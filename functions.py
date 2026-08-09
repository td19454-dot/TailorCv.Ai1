
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


def inject_links(data, links, mapped_links, pub_links=None):
    """
    Backfill missing project and publication URLs in the AI JSON using URLs extracted from the original PDF text.

    Important: only fill projects/publications that are missing their own links. This avoids showing
    unrelated URLs when the user/resume contains multiple projects/links.
    """
    if pub_links is None:
        pub_links = []
    
    if not isinstance(data, dict):
        return data

    # Handle Projects
    projects = data.get("projects")
    if isinstance(projects, list) and projects:
        # Ensure every project has a "links" list for downstream rendering.
        for project in projects:
            if isinstance(project, dict):
                project.setdefault("links", [])

        def _project_has_any_link(p: dict) -> bool:
            if not isinstance(p, dict):
                return False
            if str(p.get("url") or "").strip():
                return True
            if str(p.get("github_link") or "").strip():
                return True
            # Check nested links array for any usable url.
            for item in p.get("links") or []:
                if not isinstance(item, dict):
                    continue
                if str(item.get("url") or item.get("href") or item.get("link") or "").strip():
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
MOCK_INTERVIEW_MODEL = "gpt-4o-mini"


async def _build_openai_client():
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Add it to your .env file before using ATS analysis or resume optimization."
            )
        _openai_client = AsyncOpenAI(
            api_key=api_key,
            timeout=120.0,
            max_retries=3
        )
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

Rewrite the content resume to better match the job description and return in json.
Only improve wording and keyword alignment

IMPORTANT:
You are NOT formatting a resume.
You are ONLY returning structured content.
You must preserve factual details already present in the resume such as dates, CGPA/SGPA, percentages, marks, locations, and links.

### CONTENT COMPLETENESS (MANDATORY — DO NOT DROP ANYTHING)
- Include EVERY section that exists in the original resume (summary, experience, projects, education, skills, certifications, publications, achievements, extracurriculars, etc.).
- Include EVERY entry/sub-section. If the resume has 5 experiences, 8 projects, and 20 certifications, the output MUST contain ALL 5 experiences, ALL 8 projects, and ALL 20 certifications — same count, none merged, summarized away, or omitted.
- Keep EVERY bullet point of every entry. Do not drop bullets to save space.
- Never truncate the output. Return the COMPLETE JSON for the entire resume, however long it is. Length is not a reason to omit content.
- Preserve EVERY link (project, GitHub, Live/demo, LinkedIn, certification, publication, portfolio, company) on the exact entry it belongs to.

### OUTPUT RULES (MANDATORY)
- Output **ONLY valid JSON**
- No explanations, no markdown, no extra text

Guidelines to Follow:
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
Keyword Optimize and be specific for each section (Professional Summary, Experience, Skills, Education) to reflect relevance to the job.
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

  "summary": "",

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
@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=4, max=60)
)
async def get_resume_response(prompt: str, model: str = "gpt-4o-mini", temperature: float = 0) -> str:
    """
    Async OpenAI call for resume optimization with retries.
    """
    client = await _build_openai_client()
    try:
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {'role': 'system', "content": 'Expert resume writer and reviewer'},
                {'role': 'user', 'content': prompt}
            ],
            temperature=temperature,
            seed=_ATS_SEED,  # same resume + same job -> same rewrite
            max_tokens=16384,  # gpt-4o-mini max output; avoids truncating long resumes
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
                    temperature=temperature,
                    seed=_ATS_SEED,
                    max_tokens=16384,
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
) -> dict:
    """
    Post-process the skills array.

    Keeps the atomic hard skills the model produced, and adds a JD skill only
    when the original resume actually evidences it. JD skills with no evidence
    are returned on `data["skill_gaps"]` instead of being written into the
    resume, so we never make a claim the candidate cannot defend.

    `resume_text` is the raw text of the uploaded resume. When it is omitted no
    JD skill can be evidenced, so every unmatched JD skill becomes a gap.

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

    cleaned_skills: list[str] = []
    seen_lower: set[str] = set()
    for raw_skill in skills:
        skill = _clean_inline_text(raw_skill)
        key = skill.lower()
        if not _is_atomic_hard_skill(skill) or key in seen_lower:
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
    resume_evidence = str(resume_text or "")
    skill_gaps: list[str] = []

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

    data["skills"] = cleaned_skills
    data["skill_gaps"] = skill_gaps

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


def weave_soft_skills_into_summary(data: dict, soft_skills) -> dict:
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
        seen.add(key)
        additions.append(skill[0].lower() + skill[1:] if skill[:1].isupper() and not skill.isupper() else skill)

    if not additions:
        return data

    if len(additions) == 1:
        phrase = additions[0]
    elif len(additions) == 2:
        phrase = f"{additions[0]} and {additions[1]}"
    else:
        phrase = ", ".join(additions[:-1]) + f" and {additions[-1]}"

    sentence = f"Skilled in {phrase}."
    data["summary"] = f"{summary} {sentence}".strip() if summary else sentence
    data["soft_skills_added"] = additions
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
      - bullet/summary text — experience bullets, project bullets, and the
        summary — never force-injected, so bounded by what the resume's own
        content actually supports.

    Averaging the two means a resume can't reach 100% on the skills section
    alone; the bullets have to genuinely back it up too."""
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

The explanation must clearly identify:

* missing years of experience
* missing responsibilities
* missing technologies
* missing domain expertise

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


def _repair_false_future_chronology(parsed: dict, current_date: date | None = None) -> None:
    """Correct an LLM chronology failure when every cited future date is already past."""
    if not isinstance(parsed, dict):
        return

    chronology = parsed.get("sections", {}).get("chronological_dates", {})
    if not isinstance(chronology, dict) or bool_score(chronology.get("passed")):
        return

    explanation = str(chronology.get("explanation") or "")
    explanation_lower = explanation.lower()
    if "future" not in explanation_lower:
        return

    cited_dates = [
        (int(year), _MONTH_NUMBERS[month.lower()])
        for month, year in _MONTH_YEAR_RE.findall(explanation)
    ]
    if not cited_dates:
        return

    today = current_date or date.today()
    current_month = (today.year, today.month)
    if any(cited_date > current_month for cited_date in cited_dates):
        return

    independent_issues = (
        "out of order", "not in reverse chronological order", "missing date",
        "dates are missing", "cannot be determined", "unable to determine",
        "overlapping dates",
    )
    if any(issue in explanation_lower for issue in independent_issues):
        return

    chronology["passed"] = "true"
    chronology["explanation"] = (
        f"The cited experience dates are not in the future as of "
        f"{today.strftime('%B %Y')}."
    )


_ATS_SCORE_CACHE: OrderedDict[str, str] = OrderedDict()
_ATS_CACHE_MAX = 50

# Fixed seed so the same resume + job description scores the same number on
# every run and on every machine. A score that moves on its own is not a
# measurement, and this is a scoring product.
_ATS_SEED = 7


async def ats_scoring(resume_string, jd_string):
    """Gives ats score for the resume highlignting strengths and weaknesses"""
    current_date = date.today()
    _cache_key = hashlib.md5(
        (
            "ats-chronology-v3|" + current_date.isoformat() + "|" +
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
            model="gpt-4o-mini",
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
    _repair_false_future_chronology(parsed, current_date)

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
                model="gpt-4o-mini",
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
            model="gpt-4o-mini",
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
    model: str = "gpt-4o-mini",
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
