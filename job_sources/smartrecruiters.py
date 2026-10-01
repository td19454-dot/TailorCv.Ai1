"""SmartRecruiters adapter — pulls open roles from each configured company's
public SmartRecruiters postings API (public, unauthenticated: api.smartrecruiters.com).

Unlike Greenhouse/Lever/Ashby, SmartRecruiters' list endpoint doesn't include
the job description — that needs a second per-job request. Some of our
companies have 500+ open postings, so per-company detail fetches are capped
(MAX_JOBS_PER_COMPANY) and rate-limited (a bounded semaphore) rather than
fetching everything, to keep one ingestion run fast and avoid hammering their API.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from job_sources import NormalizedJob, register

logger = logging.getLogger(__name__)

LIST_URL = "https://api.smartrecruiters.com/v1/companies/{slug}/postings"
DETAIL_URL = "https://api.smartrecruiters.com/v1/companies/{slug}/postings/{job_id}"

# Company identifiers verified live against the public API (real companies,
# real open postings at verification time — job counts will naturally change).
COMPANIES = ["Visa", "TeleperformanceUSA", "Equinox", "Wehkamp", "DeliveryHero", "Accor"]

MAX_JOBS_PER_COMPANY = 40
DETAIL_CONCURRENCY = 8


def _strip_html(html: Optional[str]) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text("\n", strip=True)


def _parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _description_from_detail(detail: dict) -> str:
    sections = (detail.get("jobAd") or {}).get("sections") or {}
    parts = [_strip_html(section.get("text")) for section in sections.values() if section.get("text")]
    return "\n\n".join(parts)


async def _fetch_detail(client: httpx.AsyncClient, sem: asyncio.Semaphore, slug: str, job_id: str) -> dict:
    async with sem:
        try:
            resp = await client.get(DETAIL_URL.format(slug=slug, job_id=job_id))
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError:
            logger.warning("SmartRecruiters detail fetch failed for %s/%s", slug, job_id)
            return {}


def _to_normalized(item: dict, detail: dict, company_slug: str) -> Optional[NormalizedJob]:
    job_id = item.get("id")
    title = item.get("name")
    apply_url = detail.get("applyUrl") or detail.get("postingUrl")
    if not (job_id and title and apply_url):
        return None
    location = item.get("location") or {}
    company_name = (item.get("company") or {}).get("name") or company_slug
    return NormalizedJob(
        source="smartrecruiters",
        source_job_id=str(job_id),
        title=title,
        apply_url=apply_url,
        company=company_name,
        description=_description_from_detail(detail),
        location=location.get("fullLocation") or location.get("city"),
        is_remote=bool(location.get("remote")),
        posted_at=_parse_date(item.get("releasedDate")),
        accepting_now=True,
    )


async def _fetch_company(client: httpx.AsyncClient, sem: asyncio.Semaphore, slug: str) -> list[NormalizedJob]:
    try:
        resp = await client.get(LIST_URL.format(slug=slug))
        resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("SmartRecruiters postings list failed for %s", slug)
        return []
    items = (resp.json().get("content") or [])[:MAX_JOBS_PER_COMPANY]

    details = await asyncio.gather(*(_fetch_detail(client, sem, slug, item["id"]) for item in items))
    jobs = []
    for item, detail in zip(items, details):
        normalized = _to_normalized(item, detail, slug)
        if normalized:
            jobs.append(normalized)
    return jobs


@register("smartrecruiters")
async def fetch() -> list[NormalizedJob]:
    sem = asyncio.Semaphore(DETAIL_CONCURRENCY)
    async with httpx.AsyncClient(timeout=20.0) as client:
        results = await asyncio.gather(*(_fetch_company(client, sem, c) for c in COMPANIES))
    return [job for company_jobs in results for job in company_jobs]
