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


def make_unsubscribe_token(user_id: int) -> str:
    return _serializer.dumps(user_id)


def read_unsubscribe_token(token: str) -> Optional[int]:
    try:
        return int(_serializer.loads(token))
    except (BadSignature, ValueError, TypeError):
        return None


def unsubscribe_url(user_id: int) -> str:
    base = os.getenv("APP_BASE_URL", "https://thetailorcv.com").strip().rstrip("/")
    return f"{base}/unsubscribe?token={make_unsubscribe_token(user_id)}"
