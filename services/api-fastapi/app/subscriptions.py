import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from . import auth, settings, users
from .auth import require_auth

router = APIRouter(prefix="/api/v1/subscription")

PLANS = {
    "hourly_call": {
        "id": "hourly_call",
        "name": "Interview Call",
        "amount": 199,
        "currency": "INR",
        "duration_minutes": 60,
    },
    "monthly": {
        "id": "monthly",
        "name": "Monthly Pro",
        "amount": 1999,
        "currency": "INR",
        "duration_days": 30,
        "call_limit": 30,
    },
}
CALL_SECONDS = 3600
# A one-time, non-purchasable trial granted automatically on signup so new users can see the
# interviewer-hidden window in action before paying. Not part of PLANS/get_plan since it's never
# sold or renewed through the normal checkout flow.
FREE_TRIAL_PLAN_ID = "free_trial"
FREE_TRIAL_NAME = "Trial"
FREE_TRIAL_MINUTES = 6
# Plans that grant a single call whose window is tracked via subscriptions.valid_until
# (as opposed to "monthly", whose calls are tracked in the call_sessions table).
SINGLE_CALL_PLANS = ("hourly_call", FREE_TRIAL_PLAN_ID)
# Grace window: the client is expected to send a heartbeat roughly every 20s while a call is
# active. A gap bigger than this means the user was genuinely disconnected (power cut, network
# drop, app crash) and the excess time is refunded to their call window on reconnect.
HEARTBEAT_GRACE_SECONDS = 45
# Cap how much a single disconnect can extend a call window by, so a laptop left asleep/closed
# for days can't silently grant unlimited call time.
MAX_PAUSE_EXTENSION_SECONDS = 6 * 3600
TEST_PAYMENT_USER = "testuser_win"
RAZORPAY_API = "https://api.razorpay.com/v1"
# Flat payment gateway processing fee passed on to the customer for real Razorpay payments.
PAYMENT_PROCESSING_FEE = 2

# Configurable UPI Merchant VPA & Name
DEFAULT_UPI_VPA = os.getenv("UPI_VPA", "8886164220-5@axl")
DEFAULT_UPI_NAME = os.getenv("UPI_NAME", "GUNDIMALLA RAJESHWARI")
_DATA_ENV = os.getenv("TECHPREP_DATA_DIR")
if _DATA_ENV:
    CUSTOM_QR_DIR = Path(_DATA_ENV)
elif os.getenv("APP_ENV") == "production":
    CUSTOM_QR_DIR = Path("/data")
else:
    CUSTOM_QR_DIR = Path(__file__).resolve().parents[1] / "data"
CUSTOM_QR_PATH = CUSTOM_QR_DIR / "merchant_upi_qr.png"


def is_admin(username: str) -> bool:
    admin_user = os.getenv("APP_USERNAME")
    return bool(admin_user and username.lower() == admin_user.lower())


def _subscription_schema(conn) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL COLLATE NOCASE,
            plan_id TEXT NOT NULL,
            plan_name TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            session_start INTEGER,
            valid_until INTEGER,
            transaction_ref TEXT
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions (username, status)")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS plan_settings (
            plan_id TEXT PRIMARY KEY, amount INTEGER NOT NULL,
            duration_minutes INTEGER, duration_days INTEGER, call_limit INTEGER
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS call_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER NOT NULL,
            started_at INTEGER NOT NULL
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_call_subscription ON call_sessions (subscription_id, started_at)")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS payment_orders (
            order_id TEXT PRIMARY KEY,
            username TEXT NOT NULL COLLATE NOCASE,
            plan_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            upi_uri TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            verified_at INTEGER,
            utr_ref TEXT
        )"""
    )
    for table, columns in (
        ("subscriptions", ("call_limit", "duration_minutes", "last_heartbeat_at")),
        ("call_sessions", ("paused_seconds",)),
        ("payment_orders", ("plan_name", "call_limit", "duration_minutes", "duration_days",
                            "provider_order_id", "provider_payment_id")),
    ):
        existing = {column[1] for column in conn.execute(f"PRAGMA table_info({table})")}
        for name in columns:
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {'TEXT' if name in ('plan_name', 'provider_order_id', 'provider_payment_id') else 'INTEGER'}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_payment ON payment_orders (provider_payment_id)"
    )


users.register_schema(_subscription_schema)


@contextmanager
def get_db():
    with users.connect() as conn:
        yield conn


class CreateOrderRequest(BaseModel):
    plan_id: str = Field(..., pattern=r"^(hourly_call|monthly)$")


class VerifyPaymentRequest(BaseModel):
    order_id: str
    utr_ref: str | None = None
    razorpay_payment_id: str | None = None
    razorpay_signature: str | None = None


def razorpay_credentials() -> tuple[str, str]:
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        raise HTTPException(503, "Payment provider is not configured")
    return key_id, key_secret


def razorpay_request(method: str, path: str, **kwargs) -> dict:
    key_id, key_secret = razorpay_credentials()
    try:
        with httpx.Client(timeout=10, auth=(key_id, key_secret)) as client:
            response = client.request(method, f"{RAZORPAY_API}{path}", **kwargs)
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Payment provider unavailable; please try again") from exc


class PlanUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: int = Field(strict=True, ge=1, le=1000000)
    duration_minutes: int | None = Field(default=None, strict=True, ge=1, le=1440)
    duration_days: int | None = Field(default=None, strict=True, ge=1, le=365)
    call_limit: int | None = Field(default=None, strict=True, ge=1, le=1000)


def get_plan(conn: sqlite3.Connection, plan_id: str) -> dict[str, Any]:
    plan = dict(PLANS[plan_id])
    row = conn.execute(
        "SELECT amount, duration_minutes, duration_days, call_limit FROM plan_settings WHERE plan_id = ?",
        (plan_id,),
    ).fetchone()
    if row:
        plan.update({key: value for key, value in zip(
            ("amount", "duration_minutes", "duration_days", "call_limit"), row
        ) if value is not None})
    if plan_id == "hourly_call":
        plan["description"] = (
            f"₹{plan['amount']:,} per call session ({plan['duration_minutes']} minutes). "
            "Reconnects within the call window stay covered."
        )
    else:
        plan["description"] = (
            f"₹{plan['amount']:,} for {plan['duration_days']} days with "
            f"{plan['call_limit']} one-hour calls for interview preparation & real-time assistance."
        )
    return plan


def build_upi_uri(vpa: str, payee_name: str, amount: int, order_id: str, note: str = "TechPrep Subscription") -> str:
    clean_note = re.sub(r"[^A-Za-z0-9 ]+", "", note)[:30]
    clean_name = re.sub(r"[^A-Za-z0-9 ]+", "", payee_name)[:40]
    return f"upi://pay?pa={vpa}&pn={clean_name}&am={amount}&cu=INR&tr={order_id}&tn={clean_note}"


def _expire_subscription(sub_id: int, now: int) -> None:
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "UPDATE subscriptions SET status = 'expired' WHERE id = ? AND status = 'active' AND valid_until <= ?",
            (sub_id, now),
        )


def get_active_subscription(username: str) -> dict[str, Any] | None:
    """Read-only unless the subscription has just expired."""
    now = int(time.time())
    with get_db() as conn:
        row = conn.execute(
            """SELECT id, plan_id, plan_name, amount, status, created_at, session_start, valid_until,
                      call_limit, duration_minutes
               FROM subscriptions
               WHERE username = ? AND status = 'active'
               ORDER BY id DESC LIMIT 1""",
            (username,),
        ).fetchone()
        if not row:
            return None

        sub_id, plan_id, plan_name, amount, status, created_at, session_start, valid_until, call_limit, duration_minutes = row
        if valid_until and valid_until <= now:
            row = None
        elif plan_id == "monthly":
            calls_used, last_start = conn.execute(
                "SELECT COUNT(*), MAX(started_at) FROM call_sessions WHERE subscription_id = ?", (sub_id,)
            ).fetchone()
            last_paused = 0
            if last_start is not None:
                paused_row = conn.execute(
                    "SELECT paused_seconds FROM call_sessions WHERE subscription_id = ? AND started_at = ? ORDER BY id DESC LIMIT 1",
                    (sub_id, last_start),
                ).fetchone()
                last_paused = (paused_row[0] or 0) if paused_row else 0
    if row is None:
        _expire_subscription(sub_id, now)
        return None

    time_remaining = (valid_until - now) if valid_until else None
    if plan_id == "monthly":
        calls_total = call_limit
        call_time_remaining = max(0, last_start + CALL_SECONDS + last_paused - now) if last_start is not None else 0
    else:
        calls_used = 1 if session_start else 0
        calls_total = 1
        call_time_remaining = max(0, valid_until - now) if valid_until else 0
    return {
        "id": sub_id,
        "plan_id": plan_id,
        "plan_name": plan_name,
        "amount": amount,
        "status": "active",
        "created_at": created_at,
        "session_start": session_start,
        "valid_until": valid_until,
        "time_remaining_seconds": max(0, time_remaining) if time_remaining else None,
        "calls_total": calls_total,
        "calls_used": calls_used,
        "calls_remaining": max(0, calls_total - calls_used) if calls_total is not None else None,
        "call_time_remaining_seconds": call_time_remaining,
        "call_duration_minutes": (duration_minutes or 60) if plan_id in SINGLE_CALL_PLANS else 60,
    }


def grant_free_trial(username: str) -> bool:
    """Grant a one-time 6-minute free call right after signup, so new users can see the
    interviewer-hidden window in action before paying. Only granted if this account has never
    had any subscription before (including a prior trial). Returns True if granted."""
    now = int(time.time())
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        (count,) = conn.execute("SELECT COUNT(*) FROM subscriptions WHERE username = ?", (username,)).fetchone()
        if count:
            return False
        conn.execute(
            """INSERT INTO subscriptions
               (username, plan_id, plan_name, amount, status, created_at, session_start, valid_until, duration_minutes)
               VALUES (?, ?, ?, 0, 'active', ?, NULL, NULL, ?)""",
            (username, FREE_TRIAL_PLAN_ID, FREE_TRIAL_NAME, now, FREE_TRIAL_MINUTES),
        )
    return True


def activate_call_session_if_needed(username: str) -> None:
    """Start the purchased call window on first use."""
    now = int(time.time())
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute(
            """SELECT id, plan_id, session_start, valid_until, duration_minutes
               FROM subscriptions
               WHERE username = ? AND status = 'active'
               ORDER BY id DESC LIMIT 1""",
            (username,),
        )
        row = cursor.fetchone()
        if not row:
            return
        sub_id, plan_id, session_start, valid_until, duration_minutes = row
        if plan_id in SINGLE_CALL_PLANS and not session_start:
            call_end = now + (duration_minutes or 60) * 60
            conn.execute(
                "UPDATE subscriptions SET session_start = ?, valid_until = ? WHERE id = ?",
                (now, call_end, sub_id),
            )


def activate_monthly_call_if_needed(subscription_id: int) -> None:
    now = int(time.time())
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        (call_limit,) = conn.execute(
            "SELECT call_limit FROM subscriptions WHERE id = ?", (subscription_id,)
        ).fetchone()
        calls_used, last_start, last_paused = conn.execute(
            """SELECT COUNT(*), MAX(started_at),
                      (SELECT paused_seconds FROM call_sessions
                       WHERE subscription_id = ? ORDER BY id DESC LIMIT 1)
               FROM call_sessions WHERE subscription_id = ?""",
            (subscription_id, subscription_id),
        ).fetchone()
        if last_start is not None and last_start + CALL_SECONDS + (last_paused or 0) > now:
            return
        if call_limit is not None and calls_used >= call_limit:
            raise HTTPException(402, f"Monthly subscription's {call_limit} one-hour calls have been used. Renew to continue.")
        conn.execute(
            "INSERT INTO call_sessions (subscription_id, started_at) VALUES (?, ?)", (subscription_id, now)
        )


def subscription_enforced() -> bool:
    """Returns True if subscription is explicitly enforced via ENFORCE_SUBSCRIPTIONS=true."""
    val = os.getenv("ENFORCE_SUBSCRIPTIONS", "false").lower()
    return val in ("true", "1", "yes")


def require_subscription(request: Request, user: str = Depends(require_auth)) -> str:
    """Require an active plan when subscription enforcement is enabled."""
    sub = get_active_subscription(user)
    request.state.subscription = sub
    if not sub:
        if not subscription_enforced():
            return user
        raise HTTPException(
            status_code=402,
            detail="Active subscription required. Please choose a plan to continue.",
        )
    return user


def call_window_active(sub: dict[str, Any] | None) -> bool:
    """True when this request needs no write: there is no plan, or its call window is already open."""
    if not sub:
        return True
    if sub["plan_id"] in SINGLE_CALL_PLANS:
        return bool(sub["session_start"])
    if sub["plan_id"] == "monthly":
        return sub["call_time_remaining_seconds"] > 0
    return True


def start_ai_call(user: str, sub: dict[str, Any] | None = None) -> None:
    """Start or reuse a call window for a validated AI or audio request."""
    sub = sub if sub is not None else get_active_subscription(user)
    if call_window_active(sub):
        return
    if sub["plan_id"] in SINGLE_CALL_PLANS:
        activate_call_session_if_needed(user)
    elif sub["plan_id"] == "monthly":
        activate_monthly_call_if_needed(sub["id"])


def require_ai_call(request: Request, user: str = Depends(require_subscription)) -> str:
    start_ai_call(user, request.state.subscription)
    return user


@router.get("/plans")
def list_plans() -> dict:
    has_custom_qr = CUSTOM_QR_PATH.is_file() and CUSTOM_QR_PATH.stat().st_size > 0
    with get_db() as conn:
        plans = [get_plan(conn, plan_id) for plan_id in PLANS]
    return {
        "plans": plans,
        "upi_vpa": DEFAULT_UPI_VPA,
        "upi_name": DEFAULT_UPI_NAME,
        "custom_qr_available": has_custom_qr,
        "custom_qr_url": "/api/v1/subscription/qr-image" if has_custom_qr else None,
    }


@router.put("/plans/{plan_id}")
def update_plan(plan_id: str, req: PlanUpdate, user: str = Depends(require_auth)) -> dict:
    if not is_admin(user):
        raise HTTPException(403, "Only administrator can edit plans")
    if plan_id not in PLANS:
        raise HTTPException(404, "Plan not found")
    fields = {"amount", "duration_minutes"} if plan_id == "hourly_call" else {"amount", "duration_days", "call_limit"}
    if req.model_fields_set != fields or any(getattr(req, field) is None for field in fields):
        raise HTTPException(422, f"Expected fields: {', '.join(sorted(fields))}")
    with get_db() as conn:
        conn.execute(
            """INSERT INTO plan_settings (plan_id, amount, duration_minutes, duration_days, call_limit)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(plan_id) DO UPDATE SET amount = excluded.amount,
                 duration_minutes = excluded.duration_minutes, duration_days = excluded.duration_days,
                 call_limit = excluded.call_limit""",
            (plan_id, req.amount, req.duration_minutes, req.duration_days, req.call_limit),
        )
        return get_plan(conn, plan_id)


@router.get("/qr-image")
def get_custom_qr_image():
    if not CUSTOM_QR_PATH.is_file():
        raise HTTPException(404, "Custom QR code not uploaded")
    return FileResponse(CUSTOM_QR_PATH, media_type="image/png")


@router.post("/upload-qr")
async def upload_custom_qr(file: UploadFile = File(...), user: str = Depends(require_auth)):
    if not is_admin(user):
        raise HTTPException(403, "Only administrator can update merchant QR code")
    data = await file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "QR image file exceeds 5MB limit")
    if len(data) < 100:
        raise HTTPException(400, "Invalid image file")
    CUSTOM_QR_DIR.mkdir(parents=True, exist_ok=True)
    with open(CUSTOM_QR_PATH, "wb") as f:
        f.write(data)
    return {"status": "success", "message": "Custom QR image uploaded successfully", "url": "/api/v1/subscription/qr-image"}


@router.get("/status")
def subscription_status(user: str = Depends(require_auth)) -> dict:
    sub = get_active_subscription(user)
    if not sub:
        return {"has_active": False, "subscription": None, "token_usage": users.get_token_usage(user)}
    return {"has_active": True, "subscription": sub, "token_usage": users.get_token_usage(user)}


@router.post("/heartbeat")
def subscription_heartbeat(user: str = Depends(require_auth)) -> dict:
    """Called periodically by the client while a call is active. If the gap since the last
    heartbeat is bigger than the expected interval, the user was disconnected (power cut,
    network drop, app crash) and that gap is refunded to their current call window."""
    now = int(time.time())
    extended = 0
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            """SELECT id, plan_id, session_start, valid_until, last_heartbeat_at
               FROM subscriptions WHERE username = ? AND status = 'active' ORDER BY id DESC LIMIT 1""",
            (user,),
        ).fetchone()
        if not row:
            return {"ok": True, "extended_seconds": 0}
        sub_id, plan_id, session_start, valid_until, last_heartbeat_at = row
        gap = (now - last_heartbeat_at) if last_heartbeat_at else 0
        if gap > HEARTBEAT_GRACE_SECONDS:
            extended = min(gap - HEARTBEAT_GRACE_SECONDS, MAX_PAUSE_EXTENSION_SECONDS)
        if extended and plan_id in SINGLE_CALL_PLANS and session_start and valid_until:
            conn.execute("UPDATE subscriptions SET valid_until = valid_until + ? WHERE id = ?", (extended, sub_id))
        elif extended and plan_id == "monthly":
            cs = conn.execute(
                "SELECT id, started_at FROM call_sessions WHERE subscription_id = ? ORDER BY id DESC LIMIT 1",
                (sub_id,),
            ).fetchone()
            if cs and cs[1] + CALL_SECONDS > now:
                conn.execute(
                    "UPDATE call_sessions SET paused_seconds = COALESCE(paused_seconds, 0) + ? WHERE id = ?",
                    (extended, cs[0]),
                )
        conn.execute("UPDATE subscriptions SET last_heartbeat_at = ? WHERE id = ?", (now, sub_id))
    return {"ok": True, "extended_seconds": extended}


@router.post("/create-order")
def create_payment_order(req: CreateOrderRequest, user: str = Depends(require_auth)) -> dict:
    order_id = f"TP_{int(time.time())}_{secrets.token_hex(4).upper()}"
    now = int(time.time())
    with get_db() as conn:
        plan = get_plan(conn, req.plan_id)
    is_test = user.lower() == TEST_PAYMENT_USER
    # Real Razorpay payments pass on a flat ₹2 gateway processing fee on top of the plan price.
    processing_fee = 0 if is_test else PAYMENT_PROCESSING_FEE
    charge_amount = plan["amount"] + processing_fee
    provider_order_id = None
    upi_uri = ""
    if is_test:
        upi_uri = build_upi_uri(
            vpa=DEFAULT_UPI_VPA, payee_name=DEFAULT_UPI_NAME, amount=charge_amount,
            order_id=order_id, note=f"TechPrep {plan['name']}",
        )
    else:
        provider_order = razorpay_request(
            "POST", "/orders",
            json={"amount": charge_amount * 100, "currency": "INR",
                  "receipt": order_id, "notes": {"plan_id": req.plan_id}},
        )
        if (not isinstance(provider_order, dict)
                or not isinstance(provider_order.get("id"), str)
                or provider_order.get("amount") != charge_amount * 100
                or provider_order.get("currency") != "INR"):
            raise HTTPException(502, "Payment provider returned an invalid order")
        provider_order_id = provider_order["id"]
    with get_db() as conn:
        conn.execute(
            """INSERT INTO payment_orders
               (order_id, username, plan_id, plan_name, amount, upi_uri, status, created_at,
                call_limit, duration_minutes, duration_days, provider_order_id)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)""",
            (order_id, user, plan["id"], plan["name"], charge_amount, upi_uri, now,
             plan.get("call_limit"), plan.get("duration_minutes"), plan.get("duration_days"), provider_order_id),
        )
    return {
        "order_id": order_id,
        "plan": plan,
        "amount": charge_amount,
        "base_amount": plan["amount"],
        "processing_fee": processing_fee,
        "payment_mode": "test_utr" if is_test else "razorpay",
        "razorpay_order_id": provider_order_id,
        "razorpay_key_id": None if is_test else razorpay_credentials()[0],
        "upi_uri": upi_uri,
        "upi_vpa": DEFAULT_UPI_VPA if is_test else None,
        "upi_name": DEFAULT_UPI_NAME if is_test else None,
    }


@router.post("/verify")
def verify_payment(req: VerifyPaymentRequest, user: str = Depends(require_auth)) -> dict:
    now = int(time.time())
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute(
            """SELECT order_id, plan_id, plan_name, amount, status, call_limit, duration_minutes,
                      duration_days, provider_order_id
               FROM payment_orders WHERE order_id = ? AND username = ?""",
            (req.order_id, user),
        )
        order = cursor.fetchone()
        if not order:
            raise HTTPException(404, "Payment order not found")
        order_id, plan_id, plan_name, amount, status, call_limit, duration_minutes, duration_days, provider_order_id = order
        if status == "verified":
            return {"status": "success", "message": "Payment already verified", "order_id": order_id}

        if user.lower() == TEST_PAYMENT_USER and provider_order_id is None:
            if not req.utr_ref or not re.fullmatch(r"[0-9]{12}", req.utr_ref):
                raise HTTPException(422, "Enter a 12-digit UTR")
            reference = req.utr_ref
            payment_id = None
        else:
            if (not provider_order_id or not req.razorpay_payment_id or not req.razorpay_signature
                    or not re.fullmatch(r"pay_[A-Za-z0-9]+", req.razorpay_payment_id)):
                raise HTTPException(422, "Razorpay payment details are required")
            _, secret = razorpay_credentials()
            signed = f"{provider_order_id}|{req.razorpay_payment_id}".encode()
            expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, req.razorpay_signature):
                raise HTTPException(400, "Invalid payment signature")
            payment = razorpay_request("GET", f"/payments/{req.razorpay_payment_id}")
            if (not isinstance(payment, dict)
                    or payment.get("id") != req.razorpay_payment_id
                    or payment.get("order_id") != provider_order_id
                    or payment.get("status") != "captured"
                    or payment.get("currency") != "INR"
                    or type(payment.get("amount")) is not int
                    or payment["amount"] != amount * 100):
                raise HTTPException(402, "Payment not captured for the full subscription amount")
            reference = req.razorpay_payment_id
            payment_id = req.razorpay_payment_id

        if payment_id and conn.execute(
            "SELECT 1 FROM payment_orders WHERE provider_payment_id = ?", (payment_id,)
        ).fetchone():
            raise HTTPException(409, "Payment has already been used for another order")

        conn.execute(
            """UPDATE payment_orders SET status = 'verified', verified_at = ?,
               utr_ref = ?, provider_payment_id = ? WHERE order_id = ?""",
            (now, reference, payment_id, order_id),
        )

        if plan_id == "monthly":
            valid_until = now + (duration_days or 30) * 86400
            session_start = now
        else:
            # Hourly call: Session start begins when the call/assist is first activated
            session_start = None
            valid_until = None

        conn.execute(
            """INSERT INTO subscriptions
               (username, plan_id, plan_name, amount, status, created_at, session_start, valid_until,
                transaction_ref, call_limit, duration_minutes)
               VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)""",
            (user, plan_id, plan_name or PLANS[plan_id]["name"], amount, now, session_start, valid_until,
             reference, call_limit, duration_minutes),
        )

    return {
        "status": "success",
        "message": f"Subscription activated! Plan: {plan_name or PLANS[plan_id]['name']}",
        "plan_id": plan_id,
    }
