"""Environment/config for auto-apply.

Deliberately stdlib-only. The router imports this at module scope to decide
whether to even offer the feature, so it must be importable on a machine where
stagehand/playwright were never installed and no Browserbase key exists.
deps_installed() checks for the packages with find_spec and never imports them.
"""

from __future__ import annotations

import os
from importlib import util as _importlib_util

# Mirrors ATS_SOURCES in routers/job_dashboard.py. These four are company-hosted
# application forms we can actually fill. JSearch apply links resolve to
# Indeed/LinkedIn/ZipRecruiter, which gate on login and bot detection — offering
# auto-apply there just burns a session to discover the wall.
_DEFAULT_SOURCES = "greenhouse,lever,ashby,smartrecruiters"

UNAVAILABLE_MSG = "Auto-apply isn't set up on this server yet."
UNSUPPORTED_MSG = "Auto-apply only works on company ATS pages right now — use Apply manually for this one."


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name)
    if not raw:
        return default
    return raw.lower() not in ("0", "false", "no", "off")


def sources() -> set[str]:
    return {s.strip().lower() for s in _env("AUTO_APPLY_SOURCES", _DEFAULT_SOURCES).split(",") if s.strip()}


def submit_enabled() -> bool:
    """Whether the run clicks the final submit button.

    Default on — auto-apply submits unattended. AUTO_APPLY_SUBMIT=0 is a local
    dry-run switch: the form is still filled and verified, just never sent."""
    return _env_bool("AUTO_APPLY_SUBMIT", True)


def max_concurrency() -> int:
    return max(1, _env_int("AUTO_APPLY_MAX_CONCURRENCY", 2))


def run_timeout_seconds() -> float:
    return max(60.0, _env_float("AUTO_APPLY_TIMEOUT_SECONDS", 420.0))


def free_monthly_cap() -> int:
    return max(0, _env_int("AUTO_APPLY_FREE_MONTHLY", 5))


def pro_monthly_cap() -> int:
    return max(0, _env_int("AUTO_APPLY_PRO_MONTHLY", 50))


def model_name() -> str:
    return _env("AUTO_APPLY_MODEL", "openai/gpt-4.1")


def model_api_key() -> str:
    return _env("AUTO_APPLY_MODEL_API_KEY") or _env("OPENAI_API_KEY")


def browserbase_api_key() -> str:
    return _env("BROWSERBASE_API_KEY")


def browserbase_project_id() -> str:
    return _env("BROWSERBASE_PROJECT_ID")


def deps_installed() -> bool:
    """True if stagehand and playwright are importable — without importing them."""
    try:
        return all(_importlib_util.find_spec(m) is not None for m in ("stagehand", "playwright"))
    except (ImportError, ValueError):
        return False


def availability() -> tuple[bool, str]:
    """(available, user-facing reason). Missing deps or keys degrade the feature
    to a disabled button rather than a 500 — the dashboard must still render."""
    if not deps_installed():
        return False, UNAVAILABLE_MSG
    if not browserbase_api_key():
        return False, UNAVAILABLE_MSG
    if not model_api_key():
        return False, UNAVAILABLE_MSG
    return True, ""


def job_supported(source: str, apply_url: str) -> tuple[bool, str]:
    """source is set by our own ingestion adapters (job_sources/*.py), not by
    arbitrary user input, so it's the trustworthy signal here — not the URL.

    Originally this also required apply_url's host to be one of
    ALLOWED_APPLY_HOSTS, on the theory that a greenhouse-sourced row could
    carry an off-host redirect. In practice that rejected legitimate postings:
    Greenhouse lets companies front their board with their own branded domain
    (e.g. stripe.com/jobs/..., careers.airbnb.com/...) which still renders the
    same Greenhouse-hosted form under the hood. Trust the source; just require
    a real http(s) URL to actually navigate to."""
    if (source or "").strip().lower() not in sources():
        return False, UNSUPPORTED_MSG
    if not (apply_url or "").strip().lower().startswith(("http://", "https://")):
        return False, UNSUPPORTED_MSG
    return True, ""
