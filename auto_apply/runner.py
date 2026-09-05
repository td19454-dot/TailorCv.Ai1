"""Auto-apply orchestration: the asyncio worker that drives one run.

There is no job queue in this app, and a run takes 1-5 minutes, so a run is an
asyncio task holding a semaphore slot, with all state in the auto_apply_runs
row that the frontend polls.

Two rules encoded structurally here rather than left to the agent:

  1. The agent is told NOT to click submit. Submission is a separate,
     deterministic act() after the verify step. That keeps AUTO_APPLY_SUBMIT=0
     an honest dry run, and stops an agent's "I think I submitted it" from
     becoming status='submitted'.
  2. status='submitted' requires an extracted confirmation signal. Without one
     the run ends as needs_input, because a false success is worse than an
     honest unknown — the user stops following up on the role.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import threading
import time
from datetime import datetime

from auto_apply import config
from auto_apply.profile import (
    ApplicantProfile,
    build_applicant_profile,
    question_signature,
    snapshot_user,
    validate_profile,
)

logger = logging.getLogger(__name__)

_SEM: asyncio.Semaphore | None = None
# Strong refs: asyncio only holds weak references to tasks, so a GC'd task
# would silently vanish mid-run.
_TASKS: set[asyncio.Task] = set()
# Browsers currently owned by a run. Normally each run's own finally closes
# its browser; this exists so shutdown can close one whose run is wedged and
# therefore never reaches that finally.
_LIVE_BROWSERS: set = set()

# Every DB write in a run goes through _db_call with this bound. Writes are
# small and local; anything past this means the connection is wedged, not
# that the query is genuinely slow.
_DB_TIMEOUT_SECONDS = 20.0
# build_applicant_profile()'s narrative LLM call has no bound of its own.
_PROFILE_BUILD_TIMEOUT_SECONDS = 90.0

def _submit_db(fn, args) -> "concurrent.futures.Future":
    """Run fn on a throwaway daemon thread, reporting into a Future.

    Deliberately not a ThreadPoolExecutor: its workers are non-daemon and are
    joined by an atexit hook, so a single wedged DB thread would hang the whole
    process on shutdown (confirmed — a test with a wedged write refused to exit
    and had to be killed). Daemon threads let the interpreter exit and abandon
    them, which is the right trade for a write we have already given up on.
    A wedged thread also can't starve anything else here, since each call gets
    its own thread rather than a slot in a shared pool.
    """
    fut: "concurrent.futures.Future" = concurrent.futures.Future()

    def _run():
        if not fut.set_running_or_notify_cancel():
            return
        try:
            fut.set_result(fn(*args))
        except BaseException as exc:  # noqa: BLE001 — must not die silently
            fut.set_exception(exc)

    threading.Thread(target=_run, daemon=True, name="auto-apply-db").start()
    return fut


async def _db_call(fn, *args, timeout: float = _DB_TIMEOUT_SECONDS):
    """Run a blocking DB function off the event loop, bounded.

    Deliberately NOT `asyncio.wait_for(asyncio.to_thread(...))`: cancelling an
    executor future that has already started leaves the asyncio future pending
    forever, so wait_for hangs instead of timing out — the same trap already
    documented in browser.py's _run_playwright, and the confirmed cause of a
    run sitting at "Finishing the last few fields…" for 584s with the outer
    420s run timeout never firing (a to_thread in progress swallows that
    cancellation until its thread returns).

    Polling fut.done() keeps the decision on this side of the thread boundary:
    nothing here depends on the DB thread cooperating. A wedged thread is
    abandoned (it is a daemon, so it blocks neither other work nor shutdown)
    and the run carries on.
    """
    fut = _submit_db(fn, args)
    deadline = time.monotonic() + timeout
    while True:
        if fut.done():
            return fut.result()
        if time.monotonic() >= deadline:
            fut.cancel()  # best effort: only lands if it never started
            raise TimeoutError(f"db call exceeded {timeout:.0f}s")
        await asyncio.sleep(0.05)


async def _db_call_safe(fn, *args, timeout: float = _DB_TIMEOUT_SECONDS) -> bool:
    """_db_call, but a timeout is logged rather than raised.

    Used for progress writes (stage/note). Losing one progress row matters far
    less than the run reaching a terminal state — a raise here would abort the
    run partway and leave exactly the orphaned `running` row this is meant to
    prevent."""
    try:
        await _db_call(fn, *args, timeout=timeout)
        return True
    except Exception:
        logger.warning("auto-apply DB write timed out or failed; continuing", exc_info=True)
        return False

MAX_FORM_PAGES = 4

# How many times the repair stage may re-sweep the page. Bounded because each
# sweep still costs one observe() + one answer-mapping LLM call (~20-40s), and
# the whole run has to fit inside config.run_timeout_seconds(). Convergence is
# normally reached in 2 — the loop stops as soon as a pass fills nothing new.
_MAX_FILL_SWEEPS = 3

TERMINAL = ("submitted", "needs_input", "failed", "dry_run")

STAGE_TEXT = {
    "preparing": "Getting your details ready…",
    "opening_browser": "Opening a browser…",
    "loading_page": "Loading the application page…",
    "reading_page": "Reading the form…",
    "opening_form": "Opening the application form…",
    "attaching_resume": "Attaching your resume…",
    "filling_form": "Filling in your details…",
    "verifying": "Checking every field…",
    "submitting": "Submitting your application…",
    "confirming": "Confirming the submission…",
}

# A field whose label looks like a file-attachment requirement (Cover
# Letter, Writing Sample, ...) is one fill_form() already refuses to even
# attempt (see browser.py's _SKIP_DESCRIPTION_MARKERS), so it can still show
# up in the verify step's missing_required (the site's own required-marking
# doesn't care why it's empty), and can never be resolved by typing an
# answer in the "answer and retry" modal — a document-upload feature
# auto-apply doesn't have — so it must never be offered there as if it
# could be. Deliberately excludes "portfolio" despite it usually meaning a
# file elsewhere: a "Portfolio URL" field is a normal, already-answerable
# text field (answer_bank()'s portfolio_or_website) far more often than it's
# an upload, and misclassifying that one would wrongly hide a real,
# resolvable question from the modal instead of just misrouting an
# unresolvable one.
_DOCUMENT_FIELD_MARKERS = ("cover letter", "resume", "cv", "writing sample", "attach", "upload", "document")


def _split_missing_by_type(missing: list[str]) -> tuple[list[str], list[str]]:
    """(text_answerable, needs_document) — see _DOCUMENT_FIELD_MARKERS."""
    text_fields, document_fields = [], []
    for label in missing:
        lowered = label.lower()
        (document_fields if any(m in lowered for m in _DOCUMENT_FIELD_MARKERS) else text_fields).append(label)
    return text_fields, document_fields


# Which attached-document slot a missing-field label refers to, if any. Only
# these two are ones we ever attach ourselves; a Portfolio or Writing Sample
# label stays unmatched and is still reported as needing the user.
_DOCUMENT_SLOT_MARKERS = (
    ("cover_letter", ("cover letter", "coverletter")),
    ("resume", ("resum", "cv", "curriculum")),
)


def _document_slot_for(label: str) -> str | None:
    lowered = (label or "").lower()
    for slot, markers in _DOCUMENT_SLOT_MARKERS:
        if any(m in lowered for m in markers):
            return slot
    return None


def _drop_documents_already_attached(
    document_missing: list[str], attached: dict[str, list[str]]
) -> tuple[list[str], list[str]]:
    """(still_missing, satisfied) — never tell the user we couldn't attach
    something that is demonstrably sitting in the form right now.

    The verify step reads Resume/CV as missing on Greenhouse whenever the real
    file input is hidden behind an "Attach" button, since there is no visible
    filename to read. Left unchecked that ends the run with "we can't attach
    this automatically — finish it by hand" for a resume we not only can
    attach but already did, and the application is never submitted."""
    still_missing, satisfied = [], []
    for label in document_missing:
        slot = _document_slot_for(label)
        (satisfied if slot and attached.get(slot) else still_missing).append(label)
    return still_missing, satisfied


# Words that carry no identifying weight in a form label, so they don't count
# toward "these two labels name the same question".
_LABEL_STOPWORDS = frozenset("""
a an and any are as at be by can do does for from have has how i if in is it
me my no not of on or please provide select that the their this to us was we
what when where which who will with would you your now future
""".split())


def _distinctive(label: str) -> set[str]:
    return {t for t in question_signature(label).split() if t not in _LABEL_STOPWORDS}


def _labels_match(a: str, b: str) -> bool:
    """Whether two form labels name the same question.

    Deliberately NOT a similarity ratio. The EEO block is a set of labels that
    differ by a single word — "What is your military status?" vs "What is your
    disability status?" scores 0.85 on SequenceMatcher, and treating those as
    the same question would drop a genuinely-empty required field from the
    missing list and submit the application without it. Token containment has
    no such failure: neither is a subset of the other.

    Matches when the normalised labels are equal, or when one's distinctive
    words are wholly contained in the other's (so "Gender identity" matches
    "What is your gender identity?", and a trailing "*" or "(optional)" is
    irrelevant). At least two distinctive words are required, so a stopword-only
    or one-word label can never match broadly."""
    na, nb = question_signature(a), question_signature(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    da, db = _distinctive(a), _distinctive(b)
    if not da or not db:
        return False
    small, large = (da, db) if len(da) <= len(db) else (db, da)
    return len(small) >= 2 and small <= large


def _drop_fields_already_filled(
    missing: list[str], filled_labels: list[str]
) -> tuple[list[str], list[str]]:
    """(still_missing, already_filled) — reconcile the verify step's list
    against what the page demonstrably holds.

    The verify step is an LLM read and is wrong in one specific, repeatable
    direction: it reports react-select fields as empty because the committed
    value renders into a wrapper div rather than the input it inspects. Left
    unreconciled that blocks submission of forms that are completely filled.

    Deliberately one-directional — this only ever removes a field the DOM says
    is filled. A field the probe knows nothing about stays in `missing`, so a
    failed or empty probe degrades to exactly the previous behaviour."""
    if not filled_labels:
        return list(missing), []
    still_missing, already = [], []
    for label in missing:
        matched = any(_labels_match(label, f) for f in filled_labels)
        (already if matched else still_missing).append(label)
    return still_missing, already

# The per-field fill instructions that used to live in AGENT_SYSTEM_PROMPT for
# the autonomous Browserbase agent now live in browser.py's fill_form(), which
# is the only place that still talks to an LLM about individual form fields —
# see its module docstring for why the agent approach isn't available locally.

PAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "is_application_form": {"type": "boolean"},
        "requires_login": {"type": "boolean"},
        "has_captcha": {"type": "boolean"},
        "apply_button_text": {"type": "string"},
    },
    "required": ["is_application_form", "requires_login", "has_captcha"],
}

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "missing_required": {"type": "array", "items": {"type": "string"}},
        "resume_attached": {"type": "boolean"},
        "blocked_reason": {"type": "string"},
        "email_field_value": {"type": "string"},
        "name_field_value": {"type": "string"},
    },
    "required": ["missing_required", "resume_attached"],
}

VERIFY_INSTRUCTION = (
    "List the labels of any REQUIRED fields on this form that are still empty or "
    "invalid, and say whether a resume file is attached. Also report the CURRENT "
    "value typed into the email field and the name field, exactly as they appear "
    "right now — this is a safety check, report the literal text even if it looks wrong."
)

CONFIRM_SCHEMA = {
    "type": "object",
    "properties": {
        "submitted": {"type": "boolean"},
        "confirmation_text": {"type": "string"},
        "error_text": {"type": "string"},
        "has_next_page": {"type": "boolean"},
        "rejected_permanently": {"type": "boolean"},
    },
    "required": ["submitted"],
}


# ── task plumbing ────────────────────────────────────────────────────────────

def _sem() -> asyncio.Semaphore:
    global _SEM
    if _SEM is None:
        _SEM = asyncio.Semaphore(config.max_concurrency())
    return _SEM


def enqueue_run(run_id: int) -> None:
    task = asyncio.create_task(_worker(run_id))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def shutdown_runs(grace: float = 15.0) -> None:
    """Cancel in-flight runs and make sure no Chromium outlives this process.

    Cancelling gives each run's own finally a chance to close its browser and
    mark its row terminal, which is the clean path. Anything still registered
    after the grace period belongs to a run too wedged to reach that finally,
    so its browser is closed directly — otherwise a restart (or any --reload)
    abandons a live Chromium, which is how they accumulated."""
    tasks = [t for t in _TASKS if not t.done()]
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    for browser in list(_LIVE_BROWSERS):
        _LIVE_BROWSERS.discard(browser)
        try:
            await asyncio.wait_for(browser.end(), timeout=grace)
        except BaseException:  # noqa: BLE001 — shutdown must finish regardless
            logger.warning("could not close a browser during shutdown", exc_info=True)


async def _worker(run_id: int) -> None:
    async with _sem():
        try:
            await asyncio.wait_for(_execute(run_id), timeout=config.run_timeout_seconds())
        except asyncio.TimeoutError:
            mins = int(config.run_timeout_seconds() // 60)
            await _finish(run_id, "failed", f"Timed out after about {mins} minutes.", error="timeout")
        except Exception as exc:
            logger.exception("auto-apply run %s crashed", run_id)
            await _log_note(run_id, f"run crashed: {exc!r}")
            await _finish(run_id, "failed", "Something went wrong while applying.", error=repr(exc))


# ── DB helpers (sync SQLAlchemy, always off the event loop) ──────────────────

def _db_write(run_id: int, fields: dict, step: dict | None = None) -> None:
    from database import SessionLocal
    from models import AutoApplyRun

    db = SessionLocal()
    try:
        run = db.query(AutoApplyRun).filter(AutoApplyRun.id == run_id).first()
        if not run:
            return
        for key, value in fields.items():
            setattr(run, key, value)
        if step:
            try:
                steps = json.loads(run.steps) if run.steps else []
            except (TypeError, ValueError):
                steps = []
            steps.append(step)
            run.steps = json.dumps(steps[-40:])
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to persist auto-apply run %s", run_id)
    finally:
        db.close()


async def _set_stage(run_id: int, stage: str, detail: str | None = None) -> None:
    text = detail or STAGE_TEXT.get(stage, "Working…")
    await _db_call_safe(
        _db_write,
        run_id,
        {"status": "running", "stage": stage, "detail": text},
        {"t": datetime.utcnow().isoformat(), "stage": stage, "detail": text},
    )


async def _log_note(run_id: int, note: str) -> None:
    """Append a diagnostic line to the run's step history without touching
    status/stage/detail — those drive the live UI (paintAuto() shows `detail`
    in the note area), and a technical field-by-field breakdown isn't
    something a user should see flash by mid-run. This is purely for
    reading back afterward: `python -c "...AutoApplyRun.steps..."` (or a
    future admin view) shows exactly what fill_form() found/answered/failed
    at each stage, instead of that only ever reaching a terminal via Python's
    logger — which nothing persists once the process that printed it moves
    on."""
    logger.info("run %s: %s", run_id, note)
    await _db_call_safe(
        _db_write,
        run_id,
        {},
        {"t": datetime.utcnow().isoformat(), "stage": "note", "detail": note[:500]},
    )


async def _finish(
    run_id: int,
    status: str,
    detail: str,
    *,
    error: str | None = None,
    confirmation: str | None = None,
    missing: list[str] | None = None,
) -> None:
    fields = {
        "status": status,
        "detail": detail,
        "finished_at": datetime.utcnow(),
        "submitted": status == "submitted",
    }
    if error is not None:
        fields["error"] = error
    if confirmation is not None:
        fields["confirmation_text"] = confirmation
    if missing is not None:
        fields["missing_fields"] = json.dumps(missing[:25])
    # Safe (non-raising) on purpose: this is the write that makes a run
    # terminal. If it times out we still want the rest of _finish to run and
    # the worker to unwind — raising here would abort mid-cleanup and leave
    # exactly the stuck `running` row the periodic reaper then has to mop up.
    await _db_call_safe(
        _db_write,
        run_id,
        fields,
        {"t": datetime.utcnow().isoformat(), "stage": status, "detail": detail},
    )
    if status in ("submitted", "needs_input"):
        await _db_call_safe(_record_application, run_id, status)


def _record_application(run_id: int, status: str) -> None:
    """Write the user-facing history row — only on a terminal outcome.

    Never on enqueue: if the browser did not actually send anything, the user's
    application history must not claim they applied."""
    from database import SessionLocal
    from models import AutoApplyRun, JobBoardApplication

    db = SessionLocal()
    try:
        run = db.query(AutoApplyRun).filter(AutoApplyRun.id == run_id).first()
        if not run or run.job_board_application_id:
            return
        entry = JobBoardApplication(
            user_id=run.user_id,
            job_listing_id=run.job_listing_id,
            method="auto",
            status="submitted" if status == "submitted" else "needs_review",
        )
        db.add(entry)
        db.flush()
        run.job_board_application_id = entry.id
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to log JobBoardApplication for run %s", run_id)
    finally:
        db.close()


def _load_run(run_id: int) -> dict:
    from database import SessionLocal
    from models import AutoApplyRun

    db = SessionLocal()
    try:
        run = db.query(AutoApplyRun).filter(AutoApplyRun.id == run_id).first()
        if not run:
            return {}
        return {"user_id": run.user_id, "job_listing_id": run.job_listing_id, "dry_run": bool(run.dry_run)}
    finally:
        db.close()


def _snapshot(user_id: int, job_id: int) -> dict:
    from database import SessionLocal

    db = SessionLocal()
    try:
        return snapshot_user(db, user_id, job_id)
    finally:
        db.close()


def _refund(user_id: int) -> None:
    """Give the monthly allowance back when a run dies before it could do
    anything useful — the user shouldn't pay for our failure."""
    from database import SessionLocal

    db = SessionLocal()
    try:
        from main import refund_quota

        refund_quota(db, user_id, "auto_applies")
    except Exception:
        logger.exception("could not refund auto-apply quota for user %s", user_id)
    finally:
        db.close()


# ── the run itself ───────────────────────────────────────────────────────────

def _email_corrupted(reported: str, expected: str) -> bool:
    """True if the email field's actual current value doesn't look like the
    real email — the signal for a grounding mis-target overwriting it.

    Observed in practice: a form with no dedicated cover-letter field led the
    agent's field-description grounding to resolve "Cover Letter" to the
    Email input's own selector and .fill() it, replacing the address outright
    with the full cover letter text. A short field containing the expected
    address is healthy; anything long, spaced, or missing '@' is not."""
    reported = (reported or "").strip().lower()
    expected = (expected or "").strip().lower()
    if not reported or not expected:
        return False
    if expected in reported:
        return False
    return len(reported) > 60 or " " in reported or "@" not in reported


def _name_corrupted(reported: str, expected: str) -> bool:
    reported = (reported or "").strip()
    expected = (expected or "").strip()
    if not reported or not expected:
        return False
    if expected.lower() in reported.lower():
        return False
    return len(reported) > len(expected) + 40


async def _repair_field(run_id: int, browser, label: str, bad_value: str, correct_value: str) -> None:
    await _set_stage(run_id, "filling_form", f"Fixing the {label.lower()} field…")
    try:
        ok = await browser.set_field(label, correct_value)
        if not ok:
            logger.warning(
                "run %s could not locate the %s field to repair (was %r)",
                run_id, label.lower(), bad_value[:200],
            )
            await _log_note(run_id, f"{label} repair: field not found (bad value was {bad_value[:200]!r})")
    except Exception as exc:
        logger.exception("run %s %s-repair pass failed", run_id, label.lower())
        await _log_note(run_id, f"{label} repair raised: {exc!r}")


async def _execute(run_id: int) -> None:
    meta = _load_run(run_id)
    if not meta:
        return

    await _db_call_safe(_db_write, run_id, {"started_at": datetime.utcnow()})
    await _set_stage(run_id, "preparing")

    try:
        snap = await _db_call(_snapshot, meta["user_id"], meta["job_listing_id"])
    except Exception:
        logger.exception("run %s could not read its snapshot", run_id)
        snap = None
    if not snap:
        await _db_call_safe(_refund, meta["user_id"])
        await _finish(run_id, "failed", "That job is no longer available.", error="snapshot_missing")
        return

    # build_applicant_profile makes an LLM call for the narrative fields with
    # no bound of its own (tenacity retries on top of the OpenAI SDK's own
    # retries can run into the tens of minutes). Bounded here so a stalled
    # provider can't hold a run in "preparing" — the narrative fields are a
    # nice-to-have, so failing this is not fatal on its own.
    try:
        profile = await asyncio.wait_for(build_applicant_profile(snap), timeout=_PROFILE_BUILD_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.exception("run %s could not build the applicant profile", run_id)
        await _db_call_safe(_refund, meta["user_id"])
        await _finish(run_id, "failed", "Couldn't prepare your details. Try again.", error=repr(exc))
        return

    blockers = validate_profile(profile, snap)
    if blockers:
        # Nothing was spent yet — no session, so give the run back.
        await _db_call_safe(_refund, meta["user_id"])
        await _finish(run_id, "failed", blockers[0], error="profile_incomplete", missing=blockers)
        return

    await _set_stage(run_id, "opening_browser")
    from auto_apply.browser import open_browser

    try:
        browser = await open_browser()
    except Exception as exc:
        logger.exception("could not open local browser session for run %s", run_id)
        await _db_call_safe(_refund, meta["user_id"])
        await _finish(run_id, "failed", "Couldn't start the browser. Try again in a moment.", error=repr(exc))
        return

    # Everything from here owns a live browser, so it all sits inside the
    # try/finally — including the session-identity write, which used to run
    # before it. A hang or raise in that write left a Chromium with no owner
    # and no end(), which is one of the confirmed sources of leaked browsers.
    try:
        # Registered first thing, so shutdown can still close this browser if
        # the run is wedged anywhere below — including in the write that follows.
        _LIVE_BROWSERS.add(browser)
        # Persist session identity: if anything below dies, the user can
        # still watch the live view or read the replay.
        await _db_call_safe(
            _db_write,
            run_id,
            {
                "browserbase_session_id": browser.session_id,
                "live_view_url": browser.live_view_url,
                "replay_url": browser.replay_url,
            },
        )
        await _drive(run_id, browser, profile, snap, meta)
    finally:
        _LIVE_BROWSERS.discard(browser)
        await browser.end()


async def _drive(run_id: int, browser, profile: ApplicantProfile, snap: dict, meta: dict) -> None:
    apply_url = snap.get("apply_url") or ""

    await _set_stage(run_id, "loading_page")
    try:
        await browser.navigate_to_application(apply_url)
    except Exception as exc:
        await _finish(run_id, "failed", "Couldn't open the application page.", error=repr(exc))
        return

    await _set_stage(run_id, "reading_page")
    page = await browser.extract(
        "Describe this page: is it a job application form the visitor can fill in, does it "
        "require signing in or creating an account, and is there a CAPTCHA or bot check?",
        PAGE_SCHEMA,
    )

    # A CAPTCHA blocks the final submit click, not filling in the rest of the
    # form — so it's tracked and only acted on right before that point,
    # rather than stopping the whole run here. That way the user gets a
    # fully-filled form to finish by hand (just solve the CAPTCHA and click
    # submit) instead of an untouched one. requires_login is different: it
    # blocks seeing/filling the form at all on most ATS, so that one still
    # stops immediately below.
    captcha_present = bool(page.get("has_captcha"))

    if page.get("requires_login"):
        await _finish(
            run_id, "needs_input",
            "This employer requires an account login before applying.",
            error="login_required",
        )
        return

    if not page.get("is_application_form"):
        await _set_stage(run_id, "opening_form")
        try:
            await browser.act(page.get("apply_button_text") or "Click the apply button to open the application form")
            page = await browser.extract("Is this now a job application form the visitor can fill in?", PAGE_SCHEMA)
            captcha_present = captcha_present or bool(page.get("has_captcha"))
        except Exception as exc:
            logger.exception("run %s could not open the form", run_id)
            await _log_note(run_id, f"opening_form failed: {exc!r}")
        if not page.get("is_application_form"):
            await _finish(
                run_id, "needs_input",
                "Couldn't find an application form on that page.",
                error="no_form",
            )
            return

    # Attach the resume before filling: most ATS parse the PDF and pre-populate
    # name/email/experience, which shrinks the agent's job to corrections.
    await _set_stage(run_id, "attaching_resume")
    attached = await browser.upload_resume(profile.resume_path)
    await _log_note(run_id, f"resume upload {'succeeded' if attached else 'FAILED'}")

    # Same idea for a Cover Letter file field, if this form has one and the
    # user has a base cover letter on file — description-aware, unlike
    # upload_resume(), so it can never land in the actual Resume/CV input.
    # Skipped entirely (not even attempted) when there's nothing to attach —
    # a form that requires one and gets nothing still surfaces honestly via
    # the document_missing path below, unchanged from before this existed.
    if profile.cover_letter_path:
        cover_letter_attached = await browser.upload_cover_letter(profile.cover_letter_path)
        if cover_letter_attached:
            await _log_note(run_id, "cover letter attached")

    await _set_stage(run_id, "filling_form")
    try:
        result = await browser.fill_form(profile.to_agent_json())
        await _log_note(
            run_id,
            f"initial fill: {len(result.get('filled', []))} filled, "
            f"{len(result.get('already_filled', []))} already filled, "
            f"{len(result.get('skipped', []))} skipped "
            f"[{result.get('probe', 'n/a')}]: {result.get('skipped', [])}",
        )
    except Exception as exc:
        await _log_note(run_id, f"initial fill raised: {exc!r}")
        await _finish(run_id, "failed", "Couldn't fill in the form.", error=repr(exc))
        return

    # Some ATS run their own async JS right after a fill completes — Ashby
    # shows an "Autofill completed!" banner and re-renders the form fields
    # slightly after the fact. Checking immediately can catch that transition
    # mid-flight and misread freshly-filled fields as empty (observed in
    # practice: Email and Name correctly held real values a moment later, but
    # a verify run 4s after fill finished read both as "").
    await asyncio.sleep(2.0)

    await _set_stage(run_id, "verifying")
    verify = await browser.extract(VERIFY_INSTRUCTION, VERIFY_SCHEMA)
    missing = [str(m) for m in (verify.get("missing_required") or [])]

    # Never trust the earlier attaching_resume() result alone — it only proves
    # SOME file input on the page received the file, not necessarily the
    # required one (some ATS, Ashby included, have both a convenience
    # "autofill from resume" uploader and a separate required Resume* field).
    # This is the only chance to correct it: the agent can't fix a missing
    # attachment in the repair pass below, since file inputs are explicitly
    # off-limits for act().
    resume_flagged_missing = any("resum" in m.lower() or m.lower() == "cv" for m in missing)
    if not verify.get("resume_attached") or resume_flagged_missing:
        attached = await browser.upload_resume(profile.resume_path)
        await _log_note(
            run_id,
            f"verify said resume_attached={verify.get('resume_attached')}, flagged={resume_flagged_missing} "
            f"— re-uploaded, {'succeeded' if attached else 'FAILED'}",
        )

    # Guard against the agent's grounding mis-targeting a field that doesn't
    # exist on this page onto one that does, silently overwriting it —
    # observed in practice: a form with no Cover Letter field ended up with
    # the entire cover letter typed into the Email input via a .fill() on
    # Email's own selector. This is the only check standing between that and
    # an application submitted under the wrong contact details.
    email_reported = str(verify.get("email_field_value") or "")
    if _email_corrupted(email_reported, profile.email):
        await _repair_field(run_id, browser, "Email", email_reported, profile.email)
    name_reported = str(verify.get("name_field_value") or "")
    if _name_corrupted(name_reported, profile.full_name):
        await _repair_field(run_id, browser, "Name", name_reported, profile.full_name)

    if missing:
        # Sweep to convergence, not a single repair pass.
        #
        # observe() is not exhaustive on a long form — the same page returned
        # 22, 19 and 18 candidates on three consecutive runs — so one pass
        # cannot be assumed to have seen every field. That is why the final
        # "Do you consent to receive marketing?" question was never answered:
        # it was never surfaced, so it appeared in neither the filled list nor
        # the missing list. Re-running a full-page pass gives observe() a fresh
        # look and picks up whatever the last one missed.
        #
        # This is only affordable because fill_form now skips fields already
        # filled this run BEFORE the per-dropdown option reads and before the
        # answer-mapping LLM call, returning early when everything is skipped.
        # A converged pass therefore costs one observe() and nothing else.
        # Attempt 1 stays scoped to the labels verify complained about (cheap
        # and targeted); later attempts go full-page to catch the unseen ones.
        await _set_stage(run_id, "filling_form", "Finishing the last few fields…")
        await _log_note(run_id, f"repair pass targeting: {missing}")
        for attempt in range(_MAX_FILL_SWEEPS):
            hint = "; ".join(missing[:15]) if (attempt == 0 and missing) else None
            try:
                result = await browser.fill_form(profile.to_agent_json(), only_hint=hint)
            except Exception as exc:
                logger.exception("run %s fill sweep %s failed", run_id, attempt + 1)
                await _log_note(run_id, f"fill sweep {attempt + 1} raised: {exc!r}")
                break
            newly_filled = len(result.get("filled", []))
            await _log_note(
                run_id,
                f"fill sweep {attempt + 1}{' (scoped)' if hint else ' (full page)'}: "
                f"{newly_filled} filled, {len(result.get('already_filled', []))} already filled, "
                f"{len(result.get('skipped', []))} skipped "
                f"[{result.get('probe', 'n/a')}]"
                + (f" rejected-by-form: {result.get('rejected')}" if result.get('rejected') else "")
                + f": {result.get('skipped', [])}",
            )
            # Nothing new went in: observe() has stopped finding anything this
            # run can act on, so another pass would only repeat itself.
            if newly_filled == 0:
                break
            # A repeat pass is only cheap and non-destructive while the probe
            # is resolving fields. If it isn't, the registry is inert and the
            # next pass would re-fill everything from scratch with the
            # anti-downgrade guard also disabled — the exact overwriting this
            # is meant to stop. Stop at one pass instead, i.e. old behaviour.
            if not browser.probe_healthy():
                await _log_note(
                    run_id,
                    "field probe resolved nothing; not re-sweeping (a second pass would "
                    "re-fill every field instead of skipping the done ones)",
                )
                break
            await asyncio.sleep(1.0)
        await asyncio.sleep(1.0)
        # Non-fatal on purpose. This used to be the one unguarded browser call
        # in the whole run, so a hiccup here (a dropped RPC connection, a slow
        # read) threw away a form that was completely filled and ready to
        # send. If the recheck can't run we keep the pre-repair list and let
        # the reconciliation below sort it out.
        try:
            recheck = await browser.extract(
                "List the labels of any REQUIRED fields still empty or invalid.", VERIFY_SCHEMA
            )
            missing = [str(m) for m in (recheck.get("missing_required") or [])]
        except Exception as exc:
            logger.exception("run %s recheck failed", run_id)
            await _log_note(run_id, f"recheck raised: {exc!r} — keeping the pre-repair missing list")

    # Reconcile the LLM's list against what the page demonstrably holds before
    # any of it is allowed to block submission. The verify step reports
    # react-select fields as empty because the committed value renders into a
    # wrapper div rather than the input it reads — observed on this exact
    # Robinhood form, where a repair pass filled 11 fields and the recheck then
    # listed all 14 as still missing, ending a fully-completed application as
    # needs_input without ever pressing submit.
    if missing:
        filled_labels = await browser.filled_field_labels()
        missing, reconciled = _drop_fields_already_filled(missing, filled_labels)
        if reconciled:
            await _log_note(
                run_id,
                f"verify listed {len(reconciled)} field(s) as missing that the page shows as "
                f"filled; treating them as done: {reconciled[:10]}",
            )

    text_missing, document_missing = _split_missing_by_type(missing)

    # Reconcile the LLM's "still missing" list against what the form actually
    # holds. Without this the run dead-ends telling the user to attach a
    # resume by hand while their resume is already attached — see
    # _drop_documents_already_attached.
    if document_missing:
        try:
            attached_docs = await browser.attached_documents()
        except Exception:
            logger.exception("run %s could not read attached documents", run_id)
            attached_docs = {}
        document_missing, satisfied = _drop_documents_already_attached(document_missing, attached_docs)
        if satisfied:
            await _log_note(
                run_id,
                f"verify listed {satisfied} as missing, but the form already holds "
                f"{attached_docs}; treating them as attached",
            )

    if not config.submit_enabled():
        detail = "Dry run — the form was filled but not submitted."
        if captcha_present:
            detail += " This form also has a CAPTCHA, so a real run would still need it solved by hand."
        await _finish(run_id, "dry_run", detail, missing=text_missing)
        return

    # Required fields genuinely still unresolved after the one repair pass —
    # nothing on file answers them. Stop cleanly here, naming exactly which
    # fields need an answer, rather than clicking submit anyway and relying on
    # the site's own rejection banner as the only signal something was wrong.
    # That used to be the sole path here, and it's a strictly weaker one: the
    # verify step's missing_required list (already page-derived, already
    # honoring the site's own required-marking) is a more direct, more
    # specific source than whatever text a rejected submission's confirm
    # read happens to produce.
    if text_missing or document_missing:
        # document_missing (Cover Letter, Portfolio, Writing Sample, ...) can
        # never be resolved by an "answer and retry" text prompt — fill_form()
        # already refuses to even attempt these (_SKIP_DESCRIPTION_MARKERS),
        # so the site's own required-marking on them will never clear no
        # matter what's typed. Named separately in the message, and — this is
        # the part that matters — never put in `missing`, so the retry modal
        # only ever offers questions a text answer can actually resolve.
        parts = []
        if text_missing:
            parts.append("A few required fields still need an answer we don't have on file: " + "; ".join(text_missing[:5]))
        if document_missing:
            parts.append("This employer also requires a document we can't attach automatically: " + "; ".join(document_missing[:3]) + " — finish that part by hand.")
        await _finish(
            run_id, "needs_input",
            " ".join(parts),
            error="unresolved_required_fields",
            missing=text_missing,
        )
        return

    # The one thing a CAPTCHA actually blocks — clicking submit — checked
    # last, after everything fillable has genuinely been filled and
    # verified. Never attempt to solve or click past it; that's the one
    # button we deliberately leave for the user.
    if captcha_present:
        await _finish(
            run_id, "needs_input",
            "Everything's filled in — this form has a CAPTCHA, so the final submit has to be done by hand.",
            error="captcha",
        )
        return

    await _submit_and_confirm(run_id, browser, profile, missing)


CONFIRM_INSTRUCTION = (
    "Did the application submit successfully?\n"
    "- If YES: set submitted=true and quote the page's actual confirmation wording verbatim "
    "into confirmation_text (e.g. \"Thank you for applying\", \"Your application has been "
    "received\"). Never leave confirmation_text empty when submitted=true — a submission with "
    "no quoted confirmation is not treated as successful.\n"
    "- If NO: set submitted=false and put the reason in error_text. This includes validation "
    "errors AND any rejection banner the site shows — for example \"flagged as spam\", "
    "\"blocked\", or similar. confirmation_text must stay empty unless the application "
    "actually went through; do not put a rejection message there.\n"
    "- If the rejection looks permanent (flagged as spam/abuse, blocked, too many attempts) "
    "rather than a fixable validation error, set rejected_permanently=true.\n"
    "- Also say whether this is another page of the form that still needs completing."
)

# Unambiguous on their own — no innocent form echoes these back.
_PERMANENT_REJECTION_MARKERS = (
    "spam", "flagged", "blocked", "abuse", "banned", "too many attempts",
)
# Ambiguous words that only mean "rejected" when they are talking about the
# submission. "declined" in particular is a word this very app puts INTO the
# form: the EEO answers read "Decline to self-identify" / "I declined to
# self-identify", so a confirmation page that echoes the submitted answers back
# used to match here and downgrade a genuine submitted=True to not-submitted —
# turning a successful application into a reported failure.
_AMBIGUOUS_REJECTION_MARKERS = ("rejected", "declined", "unsuccessful", "not successful")
_REJECTION_SUBJECTS = ("application", "submission", "submit", "request", "form")


def _looks_permanently_rejected(text: str) -> bool:
    """Safety net for when the model reports a clear rejection reason but
    doesn't set rejected_permanently — a site telling us it flagged the
    submission as spam is not a validation error to fix and resubmit; doing
    that again just looks more like abuse, not less."""
    lowered = (text or "").lower()
    if any(m in lowered for m in _PERMANENT_REJECTION_MARKERS):
        return True
    return any(m in lowered for m in _AMBIGUOUS_REJECTION_MARKERS) and any(
        s in lowered for s in _REJECTION_SUBJECTS
    )


def _reconcile_confirm_result(result: dict) -> dict:
    """CONFIRM_INSTRUCTION explicitly tells the model never to put a rejection
    message in confirmation_text when submitted=True — but it isn't perfectly
    reliable about that. Observed in practice: submitted=True with
    confirmation_text reading as a spam-flag rejection banner, which got
    recorded as a real submitted application (the user never got a confirmation
    email because none was ever sent). submitted=True is never trusted on its
    own; if the text handed back for it actually reads like a rejection, this
    downgrades the result to not-submitted *before* any other logic sees it, so
    it flows into the same rejection-handling path a genuine submitted=false
    result already goes through — including the existing tolerance for a
    rejection message landing in the wrong field."""
    confirmation = str(result.get("confirmation_text") or "").strip()
    if result.get("submitted") and confirmation and _looks_permanently_rejected(confirmation):
        result = dict(result)
        result["submitted"] = False
        if not str(result.get("error_text") or "").strip():
            result["error_text"] = confirmation
        result["confirmation_text"] = ""
    return result


async def _submit_and_confirm(run_id: int, browser, profile: ApplicantProfile, missing: list[str]) -> None:
    for attempt in range(MAX_FORM_PAGES):
        await _set_stage(run_id, "submitting")
        try:
            await browser.act("Click the final submit button to send the application")
        except Exception as exc:
            await _finish(run_id, "failed", "Couldn't click submit on the form.", error=repr(exc))
            return

        # Real ATS forms redirect or show a confirmation banner over 1-3s, not
        # instantly. Checking the instant after the click risks reading the
        # page mid-transition as "nothing happened".
        await asyncio.sleep(3.0)

        await _set_stage(run_id, "confirming")
        result = _reconcile_confirm_result(await browser.extract(CONFIRM_INSTRUCTION, CONFIRM_SCHEMA))

        # A fully ambiguous first read — no confirmation, no error, no next
        # page — is often just a slow-loading confirmation screen rather than
        # a genuinely failed click. Give it one more look before concluding
        # the submit didn't do anything.
        if not result.get("submitted") and not result.get("has_next_page") and not str(result.get("error_text") or "").strip():
            await asyncio.sleep(4.0)
            result = _reconcile_confirm_result(await browser.extract(CONFIRM_INSTRUCTION, CONFIRM_SCHEMA))

        if result.get("submitted") and not result.get("has_next_page"):
            confirmation = str(result.get("confirmation_text") or "").strip()
            if not confirmation:
                # Submitted-but-unconfirmed is reported honestly, never as success.
                await _finish(
                    run_id, "needs_input",
                    "The form was sent but we couldn't confirm it went through — please double-check.",
                    error="no_confirmation",
                )
                return
            await _finish(run_id, "submitted", "Application submitted.", confirmation=confirmation)
            return

        if result.get("has_next_page"):
            await _set_stage(run_id, "filling_form", "Filling in the next page…")
            try:
                next_result = await browser.fill_form(profile.to_agent_json())
                await _log_note(
                    run_id,
                    f"page {attempt + 2} fill: {len(next_result.get('filled', []))} filled, "
                    f"{len(next_result.get('already_filled', []))} already filled, "
                    f"skipped: {next_result.get('skipped', [])}",
                )
            except Exception as exc:
                logger.exception("run %s failed on form page %s", run_id, attempt + 2)
                await _log_note(run_id, f"page {attempt + 2} fill raised: {exc!r}")
            continue

        error_text = str(result.get("error_text") or "").strip()
        # Tolerate the model putting a rejection message in confirmation_text
        # despite the instruction above (observed in practice on an Ashby
        # spam-flag rejection) — a non-empty message on a failed submission
        # is a rejection reason regardless of which field it landed in.
        if not error_text and not result.get("submitted"):
            error_text = str(result.get("confirmation_text") or "").strip()

        permanent = bool(result.get("rejected_permanently")) or _looks_permanently_rejected(error_text)
        if error_text and attempt == 0 and not permanent:
            await _set_stage(run_id, "filling_form", "Fixing what the form flagged…")
            try:
                # error_text is a free-text rejection reason, not a clean list of
                # field labels like `missing` — no reliable way to scope observe()
                # to just the flagged fields, so re-run fill_form across the whole
                # page. Fields this run already filled are skipped by fill_form's
                # own registry, so this costs one observe() and re-fills only what
                # is genuinely still empty. (It is NOT safe on the assumption that
                # rewriting a field with the same value is harmless — it isn't:
                # before the registry existed, a second pass that failed to re-read
                # a dropdown's options answered from the generic profile value and
                # overwrote a correct answer with "prefer not to say".)
                retry_result = await browser.fill_form(profile.to_agent_json())
                await _log_note(
                    run_id,
                    f"validation-error fix: {len(retry_result.get('filled', []))} filled, "
                    f"{len(retry_result.get('already_filled', []))} already filled, "
                    f"rejected-by-form: {retry_result.get('rejected', [])}, "
                    f"skipped: {retry_result.get('skipped', [])}",
                )
            except Exception as exc:
                logger.exception("run %s could not fix validation errors", run_id)
                await _log_note(run_id, f"validation-error fix raised: {exc!r}")
            continue

        # A permanent rejection (spam/abuse flag) is a dead end, not a "try
        # again" signal — the site's own retry suggestion is meant for a
        # human on a fresh visit, not an automated resubmit on the same
        # session, which just looks like more of the behavior that got it
        # flagged. Stop here rather than looping through another attempt.
        await _finish(
            run_id, "needs_input",
            error_text or "The form wouldn't submit — it needs finishing by hand.",
            error="submit_rejected",
            missing=missing,
        )
        return

    await _finish(
        run_id, "needs_input",
        "This application has more steps than we can complete automatically.",
        error="too_many_pages",
    )
