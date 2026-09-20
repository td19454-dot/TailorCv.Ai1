"""Regression tests for skill vocabulary coverage and category anchoring.

Covers the third defect found in QA on a real optimized resume: the extractor
knew infrastructure and observability but thinned out on analytics, payments
and browser-platform work - exactly what a full-stack SaaS resume is full of.
From one bullet we correctly pulled Sentry, Playwright, Netlify and Neon, then
missed GA4 and PostHog named in the same sentence as Sentry.

Also guards the category-anchoring rule: a row whose every member is a
category-shaped phrase ("Data & Analytics: Data Analysis") folds into "Other
Technical Skills", because a header that names an area of work rather than an
ownable tool advertises a gap.

Row SIZE is deliberately NOT part of that rule, and test_single_item_rows_are_
normal() pins that: demoting one-item rows buried Python and FastAPI under
"Other" on a backend resume, far worse than the thin row it was meant to tidy.

Run:  python test_skill_vocabulary.py
Exit code is non-zero if any test fails (CI-friendly).
"""

import sys
import traceback

import main
import skill_categories as skillcat

TOOLS, FW, OTHER = skillcat.TOOLS, skillcat.FRAMEWORKS, skillcat.OTHER
L, ANALYTICS = skillcat.LANGUAGES, skillcat.ANALYTICS


def rows(skills: list[str]) -> dict[str, list[str]]:
    out = {}
    for line in main.group_skills(skills):
        label, _, items = line.partition(":")
        out[label.strip()] = [i.strip() for i in items.split(",") if i.strip()]
    return out


def category_of(skill: str) -> str | None:
    return skillcat.classify_skill(skill)[0][1]


# --------------------------------------------------------------------------- #
# Vocabulary coverage
# --------------------------------------------------------------------------- #
def test_product_analytics_vendors_are_known():
    """Named in the same bullet as Sentry, which we already caught."""
    for name in ("GA4", "PostHog", "Mixpanel", "Amplitude", "Google Analytics 4"):
        assert category_of(name) == TOOLS, (name, category_of(name))


def test_payment_vendors_are_known():
    for name in ("Razorpay", "Polar", "Stripe", "PayPal", "Paddle"):
        assert category_of(name) == TOOLS, (name, category_of(name))


def test_browser_platform_work_is_a_real_skill():
    for name in ("Chrome Extension", "Browser Extension", "Manifest V3"):
        assert category_of(name) == TOOLS, (name, category_of(name))
    for name in ("DOM Manipulation", "Webhooks", "Service Workers"):
        assert category_of(name) == OTHER, (name, category_of(name))


def test_email_vendors_are_known():
    for name in ("Resend", "SendGrid", "Twilio", "Mailgun"):
        assert category_of(name) == TOOLS, (name, category_of(name))


def test_python_web_stack_is_known():
    for name in ("Uvicorn", "Alembic", "Jinja2", "WeasyPrint"):
        assert category_of(name) == FW, (name, category_of(name))


def test_no_new_term_is_filed_under_two_rows():
    assert not skillcat.DUPLICATE_TERMS, skillcat.DUPLICATE_TERMS


# --------------------------------------------------------------------------- #
# Generic phrases
# --------------------------------------------------------------------------- #
def test_generic_phrases_are_recognised():
    for phrase in ("Data Analysis", "Machine Learning", "Problem Solving",
                   "Web Development", "Software Engineering"):
        assert skillcat.is_generic_phrase(phrase), phrase


def test_named_products_are_not_generic():
    for name in ("Netlify", "SMTP", "GA4", "PostHog", "Python", "Razorpay",
                 "FastAPI", "PostgreSQL"):
        assert not skillcat.is_generic_phrase(name), name


# --------------------------------------------------------------------------- #
# Category anchoring
# --------------------------------------------------------------------------- #
def test_generic_only_row_folds_into_other():
    """'Data & Analytics: Data Analysis' must not render as its own header."""
    result = rows(["Python", "Data Analysis"])
    assert ANALYTICS not in result, result
    assert "Data Analysis" in result.get(OTHER, []), result


def test_a_named_member_keeps_the_row():
    """The same category renders once it holds something ownable."""
    result = rows(["Python", "Data Analysis", "Tableau", "ETL"])
    assert "Tableau" in result.get(skillcat.TOOLS, []), result
    assert ANALYTICS in result, result


def test_single_item_rows_are_normal():
    """Row size is not evidence of padding - this buried Python once."""
    result = rows(["Python", "FastAPI", "PostgreSQL"])
    assert result.get(L) == ["Python"], result
    assert result.get(FW) == ["FastAPI"], result
    assert result.get(skillcat.DATABASES) == ["PostgreSQL"], result
    assert OTHER not in result, result


def test_nothing_is_ever_dropped():
    src = ["Netlify", "SMTP", "Data Analysis", "Python", "FastAPI", "GA4",
           "Razorpay", "Chrome Extension", "DOM Manipulation", "Problem Solving"]
    flat = [i for items in rows(src).values() for i in items]
    missing = [s for s in src if s not in flat]
    assert not missing, missing


def test_the_reported_resume_line():
    """The real bullet: we caught Sentry and missed its sentence-mates."""
    result = rows(["Playwright", "Sentry", "Netlify", "SMTP", "Neon",
                   "GA4", "PostHog", "Razorpay", "Polar", "Chrome Extension"])
    tools = result.get(TOOLS, [])
    for name in ("Playwright", "Sentry", "GA4", "PostHog", "Razorpay",
                 "Polar", "Chrome Extension"):
        assert name in tools, (name, result)
    assert "Neon" in result.get(skillcat.DATABASES, []), result


tests = [
    test_product_analytics_vendors_are_known,
    test_payment_vendors_are_known,
    test_browser_platform_work_is_a_real_skill,
    test_email_vendors_are_known,
    test_python_web_stack_is_known,
    test_no_new_term_is_filed_under_two_rows,
    test_generic_phrases_are_recognised,
    test_named_products_are_not_generic,
    test_generic_only_row_folds_into_other,
    test_a_named_member_keeps_the_row,
    test_single_item_rows_are_normal,
    test_nothing_is_ever_dropped,
    test_the_reported_resume_line,
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
