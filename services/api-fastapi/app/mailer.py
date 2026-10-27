import os
import smtplib
import ssl
from email.message import EmailMessage

import httpx

RESEND_API = "https://api.resend.com/emails"


def configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY") and os.getenv("MAIL_FROM")) or bool(
        os.getenv("SMTP_HOST") and os.getenv("MAIL_FROM")
    )


def send(to: str, subject: str, body: str) -> None:
    """Sends via Resend's HTTP API if RESEND_API_KEY is set, otherwise falls back to SMTP
    (AWS SES SMTP, Gmail, Mailgun and others)."""
    if os.getenv("RESEND_API_KEY"):
        _send_via_resend(to, subject, body)
    else:
        _send_via_smtp(to, subject, body)


def _send_via_resend(to: str, subject: str, body: str) -> None:
    response = httpx.post(
        RESEND_API,
        headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
        json={
            "from": os.environ["MAIL_FROM"],
            "to": [to],
            "subject": subject,
            "text": body,
        },
        timeout=15,
    )
    response.raise_for_status()


def _send_via_smtp(to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = os.environ["MAIL_FROM"]
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    port = int(os.getenv("SMTP_PORT", "587"))
    context = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(os.environ["SMTP_HOST"], port, timeout=15, context=context)
    else:
        server = smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=15)
    with server:
        if port != 465:
            server.starttls(context=context)
        if os.getenv("SMTP_USERNAME"):
            server.login(os.environ["SMTP_USERNAME"], os.getenv("SMTP_PASSWORD", ""))
        server.send_message(message)
