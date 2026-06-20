"""Billing router — Razorpay (INR + USD via Razorpay International).

Region detection uses the CF-IPCountry header injected by Cloudflare.
Three pricing regions:
  india  → INR via standard Razorpay plans
  lic    → USD via Razorpay International (low-income countries)
  global → USD via Razorpay International (rest of world)

All routes return 503 if required env vars are not set, so the file is
safe to deploy before payment keys are configured.

The webhook endpoint is CSRF-exempt (added to EXEMPT_PATHS in main.py).
"""

import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Plan durations (currency-agnostic) ───────────────────────────────────────

PLAN_DURATIONS = {
    "weekly": 7,
    "monthly": 31,
    "yearly": 366,
}

# ── INR config (India) ────────────────────────────────────────────────────────

RAZORPAY_PLANS = {
    "monthly": os.getenv("RAZORPAY_PLAN_MONTHLY"),
    "yearly":  os.getenv("RAZORPAY_PLAN_YEARLY"),
}

WEEKLY_INR = 14900  # ₹149 in paise

# ── USD config (Razorpay International) ──────────────────────────────────────

# Low-income countries: South Asia, SE Asia, Africa (World Bank lower-middle)
LIC_COUNTRIES = {
    "PK", "LK", "NP", "BD", "MM", "KH", "LA", "VN",
    "NG", "ET", "KE", "GH", "TZ", "UG", "EG", "MA", "ID",
}

USD_WEEKLY = {"lic": 199, "global": 499}   # cents  ($1.99 / $4.99)

USD_PLANS = {
    "lic": {
        "monthly": os.getenv("RAZORPAY_PLAN_MONTHLY_LIC"),
        "yearly":  os.getenv("RAZORPAY_PLAN_YEARLY_LIC"),
    },
    "global": {
        "monthly": os.getenv("RAZORPAY_PLAN_MONTHLY_GLOBAL"),
        "yearly":  os.getenv("RAZORPAY_PLAN_YEARLY_GLOBAL"),
    },
}


# ── Region detection ──────────────────────────────────────────────────────────

def _get_region(request: Request) -> str:
    """Derive pricing region from Cloudflare CF-IPCountry header.

    Returns 'india', 'lic', or 'global'.
    Falls back to 'india' when the header is absent — Cloudflare always sets it
    in production, so absence means local dev or a direct (non-proxied) hit.
    """
    country = request.headers.get("CF-IPCountry", "").upper().strip()
    if not country:
        return "india"
    if country == "IN":
        return "india"
    if country in LIC_COUNTRIES:
        return "lic"
    return "global"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _require_razorpay():
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        raise HTTPException(status_code=503, detail={"error": "payment_not_configured"})
    import razorpay as _razorpay
    return _razorpay.Client(auth=(key_id, key_secret))


def _get_db_and_user(request: Request):
    from database import SessionLocal
    from models import User

    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db: Session = SessionLocal()
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        db.close()
        raise HTTPException(status_code=401, detail="Not logged in")
    return db, user


def _extend_pro(db: Session, user, days: int,
                razorpay_subscription_id: str = None) -> None:
    """Grant or extend Pro access by *days* from now (or from existing pro_until)."""
    base = max(user.pro_until or datetime.utcnow(), datetime.utcnow())
    user.pro_until = base + timedelta(days=days)
    user.plan_provider = "razorpay"
    if razorpay_subscription_id:
        user.razorpay_subscription_id = razorpay_subscription_id
    db.commit()


# ── Region endpoint ───────────────────────────────────────────────────────────

@router.get("/api/billing/region")
async def billing_region(request: Request):
    """Return the visitor's pricing region for the frontend to render prices."""
    country = request.headers.get("CF-IPCountry", "").upper().strip()
    region = _get_region(request)
    return JSONResponse({"region": region, "country": country or None})


# ── Razorpay routes ───────────────────────────────────────────────────────────

class RazorpaySubscriptionRequest(BaseModel):
    plan: str  # "monthly" | "yearly"


class RazorpayOrderRequest(BaseModel):
    plan: str  # "weekly"


class RazorpayVerifyRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str = ""
    razorpay_subscription_id: str = ""
    razorpay_signature: str
    plan: str


@router.post("/api/billing/razorpay/subscription")
async def razorpay_subscription(body: RazorpaySubscriptionRequest, request: Request):
    client = _require_razorpay()
    db, user = _get_db_and_user(request)
    try:
        region = _get_region(request)
        if region == "india":
            plan_id = RAZORPAY_PLANS.get(body.plan)
        else:
            plan_id = USD_PLANS[region].get(body.plan)

        if not plan_id:
            raise HTTPException(
                status_code=503,
                detail={"error": "payment_not_configured",
                        "msg": f"No plan ID configured for {region}/{body.plan}"}
            )
        total_count = 10 if body.plan == "yearly" else 60
        subscription = client.subscription.create({
            "plan_id": plan_id,
            "customer_notify": 1,
            "total_count": total_count,
            "notes": {"user_id": str(user.id), "plan": body.plan, "region": region},
        })
        return {
            "subscription_id": subscription["id"],
            "key_id": os.getenv("RAZORPAY_KEY_ID"),
            "name": user.name,
            "email": user.email,
        }
    finally:
        db.close()


@router.post("/api/billing/razorpay/order")
async def razorpay_order(body: RazorpayOrderRequest, request: Request):
    if body.plan != "weekly":
        raise HTTPException(status_code=400, detail="Only 'weekly' is a one-time order")
    client = _require_razorpay()
    db, user = _get_db_and_user(request)
    try:
        region = _get_region(request)
        if region == "india":
            amount, currency = WEEKLY_INR, "INR"
        else:
            amount, currency = USD_WEEKLY[region], "USD"

        order = client.order.create({
            "amount": amount,
            "currency": currency,
            "receipt": str(uuid.uuid4())[:20],
            "notes": {"user_id": str(user.id), "plan": "weekly", "region": region},
        })
        return {
            "order_id": order["id"],
            "key_id": os.getenv("RAZORPAY_KEY_ID"),
            "amount": amount,
            "currency": currency,
            "name": user.name,
            "email": user.email,
        }
    finally:
        db.close()


@router.post("/api/billing/razorpay/verify")
async def razorpay_verify(body: RazorpayVerifyRequest, request: Request):
    """Verify Razorpay payment signature on client callback and grant Pro."""
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_secret:
        raise HTTPException(status_code=503, detail={"error": "payment_not_configured"})

    if body.razorpay_subscription_id:
        message = f"{body.razorpay_payment_id}|{body.razorpay_subscription_id}"
    else:
        message = f"{body.razorpay_order_id}|{body.razorpay_payment_id}"

    expected = hmac.new(key_secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Payment signature invalid")

    db, user = _get_db_and_user(request)
    try:
        days = PLAN_DURATIONS.get(body.plan, 31)
        _extend_pro(db, user, days,
                    razorpay_subscription_id=body.razorpay_subscription_id or None)
        return {"success": True, "pro_until": user.pro_until.isoformat()}
    finally:
        db.close()


@router.post("/api/billing/razorpay/webhook")
async def razorpay_webhook(request: Request):
    webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")
    if not webhook_secret:
        raise HTTPException(status_code=503, detail={"error": "payment_not_configured"})

    payload = await request.body()
    sig_header = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig_header):
        logger.warning("Razorpay webhook signature mismatch")
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        event = json.loads(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    from database import SessionLocal
    from models import User

    event_type = event.get("event", "")
    db: Session = SessionLocal()
    try:
        if event_type in ("subscription.charged", "payment.captured"):
            entity = event.get("payload", {}).get("payment", {}).get("entity", {})
            notes = entity.get("notes", {})
            user_id = notes.get("user_id")
            plan = notes.get("plan", "monthly")
            sub_id = entity.get("subscription_id") or notes.get("subscription_id")

            user = None
            if user_id:
                user = db.query(User).filter_by(id=int(user_id)).first()
            if not user and sub_id:
                user = db.query(User).filter_by(razorpay_subscription_id=sub_id).first()

            if user:
                days = PLAN_DURATIONS.get(plan, 31)
                _extend_pro(db, user, days, razorpay_subscription_id=sub_id)

    except Exception as exc:
        logger.exception("Error processing Razorpay webhook: %s", exc)
    finally:
        db.close()

    return {"received": True}
