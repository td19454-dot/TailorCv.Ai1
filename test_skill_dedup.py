"""Regression tests for skill deduplication and the fabrication guard.

Covers the two defects found in QA on a real optimized resume, which turned out
to share one root cause - a source-side typo, "Java Script":

  1. A fabricated "Java" shipped in the skills line. The JD asked for "Python,
     Java, Go, or Node.js"; the resume never said Java. The strip that exists
     to catch exactly this was bypassed because _skill_in_source_resume()
     regexed the raw document, and "\\bjava\\b" matches inside "Java Script".

  2. Duplicate spellings on one row: FastAPI/Fast Api, Pandas/Panda,
     JavaScript/Java Script, Matplotlib/Matpotlib. Dedup keyed on the canonical
     form, which preserves spaces because skill_categories.TERM_INDEX needs
     them, so the spaced spellings survived as separate members.

The retention cases in test_source_skills_are_never_stripped() are the reason
the exemption being narrowed here exists at all - the comments in
inject_jd_hard_skills record the strip deleting Django, Flask and
Stable-Baselines3 from real resumes. Narrowing the exemption must not bring
that back.

Run:  python test_skill_dedup.py
Exit code is non-zero if any test fails (CI-friendly).
"""

import sys
import traceback

from functions import (
    _dedupe_skill_key,
    _skill_in_source_resume,
    correct_skill_spelling,
    inject_jd_hard_skills,
    sanitize_resume_data,
)

# A resume whose skills line carries the "Java Script" typo and no Java.
RESUME_WITH_TYPO = """Trisha Dey
Backend Engineer

TECHNICAL SKILLS
Languages: Python, HTML, CSS, Java Script, SQL
Frameworks: FastAPI, Pandas, NumPy, Seaborn
Tools: Git, Docker, Playwright, Sentry

EXPERIENCE
TailorCV - Co-founder
- Built a resume tailoring pipeline in Python and FastAPI.
"""

BACKEND_JD = """Backend Software Engineer

We are looking for an engineer with strong experience in Python, Java, Go, or
Node.js. You will build REST APIs and work with PostgreSQL and Docker.
"""


# --------------------------------------------------------------------------- #
# The dedupe key
# --------------------------------------------------------------------------- #
def test_spacing_variants_collapse():
    for a, b in (("FastAPI", "Fast Api"),
                 ("JavaScript", "Java Script"),
                 ("PostgreSQL", "postgres sql"),
                 ("Node.js", "NodeJS")):
        assert _dedupe_skill_key(a) == _dedupe_skill_key(b), (a, b)


def test_typos_collapse_onto_the_real_spelling():
    for a, b in (("Matplotlib", "Matpotlib"),
                 ("Pandas", "Panda"),
                 ("NumPy", "Numpny"),
                 ("PostgreSQL", "Postgressql")):
        assert _dedupe_skill_key(a) == _dedupe_skill_key(b), (a, b)


def test_java_and_javascript_are_never_the_same_skill():
    """The whole fix depends on this staying false."""
    assert _dedupe_skill_key("Java") != _dedupe_skill_key("JavaScript")
    assert _dedupe_skill_key("Java") != _dedupe_skill_key("Java Script")


def test_distinct_skills_stay_distinct():
    keys = [_dedupe_skill_key(s) for s in
            ("Python", "Java", "SQL", "MySQL", "PostgreSQL", "Go", "R", "C", "C++")]
    assert len(keys) == len(set(keys)), keys


# --------------------------------------------------------------------------- #
# sanitize_resume_data dedup
# --------------------------------------------------------------------------- #
def test_duplicate_spellings_collapse_to_one_entry():
    data = sanitize_resume_data({
        "skills": ["FastAPI", "Pandas", "NumPy", "Seaborn", "Fast Api", "Matpotlib"]
    })
    keys = [_dedupe_skill_key(s) for s in data["skills"]]
    assert len(keys) == len(set(keys)), data["skills"]
    assert len(data["skills"]) == 5, data["skills"]


def test_dedup_keeps_the_better_spelling():
    data = sanitize_resume_data({"skills": ["Fast Api", "FastAPI"]})
    assert data["skills"] == ["FastAPI"], data["skills"]

    data = sanitize_resume_data({"skills": ["Panda", "Pandas"]})
    assert data["skills"] == ["Pandas"], data["skills"]


def test_a_lone_typo_is_corrected_not_just_deduped():
    """Dedup cannot reach a typo with no correct spelling beside it.

    "Panda" collapses onto "Pandas" only because both were present. A resume
    carrying just "Matpotlib" has nothing to merge into, so without an explicit
    correction the misspelling renders on the finished PDF - laundered through
    our optimizer and shipped to a recruiter.
    """
    data = sanitize_resume_data({"skills": ["FastAPI", "Matpotlib", "NumPy"]})
    assert "Matplotlib" in data["skills"], data["skills"]
    assert "Matpotlib" not in data["skills"], data["skills"]


def test_spelling_correction_never_rewrites_an_unknown_name():
    """The dangerous half: correcting a real name we simply do not know."""
    for name in ("Matplotlib", "Pandas", "Python", "Aerospike", "Zapier",
                 "FooBarDB", "TailorCV", "C", "R", "Go", "scikit-learn",
                 "NumPy", "Neon", "Polar"):
        assert correct_skill_spelling(name) == name, name


def test_conventional_casing_wins_over_casual_casing():
    """Spellings taken verbatim from the real source resume.

    "Power Bi", "Mysql", "Postgresql" and "Html" all have a capital letter, so
    they tied with the conventional form on every earlier test and won on
    length or arrival order - which spelling shipped was luck, not logic.
    """
    for casual, conventional in (("Power Bi", "Power BI"),
                                 ("Mysql", "MySQL"),
                                 ("Postgresql", "PostgreSQL"),
                                 ("Html", "HTML"),
                                 ("Css", "CSS"),
                                 ("Sql", "SQL"),
                                 ("Fast Api", "FastAPI")):
        for order in ((casual, conventional), (conventional, casual)):
            got = sanitize_resume_data({"skills": list(order)})["skills"]
            assert got == [conventional], (order, got)


def test_javascript_typo_does_not_double_up():
    data = sanitize_resume_data({"skills": ["JavaScript", "Java Script"]})
    assert len(data["skills"]) == 1, data["skills"]


# --------------------------------------------------------------------------- #
# The fabrication guard
# --------------------------------------------------------------------------- #
def test_java_script_does_not_evidence_java():
    """The precise bug: 'Java Script' in the source must not claim 'Java'."""
    assert _skill_in_source_resume(RESUME_WITH_TYPO, "Java Script") is True
    assert _skill_in_source_resume(RESUME_WITH_TYPO, "JavaScript") is True
    assert _skill_in_source_resume(RESUME_WITH_TYPO, "Java") is False


def test_source_skills_are_never_stripped():
    """Retention cases the exemption exists for - must survive the narrowing."""
    resume = """SKILLS
Languages: Python, C
Frameworks: Django, Flask, Stable-Baselines3, PineconeDB
"""
    for skill in ("Django", "Flask", "Stable-Baselines3", "PineconeDB", "Python", "C"):
        assert _skill_in_source_resume(resume, skill) is True, skill


def test_fabricated_jd_skill_is_stripped_and_reported():
    """End to end: the model claims Java, the JD asks for Java, resume has neither."""
    data = inject_jd_hard_skills(
        {"skills": ["Python", "HTML", "CSS", "JavaScript", "SQL", "Java"]},
        BACKEND_JD,
        resume_text=RESUME_WITH_TYPO,
        jd_skills=["Python", "Java", "Go", "Node.js", "PostgreSQL", "Docker"],
    )
    shipped = [s.lower() for s in data["skills"]]
    assert "java" not in shipped, data["skills"]
    assert any("javascript" in s or "java script" in s for s in shipped), data["skills"]
    gaps = [g.lower() for g in data.get("skill_gaps", [])]
    assert "java" in gaps, data.get("skill_gaps")


def test_evidenced_skills_still_survive_the_pipeline():
    data = inject_jd_hard_skills(
        {"skills": ["Python", "FastAPI", "Docker"]},
        BACKEND_JD,
        resume_text=RESUME_WITH_TYPO,
        jd_skills=["Python", "Docker", "PostgreSQL"],
    )
    shipped = [s.lower() for s in data["skills"]]
    for skill in ("python", "fastapi", "docker"):
        assert skill in shipped, (skill, data["skills"])


def test_no_duplicate_keys_survive_the_full_pipeline():
    data = inject_jd_hard_skills(
        {"skills": ["Python", "FastAPI", "Fast Api", "JavaScript", "Java Script",
                    "Pandas", "Panda", "Matplotlib", "Matpotlib"]},
        BACKEND_JD,
        resume_text=RESUME_WITH_TYPO,
        jd_skills=["Python"],
    )
    data = sanitize_resume_data(data)
    keys = [_dedupe_skill_key(s) for s in data["skills"]]
    assert len(keys) == len(set(keys)), data["skills"]


tests = [
    test_spacing_variants_collapse,
    test_typos_collapse_onto_the_real_spelling,
    test_java_and_javascript_are_never_the_same_skill,
    test_distinct_skills_stay_distinct,
    test_duplicate_spellings_collapse_to_one_entry,
    test_dedup_keeps_the_better_spelling,
    test_a_lone_typo_is_corrected_not_just_deduped,
    test_spelling_correction_never_rewrites_an_unknown_name,
    test_conventional_casing_wins_over_casual_casing,
    test_javascript_typo_does_not_double_up,
    test_java_script_does_not_evidence_java,
    test_source_skills_are_never_stripped,
    test_fabricated_jd_skill_is_stripped_and_reported,
    test_evidenced_skills_still_survive_the_pipeline,
    test_no_duplicate_keys_survive_the_full_pipeline,
]


if __name__ == "__main__":
    passed = failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {fn.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed}/{passed + failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
