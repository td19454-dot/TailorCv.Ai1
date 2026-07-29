from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column("full_name", String(120), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column("password", String(255), nullable=False)
    pro_until = Column(DateTime, nullable=True)                        # Pro iff pro_until > utcnow()
    plan_provider = Column(String(20), nullable=True)                  # "razorpay" | "polar"
    razorpay_subscription_id = Column(String(100), nullable=True)
    polar_subscription_id = Column(String(100), nullable=True)
    # One Netlify "live site" per user — reused across all their portfolios so each
    # user only ever consumes credits for a single site. netlify_portfolio_id tracks
    # which portfolio is currently published there.
    netlify_site_id = Column(String(64), nullable=True)
    netlify_url = Column(String(255), nullable=True)
    netlify_portfolio_id = Column(Integer, nullable=True)
    # A single reusable "base resume" the Chrome extension tailors against on any
    # job page, distinct from the tailored outputs saved to SavedResume.
    base_resume_path = Column(String(500), nullable=True)
    base_resume_filename = Column(String(255), nullable=True)
    base_template_id = Column(Integer, nullable=True)
    base_style_id = Column(Integer, nullable=True)
    base_resume_uploaded_at = Column(DateTime, nullable=True)
    # Which of the cover-letter designs (classic / modern / monogram) the extension
    # renders when it writes a letter from a job page.
    base_cover_template = Column(String(20), nullable=True)
    # Extracted once at upload time so the extension's skill-match score never
    # needs to re-parse the PDF on every job the user looks at.
    base_resume_text = Column(Text, nullable=True)

    reset_tokens = relationship("PasswordResetToken", back_populates="user", cascade="all, delete-orphan")
    login_codes = relationship("LoginVerificationCode", back_populates="user", cascade="all, delete-orphan")
    job_applications = relationship("JobApplication", back_populates="user", cascade="all, delete-orphan")
    welcome_emails = relationship("WelcomeEmailLog", back_populates="user", cascade="all, delete-orphan")
    usage_records = relationship("UsageRecord", back_populates="user", cascade="all, delete-orphan")
    saved_resumes = relationship("SavedResume", back_populates="user", cascade="all, delete-orphan")
    personality_cards = relationship("PersonalityCard", back_populates="user", cascade="all, delete-orphan")
    portfolios = relationship("Portfolio", back_populates="user", cascade="all, delete-orphan")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token = Column(String(255), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="reset_tokens")


class LoginVerificationCode(Base):
    __tablename__ = "login_verification_codes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code = Column(String(12), index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="login_codes")


class SignupVerificationCode(Base):
    __tablename__ = "signup_verification_codes"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), index=True, nullable=False)
    code = Column(String(12), index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class JobApplication(Base):
    __tablename__ = "job_applications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    company = Column(String(200), nullable=False)
    role = Column(String(200), nullable=False)
    stage = Column(String(50), nullable=False, default="saved")  # saved, applied, interview, offer, rejected
    salary_ctc = Column(String(100), nullable=True)
    interview_date = Column(String(50), nullable=True)
    job_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="job_applications")


class SavedResume(Base):
    """An optimized resume persisted to a user's account so they can return to
    re-download or re-edit it. The foundation of the 'My Resumes' dashboard."""
    __tablename__ = "saved_resumes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="Untitled Resume")
    candidate_name = Column(String(255), nullable=True)
    jd_snippet = Column(Text, nullable=True)                    # full job description text
    template_id = Column(Integer, nullable=True)
    style_id = Column(Integer, nullable=True)
    ats_score = Column(Integer, nullable=True)
    company = Column(String(200), nullable=True)               # job tracker: company applied to
    status = Column(String(30), nullable=False, default="saved")  # saved, applied, interview, selected, rejected
    resume_json = Column(Text, nullable=True)   # the optimized resume dict, JSON-encoded
    html_content = Column(Text, nullable=True)  # rendered HTML, for instant re-download
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="saved_resumes")


class PersonalityCard(Base):
    __tablename__ = "personality_cards"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    resume_id = Column(Integer, ForeignKey("saved_resumes.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    token = Column(String(32), unique=True, index=True, nullable=False)
    archetype = Column(String(120), nullable=False)
    tagline = Column(Text, nullable=False)
    story = Column(Text, nullable=False)          # dramatic metaphorical narrative
    traits = Column(Text, nullable=False)          # JSON-encoded list
    stats = Column(Text, nullable=False)           # JSON-encoded dict
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="personality_cards")
    resume = relationship("SavedResume")


class Portfolio(Base):
    """A live, public portfolio website generated from a user's saved resume.

    Mirrors PersonalityCard: a public, no-login page reachable by a stable
    handle (here the human-friendly `slug`, e.g. "emilian-leaman-a1b2"). The
    fully-rendered content is held as a JSON blob (`data_json`) so the public
    page never needs the source resume to render and the user can regenerate or
    re-theme without losing their link."""
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    resume_id = Column(Integer, ForeignKey("saved_resumes.id", ondelete="SET NULL"), nullable=True, index=True)
    slug = Column(String(160), unique=True, index=True, nullable=False)   # public path in /p/<slug>
    handle = Column(String(63), unique=True, index=True, nullable=True)    # subdomain label: <handle>.thetailorcv.com
    token = Column(String(32), unique=True, index=True, nullable=False)   # opaque id for owner actions
    theme = Column(String(40), nullable=False, default="aurora")
    accent = Column(String(20), nullable=True)                            # optional hero accent override
    headline = Column(String(255), nullable=True)
    tagline = Column(Text, nullable=True)                                  # AI hero one-liner
    about = Column(Text, nullable=True)                                    # AI polished about paragraph
    data_json = Column(Text, nullable=False)                               # full render dict, JSON-encoded
    published = Column(Boolean, default=True, nullable=False)
    view_count = Column(Integer, default=0, nullable=False)
    netlify_site_id = Column(String(64), nullable=True)                    # Netlify site id once deployed
    netlify_url = Column(String(255), nullable=True)                       # *.netlify.app live URL
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="portfolios")
    resume = relationship("SavedResume")


class WelcomeEmailLog(Base):
    __tablename__ = "welcome_email_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True, unique=True)
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    source = Column(String(30), nullable=False, default="login")

    user = relationship("User", back_populates="welcome_emails")


class GuestAtsScan(Base):
    """Rate-limits anonymous ATS scans to one per IP per 24 hours."""
    __tablename__ = "guest_ats_scans"

    id = Column(Integer, primary_key=True, index=True)
    ip_hash = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class FeedbackSubmission(Base):
    """Survey submitted from email campaign links (/feedback?reason=...).

    Upserted by session_id on every answer click so partial/abandoned
    responses are still captured, not just fully-finished ones.
    """
    __tablename__ = "feedback_submissions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), nullable=False, unique=True, index=True)

    # Nullable because a partial (in-progress) response won't have all of
    # these yet — only guaranteed non-null once completed_at is set.
    time_saved_rating = Column(Integer, nullable=True)                # Q1, 1-5
    workflow_likelihood_rating = Column(Integer, nullable=True)       # Q2, 1-5
    would_pay = Column(String(60), nullable=True, index=True)         # Q3, e.g. "No — too expensive"
    shutdown_impact_rating = Column(Integer, nullable=True)           # Q4, 1-5
    nps_score = Column(Integer, nullable=True, index=True)            # Q5, 1-10
    additional_feedback = Column(Text, nullable=True)                 # Q6, optional

    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)
    campaign_reason = Column(String(30), nullable=True)              # raw ?reason= key from the email link
    referrer = Column(String(500), nullable=True)                    # HTTP Referer header
    user_agent = Column(String(500), nullable=True)
    ip_address = Column(String(64), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True, index=True)        # set once all required questions are answered


class UsageRecord(Base):
    """Tracks monthly feature usage per user for enforcing free-tier limits."""
    __tablename__ = "usage_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    month = Column(String(7), nullable=False)  # "2026-06"
    ats_scans = Column(Integer, default=0, nullable=False)
    ai_optimizations = Column(Integer, default=0, nullable=False)
    mock_interviews = Column(Integer, default=0, nullable=False)
    interview_questions = Column(Integer, default=0, nullable=False)
    cover_letters = Column(Integer, default=0, nullable=False)
    linkedin_imports = Column(Integer, default=0, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "month", name="uq_user_month"),)

    user = relationship("User", back_populates="usage_records")


class JobListing(Base):
    """An aggregated freelance / AI-training gig (Mercor, Outlier, Alignerr, Fleet,
    Scale/Remotasks, DataAnnotation, and similar). Pulled from external sources,
    marked verified-legit, and shown on the public /gigs board. Candidates apply
    on the source site via `apply_url` — we are the trusted discovery + matching
    layer. Global (not per-user); matching is computed per-request against a
    signed-in user's resume."""
    __tablename__ = "job_listings"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(40), nullable=False, index=True)        # mercor, outlier, alignerr, fleet, scale, ...
    source_job_id = Column(String(200), nullable=False)            # stable id from the source, for dedupe
    slug = Column(String(220), unique=True, index=True, nullable=False)  # our detail-page path /gigs/<slug>

    title = Column(String(300), nullable=False)
    company = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String(80), nullable=True, index=True)       # e.g. AI Training, Data Labeling, Writing
    tags = Column(Text, nullable=True)                             # JSON-encoded list
    required_skills = Column(Text, nullable=True)                  # JSON-encoded list, used for matching
    min_experience = Column(String(40), nullable=True)             # entry, 1-3y, senior, ...
    pay_text = Column(String(160), nullable=True)                  # free-text pay/rate as shown by source
    location = Column(String(160), nullable=True)
    is_remote = Column(Boolean, default=True, nullable=False)
    apply_url = Column(String(600), nullable=False)                # external apply link (source site)

    posted_at = Column(DateTime, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    accepting_now = Column(Boolean, default=True, nullable=False, index=True)  # currently open to apply
    is_verified = Column(Boolean, default=False, nullable=False, index=True)   # passed verify-legit rule
    verification_note = Column(String(240), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)      # not stale / withdrawn

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "source_job_id", name="uq_source_jobid"),
    )
