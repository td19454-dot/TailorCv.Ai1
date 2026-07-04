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
from datetime import datetime, timedelta
import uuid

import pdfplumber
import tempfile
import shutil
import uvicorn
from dotenv import load_dotenv
from pydantic import ValidationError
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
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
    create_prompt,
    get_resume_response,
    extract_links,
    inject_links,
    inject_jd_hard_skills,
    sanitize_resume_data,
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
)

from extraction import process_resume
from models import GuestAtsScan, JobApplication, PasswordResetToken, PersonalityCard, Portfolio, SavedResume, SignupVerificationCode, UsageRecord, User, WelcomeEmailLog
from sqlalchemy.exc import IntegrityError
from schemas import ForgotPasswordRequest, ResetPasswordRequest, SignupCodeRequest, UserLogin, UserLoginVerify, UserSignup
from routers.linkedin import router as linkedin_router
from routers.billing import router as billing_router
from blog_system import BlogService, codehilite_css, xml_escape


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
        "/api/billing/razorpay/webhook",
        "/api/billing/polar/webhook",
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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-CSRFToken", "X-Requested-With"],
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
    if "razorpay_subscription_id" not in cols:
        to_add.append("ADD COLUMN razorpay_subscription_id VARCHAR(100)" if is_pg else "ADD COLUMN razorpay_subscription_id TEXT")
    # One shared Netlify "live site" per user (reused across portfolios to save credits).
    if "netlify_site_id" not in cols:
        to_add.append("ADD COLUMN netlify_site_id VARCHAR(64)" if is_pg else "ADD COLUMN netlify_site_id TEXT")
    if "netlify_url" not in cols:
        to_add.append("ADD COLUMN netlify_url VARCHAR(255)" if is_pg else "ADD COLUMN netlify_url TEXT")
    if "netlify_portfolio_id" not in cols:
        to_add.append("ADD COLUMN netlify_portfolio_id INTEGER")
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

def is_pro(user) -> bool:
    """Return True iff the user currently has an active Pro subscription."""
    return bool(user and user.pro_until and user.pro_until > datetime.utcnow())


FREE_LIMITS: dict[str, int] = {
    "ai_optimizations": 3,
    "cover_letters": 3,
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
    from_addr = _resend_from()
    if not (api_key and from_addr):
        return False

    resend.api_key = api_key
    resend.Emails.send({
        "from": from_addr,
        "to": [recipient_email],
        "subject": "Welcome to TailorCV",
        "text": (
            f"Hi {recipient_name or 'there'},\n\n"
            "I am the Co-Founder of TailorCV, and I would love your feedback on our platform.\n\n"
            "Here are the tools you can explore:\n"
            "- https://thetailorcv.com/solutions: Optimizing resume for job description, Checking ATS score\n"
            "- https://thetailorcv.com/templates : ATS friendly resume templates\n"
            "- https://thetailorcv.com/modify-cv: Build resume from scratch\n"
            "- https://thetailorcv.com/interview-prep: Generate interview questions\n"
            "- https://thetailorcv.com/mock-interview: Mock interview practice\n\n"
            "Please reply to this email and share your feedback. It will really help us improve TailorCV.\n\n"
            "Thanks,\n"
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


def extract_pdf_text(path: str) -> str:
    text_parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=1, y_tolerance=3)
            if not words:
                text_parts.append(page.extract_text() or "")
                continue
            # Group words into lines by vertical position (4pt bucket) then sort left-to-right
            lines: dict[int, list] = {}
            for word in words:
                bucket = round(word["top"] / 4) * 4
                lines.setdefault(bucket, []).append(word)
            for bucket_key in sorted(lines):
                line_words = sorted(lines[bucket_key], key=lambda w: w["x0"])
                text_parts.append(" ".join(w["text"] for w in line_words))
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


def _detect_section_headings(pdf_path: str) -> list[tuple[int, float, str]]:
    """Return ordered (page_idx, top, section_name) for every detected section heading."""
    headings: list[tuple[int, float, str]] = []
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
                    placed = False
                    for ln in lines:
                        if abs(top - ln["top"]) <= 2.5:
                            ln["text"] = (ln["text"] + " " + t).strip()
                            ln["top"] = min(ln["top"], top)
                            placed = True
                            break
                    if not placed:
                        lines.append({"text": t, "top": top})
                for ln in lines:
                    nk = _normalize_key(ln["text"])
                    if nk in _SECTION_HEADING_KEYS and len(ln["text"].split()) <= 4:
                        headings.append((page_idx, float(ln["top"]), _SECTION_HEADING_KEYS[nk]))
    except Exception:
        return []
    headings.sort(key=lambda h: (h[0], h[1]))
    return headings


def _section_of(headings: list[tuple[int, float, str]], page_idx: int, top: float) -> str | None:
    """Which section a (page, top) position belongs to. None = header/contact region
    (above the first content heading)."""
    current = None
    for (hp, ht, name) in headings:
        if (hp, ht) <= (page_idx, top):
            current = name
        else:
            break
    return current


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
        # 3) Last resort: nearest project-name line anywhere on the page (closest center).
        #    Global URL dedup downstream still guarantees no link appears twice.
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
    enforce_section = any(name == section for (_p, _t, name) in headings)

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
            if enforce_section and _section_of(headings, page_idx, top) != section:
                continue

            matched_project, dist = match_project(top, bottom, candidates)
            if not matched_project:
                continue

            label = "GitHub" if "github.com" in lowered_uri else "Link"
            prev = best_for_uri.get(uri)
            # Keep the closest (most confident) project for each unique URL.
            if prev is None or dist < prev[1]:
                best_for_uri[uri] = (matched_project, dist, label)

    result: dict[str, list[tuple[str, str]]] = {}
    for uri, (project, _dist, label) in best_for_uri.items():
        result.setdefault(project, [])
        pair = (label, uri)
        if pair not in result[project]:
            result[project].append(pair)

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
                            if _section_of(headings, page_idx, top) not in header_ok:
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
    enforce_section = bool(section) and any(nm == section for (_p, _t, nm) in headings)
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
                if enforce_section and _section_of(headings, page_idx, r_top) != section:
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
_RESTORE_DATE_RANGE = (
    _RESTORE_DATE + r"\s*[-–—]\s*(?:" + _RESTORE_DATE + r"|" + _RESTORE_OPEN_END + r")"
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
        nk = _normalize_key(line)
        if nk in _SECTION_HEADING_KEYS and len(line.split()) <= 4:
            cur = _SECTION_HEADING_KEYS[nk]
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
        cands = []
        for i in range(start + 1, end):
            line = section_lines[i][0]
            # Hard boundary: a new entry title. Titles in virtually every template
            # carry a "|" stack/role separator while bullets never do — stopping
            # here prevents capturing a following entry the optimizer may have
            # dropped (which would otherwise be restored onto the wrong entry).
            if "|" in line and not _restore_is_meta_line(line):
                break
            if _restore_is_meta_line(line):
                continue
            clean = line.strip().lstrip(_RESTORE_MARKERS + " ").strip()
            if len(clean.split()) >= 3:
                cands.append(clean)
        result[ident] = cands
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
            cands = orig.get(ident)
            if not cands:
                continue
            # Drop candidates that are really this entry's own header row (role,
            # company, location) — e.g. "Data Analyst Research Intern Kolkata".
            header_values = [
                str(e.get(k, "")).strip()
                for k in ("company", "title", "role", "organization", "name", "location", "place", "city")
            ]
            header_values = [h for h in header_values if h]
            cands = [c for c in cands if not _restore_is_header_echo(c, header_values)]
            if not cands:
                continue
            ai_bullets = [str(b).strip() for b in (e.get("bullets") or []) if str(b).strip()]
            ai_tokens = set()
            for b in ai_bullets:
                ai_tokens |= _restore_tokens(b)
            added = False
            for c in cands:
                ct = _restore_tokens(c)
                if not ct:
                    continue
                shared = len(ct & ai_tokens) / len(ct)
                if shared < 0.4:  # most of this content is absent -> it was dropped
                    ai_bullets.append(c)
                    ai_tokens |= ct
                    added = True
            if added:
                e["bullets"] = ai_bullets
    return parsed


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
        "AI/ML": [],
        "Frameworks/Libraries": [],
        "Databases": [],
        "Tools & Platforms": [],
    }
    uncategorized = []

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
        "docker", "kubernetes", "k8s", "helm",
        "aws", "amazon web services", "azure", "gcp",
        "google cloud", "google cloud platform",
        "linux", "ubuntu", "centos",
        "vscode", "visual studio code", "visual studio",
        "postman", "insomnia", "swagger",
        "jenkins", "github actions", "gitlab ci", "circleci",
        "ci/cd", "ci", "cd", "devops",
        "mlflow", "dvc", "wandb", "weights & biases",
        "power bi", "powerbi", "tableau", "grafana",
        "excel", "jira", "confluence",
        "terraform", "ansible", "nginx", "apache",
        "vercel", "netlify", "heroku",
        "cloud platforms", "serverless",
        "kubeflow", "airflow", "prefect", "dagster", "kafka",
        "pytest", "jest", "selenium", "cuda", "jupyter"
    }

    def add_unique(bucket: list[str], value: str):
        if value and value not in bucket:
            bucket.append(value)

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
        if item_norm in ai_ml_terms:
            return "AI/ML"
        if item_norm in framework_terms:
            return "Frameworks/Libraries"
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
                                "tools and platforms", "platforms", "devops"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    add_unique(grouped["Tools & Platforms"], item)
                continue
            if label_lower in {"technologies/frameworks", "technologies", "frameworks",
                                "frameworks & libraries", "frameworks/libraries", "libraries",
                                "technologies & frameworks"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    cat = classify_item(item)
                    target = cat if cat not in ("uncategorized", "human_language") else "Frameworks/Libraries"
                    add_unique(grouped[target], item)
                continue
            if label_lower in {"ai", "ml", "ai/ml", "machine learning", "artificial intelligence",
                                "data science", "ai/ml & data science", "ai & ml"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    add_unique(grouped["AI/ML"], item)
                continue
            if label_lower in {"databases", "database", "db", "data stores", "data storage",
                                "databases & storage"}:
                for item in [p.strip() for p in value.split(",") if p.strip()]:
                    add_unique(grouped["Databases"], item)
                continue
            # Unknown label: classify each value item individually
            for item in [p.strip() for p in re.split(r"[,;]", value) if p.strip()]:
                cat = classify_item(item)
                if cat in ("uncategorized", "human_language"):
                    uncategorized.append(item)
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
                add_unique(grouped["Frameworks/Libraries"], item)
            else:
                add_unique(grouped[cat], item)

    result = []
    for label in ("Languages", "AI/ML", "Frameworks/Libraries", "Databases", "Tools & Platforms"):
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
            if not _h or _h in _seen_here or _h in seen_project_hrefs:
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
    return templates.TemplateResponse(request, "interview_prep.html", {"request": request})


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
    "name": "theTailorCV Team",
    "title": "Resume & ATS Specialists",
    "bio": (
        "The theTailorCV team builds an AI-powered resume optimizer and free ATS "
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


def build_blogposting_schema(post, canonical_url: str) -> str:
    image_url = post.image if str(post.image).startswith("http") else build_absolute_url(post.image or "/static/logo.png")
    author = {
        "@type": AUTHOR_PROFILE["type"],
        "name": AUTHOR_PROFILE["name"],
        "url": AUTHOR_PROFILE["url"],
        "sameAs": AUTHOR_PROFILE["sameAs"],
    }
    if AUTHOR_PROFILE["type"] == "Person":
        author["jobTitle"] = AUTHOR_PROFILE["title"]
    schema = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.title,
        "description": post.description,
        "image": [image_url],
        "author": author,
        "publisher": {
            "@type": "Organization",
            "name": "theTailorCV",
            "url": SITE_URL,
            "logo": {"@type": "ImageObject", "url": build_absolute_url("/static/logo.png")},
        },
        "datePublished": post.date_iso,
        "dateModified": post.lastmod_iso,
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
        "name": "theTailorCV ATS Score Checker & Resume Optimizer",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "url": build_absolute_url("/solutions"),
        "description": (
            "Free AI-powered ATS score checker and resume optimizer. Upload your "
            "resume and a job description to get an instant ATS score, missing "
            "keywords, and optimization tips."
        ),
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "publisher": {"@type": "Organization", "name": "theTailorCV", "url": SITE_URL},
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
        "Yes. theTailorCV's ATS score checker is completely free. Upload your "
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
        "systems can parse it correctly. theTailorCV's templates, including Jake's "
        "Resume template, are built to be ATS-friendly.",
    ),
    (
        "Can I practice mock interviews online?",
        "Yes. theTailorCV includes an AI mock interview tool that asks role-specific "
        "technical and behavioral questions, then gives real-time feedback and a "
        "scorecard so you can practice before your real interview.",
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
            "faq_schema_json": build_faq_page_schema(),
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
        "competitor": "Jobscan",
        "audience": "students, freshers & job seekers",
        "title": "Best Jobscan Alternative (2026) — Free ATS Score & Resume Optimizer",
        "description": "Looking for a Jobscan alternative? TheTailorCV gives you a free ATS score, AI resume tailoring, a built-in portfolio website builder, and affordable pricing.",
        "hero": "Get an instant ATS score, tailor your resume to any job description with AI, and even publish a live portfolio website — at a fraction of Jobscan's price.",
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "Check how your resume scores against any job description before you pay anything."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Turn your resume into a live portfolio site — something Jobscan doesn't offer."},
            {"icon": "price", "title": "Student friendly pricing", "link": "/pricing", "text": "Affordable plans built for freshers and students, not enterprise budgets."},
            {"icon": "ai", "title": "AI tailoring and interviews", "link": "/solutions", "text": "Rewrite bullets, match keywords, and practice AI mock interviews in one place."},
        ],
        "rows": [
            {"feature": "Free ATS score", "us": "<span class='yes'>✓</span> Yes", "them": "Limited free scans"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "Add-on"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "Premium / USD pricing"},
        ],
        "faq": [
            {"q": "Is TheTailorCV a good Jobscan alternative?", "a": "Yes. TheTailorCV offers a free ATS score, AI resume tailoring to a job description, a cover letter generator, AI mock interviews, and a portfolio website builder — at a more affordable price point than Jobscan."},
            {"q": "Is TheTailorCV free?", "a": "You can check your ATS score and build a portfolio for free. Pro unlocks unlimited optimizations, cover letters, mock interviews and a custom live site."},
            {"q": "Does TheTailorCV check my resume against the ATS like Jobscan?", "a": "Yes — paste your resume and a job description and you get a match score plus the missing keywords and fixes to raise it."},
            {"q": "Is TheTailorCV cheaper than Jobscan?", "a": "Yes. TheTailorCV is built to be affordable for students and freshers, with plans priced well below typical USD-based resume tools — and you can start for free."},
            {"q": "Can TheTailorCV build a portfolio website?", "a": "Yes. TheTailorCV turns your resume into a live, shareable portfolio website in minutes — no coding — which Jobscan does not offer."},
            {"q": "Does TheTailorCV write cover letters?", "a": "Yes. It generates personalized cover letters matched to each job description, so every application is tailored without starting from scratch."},
            {"q": "Is TheTailorCV good for freshers and students?", "a": "Absolutely. It's designed for first-time job seekers — get an ATS score, tailor your resume, add projects, and build a portfolio even with little or no experience."},
            {"q": "Can I practice interviews on TheTailorCV?", "a": "Yes. You get AI mock interviews with role-specific questions and instant feedback to help you prepare."},
        ],
    },
    "careerflow-alternative": {
        "competitor": "Careerflow",
        "audience": "students, freshers & job seekers",
        "title": "Best Careerflow Alternative (2026) — ATS Resume Optimizer & Portfolio Builder",
        "description": "A Careerflow alternative focused on getting your resume past the ATS: free ATS score, AI resume tailoring, cover letters, mock interviews, and a portfolio website builder.",
        "hero": "Go beyond LinkedIn tweaks. TheTailorCV scores your resume against the ATS, tailors it to each job with AI, and turns it into a live portfolio website.",
        "props": [
            {"icon": "target", "title": "ATS first", "link": "/solutions", "text": "Built around beating applicant tracking systems, not just polishing your LinkedIn."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Publish a real portfolio site from your resume in minutes."},
            {"icon": "ai", "title": "AI mock interviews", "link": "/mock-interview", "text": "Practice role-specific interviews with instant AI feedback."},
            {"icon": "doc", "title": "Tailored resumes and cover letters", "link": "/cover-letter", "text": "Match every application to its job description automatically."},
        ],
        "rows": [
            {"feature": "Free ATS score", "us": "<span class='yes'>✓</span> Yes", "them": "Limited"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "Varies"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Focus", "us": "ATS + resume + portfolio", "them": "LinkedIn optimization"},
        ],
        "faq": [
            {"q": "Is TheTailorCV a good Careerflow alternative?", "a": "Yes, especially if your priority is passing the ATS. TheTailorCV scores your resume against a job description, tailors it with AI, writes cover letters, runs mock interviews, and builds a portfolio website."},
            {"q": "What does TheTailorCV do that Careerflow doesn't?", "a": "TheTailorCV includes a portfolio website builder that turns your resume into a shareable live site, plus a dedicated ATS match score for every job description."},
            {"q": "Is there a free plan?", "a": "Yes — get a free ATS score and build a portfolio for free, then upgrade to Pro for unlimited use."},
            {"q": "Does TheTailorCV have an ATS score checker?", "a": "Yes. Paste your resume and a job description and you get a match score with the missing keywords and concrete fixes — the core focus of TheTailorCV."},
            {"q": "Can I build a portfolio website with TheTailorCV?", "a": "Yes. Turn your resume into a live, shareable portfolio site in minutes, with no coding required."},
            {"q": "Is TheTailorCV good for freshers and students?", "a": "Yes — it's designed for first-time job seekers, with affordable pricing and tools to present projects and skills even without much experience."},
            {"q": "How much does TheTailorCV cost?", "a": "You can start for free. Pro plans are affordable and unlock unlimited optimizations, cover letters, mock interviews and a custom live portfolio site."},
            {"q": "Can I practice mock interviews on TheTailorCV?", "a": "Yes. Practice role-specific AI mock interviews and get instant feedback to improve before the real thing."},
        ],
    },
    "resume-worded-alternative": {
        "competitor": "Resume Worded",
        "audience": "students, freshers & job seekers",
        "title": "Best Resume Worded Alternative (2026) — Free ATS Score, Resumes & Portfolio",
        "description": "A Resume Worded alternative with a free ATS score, AI resume tailoring to any job description, cover letters, mock interviews, and a portfolio website builder.",
        "hero": "Score and tailor your resume to each job, write cover letters, practice interviews, and publish a portfolio website — all in one place.",
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "Check your resume against a real job description before you pay anything."},
            {"icon": "doc", "title": "AI tailoring to a JD", "link": "/solutions", "text": "Rewrites bullets and adds missing keywords for the exact role you're applying to."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Turn your resume into a live, shareable site — Resume Worded doesn't."},
            {"icon": "ai", "title": "Mock interviews", "link": "/mock-interview", "text": "Practice role-specific AI interviews with instant feedback."},
        ],
        "rows": [
            {"feature": "Free ATS score", "us": "<span class='yes'>✓</span> Yes", "them": "Limited free credits"},
            {"feature": "Tailor resume to a job description", "us": "<span class='yes'>✓</span> Yes", "them": "Line-by-line tips"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "USD pricing"},
        ],
        "faq": [
            {"q": "Is TheTailorCV a good Resume Worded alternative?", "a": "Yes. TheTailorCV gives you a free ATS score, tailors your whole resume to a job description with AI, writes cover letters, runs mock interviews, and builds a portfolio site — broader than line-by-line scoring."},
            {"q": "Does TheTailorCV score my resume like Resume Worded?", "a": "Yes — paste your resume and a job description and you get a match score plus the missing keywords and fixes to raise it."},
            {"q": "Is it free?", "a": "You can check your ATS score and build a portfolio for free; Pro unlocks unlimited optimizations, cover letters and mock interviews."},
            {"q": "What does TheTailorCV add over Resume Worded?", "a": "A portfolio website builder and AI mock interviews, plus full AI rewriting tailored to each job — not just scoring suggestions."},
        ],
    },
    "teal-alternative": {
        "competitor": "Teal",
        "audience": "students, freshers & job seekers",
        "title": "Best Teal Alternative (2026) — ATS Resume Optimizer & Portfolio Builder",
        "description": "A Teal alternative for getting past the ATS: free ATS score, AI resume tailoring to a job description, cover letters, mock interviews, and a live portfolio website.",
        "hero": "Tailor your resume to each job, beat the ATS, practice interviews, and publish a portfolio site — affordable and built for first-time job seekers.",
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "Instant match score against any job description, free."},
            {"icon": "doc", "title": "AI resume tailoring", "link": "/solutions", "text": "Rewrites and aligns your resume to the role automatically."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Publish a shareable portfolio site from your resume in minutes."},
            {"icon": "ai", "title": "AI mock interviews", "link": "/mock-interview", "text": "Role-specific practice with instant feedback."},
        ],
        "rows": [
            {"feature": "Free ATS score", "us": "<span class='yes'>✓</span> Yes", "them": "Limited"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Yes", "them": "Keyword matching"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Job tracker", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "USD subscription"},
        ],
        "faq": [
            {"q": "Is TheTailorCV a good Teal alternative?", "a": "Yes, especially for ATS-first job seekers. TheTailorCV scores and rewrites your resume for each job, writes cover letters, runs mock interviews, and builds a portfolio website."},
            {"q": "What does TheTailorCV offer that Teal doesn't?", "a": "A portfolio website builder and AI mock interviews, plus full AI rewriting tailored to each job description."},
            {"q": "Is TheTailorCV cheaper than Teal?", "a": "Yes — it's priced affordably for students and freshers, and you can start for free."},
            {"q": "Does it work for freshers?", "a": "Yes — it's built for first-time job seekers, helping you present projects and skills even with little experience."},
        ],
    },
    "rezi-alternative": {
        "competitor": "Rezi",
        "audience": "students, freshers & job seekers",
        "title": "Best Rezi Alternative (2026) — Free ATS Score, AI Resumes & Portfolio",
        "description": "A Rezi alternative with a free ATS score, AI resume tailoring to a job description, cover letters, mock interviews, and a portfolio website builder.",
        "hero": "Get an ATS score, tailor your resume to each job with AI, write cover letters, practice interviews, and publish a portfolio website.",
        "props": [
            {"icon": "target", "title": "Free ATS score", "link": "/ats-analysis", "text": "See your match score against any job description for free."},
            {"icon": "doc", "title": "AI tailoring to a JD", "link": "/solutions", "text": "Aligns your resume to the exact role you're targeting."},
            {"icon": "globe", "title": "Portfolio website builder", "link": "/portfolio", "text": "Turn your resume into a live portfolio site — Rezi doesn't."},
            {"icon": "ai", "title": "AI mock interviews", "link": "/mock-interview", "text": "Practice and get instant feedback before the real thing."},
        ],
        "rows": [
            {"feature": "Free ATS score", "us": "<span class='yes'>✓</span> Yes", "them": "Limited free plan"},
            {"feature": "AI resume tailoring to a JD", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Portfolio website builder", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "AI mock interviews", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='no'>✗</span> No"},
            {"feature": "Cover letter generator", "us": "<span class='yes'>✓</span> Yes", "them": "<span class='yes'>✓</span> Yes"},
            {"feature": "Pricing", "us": "Affordable (₹ plans)", "them": "USD pricing"},
        ],
        "faq": [
            {"q": "Is TheTailorCV a good Rezi alternative?", "a": "Yes. TheTailorCV offers a free ATS score, AI resume tailoring to a job description, cover letters, AI mock interviews, and a portfolio website builder at an affordable price."},
            {"q": "Does TheTailorCV build resumes like Rezi?", "a": "Yes — it tailors and rewrites your resume to each job and gives you an ATS match score with the missing keywords."},
            {"q": "What's different from Rezi?", "a": "TheTailorCV adds a portfolio website builder and AI mock interviews, and is priced affordably for students and freshers."},
            {"q": "Is there a free option?", "a": "Yes — get a free ATS score and build a portfolio for free, then upgrade to Pro for unlimited use."},
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
        "seo_og_title": "Free Resume Examples by Job Role (2026) | theTailorCV",
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
        {"q": f"Is theTailorCV's ATS checker free for a {role_name} resume?",
         "a": "Yes. Paste your resume and a job description to get a free ATS score with the missing keywords and fixes before you apply."},
    ]
    article_schema = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": f"{role_name} Resume Example & Guide",
                "description": r["description"],
                "author": {"@type": "Organization", "name": "theTailorCV"},
                "publisher": {"@type": "Organization", "name": "theTailorCV"},
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
    finally:
        db.close()
    return templates.TemplateResponse(
        request,
        "optimized_editor.html",
        {"request": request, "is_pro": user_is_pro},
    )


@app.get("/modify-cv", response_class=HTMLResponse)
async def modify_cv_page(request: Request):
    """Manual CV editing page."""
    return templates.TemplateResponse(
        request,
        "modify_cv.html",
        {"request": request},
    )


@app.get("/my-resumes", response_class=HTMLResponse)
async def my_resumes_page(request: Request):
    """Dashboard of the logged-in user's saved (optimized) resumes."""
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse(url="/login?next=/my-resumes", status_code=302)
    db = get_db()
    try:
        resumes = (
            db.query(SavedResume)
            .filter(SavedResume.user_id == user_id)
            .order_by(SavedResume.created_at.desc())
            .all()
        )
    finally:
        db.close()
    return templates.TemplateResponse(
        request,
        "my_resumes.html",
        {"request": request, "resumes": resumes},
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
                if used > limit:
                    return RedirectResponse("/pricing", status_code=303)
        record = (
            db.query(SavedResume)
            .filter(SavedResume.id == resume_id, SavedResume.user_id == user_id)
            .first()
        )
        html_content = record.html_content if record else None
    finally:
        db.close()
    if not record:
        raise HTTPException(status_code=404, detail="Resume not found")
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
            "canonical_url": build_absolute_url("/cover-letter"),
            "software_schema_json": build_software_app_schema(),
            "page_schema_json": build_page_breadcrumb("AI Cover Letter Generator", "/cover-letter"),
        },
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

    prompt = (
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

    try:
        raw = await get_resume_response(prompt, model="gpt-4o-mini", temperature=0.4)
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
    "<meta name='robots' content='index,follow'><title>{title} | theTailorCV</title>"
    "<meta name='description' content='{title} for theTailorCV — AI resume optimization and ATS scoring.'>"
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
    "<body><div class='legal-top'><a href='/'>&larr; Back to theTailorCV</a></div>"
    "<div class='wrap'><h1>{title}</h1><p class='updated'>Last updated: {updated}</p>{body}"
    "<div class='legal-nav'><a href='/terms'>Terms of Service</a><a href='/privacy'>Privacy Policy</a>"
    "<a href='/refund'>Refund Policy</a><a href='/contact'>Contact</a></div></div></body></html>"
)


def _render_legal(title, body):
    return HTMLResponse(_LEGAL_PAGE.format(title=title, updated=LEGAL_LAST_UPDATED, body=body))


_PRIVACY_BODY = (
    "<div class='legal-card'><p>theTailorCV (\"theTailorCV\", \"we\", \"us\" or \"our\") operates the "
    "website <strong>www.thetailorcv.com</strong> and the related AI resume tools (the \"Service\"). "
    "This Privacy Policy explains what personal data we collect, why we collect it, how we use and "
    "share it, and the rights you have over it. By using the Service you agree to the practices "
    "described here.</p></div>"

    "<h2>1. Who we are</h2>"
    "<p>theTailorCV is an AI-powered resume optimization and ATS (Applicant Tracking System) scoring "
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
    "theTailorCV website at <strong>www.thetailorcv.com</strong> and its AI resume tools (the "
    "\"Service\"), operated by theTailorCV (\"we\", \"us\" or \"our\"). By creating an account or "
    "using the Service, you agree to these Terms. If you do not agree, do not use the Service.</p></div>"

    "<h2>1. The Service</h2>"
    "<p>theTailorCV provides AI-assisted resume optimization, ATS scoring, cover-letter generation, "
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
    "(Paddle.com Market Limited), which acts as the Merchant of Record for purchases on theTailorCV. "
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
    "owned by theTailorCV and protected by intellectual-property laws. We grant you a limited, "
    "revocable, non-transferable license to use the Service for its intended purpose. You may not copy "
    "or exploit it beyond that license.</p>"

    "<h2>9. Disclaimers</h2>"
    "<p>The Service is provided on an \"as is\" and \"as available\" basis, without warranties of any "
    "kind, express or implied, including merchantability, fitness for a particular purpose and "
    "non-infringement. We do not warrant that the Service will be uninterrupted, secure or error-free.</p>"

    "<h2>10. Limitation of liability</h2>"
    "<p>To the maximum extent permitted by law, theTailorCV and its team will not be liable for any "
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
    "paid plans on theTailorCV (<strong>www.thetailorcv.com</strong>). Payments are processed by "
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
        raw_response = await get_resume_response(prompt, model="gpt-4o-mini", temperature=0.7)
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
# Convention: image at static/portfolio-previews/<slug>.<ext>; demo is the Netlify URL.
PORTFOLIO_THEME_MEDIA = {
    "editor": {"image": "/static/portfolio-previews/editor.png", "demo": "https://karen-taylor-5.netlify.app/"},
    "nova": {"image": "/static/portfolio-previews/nova.png", "demo": "https://william-davis-7ef8.netlify.app/"},
    "codeflow": {"image": "/static/portfolio-previews/codeflow.png", "demo": "https://joseph-harris.netlify.app/"},
    "panels": {"image": "/static/portfolio-previews/panels.png", "demo": "https://mary-smith-2.netlify.app/"},
    "wave": {"image": "/static/portfolio-previews/wave.png", "demo": "https://trisha-debnath-8.netlify.app/"},
    "bold": {"image": "/static/portfolio-previews/bold.png", "demo": "https://shubham-sarkar-8.netlify.app/"},
    "terminal": {"image": "/static/portfolio-previews/terminal.png", "demo": "https://nicholas-walker.netlify.app/"},
    "clean": {"image": "/static/portfolio-previews/clean.png", "demo": "https://emma-martinez-ff85.netlify.app/"},
    "editorial": {"image": "/static/portfolio-previews/editorial.png", "demo": "https://amelia-clark.netlify.app/"},
    "vibrant": {"image": "/static/portfolio-previews/vibrant.png", "demo": "https://evelyn-harris.netlify.app/"},
    "console": {"image": "/static/portfolio-previews/console.png", "demo": "https://ryan-lewis.netlify.app/"},
    "monolith": {"image": "/static/portfolio-previews/monolith.png", "demo": "https://susan-garcia.netlify.app/"},
    "particle": {"image": "/static/portfolio-previews/particle.png", "demo": "https://jonathan-allen.netlify.app/"},
    "snowcard": {"image": "/static/portfolio-previews/snowcard.png", "demo": "https://lisa-martinez.netlify.app/"},
    "github": {"image": "/static/portfolio-previews/github.png", "demo": "https://karen-taylor.netlify.app/"},
    "parchment": {"image": "/static/portfolio-previews/parchment.png"},
    "assistant": {"image": "/static/portfolio-previews/assistant.png", "demo": "https://trisha-debnath.netlify.app/"},
    "cloud": {"image": "/static/portfolio-previews/cloud.png", "demo": "https://uttam-debnath.netlify.app/"},
    "neon": {"image": "/static/portfolio-previews/neon.png"},
    "brutalist": {"image": "/static/portfolio-previews/brutalist.png"},
    "hacker": {"image": "/static/portfolio-previews/hacker.png"},
    "magazine": {"image": "/static/portfolio-previews/magazine.png"},
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
        raw = await get_resume_response(prompt, model="gpt-4o-mini", temperature=0.6)
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
        "portfolio_domain": PORTFOLIO_DOMAIN,
        "subdomains_enabled": PORTFOLIO_SUBDOMAINS_ENABLED,
        "canonical_url": build_absolute_url("/portfolio"),
        "software_schema_json": build_software_app_schema(),
        "page_schema_json": build_page_breadcrumb("Portfolio Website Builder", "/portfolio"),
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
    results = blog_service.search_posts(query=q, tag=tag, category=category, page=page, per_page=9)
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
            "selected_tag": tag,
            "selected_category": category,
            "tags": filters["tags"],
            "categories": filters["categories"],
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


@app.get("/blog/{slug}", response_class=HTMLResponse)
async def blog_post_page(request: Request, slug: str):
    # Consolidate merged duplicates: permanent-redirect old slugs to their pillar.
    target = BLOG_REDIRECTS.get(slug)
    if target:
        return RedirectResponse(url=f"/blog/{target}", status_code=301)
    post = blog_service.get_post(slug)
    if post is None:
        raise HTTPException(status_code=404, detail="Blog post not found")
    related_posts = blog_service.related_posts(post, limit=3)
    canonical_url = build_absolute_url(f"/blog/{post.slug}")
    og_image = post.image if str(post.image).startswith("http") else build_absolute_url(post.image or "/static/logo.png")
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
            "blog_schema_json": build_blogposting_schema(post, canonical_url),
            "breadcrumb_schema_json": build_breadcrumb_schema(post, canonical_url),
            "faq_schema_json": build_faq_schema(post),
            "author_profile": AUTHOR_PROFILE,
            "related_resume_example": _BLOG_TO_ROLE.get(post.slug),
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
        ("/jobscan-alternative", "monthly", "0.7"),
        ("/careerflow-alternative", "monthly", "0.7"),
        ("/resume-worded-alternative", "monthly", "0.7"),
        ("/teal-alternative", "monthly", "0.7"),
        ("/rezi-alternative", "monthly", "0.7"),
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
    all_urls = static_urls + post_urls + role_urls

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
        if not user:
            # Auto-provision user on first login attempt so new users are persisted in DB.
            inferred_name = payload.email.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
            inferred_name = " ".join(part.capitalize() for part in inferred_name.split()) or "User"
            user = User(
                name=inferred_name[:120],
                email=payload.email.lower(),
                hashed_password=hash_password(payload.password),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        elif not verify_password(payload.password, user.hashed_password):
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


@app.post("/get-optimised-resume")
async def upload_resume(
    request: Request,
    jd_string: str | None = Form(None),
    file: UploadFile = File(...),
    template_id: int | None = Form(1),
    style_id: int | None = Form(1),
    editor_mode: str | None = Form(None),
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
                logger.exception("AI generation failed")
                raise HTTPException(status_code=500, detail="AI generation failed. Please try again.")

            parsed = parse_ai_json_response(response_string)

            # Recover any bullet point the optimizer silently dropped/merged on a
            # long resume, restoring it onto the exact entry it came from.
            parsed = restore_dropped_bullets(parsed, resume_string)

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

            parsed = inject_links(parsed, effective_map, mapped_links, extracted_pub_links)
            parsed = inject_jd_hard_skills(parsed, jd_string)

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
                    "resume_data": parsed if isinstance(parsed, dict) else None,
                    "candidate_name": (
                        str((parsed or {}).get("name") or "").strip()[:255]
                        if isinstance(parsed, dict) else None
                    ),
                })

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
    with pdfplumber.open(path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


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
            if linkedin_url:
                resume_string += f"\nLinkedIn: {linkedin_url}"
            ats_score = await ats_scoring(resume_string, jd_string)

        result = parse_ai_json_response(ats_score)

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

    # skills: list of strings or list of dicts like {"category": "values"}
    raw_skill_strings = []
    for skill in parsed.get("skills", []) or []:
        if isinstance(skill, str) and skill.strip():
            raw_skill_strings.append(skill.strip())
        elif isinstance(skill, dict):
            name = skill.get("name") or skill.get("category")
            items = skill.get("skills") or skill.get("items") or skill.get("values")
            if name and items and isinstance(items, list):
                items_str = ", ".join(str(i).strip() for i in items if str(i).strip())
                raw_skill_strings.append(f"{t(name)}: {items_str}" if items_str else t(name))
            elif name:
                raw_skill_strings.append(t(name))
            else:
                for key, value in skill.items():
                    key_text = str(key).strip()
                    value_text = str(value).strip()
                    raw_skill_strings.append(f"{key_text}: {value_text}" if value_text else key_text)
    skill_entries = [{"name": s} for s in group_skills(raw_skill_strings)]

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

        await asyncio.to_thread(lambda: HTML(string=html_output).write_pdf(pdf_path))
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

        await asyncio.to_thread(lambda: HTML(string=html_output).write_pdf(pdf_path))
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

def _render_custom_cv_html(template_id: int, cv_data: dict) -> str:
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

