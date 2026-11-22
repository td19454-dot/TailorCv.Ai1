import hmac
import json
import logging
import os
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response
from sqlalchemy.exc import IntegrityError

import database
from email_suppression import base_url, read_track_token, read_unsubscribe_campaign, read_unsubscribe_token
from models import MarketingEvent, User

router = APIRouter()
logger = logging.getLogger(__name__)

# 1x1 transparent GIF for the open pixel.
_PIXEL = bytes.fromhex("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b")
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}


def _record(db, campaign: str, user_id: int, kind: str, url: str = "") -> None:
    """Store a campaign event. A duplicate (already counted) is a no-op."""
    db.add(MarketingEvent(campaign=campaign, user_id=user_id, kind=kind, url=url))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def _track(token: str, kinds: tuple[str, ...]):
    """Record events for a tracking token. Returns its payload, or None if forged.
    Never raises: a DB hiccup must not break the redirect or the pixel."""
    payload = read_track_token(token)
    if payload is None:
        return None
    campaign, user_id, url = payload
    db = database.SessionLocal()
    try:
        for kind in kinds:
            _record(db, campaign, user_id, kind, url if kind == "click" else "")
    except Exception:
        logger.warning("Could not record %s for campaign %s", kinds, campaign, exc_info=True)
    finally:
        db.close()
    return payload


@router.get("/e/o/{token}.gif")
async def track_open(token: str):
    _track(token, ("open",))
    return Response(content=_PIXEL, media_type="image/gif", headers=_NO_STORE)


@router.get("/e/c/{token}")
async def track_click(token: str):
    # A click also counts as an open: readers with images off never load the pixel.
    payload = _track(token, ("open", "click"))
    destination = payload[2] if payload and payload[2] else base_url()
    return RedirectResponse(destination, status_code=302, headers=_NO_STORE)


def _opt_out(token: str) -> None:
    user_id = read_unsubscribe_token(token)
    if user_id is None:
        raise HTTPException(status_code=400, detail="Invalid or expired unsubscribe link.")

    db = database.SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user and not user.marketing_opt_out:
            user.marketing_opt_out = True
            db.commit()
            campaign = read_unsubscribe_campaign(token)
            if campaign:
                _record(db, campaign, user_id, "unsubscribe")
    finally:
        db.close()


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str = ""):
    """Public, no-login unsubscribe target for marketing_email.py campaigns.
    Never touches transactional mail or requires a session."""
    _opt_out(token)
    return HTMLResponse(
        "<html><body style=\"font-family:sans-serif;max-width:480px;margin:80px auto;"
        "text-align:center;color:#222\">"
        "<h2>You're unsubscribed</h2>"
        "<p>You won't receive further marketing emails from TailorCV. "
        "Account emails (password resets, receipts, etc.) are unaffected.</p>"
        "</body></html>"
    )


@router.post("/unsubscribe")
async def unsubscribe_one_click(token: str = ""):
    """RFC 8058 one-click: the "Unsubscribe" button Gmail/Yahoo show next to the
    sender POSTs `List-Unsubscribe=One-Click` to the List-Unsubscribe URL, with
    the token still in its query string. Without this route that button 405s."""
    _opt_out(token)
    return PlainTextResponse("unsubscribed")


@router.post("/webhooks/ses-events")
async def ses_events(request: Request, secret: str = ""):
    """SNS delivery target for the SES Configuration Set's bounce/complaint topic.
    Auth is a shared secret in the subscription URL's query string rather than
    full SNS message-signature verification — simple to stand up, sufficient as
    long as the URL (with its secret) isn't leaked. Configure the HTTPS
    subscription in the SNS console as:
        https://<host>/webhooks/ses-events?secret=<SES_WEBHOOK_SECRET>
    """
    expected = os.getenv("SES_WEBHOOK_SECRET", "").strip()
    if not expected or not hmac.compare_digest(secret, expected):
        raise HTTPException(status_code=404)

    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    msg_type = request.headers.get("x-amz-sns-message-type", body.get("Type", ""))

    if msg_type == "SubscriptionConfirmation":
        subscribe_url = body.get("SubscribeURL")
        if subscribe_url:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.get(subscribe_url)
            logger.info("Confirmed SES/SNS webhook subscription.")
        return PlainTextResponse("ok")

    if msg_type != "Notification":
        return PlainTextResponse("ignored")

    try:
        message = json.loads(body.get("Message", "{}"))
    except ValueError:
        return PlainTextResponse("ignored")

    notification_type = message.get("notificationType") or message.get("eventType")
    recipients = []
    field = None
    if notification_type == "Bounce":
        bounce = message.get("bounce", {})
        # Only permanent (hard) bounces suppress — transient bounces are retried
        # by SES itself and don't mean the address is dead.
        if bounce.get("bounceType") == "Permanent":
            recipients = [r.get("emailAddress") for r in bounce.get("bouncedRecipients", [])]
        field = "email_bounced_at"
    elif notification_type == "Complaint":
        complaint = message.get("complaint", {})
        recipients = [r.get("emailAddress") for r in complaint.get("complainedRecipients", [])]
        field = "email_complained_at"
    else:
        return PlainTextResponse("ignored")

    recipients = [r.lower() for r in recipients if r]
    if not recipients or field is None:
        return PlainTextResponse("ok")

    db = database.SessionLocal()
    try:
        now = datetime.utcnow()
        for email in recipients:
            user = db.query(User).filter(User.email == email).first()
            if user:
                setattr(user, field, now)
        db.commit()
    finally:
        db.close()
    return PlainTextResponse("ok")
