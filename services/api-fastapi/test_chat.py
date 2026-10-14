import unittest
from unittest.mock import AsyncMock, patch

from app import llm


class ChatTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_precedes_current_question(self):
        provider = AsyncMock()

        async def chunks():
            yield type("Chunk", (), {"choices": [
                type("Choice", (), {"delta": type("Delta", (), {"content": "response"})()})()
            ]})()

        provider.chat.completions.create.return_value = chunks()
        history = [
            {"role": "user", "content": "Write a program"},
            {"role": "assistant", "content": "print('hello')"},
        ]
        with patch.object(llm, "client", return_value=provider):
            answer = [part async for part in llm.stream_chat("instructions", "Explain it", history)]
        self.assertEqual(answer, ["response"])
        self.assertEqual(provider.chat.completions.create.call_args.kwargs["messages"], [
            {"role": "system", "content": "instructions"},
            *history,
            {"role": "user", "content": "Explain it"},
        ])

    async def test_new_question_without_history(self):
        provider = AsyncMock()

        async def chunks():
            if False:
                yield None

        provider.chat.completions.create.return_value = chunks()
        with patch.object(llm, "client", return_value=provider):
            _ = [part async for part in llm.stream_chat("instructions", "Write a program")]
        self.assertEqual(provider.chat.completions.create.call_args.kwargs["messages"], [
            {"role": "system", "content": "instructions"},
            {"role": "user", "content": "Write a program"},
        ])
