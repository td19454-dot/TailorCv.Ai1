# -*- coding: utf-8 -*-
"""Validate blog articles against content-plan/ARTICLE-STANDARD.md.

    python content-plan/check_article.py <slug> [<slug> ...]
    python content-plan/check_article.py --batch      # every post newer than the standard
    python content-plan/check_article.py --all        # whole catalogue (slow, informational)

Exit code 1 if any checked article fails a hard minimum.
No network, no API, no cost - pure local text analysis.
"""
import io, os, re, sys, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOGS = os.path.join(ROOT, "content", "blogs")
PLAN = os.path.join(ROOT, "content-plan", "tailorcv_1000_topics.json")
BOM = "﻿"

# MUST match blog_system.WORD_PER_MINUTE, because that is the figure the site
# renders on the post ("9 min read"). Validating against any other rate lets
# articles pass here and display a lower number to the reader. Imported live so
# the two can never drift apart again.
try:
    sys.path.insert(0, ROOT)
    from blog_system import WORD_PER_MINUTE as WPM
except Exception:                                    # pragma: no cover
    WPM = 220

# Hard floor: 9 minutes of genuine reading time at the site's own rate.
MIN_READ_MINUTES = 9
TARGET_READ_MINUTES = 10
MIN_WORDS = MIN_READ_MINUTES * WPM          # 1980 at 220 wpm
TARGET_WORDS = TARGET_READ_MINUTES * WPM    # 2200 at 220 wpm

# The site rounds read_time, so 1930 words would display as "9 min" while being
# under the true 9-minute bar. Require the real word count, not the rounded one.
MIN = dict(words=MIN_WORDS, h2=8, h3=6, table_rows=6, blog_links=12,
           product_links=2, faqs=6, examples=2)
TARGET = dict(words=TARGET_WORDS, h2=10, h3=12, table_rows=10, blog_links=18,
              product_links=3, faqs=8, examples=3)

# Verified against main.py @app.get routes. Do not add a path that is not a real route.
PRODUCT_PATHS = {
    "/ats-analysis", "/solutions", "/portfolio", "/cover-letter", "/mock-interview",
    "/templates", "/extension", "/pricing", "/resume-examples", "/interview-prep",
    "/portfolio-builder", "/auto-apply", "/alternatives", "/optimize", "/modify-cv",
}

def existing_slugs():
    return {os.path.basename(p)[:-3] for p in glob.glob(os.path.join(BLOGS, "*.md"))}

def planned_slugs():
    if not os.path.exists(PLAN):
        return set()
    return {r["slug"] for r in json.load(io.open(PLAN, encoding="utf-8"))}

def split_fm(text):
    text = text.lstrip(BOM)
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    fm = {}
    for line in parts[1].splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip().lower()] = v.strip()
    return fm, parts[2]

def analyse(slug, exist, planned):
    path = os.path.join(BLOGS, slug + ".md")
    if not os.path.exists(path):
        return None, ["file not found"]
    fm, body = split_fm(io.open(path, encoding="utf-8").read())

    words = len(body.split())
    h2 = re.findall(r"^## (.+)$", body, re.M)
    h3 = re.findall(r"^### (.+)$", body, re.M)
    rows = [l for l in re.findall(r"^\|.*$", body, re.M) if not re.match(r"^\|[\s|:-]+\|?$", l)]
    quotes = len(re.findall(r"^>", body, re.M))
    ba = len(re.findall(r"\*\*(Before|After|Weak|Strong|Original|Rewritten|Tailored)", body, re.I))

    links = re.findall(r"\[([^\]]+)\]\((/[a-zA-Z0-9/_-]+)\)", body)
    blog_links = [(a, h) for a, h in links if h.startswith("/blog/")]
    prod_links = [(a, h) for a, h in links if h in PRODUCT_PATHS]
    other = [(a, h) for a, h in links if not h.startswith("/blog/") and h not in PRODUCT_PATHS]

    # FAQ questions: H3s under an FAQ H2, or bolded question lines
    faq = 0
    m = re.search(r"^## .*(Frequently Asked|FAQ).*$", body, re.M | re.I)
    if m:
        tail = body[m.end():]
        nxt = re.search(r"^## ", tail, re.M)
        seg = tail[:nxt.start()] if nxt else tail
        faq = len(re.findall(r"^### ", seg, re.M)) + len(re.findall(r"^\*\*.+\?\*\*", seg, re.M))

    # link integrity
    dead, pending = [], []
    for a, h in blog_links:
        t = h.split("/blog/")[1].strip("/")
        if t in exist:
            continue
        (pending if t in planned else dead).append((a, t))

    # spread: how many H2 sections contain at least one internal link
    secs = re.split(r"^## ", body, flags=re.M)[1:]
    linked_secs = sum(1 for s in secs if re.search(r"\]\(/(blog/|ats-analysis|solutions|portfolio|cover-letter|mock-interview|templates|extension|pricing|resume-examples|interview-prep)", s))

    got = dict(words=words, h2=len(h2), h3=len(h3), table_rows=len(rows),
               blog_links=len(blog_links), product_links=len(prod_links),
               faqs=faq, examples=quotes + ba)

    site_read = max(1, round(words / WPM))   # exactly what blog_system renders
    true_read = words / WPM

    # ---- engagement checks -------------------------------------------------
    # Length alone does not make an article worth reading. These catch the
    # mechanical failures: a generic opening, walls of text, and long stretches
    # of undifferentiated prose. Padding and repetition still need human review.
    engagement = []

    # 1. Opening: first prose paragraph after Key Takeaways must not be filler.
    # Drop ONLY the Key Takeaways bullet list, keeping the prose that follows it -
    # that prose is the real opening and the thing being judged. (An earlier
    # version stripped through to the next H2 and deleted the opening entirely,
    # so this check silently never fired.)
    kt = re.search(r"^## Key Takeaways\s*$", body, re.M)
    after_kt = body
    if kt:
        rest = body[kt.end():]
        # skip the bullet block immediately under the heading
        m = re.search(r"\n(?=\s*[^\s\-*])", rest)
        after_kt = rest[m.start():] if m else rest
    first_para = ""
    for raw in after_kt.split("\n\n"):
        s = raw.strip()
        if s and not s.startswith(("#", "|", "-", "*", ">", "```")):
            first_para = s
            break
    GENERIC = [
        r"in today'?s\s+(competitive|fast[- ]paced|digital|modern|current)",
        r"in the (competitive|modern|current|ever[- ]changing)\s+(job market|world)",
        r"this (article|guide|post)\s+(will|explains|covers|walks|explores)",
        r"by the end of this (article|guide)",
        r"before we (dive|get) in",
        r"let'?s (face it|dive in|take a look)",
        r"it'?s no secret",
        r"we all know",
        r"gone are the days",
    ]
    for pat in GENERIC:
        if re.search(pat, first_para[:400], re.I):
            engagement.append("generic opening: '%s...'" % first_para[:60])
            break

    # 2. Wall of text: paragraphs over ~90 words read badly on mobile.
    long_paras = 0
    for raw in body.split("\n\n"):
        s = raw.strip()
        if s and not s.startswith(("#", "|", "-", "*", ">", "```")):
            if len(s.split()) > 90:
                long_paras += 1
    if long_paras > 2:
        engagement.append("%d paragraphs over 90 words (wall of text)" % long_paras)

    # 3. Texture: a section of pure prose with no table, list, quote or example
    #    is where readers drop. Flag long runs of undifferentiated prose.
    plain_runs = 0
    for sec in re.split(r"^## ", body, flags=re.M)[1:]:
        if len(sec.split()) > 220 and not re.search(r"^(\||>|[-*]\s|\d+\.\s|###)",
                                                    sec, re.M):
            plain_runs += 1
    if plain_runs:
        engagement.append("%d long section(s) with no list/table/example/H3" % plain_runs)

    fails = []
    # Read time is the headline requirement, so it is reported first and in
    # minutes - the unit the requirement was given in.
    if true_read < MIN_READ_MINUTES:
        fails.append(
            "READ TIME %.1f min (site shows %d min) - REQUIRED %d min. "
            "Need %d more words."
            % (true_read, site_read, MIN_READ_MINUTES, MIN_WORDS - words))
    for k, lo in MIN.items():
        if k == "words":
            continue                          # covered by the read-time check
        if got[k] < lo:
            fails.append("%s=%d (min %d)" % (k, got[k], lo))
    if dead:
        fails.append("DEAD LINKS: " + ", ".join("%s->%s" % (a[:18], t) for a, t in dead[:4]))
    if other:
        fails.append("UNKNOWN PATHS: " + ", ".join(h for _, h in other[:4]))
    fails.extend(engagement)

    got["read_min"] = round(true_read, 1)
    got["site_read"] = site_read
    got["pending"] = len(pending)
    got["sections_with_links"] = "%d/%d" % (linked_secs, len(secs))
    return got, fails

def main():
    args = sys.argv[1:]
    exist, planned = existing_slugs(), planned_slugs()
    if not args:
        print(__doc__); return 0
    if args[0] == "--all":
        slugs = sorted(exist)
    elif args[0] == "--batch":
        std = os.path.join(ROOT, "content-plan", "ARTICLE-STANDARD.md")
        cutoff = os.path.getmtime(std) if os.path.exists(std) else 0
        slugs = sorted(s for s in exist
                       if os.path.getmtime(os.path.join(BLOGS, s + ".md")) >= cutoff)
    else:
        slugs = [a.replace(".md", "") for a in args]

    bad = 0
    short = 0
    print("Enforcing >= %d min read at %d wpm (blog_system rate) = %d words minimum\n"
          % (MIN_READ_MINUTES, WPM, MIN_WORDS))
    print("%-44s %6s %5s %3s %3s %4s %4s %3s %4s  %s"
          % ("slug", "words", "read", "h2", "h3", "tbl", "link", "fe", "faq", "status"))
    for s in slugs:
        got, fails = analyse(s, exist, planned)
        if got is None:
            print("%-44s  %s" % (s, fails[0])); bad += 1; continue
        status = "OK" if not fails else "FAIL"
        if fails:
            bad += 1
        if got["read_min"] < MIN_READ_MINUTES:
            short += 1
        print("%-44s %6d %5.1f %3d %3d %4d %4d %3d %4d  %s"
              % (s[:44], got["words"], got["read_min"], got["h2"], got["h3"],
                 got["table_rows"], got["blog_links"], got["product_links"],
                 got["faqs"], status))
        for f in fails:
            print("      - %s" % f)
    print("\n%d checked, %d failing" % (len(slugs), bad))
    if short:
        print("%d BELOW THE %d-MINUTE READ-TIME FLOOR - these are not publishable."
              % (short, MIN_READ_MINUTES))
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
