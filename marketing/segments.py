"""Named groups of users a campaign can target.

Each segment returns a query of User.id. Suppression (unsubscribed, bounced,
complained) is deliberately NOT applied here — recipients() applies it once on
top of every segment, so a new segment can't forget it.
"""
import os
from datetime import datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session

from models import MarketingSend, Payment, UsageRecord, User
from quota_limits import FREE_LIMITS


def _not_paying(now: datetime):
    return or_(User.pro_until.is_(None), User.pro_until <= now)


def seg_all(db: Session, now: datetime) -> Query:
    """Every registered user."""
    return db.query(User.id)


def seg_free(db: Session, now: datetime) -> Query:
    """Registered but not on a current plan."""
    return db.query(User.id).filter(_not_paying(now))


def seg_paying(db: Session, now: datetime) -> Query:
    """On any current plan (weekly, monthly or yearly)."""
    return db.query(User.id).filter(User.pro_until > now)


def seg_weekly_active(db: Session, now: datetime) -> Query:
    """On a weekly plan that hasn't expired yet."""
    return db.query(User.id).filter(User.pro_until > now, User.pro_plan == "weekly")


def seg_weekly_expired(db: Session, now: datetime) -> Query:
    """Bought a weekly plan, it has expired, and never bought monthly or yearly."""
    weekly = db.query(Payment.user_id).filter(Payment.plan == "weekly", Payment.user_id.isnot(None))
    longer = db.query(Payment.user_id).filter(Payment.plan.in_(("monthly", "yearly")), Payment.user_id.isnot(None))
    return db.query(User.id).filter(
        User.id.in_(weekly),
        ~User.id.in_(longer),
        _not_paying(now),
    )


def seg_upgrade_prompt(db: Session, now: datetime) -> Query:
    """Not paying, and has used up the free allowance of at least one feature.

    The upgrade prompt itself is only logged client-side (PostHog
    `upgrade_prompt_shown`). This is the server-side equivalent: these are the
    users enforce_quota() answers with the 402 that opens that prompt. Mirrors
    its BILLING_BETA_USER_IDS rule — when set, only those users are ever gated.
    """
    exhausted = or_(*(
        func.coalesce(func.sum(getattr(UsageRecord, field)), 0) >= limit
        for field, limit in FREE_LIMITS.items()
    ))
    hit_limit = db.query(UsageRecord.user_id).group_by(UsageRecord.user_id).having(exhausted)
    query = db.query(User.id).filter(User.id.in_(hit_limit), _not_paying(now))

    beta_env = os.getenv("BILLING_BETA_USER_IDS", "").strip()
    if beta_env:
        beta_ids = {int(x) for x in beta_env.split(",") if x.strip().isdigit()}
        query = query.filter(User.id.in_(beta_ids))
    return query


SEGMENTS = {
    "all": seg_all,
    "free": seg_free,
    "paying": seg_paying,
    "weekly_active": seg_weekly_active,
    "weekly_expired": seg_weekly_expired,
    "upgrade_prompt": seg_upgrade_prompt,
}


def recipients(
    db: Session,
    segment: str,
    *,
    campaign: str,
    exclude: tuple[str, ...] = (),
    min_gap_days: int = 7,
    limit: int | None = None,
    now: datetime | None = None,
) -> list[User]:
    """Users in `segment`, minus `exclude` segments, suppressed addresses,
    anyone who already got `campaign`, and anyone mailed in the last
    `min_gap_days` days."""
    now = now or datetime.utcnow()
    for name in (segment, *exclude):
        if name not in SEGMENTS:
            raise ValueError(f"Unknown segment {name!r}. Choose from: {', '.join(SEGMENTS)}")

    already_got = db.query(MarketingSend.user_id).filter(MarketingSend.campaign == campaign)
    query = db.query(User).filter(
        User.id.in_(SEGMENTS[segment](db, now)),
        User.marketing_opt_out.is_(False),
        User.email_bounced_at.is_(None),
        User.email_complained_at.is_(None),
        ~User.id.in_(already_got),
    )
    if min_gap_days > 0:
        recent = db.query(MarketingSend.user_id).filter(
            MarketingSend.sent_at > now - timedelta(days=min_gap_days)
        )
        query = query.filter(~User.id.in_(recent))
    for name in exclude:
        query = query.filter(~User.id.in_(SEGMENTS[name](db, now)))

    query = query.order_by(User.id)
    if limit:
        query = query.limit(limit)
    return query.all()
