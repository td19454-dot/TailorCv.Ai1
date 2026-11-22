"""Local-only admin UI for marketing campaigns: /admin/email.

The same thing as marketing_email.py, with an editor and buttons. It is never
deployed: main.py registers this router only when ENABLE_EMAIL_ADMIN=1 and
ENVIRONMENT isn't production, and every route also rejects non-loopback
clients and non-localhost Host headers (the latter stops a web page you have
open from reaching it through DNS rebinding). Whoever reaches this page can
mail every user from our SES domain, so it must not exist on the internet.

Run it on your laptop with DATABASE_URL and SECRET_KEY set to production's
values, exactly as for marketing_email.py. Campaigns are saved as files in
marketing/templates/, so the CLI can send them too and they live in git.
"""
import json
import logging
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from jinja2 import TemplateError
from pydantic import BaseModel, Field
from sqlalchemy import distinct, func

from database import DATABASE_URL, SessionLocal, engine
from email_service import smtp_session
from email_suppression import unsubscribe_url
from marketing.render import (
    build_campaign, inner_body, list_campaigns, load_campaign, render, save_campaign, template_vars,
)
from marketing.segments import SEGMENTS, recipients
from marketing.sender import build_campaign_message, preflight, send_campaign, sender_address
from models import MarketingEvent, MarketingSend

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
# Campaign, segment and count per send; no addresses. Gitignored with the previews.
AUDIT_LOG = BASE_DIR / "marketing" / "previews" / "send_history.jsonl"

_LOOPBACK_IPS = {"127.0.0.1", "::1"}
_LOCAL_HOSTNAMES = {"127.0.0.1", "localhost", "[::1]"}
# Who the preview is rendered as. Test sends use a real recipient instead.
_SAMPLE_USER = SimpleNamespace(id=0, name="Shubham Sarkar", email="shubham.sarkar@example.com")


def _local_only(request: Request) -> None:
    client_ip = request.client.host if request.client else ""
    hostname = (request.headers.get("host") or "").rsplit(":", 1)[0].lower()
    if (client_ip not in _LOOPBACK_IPS or hostname not in _LOCAL_HOSTNAMES
            or os.getenv("ENVIRONMENT", "").lower() == "production"):
        raise HTTPException(status_code=404)


router = APIRouter(prefix="/admin/email", dependencies=[Depends(_local_only)])

# One send at a time. The app runs as a single local process, so in-memory is enough.
_jobs: dict[str, dict] = {}
_send_lock = threading.Lock()


class CampaignIn(BaseModel):
    name: str = Field(max_length=80)
    subject: str = Field(max_length=255)
    preheader: str = Field(default="", max_length=255)
    body: str = Field(default="", max_length=200_000)


class AudienceIn(BaseModel):
    campaign: str = Field(max_length=80)
    segment: str
    exclude: list[str] = []
    min_gap_days: int = Field(default=7, ge=0, le=365)


class TestIn(BaseModel):
    campaign: CampaignIn
    audience: AudienceIn
    to: str = Field(min_length=3, max_length=255)


class SendIn(BaseModel):
    audience: AudienceIn
    confirm_count: int


def _campaign(data: CampaignIn):
    try:
        return build_campaign(data.name, data.subject, data.preheader, data.body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _recipients(db, audience: AudienceIn, limit: int | None = None):
    try:
        return recipients(db, audience.segment, campaign=audience.campaign, exclude=tuple(audience.exclude),
                          min_gap_days=audience.min_gap_days, limit=limit, now=datetime.utcnow())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _segment_info() -> list[dict]:
    return [{"name": name, "description": (fn.__doc__ or "").strip().splitlines()[0]}
            for name, fn in SEGMENTS.items()]


@router.get("", response_class=HTMLResponse)
def admin_email_page(request: Request):
    MarketingSend.__table__.create(bind=engine, checkfirst=True)
    MarketingEvent.__table__.create(bind=engine, checkfirst=True)
    context = {
        "segments": _segment_info(),
        "campaigns": list_campaigns(),
        "database": engine.url.host or engine.url.database,
        "is_sqlite": DATABASE_URL.startswith("sqlite"),
        "sender": sender_address(),
        "problems": preflight(),
        "has_mailing_address": bool(os.getenv("COMPANY_MAILING_ADDRESS", "").strip()),
    }
    return templates.TemplateResponse(request, "admin_email.html", {"request": request, "boot": context})


@router.get("/api/campaigns/{name}")
def get_campaign(name: str):
    try:
        campaign = load_campaign(name)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"name": campaign.name, "subject": campaign.subject,
            "preheader": campaign.preheader, "body": inner_body(campaign)}


@router.post("/api/campaigns")
def save(data: CampaignIn):
    campaign = _campaign(data)
    try:
        render(campaign, template_vars(_SAMPLE_USER, campaign, unsubscribe_url(0)))
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=f"Template error: {exc}")
    save_campaign(campaign)
    return {"saved": campaign.name, "campaigns": list_campaigns()}


@router.post("/api/preview")
def preview(data: CampaignIn):
    campaign = _campaign(data)
    try:
        subject, html = render(campaign, template_vars(_SAMPLE_USER, campaign, unsubscribe_url(0)))
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=f"Template error: {exc}")
    return {"subject": subject, "html": html}


@router.post("/api/audience")
def audience(data: AudienceIn):
    db = SessionLocal()
    try:
        users = _recipients(db, data)
        already = db.query(MarketingSend).filter(MarketingSend.campaign == data.campaign).count()
        return {"count": len(users), "sample": [u.email for u in users[:10]], "already_sent": already}
    finally:
        db.close()


@router.post("/api/test")
def test_send(data: TestIn):
    problems = preflight()
    if problems:
        raise HTTPException(status_code=400, detail=" ".join(problems))
    campaign = _campaign(data.campaign)
    db = SessionLocal()
    try:
        # Rendered as a real recipient, as the CLI's --test-to does, so their
        # name and data are what you check. Nothing is logged.
        users = _recipients(db, data.audience, limit=1)
        as_user = users[0] if users else _SAMPLE_USER
        try:
            message = build_campaign_message(campaign, as_user, sender_address(), to_email=data.to.strip())
        except TemplateError as exc:
            raise HTTPException(status_code=400, detail=f"Template error: {exc}")
        with smtp_session() as smtp:
            smtp.send_message(message)
        return {"sent_to": data.to.strip(), "rendered_as": as_user.email}
    finally:
        db.close()


def _audit(entry: dict) -> None:
    try:
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")
    except OSError:
        logger.warning("Could not write %s", AUDIT_LOG, exc_info=True)


def _run_send(job: dict, campaign, data: AudienceIn) -> None:
    db = SessionLocal()
    try:
        users = _recipients(db, data)
        job["total"] = len(users)
        rate = float(os.getenv("MARKETING_SEND_RATE", "5") or 5)
        result = send_campaign(db, campaign, users, sender_address(), rate_per_second=rate,
                               progress=lambda msg: job["log"].append(msg.strip()))
        job.update(status="done", sent=result.sent, failed=result.failed, skipped=result.skipped)
    except Exception as exc:
        logger.exception("Campaign %s send crashed", campaign.name)
        job.update(status="error", error=str(exc))
    finally:
        db.close()
        job["finished_at"] = datetime.utcnow().isoformat()
        _audit({k: job[k] for k in ("id", "campaign", "segment", "exclude", "min_gap_days", "total",
                                    "sent", "failed", "skipped", "status", "error", "started_at", "finished_at")})
        _send_lock.release()


@router.post("/api/send")
def send(data: SendIn):
    problems = preflight()
    if problems:
        raise HTTPException(status_code=400, detail=" ".join(problems))
    # Sends the saved file, so what went out is what's in git.
    try:
        campaign = load_campaign(data.audience.campaign)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Save the campaign first. {exc}")

    if not _send_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another send is still running.")
    try:
        db = SessionLocal()
        try:
            count = len(_recipients(db, data.audience))
        finally:
            db.close()
        if count != data.confirm_count:
            raise HTTPException(status_code=409, detail=(
                f"The audience is now {count} people, not {data.confirm_count}. Check it again before sending."))
        if count == 0:
            raise HTTPException(status_code=400, detail="Nobody to send to.")
    except BaseException:
        _send_lock.release()
        raise

    job = {
        "id": uuid.uuid4().hex[:12], "status": "running", "campaign": campaign.name,
        "segment": data.audience.segment, "exclude": data.audience.exclude,
        "min_gap_days": data.audience.min_gap_days, "total": count,
        "sent": 0, "failed": 0, "skipped": 0, "error": None, "log": [],
        "started_at": datetime.utcnow().isoformat(), "finished_at": None,
    }
    _jobs[job["id"]] = job
    threading.Thread(target=_run_send, args=(job, campaign, data.audience), daemon=True).start()
    return {"job": job["id"]}


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def campaign_stats(db) -> list[dict]:
    """Per campaign: sends, unique opens/clicks/unsubscribes and their rates, newest first."""
    sends = (db.query(MarketingSend.campaign, func.count(MarketingSend.id),
                      func.min(MarketingSend.sent_at), func.max(MarketingSend.sent_at))
             .group_by(MarketingSend.campaign).all())
    events = (db.query(MarketingEvent.campaign, MarketingEvent.kind,
                       func.count(distinct(MarketingEvent.user_id)))
              .group_by(MarketingEvent.campaign, MarketingEvent.kind).all())
    counts: dict[str, dict[str, int]] = {}
    for campaign, kind, n in events:
        counts.setdefault(campaign, {})[kind] = n

    rows = []
    for campaign, sent, first, last in sends:
        c = counts.get(campaign, {})
        opens, clicks, unsubs = c.get("open", 0), c.get("click", 0), c.get("unsubscribe", 0)
        rows.append({
            "campaign": campaign, "sent": sent,
            "first_sent": first.isoformat() if first else None,
            "last_sent": last.isoformat() if last else None,
            "opens": opens, "clicks": clicks, "unsubscribes": unsubs,
            "open_rate": _rate(opens, sent), "ctr": _rate(clicks, sent),
            "click_to_open": _rate(clicks, opens), "unsub_rate": _rate(unsubs, sent),
            # Sent before tracking shipped: zeros here mean "unknown", not "nobody".
            "tracked": bool(c),
        })
    rows.sort(key=lambda r: r["last_sent"] or "", reverse=True)
    return rows


def campaign_links(db, campaign: str) -> list[dict]:
    rows = (db.query(MarketingEvent.url, func.count(distinct(MarketingEvent.user_id)))
            .filter(MarketingEvent.campaign == campaign, MarketingEvent.kind == "click")
            .group_by(MarketingEvent.url).all())
    return sorted(({"url": url, "clicks": n} for url, n in rows), key=lambda r: -r["clicks"])


@router.get("/api/stats")
def stats():
    db = SessionLocal()
    try:
        return {"campaigns": campaign_stats(db)}
    finally:
        db.close()


@router.get("/api/stats/{campaign}")
def stats_links(campaign: str):
    db = SessionLocal()
    try:
        return {"campaign": campaign, "links": campaign_links(db, campaign)}
    finally:
        db.close()


@router.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job.")
    out = {k: v for k, v in job.items() if k != "log"}
    out["log"] = job["log"][-20:]
    if job["status"] == "running":
        # send_campaign commits a claim row per recipient, so the log table is
        # the live progress counter.
        db = SessionLocal()
        try:
            out["sent"] = db.query(MarketingSend).filter(
                MarketingSend.campaign == job["campaign"],
                MarketingSend.sent_at >= datetime.fromisoformat(job["started_at"]),
            ).count()
        finally:
            db.close()
    return out
