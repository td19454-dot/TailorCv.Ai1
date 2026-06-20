"""Regression tests for Portfolio Studio data mapping.

Covers the pure, deterministic helpers that turn a parsed resume (in either the
editor `cvData` shape or the extraction `candidate_data` shape) into the
portfolio render dict. No external services and no API keys required.

Run:  python test_portfolio.py
"""

import sys
import traceback

import main


def check(name, cond):
    if cond:
        print(f"  PASS  {name}")
        return True
    print(f"  FAIL  {name}")
    return False


def test_slugify():
    ok = True
    ok &= check("basic name -> kebab", main._portfolio_slugify("Emilian Leaman") == "emilian-leaman")
    ok &= check("strips punctuation", main._portfolio_slugify("J. Doe, Jr.!") == "j-doe-jr")
    ok &= check("empty -> portfolio", main._portfolio_slugify("") == "portfolio")
    ok &= check("symbols-only -> portfolio", main._portfolio_slugify("@#$%") == "portfolio")
    ok &= check("no leading/trailing hyphen", not main._portfolio_slugify("  hi  ").startswith("-"))
    return ok


def test_initials():
    ok = True
    ok &= check("two names", main._portfolio_initials("Emilian Leaman") == "EL")
    ok &= check("single name", main._portfolio_initials("Shubham") == "SH")
    ok &= check("three names use first+last", main._portfolio_initials("A B Carter") == "AC")
    ok &= check("empty -> ?", main._portfolio_initials("") == "?")
    return ok


def test_strip_bullets():
    ok = True
    blob = "• Built X\n• Shipped Y\n\n- Led Z"
    out = main._portfolio_strip_bullets(blob)
    ok &= check("splits + strips bullet glyphs", out == ["Built X", "Shipped Y", "Led Z"])
    ok &= check("accepts a list", main._portfolio_strip_bullets(["a", "", "  b "]) == ["a", "b"])
    ok &= check("empty -> []", main._portfolio_strip_bullets("") == [])
    return ok


def test_skill_groups():
    ok = True
    # candidate_data dict shape -> grouped
    g = main._portfolio_skill_groups({"programming": ["Python", "C"], "empty": []})
    ok &= check("dict shape groups & titleizes", g == [{"group": "Programming", "items": ["Python", "C"]}])
    # editor list of dicts
    g2 = main._portfolio_skill_groups([{"name": "Python"}, {"name": "SQL"}])
    ok &= check("list[dict] -> single flat group", g2 == [{"group": "", "items": ["Python", "SQL"]}])
    # list of strings
    g3 = main._portfolio_skill_groups(["Docker", "AWS"])
    ok &= check("list[str] -> single flat group", g3 == [{"group": "", "items": ["Docker", "AWS"]}])
    ok &= check("None -> []", main._portfolio_skill_groups(None) == [])
    return ok


def test_build_editor_shape():
    """The editor cvData shape (personalInfo / experience.details / projects)."""
    cv = {
        "personalInfo": {
            "name": "Emilian Leaman", "headline": "Frontend Developer",
            "summary": "I build delightful UIs.", "email": "e@x.com",
            "linkedin": "https://linkedin.com/in/e", "github": "https://github.com/e",
        },
        "experience": [
            {"title": "Dev", "company": "Acme", "dates": "2023-2025",
             "location": "Remote", "details": "• Shipped the dashboard\n• Cut load time 40%"},
        ],
        "projects": [
            {"name": "Portfolio Maker", "subtitle": "FastAPI", "github_link": "https://github.com/e/p",
             "details": "• One-click sites"},
        ],
        "education": [{"school": "JU", "degree": "B.Tech", "year": "2023-2027", "score": "9.1"}],
        "skills": [{"name": "JS"}, {"name": "CSS"}],
    }
    d = main._build_portfolio_data(cv)
    ok = True
    ok &= check("name", d["name"] == "Emilian Leaman")
    ok &= check("headline", d["headline"] == "Frontend Developer")
    ok &= check("initials", d["initials"] == "EL")
    ok &= check("email", d["email"] == "e@x.com")
    ok &= check("socials linkedin+github", {s["label"] for s in d["socials"]} == {"LinkedIn", "GitHub"})
    ok &= check("experience bullets parsed", d["experience"][0]["bullets"] == ["Shipped the dashboard", "Cut load time 40%"])
    ok &= check("project github mapped", d["projects"][0]["github"] == "https://github.com/e/p")
    ok &= check("education school", d["education"][0]["school"] == "JU")
    ok &= check("skills flattened", d["skills"][0]["items"] == ["JS", "CSS"])
    ok &= check("stats", d["stats"] == {"experience": 1, "projects": 1, "skills": 2})
    return ok


def test_build_candidate_shape():
    """The extraction candidate_data shape (name / work_experience / responsibilities)."""
    cd = {
        "name": "Shubham Sarkar",
        "contact_information": {"email": "s@x.com", "github": "https://github.com/s",
                                "linkedin": "https://linkedin.com/in/s"},
        "work_experience": [
            {"title": "ML Engineer", "company": "Alignerr",
             "responsibilities": ["Improved accuracy 15%", "Transcribed 50+ files"]},
        ],
        "projects": [{"name": "RAG System", "description": ["Built a pipeline"], "achievements": ["Evaluated outputs"]}],
        "education": [{"degree": "B.Tech", "institution": "Jadavpur University", "years": "2023-2027"}],
        "skills": {"programming": ["Python", "C"], "frameworks_libraries": ["PyTorch"]},
    }
    d = main._build_portfolio_data(cd)
    ok = True
    ok &= check("name from top-level", d["name"] == "Shubham Sarkar")
    ok &= check("work_experience mapped", d["experience"][0]["title"] == "ML Engineer")
    ok &= check("responsibilities -> bullets", d["experience"][0]["bullets"] == ["Improved accuracy 15%", "Transcribed 50+ files"])
    ok &= check("institution -> school", d["education"][0]["school"] == "Jadavpur University")
    ok &= check("grouped skills preserved", len(d["skills"]) == 2)
    ok &= check("socials from contact_information", {s["label"] for s in d["socials"]} == {"GitHub", "LinkedIn"})
    return ok


def test_photo_validator():
    ok = True
    good_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    ok &= check("valid png data url", main._valid_portfolio_photo(good_png))
    ok &= check("valid jpeg data url", main._valid_portfolio_photo("data:image/jpeg;base64,/9j/4AAQSkZJRg=="))
    ok &= check("rejects non-image data url", not main._valid_portfolio_photo("data:text/html;base64,PHA+"))
    ok &= check("rejects plain url", not main._valid_portfolio_photo("https://example.com/me.png"))
    ok &= check("rejects None", not main._valid_portfolio_photo(None))
    ok &= check("rejects empty", not main._valid_portfolio_photo(""))
    oversized = "data:image/png;base64," + ("A" * (main.MAX_PORTFOLIO_PHOTO_CHARS + 10))
    ok &= check("rejects oversized", not main._valid_portfolio_photo(oversized))
    return ok


def test_handle_helpers():
    ok = True
    ok &= check("name -> handle", main._portfolio_handleify("Trisha Debnath") == "trisha-debnath")
    ok &= check("strips & collapses", main._portfolio_handleify("  A!!  B @@ C ") == "a-b-c")
    ok &= check("too short -> ''", main._portfolio_handleify("Jo") == "")
    ok &= check("trims edge hyphens", not main._portfolio_handleify("--hello--").startswith("-"))
    ok &= check("caps length at 40", len(main._portfolio_handleify("x" * 80)) <= 40)
    ok &= check("www is reserved", "www" in main.RESERVED_HANDLES)
    return ok


def test_share_url():
    ok = True
    class P:
        handle = "trisha"; slug = "trisha-ab12"
    prev = main.PORTFOLIO_SUBDOMAINS_ENABLED
    try:
        main.PORTFOLIO_SUBDOMAINS_ENABLED = False
        ok &= check("disabled -> /p/<slug>", main._portfolio_share_url(P()).endswith("/p/trisha-ab12"))
        main.PORTFOLIO_SUBDOMAINS_ENABLED = True
        ok &= check("enabled -> subdomain", main._portfolio_share_url(P()) == "https://trisha." + main.PORTFOLIO_DOMAIN)
        class NoHandle:
            handle = None; slug = "x-1"
        ok &= check("no handle -> /p/<slug> even when enabled", main._portfolio_share_url(NoHandle()).endswith("/p/x-1"))
    finally:
        main.PORTFOLIO_SUBDOMAINS_ENABLED = prev
    return ok


def test_social_links_absolute():
    """Socials & project links must come out as absolute https URLs, not relative."""
    cv = {
        "personalInfo": {
            "name": "Linky McLink",
            "linkedin": "linkedin.com/in/linky",      # no scheme
            "github": "github.com/linky",             # no scheme
        },
        "projects": [{"name": "P", "url": "myproj.dev", "github_link": "github.com/linky/p"}],
    }
    d = main._build_portfolio_data(cv)
    by = {s["label"]: s["url"] for s in d["socials"]}
    ok = True
    ok &= check("linkedin absolute", by.get("LinkedIn", "").startswith("https://linkedin.com/in/linky"))
    ok &= check("github absolute", by.get("GitHub", "").startswith("https://github.com/linky"))
    ok &= check("no relative social url", all(u.startswith("http") for u in by.values()))
    ok &= check("project url absolute", d["projects"][0]["url"].startswith("https://"))
    ok &= check("project github absolute", d["projects"][0]["github"].startswith("https://github.com/linky/p"))
    return ok


def test_new_sections():
    """Extracurriculars, publications, hobbies, and all socials flow through."""
    cv = {
        "personalInfo": {
            "name": "Multi Section",
            "leetcode": "leetcode.com/u/multi",
            "googleScholar": "scholar.google.com/citations?user=abc",
            "twitter": "twitter.com/multi",
        },
        "extracurriculars": [
            {"role": "Coordinator", "organization": "Finance Club", "dates": "2024-2025",
             "url": "club.org", "details": "Ran E-Summit\nLed 5 events"},
        ],
        "publications": [
            {"title": "On RAG", "publisher": "arXiv", "year": "2025", "url": "arxiv.org/abs/1234"},
        ],
        "certifications": [
            {"name": "MERN course", "issuer": "Apna College", "year": "2024", "url": "example.com/cert"},
        ],
        "hobbies": "Chess, Photography\nOpen-source",
    }
    d = main._build_portfolio_data(cv)
    by = {s["label"]: s["url"] for s in d["socials"]}
    ok = True
    ok &= check("leetcode social absolute", by.get("LeetCode", "").startswith("https://leetcode.com/"))
    ok &= check("scholar social absolute", by.get("Scholar", "").startswith("https://scholar.google.com/"))
    ok &= check("twitter social absolute", by.get("Twitter", "").startswith("https://twitter.com/"))
    ok &= check("extracurricular mapped", d["extracurriculars"][0]["role"] == "Coordinator")
    ok &= check("extracurricular bullets split", d["extracurriculars"][0]["bullets"] == ["Ran E-Summit", "Led 5 events"])
    ok &= check("extracurricular url absolute", d["extracurriculars"][0]["url"].startswith("https://"))
    ok &= check("publication mapped", d["publications"][0]["title"] == "On RAG")
    ok &= check("publication url absolute", d["publications"][0]["url"].startswith("https://"))
    ok &= check("certification mapped", d["certifications"][0]["name"] == "MERN course" and d["certifications"][0]["issuer"] == "Apna College")
    ok &= check("certification url absolute", d["certifications"][0]["url"].startswith("https://"))
    ok &= check("hobbies parsed from string", d["hobbies"] == ["Chess", "Photography", "Open-source"])
    return ok


def test_devicon_slug():
    ok = True
    ok &= check("HTML -> html5", main._devicon_slug("HTML") == "html5")
    ok &= check("CSS -> css3", main._devicon_slug("CSS") == "css3")
    ok &= check("Node.js -> nodejs", main._devicon_slug("Node.js") == "nodejs")
    ok &= check("C++ -> cplusplus", main._devicon_slug("C++") == "cplusplus")
    ok &= check("C# -> csharp", main._devicon_slug("C#") == "csharp")
    ok &= check("AWS alias", main._devicon_slug("Amazon Web Services (AWS)") == "amazonwebservices")
    ok &= check("scikit-learn -> scikitlearn", main._devicon_slug("scikit-learn") == "scikitlearn")
    ok &= check("unknown passthrough", main._devicon_slug("Excel") == "excel")
    return ok


def test_themes_registry():
    ok = True
    expected = {"editor", "nova", "codeflow", "panels", "wave", "bold", "terminal", "clean", "editorial", "vibrant"}
    ok &= check("10 themes registered", set(main.PORTFOLIO_THEMES) == expected)
    ok &= check("default theme valid", main.DEFAULT_PORTFOLIO_THEME in main.PORTFOLIO_THEMES)
    return ok


def test_empty_resume():
    d = main._build_portfolio_data({})
    ok = True
    ok &= check("empty -> safe name", d["name"] == "Your Name")
    ok &= check("empty -> no sections", d["experience"] == [] and d["projects"] == [] and d["skills"] == [])
    ok &= check("empty -> '?' initials", d["initials"] == "?")
    return ok


def main_run():
    tests = [
        test_slugify, test_initials, test_strip_bullets, test_skill_groups,
        test_build_editor_shape, test_build_candidate_shape, test_photo_validator,
        test_handle_helpers, test_share_url, test_social_links_absolute,
        test_new_sections, test_devicon_slug, test_themes_registry, test_empty_resume,
    ]
    all_ok = True
    for t in tests:
        print(f"\n{t.__name__}:")
        try:
            all_ok &= t()
        except Exception:
            all_ok = False
            traceback.print_exc()
    print("\n" + ("ALL TESTS PASSED" if all_ok else "SOME TESTS FAILED"))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main_run())
