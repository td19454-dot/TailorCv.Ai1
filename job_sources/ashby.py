"""Ashby adapter — pulls open roles from each configured company's public
Ashby job board API (public, unauthenticated: api.ashbyhq.com/posting-api).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

import httpx

from job_sources import NormalizedJob, register

logger = logging.getLogger(__name__)

BASE_URL = "https://api.ashbyhq.com/posting-api/job-board/{slug}"

# Board slugs verified live against the public API (real companies, real open
# postings at verification time — job counts will naturally change over time).
COMPANIES = [
    "notion", "linear", "ramp", "substack", "openai", "runway", "clickhouse", "temporal", "modal",
]


def _parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _to_normalized(item: dict, company_slug: str) -> Optional[NormalizedJob]:
    job_id = item.get("id")
    title = item.get("title")
    apply_url = item.get("applyUrl") or item.get("jobUrl")
    if not (job_id and title and apply_url):
        return None
    return NormalizedJob(
        source="ashby",
        source_job_id=str(job_id),
        title=title,
        apply_url=apply_url,
        company=company_slug.replace("-", " ").title(),
        description=item.get("descriptionPlain") or "",
        location=item.get("location"),
        is_remote=bool(item.get("isRemote")),
        posted_at=_parse_date(item.get("publishedAt")),
        accepting_now=True,
    )


async def _fetch_company(client: httpx.AsyncClient, slug: str) -> list[NormalizedJob]:
    try:
        resp = await client.get(BASE_URL.format(slug=slug))
        resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("Ashby board fetch failed for %s", slug)
        return []
    items = resp.json().get("jobs") or []
    return [j for j in (_to_normalized(item, slug) for item in items) if j]


@register("ashby")
async def fetch() -> list[NormalizedJob]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        results = await asyncio.gather(*(_fetch_company(client, c) for c in COMPANIES))
    return [job for company_jobs in results for job in company_jobs]
