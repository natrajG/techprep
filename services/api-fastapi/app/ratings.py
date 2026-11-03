import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import users
from .auth import require_auth

router = APIRouter(prefix="/api/v1/ratings")

CONTEXTS = ("trial", "paid")


def _ratings_schema(conn) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS ratings (
            username TEXT PRIMARY KEY COLLATE NOCASE,
            stars INTEGER NOT NULL,
            context TEXT NOT NULL,
            comment TEXT,
            created_at INTEGER NOT NULL
        )"""
    )


users.register_schema(_ratings_schema)


class RatingRequest(BaseModel):
    stars: int = Field(ge=1, le=5)
    context: str = Field(max_length=10)
    comment: str | None = Field(default=None, max_length=1000)


@router.post("")
def submit_rating(req: RatingRequest, user: str = Depends(require_auth)) -> dict:
    context = req.context.strip().lower()
    if context not in CONTEXTS:
        raise HTTPException(422, "Invalid rating context")
    comment = (req.comment or "").strip() or None
    now = int(time.time())
    # One rating per user: a later rating (e.g. after real usage, following an earlier trial
    # rating) simply replaces the previous one, since it reflects their fuller experience.
    with users.connect() as conn:
        conn.execute(
            """INSERT INTO ratings (username, stars, context, comment, created_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (username) DO UPDATE SET
                 stars = excluded.stars, context = excluded.context,
                 comment = excluded.comment, created_at = excluded.created_at""",
            (user, req.stars, context, comment, now),
        )
    return {"ok": True}


@router.get("/summary")
def rating_summary() -> dict:
    """Public aggregate used as social proof on the marketing site: no auth required."""
    with users.connect() as conn:
        row = conn.execute("SELECT COUNT(*), AVG(stars) FROM ratings").fetchone()
    count, average = row
    return {
        "count": count or 0,
        "average": round(average, 1) if average is not None else 0,
    }
