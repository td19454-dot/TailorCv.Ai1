import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


VALID_WOULD_PAY = {
    "Yes",
    "No — too expensive",
    "No — I use ChatGPT instead",
    "No — it doesn't help me",
    "No — I didn't trust the results",
    "No — I only needed it once",
    "Other",
}

# ?reason= slugs from email campaign links -> the closest "Would you pay" option.
REASON_QUERY_MAP = {
    "price": "No — too expensive",
    "chatgpt": "No — I use ChatGPT instead",
    "features": "No — it doesn't help me",
    "trust": "No — I didn't trust the results",
    "once": "No — I only needed it once",
    "other": "Other",
}


@router.get("/feedback", response_class=HTMLResponse)
async def feedback_page(request: Request, reason: str = ""):
    campaign_reason = reason.strip().lower()
    return templates.TemplateResponse(
        request,
        "feedback.html",
        {
            "request": request,
            "prefill_would_pay": REASON_QUERY_MAP.get(campaign_reason, ""),
            "campaign_reason": campaign_reason,
        },
    )


class FeedbackSaveRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)
    time_saved_rating: Optional[int] = Field(default=None, ge=1, le=5)
    workflow_likelihood_rating: Optional[int] = Field(default=None, ge=1, le=5)
    would_pay: Optional[str] = Field(default=None, max_length=60)
    shutdown_impact_rating: Optional[int] = Field(default=None, ge=1, le=5)
    nps_score: Optional[int] = Field(default=None, ge=1, le=10)
    additional_feedback: Optional[str] = Field(default=None, max_length=2000)
    campaign_reason: str = Field(default="", max_length=30)
    finalize: bool = False


REQUIRED_FIELDS = (
    "time_saved_rating",
    "workflow_likelihood_rating",
    "would_pay",
    "shutdown_impact_rating",
    "nps_score",
)


@router.post("/api/feedback")
async def save_feedback(body: FeedbackSaveRequest, request: Request):
    """Upsert by session_id — fired silently on every answer click (finalize=false)
    so partial/abandoned responses are still captured, and once more when the
    user hits Submit (finalize=true) to mark the row complete."""
    from database import SessionLocal
    from models import FeedbackSubmission, User

    if body.would_pay is not None and body.would_pay not in VALID_WOULD_PAY:
        raise HTTPException(status_code=400, detail="Please select a valid option for the paying question.")

    session_id = body.session_id.strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id.")

    user_id = request.session.get("user_id")
    db = SessionLocal()
    try:
        email = None
        if user_id:
            user = db.query(User).filter_by(id=user_id).first()
            if user:
                email = user.email
            else:
                user_id = None

        row = db.query(FeedbackSubmission).filter_by(session_id=session_id).first()
        if row is None:
            row = FeedbackSubmission(
                session_id=session_id,
                user_id=user_id,
                email=email,
                campaign_reason=body.campaign_reason.strip().lower() or None,
                referrer=(request.headers.get("referer", "") or "")[:500] or None,
                user_agent=(request.headers.get("user-agent", "") or "")[:500] or None,
                ip_address=_client_ip(request),
                created_at=datetime.utcnow(),
            )
            db.add(row)
        elif user_id and row.user_id != user_id:
            # Attribution can improve mid-survey (e.g. they log in partway through).
            row.user_id = user_id
            row.email = email

        if body.time_saved_rating is not None:
            row.time_saved_rating = body.time_saved_rating
        if body.workflow_likelihood_rating is not None:
            row.workflow_likelihood_rating = body.workflow_likelihood_rating
        if body.would_pay is not None:
            row.would_pay = body.would_pay
        if body.shutdown_impact_rating is not None:
            row.shutdown_impact_rating = body.shutdown_impact_rating
        if body.nps_score is not None:
            row.nps_score = body.nps_score
        if body.additional_feedback is not None:
            row.additional_feedback = body.additional_feedback.strip() or None

        row.updated_at = datetime.utcnow()

        if body.finalize:
            missing = [f for f in REQUIRED_FIELDS if getattr(row, f) is None]
            if missing:
                raise HTTPException(status_code=400, detail="Please answer all required questions before submitting.")
            row.completed_at = datetime.utcnow()

        db.commit()
        return {"success": True, "completed": bool(row.completed_at)}
    finally:
        db.close()
