"""The founder "Did we help you?" email, sent 24h after a user's first real use.

Used to fire on signup/first login, before the user had done anything — so
nobody could answer it. Now each feature's success path stamps
User.first_activity_at once (mark_first_activity), and an hourly loop in
main.py sends the email to everyone whose first activity is 24h+ old
(send_due_welcome_emails).

Only users created after this shipped are eligible: users.created_at was added
with no database default, so every pre-existing row is NULL and is excluded.
Many of those never got the old email (SES was unset on Render) and must not
all be mailed on the first tick.
"""
import logging
import os
import smtplib
from datetime import datetime, timedelta
from typing import Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import alerts
from email_service import EmailConfigurationError, send_email
from models import User, WelcomeEmailLog

logger = logging.getLogger(__name__)

WELCOME_EMAIL_DELAY = timedelta(hours=24)
# Per tick. Bounds a burst against SES sending limits; the rest go next hour.
WELCOME_EMAIL_BATCH = 50


def send_welcome_email(
    recipient_email: str,
    recipient_name: str,
    *,
    smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP,
) -> bool:
    try:
        return send_email(
            recipient_email,
            "Did we help you?",
            (
                f"<p>Hi {recipient_name or 'there'},</p>"
                "<p>I'm Shubham, Co-Founder of TailorCV.</p>"
                "<p>Behind every resume is someone hoping for an opportunity—a student looking for their first break, "
                "someone trying to switch careers, or someone simply looking for a better future.</p>"
                "<p>As a student myself, I know how overwhelming that journey can feel. That's why I started building TailorCV.</p>"
                "<p>I'd genuinely love to know whether we're creating something that truly helps job seekers.</p>"
                "<p>If you have few minutes sometime this week, I'd really appreciate your honest feedback.</p>"
                "<p>I'd especially love to know:</p>"
                "<ul>"
                "<li>Does TailorCV actually save you time and effort?</li>"
                "<li>Would you use it in your job application workflow?</li>"
                "<li>Was anything confusing or frustrating?</li>"
                "<li>Would you consider paying for something like this?</li>"
                "</ul>"
                "<p>Explore the platform here:<br>"
                "<a href='https://thetailorcv.com/dashboard'>https://thetailorcv.com/dashboard</a></p>"
                "<p>While you're there, feel free to explore our AI Resume Builder, ATS Resume Analysis, "
                "Portfolio Builder, Mock Interviews, Interview Question Generator, and Chrome Extension.</p>"
                "<p><a href='https://chromewebstore.google.com/detail/lnkplncemohgcdjlgccgmbcgiokcgmno?utm_source=item-share-cb'>"
                "TailorCV Chrome Extension</a></p>"
                "<p>Every feature is being built with one goal in mind: making the job application process less stressful and more effective.</p>"
                "<p>Just reply to this email with your thoughts. I personally read every reply, and every piece of feedback helps shape what we build next.</p>"
                "<p>You can also reach me directly at +91 8240044652 (Whatsapp, text or call).</p>"
                "<p>Thank you for your time and support!</p>"
                "<p>Best,<br>Shubham<br>Co-Founder, TailorCV</p>"
            ),
            # Sent from a monitored inbox: the body asks the user to reply.
            from_email=os.getenv("EMAIL_FROM_WELCOME"),
            smtp_factory=smtp_factory,
        )
    except EmailConfigurationError as exc:
        logger.warning("Welcome email skipped because SES SMTP is not configured")
        # Silent for months once already (SES unset on Render) — make it loud.
        alerts.notify("Welcome email not sent: SES not configured", str(exc), key="welcome:config")
        return False


def mark_first_activity(user_id, session_factory=None, now: datetime | None = None) -> None:
    """Stamp the user's first real use. Later calls are no-ops.

    Called from feature success paths, so it never raises — a failure here
    must not break the resume/portfolio/interview the user just got."""
    if not user_id:
        return
    if session_factory is None:
        from database import SessionLocal as session_factory
    db = session_factory()
    try:
        db.query(User).filter(
            User.id == int(user_id),
            User.first_activity_at.is_(None),
            User.created_at.isnot(None),
        ).update({User.first_activity_at: now or datetime.utcnow()}, synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Could not record first activity for user %s", user_id, exc_info=True)
    finally:
        db.close()


def send_due_welcome_emails(
    db: Session,
    now: datetime | None = None,
    limit: int = WELCOME_EMAIL_BATCH,
    *,
    smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP,
) -> int:
    """Send the email to every eligible user whose first activity is 24h+ old.

    Claims each user by inserting the WelcomeEmailLog row *before* sending:
    user_id is unique there, so two processes overlapping during a deploy
    can't both send. A failed send releases the claim for the next tick."""
    now = now or datetime.utcnow()
    due = (
        db.query(User)
        .outerjoin(WelcomeEmailLog, WelcomeEmailLog.user_id == User.id)
        .filter(
            WelcomeEmailLog.id.is_(None),
            User.created_at.isnot(None),
            User.first_activity_at.isnot(None),
            User.first_activity_at <= now - WELCOME_EMAIL_DELAY,
            User.email_bounced_at.is_(None),
            User.email_complained_at.is_(None),
        )
        .order_by(User.first_activity_at)
        .limit(limit)
        .all()
    )

    sent = 0
    for user in due:
        claim = WelcomeEmailLog(user_id=user.id, source="activity_24h")
        db.add(claim)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # another process claimed this user first
            continue

        try:
            ok = send_welcome_email(user.email, user.name, smtp_factory=smtp_factory)
        except Exception:
            logger.exception("Welcome email send failed for user %s", user.id)
            ok = False

        if ok:
            sent += 1
        else:
            db.delete(claim)
            db.commit()
    return sent
