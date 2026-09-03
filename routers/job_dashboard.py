"""Job Dashboard — general job search (JSearch/RapidAPI) with per-user resume
match scoring, save/apply tracking. Kept separate from routers/jobs.py (the
dormant Gigs board) even though both cache into the same JobListing table, so
re-enabling one never re-enables the other.

- GET  /dashboard/jobs           the dashboard page
- GET  /api/dashboard/jobs       jobs for the current user, with matchScore
- POST /api/saved-jobs           bookmark a job
- GET  /api/saved-jobs           list bookmarked jobs (Saved tab)
- DELETE /api/saved-jobs/{id}    remove a bookmark
- POST /api/dashboard/applications   log an apply click (manual|auto)
- GET  /api/apply-profile        the user's stored application answers
- POST /api/apply-profile        save them (incl. auto-apply consent)
- POST /api/dashboard/auto-apply           enqueue a real auto-apply run (202)
- GET  /api/dashboard/auto-apply/status    latest run per job, for page load
- GET  /api/dashboard/auto-apply/{run_id}  poll one run
"""

from __future__ import annotations

import os
import json
import asyncio
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, text

from database import SessionLocal, IS_POSTGRES, sync_embedding_vectors
from models import (
    AutoApplyRun,
    JobBoardApplication,
    JobListing,
    JobSearchQuery,
    JobSearchResult,
    SavedJob,
    User,
    UserApplyProfile,
    UserApplyQA,
)
from extraction import extract_text_from_pdf
from functions import embed_text, embedding_match_score, cosine_similarity, EMBEDDING_MODEL
from job_sources import NormalizedJob, slugify
from job_sources.jsearch import fetch_jsearch
from schemas import ApplyProfileRequest, AutoApplyRequest, RunAnswersRequest, SaveJobRequest, LogApplicationRequest

# Safe at module scope: auto_apply.config is stdlib-only and never imports
# stagehand/playwright, so this router still loads when they aren't installed.
from auto_apply import config as aa_config

logger = logging.getLogger(__name__)
router = APIRouter()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

DEFAULT_QUERY = "software engineer"
PER_PAGE = 12
# JSearch's live aggregation isn't a stable paginated list — repeat calls for
# the same query return a different sample each time (empirically: a call
# asking for more pages returned an almost entirely different job set, not a
# superset). So "load more" means fetching again and appending whatever's
# genuinely new, not asking for a bigger page. This cooldown just stops a
# user rapid-scrolling near the end from triggering a live fetch on every
# single request.
EXPAND_COOLDOWN_MINUTES = 3

# Company ATS boards ingested ahead of time (jobs_ingest.py + job_sources/
# greenhouse.py, lever.py, ashby.py, smartrecruiters.py) — a standing corpus,
# already embedded, that costs nothing to query. Checked first on every
# search; JSearch is only used as a live fallback when this corpus alone
# can't fill the requested page.
ATS_SOURCES = ["greenhouse", "lever", "ashby", "smartrecruiters"]


def _job_snippet(text: str | None, limit: int = 220) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "..."


def _upsert_job_rows(db, jobs: list[NormalizedJob], now: datetime) -> list[JobListing]:
    """DB-only upsert for a whole page of jobs at once (no embedding calls):
    one bulk SELECT for existing rows plus one flush for all inserts/updates,
    instead of a SELECT+flush pair per job. With ~30 jobs per search and a
    remote (Neon) Postgres connection, doing that per-row was 60 sequential
    network round-trips and dominated total request time. Embeddings for
    whichever rows need them are fetched concurrently by the caller after."""
    source_job_ids = [job.source_job_id for job in jobs]
    existing = {}
    if source_job_ids:
        existing_rows = (
            db.query(JobListing)
            .filter(JobListing.source == "jsearch", JobListing.source_job_id.in_(source_job_ids))
            .all()
        )
        existing = {r.source_job_id: r for r in existing_rows}

    rows = []
    for job in jobs:
        row = existing.get(job.source_job_id)
        is_new = row is None
        if row is None:
            row = JobListing(
                source=job.source,
                source_job_id=job.source_job_id,
                slug=slugify(job.title, job.source, job.source_job_id),
            )
            db.add(row)

        # Defensively truncate to each column's max length — JSearch is
        # external data with no length guarantees, and an oversized value must
        # never crash the whole request (see: source_job_id, which hit this).
        row.title = (job.title or "")[:300]
        row.company = (job.company or None) and job.company[:200]
        row.description = job.description
        row.location = (job.location or None) and job.location[:160]
        row.is_remote = bool(job.is_remote)
        row.apply_url = (job.apply_url or "")[:600]
        row.posted_at = job.posted_at
        row.accepting_now = True
        # JSearch aggregates real company postings, not freelance-gig
        # listings, so the Gigs board's verify_legit() allowlist doesn't apply.
        row.is_verified = True
        row.verification_note = "Aggregated via JSearch"
        row.is_active = True
        row.last_seen_at = now
        row.fetched_at = now
        row.tags = row.tags or "[]"
        row.required_skills = row.required_skills or "[]"
        row.needs_embedding = is_new or not row.embedding
        rows.append(row)

    db.flush()
    return rows


async def _embed_rows(db, rows: list[JobListing]) -> None:
    """Fetch embeddings for rows that need one concurrently — sequential
    awaits here would mean up to ~30 OpenAI round-trips back-to-back on a
    cold-cache search, easily blowing past any reasonable request timeout."""
    to_embed = [r for r in rows if getattr(r, "needs_embedding", False)]
    if not to_embed:
        return
    vectors = await asyncio.gather(
        *(embed_text(f"{r.title}\n{r.description or ''}") for r in to_embed),
        return_exceptions=True,
    )
    embedded = []
    for row, vector in zip(to_embed, vectors):
        if isinstance(vector, Exception):
            logger.exception("Failed to embed job listing %s", row.slug)
            continue
        row.embedding = json.dumps(vector)
        row.embedding_model = EMBEDDING_MODEL
        embedded.append(row)
    sync_embedding_vectors(db, embedded)


async def _fetch_and_append(db, query: str, location: str, query_norm: str, location_norm: str) -> None:
    """Fetch from JSearch and append any genuinely new jobs to this search's
    result list — never replaces what's already there. Since JSearch returns
    a different live sample on every call rather than a stable paginated
    list, replacing would shuffle/duplicate jobs a user has already scrolled
    past; appending only what's new keeps earlier pages stable while still
    letting the feed grow as the user scrolls further."""
    now = datetime.utcnow()
    try:
        jobs = await fetch_jsearch(query, location)
    except RuntimeError:
        # RAPIDAPI_KEY not configured yet — degrade to serving whatever is
        # already cached rather than breaking the whole dashboard.
        logger.warning("Skipping JSearch fetch: RAPIDAPI_KEY not configured")
        return

    rows = _upsert_job_rows(db, jobs, now)
    await _embed_rows(db, rows)

    existing_ids = {
        jr.job_listing_id
        for jr in db.query(JobSearchResult.job_listing_id)
        .filter_by(query_norm=query_norm, location_norm=location_norm)
        .all()
    }
    next_rank = (
        db.query(func.max(JobSearchResult.rank))
        .filter_by(query_norm=query_norm, location_norm=location_norm)
        .scalar()
        or 0
    ) + 1
    for row in rows:
        if row.id in existing_ids:
            continue
        db.add(JobSearchResult(query_norm=query_norm, location_norm=location_norm, job_listing_id=row.id, rank=next_rank))
        existing_ids.add(row.id)
        next_rank += 1

    cache_row = db.query(JobSearchQuery).filter_by(query_norm=query_norm, location_norm=location_norm).first()
    if cache_row is None:
        db.add(JobSearchQuery(query_norm=query_norm, location_norm=location_norm, last_fetched_at=now))
    else:
        cache_row.last_fetched_at = now
    db.commit()


async def _user_resume_embedding(db, user: User) -> list[float] | None:
    if not user.base_resume_path or not os.path.exists(user.base_resume_path):
        return None

    resume_text = user.base_resume_text
    if not resume_text:
        try:
            resume_text = await asyncio.to_thread(extract_text_from_pdf, user.base_resume_path)
        except Exception:
            logger.exception("Failed to extract resume text for job dashboard matching")
            return None
        user.base_resume_text = resume_text
        db.commit()
    if not resume_text:
        return None

    if user.base_resume_embedding and user.base_resume_embedding_model == EMBEDDING_MODEL:
        try:
            return json.loads(user.base_resume_embedding)
        except Exception:
            pass

    try:
        vector = await embed_text(resume_text)
    except Exception:
        logger.exception("Failed to embed resume for job dashboard matching")
        return None
    user.base_resume_embedding = json.dumps(vector)
    user.base_resume_embedding_model = EMBEDDING_MODEL
    db.commit()
    return vector


ATS_CANDIDATE_LIMIT = 150


async def _get_or_embed_query(db, cache_row: JobSearchQuery, query: str) -> list[float] | None:
    """Cache the search query's own embedding on its JobSearchQuery row so
    repeated pagination requests for the same search reuse one OpenAI call
    instead of paying for it on every page."""
    if cache_row.embedding:
        try:
            return json.loads(cache_row.embedding)
        except Exception:
            pass
    try:
        vector = await embed_text(query)
    except Exception:
        logger.exception("Failed to embed dashboard search query %r", query)
        return None
    cache_row.embedding = json.dumps(vector)
    db.commit()
    return vector


def _ats_base_query(db, location: str):
    q = db.query(JobListing).filter(
        JobListing.source.in_(ATS_SOURCES),
        JobListing.is_active == True,  # noqa: E712
        JobListing.embedding.isnot(None),
    )
    if location.strip():
        # Loose and optional: our tracked companies only cover the cities
        # they actually have offices in, so a location with no matches here
        # just means none of them do — not a bug, a real coverage limit.
        q = q.filter(JobListing.location.ilike(f"%{location.strip()}%"))
    return q


def _query_ats_candidates_pgvector(db, location: str, query_embedding: list[float]) -> list[JobListing]:
    """Postgres fast path: let the HNSW index on embedding_vec do the nearest-
    neighbor search directly in the database (ORDER BY ... LIMIT), instead of
    pulling every row's embedding into Python. Measured at 30-90s for the
    Python version once the corpus reached ~5,000 rows — this is milliseconds."""
    vec_literal = "[" + ",".join(f"{x:.8f}" for x in query_embedding) + "]"
    sources_sql = ",".join(f"'{s}'" for s in ATS_SOURCES)  # internal constant, not user input
    where_extra = ""
    params: dict = {"qvec": vec_literal, "limit": ATS_CANDIDATE_LIMIT}
    if location.strip():
        where_extra = "AND location ILIKE :loc"
        params["loc"] = f"%{location.strip()}%"
    sql = text(f"""
        SELECT id FROM job_listings
        WHERE source IN ({sources_sql}) AND is_active = true AND embedding_vec IS NOT NULL
        {where_extra}
        ORDER BY embedding_vec <=> CAST(:qvec AS vector)
        LIMIT :limit
    """)
    ids = [row[0] for row in db.execute(sql, params).fetchall()]
    if not ids:
        return []
    rows_by_id = {r.id: r for r in db.query(JobListing).filter(JobListing.id.in_(ids)).all()}
    return [rows_by_id[i] for i in ids if i in rows_by_id]


def _query_ats_candidates_python(db, location: str, query_embedding: list[float] | None) -> list[JobListing]:
    """SQLite fallback (local dev with no DATABASE_URL set — pgvector has no
    SQLite equivalent): score every candidate in Python. Fine at hundreds to
    a few thousand rows; not the path used in any Postgres environment."""
    rows = _ats_base_query(db, location).all()
    if not rows:
        return []
    if query_embedding is None:
        return rows[:ATS_CANDIDATE_LIMIT]

    scored = []
    for row in rows:
        try:
            sim = cosine_similarity(query_embedding, json.loads(row.embedding))
        except Exception:
            sim = 0.0
        scored.append((sim, row))
    scored.sort(key=lambda t: -t[0])
    return [row for _, row in scored[:ATS_CANDIDATE_LIMIT]]


def _query_ats_candidates(db, location: str, query_embedding: list[float] | None) -> list[JobListing]:
    """Semantic match against the pre-ingested ATS corpus: rank every
    candidate by cosine similarity between the search query's own embedding
    and each job's embedding (both already computed — no live fetch, no extra
    cost per job). This replaces keyword filtering, which either missed
    synonymous jobs (requiring the literal phrase — the earlier JSearch bug)
    or matched on incidental boilerplate words in long descriptions (a loose
    AND-across-words let unrelated roles like Account Executive outrank real
    matches, since "software" and "engineer" both show up somewhere in
    almost any tech company's generic posting text). Embedding similarity
    captures "backend developer" as close to "software engineer" without
    either failure mode."""
    if IS_POSTGRES and query_embedding is not None:
        return _query_ats_candidates_pgvector(db, location, query_embedding)
    return _query_ats_candidates_python(db, location, query_embedding)


def _to_dashboard_job(row: JobListing, resume_embedding: list[float] | None, saved_ids: set[int]) -> dict:
    match_score = None
    if resume_embedding and row.embedding:
        try:
            match_score = embedding_match_score(resume_embedding, json.loads(row.embedding))
        except Exception:
            match_score = None
    return {
        "id": row.id,
        "title": row.title,
        "company": row.company,
        "location": row.location,
        "description": _job_snippet(row.description),
        "applyUrl": row.apply_url,
        "postedAt": row.posted_at.isoformat() if row.posted_at else None,
        "source": row.source,
        "matchScore": match_score,
        "saved": row.id in saved_ids,
    }


@router.get("/dashboard/jobs", response_class=HTMLResponse)
async def job_dashboard_page(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse(url="/login?next=/dashboard/jobs", status_code=302)
    return templates.TemplateResponse(request, "job_dashboard.html", {"request": request})


@router.get("/api/dashboard/jobs")
async def dashboard_jobs(
    request: Request, q: str = "", location: str = "", minScore: int | None = None, page: int = 1
):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")

        query = (q or "").strip() or DEFAULT_QUERY
        loc = (location or "").strip()
        query_norm = query.strip().lower()
        location_norm = loc.strip().lower()
        page = max(1, page)
        requested_end = page * PER_PAGE

        # Cache row also holds the search query's own embedding (computed once,
        # reused across pagination) — fetched/created up front so both the ATS
        # ranking below and the JSearch cooldown check further down share it.
        cache_row = db.query(JobSearchQuery).filter_by(query_norm=query_norm, location_norm=location_norm).first()
        if cache_row is None:
            cache_row = JobSearchQuery(
                query_norm=query_norm, location_norm=location_norm, last_fetched_at=datetime.min
            )
            db.add(cache_row)
            db.flush()
        query_embedding = await _get_or_embed_query(db, cache_row, query)

        # Corpus-first: the ingested ATS boards are free and instant, so they're
        # queried unconditionally. JSearch is only hit when that alone can't
        # cover the requested page — many common searches now never touch the
        # external API at all.
        ats_rows = _query_ats_candidates(db, loc, query_embedding)
        jsearch_count = (
            db.query(JobSearchResult.id)
            .filter_by(query_norm=query_norm, location_norm=location_norm)
            .count()
        )
        if len(ats_rows) + jsearch_count < requested_end:
            if jsearch_count == 0:
                # First time this exact search has ever needed JSearch — always try once.
                await _fetch_and_append(db, query, loc, query_norm, location_norm)
            else:
                # Already tried before — fetch more, gated by a short cooldown
                # so fast scrolling can't hammer the external API.
                cooldown_elapsed = (
                    datetime.utcnow() - cache_row.last_fetched_at >= timedelta(minutes=EXPAND_COOLDOWN_MINUTES)
                )
                if cooldown_elapsed:
                    await _fetch_and_append(db, query, loc, query_norm, location_norm)

        jsearch_rows = (
            db.query(JobListing)
            .join(JobSearchResult, JobSearchResult.job_listing_id == JobListing.id)
            .filter(
                JobSearchResult.query_norm == query_norm,
                JobSearchResult.location_norm == location_norm,
                JobListing.is_active == True,  # noqa: E712
            )
            .order_by(JobSearchResult.rank.asc())
            .all()
        )
        combined = {r.id: r for r in ats_rows}
        for r in jsearch_rows:
            combined.setdefault(r.id, r)
        rows = list(combined.values())

        resume_embedding = await _user_resume_embedding(db, user)
        saved_ids = {
            sj.job_listing_id for sj in db.query(SavedJob).filter(SavedJob.user_id == user_id).all()
        }

        cards = [_to_dashboard_job(r, resume_embedding, saved_ids) for r in rows]
        if minScore is not None:
            cards = [c for c in cards if (c["matchScore"] or 0) >= minScore]
        cards.sort(key=lambda c: (c["matchScore"] is None, -(c["matchScore"] or 0)))

        total = len(cards)
        start = (page - 1) * PER_PAGE
        page_cards = cards[start:start + PER_PAGE]
        has_more = start + PER_PAGE < total

        return JSONResponse({"jobs": page_cards, "hasResume": bool(resume_embedding), "hasMore": has_more})
    finally:
        db.close()


@router.post("/api/saved-jobs")
async def save_job(request: Request, payload: SaveJobRequest):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        job = db.query(JobListing).filter(JobListing.id == payload.jobId).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        existing = db.query(SavedJob).filter_by(user_id=user_id, job_listing_id=payload.jobId).first()
        if not existing:
            db.add(SavedJob(user_id=user_id, job_listing_id=payload.jobId))
            db.commit()
        return {"ok": True, "saved": True}
    finally:
        db.close()


@router.get("/api/saved-jobs")
async def list_saved_jobs(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        rows = (
            db.query(SavedJob)
            .filter(SavedJob.user_id == user_id)
            .order_by(SavedJob.created_at.desc())
            .all()
        )
        jobs = []
        for saved in rows:
            job = saved.job
            if not job:
                continue
            jobs.append({
                "id": job.id,
                "title": job.title,
                "company": job.company,
                "location": job.location,
                "description": _job_snippet(job.description),
                "applyUrl": job.apply_url,
                "postedAt": job.posted_at.isoformat() if job.posted_at else None,
                "source": job.source,
                "matchScore": None,
                "saved": True,
            })
        return JSONResponse({"jobs": jobs})
    finally:
        db.close()


@router.delete("/api/saved-jobs/{job_id}")
async def unsave_job(request: Request, job_id: int):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        existing = db.query(SavedJob).filter_by(user_id=user_id, job_listing_id=job_id).first()
        if existing:
            db.delete(existing)
            db.commit()
        return {"ok": True, "saved": False}
    finally:
        db.close()


@router.post("/api/dashboard/applications")
async def log_application(request: Request, payload: LogApplicationRequest):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        job = db.query(JobListing).filter(JobListing.id == payload.jobId).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        entry = JobBoardApplication(user_id=user_id, job_listing_id=payload.jobId, method=payload.method)
        db.add(entry)
        db.commit()
        return {"ok": True, "id": entry.id}
    finally:
        db.close()


# ── Auto-apply ───────────────────────────────────────────────────────────────
# Clicking Auto-apply hands the posting to a Browserbase cloud browser, which
# fills the form from the user's stored application profile, attaches their
# resume and submits it. A run takes minutes, so POST only enqueues and the
# client polls the run row. See auto_apply/runner.py for the flow.

def _run_payload(run: AutoApplyRun, apply_url: str | None = None) -> dict:
    try:
        missing = json.loads(run.missing_fields) if run.missing_fields else []
    except (TypeError, ValueError):
        missing = []
    return {
        "runId": run.id,
        "jobId": run.job_listing_id,
        "status": run.status,
        "stage": run.stage,
        "detail": run.detail,
        "liveViewUrl": run.live_view_url,
        "replayUrl": run.replay_url,
        "missingFields": missing,
        "applyUrl": apply_url,
        "terminal": run.status in ("submitted", "needs_input", "failed", "dry_run"),
    }


def _profile_payload(prof: UserApplyProfile | None, resume_text: str) -> dict:
    """Stored profile merged over resume-derived defaults, so the modal opens
    pre-filled instead of blank."""
    from auto_apply.profile import resume_defaults

    derived = resume_defaults(resume_text)

    def value(attr: str, derived_key: str = "") -> str:
        stored = getattr(prof, attr, None) if prof else None
        return str(stored or derived.get(derived_key or attr, "") or "")

    return {
        "phone": value("phone"),
        "location": value("location"),
        "linkedinUrl": value("linkedin_url", "linkedin"),
        "githubUrl": value("github_url", "github"),
        "portfolioUrl": value("portfolio_url", "portfolio"),
        "workAuthorized": value("work_authorized"),
        "requiresSponsorship": value("requires_sponsorship"),
        "visaStatus": value("visa_status"),
        "willingToRelocate": value("willing_to_relocate"),
        "remotePreference": value("remote_preference"),
        "yearsExperience": value("years_experience"),
        "currentTitle": value("current_title"),
        "noticePeriod": value("notice_period"),
        "expectedSalary": value("expected_salary"),
        "availableStartDate": value("available_start_date"),
        "howDidYouHear": value("how_did_you_hear"),
        "whyThisRole": value("why_this_role"),
        "gender": value("gender"),
        "raceEthnicity": value("race_ethnicity"),
        "veteranStatus": value("veteran_status"),
        "disabilityStatus": value("disability_status"),
        "genderPronouns": value("gender_pronouns"),
        "lgbtqIdentity": value("lgbtq_identity"),
        "agreeToEmployerTerms": bool(getattr(prof, "agreed_to_employer_terms", False)),
        "consent": bool(getattr(prof, "auto_apply_consent_at", None)),
    }


@router.get("/api/apply-profile")
async def get_apply_profile(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user_id).first()
        payload = _profile_payload(prof, user.base_resume_text or "")
        payload["name"] = user.name or ""
        payload["email"] = user.email or ""
        payload["hasResume"] = bool(user.base_resume_path and os.path.exists(user.base_resume_path))
        return payload
    finally:
        db.close()


@router.post("/api/apply-profile")
async def save_apply_profile(request: Request, payload: ApplyProfileRequest):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user_id).first()
        if not prof:
            prof = UserApplyProfile(user_id=user_id)
            db.add(prof)

        prof.phone = payload.phone.strip()
        prof.location = payload.location.strip()
        prof.linkedin_url = payload.linkedinUrl.strip()
        prof.github_url = payload.githubUrl.strip()
        prof.portfolio_url = payload.portfolioUrl.strip()
        prof.work_authorized = payload.workAuthorized
        prof.requires_sponsorship = payload.requiresSponsorship
        prof.visa_status = payload.visaStatus.strip()
        prof.willing_to_relocate = payload.willingToRelocate
        prof.remote_preference = payload.remotePreference
        prof.years_experience = payload.yearsExperience.strip()
        prof.current_title = payload.currentTitle.strip()
        prof.notice_period = payload.noticePeriod.strip()
        prof.expected_salary = payload.expectedSalary.strip()
        prof.available_start_date = payload.availableStartDate.strip()
        prof.how_did_you_hear = payload.howDidYouHear.strip()
        prof.why_this_role = payload.whyThisRole.strip()
        prof.gender = payload.gender.strip()
        prof.race_ethnicity = payload.raceEthnicity.strip()
        prof.veteran_status = payload.veteranStatus.strip()
        prof.disability_status = payload.disabilityStatus.strip()
        prof.gender_pronouns = payload.genderPronouns.strip()
        prof.lgbtq_identity = payload.lgbtqIdentity.strip()
        prof.agreed_to_employer_terms = bool(payload.agreeToEmployerTerms)

        # Consent is a standing authorization to submit unattended — recorded
        # when granted, cleared if the user ever withdraws it.
        if payload.consent and not prof.auto_apply_consent_at:
            prof.auto_apply_consent_at = datetime.utcnow()
        elif not payload.consent:
            prof.auto_apply_consent_at = None

        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/api/dashboard/auto-apply", status_code=202)
async def start_auto_apply(request: Request, payload: AutoApplyRequest):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    from main import enforce_auto_apply_quota
    from auto_apply.profile import build_applicant_profile, snapshot_user, validate_profile
    from auto_apply.runner import enqueue_run

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")

        job = db.query(JobListing).filter(JobListing.id == payload.jobId).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        available, reason = aa_config.availability()
        if not available:
            raise HTTPException(status_code=503, detail=reason)

        supported, reason = aa_config.job_supported(job.source, job.apply_url)
        if not supported:
            raise HTTPException(status_code=400, detail=reason)

        existing = (
            db.query(AutoApplyRun)
            .filter(AutoApplyRun.user_id == user_id, AutoApplyRun.job_listing_id == job.id)
            .order_by(AutoApplyRun.created_at.desc())
            .first()
        )
        if existing and existing.status in ("queued", "running"):
            # Idempotent double-click: adopt the run already in flight.
            return JSONResponse(_run_payload(existing, job.apply_url), status_code=409)
        if existing and existing.status == "submitted":
            raise HTTPException(status_code=409, detail="You already applied to this job.")

        # Profile check comes before the quota call so an incomplete profile
        # never costs the user one of their monthly runs.
        snap = snapshot_user(db, user_id, job.id)
        profile = await build_applicant_profile(snap)
        blockers = validate_profile(profile, snap)
        if blockers:
            raise HTTPException(
                status_code=400,
                detail={"message": blockers[0], "needsProfile": True, "missing": blockers},
            )

        enforce_auto_apply_quota(db, user)

        run = AutoApplyRun(
            user_id=user_id,
            job_listing_id=job.id,
            status="queued",
            stage="queued",
            detail="Queued…",
            dry_run=not aa_config.submit_enabled(),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        result = _run_payload(run, job.apply_url)
    finally:
        db.close()

    enqueue_run(result["runId"])
    return JSONResponse(result, status_code=202)


@router.get("/api/dashboard/auto-apply/status")
async def auto_apply_status(request: Request, jobIds: str = ""):
    """Page-load hydration: latest run per job, so an already-applied card
    renders 'Applied' instead of a live button."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    from main import auto_apply_remaining

    ids: list[int] = []
    for chunk in (jobIds or "").split(","):
        chunk = chunk.strip()
        if chunk.isdigit():
            ids.append(int(chunk))
    ids = ids[:60]

    available, reason = aa_config.availability()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")

        runs: dict[str, dict] = {}
        if ids:
            rows = (
                db.query(AutoApplyRun)
                .filter(AutoApplyRun.user_id == user_id, AutoApplyRun.job_listing_id.in_(ids))
                .order_by(AutoApplyRun.created_at.desc())
                .all()
            )
            # Newest first, so the first row seen for a job is the latest one.
            # Deduped in Python rather than DISTINCT ON, which is Postgres-only
            # and this router still supports the SQLite fallback.
            for row in rows:
                key = str(row.job_listing_id)
                if key not in runs:
                    runs[key] = _run_payload(row)

        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user_id).first()
        profile_complete = bool(
            prof
            and prof.phone
            and prof.work_authorized in ("yes", "no")
            and prof.requires_sponsorship in ("yes", "no")
            and prof.auto_apply_consent_at
        )
        return {
            "available": available,
            "reason": reason,
            "remaining": auto_apply_remaining(db, user),
            "profileComplete": profile_complete,
            "sources": sorted(aa_config.sources()),
            "runs": runs,
        }
    finally:
        db.close()


@router.get("/api/dashboard/auto-apply/{run_id}")
async def auto_apply_run_status(request: Request, run_id: int):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        run = (
            db.query(AutoApplyRun)
            .filter(AutoApplyRun.id == run_id, AutoApplyRun.user_id == user_id)
            .first()
        )
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        job = db.query(JobListing).filter(JobListing.id == run.job_listing_id).first()
        return _run_payload(run, job.apply_url if job else None)
    finally:
        db.close()


@router.post("/api/dashboard/auto-apply/{run_id}/answers")
async def save_run_answers(request: Request, run_id: int, payload: RunAnswersRequest):
    """Save answers to specific questions a needs_input run couldn't resolve
    from the stored profile. Writes into UserApplyQA, matched by a normalized
    question signature — this deliberately does not requeue or touch the run
    itself. auto_apply_runs is "one row per attempt" by design (a live
    browser session's DOM state isn't persisted anywhere to resume into), so
    the frontend re-triggers a normal fresh Auto-apply click after this call,
    which now has these answers available."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    from auto_apply.profile import question_signature

    db = SessionLocal()
    try:
        run = (
            db.query(AutoApplyRun)
            .filter(AutoApplyRun.id == run_id, AutoApplyRun.user_id == user_id)
            .first()
        )
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        if run.status != "needs_input":
            raise HTTPException(status_code=400, detail="This run doesn't need input.")

        saved = 0
        for item in payload.answers:
            question = item.question.strip()
            answer = item.answer.strip()
            if not question or not answer:
                continue
            sig = question_signature(question)
            row = (
                db.query(UserApplyQA)
                .filter(UserApplyQA.user_id == user_id, UserApplyQA.question_signature == sig)
                .first()
            )
            if not row:
                row = UserApplyQA(user_id=user_id, question_signature=sig)
                db.add(row)
            row.question_text = question
            row.answer = answer
            saved += 1
        db.commit()
        return {"ok": True, "saved": saved}
    finally:
        db.close()
