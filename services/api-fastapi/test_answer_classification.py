import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import auth, users
from app import main as main_module
from app.main import app


def _classifier(decision: str, question: str = "", confidence: float = 0.99) -> str:
    return json.dumps({"decision": decision, "question": question, "confidence": confidence})


class AnswerClassificationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        main_module._recent_answer_events.clear()
        main_module._recent_classifier_events.clear()

    async def asyncTearDown(self):
        await self.client.aclose()

    async def _answer(self, user: str, payload: dict):
        headers = {"Authorization": "Bearer " + auth.issue_token(user)}
        return await self.client.post("/api/v1/answer", json=payload, headers=headers)

    async def test_ignore_acknowledgement_skips_answer_generation(self):
        with patch("app.llm.complete", AsyncMock(side_effect=AssertionError("classifier should be skipped"))), \
             patch("app.llm.stream_chat", AsyncMock(side_effect=AssertionError("stream should be skipped"))):
            response = await self._answer("u1", {"transcript": "Okay, thank you."})
        self.assertEqual(response.status_code, 200)
        self.assertIn('event: question\ndata: ""', response.text)
        self.assertIn("event: done", response.text)

    async def test_screen_share_prompt_is_ignored_without_llm_call(self):
        with patch("app.llm.complete", AsyncMock(side_effect=AssertionError("classifier should be skipped"))), \
             patch("app.llm.stream_chat", AsyncMock(side_effect=AssertionError("stream should be skipped"))):
            response = await self._answer("u2", {"transcript": "Can you share your screen?"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("event: done", response.text)

    async def test_answer_question_routes_to_stream_chat(self):
        async def fake_stream(_system, _question, _history, on_usage=None):
            if on_usage:
                on_usage(3, 2)
            yield "Use middleware for request/response processing."

        with patch("app.llm.complete", AsyncMock(return_value=_classifier(
            "ANSWER", "Explain Django middleware", 0.98
        ))), patch("app.llm.stream_chat", fake_stream):
            response = await self._answer("u3", {"transcript": "Explain Django middleware"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Explain Django middleware", response.text)
        self.assertIn("Use middleware", response.text)

    async def test_partial_transcript_waits_without_streaming(self):
        with patch("app.llm.complete", AsyncMock(return_value=_classifier("WAIT", "", 0.94))), \
             patch("app.llm.stream_chat", AsyncMock(side_effect=AssertionError("stream should be skipped"))):
            response = await self._answer("u4", {"transcript": "The input will be a list of integers and"})
        self.assertEqual(response.status_code, 200)
        self.assertIn('event: question\ndata: ""', response.text)
        self.assertIn("event: done", response.text)

    async def test_followup_without_context_waits(self):
        with patch("app.llm.complete", AsyncMock(return_value=_classifier("ANSWER", "Why?", 0.72))), \
             patch("app.llm.stream_chat", AsyncMock(side_effect=AssertionError("stream should be skipped"))):
            response = await self._answer("u5", {"transcript": "Why?"})
        self.assertEqual(response.status_code, 200)
        self.assertIn('event: question\ndata: ""', response.text)

    async def test_short_followup_with_context_can_answer_below_threshold(self):
        async def fake_stream(_system, _question, _history, on_usage=None):
            yield "Because indexing reduces query time."

        history = [{"question": "Why add an index to this table?", "answer": "To optimize reads."}]
        with patch("app.llm.complete", AsyncMock(return_value=_classifier("ANSWER", "Why?", 0.72))), \
             patch("app.llm.stream_chat", fake_stream):
            response = await self._answer("u6", {"transcript": "Why?", "history": history})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Because indexing", response.text)

    async def test_malformed_classifier_json_fails_closed(self):
        with patch("app.llm.complete", AsyncMock(return_value="{not-json")), \
             patch("app.llm.stream_chat", AsyncMock(side_effect=AssertionError("stream should be skipped"))):
            response = await self._answer("u7", {"transcript": "What is Redis?"})
        self.assertEqual(response.status_code, 200)
        self.assertIn('event: question\ndata: ""', response.text)

    async def test_empty_classifier_json_fails_closed(self):
        with patch("app.llm.complete", AsyncMock(return_value="")), \
             patch("app.llm.stream_chat", AsyncMock(side_effect=AssertionError("stream should be skipped"))):
            response = await self._answer("u8", {"transcript": "What is Redis?"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("event: done", response.text)

    async def test_duplicate_transcript_event_does_not_generate_duplicate_answer(self):
        stream_calls = 0

        async def fake_stream(_system, _question, _history, on_usage=None):
            nonlocal stream_calls
            stream_calls += 1
            yield "Redis is an in-memory data store."

        payload = {
            "transcript": "What is Redis?",
            "session_id": "session-a",
            "utterance_id": "utt-1",
        }
        with patch("app.llm.complete", AsyncMock(return_value=_classifier("ANSWER", "What is Redis?", 0.99))), \
             patch("app.llm.stream_chat", fake_stream):
            first = await self._answer("u9", payload)
            second = await self._answer("u9", payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(stream_calls, 1)
        self.assertIn("Redis is an in-memory", first.text)
        self.assertIn('event: question\ndata: ""', second.text)

    async def test_two_users_with_same_input_are_processed_independently(self):
        stream_calls = 0

        async def fake_stream(_system, _question, _history, on_usage=None):
            nonlocal stream_calls
            stream_calls += 1
            yield "It is a key-value store."

        payload = {
            "transcript": "What is Redis?",
            "session_id": "session-a",
            "utterance_id": "utt-1",
        }
        with patch("app.llm.complete", AsyncMock(return_value=_classifier("ANSWER", "What is Redis?", 0.99))), \
             patch("app.llm.stream_chat", fake_stream):
            a = await self._answer("user-a", payload)
            b = await self._answer("user-b", payload)
        self.assertEqual(a.status_code, 200)
        self.assertEqual(b.status_code, 200)
        self.assertEqual(stream_calls, 2)

    async def test_manual_question_bypasses_classifier(self):
        async def fake_stream(_system, _question, _history, on_usage=None):
            yield "Middleware hooks into request processing."

        with patch("app.llm.complete", AsyncMock(side_effect=AssertionError("manual question should bypass classifier"))), \
             patch("app.llm.stream_chat", fake_stream):
            response = await self._answer("u10", {"question": "Explain middleware", "transcript": "noise"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Explain middleware", response.text)

    async def test_transcript_auto_question_does_not_bypass_classifier(self):
        with patch("app.llm.complete", AsyncMock(return_value=_classifier("IGNORE", "", 0.99))), \
             patch("app.llm.stream_chat", AsyncMock(side_effect=AssertionError("stream should be skipped"))):
            response = await self._answer("u11", {
                "question": "Can you share your screen?",
                "question_source": "transcript_auto",
                "transcript": "Can you share your screen?",
            })
        self.assertEqual(response.status_code, 200)
        self.assertIn('event: question\ndata: ""', response.text)

    async def test_provider_failure_surfaces_error_event(self):
        async def failing(*_args, **_kwargs):
            raise RuntimeError("provider unavailable")
            yield ""

        with patch("app.llm.complete", AsyncMock(return_value=_classifier("ANSWER", "What is Redis?", 0.99))), \
             patch("app.llm.stream_chat", failing):
            response = await self._answer("u12", {"transcript": "What is Redis?"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("event: error", response.text)
        self.assertIn("event: done", response.text)

    async def test_no_answer_sentinel_is_not_saved(self):
        async def fake_stream(_system, _question, _history, on_usage=None):
            yield "NO_ANSWER"

        with patch("app.llm.complete", AsyncMock(return_value=_classifier("ANSWER", "What is Redis?", 0.99))), \
             patch("app.llm.stream_chat", fake_stream), \
             patch("app.history.save_interview_qa") as saver:
            response = await self._answer("u13", {"transcript": "What is Redis?"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("NO_ANSWER", response.text)
        saver.assert_not_called()
