import tempfile
import unittest
import os
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from app import auth, job_search, users


class _ProviderOk(job_search.BaseProvider):
    source = "ok-src"

    async def search(self, request: job_search.SearchRequest) -> job_search.ProviderResult:
        return job_search.ProviderResult(
            status="ok",
            jobs=[
                {
                    "source": self.source,
                    "external_id": "a1",
                    "title": f"{request.role.title()} Engineer",
                    "company": "Acme",
                    "location": request.location or "Remote",
                    "remote_type": "remote",
                    "salary_min": 100000,
                    "salary_max": 140000,
                    "currency": "INR",
                    "description_snippet": "Python, FastAPI, and AWS stack",
                    "apply_url": "https://jobs.example.com/a1",
                    "posted_at": 1_700_000_000,
                    "raw": {"id": "a1"},
                },
                {
                    "source": self.source,
                    "external_id": "a2",
                    "title": "Platform Engineer",
                    "company": "Globex",
                    "location": request.location or "Remote",
                    "remote_type": "hybrid",
                    "salary_min": 120000,
                    "salary_max": 160000,
                    "currency": "INR",
                    "description_snippet": "Kubernetes and Terraform",
                    "apply_url": "https://jobs.example.com/a2",
                    "posted_at": 1_700_000_100,
                    "raw": {"id": "a2"},
                },
            ],
        )


class _ProviderError(job_search.BaseProvider):
    source = "err-src"

    async def search(self, request: job_search.SearchRequest) -> job_search.ProviderResult:
        return job_search.ProviderResult(status="error", error="temporary outage", jobs=[])


class _ProviderCapture(job_search.BaseProvider):
    source = "capture"

    def __init__(self):
        self.locations = []

    async def search(self, request: job_search.SearchRequest) -> job_search.ProviderResult:
        self.locations.append(request.location)
        return job_search.ProviderResult(
            status="ok",
            jobs=[{
                "source": self.source,
                "external_id": request.location or "remote",
                "title": "Role",
                "company": "Acme",
                "location": request.location or "Remote",
                "remote_type": "unspecified",
                "salary_min": None,
                "salary_max": None,
                "currency": "",
                "description_snippet": "",
                "apply_url": f"https://jobs.example.com/{(request.location or 'remote').replace(' ', '-').lower()}",
                "posted_at": None,
                "raw": {},
            }],
        )


class _ProviderRoleLocationCapture(job_search.BaseProvider):
    source = "role-location-capture"

    def __init__(self):
        self.calls = []

    async def search(self, request: job_search.SearchRequest) -> job_search.ProviderResult:
        self.calls.append((request.role, request.location))
        return job_search.ProviderResult(
            status="ok",
            jobs=[{
                "source": self.source,
                "external_id": f"{request.role}:{request.location}",
                "title": f"{request.role.title()}",
                "company": "Acme",
                "location": request.location or "Remote",
                "remote_type": "unspecified",
                "salary_min": None,
                "salary_max": None,
                "currency": "",
                "description_snippet": "",
                "apply_url": f"https://jobs.example.com/{request.role.replace(' ', '-')}-{(request.location or 'remote').replace(' ', '-').lower()}",
                "posted_at": None,
                "raw": {},
            }],
        )


class _ProviderCountryFallback(job_search.BaseProvider):
    source = "country-fallback"

    def __init__(self):
        self.locations = []

    async def search(self, request: job_search.SearchRequest) -> job_search.ProviderResult:
        self.locations.append(request.location)
        if request.location != "India":
            return job_search.ProviderResult(status="ok", jobs=[])
        return job_search.ProviderResult(
            status="ok",
            jobs=[{
                "source": self.source,
                "external_id": "india-hit",
                "title": "Software Engineer",
                "company": "Acme",
                "location": "India",
                "remote_type": "unspecified",
                "salary_min": None,
                "salary_max": None,
                "currency": "",
                "description_snippet": "Country-level fallback match",
                "apply_url": "https://jobs.example.com/india-hit",
                "posted_at": None,
                "raw": {},
            }],
        )


class _ProviderRoleFallback(job_search.BaseProvider):
    source = "role-fallback"

    def __init__(self):
        self.calls = []

    async def search(self, request: job_search.SearchRequest) -> job_search.ProviderResult:
        self.calls.append((request.role, request.location))
        if request.role != "software engineer":
            return job_search.ProviderResult(status="ok", jobs=[])
        return job_search.ProviderResult(
            status="ok",
            jobs=[{
                "source": self.source,
                "external_id": "se-hit",
                "title": "Software Engineer",
                "company": "Acme",
                "location": request.location or "India",
                "remote_type": "unspecified",
                "salary_min": None,
                "salary_max": None,
                "currency": "",
                "description_snippet": "Broad role fallback",
                "apply_url": "https://jobs.example.com/se-hit",
                "posted_at": None,
                "raw": {},
            }],
        )


class JobSearchApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        app = FastAPI()
        app.include_router(job_search.router)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.addCleanup(self.client.aclose)
        self.username = "jobsearch_user"
        self.headers = {"Authorization": "Bearer " + auth.issue_token(self.username)}

    async def test_suggest_defaults_requires_resume(self):
        response = await self.client.post("/api/v1/jobs/suggest", json={"resume": " "}, headers=self.headers)
        self.assertEqual(response.status_code, 400)

    async def test_suggest_defaults_extracts_role_and_skills(self):
        response = await self.client.post(
            "/api/v1/jobs/suggest",
            json={"resume": "Senior backend engineer with Python Django AWS and Docker in Bengaluru"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["role"], "backend engineer")
        self.assertIn("python", body["skills"])
        self.assertEqual(body["country"], "in")
        self.assertIn("Bengaluru", body["locations"])

    async def test_profile_save_and_get_round_trip(self):
        save = await self.client.post(
            "/api/v1/jobs/profile/save",
            json={
                "resume": "Senior Python engineer in Hyderabad",
                "jd": "Backend role",
                "role": "backend engineer",
                "country": "in",
                "locations": ["Hyderabad", "Pune"],
                "skills": ["python", "fastapi", "postgresql"],
            },
            headers=self.headers,
        )
        self.assertEqual(save.status_code, 200)
        profile = await self.client.get("/api/v1/jobs/profile", headers=self.headers)
        self.assertEqual(profile.status_code, 200)
        body = profile.json()
        self.assertEqual(body["role"], "backend engineer")
        self.assertEqual(body["country"], "in")
        self.assertEqual(body["locations"], ["Hyderabad", "Pune"])
        self.assertIn("python", body["skills"])

    async def test_search_uses_provider_and_caches(self):
        with patch("app.job_search._providers", return_value=[_ProviderOk()]):
            first = await self.client.post(
                "/api/v1/jobs/search",
                json={"role": "backend engineer", "location": "Bengaluru", "skills": ["python", "fastapi"]},
                headers=self.headers,
            )
            self.assertEqual(first.status_code, 200)
            body = first.json()
            self.assertFalse(body["cached"])
            self.assertEqual(body["count"], 2)
            self.assertEqual(body["provider_statuses"][0]["status"], "ok")

            second = await self.client.post(
                "/api/v1/jobs/search",
                json={"role": "backend engineer", "location": "Bengaluru", "skills": ["python", "fastapi"]},
                headers=self.headers,
            )
            self.assertEqual(second.status_code, 200)
            second_body = second.json()
            self.assertTrue(second_body["cached"])
            self.assertEqual(second_body["count"], 2)

    async def test_search_all_providers_down_returns_empty_results_gracefully(self):
        # Upstream outages/rate limits/missing keys should degrade to the same friendly
        # "no jobs matched" empty state as a legitimate zero-result search, not a scary 503.
        with patch("app.job_search._providers", return_value=[_ProviderError()]):
            response = await self.client.post(
                "/api/v1/jobs/search",
                json={"role": "backend engineer", "location": "Bengaluru"},
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["jobs"], [])
            self.assertEqual(body["count"], 0)
            self.assertEqual(body["provider_statuses"][0]["status"], "error")

    async def test_search_partial_provider_failure_still_returns_jobs(self):
        with patch("app.job_search._providers", return_value=[_ProviderOk(), _ProviderError()]):
            response = await self.client.post(
                "/api/v1/jobs/search",
                json={"role": "backend engineer", "location": "Bengaluru", "force_refresh": True},
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertGreaterEqual(body["count"], 1)
            states = {item["source"]: item["status"] for item in body["provider_statuses"]}
            self.assertEqual(states["ok-src"], "ok")
            self.assertEqual(states["err-src"], "error")

    async def test_search_with_multiple_locations_queries_each_location(self):
        provider = _ProviderCapture()
        with patch("app.job_search._providers", return_value=[provider]):
            response = await self.client.post(
                "/api/v1/jobs/search",
                json={
                    "role": "backend engineer",
                    "location": "Hyderabad",
                    "locations": ["Pune", "Hyderabad", "Bengaluru"],
                    "country": "in",
                    "force_refresh": True,
                },
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(provider.locations, ["Hyderabad", "Pune", "Bengaluru"])
            self.assertEqual(body["locations"], ["Hyderabad", "Pune", "Bengaluru"])
            self.assertGreaterEqual(body["count"], 3)

    async def test_search_with_multiple_roles_queries_each_role_location_pair(self):
        provider = _ProviderRoleLocationCapture()
        with patch("app.job_search._providers", return_value=[provider]):
            response = await self.client.post(
                "/api/v1/jobs/search",
                json={
                    "roles": ["backend engineer", "python developer"],
                    "locations": ["Hyderabad", "Pune"],
                    "country": "in",
                    "force_refresh": True,
                },
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(
                provider.calls,
                [
                    ("backend engineer", "Hyderabad"),
                    ("backend engineer", "Pune"),
                    ("python developer", "Hyderabad"),
                    ("python developer", "Pune"),
                ],
            )
            self.assertEqual(body["roles"], ["backend engineer", "python developer"])
            self.assertGreaterEqual(body["count"], 4)

    async def test_search_falls_back_to_country_location_when_cities_return_empty(self):
        provider = _ProviderCountryFallback()
        with patch("app.job_search._providers", return_value=[provider]):
            response = await self.client.post(
                "/api/v1/jobs/search",
                json={
                    "role": "backend engineer",
                    "locations": ["Hyderabad", "Pune"],
                    "country": "in",
                    "force_refresh": True,
                },
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(provider.locations, ["Hyderabad", "Pune", "India"])
            self.assertEqual(body["count"], 1)

    async def test_search_falls_back_to_software_engineer_when_specific_role_returns_empty(self):
        provider = _ProviderRoleFallback()
        with patch("app.job_search._providers", return_value=[provider]):
            response = await self.client.post(
                "/api/v1/jobs/search",
                json={
                    "role": "backend engineer",
                    "locations": ["Hyderabad"],
                    "country": "in",
                    "force_refresh": True,
                },
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["count"], 1)
            self.assertEqual(provider.calls[0][0], "backend engineer")
            self.assertEqual(provider.calls[-1][0], "software engineer")

    def test_provider_selection_defaults_to_jooble(self):
        with patch.dict(os.environ, {}, clear=False):
            providers = job_search._providers()
            self.assertEqual([provider.source for provider in providers], ["jooble"])

    def test_provider_selection_respects_config_order_and_alias(self):
        with patch.dict(os.environ, {"JOB_SEARCH_PROVIDERS": "usajobs,jooble"}):
            providers = job_search._providers()
            self.assertEqual([provider.source for provider in providers], ["usajobs", "jooble"])
        with patch.dict(os.environ, {"JOB_SEARCH_PROVIDERS": "all"}):
            providers = job_search._providers()
            self.assertEqual([provider.source for provider in providers], ["adzuna", "jooble", "usajobs"])

    def test_provider_selection_ignores_unknown_and_duplicates(self):
        with patch.dict(os.environ, {"JOB_SEARCH_PROVIDERS": "jooble,unknown,jooble"}):
            providers = job_search._providers()
            self.assertEqual([provider.source for provider in providers], ["jooble"])


class JoobleProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_jooble_falls_back_to_role_only_when_role_plus_skills_returns_empty(self):
        class _FakeResponse:
            def __init__(self, payload: dict):
                self._payload = payload

            def raise_for_status(self):
                return None

            def json(self):
                return self._payload

        class _FakeClient:
            calls = []

            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def post(self, url, json):
                _FakeClient.calls.append(json)
                if len(_FakeClient.calls) == 1:
                    return _FakeResponse({"jobs": []})
                return _FakeResponse({
                    "jobs": [{
                        "id": "x1",
                        "title": "Backend Engineer",
                        "company": "Acme",
                        "location": "Hyderabad",
                        "link": "https://example.com/job/x1",
                        "snippet": "Backend role",
                    }],
                })

        request = job_search.SearchRequest(
            role="backend engineer",
            location="Hyderabad",
            skills=["python", "fastapi", "postgresql"],
            country="in",
            limit=20,
        )
        provider = job_search.JoobleProvider()
        with patch.dict(os.environ, {"JOOBLE_API_KEY": "dummy-key"}), patch("app.job_search.httpx.AsyncClient", _FakeClient):
            result = await provider.search(request)

        self.assertEqual(result.status, "ok")
        self.assertEqual(len(result.jobs), 1)
        self.assertEqual(_FakeClient.calls[0]["keywords"], "backend engineer python fastapi postgresql")
        self.assertEqual(_FakeClient.calls[1]["keywords"], "backend engineer")


if __name__ == "__main__":
    unittest.main()
