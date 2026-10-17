import json
import os
from typing import AsyncIterator, Callable

from openai import AsyncOpenAI
from openai.types.completion_usage import CompletionUsage

MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
STT_MODEL = os.getenv("STT_MODEL", "whisper-1")
STT_PROMPT = (
    "Technical interview terminology: Django, Python, REST API, React, JavaScript, "
    "TypeScript, SQL, PostgreSQL, Docker, Kubernetes, AWS, and cloud infrastructure."
)
# gpt-oss models spend hidden "reasoning" tokens, which slows answers and burns provider rate limits.
REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "low" if "gpt-oss" in MODEL else "")


def _reasoning() -> dict:
    return {"reasoning_effort": REASONING_EFFORT} if REASONING_EFFORT else {}

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI | None:
    global _client
    if _client is None and os.getenv("OPENAI_API_KEY"):
        # The SDK treats an empty OPENAI_BASE_URL as a real (invalid) URL, so default explicitly.
        _client = AsyncOpenAI(base_url=os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1")
    return _client


UsageRecorder = Callable[[int, int], None]


def _record_usage(usage: CompletionUsage | None, on_usage: UsageRecorder | None) -> None:
    if usage is not None and on_usage is not None:
        on_usage(usage.prompt_tokens, usage.completion_tokens)


async def stream_chat(
    system: str, user: str, history: list[dict[str, str]] | None = None,
    on_usage: UsageRecorder | None = None,
) -> AsyncIterator[str]:
    c = client()
    if c is None:
        yield "[OPENAI_API_KEY not set — configure it in .env to get real answers]"
        return
    stream = await c.chat.completions.create(
        model=MODEL,
        stream=True,
        stream_options={"include_usage": True},
        temperature=0.4,
        **_reasoning(),
        messages=[{"role": "system", "content": system}, *(history or []), {"role": "user", "content": user}],
    )
    async for chunk in stream:
        _record_usage(getattr(chunk, "usage", None), on_usage)
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def complete(prompt: str, json_mode: bool = False, on_usage: UsageRecorder | None = None) -> str:
    c = client()
    if c is None:
        return json.dumps({"error": "OPENAI_API_KEY not set"}) if json_mode else ""
    extra = {"response_format": {"type": "json_object"}} if json_mode else {}
    resp = await c.chat.completions.create(
        model=MODEL,
        temperature=0,
        **_reasoning(),
        messages=[{"role": "user", "content": prompt}],
        **extra,
    )
    _record_usage(resp.usage, on_usage)
    return resp.choices[0].message.content or ""


async def transcribe(filename: str, data: bytes) -> str:
    c = client()
    if c is None:
        return ""
    # Force English-only transcription: avoids Whisper mis-detecting/mixing other spoken languages
    # picked up from background noise, and improves speed/accuracy for English interviews.
    result = await c.audio.transcriptions.create(
        model=STT_MODEL, file=(filename, data), language="en", prompt=STT_PROMPT,
    )
    return result.text
