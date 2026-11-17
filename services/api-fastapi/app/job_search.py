import asyncio
import hashlib
import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import rate_limit, users
from .auth import require_auth

router = APIRouter(prefix="/api/v1/jobs")

MAX_TEXT_LENGTH = 20000
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
CACHE_TTL_SECONDS = 24 * 3600
DAILY_SUGGEST_LIMIT = 120
DAILY_SEARCH_LIMIT = 120

_SPLIT_WORDS_RE = re.compile(r"[^a-zA-Z0-9+#]+")
_LOCATION_RE = re.compile(
    r"\b(?:in|at|from|based in)\s+([A-Z][a-zA-Z]+(?:[\s-][A-Z][a-zA-Z]+){0,2})\b"
)
_URL_HASH_RE = re.compile(r"^https?://", re.IGNORECASE)

_COMMON_SKILLS = (
    "python", "django", "flask", "fastapi", "java", "spring", "javascript",
    "typescript", "react", "node", "postgresql", "mysql", "mongodb", "redis",
    "docker", "kubernetes", "aws", "azure", "gcp", "terraform", "git",
    "rest", "graphql", "microservices", "linux", "c++", "go", "scala",
)

_ROLE_KEYWORDS = (
    ("data scientist", ("data scientist",)),
    ("machine learning engineer", ("machine learning engineer", "ml engineer")),
    ("devops engineer", ("devops engineer", "site reliability engineer", "sre")),
    ("backend engineer", ("backend engineer", "backend developer", "server-side")),
    ("frontend engineer", ("frontend engineer", "frontend developer", "ui engineer")),
    ("full stack engineer", ("full stack", "full-stack")),
    ("software engineer", ("software engineer", "software developer")),
    ("qa engineer", ("qa engineer", "quality assurance", "test engineer")),
)

_COUNTRY_NAME_BY_CODE = {
    "in": "India",
    "us": "United States",
    "gb": "United Kingdom",
    "ca": "Canada",
    "au": "Australia",
    "sg": "Singapore",
    "de": "Germany",
    "fr": "France",
    "nl": "Netherlands",
    "ae": "United Arab Emirates",
}

_COUNTRY_ALIASES = {
    "in": ("india", "bharat"),
    "us": ("united states", "usa", "u.s.", "u.s.a", "america"),
    "gb": ("united kingdom", "uk", "u.k.", "great britain", "england"),
    "ca": ("canada",),
    "au": ("australia",),
    "sg": ("singapore",),
    "de": ("germany", "deutschland"),
    "fr": ("france",),
    "nl": ("netherlands", "holland"),
    "ae": ("united arab emirates", "uae", "u.a.e"),
}

_CITY_HINTS_BY_COUNTRY = {
    "in": ("hyderabad", "pune", "bengaluru", "bangalore", "chennai", "mumbai", "delhi", "noida", "gurugram", "kolkata", "ahmedabad"),
    "us": ("new york", "san francisco", "seattle", "austin", "boston", "chicago", "los angeles", "atlanta", "dallas", "san diego"),
    "gb": ("london", "manchester", "birmingham", "leeds", "bristol", "edinburgh", "glasgow"),
    "ca": ("toronto", "vancouver", "montreal", "ottawa", "calgary"),
    "au": ("sydney", "melbourne", "brisbane", "perth", "adelaide"),
    "sg": ("singapore",),
    "de": ("berlin", "munich", "hamburg", "frankfurt", "stuttgart"),
    "fr": ("paris", "lyon", "toulouse", "marseille", "lille"),
    "nl": ("amsterdam", "rotterdam", "utrecht", "eindhoven", "the hague"),
    "ae": ("dubai", "abu dhabi", "sharjah", "ajman"),
}

_CANONICAL_CITY_CASE = {
    "bengaluru": "Bengaluru",
    "bangalore": "Bengaluru",
    "new york": "New York",
    "san francisco": "San Francisco",
    "los angeles": "Los Angeles",
    "san diego": "San Diego",
    "the hague": "The Hague",
    "abu dhabi": "Abu Dhabi",
}


def _schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS jobs_catalog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_hash TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            external_id TEXT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT NOT NULL,
            remote_type TEXT NOT NULL,
            salary_min REAL,
            salary_max REAL,
            currency TEXT,
            description_snippet TEXT,
            apply_url TEXT NOT NULL,
            posted_at INTEGER,
            raw_json TEXT NOT NULL,
            ingested_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_catalog_source ON jobs_catalog (source)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_catalog_updated ON jobs_catalog (updated_at)")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS job_search_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL COLLATE NOCASE,
            query_fingerprint TEXT NOT NULL,
            role TEXT NOT NULL,
            location TEXT NOT NULL,
            skills_json TEXT NOT NULL,
            country TEXT NOT NULL,
            limit_count INTEGER NOT NULL,
            provider_statuses_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_search_cache_lookup "
        "ON job_search_cache (username, query_fingerprint, expires_at)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS job_search_cache_items (
            search_id INTEGER NOT NULL,
            job_id INTEGER NOT NULL,
            rank_order INTEGER NOT NULL,
            PRIMARY KEY (search_id, job_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_search_cache_items_rank "
        "ON job_search_cache_items (search_id, rank_order)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS job_search_profiles (
            username TEXT PRIMARY KEY COLLATE NOCASE,
            resume TEXT NOT NULL,
            jd TEXT NOT NULL,
            role TEXT NOT NULL,
            country TEXT NOT NULL,
            locations_json TEXT NOT NULL,
            skills_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )"""
    )


users.register_schema(_schema)


class SuggestRequest(BaseModel):
    resume: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)
    jd: str = Field("", max_length=MAX_TEXT_LENGTH)


class SearchRequest(BaseModel):
    resume: str = Field("", max_length=MAX_TEXT_LENGTH)
    role: str = Field("", max_length=120)
    roles: list[str] = Field(default_factory=list, max_length=10)
    location: str = Field("", max_length=120)
    locations: list[str] = Field(default_factory=list, max_length=10)
    skills: list[str] = Field(default_factory=list, max_length=30)
    country: str = Field("in", pattern=r"^[A-Za-z]{2}$")
    limit: int = Field(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    force_refresh: bool = False


class ProfileSaveRequest(BaseModel):
    resume: str | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    jd: str | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    role: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, pattern=r"^[A-Za-z]{2}$")
    locations: list[str] | None = Field(default=None, max_length=10)
    skills: list[str] | None = Field(default=None, max_length=30)


def _normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _clean_skill(skill: str) -> str:
    value = _normalize_spaces(skill).lower()
    return re.sub(r"[^a-z0-9+#.\- ]", "", value)[:40].strip()


def _tokenize(text: str) -> list[str]:
    return [token for token in _SPLIT_WORDS_RE.split((text or "").lower()) if len(token) >= 2]


def _infer_role(text: str) -> str:
    lowered = text.lower()
    for canonical, aliases in _ROLE_KEYWORDS:
        if any(alias in lowered for alias in aliases):
            return canonical
    tokens = _tokenize(text)
    if "python" in tokens and "django" in tokens:
        return "backend engineer"
    if "react" in tokens and "node" in tokens:
        return "full stack engineer"
    if "aws" in tokens or "kubernetes" in tokens:
        return "devops engineer"
    return "software engineer"


def _infer_location(text: str) -> str:
    match = _LOCATION_RE.search(text or "")
    if match:
        return _normalize_spaces(match.group(1))
    return ""


def _pretty_city_name(raw_city: str) -> str:
    key = raw_city.strip().lower()
    if not key:
        return ""
    if key in _CANONICAL_CITY_CASE:
        return _CANONICAL_CITY_CASE[key]
    return " ".join(part.capitalize() for part in key.split())


def _infer_country_code(text: str) -> str:
    lowered = (text or "").lower()
    for code, aliases in _COUNTRY_ALIASES.items():
        if any(alias in lowered for alias in aliases):
            return code
    if "+91" in lowered or " india " in f" {lowered} ":
        return "in"
    return ""


def _infer_locations(text: str, country_code: str) -> list[str]:
    lowered = (text or "").lower()
    candidates = _CITY_HINTS_BY_COUNTRY.get(country_code, ()) if country_code else tuple(
        city for cities in _CITY_HINTS_BY_COUNTRY.values() for city in cities
    )
    found: list[str] = []
    for city in candidates:
        if re.search(rf"\b{re.escape(city)}\b", lowered):
            pretty = _pretty_city_name(city)
            if pretty and pretty not in found:
                found.append(pretty)
    return found[:5]


def _infer_skills(resume: str, jd: str) -> list[str]:
    tokens = set(_tokenize(f"{resume} {jd}"))
    picked = [skill for skill in _COMMON_SKILLS if skill in tokens]
    return picked[:12]


def infer_search_defaults(resume: str, jd: str) -> dict[str, Any]:
    merged = _normalize_spaces(f"{resume}\n{jd}")
    country = _infer_country_code(merged) or "in"
    locations = _infer_locations(merged, country)
    inferred_location = _infer_location(merged)
    if inferred_location and inferred_location not in locations:
        locations.insert(0, inferred_location)
    locations = locations[:5]
    return {
        "role": _infer_role(merged),
        "location": locations[0] if locations else "",
        "locations": locations,
        "country": country,
        "skills": _infer_skills(resume, jd),
    }


def _job_hash(source: str, external_id: str, apply_url: str, title: str, company: str, location: str) -> str:
    if external_id:
        material = f"{source}|{external_id.strip().lower()}"
    elif _URL_HASH_RE.match(apply_url or ""):
        material = f"{source}|{apply_url.strip().lower()}"
    else:
        material = f"{source}|{title.strip().lower()}|{company.strip().lower()}|{location.strip().lower()}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _safe_int_timestamp(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            return int(time.mktime(time.strptime(raw[:19], fmt)))
        except ValueError:
            continue
    return None


@dataclass
class ProviderResult:
    jobs: list[dict[str, Any]]
    status: str
    error: str = ""


class BaseProvider:
    source = "unknown"

    async def search(self, request: SearchRequest) -> ProviderResult:
        raise NotImplementedError


class AdzunaProvider(BaseProvider):
    source = "adzuna"

    async def search(self, request: SearchRequest) -> ProviderResult:
        app_id = os.getenv("ADZUNA_APP_ID", "").strip()
        app_key = os.getenv("ADZUNA_APP_KEY", "").strip()
        if not app_id or not app_key:
            return ProviderResult(jobs=[], status="disabled", error="ADZUNA_APP_ID/ADZUNA_APP_KEY not configured")
        country = request.country.lower()
        query = " ".join([request.role, *request.skills[:5]]).strip()
        params = {
            "app_id": app_id,
            "app_key": app_key,
            "results_per_page": request.limit,
            "what": query or request.role,
            "where": request.location,
            "content-type": "application/json",
        }
        url = f"https://api.adzuna.com/v1/api/jobs/{country}/search/1"
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            return ProviderResult(jobs=[], status="error", error=f"Adzuna unavailable: {exc}")
        jobs = []
        for item in payload.get("results", []):
            title = _normalize_spaces(item.get("title", ""))
            company = _normalize_spaces((item.get("company") or {}).get("display_name", ""))
            location = _normalize_spaces((item.get("location") or {}).get("display_name", ""))
            apply_url = item.get("redirect_url") or item.get("adref") or ""
            if not title or not apply_url:
                continue
            jobs.append({
                "source": self.source,
                "external_id": str(item.get("id") or ""),
                "title": title,
                "company": company or "Unknown company",
                "location": location or request.location or "Not specified",
                "remote_type": "unspecified",
                "salary_min": item.get("salary_min"),
                "salary_max": item.get("salary_max"),
                "currency": item.get("salary_currency") or "",
                "description_snippet": _normalize_spaces(item.get("description", ""))[:500],
                "apply_url": apply_url,
                "posted_at": _safe_int_timestamp(item.get("created")),
                "raw": item,
            })
        return ProviderResult(jobs=jobs, status="ok")


class JoobleProvider(BaseProvider):
    source = "jooble"

    async def search(self, request: SearchRequest) -> ProviderResult:
        api_key = os.getenv("JOOBLE_API_KEY", "").strip()
        if not api_key:
            return ProviderResult(jobs=[], status="disabled", error="JOOBLE_API_KEY not configured")
        configured_domain = os.getenv("JOOBLE_COUNTRY_DOMAIN", "").strip().lower()
        configured_domain = re.sub(r"^https?://", "", configured_domain).strip("/")
        country = request.country.lower()
        primary_keywords = " ".join([request.role, *request.skills[:6]]).strip() or request.role
        body = {"keywords": primary_keywords, "location": request.location, "page": 1}
        domain = configured_domain or (f"{country}.jooble.org" if country else "jooble.org")
        url = f"https://{domain}/api/{api_key}"
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                response = await client.post(url, json=body)
                response.raise_for_status()
                payload = response.json()
                fallback_keywords = request.role.strip()
                if not payload.get("jobs") and request.skills and fallback_keywords and fallback_keywords != primary_keywords:
                    fallback_response = await client.post(
                        url,
                        json={"keywords": fallback_keywords, "location": request.location, "page": 1},
                    )
                    fallback_response.raise_for_status()
                    fallback_payload = fallback_response.json()
                    if fallback_payload.get("jobs"):
                        payload = fallback_payload
        except (httpx.HTTPError, ValueError) as exc:
            return ProviderResult(jobs=[], status="error", error=f"Jooble unavailable: {exc}")
        jobs = []
        for item in payload.get("jobs", []):
            title = _normalize_spaces(item.get("title", ""))
            apply_url = item.get("link") or ""
            if not title or not apply_url:
                continue
            jobs.append({
                "source": self.source,
                "external_id": str(item.get("id") or item.get("link") or ""),
                "title": title,
                "company": _normalize_spaces(item.get("company", "")) or "Unknown company",
                "location": _normalize_spaces(item.get("location", "")) or request.location or "Not specified",
                "remote_type": "unspecified",
                "salary_min": None,
                "salary_max": None,
                "currency": "",
                "description_snippet": _normalize_spaces(item.get("snippet", ""))[:500],
                "apply_url": apply_url,
                "posted_at": _safe_int_timestamp(item.get("updated")),
                "raw": item,
            })
        return ProviderResult(jobs=jobs, status="ok")


class UsajobsProvider(BaseProvider):
    source = "usajobs"

    async def search(self, request: SearchRequest) -> ProviderResult:
        api_key = os.getenv("USAJOBS_API_KEY", "").strip()
        if not api_key:
            return ProviderResult(jobs=[], status="disabled", error="USAJOBS_API_KEY not configured")
        user_agent = os.getenv("USAJOBS_USER_AGENT", "techprep-job-search")
        params = {
            "Keyword": " ".join([request.role, *request.skills[:4]]).strip() or request.role,
            "LocationName": request.location,
            "ResultsPerPage": request.limit,
            "Page": 1,
        }
        headers = {
            "Host": "data.usajobs.gov",
            "User-Agent": user_agent,
            "Authorization-Key": api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                response = await client.get("https://data.usajobs.gov/api/search", params=params, headers=headers)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            return ProviderResult(jobs=[], status="error", error=f"USAJOBS unavailable: {exc}")
        jobs = []
        items = (
            payload.get("SearchResult", {})
            .get("SearchResultItems", [])
        )
        for wrapper in items:
            item = wrapper.get("MatchedObjectDescriptor") or {}
            title = _normalize_spaces(item.get("PositionTitle", ""))
            apply_uri = (item.get("PositionURI") or [""])[0] if isinstance(item.get("PositionURI"), list) else item.get("PositionURI") or ""
            if not title or not apply_uri:
                continue
            org = item.get("OrganizationName") or "United States Government"
            locations = item.get("PositionLocationDisplay") or "United States"
            remuneration = (item.get("PositionRemuneration") or [{}])[0]
            posted_at = _safe_int_timestamp(item.get("PublicationStartDate"))
            jobs.append({
                "source": self.source,
                "external_id": str(item.get("PositionID") or ""),
                "title": title,
                "company": _normalize_spaces(org),
                "location": _normalize_spaces(locations),
                "remote_type": "unspecified",
                "salary_min": remuneration.get("MinimumRange"),
                "salary_max": remuneration.get("MaximumRange"),
                "currency": remuneration.get("RateIntervalCode") or "",
                "description_snippet": _normalize_spaces(item.get("UserArea", {}).get("Details", {}).get("MajorDuties", ""))[:500],
                "apply_url": apply_uri,
                "posted_at": posted_at,
                "raw": item,
            })
        return ProviderResult(jobs=jobs, status="ok")


_PROVIDER_FACTORIES: dict[str, type[BaseProvider]] = {
    "adzuna": AdzunaProvider,
    "jooble": JoobleProvider,
    "usajobs": UsajobsProvider,
}


def _providers() -> list[BaseProvider]:
    configured = os.getenv("JOB_SEARCH_PROVIDERS", "jooble")
    names = [value.strip().lower() for value in configured.split(",") if value.strip()]
    if not names:
        names = ["jooble"]
    selected: list[BaseProvider] = []
    seen: set[str] = set()
    for name in names:
        if name == "all":
            for default_name in ("adzuna", "jooble", "usajobs"):
                if default_name not in seen:
                    selected.append(_PROVIDER_FACTORIES[default_name]())
                    seen.add(default_name)
            continue
        provider_cls = _PROVIDER_FACTORIES.get(name)
        if not provider_cls or name in seen:
            continue
        selected.append(provider_cls())
        seen.add(name)
    return selected or [JoobleProvider()]


def _query_fingerprint(user: str, roles: list[str], locations: list[str], skills: list[str], country: str, limit: int) -> str:
    material = json.dumps(
        {
            "u": user.lower(),
            "roles": [role.lower() for role in roles],
            "locations": [location.lower() for location in locations],
            "skills": [s.lower() for s in skills],
            "country": country.lower(),
            "limit": limit,
        },
        sort_keys=True,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _score_job(job: dict[str, Any], role: str, skills: list[str]) -> float:
    title_lower = job["title"].lower()
    desc_lower = (job.get("description_snippet") or "").lower()
    role_score = 4.0 if role.lower() in title_lower else 1.0
    skill_hits = sum(1 for skill in skills if skill.lower() in title_lower or skill.lower() in desc_lower)
    freshness = 0.0
    if job.get("posted_at"):
        age_days = max(0, (int(time.time()) - int(job["posted_at"])) // 86400)
        freshness = max(0.0, 3.0 - min(3.0, age_days / 7))
    source_weight = {"adzuna": 1.2, "jooble": 1.1, "usajobs": 1.0}.get(job["source"], 1.0)
    return (role_score + skill_hits + freshness) * source_weight


def _persist_jobs(
    conn: sqlite3.Connection,
    username: str,
    request: SearchRequest,
    jobs: list[dict[str, Any]],
    provider_statuses: list[dict[str, str]],
    fingerprint: str,
) -> int:
    now = int(time.time())
    expires_at = now + CACHE_TTL_SECONDS
    conn.execute("BEGIN IMMEDIATE")
    conn.execute(
        "DELETE FROM job_search_cache_items WHERE search_id IN "
        "(SELECT id FROM job_search_cache WHERE username = ? AND query_fingerprint = ?)",
        (username, fingerprint),
    )
    conn.execute(
        "DELETE FROM job_search_cache WHERE username = ? AND query_fingerprint = ?",
        (username, fingerprint),
    )
    cursor = conn.execute(
        """INSERT INTO job_search_cache
           (username, query_fingerprint, role, location, skills_json, country, limit_count, provider_statuses_json, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            username,
            fingerprint,
            request.role,
            request.location,
            json.dumps(request.skills),
            request.country.lower(),
            request.limit,
            json.dumps(provider_statuses),
            now,
            expires_at,
        ),
    )
    search_id = int(cursor.lastrowid)
    ranked = sorted(jobs, key=lambda item: _score_job(item, request.role, request.skills), reverse=True)
    for rank_order, job in enumerate(ranked, start=1):
        job_hash = _job_hash(
            job["source"], str(job.get("external_id") or ""), job["apply_url"],
            job["title"], job["company"], job["location"],
        )
        conn.execute(
            """INSERT INTO jobs_catalog
               (job_hash, source, external_id, title, company, location, remote_type, salary_min, salary_max, currency,
                description_snippet, apply_url, posted_at, raw_json, ingested_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(job_hash) DO UPDATE SET
                 source=excluded.source,
                 external_id=excluded.external_id,
                 title=excluded.title,
                 company=excluded.company,
                 location=excluded.location,
                 remote_type=excluded.remote_type,
                 salary_min=excluded.salary_min,
                 salary_max=excluded.salary_max,
                 currency=excluded.currency,
                 description_snippet=excluded.description_snippet,
                 apply_url=excluded.apply_url,
                 posted_at=excluded.posted_at,
                 raw_json=excluded.raw_json,
                 updated_at=excluded.updated_at""",
            (
                job_hash,
                job["source"],
                str(job.get("external_id") or ""),
                job["title"],
                job["company"],
                job["location"],
                job.get("remote_type") or "unspecified",
                job.get("salary_min"),
                job.get("salary_max"),
                job.get("currency") or "",
                job.get("description_snippet") or "",
                job["apply_url"],
                job.get("posted_at"),
                json.dumps(job.get("raw") or {}),
                now,
                now,
            ),
        )
        job_id = conn.execute("SELECT id FROM jobs_catalog WHERE job_hash = ?", (job_hash,)).fetchone()[0]
        conn.execute(
            "INSERT INTO job_search_cache_items (search_id, job_id, rank_order) VALUES (?, ?, ?)",
            (search_id, job_id, rank_order),
        )
    conn.execute("DELETE FROM job_search_cache WHERE expires_at <= ?", (now,))
    conn.execute(
        "DELETE FROM jobs_catalog WHERE updated_at <= ? AND id NOT IN "
        "(SELECT DISTINCT job_id FROM job_search_cache_items)",
        (now - CACHE_TTL_SECONDS,),
    )
    return search_id


def _read_cached_search(conn: sqlite3.Connection, username: str, fingerprint: str) -> tuple[int, list[dict[str, Any]], list[dict[str, str]]] | None:
    now = int(time.time())
    search_row = conn.execute(
        "SELECT id, provider_statuses_json FROM job_search_cache "
        "WHERE username = ? AND query_fingerprint = ? AND expires_at > ? "
        "ORDER BY created_at DESC LIMIT 1",
        (username, fingerprint, now),
    ).fetchone()
    if not search_row:
        return None
    rows = conn.execute(
        """SELECT j.source, j.external_id, j.title, j.company, j.location, j.remote_type,
                  j.salary_min, j.salary_max, j.currency, j.description_snippet, j.apply_url, j.posted_at
           FROM job_search_cache_items c
           JOIN jobs_catalog j ON j.id = c.job_id
           WHERE c.search_id = ?
           ORDER BY c.rank_order ASC""",
        (search_row[0],),
    ).fetchall()
    jobs = []
    for row in rows:
        jobs.append(
            {
                "source": row[0],
                "external_id": row[1],
                "title": row[2],
                "company": row[3],
                "location": row[4],
                "remote_type": row[5],
                "salary_min": row[6],
                "salary_max": row[7],
                "currency": row[8],
                "description_snippet": row[9],
                "apply_url": row[10],
                "posted_at": row[11],
            }
        )
    statuses = json.loads(search_row[1]) if search_row[1] else []
    return int(search_row[0]), jobs, statuses


@router.post("/suggest")
async def suggest_search_defaults(req: SuggestRequest, user: str = Depends(require_auth)) -> dict[str, Any]:
    rate_limit.consume("job_search_suggest", user.lower(), DAILY_SUGGEST_LIMIT, 24 * 3600)
    resume = _normalize_spaces(req.resume)
    if not resume:
        raise HTTPException(400, "Paste or upload your resume text first.")
    return infer_search_defaults(resume, req.jd)


@router.get("/profile")
async def get_job_profile(user: str = Depends(require_auth)) -> dict[str, Any]:
    with users.connect() as conn:
        row = conn.execute(
            "SELECT resume, jd, role, country, locations_json, skills_json, updated_at "
            "FROM job_search_profiles WHERE username = ?",
            (user,),
        ).fetchone()
    if not row:
        return {
            "resume": "",
            "jd": "",
            "role": "",
            "country": "",
            "locations": [],
            "skills": [],
            "updated_at": None,
        }
    return {
        "resume": row[0] or "",
        "jd": row[1] or "",
        "role": row[2] or "",
        "country": row[3] or "",
        "locations": json.loads(row[4]) if row[4] else [],
        "skills": json.loads(row[5]) if row[5] else [],
        "updated_at": row[6],
    }


@router.post("/profile/save")
async def save_job_profile(req: ProfileSaveRequest, user: str = Depends(require_auth)) -> dict[str, Any]:
    with users.connect() as conn:
        existing = conn.execute(
            "SELECT resume, jd, role, country, locations_json, skills_json FROM job_search_profiles WHERE username = ?",
            (user,),
        ).fetchone()
        current_resume = existing[0] if existing else ""
        current_jd = existing[1] if existing else ""
        current_role = existing[2] if existing else ""
        current_country = existing[3] if existing else ""
        current_locations = json.loads(existing[4]) if existing and existing[4] else []
        current_skills = json.loads(existing[5]) if existing and existing[5] else []

        next_resume = req.resume.strip() if req.resume is not None else current_resume
        next_jd = req.jd.strip() if req.jd is not None else current_jd
        next_role = _normalize_spaces(req.role) if req.role is not None else current_role
        next_country = req.country.lower() if req.country is not None else current_country
        next_locations = current_locations
        if req.locations is not None:
            deduped_locations: list[str] = []
            for value in req.locations:
                normalized = _normalize_spaces(value)
                if normalized and normalized not in deduped_locations:
                    deduped_locations.append(normalized)
            next_locations = deduped_locations[:10]
        next_skills = current_skills
        if req.skills is not None:
            deduped_skills: list[str] = []
            for value in req.skills:
                cleaned = _clean_skill(value)
                if cleaned and cleaned not in deduped_skills:
                    deduped_skills.append(cleaned)
            next_skills = deduped_skills[:20]

        conn.execute(
            """INSERT INTO job_search_profiles
               (username, resume, jd, role, country, locations_json, skills_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(username) DO UPDATE SET
                 resume=excluded.resume,
                 jd=excluded.jd,
                 role=excluded.role,
                 country=excluded.country,
                 locations_json=excluded.locations_json,
                 skills_json=excluded.skills_json,
                 updated_at=excluded.updated_at""",
            (
                user,
                next_resume,
                next_jd,
                next_role,
                next_country,
                json.dumps(next_locations),
                json.dumps(next_skills),
                int(time.time()),
            ),
        )
    return {"ok": True}


@router.post("/search")
async def search_jobs(req: SearchRequest, user: str = Depends(require_auth)) -> dict[str, Any]:
    rate_limit.consume("job_search", user.lower(), DAILY_SEARCH_LIMIT, 24 * 3600)
    roles: list[str] = []
    for value in [req.role, *req.roles]:
        normalized = _normalize_spaces(value)
        if normalized and normalized not in roles:
            roles.append(normalized)
    roles = roles[:5]
    locations: list[str] = []
    for value in [req.location, *req.locations]:
        normalized = _normalize_spaces(value)
        if normalized and normalized not in locations:
            locations.append(normalized)
    locations = locations[:5]
    cleaned_skills = []
    for skill in req.skills:
        cleaned = _clean_skill(skill)
        if cleaned and cleaned not in cleaned_skills:
            cleaned_skills.append(cleaned)
    cleaned_skills = cleaned_skills[:20]

    if not roles:
        if _normalize_spaces(req.resume):
            inferred = infer_search_defaults(req.resume, "")
            inferred_role = _normalize_spaces(inferred["role"])
            if inferred_role:
                roles = [inferred_role]
            if not cleaned_skills:
                cleaned_skills = inferred["skills"]
    if not roles:
        raise HTTPException(400, "Role is required. Provide role or include resume text for auto-extraction.")

    normalized = SearchRequest(
        resume="",
        role=roles[0],
        roles=roles,
        location=locations[0] if locations else "",
        locations=locations,
        skills=cleaned_skills,
        country=req.country.lower(),
        limit=req.limit,
        force_refresh=req.force_refresh,
    )
    fingerprint = _query_fingerprint(user, normalized.roles, normalized.locations, normalized.skills, normalized.country, normalized.limit)

    with users.connect() as conn:
        cached = None if req.force_refresh else _read_cached_search(conn, user, fingerprint)
    if cached:
        _, jobs, statuses = cached
        if jobs:
            return {
                "cached": True,
                "role": normalized.role,
                "roles": normalized.roles,
                "location": normalized.location,
                "locations": normalized.locations,
                "skills": normalized.skills,
                "country": normalized.country,
                "jobs": jobs[:normalized.limit],
                "provider_statuses": statuses,
                "count": min(len(jobs), normalized.limit),
            }

    providers = _providers()
    requests_by_location = [
        SearchRequest(
            resume="",
            role=role,
            roles=[],
            location=location,
            locations=[],
            skills=normalized.skills,
            country=normalized.country,
            limit=normalized.limit,
            force_refresh=normalized.force_refresh,
        )
        for role in normalized.roles
        for location in (normalized.locations or [""])
    ]
    provider_aggregate = {
        provider.source: {"status": "disabled", "error": "", "ok_count": 0, "errors": [], "disabled_count": 0}
        for provider in providers
    }
    all_jobs: list[dict[str, Any]] = []
    for location_request in requests_by_location:
        provider_results = await asyncio.gather(*(provider.search(location_request) for provider in providers))
        for provider, result in zip(providers, provider_results):
            aggregate = provider_aggregate[provider.source]
            if result.status == "ok":
                aggregate["status"] = "ok"
                aggregate["ok_count"] += 1
            elif result.status == "error" and aggregate["status"] != "ok":
                aggregate["status"] = "error"
                if result.error:
                    aggregate["errors"].append(result.error)
            elif result.status == "disabled" and aggregate["status"] not in ("ok", "error"):
                aggregate["disabled_count"] += 1
            all_jobs.extend(result.jobs)

    fallback_country_location = _COUNTRY_NAME_BY_CODE.get(normalized.country, "")
    if not all_jobs and fallback_country_location:
        existing_locations = {location.lower() for location in normalized.locations}
        if fallback_country_location.lower() not in existing_locations:
            fallback_request = SearchRequest(
                resume="",
                role=normalized.roles[0],
                roles=[],
                location=fallback_country_location,
                locations=[],
                skills=normalized.skills,
                country=normalized.country,
                limit=normalized.limit,
                force_refresh=normalized.force_refresh,
            )
            provider_results = await asyncio.gather(*(provider.search(fallback_request) for provider in providers))
            for provider, result in zip(providers, provider_results):
                aggregate = provider_aggregate[provider.source]
                if result.status == "ok":
                    aggregate["status"] = "ok"
                    aggregate["ok_count"] += 1
                elif result.status == "error" and aggregate["status"] != "ok":
                    aggregate["status"] = "error"
                    if result.error:
                        aggregate["errors"].append(result.error)
                elif result.status == "disabled" and aggregate["status"] not in ("ok", "error"):
                    aggregate["disabled_count"] += 1
                all_jobs.extend(result.jobs)

    if not all_jobs and "software engineer" not in [role.lower() for role in normalized.roles]:
        broad_request = SearchRequest(
            resume="",
            role="software engineer",
            roles=[],
            location=normalized.location or fallback_country_location,
            locations=[],
            skills=[],
            country=normalized.country,
            limit=normalized.limit,
            force_refresh=normalized.force_refresh,
        )
        provider_results = await asyncio.gather(*(provider.search(broad_request) for provider in providers))
        for provider, result in zip(providers, provider_results):
            aggregate = provider_aggregate[provider.source]
            if result.status == "ok":
                aggregate["status"] = "ok"
                aggregate["ok_count"] += 1
            elif result.status == "error" and aggregate["status"] != "ok":
                aggregate["status"] = "error"
                if result.error:
                    aggregate["errors"].append(result.error)
            elif result.status == "disabled" and aggregate["status"] not in ("ok", "error"):
                aggregate["disabled_count"] += 1
            all_jobs.extend(result.jobs)
    statuses = []
    for provider in providers:
        aggregate = provider_aggregate[provider.source]
        error = ""
        if aggregate["errors"]:
            unique_errors = list(dict.fromkeys(aggregate["errors"]))
            error = unique_errors[0] if len(unique_errors) == 1 else "; ".join(unique_errors[:2])
        statuses.append({"source": provider.source, "status": aggregate["status"], "error": error})

    # Degrade gracefully when every provider is unavailable (missing keys, upstream rate limits,
    # or transient outages): return an empty result set instead of a scary 503, matching the
    # same "no jobs matched" empty state the UI already shows for zero-result searches. The
    # per-provider status/error below still lets admins diagnose the real cause from the logs.

    seen_keys: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for job in all_jobs:
        key = _job_hash(
            job["source"], str(job.get("external_id") or ""), job["apply_url"],
            job["title"], job["company"], job["location"],
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(job)
    deduped = deduped[: normalized.limit * 3]

    with users.connect() as conn:
        _persist_jobs(conn, user, normalized, deduped, statuses, fingerprint)
        cached = _read_cached_search(conn, user, fingerprint)
    if not cached:
        raise HTTPException(500, "Could not persist job search results.")
    _, jobs, provider_statuses = cached
    return {
        "cached": False,
        "role": normalized.role,
        "roles": normalized.roles,
        "location": normalized.location,
        "locations": normalized.locations,
        "skills": normalized.skills,
        "country": normalized.country,
        "jobs": jobs[:normalized.limit],
        "provider_statuses": provider_statuses,
        "count": min(len(jobs), normalized.limit),
    }
