import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app import auth, llm, resume_rebuild, users
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


def _fake_client(payload: dict | None = None):
    create = AsyncMock(return_value=_fake_chat_response(payload)) if payload is not None else AsyncMock()
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


class ResumeRebuildSchemaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client_patch = patch.object(llm, "_client", None)
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)

    async def test_rewrite_validates_schema_and_preserves_content(self):
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            result = await resume_rebuild.rewrite_resume(SAMPLE_RESUME, "", [])
        self.assertEqual(result.name, "Jane Doe")
        self.assertEqual(result.experience[0].company, "Acme Corp")

    async def test_rewrite_raises_on_invalid_json(self):
        fake = _fake_client({"unexpected": "shape that still parses as json but has wrong keys"})

        async def bad_create(*args, **kwargs):
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="not json"))])

        fake.chat.completions.create = bad_create
        with patch.object(llm, "client", return_value=fake):
            with self.assertRaises(resume_rebuild.RebuildError):
                await resume_rebuild.rewrite_resume(SAMPLE_RESUME, "", [])

    async def test_rewrite_raises_when_client_unconfigured(self):
        with patch.object(llm, "client", return_value=None):
            with self.assertRaises(resume_rebuild.RebuildError):
                await resume_rebuild.rewrite_resume(SAMPLE_RESUME, "", [])

    async def test_rewrite_passes_extra_context_into_the_prompt(self):
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            await resume_rebuild.rewrite_resume(
                SAMPLE_RESUME, "", [], extra_context="achievements: Cut deploy time by 60%"
            )
        sent_prompt = fake.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("Cut deploy time by 60%", sent_prompt)

    async def test_rebuild_and_score_renders_and_persists_version(self):
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            result = await resume_rebuild.rebuild_and_score("testuser_rebuild", None, SAMPLE_RESUME, "")
        self.assertIn("version_id", result)
        self.assertIn("rebuilt_score", result)
        self.assertGreater(result["rebuilt_score"], 0)

        stored = resume_rebuild.get_version(result["version_id"], "testuser_rebuild")
        self.assertIsNotNone(stored)
        self.assertEqual(stored["rebuilt_score"], result["rebuilt_score"])

        pdf_bytes = resume_rebuild.get_version_file(result["version_id"], "testuser_rebuild", "pdf")
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))
        docx_bytes = resume_rebuild.get_version_file(result["version_id"], "testuser_rebuild", "docx")
        self.assertGreater(len(docx_bytes), 0)

    async def test_other_user_cannot_read_a_version(self):
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            result = await resume_rebuild.rebuild_and_score("owner_user", None, SAMPLE_RESUME, "")
        self.assertIsNone(resume_rebuild.get_version(result["version_id"], "someone_else"))
        self.assertIsNone(resume_rebuild.get_version_file(result["version_id"], "someone_else", "pdf"))


class ResumeRebuildApiTests(unittest.IsolatedAsyncioTestCase):
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
        self.token = auth.issue_token("testuser_rebuild_api")
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def test_rebuild_requires_auth(self):
        res = await self.client.post("/api/v1/resume-builder/rebuild", json={"resume": SAMPLE_RESUME})
        self.assertEqual(res.status_code, 401)

    async def test_rebuild_rejects_empty_resume(self):
        res = await self.client.post(
            "/api/v1/resume-builder/rebuild", json={"resume": "  "}, headers=self.headers,
        )
        self.assertEqual(res.status_code, 400)

    async def test_rebuild_returns_502_when_llm_unconfigured(self):
        with patch.object(llm, "client", return_value=None):
            res = await self.client.post(
                "/api/v1/resume-builder/rebuild", json={"resume": SAMPLE_RESUME}, headers=self.headers,
            )
        self.assertEqual(res.status_code, 502)

    async def test_rebuild_end_to_end_and_fetch(self):
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            res = await self.client.post(
                "/api/v1/resume-builder/rebuild", json={"resume": SAMPLE_RESUME}, headers=self.headers,
            )
        self.assertEqual(res.status_code, 200)
        version_id = res.json()["version_id"]

        get_res = await self.client.get(f"/api/v1/resume-builder/rebuild/{version_id}", headers=self.headers)
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.json()["version_id"], version_id)

    async def test_rebuild_preview_is_locked_until_paid(self):
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            res = await self.client.post(
                "/api/v1/resume-builder/rebuild", json={"resume": SAMPLE_RESUME}, headers=self.headers,
            )
        body = res.json()
        self.assertTrue(body["locked"])
        self.assertEqual(body["preview"]["contact"], "")
        self.assertEqual(body["preview"]["certifications"], [])
        self.assertEqual(body["preview"]["education"], [])
        # Only the first bullet of each job is shown; a lock notice replaces the rest.
        self.assertEqual(len(body["preview"]["experience"][0]["bullets"]), 1)
        self.assertEqual(body["target_score"], resume_rebuild.resume_builder.TARGET_SCORE)
        self.assertIsInstance(body["facts_needed"], list)

        get_res = await self.client.get(
            f"/api/v1/resume-builder/rebuild/{body['version_id']}", headers=self.headers,
        )
        self.assertTrue(get_res.json()["locked"])
        self.assertEqual(get_res.json()["preview"]["contact"], "")

    async def test_rebuild_preview_unlocks_after_payment(self):
        from app import resume_payment

        payer = resume_payment.TEST_PAYMENT_USER
        payer_headers = {"Authorization": f"Bearer {auth.issue_token(payer)}"}
        fake = _fake_client(REBUILT_PAYLOAD)
        with patch.object(llm, "client", return_value=fake):
            res = await self.client.post(
                "/api/v1/resume-builder/rebuild", json={"resume": SAMPLE_RESUME}, headers=payer_headers,
            )
        version_id = res.json()["version_id"]

        order = (await self.client.post(
            "/api/v1/resume-builder/payment/create-order", headers=payer_headers,
        )).json()
        await self.client.post(
            "/api/v1/resume-builder/payment/verify",
            json={"order_id": order["order_id"], "utr_ref": "123456789012"},
            headers=payer_headers,
        )

        get_res = await self.client.get(
            f"/api/v1/resume-builder/rebuild/{version_id}", headers=payer_headers,
        )
        body = get_res.json()
        self.assertFalse(body["locked"])
        self.assertEqual(body["preview"]["contact"], REBUILT_PAYLOAD["contact"])
        self.assertEqual(body["preview"]["experience"][0]["bullets"], REBUILT_PAYLOAD["experience"][0]["bullets"])


if __name__ == "__main__":
    unittest.main()
