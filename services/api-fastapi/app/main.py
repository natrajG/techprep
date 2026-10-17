import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, downloads, llm, rate_limit, settings, subscriptions, users
from .prompts import EVALUATE_PROMPT, QUESTION_EXTRACT_PROMPT, SYSTEM_PROMPT

@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.validate()
    if settings.production():
        with users.connect() as conn:
            conn.execute("SELECT 1")
        if not _DIST.is_dir():
            raise RuntimeError("Production requires the built React UI.")
    yield


app = FastAPI(title="TechPrep API", version="0.2.0", lifespan=lifespan)
app.include_router(downloads.router)
app.include_router(subscriptions.router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[] if settings.production() else ["http://localhost:5173", "http://127.0.0.1:5173"],
    # The Vite dev server opened from another computer on the same private network.
    allow_origin_regex=None if settings.production() else r"^https?://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):5173$",
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_AUDIO_BYTES = 10 * 1024 * 1024
logger = logging.getLogger("techprep")


class AnswerTurn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=4000)


class AnswerRequest(BaseModel):
    question: str = Field("", max_length=20000)
    transcript: str = Field("", max_length=20000)
    resume: str = Field("", max_length=15000)
    job_description: str = Field("", max_length=10000)
    history: list[AnswerTurn] = Field(default_factory=list, max_length=2)


class LoginRequest(BaseModel):
    username: str = Field(max_length=200)
    password: str = Field(max_length=200)


class EvaluateRequest(BaseModel):
    question: str = Field(max_length=20000)
    answer: str = Field(max_length=20000)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "api-fastapi", "llm_configured": llm.client() is not None}


@app.get("/api/v1/config")
def public_config() -> dict:
    return {
        "signup_enabled": users.signup_enabled(),
        "minimum_password": users.minimum_password(),
        "local_network": not settings.production(),
        "store_url": "https://apps.microsoft.com/detail/9N36X6C5706B"
        if settings.production() and settings.store_published() else None,
    }


@app.post("/api/v1/login", dependencies=[Depends(rate_limit.auth_attempt)])
async def login(req: LoginRequest) -> dict:
    user = req.username if auth.verify_login(req.username, req.password) else users.verify_user(req.username, req.password)
    if user is None:
        if not auth.configured() and not users.signup_enabled():
            raise HTTPException(503, "Login is not configured: set APP_USERNAME and APP_PASSWORD in .env")
        await asyncio.sleep(1)  # slows password guessing
        raise HTTPException(401, "Incorrect username or password")
    return {"token": auth.issue_token(user), "user": user}


@app.post("/api/v1/signup", dependencies=[Depends(rate_limit.auth_attempt)])
async def signup(req: LoginRequest) -> dict:
    if not users.signup_enabled():
        raise HTTPException(403, "Sign up is disabled")
    problem = users.validate(req.username, req.password)
    if problem:
        raise HTTPException(422, problem)
    reserved = auth.configured() and req.username.lower() == os.environ["APP_USERNAME"].lower()
    if reserved or not users.create_user(req.username, req.password):
        raise HTTPException(409, "That username is already taken")
    return {"token": auth.issue_token(req.username), "user": req.username}


@app.get("/api/v1/me")
def me(user: str = Depends(auth.require_auth)) -> dict:
    return {"user": user, "is_admin": subscriptions.is_admin(user)}


@app.post("/api/v1/transcribe", dependencies=[Depends(rate_limit.ai_access)])
async def transcribe(audio: UploadFile = File(...), user: str = Depends(subscriptions.require_subscription)) -> dict:
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio chunk too large")
    if len(data) < 1000:
        return {"text": ""}
    subscriptions.start_ai_call(user)
    return {"text": await llm.transcribe(audio.filename or "chunk.webm", data)}


@app.post("/api/v1/answer", dependencies=[Depends(rate_limit.ai_access)])
async def answer(req: AnswerRequest, user: str = Depends(subscriptions.require_subscription)) -> StreamingResponse:
    record_usage = lambda prompt, completion: users.record_token_usage(user, prompt, completion)
    question = req.question.strip()
    if not question and not req.transcript.strip():
        raise HTTPException(400, "Provide a question or transcript")
    subscriptions.start_ai_call(user)
    if not question:
        try:
            question = (
                await llm.complete(QUESTION_EXTRACT_PROMPT.format(transcript=req.transcript[-4000:]), on_usage=record_usage)
            ).strip()
        except Exception:
            logger.exception("Question extraction failed")
            question = ""
        question = question or req.transcript[-500:]

    system = SYSTEM_PROMPT.format(
        resume=req.resume or "(not provided)",
        job_description=req.job_description or "(not provided)",
    )
    history = [
        message
        for turn in req.history
        for message in (
            {"role": "user", "content": turn.question},
            {"role": "assistant", "content": turn.answer},
        )
    ]

    async def events():
        yield f"event: question\ndata: {json.dumps(question)}\n\n"
        try:
            async for token in llm.stream_chat(system, question, history, on_usage=record_usage):
                yield f"data: {json.dumps(token)}\n\n"
        except Exception as e:  # surface provider errors (quota, auth, network) in the UI
            if settings.production():
                logger.exception("LLM provider request failed")
                text = "[The assistant is temporarily unavailable. Please try again.]"
            else:
                msg = getattr(e, "message", None) or str(e)
                text = f"[LLM error: {type(e).__name__}: {msg}]"
            yield f"event: error\ndata: {json.dumps(text)}\n\n"
        yield "event: done\ndata: \"\"\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/api/v1/evaluate", dependencies=[Depends(rate_limit.ai_access)])
async def evaluate(req: EvaluateRequest, user: str = Depends(subscriptions.require_ai_call)) -> dict:
    raw = await llm.complete(
        EVALUATE_PROMPT.format(question=req.question, answer=req.answer),
        json_mode=True,
        on_usage=lambda prompt, completion: users.record_token_usage(user, prompt, completion),
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "Could not parse evaluation", "raw": raw}


# Serve the built React UI (frontend/react-web/dist) from the same origin, used by the desktop app.
_DIST = Path(__file__).resolve().parents[3] / "frontend" / "react-web" / "dist"


class _SPAStaticFiles(StaticFiles):
    """StaticFiles that never lets the SPA shell (index.html) be cached, while letting
    content-hashed /assets/* files (produced by the Vite build) cache indefinitely.

    This guarantees the Electron desktop app (which loads the same fixed URL on every
    launch) always sees newly deployed web-layer fixes without needing a reinstall.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        path = str(args[0]) if args else ""
        if path.endswith(".html") or path == "":
            response.headers["Cache-Control"] = "no-store"
        else:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


if _DIST.is_dir():
    app.mount("/", _SPAStaticFiles(directory=_DIST, html=True), name="web")
