"""Deterministic ATS (Applicant Tracking System) compatibility scoring for a resume, optionally
matched against a job description.

Design notes (see ~/.copilot session plan for the full phased design):
- This phase reuses the resume/JD text already captured by the existing
  ProfileOnboarding/UserProfileModal "Resume & JD" fields — there is no new file upload here.
  Only text ever reaches this module.
- Scoring is 100% deterministic Python over the text (no LLM call, no randomness): the same
  analyzer version + input always produces the same score. This keeps the score explainable,
  reproducible, and free to run.
- The score is an estimated, application-defined compatibility assessment versioned by
  ANALYZER_VERSION — never represented as a guarantee of a real employer's ATS behavior.
"""

import json
import re
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import rate_limit, users
from .auth import require_auth

router = APIRouter(prefix="/api/v1/resume-builder")

ANALYZER_VERSION = "ats-v1"
MAX_TEXT_LENGTH = 20000
DAILY_ANALYZE_LIMIT = 30

# Category max points sum to 100, matching the breakdown table shape the product surfaces.
CATEGORY_MAX = {
    "formatting": 20,
    "keywords": 20,
    "experience": 20,
    "achievements": 15,
    "summary": 10,
    "education": 10,
    "contact": 5,
}
CATEGORY_LABELS = {
    "formatting": "Formatting and readability",
    "keywords": "Technical keywords",
    "experience": "Professional experience",
    "achievements": "Measurable achievements",
    "summary": "Professional summary",
    "education": "Education and certifications",
    "contact": "Contact information",
}

_BULLET_RE = re.compile(r"^\s*[-•*▪●○]\s+", re.MULTILINE)
_DATE_RANGE_RE = re.compile(
    r"\b(19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(19|20)\d{2}|present|current)\b", re.IGNORECASE
)
_NUMBER_IN_LINE_RE = re.compile(r"\d")
_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", re.IGNORECASE)
_PHONE_RE = re.compile(r"(\+?\d[\d\-.\s()]{8,}\d)")
_URL_RE = re.compile(r"(https?://|linkedin\.com|github\.com)", re.IGNORECASE)

_SECTION_KEYWORDS = {
    "experience": ("experience", "employment history", "work history"),
    "education": ("education", "academic background"),
    "certification": ("certification", "certifications", "licenses"),
    "summary": ("summary", "professional summary", "objective", "profile"),
    "skills": ("skills", "technical skills", "core competencies"),
}

# A small baseline of common technical/professional keywords used only when no job description
# is supplied, so the keyword category still produces a meaningful score.
_BASELINE_KEYWORDS = (
    "python", "java", "javascript", "typescript", "sql", "react", "node", "aws", "azure", "gcp",
    "docker", "kubernetes", "api", "rest", "git", "agile", "scrum", "ci/cd", "testing", "cloud",
    "database", "linux", "microservices", "machine learning", "data", "security", "devops",
)

_STOPWORDS = frozenset(
    "a an the and or for with to of in on at is are was were be been being this that as by "
    "from your you we our their his her its it will shall can may job role description "
    "responsibilities requirements preferred must have experience years".split()
)


def _schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS resume_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL COLLATE NOCASE,
            analyzer_version TEXT NOT NULL,
            overall_score INTEGER NOT NULL,
            breakdown TEXT NOT NULL,
            issues TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_resume_analyses_user ON resume_analyses (username, created_at)")


users.register_schema(_schema)


class AnalyzeRequest(BaseModel):
    resume: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)
    jd: str = Field("", max_length=MAX_TEXT_LENGTH)


def _tokenize(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-zA-Z][a-zA-Z0-9+#./-]{1,}", text.lower()) if w not in _STOPWORDS and len(w) > 1}


def _has_section(text_lower: str, names: tuple[str, ...]) -> bool:
    return any(name in text_lower for name in names)


def _score_formatting(resume: str) -> tuple[int, list[str]]:
    issues = []
    words = resume.split()
    word_count = len(words)
    score = CATEGORY_MAX["formatting"]
    if word_count < 150:
        score -= 10
        issues.append("Resume looks too short — add more detail on your roles and skills.")
    elif word_count > 1500:
        score -= 5
        issues.append("Resume looks very long — consider trimming to the most relevant content.")
    bullets = len(_BULLET_RE.findall(resume))
    if bullets < 3:
        score -= 6
        issues.append("Use bullet points (e.g. '- ') to list achievements for better ATS parsing.")
    lower = resume.lower()
    if not any(_has_section(lower, names) for names in _SECTION_KEYWORDS.values()):
        score -= 4
        issues.append("Add clear section headers (e.g. Experience, Education, Skills).")
    return max(0, score), issues


def _score_keywords(resume: str, jd: str) -> tuple[int, list[str]]:
    resume_tokens = _tokenize(resume)
    issues = []
    if jd.strip():
        jd_tokens = _tokenize(jd)
        if not jd_tokens:
            return CATEGORY_MAX["keywords"], issues
        matched = jd_tokens & resume_tokens
        ratio = len(matched) / len(jd_tokens)
        score = round(ratio * CATEGORY_MAX["keywords"])
        if ratio < 0.5:
            missing = sorted(jd_tokens - resume_tokens)[:8]
            if missing:
                issues.append("Add relevant keywords from the job description: " + ", ".join(missing))
        return max(0, min(CATEGORY_MAX["keywords"], score)), issues
    matched = [kw for kw in _BASELINE_KEYWORDS if kw in resume.lower()]
    ratio = len(matched) / len(_BASELINE_KEYWORDS)
    score = round(ratio * CATEGORY_MAX["keywords"])
    if ratio < 0.3:
        issues.append("Add more specific technical keywords and skills relevant to your target role.")
    return max(0, min(CATEGORY_MAX["keywords"], score)), issues


def _score_experience(resume: str) -> tuple[int, list[str]]:
    issues = []
    lower = resume.lower()
    score = CATEGORY_MAX["experience"]
    if not _has_section(lower, _SECTION_KEYWORDS["experience"]):
        score -= 10
        issues.append("Add a clearly labeled 'Experience' section.")
    date_ranges = len(_DATE_RANGE_RE.findall(resume))
    if date_ranges == 0:
        score -= 8
        issues.append("Include employment date ranges (e.g. 2021 - Present) for each role.")
    elif date_ranges == 1:
        score -= 2
    return max(0, score), issues


def _score_achievements(resume: str) -> tuple[int, list[str]]:
    issues = []
    bullet_lines = [m for m in resume.splitlines() if _BULLET_RE.match(m)]
    if not bullet_lines:
        issues.append("Add bullet points describing measurable achievements (e.g. 'Reduced load time by 30%').")
        return 0, issues
    quantified = sum(1 for line in bullet_lines if _NUMBER_IN_LINE_RE.search(line))
    ratio = quantified / len(bullet_lines)
    score = round(ratio * CATEGORY_MAX["achievements"])
    if ratio < 0.4:
        issues.append("Quantify more of your bullet points with numbers, percentages, or metrics.")
    return max(0, min(CATEGORY_MAX["achievements"], score)), issues


def _score_summary(resume: str) -> tuple[int, list[str]]:
    issues = []
    lower = resume.lower()
    if not _has_section(lower, _SECTION_KEYWORDS["summary"]):
        issues.append("Add a short professional summary near the top of your resume.")
        return 0, issues
    return CATEGORY_MAX["summary"], issues


def _score_education(resume: str) -> tuple[int, list[str]]:
    issues = []
    lower = resume.lower()
    has_education = _has_section(lower, _SECTION_KEYWORDS["education"])
    has_cert = _has_section(lower, _SECTION_KEYWORDS["certification"])
    if has_education and has_cert:
        return CATEGORY_MAX["education"], issues
    if has_education or has_cert:
        issues.append("List certifications alongside your education if you have any.")
        return round(CATEGORY_MAX["education"] * 0.7), issues
    issues.append("Add an Education section with your degree(s) and institution(s).")
    return 0, issues


def _score_contact(resume: str) -> tuple[int, list[str]]:
    issues = []
    score = 0
    if _EMAIL_RE.search(resume):
        score += 2
    else:
        issues.append("Add a professional email address.")
    if _PHONE_RE.search(resume):
        score += 2
    else:
        issues.append("Add a phone number.")
    if _URL_RE.search(resume):
        score += 1
    return min(CATEGORY_MAX["contact"], score), issues


def analyze(resume: str, jd: str) -> dict[str, Any]:
    """Pure function: deterministic given the same ANALYZER_VERSION + inputs."""
    breakdown: dict[str, dict[str, int]] = {}
    issues: list[str] = []

    for key, fn in (
        ("formatting", lambda: _score_formatting(resume)),
        ("keywords", lambda: _score_keywords(resume, jd)),
        ("experience", lambda: _score_experience(resume)),
        ("achievements", lambda: _score_achievements(resume)),
        ("summary", lambda: _score_summary(resume)),
        ("education", lambda: _score_education(resume)),
        ("contact", lambda: _score_contact(resume)),
    ):
        score, category_issues = fn()
        breakdown[key] = {"label": CATEGORY_LABELS[key], "score": score, "max": CATEGORY_MAX[key]}
        issues.extend(category_issues)

    overall = sum(c["score"] for c in breakdown.values())
    return {
        "analyzer_version": ANALYZER_VERSION,
        "overall_score": overall,
        "overall_max": sum(CATEGORY_MAX.values()),
        "breakdown": breakdown,
        "issues": issues,
    }


@router.post("/analyze")
async def analyze_resume(req: AnalyzeRequest, user: str = Depends(require_auth)) -> dict:
    rate_limit.consume("resume_analyze", user.lower(), DAILY_ANALYZE_LIMIT, 24 * 3600)
    resume = req.resume.strip()
    if not resume:
        raise HTTPException(400, "Paste or upload your resume text first.")
    result = analyze(resume, req.jd.strip())
    with users.connect() as conn:
        cur = conn.execute(
            "INSERT INTO resume_analyses (username, analyzer_version, overall_score, breakdown, issues, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                user,
                result["analyzer_version"],
                result["overall_score"],
                json.dumps(result["breakdown"]),
                json.dumps(result["issues"]),
                int(time.time()),
            ),
        )
        result["id"] = cur.lastrowid
    return result


@router.get("/{analysis_id}/report")
async def get_report(analysis_id: int, user: str = Depends(require_auth)) -> dict:
    with users.connect() as conn:
        row = conn.execute(
            "SELECT username, analyzer_version, overall_score, breakdown, issues, created_at "
            "FROM resume_analyses WHERE id = ?",
            (analysis_id,),
        ).fetchone()
    if row is None or row[0].lower() != user.lower():
        raise HTTPException(404, "Analysis not found.")
    return {
        "id": analysis_id,
        "analyzer_version": row[1],
        "overall_score": row[2],
        "overall_max": sum(CATEGORY_MAX.values()),
        "breakdown": json.loads(row[3]),
        "issues": json.loads(row[4]),
        "created_at": row[5],
    }
