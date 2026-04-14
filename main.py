import asyncio
import json
import logging
import os
import random
import re
import smtplib
from secrets import token_hex
from datetime import datetime, timedelta
from email.message import EmailMessage
import uuid

import pdfplumber
import tempfile
import shutil
import uvicorn
from dotenv import load_dotenv
from pydantic import ValidationError
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session
from auth import hash_password, verify_password
from database import Base, SessionLocal, engine
from functions import (
    ats_scoring,
    create_prompt,
    get_resume_response,
    extract_links,
    inject_links,
    map_demo_links,
    extract_project_links,
    extract_publication_links,
    map_project_demo_links,
    extract_project_link_map,
    normalize_links,
)

from extraction import process_resume
from models import PasswordResetToken, SignupVerificationCode, User
from schemas import ForgotPasswordRequest, ResetPasswordRequest, SignupCodeRequest, UserLogin, UserLoginVerify, UserSignup


from starlette.middleware.sessions import SessionMiddleware

app = FastAPI(title="Resume Optimizer Backend")
logger = logging.getLogger(__name__)
db_init_status = {"ok": None, "error": None}

# Add session middleware
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", "your-secret-key"))

# Add global exception handler for logging
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the base directory (where main.py is located)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

templates_dir = os.path.join(BASE_DIR, "templates")
static_dir = os.path.join(BASE_DIR, "static")
uploads_dir = os.path.join(BASE_DIR, "uploads")
resumes_dir = os.path.join(BASE_DIR, "resumes")

# Ensure directories exist
os.makedirs(uploads_dir, exist_ok=True)
os.makedirs(resumes_dir, exist_ok=True)
os.makedirs(templates_dir, exist_ok=True)
os.makedirs(static_dir, exist_ok=True)

# Mount static files and configure templates with absolute paths
app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)


def initialize_database() -> None:
    """Create tables if the configured database is reachable."""
    try:
        Base.metadata.create_all(bind=engine)
        db_init_status["ok"] = True
        db_init_status["error"] = None
    except Exception as exc:
        db_init_status["ok"] = False
        db_init_status["error"] = str(exc)
        logger.exception("Database initialization failed during startup")


@app.on_event("startup")
async def startup_event() -> None:
    initialize_database()


def get_db() -> Session:
    return SessionLocal()


def _cleanup_files(file_paths: list[str]) -> None:
    for path in file_paths:
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except OSError:
            pass


MAX_CONCURRENT_REQUESTS = int(os.getenv("MAX_CONCURRENT_REQUESTS", "4"))
request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)


def get_email_settings() -> tuple[str, int, str, str, str]:
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME", os.getenv("SMTP_USER", "")).strip()
    smtp_password = os.getenv("SMTP_PASSWORD", os.getenv("SMTP_PASS", "")).strip()
    smtp_from = os.getenv("SMTP_FROM_EMAIL", os.getenv("SMTP_FROM", smtp_username)).strip()
    return smtp_host, smtp_port, smtp_username, smtp_password, smtp_from


def send_password_reset_email(recipient_email: str, reset_code: str) -> bool:
    smtp_host, smtp_port, smtp_username, smtp_password, smtp_from = get_email_settings()

    if not (smtp_host and smtp_username and smtp_password and smtp_from):
        return False

    message = EmailMessage()
    message["Subject"] = "Your TailorCV password reset code"
    message["From"] = smtp_from
    message["To"] = recipient_email
    message.set_content(
        "We received a request to reset your TailorCV password.\n\n"
        f"Your verification code is: {reset_code}\n\n"
        "This code expires in 10 minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(message)

    return True


def send_signup_code_email(recipient_email: str, signup_code: str) -> bool:
    smtp_host, smtp_port, smtp_username, smtp_password, smtp_from = get_email_settings()

    if not (smtp_host and smtp_username and smtp_password and smtp_from):
        return False

    message = EmailMessage()
    message["Subject"] = "Your TailorCV sign-up verification code"
    message["From"] = smtp_from
    message["To"] = recipient_email
    message.set_content(
        "Welcome to TailorCV.\n\n"
        f"Your sign-up verification code is: {signup_code}\n\n"
        "This code expires in 10 minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(message)

    return True


def is_production_environment() -> bool:
    return os.getenv("ENVIRONMENT", "development").lower() == "production"


def extract_pdf_text(path: str) -> str:
    text = ""
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text += (page.extract_text() or "") + "\n"
    return text


def _normalize_key(text: str) -> str:
    return "".join(ch.lower() for ch in str(text or "") if ch.isalnum())


def extract_project_links_from_pdf(pdf_path: str, project_names: list[str]) -> dict[str, list[tuple[str, str]]]:
    """
    Extract *clickable* link annotations (URIs) from the PDF and map them to the nearest
    project name based on page text proximity. This is far more reliable than trying
    to recover URLs from extracted text when the resume uses link icons (↗).
    """
    try:
        from pypdf import PdfReader
    except Exception:
        return {}

    names = [str(n or "").strip() for n in (project_names or []) if str(n or "").strip()]
    if not names:
        return {}

    norm_to_name = {_normalize_key(n): n for n in names}
    norm_names = sorted(norm_to_name.keys(), key=len, reverse=True)

    def best_match(line_text: str) -> str | None:
        k = _normalize_key(line_text)
        if not k:
            return None
        for nn in norm_names:
            if nn and (nn in k or k in nn):
                return norm_to_name[nn]
        return None

    # Build line boxes using pdfplumber so we can locate nearby text for each link annotation.
    line_boxes: dict[int, list[dict]] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            words = page.extract_words(use_text_flow=True, keep_blank_chars=False) or []
            # Group words into lines by y position (tolerant grouping).
            lines: list[dict] = []
            for w in words:
                text = str(w.get("text", "")).strip()
                if not text:
                    continue
                top = float(w.get("top", 0.0))
                bottom = float(w.get("bottom", 0.0))
                x0 = float(w.get("x0", 0.0))
                x1 = float(w.get("x1", 0.0))

                placed = False
                for ln in lines:
                    # Same line if vertical overlap close enough
                    if abs(top - ln["top"]) <= 2.5:
                        ln["text"] = (ln["text"] + " " + text).strip()
                        ln["x0"] = min(ln["x0"], x0)
                        ln["x1"] = max(ln["x1"], x1)
                        ln["top"] = min(ln["top"], top)
                        ln["bottom"] = max(ln["bottom"], bottom)
                        placed = True
                        break
                if not placed:
                    lines.append({"text": text, "x0": x0, "x1": x1, "top": top, "bottom": bottom})

            line_boxes[page_idx] = lines

    reader = PdfReader(pdf_path)
    result: dict[str, list[tuple[str, str]]] = {}

    for page_idx, page in enumerate(reader.pages):
        annots = page.get("/Annots") or []
        for annot_ref in annots:
            try:
                annot = annot_ref.get_object()
            except Exception:
                continue
            a = annot.get("/A") or {}
            uri = a.get("/URI")
            if not uri:
                continue
            uri = str(uri).strip()
            if not uri:
                continue
            if not uri.startswith(("http://", "https://", "mailto:", "tel:")):
                uri = "https://" + uri
            # Reject garbage URIs that are actually just label text (e.g. "https://Live%20Demo")
            lowered_uri = uri.lower()
            if lowered_uri.startswith(("http://", "https://")):
                # decode a bit for matching
                decoded_hint = lowered_uri.replace("%20", " ")
                if "live demo" in decoded_hint or "live%20demo" in lowered_uri:
                    continue
                # require a plausible host (a dot in the hostname or known good domains)
                # this filters out things like "https://live"
                host_part = lowered_uri.split("://", 1)[1].split("/", 1)[0]
                if "." not in host_part and "localhost" not in host_part:
                    continue
            rect = annot.get("/Rect")
            if not rect or len(rect) < 4:
                continue

            try:
                x0, y0, x1, y1 = [float(v) for v in rect[:4]]
            except Exception:
                continue

            # pypdf uses PDF coords (origin bottom-left). pdfplumber uses origin top-left.
            # Convert: plumber_top = page_height - y1, plumber_bottom = page_height - y0
            try:
                page_height = float(reader.pages[page_idx].mediabox.height)
            except Exception:
                page_height = None
            if not page_height:
                continue
            top = page_height - y1
            bottom = page_height - y0

            # Find nearest text line above/overlapping this link rect.
            candidates = line_boxes.get(page_idx, [])
            best_ln = None
            best_dist = 1e9
            for ln in candidates:
                # Prefer lines close in vertical axis
                dist = abs(float(ln["top"]) - top)
                if dist < best_dist:
                    best_dist = dist
                    best_ln = ln

            nearest_text = (best_ln["text"] if best_ln else "") or ""
            matched_project = best_match(nearest_text)
            if not matched_project:
                # fallback: scan last ~15 lines above the rect for a project name mention
                nearby = sorted(candidates, key=lambda l: l["top"])
                # take lines within a window above the rect
                window = [l for l in nearby if l["top"] <= top + 25]
                window = window[-15:]
                for ln in reversed(window):
                    matched_project = best_match(ln["text"])
                    if matched_project:
                        break

            if not matched_project:
                continue

            result.setdefault(matched_project, [])
            # Label should primarily follow the actual URL domain (most reliable),
            # not the nearby text which can contain "Live Demo" even when the link is GitHub.
            uri_lower = uri.lower()
            label = "Link"
            if "github.com" in uri_lower:
                label = "GitHub"
            else:
                lt = nearest_text.lower()
                if "live" in lt or "demo" in lt:
                    label = "Live Demo"
                elif "github" in lt:
                    label = "GitHub"
            pair = (label, uri)
            if pair not in result[matched_project]:
                result[matched_project].append(pair)

    return result


def save_uploaded_pdf(file: UploadFile) -> str:
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    file_ext = filename.rsplit(".", 1)[-1].lower()
    file_name = token_hex(10)
    return os.path.join(uploads_dir, f"{file_name}.{file_ext}")


def normalize_list_of_strings(items):
    return [str(item).strip() for item in (items or []) if str(item).strip()]


def normalize_contact_link(value: str, service: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""

    value = value.replace("\\", "/").strip()
    for prefix in ("https://", "http://"):
        if value.lower().startswith(prefix):
            value = value[len(prefix):]
            break

    value = re.sub(r"^www\.", "", value, flags=re.IGNORECASE)
    lower = value.lower()

    if service == "linkedin":
        if "linkedin.com/" in lower:
            value = value[lower.index("linkedin.com/"):]
            path = value[len("linkedin.com/"):].lstrip("/")
            if path and not path.startswith((
                "in/",
                "company/",
                "school/",
                "feed/",
                "posts/",
                "jobs/",
                "pulse/",
                "learning/",
                "pub/",
            )):
                value = f"linkedin.com/in/{path}"
        elif lower.startswith("inin/"):
            value = value[2:]
        elif lower.startswith("in/"):
            value = f"linkedin.com/{value}"
        value = re.sub(r"^(linkedin(?:\.com)?/)+", "linkedin.com/", value, flags=re.IGNORECASE)

    elif service == "github":
        if "github.com/" in lower:
            value = value[lower.index("github.com/"):]
        value = re.sub(r"^(gh)+(?=github\.com/)", "", value, flags=re.IGNORECASE)
        value = re.sub(r"^(github(?:\.com)?/)+", "github.com/", value, flags=re.IGNORECASE)

    elif service == "leetcode":
        if "leetcode.com/" in lower:
            value = value[lower.index("leetcode.com/"):]
        elif lower.startswith("u/"):
            value = f"leetcode.com/{value}"
        value = re.sub(r"^(leetcode(?:\.com)?/)+", "leetcode.com/", value, flags=re.IGNORECASE)

    return value.rstrip("/")


def normalize_url(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://", "mailto:", "tel:")):
        return value
    if "@" in value and " " not in value and "/" not in value:
        return f"mailto:{value}"
    if value.replace("+", "").replace("-", "").replace(" ", "").isdigit():
        return f"tel:{value}"
    return f"https://{value}"


def display_link(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    for prefix in ("https://", "http://", "mailto:", "tel:"):
        if value.startswith(prefix):
            value = value[len(prefix):]
            break
    return value.rstrip("/")


def infer_headline_from_jd(jd_string: str) -> str:
    text = str(jd_string or "").lower()
    if not text.strip():
        return ""

    patterns = [
        (r"\bdata analyst\b", "Data Analyst"),
        (r"\bbusiness analyst\b", "Business Analyst"),
        (r"\bdata scientist\b", "Data Scientist"),
        (r"\bmachine learning engineer\b", "Machine Learning Engineer"),
        (r"\bml engineer\b", "Machine Learning Engineer"),
        (r"\bdata engineer\b", "Data Engineer"),
        (r"\bsoftware engineer\b", "Software Engineer"),
        (r"\bfull stack engineer\b", "Full Stack Engineer"),
        (r"\bfull stack developer\b", "Full Stack Developer"),
        (r"\bbackend engineer\b", "Backend Engineer"),
        (r"\bbackend developer\b", "Backend Developer"),
        (r"\bfrontend engineer\b", "Frontend Engineer"),
        (r"\bfront[\s-]?end developer\b", "Frontend Developer"),
        (r"\bfront[\s-]?end engineer\b", "Frontend Engineer"),
        (r"\bdevops engineer\b", "DevOps Engineer"),
        (r"\bqa engineer\b", "QA Engineer"),
        (r"\bproduct manager\b", "Product Manager"),
        (r"\bproject manager\b", "Project Manager"),
        (r"\bsystems engineer\b", "Systems Engineer"),
        (r"\bcloud engineer\b", "Cloud Engineer"),
        (r"\bsecurity engineer\b", "Security Engineer"),
        (r"\bmechanical engineer\b", "Mechanical Engineer"),
        (r"\bchemical engineer\b", "Chemical Engineer"),
        (r"\belectrical engineer\b", "Electrical Engineer"),
        (r"\bcivil engineer\b", "Civil Engineer"),
        (r"\bindustrial engineer\b", "Industrial Engineer"),
        (r"\bmanufacturing engineer\b", "Manufacturing Engineer"),
        (r"\bsoftware developer\b", "Software Developer"),
        (r"\bapplication developer\b", "Application Developer"),
        (r"\bdeveloper\b", "Developer"),
    ]

    for pattern, title in patterns:
        if re.search(pattern, text):
            return title

    fallback_roles = [
        ("analyst", "Analyst"),
        ("engineer", "Engineer"),
        ("scientist", "Scientist"),
        ("developer", "Developer"),
        ("consultant", "Consultant"),
        ("manager", "Manager"),
    ]
    for keyword, title in fallback_roles:
        if keyword in text:
            return title

    return ""


def group_skills(skills: list[str]) -> list[str]:
    grouped = {
        "Languages": [],
        "Developer Tools": [],
        "Technologies/Frameworks": [],
    }
    uncategorized = []

    language_terms = {
        "python", "c", "c++", "java", "javascript", "typescript", "sql",
        "html", "html5", "css", "css3", "r", "go", "rust", "php"
    }
    human_language_terms = {
        "english", "french", "german", "spanish", "hindi", "marathi", "tamil",
        "telugu", "kannada", "malayalam", "punjabi", "urdu", "arabic", "chinese",
        "japanese", "korean", "italian", "portuguese", "russian"
    }
    tool_terms = {
        "git", "github", "vscode", "visual studio code", "postman", "docker",
        "aws", "power bi", "powerbi", "excel", "mlflow", "dvc", "linux"
    }

    def add_unique(bucket: list[str], value: str):
        if value and value not in bucket:
            bucket.append(value)

    def split_skill_items(text: str) -> list[str]:
        parts = [part.strip() for part in re.split(r"[,;/]", text) if part.strip()]
        return parts if len(parts) > 1 else [text.strip()]

    for skill in skills:
        text = str(skill or "").strip()
        if not text:
            continue

        if ":" in text:
            label, value = text.split(":", 1)
            label = label.strip().lower()
            value = value.strip()
            if label in {"languages", "language", "programming"}:
                for item in [part.strip() for part in re.split(r"[,;/]", value) if part.strip()]:
                    item_lower = item.lower()
                    if item_lower in human_language_terms:
                        continue
                    if item_lower in language_terms:
                        add_unique(grouped["Languages"], item)
                continue
            if label in {"developer tools", "tools", "tooling"}:
                for item in [part.strip() for part in value.split(",") if part.strip()]:
                    add_unique(grouped["Developer Tools"], item)
                continue
            if label in {"technologies/frameworks", "technologies", "frameworks", "frameworks & libraries", "libraries"}:
                for item in [part.strip() for part in value.split(",") if part.strip()]:
                    add_unique(grouped["Technologies/Frameworks"], item)
                continue
            uncategorized.append(text)
            continue

        lowered = text.lower()
        normalized = lowered.replace("react js", "react").replace("restful apis", "rest apis")
        raw_items = split_skill_items(text)
        if len(raw_items) > 1:
            for item in raw_items:
                item_lower = item.lower()
                if item_lower in human_language_terms:
                    continue
                if item_lower in language_terms:
                    add_unique(grouped["Languages"], item)
                elif item_lower in tool_terms:
                    add_unique(grouped["Developer Tools"], item)
                else:
                    add_unique(grouped["Technologies/Frameworks"], item)
            continue
        if normalized in language_terms:
            add_unique(grouped["Languages"], text)
        elif normalized in tool_terms:
            add_unique(grouped["Developer Tools"], text)
        else:
            add_unique(grouped["Technologies/Frameworks"], text)

    result = []
    for label in ("Languages", "Developer Tools", "Technologies/Frameworks"):
        if grouped[label]:
            result.append(f"{label}: {', '.join(grouped[label])}")
    result.extend(uncategorized)
    return result


def collect_project_links(project: dict) -> list[dict]:
    def _looks_like_url_label(text: str) -> bool:
        value = str(text or "").strip().lower()
        if not value:
            return True
        if value.startswith(("http://", "https://", "www.")):
            return True
        if "://" in value or "/" in value or "@" in value:
            return True
        # A simple domain-like pattern often means the AI extracted the URL itself.
        return bool(re.search(r"\b[a-z0-9-]+\.[a-z]{2,}\b", value))

    def _normalize_visible_label(raw_label: str, href: str) -> str:
        label = str(raw_label or "").strip()
        href_l = str(href or "").lower()
        label_l = label.lower()

        if "github.com" in href_l or "github" in label_l:
            return "GitHub"
        if any(token in label_l or token in href_l for token in ("live", "demo", "preview", "site", "website")):
            return "Live Demo"
        if any(token in label_l or token in href_l for token in ("link", "url", "project")):
            return "Link"
        if _looks_like_url_label(label):
            if "github.com" in href_l:
                return "GitHub"
            if href_l:
                return "Link"
        return label or "Link"

    candidates = [
        ("GitHub", project.get("github_link") or project.get("github") or project.get("repo") or project.get("repository")),
        ("Live", project.get("url") or project.get("live_link") or project.get("live") or project.get("website") or project.get("project_link")),
        ("Demo", project.get("demo") or project.get("demo_link")),
        ("Link", project.get("link")),
    ]

    links = []
    seen = set()
    for label, raw_value in candidates:
        value = str(raw_value or "").strip()
        if not value:
            continue
        href = normalize_url(value)
        visible_label = _normalize_visible_label(label, href)
        key = (label, href)
        if key in seen:
            continue
        seen.add(key)
        links.append({
            "label": visible_label,
            "href": href,
            "display": display_link(value),
        })

    extra_links = project.get("links", [])
    if isinstance(extra_links, list):
        for item in extra_links:
            if isinstance(item, dict):
                label = str(item.get("label", "Link")).strip() or "Link"
                value = str(item.get("url") or item.get("href") or item.get("link") or "").strip()
                if not value:
                    continue
                href = normalize_url(value)
                visible_label = _normalize_visible_label(label, href)
                key = (label, href)
                if key in seen:
                    continue
                seen.add(key)
                links.append({
                    "label": visible_label,
                    "href": href,
                    "display": display_link(value),
                })

    return links


def compute_layout_scale(experience: list, projects: list, education: list, skills: list, extracurriculars: list, achievements: list, certifications: list, publications: list) -> str:
    bullet_count = sum(len(item.get("bullets", [])) for item in experience)
    bullet_count += sum(len(item.get("bullets", [])) for item in projects)
    bullet_count += sum(len(item.get("bullets", [])) for item in extracurriculars)

    section_items = (
        len(experience) * 5
        + len(projects) * 5
        + len(education) * 3
        + len(skills) * 2
        + len(extracurriculars) * 4
        + len(achievements) * 2
        + len(certifications) * 2
        + len(publications) * 2
    )
    density_score = bullet_count + section_items

    if density_score <= 28:
        return "scale-xl"
    if density_score <= 40:
        return "scale-lg"
    if density_score >= 78:
        return "scale-xs"
    if density_score >= 64:
        return "scale-sm"
    return "scale-md"


def build_resume_plain_text(parsed: dict) -> str:
    sections = []

    name = str(parsed.get("name", "")).strip()
    if name:
        sections.append(name)

    contact = parsed.get("contact", {}) or parsed.get("contact_information", {}) or {}
    contact_lines = []
    for key in ("email", "phone", "address", "linkedin", "github", "portfolio", "kaggle", "leetcode", "codeforces", "codechef", "google_scholar"):
        value = str(contact.get(key, "")).strip()
        if value:
            contact_lines.append(value)
    if contact_lines:
        sections.append("Contact\n" + "\n".join(contact_lines))

    summary = str(parsed.get("summary", "")).strip()
    if summary:
        sections.append("Summary\n" + summary)

    experience_lines = []
    for exp in parsed.get("experience", []) or []:
        if not isinstance(exp, dict):
            continue
        line_parts = [
            str(exp.get("company", "")).strip(),
            str(exp.get("title", "")).strip(),
            str(exp.get("dates", "")).strip(),
            str(exp.get("location", "")).strip(),
        ]
        headline = " | ".join(part for part in line_parts if part)
        bullets = [f"- {str(bullet).strip()}" for bullet in exp.get("bullets", []) or [] if str(bullet).strip()]
        entry = "\n".join(part for part in [headline, *bullets] if part)
        if entry:
            experience_lines.append(entry)
    if experience_lines:
        sections.append("Experience\n" + "\n".join(experience_lines))

    project_lines = []
    for project in parsed.get("projects", []) or []:
        if not isinstance(project, dict):
            continue
        line_parts = [
            str(project.get("name", "")).strip(),
            str(project.get("subtitle", "")).strip(),
            str(project.get("dates", "")).strip(),
        ]
        headline = " | ".join(part for part in line_parts if part)
        bullets = [f"- {str(bullet).strip()}" for bullet in project.get("bullets", []) or [] if str(bullet).strip()]
        entry = "\n".join(part for part in [headline, *bullets] if part)
        if entry:
            project_lines.append(entry)
    if project_lines:
        sections.append("Projects\n" + "\n".join(project_lines))

    skills = parsed.get("skills", []) or []
    if skills:
        sections.append("Skills\n" + "\n".join(str(skill).strip() for skill in skills if str(skill).strip()))

    education_lines = []
    for edu in parsed.get("education", []) or []:
        if not isinstance(edu, dict):
            continue
        line_parts = [
            str(edu.get("school", "")).strip(),
            str(edu.get("degree", "")).strip(),
            str(edu.get("year", "")).strip(),
            str(edu.get("score", "")).strip(),
        ]
        line = " | ".join(part for part in line_parts if part)
        if line:
            education_lines.append(line)
    if education_lines:
        sections.append("Education\n" + "\n".join(education_lines))

    for section_name, key in (
        ("Achievements", "achievements"),
        ("Certifications", "certifications"),
        ("Leadership / Extracurricular", "extracurriculars"),
        ("Publications", "publications"),
    ):
        lines = []
        for item in parsed.get(key, []) or []:
            if isinstance(item, dict):
                values = [str(value).strip() for value in item.values() if str(value).strip() and not isinstance(value, list)]
                bullets = item.get("bullets", []) if isinstance(item.get("bullets", []), list) else []
                values.extend(f"- {str(bullet).strip()}" for bullet in bullets if str(bullet).strip())
                line = "\n".join(values)
            else:
                line = str(item).strip()
            if line:
                lines.append(line)
        if lines:
            sections.append(section_name + "\n" + "\n".join(lines))

    return "\n\n".join(section for section in sections if section).strip()


def parse_ai_json_response(response_string: str) -> dict:
    try:
        parsed = json.loads(response_string)
    except Exception as e:
        try:
            import re
            match = re.search(r"\{[\s\S]*\}\s*$", response_string)
            if match:
                parsed = json.loads(match.group(0))
            else:
                raise
        except Exception:
            raise HTTPException(status_code=500, detail=f"Failed to parse AI JSON response: {e}")

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=500, detail="AI response JSON is not an object")
    return parsed


def build_resume_context(parsed: dict, jd_string: str = "") -> dict:
    contact = parsed.get("contact", {}) or parsed.get("contact_information", {}) or {}
    test_scores = parsed.get("test_scores", {}) or {}
    email = str(contact.get("email", "")).strip()
    phone = str(contact.get("phone", "")).strip()
    address = str(contact.get("address", "")).strip()
    linkedin = normalize_contact_link(contact.get("linkedin", ""), "linkedin")
    github = normalize_contact_link(contact.get("github", ""), "github")
    portfolio = str(contact.get("portfolio", "")).strip()
    kaggle = str(contact.get("kaggle", "")).strip()
    leetcode = normalize_contact_link(contact.get("leetcode", ""), "leetcode")
    codeforces = str(contact.get("codeforces", "")).strip()
    codechef = str(contact.get("codechef", "")).strip()
    google_scholar = str(contact.get("google_scholar", "")).strip()

    experience = []
    for job in parsed.get("experience", []) or []:
        if not isinstance(job, dict):
            continue
        experience.append({
            "title": str(job.get("title", "")).strip(),
            "company": str(job.get("company", "")).strip(),
            "dates": str(job.get("dates", "")).strip(),
            "location": str(job.get("location", "")).strip(),
            "bullets": normalize_list_of_strings(job.get("bullets", [])),
        })

    projects = []
    for project in parsed.get("projects", []) or []:
        if not isinstance(project, dict):
            continue
        links = collect_project_links(project)
        render_links = []
        seen_render_hrefs = set()
        for link in links:
            href = str(link.get("href", "")).strip()
            href_key = href.lower()
            if not href or href_key in seen_render_hrefs:
                continue
            seen_render_hrefs.add(href_key)
            render_links.append({
                "label": str(link.get("label", "Link")).strip() or "Link",
                "href": href,
                "display": str(link.get("display", "")).strip(),
            })
        # Prefer showing a non-GitHub link as the primary inline link (e.g., Live/Demo).
        primary_link = None
        for candidate in render_links:
            href = str(candidate.get("href", "")).lower()
            label = str(candidate.get("label", "")).lower()
            if "github.com" in href or "github" in label:
                continue
            primary_link = candidate
            break
        if not primary_link and render_links:
            primary_link = render_links[0]

        # Some model outputs only populate `links` but leave `github_link`/`url` blank.
        # Backfill those fields so older templates still show icons.
        github_link = str(project.get("github_link") or project.get("github", "")).strip()
        url = str(project.get("url") or project.get("website") or project.get("project_link") or "").strip()
        if (not github_link or not url) and links:
            for link in links:
                label = str(link.get("label", "")).lower()
                href = str(link.get("href", "")).strip()
                if not href:
                    continue
                if not github_link and "github" in label:
                    github_link = href
                # Label might not contain "github" (recovered labels can be whole lines),
                # so also detect github from the href itself.
                if not github_link and "github.com" in href:
                    github_link = href
                # Labels can be like "Live Demo" (from the PDF) so match by substring.
                if (
                    not url
                    and (
                        label in {"link", "project link", "live", "demo"}
                        or "live" in label
                        or "demo" in label
                    )
                ):
                    url = href
                # If we still don't know the type, treat non-GitHub href as the project's URL.
                if not url and href and "github.com" not in href:
                    url = href

        projects.append({
            "name": str(project.get("name", "")).strip(),
            "github_link": github_link,
            "url": url,
            "dates": str(project.get("dates") or project.get("date", "")).strip(),
            "subtitle": str(project.get("subtitle") or project.get("stack") or project.get("technologies", "")).strip(),
            "links": links,
            "render_links": render_links,
            "primary_link": primary_link,
            "bullets": normalize_list_of_strings(project.get("bullets") or project.get("achievements") or project.get("details") or []),
        })

    education = []
    education_items = parsed.get("education", []) or []
    for edu in education_items:
        if not isinstance(edu, dict):
            continue
        degree = str(edu.get("degree", "")).strip()
        school = str(edu.get("school") or edu.get("institution") or edu.get("university") or "").strip()
        year = str(edu.get("year") or edu.get("years") or edu.get("dates") or "").strip()
        score = str(edu.get("score") or edu.get("cgpa") or edu.get("sgpa") or edu.get("gpa") or edu.get("percentage") or edu.get("marks") or "").strip()
        school_text = f"{degree} {school}".lower()
        if not score:
            if "higher secondary" in school_text or "class 12" in school_text or "12" in school_text:
                class_12 = test_scores.get("class_12_score")
                if class_12 not in (None, ""):
                    score = f"12th Marks - {class_12}%"
            elif "secondary" in school_text or "class 10" in school_text or "10" in school_text:
                class_10 = test_scores.get("class_10_score")
                if class_10 not in (None, ""):
                    score = f"10th Marks - {class_10}%"
        education.append({
            "degree": degree,
            "school": school,
            "year": year,
            "score": score,
            "links": normalize_url(str(edu.get("links", "")).strip()),
        })

    certifications = []
    for cert in parsed.get("certifications", []) or []:
        if not isinstance(cert, dict):
            continue
        certifications.append({
            "name": str(cert.get("name", "")).strip(),
            "issuer": str(cert.get("issuer", "")).strip(),
            "year": str(cert.get("year", "")).strip(),
            "url": normalize_url(str(cert.get("url", "")).strip()),
        })

    extracurriculars = []
    for item in parsed.get("extracurriculars", []) or []:
        if not isinstance(item, dict):
            continue
        extracurriculars.append({
            "role": str(item.get("role", "")).strip(),
            "organization": str(item.get("organization", "")).strip(),
            "dates": str(item.get("dates", "")).strip(),
            "bullets": normalize_list_of_strings(item.get("bullets", [])),
            "url": normalize_url(str(item.get("url", "")).strip()),
        })

    publications = []
    for item in parsed.get("publications", []) or []:
        if not isinstance(item, dict):
            continue
        publications.append({
            "title": str(item.get("title", "")).strip(),
            "publisher": str(item.get("publisher", "")).strip(),
            "year": str(item.get("year", "")).strip(),
            "url": normalize_url(str(item.get("url", "")).strip()),
        })

    raw_skills = []
    for skill in parsed.get("skills", []) or []:
        if isinstance(skill, str) and skill.strip():
            raw_skills.append(skill.strip())
        elif isinstance(skill, dict):
            for key, value in skill.items():
                key_text = str(key).strip()
                value_text = str(value).strip()
                raw_skills.append(f"{key_text}: {value_text}" if value_text else key_text)
    skills = group_skills(raw_skills)
    achievements = normalize_list_of_strings(parsed.get("achievements", []))

    languages = []
    for skill in skills:
        skill_text = str(skill or "").strip()
        if skill_text.lower().startswith("languages:"):
            _, values = skill_text.split(":", 1)
            languages.extend([part.strip() for part in values.split(",") if part.strip()])

    awards = normalize_list_of_strings(parsed.get("awards", [])) or achievements
    layout_scale = compute_layout_scale(
        experience,
        projects,
        education,
        skills,
        extracurriculars,
        normalize_list_of_strings(parsed.get("achievements", [])),
        certifications,
        publications,
    )

    jd_headline = infer_headline_from_jd(jd_string)
    parsed_headline = str(
        parsed.get("headline")
        or parsed.get("title")
        or parsed.get("current_title")
        or parsed.get("role")
        or (experience[0]["title"] if experience and experience[0].get("title") else "")
    ).strip()
    headline = jd_headline or parsed_headline

    return {
        "name": str(parsed.get("name", "")).strip(),
        "headline": headline,
        "layout_scale": layout_scale,
        "contact": {
            "email": email,
            "email_href": normalize_url(email),
            "phone": phone,
            "phone_href": normalize_url(phone),
            "address": address,
            "linkedin": linkedin,
            "linkedin_href": normalize_url(linkedin),
            "linkedin_display": display_link(linkedin),
            "github": github,
            "github_href": normalize_url(github),
            "github_display": display_link(github),
            "portfolio": portfolio,
            "portfolio_href": normalize_url(portfolio),
            "portfolio_display": display_link(portfolio),
            "kaggle": kaggle,
            "kaggle_href": normalize_url(kaggle),
            "kaggle_display": display_link(kaggle),
            "leetcode": leetcode,
            "leetcode_href": normalize_url(leetcode),
            "leetcode_display": display_link(leetcode),
            "codeforces": codeforces,
            "codeforces_href": normalize_url(codeforces),
            "codeforces_display": display_link(codeforces),
            "codechef": codechef,
            "codechef_href": normalize_url(codechef),
            "codechef_display": display_link(codechef),
            "google_scholar": google_scholar,
            "google_scholar_href": normalize_url(google_scholar),
            "google_scholar_display": display_link(google_scholar),
        },
        "summary": str(parsed.get("summary", "")).strip(),
        "experience": experience,
        "projects": projects,
        "skills": skills,
        "languages": languages,
        "education": education,
        "certifications": certifications,
        "achievements": achievements,
        "awards": awards,
        "extracurriculars": extracurriculars,
        "publications": publications,
    }


@app.get("/health")
async def health_check():
    """Health check endpoint for deployment verification"""
    return {
        "status": "healthy",
        "database_initialized": db_init_status["ok"],
        "database_error": db_init_status["error"],
        "templates_dir": templates_dir,
        "static_dir": static_dir,
        "uploads_dir": uploads_dir,
        "resumes_dir": resumes_dir,
        "templates_exist": os.path.exists(templates_dir),
        "static_exist": os.path.exists(static_dir),
        "templates_files": os.listdir(templates_dir) if os.path.exists(templates_dir) else [],
        "static_files": os.listdir(static_dir) if os.path.exists(static_dir) else []
    }

@app.get("/", response_class=HTMLResponse)
async def landing_page(request: Request):
    """Landing page inspired by Tsenta marketing site."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/solutions", response_class=HTMLResponse)
async def solutions_page(request: Request):
    """Solutions page where users upload resume & JD."""
    return templates.TemplateResponse(request, "solutions.html")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Login page."""
    return templates.TemplateResponse(request, "login.html")


@app.get("/signup", response_class=HTMLResponse)
async def signup_page(request: Request):
    """Signup page."""
    return templates.TemplateResponse(request, "signup.html")


@app.get("/forgot-password", response_class=HTMLResponse)
async def forgot_password_page(request: Request):
    return templates.TemplateResponse(request, "forgot_password.html")


@app.get("/reset-password", response_class=HTMLResponse)
async def reset_password_page(request: Request):
    return templates.TemplateResponse(request, "reset_password.html")


@app.get("/about", response_class=HTMLResponse)
async def about_page(request: Request):
    """About page for the marketing frontend."""
    return templates.TemplateResponse(request, "aboutus.html")


@app.post("/api/signup/request-code")
async def request_signup_code(request: Request):
    try:
        payload = SignupCodeRequest(**(await request.json()))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    db = get_db()
    try:
        normalized_email = payload.email.lower()
        existing_user = db.query(User).filter(User.email == normalized_email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email is already registered")

        db.query(SignupVerificationCode).filter(
            SignupVerificationCode.email == normalized_email,
            SignupVerificationCode.used.is_(False),
        ).update({"used": True}, synchronize_session=False)

        signup_code = f"{random.randint(0, 999999):06d}"
        code_record = SignupVerificationCode(
            email=normalized_email,
            code=signup_code,
            expires_at=datetime.utcnow() + timedelta(minutes=10),
        )
        db.add(code_record)
        db.commit()

        try:
            send_signup_code_email(normalized_email, signup_code)
        except Exception:
            logger.exception("Failed to send sign-up verification email")
            raise HTTPException(status_code=500, detail="Could not send verification email. Please try again.")

        return JSONResponse({"success": True, "message": "Verification code sent to your email."})
    finally:
        db.close()


@app.post("/api/signup")
async def signup_user(request: Request):
    try:
        payload = UserSignup(**(await request.json()))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    db = get_db()
    try:
        normalized_email = payload.email.lower()
        existing_user = db.query(User).filter(User.email == normalized_email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email is already registered")

        code_record = db.query(SignupVerificationCode).filter(
            SignupVerificationCode.email == normalized_email,
            SignupVerificationCode.code == payload.code.strip(),
            SignupVerificationCode.used.is_(False),
        ).order_by(SignupVerificationCode.created_at.desc()).first()

        if not code_record or code_record.expires_at < datetime.utcnow():
            raise HTTPException(status_code=400, detail="This verification code is invalid or expired")

        user = User(
            name=payload.name.strip(),
            email=normalized_email,
            hashed_password=hash_password(payload.password),
        )
        code_record.used = True
        db.add(user)
        db.commit()
        db.refresh(user)

        request.session['user_id'] = user.id
        request.session['email'] = user.email

        return JSONResponse(
            {
                "success": True,
                "message": "Signup successful",
                "user": {"id": user.id, "name": user.name, "email": user.email},
            }
        )
    finally:
        db.close()


@app.post("/api/login")
async def login_user(request: Request):
    try:
        payload = UserLogin(**(await request.json()))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    db = get_db()
    try:
        user = db.query(User).filter(User.email == payload.email.lower()).first()
        if not user or not verify_password(payload.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        request.session['user_id'] = user.id
        request.session['email'] = user.email

        return JSONResponse(
            {
                "success": True,
                "message": "Login successful",
                "user": {"id": user.id, "name": user.name, "email": user.email},
            }
        )
    finally:
        db.close()


@app.post("/logout")
async def logout(request: Request):
    print("Session before clear:", dict(request.session))
    request.session.clear()
    return JSONResponse({"success": True})


@app.post("/api/login/verify")
async def verify_login_code(request: Request):
    try:
        UserLoginVerify(**(await request.json()))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    raise HTTPException(status_code=410, detail="Login verification is no longer required.")


@app.post("/api/forgot-password")
async def forgot_password(request: Request):
    try:
        payload = ForgotPasswordRequest(**(await request.json()))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    db = get_db()
    try:
        user = db.query(User).filter(User.email == payload.email.lower()).first()
        response_data = {
            "success": True,
            "message": "If this email exists, a reset code has been prepared.",
        }

        if not user:
            return JSONResponse(response_data)

        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used.is_(False),
        ).update({"used": True}, synchronize_session=False)

        reset_code = f"{random.randint(0, 999999):06d}"
        reset_record = PasswordResetToken(
            user_id=user.id,
            token=reset_code,
            expires_at=datetime.utcnow() + timedelta(minutes=10),
        )
        db.add(reset_record)
        db.commit()

        sent = False
        email_error = ""
        try:
            sent = send_password_reset_email(user.email, reset_code)
        except Exception as exc:
            sent = False
            email_error = str(exc)

        response_data["message"] = (
            "Password reset code sent successfully."
            if sent
            else "Reset code generated. Configure SMTP to email it automatically."
        )

        if not is_production_environment():
            response_data["reset_code"] = reset_code
            if email_error:
                response_data["email_debug"] = email_error

        response_data["redirect_url"] = "/reset-password"

        return JSONResponse(response_data)
    finally:
        db.close()


@app.post("/api/reset-password")
async def reset_password(request: Request):
    try:
        payload = ResetPasswordRequest(**(await request.json()))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    db = get_db()
    try:
        normalized_email = payload.email.lower()
        reset_record = db.query(PasswordResetToken).filter(
            PasswordResetToken.token == payload.code.strip(),
            PasswordResetToken.used.is_(False),
        ).first()

        if not reset_record or reset_record.expires_at < datetime.utcnow():
            raise HTTPException(status_code=400, detail="This reset code is invalid or expired")

        user = db.query(User).filter(User.id == reset_record.user_id).first()
        if not user or user.email.lower() != normalized_email:
            raise HTTPException(status_code=404, detail="User not found")

        user.hashed_password = hash_password(payload.password)
        reset_record.used = True
        db.commit()

        return JSONResponse({"success": True, "message": "Password reset successful"})
    finally:
        db.close()


@app.post("/get-optimised-resume")
async def upload_resume(request: Request, jd_string: str, file: UploadFile = File(...), template_id: int = 1, style_id: int = 1):
    """Upload a resume PDF file and JD with selected template and style"""
    user_id = request.session.get('user_id')
    print("Session:", dict(request.session))
    if not user_id:
        return JSONResponse(status_code=401, content={"error": "Not logged in"})
    
    file_path = None
    pdf_path = None
    response = None
    try:
        file_path = save_uploaded_pdf(file)
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        async with request_semaphore:
            resume_string = await asyncio.to_thread(extract_pdf_text, file_path)
            normalized_resume_string = normalize_links(resume_string)
            extracted_links = extract_project_links(normalized_resume_string)
            extracted_pub_links = extract_publication_links(normalized_resume_string)
            mapped_links = map_project_demo_links(normalized_resume_string)
            project_link_map = extract_project_link_map(normalized_resume_string)

            prompt = create_prompt(resume_string, jd_string)
            try:
                response_string = await get_resume_response(prompt)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"AI generation error: {e}")

            parsed = parse_ai_json_response(response_string)
            original_data = await asyncio.to_thread(process_resume, file_path)
            if "publications" not in parsed and original_data.get("publications"):
                parsed["publications"] = original_data["publications"]
            pdf_project_link_map = await asyncio.to_thread(
                extract_project_links_from_pdf,
                file_path,
                [p.get("name") for p in (parsed.get("projects") or []) if isinstance(p, dict)],
            )
            effective_map = pdf_project_link_map or project_link_map
            parsed = inject_links(parsed, effective_map, mapped_links, extracted_pub_links)

            use_default_template = template_id == 0
            template_content = None

            if not use_default_template:
                template_filename = f"template{template_id}.html"
                template_path = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "html", template_filename)
                try:
                    with open(template_path, 'r', encoding='utf-8') as f:
                        template_content = f.read()
                except FileNotFoundError:
                    try:
                        template = templates.env.get_template('resume_template.html')
                        use_default_template = True
                    except Exception:
                        raise HTTPException(status_code=500, detail=f"Template {template_filename} not found")
            else:
                template = templates.env.get_template('resume_template.html')

            if template_id == 6:
                style_filename = "style3.css"
            elif template_id < 7:
                style_filename = f"style{style_id}.css"
            else:
                style_filename = ""

            css_content = ""
            if style_filename:
                style_path = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "css", style_filename)
                try:
                    with open(style_path, 'r', encoding='utf-8') as f:
                        css_content = f.read()
                except FileNotFoundError:
                    default_style_path = os.path.join(BASE_DIR, 'resumes', 'style.css')
                    try:
                        with open(default_style_path, 'r', encoding='utf-8') as f:
                            css_content = f.read()
                    except FileNotFoundError:
                        pass

            context = build_resume_context(parsed, jd_string)
            if not use_default_template and template_content:
                from jinja2 import Template as Jinja2Template
                jinja_template = Jinja2Template(template_content)
                html_content = jinja_template.render(**context)
                html_content = html_content.replace('href="STYLESHEET_PLACEHOLDER"', '')
                if css_content:
                    html_content = html_content.replace('</head>', f'<style>{css_content}</style></head>')
            else:
                template = templates.env.get_template('resume_template.html')
                html_content = template.render(**context)

            pdf_path = os.path.join(resumes_dir, f"optimized_resume_{uuid.uuid4()}.pdf")

            def _render_pdf():
                from weasyprint import HTML
                if not use_default_template and template_content:
                    HTML(string=html_content).write_pdf(pdf_path)
                else:
                    css_path = os.path.join(resumes_dir, 'style.css')
                    HTML(string=html_content).write_pdf(pdf_path, stylesheets=[css_path])

            try:
                await asyncio.to_thread(_render_pdf)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to render PDF: {e}")

            if not os.path.exists(pdf_path):
                raise HTTPException(status_code=404, detail="PDF file not found after generation")

            wants_meta = request.headers.get("X-Return-Meta", "").lower() == "true"
            if wants_meta:
                response = JSONResponse({
                    "success": True,
                    "download_url": "/download-optimized-resume",
                })
            else:
                response = FileResponse(
                    pdf_path,
                    media_type="application/pdf",
                    filename="optimized_resume.pdf",
                    background=BackgroundTask(_cleanup_files, [pdf_path])
                )

            return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
        if pdf_path and os.path.exists(pdf_path) and not isinstance(response, FileResponse):
            os.remove(pdf_path)

@app.post("/get-ats-score")
async def get_score(jd_string: str, file: UploadFile = File(...)):
    """Upload a resume PDF file and JD"""
    file_path = None
    try:
        file_path = save_uploaded_pdf(file)
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        async with request_semaphore:
            resume_string = await asyncio.to_thread(extract_pdf_text, file_path)
            ats_score = await asyncio.to_thread(ats_scoring, resume_string, jd_string)

        return parse_ai_json_response(ats_score)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)


@app.get("/download-optimized-resume")
async def download_optimized_resume(file_name: str | None = None):
    if not file_name:
        raise HTTPException(status_code=400, detail="A file_name query parameter is required")

    pdf_path = os.path.join(resumes_dir, os.path.basename(file_name))
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Optimized resume PDF not found")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename="optimized_resume.pdf"
    )
# @app.post("/optimize-resume")
# async def optimize_resume(
#     resume_name: str = Form(..., description="Name of the uploaded resume file"),
#     job_description: str = Form(..., description="Job description text")
# ):
#     """
#     Process an uploaded resume with a job description to create an optimized version.
    
#     Args:
#         file_name: Name of the uploaded resume file in the uploads folder
#         job_description: Text of the job description to optimize for
    
#     Returns:
#         dict: Contains the optimized resume in markdown format
#     """
#     try:
#         # Construct the file path
#         resume_path=f"uploads/{resume_name}"

        
        
#         # Check if file exists
#         if not os.path.exists(resume_path):
#             raise HTTPException(status_code=404, detail=f"Resume file '{resume_name}' not found in uploads folder")
        
#         # Process the resume
#         new_resume = process_resume(resume_name, job_description)
        
#         # if new_resume.startswith("Failed"):
#         #     raise HTTPException(status_code=500, detail=new_resume)
        
#         output_pdf_file = "resumes/optimized_resume.pdf"
#         html_content = markdown(new_resume)
    

#         # Convert HTML to PDF and save (use existing styles filename)
#         HTML(string=html_content).write_pdf(output_pdf_file, stylesheets=['resumes/style.css'])
#         pdf_path = "resumes/optimized_resume.pdf"
#         if not os.path.exists(pdf_path):
#             raise HTTPException(status_code=404, detail="PDF file not found")
        
#         return FileResponse(
#             pdf_path,
#             media_type="application/pdf",
#             filename="optimized_resume.pdf"
#         )
    
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Error exporting resume: {str(e)}")


       


# @app.post("/export-resume")
# async def export_resume_endpoint(
#     resume_content: str = Form(..., description="Markdown content of the resume")
# ):
#     """
#     Export the optimized resume to PDF format.
    
#     Args:
#         resume_content: Markdown formatted resume content
    
#     Returns:
#         FileResponse: PDF file download
#     """
#     try:
#         # Export the resume to PDF
#         result = export_resume(resume_content)
        
        
#         # Return the PDF file
#         pdf_path = "resumes/resume_new.pdf"
#         if not os.path.exists(pdf_path):
#             raise HTTPException(status_code=404, detail="PDF file not found")
        
#         return FileResponse(
#             pdf_path,
#             media_type="application/pdf",
#             filename="optimized_resume.pdf"
#         )
    
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Error exporting resume: {str(e)}")


# @app.get("/")
# async def root():
#     """Health check endpoint"""
#     return {
#         "message": "Resume Optimizer API is running",
#         "endpoints": {
#             "POST /upload-resume": "Upload resume PDF file",
#             "POST /optimize-resume": "Process uploaded resume with job description",
#             "POST /export-resume": "Export optimized resume to PDF"
#         }
#     }


# @app.get("/list-resumes")
# async def list_resumes():
#     """List all uploaded resume files"""
#     try:
#         files = [f for f in os.listdir("uploads") if f.endswith('.pdf')]
#         return {
#             "success": True,
#             "files": files,
#             "count": len(files)
#         }
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Error listing files: {str(e)}")


if __name__ == "__main__":
    # For production, use environment variable PORT (set by hosting platforms)
    port = int(os.environ.get("PORT", 8000))
    # Keep local startup single-process by default on Windows.
    reload = os.environ.get("ENABLE_RELOAD", "false").lower() == "true"
    if os.name == "nt":
        # Windows + asyncio + uvicorn reload can hit Proactor socket edge cases.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=reload,
        reload_excludes=[".venv/*", "__pycache__/*", "uploads/*", "resumes/*"],
    )
