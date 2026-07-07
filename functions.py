
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


def normalize_links(text):
    return re.sub(
        r'(?<!https://)(?<!http://)(\b[a-zA-Z0-9.-]+\.(com|in|org|io|dev|ai|net)\b)',
        r'https://\1',
        text
    )


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

    start_idx = None
    for i, line in enumerate(lowered):
        if any(marker in line for marker in start_markers):
            start_idx = i
            break
    if start_idx is None:
        return ""

    stop_idx = len(lines)
    for j in range(start_idx + 1, len(lines)):
        line = lowered[j]
        if any(marker in line for marker in stop_markers):
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
        # Examples: "TailorCV.ai | HTML, CSS" -> TailorCV.ai
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
Rule01: MANDATORY SKILLS INJECTION — The `skills` array in the output JSON MUST contain EVERY hard skill (programming languages, frameworks, tools, technologies, platforms, libraries, databases) that is explicitly mentioned in the job description. Do NOT skip any. Even if the candidate does not have a skill, it must still appear in the `skills` array for ATS keyword matching purposes. If a related skill already exists, keep it AND also add the exact JD keyword. Do not fabricate experience, expertise, or accomplishments.

Rule01b: SKILLS ARRAY FORMAT — Every entry in `skills` MUST be a short, concrete, named technology (e.g. "Python", "React", "PostgreSQL", "Docker", "REST APIs") — a proper noun or standard industry term, 1-3 words. NEVER put soft skills, narrative phrases, or generic descriptions in `skills` (e.g. do NOT add things like "cross-functional collaboration", "commercial analytics applications", "marketing performance measurement", "technical report writing"). NEVER extract sentence fragments about the ROLE or COMPANY as skills — e.g. do NOT add "senior IC role", "high-growth startup", "one or more languages", "5+ years experience". If the job description says something like "proficiency in one or more of Python, Java, or C++ for a senior IC role at a high-growth startup", extract ONLY the actual technology names ("Python", "Java", "C++") and discard the surrounding sentence entirely. If the job description mentions a soft skill (communication, leadership, collaboration, stakeholder management, etc.), weave it naturally into the `summary` or experience/project `bullets` instead — never as a standalone `skills` entry.

Analyze the job description and identify relevant hard-skill keywords.
Match as much as possible of the job description's hard-skill keywords following the rules above to align with applicant tracking systems (ATS).
Prioritize industry-relevant hard skills in the dedicated Skills section, and weave soft skills into bullet points and the summary instead.

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
    r'technologies?|guidelines?|principles?|practices?|methodologies?)$',
    re.IGNORECASE,
)
_GENERIC_SKILL_PROSE_RE = re.compile(
    r'^(?:ability\s+to|working\s+with|hands-on\s+experience|understanding\s+of)\b|'
    r'^(?:an?\s+)?related\s+(?:fields?|roles?|disciplines?|areas?)$|'
    r'\b(?:for\s+(?:mobile|data\s+analysis)|related\s+fields?)$',
    re.IGNORECASE,
)


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
    if len(re.findall(r"[A-Za-z0-9+#.]+", skill)) > 4:
        return False
    if re.search(r"\bwith\s+(?:an?\s+)?(?:ml|machine learning)\s+focus\b", normalized):
        return False
    if _GENERIC_SKILL_PROSE_RE.search(normalized):
        return False
    if _GENERIC_SKILL_ENDING_RE.search(normalized):
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
        if t_lower in resume_lower:
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


def inject_jd_hard_skills(data: dict, jd_string: str) -> dict:
    """
    Post-process: ensure every hard skill from the JD appears in the resume's skills array.
    Adds missing skills without touching existing ones.
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

    for skill in _extract_hard_skills_from_jd(jd_string):
        key = skill.lower()
        if key not in seen_lower:
            seen_lower.add(key)
            cleaned_skills.append(skill)

    data["skills"] = cleaned_skills

    return data


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

Fail otherwise.

Explain exactly which requirement is missing.

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


async def ats_scoring(resume_string, jd_string):
    """Gives ats score for the resume highlignting strengths and weaknesses"""
    current_date = date.today()
    _cache_key = hashlib.md5(
        (
            "ats-chronology-v2|" + current_date.isoformat() + "|" +
            str(resume_string) + str(jd_string)
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
            max_tokens=1500,
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

Fail otherwise.

Explain exactly which requirement is missing.

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

    # Sanitize hard_missing: decompose any LLM phrase entries into atomic keywords
    # and re-route them correctly between matched/missing.
    if hard_missing:
        _sanitized_missing, _newly_matched = _sanitize_hard_skill_list(
            hard_missing,
            resume_text=resume_string,
            jd_text=jd_string,
        )
        _hs = parsed.setdefault("skills", {}).setdefault("hard_skills", {})
        _hs["missing"] = _sanitized_missing
        _hs["matched"] = list(hard_matched) + _newly_matched
        hard_missing = _sanitized_missing
        hard_matched = _hs["matched"]

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
