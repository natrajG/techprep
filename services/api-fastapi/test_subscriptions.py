import unittest
from unittest.mock import patch
import httpx

from app import auth, subscriptions, users
from app.main import app


class SubscriptionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        self.username = f"subtestuser_{id(self)}"
        self.token = auth.issue_token(self.username)
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_list_plans_public(self):
        res = await self.client.get("/api/v1/subscription/plans")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("plans", data)
        plans = {p["id"]: p for p in data["plans"]}
        self.assertIn("hourly_call", plans)
        self.assertIn("monthly", plans)
        self.assertEqual(plans["hourly_call"]["amount"], 199)
        self.assertEqual(plans["monthly"]["amount"], 1999)

    async def test_initial_subscription_status(self):
        res = await self.client.get("/api/v1/subscription/status", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["has_active"])

    async def test_create_order_and_verify_hourly(self):
        order_res = await self.client.post(
            "/api/v1/subscription/create-order",
            json={"plan_id": "hourly_call"},
            headers=self.headers,
        )
        self.assertEqual(order_res.status_code, 200)
        order_data = order_res.json()
        self.assertIn("order_id", order_data)
        self.assertIn("upi_uri", order_data)
        self.assertEqual(order_data["amount"], 199)

        # Verify payment
        verify_res = await self.client.post(
            "/api/v1/subscription/verify",
            json={"order_id": order_data["order_id"], "utr_ref": "UTR12345678"},
            headers=self.headers,
        )
        self.assertEqual(verify_res.status_code, 200)
        self.assertEqual(verify_res.json()["status"], "success")

        # Status check
        status_res = await self.client.get("/api/v1/subscription/status", headers=self.headers)
        self.assertEqual(status_res.status_code, 200)
        sub_status = status_res.json()
        self.assertTrue(sub_status["has_active"])
        self.assertEqual(sub_status["subscription"]["plan_id"], "hourly_call")

    async def test_enforced_subscription_gate(self):
        user_unpaid = "unpaid_user"
        unpaid_headers = {"Authorization": f"Bearer {auth.issue_token(user_unpaid)}"}
        with patch.dict("os.environ", {"ENFORCE_SUBSCRIPTIONS": "true"}):
            res = await self.client.post("/api/v1/answer", json={"question": "hello"}, headers=unpaid_headers)
            self.assertEqual(res.status_code, 402)


if __name__ == "__main__":
    unittest.main()
