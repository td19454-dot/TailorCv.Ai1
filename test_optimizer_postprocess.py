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
    factcheck_against_original,
    inject_jd_hard_skills,
    inject_links,
    normalize_links,
    promptable_skill_gaps,
    sanitize_resume_data,
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


def test_no_resume_text_means_every_jd_skill_is_a_gap():
    # Fail closed: with nothing to check against we must not invent claims.
    out = inject_jd_hard_skills({"skills": []}, "Required: Kubernetes, Terraform.")
    assert out["skills"] == [], out["skills"]
    assert len(out["skill_gaps"]) == 2, out["skill_gaps"]


def test_model_claimed_unevidenced_jd_skill_is_stripped():
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


# --------------------------------------------------------------------------- #
# Soft skills go into the summary, never the skills array (Rule01b). Handled
# automatically rather than asked about: unlike "do you know Tableau?", this is
# presentation of existing work, not a credential only the candidate can confirm.
# --------------------------------------------------------------------------- #
def test_soft_skills_are_appended_to_the_summary():
    data = {"summary": "Data Analyst with experience in Python and SQL."}
    out = weave_soft_skills_into_summary(data, ["mentoring", "facilitation"])
    assert out["summary"].endswith("Skilled in mentoring and facilitation."), out["summary"]
    assert out["soft_skills_added"] == ["mentoring", "facilitation"], out["soft_skills_added"]


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


def test_soft_skill_phrasing_by_count():
    base = {"summary": "Analyst."}
    one = weave_soft_skills_into_summary(dict(base), ["mentoring"])["summary"]
    three = weave_soft_skills_into_summary(
        dict(base), ["mentoring", "facilitation", "stakeholder management"]
    )["summary"]
    assert one.endswith("Skilled in mentoring."), one
    assert three.endswith("Skilled in mentoring, facilitation and stakeholder management."), three


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


def test_soft_skills_build_a_summary_when_none_exists():
    assert weave_soft_skills_into_summary({}, ["communication"])["summary"] == "Skilled in communication."


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
