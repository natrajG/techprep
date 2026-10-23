import os
import smtplib
import ssl
from email.message import EmailMessage


def configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("MAIL_FROM"))


def send(to: str, subject: str, body: str) -> None:
    """Sends through any SMTP service (AWS SES SMTP, Gmail, Mailgun and others)."""
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
