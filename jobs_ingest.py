"""Ingestion pipeline for the TailorCV Gigs board.

Runs every registered source adapter, upserts each gig into the JobListing table
(idempotent by source + source_job_id), applies the verify-legit rule, refreshes
the apply-now state, and deactivates listings that were not seen this run or have
gone stale. Safe to run repeatedly (via the admin endpoint or a cron).
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta

from database import SessionLocal, sync_embedding_vectors
from models import JobListing
from job_sources import ADAPTERS, NormalizedJob, verify_legit, slugify
from functions import embed_text, EMBEDDING_MODEL

# Import adapter modules so their @register decorators run and populate ADAPTERS.
import job_sources.fixtures  # noqa: F401
import job_sources.greenhouse  # noqa: F401
import job_sources.lever  # noqa: F401
import job_sources.ashby  # noqa: F401
import job_sources.smartrecruiters  # noqa: F401

logger = logging.getLogger(__name__)

STALE_DAYS = 21  # a listing not re-seen within this window is deactivated
# Bounded so a large first-time backfill doesn't hammer OpenAI. Concurrency
# 15 was enough to blow through the account's tokens-per-minute limit on a
# ~5,000-job backfill — each 429 the SDK hits triggers its own internal
# retry-with-backoff (max_retries=3 in functions.py's client), which is where
# a run that should take minutes was instead taking 30+.
EMBED_CONCURRENCY = 5


def _apply(job: NormalizedJob, row: JobListing, now: datetime) -> None:
    # Defensively truncate to each column's max length — external source data
    # has no length guarantees (a Greenhouse listing with a location string
    # concatenating 10 offices exceeded VARCHAR(160) and aborted an entire
    # ingestion run, since it used to be one all-or-nothing transaction).
    verified, note = verify_legit(job)
    row.source = (job.source or "")[:40]
    row.source_job_id = (job.source_job_id or "")[:200]
    row.title = (job.title or "")[:300]
    row.company = (job.company or None) and job.company[:200]
    row.description = job.description
    row.category = (job.category or None) and job.category[:80]
    row.tags = json.dumps(job.tags or [])
    row.required_skills = json.dumps(job.required_skills or [])
    row.min_experience = (job.min_experience or None) and job.min_experience[:40]
    row.pay_text = (job.pay_text or None) and job.pay_text[:160]
    row.location = (job.location or None) and job.location[:160]
    row.is_remote = bool(job.is_remote)
    row.apply_url = (job.apply_url or "")[:600]
    row.posted_at = job.posted_at
    row.accepting_now = bool(job.accepting_now)
    row.is_verified = verified
    row.verification_note = note
    row.is_active = True
    row.last_seen_at = now
    row.fetched_at = now


async def _embed_missing(db, rows: list[JobListing]) -> int:
    """Embed whichever rows don't have one yet (concurrently, bounded), so the
    job dashboard's semantic search can rank this corpus. _apply() above
    doesn't touch embeddings, so this only ever (re-)embeds rows that
    genuinely lack one — a job already embedded on a prior run is skipped.
    Returns how many actually succeeded (a large first-time backfill can hit
    OpenAI's tokens-per-minute rate limit partway through; failures are
    logged and simply left for the next ingestion run to retry, since they
    still have no embedding)."""
    to_embed = [r for r in rows if not r.embedding]
    if not to_embed:
        return 0

    sem = asyncio.Semaphore(EMBED_CONCURRENCY)
    succeeded_rows: list[JobListing] = []

    async def _embed_one(row: JobListing) -> None:
        async with sem:
            try:
                vector = await embed_text(f"{row.title}\n{row.description or ''}")
                row.embedding = json.dumps(vector)
                row.embedding_model = EMBEDDING_MODEL
                succeeded_rows.append(row)
            except Exception:
                logger.exception("Failed to embed job listing %s", row.slug)

    await asyncio.gather(*(_embed_one(r) for r in to_embed))
    sync_embedding_vectors(db, succeeded_rows)
    return len(succeeded_rows)


async def ingest_all() -> dict:
    """Fetch from all adapters, upsert, then deactivate stale/unseen listings.
    Returns a summary dict. Each adapter failure is isolated and logged."""
    now = datetime.utcnow()
    seen_ids: set[int] = set()
    created = updated = errors = 0
    per_source: dict[str, int] = {}

    db = SessionLocal()
    try:
        touched_rows: list[JobListing] = []
        for source, adapter in ADAPTERS.items():
            try:
                jobs = await adapter()
            except Exception:
                errors += 1
                logger.exception("Gig adapter %s failed", source)
                continue
            per_source[source] = len(jobs)

            # One bulk SELECT for the whole source's batch (not one per job —
            # against a remote DB that's the difference between a handful of
            # round-trips and thousands) and one SAVEPOINT per source (not
            # per job — a bad row still can't wipe out other sources'
            # progress, but this doesn't multiply round-trips by 3x either;
            # per-job savepoints made a ~5,000-job run take 20+ minutes).
            source_rows: list[JobListing] = []
            try:
                with db.begin_nested():
                    source_job_ids = [job.source_job_id for job in jobs]
                    existing = {}
                    if source_job_ids:
                        existing_rows = (
                            db.query(JobListing)
                            .filter(JobListing.source == source, JobListing.source_job_id.in_(source_job_ids))
                            .all()
                        )
                        existing = {r.source_job_id: r for r in existing_rows}

                    for job in jobs:
                        row = existing.get(job.source_job_id)
                        if row is None:
                            row = JobListing(slug=slugify(job.title, job.source, job.source_job_id))
                            _apply(job, row, now)
                            db.add(row)
                            created += 1
                        else:
                            _apply(job, row, now)
                            updated += 1
                        source_rows.append(row)
                    db.flush()
            except Exception:
                errors += 1
                logger.exception("Failed to upsert batch for source %s", source)
                continue

            for row in source_rows:
                seen_ids.add(row.id)
                touched_rows.append(row)

        # Commit the upsert work now, independent of everything after it.
        # Fetching from 4+ live APIs is the expensive, slow part of this
        # function; deactivation and embedding are separate failure points
        # (a dropped DB connection mid-deactivation has actually happened),
        # and neither should be able to discard already-fetched, already
        # -upserted data — the next attempt would otherwise have to re-fetch
        # from every live API all over again just to retry a later step.
        db.commit()

        # Deactivate anything not seen this run or older than the stale window.
        stale_cutoff = now - timedelta(days=STALE_DAYS)
        q = db.query(JobListing).filter(JobListing.is_active == True)  # noqa: E712
        deactivated = 0
        for row in q.all():
            if row.id not in seen_ids or row.last_seen_at < stale_cutoff:
                row.is_active = False
                deactivated += 1
        db.commit()

        embedded = await _embed_missing(db, touched_rows)
        db.commit()

        summary = {
            "created": created, "updated": updated, "deactivated": deactivated,
            "errors": errors, "embedded": embedded, "per_source": per_source,
            "total_active": db.query(JobListing).filter(JobListing.is_active == True).count(),  # noqa: E712
        }
        logger.info("Gig ingestion complete: %s", summary)
        return summary
    except Exception:
        db.rollback()
        logger.exception("Gig ingestion failed")
        raise
    finally:
        db.close()
