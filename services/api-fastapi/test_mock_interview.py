import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app import auth, mock_interview, users
from app.main import app


def _fake_chat_response(payload: dict):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])


def _fake_client(next_payload: dict | None = None, feedback_payload: dict | None = None, transcript: str = ""):
    chat_responses = []
    if next_payload is not None:
        chat_responses.append(_fake_chat_response(next_payload))
    if feedback_payload is not None:
        chat_responses.append(_fake_chat_response(feedback_payload))
    if len(chat_responses) == 1:
        create = AsyncMock(return_value=chat_responses[0])
    elif chat_responses:
        create = AsyncMock(side_effect=chat_responses)
    else:
        create = AsyncMock()
    return SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
        audio=SimpleNamespace(
            transcriptions=SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(text=transcript)))
        ),
    )


class MockInterviewTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        # Reset the module-level client singleton so each test controls what client() returns.
        self.client_patch = patch.object(mock_interview, "_client", None)
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.addCleanup(self.client.aclose)
        self.username = "testuser_mock"
        self.token = auth.issue_token(self.username)
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def test_next_question_requires_auth(self):
        res = await self.client.post("/api/v1/mock-interview/next", json={"role": "Backend Engineer"})
        self.assertEqual(res.status_code, 401)

    async def test_feedback_requires_auth(self):
        files = {"audio": ("answer.webm", b"fake", "audio/webm")}
        data = {"question": "Q", "sample_answer": "A", "duration_seconds": "10"}
        res = await self.client.post("/api/v1/mock-interview/feedback", data=data, files=files)
        self.assertEqual(res.status_code, 401)

    async def test_next_question_returns_question_and_sample_answer(self):
        fake = _fake_client(next_payload={"question": "Explain REST", "sample_answer": "REST is..."})
        with patch.object(mock_interview, "client", return_value=fake):
            res = await self.client.post(
                "/api/v1/mock-interview/next", json={"role": "Backend Engineer", "history": []}, headers=self.headers,
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["question"], "Explain REST")
        self.assertEqual(body["sample_answer"], "REST is...")

    async def test_next_question_without_configured_client_is_graceful(self):
        with patch.object(mock_interview, "client", return_value=None):
            res = await self.client.post(
                "/api/v1/mock-interview/next", json={"role": "Backend Engineer"}, headers=self.headers,
            )
        self.assertEqual(res.status_code, 200)
        self.assertIn("not configured", res.json()["question"])

    async def test_daily_cap_of_20_is_enforced(self):
        fake = _fake_client(next_payload={"question": "Q", "sample_answer": "A"})
        with patch.object(mock_interview, "client", return_value=fake):
            for _ in range(mock_interview.DAILY_QUESTION_LIMIT):
                res = await self.client.post(
                    "/api/v1/mock-interview/next", json={"role": "Backend Engineer"}, headers=self.headers,
                )
                self.assertEqual(res.status_code, 200)
            res = await self.client.post(
                "/api/v1/mock-interview/next", json={"role": "Backend Engineer"}, headers=self.headers,
            )
        self.assertEqual(res.status_code, 429)

    async def test_feedback_computes_words_per_minute_and_returns_feedback(self):
        transcript = " ".join(["word"] * 30)  # 30 words
        fake = _fake_client(feedback_payload={"feedback": "Good pace, sounded natural."}, transcript=transcript)
        files = {"audio": ("answer.webm", b"fake audio bytes", "audio/webm")}
        data = {"question": "Explain REST", "sample_answer": "REST is...", "duration_seconds": "15"}
        with patch.object(mock_interview, "client", return_value=fake):
            res = await self.client.post(
                "/api/v1/mock-interview/feedback", data=data, files=files, headers=self.headers,
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["transcript"], transcript)
        self.assertEqual(body["words_per_minute"], 120.0)  # 30 words / 15s * 60
        self.assertEqual(body["feedback"], "Good pace, sounded natural.")

    async def test_feedback_with_no_speech_detected_skips_llm_call(self):
        fake = _fake_client(transcript="")
        files = {"audio": ("answer.webm", b"silence", "audio/webm")}
        data = {"question": "Explain REST", "sample_answer": "REST is...", "duration_seconds": "10"}
        with patch.object(mock_interview, "client", return_value=fake):
            res = await self.client.post(
                "/api/v1/mock-interview/feedback", data=data, files=files, headers=self.headers,
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["transcript"], "")
        self.assertEqual(body["words_per_minute"], 0)
        self.assertIn("No speech", body["feedback"])
        fake.chat.completions.create.assert_not_called()

    async def test_non_english_transcript_is_dropped(self):
        fake = _fake_client(transcript="नमस्ते यह हिंदी में है")
        files = {"audio": ("answer.webm", b"fake", "audio/webm")}
        data = {"question": "Q", "sample_answer": "A", "duration_seconds": "10"}
        with patch.object(mock_interview, "client", return_value=fake):
            res = await self.client.post(
                "/api/v1/mock-interview/feedback", data=data, files=files, headers=self.headers,
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["transcript"], "")

    async def test_mock_client_uses_its_own_env_vars_independent_of_openai(self):
        with patch.dict(
            "os.environ",
            {"MOCK_LLM_API_KEY": "gsk_test", "MOCK_LLM_BASE_URL": "https://api.groq.com/openai/v1"},
            clear=False,
        ):
            with patch.object(mock_interview, "_client", None):
                c = mock_interview.client()
        self.assertIsNotNone(c)
        self.assertEqual(str(c.base_url), "https://api.groq.com/openai/v1/")


if __name__ == "__main__":
    unittest.main()
