import hmac
import json
import logging
import os
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse

from database import SessionLocal
from email_suppression import read_unsubscribe_token
from models import User

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str = ""):
    """Public, no-login one-click unsubscribe target for SES marketing campaigns.
    Never touches transactional mail (sent via Resend) or requires a session."""
    user_id = read_unsubscribe_token(token)
    if user_id is None:
        raise HTTPException(status_code=400, detail="Invalid or expired unsubscribe link.")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user and not user.marketing_opt_out:
            user.marketing_opt_out = True
            db.commit()
    finally:
        db.close()

    return HTMLResponse(
        "<html><body style=\"font-family:sans-serif;max-width:480px;margin:80px auto;"
        "text-align:center;color:#222\">"
        "<h2>You're unsubscribed</h2>"
        "<p>You won't receive further marketing emails from TailorCV. "
        "Account emails (password resets, receipts, etc.) are unaffected.</p>"
        "</body></html>"
    )


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

    db = SessionLocal()
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
