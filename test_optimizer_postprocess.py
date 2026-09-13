"""Golden tests for the resume optimizer's deterministic post-processing.

These guard the non-LLM steps that run on every optimization (JD skill
extraction, skill injection, and the final sanitizer) so regressions like the
"state management (Redux" broken-parentheses bug get caught here instead of on a
real user's resume.

No external services and no API keys required.

Run:  python test_optimizer_postprocess.py
Exit code is non-zero if any test fails (CI-friendly).
"""

import re
import sys
import traceback
from datetime import date

from functions import (
    _balance_parentheses,
    _clean_inline_text,
    _extract_hard_skills_from_jd,
    _is_atomic_hard_skill,
    _entries_represented,
    _has_concrete_evidence,
    _is_keyword_tail,
    _repair_false_future_chronology,
    _drop_future_date_priority_fixes,
    _summary_quality_issues,
    _summary_sentences,
    repair_summary,
    factcheck_against_original,
    inject_jd_hard_skills,
    inject_links,
    normalize_links,
    promptable_skill_gaps,
    sanitize_resume_data,
    weave_hard_skills_into_bullets,
    weave_soft_skills_into_summary,
)


FACTCHECK_ORIGINAL = """Jane Doe
Software Engineer, Acme Corp, 2021 - 2023
- Built REST APIs in Python
- Reduced page load time by 30%
B.Sc Computer Science, State University, 2020"""


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


# Resumes that genuinely evidence the JD technologies. inject_jd_hard_skills
# only promotes a JD skill into `skills` when the candidate's own resume backs
# it up, so the extraction tests have to supply that evidence.
CATEGORIZED_RESUME = (
    "Built dashboards in React with Redux and Zustand for state. "
    "Migrated the build from Webpack to Vite. Shipped a Next.js SSR app "
    "backed by FastAPI. Also used Pinia on a Vue side project. ES6+ throughout."
)

ATOMIC_SKILLS_RESUME = (
    "ML engineer. Built ETL Pipelines in Python on AWS, GCP and Azure. "
    "Orchestrated training with Kubeflow and Airflow. Streamed events through "
    "Kafka and RabbitMQ. Worked with Vector Databases and NoSQL stores, "
    "Prompt Engineering and LLM Fine Tuning."
)


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
# Honest skills: a JD keyword only enters the resume when the resume evidences
# it. Anything else is keyword-stuffing the candidate has to defend in an
# interview, so it is reported as a gap instead.
# --------------------------------------------------------------------------- #
def test_unevidenced_jd_skill_becomes_a_gap_not_a_skill():
    with confirm_first():
        resume = "Backend engineer. Built REST APIs in Python on AWS."
        jd = "Required: Python, Kubernetes, Terraform."
        out = inject_jd_hard_skills({"skills": ["Python"]}, jd, resume)

        lowered = [s.lower() for s in out["skills"]]
        gaps = [s.lower() for s in out["skill_gaps"]]

        assert "python" in lowered, out["skills"]
        # Never claimed on the resume -> must not appear in skills.
        assert "kubernetes" not in lowered, out["skills"]
        assert "terraform" not in lowered, out["skills"]
        # ...but the candidate is told about them.
        assert "kubernetes" in gaps and "terraform" in gaps, out["skill_gaps"]


def test_evidenced_jd_skill_is_promoted_into_skills():
    # Named in a bullet but absent from the skills list -> safe to surface.
    resume = "Deployed services to a Kubernetes cluster and wrote Terraform modules."
    jd = "Required: Kubernetes, Terraform."
    out = inject_jd_hard_skills({"skills": []}, jd, resume)

    lowered = [s.lower() for s in out["skills"]]
    assert "kubernetes" in lowered and "terraform" in lowered, out["skills"]
    assert out["skill_gaps"] == [], out["skill_gaps"]


class confirm_first:
    """No-op kept so the gated tests below read clearly.

    The skills policy is now chosen per surface by the `auto_add` argument, not
    by a global switch: the website asks the candidate to confirm an unevidenced
    JD skill, the Chrome extension adds it outright. inject_jd_hard_skills
    defaults to the website behaviour, so these tests need no override — they
    pin the evidence gate, which is what stops the MODEL slipping unbacked
    claims into the skills array on the site.
    """

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_practice_platforms_and_chat_assistants_are_not_skills():
    """Real product names that are still not screenable skills.

    These pass every other check — proper nouns, genuinely present in the
    resume — so the evidence gate let them through and a Technical Skills line
    came back reading "Razorpay, Polar, LeetCode, ChatGPT, Gemini".
    """
    for junk in ("LeetCode", "HackerRank", "Codeforces", "ChatGPT", "Gemini",
                 "GitHub Copilot", "Coursera"):
        assert not _is_atomic_hard_skill(junk), f"{junk} accepted as a skill"

    # The underlying capability is still a skill, and so is ordinary tooling.
    for real in ("Python", "Power BI", "PostgreSQL", "Playwright", "Sentry",
                 "PostHog", "Prompt Engineering"):
        assert _is_atomic_hard_skill(real), f"{real} wrongly rejected"


def test_junk_products_never_reach_the_skills_array():
    out = inject_jd_hard_skills(
        {"skills": ["Python", "LeetCode", "ChatGPT", "Gemini", "Power BI"]},
        "Data Analyst. Requires Python, Power BI.",
        "Solved problems on LeetCode. Evaluated ChatGPT and Gemini output. Built Power BI dashboards in Python.",
        jd_skills=["Python", "Power BI"],
        auto_add=False,
    )
    shipped = {s.lower() for s in out["skills"]}
    for junk in ("leetcode", "chatgpt", "gemini"):
        assert junk not in shipped, out["skills"]
    assert {"python", "power bi"}.issubset(shipped), out["skills"]


def test_model_invented_skill_is_stripped_even_when_the_jd_extractor_missed_it():
    """The evidence gate must cover EVERY claim, not just JD-listed ones.

    Only `required_skills` was checked, so a skill the model invented that the
    extractor did not recognise shipped unchallenged — a real resume came back
    listing TorchServe, TF Serving and Dask, none of which appeared anywhere in
    the candidate's document. The extractor demonstrably misses things (it does
    not recognise "SAP"), so "it wasn't in the JD list" is no protection.
    """
    out = inject_jd_hard_skills(
        {"skills": ["Python", "Playwright", "TorchServe", "Dask", "TF Serving"]},
        "ML Engineer. Requires Python, SQL.",          # JD names none of them
        "Built with Python and Playwright.",            # resume evidences neither
        jd_skills=["Python", "SQL"],
        auto_add=False,
    )
    shipped = {s.lower() for s in out["skills"]}
    for invented in ("torchserve", "dask", "tf serving"):
        assert invented not in shipped, f"unbacked claim shipped: {out['skills']}"
    # Real skills survive.
    assert {"python", "playwright"}.issubset(shipped), out["skills"]
    # ...and the stripped ones are offered, not silently binned.
    gaps = {g.lower() for g in out["skill_gaps"]}
    assert {"torchserve", "dask", "tf serving"}.issubset(gaps), out["skill_gaps"]


def test_extension_keeps_unbacked_claims():
    """auto_add=True has no dialog to ask through, so nothing is stripped."""
    out = inject_jd_hard_skills(
        {"skills": ["Python", "TorchServe"]},
        "ML Engineer. Requires Python.",
        "Built with Python.",
        jd_skills=["Python"],
        auto_add=True,
    )
    assert "TorchServe" in out["skills"], out["skills"]


def test_website_and_extension_differ_only_on_evidenced_skills():
    """The two surfaces still differ - the extension promotes evidenced skills
    silently where the website asks - but neither may invent. Previously the
    difference was that the extension added unevidenced JD terms outright."""
    resume = "Built dashboards in Power BI and wrote SQL against Postgres."
    jd = "Data Scientist. Requires Python, SQL, Power BI and Tableau."
    site = inject_jd_hard_skills({"skills": ["Python"]}, jd, resume, auto_add=False)
    ext = inject_jd_hard_skills({"skills": ["Python"]}, jd, resume, auto_add=True)
    site_skills = {s.lower() for s in site["skills"]}
    ext_skills = {s.lower() for s in ext["skills"]}
    # Neither invents the unevidenced JD skill.
    assert "tableau" not in site_skills, site["skills"]
    assert "tableau" not in ext_skills, ext["skills"]
    # Both surface it as a gap rather than a claim.
    assert any("tableau" == str(g).lower() for g in (site.get("skill_gaps") or []))
    assert any("tableau" == str(g).lower() for g in (ext.get("skill_gaps") or []))
    # The surfaces still differ: the extension promotes an evidenced skill
    # without asking, the website routes the unevidenced one to the candidate.
    assert "power bi" in ext_skills and "power bi" in site_skills


def _superseded_website_and_extension_differ_only_in_skills_policy():
    """One engine, two skill policies — the contract between the surfaces.

    Website: an unevidenced JD skill is withheld and offered as a gap, so the
    candidate confirms it. Extension: it goes straight on, because the sidebar
    has no way to ask. Same inputs, same everything else.
    """
    # jd_skills is supplied explicitly so this pins the POLICY, not the JD
    # extractor's vocabulary (which does not currently recognise "SAP").
    data = {"skills": ["Python"]}
    jd = "Required: Python, Tableau, SAP."
    resume = "Backend engineer. Built APIs in Python."
    wanted = ["Python", "Tableau", "SAP"]

    site = inject_jd_hard_skills(dict(data), jd, resume, jd_skills=wanted, auto_add=False)
    ext = inject_jd_hard_skills(dict(data), jd, resume, jd_skills=wanted, auto_add=True)

    site_skills = {s.lower() for s in site["skills"]}
    ext_skills = {s.lower() for s in ext["skills"]}

    # Evidenced skills reach both.
    assert "python" in site_skills and "python" in ext_skills

    # Website withholds and asks.
    assert "tableau" not in site_skills, site["skills"]
    assert {g.lower() for g in site["skill_gaps"]} == {"tableau", "sap"}, site["skill_gaps"]

    # Extension adds and reports.
    assert {"tableau", "sap"}.issubset(ext_skills), ext["skills"]
    assert ext["skill_gaps"] == [], ext["skill_gaps"]
    assert {s.lower() for s in ext["skills_added_from_jd"]} == {"tableau", "sap"}


def test_extension_policy_never_adds_an_unevidenced_jd_skill():
    """The extension may promote skills silently, but it may NEVER invent one.

    This branch used to append every JD term unconditionally. On a real resume
    that wrote XGBoost, Seaborn, Tableau, SageMaker and Vertex AI onto a
    candidate who names none of them - read straight off the target posting.
    Unevidenced JD skills now become gaps on BOTH surfaces.
    """
    resume = "Built dashboards in Power BI and wrote SQL against Postgres."
    jd = "Data Scientist. Requires Python, SQL, Power BI, XGBoost, Seaborn and Tableau."
    out = inject_jd_hard_skills({"skills": ["Python"]}, jd, resume, auto_add=True)
    final = {s.lower() for s in out["skills"]}
    for invented in ("xgboost", "seaborn", "tableau"):
        assert invented not in final, (invented, out["skills"])
    # Evidenced JD skills are still promoted without asking.
    assert "power bi" in final, out["skills"]


def _superseded_extension_policy_adds_every_jd_skill():
    """auto_add=True (Chrome extension): no confirmation step, nothing held back."""
    out = inject_jd_hard_skills(
        {"skills": ["Python"]},
        "Required: SQL, Power BI, Tableau, SAP.",
        "Skills: Python, SQL",
        jd_skills=["SQL", "Power BI", "Tableau", "SAP"],
        auto_add=True,
    )
    lowered = {s.lower() for s in out["skills"]}
    for skill in ("sql", "power bi", "tableau", "sap"):
        assert skill in lowered, f"{skill} missing from {out['skills']}"
    assert out["skill_gaps"] == [], "nothing should be left to ask the user"


def test_no_resume_text_means_every_jd_skill_is_a_gap():
    with confirm_first():
        # Fail closed: with nothing to check against we must not invent claims.
        out = inject_jd_hard_skills({"skills": []}, "Required: Kubernetes, Terraform.")
        assert out["skills"] == [], out["skills"]
        assert len(out["skill_gaps"]) == 2, out["skill_gaps"]


def test_model_claimed_unevidenced_jd_skill_is_stripped():
    with confirm_first():
        # Regression: the gating loop used to `continue` when a JD skill was already
        # in the model's skills array, so a skill the model invented was neither
        # evidence-checked nor reported. The candidate shipped a claim they could not
        # defend AND was never told about it. Caught by evals/run_eval.py, where
        # gpt-4o-mini put "Power BI" on a resume with no Power BI anywhere.
        resume = "Analyst. Built dashboards in Excel and wrote SQL against PostgreSQL."
        jd = "Required: SQL, Power BI, Tableau."
        out = inject_jd_hard_skills({"skills": ["SQL", "Power BI", "Tableau"]}, jd, resume)

        lowered = [s.lower() for s in out["skills"]]
        gaps = [s.lower() for s in out["skill_gaps"]]

        assert "sql" in lowered, out["skills"]
        # The model asserted these; the resume evidences neither -> stripped.
        assert "power bi" not in lowered, out["skills"]
        assert "tableau" not in lowered, out["skills"]
        # ...and the candidate is told, instead of being silently credited.
        assert "power bi" in gaps and "tableau" in gaps, out["skill_gaps"]


def test_model_claimed_skill_survives_when_resume_evidences_it():
    with confirm_first():
        # The strip must not fire on a genuine claim: same shape as above, but the
        # resume actually names Power BI.
        resume = "Analyst. Published Power BI dashboards for regional leadership."
        jd = "Required: Power BI, Tableau."
        out = inject_jd_hard_skills({"skills": ["Power BI", "Tableau"]}, jd, resume)

        lowered = [s.lower() for s in out["skills"]]
        assert "power bi" in lowered, out["skills"]
        assert "tableau" not in lowered, out["skills"]
        assert [s.lower() for s in out["skill_gaps"]] == ["tableau"], out["skill_gaps"]


def test_no_resume_text_leaves_model_skills_alone():
    # With nothing to check against, stripping the model's whole skills list
    # would destroy real content, so the claims are left in place.
    out = inject_jd_hard_skills({"skills": ["Python", "Kubernetes"]}, "Required: Kubernetes.", "")
    assert [s.lower() for s in out["skills"]] == ["python", "kubernetes"], out["skills"]


# --------------------------------------------------------------------------- #
# promptable_skill_gaps: which gaps are fit to show a candidate.
#
# skill_gaps comes from _extract_hard_skills_from_jd, which emits sentence
# fragments next to real technologies. Asking "do you have another cloud data
# warehouse?" makes the feature look broken, so the display list is filtered.
# The filter is deliberately conservative - a dropped gap can never be claimed.
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# Link LABELS are not links. Resumes render URLs as anchor text ("Live Demo |
# GitHub") and the model transcribes what it sees, returning url="Live Demo".
# That counted as "this project already has a link", so the real URLs recovered
# from the PDF annotations were never injected - a project showed no links while
# its neighbour, whose row read only "GitHub", kept them. Reproduced on a live
# run against the real resume before this was fixed.
# --------------------------------------------------------------------------- #
def test_label_text_in_url_field_does_not_block_injection():
    data = {"projects": [{"name": "Tailorcv.com", "url": "Live Demo", "github_link": "GitHub"}]}
    out = inject_links(data, {"Tailorcv.com": [
        ("Link", "https://www.thetailorcv.com"),
        ("GitHub", "https://github.com/td19454-dot/TailorCv.Ai1"),
    ]}, [])
    hrefs = {l["url"] for l in out["projects"][0]["links"]}
    assert hrefs == {
        "https://www.thetailorcv.com",
        "https://github.com/td19454-dot/TailorCv.Ai1",
    }, out["projects"][0]


def test_label_text_is_scrubbed_from_url_fields():
    # Left in place it renders as a dead link on the resume.
    data = {"projects": [{"name": "P", "url": "Live Demo", "github_link": "GitHub"}]}
    out = inject_links(data, {}, [])
    assert out["projects"][0]["url"] == "", out["projects"][0]
    assert out["projects"][0]["github_link"] == "", out["projects"][0]


def test_recovered_links_beat_whatever_the_model_produced():
    # Changed deliberately. A URL recovered from the PDF's annotation layer is
    # what the candidate actually published; the model's is a rewrite of it. It
    # invented "github.com/td19454-dot/tailorcv" for a project whose real repo is
    # TailorCv.Ai1, and merely FILLING empty fields let that stand, because a
    # project holding a fabricated URL does not look empty.
    data = {"projects": [{"name": "P", "url": "https://model-invented.com"}]}
    out = inject_links(data, {"P": [("GitHub", "https://github.com/x/y")]}, [])
    hrefs = {l["url"] for l in out["projects"][0]["links"]}
    assert hrefs == {"https://github.com/x/y"}, out["projects"][0]
    assert out["projects"][0]["url"] == "", out["projects"][0]


def test_model_url_survives_when_nothing_was_recovered():
    # We only override where the PDF gave us something better. A project we
    # recovered no link for keeps what it had, so a resume whose links are plain
    # text rather than annotations is not stripped.
    data = {"projects": [{"name": "P", "url": "https://mysite.com"}]}
    out = inject_links(data, {}, [], known_urls=["https://mysite.com"])
    assert out["projects"][0]["url"] == "https://mysite.com", out["projects"][0]


def test_invented_url_is_discarded_when_not_in_the_source():
    # Same rule as skills: a URL is a fact about the candidate's work, so it
    # must exist in their original document.
    data = {"projects": [{"name": "P", "url": "https://myntra-clone-demo.com"}]}
    out = inject_links(data, {}, [], known_urls=["https://myntraaclone.onrender.com/"])
    assert out["projects"][0]["url"] == "", out["projects"][0]


def test_bare_domain_counts_as_a_real_url():
    data = {"projects": [{"name": "P", "github_link": "github.com/x/y"}]}
    out = inject_links(data, {}, [])
    assert out["projects"][0]["github_link"] == "github.com/x/y"


def test_promptable_drops_vague_reference_phrases():
    gaps = ["Snowflake", "another cloud data warehouse", "a comparable caching layer"]
    assert promptable_skill_gaps(gaps) == ["Snowflake"], promptable_skill_gaps(gaps)


def test_promptable_drops_industry_domains():
    # A JD names these to describe the business, not a tool anyone can tick.
    gaps = ["Tableau", "retail", "e-commerce", "consumer goods analytics", "fintech"]
    assert promptable_skill_gaps(gaps) == ["Tableau"], promptable_skill_gaps(gaps)


def test_promptable_drops_category_stand_ins():
    # The real skill is Git / PostgreSQL; the category adds nothing.
    gaps = ["Git", "Version Control", "databases", "cloud platforms"]
    assert promptable_skill_gaps(gaps) == ["Git"], promptable_skill_gaps(gaps)


def test_promptable_collapses_duplicate_forms():
    # The extractor emits both; two pills for one thing is confusing.
    assert promptable_skill_gaps(["Kafka", "Apache Kafka"]) == ["Kafka"]
    assert promptable_skill_gaps(["Apache Kafka", "Kafka"]) == ["Apache Kafka"]


def test_promptable_keeps_methodologies_and_artifacts():
    # A business analyst legitimately lists these. Conservative by design:
    # keeping an odd pill beats hiding a skill the candidate really has.
    gaps = ["agile", "waterfall", "BPMN", "user stories", "wireframes", "BRDs"]
    assert promptable_skill_gaps(gaps) == gaps, promptable_skill_gaps(gaps)


def test_promptable_keeps_real_tools_including_punctuated_names():
    gaps = ["Power BI", "scikit-learn", "Node.js", "C++", "CI/CD", "gRPC", "SAP"]
    assert promptable_skill_gaps(gaps) == gaps, promptable_skill_gaps(gaps)


def test_promptable_dedupes_case_insensitively():
    assert promptable_skill_gaps(["Tableau", "tableau", "TABLEAU"]) == ["Tableau"]


def test_promptable_handles_empty_and_junk_input():
    assert promptable_skill_gaps(None) == []
    assert promptable_skill_gaps([]) == []
    assert promptable_skill_gaps(["", "   ", None]) == []


def test_promptable_drops_the_employers_own_products():
    # Real report: tailoring for an Apple JD offered "Apple Watch" as a skill.
    gaps = ["Swift", "Apple software", "Apple services", "Apple Watch", "iPhone"]
    assert promptable_skill_gaps(gaps) == ["Swift"], promptable_skill_gaps(gaps)


def test_future_date_priority_fix_is_dropped():
    # Real report, September 2026: a Jan 2022 - Feb 2026 role was flagged.
    parsed = {"top_priority_fixes": [
        {"issue": "Future date in experience",
         "action": "Update the end date of the position at California Medical "
                   "Research Associates (CMRA) to a date before September 2026."},
        {"issue": "Missing strong action verbs", "action": "Start bullets with verbs."},
        {"issue": "Missing measurable achievements",
         "action": "Add metrics, e.g. future-facing growth targets."},
    ]}
    _drop_future_date_priority_fixes(parsed)
    issues = [f["issue"] for f in parsed["top_priority_fixes"]]
    assert issues == ["Missing strong action verbs", "Missing measurable achievements"], issues


def test_future_date_fix_drop_is_safe_on_odd_shapes():
    for shape in [None, {}, {"top_priority_fixes": None}, {"top_priority_fixes": ["x", None]}]:
        _drop_future_date_priority_fixes(shape)


def test_skills_section_drops_employer_products():
    # Real report: a resume tailored for Apple shipped a Technical Skills line of
    # "Apple, iPhone, MacBook, Apple hardware, Apple software, Apple services".
    resume = ("Used Apple, iPhone, MacBook, Apple hardware, Apple software and "
              "Apple services daily. Device onboarding. Salesforce.")
    data = {"skills": ["Apple", "iPhone", "MacBook", "Device onboarding",
                       "Apple hardware", "Apple software", "Apple services",
                       "Salesforce"]}
    out = inject_jd_hard_skills(data, "Apple retail specialist.", resume_text=resume,
                                jd_skills=[])
    assert out["skills"] == ["Device onboarding", "Salesforce"], out["skills"]


def test_promptable_keeps_brand_led_real_skills():
    # The brand rule must not touch real skills that start with a brand name.
    gaps = ["Amazon Web Services", "Google Cloud", "watchOS"]
    assert promptable_skill_gaps(gaps) == gaps, promptable_skill_gaps(gaps)


# --------------------------------------------------------------------------- #
# Soft skills go into the summary, never the skills array (Rule01b). Handled
# automatically rather than asked about: unlike "do you know Tableau?", this is
# presentation of existing work, not a credential only the candidate can confirm.
# --------------------------------------------------------------------------- #
def test_soft_skills_are_suggested_never_appended_to_the_summary():
    """The summary is NEVER edited by this function any more.

    It used to append "Applies X across this work." That one line became the
    generator's most persistent artifact, surfacing as "Applies reproducible
    ... practices" in five outputs across three unrelated resumes - a generic
    closer with no specific referent, i.e. exactly what Rule 00's filler rule
    bans. The post-processor was re-introducing the defect the prompt forbids.
    """
    summary = "Data Analyst with experience in Python and SQL."
    out = weave_soft_skills_into_summary({"summary": summary}, ["mentoring", "facilitation"])
    assert out["summary"] == summary, out["summary"]
    assert "Applies" not in out["summary"]
    assert out["soft_skills_suggested"] == ["mentoring", "facilitation"], out.get("soft_skills_suggested")


def test_soft_skills_never_touch_the_skills_array_or_bullets():
    # Rule01b: "Skills: Python, SQL, mentoring" reads as padding. And a bullet
    # describing a mentee who appears nowhere in the original would be invented.
    data = {
        "summary": "Analyst.",
        "skills": ["Python"],
        "experience": [{"company": "Acme", "bullets": ["Analyzed data."]}],
    }
    out = weave_soft_skills_into_summary(data, ["mentoring", "leadership"])
    assert out["skills"] == ["Python"], out["skills"]
    assert out["experience"][0]["bullets"] == ["Analyzed data."], out["experience"]


def test_soft_skill_suggestions_are_recorded_in_order():
    base = {"summary": "Analyst."}
    one = weave_soft_skills_into_summary(dict(base), ["mentoring"])
    three = weave_soft_skills_into_summary(
        dict(base), ["mentoring", "facilitation", "stakeholder management"]
    )
    assert one["summary"] == "Analyst." and three["summary"] == "Analyst."
    assert one["soft_skills_suggested"] == ["mentoring"]
    assert three["soft_skills_suggested"] == ["mentoring", "facilitation", "stakeholder management"]


def test_soft_skill_already_in_summary_is_not_repeated():
    data = {"summary": "Analyst skilled in mentoring junior staff."}
    out = weave_soft_skills_into_summary(data, ["mentoring"])
    assert out["summary"] == "Analyst skilled in mentoring junior staff.", out["summary"]
    assert "soft_skills_added" not in out, out.get("soft_skills_added")


def test_soft_skills_noop_on_empty_input():
    data = {"summary": "Analyst."}
    assert weave_soft_skills_into_summary(dict(data), [])["summary"] == "Analyst."
    assert weave_soft_skills_into_summary(dict(data), None)["summary"] == "Analyst."
    # Must not crash on an odd shape.
    weave_soft_skills_into_summary({}, ["communication"])
    weave_soft_skills_into_summary(None, ["communication"])


def test_soft_skills_never_invent_a_summary():
    """With no summary there is nothing to annotate, and manufacturing one out
    of soft skills produced "Applies communication across this work." as an
    entire professional summary."""
    out = weave_soft_skills_into_summary({}, ["communication"])
    assert not out.get("summary"), out.get("summary")
    assert out.get("soft_skills_suggested") == ["communication"]


def test_soft_skills_are_gated_on_resume_evidence():
    """Regression: the summary used to claim whatever soft skills the JD asked
    for, producing "attention to code quality, mentoring and technical
    guidance" on a resume evidencing none of them - a sentence that could sit
    on a stranger's resume unchanged."""
    resume = "Mentored two junior analysts. Analysed quantitative data for a 7-person research team."
    jd = ["problem-solving skills", "attention to code quality", "mentoring", "technical guidance"]
    out = weave_soft_skills_into_summary({"summary": "Engineer."}, jd, resume)
    assert out.get("soft_skills_suggested") == ["mentoring"], out.get("soft_skills_suggested")
    assert "attention to code quality" not in out["summary"]
    assert "technical guidance" not in out["summary"]


def test_soft_skill_evidence_matches_verb_forms():
    """Soft skills surface as verbs on a resume ("Mentored"), never as the JD's
    noun ("mentoring"), so exact matching would reject genuine evidence."""
    resume = "Mentored juniors, collaborated with stakeholders and communicated results."
    out = weave_soft_skills_into_summary(
        {"summary": "Analyst."}, ["mentoring", "collaboration", "communication"], resume
    )
    assert out.get("soft_skills_suggested") == ["mentoring", "collaboration", "communication"], out


def test_soft_skill_trailing_skills_suffix_is_not_doubled():
    """JD soft skills often arrive suffixed ("mentoring skills"). The suffix is
    still stripped so the suggestion reads cleanly in the editor."""
    out = weave_soft_skills_into_summary({"summary": "Engineer."}, ["mentoring skills"])
    assert out["summary"] == "Engineer.", out["summary"]
    assert out["soft_skills_suggested"] == ["mentoring"], out.get("soft_skills_suggested")


def test_filler_soft_skills_are_never_stated_outright():
    """"Demonstrated problem-solving in this work." appended under a summary that
    already proves it with a shipped outcome only subtracts - and the phrase is
    on create_prompt's own BANNED list. These are dropped even when the resume
    contains the words."""
    resume = "Problem-solving across payment rails. Attention to detail throughout. Mentored two juniors."
    out = weave_soft_skills_into_summary(
        {"summary": "Engineer."}, ["problem-solving", "attention to detail", "mentoring"], resume
    )
    assert out.get("soft_skills_suggested") == ["mentoring"], out.get("soft_skills_suggested")
    assert "problem-solving" not in out["summary"].lower()
    assert "attention to detail" not in out["summary"].lower()


def test_unevidenced_hard_skills_never_get_appended_to_the_summary():
    """Regression: an unevidenced JD skill used to be bolted onto the summary as
    "Applied MySQL in this work.", stacking one flat sentence per skill and
    asserting experience the resume never showed. The skill must stay in the
    skills array only."""
    summary = "Backend engineer building FastAPI services on Postgres."
    data = {
        "summary": summary,
        "skills": ["MySQL", "Java", "NumPy"],
        "experience": [{"company": "TailorCV", "bullets": ["Built FastAPI services on Postgres."]}],
        "projects": [],
    }
    out = weave_hard_skills_into_bullets(
        data,
        resume_text="TailorCV. Built FastAPI services on Postgres.",
        jd_skills=["MySQL", "Java", "NumPy"],
    )
    assert out["summary"] == summary, out["summary"]
    assert "in this work" not in out["summary"]
    assert "across this work" not in out["summary"]
    assert out["hard_skills_woven"] == []
    # Still surfaced honestly, just not asserted as prose experience.
    assert out["skills"] == ["MySQL", "Java", "NumPy"]


def test_evidenced_hard_skill_placement_is_suggested_not_injected():
    """Placement is RECORDED, never written into the bullet.

    This function used to append "(using Redis)" to the entry's shortest
    bullet. On a real resume that produced "...to produce feasible, time-aware
    travel plans (using TypeScript)." - visible keyword stuffing on a project
    whose header already listed the stack. The decision is still made and
    reported; only the bullet edit is gone.
    """
    data = {
        "summary": "Backend engineer.",
        "skills": ["Redis"],
        "experience": [{"company": "TailorCV",
                        "bullets": ["Built caching layer.", "Shipped billing."]}],
        "projects": [],
    }
    out = weave_hard_skills_into_bullets(
        data, resume_text="TailorCV. Built caching layer with Redis.", jd_skills=["Redis"],
    )
    entry = out["experience"][0]
    assert all("(using" not in b for b in entry["bullets"]), entry["bullets"]
    assert entry["bullets"] == ["Built caching layer.", "Shipped billing."]
    suggestions = entry.get("_skill_placement_suggestions")
    assert suggestions and suggestions[0]["skills"] == ["Redis"], suggestions
    assert out["hard_skills_woven"], out.get("hard_skills_woven")


def _unused_evidenced_hard_skill_is_still_woven_into_its_own_entry():
    """Superseded by the test above; kept for reference, not collected."""
    data = {
        "summary": "Backend engineer.",
        "skills": ["Redis"],
        "experience": [{"company": "TailorCV", "bullets": ["Built caching layer.", "Shipped billing."]}],
        "projects": [],
    }
    out = weave_hard_skills_into_bullets(
        data,
        resume_text="TailorCV. Built caching layer with Redis for session storage.",
        jd_skills=["Redis"],
    )
    assert any("Redis" in str(b) for b in out["experience"][0]["bullets"]), out["experience"]
    assert out["hard_skills_woven"][0]["skill"] == "Redis"


def test_promptable_matches_the_real_optimizer_output():
    # The exact skill_gaps list the pipeline produces for the committed
    # junior_data_analyst eval fixture.
    gaps = ["MySQL", "Snowflake", "Airflow", "Tableau", "Power BI", "Version Control",
            "another cloud data warehouse", "e-commerce", "consumer goods analytics"]
    assert promptable_skill_gaps(gaps) == [
        "MySQL", "Snowflake", "Airflow", "Tableau", "Power BI",
    ], promptable_skill_gaps(gaps)


# --------------------------------------------------------------------------- #
# Link normalisation. The TLD allowlist used to be com|in|org|io|dev|ai|net,
# so ".app" was missing and every Vercel / Netlify portfolio link on a resume
# was silently dropped.
# --------------------------------------------------------------------------- #
def test_normalize_links_covers_real_portfolio_hosts():
    for raw in (
        "jane-portfolio.vercel.app",
        "myresume.netlify.app",
        "jane.github.io",
        "myapp.onrender.com",
        "huggingface.co/jane",
        "notion.site/jane",
        "jane.co.uk",
        "university.edu",
        "jane.me",
        "project.tech",
        "github.com/jane/portfolio",
        "linkedin.com/in/janedoe",
    ):
        assert normalize_links(raw).startswith("https://"), f"dropped link: {raw}"


def test_normalize_links_ignores_filenames_and_libraries():
    """A loose domain pattern would turn Node.js and resume.pdf into links."""
    for raw in (
        "Node.js", "React.js", "Vue.js", "resume.pdf", "index.html",
        "app.py", "main.ts", "data.json", "style.css", "README.md",
        "script.sh", "v1.2", "8.5 CGPA",
    ):
        assert "https://" not in normalize_links(raw), f"false link from: {raw}"


def test_normalize_links_leaves_existing_urls_and_emails_alone():
    assert normalize_links("https://github.com/jane") == "https://github.com/jane"
    assert normalize_links("http://jane.dev") == "http://jane.dev"
    assert "https://" not in normalize_links("jane@gmail.com")


# --------------------------------------------------------------------------- #
# Fact-check: rewording is fine, inventing facts is not.
# --------------------------------------------------------------------------- #
def test_factcheck_passes_an_honest_reword():
    honest = {
        "experience": [{
            "company": "Acme Corp", "dates": "2021 - 2023",
            "bullets": ["Engineered REST APIs in Python", "Cut page load time by 30%"],
        }],
        "education": [{"school": "State University",
                       "degree": "B.Sc Computer Science", "year": "2020"}],
    }
    out = factcheck_against_original(honest, FACTCHECK_ORIGINAL)
    assert out["factcheck"]["clean"] is True, out["factcheck"]["findings"]


def test_factcheck_catches_invented_employer_school_and_numbers():
    lying = {
        "experience": [
            {"company": "Acme Corp", "dates": "2021 - 2023",
             "bullets": ["Cut page load time by 65%"]},
            {"company": "Globex International", "dates": "2019 - 2021",
             "bullets": ["Led a team"]},
        ],
        "education": [{"school": "Stanford University",
                       "degree": "M.Sc Data Science", "year": "2024"}],
    }
    out = factcheck_against_original(lying, FACTCHECK_ORIGINAL)
    assert out["factcheck"]["clean"] is False

    kinds = {(f["type"], f["value"]) for f in out["factcheck"]["findings"]}
    assert ("company", "Globex International") in kinds, kinds
    assert ("school", "Stanford University") in kinds, kinds
    assert ("number", "65%") in kinds, kinds          # inflated an existing metric
    assert ("year", "2024") in kinds, kinds


def test_factcheck_does_not_report_years_twice():
    out = factcheck_against_original(
        {"experience": [{"company": "Acme Corp", "bullets": ["Shipped in 2019"]}]},
        FACTCHECK_ORIGINAL,
    )
    years = [f for f in out["factcheck"]["findings"] if f["value"] == "2019"]
    assert len(years) == 1, out["factcheck"]["findings"]


def test_factcheck_no_original_text_is_a_no_op():
    data = {"experience": [{"company": "Anything"}]}
    out = factcheck_against_original(data, "")
    assert "factcheck" not in out


def test_short_skill_names_are_not_matched_as_substrings():
    with confirm_first():
        """"R" must not match "recommendation", "Go" must not match "Google"."""
        resume = "Engineer at Google. Built Django services and React dashboards."
        jd = "Required: R, Go, React."
        out = inject_jd_hard_skills({"skills": []}, jd, resume)

        lowered = [s.lower() for s in out["skills"]]
        gaps = [s.lower() for s in out["skill_gaps"]]

        assert "react" in lowered, out["skills"]
        assert "r" not in lowered and "go" not in lowered, out["skills"]
        assert "r" in gaps and "go" in gaps, out["skill_gaps"]


# --------------------------------------------------------------------------- #
# End-to-end: inject JD skills then sanitize (mirrors the real pipeline)
# --------------------------------------------------------------------------- #
def test_inject_then_sanitize_end_to_end():
    data = {"skills": ["React", "FastAPI"]}
    data = inject_jd_hard_skills(data, CATEGORIZED_JD, CATEGORIZED_RESUME)
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
    out = sanitize_resume_data(
        inject_jd_hard_skills(data, ATOMIC_SKILLS_JD, ATOMIC_SKILLS_RESUME)
    )["skills"]
    lowered = [skill.lower() for skill in out]

    for skill in ("python", "aws", "gcp", "azure", "kubeflow", "airflow"):
        assert skill in lowered, f"missing '{skill}' in {out}"
    for phrase in (
        "backend development", "cloud platforms", "mlops tools",
        "software engineering with an ml focus", "ml focus",
    ):
        assert phrase not in lowered, f"generic phrase leaked: '{phrase}' in {out}"
    assert len(lowered) == len(set(lowered)), f"duplicates present: {out}"


# --------------------------------------------------------------------------- #
# Professional summary (Rule 00). The summary is the most-read line on the
# resume and the place a tailored resume gives itself away as a compressed
# restatement of the job description. These guard the deterministic half of
# Rule 00: the failures that are decidable from the text itself.
# --------------------------------------------------------------------------- #

# The quality bar, and the shape Rule 00 now asks for: four sentences, one
# capability domain each, acronyms expanded, no metric forced in.
SUMMARY_GOOD = (
    "Machine Learning Engineer with hands-on experience across the end-to-end Machine "
    "Learning lifecycle, including data pipelines, feature engineering, model training, "
    "deployment, and evaluation. Builds and productionizes ML models as REST APIs and "
    "inference services using Python, FastAPI, Flask, and Docker on Amazon Web Services "
    "(AWS). Applies MLOps practices including MLflow experiment tracking, DVC model and "
    "data versioning, containerized deployment, and CI/CD automation to deliver "
    "reproducible, production-grade ML systems. Applied background in Natural Language "
    "Processing (NLP), Computer Vision, LLM fine-tuning, and Retrieval Augmented "
    "Generation (RAG), with deployed projects serving real users."
)

# The failure this work exists to fix: the JD's headline echoed back, a metric
# that this job never asked about, and a trailing domain tag.
SUMMARY_JD_ECHO = (
    "ML Engineer focused on AI/ML Platform & MLOps with hands-on delivery of model "
    "deployment, CI/CD-driven inference services, and cloud-hosted pipelines using AWS, "
    "Docker and MLflow. Improved model prediction accuracy by 15% through rubric-driven "
    "evaluation of agent responses and shipped production-grade APIs and pipelines for "
    "RAG, sentiment and pricing systems in the AI/ML domain."
)

SUMMARY_PADDED_TAIL = (
    "Backend Software Engineer with experience building production FastAPI services in "
    "Python, SQL and PostgreSQL. Owned the full-stack backend for a SaaS used by 16,000+ "
    "users and implemented the ATS scoring engine, payment rails and analytics "
    "instrumentation. Domain experience in developer tools, platform reliability and "
    "API integrations."
)


SUMMARY_TARGET = (
    "Backend Engineer who built the deterministic ATS scoring engine behind a "
    "resume platform serving 16,000 users across 30 countries. Owns the "
    "FastAPI services and partitioned PostgreSQL schema powering tailoring, "
    "dual payment rails and the quota system that meters every paid feature "
    "on the platform."
)


def test_good_summary_has_no_quality_issues():
    """The anti-false-positive guard. If the validator flags a target-quality
    summary, it will mangle good output in production - a worse outcome than
    the padding it exists to remove.

    SUMMARY_GOOD is the old four-sentence capability-domain shape and now
    legitimately fails on length; SUMMARY_TARGET is the current bar.
    """
    assert _summary_quality_issues(SUMMARY_TARGET) == [], _summary_quality_issues(SUMMARY_TARGET)


def test_validator_flags_jd_echo_and_domain_tag():
    issues = _summary_quality_issues(SUMMARY_JD_ECHO)
    assert "jd_echo" in issues, issues
    assert "domain_tag" in issues, issues


def test_validator_flags_banned_filler_and_hedging():
    filler = _summary_quality_issues(
        "Detail-oriented engineer. Proven ability to deliver. Adept at shipping code."
    )
    assert any(i.startswith("banned_phrase:") for i in filler), filler

    hedging = _summary_quality_issues(
        "Backend Engineer building services. Exposure to Kubernetes and Terraform."
    )
    assert any(i.startswith("hedging:") for i in hedging), hedging


def test_validator_flags_pronouns_and_sentence_count():
    assert "pronoun" in _summary_quality_issues(
        "I build backend services in Python. My work covers APIs and data pipelines."
    )
    assert "too_few_sentences" in _summary_quality_issues("Backend Engineer building APIs.")
    # Rule 00 asks for 2-3 sentences, so the ceiling sits at 4.
    assert "too_many_sentences" not in _summary_quality_issues(
        "One sentence here. Two sentence here. Three sentence here."
    )
    assert "too_many_sentences" in _summary_quality_issues(
        "One sentence here. Two sentence here. Three sentence here. "
        "Four sentence here. Five sentence here."
    )
    assert _summary_quality_issues("") == ["empty"]


def test_validator_flags_an_over_long_summary():
    """Rule 00 asks for 45-60 words with a hard ceiling of 65. The ceiling was
    previously 130, which is why a 114-word production summary passed
    validation untouched."""
    # A summary inside the budget passes on length.
    assert 40 <= len(SUMMARY_TARGET.split()) <= 65, len(SUMMARY_TARGET.split())
    assert "too_long" not in _summary_quality_issues(SUMMARY_TARGET)
    # The old four-sentence capability-domain shape is now too long.
    assert "too_long" in _summary_quality_issues(SUMMARY_GOOD)


def test_validator_flags_weak_future_focused_closings():
    """"Prepared to grow into..." converts capability into hope, and it is most
    damaging on the early-career resumes where it is most tempting."""
    for weak in (
        "Chemical Engineer with lab experience in process design and mass balances. "
        "Prepared to grow into process simulation and plant engineering roles.",
        "Analyst building SQL reporting pipelines. Eager to learn data engineering.",
    ):
        issues = _summary_quality_issues(weak)
        assert any(i.startswith("banned_phrase:") for i in issues), (weak, issues)


def test_filler_closer_matches_the_class_not_a_phrase_list():
    """Regression: the filler rule was written as a list of exact phrasings
    ("collaborates with cross-functional teams"), so the same empty claim
    returned two rounds later as "communicates results to non-technical
    stakeholders" and shipped. It must match the CLASS - a generic activity
    verb pointed at a generic audience with no specific referent."""
    from functions import _FILLER_CLOSER_RE
    for filler in (
        "communicates results to non-technical stakeholders.",
        "collaborates with cross-functional teams.",
        "presents findings to leadership.",
        "partners with product teams.",
        "documents technical processes.",
    ):
        assert _FILLER_CLOSER_RE.search(filler), filler
    # Clauses naming a specific outcome are not filler.
    for real in (
        "informing pricing and marketing recommendations.",
        "cut nightly reconciliation from 52 minutes to 9.",
        "mentored two juniors through their first production deploys.",
    ):
        assert not _FILLER_CLOSER_RE.search(real), real


def test_entries_represented_counts_blocks_not_numbers():
    """Regression: entry coverage used min(len(numbers), 3) as a proxy, so a
    summary built entirely from one metric-dense project scored as covering
    two entries - the exact failure the two-source rule exists to catch."""
    resume = (
        "Customer Behaviour Analytics\n"
        "- Analysed 3,900 transaction records; 3,116 Loyal customers generate highest revenue\n"
        "Outlier\n"
        "- Evaluated 50+ repositories with a 10-metric rubric, 15% measured improvement"
    )
    one_project = ("Data Analyst who analysed 3,900 transaction records and found "
                   "3,116 Loyal customers generate the highest revenue.")
    two_projects = ("Data Analyst who found 3,116 Loyal customers drive revenue. "
                    "Scored 50+ repositories against a 10-metric rubric.")
    assert _entries_represented(one_project, resume) < 2, "two numbers, one project"
    assert _entries_represented(two_projects, resume) >= 2


def test_bracketed_placeholder_counts_as_evidence():
    """A metric-poor resume's honest output names the gap rather than inventing
    a number. If the placeholder did not satisfy the evidence gate, the gate
    would pressure exactly the fabrication it exists to stop."""
    assert _has_concrete_evidence("Product Designer who owns the design system behind [PRODUCT].")
    assert not _has_concrete_evidence("Product Designer who owns the design system.")


def test_keyword_tail_detection():
    """The padded tail is "A, B and C" - ONE comma. Requiring two commas missed
    every real instance, including the example Rule 00 is written around."""
    assert _is_keyword_tail("Domain experience in developer tools, platform reliability and API integrations.")
    # A sentence with a real finite verb makes a claim and is never a tail.
    assert not _is_keyword_tail(
        "Builds and productionizes ML models as REST APIs and inference services "
        "using Python, FastAPI, Flask, and Docker."
    )
    # "developer"/"development" are nouns sharing a stem with a verb - they must
    # not be mistaken for a claim.
    assert not _is_keyword_tail("Short list of two, items.")


def test_repair_strips_trailing_domain_tag():
    out = repair_summary({"summary": SUMMARY_JD_ECHO})
    assert "in the AI/ML domain" not in out["summary"], out["summary"]
    assert out["summary"].rstrip().endswith("."), out["summary"]
    # The substantive claim before the tag survives untouched.
    assert "sentiment and pricing systems" in out["summary"]


def test_repair_drops_a_padded_final_sentence():
    out = repair_summary({"summary": SUMMARY_PADDED_TAIL})
    assert "Domain experience" not in out["summary"], out["summary"]
    assert out["summary"].endswith("analytics instrumentation."), out["summary"]


def test_repair_strips_a_domain_tag_that_is_no_longer_the_last_text():
    """Regression: the tag-strip was anchored to the end of the WHOLE summary,
    but repair_summary runs after weave_soft_skills_into_summary has appended a
    sentence. The tag then stopped being the final characters and survived into
    production output. It must qualify on ending its own SENTENCE instead."""
    woven = (
        "ML Engineer building inference services using AWS, Docker and MLflow. "
        "Shipped APIs and pipelines for RAG, sentiment and pricing systems in the AI/ML domain. "
        "Applies mentoring across this work."
    )
    out = repair_summary({"summary": woven})
    assert "in the AI/ML domain" not in out["summary"], out["summary"]
    # The claim it was hanging off, and the appended sentence, both survive.
    assert "sentiment and pricing systems" in out["summary"], out["summary"]
    assert out["summary"].endswith("Applies mentoring across this work."), out["summary"]


def test_repair_keeps_a_load_bearing_mid_sentence_domain_phrase():
    """"in the fintech domain" mid-sentence qualifies a real claim - stripping it
    would delete meaning, which subtractive repair must never do."""
    text = (
        "Engineer who deployed fraud models in the fintech domain for a top-five bank. "
        "Builds APIs in Python and Go. Ships weekly to production."
    )
    assert repair_summary({"summary": text})["summary"] == text


def test_repair_is_a_noop_on_a_good_summary():
    """Repair is subtractive, so it must not rewrite a summary that meets the
    current bar. SUMMARY_GOOD is the superseded four-sentence shape and now
    legitimately carries issues; SUMMARY_TARGET is the current one."""
    data = {"summary": SUMMARY_TARGET}
    out = repair_summary(data)
    assert out["summary"] == SUMMARY_TARGET, out["summary"]
    assert "summary_issues" not in out, out.get("summary_issues")


def test_repair_never_fabricates():
    """The safety argument for running this on every optimization: repair is
    strictly subtractive, so it cannot introduce a claim the resume never made.
    Enforced mechanically rather than by reading the implementation."""
    def words(text):
        return set(re.findall(r"[a-z0-9+#/&-]+", text.lower()))

    for source in (SUMMARY_GOOD, SUMMARY_JD_ECHO, SUMMARY_PADDED_TAIL):
        out = repair_summary({"summary": source})["summary"]
        assert not (words(out) - words(source)), words(out) - words(source)
        assert len(out) <= len(source), (len(out), len(source))


def test_repair_reports_what_it_cannot_fix():
    """"focused on ..." sits mid-sentence, so removing it would mean rewriting
    the clause - which subtractive repair must never do. It is reported instead."""
    out = repair_summary({"summary": SUMMARY_JD_ECHO})
    assert "jd_echo" in (out.get("summary_issues") or []), out.get("summary_issues")


def test_repair_handles_empty_and_odd_shapes():
    assert repair_summary({}) == {}
    assert repair_summary(None) is None
    assert repair_summary({"summary": ""}) == {"summary": ""}
    assert repair_summary({"summary": None}) == {"summary": None}
    # Must not disturb the rest of the resume.
    data = {"summary": SUMMARY_GOOD, "skills": ["Python"], "experience": [{"bullets": ["Built X."]}]}
    out = repair_summary(data)
    assert out["skills"] == ["Python"]
    assert out["experience"] == [{"bullets": ["Built X."]}]


def test_summary_sentence_split_handles_abbreviations():
    """"e.g." and "Ph.D." must not each read as a sentence break, or the count
    inflates and a clean summary gets flagged as too long."""
    assert len(_summary_sentences("Engineer with a Ph.D. in physics. Builds models.")) == 2
    assert len(_summary_sentences("Uses tools, e.g. Docker and Airflow. Ships services.")) == 2


def test_prompt_and_validator_share_one_banned_list():
    """Regression guard: the banned-phrase list was written out twice and the
    two copies drifted, so the validator passed summaries the prompt banned."""
    from functions import _SUMMARY_BANNED_PHRASES, create_prompt
    prompt = create_prompt("resume", "jd")
    for phrase in _SUMMARY_BANNED_PHRASES:
        assert phrase in prompt, f"{phrase!r} missing from the prompt's banned list"


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
