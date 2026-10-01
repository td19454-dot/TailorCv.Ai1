"""Greenhouse adapter — pulls open roles from each configured company's public
Greenhouse job board API (public, unauthenticated: boards-api.greenhouse.io).
"""

from __future__ import annotations

import asyncio
import html as html_lib
import logging
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from job_sources import NormalizedJob, register

logger = logging.getLogger(__name__)

BASE_URL = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"

# Board slugs verified live against the public API (real companies, real open
# postings at verification time — job counts will naturally change over time).
COMPANIES = [
    "stripe", "airbnb", "robinhood", "coinbase", "pinterest", "gitlab",
    "figma", "asana", "databricks", "reddit", "discord", "affirm",
]


def _strip_html(raw: Optional[str]) -> str:
    if not raw:
        return ""
    # Greenhouse's "content" field is HTML that's been entity-escaped once
    # already (e.g. "&lt;h2&gt;"), so it must be unescaped before parsing —
    # otherwise BeautifulSoup treats the escaped tags as literal text and
    # get_text() returns them verbatim instead of stripping them.
    return BeautifulSoup(html_lib.unescape(raw), "html.parser").get_text("\n", strip=True)


def _parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=None)
    except Exception:
        return None


def _to_normalized(item: dict, company_slug: str) -> Optional[NormalizedJob]:
    job_id = item.get("id")
    title = item.get("title")
    apply_url = item.get("absolute_url")
    if not (job_id and title and apply_url):
        return None
    location = (item.get("location") or {}).get("name")
    return NormalizedJob(
        source="greenhouse",
        source_job_id=str(job_id),
        title=title,
        apply_url=apply_url,
        company=item.get("company_name") or company_slug,
        description=_strip_html(item.get("content")),
        location=location,
        is_remote=bool(location and "remote" in location.lower()),
        posted_at=_parse_date(item.get("first_published") or item.get("updated_at")),
        accepting_now=True,
    )


async def _fetch_company(client: httpx.AsyncClient, slug: str) -> list[NormalizedJob]:
    try:
        resp = await client.get(BASE_URL.format(slug=slug), params={"content": "true"})
        resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("Greenhouse board fetch failed for %s", slug)
        return []
    items = resp.json().get("jobs") or []
    return [j for j in (_to_normalized(item, slug) for item in items) if j]


@register("greenhouse")
async def fetch() -> list[NormalizedJob]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        results = await asyncio.gather(*(_fetch_company(client, c) for c in COMPANIES))
    return [job for company_jobs in results for job in company_jobs]
