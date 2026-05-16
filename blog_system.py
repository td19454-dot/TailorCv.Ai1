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

    def related_posts(self, post: BlogPost, limit: int = 3) -> list[BlogPost]:
        def score(candidate: BlogPost) -> int:
            shared_tags = len(set(post.tags) & set(candidate.tags))
            same_category = 1 if post.category and post.category == candidate.category else 0
            return shared_tags * 3 + same_category

        others = [p for p in self.load_posts() if p.slug != post.slug]
        others.sort(key=lambda p: (score(p), p.date_iso), reverse=True)
        return others[:limit]

    def list_filters(self) -> dict[str, list[str]]:
        posts = self.load_posts()
        tags = sorted({tag for p in posts for tag in p.tags})
        categories = sorted({p.category for p in posts if p.category})
        return {"tags": tags, "categories": categories}

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
        t = tag.strip().lower()
        c = category.strip().lower()

        filtered: list[BlogPost] = []
        for post in posts:
            if q:
                hay = " ".join([post.title, post.description, " ".join(post.tags), post.category]).lower()
                if q not in hay:
                    continue
            if t and t not in [x.lower() for x in post.tags]:
                continue
            if c and post.category.lower() != c:
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

        title = str(frontmatter.get("title") or self._title_from_file(file_path)).strip()
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

        md = markdown.Markdown(extensions=["extra", "toc", "fenced_code", "codehilite", "tables", "sane_lists"])
        content_html = md.convert(body)
        toc_html = getattr(md, "toc", "") or ""

        word_count = len(re.findall(r"\w+", body))
        read_time = max(1, round(word_count / WORD_PER_MINUTE))
        lastmod_iso = datetime.utcfromtimestamp(os.path.getmtime(file_path)).strftime("%Y-%m-%d")

        if not description:
            plain = re.sub(r"<[^>]+>", "", content_html)
            description = (plain[:157] + "...") if len(plain) > 160 else plain

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
        )

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
    def _normalize_image_path(value: str) -> str:
        if not value:
            return ""
        cleaned = value.replace("\\", "/").strip()
        if cleaned.startswith(("http://", "https://", "/")):
            return cleaned
        if cleaned.startswith("public/"):
            return "/" + cleaned
        if cleaned.startswith("static/"):
            return "/" + cleaned
        return "/public/" + cleaned


@lru_cache(maxsize=1)
def codehilite_css() -> str:
    if HtmlFormatter is None:
        return ""
    return HtmlFormatter(style="friendly").get_style_defs(".codehilite")


def xml_escape(value: str) -> str:
    return html.escape(value or "", quote=True)
