import asyncio
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import admin, auth, downloads, google_auth, llm, mailer, rate_limit, ratings, settings, subscriptions, users
from . import feedback
from . import history as history_module
from . import mock_interview
from .prompts import EVALUATE_PROMPT, QUESTION_EXTRACT_PROMPT, SYSTEM_PROMPT

@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.validate()
    if settings.production():
        with users.connect() as conn:
            conn.execute("SELECT 1")
        if not _DIST.is_dir():
            raise RuntimeError("Production requires the built React UI.")
    cleanup_task = asyncio.create_task(feedback.cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()


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
app.include_router(feedback.router)
app.include_router(mock_interview.router)
app.include_router(admin.router)
app.include_router(history_module.router)
app.include_router(ratings.router)
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


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=20, max_length=4000)


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
        "google_client_id": google_auth.client_id() if google_auth.configured() else None,
        "google_desktop_signin": google_auth.desktop_flow_configured(),
    }


async def new_session_token(username: str, request: Request) -> str:
    """Signing in replaces the account's previous session for the same client kind."""
    kind = "desktop" if request.headers.get("x-client-kind") == "desktop" else "web"
    sid = await run_in_threadpool(users.start_session, username, kind)
    return auth.issue_token(username, kind, sid)


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
    try:
        # Covers accounts created before the free trial existed: they never got one at signup time,
        # so grant it the first time such an account logs in (grant_free_trial is a no-op otherwise).
        await run_in_threadpool(subscriptions.grant_free_trial, user)
    except Exception:
        logger.exception("Could not grant free trial")
    return {"token": await new_session_token(user, request), "user": user}


@app.post("/api/v1/signup", dependencies=[Depends(rate_limit.auth_attempt)])
async def signup(req: SignupRequest, request: Request) -> dict:
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
    try:
        await run_in_threadpool(subscriptions.grant_free_trial, req.username)
    except Exception:
        logger.exception("Could not grant free trial")
    return {"token": await new_session_token(req.username, request), "user": req.username}


@app.post("/api/v1/auth/google", dependencies=[Depends(rate_limit.auth_attempt)])
async def login_with_google(req: GoogleLoginRequest, request: Request) -> dict:
    if not google_auth.configured():
        raise HTTPException(503, "Google sign-in is not configured")
    email = await run_in_threadpool(google_auth.verify, req.credential)
    if email is None:
        raise HTTPException(401, "Could not verify this Google account")
    user = await run_in_threadpool(users.get_or_create_google_user, email)
    try:
        await run_in_threadpool(subscriptions.grant_free_trial, user)
    except Exception:
        logger.exception("Could not grant free trial")
    return {"token": await new_session_token(user, request), "user": user}


# Google blocks interactive sign-in inside embedded browsers such as an Electron window, so the
# desktop app hands the OAuth flow to the user's system browser instead of embedding the normal
# Google Identity Services button. The browser completes sign-in against Google directly, Google
# redirects it to our own callback below, and that callback sends the browser back to the app via
# a "techprep://" deep link carrying a short-lived, single-use handoff code. The desktop app then
# redeems that code for a real session through the exchange endpoint. State and handoff codes are
# tracked in-memory (this server runs as a single process) and pruned as they expire.
_GOOGLE_DESKTOP_STATE_TTL = 600  # time allowed to complete the Google consent screen
_GOOGLE_DESKTOP_HANDOFF_TTL = 120  # time allowed for the app to redeem the one-time code
_google_desktop_states: dict[str, float] = {}
_google_desktop_handoffs: dict[str, tuple[str, float]] = {}


def _prune_expired_states(now: float) -> None:
    for key in [k for k, created in _google_desktop_states.items() if created + _GOOGLE_DESKTOP_STATE_TTL < now]:
        del _google_desktop_states[key]


def _prune_expired_handoffs(now: float) -> None:
    for key in [k for k, (_, created) in _google_desktop_handoffs.items() if created + _GOOGLE_DESKTOP_HANDOFF_TTL < now]:
        del _google_desktop_handoffs[key]


def _google_desktop_redirect_uri(request: Request) -> str:
    base = os.getenv("APP_PUBLIC_URL") or str(request.base_url)
    return f"{base.rstrip('/')}/api/v1/auth/google/desktop/callback"


_GOOGLE_DESKTOP_HANDOFF_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>TechPrep sign-in</title></head>
<body style="font-family: system-ui, sans-serif; background: #080a11; color: #f8fafc;
  display: grid; place-items: center; height: 100vh; margin: 0; text-align: center;">
  <div>
    <p>{message}</p>
    {link}
  </div>
  <script>{script}</script>
</body></html>"""


def _google_desktop_handoff_page(message: str, deep_link: str | None) -> HTMLResponse:
    link_html = (
        f'<p><a href="{deep_link}" style="color:#818cf8;">Click here if TechPrep did not reopen automatically.</a></p>'
        if deep_link else ""
    )
    script = f"window.location = {json.dumps(deep_link)};" if deep_link else ""
    return HTMLResponse(_GOOGLE_DESKTOP_HANDOFF_PAGE.format(message=message, link=link_html, script=script))


@app.get("/api/v1/auth/google/desktop/start")
async def google_desktop_start(request: Request):
    if not google_auth.desktop_flow_configured():
        raise HTTPException(503, "Google sign-in for the desktop app is not configured")
    now = time.time()
    _prune_expired_states(now)
    state = secrets.token_urlsafe(24)
    _google_desktop_states[state] = now
    return RedirectResponse(google_auth.authorize_url(_google_desktop_redirect_uri(request), state))


@app.get("/api/v1/auth/google/desktop/callback")
async def google_desktop_callback(request: Request):
    if not google_auth.desktop_flow_configured():
        raise HTTPException(503, "Google sign-in for the desktop app is not configured")
    now = time.time()
    _prune_expired_states(now)
    state = request.query_params.get("state") or ""
    if not state or _google_desktop_states.pop(state, None) is None:
        return _google_desktop_handoff_page("This sign-in link has expired. Return to TechPrep and try again.", None)
    code = request.query_params.get("code")
    if request.query_params.get("error") or not code:
        return _google_desktop_handoff_page("Sign-in was cancelled. You can close this window.", None)
    credential = await run_in_threadpool(google_auth.exchange_code, code, _google_desktop_redirect_uri(request))
    email = await run_in_threadpool(google_auth.verify, credential) if credential else None
    if email is None:
        return _google_desktop_handoff_page("Could not verify this Google account. Return to TechPrep and try again.", None)
    _prune_expired_handoffs(now)
    handoff = secrets.token_urlsafe(24)
    _google_desktop_handoffs[handoff] = (email, now)
    return _google_desktop_handoff_page("Signed in! Returning you to TechPrep…", f"techprep://auth-callback?code={handoff}")


class GoogleDesktopExchangeRequest(BaseModel):
    code: str = Field(min_length=10, max_length=200)


@app.post("/api/v1/auth/google/desktop/exchange", dependencies=[Depends(rate_limit.auth_attempt)])
async def google_desktop_exchange(req: GoogleDesktopExchangeRequest, request: Request) -> dict:
    now = time.time()
    _prune_expired_handoffs(now)
    entry = _google_desktop_handoffs.pop(req.code, None)
    if entry is None:
        raise HTTPException(400, "This sign-in link has expired. Return to TechPrep and try again.")
    email, _ = entry
    user = await run_in_threadpool(users.get_or_create_google_user, email)
    try:
        await run_in_threadpool(subscriptions.grant_free_trial, user)
    except Exception:
        logger.exception("Could not grant free trial")
    return {"token": await new_session_token(user, request), "user": user}


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
        full_tokens: list[str] = []
        stream_failed = False
        try:
            async for token in llm.stream_chat(system, question, history, on_usage=record_usage):
                full_tokens.append(token)
                yield f"data: {json.dumps(token)}\n\n"
        except Exception as e:  # surface provider errors (quota, auth, network) in the UI
            stream_failed = True
            if settings.production():
                logger.exception("LLM provider request failed")
                text = "[The assistant is temporarily unavailable. Please try again.]"
            else:
                msg = getattr(e, "message", None) or str(e)
                text = f"[LLM error: {type(e).__name__}: {msg}]"
            yield f"event: error\ndata: {json.dumps(text)}\n\n"
        await record_usage.flush()
        answered_text = "".join(full_tokens).strip()
        if not stream_failed and question and answered_text:
            try:
                await run_in_threadpool(history_module.save_interview_qa, user, question, answered_text)
            except Exception:
                logger.exception("Could not auto-save question and answer to interview history")
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
