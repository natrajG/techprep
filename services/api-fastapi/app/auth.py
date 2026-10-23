import base64
import hashlib
import hmac
import os
import secrets
import time

from fastapi import Header, HTTPException

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


def issue_token(username: str) -> str:
    payload = base64.urlsafe_b64encode(f"{username}|{int(time.time()) + TOKEN_TTL_SECONDS}".encode()).decode()
    return f"{payload}.{_sign(payload)}"


def parse_token(token: str) -> str | None:
    payload, _, signature = token.partition(".")
    if not payload or not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        username, expires = base64.urlsafe_b64decode(payload.encode()).decode().rsplit("|", 1)
        return username if int(expires) > time.time() else None
    except (ValueError, UnicodeDecodeError):
        return None


async def require_auth(authorization: str = Header(default="")) -> str:
    scheme, _, token = authorization.partition(" ")
    user = parse_token(token) if scheme.lower() == "bearer" else None
    if user is None:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    return user
