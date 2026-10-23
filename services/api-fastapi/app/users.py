import asyncio
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

from . import settings

DB_PATH = Path(os.getenv("USERS_DB", Path(__file__).resolve().parents[1] / "data" / "users.db"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MIN_PASSWORD = 8


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")
RESET_TTL_SECONDS = 30 * 60
BUSY_TIMEOUT_SECONDS = 10

# Schema work runs once per database file instead of on every request.
_schema_hooks: list = []
_schema_applied: dict[str, int] = {}
_schema_lock = threading.Lock()
# Password hashing is slow and uses 16 MB each, so it gets a small dedicated pool that cannot
# starve request handling or exhaust memory during a burst of logins.
_hash_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="password-hash")


def register_schema(hook) -> None:
    """Registers an idempotent hook(conn) that creates or upgrades tables."""
    _schema_hooks.append(hook)


def _users_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY COLLATE NOCASE, salt BLOB NOT NULL, hash BLOB NOT NULL, email TEXT)"
    )
    if "email" not in {column[1] for column in conn.execute("PRAGMA table_info(users)")}:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email COLLATE NOCASE) WHERE email IS NOT NULL")
    _ensure_token_usage(conn)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits (expires)")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS password_resets (
            token_hash TEXT PRIMARY KEY,
            username TEXT NOT NULL COLLATE NOCASE,
            expires INTEGER NOT NULL,
            used INTEGER NOT NULL DEFAULT 0
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (username)")


register_schema(lambda conn: _users_schema(conn))


def _apply_schema(conn: sqlite3.Connection, key: str) -> None:
    with _schema_lock:
        applied = _schema_applied.get(key, 0)
        if applied >= len(_schema_hooks):
            return
        if applied == 0:
            # WAL lets readers and the single writer proceed together; it is stored in the database file.
            conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("BEGIN IMMEDIATE")
        for hook in _schema_hooks[applied:]:
            hook(conn)
        conn.commit()
        _schema_applied[key] = len(_schema_hooks)


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    key = str(DB_PATH)
    if not DB_PATH.exists():
        _schema_applied.pop(key, None)
    conn = sqlite3.connect(DB_PATH, timeout=BUSY_TIMEOUT_SECONDS)
    try:
        if _schema_applied.get(key, 0) < len(_schema_hooks):
            _apply_schema(conn, key)
        conn.execute("PRAGMA synchronous=NORMAL")
        with conn:
            yield conn
    finally:
        conn.close()


async def in_hash_pool(function, *args):
    return await asyncio.get_running_loop().run_in_executor(_hash_pool, function, *args)


def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)


def signup_enabled() -> bool:
    default = "false" if settings.production() else "true"
    return os.getenv("ALLOW_SIGNUP", default).lower() not in ("0", "false", "no")


def minimum_password() -> int:
    return 12 if settings.production() else MIN_PASSWORD


def validate(username: str, password: str) -> str | None:
    if not USERNAME_RE.match(username):
        return "Username must be 3-32 characters: letters, numbers, dot, dash or underscore."
    if len(password) < minimum_password():
        return f"Password must be at least {minimum_password()} characters."
    return None


def normalize_email(email: str) -> str | None:
    value = (email or "").strip().lower()
    return value if len(value) <= 254 and EMAIL_RE.match(value) else None


def create_user(username: str, password: str, email: str | None = None) -> bool:
    """False when the username or email is already registered."""
    salt = secrets.token_bytes(16)
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO users (username, salt, hash, email) VALUES (?, ?, ?, ?)",
                (username, salt, _hash(password, salt), email),
            )
    except sqlite3.IntegrityError:
        return False
    return True


def verify_user(username: str, password: str) -> str | None:
    """Returns the stored username spelling on success."""
    with connect() as conn:
        row = conn.execute("SELECT username, salt, hash FROM users WHERE username = ?", (username,)).fetchone()
    # Hash even for unknown users so response time does not reveal which usernames exist.
    stored_name, salt, expected = row or (None, b"\0" * 16, b"\0" * 64)
    ok = hmac.compare_digest(_hash(password, salt), expected)
    return stored_name if row and ok else None


def get_email(username: str) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT email FROM users WHERE username = ?", (username,)).fetchone()
    return row[0] if row else None


def get_user_by_email(email: str) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT username FROM users WHERE email = ? COLLATE NOCASE", (email,)).fetchone()
    return row[0] if row else None


def set_email(username: str, email: str) -> bool:
    """False when another account already uses the address."""
    try:
        with connect() as conn:
            conn.execute("UPDATE users SET email = ? WHERE username = ?", (email, username))
    except sqlite3.IntegrityError:
        return False
    return True


def set_password(username: str, password: str) -> None:
    salt = secrets.token_bytes(16)
    with connect() as conn:
        conn.execute("UPDATE users SET salt = ?, hash = ? WHERE username = ?", (salt, _hash(password, salt), username))


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_reset_token(username: str) -> str:
    """Issues a single-use token and invalidates earlier ones; only its hash is stored."""
    token = secrets.token_urlsafe(32)
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM password_resets WHERE username = ? OR expires <= ?", (username, int(time.time())))
        conn.execute(
            "INSERT INTO password_resets (token_hash, username, expires) VALUES (?, ?, ?)",
            (_token_digest(token), username, int(time.time()) + RESET_TTL_SECONDS),
        )
    return token


def use_reset_token(token: str) -> str | None:
    """Atomically spends a valid token and returns its username."""
    digest = _token_digest(token)
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        spent = conn.execute(
            "UPDATE password_resets SET used = 1 WHERE token_hash = ? AND used = 0 AND expires > ?",
            (digest, int(time.time())),
        )
        if spent.rowcount != 1:
            return None
        row = conn.execute("SELECT username FROM password_resets WHERE token_hash = ?", (digest,)).fetchone()
        conn.execute("DELETE FROM password_resets WHERE username = ?", (row[0],))
    return row[0]


def _ensure_token_usage(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS token_usage (
            username TEXT PRIMARY KEY COLLATE NOCASE,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0
        )"""
    )


def record_token_usage(username: str, prompt_tokens: int, completion_tokens: int) -> None:
    if prompt_tokens < 0 or completion_tokens < 0:
        raise ValueError("Token counts must not be negative")
    with connect() as conn:
        conn.execute(
            """INSERT INTO token_usage (username, prompt_tokens, completion_tokens)
               VALUES (?, ?, ?)
               ON CONFLICT(username) DO UPDATE SET
                 prompt_tokens = prompt_tokens + excluded.prompt_tokens,
                 completion_tokens = completion_tokens + excluded.completion_tokens""",
            (username, prompt_tokens, completion_tokens),
        )


def get_token_usage(username: str) -> dict[str, int]:
    with connect() as conn:
        row = conn.execute(
            "SELECT prompt_tokens, completion_tokens FROM token_usage WHERE username = ?", (username,)
        ).fetchone()
    prompt, completion = row or (0, 0)
    return {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion}
