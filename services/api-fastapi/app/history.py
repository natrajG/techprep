import logging
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import users
from .auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/history")


def _history_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS interview_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL COLLATE NOCASE,
            session_id TEXT,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            created_at INTEGER NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_interview_history_user ON interview_history (username, created_at DESC)"
    )


users.register_schema(_history_schema)


class AddHistoryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=20000)
    answer: str = Field(min_length=1, max_length=50000)
    category: str | None = Field(default="general", max_length=50)
    session_id: str | None = Field(default=None, max_length=100)


def save_interview_qa(
    username: str, question: str, answer: str, category: str = "general", session_id: str | None = None
) -> int:
    """Save an interview Q&A entry into the user's history."""
    clean_q = (question or "").strip()
    clean_a = (answer or "").strip()
    if not clean_q or not clean_a:
        return 0

    now = int(time.time())
    with users.connect() as conn:
        cursor = conn.execute(
            """INSERT INTO interview_history (username, session_id, question, answer, category, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (username, session_id, clean_q, clean_a, category or "general", now),
        )
        return cursor.lastrowid or 0


@router.get("")
def list_history(
    search: str | None = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: str = Depends(require_auth),
) -> dict:
    """List all interview questions and answers recorded for the current user."""
    with users.connect() as conn:
        conn.row_factory = sqlite3.Row
        params: list[Any] = [user]
        sql = "SELECT id, username, session_id, question, answer, category, created_at FROM interview_history WHERE username = ?"
        count_sql = "SELECT COUNT(*) FROM interview_history WHERE username = ?"

        if search and search.strip():
            kw = f"%{search.strip().lower()}%"
            sql += " AND (LOWER(question) LIKE ? OR LOWER(answer) LIKE ?)"
            count_sql += " AND (LOWER(question) LIKE ? OR LOWER(answer) LIKE ?)"
            params.extend([kw, kw])

        (total,) = conn.execute(count_sql, params).fetchone()

        sql += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
        rows = conn.execute(sql, [*params, limit, offset]).fetchall()

        items = [
            {
                "id": r["id"],
                "session_id": r["session_id"],
                "question": r["question"],
                "answer": r["answer"],
                "category": r["category"] or "general",
                "created_at": r["created_at"],
            }
            for r in rows
        ]

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("")
def add_history(req: AddHistoryRequest, user: str = Depends(require_auth)) -> dict:
    """Add a question and answer pair to user interview history."""
    item_id = save_interview_qa(user, req.question, req.answer, req.category or "general", req.session_id)
    return {"status": "success", "id": item_id}


@router.delete("/{item_id}")
def delete_history_item(item_id: int, user: str = Depends(require_auth)) -> dict:
    """Delete a specific question from user history."""
    with users.connect() as conn:
        cursor = conn.execute("DELETE FROM interview_history WHERE id = ? AND username = ?", (item_id, user))
        if cursor.rowcount == 0:
            raise HTTPException(404, "History item not found")
    return {"status": "success", "deleted_id": item_id}


@router.delete("")
def clear_all_history(user: str = Depends(require_auth)) -> dict:
    """Clear all interview history for the authenticated user."""
    with users.connect() as conn:
        cursor = conn.execute("DELETE FROM interview_history WHERE username = ?", (user,))
        deleted_count = cursor.rowcount
    return {"status": "success", "deleted_count": deleted_count}
