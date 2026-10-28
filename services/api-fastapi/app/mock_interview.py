import json
import logging
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from . import rate_limit
from .auth import require_auth
from .llm import NON_ENGLISH_SCRIPT, STT_PROMPT

logger = logging.getLogger("techprep")

router = APIRouter(prefix="/api/v1/mock-interview")

# Free practice feature: runs entirely on its own Groq-backed (OpenAI-compatible) client and
# env vars, fully decoupled from OPENAI_API_KEY/OPENAI_BASE_URL/LLM_MODEL/STT_MODEL — those keep
# powering the paid live-assist feature untouched.
MOCK_MODEL = os.getenv("MOCK_LLM_MODEL", "openai/gpt-oss-120b")
MOCK_STT_MODEL = os.getenv("MOCK_STT_MODEL", "whisper-large-v3")
DAILY_QUESTION_LIMIT = 20
MAX_AUDIO_BYTES = 10 * 1024 * 1024

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI | None:
    global _client
    if _client is None and os.getenv("MOCK_LLM_API_KEY"):
        _client = AsyncOpenAI(
            api_key=os.getenv("MOCK_LLM_API_KEY"),
            base_url=os.getenv("MOCK_LLM_BASE_URL") or "https://api.groq.com/openai/v1",
        )
    return _client


class MockTurn(BaseModel):
    question: str = Field(max_length=2000)
    sample_answer: str = Field(max_length=4000)


class NextQuestionRequest(BaseModel):
    role: str = Field("", max_length=4000)
    history: list[MockTurn] = Field(default_factory=list, max_length=20)


NEXT_QUESTION_PROMPT = """You are simulating a technical interviewer for this role/job description:
{role}

Generate ONE new interview question suitable for this role. Progress naturally from easier to \
harder as the practice session continues. Do not repeat or closely resemble any of these \
previously asked questions:
{prior_questions}

Then write a strong, concise model answer to your own question, as a well-prepared candidate \
would answer it out loud — clear, structured, roughly 80-150 words, suitable for someone to \
read and practice explaining aloud.

Always write the question and model answer in English only, even if the role/job description \
above contains non-English words — treat that as incidental and respond in English regardless.

Respond ONLY with a JSON object of the form: {{"question": "...", "sample_answer": "..."}}"""

FEEDBACK_PROMPT = """An interview candidate was asked:
Question: {question}

They were shown this suggested model answer to practice explaining aloud:
{sample_answer}

Here is what they actually said, transcribed from their recording, spoken at approximately \
{wpm:.0f} words per minute:
{transcript}

Give short, encouraging but honest feedback (3-5 sentences) covering:
- Pace: was {wpm:.0f} wpm too fast, too slow, or about right? (natural conversational pace is \
roughly 110-150 wpm)
- Whether it sounded like they were reading the model answer verbatim vs. explaining it \
naturally in their own words, with a concrete tip to sound more natural if needed
- Overall clarity and confidence, with one concrete suggestion to improve

Always write the feedback in English only, regardless of the language of the transcript above.

Respond ONLY with a JSON object of the form: {{"feedback": "..."}}"""


def _unavailable() -> dict:
    return {"question": "Mock Interview is not configured yet.", "sample_answer": ""}


@router.post("/next")
async def next_question(req: NextQuestionRequest, user: str = Depends(require_auth)) -> dict:
    rate_limit.consume("mock_interview", user.lower(), DAILY_QUESTION_LIMIT, 24 * 3600)
    c = client()
    if c is None:
        return _unavailable()
    role = req.role.strip() or "general software engineering"
    prior_questions = "\n".join(f"- {turn.question}" for turn in req.history) or "(none yet)"
    prompt = NEXT_QUESTION_PROMPT.format(role=role, prior_questions=prior_questions)
    try:
        resp = await c.chat.completions.create(
            model=MOCK_MODEL,
            temperature=0.7,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
    except Exception:
        logger.exception("Mock interview question generation failed")
        raise HTTPException(502, "Could not generate a question right now. Please try again.") from None
    question = str(data.get("question") or "").strip()
    sample_answer = str(data.get("sample_answer") or "").strip()
    if not question or not sample_answer:
        raise HTTPException(502, "Could not generate a question right now. Please try again.")
    return {"question": question, "sample_answer": sample_answer}


@router.post("/feedback")
async def feedback(
    question: str = Form(..., max_length=2000),
    sample_answer: str = Form(..., max_length=4000),
    duration_seconds: float = Form(..., gt=0, le=600),
    audio: UploadFile = File(...),
    user: str = Depends(require_auth),
) -> dict:
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording too large")
    c = client()
    if c is None:
        return {"transcript": "", "words_per_minute": 0, "feedback": "Mock Interview is not configured yet."}
    try:
        result = await c.audio.transcriptions.create(
            model=MOCK_STT_MODEL, file=(audio.filename or "answer.webm", data),
            prompt=STT_PROMPT, language="en",
        )
    except Exception:
        logger.exception("Mock interview transcription failed")
        raise HTTPException(502, "Could not transcribe your recording. Please try again.") from None
    transcript = (result.text or "").strip()
    # Only genuinely English speech is ever accepted here — same "English only" rule enforced for
    # the live-assist feature (see prompts.py's SYSTEM_PROMPT); drop non-English script entirely
    # rather than translating it.
    if transcript and NON_ENGLISH_SCRIPT.search(transcript):
        transcript = ""
    if not transcript:
        return {
            "transcript": "",
            "words_per_minute": 0,
            "feedback": "No speech was detected in that recording. Try again and speak clearly into your mic.",
        }
    word_count = len(transcript.split())
    wpm = word_count / (duration_seconds / 60)
    prompt = FEEDBACK_PROMPT.format(question=question, sample_answer=sample_answer, wpm=wpm, transcript=transcript)
    try:
        resp = await c.chat.completions.create(
            model=MOCK_MODEL,
            temperature=0.3,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        feedback_data = json.loads(resp.choices[0].message.content or "{}")
    except Exception:
        logger.exception("Mock interview feedback generation failed")
        raise HTTPException(502, "Could not generate feedback right now. Please try again.") from None
    feedback_text = str(feedback_data.get("feedback") or "").strip() or "No feedback available."
    return {"transcript": transcript, "words_per_minute": round(wpm, 1), "feedback": feedback_text}
