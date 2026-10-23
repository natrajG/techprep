import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import auth, downloads, llm, mailer, rate_limit, settings, subscriptions, users
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


class SlowRequestLog:
    """Logs slow requests, 429s and server errors. Pure ASGI, so streamed answers are never buffered."""

    def __init__(self, app, threshold_seconds: float = 2.0):
        self.app = app
        self.threshold = threshold_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()

        async def observe(message):
            if message["type"] == "http.response.start":
                elapsed = time.perf_counter() - started
                status = message["status"]
                if elapsed > self.threshold or status >= 500 or status == 429:
                    logging.getLogger("techprep").warning(
                        "%s %s -> %s in %.2fs", scope["method"], scope["path"], status, elapsed
                    )
            await send(message)

        await self.app(scope, receive, observe)


app = FastAPI(title="TechPrep API", version="0.2.0", lifespan=lifespan)
app.add_middleware(SlowRequestLog)
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


class SignupRequest(LoginRequest):
    email: str = Field(max_length=254)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(max_length=254)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(max_length=200)


class EmailChangeRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class UsageWriter:
    """Records token usage off the event loop; flush() runs after the last token has been sent."""

    def __init__(self, user: str):
        self.user = user
        self.pending: list[asyncio.Future] = []

    def __call__(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.pending.append(asyncio.get_running_loop().run_in_executor(
            None, users.record_token_usage, self.user, prompt_tokens, completion_tokens,
        ))

    async def flush(self) -> None:
        pending, self.pending = self.pending, []
        for result in await asyncio.gather(*pending, return_exceptions=True):
            if isinstance(result, Exception):
                logger.error("Recording token usage failed", exc_info=result)


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
        "password_reset_enabled": mailer.configured(),
        "local_network": not settings.production(),
        "store_url": "https://apps.microsoft.com/detail/9N36X6C5706B"
        if settings.production() and settings.store_published() else None,
    }


@app.post("/api/v1/login")
async def login(req: LoginRequest, request: Request) -> dict:
    await run_in_threadpool(rate_limit.login_gate, request, req.username)
    user = req.username if auth.verify_login(req.username, req.password) else await users.in_hash_pool(
        users.verify_user, req.username, req.password
    )
    if user is None:
        await run_in_threadpool(rate_limit.login_failed, request, req.username)
        if not auth.configured() and not users.signup_enabled():
            raise HTTPException(503, "Login is not configured: set APP_USERNAME and APP_PASSWORD in .env")
        await asyncio.sleep(1)  # slows password guessing
        raise HTTPException(401, "Incorrect username or password")
    return {"token": auth.issue_token(user), "user": user}


@app.post("/api/v1/signup", dependencies=[Depends(rate_limit.auth_attempt)])
async def signup(req: SignupRequest) -> dict:
    if not users.signup_enabled():
        raise HTTPException(403, "Sign up is disabled")
    problem = users.validate(req.username, req.password)
    if problem:
        raise HTTPException(422, problem)
    email = users.normalize_email(req.email)
    if email is None:
        raise HTTPException(422, "Enter a valid email address.")
    reserved = auth.configured() and req.username.lower() == os.environ["APP_USERNAME"].lower()
    if reserved or not await users.in_hash_pool(users.create_user, req.username, req.password, email):
        raise HTTPException(409, "That username or email is already registered")
    return {"token": auth.issue_token(req.username), "user": req.username}


RESET_SENT = {"message": "If that email is registered, a reset link has been sent."}


def _prepare_reset(email: str) -> tuple[str, str] | None:
    try:
        rate_limit.consume("password-reset-email", email, 3, 3600)
    except HTTPException:
        return None
    username = users.get_user_by_email(email)
    return (username, users.create_reset_token(username)) if username else None


def _send_reset_email(email: str, link: str) -> None:
    try:
        mailer.send(
            email, "Reset your TechPrep password",
            f"We received a request to reset your TechPrep password.\n\n{link}\n\n"
            f"This link works once and expires in {users.RESET_TTL_SECONDS // 60} minutes. "
            "If you did not ask for it, you can ignore this email; your password has not changed.\n",
        )
    except Exception:
        logger.exception("Password reset email could not be sent")


@app.post("/api/v1/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, request: Request, background: BackgroundTasks) -> dict:
    if not mailer.configured():
        raise HTTPException(503, "Password reset is not available right now.")
    await run_in_threadpool(rate_limit.password_reset_attempt, request, "password-reset-request", 10)
    email = users.normalize_email(req.email)
    prepared = await run_in_threadpool(_prepare_reset, email) if email else None
    if prepared:
        # The token travels in the URL fragment, so it never reaches server logs or Referer headers.
        base = os.getenv("APP_PUBLIC_URL") or str(request.base_url)
        background.add_task(_send_reset_email, email, f"{base.rstrip('/')}/#reset={prepared[1]}")
    return RESET_SENT  # identical whether or not the address is registered


@app.post("/api/v1/reset-password")
async def reset_password(req: ResetPasswordRequest, request: Request) -> dict:
    await run_in_threadpool(rate_limit.password_reset_attempt, request, "password-reset-attempt", 20)
    if len(req.password) < users.minimum_password():
        raise HTTPException(422, f"Password must be at least {users.minimum_password()} characters.")
    username = await run_in_threadpool(users.use_reset_token, req.token)
    if username is None:
        raise HTTPException(400, "This reset link is invalid or has expired. Request a new one.")
    await users.in_hash_pool(users.set_password, username, req.password)
    return {"message": "Password updated. You can now sign in."}


@app.get("/api/v1/me")
def me(user: str = Depends(auth.require_auth)) -> dict:
    return {"user": user, "is_admin": subscriptions.is_admin(user), "email": users.get_email(user)}


@app.put("/api/v1/me/email")
async def update_email(req: EmailChangeRequest, request: Request, user: str = Depends(auth.require_auth)) -> dict:
    email = users.normalize_email(req.email)
    if email is None:
        raise HTTPException(422, "Enter a valid email address.")
    if subscriptions.is_admin(user):
        raise HTTPException(400, "The administrator account cannot use email recovery.")
    await run_in_threadpool(rate_limit.password_reset_attempt, request, "email-change", 10)
    stored = await users.in_hash_pool(users.verify_user, user, req.password)
    if stored is None:
        raise HTTPException(403, "Incorrect password.")  # not 401: that would sign the user out
    if not await run_in_threadpool(users.set_email, stored, email):
        raise HTTPException(409, "That email is already registered.")
    return {"email": email}


async def start_call(request: Request, user: str) -> None:
    """The subscription was already read for this request; only the first request of a call window writes."""
    sub = request.state.subscription
    if not subscriptions.call_window_active(sub):
        await run_in_threadpool(subscriptions.start_ai_call, user, sub)


@app.post("/api/v1/transcribe", dependencies=[Depends(rate_limit.ai_access)])
async def transcribe(
    request: Request, audio: UploadFile = File(...), user: str = Depends(subscriptions.require_subscription)
) -> dict:
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio chunk too large")
    if len(data) < 1000:
        return {"text": ""}
    await start_call(request, user)
    return {"text": await llm.transcribe(audio.filename or "chunk.webm", data)}


@app.post("/api/v1/answer", dependencies=[Depends(rate_limit.ai_access)])
async def answer(
    req: AnswerRequest, request: Request, user: str = Depends(subscriptions.require_subscription)
) -> StreamingResponse:
    record_usage = UsageWriter(user)
    question = req.question.strip()
    if not question and not req.transcript.strip():
        raise HTTPException(400, "Provide a question or transcript")
    await start_call(request, user)
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
        await record_usage.flush()
        yield "event: done\ndata: \"\"\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/api/v1/evaluate", dependencies=[Depends(rate_limit.ai_access)])
async def evaluate(req: EvaluateRequest, user: str = Depends(subscriptions.require_ai_call)) -> dict:
    usage = UsageWriter(user)
    raw = await llm.complete(
        EVALUATE_PROMPT.format(question=req.question, answer=req.answer), json_mode=True, on_usage=usage,
    )
    await usage.flush()
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
