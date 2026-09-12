"""JSearch (RapidAPI) adapter for the job dashboard.

Unlike the fixed-catalog Gigs adapters (job_sources/fixtures.py), JSearch is a
search API — it needs a (query, location) per call, not a zero-arg "fetch
everything". So this isn't decorated with @register() / iterated by
jobs_ingest.ingest_all(); it's called directly by routers/job_dashboard.py
whenever a search's cached results have gone stale.
"""

from __future__ import annotations

import os
import hashlib
import logging
from datetime import datetime
from typing import Optional

import httpx

from job_sources import NormalizedJob

logger = logging.getLogger(__name__)

JSEARCH_URL = "https://jsearch.p.rapidapi.com/search-v2"
RAPIDAPI_HOST = os.getenv("RAPIDAPI_HOST", "jsearch.p.rapidapi.com")


def _parse_posted_at(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _location(item: dict) -> Optional[str]:
    # search-v2 usually gives a ready-made "job_location" (e.g. "Anywhere" for
    # remote roles); fall back to city/state/country when that's absent.
    loc = item.get("job_location")
    if loc:
        return loc
    parts = [item.get("job_city"), item.get("job_state"), item.get("job_country")]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def _to_normalized(item: dict) -> Optional[NormalizedJob]:
    job_id = item.get("job_id")
    apply_url = item.get("job_apply_link")
    title = item.get("job_title")
    if not (job_id and apply_url and title):
        return None
    # search-v2's job_id is a ~400-char opaque blob — far longer than the
    # source_job_id column (VARCHAR(200)). Hash it to a stable, fixed-length id
    # (same job_id always hashes the same, so upsert dedup still works).
    stable_id = hashlib.sha256(str(job_id).encode()).hexdigest()
    return NormalizedJob(
        source="jsearch",
        source_job_id=stable_id,
        title=title,
        apply_url=apply_url,
        company=item.get("employer_name"),
        description=item.get("job_description"),
        location=_location(item),
        is_remote=bool(item.get("job_is_remote")),
        posted_at=_parse_posted_at(item.get("job_posted_at_datetime_utc")),
        accepting_now=True,
    )


async def fetch_jsearch(query: str, location: str = "", num_pages: int = 2) -> list[NormalizedJob]:
    """Fetch jobs matching `query` (optionally scoped to `location`) from JSearch.
    num_pages=2 (~20 jobs) gives the dashboard enough of a result set to page
    through via infinite scroll without re-hitting the external API on every
    scroll (the pages are cached in job_listings) — kept at 2 rather than
    higher since JSearch's own response time scales with num_pages and a
    cold-cache search already pays that cost synchronously on first load.
    Raises RuntimeError if RAPIDAPI_KEY isn't configured."""
    api_key = os.getenv("RAPIDAPI_KEY")
    if not api_key:
        raise RuntimeError(
            "RAPIDAPI_KEY is not set. Add it to your .env file to enable job search."
        )

    search_query = f"{query} in {location}".strip() if location else query
    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": RAPIDAPI_HOST,
        "Content-Type": "application/json",
    }
    params = {"query": search_query, "num_pages": str(num_pages), "date_posted": "all"}

    # num_pages=3 fetches ~30 jobs in one call and has been observed to take
    # 10-15s; give it real headroom rather than risk a spurious timeout on the
    # very first search for a new query.
    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            resp = await client.get(JSEARCH_URL, headers=headers, params=params)
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("JSearch request failed for query=%r location=%r", query, location)
            return []

    payload = resp.json()
    items = (payload.get("data") or {}).get("jobs") or []
    jobs = []
    for item in items:
        normalized = _to_normalized(item)
        if normalized:
            jobs.append(normalized)
    return jobs
