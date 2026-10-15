"""Load and render campaign templates from marketing/templates/.

A campaign is one HTML file: a `---` frontmatter block (subject, optional
preheader) followed by a Jinja body that extends _base.html. The base adds the
footer, unsubscribe link and mailing address, so a campaign can't forget them.
"""
import os
import re
from dataclasses import dataclass
from pathlib import Path

from jinja2 import FileSystemLoader, StrictUndefined
from jinja2.sandbox import ImmutableSandboxedEnvironment

TEMPLATES_DIR = Path(__file__).parent / "templates"

# StrictUndefined: a typo'd {{ frist_name }} fails the dry run instead of
# mailing "Hi ," to every recipient. Sandboxed because the /admin/email editor
# feeds hand-written HTML straight into Jinja, and an unsandboxed template can
# reach Python internals ({{ ''.__class__.__mro__ ... }}) and run code.
_env = ImmutableSandboxedEnvironment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=True,
    undefined=StrictUndefined,
)

CAMPAIGN_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")
_WRAP_HEAD = '{% extends "_base.html" %}\n{% block body %}\n'
_WRAP_TAIL = "\n{% endblock %}\n"
_WRAP_RE = re.compile(
    r'^\s*\{%-?\s*extends\s+"_base\.html"\s*-?%\}\s*\{%-?\s*block\s+body\s*-?%\}\n?(.*?)\n?\{%-?\s*endblock\s*-?%\}\s*$',
    re.S,
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


def list_campaigns() -> list[str]:
    return sorted(p.stem for p in TEMPLATES_DIR.glob("*.html") if not p.stem.startswith("_"))


def inner_body(campaign: Campaign) -> str:
    """The editable part of a campaign: its body without the _base.html wrapper."""
    match = _WRAP_RE.match(campaign.body)
    return match.group(1) if match else campaign.body


def build_campaign(name: str, subject: str, preheader: str, inner_html: str) -> Campaign:
    """A Campaign from editor fields. The body is always wrapped in _base.html,
    so an editor-written email can't drop the unsubscribe footer."""
    if not CAMPAIGN_NAME_RE.match(name or ""):
        raise ValueError("Campaign name: 2-80 characters, lowercase letters, digits and hyphens.")
    subject, preheader = (subject or "").strip(), (preheader or "").strip()
    if not subject:
        raise ValueError("Subject is required.")
    for label, value in (("Subject", subject), ("Preheader", preheader)):
        if "\n" in value or "\r" in value or "---" in value:
            raise ValueError(f"{label} must be one line and can't contain '---'.")
    if "{% endblock" in inner_html or "{% extends" in inner_html:
        raise ValueError("Write only the email body; the header, footer and unsubscribe link are added for you.")
    return Campaign(name=name, subject=subject, preheader=preheader,
                    body=_WRAP_HEAD + inner_html.strip() + _WRAP_TAIL)


def save_campaign(campaign: Campaign) -> Path:
    path = TEMPLATES_DIR / f"{campaign.name}.html"
    text = f"---\nsubject: {campaign.subject}\npreheader: {campaign.preheader}\n---\n{campaign.body}"
    path.write_text(text, encoding="utf-8")
    return path


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
    subject_env = ImmutableSandboxedEnvironment(undefined=StrictUndefined)  # plain text: no HTML escaping
    subject = subject_env.from_string(campaign.subject).render(**variables)
    html = _env.from_string(campaign.body).render(**variables)
    return subject, html
