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
    # Empty when the person has none. Never filled with a guess: a form's
    # Middle Name box is usually optional, and a wrong value there is worse than
    # a blank one.
    middle_name: str = ""
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

    # Parsed from the user's own base resume (UserResumeFacts), never invented —
    # see auto_apply/resume_facts.py. Application forms ask for all of these and
    # UserApplyProfile has a column for none of them. They rank BELOW anything
    # the user typed: a stored profile value wins, and a per-question answer in
    # UserApplyQA overrides both permanently.
    address_line1: str = ""
    address_line2: str = ""
    address_city: str = ""
    address_state: str = ""
    address_country: str = ""
    postal_code: str = ""
    university: str = ""
    degree: str = ""
    major: str = ""
    graduation_date: str = ""
    gpa: str = ""
    current_company: str = ""
    previous_company: str = ""
    # Full lists, for forms with education/experience repeaters rather than one
    # box each. Not flattened into the answer bank's label->value map.
    education: list[dict] = field(default_factory=list)
    work_history: list[dict] = field(default_factory=list)

    # Narrative — LLM may write these
    current_title: str = ""
    years_experience: str = ""
    top_skills: list[str] = field(default_factory=list)
    why_this_role: str = ""
    cover_note: str = ""

    def to_agent_json(self) -> str:
        """Compact CANDIDATE_DATA blob handed to the browser agent."""
        return json.dumps(answer_bank(self), ensure_ascii=False, indent=1)


def split_full_name(full: str) -> tuple[str, str, str]:
    """(first, middle, last) guessed from a single full-name string.

    Only a DEFAULT. The account stores one name string, and splitting it is a
    guess — "Mary Ann Smith" may be first name "Mary Ann", and "Maria Garcia
    Lopez" has two surnames — so the result is offered in the application
    profile for the user to confirm, and whatever they save there wins.

    Two words are first + last with NO middle name. That case matters most:
    the previous two-way split had nowhere to put a middle name at all, and a
    form's "Middle Name" box ended up with the whole name in it.
    """
    parts = [p for p in str(full or "").strip().split() if p]
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], "", ""
    if len(parts) == 2:
        return parts[0], "", parts[1]
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def _split_name(full: str) -> tuple[str, str]:
    """(first, last). Kept for callers that predate middle names."""
    first, _middle, last = split_full_name(full)
    return first, last


# Longest-first, so +971 is not read as +9 and +353 not as +35. Mirrors the
# list in chrome-extension/src/autofill/match.js splitPhone().
_DIAL_CODES = sorted([
    "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43",
    "44", "45", "46", "47", "48", "49", "51", "52", "54", "55", "56", "57", "58", "60",
    "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93",
    "94", "95", "98", "211", "212", "213", "234", "254", "353", "358", "359", "370",
    "371", "372", "380", "420", "421", "852", "880", "886", "966", "971", "972", "974",
    "977",
], key=len, reverse=True)


def split_phone(phone: str) -> tuple[str, str]:
    """("+91", "8240044652") from "+91 8240044652"; ("", number) with no "+".

    One stored string, shown as two fields. A number stored without a leading
    "+" keeps no dial code rather than having a country guessed for it.
    """
    raw = str(phone or "").strip()
    if not raw.startswith("+"):
        return "", re.sub(r"[^\d]", "", raw) if raw else ""
    digits = re.sub(r"\D", "", raw[1:])
    for code in _DIAL_CODES:
        if digits.startswith(code):
            return "+" + code, digits[len(code):]
    return "", digits


def join_phone(code: str, number: str) -> str:
    """The stored form: "+91 8240044652". Either part may be empty."""
    code = str(code or "").strip()
    number = re.sub(r"[^\d]", "", str(number or ""))
    if code and not code.startswith("+"):
        code = "+" + re.sub(r"\D", "", code)
    return " ".join(x for x in (code if code != "+" else "", number) if x)


ADDRESS_KEYS = ("address_line1", "address_line2", "city", "state", "postal_code", "country")


def resolve_address_parts(stored: dict, *free_text: str, phone: str = "") -> dict:
    """The address to fill forms with: saved parts win, else a parse of the
    free-text location (profile first, then the resume's).

    "Saved" means the user filled in a city or a first address line in their
    profile. From then on every part is taken exactly as saved — an empty
    Address Line 2 means empty, and is never refilled from the guess.

    State and country are the exception, and only in one direction: when either
    is empty and the city is a known Indian city corroborated as being in India
    (see infer_state_country), they are filled from the city. They are facts
    OF the city rather than a choice the user made, and a form's required
    "Region" left at "Select One" is the alternative.
    """
    from auto_apply.resume_facts import infer_state_country, split_location

    s = {k: str((stored or {}).get(k) or "").strip() for k in ADDRESS_KEYS}
    if not (s["city"] or s["address_line1"]):
        source = next((t for t in free_text if str(t or "").strip()), "")
        guess = split_location(source)
        s = {
            "address_line1": guess["street"],
            "address_line2": guess["area"],
            "city": guess["city"],
            "state": guess["state"],
            "postal_code": guess["postal_code"],
            "country": guess["country"],
        }
    if s["city"] and (not s["state"] or not s["country"]):
        state, country = infer_state_country(s["city"], s["country"], s["postal_code"], phone)
        s["state"] = s["state"] or state
        s["country"] = s["country"] or country
    return s


def resolve_name_parts(stored: dict, account_name: str) -> dict:
    """The name parts to fill forms with: stored parts win, else the split guess.

    Returns {first, middle, last, full}. Once the user has saved a first and
    last name, their middle name is taken exactly as saved — including EMPTY.
    An empty stored middle name means "I have none", and must not be refilled
    from the guess.
    """
    first = str((stored or {}).get("first_name") or "").strip()
    middle = str((stored or {}).get("middle_name") or "").strip()
    last = str((stored or {}).get("last_name") or "").strip()
    if first and last:
        full = " ".join(x for x in (first, middle, last) if x)
        return {"first": first, "middle": middle, "last": last, "full": full}
    g_first, g_middle, g_last = split_full_name(account_name)
    return {
        "first": first or g_first,
        "middle": middle or g_middle,
        "last": last or g_last,
        "full": str(account_name or "").strip(),
    }


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

    # Read-only: never parses here. A cache miss yields {} and the run simply
    # has no education/address facts, exactly as before this existed — a server
    # run must not grow an LLM call inside its DB snapshot. The extension's
    # /apply-context endpoint is what populates this.
    facts = _load_facts_quietly(db, user)

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
        "resume_facts": facts,
        "qa_entries": [{"question": r.question_text, "answer": r.answer} for r in qa_rows],
    }


def _load_facts_quietly(db, user) -> dict:
    """Cached resume facts, or {}. Never raises and never parses.

    Isolated so a problem in the facts layer can never break a run that would
    otherwise have worked — before this existed the runner had no education or
    address data at all, so {} is a genuinely safe outcome rather than a
    degraded one."""
    try:
        from auto_apply.resume_facts import load_cached_facts

        return load_cached_facts(db, user) or {}
    except Exception:
        logger.warning("could not read cached resume facts", exc_info=True)
        return {}


def _profile_to_dict(prof) -> dict:
    if not prof:
        return {}
    return {
        "first_name": getattr(prof, "first_name", "") or "",
        "middle_name": getattr(prof, "middle_name", "") or "",
        "last_name": getattr(prof, "last_name", "") or "",
        "university": getattr(prof, "university", "") or "",
        "degree": getattr(prof, "degree", "") or "",
        "major": getattr(prof, "major", "") or "",
        "graduation_date": getattr(prof, "graduation_date", "") or "",
        "gpa": getattr(prof, "gpa", "") or "",
        "current_company": getattr(prof, "current_company", "") or "",
        "previous_company": getattr(prof, "previous_company", "") or "",
        "skills": getattr(prof, "skills", "") or "",
        "address_line1": getattr(prof, "address_line1", "") or "",
        "address_line2": getattr(prof, "address_line2", "") or "",
        "city": getattr(prof, "city", "") or "",
        "state": getattr(prof, "state", "") or "",
        "postal_code": getattr(prof, "postal_code", "") or "",
        "country": getattr(prof, "country", "") or "",
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


async def build_applicant_profile(snap: dict, narrative: bool = True) -> ApplicantProfile:
    """Layer resume-derived defaults, then stored profile (wins), then narrative.

    narrative=False skips the one LLM call this function makes
    (_narrative_fields). The extension's /apply-context endpoint is on the
    critical path of a click and must stay fast; it also does not need
    why_this_role or a cover note, because a client-side fill never composes
    prose unprompted — those are offered as suggestions from stored values only.
    """
    prof = snap.get("profile") or {}
    derived = resume_defaults(snap.get("resume_text", ""))
    facts = snap.get("resume_facts") or {}
    fact_keys = _facts_keys_quietly(facts)

    def pick(profile_key: str, derived_key: str = "") -> str:
        return str(prof.get(profile_key) or derived.get(derived_key or profile_key) or "").strip()

    def fact(key: str) -> str:
        # A value saved on the profile page wins over the resume parse.
        saved = str(prof.get(key) or "").strip()
        return saved or str(fact_keys.get(key) or "").strip()

    names = resolve_name_parts(prof, snap.get("name") or "")
    saved_skills = [s.strip() for s in str(prof.get("skills") or "").split(",") if s.strip()][:20]
    addr = resolve_address_parts(
        prof, prof.get("location") or "",
        ((facts.get("personal_info") or {}).get("location") or "") if isinstance(facts, dict) else "",
        derived.get("location") or "",
        phone=prof.get("phone") or derived.get("phone") or "")

    p = ApplicantProfile(
        full_name=names["full"],
        first_name=names["first"],
        middle_name=names["middle"],
        last_name=names["last"],
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
        # Saved address parts win; otherwise the profile's free-text location is
        # parsed, and only then the resume's.
        address_line1=addr["address_line1"],
        address_line2=addr["address_line2"],
        address_city=addr["city"],
        address_state=addr["state"],
        address_country=addr["country"],
        postal_code=addr["postal_code"],
        university=fact("university"),
        degree=fact("degree"),
        major=fact("major"),
        graduation_date=fact("graduation_date"),
        gpa=fact("gpa"),
        current_company=fact("current_company"),
        previous_company=fact("previous_company"),
        education=list(facts.get("education") or []),
        work_history=list(facts.get("work_history") or []),
        current_title=str(prof.get("current_title") or "").strip(),
        years_experience=str(prof.get("years_experience") or "").strip(),
        why_this_role=str(prof.get("why_this_role") or "").strip(),
    )

    # The resume's own work history names the current role when the profile
    # doesn't — still below the stored value, same rule as everything above.
    if not p.current_title:
        current = next((w for w in p.work_history if w.get("is_current")),
                       p.work_history[0] if p.work_history else {})
        p.current_title = str(current.get("role") or "").strip()

    if not narrative:
        # No LLM pass. cover_note stays whatever the user stored, and is offered
        # as a suggestion rather than written into a form unasked.
        p.cover_note = p.why_this_role
        p.top_skills = saved_skills or [str(s) for s in (facts.get("skills") or [])][:8]
        return p

    generated = await _narrative_fields(snap)
    # Stored answers still win — the LLM only fills gaps.
    p.current_title = p.current_title or generated.get("current_title", "")
    p.years_experience = p.years_experience or generated.get("years_experience", "")
    p.why_this_role = p.why_this_role or generated.get("why_this_role", "")
    p.cover_note = generated.get("cover_note", "") or p.why_this_role
    # Skills the user saved are theirs to choose; the model's JD-matched pick is
    # only used when they haven't.
    p.top_skills = saved_skills or generated.get("top_skills", [])
    return p


def _facts_keys_quietly(facts: dict) -> dict:
    try:
        from auto_apply.resume_facts import facts_answer_keys

        return facts_answer_keys(facts)
    except Exception:
        logger.warning("could not flatten resume facts", exc_info=True)
        return {}


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
        # Dropped by the blank filter below when empty, so a person with no
        # middle name has NO middle_name key — nothing for a matcher or a model
        # to put in a Middle Name box.
        "middle_name": p.middle_name,
        "last_name": p.last_name,
        "email": p.email,
        "phone": p.phone,
        # "Location" questions want a place, not a street address: the saved or
        # parsed city/state/country when known, else the free text as typed.
        "location": _place(p) or p.location,
        "current_city": p.address_city or p.location,
        "linkedin_url": _as_url(p.linkedin),
        "github_url": _as_url(p.github),
        "portfolio_or_website": _as_url(p.portfolio),
        "current_job_title": p.current_title,
        "years_of_experience": p.years_experience,
        "top_skills": ", ".join(p.top_skills),
        # Resume-derived (UserResumeFacts). Every one of these is filtered out
        # below when empty, so a user with no parsed facts produces a
        # byte-identical CANDIDATE_DATA blob to before these keys existed — the
        # server engine's prompt does not change for them at all.
        # A single "Address" box gets the whole postal address; line 1 / line 2
        # boxes get their own part. Previously "address" was city+state+country,
        # so an Address Line 1 box got a place name instead of the street.
        "address": ", ".join(x for x in (p.address_line1, p.address_line2, p.address_city,
                                         p.address_state, p.postal_code, p.address_country) if x),
        "address_line1": p.address_line1,
        "address_line2": p.address_line2,
        "address_city": p.address_city,
        "address_state": p.address_state,
        "address_country": p.address_country,
        "postal_code": p.postal_code,
        "university": p.university,
        "degree": p.degree,
        "major": p.major,
        "graduation_date": p.graduation_date,
        "gpa": p.gpa,
        "current_company": p.current_company,
        "previous_company": p.previous_company,
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


def _place(p: ApplicantProfile) -> str:
    """City, State, Country — the answer to "Where are you located?"."""
    return ", ".join(x for x in (p.address_city, p.address_state, p.address_country) if x)


def _as_url(value: str) -> str:
    """display_link() strips the scheme for display; forms want it back."""
    v = str(value or "").strip()
    if not v or v.startswith(("http://", "https://")):
        return v
    return f"https://{v}"
