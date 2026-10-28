import asyncio
import logging
import os
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import mailer, rate_limit, subscriptions, users
from .auth import require_auth

logger = logging.getLogger("techprep")

router = APIRouter(prefix="/api/v1/feedback")

CATEGORIES = ("bug", "suggestion", "other")
STATUSES = ("new", "resolved")
# Feedback older than this is deleted automatically (see cleanup_loop) so the table never
# needs manual housekeeping; admins can still delete/clear entries sooner at any time.
RETENTION_SECONDS = 30 * 24 * 3600
CLEANUP_INTERVAL_SECONDS = 24 * 3600


def _feedback_schema(conn) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL COLLATE NOCASE,
            category TEXT NOT NULL,
            message TEXT NOT NULL,
            source TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'new',
            created_at INTEGER NOT NULL
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status)")


users.register_schema(_feedback_schema)


class FeedbackRequest(BaseModel):
    category: str = Field(max_length=20)
    message: str = Field(max_length=2000)
    source: str = Field(default="web", max_length=10)


class FeedbackStatusUpdate(BaseModel):
    status: str = Field(max_length=20)


def require_admin(user: str = Depends(require_auth)) -> str:
    if not subscriptions.is_admin(user):
        raise HTTPException(403, "Admin access required")
    return user


def _notify_admin(username: str, category: str, source: str, message: str) -> None:
    to = os.getenv("FEEDBACK_NOTIFY_EMAIL")
    if not to or not mailer.configured():
        return
    try:
        mailer.send(
            to, f"TechPrep feedback ({category}) from {username}",
            f"User: {username}\nCategory: {category}\nSource: {source}\n\n{message}\n",
        )
    except Exception:
        logger.exception("Could not send feedback notification email")


@router.post("")
def submit_feedback(req: FeedbackRequest, user: str = Depends(require_auth)) -> dict:
    category = req.category.strip().lower()
    if category not in CATEGORIES:
        raise HTTPException(422, "Invalid feedback category")
    message = req.message.strip()
    if not message:
        raise HTTPException(422, "Feedback message cannot be empty")
    source = req.source.strip().lower()
    if source not in ("web", "desktop"):
        source = "web"
    rate_limit.consume("feedback", user.lower(), 10, 24 * 3600)
    now = int(time.time())
    with users.connect() as conn:
        conn.execute(
            "INSERT INTO feedback (username, category, message, source, status, created_at) "
            "VALUES (?, ?, ?, ?, 'new', ?)",
            (user, category, message, source, now),
        )
    _notify_admin(user, category, source, message)
    return {"ok": True}


@router.get("", dependencies=[Depends(require_admin)])
def list_feedback(limit: int = 50, offset: int = 0) -> dict:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    with users.connect() as conn:
        rows = conn.execute(
            "SELECT id, username, category, message, source, status, created_at FROM feedback "
            "ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        (total,) = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()
    return {
        "items": [
            {
                "id": row[0], "username": row[1], "category": row[2], "message": row[3],
                "source": row[4], "status": row[5], "created_at": row[6],
            }
            for row in rows
        ],
        "total": total,
    }


@router.put("/{feedback_id}", dependencies=[Depends(require_admin)])
def update_feedback_status(feedback_id: int, req: FeedbackStatusUpdate) -> dict:
    status = req.status.strip().lower()
    if status not in STATUSES:
        raise HTTPException(422, "Invalid status")
    with users.connect() as conn:
        cursor = conn.execute("UPDATE feedback SET status = ? WHERE id = ?", (status, feedback_id))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Feedback not found")
    return {"ok": True}


@router.delete("/resolved", dependencies=[Depends(require_admin)])
def clear_resolved_feedback() -> dict:
    """Bulk-clears every entry already marked resolved, for routine cleanup."""
    with users.connect() as conn:
        cursor = conn.execute("DELETE FROM feedback WHERE status = 'resolved'")
    return {"deleted": cursor.rowcount}


@router.delete("/{feedback_id}", dependencies=[Depends(require_admin)])
def delete_feedback(feedback_id: int) -> dict:
    with users.connect() as conn:
        cursor = conn.execute("DELETE FROM feedback WHERE id = ?", (feedback_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Feedback not found")
    return {"ok": True}


def cleanup_old_feedback() -> int:
    cutoff = int(time.time()) - RETENTION_SECONDS
    with users.connect() as conn:
        cursor = conn.execute("DELETE FROM feedback WHERE created_at < ?", (cutoff,))
    return cursor.rowcount


async def cleanup_loop() -> None:
    """Runs for the lifetime of the process, deleting feedback older than 30 days once a day,
    so no admin ever needs to do manual housekeeping (manual delete/clear-resolved above are
    still available any time for earlier cleanup)."""
    while True:
        try:
            deleted = await asyncio.get_running_loop().run_in_executor(None, cleanup_old_feedback)
            if deleted:
                logger.info("Auto-deleted %d feedback entries older than 30 days", deleted)
        except Exception:
            logger.exception("Feedback auto-cleanup failed")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
