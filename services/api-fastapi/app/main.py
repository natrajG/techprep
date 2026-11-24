import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import admin, auth, downloads, google_auth, llm, mailer, rate_limit, ratings, settings, subscriptions, users
from . import feedback
from . import history as history_module
from . import job_search
from . import mock_interview
from . import resume_builder
from . import resume_payment
from . import resume_rebuild
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
app.include_router(job_search.router)
app.include_router(resume_builder.router)
app.include_router(resume_rebuild.router)
app.include_router(resume_payment.router)
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
MIN_AUDIO_BYTES = int(os.getenv("MIN_TRANSCRIBE_AUDIO_BYTES", "500"))
logger = logging.getLogger("techprep")
MIN_EXTRACT_CONFIDENCE = 0.72
QUESTION_EXTRACT_MAX_CHARS = 1600
QUESTION_EXTRACT_CONTEXT_TAIL = 260
ANSWER_DEDUP_TTL_SECONDS = 180
CLASSIFIER_DEDUP_TTL_SECONDS = 45
WAIT_FALLBACK_TTL_SECONDS = 45
NO_ANSWER_SENTINEL = "NO_ANSWER"
_FILLER_WORDS = {
    "okay", "ok", "thanks", "thank", "you", "yes", "yeah", "yep", "right",
    "sure", "fine", "alright", "understood", "understand", "got", "it", "cool", "hmm", "uh", "um",
    "no", "mm", "please", "sir",
}
_IGNORE_PATTERNS = (
    r"\b(can you|could you)\s+share your screen\b",
    r"\bcan you hear me\b",
    r"\bhave i joined early\b",
    r"\bthank you for your time\b",
    r"\bit was nice meeting you\b",
)
_LOGISTICS_PATTERNS = (
    r"(?:please )?(?:start|restart) (?:the |your )?(?:system|computer)"
    r"(?: and (?:rejoin|join again))?(?: please)?",
    r"(?:please )?(?:rejoin(?: the (?:call|meeting))?(?: again)?|join again|join the (?:call|meeting) again)(?: please)?",
)
_WAIT_SUFFIX = re.compile(r"\b(and|or|with|without|using|where|that|which|if|when|while|to)\s*$", re.IGNORECASE)
_QUESTION_SIGNAL = re.compile(
    r"\b(how|why|what|when|where|which|explain|difference|compare|implement|design|write|build|create|optimi[sz]e|"
    r"debug|fix|solve|walk me through|can you|could you|would you|should i)\b|\?",
    re.IGNORECASE,
)
_recent_answer_events: dict[tuple[str, str, str], tuple[float, str]] = {}
_recent_classifier_events: dict[tuple[str, str, str], float] = {}
_recent_wait_events: dict[tuple[str, str, str], tuple[float, int]] = {}
_dedupe_lock = asyncio.Lock()


class QuestionExtractionResult(BaseModel):
    decision: Literal["ANSWER", "WAIT", "IGNORE"]
    question: str = Field("", max_length=20000)
    confidence: float = Field(ge=0.0, le=1.0)


def _extract_confidence_threshold() -> float:
    raw = os.getenv("QUESTION_EXTRACT_MIN_CONFIDENCE")
    if raw is None:
        return MIN_EXTRACT_CONFIDENCE
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid QUESTION_EXTRACT_MIN_CONFIDENCE; using default %.2f", MIN_EXTRACT_CONFIDENCE)
        return MIN_EXTRACT_CONFIDENCE
    return max(0.0, min(1.0, value))


def _normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _has_question_signal(text: str) -> bool:
    return bool(_QUESTION_SIGNAL.search(_normalize_spaces(text)))


def _recent_transcript_window(transcript: str, history: list["AnswerTurn"]) -> str:
    normalized = _normalize_spaces(transcript)
    if not normalized:
        return ""
    chunks = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", normalized) if part.strip()]
    if not chunks:
        return normalized[-QUESTION_EXTRACT_MAX_CHARS:]
    selected: list[str] = []
    total = 0
    for part in reversed(chunks):
        cost = len(part) + (1 if selected else 0)
        if total + cost > QUESTION_EXTRACT_MAX_CHARS:
            break
        selected.append(part)
        total += cost
        if total >= 320:
            break
    selected.reverse()
    window = " ".join(selected).strip()
    if len(window) <= 80 and len(chunks) >= 2 and history:
        previous = chunks[-2][-QUESTION_EXTRACT_CONTEXT_TAIL:]
        window = f"{previous} {window}".strip()
    return window or normalized[-QUESTION_EXTRACT_MAX_CHARS:]


def _deterministic_classification(transcript: str, candidate: str = "") -> QuestionExtractionResult | None:
    normalized = _normalize_spaces(transcript)
    if not normalized:
        return QuestionExtractionResult(decision="WAIT", question="", confidence=0.95)
    lowered = normalized.lower().strip(" .!?")
    words = [w for w in re.sub(r"[^a-z\s]", " ", lowered).split() if w]
    names = set(re.findall(r"[a-z]+", candidate.lower().split("@")[0]))
    if any(word in _FILLER_WORDS for word in words) and all(
        word in _FILLER_WORDS or word in names for word in words
    ):
        return QuestionExtractionResult(decision="IGNORE", question="", confidence=0.99)
    if lowered in {"i understand", "okay fine", "ok fine", "thank you", "thanks"}:
        return QuestionExtractionResult(decision="IGNORE", question="", confidence=0.99)
    if any(re.fullmatch(pattern, lowered) for pattern in _IGNORE_PATTERNS):
        return QuestionExtractionResult(decision="IGNORE", question="", confidence=0.99)
    if any(re.fullmatch(pattern, lowered) for pattern in _LOGISTICS_PATTERNS):
        return QuestionExtractionResult(decision="IGNORE", question="", confidence=0.99)
    if normalized.endswith("...") or _WAIT_SUFFIX.search(normalized):
        return QuestionExtractionResult(decision="WAIT", question="", confidence=0.9)
    return None


def _is_short_followup(question: str) -> bool:
    q = question.strip().lower().rstrip("?.!")
    if not q:
        return False
    if q in {"why", "how", "and why", "what about that", "what about this", "what about it", "then"}:
        return True
    return q.startswith("why ") and len(q.split()) <= 4


def _request_session_scope(req: "AnswerRequest", request: Request) -> str:
    manual_scope = req.session_id.strip()
    if manual_scope:
        return manual_scope[:120]
    sub = getattr(request.state, "subscription", None) or {}
    if sub.get("session_start"):
        return f"sub-{sub['session_start']}"
    return "default"


def _sha1(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def _classifier_event_fingerprint(req: "AnswerRequest", transcript_window: str) -> str:
    if req.utterance_id.strip():
        return f"utterance:{req.utterance_id.strip()[:120]}"
    history_tail = req.history[-1].question.strip() if req.history else ""
    return f"window:{_sha1(_normalize_spaces(transcript_window))}:ctx:{_sha1(history_tail[-200:])}"


def _answer_event_fingerprint(req: "AnswerRequest", transcript_window: str, question: str) -> str:
    if req.utterance_id.strip():
        return f"utterance:{req.utterance_id.strip()[:120]}:q:{_sha1(question.strip().lower())}"
    history_tail = req.history[-1].question.strip() if req.history else ""
    payload = f"{_normalize_spaces(transcript_window)}::{question.strip().lower()}::{history_tail[-160:]}"
    return f"window:{_sha1(payload)}"


async def _is_recent_classifier_event(user: str, scope: str, fingerprint: str) -> bool:
    now = time.time()
    key = (user, scope, fingerprint)
    async with _dedupe_lock:
        for k, expires in list(_recent_classifier_events.items()):
            if expires <= now:
                del _recent_classifier_events[k]
        expires = _recent_classifier_events.get(key)
        if expires and expires > now:
            return True
        _recent_classifier_events[key] = now + CLASSIFIER_DEDUP_TTL_SECONDS
        return False


async def _begin_answer_event(user: str, scope: str, fingerprint: str) -> bool:
    now = time.time()
    key = (user, scope, fingerprint)
    async with _dedupe_lock:
        for k, (expires, _) in list(_recent_answer_events.items()):
            if expires <= now:
                del _recent_answer_events[k]
        state = _recent_answer_events.get(key)
        if state and state[0] > now:
            return False
        _recent_answer_events[key] = (now + ANSWER_DEDUP_TTL_SECONDS, "pending")
        return True


async def _wait_fallback_ready(user: str, scope: str, transcript_window: str) -> bool:
    normalized = _normalize_spaces(transcript_window)
    if not normalized or not _has_question_signal(normalized):
        return False
    fingerprint = f"wait:{_sha1(normalized.lower())}"
    now = time.time()
    key = (user, scope, fingerprint)
    async with _dedupe_lock:
        for k, (expires, _) in list(_recent_wait_events.items()):
            if expires <= now:
                del _recent_wait_events[k]
        expires, count = _recent_wait_events.get(key, (0.0, 0))
        if expires <= now:
            count = 0
        count += 1
        _recent_wait_events[key] = (now + WAIT_FALLBACK_TTL_SECONDS, count)
        return count >= 2


async def _finish_answer_event(user: str, scope: str, fingerprint: str, success: bool) -> None:
    key = (user, scope, fingerprint)
    async with _dedupe_lock:
        if success:
            _recent_answer_events[key] = (time.time() + ANSWER_DEDUP_TTL_SECONDS, "done")
        else:
            _recent_answer_events.pop(key, None)


class AnswerTurn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=4000)


class AnswerRequest(BaseModel):
    question: str = Field("", max_length=20000)
    transcript: str = Field("", max_length=20000)
    resume: str = Field("", max_length=15000)
    job_description: str = Field("", max_length=10000)
    history: list[AnswerTurn] = Field(default_factory=list, max_length=2)
    session_id: str = Field("", max_length=120)
    utterance_id: str = Field("", max_length=120)
    question_source: str = Field("manual", max_length=32)


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
    """Track every valid AI request so a heartbeat gap with AI activity cannot be refunded."""
    await run_in_threadpool(subscriptions.start_ai_call, user, request.state.subscription)


@app.post("/api/v1/transcribe", dependencies=[Depends(rate_limit.ai_access)])
async def transcribe(
    request: Request, audio: UploadFile = File(...), user: str = Depends(subscriptions.require_subscription)
) -> dict:
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio chunk too large")
    if len(data) < MIN_AUDIO_BYTES:
        logger.info("transcribe.skip_small_chunk user=%s bytes=%d threshold=%d", user, len(data), MIN_AUDIO_BYTES)
        return {"text": ""}
    await start_call(request, user)
    return {"text": await llm.transcribe(audio.filename or "chunk.webm", data)}


@app.post("/api/v1/answer", dependencies=[Depends(rate_limit.ai_access)])
async def answer(
    req: AnswerRequest, request: Request, user: str = Depends(subscriptions.require_subscription)
) -> StreamingResponse:
    record_usage = UsageWriter(user)
    manual_question = req.question.strip()
    if not manual_question and not req.transcript.strip():
        raise HTTPException(400, "Provide a question or transcript")
    await start_call(request, user)
    session_scope = _request_session_scope(req, request)
    extraction = QuestionExtractionResult(decision="WAIT", question="", confidence=0.0)
    transcript_window = ""
    classifier = "manual"
    answer_dedupe_fingerprint = ""
    allow_manual_bypass = bool(manual_question and req.question_source != "transcript_auto")
    if allow_manual_bypass:
        extraction = QuestionExtractionResult(decision="ANSWER", question=manual_question, confidence=1.0)
    else:
        transcript_window = _recent_transcript_window(req.transcript, req.history)
        if not transcript_window:
            extraction = QuestionExtractionResult(decision="WAIT", question="", confidence=1.0)
            classifier = "empty"
        else:
            rule_result = _deterministic_classification(transcript_window, user)
            if rule_result is not None:
                extraction = rule_result
                classifier = "rule"
            else:
                classifier = "llm"
                classifier_fingerprint = _classifier_event_fingerprint(req, transcript_window)
                if await _is_recent_classifier_event(user, session_scope, classifier_fingerprint):
                    extraction = QuestionExtractionResult(decision="WAIT", question="", confidence=1.0)
                    classifier = "dedupe"
                else:
                    try:
                        raw = await llm.complete(
                            QUESTION_EXTRACT_PROMPT.format(transcript=transcript_window),
                            json_mode=True,
                            on_usage=record_usage,
                        )
                        extraction = QuestionExtractionResult.model_validate_json(raw.strip())
                    except Exception:
                        logger.exception("Question extraction failed")
                        extraction = QuestionExtractionResult(decision="WAIT", question="", confidence=0.0)
                        classifier = "fallback-wait"
        if extraction.decision == "ANSWER":
            extraction.question = extraction.question.strip()
            if not extraction.question:
                extraction = QuestionExtractionResult(decision="WAIT", question="", confidence=extraction.confidence)
            elif extraction.confidence < _extract_confidence_threshold() and not (
                req.history and _is_short_followup(extraction.question)
            ):
                extraction = QuestionExtractionResult(decision="WAIT", question="", confidence=extraction.confidence)
        else:
            extraction.question = ""

    question = extraction.question.strip() if extraction.decision == "ANSWER" else ""
    if extraction.decision == "WAIT" and transcript_window and await _wait_fallback_ready(user, session_scope, transcript_window):
        fallback_question = transcript_window.strip()
        if fallback_question:
            extraction = QuestionExtractionResult(decision="ANSWER", question=fallback_question, confidence=0.65)
            classifier = "wait-fallback"
            logger.info("answer.wait_fallback user=%s scope=%s", user, session_scope)
            question = extraction.question.strip()

    if extraction.decision == "ANSWER" and not allow_manual_bypass:
        answer_dedupe_fingerprint = _answer_event_fingerprint(req, transcript_window, question)
        if not await _begin_answer_event(user, session_scope, answer_dedupe_fingerprint):
            extraction = QuestionExtractionResult(decision="WAIT", question="", confidence=1.0)
            question = ""
            logger.info("answer.skip_duplicate user=%s scope=%s", user, session_scope)

    logger.info(
        "answer.classification user=%s decision=%s conf=%.2f source=%s qlen=%d tlen=%d",
        user, extraction.decision, extraction.confidence, classifier, len(question), len(transcript_window),
    )

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
        outcome = extraction.decision
        detail = classifier
        yield f"event: classification\ndata: {json.dumps(extraction.decision)}\n\n"
        if extraction.decision != "ANSWER":
            yield 'event: question\ndata: ""\n\n'
            await record_usage.flush()
            try:
                await run_in_threadpool(
                    history_module.save_interview_event,
                    user,
                    outcome,
                    req.transcript,
                    "",
                    f"classifier={classifier}; confidence={extraction.confidence:.2f}",
                    req.session_id,
                    req.utterance_id,
                )
            except Exception:
                logger.exception("Could not persist interview event")
            yield "event: done\ndata: \"\"\n\n"
            return
        full_tokens: list[str] = []
        stream_failed = False
        question_sent = False
        prefix = ""
        try:
            async for token in llm.stream_chat(system, question, history, on_usage=record_usage):
                full_tokens.append(token)
                if not question_sent:
                    prefix += token
                    # Hold only the potential sentinel prefix, not a normal streaming answer.
                    if NO_ANSWER_SENTINEL.startswith(prefix.strip()):
                        continue
                    yield f"event: question\ndata: {json.dumps(question)}\n\n"
                    question_sent = True
                    yield f"data: {json.dumps(prefix)}\n\n"
                else:
                    yield f"data: {json.dumps(token)}\n\n"
        except Exception as e:  # surface provider errors (quota, auth, network) in the UI
            stream_failed = True
            outcome = "ERROR"
            detail = f"stream-error:{type(e).__name__}"
            if not question_sent:
                yield f"event: question\ndata: {json.dumps(question)}\n\n"
            if settings.production():
                logger.exception("LLM provider request failed")
                text = "[The assistant is temporarily unavailable. Please try again.]"
            else:
                msg = getattr(e, "message", None) or str(e)
                text = f"[LLM error: {type(e).__name__}: {msg}]"
            yield f"event: error\ndata: {json.dumps(text)}\n\n"
        await record_usage.flush()
        answered_text = "".join(full_tokens).strip()
        is_saveable_answer = bool(answered_text and answered_text != NO_ANSWER_SENTINEL)
        if not stream_failed and not question_sent:
            if is_saveable_answer:
                yield f"event: question\ndata: {json.dumps(question)}\n\n"
                yield f"data: {json.dumps(prefix)}\n\n"
            else:
                outcome = "NO_ANSWER"
                detail = "no-answer-sentinel"
                logger.info("answer.skipped_empty_or_no_answer user=%s", user)
                yield 'event: classification\ndata: "IGNORE"\n\n'
                yield 'event: question\ndata: ""\n\n'
        if not stream_failed and question and is_saveable_answer:
            outcome = "ANSWER"
            detail = "saved-answer"
            try:
                await run_in_threadpool(history_module.save_interview_qa, user, question, answered_text, "general", req.session_id)
            except Exception:
                logger.exception("Could not auto-save question and answer to interview history")
        if answer_dedupe_fingerprint:
            await _finish_answer_event(user, session_scope, answer_dedupe_fingerprint, not stream_failed and is_saveable_answer)
        try:
            await run_in_threadpool(
                history_module.save_interview_event,
                user,
                outcome,
                req.transcript,
                question,
                detail,
                req.session_id,
                req.utterance_id,
            )
        except Exception:
            logger.exception("Could not persist interview event")
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
