import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from . import settings

DB_PATH = Path(os.getenv("USERS_DB", Path(__file__).resolve().parents[1] / "data" / "users.db"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MIN_PASSWORD = 8


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY COLLATE NOCASE, salt BLOB NOT NULL, hash BLOB NOT NULL)"
        )
        with conn:
            yield conn
    finally:
        conn.close()


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


def create_user(username: str, password: str) -> bool:
    salt = secrets.token_bytes(16)
    try:
        with connect() as conn:
            conn.execute("INSERT INTO users VALUES (?, ?, ?)", (username, salt, _hash(password, salt)))
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
