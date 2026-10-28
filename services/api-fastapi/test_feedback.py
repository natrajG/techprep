import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import auth, feedback, users
from app.main import app


class FeedbackTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.username = "testuser_win"
        self.token = auth.issue_token(self.username)
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.admin_headers = {"Authorization": "Bearer " + auth.issue_token("operator")}

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_submit_requires_auth_and_valid_fields(self):
        payload = {"category": "bug", "message": "The listen button does nothing."}
        self.assertEqual((await self.client.post("/api/v1/feedback", json=payload)).status_code, 401)
        res = await self.client.post("/api/v1/feedback", json=payload, headers=self.headers)
        self.assertEqual(res.status_code, 200)
        res = await self.client.post(
            "/api/v1/feedback", json={"category": "not-a-category", "message": "hi"}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 422)
        res = await self.client.post(
            "/api/v1/feedback", json={"category": "bug", "message": "   "}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 422)

    async def test_submitted_feedback_is_only_visible_to_admins(self):
        payload = {"category": "suggestion", "message": "Add a dark mode.", "source": "desktop"}
        await self.client.post("/api/v1/feedback", json=payload, headers=self.headers)
        self.assertEqual((await self.client.get("/api/v1/feedback", headers=self.headers)).status_code, 403)
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            res = await self.client.get("/api/v1/feedback", headers=self.admin_headers)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["username"], self.username)
        self.assertEqual(body["items"][0]["category"], "suggestion")
        self.assertEqual(body["items"][0]["source"], "desktop")
        self.assertEqual(body["items"][0]["status"], "new")

    async def test_admin_can_resolve_and_delete_feedback(self):
        await self.client.post(
            "/api/v1/feedback", json={"category": "other", "message": "Just saying hi."}, headers=self.headers,
        )
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            listed = (await self.client.get("/api/v1/feedback", headers=self.admin_headers)).json()
            feedback_id = listed["items"][0]["id"]

            res = await self.client.put(
                f"/api/v1/feedback/{feedback_id}", json={"status": "resolved"}, headers=self.admin_headers,
            )
            self.assertEqual(res.status_code, 200)
            listed = (await self.client.get("/api/v1/feedback", headers=self.admin_headers)).json()
            self.assertEqual(listed["items"][0]["status"], "resolved")

            res = await self.client.delete(f"/api/v1/feedback/{feedback_id}", headers=self.admin_headers)
            self.assertEqual(res.status_code, 200)
            listed = (await self.client.get("/api/v1/feedback", headers=self.admin_headers)).json()
            self.assertEqual(listed["total"], 0)

            res = await self.client.delete(f"/api/v1/feedback/{feedback_id}", headers=self.admin_headers)
            self.assertEqual(res.status_code, 404)

    async def test_non_admin_cannot_resolve_or_delete(self):
        await self.client.post(
            "/api/v1/feedback", json={"category": "bug", "message": "Broken"}, headers=self.headers,
        )
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            feedback_id = (await self.client.get(
                "/api/v1/feedback", headers=self.admin_headers,
            )).json()["items"][0]["id"]
        res = await self.client.put(
            f"/api/v1/feedback/{feedback_id}", json={"status": "resolved"}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 403)
        res = await self.client.delete(f"/api/v1/feedback/{feedback_id}", headers=self.headers)
        self.assertEqual(res.status_code, 403)

    async def test_clear_resolved_only_deletes_resolved_entries(self):
        await self.client.post(
            "/api/v1/feedback", json={"category": "bug", "message": "Issue one"}, headers=self.headers,
        )
        await self.client.post(
            "/api/v1/feedback", json={"category": "bug", "message": "Issue two"}, headers=self.headers,
        )
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            items = (await self.client.get("/api/v1/feedback", headers=self.admin_headers)).json()["items"]
            resolved_id = items[0]["id"]
            await self.client.put(
                f"/api/v1/feedback/{resolved_id}", json={"status": "resolved"}, headers=self.admin_headers,
            )
            res = await self.client.delete("/api/v1/feedback/resolved", headers=self.admin_headers)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["deleted"], 1)
            remaining = (await self.client.get("/api/v1/feedback", headers=self.admin_headers)).json()
            self.assertEqual(remaining["total"], 1)
            self.assertNotEqual(remaining["items"][0]["id"], resolved_id)

    async def test_cleanup_deletes_only_entries_older_than_30_days(self):
        now = 2_000_000_000
        with users.connect() as conn:
            conn.execute(
                "INSERT INTO feedback (username, category, message, source, status, created_at) "
                "VALUES ('old_user', 'bug', 'stale', 'web', 'new', ?)",
                (now - feedback.RETENTION_SECONDS - 10,),
            )
            conn.execute(
                "INSERT INTO feedback (username, category, message, source, status, created_at) "
                "VALUES ('recent_user', 'bug', 'fresh', 'web', 'new', ?)",
                (now - 10,),
            )
        with patch("time.time", return_value=float(now)):
            deleted = feedback.cleanup_old_feedback()
        self.assertEqual(deleted, 1)
        with users.connect() as conn:
            remaining = conn.execute("SELECT username FROM feedback").fetchall()
        self.assertEqual(remaining, [("recent_user",)])


if __name__ == "__main__":
    unittest.main()
