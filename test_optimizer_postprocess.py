"""Golden tests for the resume optimizer's deterministic post-processing.

These guard the non-LLM steps that run on every optimization (JD skill
extraction, skill injection, and the final sanitizer) so regressions like the
"state management (Redux" broken-parentheses bug get caught here instead of on a
real user's resume.

No external services and no API keys required.

Run:  python test_optimizer_postprocess.py
Exit code is non-zero if any test fails (CI-friendly).
"""

import sys
import traceback
from datetime import date

from functions import (
    _balance_parentheses,
    _clean_inline_text,
    _extract_hard_skills_from_jd,
    _repair_false_future_chronology,
    inject_jd_hard_skills,
    sanitize_resume_data,
)


# The exact shape that produced the production bug: a categorized skills line
# with comma-separated items *inside* parentheses.
CATEGORIZED_JD = (
    "Required skills: modern JavaScript (ES6+, ESNext), state management "
    "(Redux, Zustand, Pinia), build tools (Webpack, Vite), SSR/SSG frameworks "
    "(Next.js). Experience with React and FastAPI required."
)

ATOMIC_SKILLS_JD = """
Knowledge of MLOps tools (Kubeflow, Airflow).
Experience with cloud platforms such as AWS, GCP, and Azure.
Experience in backend development and software engineering with an ML focus.
Required skills: Prompt Engineering, LLM Fine Tuning, Vector Databases, NoSQL,
ETL Pipelines, Data Structures and Algorithms, Kafka, RabbitMQ.
"""


def _has_unbalanced_parens(s: str) -> bool:
    return s.count("(") != s.count(")")


# --------------------------------------------------------------------------- #
# Unit: _balance_parentheses
# --------------------------------------------------------------------------- #
def test_balance_parens_drops_unmatched_open():
    assert _balance_parentheses("state management (Redux") == "state management Redux"


def test_balance_parens_drops_unmatched_close():
    assert _balance_parentheses("Vite)") == "Vite"


def test_balance_parens_keeps_matched_pair():
    assert _balance_parentheses("JavaScript (ES6+)") == "JavaScript (ES6+)"


def test_balance_parens_nested():
    assert _balance_parentheses("a (b (c) d") == "a b (c) d"


# --------------------------------------------------------------------------- #
# Unit: _clean_inline_text
# --------------------------------------------------------------------------- #
def test_clean_strips_leading_bullet():
    assert _clean_inline_text("• React") == "React"
    assert _clean_inline_text("- Vue.js") == "Vue.js"


def test_clean_balances_and_tidies():
    assert _clean_inline_text("state management (Redux") == "state management Redux"


def test_clean_preserves_special_skill_names():
    for skill in ("C++", "C#", "Node.js", "scikit-learn", "ASP.NET"):
        assert _clean_inline_text(skill) == skill, skill


# --------------------------------------------------------------------------- #
# Regression: JD extraction must never emit unbalanced parentheses
# --------------------------------------------------------------------------- #
def test_jd_extraction_no_unbalanced_parens():
    out = _extract_hard_skills_from_jd(CATEGORIZED_JD)
    broken = [s for s in out if _has_unbalanced_parens(s)]
    assert not broken, f"unbalanced fragments leaked: {broken}"


def test_jd_extraction_finds_real_techs():
    out = {s.lower() for s in _extract_hard_skills_from_jd(CATEGORIZED_JD)}
    for tech in ("redux", "zustand", "pinia", "webpack", "vite", "react", "fastapi"):
        assert tech in out, f"expected to extract '{tech}', got {sorted(out)}"


def test_jd_extraction_explodes_mlops_parenthetical():
    out = {skill.lower() for skill in _extract_hard_skills_from_jd(ATOMIC_SKILLS_JD)}
    assert "kubeflow" in out
    assert "airflow" in out
    assert "mlops tools" not in out


def test_jd_extraction_keeps_concrete_cloud_platforms_only():
    out = {skill.lower() for skill in _extract_hard_skills_from_jd(ATOMIC_SKILLS_JD)}
    assert {"aws", "gcp", "azure"}.issubset(out)
    assert "cloud platforms" not in out


def test_jd_extraction_removes_generic_engineering_phrases():
    out = {skill.lower() for skill in _extract_hard_skills_from_jd(ATOMIC_SKILLS_JD)}
    assert "backend development" not in out
    assert "software engineering" not in out
    assert "software engineering with an ml focus" not in out
    assert "ml focus" not in out


def test_jd_extraction_keeps_extended_atomic_vocabulary():
    out = {skill.lower() for skill in _extract_hard_skills_from_jd(ATOMIC_SKILLS_JD)}
    expected = {
        "prompt engineering", "llm fine tuning", "vector databases", "nosql",
        "etl pipelines", "data structures and algorithms", "kafka", "rabbitmq",
    }
    assert expected.issubset(out), f"missing {sorted(expected - out)} from {sorted(out)}"


# --------------------------------------------------------------------------- #
# Sanitizer: skills
# --------------------------------------------------------------------------- #
def test_sanitize_balances_skill_parens():
    data = {"skills": ["state management (Redux", "build tools (Webpack", "Vite)"]}
    out = sanitize_resume_data(data)["skills"]
    assert not any(_has_unbalanced_parens(s) for s in out), out


def test_sanitize_dedupes_case_insensitively():
    data = {"skills": ["Python", "python", "PYTHON", "React"]}
    assert sanitize_resume_data(data)["skills"] == ["Python", "React"]


def test_sanitize_strips_bullets_and_empties():
    data = {"skills": ["• React", "- Vue.js", "", "   ", "x" * 200]}
    assert sanitize_resume_data(data)["skills"] == ["React", "Vue.js"]


def test_sanitize_preserves_order():
    data = {"skills": ["Go", "Rust", "Python"]}
    assert sanitize_resume_data(data)["skills"] == ["Go", "Rust", "Python"]


def test_sanitize_removes_generic_skills_but_preserves_atomic_skills():
    data = {
        "skills": [
            "backend development", "Python", "cloud platforms", "AWS",
            "software engineering with an ML focus", "Kubeflow", "MLOps tools",
            "backend development with Python",
        ]
    }
    assert sanitize_resume_data(data)["skills"] == ["Python", "AWS", "Kubeflow"]


def test_sanitize_removes_short_requirement_prose():
    data = {
        "skills": [
            "Kotlin", "Material Design", "Material Design guidelines",
            "CD for mobile", "RAG", "data science", "a related field",
            "XGBoost", "working with large datasets", "PostgreSQL",
            "a related role", "R for data analysis", "data warehouses",
        ]
    }
    assert sanitize_resume_data(data)["skills"] == [
        "Kotlin", "Material Design", "RAG", "XGBoost", "PostgreSQL",
    ]


def test_chronology_repairs_past_date_marked_as_future():
    data = {
        "sections": {
            "chronological_dates": {
                "passed": "false",
                "explanation": (
                    "Alignerr has a start date of Jan 2026, which is in the future."
                ),
            }
        }
    }
    _repair_false_future_chronology(data, date(2026, 7, 4))
    chronology = data["sections"]["chronological_dates"]
    assert chronology["passed"] == "true"
    assert "not in the future" in chronology["explanation"]


def test_chronology_preserves_actual_future_date_failure():
    data = {
        "sections": {
            "chronological_dates": {
                "passed": "false",
                "explanation": "Alignerr starts in Jan 2027, which is in the future.",
            }
        }
    }
    _repair_false_future_chronology(data, date(2026, 7, 4))
    assert data["sections"]["chronological_dates"]["passed"] == "false"


# --------------------------------------------------------------------------- #
# Sanitizer: bullets + summary
# --------------------------------------------------------------------------- #
def test_sanitize_cleans_experience_bullets():
    data = {
        "experience": [
            {"title": "Eng", "bullets": ["• Built API (FastAPI", "- Shipped feature", ""]}
        ]
    }
    bullets = sanitize_resume_data(data)["experience"][0]["bullets"]
    assert bullets == ["Built API FastAPI", "Shipped feature"], bullets


def test_sanitize_cleans_summary():
    data = {"summary": "Engineer (Python"}
    assert not _has_unbalanced_parens(sanitize_resume_data(data)["summary"])


# --------------------------------------------------------------------------- #
# Robustness
# --------------------------------------------------------------------------- #
def test_sanitize_non_dict_passthrough():
    assert sanitize_resume_data("nope") == "nope"
    assert sanitize_resume_data(None) is None


def test_sanitize_missing_sections_ok():
    # Should not raise on a minimal/odd shape.
    sanitize_resume_data({})
    sanitize_resume_data({"skills": "not-a-list"})


# --------------------------------------------------------------------------- #
# End-to-end: inject JD skills then sanitize (mirrors the real pipeline)
# --------------------------------------------------------------------------- #
def test_inject_then_sanitize_end_to_end():
    data = {"skills": ["React", "FastAPI"]}
    data = inject_jd_hard_skills(data, CATEGORIZED_JD)
    data = sanitize_resume_data(data)
    skills = data["skills"]
    # No broken parens anywhere.
    assert not any(_has_unbalanced_parens(s) for s in skills), skills
    # Original skills preserved.
    assert "React" in skills and "FastAPI" in skills
    # New real techs pulled in from the JD.
    joined = " ".join(skills).lower()
    for tech in ("zustand", "pinia", "vite"):
        assert tech in joined, f"missing '{tech}' in {skills}"
    # No exact duplicates (case-insensitive).
    lowered = [s.lower() for s in skills]
    assert len(lowered) == len(set(lowered)), f"duplicates present: {skills}"


def test_atomic_skills_injection_end_to_end():
    data = {
        "skills": [
            "Python", "backend development", "AWS", "cloud platforms",
            "software engineering with an ML focus",
        ]
    }
    out = sanitize_resume_data(inject_jd_hard_skills(data, ATOMIC_SKILLS_JD))["skills"]
    lowered = [skill.lower() for skill in out]

    for skill in ("python", "aws", "gcp", "azure", "kubeflow", "airflow"):
        assert skill in lowered, f"missing '{skill}' in {out}"
    for phrase in (
        "backend development", "cloud platforms", "mlops tools",
        "software engineering with an ml focus", "ml focus",
    ):
        assert phrase not in lowered, f"generic phrase leaked: '{phrase}' in {out}"
    assert len(lowered) == len(set(lowered)), f"duplicates present: {out}"


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
