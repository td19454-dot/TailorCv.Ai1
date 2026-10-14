"""Load and render campaign templates from marketing/templates/.

A campaign is one HTML file: a `---` frontmatter block (subject, optional
preheader) followed by a Jinja body that extends _base.html. The base adds the
footer, unsubscribe link and mailing address, so a campaign can't forget them.
"""
import os
from dataclasses import dataclass
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

TEMPLATES_DIR = Path(__file__).parent / "templates"

# StrictUndefined: a typo'd {{ frist_name }} fails the dry run instead of
# mailing "Hi ," to every recipient.
_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=True,
    undefined=StrictUndefined,
)


@dataclass(frozen=True)
class Campaign:
    name: str
    subject: str
    preheader: str
    body: str


def _split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    # Same BOM handling as blog_system._split_frontmatter.
    text = text.lstrip("﻿")
    if not text.startswith("---"):
        return {}, text
    _, header, body = text.split("---", 2)
    meta = {}
    for line in header.strip().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip("'\"")
    return meta, body.lstrip("\n")


def load_campaign(name: str) -> Campaign:
    if not name or name.startswith("_") or "/" in name or "\\" in name:
        raise ValueError(f"Invalid campaign name {name!r}")
    path = TEMPLATES_DIR / f"{name}.html"
    if not path.exists():
        available = sorted(p.stem for p in TEMPLATES_DIR.glob("*.html") if not p.stem.startswith("_"))
        raise FileNotFoundError(f"No template {path.name}. Available: {', '.join(available) or 'none'}")
    meta, body = _split_frontmatter(path.read_text(encoding="utf-8"))
    if not meta.get("subject"):
        raise ValueError(f"{path.name} needs a 'subject:' line in its frontmatter")
    return Campaign(name=name, subject=meta["subject"], preheader=meta.get("preheader", ""), body=body)


def template_vars(user, campaign: Campaign, unsubscribe_url: str) -> dict[str, str]:
    name = (user.name or "").strip()
    return {
        "name": name,
        "first_name": name.split()[0] if name else "there",
        "email": user.email,
        "campaign": campaign.name,
        "unsubscribe_url": unsubscribe_url,
        "base_url": os.getenv("APP_BASE_URL", "https://thetailorcv.com").strip().strip("'\"").rstrip("/"),
        "mailing_address": os.getenv("COMPANY_MAILING_ADDRESS", "").strip(),
        "preheader": campaign.preheader,
    }


def render(campaign: Campaign, variables: dict[str, str]) -> tuple[str, str]:
    """Return (subject, html) for one recipient."""
    subject_env = Environment(undefined=StrictUndefined)  # plain text: no HTML escaping
    subject = subject_env.from_string(campaign.subject).render(**variables)
    html = _env.from_string(campaign.body).render(**variables)
    return subject, html
