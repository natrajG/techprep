import os

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

_request = google_requests.Request()


def configured() -> bool:
    return bool(os.getenv("GOOGLE_CLIENT_ID"))


def client_id() -> str:
    return os.environ["GOOGLE_CLIENT_ID"]


def verify(credential: str) -> str | None:
    """Verifies a Google Identity Services ID token and returns the account's email, or None."""
    try:
        claims = id_token.verify_oauth2_token(credential, _request, client_id())
    except ValueError:
        return None
    if not claims.get("email_verified"):
        return None
    email = claims.get("email")
    return email.strip().lower() if isinstance(email, str) else None
