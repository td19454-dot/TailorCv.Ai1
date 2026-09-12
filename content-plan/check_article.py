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
WPM = 250

MIN = dict(words=2000, h2=8, h3=6, table_rows=6, blog_links=12,
           product_links=2, faqs=6, examples=2)
TARGET = dict(words=2200, h2=10, h3=12, table_rows=10, blog_links=18,
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

    fails = []
    for k, lo in MIN.items():
        if got[k] < lo:
            fails.append("%s=%d (min %d)" % (k, got[k], lo))
    if dead:
        fails.append("DEAD LINKS: " + ", ".join("%s->%s" % (a[:18], t) for a, t in dead[:4]))
    if other:
        fails.append("UNKNOWN PATHS: " + ", ".join(h for _, h in other[:4]))

    got["read_min"] = round(words / WPM, 1)
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
    print("%-44s %6s %5s %3s %3s %4s %4s %3s %4s  %s"
          % ("slug", "words", "read", "h2", "h3", "tbl", "link", "fe", "faq", "status"))
    for s in slugs:
        got, fails = analyse(s, exist, planned)
        if got is None:
            print("%-44s  %s" % (s, fails[0])); bad += 1; continue
        status = "OK" if not fails else "FAIL"
        if fails:
            bad += 1
        print("%-44s %6d %5.1f %3d %3d %4d %4d %3d %4d  %s"
              % (s[:44], got["words"], got["read_min"], got["h2"], got["h3"],
                 got["table_rows"], got["blog_links"], got["product_links"],
                 got["faqs"], status))
        for f in fails:
            print("      - %s" % f)
    print("\n%d checked, %d failing" % (len(slugs), bad))
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
