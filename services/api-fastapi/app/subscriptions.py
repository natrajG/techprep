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
from pydantic import BaseModel, Field

from . import auth, settings, users
from .auth import require_auth

router = APIRouter(prefix="/api/v1/subscription")

# Plans definition
PLANS = {
    "hourly_call": {
        "id": "hourly_call",
        "name": "1-Hour Interview Call",
        "amount": 199,
        "currency": "INR",
        "duration_minutes": 60,
        "description": "₹199 per call session (1 hour). Reconnects within the hour stay covered.",
    },
    "monthly": {
        "id": "monthly",
        "name": "Monthly Pro Unlimited",
        "amount": 1999,
        "currency": "INR",
        "duration_days": 30,
        "description": "₹1,999 for 30 days unlimited interview preparation & real-time assistance.",
    },
}

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
        yield conn


class CreateOrderRequest(BaseModel):
    plan_id: str = Field(..., pattern=r"^(hourly_call|monthly)$")


class VerifyPaymentRequest(BaseModel):
    order_id: str
    utr_ref: str = Field(..., min_length=4, max_length=50)


def build_upi_uri(vpa: str, payee_name: str, amount: int, order_id: str, note: str = "TechPrep Subscription") -> str:
    clean_note = re.sub(r"[^A-Za-z0-9 ]+", "", note)[:30]
    clean_name = re.sub(r"[^A-Za-z0-9 ]+", "", payee_name)[:40]
    return f"upi://pay?pa={vpa}&pn={clean_name}&am={amount}&cu=INR&tr={order_id}&tn={clean_note}"


def get_active_subscription(username: str) -> dict[str, Any] | None:
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.execute(
            """SELECT id, plan_id, plan_name, amount, status, created_at, session_start, valid_until
               FROM subscriptions
               WHERE username = ? AND status = 'active'
               ORDER BY id DESC LIMIT 1""",
            (username,),
        )
        row = cursor.fetchone()
        if not row:
            return None

        sub_id, plan_id, plan_name, amount, status, created_at, session_start, valid_until = row

        # Check if expired
        if valid_until and valid_until <= now:
            conn.execute("UPDATE subscriptions SET status = 'expired' WHERE id = ?", (sub_id,))
            return None

        time_remaining = (valid_until - now) if valid_until else None
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
        }


def activate_call_session_if_needed(username: str) -> None:
    """For 1-hour call plan, the 60-minute countdown starts when the first call/audio begins."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.execute(
            """SELECT id, plan_id, session_start, valid_until
               FROM subscriptions
               WHERE username = ? AND status = 'active'
               ORDER BY id DESC LIMIT 1""",
            (username,),
        )
        row = cursor.fetchone()
        if not row:
            return
        sub_id, plan_id, session_start, valid_until = row
        if plan_id == "hourly_call" and not session_start:
            # First call initiated: Start 1-hour timer from now
            one_hour_later = now + 3600
            conn.execute(
                "UPDATE subscriptions SET session_start = ?, valid_until = ? WHERE id = ?",
                (now, one_hour_later, sub_id),
            )


def subscription_enforced() -> bool:
    """Returns True if subscription is explicitly enforced via ENFORCE_SUBSCRIPTIONS=true."""
    val = os.getenv("ENFORCE_SUBSCRIPTIONS", "false").lower()
    return val in ("true", "1", "yes")


def require_subscription(user: str = Depends(require_auth)) -> str:
    """Dependency protecting AI endpoints and app downloads."""
    if not subscription_enforced():
        return user
    sub = get_active_subscription(user)
    if not sub:
        raise HTTPException(
            status_code=402,
            detail="Active subscription required. Please choose a plan (₹199 per call or ₹1,999 monthly) to continue.",
        )
    # If using hourly plan, ensure timer is running once active service is called
    if sub["plan_id"] == "hourly_call":
        activate_call_session_if_needed(user)
    return user


@router.get("/plans")
def list_plans() -> dict:
    has_custom_qr = CUSTOM_QR_PATH.is_file() and CUSTOM_QR_PATH.stat().st_size > 0
    return {
        "plans": list(PLANS.values()),
        "upi_vpa": DEFAULT_UPI_VPA,
        "upi_name": DEFAULT_UPI_NAME,
        "custom_qr_available": has_custom_qr,
        "custom_qr_url": "/api/v1/subscription/qr-image" if has_custom_qr else None,
    }


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
        return {"has_active": False, "subscription": None}
    return {"has_active": True, "subscription": sub}


@router.post("/create-order")
def create_payment_order(req: CreateOrderRequest, user: str = Depends(require_auth)) -> dict:
    plan = PLANS[req.plan_id]
    order_id = f"TP_{int(time.time())}_{secrets.token_hex(4).upper()}"
    upi_uri = build_upi_uri(
        vpa=DEFAULT_UPI_VPA,
        payee_name=DEFAULT_UPI_NAME,
        amount=plan["amount"],
        order_id=order_id,
        note=f"TechPrep {plan['name']}",
    )
    now = int(time.time())
    with get_db() as conn:
        conn.execute(
            """INSERT INTO payment_orders (order_id, username, plan_id, amount, upi_uri, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?)""",
            (order_id, user, plan["id"], plan["amount"], upi_uri, now),
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
        cursor = conn.execute(
            "SELECT order_id, username, plan_id, amount, status FROM payment_orders WHERE order_id = ? AND username = ?",
            (req.order_id, user),
        )
        order = cursor.fetchone()
        if not order:
            raise HTTPException(404, "Payment order not found")
        order_id, _, plan_id, amount, status = order
        if status == "verified":
            return {"status": "success", "message": "Payment already verified", "order_id": order_id}

        # In UPI manual/gateway flow, record UTR and activate subscription
        conn.execute(
            "UPDATE payment_orders SET status = 'verified', verified_at = ?, utr_ref = ? WHERE order_id = ?",
            (now, req.utr_ref.strip(), order_id),
        )

        plan = PLANS[plan_id]
        if plan_id == "monthly":
            valid_until = now + (30 * 86400)
            session_start = now
        else:
            # Hourly call: Session start begins when the call/assist is first activated
            session_start = None
            valid_until = None

        conn.execute(
            """INSERT INTO subscriptions (username, plan_id, plan_name, amount, status, created_at, session_start, valid_until, transaction_ref)
               VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)""",
            (user, plan_id, plan["name"], amount, now, session_start, valid_until, req.utr_ref.strip()),
        )

    return {
        "status": "success",
        "message": f"Subscription activated! Plan: {plan['name']}",
        "plan_id": plan_id,
    }
