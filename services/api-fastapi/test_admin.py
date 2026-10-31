import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import auth, subscriptions, users
from app.main import app


class AdminTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

        self.admin_user = "tp_admin"
        self.admin_headers = {"Authorization": "Bearer " + auth.issue_token(self.admin_user)}
        self.regular_user = "student1"
        self.regular_headers = {"Authorization": "Bearer " + auth.issue_token(self.regular_user)}

        # Seed regular user
        users.create_user(self.regular_user, "ValidPassword123!", "student1@example.com")
        users.record_token_usage(self.regular_user, 1500, 500)

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_admin_endpoints_require_admin_privileges(self):
        # Non-admin access should return 403
        with patch.dict("os.environ", {"APP_USERNAME": self.admin_user}):
            res = await self.client.get("/api/v1/admin/users", headers=self.regular_headers)
            self.assertEqual(res.status_code, 403)

            res = await self.client.post(
                "/api/v1/admin/grant-subscription",
                json={"username": self.regular_user, "plan_id": "monthly"},
                headers=self.regular_headers,
            )
            self.assertEqual(res.status_code, 403)

    async def test_admin_can_list_users_with_token_usage_and_subs(self):
        with patch.dict("os.environ", {"APP_USERNAME": self.admin_user}):
            res = await self.client.get("/api/v1/admin/users", headers=self.admin_headers)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["summary"]["total_users"], 1)
            self.assertEqual(data["summary"]["total_tokens_burned"], 2000)

            user_entry = data["users"][0]
            self.assertEqual(user_entry["username"], self.regular_user)
            self.assertEqual(user_entry["email"], "student1@example.com")
            self.assertEqual(user_entry["token_usage"]["total_tokens"], 2000)
            self.assertIsNone(user_entry["active_subscription"])

    async def test_admin_can_grant_and_revoke_subscription(self):
        with patch.dict("os.environ", {"APP_USERNAME": self.admin_user}):
            # Grant monthly subscription without payment
            grant_res = await self.client.post(
                "/api/v1/admin/grant-subscription",
                json={
                    "username": self.regular_user,
                    "plan_id": "monthly",
                    "plan_name": "Pro Scholarship",
                    "amount": 0,
                    "call_limit": 50,
                    "duration_days": 60,
                    "reason": "Top campus contest winner",
                },
                headers=self.admin_headers,
            )
            self.assertEqual(grant_res.status_code, 200)
            grant_data = grant_res.json()
            self.assertEqual(grant_data["status"], "success")
            self.assertEqual(grant_data["subscription"]["plan_name"], "Pro Scholarship")
            self.assertEqual(grant_data["subscription"]["calls_total"], 50)

            # Check status as regular user
            status_res = await self.client.get("/api/v1/subscription/status", headers=self.regular_headers)
            self.assertEqual(status_res.status_code, 200)
            sub_status = status_res.json()
            self.assertTrue(sub_status["has_active"])
            self.assertEqual(sub_status["subscription"]["plan_name"], "Pro Scholarship")

            # Check admin user list reflects the active subscription and recharge history
            users_res = await self.client.get("/api/v1/admin/users", headers=self.admin_headers)
            user_entry = users_res.json()["users"][0]
            self.assertIsNotNone(user_entry["active_subscription"])
            self.assertEqual(user_entry["active_subscription"]["plan_name"], "Pro Scholarship")
            self.assertEqual(user_entry["active_subscription"]["type"], "grant")
            self.assertEqual(user_entry["paid_revenue"], 0)
            self.assertEqual(users_res.json()["summary"]["actual_payment_revenue"], 0)
            self.assertEqual(users_res.json()["summary"]["total_granted_orders"], 1)
            self.assertGreaterEqual(len(user_entry["recharges"]), 1)
            self.assertEqual(user_entry["recharges"][0]["status"], "verified")
            self.assertEqual(user_entry["recharges"][0]["type"], "grant")

            # Revoke subscription
            revoke_res = await self.client.post(
                "/api/v1/admin/revoke-subscription",
                json={"username": self.regular_user},
                headers=self.admin_headers,
            )
            self.assertEqual(revoke_res.status_code, 200)

            # Verify no longer active
            status_after = await self.client.get("/api/v1/subscription/status", headers=self.regular_headers)
            self.assertFalse(status_after.json()["has_active"])
