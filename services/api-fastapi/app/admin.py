import os
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import auth, subscriptions, users
from .auth import require_auth

router = APIRouter(prefix="/api/v1/admin")


def require_admin(user: str = Depends(require_auth)) -> str:
    if not subscriptions.is_admin(user):
        raise HTTPException(403, "Admin access required")
    return user


class GrantSubscriptionRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    plan_id: str = Field(default="monthly", max_length=50)
    plan_name: str | None = Field(default=None, max_length=100)
    amount: int = Field(default=0, ge=0, le=1000000)
    duration_days: int | None = Field(default=None, ge=1, le=365)
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    call_limit: int | None = Field(default=None, ge=1, le=1000)
    reason: str | None = Field(default="Admin grant", max_length=200)


class RevokeSubscriptionRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    subscription_id: int | None = None


@router.get("/users")
def list_users(admin: str = Depends(require_admin)) -> dict:
    """Returns list of registered users with token usage, active subscription, and recharge history."""
    now = int(time.time())
    with users.connect() as conn:
        conn.row_factory = None
        user_rows = conn.execute(
            "SELECT username, email FROM users ORDER BY username COLLATE NOCASE ASC"
        ).fetchall()

        # Token usage lookup
        token_rows = conn.execute(
            "SELECT username, prompt_tokens, completion_tokens FROM token_usage"
        ).fetchall()
        token_map = {
            r[0].lower(): {
                "prompt_tokens": r[1],
                "completion_tokens": r[2],
                "total_tokens": r[1] + r[2],
            }
            for r in token_rows
        }

        # Payment orders / recharge history lookup
        order_rows = conn.execute(
            """SELECT order_id, username, plan_id, plan_name, amount, status, created_at, verified_at,
                      utr_ref, provider_payment_id
               FROM payment_orders
               ORDER BY created_at DESC"""
        ).fetchall()
        orders_by_user: dict[str, list[dict[str, Any]]] = {}
        total_revenue = 0
        for r in order_rows:
            uname = r[1].lower()
            if r[5] == "verified":
                total_revenue += r[4]
            order_dict = {
                "order_id": r[0],
                "plan_id": r[2],
                "plan_name": r[3] or r[2],
                "amount": r[4],
                "status": r[5],
                "created_at": r[6],
                "verified_at": r[7],
                "reference": r[8] or r[9],
            }
            orders_by_user.setdefault(uname, []).append(order_dict)

        # Subscriptions history lookup
        sub_rows = conn.execute(
            """SELECT id, username, plan_id, plan_name, amount, status, created_at, session_start,
                      valid_until, transaction_ref, call_limit, duration_minutes
               FROM subscriptions
               ORDER BY id DESC"""
        ).fetchall()
        subs_by_user: dict[str, list[dict[str, Any]]] = {}
        for r in sub_rows:
            uname = r[1].lower()
            sub_dict = {
                "id": r[0],
                "plan_id": r[2],
                "plan_name": r[3],
                "amount": r[4],
                "status": r[5],
                "created_at": r[6],
                "session_start": r[7],
                "valid_until": r[8],
                "transaction_ref": r[9],
                "call_limit": r[10],
                "duration_minutes": r[11],
            }
            subs_by_user.setdefault(uname, []).append(sub_dict)

    result_users = []
    total_active_subs = 0
    total_tokens_burned = 0

    for uname, email in user_rows:
        uname_lower = uname.lower()
        active_sub = subscriptions.get_active_subscription(uname)
        if active_sub:
            total_active_subs += 1

        t_usage = token_map.get(uname_lower, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
        total_tokens_burned += t_usage["total_tokens"]

        result_users.append({
            "username": uname,
            "email": email,
            "active_subscription": active_sub,
            "token_usage": t_usage,
            "recharges": orders_by_user.get(uname_lower, []),
            "subscriptions": subs_by_user.get(uname_lower, []),
        })

    return {
        "users": result_users,
        "summary": {
            "total_users": len(user_rows),
            "total_active_subs": total_active_subs,
            "total_tokens_burned": total_tokens_burned,
            "total_revenue": total_revenue,
        },
    }


@router.post("/grant-subscription")
def grant_subscription(req: GrantSubscriptionRequest, admin: str = Depends(require_admin)) -> dict:
    """Manually grant an active subscription / promo offer to any user without payment."""
    now = int(time.time())
    with users.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")

        # Verify user exists in users table (case-insensitive check)
        user_row = conn.execute(
            "SELECT username FROM users WHERE username = ? COLLATE NOCASE", (req.username,)
        ).fetchone()
        canonical_username = user_row[0] if user_row else req.username

        # Determine plan parameters
        plan_id = req.plan_id.strip() or "monthly"
        if plan_id == "monthly":
            plan_name = req.plan_name or "Monthly Pro"
            duration_days = req.duration_days or 30
            duration_minutes = None
            call_limit = req.call_limit or 30
            session_start = now
            valid_until = now + duration_days * 86400
        elif plan_id == "hourly_call":
            plan_name = req.plan_name or "Interview Call"
            duration_days = None
            duration_minutes = req.duration_minutes or 60
            call_limit = req.call_limit or 1
            session_start = None  # Starts on first use
            valid_until = None
        else:
            plan_name = req.plan_name or f"Special Offer ({plan_id})"
            duration_days = req.duration_days
            duration_minutes = req.duration_minutes
            call_limit = req.call_limit or 10
            if duration_days:
                session_start = now
                valid_until = now + duration_days * 86400
            elif duration_minutes:
                session_start = None
                valid_until = None
            else:
                duration_days = 30
                session_start = now
                valid_until = now + 30 * 86400

        # Expire any previous active subscription to give clean state
        conn.execute(
            "UPDATE subscriptions SET status = 'replaced' WHERE username = ? COLLATE NOCASE AND status = 'active'",
            (canonical_username,),
        )

        ref = f"ADMIN_GRANT:{req.reason or 'free_offer'}"
        conn.execute(
            """INSERT INTO subscriptions
               (username, plan_id, plan_name, amount, status, created_at, session_start, valid_until,
                transaction_ref, call_limit, duration_minutes)
               VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)""",
            (canonical_username, plan_id, plan_name, req.amount, now, session_start, valid_until,
             ref, call_limit, duration_minutes),
        )

        order_id = f"ADM_{int(now)}_{secrets.token_hex(3).upper()}"
        conn.execute(
            """INSERT INTO payment_orders
               (order_id, username, plan_id, plan_name, amount, upi_uri, status, created_at, verified_at,
                utr_ref, call_limit, duration_minutes, duration_days)
               VALUES (?, ?, ?, ?, ?, '', 'verified', ?, ?, ?, ?, ?, ?)""",
            (order_id, canonical_username, plan_id, plan_name, req.amount, now, now,
             ref, call_limit, duration_minutes, duration_days),
        )

    active = subscriptions.get_active_subscription(canonical_username)
    return {
        "status": "success",
        "message": f"Successfully granted {plan_name} to {canonical_username} without payment.",
        "subscription": active,
    }


@router.post("/revoke-subscription")
def revoke_subscription(req: RevokeSubscriptionRequest, admin: str = Depends(require_admin)) -> dict:
    """Revoke/expire an active subscription for a user."""
    with users.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if req.subscription_id:
            conn.execute(
                "UPDATE subscriptions SET status = 'cancelled' WHERE id = ? AND username = ? COLLATE NOCASE",
                (req.subscription_id, req.username),
            )
        else:
            conn.execute(
                "UPDATE subscriptions SET status = 'cancelled' WHERE username = ? COLLATE NOCASE AND status = 'active'",
                (req.username,),
            )
    return {
        "status": "success",
        "message": f"Revoked active subscription for {req.username}.",
    }
