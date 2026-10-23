import hashlib
import threading
import time

from fastapi import Depends, HTTPException, Request

from . import auth, settings, users

TOO_MANY = "Too many requests. Please wait and try again."


def _too_many(retry_after: int) -> HTTPException:
    return HTTPException(429, TOO_MANY, headers={"Retry-After": str(max(1, retry_after))})


def _key(bucket: str, identity: str) -> str:
    return hashlib.sha256(f"{bucket}:{identity}".encode()).hexdigest()


def consume(bucket: str, identity: str, limit: int, seconds: int) -> None:
    """Durable fixed-window counter shared by all workers; for low-volume endpoints."""
    now = int(time.time())
    key = _key(bucket, identity)
    with users.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM rate_limits WHERE expires <= ?", (now,))
        row = conn.execute("SELECT attempts, expires FROM rate_limits WHERE key = ?", (key,)).fetchone()
        if row and row[0] >= limit:
            raise _too_many(row[1] - now)
        conn.execute(
            "INSERT INTO rate_limits VALUES (?, 1, ?) "
            "ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1",
            (key, now + seconds),
        )


def blocked(bucket: str, identity: str, limit: int) -> None:
    """Raises 429 when the counter is already at its limit, without counting this call."""
    now = int(time.time())
    with users.connect() as conn:
        row = conn.execute(
            "SELECT attempts, expires FROM rate_limits WHERE key = ? AND expires > ?", (_key(bucket, identity), now)
        ).fetchone()
    if row and row[0] >= limit:
        raise _too_many(row[1] - now)


def record(bucket: str, identity: str, seconds: int) -> None:
    consume(bucket, identity, 2**62, seconds)


# Per-process counters for the high-volume AI endpoints: no database write per request.
# With several workers the effective ceiling is the limit multiplied by the worker count.
_memory: dict[str, list[float]] = {}
_memory_lock = threading.Lock()
_MEMORY_SWEEP_SIZE = 50_000


def consume_memory(bucket: str, identity: str, limit: int, seconds: int) -> None:
    now = time.time()
    key = f"{bucket}:{identity}"
    with _memory_lock:
        if len(_memory) > _MEMORY_SWEEP_SIZE:
            for stale in [name for name, entry in _memory.items() if entry[1] <= now]:
                del _memory[stale]
        entry = _memory.get(key)
        if entry is None or entry[1] <= now:
            entry = _memory[key] = [0, now + seconds]
        if entry[0] >= limit:
            raise _too_many(int(entry[1] - now) + 1)
        entry[0] += 1


def reset_memory() -> None:
    with _memory_lock:
        _memory.clear()


def _client_address(request: Request) -> str:
    if request.client is None:
        raise HTTPException(503, "Cannot determine the client address.")
    return request.client.host


def auth_attempt(request: Request) -> None:
    """Sign-up limit per client address."""
    if not settings.production():
        return
    consume(
        "authentication", _client_address(request),
        settings.positive_integer("AUTH_RATE_LIMIT_ATTEMPTS", 10),
        settings.positive_integer("AUTH_RATE_LIMIT_WINDOW_SECONDS", 300),
    )


def login_gate(request: Request, username: str) -> None:
    """Called before checking a password.

    Failed attempts lock one username for one address, so users sharing an office or campus
    address do not lock each other out. A generous per-address ceiling still stops one address
    from trying many accounts.
    """
    if not settings.production():
        return
    address = _client_address(request)
    window = settings.positive_integer("AUTH_RATE_LIMIT_WINDOW_SECONDS", 300)
    consume("login-address", address, settings.positive_integer("AUTH_RATE_LIMIT_IP_ATTEMPTS", 500), window)
    blocked(
        "login-failures", f"{address}|{username.lower()}",
        settings.positive_integer("AUTH_RATE_LIMIT_ATTEMPTS", 10),
    )


def login_failed(request: Request, username: str) -> None:
    if not settings.production():
        return
    record(
        "login-failures", f"{_client_address(request)}|{username.lower()}",
        settings.positive_integer("AUTH_RATE_LIMIT_WINDOW_SECONDS", 300),
    )


def password_reset_attempt(request: Request, bucket: str, limit: int) -> None:
    consume(bucket, _client_address(request), limit, 900)


async def ai_access(user: str = Depends(auth.require_auth)) -> str:
    if settings.production():
        consume_memory("assistant", user.lower(), settings.positive_integer("AI_REQUESTS_PER_MINUTE", 30), 60)
    return user
