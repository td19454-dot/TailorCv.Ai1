"""Regression tests for per-project link recovery from PDF annotations.

A PDF stores a link as a rectangle and a URL - nothing in it says which project
the link belongs to. Working that out is our job, and it used to be done purely
by looking for a project NAME in the text near the link. When a resume put its
links somewhere that lookup could not read - most commonly on their own row
underneath the title:

    Tailorcv.com - html,css,javascript,FastApi        Feb 2026
    Live Demo | GitHub          <- the annotations live on THIS line

...the match failed and the link was silently discarded. A real resume lost the
links for two of its three projects that way, while its certification links (a
path that already had a positional fallback) came through fine.

These tests render fixture PDFs covering the layouts we know users produce and
assert every link lands on its own project. Resumes arrive in any shape; coping
with that is the product's job, so each layout is treated as a supported case.

Needs WeasyPrint (already a dependency) but no network and no API keys.
Run:  python test_project_links.py
"""

import os
import sys
import tempfile
import traceback

import main

extract = main.extract_project_links_from_pdf

TAILORCV = ("Tailorcv.com", "html,css,javascript,FastApi", "Feb 2026", [
    ("Live Demo", "https://www.thetailorcv.com"),
    ("GitHub", "https://github.com/td19454-dot/TailorCv.Ai1"),
])
MYNTRA = ("Myntra E-commerce Website Clone", "html,css,javascript", "mar 2025", [
    ("Live Demo", "https://myntraaclone.onrender.com/"),
    ("GitHub", "https://github.com/td19454-dot/myntraaclone"),
])
CUSTOMER = ("Customer Behaviour Analytics", "Python, PowerBI, SQL, Excel", "January 2026", [
    ("GitHub", "https://github.com/td19454-dot/customer_behavior"),
])
PROJECTS = [TAILORCV, MYNTRA, CUSTOMER]

_CSS = """body{font-family:serif;font-size:9pt;margin:30px}
.d{float:right;font-style:italic}.lk{color:#1a4d8f;font-weight:bold}
ul{margin:2px 0 8px 14px}h2{font-size:11pt;border-bottom:1px solid #888;margin:10px 0 4px}"""


def _render(body_html: str) -> str:
    """Render a fixture resume to a temp PDF and return its path."""
    from weasyprint import HTML
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    HTML(string=f"<html><head><style>{_CSS}</style></head><body>"
                f"<h2>Experience</h2><div><b>Berger Paints</b> - <i>Trainee</i></div>"
                f"<ul><li>Studied the paint manufacturing process.</li></ul>"
                f"<h2>Projects</h2>{body_html}"
                f"<h2>Education</h2><div>Jadavpur University</div></body></html>").write_pdf(path)
    return path


def _links_html(links):
    return " | ".join(f'<a href="{u}">{l}</a>' for l, u in links)


def build_links_on_own_row() -> str:
    """Trisha's layout: links on a dedicated row beneath the title. This is the
    one that regressed - the row carries no project name at all."""
    out = []
    for title, sub, date, links in PROJECTS:
        out.append(
            f'<div><b>{title}</b> &mdash; <i>{sub}</i><span class="d">{date}</span></div>'
            f'<div class="lk">{_links_html(links)}</div>'
            f'<ul><li>Did the work for {title}.</li></ul>'
        )
    return "".join(out)


def build_links_inline_in_bullet() -> str:
    """Shubham's layout: link anchored at the end of a bullet. Must not regress."""
    out = []
    for title, sub, date, links in PROJECTS:
        out.append(
            f'<div><b>{title}</b> | <i>{sub}</i><span class="d">{date}</span></div>'
            f'<ul><li>Did the work for {title}. {_links_html(links)}</li></ul>'
        )
    return "".join(out)


def build_links_beside_title() -> str:
    """Links on the same row as the title."""
    out = []
    for title, sub, date, links in PROJECTS:
        out.append(
            f'<div><b>{title}</b> &mdash; <i>{sub}</i> {_links_html(links)}'
            f'<span class="d">{date}</span></div>'
            f'<ul><li>Did the work for {title}.</li></ul>'
        )
    return "".join(out)


LAYOUTS = {
    "links on their own row (regressed layout)": build_links_on_own_row,
    "links inline in a bullet": build_links_inline_in_bullet,
    "links beside the title": build_links_beside_title,
}


def _assert_correctly_split(mapping, label):
    """Every project keeps its own links, and nobody holds someone else's."""
    for title, _sub, _date, links in PROJECTS:
        got = {u for _l, u in mapping.get(title, [])}
        want = {u for _l, u in links}
        assert got == want, (
            f"[{label}] {title}: expected {sorted(want)}, got {sorted(got)}"
        )


# --------------------------------------------------------------------------- #
# Every layout must attribute every link
# --------------------------------------------------------------------------- #
def test_every_layout_keeps_links_on_their_own_project():
    names = [p[0] for p in PROJECTS]
    for label, builder in LAYOUTS.items():
        path = _render(builder())
        try:
            _assert_correctly_split(extract(path, names), label)
        finally:
            os.remove(path)


def test_no_link_is_silently_dropped():
    total = sum(len(p[3]) for p in PROJECTS)
    names = [p[0] for p in PROJECTS]
    for label, builder in LAYOUTS.items():
        path = _render(builder())
        try:
            mapping = extract(path, names)
            found = sum(len(v) for v in mapping.values())
            assert found == total, f"[{label}] recovered {found}/{total} links"
        finally:
            os.remove(path)


# --------------------------------------------------------------------------- #
# Renamed projects (regression for the earlier name-matching fix)
# --------------------------------------------------------------------------- #
def test_renamed_projects_keep_their_own_links():
    """Tailoring rewrites project titles. A rename used to send every link to
    whichever project still matched, so one project got none and another got
    all of them."""
    renames = [
        "Tailorcv.com — AI Resume Optimization Platform",
        "Myntra E-commerce Clone",
        "Customer Behaviour Analytics Dashboard",
    ]
    path = _render(build_links_on_own_row())
    try:
        mapping = extract(path, renames)
        for new_name, (_t, _s, _d, links) in zip(renames, PROJECTS):
            got = {u for _l, u in mapping.get(new_name, [])}
            want = {u for _l, u in links}
            assert got == want, f"{new_name}: expected {sorted(want)}, got {sorted(got)}"
    finally:
        os.remove(path)


# --------------------------------------------------------------------------- #
# Guardrails: recovering more links must not start inventing them
# --------------------------------------------------------------------------- #
def test_contact_links_never_become_project_links():
    """Contact details sit above the first heading; they belong to nobody."""
    body = ('<div><b>Tailorcv.com</b></div>'
            '<div class="lk"><a href="https://github.com/td19454-dot/TailorCv.Ai1">GitHub</a></div>'
            '<ul><li>Built it.</li></ul>')
    from weasyprint import HTML
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    HTML(string=f"<html><head><style>{_CSS}</style></head><body>"
                f'<div><a href="mailto:td19454@gmail.com">td19454@gmail.com</a> | '
                f'<a href="https://linkedin.com/in/trisha-debnath-159008317">LinkedIn</a> | '
                f'<a href="https://github.com/td19454-dot">github.com/td19454-dot</a></div>'
                f"<h2>Projects</h2>{body}"
                f"<h2>Education</h2><div>Jadavpur University</div></body></html>").write_pdf(path)
    try:
        got = {u for pairs in extract(path, ["Tailorcv.com"]).values() for _l, u in pairs}
        assert got == {"https://github.com/td19454-dot/TailorCv.Ai1"}, got
    finally:
        os.remove(path)


def test_a_url_is_never_attached_to_two_projects():
    names = [p[0] for p in PROJECTS]
    path = _render(build_links_on_own_row())
    try:
        seen = {}
        for project, pairs in extract(path, names).items():
            for _label, uri in pairs:
                assert uri not in seen, f"{uri} on both {seen[uri]} and {project}"
                seen[uri] = project
    finally:
        os.remove(path)


def test_no_projects_means_no_links():
    path = _render(build_links_on_own_row())
    try:
        assert extract(path, []) == {}
    finally:
        os.remove(path)


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
