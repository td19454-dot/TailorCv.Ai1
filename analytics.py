"""Server-side PostHog events.

Standalone on purpose: main.py and routers/* both import it, and routers can't
import main at module load without a cycle.

Everything here is best-effort — analytics must never break a request. With no
POSTHOG_API_KEY set, track() is a no-op. distinct_id is always str(user.id), the
same id the browser and the extension pass to posthog.identify().

Never put resume text, JD text, emails, names or raw IPs in `props`.
"""
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_client = None


def init() -> None:
    """Create the one PostHog client. Safe to call repeatedly."""
    global _client
    if _client is not None:
        return
    key = os.getenv("POSTHOG_API_KEY", "").strip()
    if not key:
        return
    try:
        from posthog import Posthog

        _client = Posthog(key, host=os.getenv("POSTHOG_HOST", "https://us.i.posthog.com").strip())
    except Exception:
        logger.warning("PostHog init failed; server-side analytics disabled", exc_info=True)


def shutdown() -> None:
    """Flush the queue so events sent just before a restart aren't lost."""
    try:
        if _client is not None:
            _client.shutdown()
    except Exception:
        logger.warning("PostHog shutdown failed", exc_info=True)


def device_from_request(request) -> Optional[str]:
    try:
        ua = (request.headers.get("user-agent") or "").lower()
    except Exception:
        return None
    if not ua:
        return None
    if "ipad" in ua or "tablet" in ua:
        return "tablet"
    if "mobi" in ua or "android" in ua or "iphone" in ua:
        return "mobile"
    return "desktop"


def jd_length_bucket(n: int) -> str:
    return "short" if n < 1500 else "medium" if n < 4000 else "long"


def error_category(exc: BaseException, stage: str) -> str:
    """Safe label for optimization_failed. `stage` is where the caller was
    (extract / ai / render); the raw message is never sent."""
    import asyncio

    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    return {"extract": "pdf_extract", "ai": "ai_error", "render": "render"}.get(stage, "unknown")


def track_optimization_completed(user_id, request, props: dict) -> None:
    """Fire optimization_completed with the user's running count. Each completion
    gets its own log row, which is what count_events() counts."""
    import uuid

    previous = count_events(user_id, "optimization_completed")
    track(
        user_id,
        "optimization_completed",
        {**props, "optimization_count": previous + 1, "is_repeat": previous > 0},
        request=request,
        dedupe_key=f"opt:{uuid.uuid4().hex}",
    )


def _claim(user_id, event: str, key: str) -> bool:
    """Insert the dedupe row. False means this key already fired (or the DB is
    unreachable — we'd rather drop an event than double-count a payment)."""
    from sqlalchemy.exc import IntegrityError

    from database import SessionLocal
    from models import AnalyticsEventLog

    db = SessionLocal()
    try:
        db.add(AnalyticsEventLog(key=key[:190], user_id=int(user_id), event=event))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False
    except Exception:
        db.rollback()
        logger.warning("analytics dedupe insert failed for %s", event, exc_info=True)
        return False
    finally:
        db.close()


def count_events(user_id, event: str) -> int:
    """How many dedupe-logged `event` rows this user already has."""
    from database import SessionLocal
    from models import AnalyticsEventLog

    db = SessionLocal()
    try:
        return db.query(AnalyticsEventLog).filter(
            AnalyticsEventLog.user_id == int(user_id),
            AnalyticsEventLog.event == event,
        ).count()
    except Exception:
        return 0
    finally:
        db.close()


def track(user_id, event: str, props: Optional[dict] = None, request=None,
          dedupe_key: Optional[str] = None) -> bool:
    """Capture `event` for `user_id`. With `dedupe_key`, fires at most once per
    key, across restarts and workers. Returns True if the event was sent."""
    try:
        if _client is None or user_id is None:
            return False
        if dedupe_key and not _claim(user_id, event, dedupe_key):
            return False
        properties = dict(props or {})
        if request is not None:
            country = request.headers.get("cf-ipcountry")
            if country:
                properties.setdefault("country", country)
            device = device_from_request(request)
            if device:
                properties.setdefault("device", device)
        _client.capture(event, distinct_id=str(user_id), properties=properties)
        return True
    except Exception:
        logger.warning("analytics track(%s) failed", event, exc_info=True)
        return False
