import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import auth, history, users
from app.main import app


class HistoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

        self.username = "test_candidate"
        self.headers = {"Authorization": "Bearer " + auth.issue_token(self.username)}
        users.create_user(self.username, "SecurePass123!", "candidate@example.com")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_add_and_list_history(self):
        # Empty at start
        res = await self.client.get("/api/v1/history", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["total"], 0)
        self.assertEqual(len(res.json()["items"]), 0)

        # Add question 1
        add1 = await self.client.post(
            "/api/v1/history",
            json={
                "question": "How do you optimize React render cycles?",
                "answer": "Use React.memo, useMemo, and useCallback to prevent unnecessary re-renders.",
            },
            headers=self.headers,
        )
        self.assertEqual(add1.status_code, 200)
        q1_id = add1.json()["id"]

        # Add question 2
        add2 = await self.client.post(
            "/api/v1/history",
            json={
                "question": "Explain database indexing in PostgreSQL",
                "answer": "B-Tree indexes speed up lookups by organizing keys into a balanced tree structure.",
            },
            headers=self.headers,
        )
        self.assertEqual(add2.status_code, 200)

        # List all
        res = await self.client.get("/api/v1/history", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 2)
        self.assertEqual(len(data["items"]), 2)
        # Ordered by created_at DESC (newest first)
        self.assertEqual(data["items"][0]["question"], "Explain database indexing in PostgreSQL")

        # Search filter
        search_res = await self.client.get("/api/v1/history?search=react", headers=self.headers)
        self.assertEqual(search_res.status_code, 200)
        search_data = search_res.json()
        self.assertEqual(search_data["total"], 1)
        self.assertEqual(search_data["items"][0]["id"], q1_id)

        # Delete single item
        del_res = await self.client.delete(f"/api/v1/history/{q1_id}", headers=self.headers)
        self.assertEqual(del_res.status_code, 200)

        after_del = await self.client.get("/api/v1/history", headers=self.headers)
        self.assertEqual(after_del.json()["total"], 1)

        # Clear all
        clear_res = await self.client.delete("/api/v1/history", headers=self.headers)
        self.assertEqual(clear_res.status_code, 200)
        self.assertEqual(clear_res.json()["deleted_count"], 1)

        final_res = await self.client.get("/api/v1/history", headers=self.headers)
        self.assertEqual(final_res.json()["total"], 0)
