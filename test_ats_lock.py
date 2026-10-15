"""Locked ATS scans (ats_lock.py): the redacted copy must never carry the
paid content - explanations, actions, skill names, fixes after the first -
while keeping what the locked page shows: the score, the check shape, skill
counts, fix #1 and the Searchability section.

Run: python test_ats_lock.py
"""
import json

from ats_lock import LOCKED_SKILL, redact_ats_for_lock

SECRET = "SECRET-DETAIL"

FULL = {
    "match_rate": 62,
    "match_level": "Good",
    "has_portfolio": True,
    "job_title_match": {"job_title_in_jd": "Data Analyst", "passed": "false", "explanation": SECRET},
    "deterministic_breakdown": {"final_score": 62, "notes": SECRET},
    "contact_information": {
        "email": {"present": "true"},
        "linkedin": {"present": "false", "explanation": "Add your LinkedIn URL"},
    },
    "sections": {
        "experience": {"present": "true"},
        "chronological_dates": {"passed": "false", "explanation": "Dates are out of order"},
    },
    "experience": {
        "quantified_impact": {"passed": "false", "explanation": SECRET, "action": SECRET, "evidence": [SECRET]},
        "job_titles": {"present": "true", "found": [SECRET]},
    },
    "spelling_and_grammar": {"spelling": {"passed": "false", "explanation": SECRET, "errors": [SECRET]}},
    "skills": {
        "hard_skills": {"matched": ["SQL", "Excel"], "missing": ["Tableau", "Power BI", "Python"]},
        "soft_skills": {"matched": ["Communication"], "missing": []},
    },
    "top_priority_fixes": [
        {"issue": "Add Tableau", "action": "Mention the dashboard project"},
        {"issue": SECRET, "action": SECRET},
        {"issue": SECRET, "action": SECRET},
    ],
    "some_future_block": {"passed": "true", "explanation": SECRET},
    "raw_text": SECRET,
}


def test_no_paid_content_leaks():
    out = json.dumps(redact_ats_for_lock(FULL, "tok"))
    assert SECRET not in out, out
    for skill in ("SQL", "Excel", "Tableau", "Power BI", "Python", "Communication"):
        assert f'"{skill}"' not in out, f"skill name {skill} leaked"


def test_keeps_what_the_locked_page_shows():
    out = redact_ats_for_lock(FULL, "tok")
    assert (out["match_rate"], out["match_level"], out["has_portfolio"]) == (62, "Good", True)
    assert out["locked"] is True and out["report_id"] == "tok"
    assert out["job_title_match"] == {"job_title_in_jd": "Data Analyst"}
    # Check shape survives, so category bars and "N issues to fix" are real.
    assert out["experience"] == {"quantified_impact": {"passed": "false"}, "job_titles": {"present": "true"}}
    assert out["spelling_and_grammar"] == {"spelling": {"passed": "false"}}
    # Skill counts survive; names don't.
    assert out["skills"]["hard_skills"] == {"matched": [LOCKED_SKILL] * 2, "missing": [LOCKED_SKILL] * 3}
    assert out["skills"]["soft_skills"] == {"matched": [LOCKED_SKILL], "missing": []}
    # Fix #1 in full, the rest as placeholders (count kept).
    fixes = out["top_priority_fixes"]
    assert fixes[0] == {"issue": "Add Tableau", "action": "Mention the dashboard project"}
    assert len(fixes) == 3 and all(SECRET not in json.dumps(f) for f in fixes[1:])


def test_searchability_is_sent_in_full():
    out = redact_ats_for_lock(FULL, "tok")
    assert out["contact_information"] == FULL["contact_information"]
    assert out["sections"]["chronological_dates"]["explanation"] == "Dates are out of order"


def test_input_not_mutated_and_empty_input_safe():
    before = json.dumps(FULL, sort_keys=True)
    redact_ats_for_lock(FULL, "tok")
    assert json.dumps(FULL, sort_keys=True) == before
    out = redact_ats_for_lock({}, "tok")
    assert out["locked"] and out["top_priority_fixes"] == []
    assert out["skills"]["hard_skills"] == {"matched": [], "missing": []}


if __name__ == "__main__":
    test_no_paid_content_leaks()
    test_keeps_what_the_locked_page_shows()
    test_searchability_is_sent_in_full()
    test_input_not_mutated_and_empty_input_safe()
    print("test_ats_lock.py: ok")
