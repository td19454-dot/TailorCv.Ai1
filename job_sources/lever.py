"""Lever adapter — pulls open roles from each configured company's public
Lever job board API (public, unauthenticated: api.lever.co).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

import httpx

from job_sources import NormalizedJob, register

logger = logging.getLogger(__name__)

BASE_URL = "https://api.lever.co/v0/postings/{slug}"

# Board slugs verified live against the public API (real companies, real open
# postings at verification time — job counts will naturally change over time).
COMPANIES = [
    "palantir", "angellist", "wealthfront", "ro", "includedhealth", "levelup", "anchorage",
]


def _parse_epoch_ms(raw) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.utcfromtimestamp(int(raw) / 1000)
    except Exception:
        return None


def _to_normalized(item: dict) -> Optional[NormalizedJob]:
    job_id = item.get("id")
    title = item.get("text")
    apply_url = item.get("applyUrl") or item.get("hostedUrl")
    if not (job_id and title and apply_url):
        return None
    categories = item.get("categories") or {}
    location = categories.get("location")
    return NormalizedJob(
        source="lever",
        source_job_id=str(job_id),
        title=title,
        apply_url=apply_url,
        company=None,  # Lever's posting payload doesn't include the company name itself
        description=item.get("descriptionPlain") or "",
        location=location,
        is_remote=(item.get("workplaceType") == "remote") or bool(location and "remote" in location.lower()),
        posted_at=_parse_epoch_ms(item.get("createdAt")),
        accepting_now=True,
    )


async def _fetch_company(client: httpx.AsyncClient, slug: str) -> list[NormalizedJob]:
    try:
        resp = await client.get(BASE_URL.format(slug=slug), params={"mode": "json"})
        resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("Lever board fetch failed for %s", slug)
        return []
    items = resp.json() or []
    jobs = []
    for item in items:
        normalized = _to_normalized(item)
        if normalized:
            normalized.company = normalized.company or slug.replace("-", " ").title()
            jobs.append(normalized)
    return jobs


@register("lever")
async def fetch() -> list[NormalizedJob]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        results = await asyncio.gather(*(_fetch_company(client, c) for c in COMPANIES))
    return [job for company_jobs in results for job in company_jobs]
