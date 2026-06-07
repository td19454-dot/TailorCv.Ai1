"""Golden tests for the deterministic ATS score breakdown.

The ATS score is the product's core promise, so its math must be stable. These
lock the section weights (they must total 100), the match-ratio scaling, the
"true"-only truthiness contract of bool_score, and robustness against malformed
input — so a refactor or prompt-schema change can't silently move users' scores.

No external services and no API keys required.

Run:  python test_ats_scoring.py
Exit code is non-zero if any test fails (CI-friendly).
"""

import sys
import traceback

from functions import bool_score, compute_deterministic_ats_score_breakdown


def _score(parsed, resume_text=""):
    return compute_deterministic_ats_score_breakdown(parsed, resume_text)["final_score"]


def _perfect_parsed() -> dict:
    """A resume that should pass every deterministic check -> exactly 100.0."""
    return {
        "contact_information": {
            "email": {"present": True},
            "phone": {"present": True},
            "linkedin": {"present": True},
        },
        "sections": {
            "projects": {"present": True},
            "experience": {"present": True},
            "skills": {"present": True},
            "education": {"present": True},
            "chronological_dates": {"passed": True},
        },
        "skills": {
            "hard_skills": {"matched": ["python", "fastapi"], "missing": []},
            "soft_skills": {"matched": ["teamwork"], "missing": []},
        },
        "experience": {
            "experience_match": {"passed": True},
            "company_names": {"present": True},
            "job_titles": {"present": True},
            "action_verbs": {"passed": True},
            "quantified_impact": {"passed": True},
        },
        "projects": {
            "project_links": {"passed": True},
            "action_verbs": {"passed": True},
            "quantified_impact": {"passed": True},
        },
        "education": {"qualification_match": {"passed": True}},
        "formatting": {
            "single_column": {"passed": True},
            "photos_or_graphics": {"passed": True},
            "excessive_design": {"passed": True},
            "unnecessary_sections": {"passed": True},
        },
        "spelling_and_grammar": {
            "spelling": {"passed": True},
            "grammar": {"passed": True},
            "buzzwords": {"passed": True},
            "personal_pronouns": {"passed": True},
        },
    }


# --------------------------------------------------------------------------- #
# bool_score contract: ONLY a literal "true" (any case) counts as a pass.
# --------------------------------------------------------------------------- #
def test_bool_score_accepts_true():
    assert bool_score(True) is True
    assert bool_score("true") is True
    assert bool_score("True") is True


def test_bool_score_rejects_other_truthy():
    # These are "truthy" in Python but must NOT count as a passed check.
    for value in (1, "1", "yes", "Y", "present", [1], {"x": 1}):
        assert bool_score(value) is False, value


def test_bool_score_rejects_falsey():
    for value in (False, None, "", "false", 0):
        assert bool_score(value) is False, value


# --------------------------------------------------------------------------- #
# Total weights must sum to exactly 100 (this is the headline guarantee).
# --------------------------------------------------------------------------- #
def test_perfect_resume_scores_100():
    assert _score(_perfect_parsed()) == 100.0


def test_empty_parsed_scores_zero():
    assert _score({}) == 0.0


def test_score_never_exceeds_100_or_below_0():
    assert 0.0 <= _score(_perfect_parsed()) <= 100.0
    assert 0.0 <= _score({}) <= 100.0


# --------------------------------------------------------------------------- #
# Section weights: each block contributes its documented points.
# --------------------------------------------------------------------------- #
def test_contact_block_is_worth_10():
    parsed = {
        "contact_information": {
            "email": {"present": True},
            "phone": {"present": True},
            "linkedin": {"present": True},
        }
    }
    assert _score(parsed) == 10.0  # 4 + 3 + 3


def test_contact_email_only_is_4():
    parsed = {"contact_information": {"email": {"present": True}}}
    assert _score(parsed) == 4.0


def test_education_block_is_worth_5():
    parsed = {"education": {"qualification_match": {"passed": True}}}
    assert _score(parsed) == 5.0


# --------------------------------------------------------------------------- #
# Skills match (25): score scales with the matched / total ratio.
# --------------------------------------------------------------------------- #
def test_skills_full_match_is_25():
    parsed = {"skills": {"hard_skills": {"matched": ["a", "b"], "missing": []}}}
    assert _score(parsed) == 25.0


def test_skills_half_match_is_12_5():
    parsed = {"skills": {"hard_skills": {"matched": ["a"], "missing": ["b"]}}}
    assert _score(parsed) == 12.5


def test_skills_no_data_contributes_nothing():
    # No skills at all must not divide-by-zero or add points.
    assert _score({"skills": {}}) == 0.0


# --------------------------------------------------------------------------- #
# LinkedIn fallback: hyperlinked LinkedIn shows as plain text, so the raw
# resume text is checked even when the parsed contact block misses it.
# --------------------------------------------------------------------------- #
def test_linkedin_detected_from_resume_text():
    parsed = {"contact_information": {"linkedin": {"present": False}}}
    assert _score(parsed, "Connect: linkedin.com/in/jane") == 3.0


def test_no_linkedin_anywhere_scores_zero():
    parsed = {"contact_information": {"linkedin": {"present": False}}}
    assert _score(parsed, "no social links here") == 0.0


# --------------------------------------------------------------------------- #
# Monotonicity: improving a resume must never lower its score.
# --------------------------------------------------------------------------- #
def test_adding_a_matched_skill_does_not_lower_score():
    before = {"skills": {"hard_skills": {"matched": ["a"], "missing": ["b", "c"]}}}
    after = {"skills": {"hard_skills": {"matched": ["a", "b"], "missing": ["c"]}}}
    assert _score(after) >= _score(before)


# --------------------------------------------------------------------------- #
# Robustness: malformed / partial input must never raise.
# --------------------------------------------------------------------------- #
def test_missing_sections_do_not_crash():
    for parsed in ({}, {"skills": {}}, {"contact_information": {}}, {"experience": {}}):
        compute_deterministic_ats_score_breakdown(parsed, "")


def test_return_shape_is_rounded_final_score():
    out = compute_deterministic_ats_score_breakdown(_perfect_parsed(), "")
    assert set(out) == {"final_score"}
    assert isinstance(out["final_score"], float)
    # Rounded to 2 decimals (12.5 half-match style values stay exact).
    assert round(out["final_score"], 2) == out["final_score"]


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    failures = []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception as exc:  # noqa: BLE001 - report every failure
            failures.append((t.__name__, exc))
            print(f"  FAIL  {t.__name__}: {exc}")
            traceback.print_exc()

    print(f"\n{passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
