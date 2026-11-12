"""Phase 4: a one-time ₹10 payment that unlocks resume-rebuild downloads for 24 hours.

The rebuild itself (resume_rebuild.py) is free to preview — paying once lets the user download
the formatted PDF/DOCX for *any* version they own (regenerate as many times as they like) for a
24-hour window from the moment payment is verified, reusing the same Razorpay/UPI helpers and
verification pattern as subscriptions.py.
"""
import hashlib
import hmac
import os
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from . import resume_rebuild, users
from .auth import require_auth
from .subscriptions import (
    DEFAULT_UPI_NAME,
    DEFAULT_UPI_VPA,
    TEST_PAYMENT_USER,
    build_upi_uri,
    razorpay_credentials,
    razorpay_request,
)

router = APIRouter(prefix="/api/v1/resume-builder")

RESUME_REBUILD_PRICE = int(os.getenv("RESUME_REBUILD_PRICE", "10"))
ENTITLEMENT_WINDOW_SECONDS = 24 * 3600


def _schema(conn) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS resume_payment_orders (
            order_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            amount INTEGER NOT NULL,
            upi_uri TEXT NOT NULL DEFAULT '',
            provider_order_id TEXT,
            provider_payment_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            verified_at INTEGER,
            entitlement_expires_at INTEGER
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_resume_payment_orders_user "
        "ON resume_payment_orders (username, entitlement_expires_at)"
    )


users.register_schema(_schema)


class VerifyResumePaymentRequest(BaseModel):
    order_id: str
    utr_ref: str | None = None
    razorpay_payment_id: str | None = None
    razorpay_signature: str | None = None


@router.post("/payment/create-order")
def create_resume_payment_order(user: str = Depends(require_auth)) -> dict:
    order_id = f"TPR_{int(time.time())}_{user.lower()}"
    now = int(time.time())
    is_test = user.lower() == TEST_PAYMENT_USER
    amount = RESUME_REBUILD_PRICE
    provider_order_id = None
    upi_uri = ""
    if is_test:
        upi_uri = build_upi_uri(
            vpa=DEFAULT_UPI_VPA, payee_name=DEFAULT_UPI_NAME, amount=amount,
            order_id=order_id, note="TechPrep ATS Resume Rebuild",
        )
    else:
        provider_order = razorpay_request(
            "POST", "/orders",
            json={"amount": amount * 100, "currency": "INR", "receipt": order_id,
                  "notes": {"feature": "resume_rebuild_24h"}},
        )
        if (not isinstance(provider_order, dict)
                or not isinstance(provider_order.get("id"), str)
                or provider_order.get("amount") != amount * 100
                or provider_order.get("currency") != "INR"):
            raise HTTPException(502, "Payment provider returned an invalid order")
        provider_order_id = provider_order["id"]

    with users.connect() as conn:
        conn.execute(
            """INSERT INTO resume_payment_orders
               (order_id, username, amount, upi_uri, provider_order_id, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?)""",
            (order_id, user, amount, upi_uri, provider_order_id, now),
        )

    return {
        "order_id": order_id,
        "amount": amount,
        "entitlement_hours": ENTITLEMENT_WINDOW_SECONDS // 3600,
        "payment_mode": "test_utr" if is_test else "razorpay",
        "razorpay_order_id": provider_order_id,
        "razorpay_key_id": None if is_test else razorpay_credentials()[0],
        "upi_uri": upi_uri,
        "upi_vpa": DEFAULT_UPI_VPA if is_test else None,
        "upi_name": DEFAULT_UPI_NAME if is_test else None,
    }


@router.post("/payment/verify")
def verify_resume_payment(req: VerifyResumePaymentRequest, user: str = Depends(require_auth)) -> dict:
    now = int(time.time())
    with users.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT order_id, amount, status, provider_order_id, entitlement_expires_at "
            "FROM resume_payment_orders WHERE order_id = ? AND username = ?",
            (req.order_id, user),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Payment order not found")
        order_id, amount, status, provider_order_id, entitlement_expires_at = row
        if status == "verified":
            return {
                "status": "success", "message": "Payment already verified", "order_id": order_id,
                "entitlement_expires_at": entitlement_expires_at,
            }

        if user.lower() == TEST_PAYMENT_USER and provider_order_id is None:
            if not req.utr_ref or not re.fullmatch(r"[0-9]{12}", req.utr_ref):
                raise HTTPException(422, "Enter a 12-digit UTR")
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
                raise HTTPException(402, "Payment not captured for the full amount")
            payment_id = req.razorpay_payment_id

        if payment_id and conn.execute(
            "SELECT 1 FROM resume_payment_orders WHERE provider_payment_id = ?", (payment_id,)
        ).fetchone():
            raise HTTPException(409, "Payment has already been used for another order")

        expires_at = now + ENTITLEMENT_WINDOW_SECONDS
        conn.execute(
            """UPDATE resume_payment_orders SET status = 'verified', verified_at = ?,
               provider_payment_id = ?, entitlement_expires_at = ? WHERE order_id = ?""",
            (now, payment_id, expires_at, order_id),
        )

    return {"status": "success", "order_id": order_id, "entitlement_expires_at": expires_at}


def _entitlement_expiry(username: str) -> int | None:
    """Returns the latest active (non-expired) entitlement's expiry timestamp, or None."""
    now = int(time.time())
    with users.connect() as conn:
        row = conn.execute(
            "SELECT MAX(entitlement_expires_at) FROM resume_payment_orders "
            "WHERE username = ? AND status = 'verified' AND entitlement_expires_at > ?",
            (username, now),
        ).fetchone()
    return row[0] if row and row[0] else None


@router.get("/payment/entitlement")
def get_entitlement(user: str = Depends(require_auth)) -> dict:
    expires_at = _entitlement_expiry(user)
    return {"active": expires_at is not None, "entitlement_expires_at": expires_at}


@router.get("/version/{version_id}/download")
def download_resume_version(
    version_id: int, fmt: str = Query(..., pattern=r"^(pdf|docx)$"), user: str = Depends(require_auth)
) -> Response:
    if _entitlement_expiry(user) is None:
        raise HTTPException(402, "Pay ₹%d to unlock resume downloads for 24 hours." % RESUME_REBUILD_PRICE)
    data = resume_rebuild.get_version_file(version_id, user, fmt)
    if data is None:
        raise HTTPException(404, "Resume version not found.")
    media_type = (
        "application/pdf" if fmt == "pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    filename = f"resume-rebuilt-{version_id}.{fmt}"
    return Response(
        content=data, media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
