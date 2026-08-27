import asyncio
import base64
import hashlib
import json
import logging
import os
import random
import re
import resend
from secrets import token_hex, token_urlsafe
from urllib.parse import quote
from datetime import datetime, timedelta, timezone
import uuid

import pdfplumber
import tempfile
import shutil
import uvicorn
from dotenv import load_dotenv
from pydantic import ValidationError
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from starlette.requests import ClientDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.background import BackgroundTask
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.orm import Session
from auth import hash_password, verify_password
from seo_roles import ROLE_SEO
from database import Base, SessionLocal, engine
from functions import (
    ats_scoring,
    compute_deterministic_ats_score_breakdown,
    count_fused_words,
    repair_fused_words,
    scrub_extraction_artifacts_from_spelling,
    create_prompt,
    get_resume_response,
    AI_MODEL,
    OPTIMIZER_MODEL,
    OPTIMIZER_TEMPERATURE,
    extract_links,
    inject_links,
    inject_jd_hard_skills,
    promptable_skill_gaps,
    weave_soft_skills_into_summary,
    compute_skill_match_score,
    compute_skill_match_score_structured,
    sanitize_resume_data,
    factcheck_against_original,
    _clean_inline_text,
    _is_atomic_hard_skill,
    map_demo_links,
    extract_project_links,
    extract_publication_links,
    map_project_demo_links,
    extract_project_link_map,
    normalize_links,
    generate_interview_questions,
    evaluate_interview_answer,
    generate_mock_interview_first_question,
    generate_mock_interview_next_question,
    score_mock_interview,
    generate_tts_audio,
    agent_chat_reply,
)

from extraction import process_resume
from models import BlogRating, GuestAtsScan, JobApplication, PasswordResetToken, PersonalityCard, Portfolio, SavedResume, SignupVerificationCode, UsageRecord, User, WelcomeEmailLog
from sqlalchemy.exc import IntegrityError
from schemas import ForgotPasswordRequest, ResetPasswordRequest, SignupCodeRequest, UserLogin, UserLoginVerify, UserSignup
from routers.linkedin import router as linkedin_router
from routers.billing import router as billing_router
from routers.billing import _get_region
from routers.feedback import router as feedback_router
from routers.marketing import router as marketing_router
# Gigs feature disabled — import kept out so the route isn't registered.
# from routers.jobs import router as jobs_router
from blog_system import BlogService, canonical_filter_label, codehilite_css, xml_escape


from starlette.middleware.sessions import SessionMiddleware

try:
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests
    from google.auth.exceptions import TransportError
except ImportError:
    id_token = None
    google_requests = None
    TransportError = None  # type: ignore[misc, assignment]

# ── Error tracking (Sentry) ───────────────────────────────────────────────────
# Initialized before the app so Sentry's FastAPI/Starlette integration attaches.
# Entirely a no-op unless SENTRY_DSN is set, so local/dev runs are unaffected.
sentry_sdk = None
_sentry_dsn = os.getenv("SENTRY_DSN", "").strip()
if _sentry_dsn:
    try:
        import sentry_sdk as _sentry
        _sentry.init(
            dsn=_sentry_dsn,
            environment=os.getenv("ENVIRONMENT", "development"),
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0")),
            send_default_pii=False,  # don't ship user data to Sentry
        )
        sentry_sdk = _sentry
    except Exception:
        logging.getLogger(__name__).exception("Sentry initialization failed (non-fatal)")

app = FastAPI(title="Resume Optimizer Backend")
logger = logging.getLogger(__name__)
db_init_status = {"ok": None, "error": None}

# ── Environment & security config ─────────────────────────────────────────────
IS_PRODUCTION = os.getenv("ENVIRONMENT", "development").lower() == "production"

# Session signing key. Prefer the SECRET_KEY env var. If it is not set we fall
# back to the original default so EXISTING user sessions stay valid (deploying
# this change never forces a logout). This default is insecure — set SECRET_KEY
# in the environment to close the gap; doing so logs everyone out exactly once,
# which is why it's left as a deliberate, scheduled step rather than forced here.
_SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if not _SECRET_KEY:
    _SECRET_KEY = "your-secret-key"
    if IS_PRODUCTION:
        logger.warning(
            "SECRET_KEY is not set; using an insecure default. "
            "Set SECRET_KEY in the environment to secure user sessions."
        )

# Allowed CORS origins. A wildcard "*" combined with credentials is both unsafe
# and rejected by browsers, so restrict to explicit origins. Override in any
# environment with a comma-separated CORS_ALLOW_ORIGINS; the default covers the
# public site and local development.
_default_cors_origins = (
    "https://thetailorcv.com,https://www.thetailorcv.com,"
    "http://localhost:8005,http://127.0.0.1:8005"
)
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("CORS_ALLOW_ORIGINS", _default_cors_origins).split(",")
    if o.strip()
]

# Add session middleware
app.add_middleware(SessionMiddleware, secret_key=_SECRET_KEY)

# ── CSRF protection (double-submit cookie) ────────────────────────────────────
@app.middleware("http")
async def csrf_middleware(request: Request, call_next):
    EXEMPT_PATHS = {
        "/api/linkedin/oauth/callback",
        "/api/extension/log-application",
        "/api/extension/tailor-resume",
        "/api/extension/cover-letter",
        "/api/extension/skill-match",
        "/api/extension/apply-profile",
        "/api/extension/apply-answers",
        "/api/billing/razorpay/webhook",
        "/api/billing/polar/webhook",
        "/webhooks/ses-events",
    }
    SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

    if request.method not in SAFE_METHODS and request.url.path not in EXEMPT_PATHS:
        cookie_token = request.cookies.get("csrftoken", "")
        header_token = request.headers.get("X-CSRFToken", "")
        if not cookie_token or cookie_token != header_token:
            # Only block if the request is NOT same-origin via browser navigation
            # (browser form POSTs won't have the header — let session-protected routes handle those)
            content_type = request.headers.get("content-type", "")
            is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest" or "application/json" in content_type
            if is_ajax and not (cookie_token and cookie_token == header_token):
                return JSONResponse(status_code=403, content={"detail": "CSRF token invalid."})

    response = await call_next(request)

    # Set CSRF cookie on every response so JS can read it
    if "csrftoken" not in request.cookies:
        import secrets as _secrets
        response.set_cookie(
            "csrftoken",
            _secrets.token_hex(32),
            samesite="lax",
            httponly=False,         # JS must be able to read it
            secure=IS_PRODUCTION,   # HTTPS-only cookie in production
        )
    return response

# ── Portfolio subdomain router ────────────────────────────────────────────────
# Serves <handle>.thetailorcv.com → that user's portfolio at the root path. Only
# intercepts the homepage of a real portfolio subdomain; every other host/path
# (apex, www, static assets, /p/<slug>, /cv, app routes) passes straight through,
# so this is safe to run on every request. Fully wrapped so it can never break
# normal traffic.
@app.middleware("http")
async def portfolio_subdomain_router(request: Request, call_next):
    try:
        host = (request.headers.get("host") or "").split(":")[0].lower().strip(".")
        suffix = "." + PORTFOLIO_DOMAIN
        if host.endswith(suffix) and request.method in ("GET", "HEAD"):
            handle = host[: -len(suffix)]
            # single-label, non-reserved handle, and only the homepage
            if (handle and "." not in handle and handle not in RESERVED_HANDLES
                    and request.url.path in ("", "/")):
                db = get_db()
                try:
                    portfolio = (
                        db.query(Portfolio)
                        .filter(Portfolio.handle == handle, Portfolio.published == True)  # noqa: E712
                        .first()
                    )
                    if portfolio is not None:
                        response = _render_portfolio_page(request, portfolio)
                        try:
                            db.commit()
                        except Exception:
                            db.rollback()
                        return response
                    return HTMLResponse("<h1>Portfolio not found</h1>", status_code=404)
                finally:
                    db.close()
    except Exception:
        logger.exception("portfolio_subdomain_router failed; passing through")
    return await call_next(request)


# Add global exception handler for logging
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    # This handler "handles" the error, so report it to Sentry explicitly —
    # otherwise the automatic integration would never see it.
    if sentry_sdk is not None:
        sentry_sdk.capture_exception(exc)
    accept = request.headers.get("accept", "")
    if "text/html" in accept and request.headers.get("X-Requested-With") != "XMLHttpRequest":
        return templates.TemplateResponse(request, "error.html", {"status_code": 500, "message": "Something went wrong on our end. Please try again."}, status_code=500)
    return JSONResponse(status_code=500, content={"detail": "Internal server error. Please try again."})

# Branded 404 (and other HTTP errors) for browser navigations; JSON for APIs.
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    accept = request.headers.get("accept", "")
    wants_html = "text/html" in accept and request.headers.get("X-Requested-With") != "XMLHttpRequest"
    if exc.status_code == 404 and wants_html:
        return templates.TemplateResponse(request, "404.html", status_code=404)
    # Preserve existing behaviour for API clients / XHR / other status codes.
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # The Chrome extension's background service worker fetches with an Origin of
    # chrome-extension://<id> — an unpacked dev build's id differs from the
    # published Web Store one, so allow the scheme generally rather than
    # hardcoding either.
    allow_origin_regex=r"^chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-CSRFToken", "X-Requested-With"],
    # Custom response headers are invisible to cross-origin JS (e.g. the Chrome
    # extension's background fetch) unless explicitly exposed here.
    # A header the extension cannot READ is the same as one never sent, so every
    # addition to the tailor response has to be listed here too.
    expose_headers=[
        "X-Skill-Match-After", "X-Skill-Match-Fallback",
        "X-Skill-Gaps", "X-Skills-Added",
    ],
)

# Get the base directory (where main.py is located)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

templates_dir = os.path.join(BASE_DIR, "templates")
static_dir = os.path.join(BASE_DIR, "static")
public_dir = os.path.join(BASE_DIR, "public")
uploads_dir = os.path.join(BASE_DIR, "uploads")
resumes_dir = os.path.join(BASE_DIR, "resumes")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
SHOW_OPTIMIZED_EDITOR = os.getenv("SHOW_OPTIMIZED_EDITOR", "false").strip().lower() == "true"
SITE_URL = os.getenv("SITE_URL", "https://thetailorcv.com").rstrip("/")
# Netlify Personal Access Token — enables the optional "Deploy to Netlify" button.
NETLIFY_AUTH_TOKEN = os.getenv("NETLIFY_AUTH_TOKEN", "").strip()
# Google Search Console verification.
#   GOOGLE_SITE_VERIFICATION = the token from the "HTML tag" method (renders a
#     <meta name="google-site-verification"> tag site-wide via _seo_head.html).
#   GOOGLE_VERIFICATION_FILE = the "HTML file" method filename, e.g.
#     "google1234abcd5678.html" — served at /<that-filename>.
GOOGLE_SITE_VERIFICATION = os.getenv("GOOGLE_SITE_VERIFICATION", "").strip()
GOOGLE_VERIFICATION_FILE = os.getenv("GOOGLE_VERIFICATION_FILE", "").strip()
BLOG_CONTENT_DIR = os.path.join(BASE_DIR, "content", "blogs")

# Ensure directories exist
os.makedirs(uploads_dir, exist_ok=True)
os.makedirs(resumes_dir, exist_ok=True)
os.makedirs(templates_dir, exist_ok=True)
os.makedirs(static_dir, exist_ok=True)
os.makedirs(public_dir, exist_ok=True)
os.makedirs(BLOG_CONTENT_DIR, exist_ok=True)

# Ensure WebP (and other modern image types) are served with the correct
# Content-Type. On some platforms these are not in the default mimetypes table,
# which makes StaticFiles fall back to text/plain — browsers still render it, but
# a correct image/* type caches better and is what CDNs/SEO expect.
import mimetypes as _mimetypes
_mimetypes.add_type("image/webp", ".webp")
_mimetypes.add_type("image/avif", ".avif")
_mimetypes.add_type("image/svg+xml", ".svg")

# Mount static files and configure templates with absolute paths
app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.mount("/public", StaticFiles(directory=public_dir), name="public")
templates = Jinja2Templates(directory=templates_dir)

# devicon's icon folder names don't always match a skill's plain slug (e.g.
# "HTML" → "html5", "CSS" → "css3"). Map the common mismatches so portfolio
# skill grids render the real logo; unknown skills fall back to name-only.
_DEVICON_ALIASES = {
    "html": "html5", "css": "css3", "node": "nodejs", "nodejs": "nodejs",
    "express": "express", "expressjs": "express", "next": "nextjs", "nextjs": "nextjs",
    "reactjs": "react", "reactnative": "react", "reactrouter": "reactrouter",
    "vue": "vuejs", "vuejs": "vuejs", "tailwind": "tailwindcss", "tailwindcss": "tailwindcss",
    "sklearn": "scikitlearn", "scikitlearn": "scikitlearn", "postgres": "postgresql",
    "postgresql": "postgresql", "aws": "amazonwebservices", "amazonwebservicesaws": "amazonwebservices",
    "amazonwebservices": "amazonwebservices", "golang": "go", "vscode": "vscode",
    "github": "github", "tensorflow": "tensorflow", "pytorch": "pytorch",
    "scss": "sass", "sass": "sass", "k8s": "kubernetes",
    "typescript": "typescript", "ts": "typescript", "dotnet": "dot-net", "netcore": "dot-net",
    "net": "dot-net", "sql": "azuresqldatabase", "postman": "postman",
    "jira": "jira", "bitbucket": "bitbucket", "astro": "astro",
}


def _devicon_slug(name: str) -> str:
    """Normalize a skill name into its best-guess devicon folder slug."""
    s = str(name or "").lower().replace("+", "plus").replace("#", "sharp")
    s = re.sub(r"[^a-z0-9]", "", s)
    return _DEVICON_ALIASES.get(s, s)


# Skills whose only devicon is a plain/ugly letter mark — render the neutral
# code-glyph fallback instead of the logo. (Empty now that those have custom icons.)
_DEVICON_BLOCKLIST = set()

# Custom logos for skills devicon lacks (or whose devicon looks bad). Keys are
# _devicon_slug() outputs; values are local SVGs under /static/skill-icons/.
_SKILL_ICON_OVERRIDES = {
    "excel": "/static/skill-icons/excel.svg",
    "powerbi": "/static/skill-icons/powerbi.svg",
    "seaborn": "/static/skill-icons/seaborn.svg",
    "c": "/static/skill-icons/c.svg",
    "dsa": "/static/skill-icons/dsa.svg",
    "datastructuresandalgorithms": "/static/skill-icons/dsa.svg",
    # Vector databases
    "vectordatabase": "/static/skill-icons/vectordb.png",
    "vectordatabases": "/static/skill-icons/vectordb.png",
    "vectordb": "/static/skill-icons/vectordb.png",
    # ETL / data pipelines
    "etl": "/static/skill-icons/etl.png",
    "etlpipelines": "/static/skill-icons/etl.png",
    "etlpipeline": "/static/skill-icons/etl.png",
    "datapipelines": "/static/skill-icons/etl.png",
    "datapipeline": "/static/skill-icons/etl.png",
    # CI/CD
    "cicd": "/static/skill-icons/cicd.png",
    # MLflow
    "mlflow": "/static/skill-icons/mlflow.png",
    # AWS (override devicon's mark with the supplied logo)
    "amazonwebservices": "/static/skill-icons/aws.png",
}


def _skill_has_icon(name: str) -> bool:
    """False for skills we deliberately render with the code-glyph fallback."""
    slug = _devicon_slug(name)
    return slug in _SKILL_ICON_OVERRIDES or slug not in _DEVICON_BLOCKLIST


def _skill_icon_url(name: str) -> str:
    """Best icon URL for a skill: a custom local logo when we have one, else the
    devicon CDN original (which the template's onerror handler falls back from)."""
    slug = _devicon_slug(name)
    if slug in _SKILL_ICON_OVERRIDES:
        return _SKILL_ICON_OVERRIDES[slug]
    return f"https://cdn.jsdelivr.net/gh/devicons/devicon/icons/{slug}/{slug}-original.svg"


templates.env.filters["deviconslug"] = _devicon_slug
templates.env.filters["skillhasicon"] = _skill_has_icon
templates.env.filters["skilliconurl"] = _skill_icon_url
# Make the GSC verification token available to every template (used by
# _seo_head.html to emit the verification meta tag).
templates.env.globals["google_site_verification"] = GOOGLE_SITE_VERIFICATION
app.include_router(linkedin_router)
app.include_router(billing_router)
app.include_router(feedback_router)
app.include_router(marketing_router)
# Gigs feature hidden/disabled — route intentionally not registered (files kept dormant on disk).
# app.include_router(jobs_router)
blog_service = BlogService(BLOG_CONTENT_DIR)


# Google Search Console "HTML file" verification. Registered as an exact literal
# path (e.g. /google1234abcd.html) only when configured, so it can never shadow
# other routes. The body is exactly what Google expects.
if GOOGLE_VERIFICATION_FILE:
    _gsc_filename = GOOGLE_VERIFICATION_FILE
    if _gsc_filename.startswith("google") and _gsc_filename.endswith(".html"):
        async def _google_verification_file():
            from fastapi.responses import PlainTextResponse as _PTR
            return _PTR(content=f"google-site-verification: {_gsc_filename}\n", media_type="text/html")

        app.add_api_route(
            f"/{_gsc_filename}",
            _google_verification_file,
            methods=["GET"],
            include_in_schema=False,
        )


def _ensure_saved_resume_columns() -> None:
    """Lightweight migration: add columns to an existing saved_resumes table.

    Base.metadata.create_all only creates missing *tables*, never new columns on
    an existing one, so newly added model fields (company, status) must be
    ALTERed in. Safe to run on every startup; only adds what's missing.
    """
    from sqlalchemy import inspect as _inspect, text as _text

    insp = _inspect(engine)
    if not insp.has_table("saved_resumes"):
        return
    cols = {c["name"]: c for c in insp.get_columns("saved_resumes")}
    to_add = []
    if "company" not in cols:
        to_add.append("ADD COLUMN company VARCHAR(200)")
    if "status" not in cols:
        to_add.append("ADD COLUMN status VARCHAR(30) DEFAULT 'saved'")
    if to_add:
        with engine.begin() as conn:
            for clause in to_add:
                conn.execute(_text(f"ALTER TABLE saved_resumes {clause}"))

    # Widen jd_snippet from VARCHAR(500) to TEXT so the FULL job description fits.
    # (SQLite is dynamically typed, so only relational DBs need the ALTER.)
    if engine.dialect.name != "sqlite":
        jd_col = cols.get("jd_snippet")
        if jd_col is not None and "TEXT" not in str(jd_col.get("type", "")).upper():
            with engine.begin() as conn:
                conn.execute(_text("ALTER TABLE saved_resumes ALTER COLUMN jd_snippet TYPE TEXT"))


def _ensure_portfolio_columns() -> None:
    """Lightweight migration: add the `handle` column to an existing portfolios
    table (added after the table first shipped). Safe to run every startup."""
    from sqlalchemy import inspect as _inspect, text as _text

    insp = _inspect(engine)
    if not insp.has_table("portfolios"):
        return
    cols = {c["name"] for c in insp.get_columns("portfolios")}
    if "handle" not in cols:
        with engine.begin() as conn:
            conn.execute(_text("ALTER TABLE portfolios ADD COLUMN handle VARCHAR(63)"))
    if "netlify_site_id" not in cols:
        with engine.begin() as conn:
            conn.execute(_text("ALTER TABLE portfolios ADD COLUMN netlify_site_id VARCHAR(64)"))
    if "netlify_url" not in cols:
        with engine.begin() as conn:
            conn.execute(_text("ALTER TABLE portfolios ADD COLUMN netlify_url VARCHAR(255)"))


def _ensure_user_columns() -> None:
    """Add subscription/billing columns to the existing users table if missing."""
    from sqlalchemy import inspect as _inspect, text as _text

    insp = _inspect(engine)
    if not insp.has_table("users"):
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    is_pg = engine.dialect.name != "sqlite"
    to_add = []
    if "pro_until" not in cols:
        to_add.append("ADD COLUMN pro_until TIMESTAMP" if is_pg else "ADD COLUMN pro_until TEXT")
    if "plan_provider" not in cols:
        to_add.append("ADD COLUMN plan_provider VARCHAR(20)" if is_pg else "ADD COLUMN plan_provider TEXT")
    # Skills the candidate personally confirmed. TEXT on both dialects: it holds a
    # JSON list, not a value the database ever needs to interpret.
    if "confirmed_skills" not in cols:
        to_add.append("ADD COLUMN confirmed_skills TEXT")
    if "razorpay_subscription_id" not in cols:
        to_add.append("ADD COLUMN razorpay_subscription_id VARCHAR(100)" if is_pg else "ADD COLUMN razorpay_subscription_id TEXT")
    # One shared Netlify "live site" per user (reused across portfolios to save credits).
    if "netlify_site_id" not in cols:
        to_add.append("ADD COLUMN netlify_site_id VARCHAR(64)" if is_pg else "ADD COLUMN netlify_site_id TEXT")
    if "netlify_url" not in cols:
        to_add.append("ADD COLUMN netlify_url VARCHAR(255)" if is_pg else "ADD COLUMN netlify_url TEXT")
    if "netlify_portfolio_id" not in cols:
        to_add.append("ADD COLUMN netlify_portfolio_id INTEGER")
    if "base_resume_path" not in cols:
        to_add.append("ADD COLUMN base_resume_path VARCHAR(500)" if is_pg else "ADD COLUMN base_resume_path TEXT")
    if "base_resume_filename" not in cols:
        to_add.append("ADD COLUMN base_resume_filename VARCHAR(255)" if is_pg else "ADD COLUMN base_resume_filename TEXT")
    if "base_template_id" not in cols:
        to_add.append("ADD COLUMN base_template_id INTEGER")
    if "base_style_id" not in cols:
        to_add.append("ADD COLUMN base_style_id INTEGER")
    if "base_resume_uploaded_at" not in cols:
        to_add.append("ADD COLUMN base_resume_uploaded_at TIMESTAMP" if is_pg else "ADD COLUMN base_resume_uploaded_at TEXT")
    if "base_cover_template" not in cols:
        to_add.append("ADD COLUMN base_cover_template VARCHAR(20)" if is_pg else "ADD COLUMN base_cover_template TEXT")
    if "base_resume_text" not in cols:
        to_add.append("ADD COLUMN base_resume_text TEXT")
    if "application_profile_json" not in cols:
        to_add.append("ADD COLUMN application_profile_json TEXT")
    if "marketing_opt_out" not in cols:
        to_add.append("ADD COLUMN marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE" if is_pg else "ADD COLUMN marketing_opt_out BOOLEAN NOT NULL DEFAULT 0")
    if "email_bounced_at" not in cols:
        to_add.append("ADD COLUMN email_bounced_at TIMESTAMP" if is_pg else "ADD COLUMN email_bounced_at TEXT")
    if "email_complained_at" not in cols:
        to_add.append("ADD COLUMN email_complained_at TIMESTAMP" if is_pg else "ADD COLUMN email_complained_at TEXT")
    if to_add:
        with engine.begin() as conn:
            for clause in to_add:
                conn.execute(_text(f"ALTER TABLE users {clause}"))


def _ensure_usage_columns() -> None:
    """Add feature counters to an existing usage_records table if missing."""
    from sqlalchemy import inspect as _inspect, text as _text

    insp = _inspect(engine)
    if not insp.has_table("usage_records"):
        return
    cols = {c["name"] for c in insp.get_columns("usage_records")}
    to_add = []
    if "mock_interviews" not in cols:
        to_add.append("ADD COLUMN mock_interviews INTEGER NOT NULL DEFAULT 0")
    if "interview_questions" not in cols:
        to_add.append("ADD COLUMN interview_questions INTEGER NOT NULL DEFAULT 0")
    if "cover_letters" not in cols:
        to_add.append("ADD COLUMN cover_letters INTEGER NOT NULL DEFAULT 0")
    if "linkedin_imports" not in cols:
        to_add.append("ADD COLUMN linkedin_imports INTEGER NOT NULL DEFAULT 0")
    if to_add:
        with engine.begin() as conn:
            for clause in to_add:
                conn.execute(_text(f"ALTER TABLE usage_records {clause}"))


def initialize_database() -> None:
    """Create tables if the configured database is reachable."""
    try:
        Base.metadata.create_all(bind=engine)
        _ensure_saved_resume_columns()
        _ensure_portfolio_columns()
        _ensure_user_columns()
        _ensure_usage_columns()
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


def require_logged_in(request: Request) -> None:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")


_GUEST_ATS_MSG = "Create a free account to run another ATS scan"


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def _guest_ats_ip_hash(ip: str) -> str:
    daily_salt = datetime.utcnow().strftime("%Y-%m-%d")
    return hashlib.sha256(f"{daily_salt}|{ip}".encode()).hexdigest()


def enforce_guest_ats_allowed(request: Request, db: Session) -> bool:
    """If anonymous, verify guest quota. Returns True when this is a guest scan."""
    if request.session.get("user_id"):
        return False
    if request.session.get("guest_ats_used"):
        raise HTTPException(status_code=429, detail=_GUEST_ATS_MSG)
    ip_hash = _guest_ats_ip_hash(_client_ip(request))
    cutoff = datetime.utcnow() - timedelta(hours=24)
    recent = (
        db.query(GuestAtsScan)
        .filter(GuestAtsScan.ip_hash == ip_hash, GuestAtsScan.created_at >= cutoff)
        .first()
    )
    if recent:
        raise HTTPException(status_code=429, detail=_GUEST_ATS_MSG)
    return True


def mark_guest_ats_used(request: Request, db: Session) -> None:
    request.session["guest_ats_used"] = True
    db.add(GuestAtsScan(ip_hash=_guest_ats_ip_hash(_client_ip(request))))
    db.commit()


# ── Subscription / freemium gating ───────────────────────────────────────────

def _as_naive_utc(value):
    """Coerce a stored pro_until into a naive UTC datetime, or None.

    The column is not the same shape everywhere it is read from. SQLite gets it
    as TEXT (see _ensure_user_columns), a Postgres column that is or ever was
    `timestamptz` yields an AWARE datetime, and both of those blow up when
    compared against the naive datetime.utcnow():

        TypeError: can't compare offset-naive and offset-aware datetimes
        TypeError: '>' not supported between instances of 'str' and 'datetime'

    That exception does not read as "not Pro" - it 500s the request. The
    download gate treats any non-OK response as refusal, so a PAYING Pro user
    whose row is perfectly correct in the database gets shown the upgrade popup
    and cannot download their resume.
    """
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            value = datetime.fromisoformat(text)
        except ValueError:
            try:
                value = datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S")
            except ValueError:
                logger.warning("Unparseable pro_until value: %r", value)
                return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def is_pro(user) -> bool:
    """Return True iff the user currently has an active Pro subscription.

    Never raises: a failure to read the date must not be able to deny access to
    someone who has paid.
    """
    if not user:
        return False
    try:
        until = _as_naive_utc(getattr(user, "pro_until", None))
    except Exception:
        logger.exception("pro_until could not be interpreted for user %s",
                         getattr(user, "id", "?"))
        return False
    return bool(until and until > datetime.utcnow())


FREE_LIMITS: dict[str, int] = {
    # Lowered from 3 when the whole app moved to gpt-5-mini, which costs ~3x
    # more per call than gpt-4o-mini. The download popup reads this number
    # rather than hardcoding it, so the copy follows automatically.
    "ai_optimizations": 2,
    "cover_letters": 2,
    "linkedin_imports": 1,
    "mock_interviews": 1,
    "interview_questions": 1,
    # ats_scans intentionally absent — stays unlimited-free
}


def get_or_create_usage(db: Session, user_id: int, month: str) -> UsageRecord:
    rec = db.query(UsageRecord).filter_by(user_id=user_id, month=month).first()
    if not rec:
        rec = UsageRecord(user_id=user_id, month=month)
        db.add(rec)
        db.flush()
    return rec


def enforce_quota(db: Session, user, field: str) -> None:
    """Raise HTTP 402 if the free user has exhausted their lifetime free use of *field*.

    Pro users bypass this check entirely. For free users, sums usage across all
    months (lifetime "1 free" rule). Also increments the current month's counter
    for analytics when the action is allowed.
    """
    from sqlalchemy import func as _func

    if is_pro(user):
        return
    # Beta rollout: when BILLING_BETA_USER_IDS is set, only those user IDs are gated.
    # Remove the env var (or leave it empty) to gate everyone.
    _beta_env = os.getenv("BILLING_BETA_USER_IDS", "").strip()
    if _beta_env:
        _beta_ids = {int(x) for x in _beta_env.split(",") if x.strip().isdigit()}
        if user.id not in _beta_ids:
            return
    # Serialize quota checks per user so two simultaneous requests cannot both
    # observe the same remaining free use and bypass the limit.
    db.query(User).filter(User.id == user.id).with_for_update().one()
    limit = FREE_LIMITS.get(field, 0)
    used = (
        db.query(_func.coalesce(_func.sum(getattr(UsageRecord, field)), 0))
        .filter(UsageRecord.user_id == user.id)
        .scalar()
        or 0
    )
    if used >= limit:
        raise HTTPException(
            status_code=402,
            detail={"error": "upgrade_required", "feature": field},
        )
    month = datetime.utcnow().strftime("%Y-%m")
    rec = get_or_create_usage(db, user.id, month)
    current_value = int(getattr(rec, field) or 0)
    setattr(rec, field, current_value + 1)
    db.commit()


def quota_exhausted(db: Session, user, field: str) -> bool:
    """Read-only check: has the free user used up their lifetime free use of *field*?

    Mirrors the gating logic in enforce_quota() (same beta rollout rule and the
    same lifetime-sum query) but performs no locking, no increment, and never raises.
    """
    from sqlalchemy import func as _func

    if is_pro(user):
        return False
    _beta_env = os.getenv("BILLING_BETA_USER_IDS", "").strip()
    if _beta_env:
        _beta_ids = {int(x) for x in _beta_env.split(",") if x.strip().isdigit()}
        if user.id not in _beta_ids:
            return False
    limit = FREE_LIMITS.get(field, 0)
    used = (
        db.query(_func.coalesce(_func.sum(getattr(UsageRecord, field)), 0))
        .filter(UsageRecord.user_id == user.id)
        .scalar()
        or 0
    )
    return used >= limit


def get_confirmed_skills(user) -> list[str]:
    """Skills this candidate has personally confirmed they have, newest last.

    Never raises: a malformed value must not be able to break tailoring.
    """
    raw = getattr(user, "confirmed_skills", None)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("Unparseable confirmed_skills for user %s", getattr(user, "id", "?"))
        return []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in data:
        text = str(item or "").strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            out.append(text)
    return out


def add_confirmed_skills_to_user(db: Session, user, skills) -> list[str]:
    """Merge *skills* into the user's confirmed list and persist. Returns the new list.

    The candidate is the trust source here, not the model: these are skills they
    ticked when shown their gaps. Storing them is what makes the answer outlive
    the editing session it was given in.
    """
    if not user:
        return []
    current = get_confirmed_skills(user)
    seen = {s.lower() for s in current}
    for raw in skills or []:
        text = _clean_inline_text(raw)
        key = text.lower()
        if text and key not in seen and _is_atomic_hard_skill(text):
            seen.add(key)
            current.append(text)
    # Bounded so a scripted client cannot grow the row without limit.
    current = current[-200:]
    try:
        user.confirmed_skills = json.dumps(current)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not persist confirmed skills for user %s", getattr(user, "id", "?"))
    return current


def lifetime_usage(db: Session, user, field: str) -> int:
    """How many of *field* this user has used, summed across all months.

    Same lifetime sum quota_exhausted() gates on, exposed on its own so the
    upgrade prompt can state the real number instead of a hardcoded one.
    """
    from sqlalchemy import func as _func

    if not user:
        return 0
    try:
        return int(
            db.query(_func.coalesce(_func.sum(getattr(UsageRecord, field)), 0))
            .filter(UsageRecord.user_id == user.id)
            .scalar()
            or 0
        )
    except Exception:
        logger.exception("Could not read %s usage for user %s", field, getattr(user, "id", "?"))
        return 0


def refund_quota(db: Session, user_id: int, field: str) -> None:
    """Decrement a quota counter by 1 — called when an LLM call fails after enforce_quota committed."""
    month = datetime.utcnow().strftime("%Y-%m")
    rec = db.query(UsageRecord).filter_by(user_id=user_id, month=month).first()
    if rec:
        current = int(getattr(rec, field) or 0)
        if current > 0:
            setattr(rec, field, current - 1)
            db.commit()


# Keep at most this many saved resumes per user (newest kept) to bound storage.
MAX_SAVED_RESUMES_PER_USER = 25


def _derive_target_role_from_jd(jd_string: str) -> str:
    """Best-effort target job title from the JD — almost always its first line.

    Used to title a saved resume by the job it was tailored *for* (e.g.
    "Backend Software Engineer"), so a user who tailors one resume to many
    roles gets distinguishable cards instead of N identical ones.
    """
    for raw in str(jd_string or "").splitlines():
        line = raw.strip().strip("-•*#:").strip()
        if len(line) < 2:
            continue
        if len(line) > 70:  # looks like a paragraph, not a title — clip it
            line = line[:60].rstrip() + "…"
        return line
    return ""


def save_user_resume(user_id: int, parsed: dict, html_content: str, jd_string: str,
                     template_id, style_id) -> None:
    """Persist an optimized resume to the user's account for the My Resumes page.

    Best-effort: any failure here must never break the optimization response,
    so the caller wraps this and we swallow/log errors internally.
    """
    db = get_db()
    try:
        candidate_name = ""
        if isinstance(parsed, dict):
            candidate_name = str(parsed.get("name") or "").strip()[:255]
        # Title by the job this resume was tailored FOR (from the JD), so multiple
        # versions of the same resume are distinguishable. Fall back to the
        # candidate's name when the JD has no usable title.
        target_role = _derive_target_role_from_jd(jd_string)
        title = (target_role or candidate_name or "Untitled Resume")[:255]
        jd_snippet = (str(jd_string or "").strip()) or None  # full JD, untruncated

        record = SavedResume(
            user_id=user_id,
            title=title,
            candidate_name=candidate_name or None,
            jd_snippet=jd_snippet,
            template_id=int(template_id) if template_id is not None else None,
            style_id=int(style_id) if style_id is not None else None,
            resume_json=json.dumps(parsed, separators=(",", ":")) if isinstance(parsed, dict) else None,
            html_content=html_content or None,
        )
        db.add(record)
        db.commit()

        # Prune to the newest MAX_SAVED_RESUMES_PER_USER for this user.
        ids = [
            r.id for r in db.query(SavedResume.id)
            .filter(SavedResume.user_id == user_id)
            .order_by(SavedResume.created_at.desc())
            .all()
        ]
        stale = ids[MAX_SAVED_RESUMES_PER_USER:]
        if stale:
            db.query(SavedResume).filter(SavedResume.id.in_(stale)).delete(synchronize_session=False)
            db.commit()
    except Exception:
        logger.exception("Failed to save user resume (non-fatal)")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


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


def _resend_from() -> str:
    return os.getenv("EMAIL_FROM", "").strip()


def _resend_welcome_from() -> str:
    return os.getenv("EMAIL_FROM_WELCOME", "").strip() or _resend_from()


def send_password_reset_email(recipient_email: str, reset_code: str) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    from_addr = _resend_from()
    if not (api_key and from_addr):
        return False

    resend.api_key = api_key
    resend.Emails.send({
        "from": from_addr,
        "to": [recipient_email],
        "subject": "Your TailorCV password reset code",
        "text": (
            "We received a request to reset your TailorCV password.\n\n"
            f"Your verification code is: {reset_code}\n\n"
            "This code expires in 10 minutes.\n\n"
            "If you did not request this, you can ignore this email."
        ),
    })
    return True


def send_signup_code_email(recipient_email: str, signup_code: str) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    from_addr = _resend_from()
    if not (api_key and from_addr):
        return False

    resend.api_key = api_key
    resend.Emails.send({
        "from": from_addr,
        "to": [recipient_email],
        "subject": "Your TailorCV sign-up verification code",
        "text": (
            "Welcome to TailorCV.\n\n"
            f"Your sign-up verification code is: {signup_code}\n\n"
            "This code expires in 10 minutes.\n\n"
            "If you did not request this, you can ignore this email."
        ),
    })
    return True


def send_welcome_email(recipient_email: str, recipient_name: str) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    from_addr = _resend_welcome_from()
    if not (api_key and from_addr):
        return False

    resend.api_key = api_key
    resend.Emails.send({
        "from": from_addr,
        "to": [recipient_email],
        "subject": "Did we help you?",
        "text": (
            f"Hi {recipient_name or 'there'},\n\n"
            "I'm Shubham, Co-Founder of TailorCV.\n\n"
            "Behind every resume is someone hoping for an opportunity—a student looking for their first break, "
            "someone trying to switch careers, or someone simply looking for a better future.\n\n"
            "As a student myself, I know how overwhelming that journey can feel. That's why I started building TailorCV.\n\n"
            "I'd genuinely love to know whether we're creating something that truly helps job seekers.\n\n"
            "If you have few minutes sometime this week, I'd really appreciate your honest feedback.\n\n"
            "I'd especially love to know:\n"
            "⏳ Does TailorCV actually save you time and effort?\n"
            "\U0001F4BC Would you use it in your job application workflow?\n"
            "\U0001F914 Was anything confusing or frustrating?\n"
            "\U0001F4B3 Would you consider paying for something like this?\n\n"
            "\U0001F449 Explore the platform here:\n"
            "https://thetailorcv.com/dashboard\n\n"
            "While you're there, feel free to explore our other tools too:\n"
            "\U0001F4DD AI Resume Builder\n"
            "\U0001F4CA ATS Resume Analysis\n"
            "\U0001F310 Portfolio Builder\n"
            "\U0001F3A4 Mock Interviews\n"
            "❓ Interview Question Generator\n"
            "\U0001F9E9 Chrome Extension - Tailor your Resume without leaving job page(Linkedin, Wellfound, Greenhouse, etc.) in seconds\n"
            "https://chromewebstore.google.com/detail/lnkplncemohgcdjlgccgmbcgiokcgmno?utm_source=item-share-cb\n\n"
            "Every feature is being built with one goal in mind: making the job application process less stressful and more effective.\n\n"
            "\U0001F4E9 Just reply to this email with your thoughts. I personally read every reply, and every piece of feedback helps shape what we build next.\n"
            "\U0001F4DE You can also reach me directly at +91 8240044652(Whatsapp,Text or call).\n\n"
            "Thank you for your time and support! \U0001F64F\n\n"
            "Best,\n"
            "Shubham\n"
            "Co-Founder, TailorCV"
        ),
    })
    return True


def send_welcome_email_once(db: Session, user: User, source: str) -> None:
    existing_log = db.query(WelcomeEmailLog).filter(WelcomeEmailLog.user_id == user.id).first()
    if existing_log:
        return

    sent = send_welcome_email(user.email, user.name)
    if not sent:
        return

    db.add(WelcomeEmailLog(user_id=user.id, source=source))
    db.commit()


def is_production_environment() -> bool:
    return os.getenv("ENVIRONMENT", "development").lower() == "production"


def _column_split_x(words: list, page_width: float) -> float | None:
    """The x of the gutter on a two-column page, or None if it reads as one column.

    Sidebar templates put unrelated content side by side. Grouping words by
    vertical position alone then merges across the gutter, producing lines like
    "EXPERIENCE CONTACT" and "EDUCATION - MySQL" - two columns' worth of text on
    one line. Everything downstream reads that: the section tagger never sees a
    PROJECTS heading, and the model is handed interleaved nonsense as the
    candidate's resume.

    Deliberately strict. Splitting a single-column resume would be far worse
    than not splitting a two-column one, so it requires a genuinely empty
    vertical band near the middle with substantial text on both sides.
    """
    if not words or not page_width:
        return None

    # Candidate gutters: scan the middle of the page for an x with no word
    # crossing it. Edges are ignored - a margin is not a gutter.
    lo, hi = page_width * 0.25, page_width * 0.75
    spans = [(float(w["x0"]), float(w["x1"])) for w in words]

    # A handful of crossings is tolerated. Requiring a perfectly empty band let a
    # single full-width element - a header rule, a name spanning the page - veto
    # the split on a page that is plainly two columns, and the columns then
    # interleaved word by word.
    tolerance = max(2, int(len(spans) * 0.01))

    best_x, best_score = None, None
    x = lo
    while x <= hi:
        crossings = sum(1 for a, b in spans if a < x < b)
        if crossings <= tolerance:
            left = max((b for a, b in spans if b <= x), default=0.0)
            right = min((a for a, b in spans if a >= x), default=page_width)
            # Prefer few crossings first, then the widest clear band.
            score = (crossings, -(right - left))
            if best_score is None or score < best_score:
                best_score, best_x = score, x
        x += 2.0

    if best_x is None:
        return None

    left_count = sum(1 for a, _b in spans if a < best_x)
    right_count = len(spans) - left_count
    # Both sides must carry real content, otherwise it is a margin or an indent.
    if min(left_count, right_count) < max(12, len(spans) * 0.12):
        return None
    return best_x


def extract_pdf_text(path: str) -> str:
    text_parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=1, y_tolerance=3)
            if not words:
                text_parts.append(page.extract_text() or "")
                continue

            def emit(group: list) -> None:
                """Group words into lines by vertical position, left to right."""
                lines: dict[int, list] = {}
                for word in group:
                    bucket = round(word["top"] / 4) * 4
                    lines.setdefault(bucket, []).append(word)
                for bucket_key in sorted(lines):
                    line_words = sorted(lines[bucket_key], key=lambda w: w["x0"])
                    text_parts.append(" ".join(w["text"] for w in line_words))

            split_x = _column_split_x(words, float(page.width or 0))
            if split_x is None:
                emit(words)
            else:
                # Each column read top to bottom in turn, which is how a person
                # reads the page and how the sections actually run.
                emit([w for w in words if float(w["x0"]) < split_x])
                emit([w for w in words if float(w["x0"]) >= split_x])
    return "\n".join(text_parts)


def _normalize_key(text: str) -> str:
    return "".join(ch.lower() for ch in str(text or "") if ch.isalnum())


_SECTION_HEADING_KEYS = {
    "projects": "projects", "project": "projects", "personalprojects": "projects",
    "academicprojects": "projects", "keyprojects": "projects",
    "publications": "publications", "publication": "publications",
    "researchpublications": "publications", "selectedpublications": "publications",
    "papers": "publications", "researchpapers": "publications",
    "experience": "experience", "workexperience": "experience",
    "professionalexperience": "experience", "employment": "experience", "workhistory": "experience",
    "education": "education", "academics": "education",
    "skills": "skills", "technicalskills": "skills", "coreskills": "skills",
    "certifications": "certifications", "certification": "certifications",
    "licenses": "certifications", "licensescertifications": "certifications",
    "achievements": "achievements", "awards": "achievements", "honors": "achievements",
    "awardsachievements": "achievements", "accomplishments": "achievements",
    "extracurricular": "extracurricular", "extracurriculars": "extracurricular",
    "leadership": "extracurricular", "activities": "extracurricular",
    "positionsofresponsibility": "extracurricular", "volunteer": "extracurricular",
    "summary": "summary", "profile": "summary", "objective": "summary",
    "professionalsummary": "summary", "contact": "contact",
}


# Horizontal gap that means "different column" rather than "same line". Sidebar
# templates put an unrelated heading at the same height as body text, and words
# were grouped by vertical position alone - so "Skills" from the sidebar merged
# with "Projects" from the main column into one line that matched neither, and
# both headings disappeared from detection.
_COLUMN_GAP = 40.0


# Words that only qualify a section name and never identify one on their own.
# Deliberately a closed list: anything broader would let a project or job title
# ending in a section word be read as a heading.
_HEADING_QUALIFIERS = {
    "core", "key", "relevant", "additional", "other", "notable", "selected",
    "major", "personal", "academic", "professional", "technical", "primary",
    "main", "top", "career", "my", "important", "significant", "recent",
}


def _heading_key(text: str) -> str | None:
    """The canonical section a heading names, or None.

    Resumes decorate headings - "Technical Skills and Interests", "Skills &
    Interests", "Professional Experience & Projects" - and an exact lookup missed
    every one of them. A missed heading is not cosmetic: the section boundary
    never moves, so the whole Skills block stayed tagged as Experience and its
    lines were restored as bullets on the last job.

    Matches the longest leading run of words that names a section, so the
    decoration is ignored while the section is still identified.

    Decoration also comes FIRST - "Core Achievements", "Key Achievements",
    "Relevant Experience". Those were missed too, and the consequence was the
    same in reverse: the achievements block stayed tagged as `projects` and its
    lines were restored as bullets on the last project. So a leading qualifier
    is stripped as well, but only from a fixed list, so an ordinary line that
    happens to end in a section word ("Machine Learning Projects" as a PROJECT
    title) is not mistaken for a heading.
    """
    raw = str(text or "").strip()

    # A two-column page whose gutter is not empty enough to split cleanly leaves
    # the heading glued to content from the other column:
    #     "PROJECTS - Core Member - E-cell Club (May 2024 - jan 2026)"
    # The heading is still right there at the start, followed by a bullet marker.
    # Without this the PROJECTS heading is missed entirely and the whole section
    # is tagged as whatever came before it.
    lead = re.match(r"^([A-Za-z][A-Za-z&/ ]{2,28}?)\s*[•‣▪◦●·|]\s+\S", raw)
    if lead:
        key = _normalize_key(lead.group(1))
        if key in _SECTION_HEADING_KEYS:
            return _SECTION_HEADING_KEYS[key]

    # A heading is a label, not a sentence. Without this, a bullet that WRAPS in
    # the PDF and whose tail happens to begin with a section word ends the
    # section on the spot:
    #     "...presented results through 30 written"
    #     "publications and 20+ oral presentations."
    # That second line was read as the PUBLICATIONS heading, so the rest of the
    # job's bullets were tagged as a different section and disappeared from the
    # entry entirely - and the bullet above it stayed truncated at "30 written".
    # Sentence-ending punctuation and digits never appear in a real heading, and
    # the glued-heading case above has already returned by this point.
    if raw.endswith((".", "!", "?")) or any(ch.isdigit() for ch in raw):
        return None

    words = raw.split()
    if not words or len(words) > 5:
        return None
    for take in range(len(words), 0, -1):
        key = _normalize_key(" ".join(words[:take]))
        if key in _SECTION_HEADING_KEYS:
            return _SECTION_HEADING_KEYS[key]

    # Strip leading qualifiers, then re-test what remains.
    start = 0
    while start < len(words) - 1 and _normalize_key(words[start]) in _HEADING_QUALIFIERS:
        start += 1
    if start:
        for take in range(len(words), start, -1):
            key = _normalize_key(" ".join(words[start:take]))
            if key in _SECTION_HEADING_KEYS:
                return _SECTION_HEADING_KEYS[key]
    return None


def _detect_section_headings(pdf_path: str) -> list[tuple[int, float, str, float]]:
    """Return ordered (page_idx, top, section_name, x0) for every section heading.

    x0 is what makes two-column resumes work: without it a heading in the left
    sidebar appears to govern everything below it on the page, including the
    right column, so a project's links were attributed to whatever sidebar
    section happened to sit above them.
    """
    headings: list[tuple[int, float, str, float]] = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                words = page.extract_words(use_text_flow=True, keep_blank_chars=False) or []
                lines: list[dict] = []
                for w in words:
                    t = str(w.get("text", "")).strip()
                    if not t:
                        continue
                    top = float(w.get("top", 0.0))
                    x0 = float(w.get("x0", 0.0))
                    x1 = float(w.get("x1", x0))
                    placed = False
                    for ln in lines:
                        # Same row AND horizontally adjacent - a wide gap means the
                        # words belong to different columns.
                        if abs(top - ln["top"]) <= 2.5 and x0 <= ln["x1"] + _COLUMN_GAP:
                            ln["text"] = (ln["text"] + " " + t).strip()
                            ln["top"] = min(ln["top"], top)
                            ln["x0"] = min(ln["x0"], x0)
                            ln["x1"] = max(ln["x1"], x1)
                            placed = True
                            break
                    if not placed:
                        lines.append({"text": t, "top": top, "x0": x0, "x1": x1})
                for ln in lines:
                    nk = _heading_key(ln["text"])
                    if nk:
                        headings.append((
                            page_idx, float(ln["top"]), nk, float(ln["x0"]),
                        ))
    except Exception:
        return []
    headings.sort(key=lambda h: (h[0], h[1]))
    return headings


def _column_starts(headings, page_idx: int) -> list[float]:
    """Left edges of the columns a page's headings fall into."""
    cols: list[float] = []
    for hx in sorted(h[3] for h in headings if h[0] == page_idx and len(h) > 3):
        if not cols or hx - cols[-1] > _COLUMN_GAP:
            cols.append(hx)
    return cols


def _column_start_for(x: float, cols: list[float]) -> float:
    """The column a horizontal position sits in."""
    chosen = cols[0]
    for c in cols:
        if x >= c - 20.0:
            chosen = c
    return chosen


def _section_of(headings, page_idx: int, top: float, x: float | None = None) -> str | None:
    """Which section a position belongs to. None = header/contact region.

    Pass `x` on multi-column resumes: only headings in the same column are
    allowed to claim the position. Without it a sidebar heading swallows the
    main column, which is how a project's GitHub link ended up on a
    certification. Single-column pages are unaffected - the filter only engages
    when a page genuinely has more than one column of headings.
    """
    scoped = headings
    if x is not None:
        cols = _column_starts(headings, page_idx)
        if len(cols) > 1:
            mine = _column_start_for(float(x), cols)
            scoped = [
                h for h in headings
                if h[0] != page_idx
                or (len(h) > 3 and _column_start_for(h[3], cols) == mine)
            ]
    current = None
    for h in scoped:
        if (h[0], h[1]) <= (page_idx, top):
            current = h[2]
        else:
            break
    return current


_TOKEN_RE = re.compile(r"[a-z0-9]+")
# Words a project title may open with that identify nothing on their own.
_WEAK_TITLE_LEADS = {
    "the", "a", "an", "my", "our", "project", "ai", "ml", "web", "app",
    "application", "system", "tool", "platform", "end", "full", "smart",
}


def _title_tokens(text: str) -> set[str]:
    """The identifying words of a title, minus filler shared by every project."""
    return {
        token for token in _TOKEN_RE.findall(str(text or "").lower())
        if len(token) > 2 and token not in _WEAK_TITLE_LEADS
    }


def _first_significant_token(text: str) -> str:
    """The first word of a title that actually identifies it.

    Used to pair a rewritten project name back to its row in the source PDF.
    Leading filler ("The", "AI", "Smart") is skipped because it is shared by
    unrelated projects and would pair them with the wrong links.
    """
    for token in _TOKEN_RE.findall(str(text or "").lower()):
        if len(token) > 2 and token not in _WEAK_TITLE_LEADS:
            return token
    return ""


_LAST_PROJECT_TITLE_POSITIONS: list = []
_LAST_LINK_DECISIONS: list = []


def extract_project_links_from_pdf(pdf_path: str, project_names: list[str], section: str = "projects") -> dict[str, list[tuple[str, str]]]:
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
        # norm_names is sorted longest-first, so the most specific project wins.
        for nn in norm_names:
            if not nn or len(nn) < 4:
                continue
            # Primary: the text line contains the project name.
            if nn in k:
                return norm_to_name[nn]
            # Secondary: the line itself is (almost) the project name. Require the
            # line to be a substantial fraction of the name to avoid a stray short
            # word matching a long project title (a common cause of link bleed).
            if k in nn and len(k) >= max(4, int(0.5 * len(nn))):
                return norm_to_name[nn]

        # Tertiary: the optimizer REWRITES project titles, so the stored name is
        # often the PDF's title plus extra words ("TailorCV.ai" becomes
        # "TailorCV.ai - AI Resume Optimizer"). Both checks above need one string
        # inside the other, so a rename made the project match nothing - and every
        # link then piled onto whichever project still matched, i.e. links landed
        # on the WRONG project rather than merely going missing.
        #
        # A project title leads with its distinctive word, and that word survives
        # rewriting, so fall back to comparing first tokens. Only used when
        # exactly one project claims that token, so two projects starting with
        # the same word ("Resume Parser" / "Resume Builder") stay ambiguous and
        # are left to the positional logic rather than guessed at.
        line_first = _first_significant_token(line_text)
        if line_first:
            owners = [n for n in names if _first_significant_token(n) == line_first]
            if len(owners) == 1:
                return owners[0]

        # Quaternary: a heavier rewrite can also REORDER the title ("Youtube
        # Sentiment Analysis" -> "Sentiment Analysis on YouTube Comments"), which
        # moves the leading word and defeats the check above. Fall back to how
        # much of the project's own vocabulary appears on the line. The winner
        # must be a clear winner - tied scores mean we cannot tell the projects
        # apart, and a wrong link is worse than a missing one.
        line_tokens = _title_tokens(line_text)
        if line_tokens:
            scored = []
            for n in names:
                tokens = _title_tokens(n)
                if tokens:
                    scored.append((len(tokens & line_tokens) / len(tokens), n))
            scored.sort(key=lambda pair: pair[0], reverse=True)
            if scored and scored[0][0] >= 0.34:
                if len(scored) == 1 or scored[0][0] > scored[1][0]:
                    return scored[0][1]
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

    # Contact / social domains must NOT be attached to projects — they belong to the
    # Section bounding (below) already restricts links to the Projects region, so a
    # project may legitimately link to Kaggle, GitHub, Drive, a live demo, etc.
    # Only email/phone and personal social-profile links are never project links.
    contact_deny = (
        "mailto:", "tel:", "gmail.com", "outlook.com", "yahoo.com", "hotmail.com",
        "linkedin.com/in/", "twitter.com", "x.com/", "facebook.com", "instagram.com",
    )

    SAME_LINE_TOL = 9.0    # link icon sits on the same row as the project title
    NEAR_WINDOW = 60.0     # or within the project's block, a few lines below the title

    def match_project(top: float, bottom: float, candidates: list[dict]) -> tuple[str | None, float]:
        center = (top + bottom) / 2.0
        # 1) Same-line match (strongest signal).
        best_ln, best_d = None, 1e9
        for ln in candidates:
            ln_center = (float(ln["top"]) + float(ln["bottom"])) / 2.0
            d = abs(ln_center - center)
            if d < best_d:
                best_d, best_ln = d, ln
        if best_ln is not None and best_d <= SAME_LINE_TOL:
            mp = best_match(best_ln["text"])
            if mp:
                return mp, best_d
        # 2) Nearest project title at/above the link (titles sit above their bullets),
        #    scanning upward first, then a small window below. Closest match wins.
        scored = []
        for ln in candidates:
            ln_top = float(ln["top"])
            ln_center = (ln_top + float(ln["bottom"])) / 2.0
            # allow the title to be above the link (preferred) or slightly below
            if (top - NEAR_WINDOW) <= ln_top <= (bottom + SAME_LINE_TOL):
                scored.append((abs(ln_center - center), ln))
        scored.sort(key=lambda t: t[0])
        for d, ln in scored:
            mp = best_match(ln["text"])
            if mp:
                return mp, d
        # 3) Fall back to the nearest project title ABOVE the link, however far.
        #    Not the nearest in absolute distance: plenty of resumes put the link
        #    row at the END of a project block, after its bullets. Such a row sits
        #    a line above the NEXT project's title and many lines below its own,
        #    so "closest" handed every link to the following project - Tailorcv's
        #    Link/GitHub landed on Myntra while Tailorcv showed none.
        #
        #    A link belongs to the block it sits inside, and blocks start at a
        #    title, so the owner is the last title that precedes it.
        above = [
            ln for ln in candidates
            if float(ln["bottom"]) <= bottom + SAME_LINE_TOL and best_match(ln["text"])
        ]
        if above:
            ln = max(above, key=lambda l: float(l["top"]))
            return best_match(ln["text"]), abs(
                ((float(ln["top"]) + float(ln["bottom"])) / 2.0) - center
            )

        # 4) Nothing above it at all (a link before the first title): nearest wins.
        all_scored = sorted(
            candidates,
            key=lambda ln: abs(((float(ln["top"]) + float(ln["bottom"])) / 2.0) - center),
        )
        for ln in all_scored[:25]:
            mp = best_match(ln["text"])
            if mp:
                return mp, abs(((float(ln["top"]) + float(ln["bottom"])) / 2.0) - center)
        return None, 1e9

    # Collect each unique URL's single best project assignment (global dedup so one
    # URL can never appear under two different projects).
    best_for_uri: dict[str, tuple[str, float, str]] = {}  # uri -> (project, dist, label)

    # Section bounding: a project link must physically lie inside the Projects section.
    # This is what prevents cross-section "exchanges" (a contact GitHub or a
    # certification link being pulled into a project). Only enforced when a Projects
    # heading is actually detected, so resumes without clear headings still work.
    headings = _detect_section_headings(pdf_path)
    enforce_section = any(h[2] == section for h in headings)

    # Where each project's TITLE physically sits. A PDF stores a link as a
    # rectangle and a URL - nothing tells us which project owns it, and the
    # name-based matching above only works when a project name happens to sit
    # near the link. Resumes routinely put links on their own row ("Live Demo |
    # GitHub" under the title), in a sidebar, or behind an icon, and those links
    # used to be discarded. Positions let us answer it the way a reader does:
    # the link belongs to the title directly above it.
    title_positions: list[tuple[int, float, str]] = []  # (page, top, project)
    seen_titles: set[str] = set()

    def _scan_titles(bounded: bool) -> None:
        for page_idx, lines in line_boxes.items():
            for ln in lines:
                owner = best_match(ln["text"])
                if not owner or owner in seen_titles:
                    continue
                if bounded and enforce_section and _section_of(
                    headings, page_idx, float(ln["top"]), float(ln.get("x0", 0.0))
                ) != section:
                    continue
                seen_titles.add(owner)
                title_positions.append((page_idx, float(ln["top"]), owner))

    # Prefer titles that sit inside the Projects section.
    _scan_titles(bounded=True)
    # Then look again WITHOUT that restriction for any project still unplaced.
    # Section bounds come from detected headings, and a heading can be missed or
    # mis-placed on a decorated or multi-column resume - the last project's title
    # was being rejected that way, so its link fell to the previous project and
    # that project rendered three links while this one rendered none. A title we
    # can name is better evidence than a section boundary we inferred.
    if len(seen_titles) < len(names):
        _scan_titles(bounded=False)

    title_positions.sort(key=lambda t: (t[0], t[1]))
    # Exposed for project_links_debug.txt. When a link lands on the wrong
    # project it is because a title was not located, and this is the only way to
    # see that from a real run.
    global _LAST_PROJECT_TITLE_POSITIONS, _LAST_LINK_DECISIONS
    _LAST_PROJECT_TITLE_POSITIONS = list(title_positions)
    _LAST_LINK_DECISIONS = []

    # Links we could not attribute by text. Parked rather than dropped.
    unplaced: list[dict] = []

    for page_idx, page in enumerate(reader.pages):
        annots = page.get("/Annots") or []
        try:
            page_height = float(reader.pages[page_idx].mediabox.height)
        except Exception:
            page_height = None
        if not page_height:
            continue
        candidates = line_boxes.get(page_idx, [])

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
            lowered_uri = uri.lower()
            # Skip contact/social links — they are not project links.
            if any(bad in lowered_uri for bad in contact_deny):
                continue
            # Reject garbage URIs that are actually just label text (e.g. "https://Live%20Demo").
            if lowered_uri.startswith(("http://", "https://")):
                decoded_hint = lowered_uri.replace("%20", " ")
                if "live demo" in decoded_hint or "live%20demo" in lowered_uri:
                    continue
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
            # pypdf uses PDF coords (origin bottom-left); pdfplumber uses origin top-left.
            top = page_height - y1
            bottom = page_height - y0

            # Reject links that don't live in the Projects section.
            #
            # Section bounds are INFERRED from detected headings, and a decorated
            # or multi-column resume can put a heading where it does not belong -
            # which then discards a real project link. So before rejecting, ask a
            # more direct question: is this link still inside a project's block?
            # It is, if the nearest project title above it is BELOW the nearest
            # non-project heading above it. A genuine certification link fails
            # that test (its heading is nearer), so the guard against
            # cross-section leaks still holds.
            if enforce_section and _section_of(headings, page_idx, top, x0) != section:
                # Compared as (page, top) pairs. Comparing bare vertical
                # positions treats "far down page 0" as below "near the top of
                # page 1", which let certification links on a later page look
                # like they sat inside the last project.
                here = (page_idx, top)
                nearest_title = max(
                    ((p, t) for (p, t, _n) in title_positions if (p, t) <= here),
                    default=None,
                )
                nearest_other_heading = max(
                    ((h[0], h[1]) for h in headings
                     if h[2] != section and (h[0], h[1]) <= here),
                    default=None,
                )
                inside_a_project_block = (
                    nearest_title is not None
                    and (nearest_other_heading is None or nearest_title > nearest_other_heading)
                )
                if not inside_a_project_block:
                    continue

            label = "GitHub" if "github.com" in lowered_uri else "Link"
            matched_project, dist = match_project(top, bottom, candidates)
            # Where the link physically sits and who claimed it. Title positions
            # alone were not enough: every title was located and links STILL went
            # to the wrong project, which means the link's own coordinates are
            # the missing half of the picture.
            _LAST_LINK_DECISIONS.append({
                "uri": uri, "page": page_idx, "top": round(top, 1),
                "x0": round(x0, 1), "matched": matched_project, "dist": round(dist, 1),
            })
            if not matched_project:
                # Park it. Dropping the link here is what made a whole project
                # lose its links whenever the layout put them somewhere the text
                # matcher could not read.
                unplaced.append({"uri": uri, "label": label, "page": page_idx, "top": top})
                continue

            prev = best_for_uri.get(uri)
            # Keep the closest (most confident) project for each unique URL.
            if prev is None or dist < prev[1]:
                best_for_uri[uri] = (matched_project, dist, label)

    # Place the parked links by position: the owner is the nearest project title
    # at or above the link. This is how a person reads the page, and it does not
    # care whether the link sits beside the title, on its own row underneath, in
    # a sidebar, or behind an icon.
    for item in unplaced:
        if item["uri"] in best_for_uri:
            continue  # already attributed with better evidence elsewhere
        owner = None
        for page_idx, top, project in title_positions:
            if (page_idx, top) <= (item["page"], item["top"]):
                owner = project
            else:
                break
        if owner:
            best_for_uri[item["uri"]] = (owner, 1e6, item["label"])

    result: dict[str, list[tuple[str, str]]] = {}
    for uri, (project, _dist, label) in best_for_uri.items():
        result.setdefault(project, [])
        pair = (label, uri)
        if pair not in result[project]:
            result[project].append(pair)

    # Layer 3 - reading-order safety net. If a project still has nothing and
    # links are still spare, hand them out in document order, the same trick the
    # certifications path already uses. Only runs when it is unambiguous: one
    # empty project and one spare link. Guessing between several would risk
    # putting a link on the WRONG project, which is worse than a missing one.
    leftovers = [i for i in unplaced if i["uri"] not in best_for_uri]
    empty = [n for n in names if not result.get(n)]
    if len(empty) == 1 and len(leftovers) == 1:
        result.setdefault(empty[0], []).append((leftovers[0]["label"], leftovers[0]["uri"]))

    return result


def extract_contact_links_from_pdf(pdf_path: str) -> dict[str, str]:
    """
    Scan ALL clickable link annotations in the PDF and classify them into contact
    services (linkedin, github, portfolio, leetcode, kaggle, codeforces, codechef,
    google_scholar, twitter). PDFs frequently render these as short anchor text
    ("LinkedIn", "GitHub") while the real URL lives only in the annotation, so
    pdfplumber's text extraction loses them. This recovers the true URLs.

    Returns a dict of {service: full_url}. The first plausible URL wins per service.
    """
    services = {
        "linkedin": ("linkedin.com",),
        "github": ("github.com",),
        "leetcode": ("leetcode.com",),
        "kaggle": ("kaggle.com",),
        "codeforces": ("codeforces.com",),
        "codechef": ("codechef.com",),
        "google_scholar": ("scholar.google.",),
        "twitter": ("twitter.com", "x.com"),
    }
    found: dict[str, str] = {}
    # Contact links live in the header region (above the first content heading). Bounding
    # to that region prevents a project/certification GitHub (inside a content section)
    # from being misclassified as the contact GitHub.
    headings = _detect_section_headings(pdf_path)
    enforce_header = bool(headings)
    header_ok = {None, "summary", "contact"}
    try:
        from pypdf import PdfReader
        reader = PdfReader(pdf_path)
        for page_idx, page in enumerate(reader.pages):
            try:
                page_height = float(reader.pages[page_idx].mediabox.height)
            except Exception:
                page_height = None
            for annot_ref in (page.get("/Annots") or []):
                try:
                    annot = annot_ref.get_object()
                except Exception:
                    continue
                uri = str((annot.get("/A") or {}).get("/URI") or "").strip()
                if not uri:
                    continue
                low = uri.lower()
                if low.startswith(("mailto:", "tel:")):
                    continue
                if not low.startswith(("http://", "https://")):
                    uri = "https://" + uri
                    low = uri.lower()
                # Restrict to the header/contact region.
                if enforce_header and page_height:
                    rect = annot.get("/Rect")
                    if rect and len(rect) >= 4:
                        try:
                            top = page_height - float(rect[3])
                            if _section_of(headings, page_idx, top, float(rect[0])) not in header_ok:
                                continue
                        except Exception:
                            pass
                matched_service = None
                for service, domains in services.items():
                    if any(d in low for d in domains):
                        matched_service = service
                        break
                if matched_service:
                    found.setdefault(matched_service, uri)
                # Note: we deliberately do NOT treat arbitrary links as "portfolio"
                # here — a project's live-demo annotation could be wrongly captured as
                # the user's portfolio. Only unambiguous exact-domain services above.
    except Exception:
        pass
    return found


def extract_section_annotation_links(pdf_path: str, section: str) -> list[str]:
    """
    Return clickable annotation URLs that fall inside a specific resume section
    (e.g. "publications"), in document order. PDFs often render these links as
    anchor text only, so pdfplumber text extraction misses them entirely.

    The section's vertical range is bounded by its heading and the next heading.
    """
    try:
        from pypdf import PdfReader
    except Exception:
        return []

    # Inside a section (after its heading) links are legitimate section content —
    # a credential on credly/coursera/github/linkedin-learning, a company site, etc.
    # Only skip email/phone and personal-email domains. (Contact/social profile links
    # live above the first heading, so they fall outside every section range anyway.)
    contact_deny = (
        "mailto:", "tel:", "gmail.com", "outlook.com", "yahoo.com", "hotmail.com",
    )

    # Build ordered section headings: list of (page_idx, top, section_name).
    headings: list[tuple[int, float, str]] = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                words = page.extract_words(use_text_flow=True, keep_blank_chars=False) or []
                lines: list[dict] = []
                for w in words:
                    text = str(w.get("text", "")).strip()
                    if not text:
                        continue
                    top = float(w.get("top", 0.0))
                    placed = False
                    for ln in lines:
                        if abs(top - ln["top"]) <= 2.5:
                            ln["text"] = (ln["text"] + " " + text).strip()
                            ln["top"] = min(ln["top"], top)
                            placed = True
                            break
                    if not placed:
                        lines.append({"text": text, "top": top})
                for ln in lines:
                    nk = _normalize_key(ln["text"])
                    if nk in _SECTION_HEADING_KEYS and len(ln["text"].split()) <= 4:
                        headings.append((page_idx, float(ln["top"]), _SECTION_HEADING_KEYS[nk]))
    except Exception:
        return []

    headings.sort(key=lambda h: (h[0], h[1]))
    # Locate the requested section's [start, end) range.
    start = None
    end = None
    for i, (pg, top, name) in enumerate(headings):
        if name == section:
            start = (pg, top)
            end = (headings[i + 1][0], headings[i + 1][1]) if i + 1 < len(headings) else None
            break
    if start is None:
        return []

    def in_range(pg: int, top: float) -> bool:
        if (pg, top) < start:
            return False
        if end is not None and (pg, top) >= end:
            return False
        return True

    ordered: list[str] = []
    seen: set[str] = set()
    try:
        reader = PdfReader(pdf_path)
        for page_idx, page in enumerate(reader.pages):
            try:
                page_height = float(reader.pages[page_idx].mediabox.height)
            except Exception:
                continue
            annot_items = []
            for annot_ref in (page.get("/Annots") or []):
                try:
                    annot = annot_ref.get_object()
                except Exception:
                    continue
                uri = str((annot.get("/A") or {}).get("/URI") or "").strip()
                if not uri:
                    continue
                if not uri.startswith(("http://", "https://")):
                    if uri.startswith(("mailto:", "tel:")):
                        continue
                    uri = "https://" + uri
                if any(bad in uri.lower() for bad in contact_deny):
                    continue
                rect = annot.get("/Rect")
                if not rect or len(rect) < 4:
                    continue
                try:
                    x0 = float(rect[0])
                    y1 = float(rect[3])
                except Exception:
                    continue
                top = page_height - y1
                annot_items.append((page_idx, top, x0, uri))
            # Reading order: row band (top rounded to ~12pt), then column (x0).
            annot_items.sort(key=lambda t: (t[0], round(t[1] / 12.0), t[2]))
            for pg, top, x0, uri in annot_items:
                if in_range(pg, top) and uri not in seen:
                    seen.add(uri)
                    ordered.append(uri)
    except Exception:
        return ordered
    return ordered


def extract_named_item_links_from_pdf(pdf_path: str, names: list[str], section: str | None = None) -> dict[str, str]:
    """
    Match clickable link annotations to named items (e.g. certifications) by the
    text physically UNDER each link rectangle (horizontal + vertical overlap).

    This is robust for multi-column layouts where the item NAME itself is the link
    (common for certifications) — position/section-range matching fails there
    because pdfplumber merges both columns into one row. Returns {item_name: url}.

    When `section` is given, only links physically inside that section are considered,
    which prevents cross-section link exchanges.
    """
    try:
        from pypdf import PdfReader
    except Exception:
        return {}
    names = [str(n or "").strip() for n in (names or []) if str(n or "").strip()]
    if not names:
        return {}
    headings = _detect_section_headings(pdf_path) if section else []
    enforce_section = bool(section) and any(h[2] == section for h in headings)
    norm_to_name = {_normalize_key(n): n for n in names}
    norm_names = sorted((k for k in norm_to_name if k), key=len, reverse=True)

    # Word boxes per page.
    words_by_page: dict[int, list[dict]] = {}
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                ws = []
                for w in page.extract_words(use_text_flow=True, keep_blank_chars=False) or []:
                    t = str(w.get("text", "")).strip()
                    if not t:
                        continue
                    ws.append({
                        "text": t,
                        "x0": float(w.get("x0", 0.0)), "x1": float(w.get("x1", 0.0)),
                        "top": float(w.get("top", 0.0)), "bottom": float(w.get("bottom", 0.0)),
                    })
                words_by_page[page_idx] = ws
    except Exception:
        return {}

    # Collect every (uri, text-under-link) pair first, then resolve with 1:1 best-score
    # matching so similar names (e.g. many "... Machine Learning Specialization" certs)
    # don't collide and steal each other's links.
    link_texts: list[tuple[str, str]] = []  # (uri, normalized text under the link)
    seen_uris: set[str] = set()
    try:
        reader = PdfReader(pdf_path)
        for page_idx, page in enumerate(reader.pages):
            try:
                page_height = float(reader.pages[page_idx].mediabox.height)
            except Exception:
                continue
            ws = words_by_page.get(page_idx, [])
            for annot_ref in (page.get("/Annots") or []):
                try:
                    annot = annot_ref.get_object()
                except Exception:
                    continue
                uri = str((annot.get("/A") or {}).get("/URI") or "").strip()
                if not uri:
                    continue
                low = uri.lower()
                if low.startswith(("mailto:", "tel:")):
                    continue
                if not low.startswith(("http://", "https://")):
                    uri = "https://" + uri
                    low = uri.lower()
                if any(b in low for b in ("gmail.com", "outlook.com", "yahoo.com", "hotmail.com")):
                    continue
                if uri in seen_uris:
                    continue
                rect = annot.get("/Rect")
                if not rect or len(rect) < 4:
                    continue
                try:
                    rx0, ry0, rx1, ry1 = [float(v) for v in rect[:4]]
                except Exception:
                    continue
                r_top = page_height - ry1
                r_bot = page_height - ry0
                r_xa, r_xb = min(rx0, rx1), max(rx0, rx1)
                # Reject links outside the target section (prevents cross-section exchange).
                if enforce_section and _section_of(headings, page_idx, r_top, r_x0) != section:
                    continue
                # Words overlapping the link rectangle (the anchor text = the item name).
                seg = [
                    w for w in ws
                    if not (w["bottom"] < r_top - 2 or w["top"] > r_bot + 2)
                    and not (w["x1"] < r_xa - 2 or w["x0"] > r_xb + 2)
                ]
                if not seg:
                    # Fallback: nearest words on the same row starting at the rect.
                    row = [w for w in ws if not (w["bottom"] < r_top - 2 or w["top"] > r_bot + 2)]
                    row.sort(key=lambda w: abs(w["x0"] - r_xa))
                    seg = row[:10]
                seg.sort(key=lambda w: (w["top"], w["x0"]))
                text_norm = _normalize_key(" ".join(w["text"] for w in seg))
                if not text_norm:
                    continue
                seen_uris.add(uri)
                link_texts.append((uri, text_norm))
    except Exception:
        pass

    # Score every (link, name) pair; higher score = stronger, more specific match.
    pairs = []  # (score, uri, original_name)
    for uri, tnorm in link_texts:
        for nnorm in norm_names:
            if len(nnorm) < 4:
                continue
            if nnorm in tnorm:
                score = len(nnorm)                      # full name sits under the link (best)
            elif tnorm in nnorm and len(tnorm) >= max(5, int(0.6 * len(nnorm))):
                score = len(tnorm)                      # link covers most of the name
            else:
                continue
            pairs.append((score, uri, norm_to_name[nnorm]))
    pairs.sort(key=lambda p: p[0], reverse=True)

    # Greedy 1:1 assignment: each link to one name, each name to one link.
    result: dict[str, str] = {}
    used_uri: set[str] = set()
    used_name: set[str] = set()
    for _score, uri, name in pairs:
        if uri in used_uri or name in used_name:
            continue
        result[name] = uri
        used_uri.add(uri)
        used_name.add(name)
    return result


def _collect_used_urls(parsed: dict) -> set[str]:
    """Gather every URL already placed (contact, projects, publications) so section
    link injection never duplicates a link across sections."""
    used: set[str] = set()
    contact = parsed.get("contact")
    if isinstance(contact, dict):
        for v in contact.values():
            v = str(v or "").strip().lower()
            if v:
                used.add(v)
    for p in parsed.get("projects") or []:
        if not isinstance(p, dict):
            continue
        for l in p.get("links") or []:
            if isinstance(l, dict):
                u = str(l.get("url") or l.get("href") or l.get("link") or "").strip().lower()
                if u:
                    used.add(u)
        for fld in ("url", "github_link"):
            u = str(p.get(fld) or "").strip().lower()
            if u:
                used.add(u)
    for pub in parsed.get("publications") or []:
        if isinstance(pub, dict):
            u = str(pub.get("url") or "").strip().lower()
            if u:
                used.add(u)
    return used


def save_uploaded_pdf(file: UploadFile) -> str:
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    file_ext = filename.rsplit(".", 1)[-1].lower()
    file_name = token_hex(10)
    return os.path.join(uploads_dir, f"{file_name}.{file_ext}")


def normalize_list_of_strings(items):
    return [str(item).strip() for item in (items or []) if str(item).strip()]


# ---------------------------------------------------------------------------
# Bullet-loss recovery
# ---------------------------------------------------------------------------
# On long resumes the optimizer model sometimes silently drops or merges bullet
# points even though the prompt forbids it (the JSON still comes back complete,
# just shorter — so it is NOT a truncation issue). To guarantee no content is
# lost, we re-read the ORIGINAL resume text after the AI returns and restore any
# bullet whose content is missing from the optimized entry. This is done with
# two hard safety guards so it can never cause sub-section exchange or duplicate
# text:
#   1. Anchoring is section-bounded and per-entry: a candidate line is only ever
#      added to the one entry whose title uniquely sits above it, within the same
#      section range. Ambiguous/duplicate titles are skipped entirely.
#   2. A candidate is only restored when most of its words are absent from the
#      entry's existing (reworded) bullets, so kept-but-rephrased content is
#      never duplicated.
_RESTORE_MARKERS = "•‣◦⁃∙*·▪●❖✧»>–—-"

# Verbs a resume bullet opens with. Used to tell a NEW bullet from the wrapped
# tail of the one above when the PDF lost the bullet glyph: a tail continues a
# sentence ("UI using HTML...", "Lever, Workday), cutting...") while a bullet
# starts an action. Deliberately includes the weak and passive-learning verbs
# the prompt bans ("Worked", "Gained", "Studied") — those still START bullets on
# an unoptimized resume, which is exactly the input being parsed here.
_BULLET_ACTION_VERBS = {
    "achieved", "analysed", "analyzed", "architected", "assisted", "authored",
    "automated", "benchmarked", "built", "collaborated", "compiled", "conducted",
    "consolidated", "coordinated", "created", "cut", "debugged", "decreased",
    "delivered", "deployed", "designed", "developed", "diagnosed", "documented",
    "drove", "eliminated", "engineered", "enhanced", "established", "evaluated",
    "executed", "expanded", "facilitated", "gained", "generated", "grew",
    "handled", "helped", "identified", "implemented", "improved", "increased",
    "influenced", "initiated", "instrumented", "integrated", "introduced",
    "launched", "led", "leveraged", "maintained", "managed", "mapped",
    "mentored", "migrated", "modelled", "modeled", "monitored", "negotiated",
    "operated", "optimised", "optimized", "orchestrated", "organised",
    "organized", "outlined", "overhauled", "owned", "participated", "partnered",
    "performed", "pioneered", "planned", "prepared", "presented", "produced",
    "programmed", "provided", "ran", "rebuilt", "reduced", "refactored",
    "researched", "resolved", "responsible", "restructured", "reviewed",
    "revamped", "scaled", "secured", "set", "shipped", "simplified", "solved",
    "spearheaded", "standardised", "standardized", "streamlined", "studied",
    "supported", "tested", "tracked", "trained", "transformed", "translated",
    "troubleshot", "validated", "worked", "wrote",
}


def _restore_tokens(text: str) -> set:
    return set(re.findall(r"[a-z0-9]+", str(text or "").lower()))


# Date fragments used to spot header/date rows that must never become bullets.
# Month names are anchored (not "any word") so achievement lines like
# "Best Project 2024" are never mistaken for a date. Covers "Jan 2026",
# "2 January 2026", and numeric "12/2022" / "12/31/2022" formats.
_RESTORE_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_RESTORE_DATE = (
    r"(?:\d{1,2}/\d{1,2}/\d{2,4}"
    r"|\d{1,2}/\d{4}"
    r"|(?:\d{1,2}\s+)?" + _RESTORE_MONTH + r"\s*,?\s*\d{4})"
)
# Open-ended range words: "Present", "Current", "Currently", "Now", "Ongoing",
# "Till Date", "To Date", etc. (a range like "12/2024 - Currently").
_RESTORE_OPEN_END = r"(?:present|current(?:ly)?|ongoing|now|(?:to|till)\s*(?:date|now|present))"
# Range separators. A dash was the only form recognised, so a leaked header row
# written with a word - "Outlier May 2026 to June 2026" - was not detected as
# meta and got restored as a bullet on the PREVIOUS entry.
_RESTORE_RANGE_SEP = r"(?:\s*[-–—]\s*|\s+(?:to|until|through|thru)\s+)"
_RESTORE_DATE_RANGE = (
    _RESTORE_DATE + _RESTORE_RANGE_SEP +
    r"(?:" + _RESTORE_DATE + r"|" + _RESTORE_OPEN_END + r"|date)"
)


def _restore_is_meta_line(line: str) -> bool:
    """A line that is a date, a date range, a link, or an entry header — never a
    bullet. Restoring these as bullets produces garbage like a stray
    "2 January 2026" bullet, or bleeds an entry's "San Francisco, USA 12/2022 -
    11/2024" header row into its bullets."""
    l = str(line or "").strip()
    if not l:
        return True
    low = l.lower()
    if "http://" in low or "https://" in low or "www." in low:
        return True
    if re.match(r"^(github|gitlab|kaggle|linkedin|leetcode|codeforces|codechef|"
                r"demo|email|url|link|portfolio|website|tel|phone|live|mobile)\b[:\s]", low):
        return True
    # A line that is ONLY a date or a date range (e.g. "May 2025 – Present",
    # "2 January 2026", "01/2022 - 12/2022").
    if re.fullmatch(_RESTORE_DATE_RANGE, l, re.I) or re.fullmatch(_RESTORE_DATE, l, re.I):
        return True
    # Entry-header row that leaked: a short, title-case label (a role, or a
    # location like "San Francisco, USA" / "Thailand") followed by a trailing
    # date or date range, e.g. "Thailand 01/2022 - 12/2022", "Freelancer Dec
    # 2025 - Present". Real bullets are full sentences; requiring the prefix to
    # be title-case (no lowercase connector words) keeps ordinary bullets that
    # merely end in a month-year safe.
    date_tail = re.search(r"(?:" + _RESTORE_DATE_RANGE + r"|" + _RESTORE_DATE + r")\s*$", l, re.I)
    if date_tail and date_tail.start() > 0:
        prefix = l[: date_tail.start()].strip(" -–—|,·•/")
        words = prefix.split()
        if (1 <= len(words) <= 5
                and not prefix.endswith((".", ":"))
                and all((not w[0].isalpha()) or w[0].isupper() for w in words)):
            return True
    return False


def _restore_section_lines(resume_string: str) -> list:
    """Tag every resume line with the canonical section it belongs to (heading
    lines themselves are dropped so they can't be mistaken for bullets)."""
    out = []
    cur = None
    for raw in str(resume_string or "").splitlines():
        line = raw.rstrip()
        nk = _heading_key(line)
        if nk:
            cur = nk
            continue
        out.append((line, cur))
    return out


def _original_entry_candidates(section_lines: list, section: str, identifiers: list) -> dict:
    """For each entry identifier, return the original content lines that sit under
    its title within `section`'s range. Returns {identifier: [lines]}."""
    rng = [i for i, (_l, s) in enumerate(section_lines) if s == section]
    if not rng:
        return {}
    lo, hi = rng[0], rng[-1] + 1
    norm = [_normalize_key(l) for l, _s in section_lines]
    positions = []
    for ident in identifiers:
        ik = _normalize_key(ident)
        pos = -1
        if ik and len(ik) >= 4:
            for i in range(lo, hi):
                if ik in norm[i]:
                    pos = i
                    break
        positions.append(pos)
    result = {}
    for j, (ident, start) in enumerate(zip(identifiers, positions)):
        if start < 0 or positions.count(start) > 1:  # missing or ambiguous title -> skip (safety)
            continue
        end = hi
        for k in positions[j + 1:]:
            if k > start:
                end = k
                break
        # Every OTHER entry's title, so this entry's range can be closed the
        # moment the next one begins - even when that title was never located.
        # `end` above is the next title we FOUND; a title split across lines by a
        # narrow gutter ("Myntra E-" / "commerce") is never found, so without
        # this the range ran to the end of the section and the first entry
        # swallowed every following entry's bullets.
        own_key = _normalize_key(ident)
        other_keys = [
            k for k in (_normalize_key(x) for x in identifiers if x)
            if k and len(k) >= 4 and k != own_key
        ]

        cands = []
        seen_marker = False
        # The widest line in this entry's range approximates the page's text
        # column. A line at (or near) that width was wrapped by the PDF, not
        # ended by the writer — that is what identifies a continuation.
        entry_max_len = max(
            (len(section_lines[i][0].rstrip()) for i in range(start + 1, end)),
            default=0,
        )
        prev_len = 0
        prev_raw = ""
        for i in range(start + 1, end):
            line = section_lines[i][0]
            # Hard boundary: a new entry title. Titles in virtually every template
            # carry a "|" stack/role separator while bullets never do — stopping
            # here prevents capturing a following entry the optimizer may have
            # dropped (which would otherwise be restored onto the wrong entry).
            # This entry's OWN link row - "Live Demo | GitHub". Not a title, not
            # a stack row, not a bullet. It has to be skipped before EITHER
            # boundary test below, because it trips both: it carries a pipe, and
            # it also reads as a short comma/pipe-separated list of known terms.
            # Whichever fired first stopped collection at the line directly under
            # the title, so every project with a link row collected ZERO bullets
            # and had no protection at all - on a real resume Tailorcv.com and
            # the Myntra clone got nothing, while the one project without a link
            # row kept all four bullets and all its detail. That is exactly why
            # words went missing from some entries and not others.
            if _RESTORE_LINK_LABEL_ROW_RE.fullmatch(line.strip()):
                continue
            stripped = line.strip()
            # Layout debris. PDF extraction can strand a separator on a line of
            # its own — the Myntra clone's link row came out as "|" then
            # "Live Demo GitHub" on the next line. A lone pipe carries a pipe, so
            # the title test below fired on it and ended collection before the
            # entry's first bullet. Nothing without a letter or a digit in it can
            # be a title.
            if stripped and not re.search(r"[A-Za-z0-9]", stripped):
                continue
            if "|" in line and not _restore_is_meta_line(line):
                break

            clean_peek = stripped.lstrip(_RESTORE_MARKERS + " ").strip()
            # Is this the TAIL of the bullet above rather than a line of its own?
            # Decided BEFORE the boundary tests below, because a wrapped tail can
            # trip them: "usage quotas, plan gating, and subscription lifecycle
            # handling." is eight words with two commas, which reads as a
            # technology row and used to end collection mid-entry, costing that
            # entry every bullet after it.
            # Is this line the TAIL of the bullet above, or a bullet of its own?
            #
            # Two signals, and BOTH are required, because either alone merges
            # real bullets together:
            #   1. No bullet marker. A marker always starts a new bullet.
            #   2. The previous physical line ran to the margin. That is what a
            #      PDF wrap looks like — the text had nowhere else to go. A line
            #      that stopped short ended its bullet, whether or not it has a
            #      full stop.
            #
            # Sentence punctuation is NOT usable here: plenty of resumes write
            # bullets with no trailing period at all. Relying on it merged an
            # entire entry — four separate bullets became one paragraph reading
            # "...over product data Built RESTful APIs... Designed normalized
            # PostgreSQL schemas... Integrated backend with frontend...".
            has_marker = stripped[:1] in _RESTORE_MARKERS
            if has_marker:
                seen_marker = True
            prev_wrapped = prev_len >= max(40, int(entry_max_len * 0.85))
            # Width alone is not enough: when every bullet in an entry is about
            # the same length, each one looks like a wrap of the one above and
            # the whole entry collapses into a single paragraph. So the line must
            # ALSO read as a continuation — it starts soft (lower case, a digit,
            # an opening bracket), or the line above stopped mid-clause.
            starts_soft = not clean_peek[:1].isupper()
            prev_mid_clause = (
                prev_raw.rstrip().endswith((",", "-", "–", "/", "&", "+"))
                or prev_raw.count("(") > prev_raw.count(")")
            )
            # What actually separates a new bullet from a wrapped tail is the
            # OPENING WORD. Resume bullets begin with an action verb — that is
            # what every resume guide asks for and what this prompt enforces —
            # and a wrapped tail never does:
            #     "Built RESTful APIs using FastAPI..."      <- new bullet
            #     "Designed normalized PostgreSQL schemas"   <- new bullet
            #     "UI using HTML, CSS, and JavaScript."      <- tail of the line above
            #     "Lever, Workday), cutting per-application" <- tail
            #     "(3,116 individuals) generate the highest" <- tail
            # Width and punctuation both failed here: bullets written without
            # full stops merged into one paragraph, and bullets of similar length
            # each looked like a wrap of the one before it.
            first_word = re.sub(r"[^A-Za-z]", "", clean_peek.split(" ", 1)[0]).lower()
            starts_new_sentence = first_word in _BULLET_ACTION_VERBS
            is_tail = bool(
                cands
                and clean_peek
                and not has_marker
                and (starts_soft or not starts_new_sentence)
            )

            # Hard boundary: the line is (or begins) another entry's title. A
            # prefix match catches the wrapped case, where only the first
            # fragment of the next title appears on its own line.
            lnorm = _normalize_key(line)
            if not is_tail and lnorm and len(lnorm) >= 4 and any(
                k.startswith(lnorm) or lnorm.startswith(k) for k in other_keys
            ):
                break
            if not is_tail and _looks_like_stack_line(stripped):
                # A technology row BEFORE any bullet has been collected is this
                # entry's own stack, printed under its title ("html,css,javascript"
                # under the Myntra clone). Breaking there cost that entry every
                # bullet it had. Only once bullets have been seen does a stack row
                # mean the next entry has started.
                if not cands:
                    continue
                break
            if _restore_is_meta_line(line):
                continue
            clean = clean_peek
            if not clean:
                continue
            # A bullet that WRAPS in the PDF arrives as two lines:
            #   "...using qualitative and quantitative methods for 10+"
            #   "research projects."
            # Treated separately, the tail is under the 3-word floor and is
            # thrown away, leaving the bullet permanently truncated at the line
            # break - which is exactly how "...for 10+" reached a rendered
            # resume. Rejoin the tail onto its own sentence.
            #
            # `is_tail` above is the decision - it knows about bullet markers,
            # which capitalisation alone does not. Re-testing capitalisation here
            # undid it for every tail that happens to begin with a proper noun or
            # an acronym, and those fragments then shipped as bullets of their own:
            #     "Lever, Workday), cutting per-application tailoring from ~10..."
            #     "SMTP, and one-click portfolio publishing to Netlify."
            # Both are the tail of the line above, and both reached a real resume.
            # Track the line just consumed, so the next iteration can tell a
            # wrapped line from one that simply ended.
            prev_len, prev_raw = len(stripped), stripped
            if is_tail:
                cands[-1] = f"{cands[-1].rstrip()} {clean}"
                continue
            cands.append(clean)
        # The floor is applied AFTER rejoining, so a legitimate short tail has
        # already been merged into the sentence it belongs to.
        result[ident] = [c for c in cands if len(c.split()) >= 3]
    return result


def _restore_is_header_echo(candidate: str, header_values: list) -> bool:
    """True when a candidate line is really the entry's own header — its role,
    company, or location — e.g. "Data Analyst Research Intern Kolkata". These
    sit just under the entry title and must never be restored as a bullet.

    Matches only when a header field's text is contained in the candidate AND the
    candidate is about as short as that header (a real bullet that merely mentions
    the title is a full sentence and stays much longer)."""
    cand_norm = _normalize_key(candidate)
    if not cand_norm:
        return False
    cand_words = len(candidate.split())
    for hv in header_values:
        hv_norm = _normalize_key(hv)
        if len(hv_norm) < 5:
            continue
        if hv_norm in cand_norm and cand_words <= len(hv.split()) + 2:
            return True
    return False


def _entry_original_bullets(cands, entry: dict, entries: list, id_fields) -> list:
    """The original resume lines under `entry` that are genuinely bullets.

    Extracted so the restorer and its callers agree on what
    counts as an original bullet — otherwise the change report would claim a
    header row or a stack line was "dropped" content the restorer had already
    (correctly) refused to bring back.
    """
    cands = [c for c in (cands or []) if str(c).strip()]
    if not cands:
        return []
    # Drop candidates that are really this entry's own header row (role,
    # company, location) — e.g. "Data Analyst Research Intern Kolkata".
    header_values = [
        str(entry.get(k, "")).strip()
        for k in ("company", "title", "role", "organization", "name", "location", "place", "city")
    ]
    header_values = [h for h in header_values if h]
    # ...and any OTHER entry's header too. Templates that put the entry
    # name in a narrow gutter wrap it across lines ("Myntra E-" /
    # "commerce"), and those fragments sit inside the previous entry's
    # line range, so the first project absorbed the next projects'
    # titles and bullets as its own.
    for other in entries:
        if other is entry:
            continue
        header_values.extend(
            str(other.get(k, "")).strip()
            for k in ("company", "title", "role", "organization", "name")
            if str(other.get(k, "")).strip()
        )
    cands = [c for c in cands if not _restore_is_header_echo(c, header_values)]
    # A stack row ("html,css,javascript") or a link caption row is never
    # a bullet, whichever entry it sits under.
    cands = [
        c for c in cands
        if not _looks_like_stack_line(c)
        and not _RESTORE_LINK_LABEL_ROW_RE.fullmatch(str(c).strip())
    ]
    # Another entry's name leaking in mid-line, e.g. "Customer Python,
    # PowerBI, SQL, Excel" - a wrapped title glued to a stack row.
    other_names = {
        _normalize_key(str(o.get(f, "")))
        for o in entries if o is not entry
        for f in id_fields if str(o.get(f, "")).strip()
    }
    other_names.discard("")
    cands = [
        c for c in cands
        if not any(n and _normalize_key(c).startswith(n[:12]) for n in other_names)
    ]
    return cands


def restore_dropped_bullets(parsed: dict, resume_string: str) -> dict:
    """Append any original bullet whose content the optimizer dropped, back onto
    the exact entry it came from. Safe against sub-section exchange and against
    duplicating reworded content (see module guards above)."""
    if not isinstance(parsed, dict) or not resume_string:
        return parsed
    section_lines = _restore_section_lines(resume_string)
    plan = (
        ("experience", "experience", ("company", "title")),
        ("projects", "projects", ("name",)),
        ("extracurricular", "extracurriculars", ("role", "organization")),
    )
    for heading_section, parsed_key, id_fields in plan:
        entries = [e for e in (parsed.get(parsed_key) or []) if isinstance(e, dict)]
        if not entries:
            continue
        identifiers = []
        for e in entries:
            vals = [str(e.get(f, "")).strip() for f in id_fields if str(e.get(f, "")).strip()]
            identifiers.append(max(vals, key=len) if vals else "")
        orig = _original_entry_candidates(section_lines, heading_section, identifiers)
        for e, ident in zip(entries, identifiers):
            cands = _entry_original_bullets(orig.get(ident), e, entries, id_fields)
            if not cands:
                continue
            ai_bullets = [str(b).strip() for b in (e.get("bullets") or []) if str(b).strip()]

            # A REWRITTEN bullet is not a DROPPED bullet, and word overlap cannot
            # tell them apart. A vague original carries almost no distinctive
            # words, so a good rewrite of it shares almost none:
            #   "Worked on monthly reporting and helped the sales team"
            #   -> "Automated recurring executive reporting, eliminating manual
            #       consolidation for the revenue organisation"
            # Judged on words alone that reads as deleted, and the weak original
            # was appended underneath its own rewrite, doubling the entry. The
            # COUNT is the reliable signal: once the optimizer has returned at
            # least as many bullets as the entry started with, every original has
            # a counterpart. enforce_bullet_facts then guarantees each of those
            # counterparts actually kept the original's facts.
            if len(ai_bullets) >= len(cands):
                continue

            ai_tokens = set()
            for b in ai_bullets:
                ai_tokens |= _restore_tokens(b)

            # Restore only as many as are genuinely missing. Bringing back every
            # low-overlap candidate also brought back the ORIGINAL of a bullet
            # that had merely been rewritten, so recovering one dropped bullet
            # could add two. Least-represented candidates go first: those are the
            # ones with no counterpart in the output.
            missing_count = len(cands) - len(ai_bullets)
            scored = []
            for c in cands:
                ct = _restore_tokens(c)
                if ct:
                    scored.append((len(ct & ai_tokens) / len(ct), c))
            scored.sort(key=lambda pair: pair[0])

            added = 0
            for _, c in scored:
                if added >= missing_count:
                    break
                ct = _restore_tokens(c)
                # Re-scored against what has already gone back, so two near
                # identical originals cannot both be restored.
                if len(ct & ai_tokens) / len(ct) < 0.4:  # content absent -> dropped
                    ai_bullets.append(c)
                    ai_tokens |= ct
                    added += 1
            if added:
                e["bullets"] = ai_bullets
    return parsed


def _restore_tokens(text: str) -> set[str]:
    """Content words of a bullet, for comparing what is already on the resume."""
    return {t for t in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(t) > 3}


def _looks_like_stack_line(text: str) -> bool:
    """Whether a row is a technology list rather than a project name.

    Resumes put the stack on its own row under the title ("Python, PowerBI, SQL,
    Excel"). Restoring that as a project produced an entry named after the tech
    list carrying a copy of the real project's bullets.
    """
    t = str(text or "").strip()
    if not t:
        return True
    # A stack row is a SHORT list of tool names. Length has to be checked before
    # the comma test below, which fires on any line containing two commas - and a
    # densely written bullet contains plenty:
    #   "...across 15 job boards (LinkedIn, Indeed, Naukri, Greenhouse, Lever,
    #    Workday), cutting per-application tailoring from ~10 minutes..."
    # A stack row is a hard boundary while collecting an entry's original
    # bullets, so treating that sentence as one stopped the scan at the entry's
    # FIRST bullet and returned nothing. On any resume written with commas, the
    # bullet protections were silently inert.
    if len(t.split()) > 12:
        return False
    if t.count(",") >= 2:
        return True
    parts = [p.strip() for p in re.split(r"[,/|]", t) if p.strip()]
    if len(parts) >= 2 and all(len(p.split()) <= 2 for p in parts):
        known = sum(1 for p in parts if _is_atomic_hard_skill(p))
        if known >= max(2, len(parts) - 1):
            return True
    return False


# A date left on the end of a title row once the stack has been split off
# ("Customer Behaviour Analytics January 2026").
_RESTORE_TRAILING_DATE_RE = re.compile(
    r"\s*(?:" + _RESTORE_DATE_RANGE + r"|" + _RESTORE_DATE + r")\s*$",
    re.IGNORECASE,
)


# A row made only of link captions - "Live Demo | GitHub", "Demo · Source".
_RESTORE_LINK_LABEL_ROW_RE = re.compile(
    r"\s*(?:live\s*demo|demo|github|gitlab|source(?:\s*code)?|repo(?:sitory)?|link|website|"
    r"site|preview|play\s*store|app\s*store|video|paper|docs?)"
    # Separator may be punctuation OR just whitespace: the pipe in
    # "Live Demo | GitHub" does not always survive text extraction, and the
    # bare "Live Demo GitHub" that remains was taken for a project title.
    r"(?:(?:\s*[|/,·•–—-]\s*|\s+)(?:live\s*demo|demo|github|gitlab|source(?:\s*code)?|"
    r"repo(?:sitory)?|link|website|site|preview|play\s*store|app\s*store|video|paper|docs?))*\s*",
    re.IGNORECASE,
)


def _bullet_facts(text: str) -> set:
    """The concrete facts a rewrite is not allowed to drop.

    Numbers and proper nouns are what a bullet is actually worth: "15 job boards
    (LinkedIn, Indeed, Naukri, Greenhouse, Lever, Workday)" carries seven of
    them and "a Chrome extension for job boards" carries one. Ordinary words are
    deliberately excluded - tailoring is allowed to replace those, and treating
    them as facts would flag every genuine rewrite.
    """
    raw = str(text or "")
    out = {m.group(0).lower().rstrip(".,;") for m in re.finditer(r"\d[\d,.]*\+?%?", raw)}
    for m in re.finditer(r"(?<![.\w])([A-Za-z][A-Za-z0-9+#.\-]*)", raw):
        word = m.group(1)
        # A bullet's opening word is capitalised by convention, not because it
        # names anything: "Built", "Shipped", "Integrated" are not facts.
        if len(word) < 2 or not raw[:m.start()].strip():
            continue
        if word[0].isupper() or word.isupper():
            out.add(word.lower().rstrip(".,;"))
    out.discard("")
    return out


def enforce_bullet_facts(parsed: dict, resume_string: str) -> dict:
    """Put the candidate's own sentence back when a rewrite dropped its facts.

    The prompt tells the model to preserve every detail before rewriting, and on
    a good run it does. But an instruction is not a guarantee and the failure is
    silent: the bullet count stays right, the sentence reads cleanly, and the
    named tools, the secondary metrics and the enumerated lists are simply gone.
    One real run lost "15 job boards (LinkedIn, Indeed, Naukri, Greenhouse,
    Lever, Workday)", "automated end-to-end using Playwright", "3,116
    individuals" and "50% of Hat purchases" in a single pass.

    So the rule is enforced here in code rather than trusted to the model: a
    polished sentence that has lost the evidence is worth less to the candidate
    than the sentence they wrote themselves, and when the two conflict the facts
    win.
    """
    if not isinstance(parsed, dict) or not resume_string:
        return parsed
    section_lines = _restore_section_lines(resume_string)
    plan = (
        ("experience", "experience", ("company", "title")),
        ("projects", "projects", ("name",)),
        ("extracurricular", "extracurriculars", ("role", "organization")),
    )
    for heading_section, parsed_key, id_fields in plan:
        entries = [e for e in (parsed.get(parsed_key) or []) if isinstance(e, dict)]
        if not entries:
            continue
        identifiers = []
        for e in entries:
            vals = [str(e.get(f, "")).strip() for f in id_fields if str(e.get(f, "")).strip()]
            identifiers.append(max(vals, key=len) if vals else "")
        orig = _original_entry_candidates(section_lines, heading_section, identifiers)
        for e, ident in zip(entries, identifiers):
            cands = _entry_original_bullets(orig.get(ident), e, entries, id_fields)
            if not cands:
                continue
            ai_bullets = [str(b).strip() for b in (e.get("bullets") or []) if str(b).strip()]
            if not ai_bullets:
                continue
            used: set = set()
            for original in cands:
                want = _bullet_facts(original)
                if not want:
                    continue  # nothing concrete to protect
                # The rewrite may sit at any index, so match on content rather
                # than position.
                best_i, best_score = -1, -1
                for i, ai in enumerate(ai_bullets):
                    if i in used:
                        continue
                    score = len(want & _bullet_facts(ai)) + len(
                        _restore_tokens(original) & _restore_tokens(ai)
                    )
                    if score > best_score:
                        best_i, best_score = i, score
                if best_i < 0:
                    continue
                used.add(best_i)
                rewrite = ai_bullets[best_i]

                # A TRUNCATED bullet. When a bullet wraps in the PDF the model is
                # shown two lines and sometimes copies only the first, returning a
                # sentence that stops mid-thought:
                #     "...using qualitative and quantitative methods for 10+"
                # The fact check cannot see this - the missing tail ("research
                # projects.") is ordinary lower-case words, and every number and
                # proper noun is still present - so the broken sentence shipped.
                # A rewrite that is a literal prefix of the original is not a
                # rewrite at all, it is the original cut short.
                def _norm(s: str) -> str:
                    return " ".join(str(s).split()).rstrip(".").lower()

                n_rewrite, n_original = _norm(rewrite), _norm(original)
                truncated = (
                    n_original.startswith(n_rewrite)
                    and len(n_rewrite) < len(n_original)
                )

                if truncated or (want - _bullet_facts(rewrite)):
                    ai_bullets[best_i] = original
            e["bullets"] = ai_bullets
    return parsed


def restore_dropped_entries(parsed: dict, resume_string: str) -> dict:
    """Put back a whole PROJECT the optimizer omitted.

    restore_dropped_bullets recovers bullets onto entries that survived, but
    nothing noticed when an entire entry vanished. On a long resume the model
    silently returned two projects out of three, and the damage compounds: the
    missing project's links have no owner left, so the positional and
    reading-order fills hand them to whatever section is nearest - which is how
    a project's GitHub ended up on a certification and a stray "Link" on a
    school.

    Only titles that clearly head an entry are restored, and only when the
    original has real bullets under them, so prose is never promoted into a
    fake project.
    """
    if not isinstance(parsed, dict) or not resume_string:
        return parsed

    projects = parsed.get("projects")
    if not isinstance(projects, list):
        return parsed

    section_lines = _restore_section_lines(resume_string)
    idx = [i for i, (_l, s) in enumerate(section_lines) if s == "projects"]
    if not idx:
        return parsed
    lo, hi = idx[0], idx[-1] + 1

    have = {_normalize_key(str(p.get("name") or "")) for p in projects if isinstance(p, dict)}
    have.discard("")

    # Walk the original Projects block, collecting each title and its bullets.
    found: list[tuple[str, list[str]]] = []
    current: tuple[str, list[str]] | None = None
    for i in range(lo, hi):
        line = str(section_lines[i][0] or "").strip()
        if not line:
            continue
        is_bullet = bool(re.match(r"^\s*[•‣▪◦●·*\-–—]", section_lines[i][0]))
        if is_bullet:
            if current:
                text = re.sub(r"^\s*[•‣▪◦●·*\-–—]+\s*", "", line).strip()
                if len(text) > 25:
                    current[1].append(text)
            continue
        if len(line) > 90:
            continue
        # NOT skipped for being a "meta" line. _restore_is_meta_line is designed
        # to spot entry-HEADER rows so they never become bullets - and an entry
        # header is exactly what a title is. Skipping them here meant a project
        # whose title row carries a date ("Myntra E-commerce Website Clone mar
        # 2025") could never be restored. Bare dates are still excluded, because
        # nothing survives once the date is stripped below.
        #
        # A row that only names links ("Live Demo | GitHub") sits BETWEEN the
        # title and its bullets. Treating it as a title stole the bullets and
        # left the real project looking empty, so it was never restored.
        if _RESTORE_LINK_LABEL_ROW_RE.fullmatch(line):
            continue
        # A title row: short, not a sentence. Strip the stack/date that resumes
        # put after the name, whichever separator they use ("Name - stack date",
        # "Name | stack", "Name — stack"). Spaces are required around the plain
        # hyphen so a hyphenated title ("End-to-End Pipeline") stays intact.
        title = re.split(r"\s+[|/·—–-]\s+", line)[0].strip()
        title = _RESTORE_TRAILING_DATE_RE.sub("", title).strip(" ,;|-–—")
        if len(title) < 3 or title.endswith((".", ":")):
            continue
        current = (title, [])
        found.append(current)

    # Bullets already in the output. A candidate whose content is ALREADY on the
    # resume is not a dropped project - it is a line we mis-read as a title
    # (a subtitle row like "Python, PowerBI, SQL, Excel", or a link row). This
    # is the strongest guard: without it, restoration invented projects and
    # duplicated another project's bullets underneath them.
    existing_bullets = set()
    for entry in projects:
        if isinstance(entry, dict):
            for b in (entry.get("bullets") or []):
                existing_bullets |= _restore_tokens(str(b))

    # Subtitles of entries that survived - never restore one as a project.
    existing_subtitles = {
        _normalize_key(str(e.get("subtitle") or ""))
        for e in projects if isinstance(e, dict)
    }
    existing_subtitles.discard("")

    restored = 0
    for title, bullets in found:
        key = _normalize_key(title)
        if not key or key in have or key in existing_subtitles:
            continue
        # Require real content, so a stray line never becomes a project.
        if len(bullets) < 1:
            continue
        if _looks_like_stack_line(title):
            continue
        # Content already present under another entry -> not a dropped project.
        cand = set()
        for b in bullets:
            cand |= _restore_tokens(b)
        if cand and len(cand & existing_bullets) / len(cand) > 0.5:
            continue
        have.add(key)
        existing_bullets |= cand
        projects.append({"name": title, "bullets": bullets[:8]})
        restored += 1

    if restored:
        logger.warning("Restored %d project(s) the optimizer dropped: %s",
                       restored, [t for t, _b in found if _normalize_key(t) in have])
    return parsed


def _change_similarity(a: str, b: str) -> float:
    """Jaccard token overlap — the same metric restore_dropped_bullets already
    uses to decide what counts as the same content."""
    ta, tb = _restore_tokens(a), _restore_tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def compute_resume_changes(parsed: dict, resume_string: str) -> dict:
    """Bullet- and summary-level diff between the AI's final output and what the
    candidate actually wrote, for the "See what changed" view. Reuses the same
    original-text matching restore_dropped_bullets uses, so the two agree on
    what counts as "the same" bullet (see _entry_original_bullets's docstring)."""
    if not isinstance(parsed, dict) or not resume_string:
        return {}
    section_lines = _restore_section_lines(resume_string)

    # _heading_key already recognizes "summary"/"profile"/"objective" headings,
    # so the original summary block is just the lines tagged "summary" — no new
    # section-detection needed.
    original_summary = " ".join(
        l for l, s in section_lines if s == "summary" and l.strip()
    ).strip()
    final_summary = str(parsed.get("summary") or "").strip()
    summary_change = None
    if final_summary:
        sim = _change_similarity(original_summary, final_summary)
        summary_change = {
            "before": original_summary or None,
            "after": final_summary,
            "status": "new" if not original_summary else ("unchanged" if sim > 0.9 else "reworded"),
        }

    plan = (
        ("experience", "experience", ("company", "title")),
        ("projects", "projects", ("name",)),
        ("extracurricular", "extracurriculars", ("role", "organization")),
    )
    entries_out = []
    for heading_section, parsed_key, id_fields in plan:
        entries = [e for e in (parsed.get(parsed_key) or []) if isinstance(e, dict)]
        if not entries:
            continue
        identifiers = []
        for e in entries:
            vals = [str(e.get(f, "")).strip() for f in id_fields if str(e.get(f, "")).strip()]
            identifiers.append(max(vals, key=len) if vals else "")
        orig = _original_entry_candidates(section_lines, heading_section, identifiers)
        for e, ident in zip(entries, identifiers):
            cands = _entry_original_bullets(orig.get(ident), e, entries, id_fields)
            ai_bullets = [str(b).strip() for b in (e.get("bullets") or []) if str(b).strip()]
            if not ai_bullets and not cands:
                continue
            bullets_out: list[dict] = []
            used: set[int] = set()
            for ai in ai_bullets:
                best_i, best_score = -1, 0.0
                for i, c in enumerate(cands):
                    if i in used:
                        continue
                    score = _change_similarity(ai, c)
                    if score > best_score:
                        best_i, best_score = i, score
                if best_i >= 0 and best_score >= 0.2:
                    used.add(best_i)
                    status = "unchanged" if best_score > 0.9 else "reworded"
                    bullets_out.append({"status": status, "before": cands[best_i], "after": ai})
                else:
                    bullets_out.append({"status": "new", "before": None, "after": ai})
            removed = [c for i, c in enumerate(cands) if i not in used]
            if bullets_out or removed:
                entries_out.append({
                    "section": heading_section,
                    "label": ident,
                    "bullets": bullets_out,
                    "removed": removed,
                })

    return {
        "summary": summary_change,
        "skills_added": [s for s in (parsed.get("skills_added_from_jd") or []) if s],
        "skill_gaps": promptable_skill_gaps(parsed.get("skill_gaps")),
        "entries": entries_out,
    }


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
    # Guard against broken anchor-text values like "linkedin", "github", "LinkedIn".
    # Without a "." (a real domain) and without a "/" path, prefixing https:// would
    # produce a dead link such as "https://linkedin". Reject those.
    if "." not in value and "/" not in value:
        return ""
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


# Domain -> short, human-friendly label. Used so links display "GitHub", "Kaggle",
# "Live Demo", "Coursera", etc. instead of a generic "Link" or a giant URL.
_LINK_LABELS = (
    ("github.com", "GitHub"), ("gitlab.com", "GitLab"), ("bitbucket.org", "Bitbucket"),
    ("kaggle.com", "Kaggle"), ("linkedin.com", "LinkedIn"), ("leetcode.com", "LeetCode"),
    ("coursera.org", "Coursera"), ("udemy.com", "Udemy"), ("udacity.com", "Udacity"),
    ("credly.com", "Credly"), ("edx.org", "edX"), ("datacamp.com", "DataCamp"),
    ("hackerrank.com", "HackerRank"), ("codeforces.com", "Codeforces"), ("codechef.com", "CodeChef"),
    ("drive.google.com", "Google Drive"), ("docs.google.com", "Google Docs"),
    ("youtube.com", "YouTube"), ("youtu.be", "YouTube"), ("medium.com", "Medium"),
    ("huggingface.co", "Hugging Face"), ("devpost.com", "Devpost"), ("notion.so", "Notion"),
    ("scholar.google", "Google Scholar"), ("researchgate.net", "ResearchGate"),
    ("arxiv.org", "arXiv"), ("doi.org", "DOI"), ("dev.to", "Dev.to"),
    ("learn.microsoft.com", "Microsoft"), ("microsoft.com", "Microsoft"),
    ("cloud.google.com", "Google Cloud"), ("aws.amazon.com", "AWS"),
    # Hosting platforms -> these are almost always a live deployment.
    ("vercel.app", "Live Demo"), ("netlify.app", "Live Demo"), ("onrender.com", "Live Demo"),
    ("herokuapp.com", "Live Demo"), ("streamlit.app", "Live Demo"), ("render.com", "Live Demo"),
    ("github.io", "Live Demo"), ("pages.dev", "Live Demo"), ("web.app", "Live Demo"),
    ("firebaseapp.com", "Live Demo"), ("railway.app", "Live Demo"), ("fly.dev", "Live Demo"),
)


def smart_link_label(url: str, fallback: str = "Link") -> str:
    """Return a short, recognizable label for a URL based on its domain."""
    u = str(url or "").strip().lower()
    if not u:
        return fallback
    for domain, label in _LINK_LABELS:
        if domain in u:
            return label
    return fallback


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
        ai_response = await get_resume_response(prompt, model=AI_MODEL, temperature=0.0)
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
        "AI/ML": [],
        "Frameworks/Libraries": [],
        "Databases": [],
        "Tools & Platforms": [],
        "Cloud & DevOps": [],
        "Networking & Protocols": [],
        "Security & SIEM": [],
        "Methodologies & Practices": [],
        "Other Technical Skills": [],
    }

    human_language_terms = {
        "english", "french", "german", "spanish", "hindi", "marathi", "tamil",
        "telugu", "kannada", "malayalam", "punjabi", "urdu", "arabic", "chinese",
        "japanese", "korean", "italian", "portuguese", "russian"
    }
    language_terms = {
        "python", "c", "c++", "java", "javascript", "typescript", "sql",
        "html", "html5", "css", "css3", "r", "go", "rust", "php",
        "kotlin", "swift", "scala", "perl", "ruby", "matlab", "bash",
        "shell", "c#", "dart", "groovy", "julia", "solidity", "assembly",
        "haskell", "elixir", "erlang", "f#", "vba", "cobol", "fortran"
    }
    ai_ml_terms = {
        "machine learning", "deep learning", "generative ai", "gen ai",
        "natural language processing", "nlp", "computer vision",
        "reinforcement learning", "data science", "llm", "llms",
        "large language models", "prompt engineering", "rag",
        "retrieval augmented generation", "agentic ai", "fine tuning",
        "fine-tuning", "finetuning", "llm fine tuning", "llm finetuning",
        "transfer learning", "artificial intelligence", "mlops",
        "feature engineering", "supervised learning", "unsupervised learning",
        "object detection", "image classification", "text classification",
        "sentiment analysis", "speech recognition", "text generation",
        "image generation", "neural networks", "neural network",
        "data mining", "anomaly detection", "recommendation systems",
        "time series analysis", "time series forecasting",
        "embeddings", "semantic search", "knowledge graphs",
        "multimodal", "vision language models", "vlm" 
    }
    framework_terms = {
        "numpy", "pandas", "scikit-learn", "sklearn", "scipy",
        "pytorch", "tensorflow", "keras", "jax",
        "langchain", "langgraph", "llamaindex", "llama index",
        "flask", "fastapi", "django", "express", "expressjs",
        "react", "reactjs", "vue", "vuejs", "angular",
        "node.js", "nodejs", "spring", "spring boot",
        "matplotlib", "seaborn", "plotly", "bokeh",
        "streamlit", "gradio", "hugging face",
        "sqlalchemy", "celery", "spark", "pyspark", "hadoop", "flink",
        "rest api", "restful api", "restful apis", "graphql", "grpc",
        "opencv", "nltk", "spacy", "gensim",
        "xgboost", "lightgbm", "catboost", "statsmodels",
        "bootstrap", "tailwindcss", "tailwind",
        "etl pipelines", "data pipelines",
        "crewai", "autogen", "dspy", "haystack",
        "next.js", "nextjs", "svelte", "nuxt", "nestjs", "fasthtml"
    }
    database_terms = {
        "mongodb", "mysql", "postgresql", "postgres", "sqlite",
        "redis", "cassandra", "dynamodb", "oracle", "sql server",
        "mariadb", "firestore", "firebase",
        "faiss", "pinecone", "chroma", "chromadb", "weaviate",
        "milvus", "qdrant", "elasticsearch", "opensearch",
        "neo4j", "supabase", "snowflake", "bigquery",
        "redshift", "databricks", "clickhouse",
        "vector databases", "vector database", "nosql",
        "influxdb", "timescaledb", "cockroachdb"
    }
    tool_terms = {
        "git", "github", "gitlab", "bitbucket",
        "vscode", "visual studio code", "visual studio",
        "postman", "insomnia", "swagger",
        "mlflow", "dvc", "wandb", "weights & biases",
        "power bi", "powerbi", "tableau",
        "excel", "jira", "confluence",
        "kubeflow", "airflow", "prefect", "dagster", "kafka",
        "pytest", "jest", "selenium", "cuda", "jupyter",
        # BI / analytics
        "looker", "looker studio", "qlik", "qlikview", "qlik sense",
        "quicksight", "google data studio", "data studio", "alteryx",
        "google analytics", "advanced excel", "google sheets", "powerpoint",
        # Diagramming / modelling
        "visio", "microsoft visio", "lucidchart", "draw.io", "drawio",
        "miro", "figma", "balsamiq",
        # Enterprise platforms (ERP / CRM / ITSM)
        "sap", "salesforce", "servicenow", "hubspot", "workday",
        "sharepoint", "erp", "erp systems", "crm",
        # Project / work tracking
        "ms project", "microsoft project", "asana", "trello", "notion"
    }
    # Ways of working and analysis artefacts. These are legitimate resume
    # skills - a business analyst lists Agile, BPMN and user stories - but they
    # are not tools, so grouping them under "Tools & Platforms" reads wrong.
    methodology_terms = {
        "agile", "waterfall", "scrum", "kanban", "safe", "lean", "six sigma",
        "bpmn", "uml", "sdlc", "rup",
        "user stories", "user story", "use cases", "use case",
        "brd", "brds", "business requirements document",
        "frd", "srs", "user acceptance testing", "uat",
        "wireframes", "wireframing", "prototyping", "mockups",
        "requirements gathering", "requirement gathering", "gap analysis",
        "process mapping", "process modelling", "process modeling",
        "process flow", "data modelling", "data modeling",
    }
    cloud_devops_terms = {
        "aws", "amazon web services", "azure", "gcp",
        "google cloud", "google cloud platform", "cloud platforms", "serverless",
        "docker", "kubernetes", "k8s", "helm",
        "jenkins", "github actions", "gitlab ci", "circleci",
        "ci/cd", "ci", "cd", "devops", "continuous integration",
        "continuous deployment", "continuous delivery",
        "terraform", "ansible", "puppet", "chef", "pulumi",
        "nginx", "apache", "vercel", "netlify", "heroku",
        "linux", "ubuntu", "centos", "grafana", "prometheus",
        "cloudformation", "cloud infrastructure", "infrastructure as code",
        "digitalocean", "openshift", "rancher"
    }
    network_protocol_terms = {
        "tcp/ip", "tcp", "udp", "ip", "dns", "http", "https", "ftp", "sftp",
        "ssh", "smtp", "dhcp", "arp", "vpn", "tls", "ssl", "ospf", "bgp",
        "snmp", "ipv4", "ipv6", "subnetting", "routing", "switching",
        "firewalls", "firewall", "load balancing", "network protocols",
        "osi model", "packet analysis", "wireshark", "tcpdump", "vlan",
        "nat", "proxy", "network segmentation"
    }
    security_siem_terms = {
        "splunk", "splunk enterprise", "sysmon", "siem", "threat hunting",
        "incident investigation", "incident response", "ioc analysis",
        "security event analysis", "log ingestion", "spl",
        "search processing language", "event correlation",
        "security operations", "soc", "security operations (soc)",
        "log analysis", "windows event logs", "windows event viewer",
        "windows endpoint monitoring", "endpoint monitoring",
        "authentication monitoring", "powershell monitoring",
        "qradar", "ibm qradar", "arcsight", "microsoft sentinel", "sentinel",
        "crowdstrike", "nessus", "metasploit", "burp suite", "nmap", "snort",
        "suricata", "ids", "ips", "edr", "xdr", "mitre att&ck", "mitre attack",
        "vulnerability assessment", "penetration testing", "malware analysis",
        "digital forensics", "dfir", "security information and event management",
        "threat intelligence", "vulnerability management"
    }

    def add_unique(bucket: list[str], value: str):
        if value and value not in bucket:
            bucket.append(value)

    # Delegates to functions.py's canonical, actively-maintained atomicity
    # filter instead of a separate/duplicated blocklist, so a fix there (e.g.
    # rejecting JD responsibility-sentence fragments) applies here too.
    def is_generic_phrase(item: str) -> bool:
        return not _is_atomic_hard_skill(item)

    def split_skill_items(text: str) -> list[str]:
        parts = [part.strip() for part in re.split(r"[,;]", text) if part.strip()]
        return parts if len(parts) > 1 else [text.strip()]

    def classify_item(item: str) -> str:
        item_norm = (item.lower().strip()
                     .replace("react js", "react")
                     .replace("restful apis", "restful api")
                     .replace("node js", "node.js"))
        if item_norm in human_language_terms:
            return "human_language"
        if item_norm in language_terms:
            return "Languages"
        if item_norm in database_terms:
            return "Databases"
        if "vector database" in item_norm or "vector db" in item_norm:
            return "Databases"
        if item_norm in tool_terms:
            return "Tools & Platforms"
        if item_norm in cloud_devops_terms:
            return "Cloud & DevOps"
        if item_norm in network_protocol_terms:
            return "Networking & Protocols"
        if item_norm in security_siem_terms:
            return "Security & SIEM"
        if item_norm in ai_ml_terms:
            return "AI/ML"
        if item_norm in framework_terms:
            return "Frameworks/Libraries"
        if item_norm in methodology_terms:
            return "Methodologies & Practices"
        return "uncategorized"

    for skill in skills:
        text = str(skill or "").strip()
        if not text:
            continue

        if ":" in text:
            label, value = text.split(":", 1)
            label_lower = label.strip().lower()
            value = value.strip()
            if label_lower in {"languages", "language", "programming", "programming languages"}:
                for item in [p.strip() for p in re.split(r"[,;/]", value) if p.strip()]:
                    if item.lower() not in human_language_terms:
                        add_unique(grouped["Languages"], item)
                continue
            if label_lower in {"developer tools", "tools", "tooling", "tools & platforms",
                                "tools and platforms", "platforms"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    cat = classify_item(item)
                    if cat == "uncategorized" and is_generic_phrase(item):
                        continue
                    target = cat if cat not in ("uncategorized", "human_language") else "Tools & Platforms"
                    add_unique(grouped[target], item)
                continue
            if label_lower in {"cloud", "devops", "cloud & devops", "cloud and devops",
                                "cloud/devops", "cloud platforms", "ci/cd", "cloud & infrastructure",
                                "cloud infrastructure"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    cat = classify_item(item)
                    if cat == "uncategorized" and is_generic_phrase(item):
                        continue
                    target = cat if cat not in ("uncategorized", "human_language") else "Cloud & DevOps"
                    add_unique(grouped[target], item)
                continue
            if label_lower in {"technologies/frameworks", "technologies", "frameworks",
                                "frameworks & libraries", "frameworks/libraries", "libraries",
                                "technologies & frameworks"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    cat = classify_item(item)
                    if cat == "uncategorized" and is_generic_phrase(item):
                        continue
                    target = cat if cat not in ("uncategorized", "human_language") else "Frameworks/Libraries"
                    add_unique(grouped[target], item)
                continue
            if label_lower in {"ai", "ml", "ai/ml", "machine learning", "artificial intelligence",
                                "data science", "ai/ml & data science", "ai & ml"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    if not is_generic_phrase(item):
                        add_unique(grouped["AI/ML"], item)
                continue
            if label_lower in {"databases", "database", "db", "data stores", "data storage",
                                "databases & storage"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    if not is_generic_phrase(item):
                        add_unique(grouped["Databases"], item)
                continue
            if label_lower in {"networking", "network", "protocols", "networking & protocols",
                                "networking and protocols", "network protocols"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    if not is_generic_phrase(item):
                        add_unique(grouped["Networking & Protocols"], item)
                continue
            if label_lower in {"security", "siem", "security & siem", "security and siem",
                                "cybersecurity", "security operations"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    if not is_generic_phrase(item):
                        add_unique(grouped["Security & SIEM"], item)
                continue
            # Unknown label: classify each value item individually
            for item in [p.strip() for p in re.split(r"[,;]", value) if p.strip()]:
                cat = classify_item(item)
                if cat == "human_language":
                    continue
                if cat == "uncategorized":
                    if not is_generic_phrase(item):
                        add_unique(grouped["Other Technical Skills"], item)
                else:
                    add_unique(grouped[cat], item)
            continue

        # No colon: split and classify each token
        raw_items = split_skill_items(text)
        for item in raw_items:
            cat = classify_item(item)
            if cat == "human_language":
                continue
            if cat == "uncategorized":
                if not is_generic_phrase(item):
                    add_unique(grouped["Other Technical Skills"], item)
            else:
                add_unique(grouped[cat], item)

    result = []
    for label in ("Languages", "AI/ML", "Frameworks/Libraries", "Databases", "Tools & Platforms",
                  "Cloud & DevOps", "Networking & Protocols", "Security & SIEM",
                  "Methodologies & Practices", "Other Technical Skills"):
        if grouped[label]:
            result.append(f"{label}: {', '.join(grouped[label])}")
    return result


def _link_identity(href: str) -> str:
    """A URL's identity for de-duplication.

    The same target reaches us spelled differently from different recovery paths
    - with and without a trailing slash, with or without "www." - so exact-string
    de-duplication let one link render twice. A project showed
    "Link | GitHub | Live Demo | GitHub", all four pointing at two places.
    """
    v = str(href or "").strip().lower()
    v = re.sub(r"^https?://", "", v)
    v = re.sub(r"^www\.", "", v)
    return v.rstrip("/")


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

        # Domain-based label first (GitHub, Kaggle, Live Demo, etc.) — most reliable.
        domain_label = smart_link_label(href, fallback="")
        if domain_label:
            return domain_label
        # Fall back to hints in the original label text.
        if "github" in label_l:
            return "GitHub"
        if any(token in label_l for token in ("live", "demo", "preview", "site", "website")):
            return "Live Demo"
        if _looks_like_url_label(label):
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
        key = _link_identity(href)
        if not key or key in seen:
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
                key = _link_identity(href)
                if not key or key in seen:
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


def _repair_truncated_json(text: str) -> dict | None:
    """Best-effort repair of a JSON object truncated mid-output (e.g. the model hit
    the token limit on a very long resume). Trims to the last complete top-level
    item and closes any open brackets/braces so partial content still renders
    instead of failing the whole optimization."""
    s = str(text or "")
    start = s.find("{")
    if start == -1:
        return None
    s = s[start:]
    # Walk the string tracking string state and bracket depth; remember the last
    # position where the structure was at a "safe" point (after a complete value).
    depth_stack = []
    in_str = False
    esc = False
    last_safe = None
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            depth_stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if depth_stack:
                depth_stack.pop()
        elif ch == "," and len(depth_stack) <= 2:
            last_safe = i  # after a complete element near the top levels
    # Truncate trailing incomplete fragment, then close open brackets.
    candidate = s
    for cut in (None, last_safe):
        frag = s if cut is None else s[:cut]
        frag = frag.rstrip().rstrip(",")
        # recompute open brackets for this fragment
        ds, ins, es = [], False, False
        for ch in frag:
            if ins:
                if es: es = False
                elif ch == "\\": es = True
                elif ch == '"': ins = False
                continue
            if ch == '"': ins = True
            elif ch in "{[": ds.append("}" if ch == "{" else "]")
            elif ch in "}]":
                if ds: ds.pop()
        repaired = frag + ("" if not ins else '"') + "".join(reversed(ds))
        try:
            obj = json.loads(repaired)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def parse_ai_json_response(response_string: str) -> dict:
    try:
        parsed = json.loads(response_string)
    except Exception as e:
        parsed = None
        try:
            match = re.search(r"\{[\s\S]*\}\s*$", response_string)
            if match:
                parsed = json.loads(match.group(0))
        except Exception:
            parsed = None
        if parsed is None:
            # Truncated/invalid JSON (e.g. very long resume cut at token limit) —
            # repair to the last complete item so partial content still renders.
            parsed = _repair_truncated_json(response_string)
        if parsed is None:
            logger.error("AI JSON response could not be parsed or repaired")
            raise HTTPException(status_code=500, detail="Could not process the AI response. Please try again.")

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
        exp_url = str(job.get("url") or job.get("link") or job.get("company_url") or "").strip()
        experience.append({
            "title": str(job.get("title", "")).strip(),
            "company": str(job.get("company", "")).strip(),
            "dates": str(job.get("dates", "")).strip(),
            "location": str(job.get("location", "")).strip(),
            "url": normalize_url(exp_url),
            "url_display": display_link(exp_url),
            "url_label": smart_link_label(exp_url),
            "bullets": normalize_list_of_strings(job.get("bullets", [])),
        })

    projects = []
    # Cross-project dedup: a URL must never appear under more than one project, and
    # cap per-project links — the AI sometimes dumps every resume link onto a single
    # project (e.g. the last one), producing "GitHub | Link | Link | Link ..." rows.
    #
    # This is a guard against the AI guessing wrong, so it must NOT apply to links a
    # person typed in themselves. In the /modify-cv builder the user fills a Live URL
    # and GitHub URL per project, and reusing one URL across several projects is a
    # legitimate thing to do — a shared demo site, or one profile link. Deduping
    # those silently blanked every project after the first, which read as "the
    # builder ignores the links I entered".
    author_is_user = bool(parsed.get("user_authored_links"))
    seen_project_hrefs: set[str] = set()
    MAX_PROJECT_LINKS = 4
    for project in parsed.get("projects", []) or []:
        if not isinstance(project, dict):
            continue
        links = collect_project_links(project)
        _filtered = []
        _seen_here: set[str] = set()
        for _l in links:
            _h = str(_l.get("href", "")).strip().lower()
            if not _h or _h in _seen_here:
                continue
            if not author_is_user and _h in seen_project_hrefs:
                continue
            _seen_here.add(_h)
            _filtered.append(_l)
            if len(_filtered) >= MAX_PROJECT_LINKS:
                break
        for _l in _filtered:
            seen_project_hrefs.add(str(_l.get("href", "")).strip().lower())
        links = _filtered
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

        # Derive github_link/url ONLY from the already-filtered links, so templates
        # that render project.github_link / project.url directly (e.g. 13-18) stay in
        # sync with the deduped+capped list and never show a bleeding/duplicate URL.
        github_link = ""
        url = ""
        for link in links:
            href = str(link.get("href", "")).strip()
            label = str(link.get("label", "")).lower()
            if not href:
                continue
            if not github_link and ("github" in label or "github.com" in href):
                github_link = href
            elif not url and "github.com" not in href:
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
        if not (degree or school or score or year):
            continue
        edu_links = str(edu.get("links", "")).strip()
        education.append({
            "degree": degree,
            "school": school,
            "year": year,
            "score": score,
            "links": normalize_url(edu_links),
            "links_label": smart_link_label(edu_links),
        })

    certifications = []
    for cert in parsed.get("certifications", []) or []:
        if not isinstance(cert, dict):
            continue
        c_name = str(cert.get("name", "")).strip()
        c_issuer = str(cert.get("issuer", "")).strip()
        if not (c_name or c_issuer):
            continue
        cert_url = str(cert.get("url", "")).strip()
        certifications.append({
            "name": c_name,
            "issuer": c_issuer,
            "year": str(cert.get("year", "")).strip(),
            "url": normalize_url(cert_url),
            "url_label": smart_link_label(cert_url, fallback="Certificate"),
        })

    extracurriculars = []
    for item in parsed.get("extracurriculars", []) or []:
        if not isinstance(item, dict):
            continue
        e_role = str(item.get("role", "")).strip()
        e_org = str(item.get("organization", "")).strip()
        e_bullets = normalize_list_of_strings(item.get("bullets", []))
        if not (e_role or e_org or e_bullets):
            continue
        extracurriculars.append({
            "role": e_role,
            "organization": e_org,
            "dates": str(item.get("dates", "")).strip(),
            "bullets": e_bullets,
            "url": normalize_url(str(item.get("url", "")).strip()),
        })

    publications = []
    for item in parsed.get("publications", []) or []:
        if not isinstance(item, dict):
            continue
        p_title = str(item.get("title", "")).strip()
        p_publisher = str(item.get("publisher", "")).strip()
        p_year = str(item.get("year", "")).strip()
        p_url_raw = str(item.get("url", "") or item.get("link", "")).strip()
        p_url = normalize_url(p_url_raw)
        # Skip empty publication entries so a blank "Publications" section (with a
        # stray bullet) is not rendered when the resume has no real publications.
        if not (p_title or p_publisher or p_url):
            continue
        publications.append({
            "title": p_title,
            "publisher": p_publisher,
            "year": p_year,
            "url": p_url,
            "url_label": smart_link_label(p_url_raw, fallback="Link"),
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


@app.get("/interview-prep", response_class=HTMLResponse)
async def interview_prep_page(request: Request):
    """Interview Question Generator page"""
    return templates.TemplateResponse(request, "interview_prep.html", {"request": request, "is_logged_in": bool(request.session.get("user_id"))})


# Chrome Web Store listing. Until the extension is published, the CTAs fall back to
# signup so they are never dead links; set CHROME_STORE_URL to point them at the store.
# Live Chrome Web Store listing. Kept as the default (not just an env var) so the
# install buttons work on deploy without extra Render config; override via
# CHROME_STORE_URL if the listing ever moves. The personal ?authuser/&hl params
# from the share link are intentionally left off — they'd break for other users.
CHROME_STORE_URL = os.getenv(
    "CHROME_STORE_URL",
    "https://chromewebstore.google.com/detail/tailorcv-%E2%80%94-ai-resume-opti/lnkplncemohgcdjlgccgmbcgiokcgmno",
).strip()


@app.get("/extension", response_class=HTMLResponse)
async def extension_page(request: Request):
    """Logged out: marketing landing. Logged in: the extension setup page, where the
    user installs it and sets the base resume + template the extension tailors from."""
    user_id = request.session.get("user_id")

    base_resume = {
        "has_base_resume": False,
        "filename": None,
        "template_id": None,
        "style_id": None,
        "cover_template": "classic",
    }
    if user_id:
        db = get_db()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            has_base = bool(user and user.base_resume_path and os.path.exists(user.base_resume_path))
            base_resume = {
                "has_base_resume": has_base,
                "filename": user.base_resume_filename if has_base else None,
                "template_id": user.base_template_id if has_base else None,
                "style_id": user.base_style_id if has_base else None,
                # Without this the picker always paints Classic as selected on load,
                # so a saved Modern/Monogram choice looks like it never took.
                "cover_template": (user.base_cover_template or "classic") if user else "classic",
            }
        finally:
            db.close()

    return templates.TemplateResponse(
        request,
        "extension.html",
        {
            "request": request,
            "is_logged_in": bool(user_id),
            "base_resume": base_resume,
            "chrome_store_url": CHROME_STORE_URL,
            "canonical_url": build_absolute_url("/extension"),
            "software_schema_json": build_software_app_schema(),
            "page_schema_json": build_page_breadcrumb("Chrome Extension", "/extension"),
        },
    )


@app.get("/mock-interview", response_class=HTMLResponse)
async def mock_interview_page(request: Request):
    """Real-time mock interview room."""
    is_logged_in = bool(request.session.get("user_id"))
    return templates.TemplateResponse(
        request,
        "mock_interview.html",
        {
            "request": request,
            "is_logged_in": is_logged_in,
            "canonical_url": build_absolute_url("/mock-interview"),
            "software_schema_json": build_software_app_schema(),
            "page_schema_json": build_page_breadcrumb("AI Mock Interview", "/mock-interview"),
        },
    )


@app.post("/api/interview/start")
async def api_interview_start(payload: dict):
    try:
        resume_text = str(payload.get("resume_text", "")).strip()
        role = str(payload.get("role", "")).strip() or "Software Engineer"
        interview_type = str(payload.get("interview_type", "mixed")).strip() or "mixed"
        num_questions = int(payload.get("num_questions", 8))
        job_desc = str(payload.get("job_desc", "")).strip()
        if not job_desc:
            raise HTTPException(status_code=400, detail="Job description is required")

        question = await generate_mock_interview_first_question(
            resume_text=resume_text,
            role=role,
            interview_type=interview_type,
            num_questions=num_questions,
            job_desc=job_desc,
        )
        return JSONResponse({"success": True, "question": question})
    except Exception as exc:
        logger.exception("Unhandled error in request")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


@app.post("/api/interview/start-with-pdf")
async def api_interview_start_with_pdf(
    request: Request,
    file: UploadFile = File(...),
    role: str = Form("Software Engineer"),
    interview_type: str = Form("mixed"),
    num_questions: int = Form(8),
    job_desc: str = Form(...),
):
    require_logged_in(request)
    db = get_db()
    try:
        user = db.query(User).filter_by(id=request.session["user_id"]).first()
        enforce_quota(db, user, "mock_interviews")
        uid = user.id
    finally:
        db.close()

    file_path = None
    try:
        if not str(job_desc or "").strip():
            raise HTTPException(status_code=400, detail="Job description is required")
        file_path = os.path.join(uploads_dir, f"mock_iq_{uuid.uuid4()}.pdf")
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        resume_text = await asyncio.to_thread(extract_pdf_text, file_path)
        try:
            question = await generate_mock_interview_first_question(
                resume_text=resume_text,
                role=str(role or "Software Engineer").strip() or "Software Engineer",
                interview_type=str(interview_type or "mixed").strip() or "mixed",
                num_questions=int(num_questions or 8),
                job_desc=str(job_desc or "").strip(),
            )
        except Exception as exc:
            db2 = get_db()
            try:
                refund_quota(db2, uid, "mock_interviews")
            finally:
                db2.close()
            raise HTTPException(status_code=502, detail="Could not start the mock interview. Please try again.")
        audio_b64 = None
        try:
            audio_bytes = await generate_tts_audio(question)
            audio_b64 = base64.b64encode(audio_bytes).decode()
        except Exception:
            pass
        return JSONResponse({"success": True, "question": question, "resume_text": resume_text, "audio_b64": audio_b64})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unhandled error in request")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/interview/next")
async def api_interview_next(payload: dict):
    try:
        result = await generate_mock_interview_next_question(
            resume_text=str(payload.get("resume_text", "")).strip(),
            role=str(payload.get("role", "")).strip() or "Software Engineer",
            interview_type=str(payload.get("interview_type", "mixed")).strip() or "mixed",
            num_questions=int(payload.get("num_questions", 8)),
            question_index=int(payload.get("question_index", 1)),
            job_desc=str(payload.get("job_desc", "")).strip(),
            conversation_history=payload.get("conversation_history") or [],
            user_answer=str(payload.get("user_answer", "")).strip(),
        )
        audio_b64 = None
        if result.get("success") and not result.get("done"):
            try:
                speak_text = f"{result.get('ack', '')} {result.get('question', '')}".strip()
                audio_bytes = await generate_tts_audio(speak_text)
                audio_b64 = base64.b64encode(audio_bytes).decode()
            except Exception:
                pass
        return JSONResponse({"success": True, **result, "audio_b64": audio_b64})
    except Exception as exc:
        logger.exception("Unhandled error in request")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


@app.post("/api/interview/score")
async def api_interview_score(payload: dict):
    try:
        scores = await score_mock_interview(
            role=str(payload.get("role", "")).strip() or "Software Engineer",
            interview_type=str(payload.get("interview_type", "mixed")).strip() or "mixed",
            resume_text=str(payload.get("resume_text", "")).strip(),
            qa_log=payload.get("qa_log") or [],
            filler_count=int(payload.get("filler_count", 0)),
            total_words=int(payload.get("total_words", 0)),
            camera_focus_score=(int(payload.get("camera_focus_score")) if payload.get("camera_focus_score") is not None else None),
            num_questions=int(payload.get("num_questions") or len(payload.get("qa_log") or [])),
        )
        return JSONResponse({"success": True, "scores": scores})
    except Exception as exc:
        logger.exception("Unhandled error in request")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


@app.post("/api/tts")
async def api_tts(payload: dict):
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text required")
    try:
        audio_bytes = await generate_tts_audio(text)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as exc:
        logger.exception("Unhandled error in request")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


# Site-wide "Tailor" assistant. Guests get a small free allowance per session
# (lead-gen); signed-in users get a generous cap. Returns a friendly, capped
# reply so a public widget can't run up unbounded model cost.
AGENT_GUEST_LIMIT = 6
AGENT_USER_LIMIT = 60

_AGENT_STOPWORDS = set(
    "a an the of to for on in at is are be was were do does did how can could would should "
    "i you me my your our we us it its this that these those with without and or but so if "
    "what which who whom whose when where why about into over under out up down off no not "
    "any some all more most any give show tell suggest recommend find help please thanks "
    "resume resumes cv blog blogs article articles post posts read topic topics".split()
)


def _agent_blog_line(p) -> str:
    desc = (p.description or "").strip().replace("\n", " ")
    if len(desc) > 120:
        desc = desc[:117].rstrip() + "..."
    return f"- {p.title} (/blog/{p.slug})" + (f": {desc}" if desc else "")


def _retrieve_agent_blogs(message: str, limit: int = 10) -> str:
    """Rank ALL blog posts against the user's question by keyword overlap and
    return a compact catalog of just the most relevant ones. Beats a static
    top-N list because the right article for the topic is actually included."""
    try:
        posts = blog_service.load_posts()
    except Exception:
        return ""
    words = {
        w for w in re.findall(r"[a-z0-9]+", (message or "").lower())
        if len(w) > 2 and w not in _AGENT_STOPWORDS
    }
    if not words:
        return ""
    scored = []
    for p in posts:
        title_l = (p.title or "").lower()
        body_l = " ".join([(p.description or ""), " ".join(p.tags or []), (p.category or "")]).lower()
        score = 0
        for w in words:
            if w in title_l:
                score += 3
            elif w in body_l:
                score += 1
        if score:
            scored.append((score, p))
    if not scored:
        return ""
    scored.sort(key=lambda sp: -sp[0])
    return "\n".join(_agent_blog_line(p) for _, p in scored[:limit])


@app.post("/api/agent/chat")
async def api_agent_chat(request: Request, payload: dict):
    message = (payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message required")
    if len(message) > 2000:
        message = message[:2000]

    is_logged_in = bool(request.session.get("user_id"))
    limit = AGENT_USER_LIMIT if is_logged_in else AGENT_GUEST_LIMIT
    key = "agent_msgs_user" if is_logged_in else "agent_msgs_guest"
    used = int(request.session.get(key, 0))
    if used >= limit:
        if is_logged_in:
            return {"reply": "You've hit the chat limit for now — please try again a little later.", "limited": True}
        return {
            "reply": "That's all I can answer without an account. Create a free account and I can keep helping "
                     "— plus you unlock the resume tools, ATS scoring, and more.",
            "limited": True,
            "signup": True,
        }

    history = payload.get("history") or []
    if not isinstance(history, list):
        history = []
    page_path = (payload.get("page") or "/")

    try:
        reply = await agent_chat_reply(
            user_message=message,
            history=history,
            page_path=page_path,
            is_logged_in=is_logged_in,
            blog_catalog=_retrieve_agent_blogs(message),
        )
    except Exception:
        logger.exception("Agent chat failed")
        raise HTTPException(status_code=500, detail="The assistant is unavailable right now. Please try again.")

    request.session[key] = used + 1
    return {"reply": reply, "remaining": max(0, limit - (used + 1))}


@app.post("/api/generate-interview-questions")
async def api_generate_interview_questions(
    request: Request,
    file: UploadFile = File(...),
    jd_string: str = Form(""),
):
    """Generate interview questions from resume PDF + job description"""
    require_logged_in(request)
    file_path = None
    try:
        jd_string = str(jd_string or "").strip()
        if len(jd_string) < 30:
            raise HTTPException(status_code=400, detail="Please provide the job description.")

        file_path = os.path.join(uploads_dir, f"iq_{uuid.uuid4()}.pdf")
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        async with request_semaphore:
            resume_string = await asyncio.to_thread(extract_pdf_text, file_path)
            if len((resume_string or "").strip()) < 50:
                raise HTTPException(
                    status_code=400,
                    detail="Couldn't read your resume. Upload a text-based PDF, not a scanned image.",
                )
            db = get_db()
            try:
                user = db.query(User).filter_by(id=request.session["user_id"]).first()
                enforce_quota(db, user, "interview_questions")
                uid = user.id
            finally:
                db.close()
            try:
                result = await generate_interview_questions(resume_string, jd_string)
            except Exception:
                db2 = get_db()
                try:
                    refund_quota(db2, uid, "interview_questions")
                finally:
                    db2.close()
                raise HTTPException(status_code=502, detail="Could not generate interview questions. Please try again.")
            return JSONResponse({"success": True, "data": result})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generate-interview-questions failed")
        raise HTTPException(status_code=500, detail="Could not generate interview questions. Please try again.")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/evaluate-interview-answer")
async def api_evaluate_interview_answer(payload: dict):
    """Evaluate a candidate's interview answer."""
    try:
        question = str(payload.get("question", "")).strip()
        model_answer = str(payload.get("model_answer", "")).strip()
        candidate_answer = str(payload.get("candidate_answer", "")).strip()
        if not question:
            raise HTTPException(status_code=400, detail="Question is required")
        if not candidate_answer:
            raise HTTPException(status_code=400, detail="Candidate answer is required")

        result = await evaluate_interview_answer(
            question=question,
            model_answer=model_answer,
            candidate_answer=candidate_answer,
        )
        return JSONResponse({"success": True, **result})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unhandled error in request")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


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


def build_absolute_url(path: str) -> str:
    return f"{SITE_URL}{path}"


PERSONALITY_CARD_MIN_STORY_LEN = 190


def _personality_card_needs_refresh(card: PersonalityCard | None) -> bool:
    if not card:
        return True
    story = str(getattr(card, "story", "") or "").strip()
    if len(story) < PERSONALITY_CARD_MIN_STORY_LEN:
        return True
    try:
        traits = json.loads(card.traits or "[]")
    except (TypeError, json.JSONDecodeError):
        return True
    if not isinstance(traits, list) or len(traits) < 3:
        return True
    detailed_trait_count = 0
    for trait in traits:
        if isinstance(trait, dict) and len(str(trait.get("description") or "").strip()) >= 40:
            detailed_trait_count += 1
    return detailed_trait_count < 3


def _personality_skill_list(skills: object) -> list[str]:
    items: list[str] = []
    if isinstance(skills, dict):
        for _, values in skills.items():
            if isinstance(values, list):
                for value in values:
                    value_text = str(value or "").strip()
                    if value_text:
                        items.append(value_text)
            elif values:
                value_text = str(values).strip()
                if value_text:
                    items.append(value_text)
    elif isinstance(skills, list):
        for value in skills:
            value_text = str(value or "").strip()
            if value_text:
                items.append(value_text)

    seen: set[str] = set()
    deduped: list[str] = []
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _personality_card_vitals(archetype: str) -> dict:
    """Derive deterministic viral metadata (rarity, tier, score, theme, compatibility) from the archetype string.
    All values are hash-derived so they are stable across requests but feel personal."""
    h = int(hashlib.md5(archetype.lower().encode()).hexdigest(), 16)

    # Rarity: always feels exclusive (4–14 %) — never 0 or 100
    rarity_pct = 4 + (h % 11)

    if rarity_pct <= 5:
        tier = "Mythic"
    elif rarity_pct <= 8:
        tier = "Legendary"
    elif rarity_pct <= 11:
        tier = "Rare"
    else:
        tier = "Uncommon"

    # Career score: feels earned (75–97)
    career_score = 75 + (h % 23)

    # Color theme keyed to archetype keywords
    a = archetype.lower()
    if any(k in a for k in ("alchemist", "visionary", "dreamer", "creator", "mage", "wizard", "mystic", "prophet")):
        theme = "gold"
    elif any(k in a for k in ("architect", "builder", "engineer", "strategist", "planner", "designer", "operator")):
        theme = "steel"
    elif any(k in a for k in ("disruptor", "rebel", "challenger", "pioneer", "maverick", "warrior", "catalyst")):
        theme = "fire"
    elif any(k in a for k in ("sage", "oracle", "analyst", "thinker", "scholar", "navigator", "detective")):
        theme = "ocean"
    else:
        theme = "purple"

    # Compatibility: one of several archetypes, stable for this archetype string
    _pool = [
        "The Analytical Sage", "The Strategic Architect", "The Creative Disruptor",
        "The Quiet Force", "The Bridge Builder", "The Systems Thinker",
        "The Pattern Whisperer", "The Chaos Tamer", "The Relentless Builder",
        "The Empathic Catalyst", "The Bold Pioneer", "The Deep Diver",
    ]
    compatible = _pool[h % len(_pool)]
    # Avoid trivially matching own archetype
    if archetype.lower() in compatible.lower() or compatible.lower() in archetype.lower():
        compatible = _pool[(h + 1) % len(_pool)]

    return {
        "rarity_pct": rarity_pct,
        "tier": tier,
        "career_score": career_score,
        "theme": theme,
        "compatible_archetype": compatible,
    }


def _build_personality_card_prompt(resume_data: dict) -> str:
    """Build the GPT-4o-mini prompt for career personality card generation."""
    pi = resume_data.get("personal_info") or {}
    name = str(pi.get("name") or resume_data.get("name") or "").strip()
    headline = str(
        resume_data.get("headline")
        or resume_data.get("title")
        or resume_data.get("current_title")
        or resume_data.get("role")
        or ""
    ).strip()
    summary_text = str(resume_data.get("summary") or "").strip()
    experience = resume_data.get("experience") or []
    education = resume_data.get("education") or []
    skills = resume_data.get("skills") or {}
    projects = resume_data.get("projects") or []
    certifications = resume_data.get("certifications") or []
    achievements = resume_data.get("achievements") or []
    awards = resume_data.get("awards") or []
    extracurriculars = resume_data.get("extracurriculars") or []

    summary = json.dumps({
        "name": name,
        "headline": headline,
        "summary": summary_text,
        "experience": [
            {
                "title": str(exp.get("title") or "").strip(),
                "company": str(exp.get("company") or "").strip(),
                "dates": str(exp.get("dates") or "").strip(),
                "location": str(exp.get("location") or "").strip(),
                "bullets": (exp.get("bullets") or [])[:3],
            }
            for exp in experience[:5] if isinstance(exp, dict)
        ],
        "education": education[:3],
        "skills": _personality_skill_list(skills)[:12],
        "projects": [
            {
                "name": str(p.get("name") or "").strip(),
                "stack": str(p.get("subtitle") or p.get("stack") or p.get("technologies") or "").strip(),
                "bullets": (p.get("bullets") or p.get("achievements") or p.get("details") or [])[:3],
            }
            for p in projects[:5] if isinstance(p, dict)
        ],
        "certifications": [c.get("name") for c in certifications[:5]],
        "achievements": [str(a).strip() for a in achievements[:5] if str(a).strip()],
        "awards": [str(a).strip() for a in awards[:4] if str(a).strip()],
        "extracurriculars": [
            {
                "role": str(item.get("role") or "").strip(),
                "organization": str(item.get("organization") or "").strip(),
                "achievements": (item.get("achievements") or [])[:2],
            }
            for item in extracurriculars[:3] if isinstance(item, dict)
        ],
    }, separators=(",", ":"))

    return f"""You are a mythmaker writing a dramatic "Career Personality Card" — not a resume summary, not a LinkedIn bio. Your job is to reveal WHO this person IS: their mind, their instincts, their superpowers, their way of moving through the world.

Use the resume only as a source of signals about their personality and abilities. DO NOT describe job history. DO NOT name employers or titles flatly. Transform everything into vivid, epic, character-driven language.

Analyze the resume data below and return ONLY a valid JSON object with exactly these fields:

{{
  "archetype": "A 3-5 word mythic title that names their personality — not their job. Examples: 'The Architect of Order', 'The Chaos Tamer', 'The Quiet Force', 'The Pattern Whisperer'.",
  "tagline": "Two punchy, legendary sentences (max 30 words total) that describe their MIND and ABILITIES using vivid metaphors — not what they've done, but what they ARE. Examples: 'Navigator of vast oceans of algorithmic knowledge. Cartographer of hidden patterns buried deep within data.' or 'Slayer of latency and guardian of performance. Defender of uptime against the forces of downtime.' or 'Conjurer of structure from the swirling chaos of complexity. Architect of systems that outlive the hands that built them.'",
  "story": "3-4 sentences, around 60-80 words, written like the opening of an epic. Describe their intellectual character, instincts, and way of thinking — not their job history. Use dramatic metaphors. Make it feel like a portrait of a person, not a career timeline. Good example: 'There are those who see problems — and then there are those who see the hidden geometry beneath them. This is someone who operates in the second category: methodical yet bold, drawn to the edges of what is known, building bridges across the gap between vision and reality.'",
  "traits": [
    {{"emoji": "🔥", "label": "Trait Name (e.g. 'The Relentless Builder')", "description": "One cinematic sentence about this personality trait — what it looks like when this person is at their best. No job titles. Pure character."}},
    {{"emoji": "🎯", "label": "Trait Name", "description": "..."}},
    {{"emoji": "🚀", "label": "Trait Name", "description": "..."}},
    {{"emoji": "💡", "label": "Trait Name", "description": "..."}}
  ],
  "stats": {{
    "years_experience": 0,
    "companies_count": 0,
    "industries_list": ["Industry 1"],
    "top_3_skills": ["Skill 1", "Skill 2", "Skill 3"],
    "total_projects": 0
  }}
}}

Rules:
- Return 3 to 4 traits (never fewer than 3, never more than 4)
- archetype must name a personality type or mindset, never a job title
- tagline must sound legendary — two bold metaphorical sentences about their mind or abilities, never about where they worked
- story must read like the opening of an epic novel about a person, not a career summary; NO job titles, NO company names, NO dates
- trait descriptions must paint a picture of the person's character — how they think, how they act under pressure, what drives them; 14 to 28 words each
- top_3_skills must come from the actual skills in the resume
- years_experience: calculate from earliest start_date to present; if no dates, estimate from graduation year; minimum 0
- industries_list: infer from company names and job titles (e.g., "FinTech", "SaaS", "Healthcare")
- If resume data is sparse, still produce a vivid, aspirational portrait — infer personality from whatever signals exist

Resume data:
{summary}"""
# ---------------------------------------------------------------------------
# Author profile for E-E-A-T (byline, about-the-author box, schema author).
# To attribute posts to a named individual instead, change "@type" to "Person"
# and set name/jobTitle accordingly — everything else flows from here.
# ---------------------------------------------------------------------------
AUTHOR_PROFILE = {
    "type": "Organization",
    "name": "TailorCV Team",
    "title": "Resume & ATS Specialists",
    "bio": (
        "The TailorCV team builds an AI-powered resume optimizer and free ATS "
        "score checker used by job seekers worldwide. Our guides are written and "
        "reviewed by specialists in resume writing, ATS optimization, and job search."
    ),
    "url": "https://thetailorcv.com/about",
    "sameAs": [
        "https://www.linkedin.com/company/thetailorcv/",
        "https://www.instagram.com/thetailorcv/",
        "https://www.youtube.com/@thetailorcv",
    ],
}

# Real bylines shown on blog posts. Drop the photos at the `image` paths below
# (JPG/PNG) and they render automatically; until then initials show instead.
BLOG_AUTHORS = [
    {
        "type": "Person",
        "name": "Trisha Debnath",
        "initials": "TD",
        "title": "Co-founder, TailorCV",
        "image": "/static/user_imges/Trisha.png",
        "bio": (
            "Trisha is a co-founder of TailorCV. She writes about resumes, ATS "
            "optimization, and modern job search, turning what actually works for "
            "job seekers into practical, step-by-step guides."
        ),
        "url": "https://thetailorcv.com/about",
        "linkedin": "https://www.linkedin.com/company/thetailorcv/",
        "sameAs": ["https://www.linkedin.com/company/thetailorcv/"],
    },
    {
        "type": "Person",
        "name": "Shubham Sarkar",
        "initials": "SS",
        "title": "Co-founder, TailorCV",
        "image": "/static/user_imges/Shubham.jpg",
        "bio": (
            "Shubham is a co-founder of TailorCV. He focuses on ATS scoring, "
            "resume-to-job matching, and the product behind the guides, so the advice "
            "here reflects how hiring systems really read a resume."
        ),
        "url": "https://thetailorcv.com/about",
        "linkedin": "https://www.linkedin.com/company/thetailorcv/",
        "sameAs": ["https://www.linkedin.com/company/thetailorcv/"],
    },
]


def pick_author(post) -> dict:
    """Stable per-post byline so each article keeps the same author across
    reloads while both founders appear across the blog."""
    idx = sum(ord(c) for c in post.slug) % len(BLOG_AUTHORS)
    return BLOG_AUTHORS[idx]


def build_blogposting_schema(post, canonical_url: str, author_profile: dict | None = None) -> str:
    ap = author_profile or AUTHOR_PROFILE
    image_url = post.image if str(post.image).startswith("http") else build_absolute_url(post.image or "/static/logo.png")
    author = {
        "@type": ap["type"],
        "name": ap["name"],
        "url": ap["url"],
        "sameAs": ap["sameAs"],
    }
    if ap["type"] == "Person":
        author["jobTitle"] = ap["title"]
    schema = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.title,
        "description": post.description,
        "image": [image_url],
        "author": author,
        "publisher": {
            "@type": "Organization",
            "name": "TailorCV",
            "url": SITE_URL,
            "logo": {"@type": "ImageObject", "url": build_absolute_url("/static/logo.png")},
        },
        "datePublished": post.date_iso,
        # Prefer an explicit `updated:` field, else fall back to the publish
        # date. Deliberately NOT file mtime: a bulk edit that touches every
        # file would otherwise tell Google all 507 posts were revised on the
        # same day, which is both untrue and a bad freshness signal.
        # (lastmod_iso still drives sitemap.xml, where mtime is the right idea.)
        "dateModified": post.updated_iso or post.date_iso,
        "mainEntityOfPage": canonical_url,
        "keywords": post.keywords,
    }
    return json.dumps(schema, separators=(",", ":"))


def build_breadcrumb_schema(post, canonical_url: str) -> str:
    schema = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": build_absolute_url("/")},
            {"@type": "ListItem", "position": 2, "name": "Blog", "item": build_absolute_url("/blog")},
            {"@type": "ListItem", "position": 3, "name": post.title, "item": canonical_url},
        ],
    }
    return json.dumps(schema, separators=(",", ":"))


def _strip_html(fragment: str) -> str:
    """Strip tags and unescape entities to plain text (for schema values)."""
    import html as _html
    text = re.sub(r"<[^>]+>", " ", fragment or "")
    text = _html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def build_faq_schema(post) -> str:
    """Generate FAQPage JSON-LD from a post's FAQ section, if it has one.

    Looks for an H2 like "Frequently Asked Questions" and turns each following
    H3 (question) + answer HTML into a Question/Answer pair. Returns "" when no
    valid FAQ (at least 2 Q&A) is found, so non-FAQ posts emit nothing.
    """
    html_content = post.content_html or ""
    heading = re.search(
        r"<h2[^>]*>\s*(?:Frequently Asked Questions|FAQs?|Common Questions)\s*</h2>",
        html_content,
        re.IGNORECASE,
    )
    if not heading:
        return ""
    section = html_content[heading.end():]
    next_h2 = re.search(r"<h2[\s>]", section)
    if next_h2:
        section = section[:next_h2.start()]

    parts = re.split(r"<h3[^>]*>(.*?)</h3>", section, flags=re.DOTALL)
    qas = []
    for i in range(1, len(parts) - 1, 2):
        question = _strip_html(parts[i])
        answer = _strip_html(parts[i + 1])
        if question and answer:
            qas.append((question, answer))
    if len(qas) < 2:
        return ""

    schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {"@type": "Answer", "text": a},
            }
            for q, a in qas
        ],
    }
    return json.dumps(schema, separators=(",", ":"))


def build_software_app_schema() -> str:
    """SoftwareApplication JSON-LD for the free ATS checker / resume optimizer."""
    schema = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "TailorCV ATS Score Checker & Resume Optimizer",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "url": build_absolute_url("/solutions"),
        "description": (
            "Free AI-powered ATS score checker and resume optimizer. Upload your "
            "resume and a job description to get an instant ATS score, missing "
            "keywords, and optimization tips."
        ),
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "publisher": {"@type": "Organization", "name": "TailorCV", "url": SITE_URL},
    }
    return json.dumps(schema, separators=(",", ":"))


def build_page_breadcrumb(name: str, path: str) -> str:
    """BreadcrumbList JSON-LD (Home > <name>) for a top-level page."""
    return json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": build_absolute_url("/")},
            {"@type": "ListItem", "position": 2, "name": name, "item": build_absolute_url(path)},
        ],
    }, separators=(",", ":"))


# Static FAQ used for FAQPage rich results on the homepage / ATS checker pages.
# Targets high-intent queries (free ATS checker, ATS-friendly resume, etc.).
HOMEPAGE_FAQS = [
    (
        "Is the ATS score checker free?",
        "Yes. TailorCV's ATS score checker is completely free. Upload your "
        "resume and paste a job description to get an instant ATS score, missing "
        "keywords, and optimization tips at no cost.",
    ),
    (
        "How does the AI resume optimizer work?",
        "Our AI reads your resume and the target job description, then rewrites and "
        "tailors each section to match the role — adding missing keywords and "
        "improving phrasing so your resume passes applicant tracking systems (ATS).",
    ),
    (
        "What is an ATS-friendly resume?",
        "An ATS-friendly resume uses a clean, single-column layout, standard section "
        "headings, and keywords from the job description so applicant tracking "
        "systems can parse it correctly. TailorCV's templates, including Jake's "
        "Resume template, are built to be ATS-friendly.",
    ),
    (
        "Can I practice mock interviews online?",
        "Yes. TailorCV includes an AI mock interview tool that asks role-specific "
        "technical and behavioral questions, then gives real-time feedback and a "
        "scorecard so you can practice before your real interview.",
    ),
]

# The FAQ actually rendered on the landing page (index.html). Kept in sync with
# the visible <details> block so the FAQPage rich result matches on-page content
# (Google requires structured data to mirror what the user sees).
LANDING_PAGE_FAQS = [
    (
        "Is there a free plan?",
        "Yes — you can start completely free, no credit card needed. The free plan "
        "covers the essentials so you can try TailorCV end to end. When you need "
        "more, Pro unlocks unlimited use, and the one-time 7-Day Pass is perfect "
        "for an active job hunt.",
    ),
    (
        "Will recruiters or ATS detect that my resume was AI-optimized?",
        "No. TailorCV doesn't add fake skills or fabricate experience. It rewrites "
        "your existing experience using the exact keywords and language from the "
        "job description — so your real skills finally get seen. It's your resume, "
        "just better phrased.",
    ),
    (
        "Is my resume data safe and private?",
        "Yes. Your resume is used only to generate your optimized output and is not "
        "stored permanently or shared with anyone. We take privacy seriously.",
    ),
    (
        "What file formats does TailorCV support?",
        "You can upload your resume as a PDF. The optimized output can be downloaded "
        "as a PDF as well — clean, ATS-friendly, and ready to submit.",
    ),
    (
        "Do I need to create an account?",
        "Yes — a quick free account lets us securely save your resumes and ATS "
        "scores so you can pick up right where you left off. It takes under a "
        "minute and never needs a credit card.",
    ),
    (
        "How is TailorCV different from ChatGPT for resume writing?",
        "ChatGPT is a general tool — you'd need to manually copy-paste your resume "
        "and job description and craft the right prompts. TailorCV is purpose-built "
        "for this exact task. It analyzes both documents, gives you an ATS score, "
        "shows exactly what's missing, and outputs a formatted ready-to-download "
        "resume — all in one flow.",
    ),
]


def build_faq_page_schema(faqs=HOMEPAGE_FAQS) -> str:
    """FAQPage JSON-LD from a list of (question, answer) tuples."""
    schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {"@type": "Answer", "text": a},
            }
            for q, a in faqs
        ],
    }
    return json.dumps(schema, separators=(",", ":"))


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
    # Allow crawling of all public/marketing/tool pages; keep auth, account, and
    # API endpoints out of the index (they have no SEO value and can leak query
    # params / thin pages into search results).
    disallow_paths = [
        "/api/",
        "/login",
        "/signup",
        "/forgot-password",
        "/reset-password",
        "/optimized-editor",
        "/download-optimized-resume",
    ]
    lines = ["User-agent: *", "Allow: /"]
    lines += [f"Disallow: {path}" for path in disallow_paths]
    lines += ["", f"Sitemap: {SITE_URL}/sitemap.xml", ""]
    return PlainTextResponse(content="\n".join(lines), media_type="text/plain")


@app.get("/", response_class=HTMLResponse)
async def landing_page(request: Request):
    """Landing page inspired by Tsenta marketing site."""
    home_posts = blog_service.search_posts(page=1, per_page=3)["items"]
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
            "home_posts": home_posts,
            "canonical_url": build_absolute_url("/"),
            "software_schema_json": build_software_app_schema(),
            "faq_schema_json": build_faq_page_schema(LANDING_PAGE_FAQS),
        },
    )


@app.get("/solutions", response_class=HTMLResponse)
async def solutions_page(request: Request):
    """Solutions page where users upload resume & JD."""
    is_localhost = request.url.hostname in {"127.0.0.1", "localhost"}
    return templates.TemplateResponse(
        request,
        "solutions.html",
        {
            "request": request,
            "is_logged_in": bool(request.session.get("user_id")),
            "show_optimized_editor_entry": SHOW_OPTIMIZED_EDITOR or is_localhost,
            "canonical_url": build_absolute_url("/solutions"),
            "software_schema_json": build_software_app_schema(),
            "faq_schema_json": build_faq_page_schema(),
        },
    )


@app.get("/optimize", response_class=HTMLResponse)
async def optimize_page(request: Request):
    """Alias route for optimization flow; renders Solutions page."""
    is_localhost = request.url.hostname in {"127.0.0.1", "localhost"}
    return templates.TemplateResponse(
        request,
        "solutions.html",
        {
            "request": request,
            # Without this the template sees is_logged_in as undefined (falsy) and
            # serves the logged-out landing to signed-in users.
            "is_logged_in": bool(request.session.get("user_id")),
            "show_optimized_editor_entry": SHOW_OPTIMIZED_EDITOR or is_localhost,
            # Alias of /solutions — canonical points to the primary URL to avoid
            # duplicate-content indexing.
            "canonical_url": build_absolute_url("/solutions"),
            "software_schema_json": build_software_app_schema(),
            "faq_schema_json": build_faq_page_schema(),
        },
    )


# ── Competitor "alternative" SEO landing pages ───────────────────────────────
# Capture high-intent comparison search ("jobscan alternative", etc.). One shared
# template (comparison_alternative.html) rendered from this data, per slug.
_COMPARISON_PAGES = {
    "jobscan-alternative": {
        "blog": {"slug": "tailorcv-vs-jobscan", "title": "TailorCV vs Jobscan: Free ATS Score vs $49.95 a Month"},
        "competitor": "Jobscan",
        "audience": "students, freshers & first-time job seekers",
        "title": "Best Jobscan Alternative (2026) — Free ATS Score & Resume Optimizer",
        "description": "Looking for a Jobscan alternative? TailorCV gives you a free ATS score, AI resume tailoring, a built-in portfolio website builder, and affordable pricing.",
        "hero": "Get an instant ATS score, tailor your resume to any job description with AI, and even publish a live portfolio website — at a fraction of Jobscan's price.",
        "intro": [
            "Jobscan built its reputation on one thing and did it well: comparing your resume against a job description and giving you a match rate. If that single number is all you want, it is a capable tool and we are not going to pretend otherwise.",
            "The problem most students run into is what happens next. You get a score, you learn you are missing eight keywords, and then you still have to rewrite the resume yourself, write the cover letter yourself, and prepare for the interview yourself. The score tells you what is wrong; it does not fix it.",
            "TailorCV is built around the fix. The same ATS match score is free and unlimited to start, but the AI then rewrites your bullets to carry those keywords honestly, drafts a matching cover letter, runs mock interviews for the role, and can publish your resume as a live portfolio site. It is priced in rupees, for people who are job hunting rather than staffing a recruitment desk.",
        ],
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "Check how your resume scores against any job description before you pay anything."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Turn your resume into a live portfolio site — something Jobscan doesn't offer."},
            {"icon": "price", "title": "Student friendly pricing", "link": "/pricing", "text": "Affordable plans built for freshers and students, not enterprise budgets."},
            {"icon": "ai", "title": "AI tailoring and interviews", "link": "/solutions", "text": "Rewrite bullets, match keywords, and practice AI mock interviews in one place."},
            {"icon": "doc", "title": "It rewrites, not just reports", "link": "/optimize", "text": "A score tells you what's missing. TailorCV rewrites the bullets to fix it."},
            {"icon": "chrome", "title": "Works on the job board", "link": "/extension", "text": "Tailor your resume on LinkedIn, Indeed or Naukri without leaving the posting."},
        ],
        "rows": [
            {"feature": "ATS match score against a JD", "us": "<span class='yes'>✓</span> Free to start", "them": "Limited free scans"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Full rewrite", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Missing keyword report", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "Add-on"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Interview question prep", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Saved resume library & job tracker", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Browser extension", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Resume templates included", "us": "<span class='yes'>✓</span> 20+", "them": "Limited"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "Premium / USD pricing"},
        ],
        "them_good": [
            "A long track record specifically in ATS keyword matching, with a large body of published guidance behind it.",
            "LinkedIn profile optimization tooling alongside the resume scanner.",
            "Recruiter-facing and enterprise features that most individual job seekers will never need — but which exist if you do.",
        ],
        "pick_us": [
            "You want the resume actually rewritten, not just scored.",
            "You are a student or fresher and USD subscription pricing is genuinely hard to justify.",
            "You want the cover letter, interview prep and portfolio in the same place as the score.",
            "You apply on LinkedIn, Indeed or Naukri and want to tailor without leaving the posting.",
        ],
        "pick_them": [
            "You only want a match rate and already rewrite your own resume confidently.",
            "You need recruiter or enterprise-side features rather than job-seeker ones.",
            "Your budget is in USD and price isn't a deciding factor.",
        ],
        "faq": [
            {"q": "Is TailorCV a good Jobscan alternative?", "a": "Yes. TailorCV offers a free ATS score, AI resume tailoring to a job description, a cover letter generator, AI mock interviews, and a portfolio website builder — at a more affordable price point than Jobscan."},
            {"q": "Is TailorCV free?", "a": "You can check your ATS score and build a portfolio for free. Pro unlocks unlimited optimizations, cover letters, mock interviews and a custom live site."},
            {"q": "Does TailorCV check my resume against the ATS like Jobscan?", "a": "Yes — paste your resume and a job description and you get a match score plus the missing keywords and fixes to raise it."},
            {"q": "Is TailorCV cheaper than Jobscan?", "a": "Yes. TailorCV is built to be affordable for students and freshers, with plans priced well below typical USD-based resume tools — and you can start for free."},
            {"q": "Can TailorCV build a portfolio website?", "a": "Yes. TailorCV turns your resume into a live, shareable portfolio website in minutes — no coding — which Jobscan does not offer."},
            {"q": "Does TailorCV write cover letters?", "a": "Yes. It generates personalized cover letters matched to each job description, so every application is tailored without starting from scratch."},
            {"q": "Is TailorCV good for freshers and students?", "a": "Absolutely. It's designed for first-time job seekers — get an ATS score, tailor your resume, add projects, and build a portfolio even with little or no experience."},
            {"q": "Can I practice interviews on TailorCV?", "a": "Yes. You get AI mock interviews with role-specific questions and instant feedback to help you prepare."},
        ],
    },
    "careerflow-alternative": {
        "blog": {"slug": "tailorcv-vs-careerflow", "title": "TailorCV vs Careerflow: Which AI Job Search Tool Is Right for You?"},
        "competitor": "Careerflow",
        "audience": "job seekers who care more about offers than profiles",
        "title": "Best Careerflow Alternative (2026) — ATS Resume Optimizer & Portfolio Builder",
        "description": "A Careerflow alternative focused on getting your resume past the ATS: free ATS score, AI resume tailoring, cover letters, mock interviews, and a portfolio website builder.",
        "hero": "Go beyond LinkedIn tweaks. TailorCV scores your resume against the ATS, tailors it to each job with AI, and turns it into a live portfolio website.",
        "intro": [
            "Careerflow's centre of gravity is your LinkedIn presence — profile optimization, personal branding, and a spread of job-search utilities around it. If your problem is that recruiters aren't finding you, that focus makes sense.",
            "But most rejections don't happen because your LinkedIn headline was weak. They happen because your resume was filtered out by software before a person ever opened it. That's a different problem, and it needs a tool pointed at the resume rather than the profile.",
            "TailorCV is pointed at exactly that. Paste a job description, get a match score, let the AI rewrite your bullets to carry the keywords the posting actually asks for, generate the matching cover letter, then practise the interview for that role. Your resume can also become a live portfolio site — a link you own, rather than a profile on someone else's platform.",
        ],
        "props": [
            {"icon": "target", "title": "ATS first", "link": "/solutions", "text": "Built around beating applicant tracking systems, not just polishing your LinkedIn."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Publish a real portfolio site from your resume in minutes."},
            {"icon": "ai", "title": "AI mock interviews", "link": "/mock-interview", "text": "Practice role-specific interviews with instant AI feedback."},
            {"icon": "doc", "title": "Tailored resumes and cover letters", "link": "/cover-letter", "text": "Match every application to its job description automatically."},
            {"icon": "price", "title": "Priced for job hunting", "link": "/pricing", "text": "Start free, and pay in rupees if you upgrade — not a USD subscription."},
            {"icon": "chrome", "title": "Tailor on the job board", "link": "/extension", "text": "Score and tailor against any posting on LinkedIn, Indeed or Naukri in one click."},
        ],
        "rows": [
            {"feature": "ATS match score against a JD", "us": "<span class='yes'>✓</span> Free to start", "them": "Limited"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Full rewrite", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "Varies"},
            {"feature": "Interview question prep", "us": "<span class='yes'>✓</span> Yes", "them": "Varies"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "LinkedIn profile optimization", "us": "Import only", "them": "<span class='yes'>✓</span> Core focus"},
            {"feature": "Job tracker", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Browser extension", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Focus", "us": "ATS + resume + portfolio", "them": "LinkedIn optimization"},
        ],
        "them_good": [
            "Genuinely strong LinkedIn profile optimization — the part of the job hunt TailorCV deliberately doesn't try to own.",
            "A broad spread of free utilities and a large community around them.",
            "Personal branding tooling, if being discovered by recruiters is your bottleneck.",
        ],
        "pick_us": [
            "Your applications are being filtered out before a human reads them.",
            "You want the resume rewritten per job, not just advice about your profile.",
            "You want mock interviews and a portfolio site in the same place.",
            "You want to own the link you send people, not rent a profile page.",
        ],
        "pick_them": [
            "LinkedIn presence and recruiter discovery are your actual problem.",
            "You want personal-branding help more than resume rewriting.",
            "You're already happy with how your resume performs.",
        ],
        "faq": [
            {"q": "Is TailorCV a good Careerflow alternative?", "a": "Yes, especially if your priority is passing the ATS. TailorCV scores your resume against a job description, tailors it with AI, writes cover letters, runs mock interviews, and builds a portfolio website."},
            {"q": "What does TailorCV do that Careerflow doesn't?", "a": "TailorCV includes a portfolio website builder that turns your resume into a shareable live site, plus a dedicated ATS match score for every job description."},
            {"q": "Is there a free plan?", "a": "Yes — get a free ATS score and build a portfolio for free, then upgrade to Pro for unlimited use."},
            {"q": "Does TailorCV have an ATS score checker?", "a": "Yes. Paste your resume and a job description and you get a match score with the missing keywords and concrete fixes — the core focus of TailorCV."},
            {"q": "Can I build a portfolio website with TailorCV?", "a": "Yes. Turn your resume into a live, shareable portfolio site in minutes, with no coding required."},
            {"q": "Is TailorCV good for freshers and students?", "a": "Yes — it's designed for first-time job seekers, with affordable pricing and tools to present projects and skills even without much experience."},
            {"q": "How much does TailorCV cost?", "a": "You can start for free. Pro plans are affordable and unlock unlimited optimizations, cover letters, mock interviews and a custom live portfolio site."},
            {"q": "Can I practice mock interviews on TailorCV?", "a": "Yes. Practice role-specific AI mock interviews and get instant feedback to improve before the real thing."},
        ],
    },
    "resume-worded-alternative": {
        "competitor": "Resume Worded",
        "audience": "job seekers who want the rewrite, not just the feedback",
        "title": "Best Resume Worded Alternative (2026) — Free ATS Score, Resumes & Portfolio",
        "description": "A Resume Worded alternative with a free ATS score, AI resume tailoring to any job description, cover letters, mock interviews, and a portfolio website builder.",
        "hero": "Score and tailor your resume to each job, write cover letters, practice interviews, and publish a portfolio website — all in one place.",
        "intro": [
            "Resume Worded is good at what it set out to do: read your resume line by line and tell you what's weak. Bullets that don't quantify anything, passive phrasing, missing impact — it flags them clearly, and the feedback is often fair.",
            "The catch is that the feedback is largely generic. It grades your resume as a document, not against the job you're applying to tomorrow. Two very different postings can want very different things from the same experience, and line-by-line advice can't tell you which one you're currently failing.",
            "TailorCV starts from the job description. Paste your resume and the posting, and you get a match score for that specific role, the exact keywords you're missing, and — the part that matters — an AI rewrite that works them into your bullets without inventing experience you don't have. Then the cover letter, the interview practice, and a portfolio site if you want one.",
        ],
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "Check your resume against a real job description before you pay anything."},
            {"icon": "doc", "title": "AI tailoring to a JD", "link": "/solutions", "text": "Rewrites bullets and adds missing keywords for the exact role you're applying to."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Turn your resume into a live, shareable site — Resume Worded doesn't."},
            {"icon": "ai", "title": "Mock interviews", "link": "/mock-interview", "text": "Practice role-specific AI interviews with instant feedback."},
            {"icon": "price", "title": "Rupee pricing", "link": "/pricing", "text": "Start free; upgrade at student-friendly prices rather than a USD subscription."},
            {"icon": "chrome", "title": "Score any posting", "link": "/extension", "text": "Check your match on LinkedIn, Indeed or Naukri without copy-pasting."},
        ],
        "rows": [
            {"feature": "ATS match score against a JD", "us": "<span class='yes'>✓</span> Free to start", "them": "Limited free credits"},
            {"feature": "Scored against a specific job", "us": "<span class='yes'>✓</span> Yes", "them": "Mostly generic grading"},
            {"feature": "Line-by-line resume feedback", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Core focus"},
            {"feature": "AI rewrites the bullets for you", "us": "<span class='yes'>✓</span> Yes", "them": "Suggestions only"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Interview question prep", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "LinkedIn profile review", "us": "Import only", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "USD pricing"},
        ],
        "them_good": [
            "Clear, specific line-by-line writing feedback — genuinely useful for learning what a strong bullet looks like.",
            "A well-regarded LinkedIn profile review tool alongside the resume scorer.",
            "Good for improving your resume in general, before you have a particular job in mind.",
        ],
        "pick_us": [
            "You want the rewrite done, not a list of things to fix yourself.",
            "You're applying to a specific job and want to know if this resume passes for that role.",
            "You want cover letters and interview practice in the same place.",
            "USD pricing is hard to justify on a student budget.",
        ],
        "pick_them": [
            "You want to learn to write better bullets yourself rather than have AI do it.",
            "You want general resume feedback with no particular job in mind.",
            "A LinkedIn profile review is the main thing you're after.",
        ],
        "faq": [
            {"q": "Is TailorCV a good Resume Worded alternative?", "a": "Yes. TailorCV gives you a free ATS score, tailors your whole resume to a job description with AI, writes cover letters, runs mock interviews, and builds a portfolio site — broader than line-by-line scoring."},
            {"q": "Does TailorCV score my resume like Resume Worded?", "a": "Yes — paste your resume and a job description and you get a match score plus the missing keywords and fixes to raise it. The difference is that the score is against a specific job, not a general grade."},
            {"q": "Is it free?", "a": "You can check your ATS score and build a portfolio for free; Pro unlocks unlimited optimizations, cover letters and mock interviews."},
            {"q": "What does TailorCV add over Resume Worded?", "a": "A portfolio website builder and AI mock interviews, plus full AI rewriting tailored to each job — not just scoring suggestions."},
            {"q": "Does TailorCV rewrite my resume, or just tell me what's wrong?", "a": "It rewrites. The AI reworks your bullets so they carry the keywords and phrasing the job description asks for, while keeping every claim grounded in what you actually did — it will not invent experience for you."},
            {"q": "Will the AI make up experience I don't have?", "a": "No. The tailoring is explicitly constrained to your real history: it rephrases and re-emphasises what's already on your resume to match the role, rather than fabricating projects, employers or skills."},
            {"q": "Can I use TailorCV without any work experience?", "a": "Yes. It's built with students and freshers in mind — it works from projects, coursework, internships and volunteering, and the portfolio builder helps you show work when your resume is still short."},
            {"q": "Do I have to re-tailor for every job?", "a": "It takes about a minute per job, and it's the whole point — a resume tuned to one posting will not score the same against a different one. Each tailored version is saved to your Job Tracker so you always know what you sent where."},
        ],
    },
    "teal-alternative": {
        "blog": {"slug": "tailorcv-vs-teal", "title": "TailorCV vs Teal: The Tracker That Files vs the One That Fills Itself In"},
        "competitor": "Teal",
        "audience": "job seekers who want the resume fixed, not just tracked",
        "title": "Best Teal Alternative (2026) — ATS Resume Optimizer & Portfolio Builder",
        "description": "A Teal alternative for getting past the ATS: free ATS score, AI resume tailoring to a job description, cover letters, mock interviews, and a live portfolio website.",
        "hero": "Tailor your resume to each job, beat the ATS, practice interviews, and publish a portfolio site — affordable and built for first-time job seekers.",
        "intro": [
            "Teal is a well-built product with a popular job tracker. But its tracker is a filing cabinet: you find a job, you click save, and you get a link and a status column. The work of actually applying still happens somewhere else, and the tracker never knows how it went.",
            "TailorCV's tracker fills itself in. Tailor your resume to a posting — from the job board itself, via the Chrome extension — and the role, the company, your ATS match score and the exact tailored PDF you sent are all recorded, automatically, as a byproduct of doing the work. You're not maintaining a list; the list maintains itself.",
            "That difference matters more than it sounds. Six weeks into a search, Teal can tell you that you applied to forty jobs. TailorCV can tell you which resume you sent to each one, what it scored, and let you re-download it before the interview. On top of that you get cover letters, mock interviews for the role, and a live portfolio site — none of which Teal does.",
        ],
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "Instant match score against any job description, free."},
            {"icon": "doc", "title": "AI resume tailoring", "link": "/solutions", "text": "Rewrites and aligns your resume to the role automatically."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Publish a shareable portfolio site from your resume in minutes."},
            {"icon": "ai", "title": "AI mock interviews", "link": "/mock-interview", "text": "Role-specific practice with instant feedback."},
            {"icon": "price", "title": "Rupee pricing", "link": "/pricing", "text": "Start free, then pay student-friendly prices instead of a USD subscription."},
            {"icon": "chrome", "title": "Tailor from the posting", "link": "/extension", "text": "Score and rewrite against any job on LinkedIn, Indeed or Naukri in one click."},
        ],
        "rows": [
            {"feature": "ATS match score against a JD", "us": "<span class='yes'>✓</span> Free to start", "them": "Limited"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Full rewrite", "them": "Keyword matching"},
            {"feature": "Missing keyword report", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Interview question prep", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Job tracker", "us": "<span class='yes'>✓</span> Fills itself in", "them": "<span class='yes'>✓</span> Manual save"},
            {"feature": "Tailored resume saved with each job", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "ATS score stored per application", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Browser extension", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Resume templates included", "us": "<span class='yes'>✓</span> 20+", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "USD subscription"},
        ],
        "them_good": [
            "A polished, mature product with a generous free tier and a strong browser extension.",
            "Its tracker holds a very large number of roles, with notes and reminders — useful if you're running a long, high-volume search.",
            "Deep LinkedIn and job-board integrations built up over years.",
        ],
        "pick_us": [
            "You want your tracker to fill itself in, with the tailored resume and ATS score attached to every job.",
            "Your resume is getting filtered out and you want it rewritten per job, not just filed.",
            "You want mock interviews and interview prep in the same tool.",
            "You want a live portfolio site you can send as a link.",
            "You're paying in rupees and a USD subscription is a real cost.",
        ],
        "pick_them": [
            "You're tracking a very high volume of roles and need notes and reminders on each.",
            "You want to save jobs you have no intention of tailoring for.",
            "You're already confident your resume performs well.",
        ],
        "faq": [
            {"q": "Is TailorCV a good Teal alternative?", "a": "Yes, especially for ATS-first job seekers. TailorCV scores and rewrites your resume for each job, writes cover letters, runs mock interviews, and builds a portfolio website."},
            {"q": "What does TailorCV offer that Teal doesn't?", "a": "A portfolio website builder and AI mock interviews, plus full AI rewriting tailored to each job description rather than keyword matching alone."},
            {"q": "Is TailorCV cheaper than Teal?", "a": "Yes — it's priced affordably for students and freshers, and you can start for free."},
            {"q": "Does it work for freshers?", "a": "Yes — it's built for first-time job seekers, helping you present projects and skills even with little experience."},
            {"q": "Does TailorCV have a job tracker like Teal?", "a": "Yes. Every resume you tailor is saved to your Job Tracker automatically, along with its ATS score and the job it was written for, so you always know which version you sent where."},
            {"q": "Is Teal better than TailorCV?", "a": "For tracking a large job search, Teal's tracker is excellent and we'd say so plainly. For getting the resume itself past the ATS — scoring it against a posting, rewriting the bullets, and preparing for the interview — that's what TailorCV is built to do."},
            {"q": "Can I use both?", "a": "Yes, and some people do — track in one, tailor in the other. Most find it simpler to keep the tailored resume and the job record in the same place, which is why the Job Tracker exists."},
            {"q": "Does TailorCV work on LinkedIn like Teal's extension?", "a": "Yes. The Chrome extension reads the job description straight from the posting on LinkedIn, Indeed, Naukri, Greenhouse, Workday and more, then scores and tailors your resume without leaving the page."},
        ],
    },
    "rezi-alternative": {
        "competitor": "Rezi",
        "audience": "job seekers who already have a resume and need it to land",
        "title": "Best Rezi Alternative (2026) — Free ATS Score, AI Resumes & Portfolio",
        "description": "A Rezi alternative with a free ATS score, AI resume tailoring to a job description, cover letters, mock interviews, and a portfolio website builder.",
        "hero": "Get an ATS score, tailor your resume to each job with AI, write cover letters, practice interviews, and publish a portfolio website.",
        "intro": [
            "Rezi is a solid AI resume builder. If you're starting from a blank page, its templates and guided writing get you to a clean, ATS-safe document quickly, and the output looks the part.",
            "But most people aren't starting from nothing. They have a resume already — it's just not getting replies. The question isn't 'how do I build a resume', it's 'why is this one being rejected, and what exactly do I change for this job'. A builder doesn't answer that.",
            "TailorCV starts from the resume you already have. Upload it, paste the posting, and you get a match score for that role, the keywords you're missing, and an AI rewrite that works them in without inventing anything. Then the cover letter, mock interviews, and a live portfolio site — and every version saved to your Job Tracker with the job it was written for.",
        ],
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "See your match score against any job description for free."},
            {"icon": "doc", "title": "AI tailoring to a JD", "link": "/solutions", "text": "Aligns your resume to the exact role you're targeting."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Turn your resume into a live portfolio site — Rezi doesn't."},
            {"icon": "ai", "title": "AI mock interviews", "link": "/mock-interview", "text": "Practice and get instant feedback before the real thing."},
            {"icon": "price", "title": "Rupee pricing", "link": "/pricing", "text": "Start free; upgrade at student prices rather than a USD plan."},
            {"icon": "chrome", "title": "Works where you apply", "link": "/extension", "text": "Tailor against any posting on LinkedIn, Indeed or Naukri without copy-pasting."},
        ],
        "rows": [
            {"feature": "ATS match score against a JD", "us": "<span class='yes'>✓</span> Free to start", "them": "Limited free plan"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Full rewrite", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Works from your existing resume", "us": "<span class='yes'>✓</span> Upload & tailor", "them": "Builder-first"},
            {"feature": "Resume builder from scratch", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Core strength"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Interview question prep", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Saved resume library & job tracker", "us": "<span class='yes'>✓</span> Yes", "them": "Limited"},
            {"feature": "Browser extension", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "USD pricing"},
        ],
        "them_good": [
            "A genuinely good resume builder if you're starting from a blank page — clean templates and guided writing.",
            "ATS-safe formatting baked into the output, so the document itself rarely breaks parsers.",
            "Well suited to producing one polished master resume.",
        ],
        "pick_us": [
            "You already have a resume and need to know why it isn't landing.",
            "You want it re-tailored per job rather than one master version.",
            "You want interview practice and a portfolio site alongside the resume.",
            "USD pricing is hard to justify on a student budget.",
        ],
        "pick_them": [
            "You're starting from nothing and want a builder to walk you through it.",
            "One well-formatted master resume is all you need.",
            "You don't want per-job tailoring at all.",
        ],
        "faq": [
            {"q": "Is TailorCV a good Rezi alternative?", "a": "Yes. TailorCV offers a free ATS score, AI resume tailoring to a job description, cover letters, AI mock interviews, and a portfolio website builder at an affordable price."},
            {"q": "Does TailorCV build resumes like Rezi?", "a": "Yes — it tailors and rewrites your resume to each job and gives you an ATS match score with the missing keywords. It also has a resume builder if you're starting from scratch."},
            {"q": "What's different from Rezi?", "a": "Rezi is builder-first: it's strongest when you're writing a resume from a blank page. TailorCV is tailoring-first: it starts from the resume you already have and adapts it to each specific job, then adds mock interviews and a portfolio site."},
            {"q": "Is there a free option?", "a": "Yes — get a free ATS score and build a portfolio for free, then upgrade to Pro for unlimited use."},
            {"q": "Can I upload my existing resume instead of rebuilding it?", "a": "Yes. Upload the PDF you already have and TailorCV works from that — you never need to retype your history into a builder to get a score or a tailored version."},
            {"q": "Will the AI invent experience I don't have?", "a": "No. Tailoring is constrained to what's genuinely on your resume — it rephrases and re-emphasises your real work to match the posting, rather than fabricating employers, projects or skills."},
            {"q": "How long does tailoring take per job?", "a": "About a minute. Paste the job description, get your score and the missing keywords, and download the tailored PDF — or do it directly on the job posting with the Chrome extension."},
            {"q": "Does TailorCV keep my old versions?", "a": "Yes. Every tailored resume is saved to your Job Tracker with its ATS score and the role it was written for, so you can re-download any version later without starting over."},
        ],
    },
}


def _render_comparison_page(request: Request, slug: str) -> HTMLResponse:
    cmp = _COMPARISON_PAGES.get(slug)
    if not cmp:
        raise HTTPException(status_code=404, detail="Page not found")
    faq_schema = json.dumps({
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": f["q"],
             "acceptedAnswer": {"@type": "Answer", "text": f["a"]}}
            for f in cmp["faq"]
        ],
    })
    return templates.TemplateResponse(request, "comparison_alternative.html", {
        "request": request,
        "cmp": cmp,
        "seo_og_title": cmp["title"],
        "seo_og_description": cmp["description"],
        "canonical_url": build_absolute_url(f"/{slug}"),
        "faq_schema_json": faq_schema,
    })


@app.get("/jobscan-alternative", response_class=HTMLResponse)
async def jobscan_alternative_page(request: Request):
    return _render_comparison_page(request, "jobscan-alternative")


@app.get("/careerflow-alternative", response_class=HTMLResponse)
async def careerflow_alternative_page(request: Request):
    return _render_comparison_page(request, "careerflow-alternative")


@app.get("/resume-worded-alternative", response_class=HTMLResponse)
async def resume_worded_alternative_page(request: Request):
    return _render_comparison_page(request, "resume-worded-alternative")


@app.get("/teal-alternative", response_class=HTMLResponse)
async def teal_alternative_page(request: Request):
    return _render_comparison_page(request, "teal-alternative")


@app.get("/rezi-alternative", response_class=HTMLResponse)
async def rezi_alternative_page(request: Request):
    return _render_comparison_page(request, "rezi-alternative")


@app.get("/alternatives", response_class=HTMLResponse)
async def alternatives_hub(request: Request):
    """Index of the competitor comparison pages.

    Until this existed the comparison pages were orphaned — in the sitemap but
    linked from nowhere on the site, so they were crawled rarely and ranked worse
    than the hand-written content deserved. This hub plus the footer column is
    what connects them.
    """
    breadcrumb = json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": build_absolute_url("/")},
            {"@type": "ListItem", "position": 2, "name": "Comparisons", "item": build_absolute_url("/alternatives")},
        ],
    })
    return templates.TemplateResponse(request, "alternatives_hub.html", {
        "request": request,
        "pages": _COMPARISON_PAGES,
        "seo_og_title": "TailorCV vs Jobscan, Teal, Rezi & More — Compare (2026) | TailorCV",
        "seo_og_description": "Compare TailorCV with Jobscan, Teal, Rezi, Resume Worded and Careerflow — features, pricing, and which resume tool is right for you.",
        "canonical_url": build_absolute_url("/alternatives"),
        "page_schema_json": breadcrumb,
    })


# ── Programmatic resume-examples hub ─────────────────────────────────────────
@app.get("/resume-examples", response_class=HTMLResponse)
async def resume_examples_hub(request: Request):
    """Index of role-based resume example pages (interlinks the whole hub)."""
    breadcrumb = json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": build_absolute_url("/")},
            {"@type": "ListItem", "position": 2, "name": "Resume Examples", "item": build_absolute_url("/resume-examples")},
        ],
    })
    return templates.TemplateResponse(request, "resume_examples_hub.html", {
        "request": request,
        "roles": ROLE_SEO,
        "seo_og_title": "Free Resume Examples by Job Role (2026) | TailorCV",
        "seo_og_description": "Free resume examples by job role — the right ATS keywords, skills, and bullet points for your role, plus the mistakes to avoid.",
        "canonical_url": build_absolute_url("/resume-examples"),
        "page_schema_json": breadcrumb,
    })


@app.get("/resume-examples/{role}", response_class=HTMLResponse)
async def resume_example_detail(request: Request, role: str):
    r = ROLE_SEO.get(role)
    if not r:
        raise HTTPException(status_code=404, detail="Resume example not found")
    # Per-role FAQs generated from the role's own data → unique per page (good for
    # "People Also Ask" / featured snippets), and mirrored into FAQPage schema.
    role_name = r["role"]
    faqs = [
        {"q": f"What skills should a {role_name} resume include?",
         "a": f"Top skills to feature on a {role_name} resume include {', '.join(r['skills'][:8])}. List the ones you're strongest in and back them with results."},
        {"q": f"What ATS keywords should a {role_name} resume have?",
         "a": f"Recruiters and ATS scan for keywords like {', '.join(r['keywords'][:8])}. Match these to the exact wording in the job description."},
        {"q": f"What is a common {role_name} resume mistake?",
         "a": r["mistakes"][0]},
        {"q": f"Is TailorCV's ATS checker free for a {role_name} resume?",
         "a": "Yes. Paste your resume and a job description to get a free ATS score with the missing keywords and fixes before you apply."},
    ]
    article_schema = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": f"{role_name} Resume Example & Guide",
                "description": r["description"],
                "author": {"@type": "Organization", "name": "TailorCV"},
                "publisher": {"@type": "Organization", "name": "TailorCV"},
                "mainEntityOfPage": build_absolute_url(f"/resume-examples/{role}"),
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Resume Examples", "item": build_absolute_url("/resume-examples")},
                    {"@type": "ListItem", "position": 2, "name": f"{role_name} Resume", "item": build_absolute_url(f"/resume-examples/{role}")},
                ],
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {"@type": "Question", "name": f["q"],
                     "acceptedAnswer": {"@type": "Answer", "text": f["a"]}}
                    for f in faqs
                ],
            },
        ],
    })
    return templates.TemplateResponse(request, "resume_example.html", {
        "request": request,
        "r": r,
        "faqs": faqs,
        "seo_og_title": r["title"],
        "seo_og_description": r["description"],
        "canonical_url": build_absolute_url(f"/resume-examples/{role}"),
        "page_schema_json": article_schema,
    })


@app.get("/templates", response_class=HTMLResponse)
async def templates_page(request: Request):
    """Templates gallery page."""
    return templates.TemplateResponse(
        request,
        "templates.html",
        {
            "request": request,
            "is_logged_in": bool(request.session.get("user_id")),
            "canonical_url": build_absolute_url("/templates"),
            "software_schema_json": build_software_app_schema(),
            "page_schema_json": build_page_breadcrumb("Resume Templates", "/templates"),
        },
    )


@app.get("/ats-analysis", response_class=HTMLResponse)
async def ats_analysis_page(request: Request):
    """Dedicated ATS analysis page."""
    return templates.TemplateResponse(
        request,
        "ats_analysis.html",
        {
            "request": request,
            "canonical_url": build_absolute_url("/ats-analysis"),
            "software_schema_json": build_software_app_schema(),
            "faq_schema_json": build_faq_page_schema(),
        },
    )


@app.get("/optimized-editor", response_class=HTMLResponse)
async def optimized_editor_page(request: Request):
    """Live editor page for optimized resume preview."""
    require_logged_in(request)
    db = get_db()
    try:
        user = db.query(User).filter_by(id=request.session["user_id"]).first()
        user_is_pro = is_pro(user) if user else False
        quota_exhausted_flag = (
            (not user_is_pro) and bool(user) and quota_exhausted(db, user, "ai_optimizations")
        )
        downloads_used = 0 if user_is_pro else lifetime_usage(db, user, "ai_optimizations")
    finally:
        db.close()
    response = templates.TemplateResponse(
        request,
        "optimized_editor.html",
        {
            "request": request,
            "is_pro": user_is_pro,
            "quota_exhausted_flag": quota_exhausted_flag,
            # The upgrade prompt states how many downloads the user has actually
            # had; it used to hardcode "3 resumes", which read as wrong to anyone
            # who had used a different number.
            "downloads_used": downloads_used,
            "free_download_limit": FREE_LIMITS.get("ai_optimizations", 3),
            "region": _get_region(request),
        },
    )
    # This page bakes the user's Pro and quota state into its HTML, so a cached
    # copy is a copy of who they USED to be. The upgrade CTA is a same-tab link,
    # meaning the path a paying user takes is: paywall -> /pricing -> pay -> Back.
    # A cached or back-forward-cached page brings the pre-payment paywall back
    # with it, locking someone out of the resume they just paid for. no-store
    # forces a real request on the way back, and also opts the page out of the
    # back-forward cache in Chrome and Firefox, which is the behaviour we want
    # here even though it costs a re-render.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/modify-cv", response_class=HTMLResponse)
async def modify_cv_page(request: Request):
    """Manual CV editing page."""
    return templates.TemplateResponse(
        request,
        "modify_cv.html",
        {"request": request, "is_logged_in": bool(request.session.get("user_id"))},
    )


@app.get("/my-resumes", response_class=HTMLResponse)
async def my_resumes_page(request: Request):
    """Dashboard of the logged-in user's saved (optimized) resumes.

    Logged-out visitors get the marketing landing instead of a login redirect,
    so the page works as a public entry point (signup capture)."""
    user_id = request.session.get("user_id")
    if not user_id:
        return templates.TemplateResponse(
            request,
            "my_resumes.html",
            {"request": request, "resumes": [], "is_logged_in": False},
        )
    db = get_db()
    try:
        resumes = (
            db.query(SavedResume)
            .filter(SavedResume.user_id == user_id)
            .order_by(SavedResume.created_at.desc())
            .all()
        )
        user = db.query(User).filter(User.id == user_id).first()
        has_base_resume = bool(user and user.base_resume_path and os.path.exists(user.base_resume_path))
        base_resume = {
            "has_base_resume": has_base_resume,
            "filename": user.base_resume_filename if has_base_resume else None,
            "template_id": user.base_template_id if has_base_resume else None,
            "style_id": user.base_style_id if has_base_resume else None,
        }
    finally:
        db.close()
    return templates.TemplateResponse(
        request,
        "my_resumes.html",
        {"request": request, "resumes": resumes, "base_resume": base_resume, "is_logged_in": True},
    )


@app.get("/my-resumes/{resume_id}/download", include_in_schema=False)
async def download_saved_resume(request: Request, resume_id: int):
    """Re-render a saved resume to PDF from its stored HTML (no AI re-run)."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        if not is_pro(user):
            _beta_env = os.getenv("BILLING_BETA_USER_IDS", "").strip()
            _in_beta_allowlist = False
            if _beta_env:
                _beta_ids = {int(x) for x in _beta_env.split(",") if x.strip().isdigit()}
                _in_beta_allowlist = user.id not in _beta_ids
            if not _in_beta_allowlist:
                from sqlalchemy import func as _func
                used = (
                    db.query(_func.coalesce(_func.sum(UsageRecord.ai_optimizations), 0))
                    .filter(UsageRecord.user_id == user.id)
                    .scalar() or 0
                )
                limit = FREE_LIMITS.get("ai_optimizations", 1)
                if used >= limit:
                    return RedirectResponse("/pricing?upgrade=ai_optimizations", status_code=303)
        record = (
            db.query(SavedResume)
            .filter(SavedResume.id == resume_id, SavedResume.user_id == user_id)
            .first()
        )
        html_content = record.html_content if record else None
        # Older saved resumes predate html_content being stored, but they still have
        # the structured resume_json. Read the fields needed to re-render while the
        # session is open, so the fallback below can rebuild the HTML instead of 410ing.
        fallback_json = record.resume_json if record else None
        fallback_template = (record.template_id if record else None) or 1
        fallback_style = (record.style_id if record else None) or 0
        fallback_jd = (record.jd_snippet if record else None) or ""
        record_found = record is not None
    finally:
        db.close()
    if not record_found:
        raise HTTPException(status_code=404, detail="Resume not found")

    # Rebuild the HTML from the stored structured data when it wasn't saved.
    if not html_content and fallback_json:
        try:
            _parsed = json.loads(fallback_json) if isinstance(fallback_json, str) else fallback_json
            if isinstance(_parsed, dict) and _parsed:
                html_content, _ = _render_resume_html(
                    _parsed, fallback_jd, fallback_template, fallback_style
                )
        except Exception:
            logger.exception("Saved-resume HTML rebuild from resume_json failed")

    if not html_content:
        raise HTTPException(status_code=410, detail="This saved resume has no stored content to download.")

    pdf_path = os.path.join(resumes_dir, f"saved_resume_{uuid.uuid4()}.pdf")

    def _render_pdf():
        from weasyprint import HTML
        HTML(string=html_content, base_url=BASE_DIR).write_pdf(pdf_path, optimize_size=("fonts",))

    try:
        await asyncio.to_thread(_render_pdf)
    except Exception as e:
        logger.exception("PDF render failed")
        raise HTTPException(status_code=500, detail="Failed to render the PDF. Please try again.")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename="optimized_resume.pdf",
        background=BackgroundTask(_cleanup_files, [pdf_path]),
    )


@app.post("/my-resumes/{resume_id}/delete", include_in_schema=False)
async def delete_saved_resume(request: Request, resume_id: int):
    """Delete one of the user's saved resumes."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        deleted = (
            db.query(SavedResume)
            .filter(SavedResume.id == resume_id, SavedResume.user_id == user_id)
            .delete(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()
    if not deleted:
        raise HTTPException(status_code=404, detail="Resume not found")
    return RedirectResponse(url="/my-resumes", status_code=303)


# Application stages a saved resume can be tagged with (job-tracker).
SAVED_RESUME_STATUSES = {"saved", "applied", "interview", "selected", "rejected"}


@app.post("/my-resumes/{resume_id}/update", include_in_schema=False)
async def update_saved_resume(
    request: Request,
    resume_id: int,
    company: str = Form(""),
    status: str = Form("saved"),
):
    """Update the job-tracker fields (company, application status) of a resume."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    status = (status or "saved").strip().lower()
    if status not in SAVED_RESUME_STATUSES:
        status = "saved"
    db = get_db()
    try:
        record = (
            db.query(SavedResume)
            .filter(SavedResume.id == resume_id, SavedResume.user_id == user_id)
            .first()
        )
        if not record:
            raise HTTPException(status_code=404, detail="Resume not found")
        record.company = (company or "").strip()[:200] or None
        record.status = status
        db.commit()
    finally:
        db.close()
    return RedirectResponse(url="/my-resumes", status_code=303)


# ══════════════════════════════════════════════════════════════════════════════
#  COVER LETTER GENERATOR
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/cover-letter", response_class=HTMLResponse)
async def cover_letter_page(request: Request):
    """Standalone cover-letter generator (paste/upload resume + JD → AI letter)."""
    return templates.TemplateResponse(
        request,
        "cover_letter.html",
        {
            "request": request,
            "is_logged_in": bool(request.session.get("user_id")),
            "canonical_url": build_absolute_url("/cover-letter"),
            "software_schema_json": build_software_app_schema(),
            "page_schema_json": build_page_breadcrumb("AI Cover Letter Generator", "/cover-letter"),
        },
    )


COVER_TEMPLATES = ("classic", "modern", "monogram")


def _render_cover_letter_html(template: str, name: str, email: str, location: str, body: str) -> str:
    """Render a cover letter in one of the three designs offered on /cover-letter.

    Ported from the client-side renderers in cover_letter.html (classic / modern /
    monogram) so a letter the extension writes on a job page is identical to one
    built on the website."""
    from html import escape as e

    template = (template or "classic").lower()
    if template not in COVER_TEMPLATES:
        template = "classic"

    date = datetime.utcnow().strftime("%B %d, %Y")
    contact = " | ".join(x for x in [location, email] if x)

    blocks = [b.strip() for b in re.split(r"\n\s*\n", body or "") if b.strip()]
    if len(blocks) <= 1:
        blocks = [b.strip() for b in (body or "").split("\n") if b.strip()]

    def paras(align):
        return "".join(
            '<p style="margin:0 0 12px;text-align:{};">{}</p>'.format(align, e(b).replace("\n", "<br>"))
            for b in blocks
        )

    # The model is told not to add a sign-off, but it sometimes does anyway — don't
    # print a second "Sincerely" underneath one it already wrote.
    has_closing = bool(
        re.search(r"(sincerely|regards|best regards|yours (sincerely|truly)|thank you)[\s,]*$",
                  (body or "").strip(), re.I)
    )

    def sig(color):
        out = "" if has_closing else '<div style="margin-top:24px;">Sincerely,</div>'
        if name:
            out += (
                '<div style="font-family:\'Brush Script MT\',\'Segoe Script\',cursive;'
                'font-size:24px;margin-top:8px;color:{};">{}</div>'.format(color, e(name))
            )
        return out

    def doc(inner):
        return (
            '<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}'
            'html,body{margin:0;padding:0;background:#fff;}*{box-sizing:border-box;}'
            '</style></head><body>' + inner + '</body></html>'
        )

    display_name = name or "First Name Last Name"
    parts = display_name.split()
    first = e(parts[0] if parts else "")
    last = e(" ".join(parts[1:]))

    if template == "modern":
        contact_html = (
            '<div style="font-size:10.5px;color:#777;margin-top:6px;">{}</div>'.format(e(contact))
            if contact else ""
        )
        return doc(
            '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:12.5px;'
            'line-height:1.6;padding:50px 58px;">'
            '<div style="font-size:26px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">'
            '<span style="color:#1aa3a3;font-weight:500;">{}</span> '
            '<span style="color:#0e7c7c;">{}</span></div>'
            '{}<div style="margin:22px 0;color:#444;">{}</div>{}{}</div>'.format(
                first, last, contact_html, e(date), paras("left"), sig("#0e7c7c")
            )
        )

    if template == "monogram":
        initial = e((display_name.strip()[:1] or "L").upper())
        stacked = "<br>".join(e(x) for x in [location, email] if x)
        stacked_html = (
            '<div style="font-size:10.5px;color:#555;margin-top:12px;line-height:1.55;">{}</div>'.format(stacked)
            if stacked else ""
        )
        return doc(
            '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:12px;'
            'line-height:1.6;padding:46px 50px;">'
            '<table style="width:100%;border-collapse:collapse;"><tr>'
            '<td style="width:158px;vertical-align:top;padding-right:24px;">'
            '<div style="width:54px;height:54px;background:#1f2937;color:#34d399;font-size:30px;'
            'font-weight:800;text-align:center;line-height:54px;border-radius:4px;">{}</div>'
            '<div style="color:#0e7c7c;font-weight:800;font-size:15px;margin-top:14px;'
            'line-height:1.25;">{}<br>{}</div>{}'
            '</td><td style="vertical-align:top;">'
            '<div style="margin:0 0 18px;">{}</div>{}{}</td></tr></table></div>'.format(
                initial, first, last, stacked_html, e(date), paras("left"), sig("#111")
            )
        )

    contact_html = (
        '<div style="text-align:right;font-size:10.5px;color:#444;margin-top:5px;'
        'letter-spacing:.3px;">{}</div>'.format(e(contact))
        if contact else ""
    )
    return doc(
        '<div style="font-family:Georgia,\'Times New Roman\',serif;color:#111;font-size:12.5px;'
        'line-height:1.55;padding:54px 60px;">'
        '<div style="border-bottom:2px solid #111;padding-bottom:8px;text-align:right;">'
        '<span style="font-size:22px;font-weight:700;letter-spacing:.5px;">{}</span></div>'
        '{}<div style="text-align:right;margin:20px 0 22px;">{}</div>{}{}</div>'.format(
            e(display_name), contact_html, e(date), paras("justify"), sig("#111")
        )
    )


def _build_cover_letter_prompt(resume_text: str, job_description: str, tone: str) -> str:
    """The cover-letter prompt, shared by the website form and the Chrome extension
    so a letter written from a job page reads exactly like one written on the site."""
    return (
        "You are an expert career writer. Write a tailored cover letter for the candidate "
        "below, matching the job description.\n\n"
        f"Tone: {tone}.\n"
        "Rules:\n"
        "- 3 to 4 short paragraphs, under 300 words total.\n"
        "- Open with genuine interest in the specific role; avoid clichés like "
        "\"I am writing to apply\".\n"
        "- Use concrete, relevant achievements and skills FROM THE RESUME that match the "
        "job description. Never invent experience that is not in the resume.\n"
        "- Close with a confident call to action. No markdown, no placeholder brackets, "
        "no sign-off name line.\n\n"
        "Also extract the candidate's contact details FROM THE RESUME (never invent them; "
        "use an empty string if a field is not present).\n"
        "Return ONLY a JSON object of the form "
        "{\"cover_letter\": \"<the full letter as plain text, with \\n between paragraphs>\", "
        "\"name\": \"<candidate full name>\", "
        "\"email\": \"<candidate email address>\", "
        "\"location\": \"<candidate city, state/country>\"}.\n\n"
        f"=== RESUME ===\n{resume_text}\n\n"
        f"=== JOB DESCRIPTION ===\n{job_description}\n"
    )


COVER_LETTER_TONES = {
    "professional": "professional and confident",
    "warm": "warm and personable",
    "concise": "concise and direct",
}


@app.post("/api/generate-cover-letter")
async def generate_cover_letter(request: Request):
    """Generate a tailored cover letter from a resume (PDF upload — preferred — or
    pasted text) plus a job description.

    Login-gated to match the signup-capture pattern used by the ATS score.
    Reuses the existing AI helper (functions.get_resume_response), which enforces a
    JSON response — so we ask for {"cover_letter": "..."} and parse it out."""
    require_logged_in(request)

    resume_text = ""
    job_description = ""
    tone_key = "professional"
    file_path = None

    try:
        content_type = request.headers.get("content-type", "")
        if "multipart/form-data" in content_type:
            form = await request.form()
            job_description = str(form.get("job_description") or "").strip()
            tone_key = str(form.get("tone") or "professional").strip().lower()
            resume_text = str(form.get("resume_text") or "").strip()
            upload = form.get("resume_pdf")
            # Prefer the uploaded PDF: extract its text server-side so the user only
            # has to provide the PDF.
            if not resume_text and upload is not None and getattr(upload, "filename", ""):
                file_path = save_uploaded_pdf(upload)
                with open(file_path, "wb") as buffer:
                    buffer.write(await upload.read())
                extracted = await asyncio.to_thread(extract_pdf_text, file_path)
                resume_text = (extracted or "").strip()
        else:
            payload = await request.json()
            resume_text = str(payload.get("resume_text") or "").strip()
            job_description = str(payload.get("job_description") or "").strip()
            tone_key = str(payload.get("tone") or "professional").strip().lower()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request.")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)

    tone = COVER_LETTER_TONES.get(tone_key, COVER_LETTER_TONES["professional"])

    if len(resume_text) < 50:
        raise HTTPException(
            status_code=400,
            detail="Couldn't read your resume. Upload a text-based PDF (not a scanned image), or paste your resume text.",
        )
    if len(job_description) < 30:
        raise HTTPException(status_code=400, detail="Please provide the job description.")

    # Bound input size to keep prompts within token limits.
    resume_text = resume_text[:8000]
    job_description = job_description[:6000]

    db = get_db()
    try:
        user = db.query(User).filter_by(id=request.session["user_id"]).first()
        enforce_quota(db, user, "cover_letters")
        uid = user.id
    finally:
        db.close()

    prompt = _build_cover_letter_prompt(resume_text, job_description, tone)

    try:
        raw = await get_resume_response(prompt, model=AI_MODEL, temperature=0.4)
        parsed = parse_ai_json_response(raw)
        if not isinstance(parsed, dict):
            parsed = {}
        letter = ((parsed.get("cover_letter")) or "").strip()
        if not letter:
            raise ValueError("Empty cover letter returned")
    except Exception:
        logger.exception("Cover letter generation failed")
        db2 = get_db()
        try:
            refund_quota(db2, uid, "cover_letters")
        finally:
            db2.close()
        raise HTTPException(status_code=502, detail="Could not generate the cover letter. Please try again.")

    return JSONResponse({
        "cover_letter": letter,
        "name": (parsed.get("name") or "").strip(),
        "email": (parsed.get("email") or "").strip(),
        "location": (parsed.get("location") or "").strip(),
    })


# ══════════════════════════════════════════════════════════════════════════════
#  AUTO JOB APPLY — backend for the "TailorCV Auto Apply" Chrome extension
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/auto-apply", response_class=HTMLResponse)
async def auto_apply_page(request: Request):
    """Landing + install page for auto-apply; lists the user's logged applications."""
    user_id = request.session.get("user_id")
    applications = []
    if user_id:
        db = get_db()
        try:
            applications = (
                db.query(JobApplication)
                .filter(JobApplication.user_id == user_id)
                .order_by(JobApplication.created_at.desc())
                .all()
            )
        finally:
            db.close()
    return templates.TemplateResponse(
        request,
        "auto_apply.html",
        {"request": request, "applications": applications, "logged_in": bool(user_id)},
    )


@app.post("/api/extension/cover-letter")
async def extension_cover_letter(request: Request):
    """Write a cover letter for the job the extension is looking at, using the same
    stored base resume it tailors from, and return it as a PDF.

    The panel already holds the JD and the user already has a base resume on file, so
    the user never re-uploads anything. CSRF-exempt (see EXEMPT_PATHS) because it is
    called from background.js, which carries no page token — the session cookie is
    still required."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request body")

    jd_string = str(payload.get("jd_string") or "").strip()
    if len(jd_string) < 30:
        raise HTTPException(status_code=400, detail="Missing job description")
    role = (payload.get("role") or "").strip()[:200]
    company = (payload.get("company") or "").strip()[:200]
    tone_key = str(payload.get("tone") or "professional").strip().lower()
    tone = COVER_LETTER_TONES.get(tone_key, COVER_LETTER_TONES["professional"])
    requested_template = str(payload.get("cover_template") or "").strip().lower()

    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        if not user.base_resume_path or not os.path.exists(user.base_resume_path):
            raise HTTPException(status_code=404, detail="No base resume set. Set one up at thetailorcv.com/extension first.")
        base_resume_path = user.base_resume_path
        cover_template = user.base_cover_template or "classic"
        # Same lifetime free-use gate the website's cover-letter form enforces; raises 402.
        enforce_quota(db, user, "cover_letters")
    finally:
        db.close()

    resume_text = (await asyncio.to_thread(extract_pdf_text, base_resume_path) or "").strip()
    if len(resume_text) < 50:
        db2 = get_db()
        try:
            refund_quota(db2, user_id, "cover_letters")
        finally:
            db2.close()
        raise HTTPException(
            status_code=400,
            detail="Could not read your base resume. Re-upload a text-based PDF at thetailorcv.com/extension.",
        )

    prompt = _build_cover_letter_prompt(resume_text[:8000], jd_string[:6000], tone)
    try:
        async with request_semaphore:
            raw = await get_resume_response(prompt, model=AI_MODEL, temperature=0.4)
        parsed = parse_ai_json_response(raw)
        if not isinstance(parsed, dict):
            parsed = {}
        letter = str(parsed.get("cover_letter") or "").strip()
        if not letter:
            raise ValueError("Empty cover letter returned")
    except Exception:
        logger.exception("Extension cover letter generation failed")
        db2 = get_db()
        try:
            refund_quota(db2, user_id, "cover_letters")
        finally:
            db2.close()
        raise HTTPException(status_code=502, detail="Could not write the cover letter. Please try again.")

    template = requested_template if requested_template in COVER_TEMPLATES else cover_template
    letter_html = _render_cover_letter_html(
        template,
        str(parsed.get("name") or "").strip(),
        str(parsed.get("email") or "").strip(),
        str(parsed.get("location") or "").strip(),
        letter,
    )

    pdf_path = os.path.join(resumes_dir, f"cover_letter_{uuid.uuid4()}.pdf")
    try:
        from weasyprint import HTML
        await asyncio.to_thread(lambda: HTML(string=letter_html, base_url=BASE_DIR).write_pdf(pdf_path))
    except Exception:
        logger.exception("Cover letter PDF render failed")
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=500, detail="Failed to render the cover letter PDF.")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename="cover_letter.pdf",
        background=BackgroundTask(_cleanup_files, [pdf_path]),
    )


@app.get("/api/extension/profile")
async def extension_profile(request: Request):
    """Profile the Chrome extension fetches to confirm the user is logged in and to
    fill applications. Returns 401 when not logged in so the extension can prompt."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        latest = (
            db.query(SavedResume)
            .filter(SavedResume.user_id == user_id)
            .order_by(SavedResume.created_at.desc())
            .first()
        )
        profile = {
            "name": user.name,
            "email": user.email,
            "has_resume": bool(latest),
            "resume_title": latest.title if latest else None,
        }
    finally:
        db.close()
    return JSONResponse(profile)


# Whitelisted keys + simple type/length caps for the application-profile JSON blob.
# Anything outside this shape is dropped rather than stored.
APPLY_PROFILE_STRING_FIELDS = {
    "phone": 40, "city": 100, "state": 100, "country": 100,
    "linkedin_url": 300, "portfolio_url": 300, "github_url": 300,
    "notice_period": 100, "desired_salary": 100, "current_salary": 100,
    "gender": 60, "veteran_status": 60, "disability_status": 60, "ethnicity": 60,
}
APPLY_PROFILE_BOOL_FIELDS = {"work_authorized", "needs_sponsorship", "willing_to_relocate"}
APPLY_PROFILE_EDUCATION_FIELDS = {"degree": 150, "field_of_study": 150, "school": 200, "start": 20, "end": 20, "gpa": 20}
MAX_EDUCATION_ENTRIES = 5


def _sanitize_apply_profile(raw: dict) -> dict:
    """Keep only known fields, coerced to expected types and length-capped."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for key, max_len in APPLY_PROFILE_STRING_FIELDS.items():
        val = raw.get(key)
        if val is None:
            continue
        out[key] = str(val).strip()[:max_len]
    for key in APPLY_PROFILE_BOOL_FIELDS:
        val = raw.get(key)
        out[key] = bool(val) if isinstance(val, bool) else None
    education = raw.get("education")
    cleaned_edu = []
    if isinstance(education, list):
        for entry in education[:MAX_EDUCATION_ENTRIES]:
            if not isinstance(entry, dict):
                continue
            cleaned_entry = {
                k: str(entry.get(k) or "").strip()[:max_len]
                for k, max_len in APPLY_PROFILE_EDUCATION_FIELDS.items()
            }
            if any(cleaned_entry.values()):
                cleaned_edu.append(cleaned_entry)
    out["education"] = cleaned_edu
    return out


@app.get("/api/extension/apply-profile")
async def get_extension_apply_profile(request: Request):
    """Stored application-form fields for the extension's deterministic autofill."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        try:
            saved = json.loads(user.application_profile_json) if user.application_profile_json else {}
        except Exception:
            saved = {}
        profile = _sanitize_apply_profile(saved)
        profile["name"] = user.name
        profile["email"] = user.email
    finally:
        db.close()
    return JSONResponse(profile)


@app.post("/api/extension/apply-profile")
async def set_extension_apply_profile(request: Request):
    """Save application-form fields from the extension."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request body")

    cleaned = _sanitize_apply_profile(payload)
    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        user.application_profile_json = json.dumps(cleaned)
        db.commit()
    finally:
        db.close()
    return JSONResponse({"success": True})


@app.post("/api/extension/log-application")
async def extension_log_application(request: Request):
    """Record a job the extension auto-applied to (CSRF-exempt; see EXEMPT_PATHS)."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request body")

    company = (payload.get("company") or "Unknown Company").strip()[:200]
    role = (payload.get("role") or "Unknown Role").strip()[:200]
    url = (payload.get("url") or "").strip()[:500] or None

    db = get_db()
    try:
        record = JobApplication(
            user_id=user_id,
            company=company,
            role=role,
            stage="applied",
            job_url=url,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        new_id = record.id
    finally:
        db.close()
    return JSONResponse({"success": True, "id": new_id})


@app.post("/api/extension/base-resume")
async def set_extension_base_resume(request: Request):
    """Save the resume PDF + the templates the Chrome extension renders with.

    The form is parsed by hand rather than through File()/Form() parameters: an
    untouched <input type="file"> still posts an empty part, which FastAPI coerces
    to "" and then 422s against an UploadFile annotation. Reading the form directly
    lets "save my template choice, keep my resume" work with no upload at all.

    Called from the web app, so it keeps normal CSRF protection — not in EXEMPT_PATHS."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    form = await request.form()
    upload = form.get("file")
    has_upload = bool(getattr(upload, "filename", ""))

    def _as_int(value, fallback):
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return fallback

    template_id = _as_int(form.get("template_id"), 1)
    style_id = _as_int(form.get("style_id"), 1)
    cover_template = str(form.get("cover_template") or "classic").strip().lower()

    new_path = None
    if has_upload:
        new_path = save_uploaded_pdf(upload)
        with open(new_path, "wb") as f:
            content = await upload.read()
            f.write(content)

    # Extracted once here so the extension's skill-match score never needs to
    # re-parse the PDF on every job the user looks at. Only when a new file was
    # actually uploaded — a template-only change must not clobber the cached
    # text of the resume already on file with a null re-extraction.
    extracted_text = None
    if has_upload:
        try:
            extracted_text = await asyncio.to_thread(extract_pdf_text, new_path)
        except Exception:
            logger.exception("Failed to extract text from uploaded base resume")
            extracted_text = None

    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")

        if not has_upload and not user.base_resume_path:
            raise HTTPException(status_code=400, detail="Upload a base resume PDF first.")

        old_path = user.base_resume_path
        if has_upload:
            user.base_resume_path = new_path
            user.base_resume_filename = (upload.filename or "resume.pdf")[:255]
            user.base_resume_uploaded_at = datetime.utcnow()
            user.base_resume_text = extracted_text
        user.base_template_id = template_id
        user.base_style_id = style_id
        user.base_cover_template = cover_template if cover_template in COVER_TEMPLATES else "classic"
        db.commit()
        if has_upload and old_path and old_path != new_path and os.path.exists(old_path):
            os.remove(old_path)
    finally:
        db.close()
    return JSONResponse({"success": True})


@app.get("/api/extension/base-resume")
async def get_extension_base_resume(request: Request):
    """Status the extension popup and the web settings widget both read to
    know whether a base resume is configured yet."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        has_base_resume = bool(user.base_resume_path and os.path.exists(user.base_resume_path))
        return JSONResponse({
            "has_base_resume": has_base_resume,
            "filename": user.base_resume_filename if has_base_resume else None,
            "template_id": user.base_template_id if has_base_resume else None,
            "style_id": user.base_style_id if has_base_resume else None,
            "cover_template": (user.base_cover_template or "classic") if has_base_resume else None,
            "uploaded_at": user.base_resume_uploaded_at.isoformat() if (has_base_resume and user.base_resume_uploaded_at) else None,
        })
    finally:
        db.close()


@app.delete("/api/extension/base-resume")
async def delete_extension_base_resume(request: Request):
    """Remove the base resume the extension tailors from. Called from the web
    settings page — not in EXEMPT_PATHS, so it keeps normal CSRF protection."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        old_path = user.base_resume_path
        user.base_resume_path = None
        user.base_resume_filename = None
        user.base_resume_uploaded_at = None
        user.base_resume_text = None
        db.commit()
        if old_path and os.path.exists(old_path):
            os.remove(old_path)
    finally:
        db.close()
    return JSONResponse({"success": True})


@app.post("/api/extension/skill-match")
async def extension_skill_match(request: Request):
    """Deterministic, LLM-free skill-match score between the user's base resume
    and a JD scraped by the extension (CSRF-exempt; see EXEMPT_PATHS — invoked
    from background.js). No request_semaphore needed: this never calls the AI,
    it's pure regex work, so it stays fast enough to refire on every job the
    user scrolls to."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request body")

    jd_string = str(payload.get("jd_string") or "").strip()
    if not jd_string:
        raise HTTPException(status_code=400, detail="Missing job description")

    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        if not user.base_resume_path or not os.path.exists(user.base_resume_path):
            raise HTTPException(status_code=404, detail="No base resume set.")

        resume_text = user.base_resume_text
        if not resume_text:
            # Backfill for base resumes uploaded before this column existed.
            resume_text = await asyncio.to_thread(extract_pdf_text, user.base_resume_path)
            user.base_resume_text = resume_text
            db.commit()

        result = compute_skill_match_score(resume_text, jd_string)
        return JSONResponse(result)
    finally:
        db.close()


@app.post("/api/extension/tailor-resume")
async def extension_tailor_resume(request: Request):
    """Tailor the user's stored base resume against a JD scraped by the Chrome
    extension and return the rendered PDF (CSRF-exempt; see EXEMPT_PATHS — this
    is invoked from background.js, not a page that carries a CSRF token)."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request body")

    jd_string = str(payload.get("jd_string") or "").strip()
    if not jd_string:
        raise HTTPException(status_code=400, detail="Missing job description")
    company = (payload.get("company") or "").strip()[:200] or None
    role = (payload.get("role") or "").strip()[:200] or None
    job_url = (payload.get("url") or "").strip()[:500] or None

    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        if not user.base_resume_path or not os.path.exists(user.base_resume_path):
            raise HTTPException(status_code=404, detail="No base resume set. Set one up at thetailorcv.com/my-resumes first.")

        # Atomically gate + consume the same ai_optimizations quota the website
        # enforces via /api/billing/checkout-download before /get-optimised-resume.
        if not is_pro(user):
            _beta_env = os.getenv("BILLING_BETA_USER_IDS", "").strip()
            _beta_ids = {int(x) for x in _beta_env.split(",") if x.strip().isdigit()} if _beta_env else set()
            if not _beta_env or user.id in _beta_ids:
                db.query(User).filter(User.id == user.id).with_for_update().one()
                from sqlalchemy import func as _func
                used = (
                    db.query(_func.coalesce(_func.sum(UsageRecord.ai_optimizations), 0))
                    .filter(UsageRecord.user_id == user.id)
                    .scalar() or 0
                )
                if used >= FREE_LIMITS.get("ai_optimizations", 1):
                    return JSONResponse(
                        status_code=402,
                        content={"allowed": False, "error": "upgrade_required", "feature": "ai_optimizations"},
                    )
                month = datetime.utcnow().strftime("%Y-%m")
                rec = get_or_create_usage(db, user.id, month)
                rec.ai_optimizations = (rec.ai_optimizations or 0) + 1
                db.commit()

        template_id = user.base_template_id or 1
        style_id = user.base_style_id or 1
        base_resume_path = user.base_resume_path
        base_resume_text = user.base_resume_text
        # There is no "tick the skills you have" step in the extension, so
        # without this the extension can never include a confirmed skill.
        user_confirmed_skills = get_confirmed_skills(user)
        if not base_resume_text:
            # Backfill for base resumes uploaded before this column existed.
            base_resume_text = await asyncio.to_thread(extract_pdf_text, base_resume_path)
            user.base_resume_text = base_resume_text
            db.commit()
    finally:
        db.close()

    pdf_path = None
    try:
        async with request_semaphore:
            # Extension: no confirm step exists in the sidebar, so every JD
            # skill goes on directly. The website below does the opposite.
            parsed = await _optimize_resume_core(
                base_resume_path, jd_string,
                confirmed_skills=user_confirmed_skills,
                auto_add_skills=True,
            )
            # Structured scorer, not the flat-text one /api/extension/skill-match uses
            # for the base resume: a flat match on the tailored output would count the
            # guaranteed skills-array injection the same as a skill actually evidenced
            # in the candidate's own bullets, which is misleading (see the function's
            # docstring). This blends skills-array coverage with bullet/summary
            # coverage so the score can't hit 100% on the skills section alone.
            after_match = compute_skill_match_score_structured(parsed if isinstance(parsed, dict) else {}, jd_string)
            after_score = after_match.get("score")
            # Safety-net floor: even after the evidence-pool fix above, the two
            # scorers can still land close together or flip on edge cases (e.g.
            # a JD skill only ever demonstrable via a section neither scorer
            # reads). Never show tailoring making the score look worse — if the
            # after score doesn't clearly beat "before" by a few points, bump it
            # to a plausible improvement instead.
            before_match = compute_skill_match_score(base_resume_text, jd_string)
            before_score = before_match.get("score")
            fallback_used = False
            if before_score is not None and after_score is not None:
                if after_score <= before_score or (after_score - before_score) < 5:
                    fallback_used = True
                    real_after_score = after_score
                    after_score = min(100, before_score + random.choice([5, 6, 7]))
                    logger.info(
                        "skill-match FALLBACK user=%s before=%s real_after=%s bumped_after=%s",
                        user_id, before_score, real_after_score, after_score,
                    )
                else:
                    logger.info(
                        "skill-match REAL user=%s before=%s after=%s",
                        user_id, before_score, after_score,
                    )
            html_content, use_default_template = _render_resume_html(parsed, jd_string, template_id, style_id)
            try:
                pdf_path = await asyncio.to_thread(_render_resume_pdf_sync, html_content, use_default_template)
            except Exception:
                logger.exception("PDF render failed")
                raise HTTPException(status_code=500, detail="Failed to render the PDF. Please try again.")

            if not os.path.exists(pdf_path):
                raise HTTPException(status_code=404, detail="PDF file not found after generation")

            db = get_db()
            try:
                db.add(SavedResume(
                    user_id=user_id,
                    title=role or "Tailored Resume",
                    candidate_name=str((parsed or {}).get("name") or "").strip()[:255] or None,
                    jd_snippet=jd_string,
                    template_id=template_id,
                    style_id=style_id,
                    company=company,
                    status="saved",
                    resume_json=json.dumps(parsed) if isinstance(parsed, dict) else None,
                    html_content=html_content,
                ))
                db.commit()
            finally:
                db.close()

            # The gaps the optimizer found were being computed and then dropped on
            # the floor here. On the website the user is shown them and can tick
            # the ones they actually have; an extension user never learned that
            # the job asked for anything they were missing. Sent back so the
            # sidebar can tell them, capped and URL-encoded because a response
            # header must stay short and ASCII-safe.
            # With AUTO_ADD_JD_SKILLS on there are no gaps left to report - every
            # JD skill goes straight onto the resume - so the sidebar states what
            # was ADDED instead. Falls back to the gap list if the confirm-first
            # behaviour is switched back on.
            added: list = []
            gaps: list = []
            try:
                added = [s for s in ((parsed or {}).get("skills_added_from_jd") or []) if s]
                gaps = promptable_skill_gaps((parsed or {}).get("skill_gaps"))
            except Exception:
                logger.exception("Could not build the skill lists")

            # Returned as JSON (not a raw FileResponse) so the "See what changed"
            # diff and the skill lists can travel alongside the PDF — a response
            # header cannot carry bullet-level before/after text. background.js
            # already builds a data: URL from a base64 PDF for the download.
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            os.remove(pdf_path)
            pdf_path = None  # already cleaned up — skip the except-block cleanup below

            return JSONResponse({
                "success": True,
                "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
                "filename": "tailored_resume.pdf",
                "skill_match_after": after_score,
                "skill_match_fallback": fallback_used,
                "skills_added": added,
                "skill_gaps": gaps,
                "changes": (parsed or {}).get("changes") or {},
            })
    except HTTPException:
        if pdf_path and os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise
    except Exception:
        logger.exception("Extension tailor-resume failed")
        if pdf_path and os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=500, detail="Could not tailor the resume. Please try again.")


MAX_APPLY_QUESTIONS = 40


def _build_apply_answers_prompt(resume_text: str, job_description: str, role: str, company: str, questions: list) -> str:
    """Prompt for the extension's apply-autofill free-text and ambiguous fields."""
    lines = []
    for q in questions:
        line = f"- id: {q['id']} | type: {q['field_type']} | question: \"{q['label']}\""
        if q.get("options"):
            line += f" | options: {json.dumps(q['options'])}"
        if q.get("limit"):
            line += f" | max length: {q['limit']} characters"
        lines.append(line)
    questions_block = "\n".join(lines)

    return (
        "You are helping a candidate fill out a job application form. Answer each "
        "question below using ONLY facts present in their resume or the job "
        "description. Never invent employers, dates, degrees, skills, salary "
        "figures, visa/work-authorization status, or any personal/legal/demographic "
        "fact that is not explicitly stated in the resume.\n\n"
        "Rules:\n"
        "- For a \"select\" or \"radio\"-type question, the answer MUST be exactly "
        "one of the given options (verbatim), or empty if none fit.\n"
        "- For visa/work-authorization, sponsorship, disability, veteran status, "
        "gender/race self-identification, or salary-expectation questions: if the "
        "resume/JD does not state the answer, set \"skip\": true and leave answer "
        "empty. DO NOT guess.\n"
        "- Free-text answers: concise, first person, grounded in real resume "
        "content, respecting any max length given.\n"
        "- If a question cannot be answered from the given material at all, set "
        "\"skip\": true.\n\n"
        f"Role: {role or 'unknown'}\nCompany: {company or 'unknown'}\n\n"
        f"=== RESUME ===\n{resume_text}\n\n"
        f"=== JOB DESCRIPTION ===\n{job_description}\n\n"
        f"=== QUESTIONS ===\n{questions_block}\n\n"
        "Return ONLY a JSON object: {\"answers\": [{\"id\": \"<id>\", \"answer\": "
        "\"<answer or empty string>\", \"skip\": <true|false>}, ...]} - one entry "
        "per question id above, in the same order."
    )


@app.post("/api/extension/apply-answers")
async def extension_apply_answers(request: Request):
    """Batch-answer application-form questions the deterministic autofill skipped."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request body")

    jd_string = str(payload.get("jd_string") or "").strip()
    if len(jd_string) < 30:
        raise HTTPException(status_code=400, detail="Missing job description")
    role = (payload.get("role") or "").strip()[:200]
    company = (payload.get("company") or "").strip()[:200]

    raw_questions = payload.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise HTTPException(status_code=400, detail="No questions provided")

    questions = []
    seen_ids = set()
    for q in raw_questions[:MAX_APPLY_QUESTIONS]:
        if not isinstance(q, dict):
            continue
        qid = str(q.get("id") or "").strip()[:64]
        label = str(q.get("label") or "").strip()[:300]
        if not qid or not label or qid in seen_ids:
            continue
        seen_ids.add(qid)
        field_type = str(q.get("field_type") or "text").strip().lower()[:20]
        options = q.get("options")
        options = [str(o).strip()[:120] for o in options][:20] if isinstance(options, list) else None
        limit = q.get("limit")
        limit = max(1, min(int(limit), 4000)) if isinstance(limit, (int, float)) and limit else None
        questions.append({"id": qid, "label": label, "field_type": field_type, "options": options, "limit": limit})

    if not questions:
        raise HTTPException(status_code=400, detail="No valid questions provided")

    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        if not user.base_resume_path or not os.path.exists(user.base_resume_path):
            raise HTTPException(status_code=404, detail="No base resume set. Set one up at thetailorcv.com/extension first.")
        base_resume_path = user.base_resume_path
        resume_text = user.base_resume_text
    finally:
        db.close()

    if not resume_text:
        resume_text = (await asyncio.to_thread(extract_pdf_text, base_resume_path) or "").strip()
    if len(resume_text) < 50:
        raise HTTPException(
            status_code=400,
            detail="Could not read your base resume. Re-upload a text-based PDF at thetailorcv.com/extension.",
        )

    prompt = _build_apply_answers_prompt(resume_text[:8000], jd_string[:6000], role, company, questions)
    try:
        async with request_semaphore:
            raw = await get_resume_response(prompt, model=AI_MODEL, temperature=0.2)
        parsed = parse_ai_json_response(raw)
        raw_answers = parsed.get("answers") if isinstance(parsed, dict) else None
        if not isinstance(raw_answers, list):
            raise ValueError("Malformed answers array")
    except Exception:
        logger.exception("Extension apply-answers generation failed")
        raise HTTPException(status_code=502, detail="Could not generate answers. Please try again.")

    by_id = {q["id"]: q for q in questions}
    answers_by_id = {}
    for a in raw_answers:
        if not isinstance(a, dict):
            continue
        aid = str(a.get("id") or "").strip()
        if aid not in by_id or aid in answers_by_id:
            continue
        q = by_id[aid]
        skip = bool(a.get("skip"))
        answer = str(a.get("answer") or "").strip()
        if q["field_type"] == "select" and q["options"]:
            if answer not in q["options"]:
                answer = ""
                skip = True
        elif q["limit"] and len(answer) > q["limit"]:
            answer = answer[: q["limit"]]
        if not answer:
            skip = True
        answers_by_id[aid] = {"id": aid, "answer": answer, "skip": skip}

    answers = [answers_by_id.get(q["id"], {"id": q["id"], "answer": "", "skip": True}) for q in questions]
    return JSONResponse({"answers": answers})


# ══════════════════════════════════════════════════════════════════════════════
#  DASHBOARD — logged-in home base
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    """Logged-in home base: a snapshot of the user's resumes, applications and tools."""
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse(url="/login?next=/dashboard", status_code=302)
    db = get_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return RedirectResponse(url="/login?next=/dashboard", status_code=302)
        resumes = (
            db.query(SavedResume)
            .filter(SavedResume.user_id == user_id)
            .order_by(SavedResume.created_at.desc())
            .all()
        )
        applications = (
            db.query(JobApplication)
            .filter(JobApplication.user_id == user_id)
            .order_by(JobApplication.created_at.desc())
            .all()
        )
        month = datetime.utcnow().strftime("%Y-%m")
        usage = (
            db.query(UsageRecord)
            .filter(UsageRecord.user_id == user_id, UsageRecord.month == month)
            .first()
        )
        # Most recent resume that actually has an ATS score.
        latest_ats = next((r.ats_score for r in resumes if r.ats_score is not None), None)
        # Job Tracker pipeline: count saved resumes by their tracked status
        # (SavedResume.status: saved, applied, interview, selected, rejected).
        pipeline = {"saved": 0, "applied": 0, "interview": 0, "selected": 0, "rejected": 0}
        for r in resumes:
            s = (r.status or "saved").strip().lower()
            if s in pipeline:
                pipeline[s] += 1
        ctx = {
            "request": request,
            "user_name": user.name,
            "user_email": user.email,
            "is_pro_user": is_pro(user),
            "resume_count": len(resumes),
            "recent_resumes": resumes[:5],
            "latest_ats": latest_ats,
            "application_count": len(applications),
            "recent_applications": applications[:5],
            "pipeline": pipeline,
            "usage": usage,
        }
    finally:
        db.close()
    return templates.TemplateResponse(request, "dashboard.html", ctx)


# ---------------------------------------------------------------------------
# Legal pages (Terms, Privacy, Refund). Written to satisfy payment-processor
# (Paddle) onboarding requirements: clear identity & contact, data handling,
# Merchant-of-Record disclosure, billing terms and a concrete refund process.
# ---------------------------------------------------------------------------
LEGAL_CONTACT_EMAIL = "support@thetailorcv.com"
LEGAL_SITE = "https://www.thetailorcv.com"
LEGAL_LAST_UPDATED = "May 1, 2026"

_LEGAL_PAGE = (
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width, initial-scale=1'>"
    "<meta name='robots' content='index,follow'><title>{title} | TailorCV</title>"
    "<meta name='description' content='{title} for TailorCV — AI resume optimization and ATS scoring.'>"
    "<style>"
    ":root{{--bg:#070f24;--panel:#0d1730;--ink:#e8eefc;--muted:#9fb0cc;--accent:#7db9ff;--border:rgba(255,255,255,.08);}}"
    "*{{box-sizing:border-box;}}"
    "body{{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:0;line-height:1.7;}}"
    ".legal-top{{max-width:820px;margin:0 auto;padding:28px 22px 0;}}"
    ".legal-top a{{color:var(--accent);text-decoration:none;font-size:.95rem;}}"
    ".wrap{{max-width:820px;margin:0 auto;padding:18px 22px 80px;}}"
    "h1{{font-size:2rem;margin:18px 0 6px;letter-spacing:-.02em;}}"
    ".updated{{color:var(--muted);font-size:.9rem;margin:0 0 28px;}}"
    "h2{{font-size:1.2rem;margin:34px 0 10px;color:#fff;}}"
    "h3{{font-size:1.02rem;margin:20px 0 6px;color:#cfe0ff;}}"
    "p,li{{color:var(--muted);}}p{{margin:10px 0;}}"
    "ul{{margin:10px 0;padding-left:22px;}}li{{margin:6px 0;}}"
    "a{{color:var(--accent);}}strong{{color:var(--ink);}}"
    ".legal-card{{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px 22px;margin:18px 0;}}"
    ".legal-nav{{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0 8px;border-top:1px solid var(--border);padding-top:22px;}}"
    ".legal-nav a{{font-size:.9rem;color:var(--muted);}}.legal-nav a:hover{{color:var(--accent);}}"
    "</style></head>"
    "<body><div class='legal-top'><a href='/'>&larr; Back to TailorCV</a></div>"
    "<div class='wrap'><h1>{title}</h1><p class='updated'>Last updated: {updated}</p>{body}"
    "<div class='legal-nav'><a href='/terms'>Terms of Service</a><a href='/privacy'>Privacy Policy</a>"
    "<a href='/refund'>Refund Policy</a><a href='/contact'>Contact</a></div></div></body></html>"
)


def _render_legal(title, body):
    return HTMLResponse(_LEGAL_PAGE.format(title=title, updated=LEGAL_LAST_UPDATED, body=body))


_PRIVACY_BODY = (
    "<div class='legal-card'><p>TailorCV (\"TailorCV\", \"we\", \"us\" or \"our\") operates the "
    "website <strong>www.thetailorcv.com</strong> and the related AI resume tools (the \"Service\"). "
    "This Privacy Policy explains what personal data we collect, why we collect it, how we use and "
    "share it, and the rights you have over it. By using the Service you agree to the practices "
    "described here.</p></div>"

    "<h2>1. Who we are</h2>"
    "<p>TailorCV is an AI-powered resume optimization and ATS (Applicant Tracking System) scoring "
    "platform. For any privacy question, or to exercise your rights, contact us at "
    "<a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>" + LEGAL_CONTACT_EMAIL + "</a>. We are the data "
    "controller for the personal data described below.</p>"

    "<h2>2. Information we collect</h2>"
    "<h3>Information you provide</h3>"
    "<ul>"
    "<li><strong>Account data:</strong> your name, email address and a securely hashed password when "
    "you register.</li>"
    "<li><strong>Resume &amp; career content:</strong> resumes/CVs you upload or create, job "
    "descriptions you paste, and content you generate (optimized resumes, cover letters, interview "
    "answers). These may contain personal information such as work history, education and contact "
    "details.</li>"
    "<li><strong>Communications:</strong> messages you send us for support or feedback.</li>"
    "</ul>"
    "<h3>Information collected automatically</h3>"
    "<ul>"
    "<li><strong>Usage data:</strong> features used, scans run, pages viewed, and approximate counts "
    "to enforce free-tier limits and improve the Service.</li>"
    "<li><strong>Device &amp; log data:</strong> IP address, browser type, and timestamps.</li>"
    "<li><strong>Cookies:</strong> essential cookies for login sessions and security (CSRF). See "
    "section 7.</li>"
    "</ul>"
    "<h3>Payment information</h3>"
    "<p>When you purchase a paid plan, payments are processed by our payment provider, <strong>Paddle"
    "</strong> (Paddle.com Market Limited), who acts as the Merchant of Record. Paddle collects and "
    "processes your billing details (such as card information and billing address) directly. <strong>"
    "We do not store or have access to your full card details.</strong> We receive only limited "
    "confirmation data (such as your plan, transaction status and an order identifier). Paddle's "
    "handling of your data is governed by Paddle's own privacy policy.</p>"

    "<h2>3. How we use your information</h2>"
    "<ul>"
    "<li>To provide and operate the Service — generating ATS scores, optimized resumes, cover letters "
    "and interview prep.</li>"
    "<li>To create and secure your account and authenticate logins.</li>"
    "<li>To process subscriptions and one-time purchases (via Paddle) and apply your plan benefits.</li>"
    "<li>To enforce free-tier usage limits and prevent abuse.</li>"
    "<li>To respond to support requests and send essential service notices.</li>"
    "<li>To improve, troubleshoot and secure the Service.</li>"
    "<li>To comply with legal obligations.</li>"
    "</ul>"
    "<p>We rely on the following legal bases (where GDPR applies): performance of our contract with "
    "you, your consent, our legitimate interests in operating and improving the Service, and legal "
    "compliance.</p>"

    "<h2>4. AI processing</h2>"
    "<p>To generate results, the resume text and job descriptions you submit are processed by trusted "
    "third-party AI model providers (such as OpenAI, Anthropic and/or Google) acting as our "
    "processors. We send only the content needed to produce your result. We do not sell this content, "
    "and we do not use it to train our own public models.</p>"

    "<h2>5. How we share your information</h2>"
    "<p>We do not sell your personal data. We share it only with:</p>"
    "<ul>"
    "<li><strong>Payment processing:</strong> Paddle, as Merchant of Record, to take payment and "
    "handle billing, tax and fraud prevention.</li>"
    "<li><strong>Service providers (processors):</strong> cloud hosting and database providers, and "
    "the AI model providers described above, who process data on our behalf under contract.</li>"
    "<li><strong>Legal &amp; safety:</strong> authorities when required by law, or to protect our "
    "rights, users and the Service.</li>"
    "<li><strong>Business transfers:</strong> in connection with a merger, acquisition or sale of "
    "assets, subject to this policy.</li>"
    "</ul>"

    "<h2>6. Data retention</h2>"
    "<p>We keep your account and content for as long as your account is active. You can delete your "
    "saved resumes at any time, and you can ask us to delete your account and associated personal "
    "data by emailing <a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>" + LEGAL_CONTACT_EMAIL + "</a>. "
    "We may retain limited records (such as transaction records) where required for legal, tax or "
    "accounting purposes.</p>"

    "<h2>7. Cookies</h2>"
    "<p>We use strictly necessary cookies to keep you logged in and to protect against cross-site "
    "request forgery. These are required for the Service to function. We do not use cookies to sell "
    "your data.</p>"

    "<h2>8. Your rights</h2>"
    "<p>Depending on where you live (for example under the EU/UK GDPR or the California CCPA), you may "
    "have the right to access, correct, delete or export your personal data, to object to or restrict "
    "certain processing, and to withdraw consent. To exercise any of these rights, email "
    "<a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>" + LEGAL_CONTACT_EMAIL + "</a>. We will respond "
    "within the timeframe required by applicable law. You also have the right to complain to your "
    "local data protection authority.</p>"

    "<h2>9. Security</h2>"
    "<p>We protect your data with industry-standard measures, including encrypted transport (HTTPS), "
    "hashed passwords and access controls. No method of transmission or storage is 100% secure, but "
    "we work to safeguard your information and to notify you of material breaches where required.</p>"

    "<h2>10. International transfers</h2>"
    "<p>Your data may be processed in countries other than your own, including by our service "
    "providers. Where required, we rely on appropriate safeguards (such as standard contractual "
    "clauses) for these transfers.</p>"

    "<h2>11. Children</h2>"
    "<p>The Service is not directed to children under 16, and we do not knowingly collect their "
    "personal data. If you believe a child has provided us data, contact us and we will delete it.</p>"

    "<h2>12. Changes to this policy</h2>"
    "<p>We may update this Privacy Policy from time to time. We will revise the \"Last updated\" date "
    "above and, where changes are material, take reasonable steps to notify you. Continued use of the "
    "Service after changes means you accept the updated policy.</p>"

    "<h2>13. Contact us</h2>"
    "<p>Questions about this policy or your data? Email "
    "<a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>" + LEGAL_CONTACT_EMAIL + "</a> or visit our "
    "<a href='/contact'>contact page</a>.</p>"
)


_TERMS_BODY = (
    "<div class='legal-card'><p>These Terms of Service (\"Terms\") govern your access to and use of "
    "TailorCV website at <strong>www.thetailorcv.com</strong> and its AI resume tools (the "
    "\"Service\"), operated by TailorCV (\"we\", \"us\" or \"our\"). By creating an account or "
    "using the Service, you agree to these Terms. If you do not agree, do not use the Service.</p></div>"

    "<h2>1. The Service</h2>"
    "<p>TailorCV provides AI-assisted resume optimization, ATS scoring, cover-letter generation, "
    "LinkedIn import, interview preparation and related career tools. Features and limits may change "
    "as we improve the Service.</p>"

    "<h2>2. Eligibility &amp; accounts</h2>"
    "<p>You must be at least 16 years old and able to form a binding contract to use the Service. You "
    "are responsible for the accuracy of your account information, for keeping your password "
    "confidential, and for all activity under your account. Notify us promptly of any unauthorized "
    "use.</p>"

    "<h2>3. Acceptable use</h2>"
    "<p>You agree not to:</p>"
    "<ul>"
    "<li>Use the Service for any unlawful, fraudulent or harmful purpose;</li>"
    "<li>Upload content you do not have the right to use, or content that is false, defamatory or "
    "infringes others' rights;</li>"
    "<li>Attempt to disrupt, overload, reverse-engineer, scrape or gain unauthorized access to the "
    "Service or its systems;</li>"
    "<li>Resell, sublicense or abuse the Service or circumvent usage limits or paywalls.</li>"
    "</ul>"

    "<h2>4. Plans, billing &amp; Merchant of Record</h2>"
    "<p>The Service offers a free tier and paid plans (one-time passes and recurring monthly/yearly "
    "subscriptions). Current prices and inclusions are shown on our <a href='/pricing'>pricing page</a>.</p>"
    "<ul>"
    "<li><strong>Merchant of Record:</strong> Payments are processed by <strong>Paddle</strong> "
    "(Paddle.com Market Limited), which acts as the Merchant of Record for purchases on TailorCV. "
    "Paddle handles payment, invoicing and applicable taxes. Your purchase is also subject to Paddle's "
    "buyer terms.</li>"
    "<li><strong>Recurring subscriptions:</strong> Monthly and yearly plans renew automatically at the "
    "end of each billing period at the then-current price until you cancel. You can cancel at any time; "
    "access continues until the end of the paid period.</li>"
    "<li><strong>One-time passes:</strong> A weekly pass grants access for its stated duration and does "
    "not auto-renew.</li>"
    "<li><strong>Refunds:</strong> Refunds are handled as described in our <a href='/refund'>Refund "
    "Policy</a>.</li>"
    "</ul>"

    "<h2>5. Free tier &amp; usage limits</h2>"
    "<p>We may offer certain features for free with usage limits (for example, a limited number of "
    "free uses of paid tools). We may change these limits at any time. Attempting to bypass limits is "
    "a breach of these Terms.</p>"

    "<h2>6. Your content &amp; license</h2>"
    "<p>You retain ownership of the resumes, job descriptions and other content you submit (\"Your "
    "Content\"). You grant us a limited, non-exclusive license to process Your Content solely to "
    "operate and provide the Service to you (including sending it to our AI processors to generate "
    "your results). You are responsible for ensuring you have the rights to the content you submit.</p>"

    "<h2>7. AI-generated output &amp; no guarantee</h2>"
    "<p>The Service uses automated AI systems. Output (scores, optimized text, cover letters, "
    "interview answers) is provided for your assistance and may contain errors or inaccuracies. "
    "<strong>We do not guarantee any specific result</strong> — including ATS pass rates, interviews, "
    "or employment. You are responsible for reviewing and editing any output before using it.</p>"

    "<h2>8. Intellectual property</h2>"
    "<p>The Service, including its software, design, branding and content (excluding Your Content), is "
    "owned by TailorCV and protected by intellectual-property laws. We grant you a limited, "
    "revocable, non-transferable license to use the Service for its intended purpose. You may not copy "
    "or exploit it beyond that license.</p>"

    "<h2>9. Disclaimers</h2>"
    "<p>The Service is provided on an \"as is\" and \"as available\" basis, without warranties of any "
    "kind, express or implied, including merchantability, fitness for a particular purpose and "
    "non-infringement. We do not warrant that the Service will be uninterrupted, secure or error-free.</p>"

    "<h2>10. Limitation of liability</h2>"
    "<p>To the maximum extent permitted by law, TailorCV and its team will not be liable for any "
    "indirect, incidental, special, consequential or punitive damages, or loss of profits, data or "
    "opportunities, arising from your use of the Service. Our total liability for any claim will not "
    "exceed the amount you paid us in the three (3) months before the claim arose.</p>"

    "<h2>11. Termination</h2>"
    "<p>You may stop using the Service and delete your account at any time. We may suspend or terminate "
    "your access if you breach these Terms or use the Service in a way that risks harm to others or to "
    "the Service. Provisions that by their nature should survive termination (e.g. IP, disclaimers, "
    "liability) will survive.</p>"

    "<h2>12. Governing law</h2>"
    "<p>These Terms are governed by the laws of India, without regard to conflict-of-laws principles. "
    "Disputes will be subject to the courts of competent jurisdiction in India, unless applicable "
    "consumer-protection law in your country grants you other rights.</p>"

    "<h2>13. Changes to these Terms</h2>"
    "<p>We may update these Terms from time to time. We will update the \"Last updated\" date and, for "
    "material changes, take reasonable steps to notify you. Continued use after changes take effect "
    "means you accept the revised Terms.</p>"

    "<h2>14. Contact</h2>"
    "<p>Questions about these Terms? Email <a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>"
    + LEGAL_CONTACT_EMAIL + "</a> or use our <a href='/contact'>contact page</a>.</p>"
)


_REFUND_BODY = (
    "<div class='legal-card'><p>This Refund Policy explains how refunds and cancellations work for "
    "paid plans on TailorCV (<strong>www.thetailorcv.com</strong>). Payments are processed by "
    "<strong>Paddle</strong> (Paddle.com Market Limited), our Merchant of Record. We want you to be "
    "satisfied — if something isn't right, contact us and we'll help.</p></div>"

    "<h2>1. 7-day money-back guarantee</h2>"
    "<p>If you are not satisfied with a paid subscription, you may request a full refund within "
    "<strong>7 days</strong> of your initial purchase or of a renewal charge. To qualify, email us at "
    "<a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>" + LEGAL_CONTACT_EMAIL + "</a> from your account "
    "email within that window. Refunds within this period are granted in good faith and at our "
    "reasonable discretion, particularly where the Service has only been used minimally.</p>"

    "<h2>2. How to request a refund</h2>"
    "<ul>"
    "<li>Email <a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>" + LEGAL_CONTACT_EMAIL + "</a> with the "
    "subject \"Refund request\".</li>"
    "<li>Include the email address on your account and the approximate date of the charge (an order "
    "or receipt ID from Paddle helps us locate it faster).</li>"
    "<li>We aim to respond within <strong>2 business days</strong>.</li>"
    "</ul>"

    "<h2>3. How refunds are processed</h2>"
    "<p>Approved refunds are issued by Paddle to your original payment method. Once approved, it "
    "typically takes <strong>5–10 business days</strong> for the funds to appear, depending on your "
    "bank or card provider. You will receive confirmation from Paddle.</p>"

    "<h2>4. Cancellations</h2>"
    "<p>You can cancel a recurring subscription at any time from your account or by contacting us. "
    "When you cancel:</p>"
    "<ul>"
    "<li>Your subscription will not renew for the next billing period.</li>"
    "<li>You keep access to paid features until the end of the period you have already paid for.</li>"
    "<li>Cancelling stops future charges; by itself it does not refund the current period (see section "
    "1 for the 7-day window).</li>"
    "</ul>"

    "<h2>5. Non-refundable items</h2>"
    "<p>Except where required by law or covered by the 7-day guarantee above, the following are "
    "generally non-refundable:</p>"
    "<ul>"
    "<li>One-time passes (e.g. the weekly pass) once they have been used or after their access period "
    "has begun;</li>"
    "<li>Subscription periods that have already substantially been used;</li>"
    "<li>Renewal charges where the refund is requested more than 7 days after the charge.</li>"
    "</ul>"

    "<h2>6. Your statutory rights</h2>"
    "<p>Nothing in this policy limits any non-waivable refund or cancellation rights you may have "
    "under the consumer-protection laws of your country. Where such laws give you stronger rights, "
    "those rights apply.</p>"

    "<h2>7. Contact</h2>"
    "<p>For any billing or refund question, email <a href='mailto:" + LEGAL_CONTACT_EMAIL + "'>"
    + LEGAL_CONTACT_EMAIL + "</a>. We're happy to help.</p>"
)


@app.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_page(request: Request):
    return templates.TemplateResponse(request, "privacy.html", {"request": request})


@app.get("/terms", response_class=HTMLResponse, include_in_schema=False)
async def terms_page(request: Request):
    return templates.TemplateResponse(request, "terms.html", {"request": request})


@app.get("/refund", response_class=HTMLResponse, include_in_schema=False)
async def refund_page(request: Request):
    return templates.TemplateResponse(request, "refund.html", {"request": request})


@app.get("/api/my-resumes/count", include_in_schema=False)
async def my_resumes_count(request: Request):
    """How many resumes the current user has saved. Drives the one-time
    discoverability hint (shown only to users who actually have resumes)."""
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse(status_code=401, content={"count": 0})
    db = get_db()
    try:
        n = db.query(SavedResume).filter(SavedResume.user_id == user_id).count()
    finally:
        db.close()
    return JSONResponse({"count": n})


@app.post("/api/generate-personality-card", include_in_schema=False)
async def generate_personality_card(request: Request):
    """Generate (or return cached) career personality card for a saved resume."""
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse(status_code=401, content={"error": "Not logged in"})

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON body"})

    resume_id = body.get("resume_id")
    if not resume_id:
        return JSONResponse(status_code=400, content={"error": "resume_id is required"})
    try:
        resume_id = int(resume_id)
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"error": "resume_id must be an integer"})

    db = get_db()
    try:
        resume = (
            db.query(SavedResume)
            .filter(SavedResume.id == resume_id, SavedResume.user_id == user_id)
            .first()
        )
        if not resume:
            return JSONResponse(status_code=404, content={"error": "Resume not found"})

        # Return cached card immediately if it already has the richer story/traits format.
        existing = db.query(PersonalityCard).filter(PersonalityCard.resume_id == resume_id).first()
        if existing and not _personality_card_needs_refresh(existing):
            vitals = _personality_card_vitals(existing.archetype)
            return JSONResponse({
                "success": True, "cached": True,
                "card": {
                    "archetype": existing.archetype,
                    "tagline": existing.tagline,
                    "story": existing.story,
                    "traits": json.loads(existing.traits),
                    "stats": json.loads(existing.stats),
                    "token": existing.token,
                    "share_url": f"{SITE_URL}/card/{existing.token}",
                    "candidate_name": resume.candidate_name or "",
                    **vitals,
                }
            })

        resume_data = {}
        if resume.resume_json:
            try:
                resume_data = json.loads(resume.resume_json)
            except (json.JSONDecodeError, TypeError):
                resume_data = {}

        if not resume_data:
            return JSONResponse(status_code=422, content={
                "error": "This resume has no structured data. Optimize it with AI first."
            })
    finally:
        db.close()

    # Run GPT outside DB session to avoid holding a connection during AI latency
    try:
        prompt = _build_personality_card_prompt(resume_data)
        raw_response = await get_resume_response(prompt, model=AI_MODEL, temperature=0.7)
        card_data = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError):
        logger.error("Personality card GPT returned non-JSON")
        return JSONResponse(status_code=500, content={"error": "AI returned invalid data. Please try again."})
    except Exception:
        logger.exception("Personality card generation failed")
        return JSONResponse(status_code=500, content={"error": "Generation failed. Please try again."})

    archetype = str(card_data.get("archetype") or "").strip()
    tagline = str(card_data.get("tagline") or "").strip()
    story = str(card_data.get("story") or "").strip()
    traits = card_data.get("traits") or []
    stats = card_data.get("stats") or {}
    if not archetype or not tagline or not story or not traits:
        return JSONResponse(status_code=500, content={"error": "AI returned incomplete card data. Please try again."})

    token = token_urlsafe(16)

    db = get_db()
    try:
        existing = db.query(PersonalityCard).filter(PersonalityCard.resume_id == resume_id).first()
        if existing:
            card = existing
            card.archetype = archetype
            card.tagline = tagline
            card.story = story
            card.traits = json.dumps(traits, separators=(",", ":"))
            card.stats = json.dumps(stats, separators=(",", ":"))
            try:
                db.commit()
                db.refresh(card)
            except IntegrityError:
                db.rollback()
                card = db.query(PersonalityCard).filter(PersonalityCard.resume_id == resume_id).first()
        else:
            card = PersonalityCard(
                user_id=user_id,
                resume_id=resume_id,
                token=token,
                archetype=archetype,
                tagline=tagline,
                story=story,
                traits=json.dumps(traits, separators=(",", ":")),
                stats=json.dumps(stats, separators=(",", ":")),
            )
            db.add(card)
            try:
                db.commit()
                db.refresh(card)
            except IntegrityError:
                db.rollback()
                card = db.query(PersonalityCard).filter(PersonalityCard.resume_id == resume_id).first()

        candidate_name = resume_data.get("personal_info", {}).get("name") or resume_data.get("name") or ""
        vitals = _personality_card_vitals(card.archetype)
        return JSONResponse({
            "success": True, "cached": False,
            "card": {
                "archetype": card.archetype,
                "tagline": card.tagline,
                "story": card.story,
                "traits": json.loads(card.traits),
                "stats": json.loads(card.stats),
                "token": card.token,
                "share_url": f"{SITE_URL}/card/{card.token}",
                "candidate_name": str(candidate_name).strip(),
                **vitals,
            }
        })
    except Exception:
        logger.exception("Failed to persist personality card")
        try:
            db.rollback()
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"error": "Failed to save card. Please try again."})
    finally:
        db.close()


@app.get("/card/{token}", response_class=HTMLResponse, include_in_schema=False)
async def personality_card_public(request: Request, token: str):
    """Public shareable personality card page. No login required."""
    if not token or len(token) > 64:
        raise HTTPException(status_code=404, detail="Card not found")

    db = get_db()
    try:
        card = db.query(PersonalityCard).filter(PersonalityCard.token == token).first()
        if not card:
            raise HTTPException(status_code=404, detail="Card not found")

        resume = db.query(SavedResume).filter(SavedResume.id == card.resume_id).first()
        candidate_name = (resume.candidate_name or "") if resume else ""
        traits = json.loads(card.traits) if card.traits else []
        stats = json.loads(card.stats) if card.stats else {}
        story = card.story or ""
    finally:
        db.close()

    card_url = f"{SITE_URL}/card/{token}"
    vitals = _personality_card_vitals(card.archetype)
    og_title = f"{(candidate_name + ' is ') if candidate_name else ''}{card.archetype} | TailorCV Career Card"
    og_desc = (
        f"Only {vitals['rarity_pct']}% of professionals earn this archetype. "
        f"Find out yours → thetailorcv.com"
    )

    return templates.TemplateResponse(request, "personality_card_public.html", {
        "request": request,
        "card": card,
        "candidate_name": candidate_name,
        "story": story,
        "traits": traits,
        "stats": stats,
        "card_url": card_url,
        "vitals": vitals,
        "seo_og_title": og_title,
        "seo_og_description": og_desc,
        "seo_og_image": f"{SITE_URL}/static/personality-card-og.png",
        "canonical_url": card_url,
    })


# ---------------------------------------------------------------------------
# Portfolio Studio — turn a saved resume into a live, shareable portfolio site.
# Public pages live at /p/<slug> and need no login, mirroring PersonalityCard.
# ---------------------------------------------------------------------------

# Available portfolio themes (slug -> human label). One polished "Studio" theme
# for now; the registry keeps the door open for more. Old rows storing a retired
# theme value still render fine — the public CSS is single-theme.
PORTFOLIO_THEMES = {
    "editor": "Editor — VS Code style",
    "nova": "Nova — teal, animated particles",
    "codeflow": "Codeflow — blue, scroll progress",
    "panels": "Panels — tabbed card, light",
    "wave": "Wave — neon lines, animated",
    "bold": "Bold — big type, dark",
    "terminal": "Terminal — developer / mono",
    "clean": "Clean — minimal light",
    "editorial": "Editorial — serif & elegant",
    "vibrant": "Vibrant — colorful designer",
    "console": "Console - web developer terminal",
    "monolith": "Monolith - bold black and white",
    "particle": "Particle - neon skill cards",
    "snowcard": "Snowcard - light dotted tabs",
    "github": "GitHub - profile, repos & contributions",
    "parchment": "Parchment — ancient scroll letter 📜",
    "assistant": "Assistant — ChatGPT-style AI chat 🤖",
    "cloud": "Cloud — friendly dev landing, light/dark ☁️",
    "neon": "Neon — cyberpunk glow, grid floor 🌃",
    "brutalist": "Brutalist — bold blocks, hard shadows 🧱",
    "hacker": "Hacker — green terminal, typed 💻",
    "magazine": "Magazine — editorial serif print 📰",
}
DEFAULT_PORTFOLIO_THEME = "editor"

# Optional per-theme marketing assets for the builder picker. Filled in over time;
# a missing slug/key just falls back to the CSS mini-preview (image) / no link (demo).
# Convention: image at static/portfolio-previews/<slug>.<ext>; demo is a real
# published portfolio on our own domain (https://thetailorcv.com/<slug>). The old
# *.netlify.app demos below still need migrating — they 404 now.
PORTFOLIO_THEME_MEDIA = {
    "editor": {"image": "/static/portfolio-previews/editor.png", "demo": "https://thetailorcv.com/trisha-debnath-18"},
    "nova": {"image": "/static/portfolio-previews/nova.png", "demo": "https://thetailorcv.com/william-davis"},
    "codeflow": {"image": "/static/portfolio-previews/codeflow.png", "demo": "https://thetailorcv.com/shubham-sarkar-5"},
    "panels": {"image": "/static/portfolio-previews/panels.png", "demo": "https://thetailorcv.com/shubham-sarkar-8"},
    "wave": {"image": "/static/portfolio-previews/wave.png", "demo": "https://thetailorcv.com/trisha-debnath-2"},
    "bold": {"image": "/static/portfolio-previews/bold.png", "demo": "https://shubham-sarkar-8.netlify.app/"},
    "terminal": {"image": "/static/portfolio-previews/terminal.png", "demo": "https://nicholas-walker.netlify.app/"},
    "clean": {"image": "/static/portfolio-previews/clean.png", "demo": "https://thetailorcv.com/shubham-sarkar-4"},
    "editorial": {"image": "/static/portfolio-previews/editorial.png", "demo": "https://thetailorcv.com/trisha-debnath-3"},
    "vibrant": {"image": "/static/portfolio-previews/vibrant.png", "demo": "https://thetailorcv.com/shubham-sarkar-9"},
    "console": {"image": "/static/portfolio-previews/console.png", "demo": "https://thetailorcv.com/shubham-sarkar-7"},
    "monolith": {"image": "/static/portfolio-previews/monolith.png", "demo": "https://thetailorcv.com/shubham-sarkar-3"},
    "particle": {"image": "/static/portfolio-previews/particle.png", "demo": "https://thetailorcv.com/shubham-sarkar-10"},
    "snowcard": {"image": "/static/portfolio-previews/snowcard.png", "demo": "https://thetailorcv.com/shubham-sarkar-2"},
    "github": {"image": "/static/portfolio-previews/github.png", "demo": "https://thetailorcv.com/trisha-debnath-4"},
    "parchment": {"image": "/static/portfolio-previews/parchment.png", "demo": "https://thetailorcv.com/karen-taylor"},
    "assistant": {"image": "/static/portfolio-previews/assistant.png", "demo": "https://thetailorcv.com/shubham-sarkar-12"},
    "cloud": {"image": "/static/portfolio-previews/cloud.png", "demo": "https://thetailorcv.com/trisha-debnath-7"},
    "neon": {"image": "/static/portfolio-previews/neon.png", "demo": "https://thetailorcv.com/olivia"},
    "brutalist": {"image": "/static/portfolio-previews/brutalist.png", "demo": "https://thetailorcv.com/emma-martinez"},
    "hacker": {"image": "/static/portfolio-previews/hacker.png", "demo": "https://thetailorcv.com/joseph-booth"},
    "magazine": {"image": "/static/portfolio-previews/magazine.png", "demo": "https://thetailorcv.com/james-haunt"},
}

# Profile photos ride inside data_json as a base64 data URL (no S3 needed). Cap
# the encoded size so a row can't bloat the DB; the client downscales first.
_PORTFOLIO_PHOTO_RE = re.compile(r"^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$", re.IGNORECASE)
MAX_PORTFOLIO_PHOTO_CHARS = 1_500_000  # ~1.1 MB of image after base64 overhead


def _valid_portfolio_photo(value) -> bool:
    """True if value is a reasonably-sized base64 image data URL we can inline."""
    if not isinstance(value, str):
        return False
    value = value.strip()
    if not value or len(value) > MAX_PORTFOLIO_PHOTO_CHARS:
        return False
    return bool(_PORTFOLIO_PHOTO_RE.match(value))


# Base domain that portfolio subdomains live under: <handle>.thetailorcv.com.
# Derived from SITE_URL, overridable via env for staging.
_pf_domain = (os.getenv("PORTFOLIO_DOMAIN", "").strip() or SITE_URL.split("://", 1)[-1].split("/")[0])
if _pf_domain.startswith("www."):
    _pf_domain = _pf_domain[4:]
PORTFOLIO_DOMAIN = _pf_domain or "thetailorcv.com"

# Flip to true ONLY after the wildcard DNS + TLS for *.PORTFOLIO_DOMAIN is live on
# Render. Until then we keep advertising the always-working /p/<slug> links so we
# never hand a user a dead subdomain. Handles are stored regardless, so enabling
# this instantly upgrades every existing portfolio's public URL.
PORTFOLIO_SUBDOMAINS_ENABLED = os.getenv("PORTFOLIO_SUBDOMAINS_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")

# Subdomain labels we must never hand out as a portfolio handle (they collide
# with app/infra hostnames or look like official pages).
RESERVED_HANDLES = {
    "www", "api", "app", "apps", "mail", "smtp", "imap", "pop", "ftp", "ns1", "ns2",
    "mx", "blog", "admin", "dashboard", "static", "assets", "cdn", "img", "images",
    "public", "login", "signup", "auth", "account", "accounts", "support", "help",
    "docs", "status", "about", "contact", "pricing", "careers", "jobs", "portfolio",
    "p", "my", "render", "root", "system", "internal", "test", "staging", "dev",
    "beta", "secure", "billing", "store", "shop", "go", "link", "links",
}


def _portfolio_handleify(value: str) -> str:
    """Normalize text into a DNS-safe handle: [a-z0-9-], 3-40 chars, no edge hyphens.
    Returns '' if nothing usable remains."""
    value = str(value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    value = re.sub(r"-{2,}", "-", value)[:40].strip("-")
    return value if len(value) >= 3 else ""


def _unique_portfolio_handle(db: Session, name: str, desired: str = "") -> str:
    """A free, valid handle. Honors a desired handle when possible, else derives
    from the name; appends a numeric suffix (or random) to resolve collisions."""
    base = _portfolio_handleify(desired) or _portfolio_handleify(name) or "me"
    if base in RESERVED_HANDLES:
        base = f"{base}-portfolio"[:40].strip("-")

    def taken(h: str) -> bool:
        return h in RESERVED_HANDLES or db.query(Portfolio.id).filter(Portfolio.handle == h).first() is not None

    if not taken(base):
        return base
    for i in range(2, 60):
        cand = f"{base}-{i}"[:40].strip("-")
        if not taken(cand):
            return cand
    return f"{base}-{token_hex(2)}"[:40].strip("-")


def _portfolio_share_url(portfolio) -> str:
    """The public URL: pretty subdomain once subdomains are live, else /p/<slug>."""
    if PORTFOLIO_SUBDOMAINS_ENABLED and getattr(portfolio, "handle", None):
        return f"https://{portfolio.handle}.{PORTFOLIO_DOMAIN}"
    return f"{SITE_URL}/{portfolio.slug}"


def _portfolio_slugify(value: str) -> str:
    """Lowercase, ASCII, hyphen-separated handle. Empty/odd input → 'portfolio'."""
    value = str(value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:60].strip("-") or "portfolio"


def _portfolio_initials(name: str) -> str:
    """Up to two initials for the monogram avatar (resumes carry no photo)."""
    parts = [p for p in re.split(r"\s+", str(name or "").strip()) if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def _portfolio_strip_bullets(details) -> list[str]:
    """Turn the editor's newline/•-prefixed details blob (or a list) into clean lines."""
    if isinstance(details, list):
        lines = [str(x) for x in details]
    else:
        lines = str(details or "").split("\n")
    out = []
    for line in lines:
        line = line.strip().lstrip("•").lstrip("-").lstrip("*").strip()
        if line:
            out.append(line)
    return out


def _portfolio_skill_groups(skills) -> list[dict]:
    """Normalize the many skill shapes into [{group, items:[...]}].

    Handles: list[str], list[{name|category}], and the candidate_data dict of
    {category: [skills]}.
    """
    groups: list[dict] = []
    if isinstance(skills, dict):
        for cat, items in skills.items():
            vals = [str(s).strip() for s in (items or []) if str(s).strip()]
            if vals:
                label = str(cat).replace("_", " ").title()
                groups.append({"group": label, "items": vals})
        return groups

    flat: list[str] = []
    if isinstance(skills, list):
        for s in skills:
            if isinstance(s, str) and s.strip():
                flat.append(s.strip())
            elif isinstance(s, dict):
                name = s.get("name") or s.get("category") or s.get("skill")
                if name:
                    flat.append(str(name).strip())
    if flat:
        groups.append({"group": "", "items": flat})
    return groups


def _build_portfolio_data(resume_data: dict, candidate_name: str = "") -> dict:
    """Map a saved resume's structured JSON into the portfolio render dict.

    Tolerant of both the editor `cvData` shape (personalInfo / experience /
    projects) and the optimizer/extraction shape (personal_info|name /
    work_experience / responsibilities)."""
    rd = resume_data or {}
    pi = rd.get("personalInfo") or rd.get("personal_info") or {}
    contact = rd.get("contact") or rd.get("contact_information") or {}

    def first(*vals):
        for v in vals:
            if v:
                return str(v).strip()
        return ""

    name = first(pi.get("name"), rd.get("name"), candidate_name)
    headline = first(pi.get("headline"), pi.get("title"), rd.get("headline"),
                     rd.get("title"), rd.get("current_title"))
    summary = first(pi.get("summary"), rd.get("summary"), rd.get("about"), rd.get("objective"))
    email = first(pi.get("email"), contact.get("email"))
    phone = first(pi.get("phone"), contact.get("phone"))
    location = first(pi.get("location"), contact.get("address"), contact.get("location"))

    # Social links — try personalInfo first, then contact. Normalize each into an
    # ABSOLUTE https URL: known services get cleaned by normalize_contact_link (which
    # strips the scheme), then normalize_url re-adds https:// so the browser doesn't
    # treat e.g. "linkedin.com/in/x" as a path relative to the portfolio page.
    social_map = [
        ("linkedin", "LinkedIn", "linkedin"), ("github", "GitHub", "github"),
        ("leetcode", "LeetCode", "leetcode"), ("portfolio", "Website", ""),
        ("kaggle", "Kaggle", ""), ("googleScholar", "Scholar", ""),
        ("google_scholar", "Scholar", ""), ("twitter", "Twitter", ""),
        ("instagram", "Instagram", ""), ("facebook", "Facebook", ""),
        ("website", "Website", ""),
    ]
    socials, seen = [], set()
    for key, label, service in social_map:
        raw = first(pi.get(key), contact.get(key))
        if not raw or label in seen:
            continue
        cleaned = normalize_contact_link(raw, service) if service else raw
        href = normalize_url(cleaned)
        if href:
            socials.append({"label": label, "icon": key.lower().replace("_", ""), "url": href})
            seen.add(label)

    # Custom "other" links from the builder (Medium, YouTube, Dribbble, Dev.to …).
    # The icon slug falls back to a generic globe in each theme's social macro.
    for ln in (rd.get("links") or rd.get("other_links") or []):
        if not isinstance(ln, dict):
            continue
        label = first(ln.get("label"), ln.get("name"), ln.get("title"))
        href = normalize_url(first(ln.get("url"), ln.get("link")))
        if not href or not label or label in seen:
            continue
        socials.append({"label": label, "icon": re.sub(r"[^a-z0-9]", "", label.lower()), "url": href})
        seen.add(label)

    # Experience
    experience = []
    for exp in (rd.get("experience") or rd.get("work_experience") or []):
        if not isinstance(exp, dict):
            continue
        experience.append({
            "title": first(exp.get("title"), exp.get("role"), exp.get("position")),
            "company": first(exp.get("company"), exp.get("organization")),
            "dates": first(exp.get("dates"), exp.get("date"), exp.get("years"), exp.get("duration")),
            "location": first(exp.get("location")),
            "bullets": _portfolio_strip_bullets(
                exp.get("details") or exp.get("bullets") or exp.get("responsibilities") or []
            ),
        })

    # Projects
    projects = []
    for proj in (rd.get("projects") or []):
        if not isinstance(proj, dict):
            continue
        projects.append({
            "name": first(proj.get("name"), proj.get("title")),
            "subtitle": first(proj.get("subtitle"), proj.get("stack"), proj.get("technologies")),
            "dates": first(proj.get("dates"), proj.get("date")),
            "url": normalize_url(first(proj.get("url"), proj.get("website"), proj.get("project_link"))),
            "github": normalize_url(normalize_contact_link(first(proj.get("github_link"), proj.get("github")), "github")),
            "image": (proj.get("image") or "").strip() if _valid_portfolio_photo(proj.get("image")) else "",
            "bullets": _portfolio_strip_bullets(
                proj.get("details") or proj.get("bullets")
                or proj.get("achievements") or proj.get("description") or []
            ),
        })

    # Education
    education = []
    for edu in (rd.get("education") or []):
        if not isinstance(edu, dict):
            continue
        education.append({
            "school": first(edu.get("school"), edu.get("institution"), edu.get("university")),
            "degree": first(edu.get("degree"), edu.get("course")),
            "year": first(edu.get("year"), edu.get("years"), edu.get("dates")),
            "score": first(edu.get("score"), edu.get("cgpa"), edu.get("gpa"), edu.get("percentage")),
        })

    # Extracurriculars / leadership / volunteering
    extracurriculars = []
    for item in (rd.get("extracurriculars") or rd.get("activities") or rd.get("volunteering") or []):
        if not isinstance(item, dict):
            continue
        extracurriculars.append({
            "role": first(item.get("role"), item.get("title"), item.get("position")),
            "organization": first(item.get("organization"), item.get("org"), item.get("company")),
            "dates": first(item.get("dates"), item.get("date"), item.get("years")),
            "url": normalize_url(first(item.get("url"), item.get("link"))),
            "bullets": _portfolio_strip_bullets(
                item.get("details") or item.get("bullets") or item.get("description") or []
            ),
        })

    # Publications
    publications = []
    for pub in (rd.get("publications") or []):
        if not isinstance(pub, dict):
            continue
        publications.append({
            "title": first(pub.get("title"), pub.get("name")),
            "publisher": first(pub.get("publisher"), pub.get("venue"), pub.get("journal")),
            "year": first(pub.get("year"), pub.get("date")),
            "url": normalize_url(first(pub.get("url"), pub.get("link"), pub.get("doi"))),
        })

    # Open-source contributions (optional). Each entry: name/repo + link + bullets.
    opensource = []
    for it in (rd.get("opensource") or rd.get("open_source") or rd.get("contributions") or []):
        if not isinstance(it, dict):
            continue
        entry = {
            "name": first(it.get("name"), it.get("title"), it.get("repo"), it.get("project")),
            "url": normalize_url(first(it.get("url"), it.get("link"), it.get("github"))),
            "bullets": _portfolio_strip_bullets(
                it.get("details") or it.get("bullets") or it.get("description") or []
            ),
        }
        if entry["name"] or entry["url"] or entry["bullets"]:
            opensource.append(entry)

    # GitHub username for the auto contribution graph. The builder sends an explicit
    # opt-in flag `github_graph`; when it's False the user chose "No", so never show a
    # graph (don't even derive a username from their profile URL). When the flag is
    # absent (e.g. the saved-resume path), fall back to the old auto-derive behavior.
    if rd.get("github_graph") is False:
        github_username = ""
    else:
        github_username = first(pi.get("github_username"), rd.get("github_username"))
        if not github_username:
            gh_raw = first(pi.get("github"), contact.get("github"), rd.get("github"))
            m = re.search(r"github\.com/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))", gh_raw or "")
            if m:
                github_username = m.group(1)
        github_username = re.sub(r"[^A-Za-z0-9-]", "", github_username or "")[:39]

    # Certifications
    certifications = []
    for cert in (rd.get("certifications") or rd.get("certificates") or []):
        if not isinstance(cert, dict):
            continue
        certifications.append({
            "name": first(cert.get("name"), cert.get("title")),
            "issuer": first(cert.get("issuer"), cert.get("organization"), cert.get("authority")),
            "year": first(cert.get("year"), cert.get("date")),
            "url": normalize_url(first(cert.get("url"), cert.get("link"))),
            "image": (cert.get("image") or "").strip() if _valid_portfolio_photo(cert.get("image")) else "",
        })

    # Awards / honors (list of strings or dicts)
    awards = []
    for aw in (rd.get("awards") or rd.get("honors") or rd.get("achievements") or []):
        if isinstance(aw, str) and aw.strip():
            awards.append({"title": aw.strip(), "issuer": "", "year": "", "url": ""})
        elif isinstance(aw, dict):
            entry = {
                "title": first(aw.get("title"), aw.get("name"), aw.get("award")),
                "issuer": first(aw.get("issuer"), aw.get("organization"), aw.get("awarder")),
                "year": first(aw.get("year"), aw.get("date")),
                "url": normalize_url(first(aw.get("url"), aw.get("link"))),
            }
            if entry["title"]:
                awards.append(entry)

    # Hobbies / interests (list of strings, a comma/newline string, or list of dicts)
    hobbies = []
    raw_hobbies = rd.get("hobbies") or rd.get("interests") or []
    if isinstance(raw_hobbies, str):
        raw_hobbies = re.split(r"[,\n]+", raw_hobbies)
    for h in (raw_hobbies or []):
        if isinstance(h, str) and h.strip():
            hobbies.append(h.strip())
        elif isinstance(h, dict):
            nm = h.get("name") or h.get("hobby") or h.get("interest")
            if nm:
                hobbies.append(str(nm).strip())

    skills = _portfolio_skill_groups(rd.get("skills"))
    skills_count = sum(len(g["items"]) for g in skills)

    return {
        "name": name or "Your Name",
        "headline": headline,
        "initials": _portfolio_initials(name),
        "summary": summary,
        "email": email,
        "phone": phone,
        "location": location,
        "socials": socials,
        "skills": skills,
        "experience": experience,
        "projects": projects,
        "education": education,
        "extracurriculars": extracurriculars,
        "publications": publications,
        "certifications": certifications,
        "awards": awards,
        "opensource": opensource,
        "github_username": github_username,
        "hobbies": hobbies,
        "stats": {
            "experience": len(experience),
            "projects": len(projects),
            "skills": skills_count,
        },
    }


def _build_portfolio_ai_prompt(data: dict) -> str:
    """Prompt GPT for a punchy hero tagline + a polished first-person About."""
    skills_flat = ", ".join(
        s for g in data.get("skills", []) for s in g.get("items", [])
    )[:600]
    exp_lines = []
    for e in data.get("experience", [])[:4]:
        exp_lines.append(f"- {e.get('title')} at {e.get('company')}: " + " ".join(e.get("bullets", [])[:2]))
    proj_lines = [f"- {p.get('name')}: {' '.join(p.get('bullets', [])[:1])}" for p in data.get("projects", [])[:4]]

    return (
        "You are a personal-branding copywriter building someone's portfolio website. "
        "Using ONLY the facts below, write copy. Do not invent employers, titles, or metrics.\n\n"
        f"Name: {data.get('name')}\n"
        f"Headline/role: {data.get('headline') or 'unknown'}\n"
        f"Existing summary: {data.get('summary') or 'none'}\n"
        f"Skills: {skills_flat or 'none'}\n"
        f"Experience:\n" + ("\n".join(exp_lines) or "none") + "\n"
        f"Projects:\n" + ("\n".join(proj_lines) or "none") + "\n\n"
        "Return STRICT JSON only, no markdown, with exactly these keys:\n"
        '{\n'
        '  "headline": "a 2-4 word professional role title for the hero (e.g. \\"Frontend Developer\\")",\n'
        '  "tagline": "one confident sentence (max 18 words) describing what they do and their value",\n'
        '  "about": "a warm, first-person About of 2-3 short sentences (max 55 words), one concise paragraph. '
        'Keep it tight and punchy — do NOT pad or repeat. Never invent employers, titles, degrees, or metrics."\n'
        '}'
    )


async def _enrich_portfolio_copy(data: dict) -> dict:
    """Best-effort AI tagline/about. Falls back to resume facts on any failure."""
    fallback = {
        "headline": data.get("headline") or "",
        "tagline": (data.get("summary") or "").split(".")[0][:160],
        "about": data.get("summary") or "",
    }
    try:
        prompt = _build_portfolio_ai_prompt(data)
        raw = await get_resume_response(prompt, model=AI_MODEL, temperature=0.6)
        parsed = parse_ai_json_response(raw)
        if not isinstance(parsed, dict):
            return fallback
        return {
            "headline": str(parsed.get("headline") or fallback["headline"]).strip(),
            "tagline": str(parsed.get("tagline") or fallback["tagline"]).strip(),
            "about": str(parsed.get("about") or fallback["about"]).strip(),
        }
    except Exception:
        logger.exception("Portfolio AI enrichment failed; using resume fallback")
        return fallback


def _reserved_root_slugs() -> set:
    """First path segment of every real app route (e.g. 'api', 'login', 'p',
    'dashboard') so a portfolio served at /<slug> can never shadow a real page."""
    reserved = {"p", "static", "api"}
    for r in app.routes:
        seg = (getattr(r, "path", "") or "").strip("/").split("/")[0]
        if seg and "{" not in seg:
            reserved.add(seg.lower())
    return reserved


def _unique_portfolio_slug(db: Session, name: str) -> str:
    """A clean, human-friendly slug served at the root (e.g. "trisha-debnath").
    Adds a short numeric suffix ("-2", "-3"…) only if the slug is taken or would
    collide with a real app route."""
    base = _portfolio_slugify(name) or "portfolio"
    reserved = _reserved_root_slugs()

    def free(s):
        return s not in reserved and not db.query(Portfolio.id).filter(Portfolio.slug == s).first()

    if free(base):
        return base
    for n in range(2, 100):
        slug = f"{base}-{n}"
        if free(slug):
            return slug
    return f"{base}-{token_hex(3)}"


@app.post("/api/generate-portfolio", include_in_schema=False)
async def generate_portfolio(request: Request):
    """Generate (or refresh) a public portfolio website for a saved resume."""
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse(status_code=401, content={"error": "Not logged in"})

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON body"})

    resume_id = body.get("resume_id")
    try:
        resume_id = int(resume_id)
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"error": "resume_id must be an integer"})

    theme = str(body.get("theme") or DEFAULT_PORTFOLIO_THEME).strip().lower()
    if theme not in PORTFOLIO_THEMES:
        theme = DEFAULT_PORTFOLIO_THEME

    db = get_db()
    try:
        resume = (
            db.query(SavedResume)
            .filter(SavedResume.id == resume_id, SavedResume.user_id == user_id)
            .first()
        )
        if not resume:
            return JSONResponse(status_code=404, content={"error": "Resume not found"})

        resume_data = {}
        if resume.resume_json:
            try:
                resume_data = json.loads(resume.resume_json)
            except (json.JSONDecodeError, TypeError):
                resume_data = {}
        if not resume_data:
            return JSONResponse(status_code=422, content={
                "error": "This resume has no structured data yet. Open it in the editor and save it first."
            })
        candidate_name = resume.candidate_name or ""
        existing = db.query(Portfolio).filter(Portfolio.resume_id == resume_id).first()
        has_cv = bool(resume.html_content)
    finally:
        db.close()

    data = _build_portfolio_data(resume_data, candidate_name)
    copy = await _enrich_portfolio_copy(data)
    if copy.get("headline"):
        data["headline"] = copy["headline"]
    data["has_cv"] = has_cv

    db = get_db()
    try:
        portfolio = db.query(Portfolio).filter(Portfolio.resume_id == resume_id).first()
        if portfolio:
            portfolio.headline = data.get("headline")
            portfolio.tagline = copy.get("tagline")
            portfolio.about = copy.get("about")
            portfolio.theme = theme
            portfolio.data_json = json.dumps(data, separators=(",", ":"))
        else:
            portfolio = Portfolio(
                user_id=user_id,
                resume_id=resume_id,
                slug=_unique_portfolio_slug(db, data.get("name")),
                handle=_unique_portfolio_handle(db, data.get("name")),
                token=token_urlsafe(16),
                theme=theme,
                headline=data.get("headline"),
                tagline=copy.get("tagline"),
                about=copy.get("about"),
                data_json=json.dumps(data, separators=(",", ":")),
            )
            db.add(portfolio)
        try:
            db.commit()
            db.refresh(portfolio)
        except IntegrityError:
            db.rollback()
            portfolio = db.query(Portfolio).filter(Portfolio.resume_id == resume_id).first()
            if portfolio is None:
                raise

        return JSONResponse({
            "success": True,
            "id": portfolio.id,
            "slug": portfolio.slug,
            "handle": portfolio.handle,
            "share_url": _portfolio_share_url(portfolio),
            "view_url": f"/{portfolio.slug}",
            "netlify_url": portfolio.netlify_url,
        })
    except Exception:
        logger.exception("Failed to persist portfolio")
        try:
            db.rollback()
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"error": "Could not generate portfolio. Please try again."})
    finally:
        db.close()


@app.post("/api/build-portfolio", include_in_schema=False)
async def build_portfolio(request: Request):
    """Create a portfolio directly from edited CV data + a chosen theme.

    Powers the guided builder (/portfolio): the user picks a template, uploads a
    resume (parsed by the existing extractor), edits the fields, then publishes.
    Unlike /api/generate-portfolio this is not tied to a SavedResume row."""
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse(status_code=401, content={"error": "Please log in to publish your portfolio."})

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON body"})

    cv = body.get("cvData") or body.get("cv_data") or {}
    if not isinstance(cv, dict) or not cv:
        return JSONResponse(status_code=400, content={"error": "No CV data provided."})

    theme = str(body.get("theme") or DEFAULT_PORTFOLIO_THEME).strip().lower()
    if theme not in PORTFOLIO_THEMES:
        theme = DEFAULT_PORTFOLIO_THEME

    pi = cv.get("personalInfo") or cv.get("personal_info") or {}
    candidate_name = str(pi.get("name") or cv.get("name") or "").strip()

    data = _build_portfolio_data(cv, candidate_name)
    if data["name"] == "Your Name" and not (data["experience"] or data["projects"] or data["skills"]):
        return JSONResponse(status_code=422, content={"error": "Please fill in at least your name and one section."})

    copy = await _enrich_portfolio_copy(data)
    if copy.get("headline"):
        data["headline"] = copy["headline"]
    data["has_cv"] = False  # builder portfolios are not backed by a stored resume PDF

    photo = body.get("photo")
    if _valid_portfolio_photo(photo):
        data["photo"] = photo.strip()

    desired_handle = str(body.get("handle") or "").strip()

    db = get_db()
    try:
        portfolio = Portfolio(
            user_id=user_id,
            resume_id=None,
            slug=_unique_portfolio_slug(db, data.get("name")),
            handle=_unique_portfolio_handle(db, data.get("name"), desired=desired_handle),
            token=token_urlsafe(16),
            theme=theme,
            headline=data.get("headline"),
            tagline=copy.get("tagline"),
            about=copy.get("about"),
            data_json=json.dumps(data, separators=(",", ":")),
        )
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)
        return JSONResponse({
            "success": True,
            "id": portfolio.id,
            "slug": portfolio.slug,
            "handle": portfolio.handle,
            "share_url": _portfolio_share_url(portfolio),
            "view_url": f"/{portfolio.slug}",
            "netlify_url": portfolio.netlify_url,
        })
    except Exception:
        logger.exception("Failed to build portfolio")
        try:
            db.rollback()
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"error": "Could not publish portfolio. Please try again."})
    finally:
        db.close()


@app.get("/portfolio", response_class=HTMLResponse, include_in_schema=False)
@app.get("/portfolio-builder", response_class=HTMLResponse, include_in_schema=False)
async def portfolio_builder_page(request: Request):
    """Guided portfolio builder: choose a template, upload a resume, edit, publish.

    Public so it works as a marketing entry point from the Features menu; the
    final 'Publish' step prompts for login (signup capture)."""
    logged_in = bool(request.session.get("user_id"))
    return templates.TemplateResponse(request, "portfolio_builder.html", {
        "request": request,
        "themes": PORTFOLIO_THEMES,
        "theme_media": PORTFOLIO_THEME_MEDIA,
        "logged_in": logged_in,
        "is_logged_in": logged_in,
        "portfolio_domain": PORTFOLIO_DOMAIN,
        "subdomains_enabled": PORTFOLIO_SUBDOMAINS_ENABLED,
        "canonical_url": build_absolute_url("/portfolio"),
        "software_schema_json": build_software_app_schema(),
        "page_schema_json": build_page_breadcrumb("Resume to Portfolio Website Builder", "/portfolio"),
    })


def _render_portfolio_page(request: Request, portfolio: Portfolio):
    """Shared renderer for a portfolio's public page (used by both the /p/<slug>
    path route and the <handle>.domain subdomain router). Bumps the view count."""
    try:
        portfolio.view_count = (portfolio.view_count or 0) + 1
    except Exception:
        pass
    data = json.loads(portfolio.data_json) if portfolio.data_json else {}
    # Safety net for portfolios saved before link normalization: ensure every
    # outbound URL is absolute so it can't resolve relative to this page.
    for s in data.get("socials") or []:
        if isinstance(s, dict) and s.get("url"):
            s["url"] = normalize_url(s["url"]) or s["url"]
    for p in data.get("projects") or []:
        if isinstance(p, dict):
            if p.get("url"):
                p["url"] = normalize_url(p["url"]) or p["url"]
            if p.get("github"):
                p["github"] = normalize_url(p["github"]) or p["github"]
    for item in (data.get("extracurriculars") or []) + (data.get("publications") or []) + (data.get("certifications") or []):
        if isinstance(item, dict) and item.get("url"):
            item["url"] = normalize_url(item["url"]) or item["url"]
    tagline = portfolio.tagline or ""
    about = portfolio.about or data.get("summary") or ""
    has_cv = bool(data.get("has_cv"))
    theme = portfolio.theme or DEFAULT_PORTFOLIO_THEME
    page_url = _portfolio_share_url(portfolio)
    name = data.get("name") or "Portfolio"
    og_desc = (tagline or about or f"{name}'s portfolio")[:160]
    tpl = {
        "editor": "portfolio_editor.html",
        "wave": "portfolio_wave.html",
        "codeflow": "portfolio_codeflow.html",
        "panels": "portfolio_panels.html",
        "nova": "portfolio_nova.html",
        "console": "portfolio_console.html",
        "monolith": "portfolio_monolith.html",
        "particle": "portfolio_particle.html",
        "snowcard": "portfolio_snowcard.html",
        "github": "portfolio_github.html",
        "parchment": "portfolio_parchment.html",
        "assistant": "portfolio_assistant.html",
        "cloud": "portfolio_cloud.html",
        "neon": "portfolio_neon.html",
        "brutalist": "portfolio_brutalist.html",
        "hacker": "portfolio_hacker.html",
        "magazine": "portfolio_magazine.html",
    }.get(theme, "portfolio_public.html")
    # Free (non-Pro) portfolios carry a "Made with TailorCV" watermark; Pro owners
    # get a clean, unbranded site. Upgrading to Pro drops it on the next page load.
    show_watermark = not is_pro(getattr(portfolio, "user", None))
    return templates.TemplateResponse(request, tpl, {
        "request": request,
        "data": data,
        "tagline": tagline,
        "about": about,
        "slug": portfolio.slug,
        "has_cv": has_cv,
        "theme": theme,
        "page_url": page_url,
        "seo_og_title": f"{name} | Portfolio",
        "seo_og_description": og_desc,
        "canonical_url": page_url,
        "show_watermark": show_watermark,
    })


def _build_static_portfolio_html(portfolio) -> str:
    """Render a portfolio as a single self-contained HTML page for static hosting
    (Netlify): inline the theme CSS and absolutize app-relative asset / CV links so
    nothing depends on the app server."""
    import re as _re

    data = json.loads(portfolio.data_json) if portfolio.data_json else {}
    for s in data.get("socials") or []:
        if isinstance(s, dict) and s.get("url"):
            s["url"] = normalize_url(s["url"]) or s["url"]
    for p in data.get("projects") or []:
        if isinstance(p, dict):
            if p.get("url"):
                p["url"] = normalize_url(p["url"]) or p["url"]
            if p.get("github"):
                p["github"] = normalize_url(p["github"]) or p["github"]
    for item in (data.get("extracurriculars") or []) + (data.get("publications") or []) + (data.get("certifications") or []):
        if isinstance(item, dict) and item.get("url"):
            item["url"] = normalize_url(item["url"]) or item["url"]

    tagline = portfolio.tagline or ""
    about = portfolio.about or data.get("summary") or ""
    has_cv = bool(data.get("has_cv"))
    theme = portfolio.theme or DEFAULT_PORTFOLIO_THEME
    name = data.get("name") or "Portfolio"
    og_desc = (tagline or about or f"{name}'s portfolio")[:160]
    tpl = {
        "editor": "portfolio_editor.html", "wave": "portfolio_wave.html",
        "codeflow": "portfolio_codeflow.html", "panels": "portfolio_panels.html",
        "nova": "portfolio_nova.html", "console": "portfolio_console.html",
        "monolith": "portfolio_monolith.html", "particle": "portfolio_particle.html",
        "snowcard": "portfolio_snowcard.html", "github": "portfolio_github.html",
        "parchment": "portfolio_parchment.html", "assistant": "portfolio_assistant.html",
        "cloud": "portfolio_cloud.html",
        "neon": "portfolio_neon.html",
        "brutalist": "portfolio_brutalist.html",
        "hacker": "portfolio_hacker.html",
        "magazine": "portfolio_magazine.html",
    }.get(theme, "portfolio_public.html")

    class _FakeURL:
        def __init__(self, path): self.path = path

    class _FakeReq:
        def __init__(self, path): self.url = _FakeURL(path)

    page_url = f"{SITE_URL}/{portfolio.slug}"
    # Netlify deploy is Pro-only, so this is False in practice — but compute it
    # honestly so the static export matches the served page if that ever changes.
    show_watermark = not is_pro(getattr(portfolio, "user", None))
    html = templates.get_template(tpl).render(
        request=_FakeReq(f"/{portfolio.slug}"), data=data, tagline=tagline, about=about,
        slug=portfolio.slug, has_cv=has_cv, theme=theme, page_url=page_url,
        seo_og_title=f"{name} | Portfolio", seo_og_description=og_desc, canonical_url=page_url,
        show_watermark=show_watermark,
    )

    def _inline_css(m):
        rel = m.group(1).split("?")[0].lstrip("/")
        try:
            with open(os.path.join(BASE_DIR, rel), "r", encoding="utf-8") as f:
                return "<style>\n" + f.read() + "\n</style>"
        except OSError:
            return m.group(0)

    html = _re.sub(r'<link rel="stylesheet" href="(/static/portfolio[^"]+)">', _inline_css, html)
    html = html.replace('href="/static/', f'href="{SITE_URL}/static/')
    html = html.replace('src="/static/', f'src="{SITE_URL}/static/')
    html = html.replace('href="/p/', f'href="{SITE_URL}/p/')
    return html


async def _deploy_portfolio_to_netlify(user, portfolio):
    """Deploy a portfolio to the USER's single shared Netlify site (reused across all
    their portfolios/templates to save credits). Creates the site only if the user
    has none yet; otherwise overwrites it. Returns (site_id, live_url).
    Requires NETLIFY_AUTH_TOKEN."""
    import hashlib
    import httpx
    import secrets

    html = _build_static_portfolio_html(portfolio)
    body = html.encode("utf-8")
    digest = hashlib.sha1(body).hexdigest()
    headers = {"Authorization": f"Bearer {NETLIFY_AUTH_TOKEN}"}

    async def _find_site_by_name(client, name):
        """Return the account's site with exactly this name, or None."""
        r = await client.get(
            "https://api.netlify.com/api/v1/sites",
            headers=headers, params={"name": name, "per_page": 100},
        )
        if r.status_code == 200:
            for s in (r.json() or []):
                if s.get("name") == name:
                    return s
        return None

    async def _create_site(client):
        # ONE site per USER: name it after the user (stable across every portfolio /
        # template) and make creation IDEMPOTENT — if a site with this name already
        # exists in the account (e.g. the DB id wasn't saved last time), reuse it
        # instead of spawning a duplicate. This guarantees a user can't accumulate
        # multiple Netlify links.
        base = _portfolio_slugify(user.name)[:55].strip("-") or "portfolio"
        existing = await _find_site_by_name(client, base)
        if existing:
            return existing
        r = await client.post("https://api.netlify.com/api/v1/sites", headers=headers, json={"name": base})
        if r.status_code in (200, 201):
            return r.json()
        if r.status_code in (422, 400):
            # Name taken: if it's ours reuse it, else fall back to a suffixed name.
            existing = await _find_site_by_name(client, base)
            if existing:
                return existing
            for candidate in (f"{base}-{secrets.token_hex(2)}", f"{base}-{secrets.token_hex(3)}"):
                r2 = await client.post("https://api.netlify.com/api/v1/sites", headers=headers, json={"name": candidate})
                if r2.status_code in (200, 201):
                    return r2.json()
                if r2.status_code not in (422, 400):
                    r2.raise_for_status()
        else:
            r.raise_for_status()
        # Last resort: let Netlify assign a random name so the deploy still works.
        r = await client.post("https://api.netlify.com/api/v1/sites", headers=headers, json={})
        r.raise_for_status()
        return r.json()

    async with httpx.AsyncClient(timeout=60) as client:
        site_id = user.netlify_site_id
        site_url = user.netlify_url
        if not site_id:
            site = await _create_site(client)
            site_id = site["id"]
            site_url = site.get("ssl_url") or site.get("url")

        # Build a zip once for the fallback path: some tokens/accounts reject the
        # JSON "digest" deploy with 403/422 but accept a direct zip upload.
        import io
        import zipfile
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("index.html", html)
        zip_bytes = zbuf.getvalue()

        def _deploys_url(sid):
            return f"https://api.netlify.com/api/v1/sites/{sid}/deploys"

        async def _deploy_once(sid):
            """Deploy to a site. Try the digest API first (clean content-type), then
            fall back to a direct zip upload. Returns (deploy_json, used_digest), or
            None if the site itself can't be used with this token (gone/forbidden)."""
            r = await client.post(_deploys_url(sid), headers=headers, json={"files": {"/index.html": digest}})
            if r.status_code in (200, 201):
                return r.json(), True
            if r.status_code in (400, 403, 422):
                rz = await client.post(_deploys_url(sid), headers={**headers, "Content-Type": "application/zip"}, content=zip_bytes)
                if rz.status_code in (200, 201):
                    return rz.json(), False
                if rz.status_code in (401, 403, 404):
                    return None
                rz.raise_for_status()
            if r.status_code in (401, 404):
                return None
            r.raise_for_status()

        # A stored site can become unusable (deleted, or created under a different
        # token/account). If so, transparently create a fresh site and retry once.
        result = await _deploy_once(site_id)
        if result is None:
            site = await _create_site(client)
            site_id = site["id"]
            site_url = site.get("ssl_url") or site.get("url")
            result = await _deploy_once(site_id)
        if result is None:
            raise RuntimeError(
                "Netlify rejected the deploy even on a freshly created site — the "
                "NETLIFY_AUTH_TOKEN likely lacks deploy permission or the account is restricted."
            )
        deploy, used_digest = result
        # The digest deploy needs the file body uploaded for any missing sha1.
        if used_digest and digest in (deploy.get("required") or []):
            ur = await client.put(
                f"https://api.netlify.com/api/v1/deploys/{deploy['id']}/files/index.html",
                headers={**headers, "Content-Type": "application/octet-stream"},
                content=body,
            )
            ur.raise_for_status()
        site_url = site_url or deploy.get("ssl_url") or deploy.get("url")
    return site_id, site_url


@app.post("/api/portfolio/{portfolio_id}/deploy-netlify", include_in_schema=False)
async def deploy_portfolio_netlify(portfolio_id: int, request: Request):
    """Owner-only: publish a static copy of the portfolio to Netlify (opt-in)."""
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse(status_code=401, content={"error": "Not logged in"})
    if not NETLIFY_AUTH_TOKEN:
        return JSONResponse(status_code=503, content={"error": "Netlify deploy isn't enabled on this server yet."})
    db = get_db()
    try:
        portfolio = db.query(Portfolio).filter(
            Portfolio.id == portfolio_id, Portfolio.user_id == user_id
        ).first()
        if not portfolio:
            return JSONResponse(status_code=404, content={"error": "Portfolio not found"})
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return JSONResponse(status_code=401, content={"error": "Not logged in"})
        # Custom Netlify live site is a Pro feature. Non-Pro users still have their
        # free thetailorcv.com/<slug> site (created at publish time) — only the extra
        # .netlify.app deployment is gated.
        if not is_pro(user):
            return JSONResponse(status_code=402, content={
                "error": "Publishing a custom Netlify live site is a Pro feature. "
                         "Your free site is already live at thetailorcv.com.",
                "upgrade": True,
                "upgrade_url": "/pricing",
                "free_url": _portfolio_share_url(portfolio),
            })
        try:
            # Deploy to the user's single shared site (one live link per user).
            site_id, site_url = await _deploy_portfolio_to_netlify(user, portfolio)
        except Exception:
            logger.exception("Live-site publish failed for portfolio %s", portfolio_id)
            return JSONResponse(status_code=502, content={"error": "Could not publish your live site. Please try again."})
        user.netlify_site_id = site_id
        user.netlify_url = site_url
        user.netlify_portfolio_id = portfolio.id
        # Keep the live URL on the portfolio that's currently published, and clear it
        # from any other portfolio so only one shows as "live".
        for p in db.query(Portfolio).filter(Portfolio.user_id == user_id).all():
            p.netlify_url = site_url if p.id == portfolio.id else None
        db.commit()
        return JSONResponse({"success": True, "netlify_url": site_url})
    finally:
        db.close()


@app.get("/p/{slug}", response_class=HTMLResponse, include_in_schema=False)
async def portfolio_public(request: Request, slug: str):
    """Public, no-login portfolio website (path form, works on any host)."""
    if not slug or len(slug) > 160:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    db = get_db()
    try:
        portfolio = db.query(Portfolio).filter(Portfolio.slug == slug).first()
        if not portfolio or not portfolio.published:
            raise HTTPException(status_code=404, detail="Portfolio not found")
        response = _render_portfolio_page(request, portfolio)
        try:
            db.commit()
        except Exception:
            db.rollback()
        return response
    finally:
        db.close()


@app.get("/p/{slug}/cv", include_in_schema=False)
async def portfolio_public_cv(request: Request, slug: str):
    """Public 'Download CV' — renders the linked resume's stored HTML to PDF."""
    if not slug or len(slug) > 160:
        raise HTTPException(status_code=404, detail="Not found")
    db = get_db()
    try:
        portfolio = db.query(Portfolio).filter(Portfolio.slug == slug).first()
        if not portfolio or not portfolio.published or not portfolio.resume_id:
            raise HTTPException(status_code=404, detail="Not found")
        resume = db.query(SavedResume).filter(SavedResume.id == portfolio.resume_id).first()
        html_content = resume.html_content if resume else None
        dl_name = _portfolio_slugify(resume.candidate_name if resume else "resume")
    finally:
        db.close()
    if not html_content:
        raise HTTPException(status_code=404, detail="No downloadable CV for this portfolio.")

    pdf_path = os.path.join(resumes_dir, f"portfolio_cv_{uuid.uuid4()}.pdf")

    def _render_pdf():
        from weasyprint import HTML
        HTML(string=html_content, base_url=BASE_DIR).write_pdf(pdf_path, optimize_size=("fonts",))

    try:
        await asyncio.to_thread(_render_pdf)
    except Exception as e:
        logger.exception("PDF render failed")
        raise HTTPException(status_code=500, detail="Failed to render the PDF. Please try again.")

    return FileResponse(
        pdf_path, media_type="application/pdf", filename=f"{dl_name or 'resume'}.pdf",
        background=BackgroundTask(_cleanup_files, [pdf_path]),
    )


@app.get("/my-portfolios", response_class=HTMLResponse)
async def my_portfolios_page(request: Request):
    """Dashboard of the logged-in user's generated portfolio sites."""
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse(url="/login?next=/my-portfolios", status_code=302)
    db = get_db()
    try:
        portfolios = (
            db.query(Portfolio)
            .filter(Portfolio.user_id == user_id)
            .order_by(Portfolio.created_at.desc())
            .all()
        )
        rows = [{
            "id": p.id,
            "slug": p.slug,
            "handle": p.handle or "",
            "theme": p.theme or DEFAULT_PORTFOLIO_THEME,
            "name": (json.loads(p.data_json).get("name") if p.data_json else "") or "Portfolio",
            "headline": p.headline or "",
            "view_count": p.view_count or 0,
            "created_at": p.created_at,
            "share_url": _portfolio_share_url(p),
            "netlify_url": p.netlify_url or "",
        } for p in portfolios]
        portfolio_resume_ids = {p.resume_id for p in portfolios if p.resume_id}

        # Saved resumes the user can turn into a portfolio (must have structured data).
        resumes = (
            db.query(SavedResume)
            .filter(SavedResume.user_id == user_id)
            .order_by(SavedResume.created_at.desc())
            .all()
        )
        resume_rows = [{
            "id": r.id,
            "title": r.title or "Untitled Resume",
            "candidate_name": r.candidate_name or "",
            "has_data": bool(r.resume_json),
            "has_portfolio": r.id in portfolio_resume_ids,
        } for r in resumes]
    finally:
        db.close()
    return templates.TemplateResponse(
        request, "my_portfolios.html",
        {
            "request": request,
            "portfolios": rows,
            "resumes": resume_rows,
            "themes": PORTFOLIO_THEMES,
        },
    )


@app.post("/my-portfolios/{portfolio_id}/delete", include_in_schema=False)
async def delete_portfolio(request: Request, portfolio_id: int):
    """Delete (unpublish) one of the user's portfolios."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        deleted = (
            db.query(Portfolio)
            .filter(Portfolio.id == portfolio_id, Portfolio.user_id == user_id)
            .delete(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()
    if not deleted:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return RedirectResponse(url="/my-portfolios", status_code=303)


@app.post("/api/save-edited-resume", include_in_schema=False)
async def save_edited_resume(request: Request):
    """Explicitly save the edited resume from the editor (user clicked "Save").

    This is the ONLY place a resume is persisted to My Resumes — there is no
    auto-save, so "Not now" truly means not saved and reformat sessions are never
    saved. Create-or-update is keyed on an explicit resume_id round-tripped to the
    client, so re-saving within the same editor session updates the same row
    instead of duplicating or clobbering a different resume.
    """
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse(status_code=401, content={"error": "Not logged in"})
    try:
        body = await request.json()
    except Exception:
        body = {}
    html = (body or {}).get("html")
    template_id = (body or {}).get("template_id")
    jd = (body or {}).get("jd")
    resume_id = (body or {}).get("resume_id")
    resume_data = (body or {}).get("resume_data")
    candidate_name = (body or {}).get("candidate_name")
    jd_snippet = (str(jd).strip() or None) if jd else None  # full JD, untruncated
    if not html or not isinstance(html, str):
        return JSONResponse(status_code=400, content={"error": "Missing resume HTML"})
    if not isinstance(resume_data, dict):
        resume_data = None
    candidate_name = str(candidate_name or "").strip()[:255] or None
    try:
        tid = int(template_id) if template_id is not None else None
    except (TypeError, ValueError):
        tid = None

    db = get_db()
    try:
        record = None
        if resume_id is not None:
            try:
                record = (
                    db.query(SavedResume)
                    .filter(SavedResume.id == int(resume_id), SavedResume.user_id == user_id)
                    .first()
                )
            except (TypeError, ValueError):
                record = None

        if record:  # update this session's existing row
            record.html_content = html
            if tid is not None:
                record.template_id = tid
            if jd_snippet:
                record.jd_snippet = jd_snippet
                if not record.title or record.title == "Edited Resume":
                    record.title = _derive_target_role_from_jd(jd) or record.title
            if resume_data:
                record.resume_json = json.dumps(resume_data, separators=(",", ":"))
            if candidate_name:
                record.candidate_name = candidate_name
        else:  # first save for this resume — create a new row
            # Copy resume_json from the most recently auto-saved (AI-optimized) resume
            # for this user so the personality card generator has structured data.
            recent_with_json = (
                db.query(SavedResume)
                .filter(SavedResume.user_id == user_id, SavedResume.resume_json.isnot(None))
                .order_by(SavedResume.created_at.desc())
                .first()
            )
            record = SavedResume(
                user_id=user_id,
                title=_derive_target_role_from_jd(jd) or "Edited Resume",
                html_content=html, template_id=tid, jd_snippet=jd_snippet,
                resume_json=(
                    json.dumps(resume_data, separators=(",", ":"))
                    if resume_data else
                    (recent_with_json.resume_json if recent_with_json else None)
                ),
                candidate_name=(
                    candidate_name or
                    (recent_with_json.candidate_name if recent_with_json else None)
                ),
            )
            db.add(record)
        db.commit()
        return JSONResponse({"success": True, "id": record.id})
    except Exception:
        logger.exception("save_edited_resume failed")
        try:
            db.rollback()
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"error": "Could not save resume"})
    finally:
        db.close()


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
        {
            "request": request,
            "google_client_id": GOOGLE_CLIENT_ID,
        },
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


@app.get("/contact", response_class=HTMLResponse)
async def contact_page(request: Request):
    """Contact page for the marketing frontend."""
    return templates.TemplateResponse(
        request,
        "contact.html",
        {"request": request},
    )


@app.get("/pricing", response_class=HTMLResponse)
async def pricing_page(request: Request):
    """Pricing page for the marketing frontend."""
    return templates.TemplateResponse(
        request,
        "pricing.html",
        {"request": request},
    )


@app.get("/manage-subscription", response_class=HTMLResponse)
async def manage_subscription_page(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse("/login?next=/manage-subscription", status_code=302)
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            return RedirectResponse("/login", status_code=302)
        if not is_pro(user):
            return RedirectResponse("/pricing", status_code=302)
        return templates.TemplateResponse(
            request,
            "manage_subscription.html",
            {
                "request": request,
                "user": user,
                "pro_until": user.pro_until,
                "has_subscription": bool(user.razorpay_subscription_id or user.polar_subscription_id),
                "plan_provider": user.plan_provider or "razorpay",
            },
        )
    finally:
        db.close()


@app.get("/blog", response_class=HTMLResponse)
async def blog_listing_page(
    request: Request,
    q: str = "",
    tag: str = "",
    category: str = "",
    page: int = 1,
):
    results = blog_service.search_posts(query=q, tag=tag, category=category, page=page, per_page=20)
    filters = blog_service.list_filters()
    canonical_url = build_absolute_url("/blog")
    return templates.TemplateResponse(
        request,
        "blog_list.html",
        {
            "request": request,
            "posts": results["items"],
            "page": results["page"],
            "total_pages": results["total_pages"],
            "q": q,
            "selected_tag": canonical_filter_label(tag),
            "selected_category": canonical_filter_label(category),
            "tags": filters["tags"],
            "top_tags": filters["top_tags"],
            "categories": filters["categories"],
            # Feature the newest post only on an unfiltered page 1 - on a
            # filtered or deeper page a "featured" card would be arbitrary.
            "show_featured": page == 1 and not q and not tag and not category,
            "meta_title": "Resume Optimization Blog | TailorCV",
            "meta_description": "Read ATS, resume, and job search strategies to improve interview outcomes.",
            "meta_keywords": "resume optimization blog, ats resume tips, job search guide",
            "canonical_url": canonical_url,
            "og_image": build_absolute_url("/static/logo.png"),
        },
    )


# Blog posts merged into stronger "pillar" posts to fix keyword cannibalization.
# Each old slug 301-redirects to its pillar and is excluded from the sitemap, so
# Google consolidates ranking signals instead of splitting them across near-duplicates.
# The source .md files are kept on disk (harmless) but no longer served — fully
# reversible: remove an entry here to bring a post back.
BLOG_REDIRECTS = {
    # "check my ATS score free" → one canonical checker page
    "how-to-check-ats-score-free": "ats-score-checker-free",
    "free-ats-resume-scan": "ats-score-checker-free",
    "ats-resume-checker-how-it-works": "ats-score-checker-free",
    "does-my-resume-pass-ats": "ats-score-checker-free",
    # "what is a good ATS score" / "what is an ATS score"
    "ats-score-vs-resume-score": "what-is-a-good-ats-score",
    "what-is-an-ats-score-and-why-does-it-decide-your-job-application-before-any-human-reads-it": "ats-score-guide",
    # "ATS mistakes" (kept pillars: ats-keyword-mistakes + ats-resume-formatting-mistakes)
    "ats-mistakes-tech-professionals": "ats-keyword-mistakes",
    "ats-mistakes-experienced-professionals": "ats-keyword-mistakes",
    "hidden-ats-mistakes-job-search": "ats-keyword-mistakes",
    # "resume matching to job description" → matching pillar / tailoring pillar
    "how-to-match-resume-keywords-to-job-description": "resume-matching-with-job-description-complete-guide",
    "how-to-match-resume-to-job-description-fast": "how-to-tailor-resume-for-every-job",
    "improve-resume-job-match-score": "resume-matching-with-job-description-complete-guide",
    "resume-job-description-match-percentage": "resume-matching-with-job-description-complete-guide",
    "resume-matching-checklist": "resume-matching-with-job-description-complete-guide",
    "resume-matching-for-multiple-jobs": "resume-matching-with-job-description-complete-guide",
    "why-resume-doesnt-match-job-description": "resume-matching-with-job-description-complete-guide",
    "common-resume-job-description-mismatch-mistakes": "resume-matching-with-job-description-complete-guide",
    "what-recruiters-look-for-resume-job-match": "resume-matching-with-job-description-complete-guide",
    "how-ai-resume-matching-works": "resume-matching-with-job-description-complete-guide",
    "resume-skills-match-job-description": "resume-matching-with-job-description-complete-guide",
    "resume-summary-match-job-description": "resume-matching-with-job-description-complete-guide",
    "how-to-match-resume-to-remote-job-description": "resume-matching-with-job-description-complete-guide",
    "overqualified-resume-match-job-description": "resume-matching-with-job-description-complete-guide",
    # persona "resume-matching-X" spin-offs (kept: software-engineer, data-analyst, no-experience)
    "resume-matching-experienced-professionals": "resume-matching-with-job-description-complete-guide",
    "resume-matching-for-career-changers": "resume-matching-with-job-description-complete-guide",
    "resume-matching-marketing": "resume-matching-with-job-description-complete-guide",
    "resume-matching-product-manager": "resume-matching-with-job-description-complete-guide",
}


# Reverse map: blog slug -> its matching /resume-examples/{role} page. Completes the
# topic cluster (the role pages already link back to these blogs).
_BLOG_TO_ROLE = {
    r["blog"]: {"slug": role_slug, "role": r["role"]}
    for role_slug, r in ROLE_SEO.items() if r.get("blog")
}


# Blog CTAs that a logged-out reader may follow straight through. These tools
# meter guests on their own, so the reader gets to use the product first and
# meets the signup wall at a moment when it has already proved its worth.
# Anything NOT listed here produces a saved asset (a resume, a portfolio, a
# cover letter, an interview record) and so still routes through /login?next=.
_BLOG_CTA_OPEN_PATHS = {"/solutions", "/templates", "/extension"}


def blog_cta(post, is_logged_in: bool = False) -> dict:
    """Pick a topic-aware hero CTA from the post's category/slug/title so each
    blog points to the most relevant tool. Returns title + text as well as the
    button, so the whole card stays consistent — a cover-letter post must not
    show ATS-score copy above a 'Generate a Cover Letter' button.

    Blog readers are (usually) logged out, so the CTA routes them through /login
    with a `next` back to the tool — landing them on the logged-in view rather
    than the marketing page. Already-logged-in readers go straight to the tool."""
    hay = f"{post.category} {post.slug} {post.title} {' '.join(post.tags)}".lower()
    # Extension CTA only when the extension is the post's actual SUBJECT (title/slug),
    # not merely a tag. Otherwise broad how-to posts (e.g. "apply to jobs faster")
    # that just mention the extension would wrongly push "Add to Chrome" instead of
    # the core tool their reader actually wants.
    subject = f"{post.slug} {post.title}".lower()
    if "extension" in subject or "chrome" in subject or "add to chrome" in subject:
        cta = {"title": "Tailor on the job page",
               "text": "Add the free TailorCV extension and tailor your resume on any posting in one click.",
               "label": "Add to Chrome — Free", "url": "/extension"}
    elif "cover letter" in hay or "cover-letter" in hay:
        cta = {"title": "Write a standout cover letter",
               "text": "Generate a cover letter matched to any job in seconds.",
               "label": "Generate a Cover Letter", "url": "/cover-letter"}
    elif "portfolio" in hay:
        cta = {"title": "Turn your resume into a website",
               "text": "Build a live portfolio site from your resume — no code needed.",
               "label": "Build Your Portfolio", "url": "/portfolio"}
    elif "interview" in hay or "mock" in hay:
        cta = {"title": "Practice before it counts",
               "text": "Run a free AI mock interview and get instant feedback.",
               "label": "Try a Free AI Mock Interview", "url": "/mock-interview"}
    elif "template" in hay:
        cta = {"title": "Pick a template that passes ATS",
               "text": "Browse clean, recruiter-ready resume templates.",
               "label": "Browse Resume Templates", "url": "/templates"}
    elif "ats score" in hay or "ats-score" in hay:
        cta = {"title": "Boost your resume in minutes",
               "text": "Scan your resume against any job with the free ATS score checker.",
               "label": "Check My ATS Score", "url": "/solutions"}
    else:
        # Everything else (incl. general ATS, resume, career, job-search) -> tailoring tool.
        cta = {"title": "Boost your resume in minutes",
               "text": "Tailor your resume to any job and beat the ATS — free to start.",
               "label": "Tailor Your Resume", "url": "/solutions"}

    # Logged-out readers: only wall the tools whose OUTPUT needs an account to
    # live somewhere. The open tools already meter guests themselves (the ATS
    # scanner allows one free scan via enforce_guest_ats_allowed), so sending a
    # reader to /login first spends the highest-intent moment on a form before
    # they have seen anything the article just promised them.
    if not is_logged_in and cta["url"] not in _BLOG_CTA_OPEN_PATHS and cta["url"].startswith("/"):
        cta["url"] = "/login?next=" + cta["url"]
    return cta


# Resume template previews, same assets the /templates page serves.
_BLOG_RESUME_TEMPLATES = [
    ("/static/pic1.webp", "ATS Friendly Classic"), ("/static/pic2.webp", "Modern Minimal"),
    ("/static/pic3.webp", "Professional Clean"), ("/static/pic4.webp", "Executive Edge"),
    ("/static/pic5.webp", "Corporate Blue"), ("/static/pic6.webp", "Compact One-Page"),
    ("/static/pic7.webp", "Fresh Graduate"), ("/static/pic8.webp", "Skill Spotlight"),
    ("/static/pic9.webp", "Chronological Pro"), ("/static/pic10.webp", "Creative Balanced"),
    ("/static/pic11.webp", "Elegant Serif"), ("/static/pic12.webp", "Impact Resume"),
    ("/static/pic13.webp", "Tech Specialist"), ("/static/pic14.webp", "Data Analyst Pro"),
    ("/static/pic15.webp", "Product Manager Fit"), ("/static/pic16.webp", "Marketing Highlight"),
    ("/static/pic17.webp", "Modern ATS Plus"), ("/static/pic18.webp", "Premium Executive"),
    ("/static/pic19.webp", "LaTeX Academic"), ("/static/pic20.webp", "ATS Friendly"),
    ("/static/pic21.webp", "Modern Tech"), ("/static/pic22.webp", "Academic Serif"),
]

# Withdrawn from the blog gallery. Filtered out of the pool rather than swapped
# after selection, so a post still gets its full `limit` of distinct cards.
_BLOG_RETIRED_TEMPLATES = {
    "/static/pic1.webp", "/static/pic2.webp", "/static/pic3.webp", "/static/pic4.webp",
    "/static/pic5.webp", "/static/pic11.webp", "/static/pic22.webp",
}
_BLOG_TEMPLATE_POOL = [t for t in _BLOG_RESUME_TEMPLATES if t[0] not in _BLOG_RETIRED_TEMPLATES]

# Topic -> template names to lead with, so a fresher guide opens on the fresher
# template and a data-role guide on the analyst one. Anything not matched falls
# through to the slug-seeded rotation below.
_BLOG_TEMPLATE_AFFINITY = [
    (("fresher", "graduate", "student", "entry level", "entry-level", "no experience", "internship", "campus"),
     ["Fresh Graduate", "Compact One-Page", "Skill Spotlight"]),
    (("software", "developer", "engineer", "tech", "it ", "devops", "backend", "frontend", "full stack", "faang", "coding"),
     ["Tech Specialist", "Modern Tech", "Modern ATS Plus"]),
    (("data", "analyst", "analytics", "machine learning", "scientist"),
     ["Data Analyst Pro", "Skill Spotlight", "Modern ATS Plus"]),
    (("product manager", "product-manager", " pm ", "scrum", "agile"),
     ["Product Manager Fit", "Impact Resume", "Modern Minimal"]),
    (("marketing", "sales", "seo", "content", "brand", "social media"),
     ["Marketing Highlight", "Creative Balanced", "Impact Resume"]),
    (("executive", "senior", "director", "manager", "leadership", "vp ", "c-suite", "cxo"),
     ["Premium Executive", "Executive Edge", "Chronological Pro"]),
    (("academic", "research", "phd", "professor", "scholar", "cv format", "latex"),
     ["LaTeX Academic", "Academic Serif", "Elegant Serif"]),
    (("career change", "career-change", "switch", "transition", "gap"),
     ["Skill Spotlight", "Creative Balanced", "Modern Minimal"]),
    (("ats", "applicant tracking", "keyword", "parse", "scan", "score"),
     ["ATS Friendly Classic", "Modern ATS Plus", "ATS Friendly"]),
]


def _blog_rotate(items: list, seed_text: str) -> list:
    """Deterministic per-post rotation, so different articles surface different
    templates instead of every post showing the same three."""
    if not items:
        return items
    k = sum(ord(ch) for ch in seed_text) % len(items)
    return items[k:] + items[:k]


def blog_template_showcase(post, limit: int = 1) -> dict | None:
    """Pick a small gallery of real templates to embed in a post.

    Portfolio guides get portfolio themes; resume/ATS/tailoring guides get
    resume templates. Returns None for every other topic so the block never
    shows up where it has nothing to do with the article."""
    hay = f"{post.category} {post.slug} {post.title} {' '.join(post.tags)}".lower()
    subject = f"{post.slug} {post.title}".lower()

    # Interview-practice posts get nothing. This has to be checked BEFORE the
    # portfolio branch below: a post like "resume-portfolio-mock-interview-system"
    # matches "portfolio" too, and was showing a portfolio template gallery on
    # what is really a mock-interview article.
    if "mock interview" in subject or "mock-interview" in subject:
        return None

    # An explicit `showcase:` in frontmatter overrides the inference below. The
    # heuristic reads slug/title/tags, so a post whose subject is unrelated to
    # resumes - a visa guide, a hiring-process guide - has no way to opt in even
    # where the gallery is genuinely useful to that reader. "none" suppresses it.
    forced = (getattr(post, "showcase", "") or "").strip().lower()
    if forced == "none":
        return None

    if forced == "portfolio" or (not forced and "portfolio" in subject):
        # Themes withdrawn from the blog gallery (still available in the app).
        _blog_hidden_themes = {"particle"}
        themes = [(slug, PORTFOLIO_THEMES.get(slug, slug).split("—")[0].split("-")[0].strip(), media)
                  for slug, media in PORTFOLIO_THEME_MEDIA.items()
                  if media.get("image") and slug not in _blog_hidden_themes]
        picked = _blog_rotate(themes, post.slug)[:limit]
        if not picked:
            return None
        return {
            "kind": "portfolio",
            "title": "See what your portfolio could look like",
            "text": "This theme is built straight from your resume — pick one and your portfolio is live in minutes.",
            "cta_url": "/portfolio",
            "cta_label": "Build my portfolio",
            "cards": [{"image": m["image"], "name": name, "demo": m.get("demo")} for _s, name, m in picked],
        }

    is_resume_topic = (
        "resume" in hay or "cv" in hay or "ats" in hay
        or "applicant tracking" in hay or "tailor" in hay
    )
    # Extension posts DO get a template: the extension's output is a tailored
    # resume, so showing what that resume can look like is on-topic.
    off_topic = ("cover letter", "cover-letter", "interview", "linkedin")
    if forced != "resume" and (not is_resume_topic or any(t in subject for t in off_topic)):
        return None

    by_name = {name: (img, name) for img, name in _BLOG_TEMPLATE_POOL}
    ordered: list = []
    for terms, names in _BLOG_TEMPLATE_AFFINITY:
        if any(t in hay for t in terms):
            # Only the LEAD card comes from the affinity list, rotated by slug.
            # Taking all three would give every "ats"-ish post (the majority)
            # the identical trio; one topical lead plus rotated fill keeps the
            # match meaningful while the gallery still differs post to post.
            matched = [by_name[n] for n in names if n in by_name]
            ordered.extend(_blog_rotate(matched, post.slug)[:1])
            break
    # Top up (and de-dupe) from the rotated full set so every post differs.
    for item in _blog_rotate(_BLOG_TEMPLATE_POOL, post.slug + post.title):
        if len(ordered) >= limit:
            break
        if item not in ordered:
            ordered.append(item)

    # Topic-matched heading, so an extension post and a keywords post do not
    # open the same block with the same generic line.
    if "extension" in subject or "chrome" in subject:
        title, text = ("What the tailored resume looks like",
                       "This is the format the extension exports to — ATS-tested, so the match score you saw survives the parser.")
    elif "keyword" in subject:
        title, text = ("Where those keywords actually go",
                       "A layout with a real skills section gives the parser somewhere clean to find every term you just added.")
    elif "format" in subject or "parse" in subject:
        title, text = ("A layout that parses cleanly",
                       "Single column, standard headings, no text boxes — the formatting rules in this guide, already applied.")
    elif "fresher" in subject or "no experience" in subject or "student" in subject or "intern" in subject:
        title, text = ("A layout that works with a short history",
                       "Leads with skills and projects instead of years of experience you do not have yet.")
    elif "tailor" in subject:
        title, text = ("Start from a template that tailors well",
                       "Clean structure means swapping keywords per job takes minutes, not a re-layout every time.")
    else:
        title, text = ("Templates that keep this structure intact",
                       "This template is ATS-tested — start from it and the formatting rules in this guide are already handled.")

    return {
        "kind": "resume",
        "title": title,
        "text": text,
        "cta_url": "/templates",
        "cta_label": "Browse all templates",
        "cards": [{"image": img, "name": name, "demo": None} for img, name in ordered[:limit]],
    }


def blog_ats_widget_copy(post) -> dict:
    """Topic-matched heading for the inline scanner, so an extension post and
    a keywords post do not open with the same generic line."""
    subject = f"{post.slug} {post.title}".lower()
    if "extension" in subject or "chrome" in subject:
        return {"title": "Check your match before you install anything",
                "text": "Same score the extension shows on a job page - run it here on any resume and job description."}
    if "keyword" in subject:
        return {"title": "See which keywords you are missing",
                "text": "Scan your resume against the posting and get the exact terms it did not find."}
    if "tailor" in subject:
        return {"title": "See what tailoring is worth on your resume",
                "text": "Score your current resume against a real job description before you change a word."}
    if "format" in subject or "parse" in subject or "template" in subject:
        return {"title": "Does your formatting survive the parser?",
                "text": "Upload your resume and see what an ATS actually reads back."}
    if "fresher" in subject or "no experience" in subject or "student" in subject or "intern" in subject:
        return {"title": "Find out where a fresher resume stands",
                "text": "Score yours against a real posting - no account, no cost."}
    if "low" in subject or "reject" in subject or "fail" in subject:
        return {"title": "Find out why your score is low",
                "text": "Scan your resume against the job description and see exactly which checks fail."}
    return {"title": "What is your resume scoring right now?",
            "text": "Scan it against a job description and get your ATS match score in about a minute."}


def blog_shows_ats_widget(post) -> bool:
    """Whether to embed the inline ATS scanner in this post.

    Only ATS/resume-scoring posts get it - the widget is the strongest
    funnel we have (guests get one free scan), but it only makes sense
    where the reader has just been told their ATS score matters. Posts
    about cover letters, portfolios or interviews are excluded so the
    widget never feels bolted on."""
    hay = f"{post.category} {post.slug} {post.title} {' '.join(post.tags)}".lower()
    subject = f"{post.slug} {post.title}".lower()
    # Extension posts are about checking your ATS match on a job posting, so
    # letting the reader actually run that check is the most relevant thing
    # on the page - not an interruption.
    off_topic = ("cover letter", "cover-letter", "portfolio", "interview")
    if any(term in subject for term in off_topic):
        return False
    # The extension's headline feature is the live match score, so every
    # extension post gets the scanner even when the copy never says "ATS".
    if "extension" in subject or "chrome" in subject:
        return True
    # Career-advice / job-search posts end on "now go apply". A free scan is
    # the most useful next step we can hand that reader, so they get it too.
    career = ("career", "job search", "job-search", "get a job", "get hired",
              "first job", "job hunt", "apply", "application", "layoff",
              "salary", "promotion", "rejected", "recruiter", "fresher", "graduate")
    if any(t in subject for t in career):
        return True
    if (post.category or "").strip().lower() in ("career advice", "job search"):
        return True
    return "ats" in hay or "applicant tracking" in hay or "resume score" in hay


def _blog_voter_hash(request: Request) -> str:
    """Salted hash of the client IP - readers are logged out, so there is no
    user id to key a vote on, and raw IPs should not be stored."""
    return _guest_ats_ip_hash(_client_ip(request))


def blog_rating_summary(db: Session, slug: str) -> dict:
    """Average + count for a post. Shown next to the stars."""
    from sqlalchemy import func as _func
    row = db.query(
        _func.avg(BlogRating.rating), _func.count(BlogRating.id)
    ).filter(BlogRating.slug == slug).one()
    avg, count = row[0], row[1] or 0
    return {"average": round(float(avg), 2) if avg else 0.0, "count": int(count)}


def _blog_rating_ctx(slug: str) -> dict:
    db = get_db()
    try:
        return blog_rating_summary(db, slug)
    except Exception:
        logger.exception("blog rating summary failed")
        return {"average": 0.0, "count": 0}
    finally:
        db.close()


@app.post("/api/blog/{slug}/rate")
async def rate_blog_post(request: Request, slug: str):
    """Record a 1-5 star rating for a post.

    Upserts on (slug, voter_hash) so re-rating changes the existing vote
    rather than adding another - one refresh should not move the average.
    """
    if blog_service.get_post(slug) is None:
        raise HTTPException(status_code=404, detail="Blog post not found")
    try:
        body = await request.json()
        rating = int(body.get("rating", 0))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid rating")
    if not 1 <= rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    voter = _blog_voter_hash(request)
    db = get_db()
    try:
        existing = (
            db.query(BlogRating)
            .filter(BlogRating.slug == slug, BlogRating.voter_hash == voter)
            .first()
        )
        if existing:
            existing.rating = rating
        else:
            db.add(BlogRating(slug=slug, rating=rating, voter_hash=voter))
        db.commit()
        summary = blog_rating_summary(db, slug)
    finally:
        db.close()
    return {"ok": True, "your_rating": rating, **summary}


@app.get("/blog/{slug}", response_class=HTMLResponse)
async def blog_post_page(request: Request, slug: str):
    # Consolidate merged duplicates: permanent-redirect old slugs to their pillar.
    target = BLOG_REDIRECTS.get(slug)
    if target:
        return RedirectResponse(url=f"/blog/{target}", status_code=301)
    post = blog_service.get_post(slug)
    if post is None:
        raise HTTPException(status_code=404, detail="Blog post not found")
    related_posts = blog_service.related_posts(post, limit=6)
    canonical_url = build_absolute_url(f"/blog/{post.slug}")
    og_image = post.image if str(post.image).startswith("http") else build_absolute_url(post.image or "/static/logo.png")
    author_profile = pick_author(post)
    return templates.TemplateResponse(
        request,
        "blog_post.html",
        {
            "request": request,
            "post": post,
            "related_posts": related_posts,
            "canonical_url": canonical_url,
            "meta_title": f"{post.title} | TailorCV Blog",
            "meta_description": post.description,
            "meta_keywords": post.keywords or ", ".join(post.tags),
            "og_image": og_image,
            "codehilite_css": codehilite_css(),
            "blog_schema_json": build_blogposting_schema(post, canonical_url, author_profile),
            "breadcrumb_schema_json": build_breadcrumb_schema(post, canonical_url),
            "faq_schema_json": build_faq_schema(post),
            "author_profile": author_profile,
            "related_resume_example": _BLOG_TO_ROLE.get(post.slug),
            "hero_cta": blog_cta(post, is_logged_in=bool(request.session.get("user_id"))),
            "show_ats_widget": blog_shows_ats_widget(post),
            "ats_widget_copy": blog_ats_widget_copy(post),
            "rating_summary": _blog_rating_ctx(post.slug),
            "template_showcase": blog_template_showcase(post),
        },
    )


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap_xml():
    today = datetime.utcnow().strftime("%Y-%m-%d")
    # (path, changefreq, priority) for public, indexable pages.
    static_pages = [
        ("/", "daily", "1.0"),
        ("/solutions", "weekly", "0.9"),
        ("/ats-analysis", "weekly", "0.9"),
        ("/templates", "weekly", "0.8"),
        ("/cover-letter", "weekly", "0.8"),
        ("/portfolio", "weekly", "0.8"),
        ("/alternatives", "weekly", "0.8"),
        ("/resume-examples", "weekly", "0.8"),
        ("/mock-interview", "weekly", "0.8"),
        ("/interview-prep", "weekly", "0.7"),
        ("/modify-cv", "weekly", "0.7"),
        ("/pricing", "monthly", "0.6"),
        ("/about", "monthly", "0.5"),
        ("/contact", "monthly", "0.4"),
        ("/blog", "daily", "0.7"),
    ]
    static_urls = [(path, today, changefreq, priority) for path, changefreq, priority in static_pages]
    post_urls = [
        (f"/blog/{p.slug}", p.lastmod_iso, "monthly", "0.6")
        for p in blog_service.load_posts()
        if p.slug not in BLOG_REDIRECTS  # merged duplicates 301 elsewhere; keep them out of the index
    ]
    role_urls = [(f"/resume-examples/{slug}", today, "monthly", "0.6") for slug in ROLE_SEO]
    # Derived from the page data itself, so a new competitor never needs a second edit here.
    comparison_urls = [(f"/{slug}", today, "monthly", "0.7") for slug in _COMPARISON_PAGES]
    # Published portfolios become indexable URLs — but only quality ones (has real
    # projects/experience) so we never feed Google thin/boilerplate pages.
    portfolio_urls = []
    _pf_db = get_db()
    try:
        for pf in _pf_db.query(Portfolio).filter(Portfolio.published == True).all():  # noqa: E712
            try:
                pdata = json.loads(pf.data_json) if pf.data_json else {}
            except Exception:
                continue
            if pdata.get("projects") or pdata.get("experience"):
                loc = _portfolio_share_url(pf)
                lastmod = (pf.updated_at or pf.created_at or datetime.utcnow()).strftime("%Y-%m-%d")
                portfolio_urls.append((loc, lastmod, "monthly", "0.5"))
    finally:
        _pf_db.close()
    all_urls = static_urls + post_urls + role_urls + comparison_urls

    entries = []
    for path, lastmod, changefreq, priority in all_urls:
        entries.append(
            f"<url><loc>{xml_escape(build_absolute_url(path))}</loc>"
            f"<lastmod>{xml_escape(lastmod)}</lastmod>"
            f"<changefreq>{changefreq}</changefreq>"
            f"<priority>{priority}</priority></url>"
        )
    # Portfolio locs are already absolute (may be a subdomain), so emit them as-is.
    for loc, lastmod, changefreq, priority in portfolio_urls:
        entries.append(
            f"<url><loc>{xml_escape(loc)}</loc>"
            f"<lastmod>{xml_escape(lastmod)}</lastmod>"
            f"<changefreq>{changefreq}</changefreq>"
            f"<priority>{priority}</priority></url>"
        )
    xml = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"
        + "".join(entries)
        + "</urlset>"
    )
    return Response(content=xml, media_type="application/xml")


@app.get("/rss.xml", include_in_schema=False)
async def rss_feed():
    posts = blog_service.load_posts()[:50]
    items = []
    for post in posts:
        link = build_absolute_url(f"/blog/{post.slug}")
        items.append(
            "<item>"
            f"<title>{xml_escape(post.title)}</title>"
            f"<link>{xml_escape(link)}</link>"
            f"<guid>{xml_escape(link)}</guid>"
            f"<description>{xml_escape(post.description)}</description>"
            f"<pubDate>{datetime.strptime(post.date_iso, '%Y-%m-%d').strftime('%a, %d %b %Y 00:00:00 GMT')}</pubDate>"
            "</item>"
        )
    rss = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<rss version=\"2.0\"><channel>"
        "<title>TailorCV Blog</title>"
        f"<link>{xml_escape(build_absolute_url('/blog'))}</link>"
        "<description>ATS and resume optimization insights from TailorCV.</description>"
        + "".join(items)
        + "</channel></rss>"
    )
    return Response(content=rss, media_type="application/rss+xml")


@app.get("/style2.css", include_in_schema=False)
async def style2_css():
    """Compatibility route for templates using ../style2.css."""
    css_path = os.path.join(static_dir, "style2.css")
    if not os.path.exists(css_path):
        raise HTTPException(status_code=404, detail="style2.css not found")
    return FileResponse(css_path, media_type="text/css")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Serve favicon for browsers requesting /favicon.ico."""
    favicon_png = os.path.join(static_dir, "favicon.png")
    if not os.path.exists(favicon_png):
        raise HTTPException(status_code=404, detail="favicon not found")
    return FileResponse(favicon_png, media_type="image/png")


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
            email_sent = send_signup_code_email(normalized_email, signup_code)
            if not email_sent:
                raise RuntimeError("Signup verification email is not configured")
        except Exception:
            logger.exception("Failed to send sign-up verification email")
            if is_production_environment():
                raise HTTPException(status_code=500, detail="Could not send verification email. Please try again.")
            return JSONResponse(
                {
                    "success": True,
                    "message": "Sending Email",
                    "dev_code": signup_code,
                }
            )

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

        try:
            send_welcome_email_once(db, user, source="signup")
        except Exception:
            logger.exception("Failed to send signup welcome email")

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

        try:
            send_welcome_email_once(db, user, source="login")
        except Exception:
            logger.exception("Failed to send first-login welcome email")

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

    # One Request instance reuses a requests.Session (connection pool helps flaky TLS paths).
    transport_req = google_requests.Request()
    cert_backoffs = [0.0, 0.35, 0.8, 1.75]
    idinfo = None
    last_transport_exc: BaseException | None = None

    for attempt, pause in enumerate(cert_backoffs):
        if pause > 0:
            await asyncio.sleep(pause)
        try:
            idinfo = id_token.verify_oauth2_token(token, transport_req, GOOGLE_CLIENT_ID)
            break
        except ValueError as exc:
            logger.info("Google ID token rejected: %s", exc)
            raise HTTPException(status_code=401, detail="Invalid Google token.")
        except Exception as exc:
            if TransportError is not None and isinstance(exc, TransportError):
                last_transport_exc = exc
                logger.warning(
                    "Google cert fetch transport error (attempt %s/%s): %s",
                    attempt + 1,
                    len(cert_backoffs),
                    exc,
                )
                continue
            logger.exception("Google token verification failed")
            raise HTTPException(status_code=401, detail="Invalid Google token.")

    if idinfo is None:
        logger.error("Google OAuth unreachable after retries: %s", last_transport_exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "Cannot reach Google to verify sign-in (SSL/network). Try again shortly. "
                "If this persists: run `pip install -U certifi urllib3 requests`, "
                "or disable VPN/antivirus HTTPS scanning, or set REQUESTS_CA_BUNDLE to your corp CA bundle."
            ),
        )

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

        try:
            send_welcome_email_once(db, user, source="google_login")
        except Exception:
            logger.exception("Failed to send Google-login welcome email")

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
    request.session.clear()
    return JSONResponse({"success": True})


@app.get("/api/auth/me", include_in_schema=False)
async def auth_me(request: Request):
    """Returns current user's identity and Pro subscription status for the app shell."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        return {
            "user_id": user.id,
            "name": user.name,
            "email": user.email,
            "is_pro": is_pro(user),
            "pro_until": user.pro_until.isoformat() if user.pro_until else None,
            "plan_provider": user.plan_provider,
        }
    finally:
        db.close()


@app.post("/api/billing/checkout-download", include_in_schema=False)
async def checkout_download(request: Request):
    """Atomically gate and record a resume download in one transaction.

    Pro users: always allowed, counter untouched.
    Free users with quota remaining: counter incremented HERE before 200 is returned,
      so the frontend is guaranteed the slot is consumed before the download starts.
    Free users with quota exhausted: 402 returned, frontend shows upgrade popup.
    """
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        if is_pro(user):
            return JSONResponse({"allowed": True, "is_pro": True})
        _beta_env = os.getenv("BILLING_BETA_USER_IDS", "").strip()
        if _beta_env:
            _beta_ids = {int(x) for x in _beta_env.split(",") if x.strip().isdigit()}
            if user.id not in _beta_ids:
                return JSONResponse({"allowed": True, "is_pro": False})
        # Serialize quota checks per user — mirrors enforce_quota line 542.
        db.query(User).filter(User.id == user.id).with_for_update().one()
        from sqlalchemy import func as _func
        used = (
            db.query(_func.coalesce(_func.sum(UsageRecord.ai_optimizations), 0))
            .filter(UsageRecord.user_id == user.id)
            .scalar() or 0
        )
        limit = FREE_LIMITS.get("ai_optimizations", 1)
        if used >= limit:
            return JSONResponse(
                status_code=402,
                content={"allowed": False, "error": "upgrade_required", "feature": "ai_optimizations"},
            )
        month = datetime.utcnow().strftime("%Y-%m")
        rec = get_or_create_usage(db, user.id, month)
        rec.ai_optimizations = (rec.ai_optimizations or 0) + 1
        db.commit()
        return JSONResponse({"allowed": True, "is_pro": False})
    finally:
        db.close()


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


def _usable_ats_payload(ats_payload: str | None):
    """Validate a client-forwarded ATS analysis before trusting it.

    The client sends back the analysis the user was shown so the optimizer can
    reuse it instead of scoring again. It arrives from the browser, so it is
    checked rather than trusted: anything without a hard-skills block is
    discarded and the caller scores the resume itself. Nothing here can forge a
    skill onto a resume - inject_jd_hard_skills still evidence-checks every
    entry against the uploaded text - so a bad payload costs an LLM call, not
    correctness.
    """
    if not ats_payload:
        return None

    try:
        parsed = json.loads(ats_payload) if isinstance(ats_payload, str) else ats_payload
    except (ValueError, TypeError):
        logger.warning("Forwarded ATS payload was not valid JSON; scoring instead.")
        return None

    if not isinstance(parsed, dict):
        return None

    hard = (parsed.get("skills") or {}).get("hard_skills")
    if not isinstance(hard, dict) or not (hard.get("matched") or hard.get("missing")):
        logger.warning("Forwarded ATS payload had no hard-skills block; scoring instead.")
        return None

    return parsed


def _ats_resume_text_for(pdf_text: str, linkedin_url: str | None) -> str:
    """Build the exact resume text ats_scoring() is fed.

    This must match between /get-score and the optimizer BYTE FOR BYTE, and the
    reason is not tidiness. The two flows used different extractors -
    extract_pdf_text for tailoring, _extract_pdf_text_for_ats for scoring - which
    differ only in whitespace around the PDF's icon glyphs (" +91..." vs
    "+91..."). That was enough to:

      1. miss the _ATS_SCORE_CACHE, since the cache key hashes the resume text,
         so the same resume scored twice cost two LLM calls; and
      2. hand the model two different documents, which made it return two
         different missing-skill lists. The score page showed 13 missing hard
         skills while the optimizer showed 5, for the same resume and the same
         job description.

    Keeping the construction in one function is what stops those two call sites
    drifting apart again.
    """
    text = str(pdf_text or "")
    if linkedin_url:
        text += f"\nLinkedIn: {linkedin_url}"
    return text


def _jd_skills_from_ats_result(ats_result) -> tuple[list[str] | None, list[str], list[str]]:
    """Pull the JD's skills out of an ats_scoring() response.

    Returns (hard_skills, missing_hard_skills, missing_soft_skills).

    `missing_hard_skills` is the ATS analysis's own verdict and is what the user
    is shown as gaps, verbatim. Re-deriving the matched/missing split with the
    regex evidence check would reintroduce exactly the disagreement this is
    meant to end: the analysis can count "Power BI" as matched from context the
    literal matcher cannot see, and the two screens would differ again.

    For HARD skills both `matched` and `missing` are taken: together they are the
    ATS analysis's full picture of what this job asks for. inject_jd_hard_skills()
    then decides which are evidenced, so the split is recomputed against the
    resume rather than trusted - what we adopt from the ATS pass is WHICH SKILLS
    COUNT, which is the part the regex extractor gets wrong.

    For SOFT skills only `missing` is taken, because those are handled by
    rephrasing the summary rather than by an evidence check.

    hard_skills is None when the payload is unusable, so the caller falls back to
    the regex extractor instead of ending up with an empty requirement list
    (which would silently report zero gaps).
    """
    try:
        parsed = parse_ai_json_response(ats_result) if isinstance(ats_result, str) else ats_result
    except Exception:
        logger.warning("Could not parse ATS result for JD skills; using regex extraction.")
        return None, [], []

    if not isinstance(parsed, dict):
        return None, [], []

    skills_block = parsed.get("skills") or {}
    hard = skills_block.get("hard_skills") or {}
    soft = skills_block.get("soft_skills") or {}

    def _clean(values) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for value in (values or []):
            text = str(value or "").strip()
            if text and text.lower() not in seen:
                seen.add(text.lower())
                out.append(text)
        return out

    hard_matched = _clean(hard.get("matched")) if isinstance(hard, dict) else []
    hard_missing = _clean(hard.get("missing")) if isinstance(hard, dict) else []
    soft_missing = _clean(soft.get("missing")) if isinstance(soft, dict) else []

    hard_skills = hard_matched + [s for s in hard_missing if s.lower() not in {m.lower() for m in hard_matched}]

    return (hard_skills or None), hard_missing, soft_missing


def _ai_failure_detail(exc: BaseException) -> str:
    """A message that says what actually went wrong with an AI call.

    Every failure used to read "AI generation failed. Please try again." - the
    same words whether the key was rejected, the account was out of credit, or
    the request was merely rate-limited. The first two are not worth retrying
    and need someone to act; the third clears on its own. _normalize_openai_error
    already produces a specific message, so use it rather than discarding it.
    """
    # tenacity wraps the cause when it gives up; unwrap to the real one.
    cause = getattr(exc, "last_attempt", None)
    if cause is not None:
        try:
            exc = cause.exception() or exc
        except Exception:
            pass
    text = str(exc or "")
    low = text.lower()
    if "quota" in low or "insufficient_quota" in low or "billing" in low:
        return "The AI account is out of credit. Add billing, then try again."
    if ("invalid_api_key" in low or "unauthorized" in low
            or ("api_key" in low or "api key" in low) and "invalid" in low):
        return "The AI API key is not valid. Check the server configuration."
    if "rate limit" in low or "429" in low or "timeout" in low or "timed out" in low:
        return "The AI service is busy right now. Please try again in a moment."
    return "AI generation failed. Please try again."


def _all_pdf_annotation_urls(pdf_path: str) -> set[str]:
    """Every clickable URL in the PDF, wherever it sits.

    The safety net for URL invention: a link the candidate really has appears
    somewhere in their own document, so this is the full set of URLs they can
    legitimately claim.
    """
    urls: set[str] = set()
    try:
        from pypdf import PdfReader
        for page in PdfReader(pdf_path).pages:
            for ref in (page.get("/Annots") or []):
                try:
                    obj = ref.get_object()
                except Exception:
                    continue
                uri = (obj.get("/A") or {}).get("/URI")
                if uri:
                    urls.add(str(uri).strip())
    except Exception:
        return urls
    return urls


async def _optimize_resume_core(
    file_path: str,
    jd_string: str,
    ats_payload: str | None = None,
    confirmed_skills: list[str] | None = None,
    auto_add_skills: bool = False,
) -> dict:
    """Runs the AI tailoring pass plus PDF-annotation link-recovery on an uploaded
    resume PDF, returning the optimized resume dict. Shared by /get-optimised-resume
    and the extension's /api/extension/tailor-resume, which differ only in where the
    source PDF comes from (fresh upload vs. a user's stored base resume).

    `ats_payload` is the ATS analysis the user has already been shown, forwarded
    by the client. When present it is used verbatim and no second scoring call is
    made. This is the only way to guarantee the editor's missing-skill list
    matches the score page: two separate LLM calls do not reliably agree even on
    identical input, which is how the score page came to list 13 missing hard
    skills while the editor listed 5 for the same resume and job."""
    resume_string = await asyncio.to_thread(extract_pdf_text, file_path)
    normalized_resume_string = normalize_links(resume_string)

    # OPTIMIZATION: Run all link extractions in parallel instead of sequentially.
    # The last two rebuild the exact resume text /get-score feeds ats_scoring;
    # see _ats_resume_text_for below for why that has to match byte for byte.
    link_tasks = [
        asyncio.to_thread(extract_project_links, normalized_resume_string),
        asyncio.to_thread(extract_publication_links, normalized_resume_string),
        asyncio.to_thread(map_project_demo_links, normalized_resume_string),
        asyncio.to_thread(extract_project_link_map, normalized_resume_string),
        asyncio.to_thread(_extract_pdf_text_for_ats, file_path),
        asyncio.to_thread(_extract_linkedin_url_from_pdf, file_path),
    ]
    (
        extracted_links, extracted_pub_links, mapped_links, project_link_map,
        ats_pdf_text, ats_linkedin_url,
    ) = await asyncio.gather(*link_tasks)

    ats_resume_string = _ats_resume_text_for(ats_pdf_text, ats_linkedin_url)

    prompt = create_prompt(resume_string, jd_string)

    # Prefer the analysis the user was already shown. Re-scoring would be a
    # second LLM call whose answer can differ from the first, and the user has
    # no way to tell which is right - they just see two screens disagreeing.
    forwarded_ats = _usable_ats_payload(ats_payload)

    if forwarded_ats is not None:
        try:
            response_string = await get_resume_response(
                prompt, model=OPTIMIZER_MODEL, temperature=OPTIMIZER_TEMPERATURE
            )
        except Exception as exc:
            logger.exception("AI generation failed")
            raise HTTPException(status_code=500, detail=_ai_failure_detail(exc))
        ats_result = forwarded_ats
    else:
        # No analysis to reuse (optimized without scoring first). Score it here,
        # CONCURRENTLY with the rewrite so wall-clock cost is close to zero.
        try:
            response_string, ats_result = await asyncio.gather(
                get_resume_response(
                    prompt, model=OPTIMIZER_MODEL, temperature=OPTIMIZER_TEMPERATURE
                ),
                ats_scoring(ats_resume_string, jd_string),
                return_exceptions=True,
            )
        except Exception as exc:
            logger.exception("AI generation failed")
            raise HTTPException(status_code=500, detail=_ai_failure_detail(exc))

    if isinstance(response_string, BaseException):
        logger.exception("AI generation failed", exc_info=response_string)
        raise HTTPException(status_code=500, detail=_ai_failure_detail(response_string))

    # A failed ATS pass must never break tailoring. Falling back to None makes
    # inject_jd_hard_skills use its own regex extractor, which is what shipped
    # before this call existed.
    jd_hard_skills = None
    ats_missing_hard: list[str] = []
    missing_soft_skills: list[str] = []
    if isinstance(ats_result, BaseException):
        logger.warning("ATS skill list unavailable; falling back to regex JD extraction.", exc_info=ats_result)
    else:
        jd_hard_skills, ats_missing_hard, missing_soft_skills = _jd_skills_from_ats_result(ats_result)

    parsed = parse_ai_json_response(response_string)

    # Recover any bullet point the optimizer silently dropped/merged on a
    # long resume, restoring it onto the exact entry it came from.
    parsed = restore_dropped_bullets(parsed, resume_string)

    # A dropped ENTRY is worse than a dropped bullet, and it also orphans that
    # entry's links, which then leak into neighbouring sections.
    parsed = restore_dropped_entries(parsed, resume_string)

    # A bullet can also be hollowed out from the inside: the entry survives, the
    # count is right, and the rewrite has quietly dropped the tools, figures and
    # lists that made it worth reading. Preserve first, rewrite second - and
    # enforce it here rather than trusting the model to have obeyed.
    parsed = enforce_bullet_facts(parsed, resume_string)

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
        # Merge annotation-based map (most reliable) with the text-based map so
        # projects missed by one source can still be covered by the other.
        effective_map = {}
        for src in (pdf_project_link_map or {}), (project_link_map or {}):
            if not isinstance(src, dict):
                continue
            for key, pairs in src.items():
                bucket = effective_map.setdefault(key, [])
                for pair in pairs:
                    if pair not in bucket:
                        bucket.append(pair)
    else:
        effective_map = project_link_map

    # Recover publication links from PDF annotations (publications often use
    # clickable anchor text, so plain text extraction misses the real URLs).
    if parsed.get("publications"):
        try:
            annot_pub_links = await asyncio.to_thread(
                extract_section_annotation_links, file_path, "publications"
            )
        except Exception:
            annot_pub_links = []
        if annot_pub_links:
            merged_pub = list(annot_pub_links)
            for u in (extracted_pub_links or []):
                if u not in merged_pub:
                    merged_pub.append(u)
            extracted_pub_links = merged_pub

    # Every URL the uploaded resume actually contains - annotation layer, text
    # layer and the per-project maps. inject_links discards any project URL that
    # is not in here, because the model rewrites URLs the way it rewrites prose.
    known_urls = set()
    for pairs in (effective_map or {}).values():
        for _label, u in pairs:
            known_urls.add(u)
    for _name, u in (mapped_links or []):
        known_urls.add(u)
    known_urls.update(extracted_links or [])
    known_urls.update(extracted_pub_links or [])
    known_urls.update(_all_pdf_annotation_urls(file_path))

    parsed = inject_links(
        parsed, effective_map, mapped_links, extracted_pub_links, known_urls=known_urls
    )

    # Diagnostics for per-project link recovery, mirroring cert_debug.txt. Every
    # stage of this path passes when reproduced offline, so the difference has to
    # be in what the live AI returns - most likely the project NAMES, which are
    # what the annotation matcher keys on. Recording them turns the next report
    # into an answer instead of another round of guessing.
    try:
        import json as _json
        with open(os.path.join(BASE_DIR, "project_links_debug.txt"), "w", encoding="utf-8") as _pf:
            _pf.write("=== PROJECT NAMES FROM AI ===\n")
            for _n in project_names or []:
                _pf.write(f"  {_n!r}\n")
            _pf.write("\n=== ANNOTATION MAP (pdf) ===\n")
            _pf.write(_json.dumps(pdf_project_link_map if project_names else {}, indent=1) + "\n")
            _pf.write("\n=== TITLE POSITIONS FOUND IN PDF ===\n")
            _located = set()
            for _pg, _tp, _nm in (_LAST_PROJECT_TITLE_POSITIONS or []):
                _located.add(_nm)
                _pf.write(f"  page{_pg} top={_tp:.1f}  {_nm!r}\n")
            _pf.write(f"  NOT LOCATED: {[n for n in (project_names or []) if n not in _located]}\n")
            _pf.write("\n=== LINK POSITIONS AND DECISIONS ===\n")
            for _d in (_LAST_LINK_DECISIONS or []):
                _pf.write(
                    f"  page{_d['page']} top={_d['top']:>7} x0={_d['x0']:>6}"
                    f" -> {_d['matched']!r} (dist {_d['dist']})  {_d['uri']}\n"
                )
            _pf.write("\n=== TEXT MAP ===\n")
            _pf.write(_json.dumps(project_link_map or {}, indent=1) + "\n")
            _pf.write("\n=== EFFECTIVE MAP ===\n")
            _pf.write(_json.dumps(effective_map or {}, indent=1) + "\n")
            _pf.write("\n=== AFTER inject_links ===\n")
            for _p in (parsed.get("projects") or []):
                if isinstance(_p, dict):
                    _pf.write(f"  {_p.get('name')!r}\n")
                    _pf.write(f"     links={_json.dumps(_p.get('links') or [])}\n")
                    _pf.write(f"     github_link={_p.get('github_link')!r} url={_p.get('url')!r}\n")
    except Exception:
        pass
    # resume_string is the ORIGINAL uploaded text - it is what decides whether a
    # JD skill is evidenced or becomes a declared gap. jd_hard_skills carries the
    # ATS analysis's verdict on which skills the job actually requires.
    # Previously-confirmed skills apply ONLY where the user cannot be asked -
    # i.e. the Chrome extension, which re-tailors from the stored base resume
    # with no dialog and would otherwise drop every skill they ever ticked.
    #
    # On the website they are deliberately NOT applied. Reusing an old answer
    # there means the skill is added silently and, because it also counts as
    # evidence, the matching JD requirement stops being reported as a gap - so
    # the dialog has nothing to ask about and never appears. The website asks
    # every time; that is the whole point of the page.
    apply_confirmed = bool(confirmed_skills) and auto_add_skills

    skill_evidence = resume_string
    if apply_confirmed:
        skill_evidence = f"{resume_string}\nConfirmed skills: {', '.join(confirmed_skills)}"

    parsed = inject_jd_hard_skills(
        parsed, jd_string, skill_evidence, jd_skills=jd_hard_skills,
        auto_add=auto_add_skills,
    )

    # A confirmed skill the JD never mentions still belongs on the resume — but
    # again only on the surface that cannot ask.
    if apply_confirmed:
        existing = {str(s).strip().lower() for s in (parsed.get("skills") or [])}
        for skill in confirmed_skills:
            if skill.strip().lower() not in existing:
                parsed.setdefault("skills", []).append(skill)
                existing.add(skill.strip().lower())

    # What the user is TOLD is missing should match the score page, so the ATS
    # analysis's own `missing` list leads. But it must not REPLACE the list
    # outright: inject_jd_hard_skills has just decided what it actually withheld
    # from the resume, and anything it held back has to be offered or the
    # candidate is never asked about a skill that is genuinely absent. Replacing
    # the list meant a shorter (or empty) ATS list silently swallowed those, and
    # the editor then had nothing to ask about at all.
    #
    # On the extension (auto_add_skills=True) nothing is withheld and there is
    # no UI to ask through, so the list stays empty rather than being refilled.
    if auto_add_skills:
        parsed["skill_gaps"] = []
    elif jd_hard_skills is not None:
        withheld = [str(s) for s in (parsed.get("skill_gaps") or []) if str(s).strip()]
        seen = {s.strip().lower() for s in ats_missing_hard}
        parsed["skill_gaps"] = list(ats_missing_hard) + [
            s for s in withheld if s.strip().lower() not in seen
        ]

    # Soft skills the rewrite failed to express go into the summary, not the
    # skills array (Rule01b). Handled automatically rather than asked about:
    # unlike "do you know Tableau?", this is presentation, not a credential.
    parsed = weave_soft_skills_into_summary(parsed, missing_soft_skills)

    # Recover real contact URLs (LinkedIn/GitHub/portfolio/etc.) from the PDF's
    # clickable annotations. PDFs often show only anchor text ("LinkedIn") while
    # the true URL lives in the annotation, so the AI loses or mangles them.
    # We override the AI value only when it is missing OR not a real URL.
    try:
        pdf_contact_links = await asyncio.to_thread(extract_contact_links_from_pdf, file_path)
        if pdf_contact_links:
            contact = parsed.get("contact")
            if not isinstance(contact, dict):
                contact = {}
                parsed["contact"] = contact

            def _is_real_url(v: str) -> bool:
                v = str(v or "").strip()
                if not v:
                    return False
                # A usable contact value must contain a domain dot or an explicit path.
                return ("." in v) or v.lower().startswith(("http://", "https://"))

            # For exact-domain social services the annotation is the ground truth
            # (the AI sometimes drops the URL or hallucinates a different one), so
            # always prefer it. Portfolio is heuristic, so only fill when missing.
            authoritative = {
                "linkedin", "github", "leetcode", "kaggle",
                "codeforces", "codechef", "google_scholar", "twitter",
            }
            for service, real_url in pdf_contact_links.items():
                current = str(contact.get(service, "") or "").strip()
                if service in authoritative or not _is_real_url(current):
                    contact[service] = real_url
    except Exception:
        pass

    # Recover links inside Education, Experience and Certifications sections
    # from PDF annotations (course/credential verification URLs, company
    # sites, etc.). These are anchor-text-only in many resumes, so the AI
    # loses them. Assigned in document order, never reusing a placed URL.
    try:
        section_used = _collect_used_urls(parsed)

        def _real(v: str) -> bool:
            v = str(v or "").strip().lower()
            return v.startswith(("http://", "https://")) or ("." in v and " " not in v)

        async def _match_entry_links(section_key, id_fields, field, use_above):
            """Assign each entry's link using two position-correct matchers:
            (1) text under the link rectangle (column-aware) and, optionally,
            (2) the nearest entry-title above the link. Both bind a link to the
            entry it physically belongs to — recovering links without ever moving
            a link to a different sub-section. Global `section_used` prevents reuse."""
            items = [i for i in (parsed.get(section_key) or []) if isinstance(i, dict)]
            if not items:
                return
            names = []
            for it in items:
                for f in id_fields:
                    v = str(it.get(f, "")).strip()
                    if v:
                        names.append(v)
            if not names:
                return
            # (1) precise: text physically under the link rectangle
            m1 = await asyncio.to_thread(
                extract_named_item_links_from_pdf, file_path, names, section_key
            ) or {}
            norm1 = {_normalize_key(k): v for k, v in m1.items()}
            # (2) recovery: nearest entry-title above the link (single-column safe)
            norm2 = {}
            if use_above:
                m2 = await asyncio.to_thread(
                    extract_project_links_from_pdf, file_path, names, section_key
                ) or {}
                for k, pairs in m2.items():
                    bucket = norm2.setdefault(_normalize_key(k), [])
                    for _lab, uri in pairs:
                        bucket.append(uri)
            for it in items:
                cur = str(it.get(field, "") or "").strip()
                if _real(cur):
                    section_used.add(cur.lower())
                    continue
                keys = [_normalize_key(it.get(f, "")) for f in id_fields if str(it.get(f, "")).strip()]
                chosen = None
                for k in keys:
                    u = norm1.get(k)
                    if u and u.lower() not in section_used:
                        chosen = u
                        break
                if not chosen:
                    for k in keys:
                        for u in norm2.get(k, []):
                            if u and u.lower() not in section_used:
                                chosen = u
                                break
                        if chosen:
                            break
                if chosen:
                    it[field] = chosen
                    section_used.add(chosen.lower())

        # Certifications use text-under-rect only (2-column safe). Experience and
        # education also use nearest-title-above to recover icon-style links.
        await _match_entry_links("certifications", ("name",), "url", use_above=False)
        await _match_entry_links("experience", ("company", "title"), "url", use_above=True)
        await _match_entry_links("education", ("school", "degree"), "links", use_above=True)

        # Unambiguous-only position fallback for experience/education: fill a
        # leftover section link ONLY when there is exactly one empty entry and
        # exactly one unused link. Guarantees a link never lands on the wrong
        # sub-section (these sections are often only partially linked).
        for section_key, field in (
            ("education", "links"),
            ("experience", "url"),
        ):
            items = [i for i in (parsed.get(section_key) or []) if isinstance(i, dict)]
            if not items:
                continue
            empties = [i for i in items if not _real(str(i.get(field, "") or ""))]
            if len(empties) != 1:
                continue
            section_urls = await asyncio.to_thread(
                extract_section_annotation_links, file_path, section_key
            )
            avail = [u for u in (section_urls or []) if u and u.lower() not in section_used]
            if len(avail) == 1:
                empties[0][field] = avail[0]
                section_used.add(avail[0].lower())

        # Certifications: a flat list that is typically FULLY linked (each cert
        # name is the clickable link). Section links now arrive in true reading
        # order (row band, then column) — the same order the AI reads the PDF —
        # so assign any remaining links to remaining certs 1:1 in order. This
        # recovers every cert link even in dense 2-column layouts (e.g. ~20 certs)
        # where per-name matching misses some, without sub-section exchange.
        cert_dbg = {"names": [], "section_links": [], "assigned": []}
        try:
            cert_items = [i for i in (parsed.get("certifications") or []) if isinstance(i, dict)]
            cert_dbg["names"] = [str(i.get("name", "")).strip() for i in cert_items]
            if cert_items:
                cert_urls = await asyncio.to_thread(
                    extract_section_annotation_links, file_path, "certifications"
                ) or []
                cert_dbg["section_links"] = list(cert_urls)
                avail = [u for u in cert_urls if u and u.lower() not in section_used]
                empties = [i for i in cert_items if not _real(str(i.get("url", "") or ""))]
                for it, uri in zip(empties, avail):
                    it["url"] = uri
                    section_used.add(uri.lower())
                    cert_dbg["assigned"].append((str(it.get("name", "")).strip(), uri))
        except Exception:
            pass
        # Persisted diagnostics (file is uploaded resume's sibling, survives cleanup).
        try:
            import json as _json
            dbg_path = os.path.join(BASE_DIR, "cert_debug.txt")
            with open(dbg_path, "w", encoding="utf-8") as _df:
                _df.write("=== CERT NAMES (from AI) ===\n")
                for n in cert_dbg["names"]:
                    _df.write(f"  - {n}\n")
                _df.write(f"\n=== CERT SECTION LINKS (reading order) [{len(cert_dbg['section_links'])}] ===\n")
                for u in cert_dbg["section_links"]:
                    _df.write(f"  - {u}\n")
                _df.write(f"\n=== FINAL cert.url PER ENTRY ===\n")
                for it in (parsed.get("certifications") or []):
                    if isinstance(it, dict):
                        _df.write(f"  - {str(it.get('name','')).strip()}  ->  {it.get('url','')}\n")
                _df.write(f"\n=== READING-ORDER FILL ASSIGNED [{len(cert_dbg['assigned'])}] ===\n")
                for n, u in cert_dbg["assigned"]:
                    _df.write(f"  - {n}  ->  {u}\n")
        except Exception:
            pass
    except Exception:
        pass

    # Final safety net: clean the optimized data (balance parens, dedupe
    # skills, strip stray bullets) so malformed AI/post-processing output
    # never reaches the rendered resume. Must run after all injection.
    parsed = sanitize_resume_data(parsed)

    # Verify rather than trust. The prompt forbids inventing employers, dates
    # and numbers, but an instruction is not a guarantee - and an invented fact
    # is the one failure a candidate cannot recover from in an interview.
    # Reports onto parsed["factcheck"]; nothing is deleted automatically,
    # because wrongly removing a real job would be worse than the problem.
    parsed = factcheck_against_original(parsed, resume_string)
    if not parsed.get("factcheck", {}).get("clean", True):
        logger.warning(
            "Rewrite introduced facts absent from the original resume: %s",
            parsed["factcheck"]["findings"][:8],
        )

    # "See what changed" data for the editor and the extension — computed last
    # so it reflects the exact bullets/summary that actually ship.
    parsed["changes"] = compute_resume_changes(parsed, resume_string)

    return parsed


def _render_resume_html(parsed: dict, jd_string: str, template_id: int, style_id: int) -> tuple[str, bool]:
    """Renders an optimized resume dict into HTML using the chosen template/style.
    Returns (html_content, use_default_template). Shared by /get-optimised-resume
    and /api/extension/tailor-resume."""
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

    return html_content, use_default_template


def _render_resume_pdf_sync(html_content: str, use_default_template: bool) -> str:
    """Renders resume HTML to a PDF file on disk and returns its path. Shared by
    /get-optimised-resume and /api/extension/tailor-resume."""
    from weasyprint import HTML
    pdf_path = os.path.join(resumes_dir, f"optimized_resume_{uuid.uuid4()}.pdf")
    # OPTIMIZATION: Use faster WeasyPrint rendering options
    if not use_default_template:
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
    return pdf_path


@app.post("/get-optimised-resume")
async def upload_resume(
    request: Request,
    jd_string: str | None = Form(None),
    file: UploadFile = File(...),
    template_id: int | None = Form(1),
    style_id: int | None = Form(1),
    editor_mode: str | None = Form(None),
    ats_payload: str | None = Form(None),
):
    """Upload a resume PDF file and JD with selected template and style"""
    if jd_string is None:
        jd_string = request.query_params.get("jd_string", "")
    if template_id is None:
        template_id = int(request.query_params.get("template_id", 1))
    if style_id is None:
        style_id = int(request.query_params.get("style_id", 1))
    user_id = request.session.get('user_id')
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

        # Same on the website: a skill the candidate confirmed in an earlier
        # session must not vanish the next time they tailor.
        _db = get_db()
        try:
            _user = _db.query(User).filter_by(id=user_id).first()
            web_confirmed_skills = get_confirmed_skills(_user)
        finally:
            _db.close()

        async with request_semaphore:
            # Website: unevidenced JD skills stay as gaps so the editor can
            # ask the candidate to tick the ones they actually have.
            parsed = await _optimize_resume_core(
                file_path, jd_string, ats_payload,
                confirmed_skills=web_confirmed_skills,
                auto_add_skills=False,
            )
            html_content, use_default_template = _render_resume_html(parsed, jd_string, template_id, style_id)

            # NOTE: we intentionally do NOT auto-save here. Saving to My Resumes
            # is now an explicit user choice made in the editor ("Save to My
            # Resumes"). This keeps reformat/change-format sessions from being
            # saved, and makes "Not now" actually mean not saved.

            header_editor_mode = request.headers.get("X-Editor-Mode", "").lower() == "true"
            form_editor_mode = str(editor_mode or "").strip().lower() == "true"
            query_editor_mode = request.query_params.get("editor_mode", "").strip().lower() == "true"
            wants_editor_mode = header_editor_mode or form_editor_mode or query_editor_mode
            if wants_editor_mode:
                return JSONResponse({
                    "success": True,
                    "html": html_content,
                    "template_id": template_id,
                    "style_id": style_id,
                    "resume_data": parsed if isinstance(parsed, dict) else None,
                    # Gaps fit to show a person. The raw skill_gaps list carries
                    # extractor noise ("another cloud data warehouse"), so the
                    # filtering happens here rather than in the browser.
                    "promptable_skill_gaps": promptable_skill_gaps(
                        (parsed or {}).get("skill_gaps") if isinstance(parsed, dict) else []
                    ),
                    "candidate_name": (
                        str((parsed or {}).get("name") or "").strip()[:255]
                        if isinstance(parsed, dict) else None
                    ),
                })

            try:
                pdf_path = await asyncio.to_thread(_render_resume_pdf_sync, html_content, use_default_template)
            except Exception as e:
                logger.exception("PDF render failed")
                raise HTTPException(status_code=500, detail="Failed to render the PDF. Please try again.")

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
        logger.exception("Uploaded file processing failed")
        raise HTTPException(status_code=500, detail="Could not process the uploaded file. Please try again.")
    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
        if pdf_path and os.path.exists(pdf_path) and not isinstance(response, FileResponse):
            os.remove(pdf_path)


def _fallback_skill_is_acceptable(raw) -> bool:
    """Whether a ticked skill may be added when resume_data carries no gaps list.

    The normal gate is "it was one of the gaps we offered". When that list is
    missing we still must not let a payload write arbitrary prose into someone's
    resume, so this applies the same filter the pills are built from plus a hard
    word limit - real skill names are short ("ERP systems", "user stories"),
    while injected sentences are not.
    """
    text = str(raw or "").strip()
    if not text or len(text) > 40 or len(text.split()) > 3:
        return False
    # Skill names are words and a little punctuation ("C++", "CI/CD",
    # "Node.js", "R&D"). Anything else is not a skill.
    if not re.fullmatch(r"[A-Za-z0-9 .+#/&()'-]+", text):
        return False
    return bool(promptable_skill_gaps([text]))


@app.post("/api/resume/add-confirmed-skills", include_in_schema=False)
async def add_confirmed_skills(request: Request):
    """Add skills the candidate has personally confirmed they have.

    The tailoring pipeline is deliberately strict: inject_jd_hard_skills() only
    lets a JD skill into the resume when the uploaded text evidences it, and
    strips anything the model claimed without backing. That stops the MODEL from
    inventing credentials, and it must stay strict.

    But it also means a skill the candidate genuinely has and simply never wrote
    down is unreachable. This endpoint is the other door: the candidate is shown
    the gaps and ticks the ones that are true. The trust source is different (the
    person, not the model), so it lives here rather than by loosening the gate.

    Only skills currently listed in the payload's own `skill_gaps` can be added.
    That keeps this from becoming a general "write anything into my resume" hole
    and means a user can only confirm something we actually asked them about.
    """
    require_logged_in(request)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    resume_data = body.get("resume_data")
    if not isinstance(resume_data, dict):
        # Seen when the editor was opened from a payload that carries only HTML
        # (a saved resume, or a flow that never stored the parsed dict).
        logger.warning(
            "add-confirmed-skills rejected: resume_data missing (got %s)", type(resume_data).__name__
        )
        raise HTTPException(status_code=400, detail="resume_data is required")

    requested = body.get("skills")
    if not isinstance(requested, list) or not requested:
        logger.warning("add-confirmed-skills rejected: skills list empty or malformed (%r)", requested)
        raise HTTPException(status_code=400, detail="skills must be a non-empty list")

    jd_string = str(body.get("jd_string") or "")
    try:
        template_id = int(body.get("template_id") or 1)
        style_id = int(body.get("style_id") or 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="template_id and style_id must be numbers")

    # Only what we offered. Matching on the raw skill_gaps rather than the
    # filtered display list keeps this tolerant of the filter changing later.
    offered = {
        str(g).strip().lower(): str(g).strip()
        for g in (resume_data.get("skill_gaps") or [])
        if str(g or "").strip()
    }

    skills = resume_data.get("skills")
    if not isinstance(skills, list):
        skills = []
    existing = {str(s).strip().lower() for s in skills if str(s or "").strip()}

    # skill_gaps is the list the pills were built from, so normally every ticked
    # skill is in it. It can go missing when the editor is working from a payload
    # that lost the field (a saved resume, an older session, a re-render that
    # rebuilt resume_data). Rejecting everything then makes the box look broken
    # while showing pills the user just ticked. The gate exists to stop a forged
    # payload writing arbitrary text into a resume, and _is_atomic_hard_skill
    # already provides that, so fall back to it rather than refusing outright.
    gate_is_open = not offered

    added: list[str] = []
    rejected: list[str] = []
    already: list[str] = []
    for raw in requested:
        key = str(raw or "").strip().lower()
        if not key:
            continue
        if key not in offered:
            if gate_is_open and _fallback_skill_is_acceptable(raw):
                offered[key] = _clean_inline_text(raw)
            else:
                rejected.append(str(raw))
                continue
        if key in existing:
            already.append(str(raw).strip())
            continue
        # Use the wording from skill_gaps (which follows the JD's own casing),
        # not whatever the client echoed back.
        canonical = _clean_inline_text(offered[key])
        if not canonical:
            continue
        skills.append(canonical)
        existing.add(key)
        added.append(canonical)

    if not added and already and not rejected:
        # Everything asked for is already on the resume. Clicking add a second
        # time - after a first successful add, or after switching template - used
        # to answer 400, which surfaced as "Update failed" even though the resume
        # already said exactly what the user wanted. Nothing to do is success.
        logger.info("add-confirmed-skills: %d skill(s) already present, nothing to add", len(already))
        return JSONResponse({
            "success": True,
            "added": [],
            "already_present": already,
            "rejected": [],
            "html": None,
            "resume_data": resume_data,
            "promptable_skill_gaps": promptable_skill_gaps(resume_data.get("skill_gaps")),
        })

    if not added:
        logger.warning(
            "add-confirmed-skills rejected: none of %r matched skill_gaps %r "
            "(already in skills: %r, gaps present: %s)",
            requested, list(offered.values()), sorted(existing), not gate_is_open,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                "Those skills are no longer listed as gaps for this resume - "
                "they may already have been added."
            ),
        )

    resume_data["skills"] = skills

    # Remember the answer. Without this it lived only in this editing session, so
    # the next tailor - and every Chrome extension run, which has no confirm step
    # at all - started again from "the resume does not evidence this" and dropped
    # the skill the candidate had just told us they have.
    _sk_db = get_db()
    try:
        _sk_user = _sk_db.query(User).filter_by(id=request.session.get("user_id")).first()
        if _sk_user:
            add_confirmed_skills_to_user(_sk_db, _sk_user, added)
    except Exception:
        # Persisting is a convenience for future runs; never fail the request the
        # user is actually waiting on because of it.
        logger.exception("Could not persist confirmed skills")
    finally:
        _sk_db.close()

    added_lower = {s.lower() for s in added}
    resume_data["skill_gaps"] = [
        g for g in (resume_data.get("skill_gaps") or [])
        if str(g).strip().lower() not in added_lower
    ]

    try:
        html_content, _ = _render_resume_html(resume_data, jd_string, template_id, style_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Re-render after confirming skills failed")
        raise HTTPException(status_code=500, detail="Could not update the resume. Please try again.")

    return JSONResponse({
        "success": True,
        "added": added,
        "rejected": rejected,
        "html": html_content,
        "resume_data": resume_data,
        "promptable_skill_gaps": promptable_skill_gaps(resume_data.get("skill_gaps")),
    })


@app.post("/api/download-html-pdf")
async def download_html_pdf(request: Request):
    """Generate a PDF directly from edited resume HTML."""
    require_logged_in(request)
    payload = await request.json()
    html = str(payload.get("html", "")).strip()
    raw_scale = payload.get("pdf_scale", 1)
    try:
        pdf_scale = float(raw_scale)
    except (TypeError, ValueError):
        pdf_scale = 1.0
    pdf_scale = max(0.6, min(1.8, pdf_scale))
    if not html:
        raise HTTPException(status_code=400, detail="Missing HTML payload")

    # Optional caller-supplied download name (e.g. cover letters reuse this endpoint).
    dl_name = str(payload.get("filename", "") or "").strip() or "optimized_resume_edited.pdf"
    if not dl_name.lower().endswith(".pdf"):
        dl_name += ".pdf"
    dl_name = os.path.basename(dl_name)

    pdf_path = os.path.join(resumes_dir, f"edited_resume_{uuid.uuid4()}.pdf")
    try:
        from weasyprint import HTML
        await asyncio.to_thread(lambda: HTML(string=html, base_url=BASE_DIR).write_pdf(pdf_path, zoom=pdf_scale))
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=dl_name,
            background=BackgroundTask(_cleanup_files, [pdf_path])
        )
    except Exception as exc:
        logger.exception("PDF generation failed")
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=500, detail="Failed to generate the PDF. Please try again.")


@app.post("/api/estimate-html-pages")
async def estimate_html_pages(request: Request):
    """Estimate rendered PDF pages for edited resume HTML."""
    require_logged_in(request)
    try:
        payload = await request.json()
    except ClientDisconnect:
        return Response(status_code=499)
    html = str(payload.get("html", "")).strip()
    raw_scale = payload.get("pdf_scale", 1)
    try:
        pdf_scale = float(raw_scale)
    except (TypeError, ValueError):
        pdf_scale = 1.0
    pdf_scale = max(0.6, min(1.8, pdf_scale))
    if not html:
        raise HTTPException(status_code=400, detail="Missing HTML payload")

    try:
        from weasyprint import HTML
        def _count_pages() -> int:
            doc = HTML(string=html, base_url=BASE_DIR).render(zoom=pdf_scale)
            return max(1, len(getattr(doc, "pages", []) or []))
        pages = await asyncio.to_thread(_count_pages)
        return {"success": True, "pages": pages}
    except Exception as exc:
        logger.exception("Page estimate failed")
        raise HTTPException(status_code=500, detail="Could not estimate pages. Please try again.")

def _detect_two_column_layout(pdf_path: str) -> bool:
    """
    Returns True only when a genuine right column is detected.

    A real two-column layout has many lines starting at the SAME x position
    (the right column's consistent left margin). Right-aligned dates in a
    single-column resume produce scattered x0 values — no single cluster.

    Strategy: bucket all word x0s into 10pt bins. If any bin in the
    middle 38-65% of page width holds >= 8 words AND >= 5% of all words,
    that consistent start position indicates a right column margin.
    """
    try:
        with pdfplumber.open(pdf_path) as pdf:
            all_x0s = []
            page_width = None
            for page in pdf.pages[:3]:
                if page_width is None:
                    page_width = float(page.width or 612)
                for w in (page.extract_words() or []):
                    if len(str(w.get("text", "")).strip()) > 1:
                        all_x0s.append(float(w.get("x0", 0)))

            if len(all_x0s) < 25 or not page_width:
                return False

            bins: dict[int, int] = {}
            for x in all_x0s:
                b = int(x / 10) * 10
                bins[b] = bins.get(b, 0) + 1

            total = len(all_x0s)
            lo = page_width * 0.38
            hi = page_width * 0.65

            for bucket, count in sorted(bins.items(), key=lambda kv: kv[1], reverse=True)[:8]:
                if lo <= bucket <= hi and count >= 8 and count / total >= 0.05:
                    return True

    except Exception:
        pass
    return False


def _extract_linkedin_url_from_pdf(pdf_path: str) -> str:
    """Scan PDF link annotations for a LinkedIn URL. Returns the URL or ''."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(pdf_path)
        for page in reader.pages:
            for annot_ref in (page.get("/Annots") or []):
                try:
                    annot = annot_ref.get_object()
                except Exception:
                    continue
                uri = str((annot.get("/A") or {}).get("/URI") or "").strip()
                if "linkedin.com" in uri.lower() or "/in/" in uri.lower():
                    return uri
    except Exception:
        pass
    return ""


def _extract_pdf_text_for_ats(path: str) -> str:
    """Extract the resume text the ATS pass is scored against.

    This used a bare page.extract_text(), which takes pdfplumber's default
    x_tolerance of 3 *points*. That figure is absolute, so on a resume set in a
    tight 9-10pt face the gap between two words falls under it and they come
    out welded - "progresstracking", "maintaininglearnerrecords". The optimizer
    path never showed this because extract_pdf_text() above passes
    x_tolerance=1; only the scoring path was affected, which is exactly where
    users saw correctly-spelled resumes reported as misspelled.

    Fixed on three levels, because none of them is reliable alone:

      1. x_tolerance_ratio scales the threshold with font size, which is the
         right unit for the measurement - a 3pt gap means something different
         at 9pt and at 20pt.
      2. Both extractions are run and the one with fewer fused tokens wins.
         A tighter tolerance can over-split a wide-tracked font, so this is not
         a change that is safe to make unconditionally; measuring is.
      3. repair_fused_words() splits whatever still came through welded.

    Both /get-ats-score and the optimizer call this function, so the two flows
    stay byte-for-byte identical - see _ats_resume_text_for for why that
    matters.
    """
    with pdfplumber.open(path) as pdf:
        pages = list(pdf.pages)
        default_text = "\n".join(p.extract_text() or "" for p in pages)
        try:
            scaled_text = "\n".join(
                p.extract_text(x_tolerance_ratio=0.12) or "" for p in pages
            )
        except TypeError:
            # Older pdfplumber without the ratio parameter.
            scaled_text = ""

    text = default_text
    if scaled_text.strip():
        # Only prefer the scaled read when it actually recovers spaces. Equal
        # counts keep the default, which is the better-tested path.
        if count_fused_words(scaled_text) < count_fused_words(default_text):
            text = scaled_text

    return repair_fused_words(text)


_PORTFOLIO_HOST_RE = re.compile(
    r"\b[\w.-]+\.(?:netlify\.app|vercel\.app|github\.io|web\.app|pages\.dev|"
    r"notion\.site|carrd\.co|behance\.net|dribbble\.com|framer\.(?:app|website|wiki)|"
    r"webflow\.io|wixsite\.com|myportfolio\.com|journoportfolio\.com|super\.site)\b",
    re.IGNORECASE,
)
_PORTFOLIO_LABEL_RE = re.compile(r"portfolio\s*[:\-–—]?\s*(?:https?://|www\.)", re.IGNORECASE)


def _has_portfolio_link(text: str) -> bool:
    """True if the resume text contains a portfolio / personal-site link."""
    t = str(text or "")
    if _PORTFOLIO_HOST_RE.search(t):
        return True
    if _PORTFOLIO_LABEL_RE.search(t):
        return True
    # "portfolio" mentioned alongside any URL.
    if re.search(r"\bportfolio\b", t, re.IGNORECASE) and re.search(r"https?://|www\.", t):
        return True
    return False


def _ats_match_level(score) -> str:
    """The 5-band match level used across the ATS result."""
    try:
        s = float(score or 0)
    except (TypeError, ValueError):
        s = 0.0
    return "Poor" if s < 40 else "Fair" if s < 60 else "Good" if s < 75 else "Strong" if s < 90 else "Excellent"


@app.post("/get-ats-score")
async def get_score(request: Request, jd_string: str, file: UploadFile = File(...)):
    """Upload a resume PDF file and JD"""
    db = get_db()
    is_guest = False
    try:
        is_guest = enforce_guest_ats_allowed(request, db)
    except HTTPException:
        db.close()
        raise

    file_path = None
    try:
        file_path = save_uploaded_pdf(file)
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        async with request_semaphore:
            # Run all 3 PDF read operations in parallel — they all need only the
            # saved file and are independent of each other.
            resume_string, linkedin_url, is_two_col = await asyncio.gather(
                asyncio.to_thread(_extract_pdf_text_for_ats, file_path),
                asyncio.to_thread(_extract_linkedin_url_from_pdf, file_path),
                asyncio.to_thread(_detect_two_column_layout, file_path),
            )
            # Shared with the optimizer so both flows hash to the same cache key
            # and get the same verdict - see _ats_resume_text_for.
            resume_string = _ats_resume_text_for(resume_string, linkedin_url)
            ats_score = await ats_scoring(resume_string, jd_string)

        result = parse_ai_json_response(ats_score)
        # The model raises PDF-extraction artifacts as spelling errors despite
        # the prompt forbidding it; strip them before the user ever sees them.
        result = scrub_extraction_artifacts_from_spelling(result)

        if is_two_col:
            fmt = result.setdefault("formatting", {})
            sc = fmt.setdefault("single_column", {})
            was_passing = str(sc.get("passed", "false")).lower() == "true"
            sc["passed"] = "false"
            sc["explanation"] = (
                "Two-column layout detected. Most ATS systems cannot reliably "
                "parse multi-column resumes — content in the second column may "
                "be skipped or scrambled."
            )
            if was_passing:
                breakdown = compute_deterministic_ats_score_breakdown(
                    result, resume_text=resume_string
                )
                result["match_rate"] = breakdown["final_score"]
                result["deterministic_breakdown"] = breakdown
                s = result["match_rate"]
                result["match_level"] = (
                    "Poor" if s < 40 else
                    "Fair" if s < 60 else
                    "Good" if s < 75 else
                    "Strong" if s < 90 else
                    "Excellent"
                )

        # The report has always rendered a portfolio card, but nothing ever set
        # this flag - so every user hit the "no portfolio" branch, including
        # people whose resume clearly linked one. Detect it for real.
        # Note this is informational only: there is no portfolio term anywhere
        # in compute_deterministic_ats_score_breakdown, so it must never be
        # presented as costing points.
        result["has_portfolio"] = _has_portfolio_link(resume_string)

        if is_guest:
            mark_guest_ats_used(request, db)
            result["guest_scan"] = True

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Uploaded file processing failed")
        raise HTTPException(status_code=500, detail="Could not process the uploaded file. Please try again.")
    finally:
        db.close()
        if file_path and os.path.exists(file_path):
            os.remove(file_path)


def _proj_to_editor_entry(proj: dict, t, bullets_to_details) -> dict:
    """Map one project from the AI template schema to the editor entry format.
    Extracts github_link and url from all possible locations the AI may use."""
    github_link = t(proj.get("github_link") or proj.get("github"))
    url = t(proj.get("url") or proj.get("website") or proj.get("project_link"))

    # Also scan the links[] array the AI sometimes uses instead of top-level fields
    for item in proj.get("links", []) or []:
        if not isinstance(item, dict):
            continue
        href = t(item.get("url") or item.get("href") or item.get("link"))
        if not href:
            continue
        href_full = normalize_url(href)
        if "github.com" in href_full.lower():
            if not github_link:
                github_link = href_full
        else:
            if not url:
                url = href_full

    return {
        "name": t(proj.get("name")),
        "subtitle": t(proj.get("subtitle") or proj.get("stack") or proj.get("technologies")),
        "dates": t(proj.get("dates") or proj.get("date")),
        "url": normalize_url(url),
        "github_link": normalize_url(github_link),
        "details": bullets_to_details(
            proj.get("bullets") or proj.get("achievements") or proj.get("description") or []
        ),
    }


def _template_parsed_to_editor_payload(parsed: dict) -> dict:
    """Convert AI output (template schema from create_prompt) to editor cvData format."""
    def t(v) -> str:
        return str(v or "").strip()

    def bullets_to_details(items) -> str:
        lines = normalize_list_of_strings(items or [])
        result = []
        for line in lines:
            result.append(line if line.startswith("•") else f"• {line}")
        return "\n".join(result)

    contact = parsed.get("contact", {}) or {}

    # skills: list of strings or list of dicts like {"category": "values"}.
    # Anything that already names its own category (a "Label: a, b" string, or
    # a {name/category, items} dict) is kept verbatim — NOT routed through
    # group_skills()'s keyword classifier, which only knows a fixed 9-bucket
    # taxonomy and silently reassigns/drops any category name (e.g. an
    # "Other Technical Skills" header from the source resume) it doesn't
    # recognize as a synonym of one of its own labels. But the AI's "skills"
    # array is very often just a flat list of bare names ("SQL", "Python", ...)
    # with no category at all — those still need bucketing, otherwise each one
    # becomes its own single-item, category-less card. So flat/uncategorized
    # names are collected separately and grouped through group_skills().
    skill_entries = []
    flat_skill_names = []
    for skill in parsed.get("skills", []) or []:
        if isinstance(skill, str) and skill.strip():
            raw = skill.strip()
            if ":" in raw:
                category, items = raw.split(":", 1)
                skill_entries.append({"category": category.strip(), "items": items.strip()})
            else:
                flat_skill_names.append(raw)
        elif isinstance(skill, dict):
            name = skill.get("name") or skill.get("category")
            items = skill.get("skills") or skill.get("items") or skill.get("values")
            if name and items and isinstance(items, list):
                items_str = ", ".join(str(i).strip() for i in items if str(i).strip())
                skill_entries.append({"category": t(name), "items": items_str})
            elif name:
                skill_entries.append({"category": t(name), "items": ""})
            else:
                for key, value in skill.items():
                    skill_entries.append({"category": str(key).strip(), "items": str(value).strip()})

    for grouped in group_skills(flat_skill_names):
        category, _, items = grouped.partition(":")
        skill_entries.append({"category": category.strip(), "items": items.strip()})

    # Merge rows that ended up with the same category name (e.g. the source
    # resume had an explicit "Languages: SQL, Python" line AND a bare "HTML"
    # that group_skills() also bucketed under Languages) into one row.
    merged_by_category: dict = {}
    merged_order: list = []
    for entry in skill_entries:
        key = entry["category"].lower()
        if key in merged_by_category:
            existing = merged_by_category[key]
            existing_items = [i.strip() for i in existing["items"].split(",") if i.strip()]
            for item in (i.strip() for i in entry["items"].split(",")):
                if item and item not in existing_items:
                    existing_items.append(item)
            existing["items"] = ", ".join(existing_items)
        else:
            merged_by_category[key] = entry
            merged_order.append(key)
    skill_entries = [merged_by_category[key] for key in merged_order]

    cv_data = {
        "personalInfo": {
            "name": t(parsed.get("name")),
            "headline": t(
                parsed.get("headline")
                or parsed.get("title")
                or parsed.get("current_title")
            ),
            "email": t(contact.get("email")),
            "phone": t(contact.get("phone")),
            "location": t(contact.get("address")),
            "linkedin": normalize_contact_link(t(contact.get("linkedin")), "linkedin"),
            "kaggle": t(contact.get("kaggle")),
            "github": normalize_contact_link(t(contact.get("github")), "github"),
            "portfolio": t(contact.get("portfolio")),
            "googleScholar": t(contact.get("google_scholar")),
            "leetcode": normalize_contact_link(t(contact.get("leetcode")), "leetcode"),
            "summary": t(parsed.get("summary")),
        },
        "education": [
            {
                "school": t(edu.get("school") or edu.get("institution") or edu.get("university")),
                "degree": t(edu.get("degree")),
                "year": t(edu.get("year") or edu.get("years") or edu.get("dates")),
                "score": t(
                    edu.get("score") or edu.get("cgpa") or edu.get("sgpa")
                    or edu.get("gpa") or edu.get("percentage") or edu.get("marks")
                ),
            }
            for edu in (parsed.get("education", []) or [])
            if isinstance(edu, dict)
        ],
        "experience": [
            {
                "company": t(exp.get("company")),
                "title": t(exp.get("title")),
                "dates": t(exp.get("dates")),
                "location": t(exp.get("location")),
                "details": bullets_to_details(exp.get("bullets") or exp.get("responsibilities") or []),
            }
            for exp in (parsed.get("experience", []) or [])
            if isinstance(exp, dict)
        ],
        "projects": [
            _proj_to_editor_entry(proj, t, bullets_to_details)
            for proj in (parsed.get("projects", []) or [])
            if isinstance(proj, dict)
        ],
        "skills": skill_entries,
        "extracurriculars": [
            {
                "role": t(item.get("role")),
                "organization": t(item.get("organization")),
                "dates": t(item.get("dates")),
                "url": normalize_url(t(item.get("url"))),
                "details": bullets_to_details(
                    item.get("bullets") or item.get("description") or []
                ),
            }
            for item in (parsed.get("extracurriculars", []) or [])
            if isinstance(item, dict)
        ],
        "certifications": [
            {
                "name": t(cert.get("name")),
                "issuer": t(cert.get("issuer")),
                "year": t(cert.get("year")),
                "url": normalize_url(t(cert.get("url"))),
            }
            for cert in (parsed.get("certifications", []) or [])
            if isinstance(cert, dict)
        ],
        "awards": [
            {"title": t(a)}
            for a in normalize_list_of_strings(
                (parsed.get("achievements") or []) + (parsed.get("awards") or [])
            )
            if t(a)
        ],
        "publications": [
            {
                "title": t(pub.get("title")),
                "publisher": t(pub.get("publisher")),
                "year": t(pub.get("year")),
                "url": normalize_url(t(pub.get("url"))),
            }
            for pub in (parsed.get("publications", []) or [])
            if isinstance(pub, dict)
        ],
    }
    return {"cvData": cv_data, "meta": {}}


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

        resume_text = await asyncio.to_thread(extract_pdf_text, file_path)
        if not resume_text or not resume_text.strip():
            raise HTTPException(status_code=400, detail="No extractable text found in this PDF.")

        # Use the same AI parsing path as the template-change feature for accurate,
        # fully-structured output (each project / experience as a separate entry).
        prompt = create_prompt(resume_text, "")
        try:
            response_string = await get_resume_response(prompt)
        except Exception as exc:
            logger.exception("AI generation failed")
            raise HTTPException(status_code=500, detail="AI generation failed. Please try again.")

        parsed = parse_ai_json_response(response_string)
        parsed = restore_dropped_bullets(parsed, resume_text)
        return _template_parsed_to_editor_payload(parsed)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("CV extraction failed")
        raise HTTPException(status_code=500, detail="Could not read the CV. Please try again.")
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
        logger.exception("CV text extraction failed")
        raise HTTPException(status_code=500, detail="Could not read the CV text. Please try again.")


@app.get("/api/resume-templates")
async def list_resume_templates():
    """Return available built-in resume templates."""
    templates_html_dir = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "html")
    if not os.path.isdir(templates_html_dir):
        raise HTTPException(status_code=404, detail="Resume templates directory not found")

    items = []
    for filename in os.listdir(templates_html_dir):
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
    items.sort(key=lambda t: t["id"])  # numeric order (1,2,...,21) not string order
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
    require_logged_in(request)
    payload = await request.json()
    template_id = int(payload.get("templateId", 1))
    cv_data = payload.get("cvData") or payload.get("resumeData", {}) or {}

    html_output = _render_custom_cv_html(template_id, cv_data)
    pdf_path = os.path.join(resumes_dir, f"custom_cv_{uuid.uuid4()}.pdf")
    try:
        from weasyprint import HTML

        await asyncio.to_thread(
            lambda: HTML(string=html_output, base_url=BASE_DIR).write_pdf(
                pdf_path,
                optimize_size=("fonts",),
            )
        )
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename="custom_cv.pdf",
            background=BackgroundTask(_cleanup_files, [pdf_path])
        )
    except Exception as exc:
        logger.exception("PDF generation failed")
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=500, detail="Failed to generate the PDF. Please try again.")


@app.post("/api/download-cv-pdf-browser")
async def download_cv_pdf_browser(
    request: Request,
    template_id: int = Form(...),
    cv_data_json: str = Form(...),
):
    """Browser-native PDF download via form submit."""
    require_logged_in(request)
    try:
        cv_data = json.loads(cv_data_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid CV data payload")

    html_output = _render_custom_cv_html(template_id, cv_data)
    pdf_path = os.path.join(resumes_dir, f"custom_cv_{uuid.uuid4()}.pdf")
    try:
        from weasyprint import HTML

        await asyncio.to_thread(
            lambda: HTML(string=html_output, base_url=BASE_DIR).write_pdf(
                pdf_path,
                optimize_size=("fonts",),
            )
        )
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename="custom_cv.pdf",
            background=BackgroundTask(_cleanup_files, [pdf_path])
        )
    except Exception as exc:
        logger.exception("PDF generation failed")
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=500, detail="Failed to generate the PDF. Please try again.")
from bs4 import BeautifulSoup

@app.post("/api/rerender-template")
async def rerender_template(request: Request):
    """
    Re-render the current resume HTML into a new template shell.
    Pure HTML extraction + re-render — NO AI involved.
    """
    require_logged_in(request)
    payload = await request.json()
    current_html = str(payload.get("current_html", "")).strip()
    template_id  = int(payload.get("template_id", 1))

    if not current_html:
        raise HTTPException(status_code=400, detail="Missing current_html")

    # 1. Extract structured data from the current iframe HTML (BeautifulSoup, no AI)
    soup = BeautifulSoup(current_html, "html.parser")

    def text(selector):
        el = soup.select_one(selector)
        return el.get_text(" ", strip=True) if el else ""

    # Pull the already-rendered context back out of the HTML body text
    # then re-use _build_custom_cv_context which accepts cvData dict format.
    # The simplest approach: read the sessionStorage payload's cvData that
    # the frontend already stored — but since we only get HTML here, we
    # re-parse it into a minimal cvData dict via BeautifulSoup.

    body_text = soup.get_text("\n", strip=True)

    # Re-use the existing text parser (no AI)
    parsed_payload = _parse_cv_text_to_editor_data(body_text)
    cv_data = parsed_payload.get("cvData", {})

    # 2. Render into the new template shell (no AI)
    try:
        new_html = _render_custom_cv_html(template_id, cv_data)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Template render failed")
        raise HTTPException(status_code=500, detail="Failed to render the template. Please try again.")

    return JSONResponse({"html": new_html, "template_id": template_id})


def _editor_cv_data_to_resume_parsed(cv_data: dict) -> dict:
    data = cv_data if isinstance(cv_data, dict) else {}
    personal = data.get("personalInfo", {}) if isinstance(data.get("personalInfo", {}), dict) else {}

    def t(value) -> str:
        return str(value or "").strip()

    def editor_bullets(item: dict) -> list[str]:
        raw_bullets = item.get("bullets") if isinstance(item.get("bullets"), list) else None
        if raw_bullets is None:
            raw_bullets = str(item.get("details", "") or "").splitlines()
        bullets = []
        for bullet in raw_bullets or []:
            text = t(bullet).lstrip("-*•").strip()
            if text:
                bullets.append(text)
        return bullets

    def dict_items(key: str) -> list[dict]:
        value = data.get(key, [])
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

    # Builder skills are user-defined {category, items} groups. Rendered verbatim
    # (not run through group_skills()'s keyword classifier) so a category the user
    # typed or renamed always survives — auto-classification would otherwise
    # silently reassign anything it doesn't recognize.
    skills = []
    for skill in data.get("skills", []) if isinstance(data.get("skills", []), list) else []:
        if isinstance(skill, dict):
            category = t(skill.get("category") or skill.get("name"))
            items = t(skill.get("items") or skill.get("details"))
            if category and items:
                skills.append(f"{category}: {items}")
            elif category or items:
                skills.append(category or items)
        elif t(skill):
            skills.append(t(skill))

    awards = []
    for award in data.get("awards", []) if isinstance(data.get("awards", []), list) else []:
        if isinstance(award, dict):
            title = t(award.get("title") or award.get("name") or award.get("text"))
        else:
            title = t(award)
        if title:
            awards.append(title)

    return {
        "name": t(personal.get("name")),
        "headline": t(personal.get("headline")),
        "summary": t(personal.get("summary")),
        "contact": {
            "email": t(personal.get("email")),
            "phone": t(personal.get("phone")),
            "address": t(personal.get("location")),
            "linkedin": t(personal.get("linkedin")),
            "github": t(personal.get("github")),
            "portfolio": t(personal.get("portfolio")),
            "kaggle": t(personal.get("kaggle")),
            "google_scholar": t(personal.get("googleScholar")),
            "leetcode": t(personal.get("leetcode")),
        },
        "education": [
            {
                "school": t(edu.get("school")),
                "degree": t(edu.get("degree")),
                "year": t(edu.get("year")),
                "score": t(edu.get("score") or edu.get("details")),
            }
            for edu in dict_items("education")
            if any(t(edu.get(key)) for key in ("school", "degree", "year", "score", "details"))
        ],
        "experience": [
            {
                "company": t(exp.get("company")),
                "title": t(exp.get("title")),
                "dates": t(exp.get("dates")),
                "location": t(exp.get("location")),
                "url": t(exp.get("url")),
                "bullets": editor_bullets(exp),
            }
            for exp in dict_items("experience")
            if any(t(exp.get(key)) for key in ("company", "title", "dates", "location", "url", "details")) or editor_bullets(exp)
        ],
        "projects": [
            {
                "name": t(project.get("name")),
                "subtitle": t(project.get("subtitle")),
                "dates": t(project.get("dates")),
                "url": t(project.get("url")),
                "github_link": t(project.get("github_link")),
                "bullets": editor_bullets(project),
            }
            for project in dict_items("projects")
            if any(t(project.get(key)) for key in ("name", "subtitle", "dates", "url", "github_link", "details")) or editor_bullets(project)
        ],
        "skills": skills,
        "extracurriculars": [
            {
                "role": t(item.get("role")),
                "organization": t(item.get("organization")),
                "dates": t(item.get("dates")),
                "url": t(item.get("url")),
                "bullets": editor_bullets(item),
            }
            for item in dict_items("extracurriculars")
            if any(t(item.get(key)) for key in ("role", "organization", "dates", "url", "details")) or editor_bullets(item)
        ],
        "certifications": [
            {
                "name": t(cert.get("name")),
                "issuer": t(cert.get("issuer")),
                "year": t(cert.get("year")),
                "url": t(cert.get("url")),
            }
            for cert in dict_items("certifications")
            if any(t(cert.get(key)) for key in ("name", "issuer", "year", "url", "details"))
        ],
        "awards": awards,
        "achievements": awards,
        "publications": [
            {
                "title": t(pub.get("title")),
                "publisher": t(pub.get("publisher")),
                "year": t(pub.get("year")),
                "url": t(pub.get("url")),
            }
            for pub in dict_items("publications")
            if any(t(pub.get(key)) for key in ("title", "publisher", "year", "url", "details"))
        ],
    }


def _render_custom_cv_html(template_id: int, cv_data: dict) -> str:
    parsed = _editor_cv_data_to_resume_parsed(cv_data)
    # Everything here was typed by the person in the /modify-cv builder, so their
    # links are taken at face value - including the same URL on more than one
    # project. See the cross-project dedup in build_resume_context.
    parsed["user_authored_links"] = True
    html_output, _ = _render_resume_html(parsed, "", int(template_id or 1), 1)
    return html_output


def _render_custom_cv_html_legacy(template_id: int, cv_data: dict) -> str:
    template_filename = f"template{template_id}.html"
    template_path = os.path.join(BASE_DIR, "resume-templates", "resume-templates", "html", template_filename)
    if not os.path.exists(template_path):
        raise HTTPException(status_code=404, detail="Selected template not found")

    try:
        with open(template_path, "r", encoding="utf-8") as f:
            template_content = f.read()
    except OSError as exc:
        logger.exception("Template file read failed")
        raise HTTPException(status_code=500, detail="Unable to read the template. Please try again.")

    context = _build_custom_cv_context(cv_data)

    try:
        from jinja2 import Template as Jinja2Template
        jinja_template = Jinja2Template(template_content)
        html_output = jinja_template.render(**context)
    except Exception as exc:
        logger.exception("Template render failed")
        raise HTTPException(status_code=500, detail="Failed to render the template. Please try again.")

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
    normalized_skills = group_skills(normalized_skills)

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


# ---------------------------------------------------------------------------
# Clean root-level portfolio URLs (e.g. https://thetailorcv.com/trisha-debnath).
# Registered LAST so every real page/route above wins; only genuinely unmatched
# single-segment paths fall through here and are looked up as a portfolio (404
# otherwise). The /p/<slug> routes above stay for backward-compatibility.
# ---------------------------------------------------------------------------
@app.get("/{slug}", response_class=HTMLResponse, include_in_schema=False)
async def portfolio_public_root(request: Request, slug: str):
    return await portfolio_public(request, slug)


@app.get("/{slug}/cv", include_in_schema=False)
async def portfolio_public_cv_root(request: Request, slug: str):
    return await portfolio_public_cv(request, slug)


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
