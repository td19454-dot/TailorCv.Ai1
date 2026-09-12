"""Builds the applicant answer bank auto-apply fills forms from.

The split that matters here: declarative answers (work authorization,
sponsorship, salary, EEO, dates) are copied verbatim from the user's stored
UserApplyProfile, and the LLM is structurally unable to produce them — it is
only asked for narrative fields. Auto-apply submits unattended, so a fabricated
answer to "are you authorized to work in the US?" would be a false declaration
filed under the user's name. Blank-and-report is not an option either, since the
whole point is not stopping to ask; the answer has to already be on file, which
is what validate_profile() enforces before a run is allowed to start.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field

from functions import _extract_contact_from_resume_text, get_resume_response

logger = logging.getLogger(__name__)

DECLINE = "Decline to self-identify"

# Blockers use plain second-person text — these are surfaced verbatim in the UI.
MSG_NO_RESUME = "Upload your base resume first — we need the PDF to attach to applications."
MSG_NO_PHONE = "Add a phone number to your application profile."
MSG_NO_EMAIL = "Add an email address to your application profile."
MSG_NO_NAME = "Add your full name to your account before applying."
MSG_NO_WORK_AUTH = "Answer the work authorization question in your application profile."
MSG_NO_SPONSORSHIP = "Answer the visa sponsorship question in your application profile."
MSG_NO_CONSENT = "Confirm you authorize us to submit applications on your behalf."

# Maps a blocker to the profile field the modal should focus.
BLOCKER_FIELDS = {
    MSG_NO_PHONE: "phone",
    MSG_NO_WORK_AUTH: "workAuthorized",
    MSG_NO_SPONSORSHIP: "requiresSponsorship",
    MSG_NO_CONSENT: "consent",
}


@dataclass
class ApplicantProfile:
    # Identity / contact
    full_name: str = ""
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    linkedin: str = ""
    github: str = ""
    portfolio: str = ""

    # Resume file
    resume_path: str = ""
    resume_filename: str = ""

    # Reusable, non-job-specific cover letter — attached to any "Cover
    # Letter" file-upload field the same way resume_path is attached to a
    # Resume one. Empty if the user hasn't generated/uploaded one; that's
    # not a blocker (validate_profile() doesn't require it — a form that
    # needs one but finds nothing on file still surfaces honestly via
    # runner.py's document_missing path, same as before this existed).
    cover_letter_path: str = ""
    cover_letter_filename: str = ""

    # Declarative — from UserApplyProfile only, never LLM-written
    work_authorized: str = ""
    requires_sponsorship: str = ""
    visa_status: str = ""
    willing_to_relocate: str = ""
    remote_preference: str = ""
    notice_period: str = ""
    expected_salary: str = ""
    available_start_date: str = ""
    how_did_you_hear: str = "Company website"
    gender: str = DECLINE
    race_ethnicity: str = DECLINE
    veteran_status: str = DECLINE
    disability_status: str = DECLINE
    gender_pronouns: str = DECLINE
    lgbtq_identity: str = DECLINE
    agreed_to_employer_terms: bool = False
    has_consent: bool = False

    # Answers to specific per-employer questions the user was asked before
    # (e.g. "Have you used Robinhood?"), never LLM-generated — see
    # UserApplyQA. Free-form, so no single fixed profile column could hold
    # a universally-correct value for any of these.
    qa_entries: list[dict] = field(default_factory=list)

    # Narrative — LLM may write these
    current_title: str = ""
    years_experience: str = ""
    top_skills: list[str] = field(default_factory=list)
    why_this_role: str = ""
    cover_note: str = ""

    def to_agent_json(self) -> str:
        """Compact CANDIDATE_DATA blob handed to the browser agent."""
        return json.dumps(answer_bank(self), ensure_ascii=False, indent=1)


def _split_name(full: str) -> tuple[str, str]:
    parts = [p for p in str(full or "").strip().split() if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def question_signature(text: str) -> str:
    """Normalized question-text key used to match a form's question against a
    stored UserApplyQA answer (and to save one) — lowercased, punctuation
    stripped, whitespace collapsed. Exact-normalized match only at the storage
    layer; matching a *newly*-seen, differently-worded question against a
    stored one is fill_form()'s LLM prompt's job (via other_answers_on_file
    in the answer bank below), not this function's."""
    text = (text or "").lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:160]


def snapshot_user(db, user_id: int, job_id: int) -> dict:
    """Read everything the run needs in one short DB transaction.

    Returns plain values, never ORM instances: the worker calls this inside
    asyncio.to_thread and the session is closed immediately after, so anything
    still attached would blow up on later attribute access.
    """
    from models import JobListing, User, UserApplyProfile, UserApplyQA

    user = db.query(User).filter(User.id == user_id).first()
    job = db.query(JobListing).filter(JobListing.id == job_id).first()
    prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user_id).first()
    qa_rows = db.query(UserApplyQA).filter(UserApplyQA.user_id == user_id).all()
    if not user or not job:
        return {}

    return {
        "user_id": user.id,
        "name": user.name or "",
        "email": user.email or "",
        "resume_path": user.base_resume_path or "",
        "resume_filename": user.base_resume_filename or "",
        "resume_text": user.base_resume_text or "",
        "cover_letter_path": user.base_cover_letter_path or "",
        "cover_letter_filename": user.base_cover_letter_filename or "",
        "job_id": job.id,
        "job_title": job.title or "",
        "job_company": job.company or "",
        "job_location": job.location or "",
        "job_description": (job.description or "")[:6000],
        "apply_url": job.apply_url or "",
        "job_source": job.source or "",
        "profile": _profile_to_dict(prof),
        "qa_entries": [{"question": r.question_text, "answer": r.answer} for r in qa_rows],
    }


def _profile_to_dict(prof) -> dict:
    if not prof:
        return {}
    return {
        "phone": prof.phone or "",
        "location": prof.location or "",
        "linkedin_url": prof.linkedin_url or "",
        "github_url": prof.github_url or "",
        "portfolio_url": prof.portfolio_url or "",
        "work_authorized": prof.work_authorized or "",
        "requires_sponsorship": prof.requires_sponsorship or "",
        "visa_status": prof.visa_status or "",
        "willing_to_relocate": prof.willing_to_relocate or "",
        "remote_preference": prof.remote_preference or "",
        "years_experience": prof.years_experience or "",
        "current_title": prof.current_title or "",
        "notice_period": prof.notice_period or "",
        "expected_salary": prof.expected_salary or "",
        "available_start_date": prof.available_start_date or "",
        "how_did_you_hear": prof.how_did_you_hear or "",
        "why_this_role": prof.why_this_role or "",
        "gender": prof.gender or "",
        "race_ethnicity": prof.race_ethnicity or "",
        "veteran_status": prof.veteran_status or "",
        "disability_status": prof.disability_status or "",
        "gender_pronouns": prof.gender_pronouns or "",
        "lgbtq_identity": prof.lgbtq_identity or "",
        "agreed_to_employer_terms": bool(prof.agreed_to_employer_terms),
        "has_consent": prof.auto_apply_consent_at is not None,
    }


def resume_defaults(resume_text: str) -> dict:
    """Contact fields parsed out of the resume — used to pre-fill the profile
    modal so the user edits rather than types from scratch."""
    text = str(resume_text or "")
    if not text.strip():
        return {}
    try:
        return _extract_contact_from_resume_text(text, text.splitlines())
    except Exception:
        logger.exception("resume contact extraction failed")
        return {}


_NARRATIVE_PROMPT = """You are preparing a candidate's job application.

RESUME:
{resume}

JOB: {title} at {company}
JOB DESCRIPTION:
{jd}

Return ONLY a JSON object with these keys:
  "current_title": their most recent job title, verbatim from the resume ("" if none)
  "years_experience": total years of professional experience as a number-like string, e.g. "4"
  "top_skills": array of up to 8 skills from the resume that this job asks for
  "why_this_role": 3-4 sentences, first person, why this candidate fits this role.
                   Use only facts present in the resume.
  "cover_note": a short paragraph (<=120 words) usable as a cover letter body.

Never invent employers, dates, degrees, or credentials. If the resume does not
support a claim, leave it out."""


async def _narrative_fields(snap: dict) -> dict:
    """One gpt-4o-mini pass for the free-text fields only.

    The prompt asks for narrative keys and nothing else, and the caller only
    reads those keys back — so there is no path by which the model can set a
    work-authorization, sponsorship, salary, or EEO answer."""
    resume = (snap.get("resume_text") or "").strip()
    if not resume:
        return {}
    prompt = _NARRATIVE_PROMPT.format(
        resume=resume[:8000],
        title=snap.get("job_title", ""),
        company=snap.get("job_company", ""),
        jd=(snap.get("job_description") or "")[:4000],
    )
    try:
        raw = await get_resume_response(prompt)
        data = json.loads(raw)
    except Exception:
        logger.exception("auto-apply narrative generation failed; continuing without it")
        return {}
    if not isinstance(data, dict):
        return {}
    skills = data.get("top_skills")
    return {
        "current_title": str(data.get("current_title") or "").strip(),
        "years_experience": str(data.get("years_experience") or "").strip(),
        "top_skills": [str(s).strip() for s in skills][:8] if isinstance(skills, list) else [],
        "why_this_role": str(data.get("why_this_role") or "").strip(),
        "cover_note": str(data.get("cover_note") or "").strip(),
    }


async def build_applicant_profile(snap: dict) -> ApplicantProfile:
    """Layer resume-derived defaults, then stored profile (wins), then narrative."""
    prof = snap.get("profile") or {}
    derived = resume_defaults(snap.get("resume_text", ""))

    def pick(profile_key: str, derived_key: str = "") -> str:
        return str(prof.get(profile_key) or derived.get(derived_key or profile_key) or "").strip()

    full_name = (snap.get("name") or "").strip()
    first, last = _split_name(full_name)

    p = ApplicantProfile(
        full_name=full_name,
        first_name=first,
        last_name=last,
        email=(snap.get("email") or derived.get("email") or "").strip(),
        phone=pick("phone"),
        location=pick("location"),
        linkedin=pick("linkedin_url", "linkedin"),
        github=pick("github_url", "github"),
        portfolio=pick("portfolio_url", "portfolio"),
        resume_path=snap.get("resume_path", ""),
        resume_filename=snap.get("resume_filename", "") or "resume.pdf",
        cover_letter_path=snap.get("cover_letter_path", ""),
        cover_letter_filename=snap.get("cover_letter_filename", "") or "cover_letter.pdf",
        work_authorized=str(prof.get("work_authorized") or "").strip(),
        requires_sponsorship=str(prof.get("requires_sponsorship") or "").strip(),
        visa_status=str(prof.get("visa_status") or "").strip(),
        willing_to_relocate=str(prof.get("willing_to_relocate") or "").strip(),
        remote_preference=str(prof.get("remote_preference") or "").strip(),
        notice_period=str(prof.get("notice_period") or "").strip(),
        expected_salary=str(prof.get("expected_salary") or "").strip(),
        available_start_date=str(prof.get("available_start_date") or "").strip(),
        how_did_you_hear=str(prof.get("how_did_you_hear") or "").strip() or "Company website",
        gender=str(prof.get("gender") or "").strip() or DECLINE,
        race_ethnicity=str(prof.get("race_ethnicity") or "").strip() or DECLINE,
        veteran_status=str(prof.get("veteran_status") or "").strip() or DECLINE,
        disability_status=str(prof.get("disability_status") or "").strip() or DECLINE,
        gender_pronouns=str(prof.get("gender_pronouns") or "").strip() or DECLINE,
        lgbtq_identity=str(prof.get("lgbtq_identity") or "").strip() or DECLINE,
        qa_entries=snap.get("qa_entries") or [],
        agreed_to_employer_terms=bool(prof.get("agreed_to_employer_terms")),
        has_consent=bool(prof.get("has_consent")),
        current_title=str(prof.get("current_title") or "").strip(),
        years_experience=str(prof.get("years_experience") or "").strip(),
        why_this_role=str(prof.get("why_this_role") or "").strip(),
    )

    narrative = await _narrative_fields(snap)
    # Stored answers still win — the LLM only fills gaps.
    p.current_title = p.current_title or narrative.get("current_title", "")
    p.years_experience = p.years_experience or narrative.get("years_experience", "")
    p.why_this_role = p.why_this_role or narrative.get("why_this_role", "")
    p.cover_note = narrative.get("cover_note", "") or p.why_this_role
    p.top_skills = narrative.get("top_skills", [])
    return p


def validate_profile(p: ApplicantProfile, snap: dict) -> list[str]:
    """Blockers that must be cleared before a run starts.

    Checked before any Browserbase session opens and before the quota is
    charged, so an incomplete profile costs the user nothing. This is the only
    point where auto-apply ever asks the user for anything — once these are on
    file, every later click runs straight through."""
    blockers: list[str] = []

    resume_path = (p.resume_path or "").strip()
    # Render's disk is ephemeral, so a path in the DB is not proof of a file —
    # every other resume call site checks existence the same way.
    if not resume_path or not os.path.exists(resume_path):
        blockers.append(MSG_NO_RESUME)
    if not (p.full_name or "").strip():
        blockers.append(MSG_NO_NAME)
    if not (p.email or "").strip():
        blockers.append(MSG_NO_EMAIL)
    if not (p.phone or "").strip():
        blockers.append(MSG_NO_PHONE)
    if p.work_authorized not in ("yes", "no"):
        blockers.append(MSG_NO_WORK_AUTH)
    if p.requires_sponsorship not in ("yes", "no"):
        blockers.append(MSG_NO_SPONSORSHIP)
    if not p.has_consent:
        blockers.append(MSG_NO_CONSENT)
    return blockers


def _yn(value: str) -> str:
    return {"yes": "Yes", "no": "No"}.get((value or "").strip().lower(), "")


def answer_bank(p: ApplicantProfile) -> dict:
    """Flat label -> value map handed to the agent as CANDIDATE_DATA.

    Pre-canned answers for the usual free-text prompts live here too, so the
    agent copies an answer rather than composing one mid-submission."""
    bank = {
        "full_name": p.full_name,
        "first_name": p.first_name,
        "last_name": p.last_name,
        "email": p.email,
        "phone": p.phone,
        "location": p.location,
        "current_city": p.location,
        "linkedin_url": _as_url(p.linkedin),
        "github_url": _as_url(p.github),
        "portfolio_or_website": _as_url(p.portfolio),
        "current_job_title": p.current_title,
        "years_of_experience": p.years_experience,
        "top_skills": ", ".join(p.top_skills),
        "authorized_to_work_in_country": _yn(p.work_authorized),
        "requires_visa_sponsorship": _yn(p.requires_sponsorship),
        "visa_status": p.visa_status,
        "willing_to_relocate": _yn(p.willing_to_relocate),
        "remote_work_preference": p.remote_preference,
        "notice_period": p.notice_period,
        "expected_salary": p.expected_salary,
        "available_start_date": p.available_start_date,
        "how_did_you_hear_about_us": p.how_did_you_hear,
        "why_do_you_want_this_role": p.why_this_role,
        "cover_letter": p.cover_note,
        "gender": p.gender or DECLINE,
        "race_ethnicity": p.race_ethnicity or DECLINE,
        "veteran_status": p.veteran_status or DECLINE,
        "disability_status": p.disability_status or DECLINE,
        "gender_pronouns": p.gender_pronouns or DECLINE,
        "lgbtq_identity": p.lgbtq_identity or DECLINE,
        "accepts_employer_terms_and_privacy_policy": "Yes" if p.agreed_to_employer_terms else "",
        # Not a stored profile field — no UI collects it. Present here as an
        # actual CANDIDATE_DATA value, not only as a prompt rule, because the
        # prompt's opening instruction ("never invent a fact that isn't present
        # here") otherwise wins and the model returns nothing for it. An
        # unanswered consent question the employer marks required blocks the
        # whole submission, which is how a completed form failed to send.
        "marketing_or_promotional_emails_opt_in": "Yes",
    }
    bank = {k: v for k, v in bank.items() if str(v).strip()}
    # Added after the empty-string filter above: a *list* value would pass
    # that filter even when empty (str([]) == "[]", non-blank), so this only
    # goes in when there's actually something in it.
    if p.qa_entries:
        bank["other_answers_on_file"] = [f"Q: {e['question']} A: {e['answer']}" for e in p.qa_entries]
    return bank


def _as_url(value: str) -> str:
    """display_link() strips the scheme for display; forms want it back."""
    v = str(value or "").strip()
    if not v or v.startswith(("http://", "https://")):
        return v
    return f"https://{v}"
