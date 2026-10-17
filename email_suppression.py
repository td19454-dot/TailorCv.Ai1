"""Unsubscribe-token helpers shared by the /unsubscribe route (routers/marketing.py)
and the bulk SES sender (marketing_email.py). Kept separate from main.py so the
sender script can import it without pulling in the whole FastAPI app.

Tokens are signed (itsdangerous), not stored — no DB round-trip needed to verify
one, and no per-user token column to keep in sync.
"""
import os
from typing import Optional

from itsdangerous import BadSignature, URLSafeSerializer

_SECRET_KEY = os.getenv("SECRET_KEY", "").strip() or "your-secret-key"
_serializer = URLSafeSerializer(_SECRET_KEY, salt="marketing-unsubscribe")
# Open-pixel and click-redirect tokens. The click destination is signed into
# the token, so /e/c/ can't be used as an open redirect to arbitrary sites.
_track_serializer = URLSafeSerializer(_SECRET_KEY, salt="marketing-track")


def base_url() -> str:
    return os.getenv("APP_BASE_URL", "https://thetailorcv.com").strip().strip("'\"").rstrip("/")


def make_unsubscribe_token(user_id: int, campaign: Optional[str] = None) -> str:
    # Campaign-less tokens stay a bare int: the shape every link already in an inbox has.
    return _serializer.dumps([user_id, campaign] if campaign else user_id)


def _load_unsubscribe(token: str):
    try:
        payload = _serializer.loads(token)
    except (BadSignature, ValueError, TypeError):
        return None, None
    if isinstance(payload, list) and len(payload) == 2:
        user_id, campaign = payload
    else:
        user_id, campaign = payload, None
    try:
        return int(user_id), (str(campaign) if campaign else None)
    except (ValueError, TypeError):
        return None, None


def read_unsubscribe_token(token: str) -> Optional[int]:
    return _load_unsubscribe(token)[0]


def read_unsubscribe_campaign(token: str) -> Optional[str]:
    """The campaign the unsubscribe link was sent in, or None for older links."""
    return _load_unsubscribe(token)[1]


def unsubscribe_url(user_id: int, campaign: Optional[str] = None) -> str:
    return f"{base_url()}/unsubscribe?token={make_unsubscribe_token(user_id, campaign)}"


def make_track_token(campaign: str, user_id: int, url: str = "") -> str:
    return _track_serializer.dumps([campaign, user_id, url])


def read_track_token(token: str) -> Optional[tuple[str, int, str]]:
    try:
        campaign, user_id, url = _track_serializer.loads(token)
        return str(campaign), int(user_id), str(url)
    except (BadSignature, ValueError, TypeError):
        return None
