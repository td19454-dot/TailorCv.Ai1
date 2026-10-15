"""Locked ATS scans: what a free user sees once their free scans are used up.

The scan still runs, but the browser gets a redacted copy: the score, the
pass/fail shape of every check, skill counts, the first priority fix, and the
Searchability section in full (contact details, section headings, dates -
generic checks, cheap to give away, and enough to show the report is real).
Every other explanation, action and skill name stays on the server
(AtsLockedReport) and is returned by /api/ats-report/<token> once the user is
Pro.

Redaction is server-side on purpose. The report IS the product here - unlike
the tailored-resume lock, where the download gate is what protects it - so a
client-side blur over the full JSON would give the missing keywords away to
anyone who opens DevTools or sessionStorage.
"""
from copy import deepcopy

LOCKED_SKILL = "Locked skill"
LOCKED_FIX = {"issue": "Unlock to see this fix", "action": ""}

# Rendered as the Searchability section; sent in full.
_OPEN_SECTIONS = ("contact_information", "sections")
# Leaf fields kept everywhere else. Anything not listed - explanation, action,
# evidence, any field added later - is dropped by default.
_KEEP_LEAVES = {"passed", "present"}
# Top-level blocks that aren't checks: handled explicitly or not sent at all.
_SPECIAL = {"skills", "top_priority_fixes", "job_title_match", "deterministic_breakdown"}


def _shape_only(node: dict) -> dict:
    out = {}
    for key, value in node.items():
        if isinstance(value, dict):
            inner = _shape_only(value)
            if inner:
                out[key] = inner
        elif key in _KEEP_LEAVES:
            out[key] = value
    return out


def redact_ats_for_lock(result: dict, report_id: str) -> dict:
    """The browser's copy of a locked scan. Pure: `result` is not modified."""
    result = deepcopy(result or {})
    skills = result.get("skills") or {}
    fixes = [f for f in (result.get("top_priority_fixes") or []) if isinstance(f, dict)]
    title = (result.get("job_title_match") or {}).get("job_title_in_jd") or ""

    redacted = {}
    for key, value in result.items():
        if key in _SPECIAL or not isinstance(value, dict):
            continue
        redacted[key] = value if key in _OPEN_SECTIONS else _shape_only(value)

    redacted["skills"] = {}
    for kind in ("hard_skills", "soft_skills"):
        block = skills.get(kind) or {}
        redacted["skills"][kind] = {
            "matched": [LOCKED_SKILL] * len(block.get("matched") or []),
            "missing": [LOCKED_SKILL] * len(block.get("missing") or []),
        }
    # The first fix in full: proof the report is worth unlocking.
    redacted["top_priority_fixes"] = (
        [{"issue": fixes[0].get("issue", ""), "action": fixes[0].get("action", "")}] if fixes else []
    ) + [dict(LOCKED_FIX) for _ in fixes[1:]]

    redacted.update({
        "match_rate": result.get("match_rate"),
        "match_level": result.get("match_level"),
        "has_portfolio": bool(result.get("has_portfolio")),
        "job_title_match": {"job_title_in_jd": title} if title else {},
        "locked": True,
        "report_id": report_id,
    })
    return redacted
