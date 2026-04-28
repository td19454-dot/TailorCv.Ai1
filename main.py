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
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
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

try:
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests
except ImportError:
    id_token = None
    google_requests = None

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
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()

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

# OPTIMIZATION: Cache for templates and CSS to avoid repeated file I/O
_template_cache = {}
_css_cache = {}


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
    to recover URLs from extracted text when the resume uses link icons (â†—).
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


def _clean_resume_line(line: str) -> str:
    line = re.sub(r"\s+", " ", str(line or "")).strip()
    return line.strip("|_: ")


def _normalize_resume_text(text: str) -> str:
    value = str(text or "")
    replacements = {
        "â€“": "-",
        "â€”": "-",
        "â€": "\"",
        "â€¢": "•",
        "\u00a0": " ",
    }
    for bad, good in replacements.items():
        value = value.replace(bad, good)
    return value


def _split_resume_sections(text: str) -> dict[str, list[str]]:
    section_aliases = {
        "summary": ["summary", "professional summary", "profile", "objective"],
        "education": ["education", "academic background", "academics"],
        "experience": ["experience", "work experience", "employment", "professional experience"],
        "projects": ["projects", "project"],
        "skills": ["skills", "technical skills", "core competencies"],
        "certifications": ["certifications", "certification", "licenses"],
        "awards": ["awards", "achievements", "accomplishments", "honors"],
        "publications": ["publications", "publication", "research papers"],
        "extracurriculars": ["extracurricular", "extracurriculars", "activities", "leadership", "volunteer"],
    }

    alias_to_section = {}
    for section, aliases in section_aliases.items():
        for alias in aliases:
            alias_to_section[re.sub(r"[^a-z]", "", alias.lower())] = section

    sections: dict[str, list[str]] = {key: [] for key in section_aliases}
    current_section = "summary"

    def is_heading_line(value: str) -> bool:
        candidate = str(value or "").strip()
        if not candidate:
            return False
        line_no_colon = candidate.rstrip(":").strip()
        if len(line_no_colon) < 2 or len(line_no_colon) > 55:
            return False
        if re.search(r"[@]|https?://|www\.|\d{4,}", line_no_colon.lower()):
            return False
        words = [w for w in line_no_colon.split() if w]
        if len(words) > 6:
            return False
        alpha_chars = [ch for ch in line_no_colon if ch.isalpha()]
        upper_ratio = (
            sum(1 for ch in alpha_chars if ch.isupper()) / max(1, len(alpha_chars))
            if alpha_chars
            else 0.0
        )
        title_ratio = (
            sum(1 for w in words if w[:1].isupper()) / max(1, len(words))
            if words
            else 0.0
        )
        return (
            candidate.endswith(":")
            or line_no_colon.isupper()
            or upper_ratio > 0.72
            or title_ratio > 0.9
        )

    raw_lines = [str(line).rstrip() for line in str(text or "").splitlines()]
    for raw_line in raw_lines:
        line = _clean_resume_line(raw_line)
        if not line:
            if sections[current_section] and sections[current_section][-1] != "":
                sections[current_section].append("")
            continue

        normalized = re.sub(r"[^a-z]", "", line.lower().rstrip(":"))
        is_heading_like = is_heading_line(line)
        matched_section = alias_to_section.get(normalized) if is_heading_like else None
        if not matched_section and is_heading_like:
            for alias_key, section_key in alias_to_section.items():
                if not alias_key:
                    continue
                if normalized == alias_key:
                    matched_section = section_key
                    break
                if normalized.startswith(alias_key):
                    suffix = normalized[len(alias_key):]
                    if suffix in {"", "andtools", "andtechnologies", "tools", "technologies", "details"}:
                        matched_section = section_key
                        break
                if alias_key.startswith(normalized) and len(normalized) >= 4:
                    matched_section = section_key
                    break

        if matched_section:
            current_section = matched_section
            continue

        sections[current_section].append(line)

    return sections


def _extract_contact_from_resume_text(text: str, lines: list[str]) -> dict[str, str]:
    email_match = re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", text)
    email = email_match.group(0).strip() if email_match else ""

    phone = ""
    for match in re.finditer(r"(?:\+?\d[\d()\-\s]{7,}\d)", text):
        candidate = re.sub(r"\s+", " ", match.group(0)).strip()
        digits = re.sub(r"\D", "", candidate)
        if 8 <= len(digits) <= 15:
            phone = candidate
            break

    urls = re.findall(r"(https?://[^\s)]+|www\.[^\s)]+|[A-Za-z0-9.-]+\.(?:com|in|org|io|dev|ai|net)/[^\s)]*)", text)
    normalized_urls = []
    for url in urls:
        clean = str(url).strip().rstrip(".,);")
        if not clean:
            continue
        normalized_urls.append(clean if clean.startswith(("http://", "https://")) else f"https://{clean}")

    def first_url_containing(keyword: str) -> str:
        for url in normalized_urls:
            if keyword in url.lower():
                return url
        return ""

    linkedin = first_url_containing("linkedin")
    github = first_url_containing("github")
    kaggle = first_url_containing("kaggle")
    leetcode = first_url_containing("leetcode")
    google_scholar = first_url_containing("scholar.google")

    portfolio = ""
    for url in normalized_urls:
        lower = url.lower()
        if all(token not in lower for token in ("linkedin", "github", "kaggle", "leetcode", "scholar.google")):
            portfolio = url
            break

    top_lines = [_clean_resume_line(line) for line in lines[:8] if _clean_resume_line(line)]
    location = ""
    for line in top_lines:
        if email and email in line:
            continue
        if phone and phone in line:
            continue
        if "@" in line or "http" in line.lower() or "www." in line.lower():
            continue
        if re.search(r"\b(?:india|usa|united states|uk|canada|australia|remote)\b", line.lower()) or "," in line:
            location = line
            break

    return {
        "email": email,
        "phone": phone,
        "linkedin": display_link(linkedin) if linkedin else "",
        "github": display_link(github) if github else "",
        "kaggle": display_link(kaggle) if kaggle else "",
        "leetcode": display_link(leetcode) if leetcode else "",
        "googleScholar": display_link(google_scholar) if google_scholar else "",
        "portfolio": display_link(portfolio) if portfolio else "",
        "location": location,
    }


def _split_paragraphs(lines: list[str]) -> list[list[str]]:
    paragraphs: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        clean = _clean_resume_line(line)
        if not clean:
            if current:
                paragraphs.append(current)
                current = []
            continue
        current.append(clean)
    if current:
        paragraphs.append(current)
    return paragraphs


def _is_contact_or_location_line(line: str) -> bool:
    value = _clean_resume_line(line)
    if not value:
        return True
    lower = value.lower()
    if re.search(r"[@]|https?://|www\.|linkedin|github|kaggle|leetcode|scholar\.google", lower):
        return True
    if re.search(r"\b\d{5,}\b", lower):
        return True
    if re.search(r"(?:\+?\d[\d()\-\s]{7,}\d)", value):
        return True
    if re.search(r"\b(?:road|rd|street|st|avenue|ave|lane|ln|apt|apartment|sector|block|zip|pincode|pin)\b", lower):
        return True
    if re.search(r"\b(?:india|usa|united states|uk|canada|australia|remote)\b", lower):
        return True
    if "," in value and len(value.split()) <= 8:
        return True
    return False


def _is_probable_name_line(line: str) -> bool:
    value = _clean_resume_line(line)
    if not value:
        return False
    if _is_contact_or_location_line(value):
        return False
    words = [w for w in value.split() if w]
    if not (2 <= len(words) <= 5):
        return False
    if any(re.search(r"\d", w) for w in words):
        return False
    # Typical name line should not include heavy punctuation.
    if re.search(r"[|/\\:;@]", value):
        return False
    return True


def _is_probable_headline_line(line: str) -> bool:
    value = _clean_resume_line(line)
    if not value:
        return False
    if _is_contact_or_location_line(value):
        return False
    if len(value.split()) < 2 or len(value.split()) > 12:
        return False
    lower = value.lower()
    role_keywords = (
        "engineer", "developer", "analyst", "scientist", "manager", "designer",
        "consultant", "intern", "student", "architect", "specialist", "lead"
    )
    return any(keyword in lower for keyword in role_keywords)


def _is_likely_skill_token(token: str) -> bool:
    value = _clean_resume_line(token).strip(",.;")
    if not value:
        return False
    lower = value.lower()
    if re.search(r"(19|20)\d{2}", lower):
        return False
    if re.search(r"\b(led|organized|volunteer|captain|coordinator|member|participated|managed|responsible)\b", lower):
        return False
    words = [w for w in value.split() if w]
    if len(words) > 6 and ":" not in value:
        return False
    if len(words) > 12:
        return False
    return True


def _parse_cv_text_to_editor_data(text: str) -> dict:
    raw_text = str(text or "")
    raw_lines = [line for line in raw_text.splitlines()]
    lines = [_clean_resume_line(line) for line in raw_lines if _clean_resume_line(line)]
    sections = _split_resume_sections(raw_text)

    contact = _extract_contact_from_resume_text(raw_text, lines)
    top_lines = lines[:12]
    likely_name = ""
    likely_headline = ""
    for line in top_lines:
        if _is_probable_name_line(line) and not likely_name:
            likely_name = line
            continue
        if _is_probable_headline_line(line) and not likely_headline:
            likely_headline = line
    if not likely_headline:
        for line in top_lines:
            clean = _clean_resume_line(line)
            if not clean or clean == likely_name:
                continue
            if _is_contact_or_location_line(clean):
                continue
            if 2 <= len(clean.split()) <= 8:
                likely_headline = clean
                break

    summary_lines = sections.get("summary", [])
    filtered_summary_lines = []
    for line in summary_lines:
        clean = _clean_resume_line(line)
        if not clean:
            continue
        if clean in {likely_name, likely_headline}:
            continue
        if _is_contact_or_location_line(clean):
            continue
        if len(clean.split()) < 5:
            continue
        filtered_summary_lines.append(clean)
    summary = " ".join(filtered_summary_lines[:4]).strip() if filtered_summary_lines else ""
    if not summary:
        fallback_summary = []
        for line in lines[2:12]:
            clean = _clean_resume_line(line)
            if not clean or clean in {likely_name, likely_headline}:
                continue
            if _is_contact_or_location_line(clean):
                continue
            if len(clean.split()) >= 7:
                fallback_summary.append(clean)
        summary = " ".join(fallback_summary[:2]).strip()

    education = []
    for paragraph in _split_paragraphs(sections.get("education", []))[:6]:
        school = ""
        degree = ""
        year = ""
        score = ""
        for line in paragraph:
            lower = line.lower()
            if not school and re.search(r"\b(university|college|school|institute|academy)\b", lower):
                school = line
            elif not degree and re.search(r"\b(b\.?tech|bachelor|master|m\.?tech|mba|phd|diploma|b\.?e\.?|m\.?s\.?)\b", lower):
                degree = line
            if not year:
                match = re.search(r"(19|20)\d{2}(?:\s*[-–]\s*(19|20)?\d{2}|(?:\s*-\s*present)|(?:\s*to\s*present))?", line, re.IGNORECASE)
                if match:
                    year = match.group(0)
            if not score and re.search(r"\b(cgpa|gpa|grade|percentage|percent|score)\b", lower):
                score = line
        if paragraph and not school:
            school = paragraph[0]
        if paragraph and not degree and len(paragraph) > 1:
            degree = paragraph[1]
        if school or degree or year or score:
            education.append({"school": school, "degree": degree, "year": year, "score": score})

    experience = []
    for paragraph in _split_paragraphs(sections.get("experience", []))[:8]:
        company = paragraph[0] if paragraph else ""
        title = paragraph[1] if len(paragraph) > 1 else ""
        dates = ""
        location = ""
        detail_lines = []
        if paragraph and "|" in paragraph[0]:
            left, right = [part.strip() for part in paragraph[0].split("|", 1)]
            if left and right:
                title = left
                company = right
        elif paragraph and " at " in paragraph[0].lower():
            parts = re.split(r"\bat\b", paragraph[0], flags=re.IGNORECASE, maxsplit=1)
            if len(parts) == 2:
                title = parts[0].strip() or title
                company = parts[1].strip() or company
        for line in paragraph:
            if not dates:
                date_match = re.search(r"(19|20)\d{2}(?:\s*[-–]\s*(?:present|(19|20)\d{2}))?", line, re.IGNORECASE)
                if date_match:
                    dates = date_match.group(0)
            if not location and "," in line and len(line.split()) <= 8 and not re.search(r"@|https?://|www\.", line.lower()):
                location = line
            if re.match(r"^[\-\u2022\*]\s*", line):
                detail_lines.append(re.sub(r"^[\-\u2022\*]\s*", "", line).strip())
        if not detail_lines:
            detail_lines = [line for line in paragraph[2:6] if line and line != dates and line != location]
        details = "\n".join(detail_lines).strip()
        if any((company, title, dates, location, details)):
            experience.append(
                {
                    "company": company,
                    "title": title,
                    "dates": dates,
                    "location": location,
                    "details": details,
                }
            )

    projects = []
    for paragraph in _split_paragraphs(sections.get("projects", []))[:8]:
        name = paragraph[0] if paragraph else ""
        subtitle = paragraph[1] if len(paragraph) > 1 else ""
        dates = ""
        urls = re.findall(r"(https?://[^\s)]+|www\.[^\s)]+|[A-Za-z0-9.-]+\.(?:com|in|org|io|dev|ai|net)/[^\s)]*)", "\n".join(paragraph))
        normalized_urls = []
        for url in urls:
            clean = str(url).strip().rstrip(".,);")
            if clean:
                normalized_urls.append(clean if clean.startswith(("http://", "https://")) else f"https://{clean}")

        github_link = ""
        live_url = ""
        for url in normalized_urls:
            if "github" in url.lower() and not github_link:
                github_link = url
            elif not live_url:
                live_url = url

        for line in paragraph:
            if not dates:
                date_match = re.search(r"(19|20)\d{2}(?:\s*[-–]\s*(?:present|(19|20)\d{2}))?", line, re.IGNORECASE)
                if date_match:
                    dates = date_match.group(0)

        detail_lines = []
        for line in paragraph:
            if re.match(r"^[\-\u2022\*]\s*", line):
                detail_lines.append(re.sub(r"^[\-\u2022\*]\s*", "", line).strip())
        if not detail_lines:
            detail_lines = [line for line in paragraph[2:6] if line not in normalized_urls and line != dates]
        details = "\n".join(detail_lines).strip()

        if any((name, subtitle, dates, github_link, live_url, details)):
            projects.append(
                {
                    "name": name,
                    "subtitle": subtitle,
                    "dates": dates,
                    "url": live_url,
                    "github_link": github_link,
                    "details": details,
                }
            )

    skills = []
    for line in sections.get("skills", [])[:30]:
        clean = re.sub(r"^[\-\u2022\*]\s*", "", line).strip()
        if not clean:
            continue
        if not _is_likely_skill_token(clean):
            continue
        if ":" in clean and len(clean.split(":", 1)[0]) <= 25:
            if _is_likely_skill_token(clean.split(":", 1)[1]):
                skills.append({"name": clean})
            continue
        tokens = [token.strip() for token in re.split(r"[,\|;/]", clean) if token.strip()]
        if len(tokens) > 1:
            for token in tokens:
                if _is_likely_skill_token(token):
                    skills.append({"name": token})
        else:
            skills.append({"name": clean})
    deduped_skills = []
    seen_skills = set()
    for skill in skills:
        name = str(skill.get("name", "")).strip()
        key = name.lower()
        if not name or key in seen_skills:
            continue
        seen_skills.add(key)
        deduped_skills.append({"name": name})
    skills = deduped_skills[:40]

    certifications = []
    for line in sections.get("certifications", [])[:20]:
        clean = re.sub(r"^[\-\u2022\*]\s*", "", line).strip()
        if not clean:
            continue
        year_match = re.search(r"(19|20)\d{2}", clean)
        certifications.append(
            {
                "name": clean,
                "issuer": "",
                "year": year_match.group(0) if year_match else "",
                "url": "",
            }
        )

    awards = []
    for line in sections.get("awards", [])[:20]:
        clean = re.sub(r"^[\-\u2022\*]\s*", "", line).strip()
        if clean:
            awards.append({"title": clean})

    publications = []
    for line in sections.get("publications", [])[:20]:
        clean = re.sub(r"^[\-\u2022\*]\s*", "", line).strip()
        if not clean:
            continue
        year_match = re.search(r"(19|20)\d{2}", clean)
        publications.append(
            {
                "title": clean,
                "publisher": "",
                "year": year_match.group(0) if year_match else "",
                "url": "",
            }
        )

    extracurriculars = []
    for line in sections.get("extracurriculars", [])[:20]:
        clean = re.sub(r"^[\-\u2022\*]\s*", "", line).strip()
        if not clean:
            continue
        extracurriculars.append({"role": clean, "organization": "", "dates": "", "url": ""})

    detected_sections = [
        section
        for section, values in sections.items()
        if values and section in {"summary", "education", "experience", "projects", "skills", "certifications", "awards", "publications", "extracurriculars"}
    ]

    return {
        "cvData": {
            "personalInfo": {
                "name": likely_name,
                "headline": likely_headline,
                "email": contact["email"],
                "phone": contact["phone"],
                "location": contact["location"],
                "linkedin": contact["linkedin"],
                "kaggle": contact["kaggle"],
                "github": contact["github"],
                "portfolio": contact["portfolio"],
                "googleScholar": contact["googleScholar"],
                "leetcode": contact["leetcode"],
                "summary": summary,
            },
            "education": education,
            "experience": experience,
            "projects": projects,
            "skills": skills,
            "extracurriculars": extracurriculars,
            "certifications": certifications,
            "awards": awards,
            "publications": publications,
        },
        "meta": {
            "detected_sections": detected_sections,
        },
    }


def _cv_data_quality_score(payload: dict) -> int:
    cv_data = payload.get("cvData", {}) if isinstance(payload, dict) else {}
    if not isinstance(cv_data, dict):
        return 0
    score = 0
    personal = cv_data.get("personalInfo", {}) if isinstance(cv_data.get("personalInfo", {}), dict) else {}
    for field in ("name", "email", "phone", "summary", "headline"):
        if str(personal.get(field, "")).strip():
            score += 1
    for section in ("education", "experience", "projects", "skills", "certifications", "awards", "publications", "extracurriculars"):
        items = cv_data.get(section, [])
        if isinstance(items, list) and items:
            score += 2
    headline = str(personal.get("headline", "")).strip()
    if headline and _is_contact_or_location_line(headline):
        score -= 3

    skills_items = cv_data.get("skills", [])
    if isinstance(skills_items, list) and skills_items:
        skill_names = [
            str(item.get("name", "")).strip()
            for item in skills_items
            if isinstance(item, dict)
        ]
        suspicious = [name for name in skill_names if name and not _is_likely_skill_token(name)]
        if skill_names and len(suspicious) >= max(2, len(skill_names) // 3):
            score -= 3

    score = max(0, score)
    return score


def _to_text(value) -> str:
    return str(value or "").strip()


def _normalize_string_list(value) -> list[str]:
    if isinstance(value, list):
        candidates = value
    elif value is None:
        candidates = []
    else:
        candidates = [value]

    seen: set[str] = set()
    output: list[str] = []
    for item in candidates:
        text = _to_text(item)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(text)
    return output


def _join_date_range(start_date: str, end_date: str) -> str:
    start = _to_text(start_date)
    end = _to_text(end_date)
    if end.lower() in {"current", "present"}:
        end = "Present"
    if start and end:
        return f"{start} - {end}"
    return start or end


def _strict_schema_to_editor_payload(parsed: dict) -> dict:
    data = parsed if isinstance(parsed, dict) else {}
    personal = data.get("personal_info", {}) if isinstance(data.get("personal_info"), dict) else {}

    summary = _to_text(data.get("summary"))
    personal_summary = summary

    cv_data: dict = {
        "personalInfo": {
            "name": _to_text(personal.get("full_name")),
            "headline": _to_text(personal.get("headline")),
            "email": _to_text(personal.get("email")),
            "phone": _to_text(personal.get("phone")),
            "location": _to_text(personal.get("location")),
            "linkedin": _to_text(personal.get("linkedin")),
            "kaggle": _to_text(personal.get("kaggle")),
            "github": _to_text(personal.get("github")),
            "portfolio": _to_text(personal.get("portfolio")),
            "googleScholar": _to_text(personal.get("google_scholar")),
            "leetcode": _to_text(personal.get("leetcode")),
            "summary": personal_summary,
        },
        "education": [],
        "experience": [],
        "projects": [],
        "skills": [],
        "extracurriculars": [],
        "certifications": [],
        "awards": [],
        "publications": [],
    }

    for skill in _normalize_string_list(data.get("skills")):
        cv_data["skills"].append({"name": skill})

    for edu in data.get("education", []) if isinstance(data.get("education"), list) else []:
        if not isinstance(edu, dict):
            continue
        degree = _to_text(edu.get("degree"))
        field = _to_text(edu.get("field_of_study"))
        if degree and field and field.lower() not in degree.lower():
            degree_value = f"{degree} - {field}"
        else:
            degree_value = degree or field
        description = _to_text(edu.get("description"))
        cv_data["education"].append(
            {
                "school": _to_text(edu.get("institution")),
                "degree": degree_value,
                "year": _join_date_range(edu.get("start_date"), edu.get("end_date")),
                "score": description,
            }
        )

    for exp in data.get("experience", []) if isinstance(data.get("experience"), list) else []:
        if not isinstance(exp, dict):
            continue
        bullets = _normalize_string_list(exp.get("description"))
        technologies = _normalize_string_list(exp.get("technologies"))
        details_lines = bullets[:]
        if technologies:
            details_lines.append(f"Technologies: {', '.join(technologies)}")

        cv_data["experience"].append(
            {
                "company": _to_text(exp.get("company")),
                "title": _to_text(exp.get("role")),
                "dates": _join_date_range(exp.get("start_date"), exp.get("end_date")),
                "location": _to_text(exp.get("location")),
                "details": "\n".join(details_lines).strip(),
            }
        )

    for project in data.get("projects", []) if isinstance(data.get("projects"), list) else []:
        if not isinstance(project, dict):
            continue
        bullets = _normalize_string_list(project.get("description"))
        technologies = _normalize_string_list(project.get("technologies"))
        details_lines = bullets[:]
        if technologies:
            details_lines.append(f"Technologies: {', '.join(technologies)}")
        cv_data["projects"].append(
            {
                "name": _to_text(project.get("name")),
                "subtitle": ", ".join(technologies),
                "dates": "",
                "url": _to_text(project.get("link")),
                "github_link": "",
                "details": "\n".join(details_lines).strip(),
            }
        )

    for award in data.get("awards", []) if isinstance(data.get("awards"), list) else []:
        if not isinstance(award, dict):
            continue
        title = _to_text(award.get("title"))
        issuer = _to_text(award.get("issuer"))
        date = _to_text(award.get("date"))
        desc = _to_text(award.get("description"))
        parts = [part for part in [title, issuer, date, desc] if part]
        if parts:
            cv_data["awards"].append({"title": " | ".join(parts)})

    for pub in data.get("publications", []) if isinstance(data.get("publications"), list) else []:
        if not isinstance(pub, dict):
            continue
        publisher = _to_text(pub.get("publisher"))
        authors = _normalize_string_list(pub.get("authors"))
        description = _to_text(pub.get("description"))
        if authors:
            publisher = f"{publisher} | Authors: {', '.join(authors)}" if publisher else f"Authors: {', '.join(authors)}"
        if description:
            publisher = f"{publisher} | {description}" if publisher else description
        cv_data["publications"].append(
            {
                "title": _to_text(pub.get("title")),
                "publisher": publisher,
                "year": _to_text(pub.get("date")),
                "url": _to_text(pub.get("link")),
            }
        )

    for activity in data.get("extracurricular_activities", []) if isinstance(data.get("extracurricular_activities"), list) else []:
        if not isinstance(activity, dict):
            continue
        descriptions = _normalize_string_list(activity.get("description"))
        role = _to_text(activity.get("role"))
        if descriptions:
            role = f"{role} | {'; '.join(descriptions)}" if role else "; ".join(descriptions)
        cv_data["extracurriculars"].append(
            {
                "role": role,
                "organization": _to_text(activity.get("organization")),
                "dates": _join_date_range(activity.get("start_date"), activity.get("end_date")),
                "url": "",
            }
        )

    for cert in data.get("certifications", []) if isinstance(data.get("certifications"), list) else []:
        if not isinstance(cert, dict):
            continue
        cv_data["certifications"].append(
            {
                "name": _to_text(cert.get("name")),
                "issuer": _to_text(cert.get("issuer")),
                "year": _to_text(cert.get("date")),
                "url": _to_text(cert.get("link")),
            }
        )

    additional = data.get("additional_sections", [])
    if isinstance(additional, list):
        for section in additional:
            if not isinstance(section, dict):
                continue
            section_name = _to_text(section.get("section_name")) or "Additional Section"
            entries = section.get("entries", [])
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                title = _to_text(entry.get("title"))
                org = _to_text(entry.get("organization"))
                date = _to_text(entry.get("date"))
                desc = _to_text(entry.get("description"))
                parts = [part for part in [section_name, title, org, date, desc] if part]
                if parts:
                    cv_data["awards"].append({"title": " | ".join(parts)})

    detected_sections = [
        key
        for key, value in data.items()
        if key in {
            "summary",
            "skills",
            "education",
            "experience",
            "projects",
            "awards",
            "publications",
            "extracurricular_activities",
            "certifications",
            "additional_sections",
        }
        and (value if not isinstance(value, list) else len(value) > 0)
    ]

    return {
        "cvData": cv_data,
        "meta": {"detected_sections": detected_sections},
    }


async def _parse_cv_text_to_editor_data_ai(raw_text: str) -> dict | None:
    if not str(raw_text or "").strip():
        return None

    prompt = f"""
You are an advanced resume/CV parser. Your task is to extract structured data from raw, messy CV text (including PDF-extracted text).

Return STRICT JSON following the schema below.

CRITICAL RULES:
- Output ONLY valid JSON. No explanations or markdown.
- Never hallucinate or invent information.
- If a field is missing -> return null or [].
- Preserve ALL relevant information.
- Merge repeated sections into one.
- Handle multiple subsections correctly.

CORE PARSING LOGIC:
1. MULTIPLE SUBSECTIONS:
- Any section (Experience, Projects, Education, Awards, etc.) may contain multiple entries.
- Each entry MUST be extracted as a separate object.
- Detect new entries using titles, organizations, dates, and bullet groups.
- NEVER merge multiple entries into one.

2. REPEATED SECTIONS:
- If a section appears multiple times, merge into one array.

3. UNKNOWN / EXTRA SECTIONS:
- If new sections appear, map them to the closest existing category OR store in "additional_sections".

4. SPLIT CONTENT:
- If one entry is broken across lines/pages, combine into one.

5. BULLET POINTS:
- Always store as arrays of strings.

OUTPUT JSON SCHEMA:
{{
  "personal_info": {{
    "full_name": null,
    "headline": null,
    "email": null,
    "phone": null,
    "location": null,
    "linkedin": null,
    "github": null,
    "portfolio": null,
    "kaggle": null,
    "google_scholar": null,
    "leetcode": null
  }},
  "summary": null,
  "skills": [],
  "education": [
    {{
      "institution": null,
      "degree": null,
      "field_of_study": null,
      "start_date": null,
      "end_date": null,
      "description": null
    }}
  ],
  "experience": [
    {{
      "company": null,
      "role": null,
      "start_date": null,
      "end_date": null,
      "location": null,
      "description": [],
      "technologies": []
    }}
  ],
  "projects": [
    {{
      "name": null,
      "description": [],
      "technologies": [],
      "link": null
    }}
  ],
  "awards": [
    {{
      "title": null,
      "issuer": null,
      "date": null,
      "description": null
    }}
  ],
  "publications": [
    {{
      "title": null,
      "authors": [],
      "publisher": null,
      "date": null,
      "link": null,
      "description": null
    }}
  ],
  "extracurricular_activities": [
    {{
      "organization": null,
      "role": null,
      "start_date": null,
      "end_date": null,
      "description": []
    }}
  ],
  "certifications": [
    {{
      "name": null,
      "issuer": null,
      "date": null,
      "link": null
    }}
  ],
  "additional_sections": [
    {{
      "section_name": "",
      "entries": [
        {{
          "title": null,
          "organization": null,
          "date": null,
          "description": null
        }}
      ]
    }}
  ]
}}

SECTION MAPPING GUIDE:
- Work Experience / Professional Experience -> experience
- Projects / Personal Projects -> projects
- Education -> education
- Achievements / Honors -> awards
- Research / Papers -> publications
- Activities / Leadership -> extracurricular_activities
- Certifications / Courses -> certifications
- If unsure, use additional_sections.

DATA NORMALIZATION:
- Dates -> "MMM YYYY" (e.g., "Nov 2025")
- "Present" and "Current" -> "Present"
- Remove duplicates in skills
- Extract technologies from descriptions where possible

FINAL VALIDATION:
- Ensure multiple entries are preserved
- Ensure repeated sections are merged
- Ensure no data is lost
- Ensure valid JSON format

INPUT:
\"\"\"
{raw_text}
\"\"\"
"""
    try:
        ai_response = await get_resume_response(prompt, model="gpt-4o-mini", temperature=0.0)
        strict_parsed = parse_ai_json_response(ai_response)
        if not isinstance(strict_parsed, dict):
            return None
        normalized_payload = _strict_schema_to_editor_payload(strict_parsed)
        return normalized_payload
    except Exception:
        return None


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

@app.get("/favicon.png", include_in_schema=False)
async def favicon_ico():
    return FileResponse(
        os.path.join(static_dir, "favicon.png"),
        media_type="image/x-icon",
    )


@app.get("/logo.png", include_in_schema=False)
async def site_logo():
    return FileResponse(
        os.path.join(static_dir, "logo.png"),
        media_type="image/png",
    )


@app.get("/site.webmanifest", include_in_schema=False)
async def site_webmanifest():
    return FileResponse(
        os.path.join(static_dir, "site.webmanifest"),
        media_type="application/manifest+json",
    )


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    return FileResponse(
        os.path.join(static_dir, "robots.txt"),
        media_type="text/plain",
    )


@app.get("/", response_class=HTMLResponse)
async def landing_page(request: Request):
    """Landing page inspired by Tsenta marketing site."""
    return templates.TemplateResponse(
        request,
        "index.html",
        {"request": request},
    )


@app.get("/solutions", response_class=HTMLResponse)
async def solutions_page(request: Request):
    """Solutions page where users upload resume & JD."""
    return templates.TemplateResponse(
        request,
        "solutions.html",
        {"request": request},
    )


@app.get("/optimize", response_class=HTMLResponse)
async def optimize_page(request: Request):
    """Alias route for optimization flow; renders Solutions page."""
    return templates.TemplateResponse(
        request,
        "solutions.html",
        {"request": request},
    )


@app.get("/templates", response_class=HTMLResponse)
async def templates_page(request: Request):
    """Templates gallery page."""
    return templates.TemplateResponse(
        request,
        "templates.html",
        {"request": request},
    )


@app.get("/ats-analysis", response_class=HTMLResponse)
async def ats_analysis_page(request: Request):
    """Dedicated ATS analysis page."""
    return templates.TemplateResponse(
        request,
        "ats_analysis.html",
        {"request": request},
    )


@app.get("/modify-cv", response_class=HTMLResponse)
async def modify_cv_page(request: Request):
    """Manual CV editing page."""
    return templates.TemplateResponse(
        request,
        "modify_cv.html",
        {"request": request},
    )


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Login page."""
    return templates.TemplateResponse(
        request,
        "login.html",
        {
            "request": request,
            "google_client_id": GOOGLE_CLIENT_ID,
        },
    )


@app.get("/signup", response_class=HTMLResponse)
async def signup_page(request: Request):
    """Signup page."""
    return templates.TemplateResponse(
        request,
        "signup.html",
        {"request": request},
    )


@app.get("/forgot-password", response_class=HTMLResponse)
async def forgot_password_page(request: Request):
    return templates.TemplateResponse(
        request,
        "forgot_password.html",
        {"request": request},
    )


@app.get("/reset-password", response_class=HTMLResponse)
async def reset_password_page(request: Request):
    return templates.TemplateResponse(
        request,
        "reset_password.html",
        {"request": request},
    )


@app.get("/about", response_class=HTMLResponse)
async def about_page(request: Request):
    """About page for the marketing frontend."""
    return templates.TemplateResponse(
        request,
        "aboutus.html",
        {"request": request},
    )


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


@app.post("/api/login/google")
async def login_with_google(request: Request):
    """Verify a Google ID token and log the user in (create user if first time)."""
    body = await request.json()
    token = body.get("credential") or body.get("id_token") or body.get("token")

    if id_token is None or google_requests is None:
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is unavailable because the google-auth package is not installed.",
        )

    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google login is not configured on this server.")

    if not token:
        raise HTTPException(status_code=400, detail="Missing Google credential.")

    try:
        idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        logger.exception("Google token verification failed")
        raise HTTPException(status_code=401, detail="Invalid Google token.")

    email = (idinfo.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Google account email is required.")

    name = idinfo.get("name") or idinfo.get("given_name") or email.split("@")[0]

    db = get_db()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            # Create a password placeholder so the column constraint is satisfied.
            user = User(name=name, email=email, hashed_password=hash_password(token_hex(16)))
            db.add(user)
            db.commit()
            db.refresh(user)

        request.session["user_id"] = user.id
        request.session["email"] = user.email

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
async def upload_resume(
    request: Request,
    jd_string: str | None = Form(None),
    file: UploadFile = File(...),
    template_id: int | None = Form(1),
    style_id: int | None = Form(1),
):
    """Upload a resume PDF file and JD with selected template and style"""
    if jd_string is None:
        jd_string = request.query_params.get("jd_string", "")
    if template_id is None:
        template_id = int(request.query_params.get("template_id", 1))
    if style_id is None:
        style_id = int(request.query_params.get("style_id", 1))
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

            # OPTIMIZATION: Run all link extractions in parallel instead of sequentially
            link_tasks = [
                asyncio.to_thread(extract_project_links, normalized_resume_string),
                asyncio.to_thread(extract_publication_links, normalized_resume_string),
                asyncio.to_thread(map_project_demo_links, normalized_resume_string),
                asyncio.to_thread(extract_project_link_map, normalized_resume_string),
            ]
            extracted_links, extracted_pub_links, mapped_links, project_link_map = await asyncio.gather(*link_tasks)

            prompt = create_prompt(resume_string, jd_string)
            try:
                response_string = await get_resume_response(prompt)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"AI generation error: {e}")

            parsed = parse_ai_json_response(response_string)

            # OPTIMIZATION: Removed duplicate process_resume() call that was making a second OpenAI API call
            # The AI response already contains the optimized data - no need to re-extract original data

            # Extract project links from PDF for better accuracy (only if needed)
            project_names = [p.get("name") for p in (parsed.get("projects") or []) if isinstance(p, dict)]
            if project_names:
                pdf_project_link_map = await asyncio.to_thread(
                    extract_project_links_from_pdf,
                    file_path,
                    project_names,
                )
                effective_map = pdf_project_link_map or project_link_map
            else:
                effective_map = project_link_map

            parsed = inject_links(parsed, effective_map, mapped_links, extracted_pub_links)

            use_default_template = template_id == 0
            template_content = None

            # OPTIMIZATION: Use cached templates to avoid repeated file I/O
            if not use_default_template:
                template_filename = f"template{template_id}.html"
                if template_filename in _template_cache:
                    template_content = _template_cache[template_filename]
                else:
                    template_path = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "html", template_filename)
                    try:
                        with open(template_path, 'r', encoding='utf-8') as f:
                            template_content = f.read()
                            _template_cache[template_filename] = template_content  # Cache it
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
            # OPTIMIZATION: Use cached CSS to avoid repeated file I/O
            if style_filename:
                if style_filename in _css_cache:
                    css_content = _css_cache[style_filename]
                else:
                    style_path = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "css", style_filename)
                    try:
                        with open(style_path, 'r', encoding='utf-8') as f:
                            css_content = f.read()
                            _css_cache[style_filename] = css_content  # Cache it
                    except FileNotFoundError:
                        default_style_path = os.path.join(BASE_DIR, 'resumes', 'style.css')
                        try:
                            with open(default_style_path, 'r', encoding='utf-8') as f:
                                css_content = f.read()
                                _css_cache[style_filename] = css_content
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
                # OPTIMIZATION: Use faster WeasyPrint rendering options
                if not use_default_template and template_content:
                    HTML(string=html_content, base_url=BASE_DIR).write_pdf(
                        pdf_path,
                        optimize_size=('fonts',)  # Skip font subsetting for speed
                    )
                else:
                    css_path = os.path.join(resumes_dir, 'style.css')
                    HTML(string=html_content, base_url=BASE_DIR).write_pdf(
                        pdf_path,
                        stylesheets=[css_path],
                        optimize_size=('fonts',)
                    )

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
            ats_score = await ats_scoring(resume_string, jd_string)

        return parse_ai_json_response(ats_score)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/extract-cv-from-pdf")
@app.post("/api/extract-cv-from-pdf/")
@app.post("/extract-cv-from-pdf")
@app.post("/extract-cv-from-pdf/")
async def extract_cv_from_pdf(file: UploadFile = File(...)):
    """Extract structured CV data from an uploaded PDF for the Modify CV editor."""
    file_path = None
    try:
        file_path = save_uploaded_pdf(file)
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        extracted_text = await asyncio.to_thread(extract_pdf_text, file_path)
        if not extracted_text or not extracted_text.strip():
            raise HTTPException(status_code=400, detail="No extractable text found in this PDF.")

        parsed_payload = _parse_cv_text_to_editor_data(extracted_text)
        # Heuristic parser first, AI fallback for difficult resume layouts.
        if _cv_data_quality_score(parsed_payload) < 8:
            ai_payload = await _parse_cv_text_to_editor_data_ai(extracted_text)
            if ai_payload and _cv_data_quality_score(ai_payload) >= _cv_data_quality_score(parsed_payload):
                parsed_payload = ai_payload
        return parsed_payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract CV data: {exc}")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/extract-cv-from-text")
@app.post("/api/extract-cv-from-text/")
@app.post("/extract-cv-from-text")
@app.post("/extract-cv-from-text/")
async def extract_cv_from_text(request: Request):
    """Extract structured CV data from pasted plain text for the Modify CV editor."""
    try:
        payload = await request.json()
        cv_text = ""
        if isinstance(payload, dict):
            cv_text = str(payload.get("cvText") or payload.get("cv_text") or "").strip()

        if not cv_text:
            raise HTTPException(status_code=400, detail="No CV text provided.")
        if len(cv_text) < 60:
            raise HTTPException(status_code=400, detail="CV text is too short to extract reliable data.")

        parsed_payload = _parse_cv_text_to_editor_data(cv_text)
        if _cv_data_quality_score(parsed_payload) < 8:
            ai_payload = await _parse_cv_text_to_editor_data_ai(cv_text)
            if ai_payload and _cv_data_quality_score(ai_payload) >= _cv_data_quality_score(parsed_payload):
                parsed_payload = ai_payload
        return parsed_payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract CV data from text: {exc}")


@app.get("/api/resume-templates")
async def list_resume_templates():
    """Return available built-in resume templates."""
    templates_html_dir = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "html")
    if not os.path.isdir(templates_html_dir):
        raise HTTPException(status_code=404, detail="Resume templates directory not found")

    items = []
    for filename in sorted(os.listdir(templates_html_dir)):
        if not filename.lower().endswith(".html"):
            continue
        match = re.match(r"template(\d+)\.html$", filename.lower())
        if not match:
            continue
        template_id = int(match.group(1))
        items.append(
            {
                "id": template_id,
                "name": f"Template {template_id}",
                "filename": filename,
            }
        )
    return {"templates": items}


@app.post("/api/render-template-preview")
async def render_template_preview(request: Request):
    """Render selected template HTML with provided cvData."""
    payload = await request.json()
    template_id = int(payload.get("templateId", 1))
    cv_data = payload.get("cvData") or payload.get("resumeData", {}) or {}
    html_output = _render_custom_cv_html(template_id, cv_data)
    return {"html": html_output}


@app.post("/api/download-cv-pdf")
async def download_cv_pdf(request: Request):
    """Generate a styled PDF from modify-cv builder data."""
    payload = await request.json()
    template_id = int(payload.get("templateId", 1))
    cv_data = payload.get("cvData") or payload.get("resumeData", {}) or {}

    html_output = _render_custom_cv_html(template_id, cv_data)
    pdf_path = os.path.join(resumes_dir, f"custom_cv_{uuid.uuid4()}.pdf")
    try:
        from weasyprint import HTML

        await asyncio.to_thread(lambda: HTML(string=html_output).write_pdf(pdf_path))
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename="custom_cv.pdf",
            background=BackgroundTask(_cleanup_files, [pdf_path])
        )
    except Exception as exc:
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {exc}")


@app.post("/api/download-cv-pdf-browser")
async def download_cv_pdf_browser(
    template_id: int = Form(...),
    cv_data_json: str = Form(...),
):
    """Browser-native PDF download via form submit."""
    try:
        cv_data = json.loads(cv_data_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid CV data payload")

    html_output = _render_custom_cv_html(template_id, cv_data)
    pdf_path = os.path.join(resumes_dir, f"custom_cv_{uuid.uuid4()}.pdf")
    try:
        from weasyprint import HTML

        await asyncio.to_thread(lambda: HTML(string=html_output).write_pdf(pdf_path))
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename="custom_cv.pdf",
            background=BackgroundTask(_cleanup_files, [pdf_path])
        )
    except Exception as exc:
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {exc}")


def _render_custom_cv_html(template_id: int, cv_data: dict) -> str:
    template_filename = f"template{template_id}.html"
    template_path = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "html", template_filename)
    if not os.path.exists(template_path):
        raise HTTPException(status_code=404, detail="Selected template not found")

    try:
        with open(template_path, "r", encoding="utf-8") as f:
            template_content = f.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Unable to read template: {exc}")

    context = _build_custom_cv_context(cv_data)

    try:
        from jinja2 import Template as Jinja2Template
        jinja_template = Jinja2Template(template_content)
        html_output = jinja_template.render(**context)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render template: {exc}")

    style_filename = ""
    if template_id == 6:
        style_filename = "style3.css"
    elif template_id < 7:
        style_filename = "style1.css"

    if style_filename:
        style_path = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "css", style_filename)
        css_content = ""
        try:
            with open(style_path, "r", encoding="utf-8") as f:
                css_content = f.read()
        except OSError:
            css_content = ""
        if css_content:
            html_output = html_output.replace('href="STYLESHEET_PLACEHOLDER"', "")
            html_output = html_output.replace("</head>", f"<style>{css_content}</style></head>")

    return html_output


def _build_custom_cv_context(cv_data: dict) -> dict:
    data = cv_data if isinstance(cv_data, dict) else {}
    personal = data.get("personalInfo", {}) if isinstance(data.get("personalInfo", {}), dict) else {}
    education_data = data.get("education", []) if isinstance(data.get("education", []), list) else []
    experience_data = data.get("experience", []) if isinstance(data.get("experience", []), list) else []
    projects_data = data.get("projects", []) if isinstance(data.get("projects", []), list) else []
    publications_data = data.get("publications", []) if isinstance(data.get("publications", []), list) else []
    skills_data = data.get("skills", []) if isinstance(data.get("skills", []), list) else []
    certifications_data = data.get("certifications", []) if isinstance(data.get("certifications", []), list) else []
    extracurriculars_data = data.get("extracurriculars", []) if isinstance(data.get("extracurriculars", []), list) else []
    awards_data = data.get("awards", []) if isinstance(data.get("awards", []), list) else []

    def split_bullets(value: str) -> list[str]:
        text = str(value or "").strip()
        if not text:
            return []
        return [line.strip().lstrip("-").strip() for line in text.splitlines() if line.strip()]

    normalized_education = []
    for edu in education_data:
        if not isinstance(edu, dict):
            continue
        if not any(str(edu.get(key, "")).strip() for key in ("school", "degree", "year", "score", "details")):
            continue
        normalized_education.append(
            {
                "school": str(edu.get("school", "")).strip(),
                "degree": str(edu.get("degree", "")).strip(),
                "year": str(edu.get("year", "")).strip(),
                "score": str(edu.get("score", "")).strip() or str(edu.get("details", "")).strip(),
            }
        )

    normalized_experience = []
    for exp in experience_data:
        if not isinstance(exp, dict):
            continue
        bullets = exp.get("bullets") if isinstance(exp.get("bullets"), list) else split_bullets(exp.get("details", ""))
        if not any(str(exp.get(key, "")).strip() for key in ("company", "title", "dates", "location", "details")) and not bullets:
            continue
        normalized_experience.append(
            {
                "company": str(exp.get("company", "")).strip(),
                "title": str(exp.get("title", "")).strip(),
                "dates": str(exp.get("dates", "")).strip(),
                "location": str(exp.get("location", "")).strip(),
                "bullets": [str(item).strip() for item in bullets if str(item).strip()],
            }
        )

    normalized_projects = []
    for project in projects_data:
        if not isinstance(project, dict):
            continue
        bullets = project.get("bullets") if isinstance(project.get("bullets"), list) else split_bullets(project.get("details", ""))
        if not any(str(project.get(key, "")).strip() for key in ("name", "subtitle", "dates", "url", "github_link", "details")) and not bullets:
            continue
        links = []
        if str(project.get("github_link", "")).strip():
            href = normalize_url(str(project.get("github_link", "")).strip())
            links.append({"label": "GitHub", "href": href, "display": display_link(href)})
        if str(project.get("url", "")).strip():
            href = normalize_url(str(project.get("url", "")).strip())
            links.append({"label": "Live Demo", "href": href, "display": display_link(href)})
        normalized_projects.append(
            {
                "name": str(project.get("name", "")).strip(),
                "subtitle": str(project.get("subtitle", "")).strip(),
                "dates": str(project.get("dates", "")).strip(),
                "url": str(project.get("url", "")).strip(),
                "github_link": str(project.get("github_link", "")).strip(),
                "links": links,
                "bullets": [str(item).strip() for item in bullets if str(item).strip()],
            }
        )

    normalized_publications = []
    for publication in publications_data:
        if not isinstance(publication, dict):
            continue
        if not any(str(publication.get(key, "")).strip() for key in ("title", "publisher", "year", "url", "details")):
            continue
        normalized_publications.append(
            {
                "title": str(publication.get("title", "")).strip(),
                "publisher": str(publication.get("publisher", "")).strip(),
                "year": str(publication.get("year", "")).strip(),
                "url": str(publication.get("url", "")).strip(),
            }
        )

    normalized_skills = []
    for skill in skills_data:
        if isinstance(skill, dict):
            name = str(skill.get("name", "")).strip()
            details = str(skill.get("details", "")).strip()
            if not name and not details:
                continue
            normalized_skills.append(f"{name}: {details}" if details else name)
        elif isinstance(skill, str) and skill.strip():
            normalized_skills.append(skill.strip())

    normalized_extracurriculars = []
    for item in extracurriculars_data:
        if not isinstance(item, dict):
            continue
        bullets = item.get("bullets") if isinstance(item.get("bullets"), list) else split_bullets(item.get("details", ""))
        if not any(str(item.get(key, "")).strip() for key in ("role", "organization", "dates", "url", "details")) and not bullets:
            continue
        normalized_extracurriculars.append(
            {
                "role": str(item.get("role", "")).strip(),
                "organization": str(item.get("organization", "")).strip(),
                "dates": str(item.get("dates", "")).strip(),
                "url": str(item.get("url", "")).strip(),
                "bullets": [str(bullet).strip() for bullet in bullets if str(bullet).strip()],
            }
        )

    normalized_certifications = []
    for cert in certifications_data:
        if not isinstance(cert, dict):
            continue
        if not any(str(cert.get(key, "")).strip() for key in ("name", "issuer", "year", "url", "details")):
            continue
        normalized_certifications.append(
            {
                "name": str(cert.get("name", "")).strip(),
                "issuer": str(cert.get("issuer", "")).strip(),
                "year": str(cert.get("year", "")).strip(),
                "url": str(cert.get("url", "")).strip(),
            }
        )

    normalized_awards = []
    for award in awards_data:
        if isinstance(award, dict):
            title = str(award.get("title", "")).strip()
            if title:
                normalized_awards.append(title)
        elif isinstance(award, str) and award.strip():
            normalized_awards.append(award.strip())

    return {
        "name": personal.get("name", ""),
        "headline": personal.get("headline", ""),
        "summary": personal.get("summary", ""),
        "contact": {
            "email": personal.get("email", ""),
            "phone": personal.get("phone", ""),
            "address": personal.get("location", ""),
            "linkedin": personal.get("linkedin", ""),
            "github": personal.get("github", ""),
            "portfolio": personal.get("portfolio", ""),
            "kaggle": personal.get("kaggle", ""),
            "email_href": normalize_url(personal.get("email", "")),
            "phone_href": normalize_url(personal.get("phone", "")),
            "linkedin_href": normalize_url(personal.get("linkedin", "")),
            "github_href": normalize_url(personal.get("github", "")),
            "portfolio_href": normalize_url(personal.get("portfolio", "")),
            "kaggle_href": normalize_url(personal.get("kaggle", "")),
            "linkedin_display": display_link(personal.get("linkedin", "")),
            "github_display": display_link(personal.get("github", "")),
            "portfolio_display": display_link(personal.get("portfolio", "")),
            "kaggle_display": display_link(personal.get("kaggle", "")),
        },
        "education": normalized_education,
        "experience": normalized_experience,
        "projects": normalized_projects,
        "skills": normalized_skills,
        "publications": normalized_publications,
        "certifications": normalized_certifications,
        "awards": normalized_awards,
        "achievements": normalized_awards,
        "extracurriculars": normalized_extracurriculars,
        "languages": [],
        "layout_scale": "scale-md",
    }


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

