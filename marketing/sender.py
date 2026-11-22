"""Render and send one campaign to a list of users over a single SES SMTP session."""
import logging
import os
import re
import smtplib
import time
from contextlib import ExitStack
from dataclasses import dataclass
from html import unescape
from typing import Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from email_service import build_message, smtp_session
from email_suppression import base_url, make_track_token, unsubscribe_url
from marketing.render import Campaign, render, template_vars
from models import MarketingSend

logger = logging.getLogger(__name__)

# email_suppression.py signs with this when SECRET_KEY is unset — production
# never accepts tokens signed with it.
_FALLBACK_SECRET = "your-secret-key"


def sender_address() -> str:
    return (os.getenv("MARKETING_FROM", "").strip() or os.getenv("EMAIL_FROM", "").strip()).strip("'\"")


def preflight() -> list[str]:
    """Reasons a real send must not go ahead. Shared by marketing_email.py and /admin/email."""
    problems = []
    secret = os.getenv("SECRET_KEY", "").strip()
    if not secret or secret == _FALLBACK_SECRET:
        problems.append(
            "SECRET_KEY is not set. Set it to production's value (Render > Environment): "
            "unsubscribe links are signed with it, and with any other value every "
            "unsubscribe link in this campaign would fail."
        )
    if not sender_address():
        problems.append("Set MARKETING_FROM (or EMAIL_FROM) to the sender address.")
    return problems


@dataclass
class SendResult:
    sent: int = 0
    failed: int = 0
    skipped: int = 0  # claimed by another run first


_HREF_RE = re.compile(r'href="(https?://[^"]+)"', re.I)


def _instrument(html: str, campaign: str, user_id: int, unsub: str) -> str:
    """Route each link through /e/c/ (click tracking) and add the /e/o/ open
    pixel. The unsubscribe link is left alone so it never depends on tracking."""
    base = base_url()

    def rewrite(match: re.Match) -> str:
        url = unescape(match.group(1))
        if url == unsub:
            return match.group(0)
        return f'href="{base}/e/c/{make_track_token(campaign, user_id, url)}"'

    html = _HREF_RE.sub(rewrite, html)
    pixel = (f'<img src="{base}/e/o/{make_track_token(campaign, user_id)}.gif" width="1" height="1" '
             f'alt="" style="display:block;width:1px;height:1px;border:0;">')
    if "</body>" in html:
        return html.replace("</body>", pixel + "\n</body>", 1)
    return html + pixel


def build_campaign_message(campaign: Campaign, user, from_email: str, to_email: str | None = None,
                           track: bool = False):
    """`track` is only set by send_campaign: previews and test sends must not
    record opens and clicks against the real user they are rendered as."""
    unsub = unsubscribe_url(user.id, campaign.name if track else None)
    subject, html = render(campaign, template_vars(user, campaign, unsub))
    if track:
        html = _instrument(html, campaign.name, user.id, unsub)
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
                message = build_campaign_message(campaign, user, from_email, track=True)
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

