"""Pluggable job-source adapters for the TailorCV Gigs board.

Each adapter fetches gigs from one platform (Mercor, Outlier, Alignerr, Fleet,
Scale/Remotasks, DataAnnotation, ...) and returns a list of `NormalizedJob`.
The ingestion pipeline (jobs_ingest.py) iterates the registered adapters,
upserts into the JobListing table, applies the verify-legit rule, and
deactivates stale rows.

Phase 1 ships a single `fixtures` adapter (representative real gigs, zero
scraping/legal risk). Real per-platform scraping adapters plug in later behind
the same interface — add a module, decorate its fetch with @register, done.
"""

from __future__ import annotations

import re
import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Awaitable, Callable, Optional


@dataclass
class NormalizedJob:
    source: str
    source_job_id: str
    title: str
    apply_url: str
    company: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    required_skills: list[str] = field(default_factory=list)
    min_experience: Optional[str] = None
    pay_text: Optional[str] = None
    location: Optional[str] = None
    is_remote: bool = True
    posted_at: Optional[datetime] = None
    accepting_now: bool = True


# Adapter registry. Each adapter is an async callable returning list[NormalizedJob].
Adapter = Callable[[], Awaitable[list[NormalizedJob]]]
ADAPTERS: dict[str, Adapter] = {}


def register(source: str):
    """Decorator to register a source adapter under a stable source key."""
    def _wrap(fn: Adapter) -> Adapter:
        ADAPTERS[source] = fn
        return fn
    return _wrap


# Platforms we consider trustworthy enough to auto-mark verified. Auto-aggregated
# listings from anywhere else stay unverified (and hidden) until reviewed.
TRUSTED_SOURCES = {
    "mercor", "outlier", "alignerr", "fleet", "scale", "remotasks",
    "dataannotation", "surge", "prolific", "appen", "telus", "turing",
    "toloka", "clickworker", "braintrust",
    # ATS-hosted company job boards — each listing is a real company's own
    # posting on their public applicant-tracking-system board, not a
    # third-party aggregation, so the same "trusted platform" reasoning applies.
    "greenhouse", "lever", "ashby", "smartrecruiters",
}

# Text patterns that signal a scam — never verify a listing containing these.
_SCAM_PATTERNS = [
    "registration fee", "pay upfront", "upfront payment", "processing fee",
    "deposit required", "pay to apply", "training fee", "activation fee",
    "send money", "wire transfer", "gift card",
]


def is_scammy(job: NormalizedJob) -> bool:
    hay = " ".join(filter(None, [job.title, job.description or "", job.pay_text or ""])).lower()
    return any(p in hay for p in _SCAM_PATTERNS)


def verify_legit(job: NormalizedJob) -> tuple[bool, str]:
    """Return (is_verified, note). A gig is verified-legit when it comes from a
    trusted source, has a real external apply link, and shows no scam signals."""
    if job.source not in TRUSTED_SOURCES:
        return False, "Source not yet reviewed"
    if not (job.apply_url or "").lower().startswith(("http://", "https://")):
        return False, "No valid apply link"
    if is_scammy(job):
        return False, "Flagged by scam filter"
    return True, "Trusted platform · real apply link · no upfront fees"


def slugify(title: str, source: str, source_job_id: str) -> str:
    """Stable, unique, URL-safe slug for the /gigs/<slug> detail page."""
    base = re.sub(r"[^a-z0-9]+", "-", (title or "gig").lower()).strip("-")[:80] or "gig"
    tail = hashlib.sha1(f"{source}:{source_job_id}".encode()).hexdigest()[:8]
    return f"{base}-{source}-{tail}"
