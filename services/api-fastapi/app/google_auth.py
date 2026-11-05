import os
from urllib.parse import urlencode

import requests
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

_request = google_requests.Request()

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"


def configured() -> bool:
    return bool(os.getenv("GOOGLE_CLIENT_ID"))


def client_id() -> str:
    return os.environ["GOOGLE_CLIENT_ID"]


def desktop_flow_configured() -> bool:
    # Google blocks interactive sign-in inside embedded browsers (like an Electron window), so the
    # desktop app hands the flow to the user's system browser and the server exchanges the resulting
    # authorization code for tokens itself. That server-to-server exchange needs a client secret.
    return configured() and bool(os.getenv("GOOGLE_CLIENT_SECRET"))


def authorize_url(redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client_id(),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code(code: str, redirect_uri: str) -> str | None:
    """Exchanges an authorization code for an ID token. Returns None on any failure."""
    try:
        response = requests.post(TOKEN_URL, data={
            "code": code,
            "client_id": client_id(),
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }, timeout=10)
        response.raise_for_status()
    except requests.RequestException:
        return None
    token = response.json().get("id_token")
    return token if isinstance(token, str) else None


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
