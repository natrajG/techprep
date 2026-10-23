import unittest
import tempfile
import hashlib
import hmac
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import httpx

from app import auth, llm, subscriptions, users
from app.main import app


class SubscriptionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        self.username = "testuser_win"
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
        self.assertEqual(plans["monthly"]["call_limit"], 30)

    async def test_only_admin_can_edit_plans_and_invalid_settings_are_rejected(self):
        url = "/api/v1/subscription/plans/monthly"
        payload = {"amount": 2500, "call_limit": 12, "duration_days": 45}
        self.assertEqual((await self.client.put(url, json=payload)).status_code, 401)
        self.assertEqual((await self.client.put(url, json=payload, headers=self.headers)).status_code, 403)
        admin = {"Authorization": "Bearer " + auth.issue_token("operator")}
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            for invalid in (
                {"amount": 0, "call_limit": 12, "duration_days": 45},
                {"amount": 2500, "call_limit": 0, "duration_days": 45},
                {"amount": 2500, "call_limit": 12, "duration_days": 45, "duration_minutes": 60},
                {"amount": 2500, "call_limit": 12},
                {"amount": "2500", "call_limit": 12, "duration_days": 45},
            ):
                with self.subTest(invalid=invalid):
                    self.assertEqual((await self.client.put(url, json=invalid, headers=admin)).status_code, 422)
            self.assertEqual((await self.client.put(
                "/api/v1/subscription/plans/hourly_call",
                json={"amount": 299, "duration_minutes": 90}, headers=admin,
            )).status_code, 200)
            self.assertEqual((await self.client.put(url, json=payload, headers=admin)).status_code, 200)
        plans = (await self.client.get("/api/v1/subscription/plans")).json()["plans"]
        self.assertEqual(plans[0]["amount"], 299)
        self.assertEqual(plans[0]["duration_minutes"], 90)
        self.assertEqual(plans[1]["call_limit"], 12)
        self.assertEqual(plans[1]["duration_days"], 45)

    async def test_plan_edits_affect_new_orders_not_existing_orders_or_subscriptions(self):
        old_order = (await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "monthly"}, headers=self.headers
        )).json()
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            admin = {"Authorization": "Bearer " + auth.issue_token("operator")}
            updated = await self.client.put(
                "/api/v1/subscription/plans/monthly",
                json={"amount": 2499, "call_limit": 15, "duration_days": 45}, headers=admin,
            )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(old_order["amount"], 1999)
        old_sub = await self.client.post(
            "/api/v1/subscription/verify",
            json={"order_id": old_order["order_id"], "utr_ref": "123456789001"}, headers=self.headers,
        )
        self.assertEqual(old_sub.status_code, 200)
        old_status = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()["subscription"]
        self.assertEqual(old_status["calls_total"], 30)
        self.assertEqual(old_status["amount"], 1999)
        self.assertAlmostEqual(old_status["time_remaining_seconds"], 30 * 86400, delta=2)

        new_order = (await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "monthly"}, headers=self.headers
        )).json()
        self.assertEqual(new_order["amount"], 2499)
        self.assertEqual(new_order["plan"]["call_limit"], 15)
        self.assertIn("am=2499", new_order["upi_uri"])
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            await self.client.put(
                "/api/v1/subscription/plans/monthly",
                json={"amount": 2999, "call_limit": 7, "duration_days": 60}, headers=admin,
            )
        self.assertEqual((await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()
                         ["subscription"]["calls_total"], 30)
        await self.client.post(
            "/api/v1/subscription/verify",
            json={"order_id": new_order["order_id"], "utr_ref": "123456789002"}, headers=self.headers,
        )
        new_status = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()["subscription"]
        self.assertEqual(new_status["calls_total"], 15)
        self.assertEqual(new_status["amount"], 2499)
        self.assertAlmostEqual(new_status["time_remaining_seconds"], 45 * 86400, delta=2)

    async def test_existing_legacy_subscription_keeps_unlimited_calls(self):
        with subscriptions.get_db() as conn:
            conn.execute(
                """INSERT INTO subscriptions
                   (username, plan_id, plan_name, amount, status, created_at, session_start, valid_until)
                   VALUES (?, 'monthly', 'Monthly Pro Unlimited', 1999, 'active', 1, 1, ?)""",
                (self.username, 2**31),
            )
        status = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()["subscription"]
        self.assertIsNone(status["calls_total"])
        self.assertIsNone(status["calls_remaining"])
        with patch.dict("os.environ", {"ENFORCE_SUBSCRIPTIONS": "true"}):
            with patch.object(llm, "transcribe", AsyncMock(return_value="")):
                response = await self.client.post(
                    "/api/v1/transcribe", files={"audio": ("chunk.webm", b"a" * 1000)}, headers=self.headers
                )
        self.assertEqual(response.status_code, 200)

    async def test_hourly_duration_is_snapshotted_when_order_is_created(self):
        old_order = (await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "hourly_call"}, headers=self.headers
        )).json()
        with patch.dict("os.environ", {"APP_USERNAME": "operator"}):
            admin = {"Authorization": "Bearer " + auth.issue_token("operator")}
            await self.client.put(
                "/api/v1/subscription/plans/hourly_call",
                json={"amount": 399, "duration_minutes": 90}, headers=admin,
            )
        self.assertEqual((await self.client.post(
            "/api/v1/subscription/verify",
            json={"order_id": old_order["order_id"], "utr_ref": "123456789003"}, headers=self.headers,
        )).status_code, 200)
        old = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()["subscription"]
        self.assertEqual(old["call_duration_minutes"], 60)
        self.assertEqual(old["amount"], 199)

        new_order = (await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "hourly_call"}, headers=self.headers
        )).json()
        self.assertEqual(new_order["amount"], 399)
        self.assertEqual(new_order["plan"]["duration_minutes"], 90)
        self.assertEqual((await self.client.post(
            "/api/v1/subscription/verify",
            json={"order_id": new_order["order_id"], "utr_ref": "123456789004"}, headers=self.headers,
        )).status_code, 200)
        with patch.object(llm, "transcribe", AsyncMock(return_value="")):
            self.assertEqual((await self.client.post(
                "/api/v1/transcribe", files={"audio": ("chunk.webm", b"a" * 1000)}, headers=self.headers,
            )).status_code, 200)
        current = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()["subscription"]
        self.assertEqual(current["call_duration_minutes"], 90)
        self.assertAlmostEqual(current["time_remaining_seconds"], 90 * 60, delta=2)

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
            json={"order_id": order_data["order_id"], "utr_ref": "123456789005"},
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

    async def test_test_user_requires_twelve_digit_utr(self):
        order = (await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "hourly_call"}, headers=self.headers
        )).json()
        self.assertEqual(order["payment_mode"], "test_utr")
        for utr in ("12345678901", "12345678901A", "1234567890123", " 123456789012"):
            response = await self.client.post(
                "/api/v1/subscription/verify",
                json={"order_id": order["order_id"], "utr_ref": utr}, headers=self.headers,
            )
            self.assertEqual(response.status_code, 422)
        self.assertFalse((await self.client.get(
            "/api/v1/subscription/status", headers=self.headers
        )).json()["has_active"])

    async def test_real_payments_require_captured_full_amount_and_valid_signature(self):
        headers = {"Authorization": "Bearer " + auth.issue_token("paying_user")}
        secret = "test-secret"
        provider_order_id = "order_abc123"
        payment_id = "pay_abc123"
        def provider_request(method, path, **kwargs):
            if method == "POST":
                return {"id": provider_order_id, "amount": kwargs["json"]["amount"], "currency": "INR"}
            return payment

        with patch.dict("os.environ", {"RAZORPAY_KEY_ID": "rzp_test_key", "RAZORPAY_KEY_SECRET": secret}):
            with patch.object(subscriptions, "razorpay_request", side_effect=provider_request):
                order = (await self.client.post(
                    "/api/v1/subscription/create-order", json={"plan_id": "monthly"}, headers=headers
                )).json()
                self.assertEqual(order["payment_mode"], "razorpay")
                self.assertEqual(order["razorpay_order_id"], provider_order_id)
                signature = hmac.new(secret.encode(), f"{provider_order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
                payload = {"order_id": order["order_id"], "razorpay_payment_id": payment_id,
                           "razorpay_signature": signature}
                payment = {"id": payment_id, "order_id": provider_order_id,
                           "status": "captured", "currency": "INR", "amount": 199900}
                for invalid in (
                    {"utr_ref": "123456789012"},
                    {**payload, "razorpay_signature": "invalid"},
                ):
                    response = await self.client.post(
                        "/api/v1/subscription/verify",
                        json={"order_id": order["order_id"], **invalid}, headers=headers,
                    )
                    self.assertNotEqual(response.status_code, 200)
                for change in (
                    {"amount": 100}, {"amount": 200000}, {"amount": "199900"},
                    {"currency": "USD"}, {"status": "authorized"},
                    {"order_id": "order_other"}, {"id": "pay_other"},
                ):
                    with self.subTest(change=change):
                        payment = {**payment, **change}
                        response = await self.client.post(
                            "/api/v1/subscription/verify", json=payload, headers=headers,
                        )
                        self.assertEqual(response.status_code, 402)
                        self.assertFalse((await self.client.get(
                            "/api/v1/subscription/status", headers=headers,
                        )).json()["has_active"])
                        payment = {"id": payment_id, "order_id": provider_order_id,
                                   "status": "captured", "currency": "INR", "amount": 199900}
                response = await self.client.post(
                    "/api/v1/subscription/verify", json=payload, headers=headers,
                )
                self.assertEqual(response.status_code, 200)
                self.assertTrue((await self.client.get(
                    "/api/v1/subscription/status", headers=headers,
                )).json()["has_active"])
                self.assertEqual((await self.client.post(
                    "/api/v1/subscription/verify", json=payload, headers=headers,
                )).json()["message"], "Payment already verified")
                second_order = (await self.client.post(
                    "/api/v1/subscription/create-order", json={"plan_id": "monthly"}, headers=headers,
                )).json()
                replay = await self.client.post(
                    "/api/v1/subscription/verify",
                    json={**payload, "order_id": second_order["order_id"]}, headers=headers,
                )
                self.assertEqual(replay.status_code, 409)

    async def test_real_payment_provider_must_be_configured(self):
        headers = {"Authorization": "Bearer " + auth.issue_token("paying_user")}
        with patch.dict("os.environ", {"RAZORPAY_KEY_ID": "", "RAZORPAY_KEY_SECRET": ""}):
            response = await self.client.post(
                "/api/v1/subscription/create-order", json={"plan_id": "monthly"}, headers=headers,
            )
        self.assertEqual(response.status_code, 503)

    async def test_enforced_subscription_gate(self):
        user_unpaid = "unpaid_user"
        unpaid_headers = {"Authorization": f"Bearer {auth.issue_token(user_unpaid)}"}
        with patch.dict("os.environ", {"ENFORCE_SUBSCRIPTIONS": "true"}):
            res = await self.client.post("/api/v1/answer", json={"question": "hello"}, headers=unpaid_headers)
            self.assertEqual(res.status_code, 402)

    async def test_monthly_thirty_one_hour_calls_and_usage(self):
        order = await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "monthly"}, headers=self.headers
        )
        with patch("app.subscriptions.time.time", return_value=1000):
            verified = await self.client.post(
                "/api/v1/subscription/verify",
                json={"order_id": order.json()["order_id"], "utr_ref": "123456789006"}, headers=self.headers,
            )
        self.assertEqual(verified.status_code, 200)
        with patch("app.subscriptions.time.time", return_value=1000):
            await self.client.get("/api/v1/downloads/windows", headers=self.headers)
            unused = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()
            self.assertEqual(unused["subscription"]["calls_remaining"], 30)
            await self.client.post(
                "/api/v1/transcribe", files={"audio": ("chunk.webm", b"tiny")}, headers=self.headers
            )
            await self.client.post("/api/v1/answer", json={}, headers=self.headers)
            unused = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()
            self.assertEqual(unused["subscription"]["calls_remaining"], 30)
        with patch.dict("os.environ", {"ENFORCE_SUBSCRIPTIONS": "true"}):
            with patch.object(llm, "transcribe", AsyncMock(return_value="")):
                for call in range(30):
                    with patch("app.subscriptions.time.time", return_value=1000 + call * 3600):
                        response = await self.client.post(
                            "/api/v1/transcribe", files={"audio": ("chunk.webm", b"a" * 1000)}, headers=self.headers
                        )
                        self.assertEqual(response.status_code, 200)
                        status = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()
                        self.assertEqual(status["subscription"]["calls_used"], call + 1)
                        self.assertEqual(status["subscription"]["calls_remaining"], 29 - call)
                        self.assertEqual(status["subscription"]["call_time_remaining_seconds"], 3600)
                        self.assertEqual(status["token_usage"]["total_tokens"], 0)
                    with patch("app.subscriptions.time.time", return_value=1001 + call * 3600):
                        same_call = await self.client.post(
                            "/api/v1/transcribe", files={"audio": ("chunk.webm", b"a" * 1000)}, headers=self.headers
                        )
                        self.assertEqual(same_call.status_code, 200)
                with patch("app.subscriptions.time.time", return_value=1000 + 30 * 3600):
                    exhausted = await self.client.post(
                        "/api/v1/transcribe", files={"audio": ("chunk.webm", b"a" * 1000)}, headers=self.headers
                    )
                    self.assertEqual(exhausted.status_code, 402)
                    self.assertIn("30 one-hour calls", exhausted.json()["detail"])

        with patch("app.subscriptions.time.time", return_value=1000 + 30 * 3600):
            exhausted = await self.client.post(
                "/api/v1/answer", json={"question": "hello"}, headers=self.headers
            )
            self.assertEqual(exhausted.status_code, 402)

        users.record_token_usage(self.username, 100, 25)
        users.record_token_usage(self.username.upper(), 5, 2)
        users.record_token_usage("other-user", 900, 0)
        status = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()
        self.assertEqual(status["token_usage"], {
            "prompt_tokens": 105, "completion_tokens": 27, "total_tokens": 132,
        })

        renewal = await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "monthly"}, headers=self.headers
        )
        self.assertEqual((await self.client.post(
            "/api/v1/subscription/verify",
            json={"order_id": renewal.json()["order_id"], "utr_ref": "123456789007"}, headers=self.headers,
        )).status_code, 200)
        renewed = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()
        self.assertEqual(renewed["subscription"]["calls_remaining"], 30)
        self.assertEqual(renewed["token_usage"]["total_tokens"], 132)

    async def test_answer_and_evaluation_usage_reaches_account(self):
        provider = AsyncMock()

        async def chunks():
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="answer"))], usage=None)
            yield SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=11, completion_tokens=3))

        provider.chat.completions.create.return_value = chunks()
        with patch.object(llm, "client", return_value=provider):
            answer = await self.client.post("/api/v1/answer", json={"question": "hello"}, headers=self.headers)
        self.assertIn("answer", answer.text)
        provider.chat.completions.create.return_value = SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=7, completion_tokens=2),
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"score": 5}'))],
        )
        with patch.object(llm, "client", return_value=provider):
            evaluated = await self.client.post(
                "/api/v1/evaluate", json={"question": "hello", "answer": "world"}, headers=self.headers
            )
        self.assertEqual(evaluated.json(), {"score": 5})
        status = (await self.client.get("/api/v1/subscription/status", headers=self.headers)).json()
        self.assertEqual(status["token_usage"], {
            "prompt_tokens": 18, "completion_tokens": 5, "total_tokens": 23,
        })

    async def test_hourly_plan_still_has_single_call(self):
        order = await self.client.post(
            "/api/v1/subscription/create-order", json={"plan_id": "hourly_call"}, headers=self.headers
        )
        await self.client.post(
            "/api/v1/subscription/verify",
            json={"order_id": order.json()["order_id"], "utr_ref": "123456789008"}, headers=self.headers,
        )
        with patch.dict("os.environ", {"ENFORCE_SUBSCRIPTIONS": "true"}):
            response = await self.client.get("/api/v1/subscription/status", headers=self.headers)
            self.assertEqual(response.json()["subscription"]["calls_remaining"], 1)
            with patch.object(llm, "transcribe", AsyncMock(return_value="")):
                response = await self.client.post(
                    "/api/v1/transcribe", files={"audio": ("chunk.webm", b"a" * 1000)}, headers=self.headers
                )
            self.assertEqual(response.status_code, 200)
            response = await self.client.get("/api/v1/subscription/status", headers=self.headers)
            self.assertEqual(response.json()["subscription"]["calls_remaining"], 0)


if __name__ == "__main__":
    unittest.main()
