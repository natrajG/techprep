import hashlib
import time

from fastapi import Depends, HTTPException, Request

from . import auth, settings, users


def consume(bucket: str, identity: str, limit: int, seconds: int) -> None:
    now = int(time.time())
    key = hashlib.sha256(f"{bucket}:{identity}".encode()).hexdigest()
    with users.connect() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS rate_limits "
            "(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits (expires)")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM rate_limits WHERE expires <= ?", (now,))
        row = conn.execute("SELECT attempts, expires FROM rate_limits WHERE key = ?", (key,)).fetchone()
        if row and row[0] >= limit:
            raise HTTPException(
                429, "Too many requests. Please wait and try again.",
                headers={"Retry-After": str(max(1, row[1] - now))},
            )
        conn.execute(
            "INSERT INTO rate_limits VALUES (?, 1, ?) "
            "ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1",
            (key, now + seconds),
        )


def auth_attempt(request: Request) -> None:
    if not settings.production():
        return
    if request.client is None:
        raise HTTPException(503, "Cannot determine the client address.")
    consume(
        "authentication", request.client.host,
        settings.positive_integer("AUTH_RATE_LIMIT_ATTEMPTS", 10),
        settings.positive_integer("AUTH_RATE_LIMIT_WINDOW_SECONDS", 300),
    )


def ai_access(user: str = Depends(auth.require_auth)) -> str:
    if settings.production():
        consume("assistant", user.lower(), settings.positive_integer("AI_REQUESTS_PER_MINUTE", 30), 60)
    return user
