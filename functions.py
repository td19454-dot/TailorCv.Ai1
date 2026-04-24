
import os
from pathlib import Path
import pdfplumber
from dotenv import load_dotenv
from openai import AsyncOpenAI
import re
import json
import asyncio
import math
from collections import Counter
from tenacity import retry, stop_after_attempt, wait_exponential


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
                for key, url_pairs in project_link_map.items():
                    k = str(key or "").strip().lower()
                    if not k:
                        continue
                    if pname == k or pname in k or k in pname:
                        for label, url in url_pairs:
                            project.setdefault("links", []).append(
                                {"label": str(label or "Link").strip(), "url": url}
                            )
                        injected = True
                        break

            # If name-based injection didn't happen, do nothing (safer than wrong links).
            if not injected:
                # Only inject sequentially when no name-map is provided.
                if not isinstance(links, dict):
                    # Prefer label-specific mapped links (typically coming from "Live Demo ↗" style lines).
                    # (order-based fallback - used only when name-map isn't available)
                    if mapped_links:
                        label, url = mapped_links[0]
                        project.setdefault("links", []).append(
                            {"label": str(label or "Link").strip(), "url": url}
                        )
                        # Consume first mapping so next project doesn't get same link repeatedly
                        mapped_links = mapped_links[1:]

                    # If still empty and there are extracted URLs, use next one.
                    elif links:
                        # `links` might be a list[str] of URLs
                        if isinstance(links, list) and links:
                            url = links[0]
                            mapped_links = mapped_links
                            project.setdefault("links", []).append({"label": "Project Link", "url": url})
                            links = links[1:]

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


async def _build_openai_client():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add it to your .env file before using ATS analysis or resume optimization."
        )
    return AsyncOpenAI(
        api_key=api_key,
        timeout=120.0,
        max_retries=3
    )


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
Do not remove or rewrite those details unless the resume itself clearly contains an error.
For every section, prefer copying factual values from the original resume verbatim and only improve wording around them.

### OUTPUT RULES (MANDATORY)
- Output **ONLY valid JSON**
- No explanations, no markdown, no extra text

Guidelines to Follow:
1)Keyword and Skill Optimization:
Rule01:If a tool, framework or skill doesn't match the ones mentioned in the Job description but a similar skill is mentioned, replace the tool/skill/framework with that keyword to match the JD. For example, if Tableau is mentioned but the requirement asks for PowerBI, add PowerBI to skills. Be ethical, don't replace if it is not logical or closely related.

Analyze the job description and identify relevant keywords (hard and soft skills).
Match as much as possible of the job description’s keywords following the rule above to align with applicant tracking systems (ATS).
Prioritize industry-relevant hard skills and soft skills in dedicated sections and throughout bullet points.

Incorporate Measurable Metrics:
Quantify achievements using the XYZ formula if the user has put such quantifications but not formatted it if user has not put anything quantifyable don't do it: Accomplished X, measured by Y, by doing Z.

Include as many  measurable results as possible to clearly demonstrate impact.
Don't use vague statements; use metrics to highlight value and effectiveness.


Content Quality and Language:
Eliminate buzzwords, clichés, and pronouns (e.g., “I,” “me,” “my”).
Use action-oriented, impactful language to emphasize accomplishments over duties.
Replace generic phrases with specific examples that showcase expertise and success.
Focus on selling professional experience, skills, and results, not merely summarizing past roles.

Additional Instructions:
Keyword Optimize and be specific for each section (Professional Summary, Experience, Skills, Education) to reflect relevance to the job.
Ensure consistent formatting, professional fonts
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
async def get_resume_response(prompt: str, model: str = "gpt-4o-mini", temperature: float = 0.1) -> str:
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
            temperature=temperature
        )
        return response.choices[0].message.content
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


def compute_deterministic_ats_score_breakdown(resume_text: str, jd_text: str) -> dict[str, float]:
    resume_tokens = _tokenize_for_ats(resume_text)
    jd_tokens = _tokenize_for_ats(jd_text)
    vec_resume, vec_jd = _tfidf_vectors(resume_tokens, jd_tokens)
    keyword_score = max(0.0, min(1.0, _cosine_similarity(vec_resume, vec_jd)))

    # Semantic similarity uses the same deterministic TF-IDF family with bigram tokens.
    resume_bigrams = [f"{resume_tokens[i]}_{resume_tokens[i+1]}" for i in range(len(resume_tokens) - 1)]
    jd_bigrams = [f"{jd_tokens[i]}_{jd_tokens[i+1]}" for i in range(len(jd_tokens) - 1)]
    vec_resume_bg, vec_jd_bg = _tfidf_vectors(resume_bigrams, jd_bigrams)
    semantic_score = max(0.0, min(1.0, _cosine_similarity(vec_resume_bg, vec_jd_bg)))

    jd_skills = _extract_skill_candidates(jd_text)
    resume_skills = _extract_skill_candidates(resume_text)
    skill_score = (len(jd_skills.intersection(resume_skills)) / len(jd_skills)) if jd_skills else keyword_score
    skill_score = max(0.0, min(1.0, skill_score))

    required_years = _extract_years_of_experience(jd_text)
    resume_years = _extract_years_of_experience(resume_text)
    if required_years > 0:
        experience_score = max(0.0, min(1.0, resume_years / required_years))
    else:
        experience_score = 1.0 if resume_years > 0 else 0.5

    formatting_score = _formatting_structure_score(resume_text)
    formatting_component = (0.6 * formatting_score) + (0.4 * experience_score)

    final_score = (
        0.40 * keyword_score
        + 0.30 * skill_score
        + 0.20 * semantic_score
        + 0.10 * formatting_component
    ) * 100.0

    return {
        "final_score": round(max(0.0, min(100.0, final_score)), 2),
        "keyword_score": round(keyword_score, 4),
        "skill_score": round(skill_score, 4),
        "semantic_score": round(semantic_score, 4),
        "experience_score": round(experience_score, 4),
        "formatting_score": round(formatting_score, 4),
    }


def compute_deterministic_ats_score(resume_text: str, jd_text: str) -> float:
    breakdown = compute_deterministic_ats_score_breakdown(resume_text, jd_text)
    return round(float(breakdown["final_score"]), 2)

async def ats_scoring(resume_string, jd_string):
    """Gives ats score for the resume highlignting strengths and weaknesses"""
    deterministic_breakdown = compute_deterministic_ats_score_breakdown(resume_string, jd_string)
    deterministic_score = deterministic_breakdown["final_score"]

    base_prompt=f"""You are a professional Applicant Tracking System (ATS) resume scanner similar to Jobscan.
    Your task is to analyze a resume against a job description and generate a Jobscan-style Match Report.
    Output ONLY valid JSON. Do NOT wrap the JSON in quotes
    INPUTS 
    Resume:
    {_escape_braces(resume_string)}
    Job Description:
    {_escape_braces(jd_string)}
  
    ANALYSIS INSTRUCTIONS
    Evaluate the resume using ATS logic based on:
    - Searchability: 1)Contact information : is email present ,is phone number present, is name present
                     2)Professional summary: is it present, presents my abilities clearly and precisely, is it relevant to the job description
                     3)Section Headings: are Work Experience, Education, Skills, Projects present
                     4) Does Job title Match
                     5)Are the dates in chronological order
                     6) Are there any spelling mistakes in the resume
                     7) Does the resume have relevant links to all projects and achievements
    - Hard skills and Soft skills  match
    - cliches : Does the resume have generic cliche words with no measurable impact.
    - Experience relevance: does the candidate have the experience required in the JD
    - Formatting: 1) Is the resume free from any pictures, watermarks
                  2) Is the resume single column
                  3) Does the resume have too much color and design (too much means more than two)
                  4) Does the resume have unessacery sections like extracurriculars, hobbies, interests
    Be strict, realistic, and recruiter-focused.
    Do NOT assume or hallucinate skills or experience not explicitly stated.

    IMPORTANT:
    - Numeric ATS score is already computed deterministically server-side.
    - Do NOT recalculate score with AI.
    - Focus on qualitative analysis, strengths, gaps, and actionable recruiter tips.
    - Use this deterministic score exactly:
      deterministic_match_rate={deterministic_score}

    ### OUTPUT RULES (MANDATORY)
    - Output **ONLY valid JSON**
    - No explanations, no markdown, no extra text
    - JSON must strictly follow the schema below

    ### REQUIRED JOBSCAN-STYLE JSON FORMAT
    """
    json_schema='''{
    "match_rate": <integer 0-100>,
    "match_level": "<Poor | Fair | Good | Strong | Excellent>",

    "hard_skills": {
        "matched": ["<skill1>", "<skill2>"],
        "missing": ["<skill1>", "<skill2>"]
    },
    "soft_skills": {
        "matched": ["<skill1>", "<skill2>"],
        "missing": ["<skill1>", "<skill2>"]
    },
    "keywords": {
        "matched": ["<keyword1>", "<keyword2>"],
        "missing": ["<keyword1>", "<keyword2>"]
    },
    "tools_and_technologies": {
        "matched": ["<tool1>", "<tool2>"],
        "missing": ["<tool1>", "<tool2>"]
    },

    "experience": {
        "job_requirement": "<years or description from JD>",
        "resume_experience": "<summary of experience from resume>",
        "match_status": "<Low | Partial | Strong>",
        "relevance_score": <integer 0-100>,
        "notes": "<short explanation of how well the experience matches the JD>"
    },

    "job_title_match": {
        "job_title_in_jd": "<title from JD>",
        "resume_titles": ["<title1 from resume>", "<title2 from resume>"],
        "match_status": "<Low | Partial | Strong>"
    },

    "searchability": {
        "score": <integer 0-100>,
        "contact_information": {
        "has_name": <true | false>,
        "has_email": <true | false>,
        "has_phone": <true | false>
        },
        "professional_summary": {
        "is_present": <true | false>,
        "is_clear_and_concise": <true | false>,
        "is_relevant_to_jd": <true | false>
        },
        "section_headings": {
        "has_work_experience": <true | false>,
        "has_education": <true | false>,
        "has_skills": <true | false>,
        "has_projects": <true | false>,
        "missing_sections": ["<missing_section1>", "<missing_section2>"]
        },
        "chronology": {
        "is_chronological": <true | false>,
        "issues": ["<issue about date ordering, if any>"]
        },
        "spelling_grammar": {
        "has_spelling_or_grammar_errors": <true | false>,
        "examples": ["<example error 1>", "<example error 2>"]
        },
        "links": {
        "has_relevant_links": <true | false>,
        "missing_recommended_links": ["<missing_link_description1>", "<missing_link_description2>"]
        },
        "issues": [
        "<high-level searchability issue 1>",
        "<high-level searchability issue 2>"
        ]
    },

    "cliches": {
        "has_cliches": <true | false>,
        "examples": ["<cliche phrase 1>", "<cliche phrase 2>"]
    },

    "formatting": {
        "is_photo_free": <true | false>,
        "is_single_column": <true | false>,
        "has_minimal_color_and_design": <true | false>,  // false if more than two strong colors/design elements
        "unnecessary_sections_present": <true | false>,
        "unnecessary_sections": ["<section name 1>", "<section name 2>"]
    },

    "recruiter_tips": [
        "<actionable improvement 1 based on above analysis>",
        "<actionable improvement 2>",
        "<actionable improvement 3>"
    ]} '''
    prompt = base_prompt + "\n" + json_schema
    model="gpt-4o-mini"
    temperature=0.1
    client = await _build_openai_client()

    #Make call
    try:
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {'role': 'system', "content": 'Applicant Tracking System (ATS) resume scanner similar to Jobscan'},
                {'role': 'user', 'content': prompt}
            ],
            temperature=temperature
        )
    except Exception as exc:
        raise _normalize_openai_error(exc) from exc

    content = response.choices[0].message.content
    try:
        parsed = json.loads(content)
    except Exception:
        match = re.search(r"\{[\s\S]*\}\s*$", content)
        parsed = json.loads(match.group(0)) if match else {}

    if not isinstance(parsed, dict):
        parsed = {}

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

    return json.dumps(parsed)

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
