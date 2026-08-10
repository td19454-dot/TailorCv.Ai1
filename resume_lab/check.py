"""Run every resume in this folder through the failure modes we keep hitting.

Drop PDFs into resume_lab/ and run:

    python resume_lab/check.py

No API keys and no network - this exercises the deterministic half of the
optimizer, which is where every bug in this area has actually lived:

  LINKS      Each project's clickable links must land on THAT project. Links have
             gone missing, and worse, landed on a neighbour or on a certification.
  TITLES     Link attribution keys on locating each project's title in the PDF. A
             title that cannot be located is the root cause of misplaced links.
  BLEED      One entry must not absorb the next entry's bullets. Templates that
             wrap a title across lines used to make the first project swallow
             everything after it.
  JUNK       Restoring a dropped entry must not invent one from a stack row
             ("Python, PowerBI, SQL, Excel") or a link caption row.
  SECTIONS   The Skills block must not be tagged as Experience - decorated
             headings like "Technical Skills and Interests" once broke this and
             the whole skills list was restored as bullets on the last job.

Real resumes are personal data, so this folder is gitignored.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import warnings
from pathlib import Path

logging.disable(logging.CRITICAL)
warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

_stderr = sys.stderr
sys.stderr = open(os.devnull, "w")  # noqa: SIM115 - silence pdf library chatter
import main  # noqa: E402
from pypdf import PdfReader  # noqa: E402
sys.stderr = _stderr

CONTACT_PREFIXES = (
    "mailto:", "tel:", "linkedin.com/in/", "twitter.com", "x.com/",
    "facebook.com", "instagram.com",
)


def quiet(fn, *a, **kw):
    """Run something noisy without its stderr."""
    saved, sys.stderr = sys.stderr, open(os.devnull, "w")  # noqa: SIM115
    try:
        return fn(*a, **kw)
    finally:
        sys.stderr.close()
        sys.stderr = saved


def project_titles_from_text(text: str) -> list[str]:
    """Best-effort read of the project names in the source, for testing without
    calling the AI. Mirrors what the model is asked to return."""
    # Reuse the production tagger rather than a second, weaker heading regex -
    # it already copes with "Pro jects" (kerning artefacts) and decorated
    # headings like "Technical Skills and Interests".
    block_lines = [ln for ln, sec in main._restore_section_lines(text) if sec == "projects"]
    if not block_lines:
        return []

    titles: list[str] = []
    for raw in block_lines:
        line = raw.strip()
        if not line or re.match(r"^[•‣▪◦●·*\-–—]", line) or len(line) > 90:
            continue
        # Deliberately NOT filtered by _restore_is_meta_line: that spots entry
        # HEADER rows, and a title row carrying a date is exactly one.
        if main._RESTORE_LINK_LABEL_ROW_RE.fullmatch(line):
            continue
        # Split the stack/date off FIRST, then judge. A real title row reads
        # "Tailorcv.com - html,css,javascript,FastApi Feb 2026", and testing the
        # whole line sees those commas and calls it a technology row.
        title = re.split(r"\s+[|/·—–-]\s+", line)[0].strip()
        title = main._RESTORE_TRAILING_DATE_RE.sub("", title).strip(" ,;|-–—")
        if main._looks_like_stack_line(title):
            continue
        if 3 <= len(title) <= 60 and not title.endswith((".", ":", ",")):
            titles.append(title)
    # De-duplicate, keep order.
    seen, out = set(), []
    for t in titles:
        k = main._normalize_key(t)
        if k and k not in seen:
            seen.add(k)
            out.append(t)
    return out[:8]


def project_section_links(path: Path) -> list[str]:
    """Clickable URLs that physically sit inside the Projects section."""
    headings = quiet(main._detect_section_headings, str(path))
    if not any(h[2] == "projects" for h in headings):
        return []
    reader = PdfReader(str(path))
    found: list[str] = []
    for page_idx, page in enumerate(reader.pages):
        try:
            height = float(page.mediabox.height)
        except Exception:
            continue
        for ref in (page.get("/Annots") or []):
            try:
                obj = ref.get_object()
            except Exception:
                continue
            uri = (obj.get("/A") or {}).get("/URI")
            rect = obj.get("/Rect")
            if not uri or not rect or len(rect) < 4:
                continue
            uri = str(uri)
            if any(b in uri.lower() for b in CONTACT_PREFIXES):
                continue
            try:
                top = height - float(rect[3])
                x0 = float(rect[0])
            except Exception:
                continue
            if main._section_of(headings, page_idx, top, x0) == "projects":
                found.append(uri)
    return found


def check(path: Path) -> list[str]:
    """Return a list of problems. Empty means clean."""
    problems: list[str] = []
    text = quiet(main.extract_pdf_text, str(path))
    if not text.strip():
        return ["no text layer (scanned image?)"]

    titles = project_titles_from_text(text)
    if not titles:
        return ["no Projects section detected"]

    # --- LINKS + TITLES -----------------------------------------------------
    mapping = quiet(main.extract_project_links_from_pdf, str(path), titles)
    located = {n for _p, _t, n in main._LAST_PROJECT_TITLE_POSITIONS}
    missing_titles = [t for t in titles if t not in located]
    if missing_titles:
        problems.append(f"title not located: {missing_titles}")

    # Count DISTINCT destinations. A wrapped anchor emits one annotation per line
    # it spans, so the raw count triples for no reason and every such resume
    # looked like it was losing links.
    section_links = {main._link_identity(u) for u in project_section_links(path)}
    section_links.discard("")
    attributed = {
        main._link_identity(u)
        for pairs in mapping.values() for _label, u in pairs
    }
    attributed.discard("")
    lost = section_links - attributed
    if lost:
        problems.append(
            f"links lost: {len(section_links)} in Projects, "
            f"{len(attributed)} attributed, missing {sorted(lost)[:3]}"
        )

    # Every link on ONE project, when the destinations are clearly different
    # repos or sites, means the other titles were never found - attribution then
    # looks complete while actually being wrong. Without this the check reported
    # a clean pass on a resume where one project had swallowed all five links.
    owners_with_links = [n for n, pairs in mapping.items() if pairs]
    if len(owners_with_links) == 1 and len(attributed) >= 3 and len(titles) > 1:
        problems.append(
            f"all {len(attributed)} links landed on one project "
            f"({owners_with_links[0]!r}) - other titles likely not found"
        )

    # A URL must never sit on two projects.
    seen_owner: dict[str, str] = {}
    for owner, pairs in mapping.items():
        for _label, uri in pairs:
            key = main._link_identity(uri)
            if key in seen_owner and seen_owner[key] != owner:
                problems.append(f"link on two projects: {uri}")
            seen_owner[key] = owner

    # --- BLEED --------------------------------------------------------------
    parsed = {"projects": [{"name": t, "bullets": []} for t in titles]}
    restored = quiet(main.restore_dropped_bullets, parsed, text)
    for i, entry in enumerate(restored.get("projects") or []):
        joined = " ".join(entry.get("bullets") or []).lower()
        for j, other in enumerate(titles):
            if i == j:
                continue
            lead = main._first_significant_token(other)
            if lead and len(lead) > 4 and lead in joined:
                problems.append(
                    f"bleed: {entry.get('name')!r} contains {other!r} content"
                )
                break

    # --- JUNK ---------------------------------------------------------------
    before = {main._normalize_key(t) for t in titles}
    after = quiet(main.restore_dropped_entries, {"projects": [
        {"name": t, "bullets": ["placeholder bullet text for this project entry"]}
        for t in titles
    ]}, text)
    invented = [
        p.get("name") for p in (after.get("projects") or [])
        if main._normalize_key(str(p.get("name"))) not in before
    ]
    if invented:
        problems.append(f"invented project(s): {invented}")

    # --- SECTIONS -----------------------------------------------------------
    tagged = main._restore_section_lines(text)
    skills_as_experience = [
        ln for ln, sec in tagged
        if sec == "experience" and re.match(
            r"^\s*(languages|frameworks?/?libraries|databases|tools\s*&|cloud\s*&|"
            r"methodologies|ai/ml)\s*:", ln, re.I)
    ]
    if skills_as_experience:
        problems.append(
            f"skills tagged as experience ({len(skills_as_experience)} rows)"
        )

    return problems


def check_live(path: Path, jd: str) -> list[str]:
    """Run the REAL optimizer against a job description and audit the result.

    The offline check isolates link handling; this one adds what only a real run
    exercises - the model renaming a project, dropping one, or writing a link
    caption into a field - and confirms the links survive all of it into the
    rendered HTML. Costs two API calls per resume.
    """
    import asyncio

    problems: list[str] = []
    text = quiet(main.extract_pdf_text, str(path))
    expected = project_section_links(path)

    parsed = quiet(lambda: asyncio.run(main._optimize_resume_core(str(path), jd)))
    projects = [p for p in (parsed.get("projects") or []) if isinstance(p, dict)]
    if not projects:
        return ["optimizer returned no projects"]

    source_titles = project_titles_from_text(text)
    if source_titles and len(projects) < len(source_titles):
        problems.append(
            f"project dropped: source has {len(source_titles)}, output has {len(projects)}"
        )

    placed = {
        main._link_identity(l.get("url") or l.get("href") or "")
        for p in projects for l in (p.get("links") or [])
    }
    placed.discard("")
    lost = [u for u in expected if main._link_identity(u) not in placed]
    if lost:
        problems.append(f"{len(lost)} of {len(expected)} link(s) missing after optimize: {lost[:3]}")

    # And they must survive rendering, not just live in the JSON.
    html, _ = quiet(main._render_resume_html, parsed, jd, 1, 1)
    not_rendered = [u for u in expected if u not in html and u.rstrip("/") not in html]
    if not_rendered:
        problems.append(f"{len(not_rendered)} link(s) not in rendered HTML")

    # A project must not carry another project's link.
    seen: dict[str, str] = {}
    for p in projects:
        for l in (p.get("links") or []):
            key = main._link_identity(l.get("url") or l.get("href") or "")
            if key and key in seen and seen[key] != p.get("name"):
                problems.append(f"link on two projects: {key}")
            if key:
                seen[key] = p.get("name")
    return problems


def main_runner() -> int:
    live = "--live" in sys.argv
    jd_arg = next((a for a in sys.argv[1:] if a.endswith((".txt", ".md"))), None)

    pdfs = sorted(p for p in ROOT.glob("*.pdf"))
    if not pdfs:
        print(f"No PDFs found in {ROOT}. Drop resumes there and run again.")
        return 0

    jd = ""
    if live:
        jd_path = Path(jd_arg) if jd_arg else (ROOT / "jd.txt")
        if not jd_path.exists():
            print(f"--live needs a job description. Put one at {ROOT / 'jd.txt'} "
                  f"or pass a path.")
            return 1
        jd = jd_path.read_text(encoding="utf-8")

    mode = "LIVE (real optimizer, 2 API calls each)" if live else "offline (no API calls)"
    print(f"Checking {len(pdfs)} resume(s) - {mode}\n")

    clean = 0
    for pdf in pdfs:
        try:
            problems = check_live(pdf, jd) if live else check(pdf)
        except Exception as exc:  # noqa: BLE001
            problems = [f"crashed: {type(exc).__name__}: {exc}"]
        if problems:
            print(f"  FAIL  {pdf.name}")
            for p in problems:
                print(f"          - {p}")
        else:
            clean += 1
            print(f"  PASS  {pdf.name}")
    print(f"\n{clean}/{len(pdfs)} clean")
    return 1 if clean != len(pdfs) else 0


if __name__ == "__main__":
    sys.exit(main_runner())
