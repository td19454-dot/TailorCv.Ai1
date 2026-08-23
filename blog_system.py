import html
import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache
from typing import Any

import markdown

try:
    from pygments.formatters import HtmlFormatter
except Exception:  # pragma: no cover
    HtmlFormatter = None


WORD_PER_MINUTE = 220

FILTER_ALIASES = {
    "ats": "ATS Optimization",
    "ats optimization": "ATS Optimization",
    "ats resume": "ATS Optimization",
    "resume": "Resume Writing",
    "resume tips": "Resume Writing",
    "resume writing": "Resume Writing",
    "resume optimization": "Resume Optimization",
    "resume tailoring": "Resume Optimization",
    "career advice": "Career Advice",
    "job search": "Job Search",
    "portfolio": "Portfolio",
    "portfolio guide": "Portfolio",
    "interview prep": "Interview Preparation",
    "interview preparation": "Interview Preparation",
    "cover letter": "Cover Letters",
    "cover letters": "Cover Letters",
    "linkedin": "LinkedIn",
}

CATEGORY_ORDER = [
    "ATS Optimization",
    "Resume Optimization",
    "Resume Writing",
    "Job Search",
    "Career Advice",
    "Cover Letters",
    "Interview Preparation",
    "LinkedIn",
    "Portfolio",
    "Resume Examples",
    "Comparisons",
]

TOPIC_ORDER = [
    "ATS Resume Checker",
    "ATS Keywords",
    "Resume Keywords",
    "Resume Match",
    "Resume Tips 2026",
    "Free Resume Optimizer",
    "Chrome Extension",
    "AI Resume",
    "Mock Interview",
    "Portfolio Builder",
]

BROAD_FILTER_LABELS = set(CATEGORY_ORDER)


def canonical_filter_label(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return ""
    key = text.lower()
    return FILTER_ALIASES.get(key, text)


@dataclass
class BlogPost:
    source_path: str
    slug: str
    title: str
    description: str
    date_iso: str
    date_display: str
    author: str
    tags: list[str]
    category: str
    image: str
    keywords: str
    read_time: int
    content_html: str
    toc_html: str
    word_count: int
    lastmod_iso: str
    # Opt-in "Updated" stamp. Only set when a post carries an `updated:` field
    # in its frontmatter - deliberately NOT derived from file mtime, which
    # would claim every post was revised on whatever day the files were last
    # touched in bulk. Empty string means "show nothing".
    updated_iso: str = ""
    updated_display: str = ""
    # Opt-in override for the embedded template gallery. blog_template_showcase()
    # otherwise infers the gallery from slug/title/tags, which cannot work for a
    # post whose subject is unrelated to resumes ("usa-day-one-cpt-risks") but
    # which should still show one. Values: "portfolio", "resume", "none".
    showcase: str = ""


class BlogService:
    def __init__(self, content_dir: str, default_author: str = "TailorCV Team") -> None:
        self.content_dir = content_dir
        self.default_author = default_author
        self._cache_signature: tuple[str, ...] = ()
        self._posts_cache: list[BlogPost] = []

    def _snapshot(self) -> tuple[str, ...]:
        if not os.path.isdir(self.content_dir):
            return ()
        parts: list[str] = []
        for file_name in os.listdir(self.content_dir):
            if not file_name.endswith(".md"):
                continue
            path = os.path.join(self.content_dir, file_name)
            stat = os.stat(path)
            parts.append(f"{file_name}:{stat.st_mtime_ns}:{stat.st_size}")
        # Also watch the blog-images folder: a post caches its computed .image
        # (which depends on whether the file exists), so dropping/removing a
        # cover must invalidate the cache too — otherwise a newly added image
        # won't appear until the server restarts.
        img_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "blog-images")
        if os.path.isdir(img_dir):
            try:
                for fn in os.listdir(img_dir):
                    parts.append(f"img:{fn}")
            except OSError:
                pass
        return tuple(sorted(parts))

    def load_posts(self) -> list[BlogPost]:
        sig = self._snapshot()
        if sig == self._cache_signature and self._posts_cache:
            return self._posts_cache

        posts: list[BlogPost] = []
        if os.path.isdir(self.content_dir):
            for file_name in sorted(os.listdir(self.content_dir)):
                if file_name.endswith(".md"):
                    path = os.path.join(self.content_dir, file_name)
                    post = self._parse_post(path)
                    if post:
                        posts.append(post)

        posts.sort(key=lambda p: p.date_iso, reverse=True)
        self._cache_signature = sig
        self._posts_cache = posts
        return posts

    def get_post(self, slug: str) -> BlogPost | None:
        for post in self.load_posts():
            if post.slug == slug:
                return post
        return None

    def related_posts(self, post: BlogPost, limit: int = 8) -> list[BlogPost]:
        """Pick related posts for internal linking. Layered so every post links to
        several others AND every post RECEIVES links (no orphan pages):
          1) strongest tag overlap (relevance),
          2) same-category posts, rotated by slug so inbound links spread across
             the whole category instead of hitting the same few popular posts,
          3) most-recent posts (rotated) as filler,
          4) a global "ring": each post always links to its two successors in a
             stable slug-sorted order, which guarantees every post is linked from
             its two ring-predecessors — so nothing is ever orphaned.
        """
        all_posts = self.load_posts()
        others = [p for p in all_posts if p.slug != post.slug]
        if not others:
            return []
        post_tags = set(post.tags)

        def tag_overlap(c: BlogPost) -> int:
            return len(post_tags & set(c.tags))

        tagged = sorted(
            (p for p in others if tag_overlap(p) > 0),
            key=lambda p: (tag_overlap(p), p.date_iso),
            reverse=True,
        )
        same_cat = [p for p in others if post.category and p.category == post.category]
        if same_cat:
            seed = sum(ord(ch) for ch in post.slug) % len(same_cat)
            same_cat = same_cat[seed:] + same_cat[:seed]  # rotate to spread links
        recent = sorted(others, key=lambda p: p.date_iso, reverse=True)
        if recent:
            seed_r = (sum(ord(ch) for ch in post.slug) * 7 + 3) % len(recent)
            recent = recent[seed_r:] + recent[:seed_r]

        # Coverage guarantee: successors in a stable global ring.
        ring_order = sorted(all_posts, key=lambda p: p.slug)
        idx = next((i for i, p in enumerate(ring_order) if p.slug == post.slug), -1)
        n = len(ring_order)
        ring = [ring_order[(idx + k) % n] for k in (1, 2)] if idx >= 0 and n > 1 else []

        picked: list[BlogPost] = []
        seen: set[str] = {post.slug}

        def add(p: BlogPost) -> None:
            if p.slug not in seen:
                picked.append(p)
                seen.add(p.slug)

        # Fill most slots with relevance, but reserve room for the ring neighbours.
        reserve = len(ring)
        for pool in (tagged, same_cat, recent):
            for p in pool:
                if len(picked) >= limit - reserve:
                    break
                add(p)
        # Guaranteed ring neighbours (this is what removes orphans).
        for p in ring:
            if len(picked) >= limit:
                break
            add(p)
        # Top up if any ring neighbour was already present.
        for p in recent:
            if len(picked) >= limit:
                break
            add(p)
        return picked[:limit]

    def link_hub(self, post: BlogPost, exclude: list[BlogPost] | None = None,
                 per_group: int = 20, min_total: int = 100) -> list[dict]:
        """Curated groups of internal links shown as compact text lists under a
        post, so every article carries a rich set of internal links (dozens) the
        way large content sites do — via a browse hub, NOT keyword-stuffed prose.

        Returns an ordered list of {"title", "posts"} groups:
          1) More in the post's own category (relevance + spreads link equity),
          2) posts sharing the post's tags but not its category (adjacent topics),
          3) newest guides (freshness),
          4) an alphabetical ring slice (coverage: guarantees no orphan pages).
        Each group is rotated by a slug-derived seed so different posts surface
        different neighbours, spreading inbound links across the whole blog.
        """
        all_posts = self.load_posts()
        seen = {post.slug} | {p.slug for p in (exclude or [])}
        seed = sum(ord(ch) for ch in post.slug)

        def rotate(items: list[BlogPost], salt: int) -> list[BlogPost]:
            if not items:
                return items
            k = (seed * salt + 1) % len(items)
            return items[k:] + items[:k]

        def take(items: list[BlogPost]) -> list[BlogPost]:
            out = []
            for p in items:
                if p.slug in seen:
                    continue
                out.append(p)
                seen.add(p.slug)
                if len(out) >= per_group:
                    break
            return out

        others = [p for p in all_posts if p.slug != post.slug]
        post_tags = set(post.tags)

        same_cat = [p for p in others if post.category and p.category == post.category]
        tag_adj = sorted(
            (p for p in others if post_tags & set(p.tags) and p.category != post.category),
            key=lambda p: (len(post_tags & set(p.tags)), p.date_iso), reverse=True,
        )
        recent = sorted(others, key=lambda p: p.date_iso, reverse=True)
        ring = sorted(others, key=lambda p: p.slug)

        groups = [
            [f"More {post.category} guides" if post.category else "More guides", take(rotate(same_cat, 3))],
            ["Related topics", take(tag_adj)],
            ["Explore more", take(rotate(ring, 11))],
        ]
        # Modest floor so a no-category post still shows a couple of links, without
        # turning into a wall. Top up "Explore more" from the ring if a page is light.
        target = min_total - len(exclude or [])
        total = sum(len(ps) for _, ps in groups)
        if total < target:
            needed = target - total
            pool = [p for p in rotate(ring, 7) if p.slug not in seen]
            groups[-1][1] = groups[-1][1] + pool[:needed]
        return [{"title": t, "posts": ps} for t, ps in groups if ps]

    def list_filters(self, top_tag_count: int = 10) -> dict[str, list[str]]:
        posts = self.load_posts()
        tags = sorted({canonical_filter_label(tag) for p in posts for tag in p.tags if canonical_filter_label(tag)})
        category_counts: dict[str, int] = {}
        for p in posts:
            category = canonical_filter_label(p.category)
            if category:
                category_counts[category] = category_counts.get(category, 0) + 1
        categories = sorted(
            category_counts,
            key=lambda name: (
                CATEGORY_ORDER.index(name) if name in CATEGORY_ORDER else len(CATEGORY_ORDER),
                name.lower(),
            ),
        )
        # The full tag list runs to hundreds of entries, which is useless as a
        # UI. `top_tags` is the handful worth showing as chips - ordered by how
        # many posts carry them, so the chips lead somewhere populated.
        counts: dict[str, int] = {}
        for p in posts:
            for tag in p.tags:
                label = canonical_filter_label(tag)
                if label and label not in BROAD_FILTER_LABELS and label != canonical_filter_label(p.category):
                    counts[label] = counts.get(label, 0) + 1
        top_tags = [
            t for t, _ in sorted(
                counts.items(),
                key=lambda kv: (
                    TOPIC_ORDER.index(kv[0]) if kv[0] in TOPIC_ORDER else len(TOPIC_ORDER),
                    -kv[1],
                    kv[0].lower(),
                ),
            )[:top_tag_count]
        ]
        return {"tags": tags, "categories": categories, "top_tags": top_tags}

    def search_posts(
        self,
        query: str = "",
        tag: str = "",
        category: str = "",
        page: int = 1,
        per_page: int = 9,
    ) -> dict[str, Any]:
        posts = self.load_posts()
        q = query.strip().lower()
        t = canonical_filter_label(tag).lower()
        c = canonical_filter_label(category).lower()

        filtered: list[BlogPost] = []
        for post in posts:
            if q:
                hay = " ".join([post.title, post.description, " ".join(post.tags), post.category]).lower()
                if q not in hay:
                    continue
            post_tags = [canonical_filter_label(x).lower() for x in post.tags]
            post_category = canonical_filter_label(post.category).lower()
            if t and t not in post_tags and t != post_category:
                continue
            if c and post_category != c:
                continue
            filtered.append(post)

        total = len(filtered)
        total_pages = max(1, (total + per_page - 1) // per_page)
        page = max(1, min(page, total_pages))
        start = (page - 1) * per_page
        end = start + per_page
        return {
            "items": filtered[start:end],
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
        }

    def _parse_post(self, file_path: str) -> BlogPost | None:
        raw = self._read_file(file_path)
        if not raw.strip():
            return None
        frontmatter, body = self._split_frontmatter(raw)

        # A leading "# H1" / "## H2" at the very top of the body is usually the
        # article's real (fuller) title, duplicated from the hero heading. When it
        # matches or extends the frontmatter title, adopt it as the title and strip
        # it from the content so the heading isn't shown twice. A leading heading
        # that is unrelated to the title (a genuine section) is left untouched.
        fm_title = str(frontmatter.get("title") or "").strip()
        lead = re.match(r"\s*#{1,2}(?!#)[ \t]+(.+?)[ \t]*(?:\n|$)", body)
        if lead:
            heading = lead.group(1).strip()
            if not fm_title or heading == fm_title or (heading.startswith(fm_title) and len(heading) > len(fm_title)):
                fm_title = heading
                body = body[lead.end():].lstrip("\n")
        title = (fm_title or self._title_from_file(file_path)).strip()
        description = str(frontmatter.get("description") or "").strip()
        slug = self._slugify(str(frontmatter.get("slug") or os.path.splitext(os.path.basename(file_path))[0]))
        author = str(frontmatter.get("author") or self.default_author).strip()
        category = str(frontmatter.get("category") or "").strip()
        image = self._normalize_image_path(str(frontmatter.get("image") or "").strip())
        keywords = str(frontmatter.get("keywords") or "").strip()

        tags = self._coerce_list(frontmatter.get("tags"))
        parsed_date = self._parse_date(str(frontmatter.get("date") or ""))
        if parsed_date is None:
            parsed_date = datetime.utcfromtimestamp(os.path.getmtime(file_path)).date()
        # Only honour an explicit `updated:` field, and only when it is actually
        # later than the publish date - a stamp that matches the publish date
        # tells the reader nothing.
        updated_date = self._parse_date(str(frontmatter.get("updated") or ""))
        if updated_date is not None and updated_date <= parsed_date:
            updated_date = None

        md = markdown.Markdown(extensions=["extra", "toc", "fenced_code", "codehilite", "tables", "sane_lists"])
        content_html = md.convert(body)
        content_html = self._normalize_content_images(content_html)
        content_html = self._render_task_lists(content_html)
        toc_html = getattr(md, "toc", "") or ""

        word_count = len(re.findall(r"\w+", body))
        read_time = max(1, round(word_count / WORD_PER_MINUTE))
        lastmod_iso = datetime.utcfromtimestamp(os.path.getmtime(file_path)).strftime("%Y-%m-%d")

        if not description:
            plain = re.sub(r"<[^>]+>", "", content_html)
            description = (plain[:157] + "...") if len(plain) > 160 else plain
        description = self._strip_markdown(description)

        return BlogPost(
            source_path=file_path,
            slug=slug,
            title=title,
            description=description,
            date_iso=parsed_date.strftime("%Y-%m-%d"),
            date_display=parsed_date.strftime("%b %d, %Y"),
            author=author,
            tags=tags,
            category=category,
            image=image,
            keywords=keywords,
            read_time=read_time,
            content_html=content_html,
            toc_html=toc_html,
            word_count=word_count,
            lastmod_iso=lastmod_iso,
            updated_iso=updated_date.strftime("%Y-%m-%d") if updated_date else "",
            updated_display=updated_date.strftime("%b %d, %Y") if updated_date else "",
            showcase=str(frontmatter.get("showcase", "") or "").strip().lower(),
        )

    @staticmethod
    def _render_task_lists(content_html: str) -> str:
        """Turn markdown task-list syntax into real checkbox rows.

        106 posts use `- [ ] item` for checklists, but python-markdown has no
        task-list extension enabled, so the literal "[ ]" was being printed as
        text next to the bullet. Replace it with a styled box and tag the <li>
        so CSS can drop the bullet.
        """
        def repl(m: re.Match) -> str:
            attrs, mark, rest = m.group(1), m.group(2), m.group(3)
            done = mark.lower() == "x"
            cls = "task-item task-done" if done else "task-item"
            box = '<span class="task-box" aria-hidden="true">' + ("&#10003;" if done else "") + "</span>"
            label = "checked" if done else "unchecked"
            return f'<li{attrs} class="{cls}"><span class="sr-only">{label}: </span>{box}{rest}'

        return re.sub(r'<li([^>]*)>\s*\[([ xX])\]\s*(.*)', repl, content_html)

    @staticmethod
    def _normalize_content_images(content_html: str) -> str:
        """Make in-article image paths root-relative, and lazy-load them.

        Posts write images as `![alt](public/blog-images/x.webp)`, matching
        the frontmatter convention. The frontmatter `image` gets fixed up by
        _normalize_image_path, but body images went through untouched - so on
        /blog/<slug> the browser resolved them against the post URL and asked
        for /blog/public/blog-images/x.webp, which 404s. Every inline image
        in the blog was silently broken.
        """
        def fix(m: re.Match) -> str:
            before, src, after = m.group(1), m.group(2), m.group(3)
            if not src.startswith(("http://", "https://", "//", "/", "data:")):
                src = "/" + src.lstrip("./")
            extra = "" if "loading=" in (before + after) else ' loading="lazy" decoding="async"'
            return f'<img{before}src="{src}"{after}{extra}>'

        return re.sub(r'<img([^>]*?)src="([^"]+)"([^>]*?)>', fix, content_html)

    @staticmethod
    def _read_file(path: str) -> str:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    @staticmethod
    def _split_frontmatter(raw: str) -> tuple[dict[str, Any], str]:
        raw = raw.lstrip("\ufeff")
        if not raw.startswith("---"):
            return {}, raw
        parts = raw.split("---", 2)
        if len(parts) < 3:
            return {}, raw
        front_raw = parts[1]
        body = parts[2].lstrip("\n")
        return BlogService._parse_frontmatter(front_raw), body

    @staticmethod
    def _parse_frontmatter(front_raw: str) -> dict[str, Any]:
        data: dict[str, Any] = {}
        current_list_key = ""
        for line in front_raw.splitlines():
            if not line.strip():
                continue
            if line.strip().startswith("#"):
                continue
            if line.lstrip().startswith("- ") and current_list_key:
                data.setdefault(current_list_key, []).append(line.split("-", 1)[1].strip().strip("\"'"))
                continue
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()
            if value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                data[key] = [v.strip().strip("\"'") for v in inner.split(",") if v.strip()]
                current_list_key = ""
            elif value:
                data[key] = value.strip("\"'")
                current_list_key = ""
            else:
                data[key] = []
                current_list_key = key
        return data

    @staticmethod
    def _coerce_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return []

    @staticmethod
    def _title_from_file(file_path: str) -> str:
        base = os.path.splitext(os.path.basename(file_path))[0]
        return base.replace("-", " ").replace("_", " ").title()

    @staticmethod
    def _slugify(value: str) -> str:
        value = value.lower().strip()
        value = re.sub(r"[^a-z0-9\s-]", "", value)
        value = re.sub(r"\s+", "-", value)
        value = re.sub(r"-+", "-", value)
        return value.strip("-")

    @staticmethod
    def _parse_date(value: str) -> date | None:
        if not value:
            return None
        candidates = ["%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d", "%b %d, %Y", "%B %d, %Y"]
        for fmt in candidates:
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                continue
        return None

    @staticmethod
    def _strip_markdown(text: str) -> str:
        """Turn inline markdown into clean plain text for excerpts/meta:
        [anchor](url) -> anchor, and drop emphasis/heading/code markers."""
        if not text:
            return ""
        text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # links -> anchor text
        text = re.sub(r"[*_`>#]", "", text)                    # emphasis / heading marks
        text = re.sub(r"\s+", " ", text).strip()
        return text

    @staticmethod
    def _normalize_image_path(value: str) -> str:
        if not value:
            return ""
        cleaned = value.replace("\\", "/").strip()
        # External URLs pass through (can't verify existence on disk).
        if cleaned.startswith(("http://", "https://")):
            return cleaned
        # Normalise to a leading-slash web path.
        if cleaned.startswith("/"):
            web = cleaned
        elif cleaned.startswith(("public/", "static/")):
            web = "/" + cleaned
        else:
            web = "/public/" + cleaned
        # Only surface the image if the file actually exists, so a post can
        # declare its expected cover path before the image is generated without
        # rendering a broken <img>. Also accept the same basename with any common
        # extension, so declaring ".webp" still works if a ".png"/".jpg" is
        # dropped in later (or vice-versa).
        root = os.path.dirname(os.path.abspath(__file__))
        disk = os.path.join(root, web.lstrip("/"))
        if os.path.isfile(disk):
            return web
        disk_base, _ = os.path.splitext(disk)
        web_base, _ = os.path.splitext(web)
        for ext in (".webp", ".png", ".jpg", ".jpeg", ".avif"):
            if os.path.isfile(disk_base + ext):
                return web_base + ext
        return ""


@lru_cache(maxsize=1)
def codehilite_css() -> str:
    if HtmlFormatter is None:
        return ""
    return HtmlFormatter(style="friendly").get_style_defs(".codehilite")


def xml_escape(value: str) -> str:
    return html.escape(value or "", quote=True)
