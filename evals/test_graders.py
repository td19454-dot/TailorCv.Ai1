"""Tests for the eval graders.

The harness exists to decide which model to ship. If a grader silently returns
100 for everything, the harness would confidently recommend the cheaper model
and nobody would notice - so each grader is checked against a payload carrying
the exact defect it is supposed to catch, and against a clean one.

No external services and no API keys required (the graders are pure functions).
Run:  python evals/test_graders.py
"""

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import graders


# --------------------------------------------------------------------------- #
# Shared material
# --------------------------------------------------------------------------- #

RESUME = """PRIYA RAMANATHAN
priya@example.com | github.com/priyaram

EXPERIENCE
Data Analyst Intern
Nexora Retail Solutions | Jan 2025 - Jun 2025
- Worked on cleaning sales data from 14 stores using Python and Pandas.

PROJECTS
Sentiment Analyzer | github.com/priyaram/yt-sentiment
- Built a classifier in Python with scikit-learn over 10,000 comments at 91% accuracy.

SKILLS
Python, SQL, Pandas, scikit-learn
"""

JD = """Data Analyst
Proficiency in Python and Pandas.
Strong SQL skills with PostgreSQL.
Hands-on experience building dashboards in Power BI or Tableau.
"""

META = {
    "expected_counts": {"experience": 1, "projects": 1},
    "expected_entry_names": ["nexora", "sentiment"],
    "unevidenced_jd_skills": ["Power BI", "Tableau"],
}

CLEAN = {
    "name": "Priya Ramanathan",
    "contact": {"github": "github.com/priyaram"},
    "summary": "Data analyst with Python and SQL experience.",
    "skills": ["Python", "SQL", "Pandas", "scikit-learn"],
    "experience": [{
        "title": "Data Analyst Intern", "company": "Nexora Retail Solutions",
        "bullets": ["Analyzed sales data from 14 stores using Python and Pandas."],
    }],
    "projects": [{
        "name": "Sentiment Analyzer", "github_link": "github.com/priyaram/yt-sentiment",
        "bullets": ["Built a classifier in Python with scikit-learn over 10,000 comments at 91% accuracy."],
    }],
}


def _copy(extra: dict) -> dict:
    import json
    out = json.loads(json.dumps(CLEAN))
    out.update(extra)
    return out


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #

def test_schema_accepts_clean_payload():
    assert graders.grade_schema(CLEAN)["valid"], graders.grade_schema(CLEAN)["problems"]


def test_schema_catches_non_string_bullet():
    bad = _copy({"experience": [{"company": "X", "bullets": [{"text": "oops"}]}]})
    result = graders.grade_schema(bad)
    assert not result["valid"], "dict-in-bullets should fail schema"
    assert result["score"] < 100


# --------------------------------------------------------------------------- #
# Preservation - the worst failure mode
# --------------------------------------------------------------------------- #

def test_preservation_full_marks_when_nothing_dropped():
    result = graders.grade_preservation(CLEAN, META)
    assert result["entries_dropped"] == 0, result
    assert result["score"] == 100.0, result


def test_preservation_detects_dropped_entry():
    bad = _copy({"projects": []})
    result = graders.grade_preservation(bad, META)
    assert result["entries_dropped"] == 1, result
    assert "sentiment" in result["dropped_names"], result
    assert result["score"] < 100


# --------------------------------------------------------------------------- #
# Fabrication
# --------------------------------------------------------------------------- #

def test_fabrication_clean_when_facts_match_original():
    result = graders.grade_fabrication(CLEAN, RESUME)
    assert result["clean"], result["examples"]
    assert result["score"] == 100.0


def test_fabrication_catches_invented_employer():
    bad = _copy({"experience": [{"company": "Goldman Sachs", "bullets": ["Analyzed data."]}]})
    result = graders.grade_fabrication(bad, RESUME)
    assert not result["clean"], "invented employer not caught"
    assert result["by_type"].get("company") == 1, result["by_type"]
    assert result["score"] <= 60, result["score"]


def test_fabrication_catches_invented_metric():
    bad = _copy({"projects": [{
        "name": "Sentiment Analyzer",
        "bullets": ["Built a classifier improving revenue by 37% across 88 clients."],
    }]})
    result = graders.grade_fabrication(bad, RESUME)
    assert not result["clean"], "invented numbers not caught"


# --------------------------------------------------------------------------- #
# Skill gating - Rule01 compliance, measured on raw model output
# --------------------------------------------------------------------------- #

def test_gating_passes_when_model_omits_unevidenced_skills():
    result = graders.grade_skill_gating(CLEAN, RESUME, JD, META)
    assert result["declared_gaps_leaked"] == [], result
    assert result["unevidenced_in_skills"] == [], result
    assert result["score"] == 100.0


def test_gating_catches_unevidenced_skill_in_skills_array():
    bad = _copy({"skills": ["Python", "SQL", "Power BI", "Tableau"]})
    result = graders.grade_skill_gating(bad, RESUME, JD, META)
    assert "Power BI" in result["declared_gaps_leaked"], result
    assert "Tableau" in result["declared_gaps_leaked"], result
    assert result["score"] == 0.0, result["score"]


def test_gating_flags_phrases_that_are_not_technologies():
    bad = _copy({"skills": ["Python", "cross-functional stakeholder communication skills"]})
    result = graders.grade_skill_gating(bad, RESUME, JD, META)
    assert result["phrase_not_technology"], "Rule01b phrase not flagged"


# --------------------------------------------------------------------------- #
# Bullet quality
# --------------------------------------------------------------------------- #

def test_bullets_reward_strong_verbs_and_metrics():
    result = graders.grade_bullets(CLEAN, JD)
    assert result["strong_verb_pct"] == 100.0, result
    assert result["quantified_pct"] == 100.0, result


def test_bullets_penalise_weak_openers():
    bad = _copy({"experience": [{"company": "Nexora Retail Solutions", "bullets": [
        "Worked on cleaning sales data.",
        "Helped the team with reports.",
    ]}], "projects": []})
    result = graders.grade_bullets(bad, JD)
    assert result["weak_opener_count"] == 2, result
    assert result["strong_verb_pct"] == 0.0, result


def test_bullets_flag_keyword_stuffing():
    bad = _copy({"experience": [{"company": "Nexora Retail Solutions", "bullets": [
        "Analyzed data using Python, Pandas, SQL and PostgreSQL for dashboards.",
    ]}], "projects": []})
    result = graders.grade_bullets(bad, JD)
    assert result["keyword_stuffed_pct"] == 100.0, result


def test_bullets_flag_overlong():
    long_bullet = "Developed " + " ".join(["word"] * 45)
    bad = _copy({"experience": [{"company": "X", "bullets": [long_bullet]}], "projects": []})
    result = graders.grade_bullets(bad, JD)
    assert result["overlong_pct"] == 100.0, result


# --------------------------------------------------------------------------- #
# Links and cleanliness
# --------------------------------------------------------------------------- #

def test_links_detects_lost_url():
    bad = _copy({"projects": [{"name": "Sentiment Analyzer", "bullets": ["Built a classifier."]}]})
    result = graders.grade_links(bad, RESUME)
    assert result["lost"], "dropped github link not detected"
    assert result["score"] < 100


def test_links_full_marks_when_preserved():
    assert graders.grade_links(CLEAN, RESUME)["score"] == 100.0


def test_cleanliness_catches_pronouns_and_markers():
    bad = _copy({"experience": [{"company": "X", "bullets": [
        "- Developed my own pipeline.",
    ]}], "projects": []})
    result = graders.grade_cleanliness(bad)
    assert result["pronoun_usages"] == 1, result
    assert result["leading_bullet_chars"] == 1, result
    assert result["score"] < 100


def test_cleanliness_catches_unbalanced_parens():
    bad = _copy({"experience": [{"company": "X", "bullets": [
        "Developed a pipeline (Redux",
    ]}], "projects": []})
    assert graders.grade_cleanliness(bad)["unbalanced_parens"] == 1


# --------------------------------------------------------------------------- #
# Composite
# --------------------------------------------------------------------------- #

def test_composite_ranks_clean_above_defective():
    good = graders.grade_all(CLEAN, CLEAN, RESUME, JD, META)
    bad_payload = _copy({
        "skills": ["Python", "Power BI", "Tableau"],
        "experience": [{"company": "Goldman Sachs", "bullets": ["Worked on stuff."]}],
        "projects": [],
    })
    bad = graders.grade_all(bad_payload, bad_payload, RESUME, JD, META)
    assert good["composite"] > bad["composite"], (good["composite"], bad["composite"])
    assert good["composite"] >= 85, good["composite"]


def test_composite_is_deterministic():
    a = graders.grade_all(CLEAN, CLEAN, RESUME, JD, META)["composite"]
    b = graders.grade_all(CLEAN, CLEAN, RESUME, JD, META)["composite"]
    assert a == b, (a, b)


def main_runner() -> int:
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    passed, failures = 0, []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures.append(t.__name__)
            print(f"  FAIL  {t.__name__}: {exc}")
            traceback.print_exc()
    print(f"\n{passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main_runner())
