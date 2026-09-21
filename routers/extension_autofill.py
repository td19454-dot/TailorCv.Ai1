"""Backend for the Chrome extension's client-side application autofill.

The extension fills a form in the user's own tab; this router is only the brain.
The split is deliberate and is the whole security model:

  * The BROWSER owns everything about the DOM — finding fields, writing values,
    verifying them. No page content is ever sent here beyond field labels and
    the option lists those fields offer.
  * The SERVER owns everything about the user — the answer bank, the learned
    answers, the quota, and the rule that a sensitive question can only be
    answered from a value the user themselves stored.

Endpoints:
  GET  /api/extension/apply-context      what we know about the user (cacheable)
  POST /api/extension/autofill/plan      field labels in, answers out (1 LLM call)
  POST /api/extension/apply-answers      save an answer the user typed
  GET  /api/extension/base-resume/file   the resume bytes, for the file input

One plan call per form page is the performance contract. The context is cached
in the extension for the browser session, so a typical application costs one
request.
"""

from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from database import SessionLocal
from models import User, UserApplyProfile
from schemas import ApplyAnswersRequest, AutofillPlanRequest

logger = logging.getLogger(__name__)
router = APIRouter()

# Long-form prose is never written into a form silently, however confident the
# model is — the v1 promise is that the user reviews before submitting, and a
# paragraph they did not read is the one thing they cannot review at a glance.
PROSE_KEYS = {"cover_letter", "why_do_you_want_this_role"}

MAX_FIELDS_PER_PLAN = 120
MAX_OPTIONS_PER_FIELD = 60


def _require_user(request: Request, db):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user


# ── GET /api/extension/apply-context ──────────────────────────────────────

@router.get("/api/extension/apply-context")
async def apply_context(request: Request):
    """Everything the extension needs to answer a form deterministically.

    Safe method, so CSRF does not apply. Cached client-side against
    profileVersion: the extension re-fetches only when that string changes,
    which is what keeps a second application on the same site at one request.
    """
    from main import is_pro, quota_exhausted
    from auto_apply import resume_facts as rf
    from auto_apply.profile import (
        answer_bank,
        build_applicant_profile,
        snapshot_user,
        validate_profile,
    )

    db = SessionLocal()
    try:
        user = _require_user(request, db)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()

        # Parse the resume into structured facts if we haven't already, or if the
        # resume changed. This is the one place that happens — the upload path
        # deliberately only invalidates, so it never grows an LLM call.
        facts = rf.load_cached_facts(db, user)
        if facts is None and (user.base_resume_text or "").strip():
            facts = await rf.build_resume_facts(user.base_resume_text)
            try:
                rf.store_facts(db, user, facts)
            except Exception:
                logger.warning("could not cache resume facts for user %s", user.id, exc_info=True)
                db.rollback()
        facts = facts or rf.empty_facts()

        snap = _context_snapshot(user, prof, facts)
        # narrative=False: no LLM call, so this endpoint stays fast enough to sit
        # on the critical path of the Autofill click.
        profile = await build_applicant_profile(snap, narrative=False)
        bank = answer_bank(profile)
        blockers = validate_profile(profile, snap)

        resume_ok = bool((user.base_resume_path or "").strip()
                         and os.path.exists(user.base_resume_path or ""))
        return {
            "profileVersion": _profile_version(user, prof, facts),
            "answerBank": bank,
            "facts": {
                "education": facts.get("education") or [],
                "workHistory": facts.get("work_history") or [],
                "address": facts.get("address") or {},
            },
            # Which sensitive categories the user has actually answered. The
            # extension shows "set this once in your profile" for the rest
            # instead of offering a free-text box, because these are answers
            # that belong on file, not per-application guesses.
            "sensitiveAnswered": {
                "workAuth": bool(bank.get("authorized_to_work_in_country")),
                "sponsorship": bool(bank.get("requires_visa_sponsorship")),
                "salary": bool(bank.get("expected_salary")),
                "eeo": bool(bank.get("gender") or bank.get("race_ethnicity")
                            or bank.get("veteran_status") or bank.get("disability_status")),
            },
            "blockers": blockers,
            "hasResume": resume_ok,
            "resumeFilename": user.base_resume_filename or "resume.pdf",
            "hasCoverLetter": bool((user.base_cover_letter_path or "").strip()
                                   and os.path.exists(user.base_cover_letter_path or "")),
            "coverLetterFilename": user.base_cover_letter_filename or "cover_letter.pdf",
            "quota": {
                "exhausted": quota_exhausted(db, user, "autofills"),
                "isPro": is_pro(user),
            },
        }
    finally:
        db.close()


def _context_snapshot(user, prof, facts: dict) -> dict:
    """snapshot_user()'s shape, without a job.

    snapshot_user itself requires a JobListing row, because the server engine
    always applies to a job it ingested. The extension applies to whatever page
    the user is on, which is usually not in our database at all — so the job
    fields are simply absent, and nothing downstream needs them: the answer bank
    is per-user, and narrative generation (the only job-dependent part) is off.
    """
    from auto_apply.profile import _profile_to_dict

    return {
        "user_id": user.id,
        "name": user.name or "",
        "email": user.email or "",
        "resume_path": user.base_resume_path or "",
        "resume_filename": user.base_resume_filename or "",
        "resume_text": user.base_resume_text or "",
        "cover_letter_path": user.base_cover_letter_path or "",
        "cover_letter_filename": user.base_cover_letter_filename or "",
        "profile": _profile_to_dict(prof),
        "resume_facts": facts,
        # The plan endpoint does QA recall itself, with embeddings; putting the
        # whole answer list in the bank as well would duplicate it into every
        # prompt for no gain.
        "qa_entries": [],
    }


def _profile_version(user, prof, facts: dict) -> str:
    """Changes whenever anything in the context could have changed.

    The extension's cache key. Deliberately includes the resume hash rather than
    a timestamp: an in-place re-upload of a same-named file leaves every
    timestamp we have untouched.
    """
    import hashlib

    from auto_apply.resume_facts import resume_text_hash

    parts = [
        str(getattr(prof, "updated_at", "") or ""),
        resume_text_hash(user.base_resume_text or "")[:16],
        str(user.base_cover_letter_path or ""),
        str(facts.get("version") or 0),
        str(user.name or ""),
        str(user.email or ""),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:20]


# ── POST /api/extension/autofill/plan ─────────────────────────────────────

@router.post("/api/extension/autofill/plan")
async def autofill_plan(request: Request, payload: AutofillPlanRequest):
    """Answers for the fields the extension found. One LLM call, at most.

    Fields the extension could already answer from the deterministic tier are
    not sent here at all, so this only ever sees the remainder.
    """
    from main import enforce_quota, refund_quota
    from auto_apply import qa_store
    from auto_apply.match_guard import classify_sensitive, is_never_fill
    from auto_apply.profile import answer_bank, build_applicant_profile

    db = SessionLocal()
    charged_user_id = None
    try:
        user = _require_user(request, db)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()

        fields = list(payload.fields or [])[:MAX_FIELDS_PER_PLAN]
        if not fields:
            return {"answers": {}, "ask": [], "sensitiveSkipped": []}

        # Re-derive the locks here rather than trusting what the request says. A
        # client claiming sensitive=false about "Are you legally authorized to
        # work in the United States?" must not get an answer for it; the flags
        # are OR'd, so the request can only ever add caution, never remove it.
        for f in fields:
            f.sensitive = bool(f.sensitive) or bool(classify_sensitive(f.label))
            f.neverFill = bool(is_never_fill(f.label))

        # Charged before the work, refunded if the work fails — the same shape
        # every other metered feature here uses. 402 carries the code the
        # extension's existing upgrade-prompt path already handles.
        enforce_quota(db, user, "autofills")
        charged_user_id = user.id

        from auto_apply import resume_facts as rf

        facts = rf.load_cached_facts(db, user) or rf.empty_facts()
        snap = _context_snapshot(user, prof, facts)
        profile = await build_applicant_profile(snap, narrative=False)
        bank = answer_bank(profile)

        answers: dict[str, dict] = {}
        ask: list[int] = []

        # ── Tier 2: recall a stored answer, exactly or semantically ──
        stored = qa_store.load_answers(db, user.id)
        recall_targets = [f for f in fields if not f.sensitive and not f.neverFill]
        label_vectors: list[list[float]] = []
        if stored and recall_targets:
            await qa_store.backfill_embeddings(db, user.id, stored)
            label_vectors = await _embed_quietly([f.label for f in recall_targets])

        for idx, f in enumerate(recall_targets):
            vector = label_vectors[idx] if idx < len(label_vectors) else []
            hit = qa_store.recall(f.label, vector, stored)
            if not hit:
                continue
            value = _resolve_against_options(hit["answer"], f)
            if value is None:
                continue
            answers[str(f.i)] = {
                "value": value,
                "source": "saved_answer",
                "confidence": 0.85 if hit["confident"] else 0.6,
                "matchedQuestion": hit["question"],
            }

        # ── Tier 3: one LLM call for whatever is left ──
        # What the model is allowed to see. Everything sensitive, every
        # never-fill identifier and every document slot is absent, so there is no
        # index it could return for one of those.
        remaining = [f for f in fields
                     if str(f.i) not in answers
                     and not f.sensitive and not f.neverFill and not f.documentSlot
                     # Identified but empty in the profile (Middle Name for
                     # someone with none): the model could only borrow a
                     # neighbouring value, e.g. the full name.
                     and not f.recallOnly]
        if remaining:
            try:
                llm = await _llm_answers(bank, remaining, payload)
            except Exception:
                logger.exception("autofill plan: answer-mapping LLM call failed")
                llm = {}
            for f in remaining:
                raw = llm.get(str(f.i))
                if raw is None or not str(raw).strip():
                    continue
                value = _resolve_against_options(str(raw), f)
                if value is None:
                    continue
                key = _bank_key_for(value, bank)
                exact_option = bool(f.options) and _is_listed_option(value, f)
                prose = key in PROSE_KEYS or len(str(value)) > 180
                answers[str(f.i)] = {
                    "value": value,
                    "source": "ai",
                    # Verifiable (the value is one of the options the form
                    # itself offers) earns autofill; prose never does.
                    "confidence": 0.55 if prose else (0.8 if exact_option else 0.65),
                }

        # Anything required that nothing answered is the user's to fill in. A
        # sensitive field with no stored answer is always asked, required or not:
        # leaving it blank is the honest outcome, and the sidebar points the user
        # at their profile rather than offering a free-text box.
        for f in fields:
            if str(f.i) in answers or f.neverFill:
                continue
            if f.required or f.sensitive:
                ask.append(f.i)

        return {
            "answers": answers,
            "ask": ask,
            "sensitiveSkipped": [f.i for f in fields if f.sensitive],
            "neverFill": [f.i for f in fields if f.neverFill],
        }
    except HTTPException:
        if charged_user_id:
            refund_quota(db, charged_user_id, "autofills")
        raise
    except Exception:
        if charged_user_id:
            refund_quota(db, charged_user_id, "autofills")
        logger.exception("autofill plan failed")
        raise HTTPException(status_code=500, detail="Could not build an autofill plan.")
    finally:
        db.close()


async def _embed_quietly(labels: list[str]) -> list[list[float]]:
    try:
        from functions import embed_texts

        return await embed_texts(labels)
    except Exception:
        logger.warning("could not embed field labels; exact recall still works", exc_info=True)
        return []


def _is_listed_option(value: str, f) -> bool:
    from auto_apply.browser import _normalize_option_text

    target = _normalize_option_text(value)
    return any(_normalize_option_text(o) == target for o in (f.options or []))


def _resolve_against_options(value: str, f):
    """Coerce a value onto one of the field's real options, or refuse.

    Returns None when the field offers a fixed set and nothing in it matches.
    Refusing is the point: the same stored value cannot be expected to fit two
    employers' dropdowns for the "same" question — one company's location field
    is a country list, another's is "USA / Canada / Elsewhere" — so a value that
    is not on this form's menu must become a question for the user rather than a
    wrong selection.
    """
    from auto_apply.browser import _best_option_match

    text = str(value or "").strip()
    if not text:
        return None
    options = list(f.options or [])[:MAX_OPTIONS_PER_FIELD]
    if not options:
        return text
    match = _best_option_match(text, [{"value": o, "label": o} for o in options])
    return match["label"] if match else None


def _bank_key_for(value: str, bank: dict) -> str:
    """Which answer-bank key a value came from, if any — used to spot prose."""
    for key, stored in bank.items():
        if isinstance(stored, str) and stored and stored == value:
            return key
    return ""


def _fields_block(fields) -> str:
    lines = []
    for f in fields:
        line = f"{f.i}: {f.label}"
        options = list(f.options or [])[:MAX_OPTIONS_PER_FIELD]
        if options:
            line += ("  [OPTIONS — pick exactly one of these: "
                     + " | ".join(str(o) for o in options) + "]")
        lines.append(line)
    return "\n".join(lines)


async def _llm_answers(bank: dict, fields, payload) -> dict:
    """The single answer-mapping call.

    Reuses the server engine's _FIELD_ANSWER_PROMPT verbatim rather than writing
    a second one. That prompt already carries the rules this needs and the
    reasons they exist — the pick-exactly-one-listed-option constraint with its
    worked "Kolkata, India" -> "Elsewhere" example, the consent/marketing
    answer-yes rule, and the refusal to invent anything absent from
    CANDIDATE_DATA. Two prompts would drift, and the extension would slowly
    relearn bugs this one has already had fixed.

    Note what is NOT in `fields` by the time it gets here: every sensitive field
    was removed by the caller. The model cannot return an index it was never
    shown, which is what makes "never guess work authorization" a property of
    the code rather than a line of prompt text the model might ignore.
    """
    from auto_apply.browser import _FIELD_ANSWER_PROMPT
    from functions import get_resume_response

    candidate = dict(bank)
    if payload.jobTitle:
        candidate["_applying_for"] = payload.jobTitle
    if payload.jobCompany:
        candidate["_company"] = payload.jobCompany

    prompt = _FIELD_ANSWER_PROMPT.format(
        candidate_json=json.dumps(candidate, ensure_ascii=False, indent=1),
        fields_block=_fields_block(fields),
    )
    raw = await get_resume_response(prompt)
    parsed = json.loads(raw)
    answers = parsed.get("answers") if isinstance(parsed, dict) else None
    return answers if isinstance(answers, dict) else {}


# ── POST /api/extension/apply-answers ─────────────────────────────────────

@router.post("/api/extension/apply-answers")
async def save_apply_answers(request: Request, payload: ApplyAnswersRequest):
    """Remember an answer the user typed, for next time.

    Shares its storage with the dashboard's answer-and-retry modal, so an answer
    learned here immediately improves the server-side auto-apply engine too.
    """
    from auto_apply import qa_store
    from auto_apply.match_guard import is_never_store

    db = SessionLocal()
    try:
        user = _require_user(request, db)
        items = [
            {"question": a.question.strip(), "answer": a.answer.strip()}
            for a in (payload.answers or [])
            if a.question.strip() and a.answer.strip()
        ]
        # Server-side refusal, not merely a client-side filter: a secret must
        # never be storable by a request that claims it is an ordinary answer.
        kept = [i for i in items if not is_never_store(i["question"], i["answer"])]
        rejected = len(items) - len(kept)
        if not kept:
            return {"ok": True, "saved": 0, "rejected": rejected}

        vectors = await _embed_quietly([i["question"] for i in kept])
        embeddings = {
            i["question"]: v for i, v in zip(kept, vectors) if v
        }
        saved = qa_store.upsert_answers(db, user.id, kept, embeddings)
        return {"ok": True, "saved": saved, "rejected": rejected}
    finally:
        db.close()


# ── GET /api/extension/base-resume/file ───────────────────────────────────

@router.get("/api/extension/base-resume/file")
async def base_resume_file(request: Request, doc: str = "resume"):
    """The raw bytes of the user's base resume or cover letter.

    The extension needs the actual file to build a File object and put it on the
    page's <input type=file> — there is no way to attach a document without it.
    Existence is checked rather than trusted: Render's disk is ephemeral, so a
    path in the database is not proof of a file, and every other resume call
    site checks the same way.
    """
    db = SessionLocal()
    try:
        user = _require_user(request, db)
        if doc == "cover_letter":
            path = user.base_cover_letter_path or ""
            filename = user.base_cover_letter_filename or "cover_letter.pdf"
        else:
            path = user.base_resume_path or ""
            filename = user.base_resume_filename or "resume.pdf"
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=404, detail="No file on file.")
        return FileResponse(path, media_type="application/pdf", filename=filename)
    finally:
        db.close()
