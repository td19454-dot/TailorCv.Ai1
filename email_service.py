import logging
import os
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from html import unescape
from re import sub
from typing import Callable

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


def send_email(
    recipient_email: str,
    subject: str,
    html_body: str,
    *,
    smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP,
) -> bool:
    """Send an HTML email through Amazon SES SMTP using STARTTLS."""
    config = load_ses_smtp_config()

    message = EmailMessage()
    message["From"] = config.from_email
    message["To"] = recipient_email
    message["Subject"] = subject
    message.set_content(html_to_text(html_body) or "This email requires an HTML-capable email client.")
    message.add_alternative(html_body, subtype="html")

    try:
        with smtp_factory(config.host, config.port, timeout=30) as smtp:
            smtp.starttls()
            smtp.login(config.username, config.password)
            smtp.send_message(message)
    except smtplib.SMTPException:
        logger.exception("SMTP email send failed for recipient=%s subject=%r", recipient_email, subject)
        raise
    except OSError:
        logger.exception("SMTP connection failed for host=%s port=%s recipient=%s", config.host, config.port, recipient_email)
        raise

    logger.info("Email sent successfully to recipient=%s subject=%r", recipient_email, subject)
    return True
