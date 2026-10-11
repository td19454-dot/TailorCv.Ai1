import logging
import os
import smtplib
from contextlib import contextmanager
from dataclasses import dataclass
from email.message import EmailMessage
from html import unescape
from re import sub
from typing import Callable, Iterator

import alerts

logger = logging.getLogger(__name__)


class EmailConfigurationError(RuntimeError):
    """Raised when required SMTP settings are missing or invalid."""


@dataclass(frozen=True)
class SesSmtpConfig:
    host: str
    port: int
    username: str
    password: str
    from_email: str


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def load_ses_smtp_config() -> SesSmtpConfig:
    port_value = _env("SES_SMTP_PORT") or "587"
    try:
        port = int(port_value)
    except ValueError as exc:
        raise EmailConfigurationError("SES_SMTP_PORT must be an integer") from exc

    config = SesSmtpConfig(
        host=_env("SES_SMTP_HOST"),
        port=port,
        username=_env("SES_SMTP_USERNAME"),
        password=_env("SES_SMTP_PASSWORD"),
        from_email=_env("EMAIL_FROM"),
    )
    missing = [
        name
        for name, value in (
            ("SES_SMTP_HOST", config.host),
            ("SES_SMTP_USERNAME", config.username),
            ("SES_SMTP_PASSWORD", config.password),
            ("EMAIL_FROM", config.from_email),
        )
        if not value
    ]
    if missing:
        raise EmailConfigurationError(f"Missing email configuration: {', '.join(missing)}")
    return config


def html_to_text(html_body: str) -> str:
    text = sub(r"(?is)<(script|style).*?>.*?</\1>", "", html_body)
    text = sub(r"(?i)<br\s*/?>", "\n", text)
    text = sub(r"(?i)</p\s*>", "\n\n", text)
    text = sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return sub(r"\n{3,}", "\n\n", text).strip()


def build_message(
    recipient_email: str,
    subject: str,
    html_body: str,
    from_email: str,
    headers: dict[str, str] | None = None,
) -> EmailMessage:
    """HTML email with a plain-text alternative derived from the HTML."""
    message = EmailMessage()
    message["From"] = from_email
    message["To"] = recipient_email
    message["Subject"] = subject
    for name, value in (headers or {}).items():
        message[name] = value
    message.set_content(html_to_text(html_body) or "This email requires an HTML-capable email client.")
    message.add_alternative(html_body, subtype="html")
    return message


@contextmanager
def smtp_session(smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP) -> Iterator[smtplib.SMTP]:
    """One logged-in SES SMTP connection, for sending many messages without
    a STARTTLS + login round trip per message (bulk campaigns)."""
    config = load_ses_smtp_config()
    with smtp_factory(config.host, config.port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(config.username, config.password)
        yield smtp


def send_email(
    recipient_email: str,
    subject: str,
    html_body: str,
    *,
    from_email: str | None = None,
    smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP,
) -> bool:
    """Send an HTML email through Amazon SES SMTP using STARTTLS.

    from_email overrides EMAIL_FROM for this message; falls back to it when empty.
    """
    config = load_ses_smtp_config()
    message = build_message(
        recipient_email, subject, html_body, (from_email or "").strip() or config.from_email
    )

    try:
        with smtp_session(smtp_factory) as smtp:
            refused = smtp.send_message(message)
            if refused:
                raise smtplib.SMTPRecipientsRefused(refused)
    except smtplib.SMTPException as exc:
        logger.exception("SMTP email send failed for recipient=%s subject=%r", recipient_email, subject)
        alerts.notify(f"Email failed: {subject}", f"{type(exc).__name__}: {str(exc)[:300]}", key=f"email:{subject}")
        raise
    except OSError as exc:
        logger.exception("SMTP connection failed for host=%s port=%s recipient=%s", config.host, config.port, recipient_email)
        alerts.notify(f"Email failed: {subject}", f"Cannot reach {config.host}:{config.port}: {exc}", key=f"email:{subject}")
        raise

    logger.info("Email sent successfully to recipient=%s subject=%r", recipient_email, subject)
    return True
