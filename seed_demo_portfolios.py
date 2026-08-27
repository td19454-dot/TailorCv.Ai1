"""Seed one published sample portfolio per theme so the builder's "View demo"
links resolve to our own site (https://thetailorcv.com/demo-<theme>) instead of
per-person Netlify sites that 404 once the Netlify account lapses.

Idempotent: re-running updates the existing demo rows in place (matched by the
fixed slug `demo-<theme>`), so it is safe to run after adding a new theme or
tweaking the sample content below.

Usage (uses DATABASE_URL from .env — point it at whichever DB you want seeded):

    venv/Scripts/python.exe seed_demo_portfolios.py            # create / refresh
    venv/Scripts/python.exe seed_demo_portfolios.py --list     # show what exists
    venv/Scripts/python.exe seed_demo_portfolios.py --delete   # remove all demo rows

There is no Alembic here; this script assumes the `users` and `portfolios`
tables already exist (they do on any DB the app has booted against).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from secrets import token_urlsafe

from auth import hash_password
from database import SessionLocal
from main import PORTFOLIO_THEMES, SITE_URL, _build_portfolio_data
from models import Portfolio, User

DEMO_OWNER_EMAIL = "portfolio-demos@thetailorcv.com"
DEMO_OWNER_NAME = "TailorCV Demos"
SLUG_PREFIX = "demo-"

DEMO_TAGLINE = "I build fast, reliable web apps end to end — from database schema to design system."
DEMO_ABOUT = (
    "I'm a full-stack engineer who likes turning fuzzy problems into simple, "
    "well-tested software. Lately I've been focused on performance work and "
    "developer tooling. Outside of work you'll find me trail running or "
    "tinkering with small open-source CLIs."
)

# Canned resume in the editor (`cvData`) shape that _build_portfolio_data reads.
SAMPLE_RESUME = {
    "personalInfo": {
        "name": "Jordan Rivera",
        "headline": "Full-Stack Software Engineer",
        "email": "jordan.rivera@example.com",
        "phone": "+1 (555) 012-3456",
        "location": "Austin, TX",
        "linkedin": "https://www.linkedin.com/in/example",
        "github": "https://github.com/octocat",
        "portfolio": "https://thetailorcv.com",
        "summary": (
            "Full-stack engineer with 6+ years shipping performant web apps end to "
            "end. Comfortable across the stack — Postgres and API design through to "
            "React and a shared design system."
        ),
    },
    "skills": {
        "languages": ["Python", "TypeScript", "Go", "SQL"],
        "frameworks": ["React", "Next.js", "FastAPI", "Node.js"],
        "cloud_and_tools": ["AWS", "Docker", "PostgreSQL", "Redis", "GitHub Actions"],
    },
    "experience": [
        {
            "company": "Northwind Labs",
            "title": "Senior Software Engineer",
            "dates": "2022 — Present",
            "location": "Remote",
            "details": [
                "Led migration of a monolith to a modular service architecture, cutting p95 latency by 38%.",
                "Built the internal design-system component library now used by four product teams.",
                "Mentored three engineers and introduced trunk-based development with preview deploys.",
            ],
        },
        {
            "company": "Brightpath",
            "title": "Software Engineer",
            "dates": "2019 — 2022",
            "location": "Austin, TX",
            "details": [
                "Shipped the customer billing portal (React + FastAPI) serving 120k monthly users.",
                "Cut infrastructure spend 25% by right-sizing containers and adding request-level caching.",
            ],
        },
    ],
    "projects": [
        {
            "name": "DevPulse",
            "subtitle": "React, FastAPI, WebSockets",
            "url": "https://thetailorcv.com",
            "github_link": "https://github.com/octocat",
            "details": [
                "Real-time dashboard that folds CI, error-rate and deploy signals into one view.",
                "Open-source, 800+ GitHub stars.",
            ],
        },
        {
            "name": "Lexi",
            "subtitle": "Python, spaCy",
            "github_link": "https://github.com/octocat",
            "details": [
                "CLI that summarizes and tags long PDFs locally, with no API calls.",
            ],
        },
    ],
    "education": [
        {
            "school": "University of Texas at Austin",
            "degree": "B.S. Computer Science",
            "year": "2015 — 2019",
            "score": "3.8 GPA",
        },
    ],
    "certifications": [
        {
            "name": "AWS Solutions Architect – Associate",
            "issuer": "Amazon Web Services",
            "year": "2023",
        },
    ],
    "extracurriculars": [
        {
            "role": "Mentor",
            "organization": "ATX Code Bridge",
            "dates": "2021 — Present",
            "details": ["Pair weekly with career-changers learning their first backend stack."],
        },
    ],
    "awards": ["Hackathon winner — ATX CivicTech 2021"],
}


def _get_or_create_owner(db) -> User:
    owner = db.query(User).filter(User.email == DEMO_OWNER_EMAIL).first()
    if owner is None:
        owner = User(
            name=DEMO_OWNER_NAME,
            email=DEMO_OWNER_EMAIL,
            hashed_password=hash_password(token_urlsafe(24)),
        )
        db.add(owner)
        db.flush()
    # Keep the owner "Pro" so demo pages render without the "Made with TailorCV"
    # watermark. Far-future date; refreshed on every run.
    owner.pro_until = datetime.utcnow() + timedelta(days=3650)
    return owner


def _build_data() -> dict:
    data = _build_portfolio_data(SAMPLE_RESUME)
    data["has_cv"] = False  # no stored resume PDF behind a demo -> hide "Download CV"
    return data


def seed(db) -> None:
    owner = _get_or_create_owner(db)
    data_json = json.dumps(_build_data(), separators=(",", ":"))
    themes = list(PORTFOLIO_THEMES.keys())

    for theme in themes:
        slug = f"{SLUG_PREFIX}{theme}"
        row = db.query(Portfolio).filter(Portfolio.slug == slug).first()
        if row is None:
            row = Portfolio(
                user_id=owner.id,
                resume_id=None,
                slug=slug,
                handle=None,
                token=token_urlsafe(16),
                theme=theme,
                headline="Full-Stack Software Engineer",
                tagline=DEMO_TAGLINE,
                about=DEMO_ABOUT,
                data_json=data_json,
                published=True,
            )
            db.add(row)
            action = "created"
        else:
            row.user_id = owner.id
            row.theme = theme
            row.headline = "Full-Stack Software Engineer"
            row.tagline = DEMO_TAGLINE
            row.about = DEMO_ABOUT
            row.data_json = data_json
            row.published = True
            action = "updated"
        print(f"  {action:8}  {SITE_URL}/{slug}")

    db.commit()
    print(f"\n{len(themes)} demo portfolios seeded.")


def list_rows(db) -> None:
    rows = (
        db.query(Portfolio)
        .filter(Portfolio.slug.like(f"{SLUG_PREFIX}%"))
        .order_by(Portfolio.slug)
        .all()
    )
    if not rows:
        print("No demo portfolios found.")
        return
    for r in rows:
        flag = "" if r.published else "  (unpublished)"
        print(f"  {SITE_URL}/{r.slug}  ->  theme={r.theme}{flag}")


def delete_rows(db) -> None:
    n = (
        db.query(Portfolio)
        .filter(Portfolio.slug.like(f"{SLUG_PREFIX}%"))
        .delete(synchronize_session=False)
    )
    db.commit()
    print(f"Deleted {n} demo portfolios.")


def main() -> None:
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    db = SessionLocal()
    try:
        if arg == "--list":
            list_rows(db)
        elif arg == "--delete":
            delete_rows(db)
        elif arg in ("", "--seed"):
            seed(db)
        else:
            print(__doc__)
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
