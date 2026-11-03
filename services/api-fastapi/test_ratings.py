import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import auth, users
from app.main import app


class RatingsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.token = auth.issue_token("testuser_win")
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_submit_requires_auth_and_valid_fields(self):
        payload = {"stars": 5, "context": "trial"}
        self.assertEqual((await self.client.post("/api/v1/ratings", json=payload)).status_code, 401)
        res = await self.client.post("/api/v1/ratings", json=payload, headers=self.headers)
        self.assertEqual(res.status_code, 200)
        res = await self.client.post(
            "/api/v1/ratings", json={"stars": 6, "context": "trial"}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 422)
        res = await self.client.post(
            "/api/v1/ratings", json={"stars": 4, "context": "bogus"}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 422)

    async def test_public_summary_reflects_submitted_ratings(self):
        summary = (await self.client.get("/api/v1/ratings/summary")).json()
        self.assertEqual(summary, {"count": 0, "average": 0})

        await self.client.post("/api/v1/ratings", json={"stars": 4, "context": "trial"}, headers=self.headers)
        other_headers = {"Authorization": f"Bearer {auth.issue_token('otheruser')}"}
        await self.client.post("/api/v1/ratings", json={"stars": 5, "context": "paid"}, headers=other_headers)

        summary = (await self.client.get("/api/v1/ratings/summary")).json()
        self.assertEqual(summary["count"], 2)
        self.assertEqual(summary["average"], 4.5)

    async def test_a_later_rating_replaces_the_earlier_one_from_the_same_user(self):
        await self.client.post(
            "/api/v1/ratings", json={"stars": 3, "context": "trial", "comment": "decent"}, headers=self.headers,
        )
        await self.client.post(
            "/api/v1/ratings", json={"stars": 5, "context": "paid", "comment": "great after upgrading"},
            headers=self.headers,
        )
        summary = (await self.client.get("/api/v1/ratings/summary")).json()
        # Still one distinct rater, now reflecting their latest (paid-usage) score.
        self.assertEqual(summary["count"], 1)
        self.assertEqual(summary["average"], 5)
