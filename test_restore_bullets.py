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
