"""Render and send one campaign to a list of users over a single SES SMTP session."""
import logging
import os
import smtplib
import time
from contextlib import ExitStack
from dataclasses import dataclass
from typing import Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from email_service import build_message, smtp_session
from email_suppression import unsubscribe_url
from marketing.render import Campaign, render, template_vars
from models import MarketingSend

logger = logging.getLogger(__name__)


@dataclass
class SendResult:
    sent: int = 0
    failed: int = 0
    skipped: int = 0  # claimed by another run first


def build_campaign_message(campaign: Campaign, user, from_email: str, to_email: str | None = None):
    unsub = unsubscribe_url(user.id)
    subject, html = render(campaign, template_vars(user, campaign, unsub))
    headers = {
        # RFC 8058 one-click: Gmail/Yahoo show an "Unsubscribe" button next to
        # the sender and POST to this URL (routers/marketing.py handles both).
        "List-Unsubscribe": f"<{unsub}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    config_set = os.getenv("SES_CONFIGURATION_SET", "").strip()
    if config_set:
        headers["X-SES-CONFIGURATION-SET"] = config_set
    return build_message(to_email or user.email, subject, html, from_email, headers)


def send_campaign(
    db: Session,
    campaign: Campaign,
    users: list,
    from_email: str,
    *,
    rate_per_second: float = 5.0,
    smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP,
    progress: Callable[[str], None] = print,
) -> SendResult:
    """Claim-then-send each user, like welcome_email.send_due_welcome_emails:
    the MarketingSend row is committed before the email goes out, and removed
    again if the send fails, so a rerun resumes without re-mailing anyone."""
    result = SendResult()
    min_interval = 1.0 / max(rate_per_second, 0.1)

    with ExitStack() as connections:
        smtp = connections.enter_context(smtp_session(smtp_factory))
        for user in users:
            started = time.monotonic()

            claim = MarketingSend(campaign=campaign.name, user_id=user.id)
            db.add(claim)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                result.skipped += 1
                continue

            try:
                message = build_campaign_message(campaign, user, from_email)
                try:
                    smtp.send_message(message)
                except smtplib.SMTPServerDisconnected:
                    # SES closes long-lived connections; reconnect once and retry.
                    smtp = connections.enter_context(smtp_session(smtp_factory))
                    smtp.send_message(message)
                result.sent += 1
            except Exception as exc:
                logger.warning("Campaign %s failed for user %s", campaign.name, user.id, exc_info=True)
                progress(f"  FAILED {user.email}: {exc}")
                db.delete(claim)
                db.commit()
                result.failed += 1

            done = result.sent + result.failed
            if done % 50 == 0:
                progress(f"  {done}/{len(users)} processed")
            elapsed = time.monotonic() - started
            if elapsed < min_interval:
                time.sleep(min_interval - elapsed)
    return result

