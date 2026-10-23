import ipaddress
import os
import re
from pathlib import Path
from urllib.parse import urlsplit


def production() -> bool:
    return os.getenv("APP_ENV", "development") == "production"


def public_origin(value: str) -> str:
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or parsed.port not in (None, 443)
        or "." not in host
        or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid", ".example"))
        or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host)
    ):
        raise ValueError("APP_PUBLIC_URL must be an HTTPS public hostname without a path, credentials, or custom port.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return f"https://{host}"
    raise ValueError("APP_PUBLIC_URL must use a DNS hostname, not an IP address.")


def positive_integer(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer.")
    return value


def store_published() -> bool:
    return os.getenv("STORE_APP_PUBLISHED", "false").lower() in ("true", "1", "yes")


def validate() -> None:
    if os.getenv("APP_ENV", "development") not in ("development", "production"):
        raise ValueError("APP_ENV must be development or production.")
    if not production():
        return
    public_origin(os.getenv("APP_PUBLIC_URL", ""))
    secret = os.getenv("AUTH_SECRET", "")
    if len(secret) < 32 or secret.lower().startswith(("change", "replace", "example")):
        raise ValueError("Production requires a randomly generated AUTH_SECRET of at least 32 characters.")
    username, password = os.getenv("APP_USERNAME", ""), os.getenv("APP_PASSWORD", "")
    if bool(username) != bool(password) or (password and len(password) < 12):
        raise ValueError("Set both APP_USERNAME and APP_PASSWORD; the production password must have at least 12 characters.")
    signup = os.getenv("ALLOW_SIGNUP", "false").lower()
    if signup not in ("true", "false", "1", "0", "yes", "no"):
        raise ValueError("ALLOW_SIGNUP must be true or false.")
    if os.getenv("STORE_APP_PUBLISHED", "false").lower() not in ("true", "false", "1", "0", "yes", "no"):
        raise ValueError("STORE_APP_PUBLISHED must be true or false.")
    if signup in ("false", "0", "no") and not username:
        raise ValueError("Configure a bootstrap login before starting with sign-up disabled.")
    if not os.getenv("OPENAI_API_KEY"):
        raise ValueError("Production requires OPENAI_API_KEY for the assistant.")
    for name in ("USERS_DB", "DESKTOP_RELEASE_DIR"):
        if not Path(os.getenv(name, "")).is_absolute():
            raise ValueError(f"{name} must be an absolute persistent-storage path in production.")
    for name, default in (
        ("AUTH_TOKEN_TTL_HOURS", 12),
        ("AUTH_RATE_LIMIT_ATTEMPTS", 10),
        ("AUTH_RATE_LIMIT_WINDOW_SECONDS", 300),
        ("AUTH_RATE_LIMIT_IP_ATTEMPTS", 500),
        ("AI_REQUESTS_PER_MINUTE", 30),
        ("SMTP_PORT", 587),
    ):
        positive_integer(name, default)
    if bool(os.getenv("SMTP_HOST")) != bool(os.getenv("MAIL_FROM")):
        raise ValueError("Set both SMTP_HOST and MAIL_FROM to enable password reset emails.")
