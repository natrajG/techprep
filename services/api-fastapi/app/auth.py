import base64
import hashlib
import hmac
import os
import secrets
import time

from fastapi import Header, HTTPException

from . import users

TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_HOURS", "12")) * 3600
# Without AUTH_SECRET, tokens are valid only until the backend restarts.
_SECRET = (os.getenv("AUTH_SECRET") or secrets.token_hex(32)).encode()


def configured() -> bool:
    return bool(os.getenv("APP_USERNAME") and os.getenv("APP_PASSWORD"))


def verify_login(username: str, password: str) -> bool:
    if not configured():
        return False
    user_ok = hmac.compare_digest(username.encode(), os.environ["APP_USERNAME"].encode())
    pass_ok = hmac.compare_digest(password.encode(), os.environ["APP_PASSWORD"].encode())
    return user_ok and pass_ok


def _sign(payload: str) -> str:
    return hmac.new(_SECRET, payload.encode(), hashlib.sha256).hexdigest()


def issue_token(username: str, kind: str = "", sid: str = "") -> str:
    expires = int(time.time()) + TOKEN_TTL_SECONDS
    payload = base64.urlsafe_b64encode(f"{username}|{expires}|{kind}|{sid}".encode()).decode()
    return f"{payload}.{_sign(payload)}"


def parse_claims(token: str) -> tuple[str, str, str] | None:
    """Returns (username, kind, sid). Tokens without a session have empty kind and sid."""
    payload, _, signature = token.partition(".")
    if not payload or not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        parts = base64.urlsafe_b64decode(payload.encode()).decode().split("|")
        if len(parts) == 2:
            parts += ["", ""]
        username, expires, kind, sid = parts
        return (username, kind, sid) if int(expires) > time.time() else None
    except (ValueError, UnicodeDecodeError):
        return None


def parse_token(token: str) -> str | None:
    claims = parse_claims(token)
    return claims[0] if claims else None


async def require_auth(authorization: str = Header(default="")) -> str:
    scheme, _, token = authorization.partition(" ")
    claims = parse_claims(token) if scheme.lower() == "bearer" else None
    if claims is None:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    user, kind, sid = claims
    if kind and not users.session_current(user, kind, sid):
        raise HTTPException(401, "Signed in on another device. Sign in again.", headers={"WWW-Authenticate": "Bearer"})
    return user
