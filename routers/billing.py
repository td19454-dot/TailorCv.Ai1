"""Billing router — Razorpay (India/INR) + Polar (LIC/Global USD).

Region detection uses the CF-IPCountry header injected by Cloudflare.
Three pricing regions:
  india  → INR via Razorpay (unchanged)
  lic    → USD via Polar (low-income countries)
  global → USD via Polar (rest of world)

All routes return 503 if required env vars are not set, so the file is
safe to deploy before payment keys are configured.

Webhook endpoints are CSRF-exempt (added to EXEMPT_PATHS in main.py).
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

# ── Polar config (LIC + Global USD) ──────────────────────────────────────────

POLAR_PRICES = {
    "lic": {
        "weekly":  os.getenv("POLAR_PRICE_WEEKLY_LIC"),
        "monthly": os.getenv("POLAR_PRICE_MONTHLY_LIC"),
        "yearly":  os.getenv("POLAR_PRICE_YEARLY_LIC"),
    },
    "global": {
        "weekly":  os.getenv("POLAR_PRICE_WEEKLY_GLOBAL"),
        "monthly": os.getenv("POLAR_PRICE_MONTHLY_GLOBAL"),
        "yearly":  os.getenv("POLAR_PRICE_YEARLY_GLOBAL"),
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
                razorpay_subscription_id: str = None,
                polar_subscription_id: str = None,
                provider: str = "razorpay") -> None:
    """Grant or extend Pro access by *days* from now (or from existing pro_until)."""
    base = max(user.pro_until or datetime.utcnow(), datetime.utcnow())
    user.pro_until = base + timedelta(days=days)
    user.plan_provider = provider
    if provider == "razorpay" and razorpay_subscription_id:
        user.razorpay_subscription_id = razorpay_subscription_id
    elif provider == "polar" and polar_subscription_id:
        user.polar_subscription_id = polar_subscription_id
    db.commit()


def _require_polar():
    access_token = os.getenv("POLAR_ACCESS_TOKEN")
    if not access_token:
        raise HTTPException(status_code=503, detail={"error": "payment_not_configured"})
    from polar_sdk import Polar
    return Polar(access_token=access_token)


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


@router.post("/api/billing/razorpay/cancel")
async def razorpay_cancel(request: Request):
    """Cancel the user's active Razorpay subscription at end of current billing cycle."""
    client = _require_razorpay()
    db, user = _get_db_and_user(request)
    try:
        if not user.razorpay_subscription_id:
            raise HTTPException(status_code=400, detail="No active subscription to cancel")
        sub_id = user.razorpay_subscription_id
        client.subscription.cancel(sub_id, {"cancel_at_cycle_end": True})
        user.razorpay_subscription_id = None
        db.commit()
        return {
            "success": True,
            "access_until": user.pro_until.isoformat() if user.pro_until else None,
        }
    finally:
        db.close()


@router.post("/api/billing/razorpay/webhook")
async def razorpay_webhook(request: Request):
    webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")
    if not webhook_secret:
        # Misconfiguration on our side — Razorpay treats the resulting non-2xx as a
        # delivery failure and deactivates the webhook after 24h. Log loudly so it's
        # obvious in the server logs that the env var is the culprit.
        logger.error(
            "Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set in this "
            "environment — set it (matching the secret on the Razorpay dashboard webhook) "
            "and re-enable the webhook."
        )
        raise HTTPException(status_code=503, detail={"error": "payment_not_configured"})

    payload = await request.body()
    sig_header = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig_header):
        # Almost always means the secret in this env != the secret on the dashboard
        # webhook (or a proxy stripped the header). Log non-sensitive diagnostics:
        # never the secret or the actual signature values.
        logger.warning(
            "Razorpay webhook signature mismatch (header_present=%s, header_len=%d, body_len=%d) "
            "— check RAZORPAY_WEBHOOK_SECRET matches the dashboard webhook secret.",
            bool(sig_header), len(sig_header), len(payload),
        )
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

        elif event_type == "subscription.cancelled":
            sub_entity = event.get("payload", {}).get("subscription", {}).get("entity", {})
            sub_id = sub_entity.get("id")
            if sub_id:
                user = db.query(User).filter_by(razorpay_subscription_id=sub_id).first()
                if user:
                    user.razorpay_subscription_id = None
                    db.commit()

    except Exception as exc:
        logger.exception("Error processing Razorpay webhook: %s", exc)
    finally:
        db.close()

    return {"received": True}


# ── Polar routes (LIC + Global USD) ──────────────────────────────────────────

class PolarCheckoutRequest(BaseModel):
    plan: str  # "weekly" | "monthly" | "yearly"


@router.post("/api/billing/polar/checkout")
async def polar_checkout(body: PolarCheckoutRequest, request: Request):
    """Create a Polar hosted checkout session and return the redirect URL."""
    if body.plan not in PLAN_DURATIONS:
        raise HTTPException(status_code=400, detail="Invalid plan")

    polar = _require_polar()
    db, user = _get_db_and_user(request)
    try:
        region = _get_region(request)
        if region == "india":
            raise HTTPException(status_code=400, detail="India region uses Razorpay")

        price_id = POLAR_PRICES.get(region, {}).get(body.plan)
        if not price_id:
            raise HTTPException(
                status_code=503,
                detail={"error": "payment_not_configured",
                        "msg": f"No Polar price ID configured for {region}/{body.plan}"}
            )

        app_base = os.getenv("APP_BASE_URL", "").rstrip("/")
        success_url = f"{app_base}/dashboard?upgrade=success"

        from polar_sdk.models import CheckoutCreate
        checkout = polar.checkouts.create(
            request=CheckoutCreate(
                products=[price_id],
                customer_email=user.email,
                customer_name=user.name,
                metadata={
                    "user_id": str(user.id),
                    "plan": body.plan,
                    "region": region,
                },
                success_url=success_url,
            )
        )
        return {"checkout_url": checkout.url}
    finally:
        db.close()


@router.post("/api/billing/polar/cancel")
async def polar_cancel(request: Request):
    """Cancel the user's active Polar subscription (revokes at period end)."""
    from polar_sdk.models import ResourceNotFound as PolarResourceNotFound
    polar = _require_polar()
    db, user = _get_db_and_user(request)
    try:
        if not user.polar_subscription_id:
            raise HTTPException(status_code=400, detail="No active Polar subscription to cancel")
        try:
            polar.subscriptions.revoke(id=user.polar_subscription_id)
        except PolarResourceNotFound:
            # Subscription no longer exists on Polar (already cancelled or expired).
            # Clear our stale reference so the user is unblocked.
            logger.warning("Polar subscription %s not found during cancel — clearing stale ID", user.polar_subscription_id)
        user.polar_subscription_id = None
        db.commit()
        return {
            "success": True,
            "access_until": user.pro_until.isoformat() if user.pro_until else None,
        }
    finally:
        db.close()


@router.post("/api/billing/polar/webhook")
async def polar_webhook(request: Request):
    """Process Polar webhook events to grant/revoke Pro access."""
    webhook_secret = os.getenv("POLAR_WEBHOOK_SECRET")
    if not webhook_secret:
        raise HTTPException(status_code=503, detail={"error": "payment_not_configured"})

    payload = await request.body()
    headers = dict(request.headers)

    try:
        from polar_sdk.webhooks import validate_event
        event = validate_event(payload, headers, webhook_secret)
    except Exception:
        logger.warning("Polar webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid signature")

    from database import SessionLocal
    from models import User
    from polar_sdk.models import (
        WebhookOrderPaidPayload,
        WebhookSubscriptionCreatedPayload,
        WebhookSubscriptionUpdatedPayload,
        WebhookSubscriptionActivePayload,
        WebhookSubscriptionRevokedPayload,
    )

    db: Session = SessionLocal()
    try:
        if isinstance(event, WebhookOrderPaidPayload):
            # One-time purchase (weekly plan)
            order = event.data
            metadata = order.metadata or {}
            user_id = metadata.get("user_id")
            plan = metadata.get("plan", "weekly")

            user = None
            if user_id:
                try:
                    user = db.query(User).filter_by(id=int(user_id)).first()
                except (ValueError, TypeError):
                    pass
            if user:
                days = PLAN_DURATIONS.get(plan, 7)
                _extend_pro(db, user, days, polar_subscription_id=str(order.id), provider="polar")

        elif isinstance(event, (WebhookSubscriptionCreatedPayload,
                                WebhookSubscriptionUpdatedPayload,
                                WebhookSubscriptionActivePayload)):
            sub = event.data
            metadata = sub.metadata or {}
            user_id = metadata.get("user_id")
            sub_id = str(sub.id)

            # Derive plan from metadata; fall back to recurring_interval
            plan = metadata.get("plan")
            if not plan:
                interval = str(getattr(sub, "recurring_interval", "month"))
                plan = "yearly" if "year" in interval else "monthly"

            user = None
            if user_id:
                try:
                    user = db.query(User).filter_by(id=int(user_id)).first()
                except (ValueError, TypeError):
                    pass
            if not user and sub_id:
                user = db.query(User).filter_by(polar_subscription_id=sub_id).first()

            # sub.status is a SubscriptionStatus enum — compare .value not str()
            if user and sub.status.value == "active":
                days = PLAN_DURATIONS.get(plan, 31)
                _extend_pro(db, user, days, polar_subscription_id=sub_id, provider="polar")

        elif isinstance(event, WebhookSubscriptionRevokedPayload):
            sub = event.data
            sub_id = str(sub.id)
            user = db.query(User).filter_by(polar_subscription_id=sub_id).first()
            if user:
                user.polar_subscription_id = None
                db.commit()

    except Exception as exc:
        logger.exception("Error processing Polar webhook: %s", exc)
    finally:
        db.close()

    return {"received": True}
