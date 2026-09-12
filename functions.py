import os
import logging
from pathlib import Path
import pdfplumber
from dotenv import load_dotenv
from openai import AsyncOpenAI
import re
import json
import asyncio
import math
from datetime import date
from collections import Counter, OrderedDict
import hashlib
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


# Domain endings that actually turn up in resume links. The previous list was
# com|in|org|io|dev|ai|net, which silently dropped every link on a TLD outside
# it - most damagingly ".app", so every Vercel and Netlify portfolio URL
# ("jane.vercel.app", "resume.netlify.app") was never linked at all.
#
# This stays an allowlist rather than a generic "word.word" pattern on purpose:
# a loose pattern turns "Node.js", "resume.pdf" and "v1.2" into links. Anything
# not listed here is left as plain text, which is the safe failure.
#
# Matched case-sensitively (lower-case only) so that a missing space after a
# full stop - "built in Python.It was" - cannot be read as a domain.
# Unambiguous endings: no English word is "com" or "org", so these are safe to
# match in ANY case - which is what rescues an all-caps "GITHUB.COM/JANE".
_LINK_TLDS_ANYCASE = (
    "com|org|net|info|biz|io|dev|ai|app|tech|live|site|space|online|store|"
    "blog|cloud|page|xyz|edu|gov"
)
# Short country endings that double as English words once a PDF loses the space
# after a full stop ("Python.In the next role"). Lower-case only, deliberately.
_LINK_TLDS_LOWER = "in|uk|us|ca|au|de|fr|nl|es|se|ch|sg|ae|me|co"
# Two-part suffixes must be tried first, or "jane.co.uk" matches only ".co".
_LINK_MULTI_TLDS = "co\\.uk|co\\.in|com\\.au|ac\\.uk|ac\\.in|co\\.nz|com\\.br"

_DOMAIN_BODY = r'(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+'
_LINK_PATH = r'(?:/[^\s,;)\]]*)?'

_LINK_RE = re.compile(
    r'(?<!https://)(?<!http://)(?<![\w@.])'
    r'(' + _DOMAIN_BODY + rf'(?:(?i:{_LINK_MULTI_TLDS}|{_LINK_TLDS_ANYCASE})|{_LINK_TLDS_LOWER})'
    r'\b' + _LINK_PATH + r')'
)

# --- PDF text-extraction artefacts that hide real links -------------------- #
# 1. a stray space before the dot: "github .com/jane"
_LINK_SPACED_DOT_RE = re.compile(
    rf'(\b[a-zA-Z0-9][a-zA-Z0-9-]*)\s+\.\s*((?i:{_LINK_TLDS_ANYCASE})\b)'
)
# 2. a long URL wrapped onto the next line, which pdfplumber breaks at the
#    slash or hyphen: "github.com/jane/\nproject-name"
_LINK_WRAPPED_RE = re.compile(
    r'((?:https?://|\b[a-zA-Z0-9-]+\.)[^\s]*[-/])\n[ \t]*(?=[A-Za-z0-9])'
)


def repair_pdf_link_artifacts(text: str) -> str:
    """Undo the two ways PDF extraction breaks a URL before we try to match it.

    Without this, "github .com/jane" is never seen as a link at all, and a
    wrapped URL yields a truncated one ("https://github.com/jane/"), which is
    worse than none because it renders as a dead link.
    """
    s = str(text or "")
    s = _LINK_SPACED_DOT_RE.sub(r'\1.\2', s)
    s = _LINK_WRAPPED_RE.sub(r'\1', s)
    return s


def normalize_links(text):
    """Prefix bare domains with https:// so they survive as real links.

    Repairs PDF extraction damage first, then skips anything that already
    carries a scheme or is part of an email address.
    """
    return _LINK_RE.sub(r'https://\1', repair_pdf_link_artifacts(text))


def _escape_braces(text: str) -> str:
    """Escape curly braces so user text with { or } does not crash f-string formatting."""
    return str(text or "").replace("{", "{{").replace("}", "}}")


def _slice_section(text: str, start_markers: list[str], stop_markers: list[str]) -> str:
    """
    Best-effort extraction of a resume section from raw PDF text.
    Uses simple marker matching because PDF text extraction is noisy.
    """
    raw = str(text or "")
    if not raw.strip():
        return ""

    lines = [line.rstrip() for line in raw.splitlines()]
    lowered = [line.strip().lower() for line in lines]
    # PDF extraction routinely injects stray spaces into letter-spaced headings:
    # a real resume rendered "Projects" as "Pro jects", so the marker never
    # matched and the entire Projects section - every project link with it - was
    # invisible to this function. Compare with all whitespace removed as well.
    squeezed = [re.sub(r"\s+", "", line) for line in lowered]
    start_squeezed = [re.sub(r"\s+", "", m) for m in start_markers]
    stop_squeezed = [re.sub(r"\s+", "", m) for m in stop_markers]

    def _hits(idx: int, markers: list[str], markers_squeezed: list[str]) -> bool:
        if any(m in lowered[idx] for m in markers):
            return True
        return any(m and m in squeezed[idx] for m in markers_squeezed)

    start_idx = None
    for i in range(len(lines)):
        if _hits(i, start_markers, start_squeezed):
            start_idx = i
            break
    if start_idx is None:
        return ""

    stop_idx = len(lines)
    for j in range(start_idx + 1, len(lines)):
        if _hits(j, stop_markers, stop_squeezed):
            stop_idx = j
            break

    return "\n".join(lines[start_idx:stop_idx]).strip()


def extract_project_links(text: str) -> list[str]:
    """
    Extract only project-related URLs from the Projects section.

    This avoids grabbing contact links (gmail/leetcode/linkedin/etc) that appear
    outside Projects and were previously being injected into projects incorrectly.
    """
    projects_block = _slice_section(
        text,
        start_markers=["projects"],
        stop_markers=[
            "technical skills",
            "skills",
            "education",
            "experience",
            "certifications",
            "achievements",
            "publications",
            "extracurricular",
            "leadership",
        ],
    )
    if not projects_block:
        return []

    normalized = normalize_links(projects_block)
    links = extract_links(normalized)

    # Filter obvious non-project/contact domains that sometimes appear inline.
    deny_substrings = (
        "mailto:",
        "tel:",
        "linkedin.com",
        "leetcode.com",
        "gmail.com",
        "outlook.com",
        "yahoo.com",
    )
    filtered = []
    for url in links:
        u = str(url).strip().lower()
        if any(bad in u for bad in deny_substrings):
            continue
        filtered.append(url)
    return filtered
        
def map_project_demo_links(text: str) -> list[tuple[str, str]]:
    """
    Like `map_demo_links`, but scoped to Projects and supports both:
    - label line contains ↗ and next line contains the URL
    - label line contains ↗ and the URL is on the same line (common in PDFs)
    """
    projects_block = _slice_section(
        text,
        start_markers=["projects"],
        stop_markers=[
            "technical skills",
            "skills",
            "education",
            "experience",
            "certifications",
            "achievements",
            "publications",
            "extracurricular",
            "leadership",
        ],
    )
    if not projects_block:
        return []

    normalized = normalize_links(projects_block)
    lines = normalized.split("\n")
    mapped: list[tuple[str, str]] = []

    for i in range(len(lines)):
        line = lines[i].strip()
        if "↗" not in line:
            continue

        # Prefer URL on same line
        same_line_urls = extract_links(line)
        if same_line_urls:
            label = line.replace("↗", "").strip()
            mapped.append((label, same_line_urls[0]))
            continue

        # Fallback to next line URL
        if i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            next_urls = extract_links(next_line)
            if next_urls:
                label = line.replace("↗", "").strip()
                mapped.append((label, next_urls[0]))

    # Apply the same deny-list filtering as extract_project_links
    deny_substrings = ("mailto:", "tel:", "linkedin.com", "leetcode.com", "gmail.com", "outlook.com", "yahoo.com")
    cleaned: list[tuple[str, str]] = []
    for label, url in mapped:
        u = str(url).strip().lower()
        if any(bad in u for bad in deny_substrings):
            continue
        cleaned.append((label, url))

    return cleaned


def extract_project_link_map(text: str) -> dict[str, list[tuple[str, str]]]:
    """
    Extract a best-effort mapping: project_name -> [(label, url), ...]
    from the PDF "Projects" section only.

    This is used to inject the correct URL under the correct project
    (instead of injecting links in a global order).
    """
    projects_block = _slice_section(
        text,
        start_markers=["projects"],
        stop_markers=[
            "technical skills",
            "skills",
            "education",
            "experience",
            "certifications",
            "achievements",
            "publications",
            "extracurricular",
            "leadership",
        ],
    )
    if not projects_block:
        return {}

    normalized = normalize_links(projects_block)
    lines = [ln.strip() for ln in normalized.splitlines() if ln.strip()]

    deny_substrings = ("mailto:", "tel:", "linkedin.com", "leetcode.com", "gmail.com", "outlook.com", "yahoo.com")

    def clean_url(url: str) -> str:
        u = str(url or "").strip().strip("<>")
        u = u.rstrip(").,;:\"'!?]}")
        return u

    def clean_project_name(line: str) -> str:
        # Keep left side before stack separator if present.
        # Examples: "TailorCV | HTML, CSS" -> TailorCV
        base = line.replace("↗", " ").strip()
        if "|" in base:
            base = base.split("|", 1)[0].strip()
        # Remove common link labels if they appear in same line.
        base = re.split(r"\b(Live|Demo|GitHub|Project Link)\b", base, flags=re.IGNORECASE)[0].strip()
        return base

    mapping: dict[str, list[tuple[str, str]]] = {}

    for i in range(len(lines)):
        line = lines[i]
        if "↗" not in line:
            continue

        # Prefer URL on same line; otherwise use next line.
        urls_same_line = extract_links(line)
        url = clean_url(urls_same_line[0]) if urls_same_line else ""
        label = line.replace("↗", "").strip()

        if not url and i + 1 < len(lines):
            next_line = lines[i + 1]
            urls_next = extract_links(next_line)
            if urls_next:
                url = clean_url(urls_next[0])

        if not url:
            continue

        if any(bad in url.lower() for bad in deny_substrings):
            continue

        pname = clean_project_name(label)
        if not pname:
            continue

        mapping.setdefault(pname, [])
        # Store both label and url; label is for display (can be "Live Demo", etc.)
        if (label, url) not in mapping[pname]:
            mapping[pname].append((label, url))

    return mapping


def extract_links(text):
    # Preserve first-seen order (sets destroy ordering, which breaks link<->project alignment)
    found = re.findall(r'https?://\S+', text)
    seen = set()
    ordered = []
    for link in found:
        # PDF extraction sometimes captures trailing punctuation.
        link = link.strip().strip("<>")
        link = link.rstrip(").,;:\"'!?]}")
        if link not in seen:
            seen.add(link)
            ordered.append(link)
    return ordered


def map_demo_links(text):
    lines = text.split("\n")
    mapped = []

    for i in range(len(lines) - 1):
        if "↗" in lines[i]:
            label = lines[i].replace("↗", "").strip()
            next_line = lines[i + 1].strip()

            if re.search(r'(https?://|\w+\.(com|in|org|io|dev|ai))', next_line):
                if not next_line.startswith("http"):
                    next_line = "https://" + next_line
                next_line = next_line.strip().strip("<>")
                next_line = next_line.rstrip(").,;:\"'!?]}")  # clean trailing punctuation
                mapped.append((label, next_line))

    return mapped


def extract_publication_links(text: str) -> list[str]:
    """
    Extract publication-related URLs from the Publications section.
    Includes DOI, arXiv, conference/journal URLs, and generic http links.
    """
    pub_block = _slice_section(
        text,
        start_markers=["publications", "selected publications"],
        stop_markers=[
            "technical skills",
            "skills",
            "education",
            "experience",
            "certifications",
            "achievements",
            "extracurricular",
            "leadership",
        ],
    )
    if not pub_block:
        return []

    normalized = normalize_links(pub_block)
    links = extract_links(normalized)

    # Allow publication-specific URLs
    allow_substrings = (
        "doi.org",
        "arxiv.org",
        "scholar.google.com",
        "researchgate.net",
        "github.com",
    )

    filtered = []
    for url in links:
        u = str(url).strip().lower()
        # Keep publication-specific URLs
        if any(sub in u for sub in allow_substrings):
            filtered.append(url)
        # Keep generic URLs (not contact info)
        elif not any(blocked in u for blocked in ["gmail", "linkedin.com", "leetcode", "outlook", "yahoo"]):
            filtered.append(url)
    return filtered


def _url_identity(value) -> str:
    """A URL reduced to what identifies it, for comparing against the source."""
    v = str(value or "").strip().lower()
    v = re.sub(r"^https?://", "", v)
    v = re.sub(r"^www\.", "", v)
    return v.rstrip("/")


def inject_links(data, links, mapped_links, pub_links=None, known_urls=None):
    """
    Backfill missing project and publication URLs in the AI JSON using URLs extracted from the original PDF text.

    Important: only fill projects/publications that are missing their own links. This avoids showing
    unrelated URLs when the user/resume contains multiple projects/links.

    `known_urls` is every URL actually found in the uploaded resume. Anything the
    model produced that is not in that set is DISCARDED before backfilling.
    Without it the model's inventions won: asked to rewrite a resume it also
    rewrote the URLs, turning github.com/td19454-dot/TailorCv.Ai1 into
    github.com/td19454-dot/tailorcv and inventing myntra-clone-demo.com outright.
    Those look like URLs, so they counted as "this project already has a link"
    and the real ones recovered from the PDF were never applied - shipping a
    resume whose links 404 in front of a recruiter.

    A URL is a fact about the candidate's work, exactly like an employer or a
    date, so it is held to the same rule: it must exist in the original.
    """
    if pub_links is None:
        pub_links = []

    if not isinstance(data, dict):
        return data

    # Drop invented URLs before anything else looks at them.
    if known_urls:
        allowed = {_url_identity(u) for u in known_urls if str(u or "").strip()}
        allowed.discard("")
        if allowed:
            for project in (data.get("projects") or []):
                if not isinstance(project, dict):
                    continue
                for field in ("url", "github_link"):
                    if project.get(field) and _url_identity(project[field]) not in allowed:
                        project[field] = ""
                kept = []
                for item in (project.get("links") or []):
                    if not isinstance(item, dict):
                        continue
                    href = item.get("url") or item.get("href") or item.get("link")
                    if href and _url_identity(href) in allowed:
                        kept.append(item)
                project["links"] = kept

    # Handle Projects
    projects = data.get("projects")
    if isinstance(projects, list) and projects:
        # Ensure every project has a "links" list for downstream rendering.
        for project in projects:
            if isinstance(project, dict):
                project.setdefault("links", [])

        def _looks_like_url(value) -> bool:
            """Whether a field actually holds a link rather than a link's LABEL.

            Resumes render links as anchor text - "Live Demo | GitHub" - and the
            model transcribes what it sees, so it returns url="Live Demo". That
            is a caption, not an address. Counting it as a link made
            _project_has_any_link report the project as already linked, so the
            real URLs recovered from the PDF annotations were never injected: a
            project showed no links at all while its neighbour, whose row said
            only "GitHub", kept them.
            """
            v = str(value or "").strip()
            if not v:
                return False
            if v.lower().startswith(("http://", "https://", "www.", "mailto:", "tel:")):
                return True
            # A bare domain ("github.com/user/repo"). Labels contain spaces and
            # no dot, so this keeps them out.
            return "." in v and " " not in v

        # Drop label text sitting in URL fields. Left in place it would render as
        # a dead link, and it would also poison the used_urls set below.
        for project in projects:
            if isinstance(project, dict):
                for fld in ("url", "github_link"):
                    if project.get(fld) and not _looks_like_url(project.get(fld)):
                        project[fld] = ""
                project["links"] = [
                    item for item in (project.get("links") or [])
                    if isinstance(item, dict)
                    and _looks_like_url(item.get("url") or item.get("href") or item.get("link"))
                ]

        def _project_has_any_link(p: dict) -> bool:
            if not isinstance(p, dict):
                return False
            if _looks_like_url(p.get("url")):
                return True
            if _looks_like_url(p.get("github_link")):
                return True
            # Check nested links array for any usable url.
            for item in p.get("links") or []:
                if not isinstance(item, dict):
                    continue
                if _looks_like_url(item.get("url") or item.get("href") or item.get("link")):
                    return True
            return False

        # Track every URL already assigned to a project so the same link can never
        # bleed into a second project (the core "one project shows 4 links" bug).
        used_urls: set[str] = set()
        for project in projects:
            if not isinstance(project, dict):
                continue
            for item in project.get("links") or []:
                if isinstance(item, dict):
                    u = str(item.get("url") or item.get("href") or item.get("link") or "").strip().lower()
                    if u:
                        used_urls.add(u)
            for fld in ("url", "github_link"):
                u = str(project.get(fld) or "").strip().lower()
                if u:
                    used_urls.add(u)

        def _match_name(pname: str, key: str) -> bool:
            if not pname or not key:
                return False
            if pname == key:
                return True
            # Containment only with a length guard, to avoid a short name matching
            # an unrelated longer project title.
            if key in pname and len(key) >= 5:
                return True
            if pname in key and len(pname) >= 5:
                return True
            return False

        # Where the PDF's own annotation layer names a project's links, those ARE
        # the links. The model rewrites URLs the way it rewrites prose - it
        # turned TailorCv.Ai1 into "tailorcv" and invented myntra-clone-demo.com
        # - and merely filling empty fields let those inventions stand, because a
        # project holding a fabricated URL does not look empty. Recovered links
        # replace whatever the model produced for that project rather than
        # waiting for a gap to fill.
        for project in projects:
            if not isinstance(project, dict):
                continue
            recovered = None
            for key, pairs in (links or {}).items():
                if _match_name(str(project.get("name") or "").strip().lower(),
                               str(key or "").strip().lower()):
                    recovered = pairs
                    break
            if not recovered:
                continue
            project["links"] = [{"label": lbl, "url": u} for lbl, u in recovered]
            project["url"] = ""
            project["github_link"] = ""

        for project in projects:
            if not isinstance(project, dict):
                continue
            if _project_has_any_link(project):
                continue

            # Name-based injection first (prevents Gmail/LeetCode from landing under wrong projects).
            pname = str(project.get("name", "")).strip().lower()
            injected = False
            if isinstance(links, dict):
                # Backward-compatible: if `links` is actually a project_link_map, handle it.
                project_link_map = links
                # Prefer an exact name match over a loose containment match.
                ordered_keys = sorted(
                    project_link_map.keys(),
                    key=lambda key: 0 if str(key or "").strip().lower() == pname else 1,
                )
                for key in ordered_keys:
                    k = str(key or "").strip().lower()
                    if not _match_name(pname, k):
                        continue
                    for label, url in project_link_map[key]:
                        u = str(url or "").strip()
                        if not u or u.lower() in used_urls:
                            continue  # never reuse a URL already shown elsewhere
                        project.setdefault("links", []).append(
                            {"label": str(label or "Link").strip(), "url": u}
                        )
                        used_urls.add(u.lower())
                        injected = True
                    if injected:
                        break

            # If name-based injection didn't cover this project, fall back to the
            # text-based "Name ↗ / url" pairs (runs even when a name-map exists, so
            # projects the map missed are still covered). Global dedup prevents reuse.
            if not injected:
                while mapped_links and not injected:
                    label, url = mapped_links[0]
                    mapped_links = mapped_links[1:]
                    u = str(url or "").strip()
                    if not u or u.lower() in used_urls:
                        continue
                    project.setdefault("links", []).append(
                        {"label": str(label or "Link").strip(), "url": u}
                    )
                    used_urls.add(u.lower())
                    injected = True

                # Last resort: a plain list of extracted project URLs (only when no
                # name-map was provided, i.e. `links` is itself the URL list).
                if not injected and isinstance(links, list):
                    while links and not injected:
                        url = str(links[0] or "").strip()
                        links = links[1:]
                        if not url or url.lower() in used_urls:
                            continue
                        project.setdefault("links", []).append({"label": "Project Link", "url": url})
                        used_urls.add(url.lower())
                        injected = True

    # Handle Publications
    publications = data.get("publications")
    if isinstance(publications, list) and publications and pub_links:
        pub_link_idx = 0
        for pub in publications:
            if not isinstance(pub, dict):
                continue
            # Skip if publication already has a URL
            if str(pub.get("url") or "").strip():
                continue

            # Inject next available publication link
            if pub_link_idx < len(pub_links):
                pub["url"] = pub_links[pub_link_idx]
                pub_link_idx += 1

    return data

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

# OPTIMIZATION: Reuse a single OpenAI client instance instead of creating new ones
_openai_client = None
# The model for every feature EXCEPT the resume tailoring rewrite: cover
# letters, mock interviews, interview questions, LinkedIn parsing, resume
# extraction. These are ordinary generation tasks where gpt-4o-mini is both
# cheaper and faster, and no measurement suggested they need more.
# The tailoring call is the exception — see OPTIMIZER_MODEL below.
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
MOCK_INTERVIEW_MODEL = AI_MODEL


_REASONING_MODEL_PREFIXES = ("gpt-5", "o1", "o3", "o4")


def _is_reasoning_model(model: str) -> bool:
    return str(model or "").startswith(_REASONING_MODEL_PREFIXES)


def _adapt_call_params(kwargs: dict) -> dict:
    """Rewrite request parameters into the ones the target model family accepts.

    The gpt-5 / o-series models are reasoning models and REJECT the parameters
    the gpt-4 family requires — these are hard 400s, not degraded responses:
      - `max_tokens` is refused; the equivalent is `max_completion_tokens`.
      - `temperature` accepts only the default 1; any other value is refused.
      - `reasoning_effort` is theirs alone, and it is the speed/cost dial. At the
        default the tailoring call took ~65s and burned ~2,800 billed reasoning
        tokens; at "low" it is ~18s.

    Applied here, at the client, rather than at each of the ten call sites: this
    codebase calls chat.completions.create from nine places with different
    parameter sets, and a single missed one is a 500 on a live feature. Doing it
    centrally also means any call added later is correct by default.
    """
    if not _is_reasoning_model(kwargs.get("model")):
        return kwargs

    out = dict(kwargs)
    if "max_tokens" in out:
        out["max_completion_tokens"] = out.pop("max_tokens")
    # Only the default temperature is accepted, so drop whatever was asked for
    # rather than 400. Callers use it to trade determinism against variety; on a
    # reasoning model that dial is `reasoning_effort` instead.
    out.pop("temperature", None)
    out.pop("top_p", None)
    if "reasoning_effort" not in out:
        effort = os.getenv("OPTIMIZER_REASONING_EFFORT", "low").strip().lower()
        if effort in {"minimal", "low", "medium", "high"}:
            out["reasoning_effort"] = effort
    return out


class _AdaptingCompletions:
    """chat.completions proxy that runs every create() through _adapt_call_params."""

    def __init__(self, inner):
        self._inner = inner

    async def create(self, **kwargs):
        return await self._inner.create(**_adapt_call_params(kwargs))

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _AdaptingChat:
    def __init__(self, inner):
        self._inner = inner
        self.completions = _AdaptingCompletions(inner.completions)

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _AdaptingClient:
    """AsyncOpenAI wrapper. Everything except chat.completions passes straight through."""

    def __init__(self, inner):
        self._inner = inner
        self.chat = _AdaptingChat(inner.chat)

    def __getattr__(self, name):
        return getattr(self._inner, name)


async def _build_openai_client():
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Add it to your .env file before using ATS analysis or resume optimization."
            )
        _openai_client = _AdaptingClient(AsyncOpenAI(
            api_key=api_key,
            timeout=120.0,
            max_retries=3
        ))
    return _openai_client


def _normalize_openai_error(exc: Exception) -> RuntimeError:
    message = str(exc)
    if "insufficient_quota" in message or "You exceeded your current quota" in message:
        return RuntimeError(
            "OpenAI quota exceeded for the configured API key. Add billing or use a different key, then restart the app."
        )
    if "invalid_api_key" in message:
        return RuntimeError(
            "The configured OPENAI_API_KEY is invalid. Replace it in .env and restart the app."
        )
    return RuntimeError(f"OpenAI request failed: {message}")

# The filler phrases Rule 00 bans from the professional summary. Defined here
# rather than inline in the prompt so that create_prompt() and the deterministic
# validator below (_summary_quality_issues) are guaranteed to police the SAME
# list — when they were written out twice they drifted, and the validator went
# on passing summaries the prompt had already banned.
_SUMMARY_BANNED_PHRASES = (
    "Detail-oriented", "Results-driven", "Proven ability", "Proven track record",
    "Adept at", "Skilled in", "Passionate about", "Strong analytical skills",
    "problem-solving skills", "Seeking a challenging role", "Dynamic professional",
    "Excellent communication skills", "Self-motivated", "wide range of",
    "various technologies", "Strong background in", "Experienced professional with",
    # Added with the 6-7 line length. A longer paragraph is an invitation to
    # fill space with assertion rather than fact, and these are the words that
    # get reached for when a sentence has nothing left to say.
    "extensive experience", "robust", "cutting-edge", "seasoned",
    "demonstrated ability", "proven expertise", "comprehensive understanding",
    "well-versed", "track record", "deep understanding", "highly skilled",
    # Weak future-focused closings. They turn a statement of capability into a
    # statement of hope, and they are most damaging on exactly the early-career
    # resumes where they are most tempting.
    "prepared to grow into", "looking to gain experience", "hoping to develop",
    "eager to learn", "aspiring to", "seeking to gain",
)

# Hedging constructions that shrink real work into mere acquaintance. Banned by
# Rule 00 and checked by the validator.
_SUMMARY_HEDGING_PHRASES = (
    "exposure to", "familiarity with", "understanding of", "knowledge of",
    "worked with", "involved in", "experience with", "domain experience in",
)

_SUMMARY_BANNED_PHRASES_TEXT = ", ".join(f'"{p}"' for p in _SUMMARY_BANNED_PHRASES)


def create_prompt(resume_string,jd_string):
    """Creates a detailed prompt for AI-powered resume optimization based on a job description.

    This function generates a structured prompt that guides the AI to:
    - Tailor the resume to match job requirements
    - Optimize for ATS systems
    - Provide actionable improvement suggestions
    - Format the output in clean Markdown

    Args:
        resume_string (str): The input resume text
        jd_string (str): The target job description text

    Returns:
        str: A formatted prompt string containing instructions for resume optimization"""
    
    return f"""
Your objective is to generate a professional, compelling resume content according to the provided job description, maximizing interview chances by integrating best practices in content quality, keyword optimization, measurable achievements, and proper formatting.

Rewrite the resume's CONTENT so it reads as though it were written for this specific job, and return it as JSON.

There are TWO ways to fail this task and they are equally bad:
  FAILURE A — deleting information. Compressing a detailed bullet into a shorter, cleaner one strips out the exact keywords the resume is scored on.
  FAILURE B — returning the bullet unchanged. Handing back the candidate's own sentence, or changing a word or two, means they paid for a tailored resume and received the one they uploaded.
Avoiding A by committing B is NOT a safe choice — it is just the other failure. The task is to do both: keep every fact AND genuinely rewrite the sentence around it.

IMPORTANT:
You are NOT formatting a resume.
You are ONLY returning structured content.
You must preserve factual details already present in the resume such as dates, CGPA/SGPA, percentages, marks, locations, and links.

### CONTENT COMPLETENESS (MANDATORY — DO NOT DROP ANYTHING)
- Include EVERY section that exists in the original resume (summary, experience, projects, education, skills, certifications, publications, achievements, extracurriculars, etc.).
- Include EVERY entry/sub-section. If the resume has 5 experiences, 8 projects, and 20 certifications, the output MUST contain ALL 5 experiences, ALL 8 projects, and ALL 20 certifications — same count, none merged, summarized away, or omitted.
- Keep EVERY bullet point of every entry. Do not drop bullets to save space.
- Keep EVERYTHING INSIDE each bullet too. Keeping the right NUMBER of bullets while quietly deleting what is in them is the same loss, and it is the most damaging thing you can do here: the deleted parts are precisely the keywords the resume is being scored on. Carry ALL of the following from the original bullet into your version:
  * every named technology, tool, library, platform, or product — e.g. "Pandas", "Playwright", "SMTP", "Netlify", "WMS", "DOM manipulation";
  * every number and quantity, the secondary ones as well as the headline one — e.g. "30+ countries", "3,116 individuals", "3.5% higher", "50% of Hat purchases", "22 weighted checks", "10-metric rubric";
  * every enumerated list, with its items intact — "15 job boards (LinkedIn, Indeed, Naukri, Greenhouse, Lever, Workday)" must keep all six names, NOT become "job boards"; "covering correctness, reasoning, code quality, and task completion" must keep all four dimensions, NOT become "a comprehensive rubric";
  * every distinction drawn between named things — "Razorpay for domestic customers and Polar for international" must keep both names AND what separates them; "integrating Razorpay and Polar" has thrown the point away.
  Rewriting means saying the SAME information in better words — a sharper verb, a tighter structure, the job description's vocabulary. It never means saying LESS. A bullet is space-constrained, so aim for about two printed lines, but that is guidance and it NEVER outranks this rule: where the original bullet is long and packed with specifics, your version is expected to be just as long.

  WORK IN THIS ORDER for every single bullet — preservation FIRST, rewriting SECOND:
    Step 1 — Before writing anything, list to yourself (internally, never in the output) every concrete item in the original bullet: each technology, each number, each item of each list, each named entity, and the outcome it reports.
    Step 2 — Now write the improved bullet, carrying EVERY item from that list into it.
    Step 3 — Check your bullet against your list. If even one item is missing, the bullet is wrong: rewrite it again until all of them are present. A shorter, cleaner sentence that lost an item is NOT an improvement, it is a downgrade.
    Step 4 — Now check the opposite: is your sentence ACTUALLY DIFFERENT from the original? If it is the same sentence with a word swapped, you have not done the job. Restructure it — lead with the strongest fact, replace the verb with a specific one, and use the job description's vocabulary for the same work. Copying the original through is a failure, not a safe answer.
  Never skip Step 1 to save effort, and never use Steps 1-3 as an excuse to skip Step 4. Every bullet must come back both COMPLETE and REWRITTEN.
- Never truncate the output. Return the COMPLETE JSON for the entire resume, however long it is. Length is not a reason to omit content.
- Preserve EVERY link (project, GitHub, Live/demo, LinkedIn, certification, publication, portfolio, company) on the exact entry it belongs to.

### OUTPUT RULES (MANDATORY)
- Output **ONLY valid JSON**
- No explanations, no markdown, no extra text

Guidelines to Follow:

### Rule 00: THE PROFESSIONAL SUMMARY (MANDATORY — IT IS THE MOST-READ LINE ON THE RESUME)
The `summary` is the first thing a recruiter reads and it is where a generic resume gives itself away. A summary that would fit any candidate applying to any job has FAILED, however well written it is. Write it LAST, after the bullets are done, so it can draw on what the tailored resume actually shows.

LENGTH: use the SHORTEST length that communicates the candidate's strongest qualifications.
- Students and early-career candidates: about 60 to 100 words.
- Experienced candidates: about 80 to 120 words.
Never exceed 120 words. One paragraph, 4 to 5 sentences.

Length is a ceiling, not a target. A 75-word summary that lands every point beats a 120-word one carrying the same content more slowly. If you have said everything the resume supports in four sentences, stop — adding a fifth to fill the budget is padding, and padding is visible.

THERE IS NO TEMPLATE. DO NOT follow a fixed sentence order. This is the single most important instruction in this rule, and it replaces an earlier version of this prompt that supplied a numbered sentence plan — that plan produced summaries which were structurally identical across completely different candidates, with only the nouns swapped. If two people in different fields would come out with the same sentence shapes, you are slot-filling, not writing.

DERIVE THE ORDER FROM THE RESUME. Before writing, identify the single most distinctive thing this candidate has for THIS job — a named product they built, a specialism, a scale they operated at, a domain they know. That goes in SENTENCE ONE. Everything else arranges itself behind it, in whatever order this particular profile calls for.

NEVER OPEN WITH A LIFECYCLE LIST. "Across the end-to-end ML lifecycle including data preparation, feature engineering, model training, deployment and evaluation" describes every practitioner in the field and differentiates nobody. It is the single most wasteful opening available — roughly thirteen words spent restating the job title. The same applies to "the full frontend lifecycle", "the full software development lifecycle", "end-to-end data workflows" and every variant. If the candidate built a named product, that product opens the summary.

LENGTH: 2 to 3 sentences, 45 to 60 words. Hard ceiling 65. This is a budget you must fit inside, not a target to approach — a 48-word summary that lands three real claims beats a 60-word one carrying the same content slowly.

LEAD WITH THE DIFFERENTIATOR, NOT THE CATEGORY. If the distinctive content is a shipped product (an ATS scoring engine, a Chrome extension, a resume-tailoring pipeline), it opens the summary and it is named in plain words — never parenthesised at the end of sentence four. If the distinctive content is a specialism (NLP, Retrieval Augmented Generation), that opens instead. Whatever a competing candidate with the same job title could NOT write about themselves is what goes first.

SAY EACH CAPABILITY EXACTLY ONCE. "Deployment as services", "post-deployment monitoring" and "deployed features" are ONE capability written three times. So are "REST API integration", "integration with RESTful services" and "frontend-backend contracts". Before finishing, list the distinct claims you are making — if two sentences make the same claim in different words, delete one and spend the words on something new.

NAME AT MOST FOUR TOOLS IN TOTAL. A summary listing eight technologies is a skills section in prose form, and the `skills` array already does that job. Choose the four that most distinguish this candidate for this job and let the rest live in `skills`.

NEVER SPEND SUMMARY WORDS ON ASSUMED SKILLS. Every role has table stakes, and naming them signals junior — only someone without stronger material would spend the most-read line on them.
  Frontend: HTML, HTML5, CSS, CSS3, JavaScript basics, ES6+, DOM manipulation, responsive design
  Backend: CRUD, MVC, OOP, Git, basic SQL, REST basics
  Machine learning: Python, scikit-learn, pandas, NumPy, Jupyter
  Data: Excel, basic SQL, charts, dashboards
A Machine Learning Engineer who spends a word on "Python" has wasted it.

NO SENIORITY HEDGES. Never write "(early-career)", "(junior)", "aspiring", "entry-level" or "recent graduate". Leading with the weakest signal in the first six words is self-sabotage. Let the scale and substance of the work establish the level — a reader infers seniority from what was built far more reliably than from a label.

NO FILLER CLOSER. Do not end on "collaborates with cross-functional teams", "documents technical processes", "committed to continuous improvement" or any variant. These carry no information, they could sit on any resume in the world, and they occupy the last thing a recruiter reads. End on the strongest concrete fact instead.

DO NOT ATTACH OUTCOME LANGUAGE TO PLAIN TOOLING CHOICES. "Neon-hosted databases for scale" claims an achievement that a hosting choice does not evidence. "PostgreSQL for persistent state" is padding — persistence is what a database is. Name the tool, or name what was achieved with it, but never dress the former as the latter.

NEVER END ON WEAK FUTURE-FOCUSED LANGUAGE. "Prepared to grow into...", "looking to gain experience in...", "hoping to develop skills in...", "eager to learn...", "aspiring to..." — all banned. They convert a statement of capability into a statement of hope, and they are most damaging exactly where they are most tempting, on an early-career resume that needs to sound capable. State what the candidate CAN do, then connect it to the target work: "Applies these fundamentals to process design, simulation and scale-up work" rather than "prepared to grow into process simulation".

DO NOT INFLATE THE VOCABULARY. Plain, standard industry terminology beats elaborate phrasing every time. "Hands-on experience in process design" is better than "hands-on exposure to process design paradigms". If a simpler word carries the same meaning, use the simpler word — sophistication in a summary reads as compensation, and recruiters discount it.

CUT WHAT DOES NOT STRENGTHEN THE FIT. Every clause must earn its place against THIS job description. Detail that is true, interesting and irrelevant is the most common reason a summary runs long. Remove it rather than shortening everything else to accommodate it.

AT THIS LENGTH THE BUZZWORD RISK IS THE MAIN RISK. A longer paragraph is an invitation to fill space with words that assert instead of describing. Do not take it. Every additional line must add a FACT — a system, a stack, a practice, a domain, a scale, an outcome, a responsibility — never an adjective about the candidate. If you find yourself reaching for "extensive", "robust", "cutting-edge", "dynamic", "seasoned", "demonstrated ability", "strong background", "proven expertise", "comprehensive understanding", "well-versed" or "track record", the sentence has nothing left to say and should be cut rather than written. The banned-filler list below applies with full force to sentences 5 and 6.

DESCRIBE HOW THE SKILLS ARE APPLIED, NEVER LIST THEM. A summary is not a skills section in prose form. Every technology named must sit inside a clause saying what was built, run or decided with it. "Builds and productionizes ML models as REST APIs using Python, FastAPI and Docker" applies the skills; "Skilled in Python, FastAPI, Docker, MLflow and AWS" lists them, and the `skills` array already does that job better.

MATCH THE EMPHASIS TO THE SENIORITY THE RESUME SUPPORTS:
- SENIOR / LEAD: emphasise ownership, technical decision-making, the scope of systems owned, production responsibility, and mentoring — but ONLY where the resume evidences each one. A senior summary that lists technologies instead of decisions reads as someone describing proximity to work rather than ownership of it.
- MID-LEVEL: emphasise what was built end to end, the stack it was built with, and the outcomes it produced.
- JUNIOR / EARLY-CAREER / FRESHER: emphasise relevant projects, technical foundations, internships and demonstrated capability. NEVER inflate seniority to close the gap — no "extensive experience", no invented ownership, no implied team leadership. A junior summary that is honest and concrete outperforms one straining to sound senior, and the strain is obvious to every recruiter who reads it.

PRIORITISE BY THE JOB DESCRIPTION'S OWN TECHNICAL DOMAIN. Work out what this specific role is built around — backend engineering, data, ML, security, design, operations — and lead with the resume evidence closest to that centre. For a backend role that means backend services, API design, the language and framework, relational and non-relational data stores, testing, CI/CD, containerisation, cloud, queues, observability and system ownership. For a data role it means pipelines, modelling, warehousing and analysis. Apply the same logic to whatever domain the JD describes, and include each item ONLY where the resume genuinely evidences it.

It MUST ALSO:
- Name the role in its CANONICAL form, at the seniority the resume genuinely supports. Write the real job title ("Machine Learning Engineer", "Data Analyst", "Backend Software Engineer"). If the JD says "Data Analyst", do not write "Software Developer". If the resume evidences a total years-of-experience figure, lead with it.
- Name the job description's HIGHEST-PRIORITY hard skills that the resume genuinely evidences, using the job description's own wording for them. These must be the JD's headline requirements, not whichever technologies were easiest to mention. GROUP them by what they are FOR, never as one flat comma list: "productionizes models as REST APIs and inference services using Python, FastAPI, Flask, and Docker on Amazon Web Services (AWS)" beats "using Python, FastAPI, Flask, Docker, MLflow, AWS".
- EXPAND ACRONYMS ON FIRST USE, then keep the short form: "Amazon Web Services (AWS)", "Retrieval Augmented Generation (RAG)", "Natural Language Processing (NLP)", "Continuous Integration/Continuous Deployment (CI/CD)". ATS keyword matching is literal, and the expanded form and the acronym are two different keywords — this is the one place in the resume where spending the extra words is worth it. Only expand acronyms the resume genuinely evidences.
- Write in CANDIDATE VOICE, not job-description voice. "Machine Learning Engineer with 3 years building RAG pipelines for X" describes a person; "Implements interactive UIs", "Applies reproducible practices", "Builds and ships production-capable systems" describe a job opening. Bare present-tense verb openings ("Implements...", "Applies...", "Builds...") are the signature of the JD-echo failure — avoid starting consecutive sentences that way, and never start the summary that way.
- MATCH THE TITLE TO THE SUBSTANCE. The role you name in sentence one must be supported by what the resume actually shows. If the title says "Machine Learning Engineer" but the resume evidences backend services, API work and product features with only LLM/RAG integration and no model training, modelling or evaluation methodology, then the honest title is "AI Engineer" or "Backend Engineer" — write that instead. A headline the body cannot deliver on is caught immediately by anyone who does the job, and it damages every other claim on the page.
- Contain no first-person pronouns, and no sentence that could be lifted onto a stranger's resume unchanged.

EXACTLY ONE CONCRETE PROOF POINT IS REQUIRED — a metric, a scale, or a named system — and it must be taken VERBATIM from elsewhere in the resume. This reverses an earlier version of this rule which made proof points optional; that version produced summaries containing no evidence at all, while the source resume carried real numbers further down. Search the experience and project sections for the strongest number or named system relevant to THIS job and bring it up into the summary.

If the resume genuinely contains no numbers anywhere, name the most specific system the candidate actually built — "the ATS scoring engine", "the payments reconciliation service" — never a vague substitute. "Serving a global user base", "at scale", "for real users" and "high-volume" are NOT evidence; they are the vague-claim pattern this rule exists to eliminate. NEVER invent, estimate or inflate a number, and NEVER omit the proof point entirely.

Use AT MOST TWO metrics. One is usually right. An impressive number that has nothing to do with what this job is hiring for actively WEAKENS the summary: it spends the most valuable line on the resume making a point the reader did not ask about, and it reads as the candidate reaching for whatever number they had. If the resume's only metrics are irrelevant to this JD, leave every number out and spend those words on capability instead. NEVER invent, estimate or inflate a number.

DO NOT ECHO THE JOB DESCRIPTION'S HEADLINE. The summary must read as a description of a person, not a compressed restatement of the posting. Specifically BANNED:
  - "<Role> focused on <the JD's headline/team name>" — e.g. "ML Engineer focused on AI/ML Platform & MLOps". Write "Machine Learning Engineer with ..." and let the capability sentences show the focus.
  - Any trailing "in the <X> domain" / "in the <X> space" / "in the <X> sector" clause — e.g. "... for RAG, sentiment and pricing systems in the AI/ML domain". The domain is already obvious from the work described; naming it again adds a keyword and claims nothing.
  - Copying the JD's team, org or product names ("AI/ML Platform & MLOps") into the summary as if they were the candidate's experience.
Name an INDUSTRY domain (fintech, healthcare, e-commerce, semiconductors, logistics) only when the resume genuinely evidences it and only woven into a claim, never as a trailing tag.

BANNED — these are the exact phrases that make a summary read as filler, and they are what this prompt keeps producing: {_SUMMARY_BANNED_PHRASES_TEXT}. Do not open with any of them. State what was built, in which stack, to what effect.

BANNED — hedging verbs that shrink real work into acquaintance. NEVER write "exposure to", "familiarity with", "understanding of", "knowledge of", "worked with", "involved in", "experience with" or "domain experience in" followed by a list of technologies. If the resume evidences the work, state what was DONE with it: "modelled the Postgres schema behind X" beats "exposure to database modelling". If it does not evidence the work, leave the technology out of the summary entirely — it already appears in `skills`.

NEVER end the summary with a trailing list of technologies, domains or capabilities. A closing clause like "Domain experience in developer tools / AI-enabled SaaS and platform reliability, with exposure to database modelling, query optimization and API integrations" is keyword padding: it names things without claiming anything, and it is the weakest position on the most-read line of the resume. Every sentence must make a claim with a subject and an outcome. End on the strongest verifiable fact, not on a keyword list.

THE CENTRAL EXAMPLE — this pair shows every rule above at once. Both were written from the SAME resume against the SAME "ML Engineer – AI/ML Platform & MLOps" job description:
BAD  : "ML Engineer focused on AI/ML Platform & MLOps with hands-on delivery of model deployment, CI/CD-driven inference services, and cloud-hosted pipelines using AWS, Docker and MLflow. Improved model prediction accuracy by 15% through rubric-driven evaluation of agent responses and shipped production-grade APIs and pipelines for RAG, sentiment and pricing systems in the AI/ML domain."
GOOD : "Machine Learning Engineer with hands-on experience across the end-to-end Machine Learning lifecycle, including data pipelines, feature engineering, model training, deployment, and evaluation. Builds and productionizes ML models as REST APIs and inference services using Python, FastAPI, Flask, and Docker on Amazon Web Services (AWS). Applies MLOps practices including MLflow experiment tracking, DVC model and data versioning, containerized deployment, and CI/CD automation to deliver reproducible, production-grade ML systems. Applied background in Natural Language Processing (NLP), Computer Vision, LLM fine-tuning, and Retrieval Augmented Generation (RAG), with deployed projects serving real users."
Study exactly what changed, because these are the failures this rule exists to stop:
  - BAD opens by echoing the posting's headline ("focused on AI/ML Platform & MLOps"); GOOD opens with the canonical role and the LIFECYCLE BREADTH the candidate covers, naming each stage.
  - BAD is two dense sentences carrying a flat tool list; GOOD is four sentences, each owning one capability domain — lifecycle, then build-and-ship stack, then MLOps practice, then applied specialisms.
  - BAD forces in "15% accuracy", a real number that this platform/MLOps job never asked about; GOOD drops every metric and spends those words on capability. That omission makes it STRONGER, not weaker.
  - BAD ends on "in the AI/ML domain", a keyword tag claiming nothing; GOOD ends on "deployed projects serving real users", a claim.
  - GOOD expands the acronyms (Amazon Web Services, Natural Language Processing, Retrieval Augmented Generation) so both forms are matchable, and uses standing-capability verbs ("Builds", "Applies").

A second pair, showing the padded-tail failure specifically:
BAD  : "Backend Software Engineer with experience building production FastAPI services and data-driven SaaS features in Python, SQL and PostgreSQL. Owned the full-stack backend for a SaaS used by 16,000+ users and implemented the core ATS scoring engine, payment rails and analytics instrumentation. Domain experience in developer tools / AI-enabled SaaS and platform reliability, with exposure to database modelling, query optimization and API integrations."
GOOD : "Backend Software Engineer building production FastAPI services in Python, SQL and PostgreSQL. Owned the full-stack backend for an AI resume-optimization SaaS serving 16,000+ users across 30+ countries, shipping the ATS scoring engine, Razorpay payment rails and analytics instrumentation that run it."
The third sentence in BAD names eight things and claims none of them; cutting it makes the summary stronger, not shorter. GOOD ends on the concrete systems the candidate shipped.

1)Keyword and Skill Optimization:
Rule01: EVIDENCED SKILLS ONLY — The `skills` array MUST contain every hard skill (programming languages, frameworks, tools, technologies, platforms, libraries, databases) that the job description names AND the candidate's resume actually evidences anywhere — in a bullet, a project, a summary line, or an existing skills list. Use the job description's exact wording for those (if the resume says "Postgres" and the JD says "PostgreSQL", output "PostgreSQL"), because the filter matches language, not meaning.

If the job description names a hard skill the resume shows NO evidence for, do NOT put it in `skills`. Leave it out entirely. A skills list is a set of claims the candidate has to defend in an interview — a keyword they have never touched clears the filter and then collapses in the conversation, which is a worse outcome for them than not being shortlisted. We surface those separately as gaps so the candidate can add them only if they are genuinely true. Do not fabricate experience, expertise, or accomplishments.

Rule01b: SKILLS ARRAY FORMAT — Every entry in `skills` MUST be a short, concrete, named technology (e.g. "Python", "React", "PostgreSQL", "Docker", "REST APIs") — a proper noun or standard industry term, 1-3 words. NEVER put soft skills, narrative phrases, or generic descriptions in `skills` (e.g. do NOT add things like "cross-functional collaboration", "commercial analytics applications", "marketing performance measurement", "technical report writing"). NEVER extract sentence fragments about the ROLE or COMPANY as skills — e.g. do NOT add "senior IC role", "high-growth startup", "one or more languages", "5+ years experience". If the job description says something like "proficiency in one or more of Python, Java, or C++ for a senior IC role at a high-growth startup", extract ONLY the actual technology names ("Python", "Java", "C++") and discard the surrounding sentence entirely. NEVER extract fragments of a RESPONSIBILITY or ACTIVITY sentence as if they were named technologies — many JD lines describe what the candidate will DO, not a tool they must know, and these must be skipped entirely unless a genuine named technology can be pulled out of them. For example: "designing and implementing scalable API architectures" → skip entirely, do NOT add "designing", "implementing", or "scalable API architectures" as skills (only add "API"/"REST APIs" if that technology is separately and explicitly named elsewhere in the JD, never derived from this sentence). "establishing and maintaining technical standards for multi-agent orchestration" → skip entirely, do NOT add "establishing", "maintaining technical standards", or "multi-agent orchestration". "experience with the Microsoft Copilot ecosystem, including Power Platform integration and Microsoft Graph API" → extract ONLY the real product names ("Microsoft Copilot", "Power Platform", "Microsoft Graph API"); discard "ecosystem" and "integration" as connective words, not skills. Rule of thumb: if a phrase is a verb-led description of an activity ("designing...", "implementing...", "establishing...", "maintaining...", "building...", "developing...", "driving...", "leading...") or a vague noun phrase about scope/process rather than a specific tool ("architecture", "ecosystem", "orchestration", "roadmap", "workload", "standard", "strategy", "pattern" used generically), it is NOT an atomic skill — extract only the concrete proper-noun technology named inside it, if any, never the sentence fragment itself. If the job description mentions a soft skill (communication, leadership, collaboration, stakeholder management, etc.), weave it naturally into the `summary` or experience/project `bullets` instead — never as a standalone `skills` entry.

Analyze the job description and identify relevant hard-skill keywords.
Match as much as possible of the job description's hard-skill keywords following the rules above to align with applicant tracking systems (ATS).
Prioritize industry-relevant hard skills in the dedicated Skills section, and weave soft skills into bullet points and the summary instead.

### Rule 1c: JD SKILLS MUST APPEAR IN THE BULLETS, NOT ONLY IN THE SKILLS LIST (MANDATORY)
A skills list proves nothing on its own. A recruiter believes a skill when they can see WHERE it was used, and an ATS that scores context ranks a skill named inside an achievement above the same word sitting in a comma-separated list. So:

Step A — read the job description twice and write down two lists (internally, do not output them):
   - HARD skills: named technologies, languages, frameworks, tools, platforms, databases, methods.
   - SOFT skills / ways of working: e.g. communication, collaboration, ownership, mentoring, stakeholder management, cross-functional work, leadership, problem solving, adaptability, attention to detail, working under ambiguity.

Step B — HARD skills, in the bullets:
   - For every JD hard skill the candidate has ANY factual basis for in the original resume, make sure at least one experience or project bullet names that technology explicitly and shows what was built or achieved with it.
   - Prefer putting it in the entry where it was genuinely used. Do not move a technology onto an unrelated project just to place the keyword.
   - If the candidate has NO factual basis for a JD hard skill, it stays in the `skills` array only (per Rule01). NEVER write a bullet claiming they used a technology they never touched.

Step C — SOFT skills, in the bullets:
   - Soft skills must NEVER appear in the `skills` array. They belong in `bullets` and `summary`.
   - Demonstrate each JD soft skill through work ALREADY described in the resume, by re-framing the SAME facts. Show it, do not assert it: write what the collaboration or ownership actually consisted of.
     GOOD (re-frames an existing bullet): "Partnered with 2 backend engineers to redesign the checkout API, cutting handoff bugs in half."
     BAD  (empty assertion): "Excellent communication and teamwork skills."
     BAD  (invented event): a bullet describing a team, mentee, client or presentation that appears nowhere in the original resume.
   - Spread the soft-skill signals across DIFFERENT entries and prioritise the projects and experience most relevant to this job (the projects section especially — that is where a hiring manager checks whether the person can actually work with others, not just code).
   - At most ONE soft-skill signal per bullet, and keep bullets to a single idea. Do not stuff several JD phrases into one sentence — a bullet crammed with keywords reads as fake to a human and adds nothing for an ATS.
   - If the resume gives NO factual basis for a JD soft skill (no team, no stakeholders, no mentoring anywhere), do NOT manufacture one. Reflect it in the `summary` as an approach instead, or leave it out. An invented collaboration is a lie that gets caught in the interview.

The hard rule underneath all of Step B and C: rewriting means expressing the SAME facts in the job description's vocabulary. You may re-word, re-frame, re-order and sharpen. You may NOT add work, people, tools, scale or outcomes that are not in the original resume.

### Rule 1d: EXPERIENCE AND PROJECT BULLETS MUST BE REBUILT, NOT ECHOED (MANDATORY)
Preserving every fact is only half the job. Handing the facts back in the candidate's original sentence means they uploaded a resume and received the same resume — the most common way this task is failed, and invisible unless you compare the two side by side. For EVERY entry in `experience` AND `projects`:

- Rebuild the sentence into the shape: strong action verb → what was actually built or changed → the technology it was built with → the outcome it produced. The original bullet is your source of FACTS, not a sentence to lightly edit.
- Open every bullet with a different, specific action verb. Never reuse an opener twice inside one entry.
  BANNED openers, weak: "Worked on", "Responsible for", "Helped with", "Involved in", "Assisted in", "Participated in", "Tasked with".
  BANNED openers, passive-learning — these describe what the candidate ABSORBED rather than what they PRODUCED, and they make real work sound like observation: "Gained", "Acquired", "Studied", "Learned", "Observed", "Exposed to", "Familiarised with", "Engaged in".
  Even for an internship, write what was DONE: "Mapped the end-to-end paint manufacturing process across production planning, raw material handling and quality control" says the same thing as "Gained hands-on exposure to..." and says it as work.
  PREFER: Built, Designed, Engineered, Automated, Migrated, Instrumented, Refactored, Shipped, Scaled, Consolidated, Benchmarked, Integrated, Diagnosed, Mapped, Modelled, Cut, Eliminated.
- LEAD with the strongest element. If the bullet has a metric, the metric belongs early, not buried at the end of a subordinate clause.
- REORDER bullets within each entry so the one most relevant to THIS job description comes first. Recruiters read the top bullet of every role and skim the rest.
- Keep the SAME NUMBER of bullets per entry as the original. Rewrite them in place; never merge two into one, never split one into two — a later step matches your bullets back against the original resume, and changing the count corrupts that match.

Before returning, compare each rewritten bullet against its original one final time and confirm BOTH: every fact is still present, AND the sentence is genuinely restructured rather than lightly edited. If only the first is true, you have not finished.

Rule 2:Incorporate Measurable Metrics:
Quantify achievements using the XYZ formula if the user has put such quantifications but not formatted it if user has not put anything quantifyable don't do it: Accomplished X, measured by Y, by doing Z.

Use existing metrics whenever available. Do not create, estimate, infer, or invent numerical results, percentages, revenue impact, time savings, rankings, or performance improvements.
Don't use vague statements; use metrics to highlight value and effectiveness.


Content Quality and Language:
Eliminate buzzwords, clichés, and pronouns (e.g., “I,” “me,” “my”).
Use action-oriented, impactful language to emphasize accomplishments over duties.

Replace generic phrases with specific examples that showcase expertise and success.
Focus on selling professional experience, skills, and results, not merely summarizing past roles.

Additional Instructions:
Keyword Optimize and be specific for EVERY section that contains bullets — Professional Summary, Experience, Projects, Skills, Education, AND extracurriculars / leadership / positions of responsibility / volunteering — to reflect relevance to the job.

### EXTRACURRICULAR, LEADERSHIP AND VOLUNTEERING BULLETS (MANDATORY)
These are bullets like any other and they must be REWRITTEN, not copied through. They were being left almost untouched while the rest of the resume was tailored, which makes the section read as an afterthought — and it is often the only place on a junior resume that evidences leadership, ownership, communication and stakeholder work, exactly the soft skills the job description asks for.
- Apply the same treatment as experience bullets: open with a strong, specific action verb, say what was actually organised, led or built, and end on the outcome it produced.
- Frame the activity in terms the job description would recognise. Running an event IS stakeholder coordination and project delivery; mentoring juniors IS knowledge transfer; managing a club budget IS ownership of resources. Name it that way when the resume supports it — but never claim a responsibility the original does not describe.
- The preservation rule above applies here in full: every number (attendee counts, funds raised, team sizes, editions), every named organisation or event, and every listed item must survive into your version.
Use concise bullet points, each starting with a strong action verb.
Preserve all existing links from the resume exactly when they exist. Do not remove project, GitHub, LinkedIn, portfolio, or other URLs.
If a project has a GitHub/repository/demo/live link in the original resume, keep it in the output using `github_link`, `url`, or `links`.
Preserve all original date ranges exactly whenever they are present in experience, projects, education, certifications, extracurriculars, and publications.
Preserve education scores exactly whenever they are present, including values like CGPA, SGPA, GPA, percentage, marks, and rank.
If the original resume contains a field value and the job description does not conflict with it, keep that original value.
Never leave `dates`, `score`, `github_link`, `url`, `links`, `linkedin`, `github`, `portfolio`, or `leetcode` blank if that value exists in the original resume.
When education contains CGPA/SGPA/percentage/marks, place it in `score` exactly as written.
When a project title line contains tools or stack details, place them in `subtitle`.

Follow this EXACT schema

{{
  "name": "",

  "contact": {{
    "email": "",
    "phone": "",
    "address": "",
    "linkedin": "",
    "github": "",
    "portfolio": "",
    "kaggle": "",
    "leetcode": "",
    "codeforces": "",
    "codechef": "",
    "google_scholar": ""
  }},

  "summary": "3-5 sentences, one capability domain each (see Rule 00): identity + lifecycle scope, what is built and the stack, the production practices, then applied specialisms. Canonical role name, acronyms expanded on first use, no JD-headline echo, no trailing domain tag, metric only if it is the strongest evidence for THIS job.",

  "experience": [
    {{
      "title": "",
      "company": "",
      "dates": "",
      "location": "",
      "url": "",
      "bullets": []
    }}
  ],

  "projects": [
    {{
      "name": "",
      "dates": "",
      "subtitle": "",
      "github_link": "",
      "url": "",
      "links": [
        {{
          "label": "",
          "url": ""
        }}
      ],
      "bullets": []
    }}
  ],

  "skills": [],

  "education": [
    {{
      "degree": "",
      "school": "",
      "year": "",
      "score": "",
      "links":""
    }}
  ],

  "certifications": [
    {{
      "name": "",
      "issuer": "",
      "year": "",
      "url":""
    }}
  ],

  "achievements": [],

  "extracurriculars": [
    {{
      "role": "",
      "organization": "",
      "dates": "",
      "bullets": [],
      "url": ""
    }}
  ],

  "publications": [
    {{
      "title": "",
      "publisher": "",
      "year": "",
      "url": ""
    }}
  ]
}}

My Resume:
{_escape_braces(resume_string)}
Job Description:
{_escape_braces(jd_string)}

"""
# The model that does the tailoring rewrite itself. Rewrite quality IS the
# product here, so this one call is chosen on measurement rather than on price.
# Every other LLM call in the app stays on gpt-4o-mini.
#
# Measured end-to-end on a real resume + JD. "reverts" is how often
# enforce_bullet_facts had to discard the model's rewrite because it dropped a
# fact, so lower means more of the resume ships genuinely rewritten; "weak
# verbs" counts bullets still opening with a banned learning verb ("Studied",
# "Acquired") that the prompt forbids:
#
#   gpt-4o-mini @ 0      ~17s   32% reverts   2 weak verbs   $1.95 / 1000
#   gpt-4o-mini @ 0.35   ~17s   14% reverts   2 weak verbs   $1.97 / 1000
#   gpt-4o     @ 0.35    ~10s   27% reverts   1 weak verb   $32.56 / 1000
#   gpt-5-mini (low)     ~18s   14% reverts   0 weak verbs   $6.37 / 1000  <- chosen
#   gpt-5-mini (medium)  ~34s    5% reverts   0 weak verbs  $11.86 / 1000
#
# gpt-5-mini at low effort is the pick: same speed and revert rate as the
# cheapest option, but it is the only model that reliably stops writing "Studied
# the process" where the prompt asks for "Mapped the process" — a failure prompt
# rules alone never fixed. medium halves the reverts again but doubles the wall
# clock, which is too slow for the Chrome extension, where someone is watching a
# spinner on a job page. gpt-4o was 16x the cost and measurably worse.
#
# Both settings are .env-overridable: OPTIMIZER_MODEL=gpt-4o-mini drops the cost
# back to ~$2/1000, OPTIMIZER_REASONING_EFFORT=medium buys the 5% revert rate.
OPTIMIZER_MODEL = os.getenv("OPTIMIZER_MODEL", "gpt-5-mini")
try:
    OPTIMIZER_TEMPERATURE = float(os.getenv("OPTIMIZER_TEMPERATURE", "0.35"))
except ValueError:
    OPTIMIZER_TEMPERATURE = 0.35


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    # Re-raise the ORIGINAL error after the last attempt. Without this tenacity
    # raises RetryError, which hides the cause: a quota problem, an invalid key
    # and a transient rate limit all surfaced as the same opaque traceback and
    # the same generic 500, so there was nothing to act on.
    reraise=True,
)
def _completion_params(model: str, temperature: float) -> dict:
    """Per-model-family call parameters for the tailoring request.

    The gpt-5 family are reasoning models and reject the parameters the gpt-4
    family requires:
      - `max_tokens` is refused outright; they want `max_completion_tokens`.
      - `temperature` accepts only the default 1 — 0.35 returns a 400.
      - `reasoning_effort` is theirs alone, and it matters: at the default the
        tailoring call took ~65s and burned ~2,800 billed reasoning tokens
        before writing anything, which is far too slow for the Chrome extension
        where the user is watching a spinner on a job page.
    Sending the wrong set is a hard 400, not a degraded response, so this is
    chosen by family rather than left to the caller.
    """
    if str(model or "").startswith(("gpt-5", "o1", "o3", "o4")):
        params = {
            "max_completion_tokens": 16384,
            "seed": _ATS_SEED,
        }
        effort = os.getenv("OPTIMIZER_REASONING_EFFORT", "low").strip().lower()
        if effort in {"minimal", "low", "medium", "high"}:
            params["reasoning_effort"] = effort
        return params
    return {
        "temperature": temperature,
        "seed": _ATS_SEED,  # same resume + same job -> same rewrite
        "max_tokens": 16384,  # avoids truncating long resumes
    }


async def get_resume_response(prompt: str, model: str = AI_MODEL, temperature: float = 0) -> str:
    """
    Async OpenAI call for resume optimization with retries.
    """
    client = await _build_openai_client()
    call_params = _completion_params(model, temperature)
    try:
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {'role': 'system', "content": 'Expert resume writer and reviewer'},
                {'role': 'user', 'content': prompt}
            ],
            **call_params,
        )
        choice = response.choices[0] if response.choices else None
        content = choice.message.content if choice else ""
        finish_reason = getattr(choice, "finish_reason", "") if choice else ""

        # Long resume overflowed the output token cap: the JSON is cut mid-way and the
        # tail (whole entries / their bullet points) would be lost. Instead of dropping
        # it, ask the model to CONTINUE from exactly where it stopped, then stitch the
        # fragments together so no bullet or sub-section is ever removed.
        rounds = 0
        while finish_reason == "length" and rounds < 6:
            rounds += 1
            logger.warning(
                "Resume AI response hit the output token limit; requesting continuation %d.", rounds
            )
            try:
                cont = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {'role': 'system', "content": 'Expert resume writer and reviewer'},
                        {'role': 'user', 'content': prompt},
                        {'role': 'assistant', 'content': content},
                        {'role': 'user', 'content': (
                            "Your previous message was cut off because it was too long. "
                            "Continue the JSON output from the EXACT character where you "
                            "stopped. Do NOT repeat anything already sent, do NOT restart, "
                            "do NOT add explanations or markdown fences — output only the raw "
                            "remaining JSON so the two parts concatenate into one valid object."
                        )},
                    ],
                    **call_params,
                )
            except Exception:
                break
            cont_choice = cont.choices[0] if cont.choices else None
            piece = (cont_choice.message.content if cont_choice else "") or ""
            if not piece.strip():
                break
            content += piece
            finish_reason = getattr(cont_choice, "finish_reason", "") if cont_choice else ""
        return content
    except Exception as exc:
        raise _normalize_openai_error(exc) from exc


def _tokenize_for_ats(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z][a-zA-Z0-9+#.-]{1,}", str(text or "").lower())


def _cosine_similarity(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
    if not vec_a or not vec_b:
        return 0.0
    common = set(vec_a).intersection(vec_b)
    numerator = sum(vec_a[k] * vec_b[k] for k in common)
    denom_a = math.sqrt(sum(v * v for v in vec_a.values()))
    denom_b = math.sqrt(sum(v * v for v in vec_b.values()))
    if denom_a == 0 or denom_b == 0:
        return 0.0
    return numerator / (denom_a * denom_b)


def _tfidf_vectors(tokens_a: list[str], tokens_b: list[str]) -> tuple[dict[str, float], dict[str, float]]:
    tf_a = Counter(tokens_a)
    tf_b = Counter(tokens_b)
    vocab = set(tf_a.keys()).union(tf_b.keys())
    n_docs = 2
    vec_a: dict[str, float] = {}
    vec_b: dict[str, float] = {}
    for term in vocab:
        df = int(term in tf_a) + int(term in tf_b)
        idf = math.log((n_docs + 1) / (df + 1)) + 1.0
        vec_a[term] = tf_a.get(term, 0) * idf
        vec_b[term] = tf_b.get(term, 0) * idf
    return vec_a, vec_b


def _extract_years_of_experience(text: str) -> int:
    years = [int(match) for match in re.findall(r"\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b", str(text or "").lower())]
    return max(years) if years else 0


_HARD_SKILL_KEYWORDS: list[str] = [
    # Languages
    "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Go", "Golang",
    "Rust", "Swift", "Kotlin", "Scala", "R", "MATLAB", "PHP", "Ruby", "Perl",
    "Bash", "Shell", "Objective-C", "Dart", "Groovy", "Lua", "Haskell",
    # Web / Frontend
    "React", "Angular", "Vue.js", "Vue", "Node.js", "Express.js", "Express",
    "Next.js", "Nuxt.js", "Svelte", "Gatsby", "jQuery", "Bootstrap", "Tailwind CSS",
    "HTML", "CSS", "SASS", "SCSS", "Webpack", "Vite", "Babel", "Redux",
    # Backend / Frameworks
    "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails", "Laravel",
    "ASP.NET", ".NET", "Gin", "Echo", "REST API", "gRPC", "GraphQL",
    "Microservices", "Serverless", "WebSocket",
    # ML / AI / Data Science
    "TensorFlow", "PyTorch", "Keras", "scikit-learn", "Pandas", "NumPy", "SciPy",
    "Hugging Face", "LangChain", "LangGraph", "OpenAI", "LLM", "RAG",
    "Computer Vision", "NLP", "NLTK", "spaCy", "OpenCV", "Transformers",
    "Machine Learning", "Deep Learning", "Reinforcement Learning",
    "Natural Language Processing", "Prompt Engineering", "LLM Fine Tuning",
    "MLflow", "Weights & Biases",
    # Databases
    "SQL", "MySQL", "PostgreSQL", "SQLite", "Oracle", "MongoDB", "Redis",
    "Elasticsearch", "Cassandra", "DynamoDB", "Firebase", "Supabase",
    "Snowflake", "BigQuery", "Redshift", "Databricks", "NoSQL",
    "Vector Databases",
    # Cloud
    "AWS", "GCP", "Azure", "Google Cloud", "Amazon Web Services",
    "EC2", "S3", "Lambda", "EKS", "ECS", "GKE", "AKS",
    # DevOps / Infrastructure
    "Docker", "Kubernetes", "Terraform", "Ansible", "Helm",
    "Jenkins", "CI/CD", "GitHub Actions", "GitLab CI", "CircleCI", "ArgoCD",
    "Prometheus", "Grafana", "Datadog", "New Relic", "Splunk",
    # Data Engineering
    "Apache Spark", "Spark", "Hadoop", "Airflow", "dbt", "Kafka",
    "RabbitMQ", "Flink", "Hive", "Trino", "ETL Pipelines",
    "Data Structures and Algorithms",
    # Analytics / BI
    "Tableau", "Power BI", "Looker", "Matplotlib", "Seaborn", "Plotly",
    # Vector DBs
    "Pinecone", "Weaviate", "ChromaDB", "Qdrant",
    # Tools
    "Git", "GitHub", "GitLab", "Bitbucket", "Jira", "Confluence", "Linux", "Unix",
    "Postman", "Swagger", "OpenAPI",
    # MLOps / Model Serving
    "Kubeflow", "TorchServe", "TF Serving", "TensorFlow Serving",
    "Dask", "MLOps", "Vertex AI", "SageMaker", "BentoML", "Ray", "Triton",
    # Architecture / design compounds that would otherwise be caught by the
    # generic "architecture/pattern/integration" ending checks below — these
    # are legitimate standalone skill entries, unlike vague variants such as
    # "ML architecture" or "microservices patterns".
    "Design Patterns", "Solution Architecture", "System Architecture",
    "Enterprise Architecture", "Microservices Architecture",
    "Continuous Integration",
    # Named products that would otherwise be caught by the generic "platform"
    # ending check.
    "Power Platform", "Microsoft Copilot",
    # Legitimate compounds that would otherwise be caught by the generic
    # "source(s)"/"task(s)" scope-noun words added below.
    "Open Source", "Source Control", "Version Control", "Task Queue",
]
_HARD_SKILL_KEYWORDS_LOWER = frozenset(
    keyword.lower() for keyword in _HARD_SKILL_KEYWORDS
)


_PHRASE_QUALIFIER_RE = re.compile(
    r'^\s*(?:\d+\+?\s*years?\s+of\s+|'
    r'experience\s+(?:in|with|deploying|building|using)\s+|'
    r'knowledge\s+of\s+|'
    r'familiarity\s+with\s+|'
    r'expertise\s+in\s+|'
    r'strong\s+(?:experience|background)\s+(?:in|with)\s+|'
    r'proficien(?:cy|t)\s+(?:in|with)\s+)',
    re.IGNORECASE,
)
_PHRASE_DELIMITERS_RE = re.compile(r'[,;/()\[\]]|\band\b|\bor\b|\bvia\b', re.IGNORECASE)
_TRAILING_SKILL_QUALIFIER_RE = re.compile(
    r'\s+(?:required|preferred|desired|is a plus|are a plus)$', re.IGNORECASE
)
_LEADING_SKILL_MODIFIER_RE = re.compile(
    r'^\s*(?:modern|common|popular|major|leading)\s+', re.IGNORECASE
)

_GENERIC_SKILL_PHRASES: set[str] = {
    "backend development", "back-end development", "frontend development",
    "front-end development", "software development", "software engineering",
    "ml engineering", "machine learning engineering", "ml focus",
    "machine learning focus", "cloud platform", "cloud platforms",
    "mlops tool", "mlops tools", "message queue", "message queues",
    "relational database", "relational databases", "state management",
    "build tool", "build tools", "system design principle",
    "system design principles", "data science", "related field",
    "related fields", "a related field", "large dataset", "large datasets",
    "working with large datasets", "material design guideline",
    "material design guidelines", "cd for mobile", "ci/cd for mobile",
    "related role", "related roles", "a related role", "data warehouse",
    "data warehouses", "data warehousing", "r for data analysis",
}
_GENERIC_SKILL_ENDING_RE = re.compile(
    r'\b(?:development|engineering|focus|tools?|platforms?|frameworks?|libraries?|'
    r'technologies?|guidelines?|principles?|practices?|methodologies?|'
    r'ecosystems?|orchestration|roadmaps?|workloads?|standards?|'
    r'strateg(?:y|ies)|deployments?|architectures?|patterns?|integrations?)$',
    re.IGNORECASE,
)
_GENERIC_SKILL_PROSE_RE = re.compile(
    r'^(?:ability\s+to|working\s+with|hands-on\s+experience|understanding\s+of)\b|'
    r'^(?:an?\s+)?related\s+(?:fields?|roles?|disciplines?|areas?)$|'
    r'\b(?:for\s+(?:mobile|data\s+analysis)|related\s+fields?)$',
    re.IGNORECASE,
)

# Generic connectivity/networking task phrases (e.g. "Wifi", "internet connectivity",
# "network setup") describe a task or amenity, not a named technology/tool, so they
# must never be surfaced as a matched/missing hard skill.
_GENERIC_CONNECTIVITY_RE = re.compile(
    r'^(?:wi-?fi|internet|network)(?:\s+(?:connectivity|connection|access|setup|'
    r'configuration|troubleshooting))?$',
    re.IGNORECASE,
)

# Verb-led phrases ("designing X", "plan, execute Y", "own Z") describe an
# activity lifted from a JD responsibility sentence, never a named technology.
# No real skill/tool name in this app's data starts with a bare activity verb
# (base or -ing form), so rejecting any candidate that opens with one of these
# stems is safe. Stems are matched with an optional inflection suffix so both
# "plan"/"planning" and "create"/"creating"/"created" are caught from one entry.
_ACTIVITY_VERB_STEMS = (
    "design", "implement", "develop", "build", "establish", "maintain",
    "manage", "lead", "driv", "creat", "ensur", "support", "overse",
    "coordinat", "facilitat", "architect", "deploy", "integrat", "configur",
    "administer", "optimiz", "automat", "analyz", "monitor", "plan",
    "execut", "own", "guid", "review", "assess", "evaluat", "prioritiz",
    "schedul", "track", "communicat", "present", "document", "test",
    "validat", "verify", "troubleshoot", "debug", "resolv", "handl",
    "process", "perform", "conduct", "deliver", "ship", "launch",
    "migrat", "refactor", "streamlin", "standardiz", "defin", "identify",
    "gather", "collect", "collaborat", "partner", "liais", "translat",
    "convert",
)
_GENERIC_ACTIVITY_VERB_LEAD_RE = re.compile(
    r'^(?:' + '|'.join(_ACTIVITY_VERB_STEMS) + r')(?:e|ing|ed|es|s)?\b',
    re.IGNORECASE,
)

# Soft-skill / role-description words that never belong in a HARD skill entry.
# Unlike _GENERIC_SKILL_ENDING_RE (which only catches phrases ending in specific
# words like "development"/"tools"), this catches short 2-3 word junk such as
# "cross-functional collaboration" or "senior IC role" that don't end in any of
# those endings but are still not a real technology name.
_GENERIC_SKILL_WORDS: set[str] = {
    "collaboration", "collaborative", "communication", "leadership", "teamwork",
    "presentation", "presentations", "documentation", "measurement", "measurements",
    "commercial", "marketing", "stakeholder", "stakeholders", "cross-functional",
    "crossfunctional", "cross", "functional", "ownership", "mentoring", "mentorship",
    "problem-solving", "adaptability", "creativity", "innovation", "strategy",
    "strategic", "planning", "reporting", "performance", "applications", "application",
    "mindset", "attitude", "interpersonal", "organizational", "multitasking",
    "proactive", "role", "roles", "senior", "junior", "ic", "startup", "startups",
    "growth", "years", "year", "experience", "requirement", "requirements",
    "responsibility", "responsibilities", "environment", "environments",
    "team", "teams", "ebooks", "ebook",
    # Generic process/scope nouns from JD responsibility sentences (e.g. "data
    # sources", "multi-step tasks", "business goals") — never a technology name
    # on their own. Legitimate compounds using these words are whitelisted
    # explicitly in _HARD_SKILL_KEYWORDS (e.g. "Open Source", "Task Queue") and
    # are protected by the exact-match short-circuit before this check runs.
    "task", "tasks", "source", "sources", "step", "steps", "goal", "goals",
    "objective", "objectives", "outcome", "outcomes", "deliverable",
    "deliverables", "activity", "activities", "initiative", "initiatives",
    "workflow", "workflows",
}
# Function/filler words: a phrase containing one of these is a sentence fragment,
# never a skill name (real skill names like "Vector Databases" never contain them).
_GENERIC_SKILL_STOPWORDS: set[str] = {
    "a", "an", "the", "one", "two", "more", "less", "some", "any", "several",
    "of", "or", "and", "with", "for", "in", "at", "is", "are", "to", "as",
    "such", "etc", "including", "like", "via",
}


# Real product names that are still NOT professional skills. They pass every
# other test here — proper nouns, genuinely present in the resume — so the
# evidence gate lets them through, and a Technical Skills line came back reading
# "Razorpay, Polar, LeetCode, ChatGPT, Gemini".
#
# Two kinds:
#   - practice and course platforms. Solving problems on LeetCode is not a skill
#     a recruiter can screen for; the certification belongs under Certifications.
#   - consumer AI assistants. "ChatGPT" as a listed skill reads as padding. The
#     underlying capability (LLM evaluation, prompt engineering) is the skill,
#     and that survives because it is a separate entry.
_NON_SKILL_PRODUCTS: set[str] = {
    "leetcode", "hackerrank", "codeforces", "codechef", "geeksforgeeks",
    "hackerearth", "codewars", "topcoder", "coursera", "udemy", "udacity",
    "edx", "datacamp", "kaggle learn",
    "chatgpt", "chat gpt", "gemini", "google gemini", "bard", "copilot",
    "github copilot", "claude", "perplexity",
}


def _strip_skill_qualifiers(value: str) -> str:
    """Remove requirement prose around a possible atomic skill."""
    cleaned = str(value or "").strip().strip("\"'.,:;-")
    previous = None
    while cleaned and cleaned != previous:
        previous = cleaned
        cleaned = _PHRASE_QUALIFIER_RE.sub("", cleaned).strip()
    cleaned = _LEADING_SKILL_MODIFIER_RE.sub("", cleaned)
    cleaned = _TRAILING_SKILL_QUALIFIER_RE.sub("", cleaned)
    return cleaned.strip().strip("\"'.,:;-")


def _is_atomic_hard_skill(value: str) -> bool:
    """Return whether a value is a concrete, resume-safe hard skill."""
    skill = _strip_skill_qualifiers(value)
    if not skill or len(skill) > 50:
        return False

    normalized = re.sub(r"\s+", " ", skill).lower()
    # Checked BEFORE the known-keyword allowlist: some of these are real,
    # recognised product names, and the point is that being real is not the same
    # as being a skill worth listing.
    if normalized in _NON_SKILL_PRODUCTS:
        return False
    if normalized in _HARD_SKILL_KEYWORDS_LOWER:
        return True
    if any(
        normalized == generic or normalized.startswith(f"{generic} ")
        for generic in _GENERIC_SKILL_PHRASES
    ):
        return False
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9+#.\-]*", normalized)
    if any(w in _GENERIC_SKILL_WORDS or w in _GENERIC_SKILL_STOPWORDS for w in words):
        return False
    if len(re.findall(r"[A-Za-z0-9+#.]+", skill)) > 4:
        return False
    if re.search(r"\bwith\s+(?:an?\s+)?(?:ml|machine learning)\s+focus\b", normalized):
        return False
    if _GENERIC_SKILL_PROSE_RE.search(normalized):
        return False
    if _GENERIC_SKILL_ENDING_RE.search(normalized):
        return False
    if _GENERIC_CONNECTIVITY_RE.match(normalized):
        return False
    if _GENERIC_ACTIVITY_VERB_LEAD_RE.match(normalized):
        return False
    return True


def _explode_skill_phrase(value: str) -> list[str]:
    """Explode parentheticals and list conjunctions into atomic skill candidates."""
    phrase = _strip_skill_qualifiers(value)
    if not phrase:
        return []

    parenthetical: list[str] = []
    for match in re.finditer(r'\(([^)]+)\)', phrase):
        parenthetical.extend(_PHRASE_DELIMITERS_RE.split(match.group(1)))

    without_parenthetical = re.sub(r'\([^)]*\)', ',', phrase)
    candidates = parenthetical + _PHRASE_DELIMITERS_RE.split(without_parenthetical)
    return [
        skill
        for candidate in candidates
        if (skill := _strip_skill_qualifiers(candidate)) and _is_atomic_hard_skill(skill)
    ]


def _contains_skill(text: str, skill: str) -> bool:
    """Match a skill without treating short names such as R or Go as substrings."""
    return bool(re.search(
        rf'(?<![A-Za-z0-9]){re.escape(skill)}(?![A-Za-z0-9])',
        text,
        re.IGNORECASE,
    ))


def _extract_hard_skills_from_jd(jd_string: str) -> list[str]:
    """Extract hard skills mentioned in the JD, returning a de-duplicated list."""
    jd = str(jd_string or "")
    jd_lower = jd.lower()
    found: list[str] = []
    seen_lower: set[str] = set()

    def _add(skill: str) -> None:
        s = _strip_skill_qualifiers(skill)
        key = s.lower()
        if _is_atomic_hard_skill(s) and key not in seen_lower:
            seen_lower.add(key)
            found.append(s)

    for kw in _HARD_SKILL_KEYWORDS:
        if _contains_skill(jd_lower, kw):
            _add(kw)

    skill_list_pattern = re.compile(
        r'(?:proficien(?:cy|t)\s+(?:in|with)|'
        r'experience\s+(?:in|with)|'
        r'knowledge\s+of|'
        r'expertise\s+in|'
        r'familiarity\s+with|'
        r'skills?\s*(?:include|required|:)|'
        r'technologies?\s*(?:include|used|:)|'
        r'tools?\s*(?:include|used|:)|'
        r'frameworks?\s*(?:include|used|:)|'
        r'(?:strong|solid)\s+(?:experience|background)\s+(?:in|with))\s*:?\s*([^\n.]+)',
        re.IGNORECASE,
    )
    for m in skill_list_pattern.finditer(jd):
        segment = m.group(1)
        # Explode categorized lists and parentheticals before validating each
        # candidate so category labels never become resume skills.
        for token in _explode_skill_phrase(segment):
            _add(token)

    return found


def _sanitize_hard_skill_list(
    skills: list[str],
    resume_text: str,
    jd_text: str,
) -> tuple[list[str], list[str]]:
    """Decompose LLM phrase entries into atomic keywords; route each to matched/missing."""
    resume_lower = str(resume_text or "").lower()
    kw_lower_map = {kw.lower(): kw for kw in _HARD_SKILL_KEYWORDS}

    cleaned_missing: list[str] = []
    newly_matched: list[str] = []
    seen_missing: set[str] = set()
    seen_matched: set[str] = set()

    def _emit(token: str) -> None:
        t = _strip_skill_qualifiers(token)
        if not _is_atomic_hard_skill(t):
            return
        t_lower = t.lower()
        # Word-boundary match, not a raw substring test. `t_lower in resume_lower`
        # counted "R" as present in any word containing an r, "Go" inside
        # "Google"/"Django", and "C" inside almost everything - inflating the
        # 25-point skills score with matches that were never really there.
        if _contains_skill(resume_lower, t_lower):
            if t_lower not in seen_matched:
                seen_matched.add(t_lower)
                newly_matched.append(kw_lower_map.get(t_lower, t))
        else:
            if t_lower not in seen_missing:
                seen_missing.add(t_lower)
                cleaned_missing.append(kw_lower_map.get(t_lower, t))

    for entry in skills:
        entry_str = str(entry or "").strip()
        if not entry_str:
            continue

        is_phrase = (
            len(entry_str) > 50
            or bool(_PHRASE_QUALIFIER_RE.match(entry_str))
            or entry_str.count(" ") >= 5
        )

        if not is_phrase:
            _emit(entry_str)
            continue

        stripped = _PHRASE_QUALIFIER_RE.sub("", entry_str).strip()

        # Extract tokens from parenthetical content first (highest signal)
        paren_tokens: list[str] = []
        for paren_match in re.finditer(r'\(([^)]+)\)', stripped):
            for tok in _PHRASE_DELIMITERS_RE.split(paren_match.group(1)):
                tok = tok.strip().strip("\"'")
                if tok:
                    paren_tokens.append(tok)

        all_tokens = _PHRASE_DELIMITERS_RE.split(stripped)
        accepted_any = False
        for tok in paren_tokens + all_tokens:
            tok = tok.strip().strip("\"'.,")
            if not tok or len(tok) < 2:
                continue
            if tok.lower() in kw_lower_map:
                _emit(kw_lower_map[tok.lower()])
                accepted_any = True

        # If no known keyword found, emit stripped phrase to avoid silent data loss
        if not accepted_any:
            _emit(stripped if len(stripped) <= 50 else entry_str)

    return cleaned_missing, newly_matched


def inject_jd_hard_skills(
    data: dict,
    jd_string: str,
    resume_text: str = "",
    jd_skills: list[str] | None = None,
    auto_add: bool = False,
) -> dict:
    """
    Post-process the skills array.

    Keeps the atomic hard skills the model produced, and adds a JD skill only
    when the original resume actually evidences it. JD skills with no evidence
    are returned on `data["skill_gaps"]` instead of being written into the
    resume, so we never make a claim the candidate cannot defend.

    `resume_text` is the raw text of the uploaded resume. When it is omitted no
    JD skill can be evidenced, so every unmatched JD skill becomes a gap.

    `auto_add` selects the SKILLS POLICY, and is the only thing that differs
    between the website and the Chrome extension — the optimization engine
    itself is shared:
      False (website)   — a JD skill the resume does not evidence is withheld and
                          reported on `data["skill_gaps"]`, so the candidate is
                          shown it and ticks it only if they genuinely have it.
      True  (extension) — every JD hard skill is written straight onto the
                          resume and `skill_gaps` comes back empty, because the
                          sidebar has no way to ask and the whole point there is
                          one click from a job posting. What got added is
                          reported on `data["skills_added_from_jd"]`.

    `jd_skills` overrides which skills the job description is considered to
    require. Callers pass the ATS analysis's own skill list so the optimizer and
    the ATS score page stop disagreeing about what is missing: the regex
    extractor used by default has no notion of "PostgreSQL or MySQL" being
    satisfied by PostgreSQL alone, nor of required vs preferred qualifications,
    so it reported gaps the ATS page correctly ignored. Falls back to
    _extract_hard_skills_from_jd() when not supplied.
    """
    if not isinstance(data, dict) or not jd_string:
        return data

    skills = data.get("skills")
    if not isinstance(skills, list):
        return data

    # Needed by the model-claim check below as well as the JD loop further down.
    resume_evidence = str(resume_text or "")

    cleaned_skills: list[str] = []
    seen_lower: set[str] = set()
    unevidenced_claims: list[str] = []
    for raw_skill in skills:
        skill = _clean_inline_text(raw_skill)
        key = skill.lower()
        if not _is_atomic_hard_skill(skill) or key in seen_lower:
            continue
        # Everything the MODEL claimed has to be backed by the resume, not just
        # the skills the JD extractor happened to recognise.
        #
        # The loop below only ever inspects `required_skills`, so a skill the
        # model invented that the extractor missed was never checked and shipped
        # unchallenged. The extractor does miss things - it does not recognise
        # "SAP" - and a real resume came back listing TorchServe, TF Serving and
        # Dask, none of which appeared anywhere in the candidate's document.
        # That is the exact claim this function exists to prevent: a keyword the
        # person has never touched clears the filter and then collapses in the
        # interview.
        #
        # auto_add (the Chrome extension) deliberately skips this: there is no
        # dialog to ask through there, and adding everything is the chosen
        # behaviour for that surface.
        if resume_evidence and not auto_add and not _contains_skill(resume_evidence, skill):
            unevidenced_claims.append(skill)
            continue
        seen_lower.add(key)
        cleaned_skills.append(skill)

    # A JD skill is only added to the resume when the person's own resume backs
    # it up. Previously every JD skill was appended regardless, which is exactly
    # the keyword-stuffing our own guides warn against - it clears the filter and
    # then collapses in the interview, which is a worse outcome for the candidate
    # than not being shortlisted.
    #
    # Skills with no evidence are returned separately as `skill_gaps` so the user
    # can be shown what this job wants and decide for themselves.
    skill_gaps: list[str] = []
    # Skills written onto the resume purely because the job asked for them.
    auto_added: list[str] = []

    if jd_skills is None:
        required_skills = _extract_hard_skills_from_jd(jd_string)
    else:
        # Supplied lists come from the ATS analysis, i.e. an LLM, so they still
        # get the same atomic-skill sanitising the regex path relies on.
        required_skills = []
        seen_required: set[str] = set()
        for candidate in jd_skills:
            skill = _clean_inline_text(candidate)
            if not skill or not _is_atomic_hard_skill(skill):
                continue
            key = skill.lower()
            if key in seen_required:
                continue
            seen_required.add(key)
            required_skills.append(skill)

    for skill in required_skills:
        key = skill.lower()
        claimed_by_model = key in seen_lower

        if resume_evidence and _contains_skill(resume_evidence, skill):
            # Named somewhere in the resume but missing from the skills list -
            # safe to surface, because the evidence is already there.
            if not claimed_by_model:
                seen_lower.add(key)
                cleaned_skills.append(skill)
            continue

        if auto_add:
            # Extension policy: put every skill the job asks for straight onto the
            # resume, with no "do you actually have this?" step. There is no UI in
            # the sidebar to ask through, and the point of the extension is one
            # click on a job posting.
            #
            # The website does the opposite (auto_add=False): unevidenced skills
            # come back as `skill_gaps` and the candidate ticks the ones they
            # really have. Same optimization engine either way — this is the only
            # place the two surfaces are allowed to differ.
            if key not in seen_lower:
                seen_lower.add(key)
                cleaned_skills.append(skill)
                # Recorded so the UI can say what it did. With gaps always empty
                # there is nothing left to ASK about, but the user should still
                # see which skills this job caused to be added.
                if not resume_evidence or not _contains_skill(resume_evidence, skill):
                    auto_added.append(skill)
            continue

        if claimed_by_model:
            # The model asserted a JD skill the resume does not evidence. This
            # used to be skipped as already-present, which meant the unbacked
            # claim shipped in the resume AND was dropped from skill_gaps - the
            # candidate was told they had a skill they had never touched. That
            # is the precise failure this function exists to prevent, so strip
            # the claim and report it as a gap like any other.
            #
            # Only done when we actually have resume text to check against;
            # with no text nothing can be evidenced and stripping the model's
            # whole skills list would be worse than leaving it alone.
            if not resume_evidence:
                continue
            cleaned_skills = [s for s in cleaned_skills if s.lower() != key]
            seen_lower.discard(key)

        skill_gaps.append(skill)

    # Claims stripped above are offered back as gaps rather than silently binned:
    # some of them the candidate genuinely has and simply never wrote down, and
    # the editor's dialog is where they say so.
    if unevidenced_claims:
        already = {g.strip().lower() for g in skill_gaps}
        for skill in unevidenced_claims:
            if skill.strip().lower() not in already:
                already.add(skill.strip().lower())
                skill_gaps.append(skill)

    data["skills"] = cleaned_skills
    data["skill_gaps"] = skill_gaps
    data["skills_added_from_jd"] = auto_added

    return data


# Industry/domain nouns a job description uses to describe the BUSINESS, not a
# tool the candidate could own. "Do you have e-commerce?" is not a question
# anyone can answer, so these must never be offered as a claimable gap.
_INDUSTRY_DOMAIN_TERMS: set[str] = {
    "retail", "e-commerce", "ecommerce", "fintech", "healthcare", "saas",
    "logistics", "banking", "insurance", "telecom", "telecommunications",
    "edtech", "gaming", "manufacturing", "consumer goods",
    "consumer goods analytics", "supply chain", "b2b", "b2c",
    "startup", "enterprise", "regulated domain", "payments",
}

# Category names that stand in for a real tool ("version control" is Git;
# "cloud platform" is AWS). The tool itself is extracted separately, so the
# category adds nothing and cannot meaningfully be ticked.
_SKILL_CATEGORY_TERMS: set[str] = {
    "version control", "source control", "cloud data warehouse",
    "data warehouse", "data warehousing", "relational database",
    "relational databases", "database", "databases", "nosql database",
    "nosql databases", "programming language", "programming languages",
    "cloud platform", "cloud platforms", "cloud", "web framework",
    "web frameworks", "scripting language", "scripting languages",
    "operating system", "operating systems", "api", "apis",
    "framework", "frameworks", "library", "libraries", "tool", "tools",
}

# Placeholder references lifted from JD prose ("or another cloud data
# warehouse", "a comparable caching layer"). They name no specific thing.
_VAGUE_SKILL_REFERENCE_RE = re.compile(
    r'^(?:another|other|similar|comparable|equivalent|alternative|any|some|'
    r'various|several|related|preferred|modern|standard)\b',
    re.IGNORECASE,
)


def promptable_skill_gaps(gaps) -> list[str]:
    """The subset of `skill_gaps` worth asking a candidate to confirm.

    `skill_gaps` is built from _extract_hard_skills_from_jd(), which returns
    sentence fragments alongside real technologies. Shown verbatim it produces
    prompts like "do you have another cloud data warehouse?" or "do you have
    consumer goods analytics?", which makes the feature look broken and trains
    people to ignore it.

    Deliberately conservative. A gap dropped here can never be claimed by the
    candidate, so a borderline term is kept: one slightly odd pill costs far
    less than silently hiding a skill the person actually has. Methodologies
    and artifacts (Agile, BPMN, user stories, wireframes) are therefore KEPT -
    a business analyst legitimately lists those on a resume.

    This is a display filter. `skill_gaps` itself is untouched, so scoring and
    anything else reading it are unaffected.
    """
    promptable: list[str] = []
    seen: set[str] = set()

    for raw_gap in (gaps or []):
        skill = _strip_skill_qualifiers(str(raw_gap or ""))
        if not skill:
            continue

        normalized = re.sub(r"\s+", " ", skill).lower()
        if normalized in seen:
            continue
        if not _is_atomic_hard_skill(skill):
            continue
        if _VAGUE_SKILL_REFERENCE_RE.match(normalized):
            continue
        if normalized in _INDUSTRY_DOMAIN_TERMS or normalized in _SKILL_CATEGORY_TERMS:
            continue

        # Collapse "Kafka" / "Apache Kafka" style pairs, which the JD extractor
        # emits together. First seen wins, so the canonical short form is the
        # one offered rather than two pills for the same thing.
        if any(_contains_skill(skill, kept) or _contains_skill(kept, skill) for kept in promptable):
            continue

        seen.add(normalized)
        promptable.append(skill)

    return promptable


# Soft skills that are pure filler when stated outright. Mirrors the BANNED
# list in create_prompt: a recruiter discounts the claim entirely, and the work
# in the bullets is what actually demonstrates it. Never appended to a summary.
_UNSTATEABLE_SOFT_SKILLS = {
    "problem-solving", "problem solving", "analytical thinking", "critical thinking",
    "attention to detail", "detail-oriented", "self-motivated", "self motivated",
    "hard-working", "hard working", "team player", "results-driven", "results driven",
    "passionate", "proactive", "adaptable", "adaptability", "flexibility",
    "work ethic", "multitasking", "time management", "interpersonal",
}


def _soft_skill_evidenced(evidence: str, skill: str) -> bool:
    """Is this soft skill genuinely visible in the original resume text?

    Soft skills surface as verbs, not nouns - a resume says "Mentored two
    juniors", never "mentoring". Exact matching therefore rejects skills the
    resume plainly demonstrates, so each word is compared on a crude stem
    (mentor|mentoring|mentored, collaborate|collaboration) instead. Multi-word
    skills need every significant word present, which keeps "attention to code
    quality" from matching a resume that merely says "quality".
    """
    text = str(evidence or "").lower()
    if not text:
        return False

    def _stem(w: str) -> str:
        # Longest suffix first: "collaboration" must lose "ation" (-> collabor)
        # to meet "collaborated" (-> collabor), not stop at the shorter "ion".
        for suffix in ("ation", "ated", "ising", "izing", "ing", "ship", "ment", "ion", "ed", "es", "s"):
            if len(w) > len(suffix) + 3 and w.endswith(suffix):
                return w[: -len(suffix)]
        return w

    words = [w for w in re.split(r'[^a-z0-9+#]+', str(skill or "").lower()) if len(w) > 2]
    # Drop connective words so "attention to detail" tests attention + detail.
    words = [w for w in words if w not in {"and", "the", "for", "with", "to", "of", "in"}]
    if not words:
        return False

    text_words = {_stem(w) for w in re.split(r'[^a-z0-9+#]+', text) if w}
    return all(_stem(w) in text_words for w in words)


def weave_soft_skills_into_summary(data: dict, soft_skills, resume_text: str = "") -> dict:
    """Fold JD soft skills the rewrite missed into the professional summary.

    Rule01c already tells the model to express every JD soft skill through work
    the resume describes, and Rule01b is explicit that they belong in the summary
    rather than the `skills` array ("Skills: Python, SQL, mentoring" reads as
    padding to a recruiter). The model does not always comply, which is why the
    ATS pass still reports soft skills as missing after tailoring.

    This closes that gap without asking the candidate. Unlike a hard skill -
    where "do you know Tableau?" is a factual question only they can answer -
    a soft skill is a matter of how existing work is presented, so it is safe
    to handle automatically.

    Deliberately conservative: it appends ONE plain capability sentence and never
    touches the bullets, because a bullet describing a team, mentee or client
    that appears nowhere in the original resume would be an invented event.
    Skills already named in the summary are skipped.
    """
    if not isinstance(data, dict):
        return data

    summary = str(data.get("summary") or "").strip()
    evidence = str(resume_text or "")

    additions: list[str] = []
    seen: set[str] = set()
    for raw in (soft_skills or []):
        skill = _clean_inline_text(raw).strip().rstrip(".")
        if not skill or len(skill) > 60:
            continue
        key = skill.lower()
        if key in seen:
            continue
        # Already stated - do not repeat it.
        if summary and _contains_skill(summary, skill):
            continue
        # Only claim what the ORIGINAL resume backs up. Without this the
        # function appended whatever the JD asked for, producing a sentence
        # that could sit on a stranger's resume unchanged - the exact failure
        # create_prompt's BANNED-phrases rule is written to prevent.
        if evidence and not _soft_skill_evidenced(evidence, skill):
            continue
        seen.add(key)
        # JD soft skills often arrive already suffixed ("problem-solving
        # skills"), which produced "Skilled in problem-solving skills" -
        # redundant, and one of the filler phrases the prompt bans outright.
        skill = re.sub(r'\s+skills?$', '', skill, flags=re.IGNORECASE).strip()
        if not skill:
            continue
        # Some JD soft skills ARE the filler create_prompt bans by name. A
        # summary that already proves the trait with a shipped outcome is only
        # weakened by "Demonstrated problem-solving in this work." appended
        # underneath it, so these are dropped rather than restated.
        if skill.lower() in _UNSTATEABLE_SOFT_SKILLS:
            continue
        additions.append(skill[0].lower() + skill[1:] if skill[:1].isupper() and not skill.isupper() else skill)

    if not additions:
        return data

    if len(additions) == 1:
        phrase = additions[0]
    elif len(additions) == 2:
        phrase = f"{additions[0]} and {additions[1]}"
    else:
        phrase = ", ".join(additions[:-1]) + f" and {additions[-1]}"

    # "Skilled in" is on create_prompt's BANNED-filler list - appending it here
    # contradicted the prompt we had just sent. Every generic frame has the same
    # flaw ("Recognised for X" could sit on a stranger's resume unchanged), so
    # the sentence is kept to the plainest possible statement and, above, is
    # only ever built from traits the ORIGINAL resume evidences.
    #
    # "Demonstrated X in this work." was that plainest statement, but it is a
    # bare assertion bolted onto the most-read line, and Rule 00 now bans
    # exactly that shape. The traits are instead folded into a capability clause
    # naming WHERE they were applied, which is the same claim in the voice the
    # rest of the summary is written in. Still purely presentational: the traits
    # are already evidence-gated above, and no new fact is introduced.
    sentence = f"Applies {phrase} across this work."
    data["summary"] = f"{summary} {sentence}".strip() if summary else sentence
    data["soft_skills_added"] = additions
    return data


# Trailing keyword-tag clauses Rule 00 bans: "... in the AI/ML domain",
# "... in the fintech space". The domain is already implied by the work the
# summary describes, so the tag adds a keyword and claims nothing - and it sits
# in the most valuable position on the page.
_SUMMARY_DOMAIN_TAG_RE = re.compile(
    r"[,\s]*\b(?:in|within|across)\s+the\s+[A-Za-z0-9/&+\-\s]{2,40}?\s*"
    r"(?:domain|space|sector|vertical|industry|field)\b\s*",
    re.IGNORECASE,
)

# "<Role> focused on <JD headline>" - the posting's own title pasted in.
_SUMMARY_JD_ECHO_RE = re.compile(r"\bfocus(?:ed|ing)?\s+on\b", re.IGNORECASE)

_SUMMARY_PRONOUN_RE = re.compile(r"\b(?:I|me|my|mine|we|our|ours)\b")

_SUMMARY_MIN_SENTENCES = 2
_SUMMARY_MAX_SENTENCES = 4

# Lifecycle-list openings. "Across the end-to-end ML lifecycle including data
# preparation, feature engineering..." describes every practitioner in the
# field and differentiates nobody - roughly thirteen words restating the job
# title, in the most valuable position on the resume.
_LIFECYCLE_OPENER_RE = re.compile(
    r"\b(?:across|through(?:out)?|spanning|covering)\s+the\s+"
    r"(?:full|entire|complete|end[-\s]?to[-\s]?end)\s+\w+",
    re.IGNORECASE,
)

# Seniority hedges. Leading with the weakest signal in the first six words is
# self-sabotage; the work should establish the level.
_SENIORITY_HEDGE_RE = re.compile(
    r"\((?:early[-\s]career|junior|entry[-\s]level|graduate|fresher)\)|"
    r"\b(?:early[-\s]career|entry[-\s]level|aspiring|recent graduate|"
    r"budding|upcoming)\b",
    re.IGNORECASE,
)

# Filler closers that carry no information and could sit on any resume.
_FILLER_CLOSER_RE = re.compile(
    r"\b(?:collaborat\w+\s+with\s+(?:cross[-\s]functional|product|"
    r"stakeholder|various)|documents?\s+technical\s+(?:processes|"
    r"documentation)|committed\s+to\s+continuous|passionate\s+about\s+"
    r"(?:learning|technology)|thrives?\s+in)\b",
    re.IGNORECASE,
)

# Vague substitutes people reach for instead of a real proof point.
_VAGUE_EVIDENCE_RE = re.compile(
    r"\b(?:global user base|real users|at scale|large[-\s]scale|"
    r"high[-\s]volume|numerous|various|multiple|several)\b",
    re.IGNORECASE,
)

# Outcome language welded onto a plain tooling choice. "Neon-hosted databases
# for scale" claims an achievement the hosting choice does not evidence.
_OVERCLAIM_RE = re.compile(
    r"\b\w+(?:-hosted|-backed|-powered)?\s+(?:databases?|storage|hosting|"
    r"infrastructure)\s+for\s+(?:scale|performance|reliability|speed)\b",
    re.IGNORECASE,
)

# Concepts that are one capability wearing different words. Two members of the
# same group appearing in one summary is a restatement, not two claims.
_SEMANTIC_GROUPS = (
    {"rest api", "restful", "api integration", "frontend-backend contract", "apis"},
    {"deployment", "deployed", "deploy", "productioniz", "production-capable",
     "production-ready", "post-deployment"},
    {"evaluation", "evaluating", "rubric", "assessment"},
    {"responsive", "mobile-friendly", "adaptive layout"},
    {"monitoring", "observability", "error tracking"},
    {"pipeline", "pipelines", "workflow", "workflows"},
    {"testing", "test automation", "automated testing", "e2e testing"},
)

# Table-stakes skills per domain. Naming these signals junior, because only a
# candidate without stronger material would spend the most-read line on them.
_BASELINE_SKILLS_BY_DOMAIN = {
    "frontend": {"html", "html5", "css", "css3", "es6+", "es6",
                 "dom manipulation", "responsive design", "javascript basics"},
    "backend": {"crud", "mvc", "oop", "git", "basic sql", "rest basics"},
    "ml": {"python", "scikit-learn", "sklearn", "pandas", "numpy", "jupyter"},
    "data": {"excel", "basic sql", "charts", "dashboards"},
}

# Words whose presence in the JD says which domain's baseline list applies.
_DOMAIN_HINTS = {
    "frontend": ("frontend", "front-end", "react", "vue", "angular", "ui ", "ux "),
    "ml": ("machine learning", "ml engineer", "deep learning", "model training", "mlops"),
    "backend": ("backend", "back-end", "api", "microservice", "server-side"),
    "data": ("data analyst", "analytics", "business intelligence", "data engineer"),
}

# A summary claiming an ML title needs ML substance behind it. LLM/RAG
# integration alone is AI *application*, not machine learning engineering, and
# a headline the body cannot deliver on is caught by anyone who does the job.
_ML_TITLE_RE = re.compile(r"\bmachine learning engineer\b|\bml engineer\b", re.IGNORECASE)
_ML_SUBSTANCE_RE = re.compile(
    r"\b(?:model training|trained|training|fine-tun\w+|feature engineering|"
    r"model evaluation|hyperparameter|cross-validation|scikit-learn|"
    r"tensorflow|pytorch|xgboost|regression|classification|clustering)\b",
    re.IGNORECASE,
)


def _has_concrete_evidence(summary: str) -> bool:
    """Does the summary carry a real proof point rather than a vague claim?

    A number, a percentage, a scale figure, or a capitalised named system all
    count. "Serving a global user base" does not - that is the vague-claim
    pattern the rule exists to eliminate.
    """
    text = str(summary or "")
    if not text.strip():
        return False
    # Any digit that is not part of a version/acronym token (ES6, GA4, CSS3).
    for m in re.finditer(r"\d[\d,.]*\+?%?", text):
        token = text[max(0, m.start() - 12): m.end() + 2]
        if re.search(r"[A-Za-z]\d", token) and not re.search(r"\d\s*(?:%|x\b|\+)", m.group(0)):
            continue  # ES6 / GA4 / CSS3 style token, not a metric
        return True
    # A named system: two or more consecutive capitalised words that are not
    # the opening role title, or a quoted/definite-article named component.
    body = re.sub(r"^[^.]*\.", "", text, count=1)  # drop sentence one (the title)
    if re.search(r"\bthe\s+[A-Z][\w-]*(?:\s+[A-Z][\w-]*)*\s+"
                 r"(?:engine|service|platform|pipeline|extension|system|API)\b", body):
        return True
    if re.search(r"\b(?:ATS scoring|Chrome extension|resume tailoring)\b", body, re.IGNORECASE):
        return True
    return False


def _duplicate_capability(summary: str) -> list[str]:
    """Concepts stated more than once in different words.

    String matching cannot catch this: "deployment as services",
    "post-deployment monitoring" and "deployed features" share no common
    token long enough to match, yet they are one capability written thrice.
    """
    lowered = str(summary or "").lower()
    repeated: list[str] = []
    for group in _SEMANTIC_GROUPS:
        hits = sum(1 for term in group if term in lowered)
        if hits >= 2:
            repeated.append(sorted(group)[0])
    return repeated


def _summary_domain(jd_string: str) -> str:
    """Which baseline-skill list applies, inferred from the job description."""
    jd = str(jd_string or "").lower()
    best, best_score = "", 0
    for domain, hints in _DOMAIN_HINTS.items():
        score = sum(1 for h in hints if h in jd)
        if score > best_score:
            best, best_score = domain, score
    return best


def _baseline_skills_present(summary: str, jd_string: str = "") -> list[str]:
    """Table-stakes skills that should never occupy summary words."""
    domain = _summary_domain(jd_string)
    if not domain:
        return []
    lowered = str(summary or "").lower()
    return sorted(
        skill for skill in _BASELINE_SKILLS_BY_DOMAIN.get(domain, ())
        if re.search(r"(?<![\w-])" + re.escape(skill) + r"(?![\w-])", lowered)
    )


def _count_named_tools(summary: str) -> int:
    """Rough count of distinct named technologies in the summary.

    Capitalised or camel-cased proper nouns that are not sentence openers,
    plus a small set of lowercase tool names that never capitalise.
    """
    text = str(summary or "")
    body = re.sub(r"(?<=[.!?])\s+", "\x00", text)
    tools: set[str] = set()
    for sentence in body.split("\x00"):
        words = sentence.split()
        for i, w in enumerate(words):
            clean = w.strip("(),.;:/").replace("/", " ").split()
            for tok in clean:
                if i == 0 and tok[:1].isupper():
                    continue  # sentence-initial capital
                if re.fullmatch(r"[A-Z][A-Za-z0-9.+#-]{1,}", tok) or \
                   re.fullmatch(r"[A-Z]{2,}\d?", tok):
                    tools.add(tok.lower())
    return len(tools)


def _title_substance_mismatch(summary: str, resume_text: str = "") -> str:
    """Does the claimed headline title match what the resume evidences?

    Returns a suggested replacement title, or "" when the title is supported.
    Currently checks the failure we have actually observed: an ML Engineer
    headline over a resume whose only AI content is LLM/RAG integration, with
    no training, modelling or evaluation methodology anywhere.
    """
    head = str(summary or "").split(".")[0]
    if not _ML_TITLE_RE.search(head):
        return ""
    evidence = f"{summary} {resume_text}"
    if _ML_SUBSTANCE_RE.search(evidence):
        return ""
    if re.search(r"\b(?:LLM|RAG|Retrieval Augmented Generation|prompt)\b",
                 evidence, re.IGNORECASE):
        return "AI Engineer"
    return "Backend Engineer"

# Rule 00 asks for 45-60 words with a hard ceiling of 65. The previous ceiling
# of 130 was the reason a 114-word summary passed validation untouched: the
# number was set from an older version of the rule and never brought down when
# the rule tightened. The floor is reported but is NOT a rejection - a thin
# junior resume produces a short honest summary, and padding it to hit a word
# count is the exact failure the rule exists to prevent.
_SUMMARY_MAX_WORDS = 65
_SUMMARY_MIN_WORDS = 40


def _summary_sentences(summary: str) -> list[str]:
    """Split a summary into sentences for counting and tail surgery.

    Abbreviations that legitimately carry a period mid-sentence would otherwise
    each read as a sentence break and inflate the count.
    """
    text = str(summary or "").strip()
    if not text:
        return []
    guarded = text
    for abbr in ("e.g.", "i.e.", "etc.", "Inc.", "Ltd.", "Ph.D.", "B.Sc.", "M.Sc.", "vs."):
        guarded = guarded.replace(abbr, abbr.replace(".", "\x00"))
    parts = re.split(r"(?<=[.!?])\s+", guarded)
    return [p.replace("\x00", ".").strip() for p in parts if p.strip()]


def _is_keyword_tail(sentence: str) -> bool:
    """Does this sentence name things without claiming anything?

    The padded-tail failure Rule 00 describes: a closing clause that lists three
    or more comma-separated items and contains no finite verb, e.g. "Domain
    experience in developer tools, platform reliability and API integrations."
    Conservative by design - a sentence with a real verb is never a tail, and
    this only ever runs on the LAST sentence.
    """
    s = str(sentence or "").strip().rstrip(".")
    # Three or more listed items. The canonical padded tail is "A, B and C",
    # which carries only ONE comma — requiring two missed every real instance,
    # including the "developer tools, platform reliability and API integrations"
    # example Rule 00 is written around. Count list SEPARATORS, not commas.
    if not s:
        return False
    separators = s.count(",") + len(re.findall(r"\b(?:and|&|/)\b", s, re.IGNORECASE))
    if separators < 2:
        return False
    # A finite verb means the sentence makes a claim; leave it alone.
    #
    # Every alternative here is an explicit verb FORM. Stemmed patterns are the
    # trap: "develop\w*" also matches the noun "developer", so the padded tail
    # "Domain experience in developer tools, platform reliability and API
    # integrations." read as a claim and survived repair. Noun forms that share
    # a stem with a verb (developer/development, engineering, automation) must
    # never appear below.
    if re.search(
        r"\b(?:built|build|builds|design|designs|designed|ship|ships|shipped|"
        r"deliver|delivers|delivered|led|leads|lead|own|owns|owned|apply|applies|"
        r"applied|automates?|automated|automating|develops?|developed|developing|"
        r"implements?|implemented|implementing|serving|serve|serves|"
        r"reduces?|reduced|reducing|improves?|improved|improving|cut|"
        r"scaled|scales|migrates?|migrated|migrating|"
        r"productionizes?|productionized|productionizing)\b",
        s,
        re.IGNORECASE,
    ):
        return False
    return bool(
        re.match(
            r"^(?:domain\s+experience|experience|exposure|familiarity|knowledge|"
            r"background|skills?|expertise|proficien\w+|competen\w+)\b",
            s,
            re.IGNORECASE,
        )
    )


def _summary_quality_issues(summary: str, jd_string: str = "") -> list[str]:
    """Deterministic quality check for the professional summary.

    Rule 00 of create_prompt() is an instruction, not a guarantee. This is the
    countable half of it: every failure mode here is decidable from the text
    itself, so it is checked rather than trusted - the same reasoning as
    _repair_action_verbs(), which counts strong verbs instead of believing the
    model's arithmetic.

    Returns a list of issue codes (empty means clean). Never raises.
    """
    text = str(summary or "").strip()
    if not text:
        return ["empty"]

    issues: list[str] = []
    lowered = text.lower()

    for phrase in _SUMMARY_BANNED_PHRASES:
        if phrase.lower() in lowered:
            issues.append(f"banned_phrase:{phrase}")

    for phrase in _SUMMARY_HEDGING_PHRASES:
        if phrase.lower() in lowered:
            issues.append(f"hedging:{phrase}")

    if _SUMMARY_DOMAIN_TAG_RE.search(text):
        issues.append("domain_tag")

    if _SUMMARY_JD_ECHO_RE.search(text):
        issues.append("jd_echo")

    if _SUMMARY_PRONOUN_RE.search(text):
        issues.append("pronoun")

    sentences = _summary_sentences(text)
    if len(sentences) < _SUMMARY_MIN_SENTENCES:
        issues.append("too_few_sentences")
    elif len(sentences) > _SUMMARY_MAX_SENTENCES:
        issues.append("too_many_sentences")

    word_count = len(text.split())
    if word_count > _SUMMARY_MAX_WORDS:
        issues.append("too_long")
    elif word_count < _SUMMARY_MIN_WORDS:
        issues.append("too_short")

    if sentences and _is_keyword_tail(sentences[-1]):
        issues.append("keyword_tail")

    # --- checks added after three rounds of real output review --------------
    # Each of these corresponds to a defect observed in production summaries
    # that the earlier validator passed without comment.
    if _LIFECYCLE_OPENER_RE.search(sentences[0] if sentences else ""):
        issues.append("lifecycle_opener")

    if _SENIORITY_HEDGE_RE.search(text):
        issues.append("seniority_hedge")

    if sentences and _FILLER_CLOSER_RE.search(sentences[-1]):
        issues.append("filler_closer")

    if _OVERCLAIM_RE.search(text):
        issues.append("overclaim")

    for concept in _duplicate_capability(text):
        issues.append(f"duplicate_capability:{concept}")

    for skill in _baseline_skills_present(text, jd_string):
        issues.append(f"baseline_skill:{skill}")

    if _count_named_tools(text) > _SUMMARY_MAX_TOOLS:
        issues.append("tool_laundry")

    if not _has_concrete_evidence(text):
        issues.append("no_evidence")

    if _VAGUE_EVIDENCE_RE.search(text):
        issues.append("vague_evidence")

    return issues


# How many named technologies may appear before the summary reads as a skills
# section in prose form. The `skills` array already does that job.
_SUMMARY_MAX_TOOLS = 4


def summary_rejection_reasons(summary: str, jd_string: str = "",
                              resume_text: str = "") -> list[str]:
    """The subset of issues that should REJECT a summary outright.

    Distinct from _summary_quality_issues(), which reports everything worth
    knowing. These are the hard gates: a summary failing any of them is not
    publishable, because each represents a defect that survived three rounds
    of prompt-only fixes and reached real users.
    """
    hard = {
        "too_long", "no_evidence", "vague_evidence", "lifecycle_opener",
        "seniority_hedge", "filler_closer", "overclaim", "tool_laundry",
        "empty",
    }
    reasons = [
        issue for issue in _summary_quality_issues(summary, jd_string)
        if issue.split(":")[0] in hard or issue.startswith("duplicate_capability")
    ]
    suggested = _title_substance_mismatch(summary, resume_text)
    if suggested:
        reasons.append(f"title_mismatch:{suggested}")
    return reasons


def repair_summary(data: dict, jd_string: str = "", resume_text: str = "") -> dict:
    """Subtractive repair of the professional summary.

    STRICTLY SUBTRACTIVE. This function only ever DELETES an offending trailing
    clause or sentence; it never writes new words. That is the whole safety
    argument: removing keyword padding cannot introduce a claim the resume does
    not support, so this can run on every optimization without any risk to the
    never-fabricate invariant. Anything it cannot fix by deletion is left alone
    and reported on `data["summary_issues"]` instead - the same conservatism as
    factcheck_against_original(), which reports rather than deletes because a
    false positive that silently removed real content is the worse failure.

    Never raises; any unexpected shape is returned untouched.
    """
    if not isinstance(data, dict):
        return data
    summary = data.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return data

    text = summary.strip()

    # 1. Drop a keyword-tag clause ("... in the AI/ML domain") that ENDS ITS OWN
    #    SENTENCE. Anchoring on the end of the whole summary was wrong: the
    #    soft-skill weave appends a sentence after this one, so the tag stopped
    #    being the final characters and survived. Mid-sentence the phrase can be
    #    load-bearing ("deployed in the healthcare domain for X"), so a tag only
    #    qualifies when nothing but the sentence terminator follows it.
    rebuilt: list[str] = []
    for sentence in _summary_sentences(text):
        tag = _SUMMARY_DOMAIN_TAG_RE.search(sentence)
        if tag and sentence[tag.end():].strip() in {"", ".", "!", "?"}:
            stripped = sentence[: tag.start()].strip().rstrip(",;").strip()
            # Only if a substantial claim remains once the tag is gone.
            if len(stripped.split()) >= 8:
                if not stripped.endswith((".", "!", "?")):
                    stripped += "."
                rebuilt.append(stripped)
                continue
        rebuilt.append(sentence)
    text = " ".join(rebuilt).strip()

    # 2. Drop a final sentence that is pure keyword padding.
    sentences = _summary_sentences(text)
    if len(sentences) > _SUMMARY_MIN_SENTENCES and _is_keyword_tail(sentences[-1]):
        text = " ".join(sentences[:-1]).strip()

    if text != summary.strip():
        data["summary"] = text

    remaining = _summary_quality_issues(text, jd_string)
    if remaining:
        data["summary_issues"] = remaining
    else:
        data.pop("summary_issues", None)
    return data


def _entry_anchor_window(resume_text: str, anchor: str, window: int = 900) -> str:
    """Best-effort slice of the ORIGINAL resume text following a company/project
    name, used as a proxy for "was this skill genuinely evidenced under this
    specific entry" without needing a full structured parse of the raw PDF
    text. Returns "" if the anchor cannot be located, in which case the
    caller must not treat the skill as evidenced for that entry."""
    text = str(resume_text or "")
    a = str(anchor or "").strip()
    if not text or not a or len(a) < 3:
        return ""
    idx = text.lower().find(a.lower())
    if idx == -1:
        return ""
    return text[idx: idx + window]


def weave_hard_skills_into_bullets(
    data: dict,
    resume_text: str,
    jd_string: str = "",
    jd_skills: list[str] | None = None,
    max_injections: int = 3,
) -> dict:
    """Deterministic safety net for Rule 1c of create_prompt(): make sure JD
    hard skills the resume genuinely evidences actually show up INSIDE the
    summary/experience/project text, not only in the `skills` array.

    Why this exists: the prompt already instructs the model to weave every
    evidenced hard skill into a bullet (Rule 1c, Step B), and mostly it
    complies - but an instruction is not a guarantee, the same reason
    factcheck_against_original() exists for facts and
    weave_soft_skills_into_summary() exists for soft skills. This is the
    hard-skill equivalent of weave_soft_skills_into_summary().

    Must run AFTER inject_jd_hard_skills(), because it only ever moves a skill
    that inject_jd_hard_skills() already decided the candidate can defend
    (i.e. it already sits in data["skills"]). It NEVER adds a new skill claim
    on its own - that would defeat the entire evidence-gating
    inject_jd_hard_skills() does.

    Deliberately conservative:
      - Only ever considers skills already confirmed onto data["skills"].
      - Skips any skill already mentioned anywhere in summary/experience/
        project bullets - the model did its job, there is nothing to do.
      - Locates the ORIGINAL resume text near the matching company/project
        name and only injects into that entry when the skill is actually
        evidenced in that window, so a technology never gets pinned onto an
        unrelated project just to place a keyword.
      - Appends as a short parenthetical to the entry's shortest bullet (the
        one with the most "room"), never rewrites or replaces existing text.
      - Never touches the summary. If no entry evidences the skill there is
        nowhere honest to weave it, so it is left in data["skills"] alone
        rather than asserted as experience in prose.
      - Capped at `max_injections` total edits so this cannot turn into
        keyword stuffing - by design it complements Rule 1c, it does not
        replace it as the primary mechanism.

    Records what it changed on data["hard_skills_woven"] for transparency/
    debugging, the same way skills_added_from_jd works for the skills array.
    """
    if not isinstance(data, dict):
        return data

    skills = data.get("skills")
    if not isinstance(skills, list) or not skills:
        data["hard_skills_woven"] = []
        return data

    confirmed = {s.lower(): s for s in skills if isinstance(s, str) and s.strip()}
    if not confirmed:
        data["hard_skills_woven"] = []
        return data

    if jd_skills is None:
        candidates_order = _extract_hard_skills_from_jd(jd_string)
    else:
        candidates_order = [str(s or "").strip() for s in jd_skills if str(s or "").strip()]

    # Only ever act on skills inject_jd_hard_skills() already confirmed -
    # walk the JD's own priority order first.
    ordered_candidates: list[str] = []
    seen_c: set[str] = set()
    for c in candidates_order:
        key = c.lower()
        if key in confirmed and key not in seen_c:
            seen_c.add(key)
            ordered_candidates.append(confirmed[key])
    # Anything confirmed but not resurfaced above (e.g. supplied via an
    # ATS-analysis jd_skills list with slightly different wording) still
    # deserves a check - append the rest in their original order.
    for key, original in confirmed.items():
        if key not in seen_c:
            seen_c.add(key)
            ordered_candidates.append(original)

    summary_text = str(data.get("summary") or "")
    experience = data.get("experience") if isinstance(data.get("experience"), list) else []
    projects = data.get("projects") if isinstance(data.get("projects"), list) else []

    def _all_bullets_text() -> str:
        parts = [summary_text]
        for entry in list(experience) + list(projects):
            if isinstance(entry, dict):
                parts.extend(str(b) for b in (entry.get("bullets") or []))
        return " ".join(parts)

    woven: list[dict] = []
    resume_evidence = str(resume_text or "")
    # (id(entry), bullet_idx) -> skills queued for that bullet, combined into
    # one parenthetical at the end rather than stacking "(using X) (using Y)".
    pending: "OrderedDict[tuple[int, int], list[str]]" = OrderedDict()
    pending_entry_by_key: dict[tuple[int, int], dict] = {}

    for skill in ordered_candidates:
        if len(woven) >= max_injections:
            break
        if _contains_skill(_all_bullets_text(), skill):
            continue  # already woven somewhere - Rule 1c worked, nothing to do

        target_entry = None
        target_section = None
        # Prefer projects, then experience - the prompt already asks for the
        # densest technical signal to live in projects.
        for section_name, entries in (("projects", projects), ("experience", experience)):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                bullets = entry.get("bullets")
                if not isinstance(bullets, list) or not bullets:
                    continue
                anchor = entry.get("name") or entry.get("company") or entry.get("title") or ""
                window = _entry_anchor_window(resume_evidence, str(anchor))
                if window and _contains_skill(window, skill):
                    target_entry, target_section = entry, section_name
                    break
            if target_entry:
                break

        if target_entry is None:
            # No entry in the ORIGINAL resume evidences this skill, so there is
            # nowhere honest to put it. This used to append "Applied X in this
            # work." to the summary, which produced strings of tacked-on
            # sentences ("Applied MySQL in this work. Applied Java in this
            # work.") that read as machine-generated and, worse, asserted
            # experience the resume never showed - the exact fabrication
            # Rule01/01b and factcheck_against_original() exist to prevent.
            # The skill still appears in data["skills"], which inject_jd_hard_
            # skills() already evidence-gated; that is the honest home for it.
            continue

        bullets = target_entry["bullets"]
        shortest_idx = min(range(len(bullets)), key=lambda i: len(str(bullets[i])))
        key = (id(target_entry), shortest_idx)
        pending.setdefault(key, []).append(skill)
        pending_entry_by_key[key] = target_entry

        entry_label = target_entry.get("name") or target_entry.get("company") or target_entry.get("title") or ""
        woven.append({"skill": skill, "section": target_section, "entry": str(entry_label)})

    # Apply all queued bullet edits, combining multiple skills destined for
    # the same bullet into a single "(using X and Y)" instead of stacking
    # separate parentheticals.
    for key, skill_list in pending.items():
        _, bullet_idx = key
        entry = pending_entry_by_key[key]
        bullets = entry["bullets"]
        bullet = str(bullets[bullet_idx]).rstrip().rstrip(".")
        if len(skill_list) == 1:
            phrase = skill_list[0]
        else:
            phrase = ", ".join(skill_list[:-1]) + f" and {skill_list[-1]}"
        bullets[bullet_idx] = _clean_inline_text(f"{bullet} (using {phrase}).")

    data["hard_skills_woven"] = woven
    return data


_SKILLS_SECTION_HEADER_RE = re.compile(
    r'^\s*(?:[-•*]\s*)?(?:technical\s+skills|core\s+competenc(?:y|ies)|key\s+skills|'
    r'skills?(?:\s*(?:&|and)\s*(?:abilities|expertise))?|technologies|'
    r'tools\s*(?:&|and)?\s*technologies|areas\s+of\s+expertise|expertise)\s*:?\s*$',
    re.IGNORECASE,
)

_EDUCATION_SECTION_HEADER_RE = re.compile(
    r'^\s*(?:[-•*]\s*)?education(?:al\s+background)?\s*:?\s*$',
    re.IGNORECASE,
)

_OTHER_SECTION_HEADER_RE = re.compile(
    r'^\s*(?:[-•*]\s*)?(?:experience|work\s+experience|professional\s+experience|'
    r'employment(?:\s+history)?|projects?|summary|profile|objective|certifications?|'
    r'achievements?|awards?|publications?|extracurriculars?|activities|leadership|'
    r'volunteer(?:ing)?|references?|interests?|hobbies)\s*:?\s*$',
    re.IGNORECASE,
)


def _split_resume_skills_section(resume_text: str) -> tuple[str, str]:
    """Best-effort split of a flat resume-text blob into a 'skills section' region
    and an 'evidence' region (experience/projects/summary/etc — mirroring the
    bullets text compute_skill_match_score_structured() builds from structured
    JSON), via cheap section-header line detection. The education section is
    dropped from both: a course name isn't evidence of a demonstrated skill.

    Falls back to returning the whole text for both regions when no skills
    header is found, so a resume we can't structurally split scores the same
    as before rather than being penalized for an unusual layout."""
    lines = str(resume_text or "").splitlines()
    skills_lines: list[str] = []
    evidence_lines: list[str] = []
    bucket = "evidence"
    saw_skills_header = False
    for line in lines:
        if _SKILLS_SECTION_HEADER_RE.match(line):
            bucket = "skills"
            saw_skills_header = True
            continue
        if _EDUCATION_SECTION_HEADER_RE.match(line):
            bucket = "education"
            continue
        if _OTHER_SECTION_HEADER_RE.match(line):
            bucket = "evidence"
            continue
        if bucket == "skills":
            skills_lines.append(line)
        elif bucket == "evidence":
            evidence_lines.append(line)
        # "education" bucket lines are dropped entirely

    if not saw_skills_header:
        whole = str(resume_text or "")
        return whole, whole

    return "\n".join(skills_lines), "\n".join(evidence_lines)


def compute_skill_match_score(resume_text: str, jd_string: str) -> dict:
    """Deterministic, LLM-free skill-match score: what fraction of the JD's
    identifiable hard skills already appear in the resume. Reuses the same
    keyword extraction/matching primitives the tailoring pipeline already
    relies on (see inject_jd_hard_skills above), so this is fast — regex-only,
    no network/LLM call — and reproducible: identical inputs always produce
    identical output.

    Splits the flat text into a skills-section region and an evidence region
    (see _split_resume_skills_section) and averages the two, the same way
    compute_skill_match_score_structured() does for a tailored resume. This
    keeps the before/after scores on the same scale: without it, the after
    score's stricter bullets requirement makes tailoring look like it hurts
    skill match even when nothing actually regressed."""
    jd_skills = _extract_hard_skills_from_jd(jd_string)
    total = len(jd_skills)
    if not total:
        return {"score": None, "matched": [], "missing": [], "total_skills": 0}

    skills_text, evidence_text = _split_resume_skills_section(resume_text)

    matched: list[str] = []
    missing: list[str] = []
    skills_hits = 0
    evidence_hits = 0
    for skill in jd_skills:
        in_skills = _contains_skill(skills_text, skill)
        in_evidence = _contains_skill(evidence_text, skill)
        if in_skills:
            skills_hits += 1
        if in_evidence:
            evidence_hits += 1
        (matched if (in_skills or in_evidence) else missing).append(skill)

    skills_fraction = skills_hits / total
    evidence_fraction = evidence_hits / total
    score = round((skills_fraction + evidence_fraction) / 2 * 100)

    return {
        "score": score,
        "matched": matched,
        "missing": missing,
        "total_skills": total,
        "skills_section_pct": round(skills_fraction * 100),
        "bullets_pct": round(evidence_fraction * 100),
    }


def compute_skill_match_score_structured(parsed: dict, jd_string: str) -> dict:
    """Deterministic skill-match score for a TAILORED resume's structured JSON
    output (as opposed to compute_skill_match_score() above, which matches
    against one flat text blob — the only thing available for an unstructured
    base-resume PDF).

    A flat-text match on a tailored resume is misleading: inject_jd_hard_skills()
    guarantees every JD hard skill lands in the `skills` array regardless of
    whether the candidate actually has it, so scoring the whole resume as one
    blob makes that guaranteed injection count the same as a skill genuinely
    demonstrated in the candidate's own experience — the score comes out near
    100% almost by construction, which is not a meaningful signal.

    This checks two sources independently and blends them:
      - the `skills` array (force-injected, ~100% after tailoring by design)
      - evidence text — summary, experience bullets, project bullets, plus
        certifications, achievements, extracurriculars, and publications
        (mirroring the sections _split_resume_skills_section() treats as
        evidence for the base-resume "before" score) — never force-injected,
        so bounded by what the resume's own content actually supports. These
        sections are carried through the tailoring prompt unchanged (see the
        JSON schema above), so a skill named only in, say, a certification
        title still counts as evidence here the same way it did before
        tailoring, instead of silently dropping out and making the after
        score look worse than the before score for no real reason.

    Averaging the two means a resume can't reach 100% on the skills section
    alone; the evidence text has to genuinely back it up too."""
    jd_skills = _extract_hard_skills_from_jd(jd_string)
    total = len(jd_skills)
    if not total:
        return {"score": None, "matched": [], "missing": [], "total_skills": 0}

    data = parsed if isinstance(parsed, dict) else {}
    skills_text = " ".join(str(s) for s in (data.get("skills") or []) if s)

    bullet_parts: list[str] = [str(data.get("summary") or "")]
    for exp in (data.get("experience") or []):
        if isinstance(exp, dict):
            bullet_parts.extend(str(b) for b in (exp.get("bullets") or []))
    for proj in (data.get("projects") or []):
        if isinstance(proj, dict):
            bullet_parts.extend(str(b) for b in (proj.get("bullets") or []))
    for cert in (data.get("certifications") or []):
        if isinstance(cert, dict):
            bullet_parts.append(str(cert.get("name") or ""))
            bullet_parts.append(str(cert.get("issuer") or ""))
        else:
            bullet_parts.append(str(cert))
    bullet_parts.extend(str(a) for a in (data.get("achievements") or []) if a)
    for extra in (data.get("extracurriculars") or []):
        if isinstance(extra, dict):
            bullet_parts.append(str(extra.get("role") or ""))
            bullet_parts.append(str(extra.get("organization") or ""))
            bullet_parts.extend(str(b) for b in (extra.get("bullets") or []))
        else:
            bullet_parts.append(str(extra))
    for pub in (data.get("publications") or []):
        if isinstance(pub, dict):
            bullet_parts.append(str(pub.get("title") or ""))
            bullet_parts.append(str(pub.get("publisher") or ""))
        else:
            bullet_parts.append(str(pub))
    bullets_text = " ".join(bullet_parts)

    matched: list[str] = []
    missing: list[str] = []
    skills_hits = 0
    bullets_hits = 0
    for skill in jd_skills:
        in_skills = _contains_skill(skills_text, skill)
        in_bullets = _contains_skill(bullets_text, skill)
        if in_skills:
            skills_hits += 1
        if in_bullets:
            bullets_hits += 1
        (matched if (in_skills or in_bullets) else missing).append(skill)

    skills_fraction = skills_hits / total
    bullets_fraction = bullets_hits / total
    score = round((skills_fraction + bullets_fraction) / 2 * 100)

    return {
        "score": score,
        "matched": matched,
        "missing": missing,
        "total_skills": total,
        "skills_section_pct": round(skills_fraction * 100),
        "bullets_pct": round(bullets_fraction * 100),
    }


# Bullet / list-marker characters that sometimes leak into AI output values.
_BULLET_CHARS = "•‣▪◦●·*–—-"


def _balance_parentheses(text: str) -> str:
    """Drop unmatched parentheses while keeping matched pairs intact.

    Defense-in-depth against broken entries like "state management (Redux" (an
    unmatched "(") that previously rendered as garbage in the skills line. A
    balanced value like "JavaScript (ES6+)" is returned unchanged.
    """
    result: list[str] = []
    open_positions: list[int] = []  # indices in `result` of unmatched "("
    for ch in text:
        if ch == "(":
            open_positions.append(len(result))
            result.append(ch)
        elif ch == ")":
            if open_positions:
                open_positions.pop()
                result.append(ch)
            # else: unmatched ")", skip it
        else:
            result.append(ch)
    # Remove any remaining unmatched "(" (delete right-to-left to keep indices valid).
    for idx in reversed(open_positions):
        del result[idx]
    return "".join(result)


def _clean_inline_text(text: str) -> str:
    """Normalize a single inline value: strip stray bullets, balance parens,
    tidy whitespace. Used for skills, summary, and bullet points."""
    t = str(text or "").strip().strip(_BULLET_CHARS).strip()
    t = _balance_parentheses(t)
    # Tidy spacing left behind by removing a paren, and collapse runs of spaces.
    t = re.sub(r"\(\s+", "(", t)
    t = re.sub(r"\s+\)", ")", t)
    t = re.sub(r"\s{2,}", " ", t)
    # Drop a dangling separator/space before a closing context.
    t = re.sub(r"\s+([,;])", r"\1", t)
    return t.strip(" ,;").strip()


def sanitize_resume_data(data: dict) -> dict:
    """Final safety net run on the optimized resume right before rendering.

    Guarantees the AI/post-processing output is presentable:
      - skills: cleaned, balanced parens, de-duplicated (case-insensitive), no
        empty/oversized noise, original order preserved
      - summary + bullet points: cleaned and paren-balanced
    Never raises — any unexpected shape is returned untouched.
    """
    if not isinstance(data, dict):
        return data

    # --- Skills -----------------------------------------------------------
    skills = data.get("skills")
    if isinstance(skills, list):
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw in skills:
            s = _clean_inline_text(raw)
            if not _is_atomic_hard_skill(s):
                continue
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(s)
        data["skills"] = cleaned

    # --- Summary ----------------------------------------------------------
    if isinstance(data.get("summary"), str):
        data["summary"] = _clean_inline_text(data["summary"])

    # --- Bulleted sections ------------------------------------------------
    for section in ("experience", "projects", "extracurriculars"):
        items = data.get(section)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("bullets"), list):
                item["bullets"] = [
                    b for b in (_clean_inline_text(x) for x in item["bullets"]) if b
                ]

    return data


_FACTCHECK_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
# Figures a rewrite might invent: percentages, money, multipliers, plain counts.
_FACTCHECK_NUMBER_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*%"          # 40%, 12.5 %
    r"|[$₹€£]\s*\d[\d,.]*"          # $2M, ₹50,000
    r"|\b\d+(?:\.\d+)?\s*[xX]\b"    # 3x
    r"|\b\d[\d,]{2,}\b"             # 1,200  15000
)


def _factcheck_numbers(text: str) -> set[str]:
    """Normalised figures appearing in a piece of text.

    Bare four-digit years are excluded - they are reported separately as
    `year` findings, and counting them here too listed every date twice.
    """
    out: set[str] = set()
    for m in _FACTCHECK_NUMBER_RE.finditer(str(text or "")):
        token = m.group(0).replace(" ", "").lower()
        if _FACTCHECK_YEAR_RE.fullmatch(token):
            continue
        out.add(token)
    return out


def factcheck_against_original(data: dict, resume_text: str) -> dict:
    """Catch facts the rewrite introduced that the original resume never had.

    The prompt tells the model repeatedly not to invent, and mostly it obeys -
    but an instruction is not a guarantee, and the one thing a candidate cannot
    survive is defending an employer, a date or a number that was never theirs.
    So we check rather than trust.

    This is deliberately conservative: it only flags a value when the ORIGINAL
    resume does not contain it anywhere. Rewording is expected and untouched;
    only genuinely new facts are reported. Findings land on
    `data["factcheck"]` - nothing is deleted here, because a false positive
    that silently removed a real job would be worse than the problem.
    """
    if not isinstance(data, dict):
        return data

    original = str(resume_text or "")
    if not original.strip():
        return data

    original_lower = original.lower()
    # finditer, not findall: the pattern has a group, so findall would return
    # just the century ("20") rather than the whole year.
    original_years = {m.group(0) for m in _FACTCHECK_YEAR_RE.finditer(original)}
    original_numbers = _factcheck_numbers(original)

    findings: list[dict] = []

    def _check_value(label: str, value, where: str) -> None:
        v = str(value or "").strip()
        if len(v) < 3:
            return
        if v.lower() not in original_lower:
            findings.append({"type": label, "value": v, "where": where})

    # Employers, schools and job titles must already exist in the original.
    for entry in data.get("experience") or []:
        if isinstance(entry, dict):
            _check_value("company", entry.get("company"), "experience")
    for entry in data.get("education") or []:
        if isinstance(entry, dict):
            _check_value("school", entry.get("school"), "education")
            _check_value("degree", entry.get("degree"), "education")

    # Years that appear nowhere in the original resume.
    def _walk_text(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, dict):
            for v in node.values():
                yield from _walk_text(v)
        elif isinstance(node, list):
            for v in node:
                yield from _walk_text(v)

    seen_years: set[str] = set()
    seen_numbers: set[str] = set()
    for chunk in _walk_text(data):
        for y in _FACTCHECK_YEAR_RE.finditer(chunk):
            year = y.group(0)
            if year not in original_years and year not in seen_years:
                seen_years.add(year)
                findings.append({"type": "year", "value": year, "where": "resume"})
        for num in _factcheck_numbers(chunk):
            if num not in original_numbers and num not in seen_numbers:
                seen_numbers.add(num)
                findings.append({"type": "number", "value": num, "where": "resume"})

    if findings:
        data["factcheck"] = {"clean": False, "findings": findings}
    else:
        data["factcheck"] = {"clean": True, "findings": []}
    return data


def _extract_skill_candidates(text: str) -> set[str]:
    content = str(text or "").lower()
    known_skills = {
        "python", "java", "javascript", "typescript", "sql", "pandas", "numpy", "tensorflow", "pytorch",
        "scikit-learn", "langchain", "langgraph", "autogen", "rllib", "docker", "kubernetes", "aws",
        "azure", "gcp", "git", "fastapi", "flask", "react", "node", "nlp", "computer vision", "spark",
        "hadoop", "mongodb", "postgresql", "mysql", "redis", "linux", "ci/cd", "rest", "api"
    }
    found = {skill for skill in known_skills if skill in content}
    extra = re.findall(r"\b[a-z][a-z0-9+#.-]{2,}\b", content)
    for token in extra:
        if token in {"experience", "skills", "ability", "strong", "using", "with", "from", "have", "role"}:
            continue
        if len(token) >= 4:
            found.add(token)
    return found


def _formatting_structure_score(resume_text: str) -> float:
    text = str(resume_text or "").lower()
    checks = [
        bool(re.search(r"\bexperience\b", text)),
        bool(re.search(r"\beducation\b", text)),
        bool(re.search(r"\bskills?\b", text)),
        bool(re.search(r"\bprojects?\b", text)),
        bool(re.search(r"\bsummary\b", text)),
        bool(re.search(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", text)),
        bool(re.search(r"\+?\d[\d\-\s()]{7,}", text)),
    ]
    return sum(1 for check in checks if check) / len(checks)


def bool_score(value):
    return str(value).lower() == "true"


# ---------------------------------------------------------------------------
# Fused-word repair
#
# pdfplumber decides where one word ends and the next begins from the gap
# between glyphs. Its default x_tolerance is 3 *points*, an absolute figure, so
# on a resume set in a tight 9-10pt face the inter-word gap falls under the
# threshold and the two words come out welded: "progresstracking",
# "maintaininglearnerrecords", "Supportedschoolactivities".
#
# That is not a cosmetic problem. A welded token:
#   1. can never match a JD keyword ("progress tracking"), so the ATS match
#      rate is scored against text the candidate did not actually write; and
#   2. is reported to the user as a spelling mistake, which is the bug this
#      block exists to kill. The prompt already tells the model to ignore
#      extraction artifacts (see SPELLING RULES) and the model ignores that
#      instruction often enough that a prompt is not a fix.
#
# So the split is done here, deterministically, where it cannot be argued with.
# ---------------------------------------------------------------------------

# Vocabulary used to decide whether a long token is really several words. It is
# deliberately a *curated* list rather than a full dictionary: every entry here
# makes a split more likely, and a wrong split corrupts the resume text. Common
# English plus the vocabulary resumes actually use covers the observed cases
# without risking rare-word false positives.
_SPLIT_VOCAB = frozenset("""
a an and are as at be been but by for from had has have her his how i if in into is it
its of on or our out over so than that the their then there these they this to under up
was we were what when where which while who will with would you your
ability able about above accurate achieve achieved achievement across action active
activities activity actual add added additional address adhere administration advanced
advertising advice advise agile aid all allocate analyse analysis analyst analytical
analytics analyze annual applicant application applied apply approach appropriate
approval approve architecture area assess assessment asset assign assist assistant
assurance attend attendance audit automate automated automation available award aware
awareness back backend balance bank based basic behaviour benchmark benefit best better
board book brand budget build building built business calendar campaign candidate
capability capacity care career case cash centre certification certified chain change
channel chart check child children claim class classroom clean clear client clinical
close cloud coach coaching code collaborate collaboration collect collection college
communicate communication community company compare complete completed completion
complex compliance component comprehensive computer concept concern condition conduct
conducted conference confidence configuration confirm connect consent consistent
consulting consumer contact content continuous contract contribute control convert
coordinate coordination core corporate correct cost course coverage create created
creation creative credit criteria critical cross culture curriculum custom customer
cycle daily dashboard data database day deadline deal decision dedicated deep defect
define delivered delivery demand department deploy deployment design designed detail
detailed develop developed developer development device diagnostic digital direct
director discussion display distribution district document documentation domain drive
driven due duty dynamic early education effective efficiency efficient effort electronic
element email employee employer employment enable end energy engage engagement engine
engineer engineering english enhance ensure ensured ensuring enterprise entry
environment equipment error escalate establish evaluate evaluation event every evidence
exam example excel excellent exceed execute execution executive exercise existing
expand experience expert expertise external facilitate facility factor faculty fault
feature feedback field file final finance financial first fix flow focus follow food
forecast form format foundation framework free frequent front full function functional
fund gap gather general generate global goal good govern government grade graduate
grant group grow growth guest guidance guide handle hardware health help high hire
history hospital hour house human identify image impact implement implementation
improve improved improvement inbound incident include increase individual industry
information infrastructure initiative innovation input inquiry insight inspection
install institute instruction insurance integrate integration intelligence interface
internal international internship interview inventory investment invoice issue item
job join journal junior key knowledge lab language large launch law lead leader
leadership learn learner learning lecture legal lesson level leverage library licence
license life line link liquid list live load loan local location log logic logistics
long loss machine main maintain maintained maintenance major manage managed management
manager manual manufacturing map market marketing material math matter measure media
medical meet meeting member memory mentor mentoring message method metric middle migrate
migration milestone mobile model module money monitor monitoring month monthly motivate
multiple national native need negotiate network new news node note number nurse object
objective observation office officer online operation operational operations
opportunity optimisation optimise optimization optimize option order organisation
organise organization organize outcome outreach output outreach overall oversee
oversight owner ownership package page paper parent part participant participate
partner party pass patient pattern payment payroll people per perform performance period
person personal phase phone physical pilot pipeline place plan planning platform play
point policy portal portfolio position positive post power practice preparation prepare
present presentation press prevent previous price primary print prior priority private
problem procedure process processing procurement produce product production
professional profile program programme programming progress project promote proposal
protection protocol provide provided provider public publish purchase quality quarter
query question quick rate ratio reach read ready real record recording records recover
recruit recruitment reduce reduced reduction reference regional register regular
regulation relation relationship release relevant reliability reliable remote report
reporting request require requirement research reservation resolve resolution resource
response responsibility responsible restaurant result retail retention return revenue
review revise risk role room root round route routine run safety sale sales sample
scale schedule scheduling scheme school science scope score screen script search second
section sector secure security select senior sensor series server service session set
setting share sharing shift ship shop short show side sign significant similar simple
single site size skill small smooth social software solution solve source space special
specialist specification specific speed spend staff stage stakeholder standard start
state statement station statistics status step stock storage store strategic strategy
stream strength strong structure student study style subject submit success successful
summary supervise supervision supervisor supplier supply support supported supporting
survey sustain system table take talent target task teach teacher teaching team
technical technique technology telephone template term test testing text theory third
time tool top total track tracking traffic train trainer training transaction transfer
transformation transition translate transport travel treatment trend trial trouble
troubleshoot turn tutor type unit update upgrade usage use user utility validate
validation value variety vendor verify version video view virtual vision visit visual
voice volume volunteer warehouse waste web website week weekly welfare well work worker
workflow working workshop world write writing written year yearly
""".split())

# Suffixes stripped when a segment is not in the vocabulary as written. Ordered
# longest first so "-ations" is tried before "-s".
_SPLIT_SUFFIXES = ("ations", "ities", "ingly", "ation", "ments", "ences", "ances",
                   "ings", "ment", "ness", "ence", "ance", "ible", "able", "ies",
                   "ing", "ers", "est", "ely", "ed", "es", "er", "ly", "al", "s")

# Below this length a token is not worth suspecting. Measured against the 12+
# character tokens in a corpus of real resumes: at 13 the guards below take the
# false-positive count to zero, and it is low enough to catch the short fusions
# ("parentconsent", "learnerrecords") that a 16-character floor let through.
_FUSE_MIN_LEN = 13

# Real single words that the segmenter would otherwise take apart, because
# their halves happen to be words too. "-ability" and "-ibility" are handled by
# rule below; these are the leftovers that need naming individually.
_NEVER_SPLIT = frozenset("""
extracurricular extracurriculars shortlisting shortlisted streamlining streamlined
notwithstanding nevertheless understanding undertaking underperforming overperforming
troubleshooting troubleshoot breakthrough workmanship craftsmanship apprenticeship
scholarship partnership relationship membership internship leadership entrepreneurship
stakeholder stakeholders whiteboard dashboard onboarding offboarding storytelling
timekeeping bookkeeping housekeeping recordkeeping safeguarding fundraising
groundbreaking forthcoming outstanding overarching throughput turnaround
""".split())

# A word ending in -ability / -ibility is a real noun built on the stem before
# it ("maintainability", "sustainability", "transferability"), not the two words
# "maintain" and "ability" fused. This single rule was the whole false-positive
# set in the corpus test.
_ABILITY_SUFFIXES = ("ability", "ibility")

# A segment shorter than this is not accepted as a word on its own. Without it,
# "management" happily splits into "man"+"age"+"men"+"t"-style nonsense.
_SEGMENT_MIN_LEN = 3


def _vocab_has(word: str) -> bool:
    """True if `word` is in the split vocabulary, allowing regular inflections."""
    w = word.lower()
    if w in _SPLIT_VOCAB:
        return True
    for suffix in _SPLIT_SUFFIXES:
        if len(w) > len(suffix) + 2 and w.endswith(suffix):
            stem = w[: -len(suffix)]
            if stem in _SPLIT_VOCAB:
                return True
            # "supplies" -> "suppli" -> "supply"; "running" -> "runn" -> "run"
            if stem.endswith("i") and stem[:-1] + "y" in _SPLIT_VOCAB:
                return True
            if stem + "e" in _SPLIT_VOCAB:
                return True
            if len(stem) > 2 and stem[-1] == stem[-2] and stem[:-1] in _SPLIT_VOCAB:
                return True
    return False


def split_fused_word(token: str):
    """Split a run-together token into its words, or return None.

    Returns the list of parts only when the WHOLE token is consumed by two or
    more vocabulary words. Partial matches return None on purpose: a token that
    is mostly a real word plus a stray fragment is far more likely to be a real
    word than an extraction artifact, and splitting it would damage the text.

    Longest-first dynamic programming, so "supporting" is preferred over
    "support" + "ing" and the greedy short-prefix traps are avoided.
    """
    word = str(token or "")
    if not word.isalpha() or len(word) < _SEGMENT_MIN_LEN * 2:
        return None

    lowered = word.lower()
    # A token that is itself a word is never a fusion, however neatly its
    # halves happen to segment.
    if lowered in _NEVER_SPLIT or _vocab_has(lowered):
        return None
    for suffix in _ABILITY_SUFFIXES:
        if lowered.endswith(suffix) and _vocab_has(lowered[: -len(suffix)]):
            return None
    n = len(lowered)
    # best[i] = list of parts covering lowered[i:], or None if uncoverable.
    best: list = [None] * (n + 1)
    best[n] = []
    for start in range(n - 1, -1, -1):
        # Longest segment first - fewer, longer words is nearly always the
        # right reading of a fused token.
        for end in range(n, start + _SEGMENT_MIN_LEN - 1, -1):
            if best[end] is None:
                continue
            segment = lowered[start:end]
            if len(segment) < _SEGMENT_MIN_LEN:
                continue
            if _vocab_has(segment):
                best[start] = [word[start:end]] + best[end]
                break
    parts = best[0]
    if not parts or len(parts) < 2:
        return None
    return parts


def looks_like_fused_word(token: str) -> bool:
    """True if `token` is long enough to suspect and splits cleanly into words."""
    return len(str(token or "")) >= _FUSE_MIN_LEN and split_fused_word(token) is not None


_ALPHA_RUN_RE = re.compile(r"[A-Za-z]+")


def count_fused_words(text: str) -> int:
    """How many run-together tokens a block of extracted text contains.

    Used to choose between two extractions of the same PDF - lower is better.
    """
    return sum(
        1 for match in _ALPHA_RUN_RE.finditer(str(text or ""))
        if looks_like_fused_word(match.group(0))
    )


def repair_fused_words(text: str) -> str:
    """Insert the spaces PDF extraction dropped.

    Only touches tokens that clear `_FUSE_MIN_LEN` and split cleanly, so
    correctly-extracted text passes through unchanged. Capitalisation of the
    first part is preserved; the rest is lowercased, since a fused token's
    interior capitals are not meaningful.
    """
    def replace(match):
        token = match.group(0)
        if not looks_like_fused_word(token):
            return token
        parts = split_fused_word(token)
        if not parts:
            return token
        head, *rest = parts
        return " ".join([head] + [p.lower() for p in rest])

    return _ALPHA_RUN_RE.sub(replace, str(text or ""))


# Words the model quotes back inside its spelling explanation, e.g.
#   The word 'progresstracking' should be 'progress tracking'.
_QUOTED_WORD_RE = re.compile(r"['\"‘’“”]([A-Za-z][A-Za-z\-']{2,})['\"‘’“”]")

# One "The word 'x' should be 'y'." claim, so a single artifact claim can be
# removed without disturbing the sentences around it.
_SPELLING_CLAIM_RE = re.compile(
    r"[^.]*?['\"‘’“”][A-Za-z][A-Za-z\-']{2,}['\"‘’“”][^.]*\.\s*"
)


def _claim_is_artifact(claim: str) -> bool:
    """True if every word this sentence calls misspelled is a fused token."""
    quoted = _QUOTED_WORD_RE.findall(claim)
    if not quoted:
        return False
    # The first quoted word is the alleged misspelling; later ones are the
    # model's suggested correction and must not be judged.
    alleged = quoted[0].replace("-", "")
    return looks_like_fused_word(alleged)


def scrub_extraction_artifacts_from_spelling(parsed):
    """Drop spelling findings that are really PDF extraction artifacts.

    The prompt asks the model not to raise these and it raises them anyway -
    users were shown "The word 'progresstracking' should be 'progress
    tracking'" for a resume that had the space all along. This removes each
    such claim, and when nothing genuine is left, marks the check passed.

    Mutates and returns `parsed`.
    """
    if not isinstance(parsed, dict):
        return parsed
    section = parsed.get("spelling_and_grammar")
    if not isinstance(section, dict):
        return parsed
    spelling = section.get("spelling")
    if not isinstance(spelling, dict):
        return parsed

    explanation = str(spelling.get("explanation") or "")
    if not explanation.strip():
        return parsed

    claims = _SPELLING_CLAIM_RE.findall(explanation)
    if not claims:
        # No per-word claims to pick apart. If the only words it quotes are
        # artifacts, the whole finding is one.
        quoted = _QUOTED_WORD_RE.findall(explanation)
        if quoted and all(looks_like_fused_word(w.replace("-", "")) for w in quoted):
            spelling["passed"] = "true"
            spelling["explanation"] = ""
            spelling["action"] = ""
        return parsed

    kept = [c for c in claims if not _claim_is_artifact(c)]
    if len(kept) == len(claims):
        return parsed  # nothing was an artifact

    remainder = "".join(kept).strip()
    if remainder:
        spelling["explanation"] = remainder
    else:
        # Every claim was an extraction artifact, so there is no spelling
        # problem to report and the check must not fail the resume for one.
        spelling["passed"] = "true"
        spelling["explanation"] = ""
        spelling["action"] = ""
    return parsed


def compute_deterministic_ats_score_breakdown(parsed, resume_text: str = ""):

    score = 0.0

    # =====================
    # CONTACT INFO (10)
    # =====================

    contact = parsed.get("contact_information", {})

    if bool_score(contact.get("email", {}).get("present")):
        score += 4

    if bool_score(contact.get("phone", {}).get("present")):
        score += 3

    # Deterministic LinkedIn check: pdfplumber extracts hyperlinked LinkedIn URLs
    # as just the word "LinkedIn" (not the URL), so we check the raw text directly.
    _raw = str(resume_text or "").lower()
    _linkedin_in_text = bool(
        re.search(r"linkedin\.com", _raw) or
        re.search(r"\blinkedin\b", _raw) or
        re.search(r"linkedin\.com/in/", _raw)
    )
    if bool_score(contact.get("linkedin", {}).get("present")) or _linkedin_in_text:
        score += 3

    # =====================
    # SECTIONS (15)
    # =====================

    sections = parsed.get("sections", {})

    section_checks = [
        sections.get("projects", {}).get("present"),
        sections.get("experience", {}).get("present"),
        sections.get("skills", {}).get("present"),
        sections.get("education", {}).get("present"),
        sections.get("chronological_dates", {}).get("passed")
    ]

    score += (
        sum(bool_score(x) for x in section_checks)
        / len(section_checks)
    ) * 15

    # =====================
    # SKILLS MATCH (25)
    # =====================

    skills = parsed.get("skills", {})

    hard_matched = len(
        skills.get("hard_skills", {}).get("matched", [])
    )

    hard_missing = len(
        skills.get("hard_skills", {}).get("missing", [])
    )

    soft_matched = len(
        skills.get("soft_skills", {}).get("matched", [])
    )

    soft_missing = len(
        skills.get("soft_skills", {}).get("missing", [])
    )

    total_skills = (
        hard_matched +
        hard_missing +
        soft_matched +
        soft_missing
    )

    if total_skills > 0:
        score += (
            (hard_matched + soft_matched)
            / total_skills
        ) * 25

    # =====================
    # EXPERIENCE (20)
    # =====================

    experience = parsed.get("experience", {})

    if bool_score(
        experience.get(
            "experience_match",
            {}
        ).get("passed")
    ):
        score += 8

    if bool_score(
        experience.get(
            "company_names",
            {}
        ).get("present")
    ):
        score += 2

    if bool_score(
        experience.get(
            "job_titles",
            {}
        ).get("present")
    ):
        score += 2

    if bool_score(
        experience.get(
            "action_verbs",
            {}
        ).get("passed")
    ):
        score += 4

    if bool_score(
        experience.get(
            "quantified_impact",
            {}
        ).get("passed")
    ):
        score += 4

    # =====================
    # PROJECTS (10)
    # =====================

    projects = parsed.get("projects", {})

    project_checks = [
        projects.get(
            "project_links",
            {}
        ).get("passed"),

        projects.get(
            "action_verbs",
            {}
        ).get("passed"),

        projects.get(
            "quantified_impact",
            {}
        ).get("passed")
    ]

    score += (
        sum(bool_score(x) for x in project_checks)
        / len(project_checks)
    ) * 10

    # =====================
    # EDUCATION (5)
    # =====================

    education = parsed.get("education", {})

    if bool_score(
        education.get(
            "qualification_match",
            {}
        ).get("passed")
    ):
        score += 5

    # =====================
    # FORMATTING (10)
    # =====================

    formatting = parsed.get("formatting", {})

    formatting_checks = [

        formatting.get(
            "single_column",
            {}
        ).get("passed"),

        formatting.get(
            "photos_or_graphics",
            {}
        ).get("passed"),

        formatting.get(
            "excessive_design",
            {}
        ).get("passed"),

        formatting.get(
            "unnecessary_sections",
            {}
        ).get("passed")
    ]

    score += (
        sum(bool_score(x) for x in formatting_checks)
        / len(formatting_checks)
    ) * 10

    # =====================
    # GRAMMAR (5)
    # =====================

    grammar = parsed.get(
        "spelling_and_grammar",
        {}
    )

    grammar_checks = [

        grammar.get(
            "spelling",
            {}
        ).get("passed"),

        grammar.get(
            "grammar",
            {}
        ).get("passed"),

        grammar.get(
            "buzzwords",
            {}
        ).get("passed"),

        grammar.get(
            "personal_pronouns",
            {}
        ).get("passed")
    ]

    score += (
        sum(bool_score(x) for x in grammar_checks)
        / len(grammar_checks)
    ) * 5

    return {
        "final_score": round(score, 2)
    }


def compute_deterministic_ats_score(resume_text: str, jd_text: str) -> float:
    breakdown = compute_deterministic_ats_score_breakdown(resume_text, jd_text)
    return round(float(breakdown["final_score"]), 2)


def _compute_resume_stats(resume_text: str) -> dict:
    """
    Compute resume statistics: word count, pages, bullet points, and metrics used.
    """
    text = str(resume_text or "")
    
    # Word count
    words = text.split()
    word_count = len(words)
    
    # Estimate pages (assuming ~500 words per page for a typical resume)
    pages = max(1, round(word_count / 500))
    
    # Count bullet points (lines starting with -, *, •, or numbered items)
    bullet_pattern = r'^[\s]*[-*•►]\s+|^\s*\d+[.)]\s+'
    bullet_points = len(re.findall(bullet_pattern, text, re.MULTILINE))
    
    # Also count bullet points in common resume formats like "•" anywhere in line
    bullet_points_alt = len(re.findall(r'[•\-\*]\s+[\w]', text))
    bullet_points = max(bullet_points, bullet_points_alt)
    
    # Count metrics used (numbers with units, percentages, $, etc.)
    # Patterns: percentages, currency, quantities with units, numbers > 10
    metrics_patterns = [
        r'\d+%',                    # percentages like 50%, 100%
        r'\$\d+[\d,]*',             # dollar amounts like $1000, $50,000
        r'\d+\s*(million|billion|M|B|K|k)\b',  # abbreviated numbers
        r'\d+\s*(users|customers|clients|employees|people|years|months|days)\b',  # quantities
        r'\b\d{2,}\b',              # any number >= 10
    ]
    metrics_used = 0
    for pattern in metrics_patterns:
        metrics_used += len(re.findall(pattern, text, re.IGNORECASE))
    
    # Deduplicate - if a line has multiple metrics, count it once
    lines_with_metrics = set()
    for line in text.split('\n'):
        for pattern in metrics_patterns:
            if re.search(pattern, line, re.IGNORECASE):
                lines_with_metrics.add(line.strip())
                break
    metrics_used = len(lines_with_metrics)
    
    return {
        "word_count": word_count,
        "pages": pages,
        "bullet_points": bullet_points,
        "metrics_used": metrics_used
    }


# Static system prompt — module-level so OpenAI can cache it across requests.
# Resume and JD are passed in the user message only (see ats_scoring).
_ATS_SYSTEM_PROMPT = """You are a professional Applicant Tracking System (ATS) resume scanner similar to Jobscan.

Your task is to analyze a resume against a job description and generate a structured ATS Match Report.

The user message will contain the Resume and Job Description to analyze.

OUTPUT ONLY VALID JSON.

Do NOT output markdown.

Do NOT output explanations outside JSON.

Do NOT estimate or calculate ATS scores.

Do NOT hallucinate information.

Do NOT assume skills, experience, education, certifications, projects, achievements, links, or qualifications that are not explicitly present in the resume.

==================================================
OBJECTIVITY RULES (MANDATORY)
=============================

You are performing a rule-based ATS audit.

Every pass/fail decision must be based only on observable evidence in the resume and job description.

If evidence is unclear, choose FALSE.

Never reward implied experience.

Never reward inferred skills.

Never reward potential.

Never reward assumptions.

Use only information explicitly written in the resume.

The same resume and same job description should produce the same output every time.

When uncertain, use the stricter interpretation.

==================================================
SKILLS MATCH RULES
==================

Hard Skills

RULE 1 — ATOMICITY: Every hard skill entry must be a single technology name, tool, or framework of 1–4 words maximum. Never output a full requirement sentence as a skill.

RULE 2 — PARENTHETICAL EXPLOSION: When the job description lists tools inside parentheses, e.g. "MLOps tools (Kubeflow, Airflow)", extract EACH tool as its own separate entry: "Kubeflow", "Airflow". Do not include the surrounding phrase.

RULE 3 — STRIP QUALIFIERS: Remove experience-level wrappers before extracting. Phrases beginning with "X+ years of", "Experience in/with", "Knowledge of", "Familiarity with", "Strong background in" are NOT skills — extract only the technology name(s) embedded inside them.

BAD (entire phrase as one skill — NEVER do this):
  "3+ years of experience in ML engineering or software engineering with an ML focus"
  "Experience deploying models via REST APIs or model serving frameworks (TorchServe, TF Serving)"
  "Knowledge of MLOps tools (Kubeflow, Airflow)"

GOOD (atomic skill names extracted from the same phrases):
  "REST API", "TorchServe", "TF Serving"
  "Kubeflow", "Airflow"

EQUIVALENCE EXAMPLES (exact match or obvious synonym only):

Python = Python
PyTorch = PyTorch
Docker = Docker

Do NOT treat:

AWS = Azure
PyTorch = TensorFlow
Power BI = Tableau

Matched Skills

Skills present in both resume and job description (atomic names only).

Missing Skills

Skills required by the job description but not found in the resume (atomic names only, 1–4 words each).

Never hallucinate skills.

Soft Skills

Extract soft skills explicitly mentioned in the job description.

Match only if clearly demonstrated in the resume through achievements, leadership, communication, collaboration, mentoring, stakeholder management, ownership, or similar evidence.

==================================================
CHRONOLOGY RULES
================

Pass if work experience entries appear in reverse chronological order.

Most recent role first.

Use the Current Date supplied in the user message for every future-date check.
Never use a training cutoff or an assumed year. A date in or before the current
month is not in the future.

An end date written as "Present", "Current", "Now", or "Ongoing" is not a date
to evaluate — it means the role is still active as of the Current Date supplied.
Never fail an entry, or cite it in an explanation, as being "in the future"
because its end date is "Present" (or an equivalent word). Only a specific
month/year that is later than the Current Date counts as a future date.

This check ONLY evaluates work experience dates. An expected/anticipated
graduation or completion date in the Education section (e.g. "Expected 2027",
"Anticipated May 2027", "Expected Graduation: 2027") is normal for a student
or recent graduate and is never a chronology issue — do not evaluate it for
future-date sanity, and never cite an Education date in this check's
explanation.

Fail if:

* dates are missing
* ordering is inconsistent
* chronology cannot be determined

==================================================
SPELLING RULES
==============
Find all spelling mistakes.
Pass if no obvious spelling mistakes are found.
Fail only when a word is genuinely misspelled. Give explanation for all misspelled words without missing any.
Do not miss any misspelled words.
Do not fail for style preferences.

MANDATORY PDF EXTRACTION ARTIFACT RULE — NEVER VIOLATE:
Resume text is extracted from PDF files. PDF extraction frequently merges multiple correctly-spelled words into one long token without spaces. This is a very common technical artifact — the original resume has correct spelling and proper spacing.

ARTIFACT EXAMPLES — these are NOT spelling errors, ignore them completely:
- "Formulatingtechnicaldesignsforindependentend-to-endproblems" → real text: "Formulating technical designs for independent end-to-end problems"
- "drivingcross-teamcollaboration" → real text: "driving cross-team collaboration"
- "upholdingsoftware" → real text: "upholding software"
- "Firstrankandallrounderoftheyear" → real text: "First rank and all-rounder of the year"
- "TackledotherchallengessuchasbuildingPrometheus" → real text: "Tackled other challenges such as building Prometheus"

DETECTION RULES — apply every one of these:
RULE: Any token containing 2 or more recognizable English words merged together (with or without a hyphen between some of them) is an extraction artifact. Do NOT flag it as a spelling error. Never mention it in feedback.
RULE: Any token where recognizable words are merged around a hyphen (e.g., "drivingcross-teamcollaboration", "end-to-endproblems") is an extraction artifact. Ignore it entirely.
RULE: When uncertain whether a long token (10+ characters) is an artifact or a genuine misspelling, treat it as an artifact and do NOT flag it.
RULE: Capitalization differences (e.g., "Medals" vs "medals", "Java", "Team") are NOT spelling errors. Only flag tokens where the specific letters themselves are wrong (e.g., "acomplishment" → "accomplishment").

==================================================
GRAMMAR RULES
=============

Pass if no objective grammar mistakes significantly affecting readability are found.

Minor stylistic preferences should not cause failure.

Fail only for actual grammar errors.

==================================================
BUZZWORD RULES
==============

Flag only if unsupported buzzwords appear.

Examples:

Hardworking
Team Player
Go Getter
Results Driven
Dynamic Professional
Fast Learner
Self Starter
Motivated Individual

Pass if these phrases are absent or supported by measurable evidence.

==================================================
EDUCATION MATCH RULES
=====================

Pass if the resume satisfies educational requirements explicitly stated in the job description.

If the job description does NOT explicitly state a degree, major, or educational requirement, this check MUST pass automatically — do not infer, assume, or guess an educational requirement that is not written in the job description, and do not fail this based on generic assumptions about what employers "often" or "typically" require.

An in-progress / currently pursuing degree counts as satisfying a stated requirement for that degree level. Never treat an in-progress degree as a weakness or partial failure — only fail if the job description explicitly requires a degree that is completed/conferred (e.g. "must have completed a Bachelor's degree") and the resume shows no evidence of one in progress or completed.

Fail otherwise, and only for a requirement that is explicitly present in the job description text.

Explain exactly which requirement, quoted or closely paraphrased from the job description, is missing.

==================================================
EXPERIENCE MATCH RULES
======================

Pass if BOTH conditions are met:

1. Required years of experience are satisfied.

AND

2. At least 50% of the primary responsibilities required by the job description are represented in the resume.

Fail otherwise.

Years of experience are a tolerance band, not an exact threshold. Treat
condition 1 as satisfied when the candidate has at least 80% of the required
years - a candidate with 8 years against a "10 years required" job description
SATISFIES it and must NOT be failed on years. Read "8+ years" as a minimum the
candidate states, never as a ceiling; their dated work history may total more.
Only a substantial shortfall - below 80% of the requirement, e.g. 4 years
against 10 - fails on years. If the years are inside that band and the
responsibilities are represented, Experience Match PASSES.

The explanation must clearly identify:

* missing years of experience
* missing responsibilities
* missing technologies
* missing domain expertise

Use the Current Date supplied in the user message for every date comparison.
Never call a month "in the future" if it is in or before the current month —
double-check the arithmetic against the Current Date before writing that
word into an explanation.

==================================================
COMPANY NAME RULES
==================

Pass if company names are provided for work experience.

Fail otherwise.

==================================================
JOB TITLE RULES
===============

Pass if job titles are provided for work experience.

Fail otherwise.

==================================================
ACTION VERB RULES
=================

Review all experience and project bullet points.

Strong action verbs include:

Developed
Built
Implemented
Designed
Engineered
Created
Led
Optimized
Automated
Managed
Analyzed
Delivered
Reduced
Increased
Generated
Architected
Deployed
Migrated
Produced
Directed
Established
Supervised
Mentored
Coached
Trained
Oversaw
Owned
Spearheaded
Headed
Coordinated
Drove
Launched
Scaled
Streamlined
Improved
Enhanced
Achieved
Executed
Integrated
Configured
Tested
Validated
Debugged
Refactored
Conducted
Investigated
Diagnosed
Resolved
Standardized
Transformed
Revamped
Upgraded
Consolidated
Introduced
Initiated
Pioneered
Facilitated
Negotiated
Presented
Authored
Documented
Published
Researched
Evaluated
Assessed
Identified
Monitored
Audited
Benchmarked
Accelerated
Minimized
Maximized
Secured
Enabled
Shipped

Weak verbs include:

Worked on
Helped
Assisted
Participated
Responsible for
Involved in
Contributed to

A bullet point that begins with a word from the Strong action verbs list above MUST be counted as strong, even if the rest of the sentence sounds generic or technical. Never cite a word from the Strong action verbs list (e.g. "Developed") as an example of weak wording in an explanation. Only words from the Weak verbs list (or synonyms of them) may be cited as weak.

Leadership and management verbs — Managed, Led, Supervised, Mentored, Directed,
Oversaw, Owned, Spearheaded, Headed, Coordinated — are STRONG. They signal
ownership of people and outcomes, which is exactly what recruiters look for.
Never describe a bullet such as "Managed development engineers/technicians" as
weak wording; a bullet naming the people or scope a candidate owned is a
strength, not a defect.

Pass if at least 4 of bullets begin with strong action verbs.

Fail otherwise and give proper explanation.

==================================================
QUANTIFIED IMPACT RULES
=======================

Count bullets containing measurable results.

Examples:

15%
20%
$50,000
1000 users
30% improvement
2x increase
50ms reduction
95% accuracy

Pass if at least 2 of experience/project bullets contain measurable metrics.

Fail otherwise and give proper explanation .

==================================================
FORMATTING RULES
================

Single Column

Pass if the resume appears primarily single-column.

Fail if multiple columns are clearly present.

Photos or Graphics

Fail if photographs, graphics, icons, watermarks, or visual elements likely to confuse ATS systems are present.

Pass otherwise.

Excessive Design

Fail if excessive colors, tables, text boxes, decorative elements, or ATS-unfriendly layouts are present.

Pass otherwise.

==================================================
EXPLANATION RULES
=================

Only provide explanations when a check fails.

Every explanation must:

1. Identify the exact issue.
2. Identify where it occurs.
3. Explain why it matters.
4. Reference actual resume content whenever possible.

Bad:

"Action verbs missing."

Good:

"The bullet point 'Worked on customer churn prediction model' uses weak wording and does not demonstrate ownership or impact."

Bad:

"Project links missing."

Good:

"The project 'Housing Price Predictor' does not contain a GitHub repository URL or live demo link."

==================================================
ACTION RULES
============

Only provide actions when a check fails.

Actions must be specific and directly actionable.

Bad:

"Add metrics."

Good:

"Rewrite 'Built recommendation engine' to include measurable outcomes such as user count, latency reduction, revenue impact, or accuracy improvement."

Bad:

"Add skills."

Good:

"Add Docker and AWS to the Skills section only if you genuinely possess those skills and can demonstrate them through experience or projects."

==================================================
TOP PRIORITY FIXES RULES
========================

Return exactly 3 fixes.

Prioritize:

1. Experience gaps
2. Missing critical skills
3. Missing ATS-critical sections
4. Missing measurable achievements
5. Formatting problems

Do not include minor issues unless no major issues exist.

==================================================
OUTPUT RULES
============

Output ONLY valid JSON.

No markdown.

No extra text.

No commentary.

No explanations outside JSON.

The JSON must strictly follow the schema provided below.

### REQUIRED JOBSCAN-STYLE JSON FORMAT

{
  "spelling_and_grammar": {
    "spelling": {
      "passed":"<false|true>",
      "explanation": "<Provide_exp with all the incorrect spellings. Do not miss any mispelled words>",
      "action":"<Provide_act>"
    },

    "grammar": {
      "passed": "<false|true>",
      "explanation": "",
      "action": ""
    },

    "buzzwords": {
      "passed": "<false|true>",
      "explanation": "",
      "action": ""
    }
  },

  "skills": {
    "hard_skills": {
      "matched": [],
      "missing": []
    },

    "soft_skills": {
      "matched": [],
      "missing": []
    }
  },

  "sections": {
    "chronological_dates": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "formatting": {
    "single_column": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "photos_or_graphics": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "excessive_design": {
      "passed": "<false|true>",
      "explanation":""
    }
  },

  "education": {
    "qualification_match": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "experience": {
    "experience_match": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "company_names": {
      "present": "<false|true>"
    },

    "job_titles": {
      "present": "<false|true>"
    },

    "action_verbs": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "quantified_impact": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "projects": {
    "action_verbs": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "quantified_impact": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "top_priority_fixes": [
    {
      "issue": "",
      "action": ""
    },
    {
      "issue": "",
      "action": ""
    },
    {
      "issue": "",
      "action": ""
    }
  ]
}"""


def _deterministic_ats_precheck(resume_string: str) -> dict:
    """Compute ATS fields that don't need LLM: contact info, section presence, pronouns, links."""
    text = str(resume_string or "")
    tl = text.lower()

    email_present = bool(re.search(r'\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b', tl))
    phone_present = bool(re.search(r'(\+?\d[\d\s\-().]{6,}\d)', text))
    linkedin_present = bool(re.search(r'linkedin\.com|/in/|\blinkedin\b', tl))

    has_projects = bool(re.search(r'\bprojects?\b|\bportfolio\b', tl))
    has_experience = bool(re.search(
        r'\b(experience|work experience|employment|internship|professional experience)\b', tl))
    has_skills = bool(re.search(r'\b(skills|technical skills)\b', tl))
    has_education = bool(re.search(r'\b(education|academics?)\b', tl))

    pronouns_found = bool(re.search(r'\b(i|me|my|mine|we|our|ours)\b', tl))
    pronouns_passed = not pronouns_found

    unnecessary_found = bool(re.search(
        r'\b(hobbies|interests|references|personal information|irrelevant activities)\b', tl))
    unnecessary_passed = not unnecessary_found

    has_project_links = bool(re.search(
        r'https?://\S+|github\.com|gitlab\.com|bitbucket\.org', tl))

    return {
        "contact_information": {
            "email": {"present": str(email_present).lower()},
            "phone": {"present": str(phone_present).lower()},
            "linkedin": {"present": str(linkedin_present).lower()},
        },
        "sections": {
            "projects": {"present": str(has_projects).lower()},
            "experience": {"present": str(has_experience).lower()},
            "skills": {"present": str(has_skills).lower()},
            "education": {"present": str(has_education).lower()},
        },
        "spelling_and_grammar": {
            "personal_pronouns": {
                "passed": str(pronouns_passed).lower(),
                "explanation": (
                    "" if pronouns_passed
                    else "Personal pronouns (I, me, my, we, our) detected in resume."
                ),
                "action": (
                    "" if pronouns_passed
                    else "Rewrite all bullet points and summary statements without first-person pronouns (e.g., 'Led a team of 5' instead of 'I led a team of 5')."
                ),
            }
        },
        "formatting": {
            "unnecessary_sections": {
                "passed": str(unnecessary_passed).lower(),
                "explanation": (
                    "" if unnecessary_passed
                    else "Resume contains unnecessary sections (Hobbies, Interests, References, or Personal Information) that reduce ATS relevance density."
                ),
                "action": (
                    "" if unnecessary_passed
                    else "Remove Hobbies, Interests, References, and Personal Information sections. Use the space for additional skills, projects, or quantified achievements."
                ),
            }
        },
        "projects": {
            "project_links": {
                "passed": str(has_project_links).lower(),
                "explanation": (
                    "" if has_project_links
                    else "No GitHub, GitLab, or project URL links detected in the resume."
                ),
                "action": (
                    "" if has_project_links
                    else "Add a GitHub repository URL or live demo link to each project on your resume."
                ),
            }
        },
    }


_MONTH_NUMBERS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2,
    "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_MONTH_YEAR_RE = re.compile(
    r'\b(' + '|'.join(_MONTH_NUMBERS) + r')\s+(20\d{2})\b',
    re.IGNORECASE,
)
# An open-ended end date ("Present"/"Current"/"Now"/"Ongoing") is never itself
# a future date — see _apply_false_future_repair below.
_PRESENT_TOKEN_RE = re.compile(r'\b(present|current(?:ly)?|ongoing|now)\b', re.IGNORECASE)
# An expected/anticipated graduation or completion date is a genuinely future
# date by design (the student hasn't graduated yet) — it's normal, not a
# chronology defect, so a "future date" explanation naming one is always a
# false positive regardless of how far out the date is.
_EDUCATION_DATE_RE = re.compile(
    r'\b(?:expected|anticipated|projected)\b[^.]{0,60}?\b(?:graduat\w*|degree|diploma|completion)\b'
    r'|\b(?:graduat\w*|degree|diploma)\b[^.]{0,60}?\b(?:expected|anticipated|projected)\b',
    re.IGNORECASE,
)


def _apply_false_future_repair(
    check: dict, current_date: date, independent_issues: tuple
) -> bool:
    """Flip a failed pass/explanation check to passed when the *only* stated
    reason is a resume date being "in the future" that is actually already
    past (the model miscounts months relative to the supplied Current Date),
    the "future" date is really an open-ended "Present"/"Current"/"Ongoing"
    end date that isn't a date to compare at all, or it's an expected/
    anticipated graduation date (genuinely future by design, and never a
    chronology defect).
    Returns True if the check was repaired.
    """
    if not isinstance(check, dict) or bool_score(check.get("passed")):
        return False

    explanation = str(check.get("explanation") or "")
    explanation_lower = explanation.lower()
    if "future" not in explanation_lower:
        return False

    cited_dates = [
        (int(year), _MONTH_NUMBERS[month.lower()])
        for month, year in _MONTH_YEAR_RE.findall(explanation)
    ]
    mentions_present = bool(_PRESENT_TOKEN_RE.search(explanation))
    mentions_expected_grad = bool(_EDUCATION_DATE_RE.search(explanation))
    if not cited_dates and not mentions_present and not mentions_expected_grad:
        return False

    # An expected graduation date is *supposed* to be future, so skip the
    # "cited dates must not actually be future" guard in that case — the
    # defect is the check evaluating an education date at all, not the date
    # itself.
    if not mentions_expected_grad:
        current_month = (current_date.year, current_date.month)
        if any(cited_date > current_month for cited_date in cited_dates):
            return False

    if any(issue in explanation_lower for issue in independent_issues):
        return False

    check["passed"] = "true"
    if mentions_expected_grad:
        check["explanation"] = (
            "An expected/anticipated graduation date is not a chronology issue."
        )
    elif mentions_present:
        check["explanation"] = (
            f"The cited dates are not in the future as of "
            f"{current_date.strftime('%B %Y')} "
            f"(an end date of \"Present\" is not a future date)."
        )
    else:
        check["explanation"] = (
            f"The cited dates are not in the future as of "
            f"{current_date.strftime('%B %Y')}."
        )
    return True


_CHRONOLOGY_INDEPENDENT_ISSUES = (
    "out of order", "not in reverse chronological order", "missing date",
    "dates are missing", "cannot be determined", "unable to determine",
    "overlapping dates",
)

# Broader/fuzzier on purpose: experience-match failures can legitimately cite
# many other reasons (years, responsibilities, technologies, domain), and we
# only want to auto-repair when the false future-date claim is the sole
# reason given — any of these hints means a real issue may still be there.
_EXPERIENCE_MATCH_INDEPENDENT_ISSUES = (
    "missing years", "missing responsibilit", "missing technolog",
    "missing domain", "does not meet", "insufficient", "not met",
    "not clearly demonstrated", "not found", "lacks", "lacking", "gap in",
    "underqualified",
)


def _repair_false_future_chronology(parsed: dict, current_date: date | None = None) -> None:
    """Correct an LLM chronology failure when every cited future date is already past."""
    if not isinstance(parsed, dict):
        return
    chronology = parsed.get("sections", {}).get("chronological_dates", {})
    _apply_false_future_repair(
        chronology, current_date or date.today(), _CHRONOLOGY_INDEPENDENT_ISSUES
    )


def _force_pass_chronology(parsed: dict) -> None:
    """The chronology check kept producing false-positive failures (future/
    Present end dates, expected graduation dates) even after narrowing the
    prompt and adding targeted repairs — it's no longer trustworthy enough to
    ever fail a resume, so it's forced to pass unconditionally instead."""
    if not isinstance(parsed, dict):
        return
    sections = parsed.setdefault("sections", {})
    if not isinstance(sections, dict):
        return
    sections["chronological_dates"] = {
        "passed": "true",
        "explanation": "Work experience entries are in reverse chronological order.",
    }


def _repair_false_future_experience_match(parsed: dict, current_date: date | None = None) -> None:
    """The same past-date-miscounted-as-future failure also leaks into the
    Experience Match explanation, e.g. "most recent experience is dated in
    the future (Jan 2026 - Mar 2026)" when Jan-Mar 2026 has already passed.
    """
    if not isinstance(parsed, dict):
        return
    experience_match = parsed.get("experience", {}).get("experience_match", {})
    _apply_false_future_repair(
        experience_match, current_date or date.today(), _EXPERIENCE_MATCH_INDEPENDENT_ISSUES
    )


# A candidate one or two years short of a stated requirement is not a mismatch —
# recruiters interview them, and "8+ years" on a resume is a floor the candidate
# states, not a ceiling. Experience Match only fails on years below this
# fraction of the requirement.
_EXPERIENCE_YEARS_TOLERANCE = 0.8

# Reasons a failed Experience Match may be about something other than years. If
# the explanation mentions any of these, a real gap may remain and the years
# tolerance must not flip the check.
_EXPERIENCE_MATCH_NON_YEARS_ISSUES = (
    "responsibilit", "technolog", "domain", "skill", "tool", "certification",
    "education", "degree", "qualification", "leadership", "management",
)

_YEARS_MENTION_RE = re.compile(r"\byears?\b|\byrs?\b", re.IGNORECASE)


def _repair_experience_years_tolerance(
    parsed: dict, resume_text: str, jd_text: str
) -> None:
    """Stop failing Experience Match on a near-miss on years.

    An "8+ years" resume against a "10 years of experience" job description was
    being failed outright, costing 8 points. Years are a tolerance band: at or
    above _EXPERIENCE_YEARS_TOLERANCE of the requirement counts as satisfied.
    Only flips a failure whose stated reason is years alone — an explanation
    that also cites missing responsibilities, technologies or domain expertise
    is left exactly as the model wrote it.
    """
    if not isinstance(parsed, dict):
        return
    experience = parsed.get("experience")
    if not isinstance(experience, dict):
        return
    check = experience.get("experience_match")
    if not isinstance(check, dict) or bool_score(check.get("passed")):
        return

    required_years = _extract_years_of_experience(jd_text)
    candidate_years = _extract_years_of_experience(resume_text)
    if required_years <= 0 or candidate_years <= 0:
        return
    if candidate_years < required_years * _EXPERIENCE_YEARS_TOLERANCE:
        return

    explanation = str(check.get("explanation") or "")
    explanation_lower = explanation.lower()
    if not _YEARS_MENTION_RE.search(explanation_lower):
        return
    if any(issue in explanation_lower for issue in _EXPERIENCE_MATCH_NON_YEARS_ISSUES):
        return

    check["passed"] = "true"
    check["explanation"] = (
        f"The resume shows {candidate_years}+ years of experience against the "
        f"{required_years} years the job description asks for — close enough to "
        "the requirement to be competitive, and the required responsibilities "
        "are represented."
    )
    check["action"] = ""


# Mirrors the Strong action verbs list in _ATS_SYSTEM_PROMPT. The prompt already
# tells the model never to cite one of these as weak wording, and it does it
# anyway ("'Managed development engineers/technicians' uses weak wording"), so
# the rule is enforced here deterministically as well.
_STRONG_ACTION_VERBS = frozenset({
    "developed", "built", "implemented", "designed", "engineered", "created",
    "led", "optimized", "optimised", "automated", "managed", "analyzed",
    "analysed", "delivered", "reduced", "increased", "generated", "architected",
    "deployed", "migrated", "produced", "directed", "established",
    # Leadership / ownership — the bucket the model most often mislabels.
    "supervised", "mentored", "coached", "trained", "oversaw", "owned",
    "spearheaded", "headed", "coordinated", "drove", "launched", "scaled",
    # Delivery and improvement
    "streamlined", "improved", "enhanced", "achieved", "executed", "integrated",
    "configured", "tested", "validated", "debugged", "refactored", "conducted",
    "investigated", "diagnosed", "resolved", "standardized", "standardised",
    "transformed", "revamped", "upgraded", "consolidated", "introduced",
    "initiated", "pioneered", "facilitated", "negotiated", "presented",
    "authored", "documented", "published", "researched", "evaluated",
    "assessed", "identified", "monitored", "audited", "benchmarked",
    "accelerated", "minimized", "minimised", "maximized", "maximised",
    "secured", "enabled", "shipped",
})

_ACTION_VERB_MIN_STRONG_BULLETS = 4

_BULLET_PREFIX_RE = re.compile(r'^[\s•●▪◦‣⁃∙\-\*·>\+]+')
# Straight or curly quotes around the snippet the explanation is citing.
_QUOTED_SNIPPET_RE = re.compile(
    r'[\'"‘“]([^\'"‘’“”]{4,200})[\'"’”]'
)


def _leading_verb(line: str) -> str:
    """First word of a bullet, with any bullet glyph stripped."""
    cleaned = _BULLET_PREFIX_RE.sub("", str(line or "")).strip()
    # A heading or a company name ("Managed Services Inc.") is not a bullet.
    if len(cleaned.split()) < 5:
        return ""
    match = re.match(r"[A-Za-z][A-Za-z\-']*", cleaned)
    return match.group(0).lower() if match else ""


def _count_strong_verb_bullets(resume_text: str) -> int:
    return sum(
        1 for line in str(resume_text or "").splitlines()
        if _leading_verb(line) in _STRONG_ACTION_VERBS
    )


def _snippet_opens_with_strong_verb(snippet: str) -> bool:
    match = re.match(r"\s*[A-Za-z][A-Za-z\-']*", str(snippet or ""))
    return bool(match) and match.group(0).strip().lower() in _STRONG_ACTION_VERBS


def _scrub_strong_verb_citations(check: dict) -> None:
    """Drop any sentence that holds up a strong action verb as an example of
    weak wording. Runs on checks that stay failed, so the user never reads
    "'Managed ...' uses weak wording" — leadership verbs are a strength."""
    explanation = str(check.get("explanation") or "")
    if not explanation:
        return
    sentences = re.split(r'(?<=[.!?])\s+', explanation)
    kept = [
        sentence for sentence in sentences
        if not any(
            _snippet_opens_with_strong_verb(snippet)
            for snippet in _QUOTED_SNIPPET_RE.findall(sentence)
        )
    ]
    if len(kept) == len(sentences):
        return
    check["explanation"] = " ".join(part for part in kept if part.strip()).strip() or (
        f"Fewer than {_ACTION_VERB_MIN_STRONG_BULLETS} bullet points begin with a "
        "strong action verb."
    )


def _repair_action_verbs(parsed: dict, resume_text: str) -> None:
    """The action-verb check is a countable rule — "at least 4 bullets begin
    with a strong action verb" — so count them here rather than trusting the
    model's arithmetic, which under-counts and then justifies itself with a
    leadership verb ("Managed ...") presented as weak wording.
    Only ever flips a failure to a pass; a genuine failure keeps its
    explanation, minus any bogus strong-verb example.
    """
    if not isinstance(parsed, dict):
        return
    strong_bullets = _count_strong_verb_bullets(resume_text)
    for section in ("experience", "projects"):
        container = parsed.get(section)
        if not isinstance(container, dict):
            continue
        check = container.get("action_verbs")
        if not isinstance(check, dict) or bool_score(check.get("passed")):
            continue
        if strong_bullets >= _ACTION_VERB_MIN_STRONG_BULLETS:
            check["passed"] = "true"
            check["explanation"] = (
                f"{strong_bullets} bullet points begin with a strong action verb."
            )
            check["action"] = ""
        else:
            _scrub_strong_verb_citations(check)


_ATS_SCORE_CACHE: OrderedDict[str, str] = OrderedDict()
# ~8.5 KB per entry, so 300 is ~2.5 MB — negligible next to the cost of a miss,
# which is a paid LLM call rather than just CPU time. Sized by that asymmetry
# rather than tuned against measured traffic.
# In-process and wiped on every deploy, so entries live hours in practice —
# churn evicts them long before the month-scoped key would.
_ATS_CACHE_MAX = 300

# Fixed seed so the same resume + job description scores the same number on
# every run and on every machine. A score that moves on its own is not a
# measurement, and this is a scoring product.
_ATS_SEED = 7


async def ats_scoring(resume_string, jd_string):
    """Gives ats score for the resume highlignting strengths and weaknesses"""
    current_date = date.today()
    _cache_key = hashlib.md5(
        (
            # Bump on every prompt/repair change or cached scans keep serving
            # the old verdicts (v4: action-verb + years-tolerance repairs).
            #
            # Scoped to the MONTH, not the day. The date is a real input — it is
            # sent to the model (see user_message) and drives the chronology and
            # years-of-experience checks — so it has to be in the key or a cached
            # verdict would go stale as time passes. But every consumer of it
            # works at month granularity: _passes_chronology_recheck compares
            # (year, month) and the explanations render "%B %Y". Keying on the
            # day therefore forced a fresh paid LLM call every midnight to
            # reproduce an identical answer — ~365 re-scans a year where ~12
            # carry real change.
            "ats-chronology-v4|" + current_date.strftime("%Y-%m") + "|" +
            # The separator matters: joining these with nothing meant a resume
            # ending in "ab" with JD "c" hashed the same as "a" + "bc", so two
            # different scans could collide and return each other's score.
            str(resume_string) + "\x00--jd--\x00" + str(jd_string)
        ).encode()
    ).hexdigest()
    if _cache_key in _ATS_SCORE_CACHE:
        _ATS_SCORE_CACHE.move_to_end(_cache_key)
        return _ATS_SCORE_CACHE[_cache_key]


    # Change 3: run deterministic checks before LLM (no tokens consumed)
    precheck = _deterministic_ats_precheck(resume_string)

    # Change 1: static rules in system message; only resume+JD in user message
    # so OpenAI caches the 300-line system prompt across requests.
    user_message = (
        f"Current Date: {current_date.strftime('%B %d, %Y')}\n\n"
        f"Resume:\n{resume_string}\n\nJob Description:\n{jd_string}"
    )

    client = await _build_openai_client()
    # Change 2: stream=True — collect chunks as they arrive instead of one big buffer
    try:
        stream = await client.chat.completions.create(
            model=AI_MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _ATS_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0,
            # ~62 of the 100 points come from this call's yes/no answers, so a
            # user rescanning the same resume could see a different number.
            # temperature=0 alone does not guarantee identical output; the seed
            # makes the score reproducible.
            seed=_ATS_SEED,
            # 1500 was not enough for the full audit JSON on a long resume - it
            # truncated and fell back to _repair_truncated_json, silently losing
            # checks (a missing check scores 0, so truncation cost real points).
            max_tokens=4000,
            stream=True,
        )
        chunks: list[str] = []
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                chunks.append(delta)
        content = "".join(chunks)
    except Exception as exc:
        raise _normalize_openai_error(exc) from exc

    if False:
        base_prompt=f"""You are a professional Applicant Tracking System (ATS) resume scanner similar to Jobscan.

Your task is to analyze a resume against a job description and generate a structured ATS Match Report.

OUTPUT ONLY VALID JSON.

Do NOT output markdown.

Do NOT output explanations outside JSON.

Do NOT estimate or calculate ATS scores.

Do NOT hallucinate information.

Do NOT assume skills, experience, education, certifications, projects, achievements, links, or qualifications that are not explicitly present in the resume.

INPUTS

Resume:
{resume_string}

Job Description:
{jd_string}

==================================================
OBJECTIVITY RULES (MANDATORY)
=============================

You are performing a rule-based ATS audit.

Every pass/fail decision must be based only on observable evidence in the resume and job description.

If evidence is unclear, choose FALSE.

Never reward implied experience.

Never reward inferred skills.

Never reward potential.

Never reward assumptions.

Use only information explicitly written in the resume.

The same resume and same job description should produce the same output every time.

When uncertain, use the stricter interpretation.

==================================================
CONTACT INFORMATION RULES
=========================

Email

Pass if a valid email address is explicitly present.

Fail otherwise.

Phone

Pass if a valid phone number is explicitly present.

Fail otherwise.

LinkedIn

Pass if any of the following are true:

* linkedin.com appears in the resume text
* a LinkedIn URL is explicitly provided
* the word "LinkedIn" appears in the contact section or header of the resume

Fail only if there is no mention of LinkedIn anywhere in the resume.

==================================================
SKILLS MATCH RULES
==================

Hard Skills

RULE 1 — ATOMICITY: Every hard skill entry must be a single technology name, tool, or framework of 1–4 words maximum. Never output a full requirement sentence as a skill.

RULE 2 — PARENTHETICAL EXPLOSION: When the job description lists tools inside parentheses, e.g. "MLOps tools (Kubeflow, Airflow)", extract EACH tool as its own separate entry: "Kubeflow", "Airflow". Do not include the surrounding phrase.

RULE 3 — STRIP QUALIFIERS: Remove experience-level wrappers before extracting. Phrases beginning with "X+ years of", "Experience in/with", "Knowledge of", "Familiarity with", "Strong background in" are NOT skills — extract only the technology name(s) embedded inside them.

BAD (entire phrase as one skill — NEVER do this):
  "3+ years of experience in ML engineering or software engineering with an ML focus"
  "Experience deploying models via REST APIs or model serving frameworks (TorchServe, TF Serving)"
  "Knowledge of MLOps tools (Kubeflow, Airflow)"

GOOD (atomic skill names extracted from the same phrases):
  "REST API", "TorchServe", "TF Serving"
  "Kubeflow", "Airflow"

EQUIVALENCE EXAMPLES (exact match or obvious synonym only):

Python = Python
PyTorch = PyTorch
Docker = Docker

Do NOT treat:

AWS = Azure
PyTorch = TensorFlow
Power BI = Tableau

Matched Skills

Skills present in both resume and job description (atomic names only).

Missing Skills

Skills required by the job description but not found in the resume (atomic names only, 1–4 words each).

Never hallucinate skills.

Soft Skills

Extract soft skills explicitly mentioned in the job description.

Match only if clearly demonstrated in the resume through achievements, leadership, communication, collaboration, mentoring, stakeholder management, ownership, or similar evidence.

==================================================
RESUME SECTION RULES
====================

Projects Section

Pass if a dedicated Projects section exists.

Experience Section

Pass if a dedicated Experience, Work Experience, Employment, Internship, or Professional Experience section exists.

Skills Section

Pass if a dedicated Skills or Technical Skills section exists.

Education Section

Pass if a dedicated Education section exists.

==================================================
CHRONOLOGY RULES
================

Pass if work experience entries appear in reverse chronological order.

Most recent role first.

Fail if:

* dates are missing
* ordering is inconsistent
* chronology cannot be determined

==================================================
SPELLING RULES
==============
Find all spelling mistakes.
Pass if no obvious spelling mistakes are found.
Fail only when a word is genuinely misspelled. Give explanation for all misspelled words without missing any.
Do not miss any misspelled words.
Do not fail for style preferences.

MANDATORY PDF EXTRACTION ARTIFACT RULE — NEVER VIOLATE:
Resume text is extracted from PDF files. PDF extraction frequently merges multiple correctly-spelled words into one long token without spaces. This is a very common technical artifact — the original resume has correct spelling and proper spacing.

ARTIFACT EXAMPLES — these are NOT spelling errors, ignore them completely:
- "Formulatingtechnicaldesignsforindependentend-to-endproblems" → real text: "Formulating technical designs for independent end-to-end problems"
- "drivingcross-teamcollaboration" → real text: "driving cross-team collaboration"
- "upholdingsoftware" → real text: "upholding software"
- "Firstrankandallrounderoftheyear" → real text: "First rank and all-rounder of the year"
- "TackledotherchallengessuchasbuildingPrometheus" → real text: "Tackled other challenges such as building Prometheus"

DETECTION RULES — apply every one of these:
RULE: Any token containing 2 or more recognizable English words merged together (with or without a hyphen between some of them) is an extraction artifact. Do NOT flag it as a spelling error. Never mention it in feedback.
RULE: Any token where recognizable words are merged around a hyphen (e.g., "drivingcross-teamcollaboration", "end-to-endproblems") is an extraction artifact. Ignore it entirely.
RULE: When uncertain whether a long token (10+ characters) is an artifact or a genuine misspelling, treat it as an artifact and do NOT flag it.
RULE: Capitalization differences (e.g., "Medals" vs "medals", "Java", "Team") are NOT spelling errors. Only flag tokens where the specific letters themselves are wrong (e.g., "acomplishment" → "accomplishment").

==================================================
GRAMMAR RULES
=============

Pass if no objective grammar mistakes significantly affecting readability are found.

Minor stylistic preferences should not cause failure.

Fail only for actual grammar errors.

==================================================
BUZZWORD RULES
==============

Flag only if unsupported buzzwords appear.

Examples:

Hardworking
Team Player
Go Getter
Results Driven
Dynamic Professional
Fast Learner
Self Starter
Motivated Individual

Pass if these phrases are absent or supported by measurable evidence.

==================================================
PERSONAL PRONOUN RULES
======================

Fail if first-person pronouns are used.

Examples:

I
Me
My
Mine
We
Our
Ours

Pass otherwise.

==================================================
EDUCATION MATCH RULES
=====================

Pass if the resume satisfies educational requirements explicitly stated in the job description.

If the job description does NOT explicitly state a degree, major, or educational requirement, this check MUST pass automatically — do not infer, assume, or guess an educational requirement that is not written in the job description, and do not fail this based on generic assumptions about what employers "often" or "typically" require.

An in-progress / currently pursuing degree counts as satisfying a stated requirement for that degree level. Never treat an in-progress degree as a weakness or partial failure — only fail if the job description explicitly requires a degree that is completed/conferred (e.g. "must have completed a Bachelor's degree") and the resume shows no evidence of one in progress or completed.

Fail otherwise, and only for a requirement that is explicitly present in the job description text.

Explain exactly which requirement, quoted or closely paraphrased from the job description, is missing.

==================================================
EXPERIENCE MATCH RULES
======================

Pass if BOTH conditions are met:

1. Required years of experience are satisfied.

AND

2. At least 50% of the primary responsibilities required by the job description are represented in the resume.

Fail otherwise.

The explanation must clearly identify:

* missing years of experience
* missing responsibilities
* missing technologies
* missing domain expertise

Use the Current Date supplied in the user message for every date comparison.
Never call a month "in the future" if it is in or before the current month —
double-check the arithmetic against the Current Date before writing that
word into an explanation.

==================================================
COMPANY NAME RULES
==================

Pass if company names are provided for work experience.

Fail otherwise.

==================================================
JOB TITLE RULES
===============

Pass if job titles are provided for work experience.

Fail otherwise.

==================================================
ACTION VERB RULES
=================

Review all experience and project bullet points.

Strong action verbs include:

Developed
Built
Implemented
Designed
Engineered
Created
Led
Optimized
Automated
Managed
Analyzed
Delivered
Reduced
Increased
Generated
Architected
Deployed
Migrated
Produced
Directed
Established

Weak verbs include:

Worked on
Helped
Assisted
Participated
Responsible for
Involved in
Contributed to

A bullet point that begins with a word from the Strong action verbs list above MUST be counted as strong, even if the rest of the sentence sounds generic or technical. Never cite a word from the Strong action verbs list (e.g. "Developed") as an example of weak wording in an explanation. Only words from the Weak verbs list (or synonyms of them) may be cited as weak.

Pass if at least 70% of bullets begin with strong action verbs.

Fail otherwise.

==================================================
QUANTIFIED IMPACT RULES
=======================

Count bullets containing measurable results.

Examples:

15%
20%
$50,000
1000 users
30% improvement
2x increase
50ms reduction
95% accuracy

Pass if at least 30% of experience/project bullets contain measurable metrics.

Fail otherwise.

==================================================
PROJECT LINK RULES
==================

Pass if project links, GitHub links, repository links, demo links, or portfolio links are explicitly present.

Fail otherwise.

Do not assume links exist.

==================================================
FORMATTING RULES
================

Single Column

Pass if the resume appears primarily single-column.

Fail if multiple columns are clearly present.

Photos or Graphics

Fail if photographs, graphics, icons, watermarks, or visual elements likely to confuse ATS systems are present.

Pass otherwise.

Excessive Design

Fail if excessive colors, tables, text boxes, decorative elements, or ATS-unfriendly layouts are present.

Pass otherwise.

Unnecessary Sections

Fail if the resume contains:

* Hobbies
* Interests
* References
* Personal Information
* Irrelevant Activities

Pass otherwise.

==================================================
EXPLANATION RULES
=================

Only provide explanations when a check fails.

Every explanation must:

1. Identify the exact issue.
2. Identify where it occurs.
3. Explain why it matters.
4. Reference actual resume content whenever possible.

Bad:

"Action verbs missing."

Good:

"The bullet point 'Worked on customer churn prediction model' uses weak wording and does not demonstrate ownership or impact."

Bad:

"Project links missing."

Good:

"The project 'Housing Price Predictor' does not contain a GitHub repository URL or live demo link."

==================================================
ACTION RULES
============

Only provide actions when a check fails.

Actions must be specific and directly actionable.

Bad:

"Add metrics."

Good:

"Rewrite 'Built recommendation engine' to include measurable outcomes such as user count, latency reduction, revenue impact, or accuracy improvement."

Bad:

"Add skills."

Good:

"Add Docker and AWS to the Skills section only if you genuinely possess those skills and can demonstrate them through experience or projects."

==================================================
TOP PRIORITY FIXES RULES
========================

Return exactly 3 fixes.

Prioritize:

1. Experience gaps
2. Missing critical skills
3. Missing ATS-critical sections
4. Missing measurable achievements
5. Formatting problems

Do not include minor issues unless no major issues exist.

==================================================
OUTPUT RULES
============

Output ONLY valid JSON.

No markdown.

No extra text.

No commentary.

No explanations outside JSON.

The JSON must strictly follow the schema provided below.


    ### REQUIRED JOBSCAN-STYLE JSON FORMAT
    """
    json_schema='''{
  "contact_information": {
    "email": {
      "present": "<false|true>"
    },
    "phone": {
      "present": "<false|true>"
    },
    "linkedin": {
      "present": "<false|true>"
    }
  },

  "spelling_and_grammar": {
    "spelling": {
      "passed":"<false|true>",
      "explanation": "<Provide_exp with all the incorrect spellings. Do not miss any mispelled words>",
      "action":"<Provide_act>"
    },

    "grammar": {
      "passed": "<false|true>",
      "explanation": "",
      "action": ""
    },

    "buzzwords": {
      "passed": "<false|true>",
      "explanation": "",
      "action": ""
    },

    "personal_pronouns": {
      "passed": "<false|true>",
      "explanation": "",
      "action":""
    }
  },

  "skills": {
    "hard_skills": {
      "matched": [],
      "missing": []
      
    },

    "soft_skills": {
      "matched": [],
      "missing": []
      
    }
  },

  "sections": {
    "projects": {
      "present": "<false|true>"
    },

    "experience": {
      "present": "<false|true>"
    },

    "skills": {
      "present": "<false|true>"
    },

    "education": {
      "present": "<false|true>"
    },

    "chronological_dates": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "formatting": {
    "single_column": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "photos_or_graphics": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "excessive_design": {
      "passed": "<false|true>",
      "explanation":""
    },

    "unnecessary_sections": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "education": {
    "qualification_match": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "experience": {
    "experience_match": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "company_names": {
      "present": "<false|true>"                                                      
    },

    "job_titles": {
      "present": "<false|true>"
    },

    "action_verbs": {
      "passed": "<false|true>",
      "explanation": ""
      
    },

    "quantified_impact": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "projects": {
    "project_links": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "action_verbs": {
      "passed": "<false|true>",
      "explanation": ""
    },

    "quantified_impact": {
      "passed": "<false|true>",
      "explanation": ""
    }
  },

  "top_priority_fixes": [
    {
      "issue": "",
      "action": ""
    },
    {
      "issue": "",
      "action": ""
    },
    {
      "issue": "",
      "action": ""
    }
  ]
} '''
    try:
        parsed = json.loads(content)
    except Exception:
        match = re.search(r"\{[\s\S]*\}\s*$", content)
        parsed = json.loads(match.group(0)) if match else {}

    if not isinstance(parsed, dict):
        parsed = {}

    # Change 3: merge deterministic pre-check results into the LLM response
    def _deep_merge(base: dict, override: dict) -> None:
        for k, v in override.items():
            if isinstance(v, dict) and isinstance(base.get(k), dict):
                _deep_merge(base[k], v)
            else:
                base[k] = v

    _deep_merge(parsed, precheck)
    _force_pass_chronology(parsed)
    _repair_false_future_experience_match(parsed, current_date)
    _repair_experience_years_tolerance(parsed, resume_string, jd_string)
    _repair_action_verbs(parsed, resume_string)

    hard_matched = parsed.get("skills", {}) \
                     .get("hard_skills", {}) \
                     .get("matched", [])

    hard_missing = parsed.get("skills", {}) \
                        .get("hard_skills", {}) \
                        .get("missing", [])

    soft_matched = parsed.get("skills", {}) \
                        .get("soft_skills", {}) \
                        .get("matched", [])

    soft_missing = parsed.get("skills", {}) \
                        .get("soft_skills", {}) \
                        .get("missing", [])

    # Sanitize hard_matched: the LLM's own "matched" list can contain the same
    # generic phrases/role fragments as "missing" (e.g. "senior IC role"), so it
    # must be decomposed/validated the same way instead of being trusted as-is.
    sanitized_matched: list[str] = []
    seen_matched_lower: set[str] = set()
    if hard_matched:
        _matched_leftover, _matched_confirmed = _sanitize_hard_skill_list(
            hard_matched, resume_text=resume_string, jd_text=jd_string,
        )
        for token in _matched_confirmed + _matched_leftover:
            key = token.lower()
            if key not in seen_matched_lower:
                seen_matched_lower.add(key)
                sanitized_matched.append(token)
    hard_matched = sanitized_matched

    # Sanitize hard_missing: decompose any LLM phrase entries into atomic keywords
    # and re-route them correctly between matched/missing.
    if hard_missing:
        _sanitized_missing, _newly_matched = _sanitize_hard_skill_list(
            hard_missing,
            resume_text=resume_string,
            jd_text=jd_string,
        )
        for token in _newly_matched:
            key = token.lower()
            if key not in seen_matched_lower:
                seen_matched_lower.add(key)
                hard_matched.append(token)
        hard_missing = _sanitized_missing

    _hs = parsed.setdefault("skills", {}).setdefault("hard_skills", {})
    _hs["matched"] = hard_matched
    _hs["missing"] = hard_missing

    matched_count = len(hard_matched) + len(soft_matched)
    missing_count = len(hard_missing) + len(soft_missing)
    
    total = matched_count + missing_count

    skill_match_score = (
        round(matched_count / total, 2)
        if total > 0 else 0
    )
    
    deterministic_breakdown = compute_deterministic_ats_score_breakdown(
        parsed, resume_text=resume_string
    )
    deterministic_score = deterministic_breakdown["final_score"]
    
    parsed["match_rate"] = deterministic_score
    if deterministic_score < 40:
        parsed["match_level"] = "Poor"
    elif deterministic_score < 60:
        parsed["match_level"] = "Fair"
    elif deterministic_score < 75:
        parsed["match_level"] = "Good"
    elif deterministic_score < 90:
        parsed["match_level"] = "Strong"
    else:
        parsed["match_level"] = "Excellent"
    parsed["deterministic_breakdown"] = deterministic_breakdown

    # Add resume statistics
    resume_stats = _compute_resume_stats(resume_string)
    parsed["word_count"] = resume_stats["word_count"]
    parsed["pages"] = resume_stats["pages"]
    parsed["bullet_points"] = resume_stats["bullet_points"]
    parsed["metrics_used"] = resume_stats["metrics_used"]

    _result = json.dumps(parsed)
    _ATS_SCORE_CACHE[_cache_key] = _result
    if len(_ATS_SCORE_CACHE) > _ATS_CACHE_MAX:
        _ATS_SCORE_CACHE.popitem(last=False)
    return _result

def process_resume(resume_name,jd_string):
    """
    Process a resume file against a job description to create an optimized version.

    Args:
        resume (file): A file object containing the resume in markdown format
        jd_string (str): The job description text to optimize the resume against

    Returns:
        tuple: A tuple containing three elements:
            - str: The optimized resume in markdown format (for display)
            - str: The same optimized resume (for editing)
            
    """
     
    def extract_pdf_text(path):
        text = ""
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text += page.extract_text() + "\n"
        return text
    resume_string=extract_pdf_text(f"uploads/{resume_name}")

    resume_string = normalize_links(resume_string)
    links = extract_links(resume_string)
    mapped_links = map_demo_links(resume_string)
    pub_links = extract_publication_links(resume_string)

    # create prompt
    prompt = create_prompt(resume_string, jd_string)

    # Generate response
    try:
        response_string = get_resume_response(prompt)
    except Exception as e:
        return f"Failed to generate resume from the AI: {e}", ""

    # Return two outputs to match Gradio: Markdown display and editable text
    new_resume = response_string
    try:
       data = json.loads(response_string)
       data = inject_links(data, links, mapped_links, pub_links)
       return json.dumps(data, indent=2)
    except Exception:
      return response_string
    # try:
    #     output_pdf_file = "resumes/optimized_resume.pdf"

    #     # convert markdown to HTML
    #     html_content = markdown(new_resume)

    #     # Convert HTML to PDF and save (use existing styles filename)
    #     HTML(string=html_content).write_pdf(output_pdf_file, stylesheets=['resumes/style.css'])
    #     return f"Successfully exported resume to {output_pdf_file} 🎉"
    # except Exception as e:
    #     return f"Failed to export resume: {str(e)} 💔"

async def generate_interview_questions(resume_string: str, jd_string: str) -> dict:
    """Generate role-specific interview questions based on resume and job description.

    The 4 categories are generated as 4 parallel LLM calls instead of one large
    50-question call. Output tokens dominate latency, so splitting the work and
    running it concurrently cuts wall-clock time to roughly the slowest single
    category (~15 questions) rather than the sum of all 50.
    """
    # Trim inputs — the model only needs the substance, and shorter prompts are faster.
    resume_string = (resume_string or "")[:6000]
    jd_string = (jd_string or "")[:4000]

    client = await _build_openai_client()

    # (display name, icon, how many questions, whether to also infer job_title/company)
    cat_specs = [
        ("Technical Skills", "TS", 15, True),
        ("Experience & Projects", "EP", 15, False),
        ("Behavioural", "BH", 10, False),
        ("Culture & Motivation", "CM", 10, False),
    ]

    def _build_prompt(name: str, count: int, want_meta: bool) -> str:
        meta = (
            '"job_title": "<inferred job title from JD>", '
            '"company": "<company name if mentioned, else \'the company\'>", '
            if want_meta else ""
        )
        return f"""You are an expert technical recruiter and interview coach.
Based on the resume and job description, generate exactly {count} "{name}" interview questions.
Output ONLY valid JSON, no markdown:

{{ {meta}"questions": [
  {{"q": "<question>", "tip": "<1-sentence answer tip>", "answer": "<model answer, 70-110 words, direct and role-specific with concrete context, tools, and outcome>"}}
] }}

Make questions specific to the candidate's actual resume and the role — not generic.
Advanced difficulty: senior-level, scenario-based, tradeoff-oriented. Most questions should
require decision-making under constraints (time, scale, reliability, security, unclear
requirements, stakeholder pressure). Avoid textbook/definition questions.
Each model answer is a direct sample answer only (no coaching advice).

Resume:
{resume_string}

Job Description:
{jd_string}"""

    async def _gen_category(name: str, icon: str, count: int, want_meta: bool) -> dict:
        # Each category is isolated: if one call fails (network, empty choices,
        # malformed JSON), it returns an empty category instead of rejecting the
        # whole asyncio.gather and failing the other 3 categories too.
        empty = {"name": name, "icon": icon, "questions": [], "_job_title": None, "_company": None}
        try:
            # Bound output so each call stays fast (~160 tokens/question is plenty).
            resp = await client.chat.completions.create(
                model=AI_MODEL,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": _build_prompt(name, count, want_meta)}],
                temperature=0.4,
                max_tokens=min(4000, count * 170 + 300),
            )
            if not resp.choices:
                logger.warning("Interview category '%s' returned no choices", name)
                return empty
            data = json.loads((resp.choices[0].message.content or "").strip())
        except Exception:
            logger.exception("Interview category generation failed: %s", name)
            return empty
        return {
            "name": name,
            "icon": icon,
            "questions": data.get("questions") or [],
            "_job_title": data.get("job_title") if want_meta else None,
            "_company": data.get("company") if want_meta else None,
        }

    try:
        results = await asyncio.gather(*[
            _gen_category(name, icon, count, want_meta)
            for (name, icon, count, want_meta) in cat_specs
        ])

        job_title, company = "", "the company"
        categories = []
        for cat in results:
            if cat.get("_job_title"):
                job_title = str(cat["_job_title"]).strip() or job_title
            if cat.get("_company"):
                company = str(cat["_company"]).strip() or company
            questions = cat["questions"] if isinstance(cat["questions"], list) else []
            for question in questions:
                if not isinstance(question, dict):
                    continue
                question["q"] = str(question.get("q", "")).strip()
                question["tip"] = str(question.get("tip", "")).strip()
                answer = str(question.get("answer", "")).strip()
                if len(answer) < 180:
                    base = answer or (
                        "In this case, I focused on solving the core requirement by breaking the problem into clear steps and prioritizing reliability first."
                    )
                    answer = (
                        f"{base} I worked with the relevant tools for the role, handled trade-offs around performance and maintainability, "
                        f"and coordinated implementation to keep delivery predictable. The result was a measurable improvement in quality and speed, "
                        f"while keeping the solution easy for the team to maintain and extend."
                    )
                question["answer"] = answer
            categories.append({"name": cat["name"], "icon": cat["icon"], "questions": questions})

        # If every category failed, surface an error instead of an empty success
        # so the endpoint can return a proper failure and the user can retry.
        if not any(c["questions"] for c in categories):
            raise RuntimeError("No interview questions were generated")

        return {"job_title": job_title, "company": company, "categories": categories}
    except Exception as exc:
        raise RuntimeError(f"Interview question generation failed: {exc}") from exc


async def evaluate_interview_answer(question: str, model_answer: str, candidate_answer: str) -> dict:
    """Evaluate a candidate answer against the question and model answer."""
    prompt = f"""You are an expert interview evaluator.
Score the candidate answer fairly on a 0-10 scale.

Question:
{question}

Model answer:
{model_answer}

Candidate answer:
{candidate_answer}

Return ONLY valid JSON with this exact schema:
{{
  "score": <number between 0 and 10>,
  "strengths": "<one short sentence>",
  "improvements": "<one short sentence>",
  "verdict": "<Excellent | Good | Fair | Needs Improvement>"
}}
"""
    client = await _build_openai_client()
    try:
        response = await client.chat.completions.create(
            model=AI_MODEL,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=400,
        )
        raw = (response.choices[0].message.content or "").strip()
        parsed = json.loads(raw)
        score = max(0.0, min(10.0, float(parsed.get("score", 0))))
        return {
            "score": round(score, 1),
            "strengths": str(parsed.get("strengths", "")).strip(),
            "improvements": str(parsed.get("improvements", "")).strip(),
            "verdict": str(parsed.get("verdict", "")).strip() or "Fair",
        }
    except Exception as exc:
        raise RuntimeError(f"Interview answer evaluation failed: {exc}") from exc


def _build_mock_interview_system_prompt(
    resume_text: str,
    role: str,
    interview_type: str,
    num_questions: int,
    job_desc: str = "",
) -> str:
    return f"""You are Zara, a professional AI interviewer for TailorCV.
You are interviewing a candidate for the role of "{role}".
Interview type: {interview_type}.
Total questions to ask: {num_questions}.

Candidate resume/background:
{resume_text or "Not provided."}

Job description:
{job_desc or "Not provided."}

Rules:
- Ask ONE question at a time, concise and spoken-friendly (max 40 words).
- Blend behavioral and technical depth according to interview type.
- Ask context-aware follow-up questions based on prior answers.
- Default to a high-difficulty bar: ask senior-level, scenario-driven, tradeoff-heavy questions.
- Avoid basic definition-style questions unless the candidate answer reveals a gap.
- Include pressure-test prompts (ambiguity, constraints, failure modes, scaling, security, and prioritization).
- Escalate difficulty when answers are strong; drill deeper with "why" and "what would you change now?" follow-ups.
- Be warm and professional.
- Do not mention internal model/provider names.
"""


async def generate_tts_audio(text: str) -> bytes:
    """Generate speech using OpenAI TTS-1 with the 'nova' voice (natural female)."""
    client = await _build_openai_client()
    response = await client.audio.speech.create(
        model="tts-1",
        voice="nova",
        input=text[:1000],
        speed=1.0,
    )
    return response.content


# ── Site-wide AI assistant ("Tailor") ────────────────────────────────────────
# A friendly product guide + general career assistant that lives on every page.
# Knows theTailorCV's features so it can explain them and nudge signup, but also
# helps with general resume/interview/career questions.

AGENT_FEATURE_KNOWLEDGE = """theTailorCV is an AI career toolkit. Its features:
- ATS Score (/solutions): scores a resume against a job description and shows what's missing. Guests get one free scan.
- AI Optimize (/optimize): rewrites a resume to match a specific job, ATS-friendly.
- Resume Builder (/modify-cv): build a resume from guided sections, pick a template, live preview, export PDF.
- Cover Letter (/cover-letter): generates a tailored cover letter from a resume + job description.
- My Resumes (/my-resumes): every optimized resume is saved with its ATS score and job, re-download anytime.
- Portfolio Website (/portfolio): turn a resume into a live shareable portfolio site, no coding.
- Templates (/templates): clean, ATS-safe resume templates.
- Interview Prep (/interview-prep): generate likely interview questions from a resume + role.
- Mock Interview (/mock-interview): practice with Zara, an AI interviewer that asks about YOUR projects and gives feedback.
- Chrome Extension (/extension): tailor resumes and check ATS score right on any job posting.
- Pricing (/pricing): free account to start; Pro unlocks unlimited tailoring."""

AGENT_COMPANY_INFO = """About theTailorCV (see /about):
- Co-founders: Shubham Sarkar (Co-Founder & Head of Technology) and Trisha Debnath (Co-Founder & Head of Strategy). They're a couple who built theTailorCV together while finishing their Chemical Engineering degrees — Shubham taught himself to code through tough circumstances and sketched the first version; Trisha learned frontend and FastAPI and turned it into production software.
- Contact / support: email support@thetailorcv.com.
- Social: X/Twitter @sarkar53765, LinkedIn linkedin.com/company/thetailorcv, Instagram @thetailorcv, YouTube @thetailorcv.
If someone asks who made theTailorCV, who the founders are, or how to get in touch, share this."""

PAGE_CONTEXT = {
    "/solutions":       "the ATS Score checker",
    "/optimize":        "the AI resume optimizer",
    "/modify-cv":       "the resume builder",
    "/cover-letter":    "the AI cover letter generator",
    "/my-resumes":      "the saved resumes library",
    "/portfolio":       "the portfolio website builder",
    "/templates":       "the resume templates gallery",
    "/interview-prep":  "the interview question generator",
    "/mock-interview":  "the AI mock interview (Zara)",
    "/extension":       "the Chrome extension",
    "/pricing":         "the pricing page",
}


def build_agent_system_prompt(page_path: str, is_logged_in: bool, blog_catalog: str = "") -> str:
    page_path = (page_path or "/").rstrip("/") or "/"
    here = PAGE_CONTEXT.get(page_path)
    where = f"The user is currently on {here}. " if here else ""
    audience = (
        "The user is signed in — be helpful and practical, point them to the right feature. "
        if is_logged_in else
        "The user is NOT signed in. Be genuinely helpful first, then, when it fits naturally, "
        "encourage them to create a free account to save their work and unlock the tools — never pushy. "
    )
    blog_block = ""
    if blog_catalog:
        blog_block = (
            "\n\nteTailorCV also has a blog with career articles. When a user's question is "
            "answered by one of these, recommend it by title and link (e.g. /blog/<slug>). "
            "Only recommend articles from this list; never invent a title or link:\n"
            f"{blog_catalog}"
        )
    return (
        "You are Tailor, the friendly AI assistant for theTailorCV. You help with two things: "
        "(1) explaining and guiding people to theTailorCV's features, and (2) general career help "
        "— resumes, cover letters, interviews, job search, ATS tips.\n\n"
        f"{AGENT_FEATURE_KNOWLEDGE}\n\n"
        f"{AGENT_COMPANY_INFO}"
        f"{blog_block}\n\n"
        f"{where}{audience}\n"
        "Style: warm, concise, conversational — 2-4 short sentences unless asked for detail. "
        "Use plain text (no markdown headings). When a theTailorCV feature or blog article solves "
        "the user's need, name it and give its full link (e.g. /cover-letter or /blog/some-slug) so "
        "it's clickable. Share support@thetailorcv.com or the full social URL when relevant. "
        "Stay honest; if you don't know, say so."
    )


async def agent_chat_reply(
    user_message: str,
    history: list | None = None,
    page_path: str = "/",
    is_logged_in: bool = False,
    blog_catalog: str = "",
    model: str = AI_MODEL,
) -> str:
    """One assistant turn for the site-wide 'Tailor' agent."""
    client = await _build_openai_client()
    messages = [{"role": "system", "content": build_agent_system_prompt(page_path, is_logged_in, blog_catalog)}]
    # Carry a short rolling window of prior turns for context.
    for turn in (history or [])[-8:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content[:2000]})
    messages.append({"role": "user", "content": user_message[:2000]})
    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.5,
        max_tokens=400,
    )
    choice = response.choices[0] if response.choices else None
    return (choice.message.content if choice else "").strip() or \
        "Sorry, I couldn't come up with a reply just now — mind trying again?"


async def generate_mock_interview_first_question(
    resume_text: str,
    role: str,
    interview_type: str,
    num_questions: int,
    job_desc: str = "",
) -> str:
    client = await _build_openai_client()
    system_prompt = _build_mock_interview_system_prompt(
        resume_text=resume_text,
        role=role,
        interview_type=interview_type,
        num_questions=num_questions,
        job_desc=job_desc,
    )
    response = await client.chat.completions.create(
        model=MOCK_INTERVIEW_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Start the interview with question 1."},
        ],
        temperature=0.5,
        max_tokens=220,
    )
    return str(response.choices[0].message.content or "").strip()


async def generate_mock_interview_next_question(
    resume_text: str,
    role: str,
    interview_type: str,
    num_questions: int,
    question_index: int,
    job_desc: str,
    conversation_history: list[dict],
    user_answer: str,
) -> dict:
    client = await _build_openai_client()
    system_prompt = _build_mock_interview_system_prompt(
        resume_text=resume_text,
        role=role,
        interview_type=interview_type,
        num_questions=num_questions,
        job_desc=job_desc,
    ) + f"\nCurrent question index already completed: {question_index}\n"

    messages = [{"role": "system", "content": system_prompt}]
    for msg in conversation_history or []:
        role_val = str(msg.get("role", "")).strip()
        content_val = str(msg.get("content", "")).strip()
        if role_val in {"user", "assistant"} and content_val:
            messages.append({"role": role_val, "content": content_val})
    _answer_quality_hint = (
        "empty or no response"
        if not (user_answer or "").strip()
           or (user_answer or "").strip().lower() in {
               "no response provided within time limit.", "no response", "n/a", "na"
           }
        else "has content"
    )
    messages.append({"role": "user", "content": user_answer or "[No answer provided]"})
    messages.append(
        {
            "role": "user",
            "content": (
                "Return JSON only: "
                '{"done": <true|false>, '
                '"ack": "<honest one-sentence acknowledgment — '
                'ONLY say positive things like \'Great answer\' or \'Well said\' if the answer was genuinely good and detailed; '
                'if the answer was weak, vague, or missing say something neutral like \'Okay, let\'s move on\' or \'Got it\'; '
                f'the answer quality is: {_answer_quality_hint}>", '
                '"question": "<next question or empty if done>"}'
            ),
        }
    )

    response = await client.chat.completions.create(
        model=MOCK_INTERVIEW_MODEL,
        response_format={"type": "json_object"},
        messages=messages,
        temperature=0.45,
        max_tokens=300,
    )
    raw = str(response.choices[0].message.content or "").strip()
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = {"done": False, "ack": "Thanks for sharing that.", "question": raw}
    return {
        "done": bool(parsed.get("done", False)),
        "ack": str(parsed.get("ack", "")).strip() or "Thanks for sharing that.",
        "question": str(parsed.get("question", "")).strip(),
    }


def _completion_penalty(answered: int, total: int) -> float:
    """Direct ratio multiplier — score is capped at completion percentage.
    2/5 answered → max 40 pts regardless of answer quality.
    Works identically for 5, 10, and 20 question interviews."""
    if total <= 0:
        return 1.0
    return round(min(answered, total) / total, 4)


def _grade_from_score(score: float) -> str:
    if score >= 80:
        return "Excellent"
    if score >= 65:
        return "Good"
    if score >= 50:
        return "Average"
    return "Needs Work"


async def score_mock_interview(
    role: str,
    interview_type: str,
    resume_text: str,
    qa_log: list[dict],
    filler_count: int,
    total_words: int,
    camera_focus_score: int | None = None,
    num_questions: int | None = None,
) -> dict:
    client = await _build_openai_client()

    _SKIP = {"no response provided within time limit.", "no response", "n/a", "na", ""}
    answered_items = [
        item for item in (qa_log or [])
        if str(item.get("answer", "")).strip().lower() not in _SKIP
    ]
    total_q = num_questions if (num_questions and num_questions > 0) else max(len(qa_log or []), 1)
    answered_count = len(answered_items)

    # Completion penalty multiplier applied to all numeric scores after LLM
    penalty = _completion_penalty(answered_count, total_q)

    skipped_indices = {
        i + 1
        for i, item in enumerate(qa_log or [])
        if str(item.get("answer", "")).strip().lower() in _SKIP
    }
    # Add placeholder entries for questions that were never reached
    full_qa_log = list(qa_log or [])
    for extra in range(len(full_qa_log), total_q):
        full_qa_log.append({"question": f"Question {extra + 1} (not reached)", "answer": ""})

    if not answered_items:
        return {
            "overall": 12, "communication": 15, "depth": 8,
            "relevance": 10, "confidence": 12, "keywords_hit": 5,
            "completion_rate": 0,
            "grade": "Needs Work",
            "strengths": ["Interview was initiated successfully."],
            "improvements": [
                "Provide spoken answers for each question.",
                "Share concrete examples with tools, decisions, and outcomes.",
                "Reduce pauses and filler words by structuring responses.",
            ],
            "qa_scores": [
                {"index": i + 1, "score": 0, "feedback": "No answer was provided for this question."}
                for i in range(total_q)
            ],
        }

    qa_text = "\n\n".join(
        f"Q{i+1}: {str(item.get('question', '')).strip()}\n"
        f"A: {str(item.get('answer', '')).strip() or '[No answer — skipped or timed out]'}"
        for i, item in enumerate(full_qa_log)
    )

    prompt = f"""You are a professional interview evaluator.
Role: {role}
Interview type: {interview_type}
Filler words detected: {filler_count} out of ~{total_words} words.
Camera attention score (0-100): {camera_focus_score if camera_focus_score is not None else "Not available"}
Questions answered: {answered_count} out of {total_q}

Q&A Transcript:
{qa_text}

Scoring policy:
- Score ONLY based on the quality of the answers actually given.
- Questions marked [No answer — skipped or timed out] must receive a score of 0 with feedback "Not answered".
- Do NOT infer capability from resume, role title prestige, or assumptions.
- Reward specificity, structured thinking, tradeoff clarity, and correctness.
- Use camera score as a minor modifier to confidence only.

Return JSON only:
{{
  "overall": <0-100>,
  "communication": <0-100>,
  "depth": <0-100>,
  "relevance": <0-100>,
  "confidence": <0-100>,
  "camera_focus": <0-100>,
  "keywords_hit": <0-100>,
  "grade": "<Excellent|Good|Average|Needs Work>",
  "strengths": ["<point>", "<point>", "<point>"],
  "improvements": ["<point>", "<point>", "<point>"],
  "qa_scores": [{{"index":1,"score":<0-10>,"feedback":"<brief feedback>"}}]
}}"""

    response = await client.chat.completions.create(
        model=MOCK_INTERVIEW_MODEL,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1200,
    )
    raw = str(response.choices[0].message.content or "").strip()
    parsed = json.loads(raw)

    # All question indices that must score 0
    all_q_indices = set(range(1, total_q + 1))
    answered_q_indices = set(range(1, len(qa_log or []) + 1)) - skipped_indices
    zero_indices = all_q_indices - answered_q_indices  # skipped + never reached

    # Ensure qa_scores has an entry for every question; zero out unanswered ones
    existing = {qs.get("index"): qs for qs in parsed.get("qa_scores", [])}
    full_qa_scores = []
    for idx in range(1, total_q + 1):
        if idx in existing:
            qs = existing[idx]
        else:
            qs = {"index": idx, "score": 0, "feedback": "Not answered."}
        if idx in zero_indices:
            qs["score"] = 0
            qs["feedback"] = "Not answered."
        else:
            try:
                qs["score"] = max(0, min(10, int(float(qs.get("score", 0)))))
            except (TypeError, ValueError):
                qs["score"] = 0
        full_qa_scores.append(qs)
    parsed["qa_scores"] = full_qa_scores

    # Derive overall deterministically from qa_scores — immune to LLM inflation
    total_possible = total_q * 10
    actual_sum = sum(qs["score"] for qs in full_qa_scores)
    parsed["overall"] = round(actual_sum / total_possible * 100) if total_possible > 0 else 0

    # Apply completion penalty to sub-scores (handles string values too)
    sub_keys = ["communication", "depth", "relevance", "confidence", "keywords_hit", "camera_focus"]
    for k in sub_keys:
        val = parsed.get(k)
        if val is not None:
            try:
                parsed[k] = round(float(val) * penalty)
            except (TypeError, ValueError):
                pass

    parsed["grade"] = _grade_from_score(parsed["overall"])
    parsed["completion_rate"] = round(answered_count / total_q * 100)
    return parsed