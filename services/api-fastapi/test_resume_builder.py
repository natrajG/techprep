import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import auth, resume_builder, users
from app.main import app

SAMPLE_JD = (
    "We need a Backend Engineer skilled in Python, Django, REST API, PostgreSQL, Docker, "
    "Kubernetes, and AWS cloud infrastructure with CI/CD experience."
)

STRONG_RESUME = """John Doe
john.doe@example.com | +1 555-123-4567 | linkedin.com/in/johndoe

Professional Summary
Backend engineer with 6 years of experience building REST APIs and cloud infrastructure.

Experience
Senior Backend Engineer, Acme Corp (2021 - Present)
- Reduced API latency by 35% by redesigning the caching layer with Redis
- Migrated legacy services to Docker and Kubernetes on AWS, cutting deployment time by 50%
- Built a Python/Django REST API used by over 200,000 daily active users

Backend Engineer, Startup Inc (2018 - 2021)
- Automated CI/CD pipelines, reducing release cycle time from days to hours
- Designed PostgreSQL schemas supporting 10x traffic growth

Education
B.S. in Computer Science, State University (2014 - 2018)

Certifications
AWS Certified Solutions Architect
"""

WEAK_RESUME = "John\nWorked at a company doing stuff with computers."


class ResumeAnalyzerPureFunctionTests(unittest.TestCase):
    """Tests the deterministic scoring function directly — no HTTP, no DB."""

    def test_strong_resume_scores_well_against_matching_jd(self):
        result = resume_builder.analyze(STRONG_RESUME, SAMPLE_JD)
        self.assertEqual(result["analyzer_version"], resume_builder.ANALYZER_VERSION)
        self.assertEqual(result["overall_max"], 100)
        self.assertGreaterEqual(result["overall_score"], 70)
        self.assertEqual(result["breakdown"]["contact"]["score"], resume_builder.CATEGORY_MAX["contact"])

    def test_weak_resume_scores_poorly_and_lists_issues(self):
        result = resume_builder.analyze(WEAK_RESUME, SAMPLE_JD)
        self.assertLess(result["overall_score"], 40)
        self.assertTrue(result["issues"])

    def test_scoring_is_reproducible(self):
        first = resume_builder.analyze(STRONG_RESUME, SAMPLE_JD)
        second = resume_builder.analyze(STRONG_RESUME, SAMPLE_JD)
        self.assertEqual(first, second)

    def test_keywords_fall_back_to_baseline_without_a_jd(self):
        result = resume_builder.analyze(STRONG_RESUME, "")
        self.assertGreater(result["breakdown"]["keywords"]["score"], 0)

    def test_category_breakdown_covers_all_seven_labels(self):
        result = resume_builder.analyze(STRONG_RESUME, SAMPLE_JD)
        self.assertEqual(set(result["breakdown"].keys()), set(resume_builder.CATEGORY_MAX.keys()))
        self.assertEqual(sum(c["max"] for c in result["breakdown"].values()), 100)


class ResumeAnalyzeApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.addCleanup(self.client.aclose)
        self.username = "testuser_resume"
        self.token = auth.issue_token(self.username)
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def test_analyze_requires_auth(self):
        res = await self.client.post("/api/v1/resume-builder/analyze", json={"resume": STRONG_RESUME})
        self.assertEqual(res.status_code, 401)

    async def test_analyze_rejects_empty_resume(self):
        res = await self.client.post(
            "/api/v1/resume-builder/analyze", json={"resume": "   ", "jd": SAMPLE_JD}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 400)

    async def test_analyze_returns_score_and_persists_report(self):
        res = await self.client.post(
            "/api/v1/resume-builder/analyze", json={"resume": STRONG_RESUME, "jd": SAMPLE_JD}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("overall_score", body)
        self.assertIn("id", body)

        report_res = await self.client.get(f"/api/v1/resume-builder/{body['id']}/report", headers=self.headers)
        self.assertEqual(report_res.status_code, 200)
        report = report_res.json()
        self.assertEqual(report["overall_score"], body["overall_score"])

    async def test_report_rejects_other_users_analysis(self):
        res = await self.client.post(
            "/api/v1/resume-builder/analyze", json={"resume": STRONG_RESUME, "jd": SAMPLE_JD}, headers=self.headers,
        )
        analysis_id = res.json()["id"]
        other_token = auth.issue_token("someone_else")
        other_headers = {"Authorization": f"Bearer {other_token}"}
        res = await self.client.get(f"/api/v1/resume-builder/{analysis_id}/report", headers=other_headers)
        self.assertEqual(res.status_code, 404)

    async def test_daily_cap_is_enforced(self):
        for _ in range(resume_builder.DAILY_ANALYZE_LIMIT):
            res = await self.client.post(
                "/api/v1/resume-builder/analyze", json={"resume": STRONG_RESUME, "jd": SAMPLE_JD}, headers=self.headers,
            )
            self.assertEqual(res.status_code, 200)
        res = await self.client.post(
            "/api/v1/resume-builder/analyze", json={"resume": STRONG_RESUME, "jd": SAMPLE_JD}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 429)


if __name__ == "__main__":
    unittest.main()
