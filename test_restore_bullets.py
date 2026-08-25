"""Regression tests for the bullet-restore meta/header detection.

The optimizer's bullet-restore step (restore_dropped_bullets) re-adds bullets the
AI silently drops. Repeatedly, header/date rows leaked in as bullets:
  - a stray "2 January 2026" date bullet
  - "Freelancer Dec 2025 - Present"            (role + date range)
  - "Data Analyst Research Intern Kolkata"     (role + location, no date)
  - "San Francisco, USA 12/2022 - 11/2024"     (location + numeric date range)

These tests lock in that all of those are skipped while real bullets — including
ones that legitimately mention a date — are kept.

No external services and no API keys required.
Run:  python test_restore_bullets.py
"""

import sys
import traceback

import main

is_meta = main._restore_is_meta_line


# --------------------------------------------------------------------------- #
# Date / header rows that must NEVER become a bullet (is_meta -> True)
# --------------------------------------------------------------------------- #
META_ROWS = [
    # bare dates — text and numeric
    "2 January 2026", "January 2026", "Jan 2026", "12/2022", "01/2022",
    # date ranges — text and numeric, hyphen and en-dash
    "Sep 2025 - Present", "May 2025 – Present", "Oct 2025 - Nov 2025",
    "01/2022 - 12/2022", "12/2022 – 11/2024",
    # role/company + date range
    "Freelancer Dec 2025 – Present",
    "Machine Learning Engineer Sep 2025 - Present",
    # ranges joined by a WORD, not a dash. Only dashes were recognised, so
    # "Outlier May 2026 to June 2026" was restored as a bullet on the entry
    # ABOVE it — the next job's header row appearing inside the previous job.
    "Outlier May 2026 to June 2026",
    "May 2026 to June 2026",
    "Jan 2024 to Present",
    "Jan 2024 to date",
    "Remote Jan 2024 until Mar 2024",
    "Data Analyst Feb 2023 through Aug 2023",
    # location + numeric date range
    "San Francisco, USA 12/2022 – 11/2024",
    "Thailand 01/2022 - 12/2022",
    "Lahore, Pakistan 01/2021 - 12/2021",
    # open-ended ranges that say "Currently" / "Current" instead of "Present"
    "12/2024 - Currently",
    "New York, United States 12/2024 – Currently",
    "California, United States 08/2024 – Currently",
    "Bangalore, India Jan 2024 - Current",
]


def test_meta_rows_are_skipped():
    for row in META_ROWS:
        assert is_meta(row) is True, f"should be skipped but wasn't: {row!r}"


# --------------------------------------------------------------------------- #
# Real bullets that must be KEPT (is_meta -> False)
# --------------------------------------------------------------------------- #
REAL_BULLETS = [
    # Widening the range separator to accept "to"/"until"/"through" must not
    # start eating sentences that merely mention a span of months.
    "Reduced onboarding time from Jan 2024 to June 2024 by 15%.",
    "Led a team of four mentees from May 2026 to June 2026 across two products.",
    "Led a team of four mentees, enhancing their skills in data science.",
    "Developed an Anti-spoofing Face-App, reducing identity fraud by 70%.",
    "Secured a position among the Top 100 Kaggle contributors globally in 2024",
    "Launched the new dashboard in March 2026 for all users",
    "Shipped the feature in December 2025 ahead of schedule",
    "Reduced operational costs in 01/2022 by streamlining the pipeline",
    "Advanced expertise in EDA, Machine Learning, and Deep Learning.",
    "Actively contributing to open-source LLM projects currently driving innovation",
]


def test_real_bullets_are_kept():
    for bullet in REAL_BULLETS:
        assert is_meta(bullet) is False, f"real bullet wrongly skipped: {bullet!r}"


# --------------------------------------------------------------------------- #
# Header echo: role/location row with NO date (handled separately)
# --------------------------------------------------------------------------- #
def test_header_echo_role_plus_location():
    headers = ["Data Analyst Research Intern", "Jadavpur University CMATER Lab", "Kolkata"]
    assert main._restore_is_header_echo("Data Analyst Research Intern Kolkata", headers) is True
    # a genuine bullet that mentions the role is a full sentence -> not an echo
    long_bullet = "As a Data Analyst Research Intern I conducted EDA on 1,097 CT scan images across classes."
    assert main._restore_is_header_echo(long_bullet, headers) is False


# --------------------------------------------------------------------------- #
# End-to-end: restore_dropped_bullets must not leak headers, but must still
# restore genuinely-dropped bullets.
# --------------------------------------------------------------------------- #
def test_restore_does_not_leak_but_restores_dropped():
    resume = (
        "Experience\n"
        "GOOGLE-KAGGLE 12/2022 – 11/2024\n"
        "AI Data Scientist Kaggle Master Mentor San Francisco, USA\n"
        "Championed mentorship initiatives through the Kaggle-X BIPOC program.\n"
        "Led a team of four mentees, enhancing their skills in machine learning.\n"
        "San Francisco, USA 12/2022 – 11/2024\n"
        "Jadavpur University CMATER Lab May 2025 - Sep 2025\n"
        "Data Analyst Research Intern Kolkata\n"
        "Conducted exploratory data analysis on 1,097 lung CT scan images.\n"
        "Evaluated model generalization across three medical datasets achieving high accuracy.\n"
        "Projects\n"
        "Some Project | Python\n"
        "Built something useful for many people.\n"
    )
    parsed = {
        "experience": [
            {"company": "GOOGLE-KAGGLE", "title": "AI Data Scientist Kaggle Master Mentor",
             "location": "San Francisco, USA",
             "bullets": ["Championed mentorship through the Kaggle-X BIPOC program."]},
            {"company": "Jadavpur University CMATER Lab", "title": "Data Analyst Research Intern",
             "location": "Kolkata",
             "bullets": ["Conducted EDA on 1,097 lung CT scan images."]},
        ]
    }
    out = main.restore_dropped_bullets(parsed, resume)
    all_bullets = [b for e in out["experience"] for b in e["bullets"]]

    leaks = [b for b in all_bullets if is_meta(b)]
    assert not leaks, f"header/date rows leaked as bullets: {leaks}"

    # genuinely-dropped bullets were restored
    joined = " ".join(all_bullets).lower()
    assert "led a team of four mentees" in joined, "dropped bullet not restored"
    assert "evaluated model generalization" in joined, "dropped bullet not restored"


# --------------------------------------------------------------------------- #
# A dropped ENTRY is worse than a dropped bullet: the whole project disappears,
# and its links are then orphaned, so the positional and reading-order fills
# hand them to whatever section is nearest - a project's GitHub landing on a
# certification, a stray "Link" on a school.
# --------------------------------------------------------------------------- #
PROJECTS_SOURCE = """Projects
Tailorcv.com - html,css,javascript,FastApi Feb 2026
Live Demo | GitHub
- Built and scaled an AI resume-optimization platform to 16,000 plus users worldwide.
Myntra E-commerce Website Clone - html,css,javascript mar 2025
Live Demo | GitHub
- Developed a frontend clone of the Myntra e-commerce platform with product listings.
Customer Behaviour Analytics - Python, PowerBI, SQL, Excel January 2026
GitHub
- Executed end-to-end data analysis using Python to clean 3,900 transaction records.
- Developed an interactive Power BI dashboard to visualize customer segments clearly.
Education
Jadavpur University
"""


def test_dropped_project_is_restored():
    parsed = {"projects": [
        {"name": "Tailorcv.com", "bullets": ["x"]},
        {"name": "Myntra E-commerce Website Clone", "bullets": ["y"]},
    ]}
    out = main.restore_dropped_entries(parsed, PROJECTS_SOURCE)
    names = [p["name"] for p in out["projects"]]
    assert "Customer Behaviour Analytics" in names, names
    restored = next(p for p in out["projects"] if p["name"] == "Customer Behaviour Analytics")
    assert len(restored["bullets"]) == 2, restored


def test_link_label_row_never_becomes_a_project():
    # "Live Demo | GitHub" sits between the title and its bullets.
    parsed = {"projects": []}
    names = [p["name"].lower() for p in main.restore_dropped_entries(parsed, PROJECTS_SOURCE)["projects"]]
    for junk in ("live demo", "github", "live demo | github"):
        assert junk not in names, names


def test_restore_entries_is_a_noop_when_nothing_is_missing():
    parsed = {"projects": [
        {"name": "Tailorcv.com", "bullets": ["x"]},
        {"name": "Myntra E-commerce Website Clone", "bullets": ["y"]},
        {"name": "Customer Behaviour Analytics", "bullets": ["z"]},
    ]}
    out = main.restore_dropped_entries(parsed, PROJECTS_SOURCE)
    assert len(out["projects"]) == 3, [p["name"] for p in out["projects"]]


def test_restore_entries_handles_odd_input():
    assert main.restore_dropped_entries({}, PROJECTS_SOURCE) == {}
    assert main.restore_dropped_entries({"projects": []}, "") == {"projects": []}
    main.restore_dropped_entries(None, PROJECTS_SOURCE)


# --------------------------------------------------------------------------- #
# Restoring dropped entries must not INVENT them. The first version promoted a
# stack row ("Python, PowerBI, SQL, Excel") and a link row ("html, css,
# javascript Live") into projects, each carrying a copy of another project's
# bullets — visibly worse than the missing project it was meant to fix.
# --------------------------------------------------------------------------- #
def test_stack_rows_are_not_projects():
    for row in ("Python, PowerBI, SQL, Excel", "html, css, javascript Live",
                "html,css,javascript,FastApi", "HTML, CSS, JavaScript"):
        assert main._looks_like_stack_line(row) is True, row


def test_real_project_titles_are_not_mistaken_for_stacks():
    for row in ("Customer Behaviour Analytics", "Tailorcv.com",
                "Myntra E-commerce Website Clone", "Anti-spoofing Face App"):
        assert main._looks_like_stack_line(row) is False, row


def test_restore_does_not_duplicate_an_existing_project_bullets():
    # The stack row sits under a project that SURVIVED, so its bullets are
    # already on the resume - restoring it would duplicate them.
    source = chr(10).join([
        "Projects",
        "Customer Behaviour Analytics - Python, PowerBI, SQL, Excel January 2026",
        "GitHub",
        "- Executed end-to-end data analysis using Python to clean 3,900 transaction records.",
        "- Developed an interactive Power BI dashboard to visualize customer segments clearly.",
        "Education",
    ])
    parsed = {"projects": [{
        "name": "Customer Behaviour Analytics",
        "subtitle": "Python, PowerBI, SQL, Excel",
        "bullets": [
            "Executed end-to-end data analysis using Python to clean 3,900 transaction records.",
            "Developed an interactive Power BI dashboard to visualize customer segments clearly.",
        ],
    }]}
    names = [p["name"] for p in main.restore_dropped_entries(parsed, source)["projects"]]
    assert names == ["Customer Behaviour Analytics"], names


# --------------------------------------------------------------------------- #
# Section headings carry decoration on BOTH sides. "Technical Skills and
# Interests" (suffix) once left the whole skills block tagged as Experience;
# "Core Achievements" (prefix) left the achievements block tagged as Projects,
# so hackathon and LeetCode lines were restored as bullets on the last project.
# --------------------------------------------------------------------------- #
DECORATED_HEADINGS = {
    "Core Achievements": "achievements",
    "Key Achievements": "achievements",
    "Relevant Experience": "experience",
    "Additional Projects": "projects",
    "Notable Projects": "projects",
    "Other Certifications": "certifications",
    "Technical Skills and Interests": "skills",
    "Selected Publications": "publications",
    "Professional Experience": "experience",
}

NOT_HEADINGS = [
    "Machine Learning Projects",      # a project title, not a heading
    "Customer Behaviour Analytics",
    "Myntra E-commerce Website Clone",
    "Data Science Portfolio",
    "Berger Paints",
]


def test_decorated_headings_resolve():
    for text, expected in DECORATED_HEADINGS.items():
        assert main._heading_key(text) == expected, (text, main._heading_key(text))


def test_entry_titles_are_not_read_as_headings():
    for text in NOT_HEADINGS:
        assert main._heading_key(text) is None, (text, main._heading_key(text))


def test_achievements_do_not_leak_into_projects():
    source = chr(10).join([
        "Projects",
        "Tailorcv.com - html, css, javascript Feb 2026",
        "- Built and scaled an AI resume-optimization platform to 16,000 plus users.",
        "Core Achievements",
        "- Finalist at the Inter-College Hackathon 2024 among 210 competing teams.",
        "- Solved 400 plus problems on LeetCode across data structures and algorithms.",
        "Certifications",
        "LeetCode SQL 50 Badge",
    ])
    parsed = {"projects": [
        {"name": "Tailorcv.com", "bullets": ["Built and scaled an AI resume-optimization platform."]},
    ]}
    bullets = main.restore_dropped_bullets(parsed, source)["projects"][0]["bullets"]
    joined = " ".join(bullets).lower()
    assert "hackathon" not in joined, bullets
    assert "leetcode" not in joined, bullets


# --------------------------------------------------------------------------- #
# Fact enforcement: preserve first, rewrite second. Enforced in code, because
# the model obeys the prompt on a good run and silently does not on a bad one.
# --------------------------------------------------------------------------- #

_FACTS_SOURCE = "\n".join([
    "EXPERIENCE",
    "Outlier - Python Engineer",
    "- Analyzed AI-generated Python code fixes across 50+ GitHub repositories, evaluating "
    "frontier LLM performance using a 10-metric rubric covering correctness, reasoning, "
    "code quality, and task completion.",
    "",
    "PROJECTS",
    "Tailorcv.com",
    "- Shipped a Chrome extension that tailors resumes across 15 job boards (LinkedIn, "
    "Indeed, Naukri, Greenhouse, Lever, Workday), cutting tailoring from ~10 minutes to "
    "under 60 seconds; automated using Playwright.",
])


def test_comma_rich_bullet_is_not_read_as_a_stack_row():
    """A dense bullet full of commas is not a technology list.

    A stack row is a hard boundary while collecting an entry's original bullets,
    so misreading a comma-heavy bullet as one stopped the scan at the entry's
    first bullet and left every bullet protection inert.
    """
    bullet = ("Shipped a Chrome extension that tailors resumes across 15 job boards "
              "(LinkedIn, Indeed, Naukri, Greenhouse, Lever, Workday), cutting to 60 seconds.")
    assert not main._looks_like_stack_line(bullet), "dense bullet misread as a stack row"
    assert main._looks_like_stack_line("Python, PowerBI, SQL, Excel"), "real stack row missed"


def test_rewrite_that_drops_named_tools_is_reverted():
    parsed = {"projects": [{"name": "Tailorcv.com", "bullets": [
        "Launched a Chrome extension for resume tailoring on job boards, cutting "
        "preparation from ~10 minutes to under 60 seconds."]}]}
    out = main.enforce_bullet_facts(parsed, _FACTS_SOURCE)["projects"][0]["bullets"]
    assert "Playwright" in out[0], f"named tool not recovered: {out}"
    assert "Naukri" in out[0], f"enumerated item not recovered: {out}"


def test_rewrite_that_drops_an_enumeration_is_reverted():
    parsed = {"experience": [{"company": "Outlier", "title": "Python Engineer", "bullets": [
        "Evaluated AI-generated Python code fixes over 50+ GitHub repositories using a "
        "comprehensive evaluation rubric."]}]}
    out = main.enforce_bullet_facts(parsed, _FACTS_SOURCE)["experience"][0]["bullets"]
    assert "task completion" in out[0], f"lost enumeration not recovered: {out}"


def test_faithful_rewrite_is_left_alone():
    """The guard exists to stop data loss, not to undo tailoring."""
    faithful = ("Engineered a Chrome extension automating resume tailoring across 15 job "
                "boards (LinkedIn, Indeed, Naukri, Greenhouse, Lever, Workday), validated "
                "with Playwright and cutting per-application effort from ~10 minutes to "
                "under 60 seconds.")
    parsed = {"projects": [{"name": "Tailorcv.com", "bullets": [faithful]}]}
    out = main.enforce_bullet_facts(parsed, _FACTS_SOURCE)["projects"][0]["bullets"]
    assert out[0] == faithful, f"faithful rewrite was reverted: {out}"


def test_opening_verb_is_not_treated_as_a_fact():
    """Otherwise changing "Shipped" to "Engineered" would count as data loss."""
    facts = main._bullet_facts("Shipped a Chrome extension using Playwright")
    assert "shipped" not in facts, facts
    assert {"chrome", "playwright"}.issubset(facts), facts


# --------------------------------------------------------------------------- #
# PDF line-wrapping. A bullet that wraps arrives as two lines; the tail is under
# the word floor and was discarded, leaving the bullet truncated mid-sentence
# ("...quantitative methods for 10+"). Worse, a tail that happens to START with a
# section word ("publications and 20+ oral presentations.") was read as a section
# HEADING, which ended the section and lost every bullet after it.
# --------------------------------------------------------------------------- #

_WRAPPED_SOURCE = "\n".join([
    "EXPERIENCE",
    "Jadavpur University, Department of Computer Science",
    "Data Research Assistant",
    "Jan 2025 - Oct 2025",
    "- Engaged in end-to-end data collection processes using qualitative and quantitative methods for 10+",
    "research projects.",
    "- Analyzed quantitative data with a 7-man research team and presented results through 30 written",
    "publications and 20+ oral presentations.",
    "- Assisted in developing 10+ new papers that the department released to the public in 2025.",
])
_WRAPPED_IDENT = "Jadavpur University, Department of Computer Science"


def _wrapped_candidates():
    section_lines = main._restore_section_lines(_WRAPPED_SOURCE)
    orig = main._original_entry_candidates(section_lines, "experience", [_WRAPPED_IDENT])
    entry = {"company": _WRAPPED_IDENT, "title": "Data Research Assistant", "bullets": ["x"]}
    return main._entry_original_bullets(
        orig.get(_WRAPPED_IDENT), entry, [entry], ("company", "title")
    )


def test_wrapped_bullet_tail_is_rejoined():
    cands = _wrapped_candidates()
    assert any(c.endswith("for 10+ research projects.") for c in cands), cands


def test_section_word_in_a_wrapped_tail_is_not_a_heading():
    """"publications and 20+ oral presentations." is a sentence, not a heading."""
    assert main._heading_key("publications and 20+ oral presentations.") is None
    # ...and the bullets after it survive in the entry.
    cands = _wrapped_candidates()
    assert len(cands) == 3, f"bullets lost after the wrapped tail: {cands}"
    assert any("new papers" in c for c in cands), cands


def test_real_headings_still_detected():
    for text, expected in (
        ("PROJECTS", "projects"),
        ("Technical Skills and Interests", "skills"),
        ("Skills & Interests", "skills"),
        ("Professional Experience & Projects", "experience"),
        ("Experience:", "experience"),
    ):
        assert main._heading_key(text) == expected, f"{text!r} -> {main._heading_key(text)}"


# --------------------------------------------------------------------------- #
# Rewrite vs deletion: a vague original shares almost no words with a good
# rewrite of it, so word overlap alone read the rewrite as a deletion and
# appended the weak original underneath it.
# --------------------------------------------------------------------------- #

_VAGUE_SOURCE = "\n".join([
    "EXPERIENCE",
    "Acme Corp - Operations Analyst",
    "- Worked on monthly reporting and helped the sales team with their data needs.",
    "- Responsible for cleaning customer records and fixing errors.",
])


def _vague_out(bullets):
    parsed = {"experience": [{"company": "Acme Corp", "title": "Operations Analyst",
                              "bullets": list(bullets)}]}
    return main.restore_dropped_bullets(parsed, _VAGUE_SOURCE)["experience"][0]["bullets"]


def test_heavy_rewrite_of_vague_bullets_is_not_duplicated():
    out = _vague_out([
        "Automated recurring executive reporting, eliminating manual consolidation for the revenue organisation.",
        "Standardised client master records, removing duplicate and malformed entries at source.",
    ])
    assert len(out) == 2, f"weak originals restored under their rewrites: {out}"


def test_one_dropped_bullet_restores_exactly_one():
    """Restoring the dropped bullet must not also re-add the surviving one's original."""
    out = _vague_out(["Automated recurring executive reporting for the revenue organisation."])
    assert len(out) == 2, f"expected 1 restore, got {len(out)}: {out}"
    assert any("cleaning customer records" in b for b in out), out


def test_truncated_bullet_is_repaired():
    """A rewrite that is a prefix of the original is the original cut short.

    When a bullet wraps in the PDF the model sees two lines and sometimes copies
    only the first, ending mid-thought at "...methods for 10+". The fact check
    cannot see it: every number and proper noun is still present and the missing
    tail is ordinary lower-case words.
    """
    truncated = ("Engaged in end-to-end data collection processes using qualitative and "
                 "quantitative methods for 10+")
    parsed = {"experience": [{"company": _WRAPPED_IDENT, "title": "Data Research Assistant",
                              "bullets": [truncated]}]}
    out = main.enforce_bullet_facts(parsed, _WRAPPED_SOURCE)["experience"][0]["bullets"]
    assert out[0].endswith("research projects."), f"still truncated: {out}"


def test_genuine_rewrite_is_not_mistaken_for_truncation():
    good = ("Drove end-to-end data collection across 10+ research projects, applying both "
            "qualitative and quantitative methods.")
    parsed = {"experience": [{"company": _WRAPPED_IDENT, "title": "Data Research Assistant",
                              "bullets": [good]}]}
    out = main.enforce_bullet_facts(parsed, _WRAPPED_SOURCE)["experience"][0]["bullets"]
    assert out[0] == good, f"good rewrite was reverted: {out}"


# --------------------------------------------------------------------------- #
# Bullet boundaries when the PDF loses the bullet glyph.
#
# A new bullet opens with an action verb; a wrapped tail never does. Punctuation
# and line width were both tried and both failed: plenty of resumes write bullets
# with no trailing full stop (which glued a whole entry into one paragraph), and
# bullets of similar length each look like a wrap of the one above.
# --------------------------------------------------------------------------- #

_NO_PERIODS_SOURCE = "\n".join([
    "PROJECTS",
    "Inventory Management System | FastAPI, PostgreSQL GitHub",
    "- Developed a scalable inventory management system with full CRUD operations and "
    "multi-field search over product data",
    "Built RESTful APIs using FastAPI with asynchronous processing and automatic OpenAPI "
    "documentation",
    "Designed normalized PostgreSQL schemas to ensure data integrity and optimize query "
    "performance",
    "Integrated backend with frontend via Jinja2 templates and managed database interactions "
    "using SQLAlchemy / psycopg2",
])

_WRAPPED_TAILS_SOURCE = "\n".join([
    "PROJECTS",
    "Tailorcv.com",
    "- Shipped a Chrome extension that tailors resumes directly on job postings across 15 job "
    "boards (LinkedIn, Indeed, Naukri, Greenhouse,",
    "Lever, Workday), cutting per-application tailoring from ~10 minutes to under 60 seconds",
    "- Developed an interactive Power BI dashboard to visualize customer segments, revealing "
    "that Loyal customers",
    "(3,116 individuals) generate the highest revenue",
])


def _project_bullets(source, name):
    section_lines = main._restore_section_lines(source)
    orig = main._original_entry_candidates(section_lines, "projects", [name])
    entry = {"name": name, "bullets": ["x"]}
    return main._entry_original_bullets(orig.get(name), entry, [entry], ("name",))


def test_bullets_without_full_stops_are_not_merged():
    """Four bullets, none ending in a period, must stay four.

    They were fused into one paragraph reading "...over product data Built RESTful
    APIs... Designed normalized PostgreSQL schemas... Integrated backend..." and
    that reached a real resume.
    """
    out = _project_bullets(_NO_PERIODS_SOURCE, "Inventory Management System")
    assert len(out) == 4, f"bullets merged: {out}"
    assert any(b.startswith("Built RESTful") for b in out), out
    assert any(b.startswith("Designed normalized") for b in out), out
    assert any(b.startswith("Integrated backend") for b in out), out


def test_wrapped_tails_still_rejoin():
    """The opposite failure: a tail must not survive as a bullet of its own."""
    out = _project_bullets(_WRAPPED_TAILS_SOURCE, "Tailorcv.com")
    assert len(out) == 2, f"tails split into separate bullets: {out}"
    joined = " ".join(out)
    assert "Lever, Workday)" in joined and "Workday), cutting" in joined, out
    assert "(3,116 individuals) generate" in joined, out
    for b in out:
        assert not b.startswith(("Lever,", "(3,116")), f"fragment shipped: {b}"


def test_action_verb_opening_starts_a_new_bullet():
    for verb in ("Built", "Designed", "Integrated", "Developed", "Shipped"):
        assert verb.lower() in main._BULLET_ACTION_VERBS, verb
    # ...and these open continuations, not bullets.
    for word in ("ui", "lever", "usage", "publications"):
        assert word not in main._BULLET_ACTION_VERBS, word


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
