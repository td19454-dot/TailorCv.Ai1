"""Regression tests for Portfolio Studio data mapping.

Covers the pure, deterministic helpers that turn a parsed resume (in either the
editor `cvData` shape or the extraction `candidate_data` shape) into the
portfolio render dict. No external services and no API keys required.

Run:  python test_portfolio.py
"""

import json
import sys
import traceback
from datetime import datetime, timedelta

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
        ok &= check("disabled -> /<slug>", main._portfolio_share_url(P()).endswith("/trisha-ab12") and "/p/" not in main._portfolio_share_url(P()))
        main.PORTFOLIO_SUBDOMAINS_ENABLED = True
        ok &= check("enabled -> subdomain", main._portfolio_share_url(P()) == "https://trisha." + main.PORTFOLIO_DOMAIN)
        class NoHandle:
            handle = None; slug = "x-1"
        ok &= check("no handle -> /<slug> even when enabled", main._portfolio_share_url(NoHandle()).endswith("/x-1") and "/p/" not in main._portfolio_share_url(NoHandle()))
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
    ok &= check(".NET Core alias", main._devicon_slug(".NET Core") == "dot-net")
    ok &= check("SQL alias", main._devicon_slug("SQL") == "azuresqldatabase")
    ok &= check("unknown passthrough", main._devicon_slug("Excel") == "excel")
    return ok


def test_themes_registry():
    ok = True
    expected = {"editor", "nova", "codeflow", "panels", "wave", "bold", "terminal", "console", "monolith", "particle", "snowcard", "clean", "editorial", "vibrant", "github", "parchment", "assistant", "cloud", "neon", "brutalist", "hacker", "magazine"}
    ok &= check("themes registered", set(main.PORTFOLIO_THEMES) == expected)
    ok &= check("default theme valid", main.DEFAULT_PORTFOLIO_THEME in main.PORTFOLIO_THEMES)
    return ok


def test_theme_gating():
    """Free accounts get exactly 3 templates; everything else needs Pro."""
    ok = True

    class Free:
        id = 1
        pro_until = None

    class Pro:
        id = 2
        pro_until = datetime.utcnow() + timedelta(days=30)

    ok &= check("free themes are 3", main.PORTFOLIO_FREE_THEMES == {"panels", "neon", "terminal"})
    ok &= check("free themes are real themes",
                main.PORTFOLIO_FREE_THEMES <= set(main.PORTFOLIO_THEMES))
    ok &= check("free fallback is itself free",
                main.FREE_PORTFOLIO_THEME in main.PORTFOLIO_FREE_THEMES)

    ok &= check("free user: free theme allowed", main.theme_allowed("panels", Free()))
    ok &= check("free user: pro theme blocked", not main.theme_allowed("editor", Free()))
    ok &= check("free user: every pro theme blocked", not any(
        main.theme_allowed(t, Free())
        for t in set(main.PORTFOLIO_THEMES) - main.PORTFOLIO_FREE_THEMES))
    ok &= check("pro user: every theme allowed", all(
        main.theme_allowed(t, Pro()) for t in main.PORTFOLIO_THEMES))
    ok &= check("logged-out: pro theme blocked", not main.theme_allowed("editor", None))
    ok &= check("logged-out: free theme allowed", main.theme_allowed("neon", None))
    return ok


def test_empty_resume():
    d = main._build_portfolio_data({})
    ok = True
    ok &= check("empty -> safe name", d["name"] == "Your Name")
    ok &= check("empty -> no sections", d["experience"] == [] and d["projects"] == [] and d["skills"] == [])
    ok &= check("empty -> '?' initials", d["initials"] == "?")
    return ok


def test_static_bundle():
    """The Netlify static bundle is self-contained: CSS inlined, no app-relative refs."""
    ok = True

    class P:
        slug = "jane-doe"; theme = "github"; tagline = "Builder of things"
        about = "I build ML pipelines.\n\nAnd web apps."
        netlify_site_id = None; netlify_url = None
        data_json = json.dumps({
            "name": "Jane Doe", "initials": "JD", "headline": "ML Engineer", "email": "j@x.com",
            "location": "NYC", "photo": None, "socials": [],
            "skills": [{"group": "Core", "items": ["Python", "Excel"]}],
            "experience": [], "education": [], "projects": [], "certifications": [],
            "publications": [], "extracurriculars": [], "hobbies": [],
            "stats": {"projects": 0, "skills": 2}, "has_cv": False,
        })

    html = main._build_static_portfolio_html(P())
    ok &= check("contains name", "Jane Doe" in html)
    ok &= check("theme CSS inlined", '<link rel="stylesheet" href="/static/portfolio' not in html and "<style>" in html)
    ok &= check("no relative /static refs", 'href="/static/' not in html and 'src="/static/' not in html)
    ok &= check("no relative /p/ refs", 'href="/p/' not in html)
    return ok


def test_slug_shape_filter():
    """The pre-DB guard on /{slug} must reject scanner probes and never a real slug."""
    ok = True
    accept = main._looks_like_portfolio_slug

    # Anything _portfolio_slugify can emit has to survive the filter, or a real
    # portfolio would 404. Derive the cases instead of hand-writing them.
    for name in ["Emilian Leaman", "J. Doe, Jr.!", "", "@#$%", "  hi  ", "x" * 200,
                 "Ravi   Kumar", "O'Brien-Smith", "李 Wei", "3M Corp"]:
        generated = main._portfolio_slugify(name)
        ok &= check(f"accepts generated {generated!r}", accept(generated))
    # ...including the uniqueness suffixes _unique_portfolio_slug appends.
    ok &= check("accepts numeric suffix", accept("j-doe-jr-2"))
    ok &= check("accepts hex suffix", accept("emilian-leaman-a1b2c3"))
    ok &= check("accepts single char", accept("x"))
    ok &= check("accepts digits only", accept("2024"))

    # Scanner probes: every one of these currently costs a Postgres round trip.
    for probe in [".env", "wp-login.php", "xmlrpc.php", "config.json",
                  "apple-touch-icon.png", "Admin", "WP-Admin", "foo_bar",
                  "foo.bar", "foo bar", "foo/bar", "-leading", "trailing-",
                  "double--hyphen", "", "a" * 161, "ünicode", "foo%20bar"]:
        ok &= check(f"rejects {probe!r}", not accept(probe))
    return ok


def test_should_count_view():
    """view_count must move for humans and stay put for automated clients."""
    ok = True

    class Req:
        def __init__(self, ua, method="GET"):
            self.method = method
            self.headers = {"user-agent": ua} if ua is not None else {}

    chrome = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    iphone = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
              "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1")
    ok &= check("counts desktop Chrome", main._should_count_view(Req(chrome)))
    ok &= check("counts mobile Safari", main._should_count_view(Req(iphone)))

    for ua in ["Googlebot/2.1 (+http://www.google.com/bot.html)",
               "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
               "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
               "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
               "curl/8.4.0", "Wget/1.21.3", "python-requests/2.31.0",
               "facebookexternalhit/1.1", "Scrapy/2.11 (+https://scrapy.org)",
               "Go-http-client/1.1", "HeadlessChrome/120.0.0.0"]:
        ok &= check(f"skips {ua.split('/')[0][:28]}", not main._should_count_view(Req(ua)))

    ok &= check("skips blank UA", not main._should_count_view(Req("")))
    ok &= check("skips missing UA", not main._should_count_view(Req(None)))
    ok &= check("skips HEAD from a browser", not main._should_count_view(Req(chrome, "HEAD")))
    ok &= check("counts lowercase 'get'", main._should_count_view(Req(chrome, "get")))
    return ok


def test_ttl_cache():
    """The shared cache must expire, invalidate, and stay bounded."""
    ok = True

    c = main._TTLCache(ttl_seconds=60, max_entries=10)
    c.set("a", True)
    ok &= check("hit before expiry", c.get("a") is True)
    ok &= check("miss for unknown key", c.get("nope") is None)

    c.discard("a")
    ok &= check("discard invalidates", c.get("a") is None)
    c.discard("not-there")  # must not raise
    ok &= check("discard of absent key is safe", True)

    expired = main._TTLCache(ttl_seconds=-1, max_entries=10)
    expired.set("a", True)
    ok &= check("expired entry reads as miss", expired.get("a") is None)

    # Overfill well past the cap: a scanner walking distinct slugs must not be
    # able to grow this without bound.
    bounded = main._TTLCache(ttl_seconds=60, max_entries=10)
    for i in range(500):
        bounded.set(f"slug-{i}", True)
    ok &= check("stays at or below max_entries", len(bounded._data) <= 10)
    ok &= check("most recent write survives eviction", bounded.get("slug-499") is True)
    return ok


def main_run():
    tests = [
        test_slugify, test_initials, test_strip_bullets, test_skill_groups,
        test_build_editor_shape, test_build_candidate_shape, test_photo_validator,
        test_handle_helpers, test_share_url, test_social_links_absolute,
        test_new_sections, test_devicon_slug, test_themes_registry, test_theme_gating,
        test_empty_resume,
        test_static_bundle, test_slug_shape_filter, test_should_count_view,
        test_ttl_cache,
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
