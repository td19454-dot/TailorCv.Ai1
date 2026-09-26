"""The profile page: every value autofill puts into an application form, in one
place, viewable and editable.

  GET    /profile                       the page
  GET    /api/profile                   stored + effective values, per field
  POST   /api/profile                   save (partial: only the keys sent change)
  GET    /api/profile/answers           the learned question -> answer store
  PUT    /api/profile/answers/{id}      edit one
  DELETE /api/profile/answers/{id}      forget one

Why a page and not only the Job Dashboard modal: the modal was built for one
job (collect the minimum an unattended auto-apply run needs) and shows a subset
of what autofill actually uses. Education, employers and skills came only from
the resume parse and could not be seen or corrected anywhere. This page shows
what a form will actually receive — including values that are only suggested
from the resume so far — and lets each be saved.

FIELDS below is the single definition of the page: it drives rendering, the
save mapping and the "what autofill will use" read. A field added here appears,
saves and reports its effective value with no second place to update.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from database import SessionLocal
from models import User, UserApplyProfile, UserApplyQA

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

YES_NO = [("", "Not set"), ("yes", "Yes"), ("no", "No")]
REMOTE = [("", "Not set"), ("remote", "Remote"), ("hybrid", "Hybrid"),
          ("onsite", "On-site"), ("flexible", "Flexible")]
EEO_NOTE = "Not set — we answer “Decline to self-identify”"

# EEO answers as the MOST detailed lists real forms use (these are Greenhouse's
# demographic questions, e.g. job-boards.greenhouse.io/robinhood). Storing the
# finest answer lets the extension widen it onto a coarser form — "Cisgender
# man" answers "Male", "I have never served in the military" answers "I am not a
# protected veteran" — which can't be done in the other direction without
# guessing. Matching lives in chrome-extension/src/autofill/match.js EEO_GROUPS.
EEO_UNSET = ("", "Not set — we answer “Decline to self-identify”")


def _eeo(*labels: str) -> list:
    return [EEO_UNSET] + [(label, label) for label in labels]


GENDER_OPTIONS = _eeo(
    "Cisgender woman", "Cisgender man", "Transgender woman", "Transgender man",
    "Non-binary", "Two-spirit", "My gender identity is not listed")
RACE_OPTIONS = _eeo(
    "American Indian or Alaskan Native", "Black or African American", "East Asian",
    "Hispanic or Latino", "Middle Eastern or North African",
    "Native Hawaiian or Other Pacific Islander", "South Asian", "Southeast Asian", "White",
    "Two or More Races")
VETERAN_OPTIONS = _eeo(
    "I have never served in the military", "I identify as a protected veteran",
    "I identify as a non-protected veteran", "I am on active duty",
    "I am part of the national guard or on reserve",
    "I identify in multiple military status categories")
DISABILITY_OPTIONS = _eeo(
    "Yes, I have a disability (or previously had a disability)",
    "No, I don't have a disability")
PRONOUN_OPTIONS = _eeo("He/him", "She/her", "They/them", "He/they", "She/they",
                       "Ze/zir", "My pronouns are not listed")
LGBTQ_OPTIONS = _eeo("Yes", "No", "Questioning")

# Free-text answers saved before these were dropdowns, mapped onto the option
# that says the same thing. Only unambiguous ones: "Not a protected veteran" is
# left alone because a non-protected veteran says that too.
EEO_LEGACY = {
    "gender": {"male": "Cisgender man", "man": "Cisgender man",
               "female": "Cisgender woman", "woman": "Cisgender woman",
               "non-binary": "Non-binary", "nonbinary": "Non-binary"},
    "race_ethnicity": {"asian indian": "South Asian", "indian": "South Asian",
                       "white / european": "White", "caucasian": "White",
                       "american indian or alaska native": "American Indian or Alaskan Native",
                       "two or more": "Two or More Races", "multiracial": "Two or More Races"},
    "veteran_status": {"not a veteran": "I have never served in the military",
                       "i am not a veteran": "I have never served in the military",
                       "never served": "I have never served in the military",
                       "protected veteran": "I identify as a protected veteran",
                       "i identify as one or more of the classifications of protected veteran":
                           "I identify as a protected veteran"},
    "disability_status": {"no disability": "No, I don't have a disability",
                          "no": "No, I don't have a disability",
                          "not disabled": "No, I don't have a disability",
                          "no, i do not have a disability": "No, I don't have a disability",
                          "yes": "Yes, I have a disability (or previously had a disability)",
                          "yes, i have a disability":
                              "Yes, I have a disability (or previously had a disability)"},
    "gender_pronouns": {"he/him/his": "He/him", "she/her/hers": "She/her",
                        "they/them/theirs": "They/them"},
    "lgbtq_identity": {},
}


def eeo_canonical(column: str, value: str) -> str:
    """The dropdown option an older free-text EEO answer means, or the value as-is."""
    text = (value or "").strip()
    return EEO_LEGACY.get(column, {}).get(text.lower(), text)


@dataclass
class Spec:
    key: str                 # form / JSON key
    column: str              # UserApplyProfile column ('' = not stored there)
    label: str
    kind: str = "text"       # text | textarea | select | phone | readonly | checkbox
    options: list = field(default_factory=list)
    placeholder: str = ""
    help: str = ""
    wide: bool = False
    max_len: int = 200


SECTIONS: list[tuple[str, str, list[Spec]]] = [
    ("name", "Legal name", [
        Spec("firstName", "first_name", "First name", max_len=80),
        Spec("middleName", "middle_name", "Middle name", placeholder="Leave empty if you have none",
             max_len=80),
        Spec("lastName", "last_name", "Last name", max_len=80),
    ]),
    ("contact", "Contact", [
        Spec("email", "", "Email", kind="readonly",
             help="Your account email. Change it in account settings."),
        Spec("phone", "phone", "Phone", kind="phone",
             help="Country code and number are kept separate, so forms with their own "
                  "country-code field get just the number."),
        Spec("linkedinUrl", "linkedin_url", "LinkedIn", placeholder="linkedin.com/in/…", max_len=300),
        Spec("githubUrl", "github_url", "GitHub", placeholder="github.com/…", max_len=300),
        Spec("portfolioUrl", "portfolio_url", "Portfolio / website", placeholder="https://…",
             max_len=300),
    ]),
    ("address", "Address", [
        Spec("addressLine1", "address_line1", "Address line 1", placeholder="House / flat, street",
             wide=True),
        Spec("addressLine2", "address_line2", "Address line 2", placeholder="Area, landmark (optional)",
             wide=True),
        Spec("city", "city", "City", max_len=100),
        Spec("state", "state", "State / region", max_len=100,
             help="Forms often call this “Region”."),
        Spec("postalCode", "postal_code", "Postal code", max_len=20),
        Spec("country", "country", "Country", max_len=80),
        Spec("location", "location", "Location (one line)", placeholder="City, Country",
             help="Used for “Where are you based?” when the parts above are empty.", max_len=160),
    ]),
    ("work", "Work experience", [
        Spec("currentCompany", "current_company", "Current / latest company", max_len=160,
             help="Where you work now, or most recently."),
        Spec("currentTitle", "current_title", "Current job title", max_len=120),
        Spec("yearsExperience", "years_experience", "Years of experience", placeholder="e.g. 3",
             max_len=20),
        Spec("previousCompany", "previous_company", "Previous company", max_len=160),
        Spec("skills", "skills", "Key skills", kind="textarea", wide=True,
             placeholder="Comma-separated", max_len=2000),
    ]),
    ("education", "Education", [
        Spec("university", "university", "University / college"),
        Spec("degree", "degree", "Degree", placeholder="e.g. B.Tech", max_len=120),
        Spec("major", "major", "Major / field of study", max_len=120),
        Spec("graduationDate", "graduation_date", "Graduation date", placeholder="e.g. Jun 2024",
             max_len=40),
        Spec("gpa", "gpa", "GPA / CGPA / percentage", placeholder="e.g. 8.7/10 or 85%",
             max_len=20),
    ]),
    ("eligibility", "Work eligibility", [
        Spec("workAuthorized", "work_authorized", "Authorized to work in the job's country?",
             kind="select", options=YES_NO,
             help="Only ever filled from this answer — never guessed."),
        Spec("requiresSponsorship", "requires_sponsorship", "Need visa sponsorship?",
             kind="select", options=YES_NO),
        Spec("visaStatus", "visa_status", "Visa status", max_len=60),
        Spec("nationality", "nationality", "Nationality / citizenship",
             placeholder="e.g. Indian",
             help="Only ever filled from this answer — never guessed from your "
                  "address or phone number.", max_len=80),
        Spec("willingToRelocate", "willing_to_relocate", "Willing to relocate?",
             kind="select", options=YES_NO),
        Spec("remotePreference", "remote_preference", "Work arrangement", kind="select",
             options=REMOTE),
    ]),
    ("availability", "Availability & compensation", [
        Spec("noticePeriod", "notice_period", "Notice period", placeholder="e.g. 30 days",
             max_len=60),
        Spec("availableStartDate", "available_start_date", "Earliest start date",
             placeholder="e.g. 01/09/2026", max_len=60),
        Spec("expectedSalary", "expected_salary", "Expected salary",
             help="Only ever filled from this answer — never guessed.", max_len=60),
    ]),
    ("answers", "Common questions", [
        Spec("howDidYouHear", "how_did_you_hear", "How did you hear about the job?",
             placeholder="Company website", max_len=120),
        Spec("whyThisRole", "why_this_role", "Why do you want this role?", kind="textarea",
             wide=True, help="Offered for review on each form, never submitted unread.",
             max_len=2000),
    ]),
    ("eeo", "Voluntary self-identification", [
        Spec("gender", "gender", "Gender identity", kind="select", options=GENDER_OPTIONS,
             help="Also answers plain Male / Female questions.", max_len=60),
        Spec("raceEthnicity", "race_ethnicity", "Race / ethnicity", kind="select",
             options=RACE_OPTIONS,
             help="Forms with broader groups get the group yours belongs to "
                  "(South Asian → Asian).", max_len=80),
        Spec("veteranStatus", "veteran_status", "Military / veteran status", kind="select",
             options=VETERAN_OPTIONS,
             help="“Never served” also answers “I am not a protected veteran”.", max_len=80),
        Spec("disabilityStatus", "disability_status", "Disability status", kind="select",
             options=DISABILITY_OPTIONS, max_len=80),
        Spec("genderPronouns", "gender_pronouns", "Pronouns", kind="select",
             options=PRONOUN_OPTIONS, max_len=40),
        Spec("lgbtqIdentity", "lgbtq_identity", "LGBTQ+ identity", kind="select",
             options=LGBTQ_OPTIONS, max_len=60),
    ]),
    ("consent", "Permissions", [
        Spec("agreeToEmployerTerms", "agreed_to_employer_terms",
             "Agree to employers' terms / privacy policies when a form asks", kind="checkbox",
             wide=True),
        Spec("consent", "", "Allow TailorCV to submit applications for me (server auto-apply only)",
             kind="checkbox", wide=True,
             help="Not needed for the Chrome extension, which never submits."),
    ]),
]

ALL_SPECS = {s.key: s for _, _, specs in SECTIONS for s in specs}
EEO_COLUMNS = {"gender", "race_ethnicity", "veteran_status", "disability_status",
               "gender_pronouns", "lgbtq_identity"}
SELECT_VALUES = {s.key: {v for v, _ in s.options} for s in ALL_SPECS.values() if s.kind == "select"}


def _require_user(request: Request, db):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user


# ── what autofill will actually use ───────────────────────────────────────

async def _effective(db, user, prof) -> dict:
    """The value each field resolves to at fill time, by the same code path the
    extension uses — so "suggested" on the page means exactly what a form gets.

    Never parses the resume here: the page must load instantly, and the facts
    are parsed (once) by the extension's first autofill. Until then education
    and work come from the resume text only if already cached.
    """
    from auto_apply import resume_facts as rf
    from auto_apply.profile import build_applicant_profile, split_phone
    from routers.extension_autofill import _context_snapshot

    facts = rf.load_cached_facts(db, user) or rf.empty_facts()
    p = await build_applicant_profile(_context_snapshot(user, prof, facts), narrative=False)
    code, number = split_phone(p.phone)
    return {
        "firstName": p.first_name, "middleName": p.middle_name, "lastName": p.last_name,
        "email": p.email,
        "phone": {"code": code, "number": number},
        "linkedinUrl": p.linkedin, "githubUrl": p.github, "portfolioUrl": p.portfolio,
        "addressLine1": p.address_line1, "addressLine2": p.address_line2,
        "city": p.address_city, "state": p.address_state, "postalCode": p.postal_code,
        "country": p.address_country, "location": p.location,
        "currentTitle": p.current_title, "currentCompany": p.current_company,
        "previousCompany": p.previous_company, "yearsExperience": p.years_experience,
        "university": p.university, "degree": p.degree, "major": p.major,
        "graduationDate": p.graduation_date, "gpa": p.gpa,
        "skills": ", ".join(p.top_skills),
        "noticePeriod": p.notice_period, "availableStartDate": p.available_start_date,
        "expectedSalary": p.expected_salary,
        "howDidYouHear": p.how_did_you_hear, "whyThisRole": p.why_this_role,
    }


def _stored(prof, user) -> dict:
    """What is actually saved, per field. Empty string = nothing saved."""
    from auto_apply.profile import split_phone

    out = {}
    for key, spec in ALL_SPECS.items():
        if key == "email":
            out[key] = user.email or ""
        elif key == "consent":
            out[key] = bool(prof and prof.auto_apply_consent_at)
        elif spec.kind == "checkbox":
            out[key] = bool(prof and getattr(prof, spec.column, False))
        elif key == "phone":
            code, number = split_phone(getattr(prof, "phone", "") if prof else "")
            out[key] = {"code": code, "number": number}
        else:
            out[key] = str((getattr(prof, spec.column, "") if prof else "") or "")
    return out


def _page_model(stored: dict, effective: dict, facts_cached: bool) -> dict:
    """Per-field view: the value to show, and whether it is saved or suggested."""
    fields = {}
    for key, spec in ALL_SPECS.items():
        s = stored.get(key)
        e = effective.get(key, s)
        if spec.column in EEO_COLUMNS:
            # Shown as saved or empty — the "Decline" fallback is explained by the
            # empty option, not written into the box as though the user chose it.
            # An older free-text answer is shown as the option it means, marked
            # Suggested until saved; one with no clear option stays as it was.
            canon = eeo_canonical(spec.column, s)
            fields[key] = {"value": canon,
                           "source": "saved" if s and canon == s else ("suggested" if s else "")}
            continue
        # Choices the user makes (yes/no answers, permissions) are only ever what
        # they saved — there is nothing to suggest.
        if spec.kind in ("checkbox", "readonly", "select"):
            fields[key] = {"value": s, "source": "saved" if s else ""}
            continue
        if key == "phone":
            saved = bool(s.get("number"))
            fields[key] = {"value": s if saved else e, "source": "saved" if saved
                           else ("suggested" if e.get("number") else "")}
            continue
        if s:
            fields[key] = {"value": s, "source": "saved"}
        elif e:
            fields[key] = {"value": e, "source": "suggested"}
        else:
            fields[key] = {"value": "", "source": ""}
    return {"fields": fields, "factsCached": facts_cached}


# ── routes ────────────────────────────────────────────────────────────────

@router.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse(url="/login?next=/profile", status_code=302)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return RedirectResponse(url="/login?next=/profile", status_code=302)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()
        from auto_apply import resume_facts as rf

        model = _page_model(_stored(prof, user), await _effective(db, user, prof),
                            rf.load_cached_facts(db, user) is not None)
        return templates.TemplateResponse(request, "profile.html", {
            "request": request,
            "sections": SECTIONS,
            "model": model,
            "user_name": user.name or "",
            "has_resume": bool(user.base_resume_path and os.path.exists(user.base_resume_path)),
        })
    finally:
        db.close()


@router.get("/api/profile")
async def get_profile(request: Request):
    db = SessionLocal()
    try:
        user = _require_user(request, db)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()
        from auto_apply import resume_facts as rf

        return _page_model(_stored(prof, user), await _effective(db, user, prof),
                           rf.load_cached_facts(db, user) is not None)
    finally:
        db.close()


class ProfileSave(BaseModel):
    """Only keys present change. Unknown keys are refused rather than ignored,
    so a typo in the page cannot silently drop a value."""
    values: dict = Field(default_factory=dict)


@router.post("/api/profile")
async def save_profile(request: Request, payload: ProfileSave):
    from datetime import datetime

    from auto_apply.profile import join_phone

    values = payload.values or {}
    unknown = [k for k in values if k not in ALL_SPECS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown field(s): {', '.join(unknown)}")

    db = SessionLocal()
    try:
        user = _require_user(request, db)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()
        if not prof:
            prof = UserApplyProfile(user_id=user.id)
            db.add(prof)

        for key, raw in values.items():
            spec = ALL_SPECS[key]
            if spec.kind == "readonly":
                continue
            if key == "consent":
                if raw and not prof.auto_apply_consent_at:
                    prof.auto_apply_consent_at = datetime.utcnow()
                elif not raw:
                    prof.auto_apply_consent_at = None
                continue
            if spec.kind == "checkbox":
                setattr(prof, spec.column, bool(raw))
                continue
            if key == "phone":
                raw = raw if isinstance(raw, dict) else {}
                phone = join_phone(raw.get("code", ""), raw.get("number", ""))
                if len(phone) > 40:
                    raise HTTPException(status_code=422, detail="Phone number is too long.")
                prof.phone = phone
                continue
            text = str(raw if raw is not None else "").strip()
            if len(text) > spec.max_len:
                raise HTTPException(status_code=422,
                                    detail=f"{spec.label} is too long (max {spec.max_len}).")
            if spec.column in EEO_COLUMNS:
                text = eeo_canonical(spec.column, text)
                # An older free-text answer with no matching option may be sent
                # back unchanged; anything else must be one of the options.
                if text not in SELECT_VALUES[key] and text != (getattr(prof, spec.column, "") or ""):
                    raise HTTPException(status_code=422, detail=f"Invalid choice for {spec.label}.")
                setattr(prof, spec.column, text)
                continue
            if spec.kind == "select" and text not in SELECT_VALUES[key]:
                raise HTTPException(status_code=422, detail=f"Invalid choice for {spec.label}.")
            setattr(prof, spec.column, text)

        db.commit()
        db.refresh(prof)
        from auto_apply import resume_facts as rf

        return {"ok": True, **_page_model(_stored(prof, user), await _effective(db, user, prof),
                                          rf.load_cached_facts(db, user) is not None)}
    finally:
        db.close()


# ── saved answers ─────────────────────────────────────────────────────────

class AnswerEdit(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)


@router.get("/api/profile/answers")
async def list_answers(request: Request):
    db = SessionLocal()
    try:
        user = _require_user(request, db)
        rows = (db.query(UserApplyQA).filter(UserApplyQA.user_id == user.id)
                .order_by(UserApplyQA.updated_at.desc()).all())
        return {"answers": [{"id": r.id, "question": r.question_text, "answer": r.answer,
                             "updatedAt": r.updated_at.isoformat() if r.updated_at else None}
                            for r in rows]}
    finally:
        db.close()


def _own_answer(db, user, answer_id: int):
    row = (db.query(UserApplyQA)
           .filter(UserApplyQA.id == answer_id, UserApplyQA.user_id == user.id).first())
    if not row:
        raise HTTPException(status_code=404, detail="Answer not found")
    return row


@router.put("/api/profile/answers/{answer_id}")
async def edit_answer(request: Request, answer_id: int, payload: AnswerEdit):
    from auto_apply.match_guard import is_never_store

    db = SessionLocal()
    try:
        user = _require_user(request, db)
        row = _own_answer(db, user, answer_id)
        answer = payload.answer.strip()
        # The same refusal the extension's save path applies: a secret-shaped
        # value does not belong in a store that is replayed into forms.
        if is_never_store(row.question_text, answer):
            raise HTTPException(status_code=422,
                                detail="That answer can't be stored as a reusable answer.")
        row.answer = answer   # the question is unchanged, so its embedding still holds
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.delete("/api/profile/answers/{answer_id}")
async def delete_answer(request: Request, answer_id: int):
    db = SessionLocal()
    try:
        user = _require_user(request, db)
        db.delete(_own_answer(db, user, answer_id))
        db.commit()
        return {"ok": True}
    finally:
        db.close()
