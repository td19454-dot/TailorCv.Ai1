"""Ingestion pipeline for the TailorCV Gigs board.

Runs every registered source adapter, upserts each gig into the JobListing table
(idempotent by source + source_job_id), applies the verify-legit rule, refreshes
the apply-now state, and deactivates listings that were not seen this run or have
gone stale. Safe to run repeatedly (via the admin endpoint or a cron).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from database import SessionLocal
from models import JobListing
from job_sources import ADAPTERS, NormalizedJob, verify_legit, slugify

# Import adapter modules so their @register decorators run and populate ADAPTERS.
import job_sources.fixtures  # noqa: F401

logger = logging.getLogger(__name__)

STALE_DAYS = 21  # a listing not re-seen within this window is deactivated


def _apply(job: NormalizedJob, row: JobListing, now: datetime) -> None:
    verified, note = verify_legit(job)
    row.source = job.source
    row.source_job_id = job.source_job_id
    row.title = job.title
    row.company = job.company
    row.description = job.description
    row.category = job.category
    row.tags = json.dumps(job.tags or [])
    row.required_skills = json.dumps(job.required_skills or [])
    row.min_experience = job.min_experience
    row.pay_text = job.pay_text
    row.location = job.location
    row.is_remote = bool(job.is_remote)
    row.apply_url = job.apply_url
    row.posted_at = job.posted_at
    row.accepting_now = bool(job.accepting_now)
    row.is_verified = verified
    row.verification_note = note
    row.is_active = True
    row.last_seen_at = now
    row.fetched_at = now


async def ingest_all() -> dict:
    """Fetch from all adapters, upsert, then deactivate stale/unseen listings.
    Returns a summary dict. Each adapter failure is isolated and logged."""
    now = datetime.utcnow()
    seen_ids: set[int] = set()
    created = updated = errors = 0
    per_source: dict[str, int] = {}

    db = SessionLocal()
    try:
        for source, adapter in ADAPTERS.items():
            try:
                jobs = await adapter()
            except Exception:
                errors += 1
                logger.exception("Gig adapter %s failed", source)
                continue
            per_source[source] = len(jobs)
            for job in jobs:
                row = (
                    db.query(JobListing)
                    .filter(JobListing.source == job.source,
                            JobListing.source_job_id == job.source_job_id)
                    .first()
                )
                if row is None:
                    row = JobListing(slug=slugify(job.title, job.source, job.source_job_id))
                    _apply(job, row, now)
                    db.add(row)
                    db.flush()
                    created += 1
                else:
                    _apply(job, row, now)
                    updated += 1
                seen_ids.add(row.id)

        # Deactivate anything not seen this run or older than the stale window.
        stale_cutoff = now - timedelta(days=STALE_DAYS)
        q = db.query(JobListing).filter(JobListing.is_active == True)  # noqa: E712
        deactivated = 0
        for row in q.all():
            if row.id not in seen_ids or row.last_seen_at < stale_cutoff:
                row.is_active = False
                deactivated += 1

        db.commit()
        summary = {
            "created": created, "updated": updated, "deactivated": deactivated,
            "errors": errors, "per_source": per_source,
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
