import unittest
from types import SimpleNamespace
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

    async def test_stream_records_provider_usage_including_final_usage_only_chunk(self):
        provider = AsyncMock()

        async def chunks():
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="hello"))], usage=None)
            yield SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=12, completion_tokens=4))

        provider.chat.completions.create.return_value = chunks()
        recorded = []
        with patch.object(llm, "client", return_value=provider):
            parts = [part async for part in llm.stream_chat(
                "system", "question", on_usage=lambda prompt, completion: recorded.append((prompt, completion))
            )]
        self.assertEqual(parts, ["hello"])
        self.assertEqual(recorded, [(12, 4)])
        self.assertEqual(provider.chat.completions.create.call_args.kwargs["stream_options"], {"include_usage": True})

    async def test_completion_records_usage(self):
        provider = AsyncMock()
        provider.chat.completions.create.return_value = SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=5, completion_tokens=3),
            choices=[SimpleNamespace(message=SimpleNamespace(content="done"))],
        )
        recorded = []
        with patch.object(llm, "client", return_value=provider):
            result = await llm.complete("question", on_usage=lambda a, b: recorded.append((a, b)))
        self.assertEqual(result, "done")
        self.assertEqual(recorded, [(5, 3)])

    async def test_transcription_uses_technical_vocabulary_hint(self):
        provider = AsyncMock()
        provider.audio.transcriptions.create.return_value.text = "Django work"
        with patch.object(llm, "client", return_value=provider):
            text = await llm.transcribe("chunk.webm", b"audio")
        self.assertEqual(text, "Django work")
        kwargs = provider.audio.transcriptions.create.call_args.kwargs
        self.assertEqual(kwargs["language"], "en")
        self.assertIn("Django", kwargs["prompt"])

    async def test_transcription_forces_english_for_gpt_transcribe_too(self):
        provider = AsyncMock()
        provider.audio.transcriptions.create.return_value.text = "Django work"
        with patch.object(llm, "client", return_value=provider), patch.object(llm, "STT_MODEL", "gpt-transcribe"):
            text = await llm.transcribe("chunk.webm", b"audio")
        self.assertEqual(text, "Django work")
        kwargs = provider.audio.transcriptions.create.call_args.kwargs
        # The OpenAI API's request schema only has a single top-level "language" field for every
        # STT model; "languages" (plural) only ever appears in gpt-transcribe's *response*, so
        # sending it as a request param (a prior bug) was silently ignored by the API.
        self.assertEqual(kwargs["language"], "en")
        self.assertIn("Django", kwargs["prompt"])

    async def test_non_english_transcription_is_skipped_not_translated(self):
        provider = AsyncMock()
        # The STT model ignored the "en" hint and transcribed actual Telugu speech in its own script.
        provider.audio.transcriptions.create.return_value.text = "డేటా బైండింగ్ అంటే ఏమిటి"
        with patch.object(llm, "client", return_value=provider):
            text = await llm.transcribe("chunk.webm", b"audio")
        self.assertEqual(text, "")
        provider.chat.completions.create.assert_not_called()

    async def test_english_transcription_passes_through(self):
        provider = AsyncMock()
        provider.audio.transcriptions.create.return_value.text = "What is data binding"
        with patch.object(llm, "client", return_value=provider):
            text = await llm.transcribe("chunk.webm", b"audio")
        self.assertEqual(text, "What is data binding")
        provider.chat.completions.create.assert_not_called()

