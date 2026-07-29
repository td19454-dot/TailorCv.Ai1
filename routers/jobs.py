"""TailorCV Gigs — public board for verified freelance / AI-training gigs.

- GET /gigs                board of verified, active, currently-open gigs, with
                           optional per-user capacity matching for signed-in users.
- GET /gigs/{slug}         gig detail + external apply link + resume/interview CTAs.
- POST /api/admin/jobs/ingest  token-gated ingestion trigger (cron/manual).
"""

from __future__ import annotations

import os
import json
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from database import SessionLocal
from models import JobListing, User
from extraction import extract_text_from_pdf
from functions import compute_skill_match_score
from jobs_ingest import ingest_all

logger = logging.getLogger(__name__)
router = APIRouter()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

PER_PAGE = 18
INGEST_TOKEN = os.getenv("JOBS_INGEST_TOKEN", "")


def _match_label(score: int | None) -> tuple[str, bool]:
    """Map a 0–100 skill-match score to a human label + eligibility flag."""
    if score is None:
        return "", False
    if score >= 75:
        return "Strong match", True
    if score >= 45:
        return "Eligible now", True
    return "Stretch", False


def _gig_jd(row: JobListing) -> str:
    """Treat a gig's requirements as a 'job description' for the match engine."""
    try:
        skills = json.loads(row.required_skills or "[]")
    except Exception:
        skills = []
    return " ".join(filter(None, [", ".join(skills), row.title or "", row.description or ""]))


def _user_resume_text(db, user_id: int | None) -> str:
    """Extract the signed-in user's base-resume text once per request for matching.
    Returns '' if there's no usable resume (matching is then skipped)."""
    if not user_id:
        return ""
    user = db.query(User).filter_by(id=user_id).first()
    path = getattr(user, "base_resume_path", None) if user else None
    if not path or not os.path.exists(path):
        return ""
    try:
        return (extract_text_from_pdf(path) or "").strip()
    except Exception:
        logger.exception("Failed to read base resume for gig matching")
        return ""


def _to_card(row: JobListing, resume_text: str) -> dict:
    try:
        tags = json.loads(row.tags or "[]")
    except Exception:
        tags = []
    card = {
        "slug": row.slug, "title": row.title, "company": row.company,
        "source": row.source, "category": row.category, "tags": tags,
        "pay_text": row.pay_text, "location": row.location, "is_remote": row.is_remote,
        "accepting_now": row.accepting_now, "verification_note": row.verification_note,
        "match_score": None, "match_label": "", "eligible": False,
    }
    if resume_text:
        try:
            result = compute_skill_match_score(resume_text, _gig_jd(row))
            score = result.get("score")
            label, eligible = _match_label(score)
            card.update(match_score=score, match_label=label, eligible=eligible)
        except Exception:
            logger.exception("Gig match scoring failed for %s", row.slug)
    return card


@router.get("/gigs", response_class=HTMLResponse)
async def gigs_board(request: Request, q: str = "", source: str = "", category: str = "",
                     remote: str = "", view: str = "", page: int = 1):
    db = SessionLocal()
    try:
        user_id = request.session.get("user_id")
        is_logged_in = bool(user_id)

        query = db.query(JobListing).filter(
            JobListing.is_verified == True,      # noqa: E712
            JobListing.is_active == True,        # noqa: E712
            JobListing.accepting_now == True,    # noqa: E712
        )
        if source:
            query = query.filter(JobListing.source == source)
        if category:
            query = query.filter(JobListing.category == category)
        if remote in ("1", "true", "yes"):
            query = query.filter(JobListing.is_remote == True)  # noqa: E712
        if q:
            like = f"%{q.strip()}%"
            query = query.filter(
                (JobListing.title.ilike(like)) | (JobListing.description.ilike(like))
                | (JobListing.company.ilike(like))
            )

        rows = query.order_by(JobListing.last_seen_at.desc()).all()

        # Distinct filter options from the visible set.
        all_sources = sorted({r.source for r in db.query(JobListing.source)
                              .filter(JobListing.is_verified == True, JobListing.is_active == True).all()})  # noqa: E712
        all_categories = sorted({c for (c,) in db.query(JobListing.category)
                                .filter(JobListing.is_verified == True, JobListing.is_active == True).all() if c})  # noqa: E712

        resume_text = _user_resume_text(db, user_id)
        cards = [_to_card(r, resume_text) for r in rows]

        matched_view = view == "matched"
        has_resume = bool(resume_text)
        if matched_view and has_resume:
            cards = [c for c in cards if c["eligible"]]
        # Sort by match when we can; otherwise recency (already ordered).
        if has_resume:
            cards.sort(key=lambda c: (c["match_score"] is None, -(c["match_score"] or 0)))

        total = len(cards)
        page = max(1, page)
        start = (page - 1) * PER_PAGE
        page_cards = cards[start:start + PER_PAGE]
        total_pages = max(1, (total + PER_PAGE - 1) // PER_PAGE)

        return templates.TemplateResponse(request, "gigs.html", {
            "request": request, "is_logged_in": is_logged_in,
            "gigs": page_cards, "total": total, "page": page, "total_pages": total_pages,
            "sources": all_sources, "categories": all_categories,
            "q": q, "sel_source": source, "sel_category": category, "sel_remote": remote,
            "matched_view": matched_view, "has_resume": has_resume,
        })
    finally:
        db.close()


@router.get("/gigs/{slug}", response_class=HTMLResponse)
async def gig_detail(request: Request, slug: str):
    db = SessionLocal()
    try:
        row = db.query(JobListing).filter(JobListing.slug == slug,
                                          JobListing.is_active == True).first()  # noqa: E712
        if not row or not row.is_verified:
            raise HTTPException(status_code=404, detail="Gig not found")
        user_id = request.session.get("user_id")
        resume_text = _user_resume_text(db, user_id)
        card = _to_card(row, resume_text)
        card["description"] = row.description
        card["apply_url"] = row.apply_url
        card["min_experience"] = row.min_experience
        try:
            card["required_skills"] = json.loads(row.required_skills or "[]")
        except Exception:
            card["required_skills"] = []
        return templates.TemplateResponse(request, "gig_detail.html", {
            "request": request, "is_logged_in": bool(user_id),
            "gig": card, "has_resume": bool(resume_text),
        })
    finally:
        db.close()


@router.post("/api/admin/jobs/ingest")
async def admin_ingest(token: str = ""):
    """Trigger gig ingestion. Gated by the JOBS_INGEST_TOKEN env secret so only an
    authorised cron/admin can run it."""
    if not INGEST_TOKEN or token != INGEST_TOKEN:
        raise HTTPException(status_code=403, detail="Forbidden")
    summary = await ingest_all()
    return {"ok": True, "summary": summary}
