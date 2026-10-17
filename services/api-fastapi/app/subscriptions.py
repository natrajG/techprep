import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
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


@contextmanager
def get_db():
    with users.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
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
            ("subscriptions", ("call_limit", "duration_minutes")),
            ("payment_orders", ("plan_name", "call_limit", "duration_minutes", "duration_days")),
        ):
            existing = {column[1] for column in conn.execute(f"PRAGMA table_info({table})")}
            for name in columns:
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {'TEXT' if name == 'plan_name' else 'INTEGER'}")
        conn.commit()
        yield conn


class CreateOrderRequest(BaseModel):
    plan_id: str = Field(..., pattern=r"^(hourly_call|monthly)$")


class VerifyPaymentRequest(BaseModel):
    order_id: str
    utr_ref: str = Field(..., min_length=4, max_length=50)


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


def get_active_subscription(username: str) -> dict[str, Any] | None:
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.execute(
            """SELECT id, plan_id, plan_name, amount, status, created_at, session_start, valid_until,
                      call_limit, duration_minutes
               FROM subscriptions
               WHERE username = ? AND status = 'active'
               ORDER BY id DESC LIMIT 1""",
            (username,),
        )
        row = cursor.fetchone()
        if not row:
            return None

        sub_id, plan_id, plan_name, amount, status, created_at, session_start, valid_until, call_limit, duration_minutes = row

        # Check if expired
        if valid_until and valid_until <= now:
            conn.execute("UPDATE subscriptions SET status = 'expired' WHERE id = ?", (sub_id,))
            return None

        time_remaining = (valid_until - now) if valid_until else None
        if plan_id == "monthly":
            calls_used, last_start = conn.execute(
                "SELECT COUNT(*), MAX(started_at) FROM call_sessions WHERE subscription_id = ?", (sub_id,)
            ).fetchone()
            calls_total = call_limit
            call_time_remaining = max(0, last_start + CALL_SECONDS - now) if last_start is not None else 0
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
            "call_duration_minutes": (duration_minutes or 60) if plan_id == "hourly_call" else 60,
        }


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
        if plan_id == "hourly_call" and not session_start:
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
        calls_used, last_start = conn.execute(
            "SELECT COUNT(*), MAX(started_at) FROM call_sessions WHERE subscription_id = ?",
            (subscription_id,),
        ).fetchone()
        if last_start is not None and last_start + CALL_SECONDS > now:
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


def require_subscription(user: str = Depends(require_auth)) -> str:
    """Require an active plan when subscription enforcement is enabled."""
    sub = get_active_subscription(user)
    if not sub:
        if not subscription_enforced():
            return user
        raise HTTPException(
            status_code=402,
            detail="Active subscription required. Please choose a plan to continue.",
        )
    return user


def start_ai_call(user: str) -> None:
    """Start or reuse a call window for a validated AI or audio request."""
    sub = get_active_subscription(user)
    if not sub:
        return
    if sub["plan_id"] == "hourly_call":
        activate_call_session_if_needed(user)
    elif sub["plan_id"] == "monthly":
        activate_monthly_call_if_needed(sub["id"])


def require_ai_call(user: str = Depends(require_subscription)) -> str:
    start_ai_call(user)
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


@router.post("/create-order")
def create_payment_order(req: CreateOrderRequest, user: str = Depends(require_auth)) -> dict:
    order_id = f"TP_{int(time.time())}_{secrets.token_hex(4).upper()}"
    now = int(time.time())
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        plan = get_plan(conn, req.plan_id)
        upi_uri = build_upi_uri(
            vpa=DEFAULT_UPI_VPA, payee_name=DEFAULT_UPI_NAME, amount=plan["amount"],
            order_id=order_id, note=f"TechPrep {plan['name']}",
        )
        conn.execute(
            """INSERT INTO payment_orders
               (order_id, username, plan_id, plan_name, amount, upi_uri, status, created_at,
                call_limit, duration_minutes, duration_days)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (order_id, user, plan["id"], plan["name"], plan["amount"], upi_uri, now,
             plan.get("call_limit"), plan.get("duration_minutes"), plan.get("duration_days")),
        )
    return {
        "order_id": order_id,
        "plan": plan,
        "amount": plan["amount"],
        "upi_uri": upi_uri,
        "upi_vpa": DEFAULT_UPI_VPA,
        "upi_name": DEFAULT_UPI_NAME,
    }


@router.post("/verify")
def verify_payment(req: VerifyPaymentRequest, user: str = Depends(require_auth)) -> dict:
    now = int(time.time())
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute(
            """SELECT order_id, plan_id, plan_name, amount, status, call_limit, duration_minutes, duration_days
               FROM payment_orders WHERE order_id = ? AND username = ?""",
            (req.order_id, user),
        )
        order = cursor.fetchone()
        if not order:
            raise HTTPException(404, "Payment order not found")
        order_id, plan_id, plan_name, amount, status, call_limit, duration_minutes, duration_days = order
        if status == "verified":
            return {"status": "success", "message": "Payment already verified", "order_id": order_id}

        # In UPI manual/gateway flow, record UTR and activate subscription
        conn.execute(
            "UPDATE payment_orders SET status = 'verified', verified_at = ?, utr_ref = ? WHERE order_id = ?",
            (now, req.utr_ref.strip(), order_id),
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
             req.utr_ref.strip(), call_limit, duration_minutes),
        )

    return {
        "status": "success",
        "message": f"Subscription activated! Plan: {plan_name or PLANS[plan_id]['name']}",
        "plan_id": plan_id,
    }
