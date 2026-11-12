import hashlib
import hmac
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app import auth, llm, resume_payment, resume_rebuild, users
from app.main import app

REBUILT_PAYLOAD = {
    "name": "Jane Doe",
    "contact": "jane@example.com | +1 555-000-1111",
    "summary": "Backend engineer with experience building REST APIs.",
    "experience": [
        {
            "title": "Backend Engineer",
            "company": "Acme Corp",
            "dates": "2021 - Present",
            "bullets": ["Reduced API latency by 35% by redesigning the caching layer"],
        }
    ],
    "education": [{"degree": "B.S. Computer Science", "institution": "State University", "dates": "2014 - 2018"}],
    "certifications": ["AWS Certified Solutions Architect"],
    "skills": ["Python", "Django", "AWS", "Docker"],
}

SAMPLE_RESUME = """Jane Doe
jane@example.com | +1 555-000-1111

Experience
Backend Engineer, Acme Corp (2021 - Present)
- Reduced latency

Education
B.S. Computer Science, State University (2014 - 2018)
"""


def _fake_chat_response(payload: dict):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])


def _fake_client(payload: dict):
    create = AsyncMock(return_value=_fake_chat_response(payload))
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


class ResumePaymentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client_patch = patch.object(llm, "_client", None)
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.addCleanup(self.client.aclose)

    async def _make_version(self, username: str) -> int:
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            result = await resume_rebuild.rebuild_and_score(username, None, SAMPLE_RESUME, "")
        return result["version_id"]

    async def test_download_requires_payment_first(self):
        token = auth.issue_token("buyer_one")
        headers = {"Authorization": f"Bearer {token}"}
        version_id = await self._make_version("buyer_one")

        res = await self.client.get(
            f"/api/v1/resume-builder/version/{version_id}/download?fmt=pdf", headers=headers,
        )
        self.assertEqual(res.status_code, 402)

        entitlement = await self.client.get("/api/v1/resume-builder/payment/entitlement", headers=headers)
        self.assertFalse(entitlement.json()["active"])

    async def test_test_user_payment_unlocks_all_their_versions_for_24h(self):
        token = auth.issue_token(resume_payment.TEST_PAYMENT_USER)
        headers = {"Authorization": f"Bearer {token}"}
        version_one = await self._make_version(resume_payment.TEST_PAYMENT_USER)

        order_res = await self.client.post("/api/v1/resume-builder/payment/create-order", headers=headers)
        self.assertEqual(order_res.status_code, 200)
        order = order_res.json()
        self.assertEqual(order["amount"], resume_payment.RESUME_REBUILD_PRICE)
        self.assertEqual(order["payment_mode"], "test_utr")
        self.assertEqual(order["entitlement_hours"], 24)

        bad_utr = await self.client.post(
            "/api/v1/resume-builder/payment/verify",
            json={"order_id": order["order_id"], "utr_ref": "123"},
            headers=headers,
        )
        self.assertEqual(bad_utr.status_code, 422)

        verify_res = await self.client.post(
            "/api/v1/resume-builder/payment/verify",
            json={"order_id": order["order_id"], "utr_ref": "123456789012"},
            headers=headers,
        )
        self.assertEqual(verify_res.status_code, 200)
        self.assertEqual(verify_res.json()["status"], "success")

        entitlement = await self.client.get("/api/v1/resume-builder/payment/entitlement", headers=headers)
        self.assertTrue(entitlement.json()["active"])

        # The single payment covers the already-generated version...
        download_res = await self.client.get(
            f"/api/v1/resume-builder/version/{version_one}/download?fmt=pdf", headers=headers,
        )
        self.assertEqual(download_res.status_code, 200)
        self.assertTrue(download_res.content.startswith(b"%PDF"))

        # ...and any further free regenerations made within the entitlement window, with no new payment.
        version_two = await self._make_version(resume_payment.TEST_PAYMENT_USER)
        download_two = await self.client.get(
            f"/api/v1/resume-builder/version/{version_two}/download?fmt=docx", headers=headers,
        )
        self.assertEqual(download_two.status_code, 200)
        self.assertGreater(len(download_two.content), 0)

    async def test_entitlement_does_not_leak_across_users(self):
        payer_token = auth.issue_token(resume_payment.TEST_PAYMENT_USER)
        payer_headers = {"Authorization": f"Bearer {payer_token}"}
        order = (await self.client.post(
            "/api/v1/resume-builder/payment/create-order", headers=payer_headers,
        )).json()
        await self.client.post(
            "/api/v1/resume-builder/payment/verify",
            json={"order_id": order["order_id"], "utr_ref": "123456789012"},
            headers=payer_headers,
        )

        other_token = auth.issue_token("non_paying_user")
        other_headers = {"Authorization": f"Bearer {other_token}"}
        version_id = await self._make_version("non_paying_user")
        res = await self.client.get(
            f"/api/v1/resume-builder/version/{version_id}/download?fmt=pdf", headers=other_headers,
        )
        self.assertEqual(res.status_code, 402)

    async def test_real_payment_requires_valid_signature(self):
        token = auth.issue_token("real_payer")
        headers = {"Authorization": f"Bearer {token}"}
        version_id = await self._make_version("real_payer")
        provider_order_id = "order_resume_abc"
        payment_id = "pay_resumeabc123"
        secret = "resume-test-secret"
        payment = {"id": payment_id, "order_id": provider_order_id, "status": "captured",
                   "currency": "INR", "amount": resume_payment.RESUME_REBUILD_PRICE * 100}

        def provider_request(method, path, **kwargs):
            if method == "POST":
                return {"id": provider_order_id, "amount": kwargs["json"]["amount"], "currency": "INR"}
            return payment

        with patch.dict("os.environ", {"RAZORPAY_KEY_ID": "rzp_test_key", "RAZORPAY_KEY_SECRET": secret}):
            with patch.object(resume_payment, "razorpay_request", side_effect=provider_request):
                order = (await self.client.post(
                    "/api/v1/resume-builder/payment/create-order", headers=headers,
                )).json()
                self.assertEqual(order["payment_mode"], "razorpay")

                bad_sig = await self.client.post(
                    "/api/v1/resume-builder/payment/verify",
                    json={"order_id": order["order_id"], "razorpay_payment_id": payment_id,
                          "razorpay_signature": "wrong"},
                    headers=headers,
                )
                self.assertEqual(bad_sig.status_code, 400)

                signed = f"{provider_order_id}|{payment_id}".encode()
                valid_sig = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
                good = await self.client.post(
                    "/api/v1/resume-builder/payment/verify",
                    json={"order_id": order["order_id"], "razorpay_payment_id": payment_id,
                          "razorpay_signature": valid_sig},
                    headers=headers,
                )
                self.assertEqual(good.status_code, 200)

        download_res = await self.client.get(
            f"/api/v1/resume-builder/version/{version_id}/download?fmt=pdf", headers=headers,
        )
        self.assertEqual(download_res.status_code, 200)

    async def test_entitlement_expires_after_24_hours(self):
        token = auth.issue_token(resume_payment.TEST_PAYMENT_USER)
        headers = {"Authorization": f"Bearer {token}"}
        version_id = await self._make_version(resume_payment.TEST_PAYMENT_USER)

        with patch("app.resume_payment.time.time", return_value=1_000_000):
            order = (await self.client.post(
                "/api/v1/resume-builder/payment/create-order", headers=headers,
            )).json()
            await self.client.post(
                "/api/v1/resume-builder/payment/verify",
                json={"order_id": order["order_id"], "utr_ref": "123456789012"},
                headers=headers,
            )

        with patch("app.resume_payment.time.time", return_value=1_000_000 + 24 * 3600 + 1):
            expired = await self.client.get(
                f"/api/v1/resume-builder/version/{version_id}/download?fmt=pdf", headers=headers,
            )
        self.assertEqual(expired.status_code, 402)


if __name__ == "__main__":
    unittest.main()
