"""The only module that imports stagehand and playwright.

Runs Stagehand against a browser Chromium instance launched locally via
Playwright — no Browserbase account, session, or credits required. Both
packages are imported lazily inside functions so the app boots without them.

IMPORTANT — why this file doesn't just call one "fill the form" primitive:
Stagehand's Python SDK (v4, confirmed against the installed package and
Stagehand's own docs) has no autonomous multi-step "agent" API at all,
locally or on Browserbase — only the atomic act()/observe()/extract() calls.
Their own docs are explicit: "If you need to orchestrate multi-step flows,
use multiple act commands." The previous version of this file's
RemoteBrowser.agent() was calling a Browserbase-hosted agent product via a
REST-shaped `client.sessions.execute(execute_options=..., agent_config=...)`
call — a Browserbase-specific feature layered on top of Stagehand, not a
portable SDK capability. There is nothing to "swap" it for; fill_form()
below is a replacement, not a port: observe() finds every field on the page,
one LLM call maps CANDIDATE_DATA onto them by index, and each answer is
applied with a direct Locator call (.fill / .select_option / .click). This
is also cheaper than an autonomous agent would have been — one page read
instead of an unknown number of think-act loops.
"""

from __future__ import annotations

import asyncio
import difflib
import html as _html
import json
import logging
import platform
import re
import threading
from typing import Any, Coroutine

from auto_apply import config
from functions import get_resume_response

logger = logging.getLogger(__name__)

_IS_WINDOWS = platform.system() == "Windows"

# Playwright's async API spawns its Node driver as a subprocess, which needs
# ProactorEventLoop on Windows — SelectorEventLoop's subprocess transport is
# unimplemented there and raises NotImplementedError. uvicorn forces
# SelectorEventLoop for the worker process whenever --reload or workers>1 is
# used on Windows (its own reload-supervisor requirement), so a plain "uvicorn
# main:app --reload" dev server is incompatible with Playwright out of the
# box. Rather than ask for --reload to be dropped, run the whole Stagehand
# session — launch, every act/observe/extract/locator call, close — on its
# own dedicated Proactor loop in a background thread, decoupled from
# whatever loop policy the ASGI server ends up with. A Stagehand/Playwright
# object is bound to the loop it was created on, so once open_browser() runs
# there, every later call for that session has to go through the same loop
# too — not just the one call that used to need it. Linux (production) never
# hits this — every event loop there supports subprocesses — so this only
# activates on Windows and the rest of the app is untouched.
_pw_loop: asyncio.AbstractEventLoop | None = None
_pw_loop_lock = threading.Lock()


def _get_playwright_loop() -> asyncio.AbstractEventLoop:
    global _pw_loop
    if _pw_loop is not None:
        return _pw_loop
    with _pw_loop_lock:
        if _pw_loop is None:
            loop = asyncio.ProactorEventLoop()  # type: ignore[attr-defined]

            def _run() -> None:
                asyncio.set_event_loop(loop)
                loop.run_forever()

            threading.Thread(target=_run, name="playwright-proactor-loop", daemon=True).start()
            _pw_loop = loop
    return _pw_loop


async def _run_playwright(coro: Coroutine) -> Any:
    """Run a Playwright/Stagehand coroutine on a loop that actually supports
    subprocess transports, regardless of which loop is driving the current
    request. On non-Windows this is a no-op passthrough."""
    if not _IS_WINDOWS:
        return await coro
    loop = _get_playwright_loop()
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    return await asyncio.wrap_future(fut)


# stagehand.act/observe/extract send real page content to the model, so a
# single run (page-read, open-form, fill, verify, submit, confirm, maybe a
# repair pass) can burn through an OpenAI account's tokens-per-minute cap in
# well under a minute — especially with more than one run in flight. There's
# no dedicated stagehand exception type exported in the v4 package (checked:
# nothing under stagehand.* has "error"/"exception" in its name), so unlike
# the previous Browserbase-backed version this can't isinstance-check a
# specific SDK error class — it falls back to the same text-matching heuristic
# that was always the fallback path here.
_RETRY_ATTEMPTS = 4
_RETRY_BASE_DELAY = 3.0
_RETRY_MAX_DELAY = 20.0
_TRANSIENT_MARKERS = ("rate limit", "try again", "timed out", "temporarily unavailable", "connection")
_PERMANENT_MARKERS = ("request too large", "must be reduced")

# Default per-call bound — see LocalBrowser._call()'s docstring. Real
# act/observe/extract calls complete in single-digit seconds per the logs
# (e.g. "inferenceTimeMs": 5356); 60s is generous headroom above that, not a
# tight budget, while still catching a genuine hang well before it can eat
# the whole run.
_CALL_TIMEOUT_SECONDS = 60.0


def _is_transient(exc: Exception) -> bool:
    text = str(exc).lower()
    if any(m in text for m in _PERMANENT_MARKERS):
        return False
    return any(m in text for m in _TRANSIENT_MARKERS)


# Prompt for fill_form()'s single answer-mapping LLM call — the replacement
# for the old AGENT_SYSTEM_PROMPT + multi-step agent. Kept here rather than
# in runner.py because it's an implementation detail of *how* browser.py
# fills a form, not of the run's stage machine.
_FIELD_ANSWER_PROMPT = """You are filling out a job application form on behalf of a candidate.

CANDIDATE_DATA is the candidate's own answers to whatever a form may ask. Use these values
exactly as given — never invent a fact that isn't present here.
CANDIDATE_DATA:
{candidate_json}

FORM FIELDS found on the page, each with an index and a description of what it asks for:
{fields_block}

For every field index that CANDIDATE_DATA reasonably answers, return a value for it. Skip an
index only if nothing in CANDIDATE_DATA answers it, or the field clearly isn't part of the
application (a search box, a filter, a nav link).
- For a Yes/No question (work authorization, sponsorship, relocation, agree-to-terms), return
  exactly "yes" or "no".
- For a consent / "I agree" / privacy-policy / terms checkbox, return "yes" — the candidate has
  authorized submitting on their behalf.
- A field marked [OPTIONS: ...] is a dropdown — its real, actual choices on THIS form are listed
  there, and every employer's list is different even for the same question (one company's
  location field lists countries, another's is just "USA / Canada / Elsewhere"). You MUST return
  one of the listed options, copied verbatim — never a value that isn't in that list, and never
  CANDIDATE_DATA's raw value itself unless it happens to be one of the listed options. Reason
  about which listed option actually fits CANDIDATE_DATA (e.g. if CANDIDATE_DATA's location is
  "Kolkata, India" and OPTIONS are "USA | Canada | Elsewhere", the right answer is "Elsewhere",
  not "Kolkata, India" or "India"). If truly none of the listed options fit at all, skip that index.
- For a dropdown/select with no [OPTIONS] listed (its real choices couldn't be read), return the
  option text as close to CANDIDATE_DATA's value as possible.
- For free text with no exact CANDIDATE_DATA match, adapt the closest available value
  (why_do_you_want_this_role, cover_letter, top_skills) only if it genuinely answers that field.
- If CANDIDATE_DATA includes other_answers_on_file, it's a list of specific questions this
  candidate has answered before, worded however that earlier form asked them. If a field here is
  the same question asked in different words (e.g. "Have you used our product?" vs "Have you used
  Robinhood?"), use that exact stored answer — do not treat a differently-worded question as
  unanswered just because it doesn't match verbatim.
- Never answer a field asking for sensitive data (SSN, bank details) not present in CANDIDATE_DATA.

Return ONLY a JSON object of this shape, nothing else:
{{"answers": {{"<index>": "<value>", "<index>": "<value>"}}}}
"""

# Fields the observe() pass finds that fill_form() must never touch: the
# resume/cover-letter file input is handled separately by upload_resume(),
# which can drive an OS file picker that act()/Locator.fill() cannot.
_SKIP_DESCRIPTION_MARKERS = ("resume", "cv", "cover letter", "attach", "upload")


def _board_root(apply_url: str) -> str | None:
    """The company's board/listing root, one path segment up from a specific
    posting — e.g. https://job-boards.greenhouse.io/acme/jobs/123 becomes
    https://job-boards.greenhouse.io/acme. Holds for all four supported ATS
    (greenhouse, lever, ashby, smartrecruiters): each puts the company slug
    as the first path segment after the host."""
    from urllib.parse import urlsplit

    try:
        parts = urlsplit(apply_url)
        segments = [s for s in parts.path.split("/") if s]
        if not segments or not parts.scheme or not parts.netloc:
            return None
        return f"{parts.scheme}://{parts.netloc}/{segments[0]}"
    except Exception:
        return None


def _job_id_segment(apply_url: str) -> str | None:
    """The path segment that actually identifies this job on its board page
    — the last non-empty one, since every supported ATS ends apply_url with
    the job's numeric id or slug (…/jobs/8654173002, …/{company}/{job-id})."""
    from urllib.parse import urlsplit

    try:
        segments = [s for s in urlsplit(apply_url).path.split("/") if s]
        return segments[-1] if segments else None
    except Exception:
        return None


def _url_matches(landed_url: str, apply_url: str) -> bool:
    """True if landed_url looks like the job page, not still the board.
    Deliberately loose (substring on the id segment) since a click-through
    can pick up query params / trailing slashes goto() wouldn't add."""
    needle = _job_id_segment(apply_url)
    return bool(needle) and needle in (landed_url or "")


# ── <select> option matching ─────────────────────────────────────────────────
# Root cause of forms getting stuck on EEO/demographic dropdowns: an answer
# ("Decline to self-identify") exists in CANDIDATE_DATA, but the real <select>
# on this specific employer's form uses different wording ("I don't wish to
# answer", "Prefer not to say", ...). select_option(value) needs an exact
# match, so a wording mismatch silently fails, leaving the field on
# "Select…" — which the site's own required-field validation then blocks
# submit on. These helpers read the select's real option text and match
# against it, instead of trusting the LLM's guessed string to be exact.

_EEO_FIELD_MARKERS = ("gender", "race", "ethnic", "veteran", "military", "disab", "pronoun", "hispanic", "latino")
# "I do not want to answer" (GitLab's exact real-world wording, confirmed
# live to match neither the fuzzy matcher nor the original version of this
# list — only "do not wish" was covered, not "do not want") is why this now
# checks for the shared "not ... answer" core rather than one fixed phrase
# per variant — new wording for the same underlying option shouldn't need a
# new marker added by hand every time a different employer's copywriter
# phrases "I decline" slightly differently.
_DECLINE_OPTION_MARKERS = (
    "decline", "prefer not", "rather not", "not disclose",
    "not wish to", "don't wish to", "not want to", "don't want to",
    "not to answer",
)
_OPTION_MATCH_THRESHOLD = 0.55
_OPTION_TAG_RE = re.compile(r"<option\b([^>]*)>(.*?)</option>", re.IGNORECASE | re.DOTALL)
_VALUE_ATTR_RE = re.compile(r'value\s*=\s*(["\'])(.*?)\1', re.IGNORECASE | re.DOTALL)


def _normalize_option_text(text: str) -> str:
    text = (text or "").lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _looks_like_eeo_field(description: str) -> bool:
    lowered = (description or "").lower()
    return any(m in lowered for m in _EEO_FIELD_MARKERS)


_PLACEHOLDER_OPTION_RE = re.compile(r"^(select|choose|please select)\b.*\.{0,3}$|^--+$", re.IGNORECASE)


def _parse_select_options(raw_html: str) -> list[dict[str, str]]:
    """<option> value/label pairs out of a <select>'s inner_html(). Regex
    rather than a full HTML parser — <option> markup is simple and well-formed
    enough in practice, and this avoids adding a new dependency for it. The
    attribute string is captured whole and searched separately for `value=`
    rather than anchoring on it directly after the tag name — option tags
    commonly carry other attributes (data-*, selected, class) before or
    instead of value, at arbitrary whitespace, which a single combined regex
    kept missing.

    The placeholder option ("Select…", empty value) is dropped rather than
    returned — it's never a real answer, only noise in front of the LLM
    (and, worse, a candidate _best_option_match could technically pick if a
    real answer scored low enough)."""
    options = []
    for m in _OPTION_TAG_RE.finditer(raw_html or ""):
        attrs, inner = m.group(1), m.group(2)
        label = _html.unescape(re.sub(r"<[^>]+>", "", inner or "")).strip()
        if not label or _PLACEHOLDER_OPTION_RE.match(label):
            continue
        value_match = _VALUE_ATTR_RE.search(attrs or "")
        value = _html.unescape(value_match.group(2)).strip() if value_match else label
        if not value:
            continue
        options.append({"value": value, "label": label})
    return options


def _find_decline_option(options: list[dict[str, str]]) -> dict[str, str] | None:
    for opt in options:
        if any(m in opt.get("label", "").lower() for m in _DECLINE_OPTION_MARKERS):
            return opt
    return None


def _best_option_match(value: str, options: list[dict[str, str]]) -> dict[str, str] | None:
    """The option whose text best matches `value`, or None if nothing clears
    _OPTION_MATCH_THRESHOLD — a non-match must not become a wrong click.
    Exact normalized match wins outright; otherwise the option with the best
    difflib ratio, with a floor bonus for substring containment (handles
    "Decline to self-identify" being a superstring/substring of a slightly
    different real option's wording)."""
    norm_value = _normalize_option_text(value)
    if not norm_value or not options:
        return None
    for opt in options:
        if _normalize_option_text(opt.get("label", "")) == norm_value:
            return opt
    best_opt, best_score = None, 0.0
    for opt in options:
        norm_label = _normalize_option_text(opt.get("label", ""))
        if not norm_label:
            continue
        score = difflib.SequenceMatcher(None, norm_value, norm_label).ratio()
        if norm_value in norm_label or norm_label in norm_value:
            score = max(score, 0.75)
        if score > best_score:
            best_opt, best_score = opt, score
    return best_opt if best_score >= _OPTION_MATCH_THRESHOLD else None


class LocalBrowser:
    """One local Stagehand session, backed by a Playwright Chromium instance
    this process launched and owns — no Browserbase account involved."""

    def __init__(self, stagehand: Any, browser: Any):
        self._sh = stagehand
        self._browser = browser
        self.session_id = getattr(browser, "session_id", None) or "local"
        # Browserbase-only conveniences. Left None so job_dashboard.js's
        # existing `if (run.liveViewUrl) ... else if (run.replayUrl)` checks
        # degrade to showing neither link, rather than a broken one.
        self.live_view_url: str | None = None
        self.replay_url: str | None = None

    async def _call(self, coro_factory, timeout: float = _CALL_TIMEOUT_SECONDS) -> Any:
        """Run one Stagehand call with the transient-error retry, on the
        dedicated Playwright loop this session was created on — bounded by an
        explicit per-call timeout.

        This is the single chokepoint every act/observe/extract/Locator call
        goes through, so it's the one place that needed a timeout added,
        rather than scattering asyncio.wait_for at individual call sites. The
        outer run-level timeout (config.run_timeout_seconds(), wrapping the
        whole worker) turned out not to be enough of a safety net on its own
        — observed in practice: a run stuck on "Finishing the last few
        fields…" for well past both that and the frontend's own polling
        ceiling, with no progress. A per-call bound catches a single hung RPC
        call, the actual failure mode, without waiting on the whole run's
        total budget.

        A timeout is NOT retried like a transient error — if a call hung
        once, retrying the identical call is unlikely to unstick it and just
        multiplies the wasted time (4 attempts x timeout would be 4x as slow
        to fail as just failing once). It's raised immediately so the
        caller's own exception handling (in _apply_answer, fill_form, etc.)
        can mark that one field/step failed and let the run move on."""
        delay = _RETRY_BASE_DELAY
        for attempt in range(_RETRY_ATTEMPTS):
            try:
                return await asyncio.wait_for(_run_playwright(coro_factory()), timeout=timeout)
            except asyncio.TimeoutError as exc:
                raise TimeoutError(f"stagehand call exceeded {timeout:.0f}s") from exc
            except Exception as exc:
                is_last = attempt == _RETRY_ATTEMPTS - 1
                if is_last or not _is_transient(exc):
                    raise
                logger.warning(
                    "stagehand call hit a transient error (attempt %s/%s), retrying in %.0fs: %s",
                    attempt + 1, _RETRY_ATTEMPTS, delay, exc,
                )
                await asyncio.sleep(delay)
                delay = min(_RETRY_MAX_DELAY, delay * 2)

    # ── Operations ────────────────────────────────────────────────────────
    async def navigate(self, url: str) -> None:
        page = await self._active_page()
        await self._call(lambda: page.goto(url))

    async def navigate_to_application(self, apply_url: str) -> None:
        """Reach a job application page the way a human applicant would —
        via the company's board page first, not a cold direct link.

        Confirmed in testing (two different Greenhouse-hosted companies, same
        exact job URLs both times): navigating straight to apply_url got
        flagged has_captcha=True by the page-read; reaching the identical URL
        by clicking a link on the board page did not.

        The first version of this method tried to reproduce that with
        page.evaluate("...element.click()...") — a scripted DOM click, which
        it still is not: a JS-invoked click sets event.isTrusted=false, and
        that CAPTCHA still fired against the exact same job in testing after
        adding it. Locator.click() below is a real CDP-dispatched pointer
        event (isTrusted=true), the same mechanism a genuine act() click
        uses — that's the actual difference between the click-through probes
        that stayed clean and this one, not the Referer header. Falls back
        to a direct navigate() if the board can't be reached or the matching
        link can't be found — this must never leave a run stuck on the board
        page.
        """
        root = _board_root(apply_url)
        if root and root.rstrip("/") != apply_url.rstrip("/"):
            try:
                page = await self._active_page()
                await self._call(lambda: page.goto(root))
                if await self._click_matching_link(page, apply_url):
                    await self._call(lambda: page.wait_for_load_state("domcontentloaded"))
                    landed = await self._call(lambda: page.url())
                    if _url_matches(landed, apply_url):
                        return
            except Exception:
                logger.info("board warm-up navigation to %s didn't land on the job page, falling back", root, exc_info=True)
        await self.navigate(apply_url)

    async def _click_matching_link(self, page: Any, apply_url: str) -> bool:
        """Click the <a> on the current (board) page whose href matches
        apply_url's identifying path segment, via Locator.click() (a real
        pointer event) — deterministic (a CSS attribute selector, no LLM
        call), so it can't click the wrong job."""
        needle = _job_id_segment(apply_url)
        if not needle:
            return False
        try:
            locator = page.locator(f'a[href*="{needle}"]')
            count = await self._call(lambda: locator.count())
            if count < 1:
                return False
            await self._call(lambda: locator.nth(0).click())
            return True
        except Exception:
            return True  # navigation away from this context reads as success too

    async def act(self, instruction: Any, timeout: float = _CALL_TIMEOUT_SECONDS) -> Any:
        """instruction is usually a plain string, but can also be a
        stagehand.Action — passed straight through to the SDK either way
        (see act()'s own signature: `str | ActionInput | Action`)."""
        return await self._call(lambda: self._sh.act(instruction), timeout=timeout)

    async def observe(self, instruction: str, timeout: float = _CALL_TIMEOUT_SECONDS) -> list[Any]:
        result = await self._call(lambda: self._sh.observe(instruction), timeout=timeout)
        return list(getattr(result, "data", None) or [])

    async def extract(self, instruction: str, schema: dict, timeout: float = _CALL_TIMEOUT_SECONDS) -> dict:
        model = _schema_to_model(schema)
        result = await self._call(lambda: self._sh.extract(instruction, model), timeout=timeout)
        data = getattr(result, "data", None)
        if data is None:
            return {}
        if hasattr(data, "model_dump"):
            return data.model_dump()
        return dict(data) if isinstance(data, dict) else {}

    async def fill_form(self, candidate_json: str, only_hint: str | None = None) -> dict:
        """Find every field on the current page and fill what CANDIDATE_DATA
        answers. only_hint scopes the observe() pass to fields matching a
        description (e.g. missing-field labels from a verify step, or a
        single field name for a targeted repair) instead of the whole form.

        Returns {"filled": [descriptions], "skipped": [descriptions]} for
        logging — never raises for an individual field failing; one bad
        field must not sink the whole run.
        """
        find_instruction = (
            "Find every fillable field in this job application form: text inputs, textareas, "
            "selects, checkboxes, radio buttons, and comboboxes. Skip search boxes, filters, "
            "and site navigation controls."
            if not only_hint else
            f"Find the form field(s) matching: {only_hint}"
        )
        actions = await self.observe(find_instruction)
        logger.info("fill_form: observe() found %d field(s) for %r", len(actions), only_hint or "(full page)")
        if not actions:
            return {"filled": [], "skipped": []}

        candidates = [
            (i, a) for i, a in enumerate(actions)
            if not any(m in (getattr(a, "description", "") or "").lower() for m in _SKIP_DESCRIPTION_MARKERS)
        ]
        if not candidates:
            return {"filled": [], "skipped": []}

        # Read every select's real option list up front, and hand it to the
        # LLM as part of the question rather than guessing a value blind and
        # trying to reconcile it against the real options afterward. The same
        # stored value can't be expected to match two employers' dropdowns
        # for the "same" question — one company's location field is a country
        # list, another's is "USA / Canada / Elsewhere" — so a fixed guess
        # inevitably has no match on one of them. Giving the model the actual
        # choice set lets it reason about which real option fits (e.g.
        # "Kolkata, India" -> "Elsewhere" when that's genuinely all that's
        # offered), instead of naming a value that was never going to exist
        # on this particular form.
        page = await self._active_page()
        option_map: dict[int, list[str]] = {}
        for i, action in candidates:
            if (getattr(action, "method", "") or "").lower() != "select":
                continue
            locator = page.locator(action.selector)
            opts = await self._read_select_options(locator)
            labels = [o["label"] for o in opts if o.get("label")]
            if labels:
                option_map[i] = labels

        fields_block = "\n".join(
            f"{i}: {a.description}"
            + (f"  [OPTIONS — pick exactly one of these: {' | '.join(option_map[i])}]" if i in option_map else "")
            for i, a in candidates
        )
        prompt = _FIELD_ANSWER_PROMPT.format(candidate_json=candidate_json, fields_block=fields_block)
        try:
            # Not routed through _call() (this is a plain OpenAI call, not a
            # Stagehand one) — bounded the same way regardless, for the same
            # reason: nothing here should be able to hang the run past a
            # bounded wait.
            raw = await asyncio.wait_for(get_resume_response(prompt), timeout=_CALL_TIMEOUT_SECONDS)
            parsed = json.loads(raw)
            answers = parsed.get("answers") or {}
        except Exception:
            logger.exception("fill_form: answer-mapping LLM call failed")
            return {"filled": [], "skipped": [a.description for _, a in candidates]}

        # unanswered: the LLM had nothing in CANDIDATE_DATA for these — a
        # profile/QA gap. apply_failed: it DID answer, but writing the value
        # into the page failed — a DOM/interaction problem, not a data gap.
        # Logged separately (rather than one flat "skipped" reason) because
        # the fix for each is completely different, and conflating them made
        # a real DOM-write failure indistinguishable from a genuinely missing
        # answer when reading the run's outcome after the fact.
        filled, unanswered, apply_failed = [], [], []
        for i, action in candidates:
            value = answers.get(str(i))
            if value is None or str(value).strip() == "":
                unanswered.append(action.description)
                continue
            ok = await self._apply_answer(action, str(value))
            (filled if ok else apply_failed).append(f"{action.description} (tried: {value!r})")
        logger.info(
            "fill_form: %d filled, %d unanswered (no data on file): %s, %d apply failed: %s",
            len(filled), len(unanswered), unanswered, len(apply_failed), apply_failed,
        )
        return {"filled": filled, "skipped": unanswered + apply_failed}

    async def _apply_answer(self, action: Any, value: str) -> bool:
        page = await self._active_page()
        # Page.locator() is a plain synchronous constructor (confirmed against
        # the installed SDK: it returns Locator directly, not an awaitable) —
        # only the operations performed *on* the resulting Locator are RPC
        # calls that need _call()'s retry/thread routing.
        locator = page.locator(action.selector)
        method = (getattr(action, "method", "") or "").lower()
        is_yesish = value.strip().lower() in ("yes", "true", "1", "checked", "on")

        try:
            if method == "click" or is_yesish and method in ("", "check", "toggle"):
                # Checkbox/radio: only click if not already in the desired
                # state — Locator has no dedicated "check" call to lean on.
                try:
                    already = await self._call(lambda: locator.is_checked())
                except Exception:
                    already = False
                if is_yesish and not already:
                    await self._call(lambda: locator.click())
                elif not is_yesish and already:
                    await self._call(lambda: locator.click())
                return True
            # Confirmed live against a real Greenhouse form (custom dropdown
            # widgets, common for EEO/demographic fields): observe() doesn't
            # always say "select" — it returned method="selectOptionFromDropdown"
            # for these, a distinct string this check used to miss entirely,
            # sending every one of them through a doomed .fill() attempt
            # first. Matching on "select"/"dropdown" as a substring catches
            # that and whatever other method names Stagehand uses for the
            # same underlying pattern, rather than hand-listing exact strings.
            if "select" in method or "dropdown" in method:
                await self._select_with_match(locator, action, value)
                return True
            # Default: plain text/textarea fill. If that fails on what turns
            # out to be a select/checkbox observe() mis-typed, fall back to
            # select_option once before giving up on this field.
            try:
                await self._call(lambda: locator.fill(value))
                return True
            except Exception:
                await self._select_with_match(locator, action, value)
                return True
        except Exception:
            logger.warning("fill_form: could not apply field %r", getattr(action, "description", ""), exc_info=True)
            return False

    async def _dropdown_shows_a_value(self, locator: Any, description: str = "") -> bool:
        """Ground truth for whether a custom-widget dropdown actually has a
        value selected now — read directly off the element, never inferred
        from whether the action that tried to set it merely avoided raising.
        Tries text_content() first (what a combobox trigger visually shows),
        falls back to input_value() for a plain input-shaped trigger.

        observe()'s selector for "the same" field isn't stable between calls
        — confirmed live: one call resolved to the exact <input> trigger
        (empty inner_html), another resolved to a broader wrapper that also
        contains the field's own label ("Veteran Status"). Without excluding
        that, a completely untouched field reads as "has a value" the moment
        the selector happens to include its label — so any text that's
        itself a close match for the field's own description is treated the
        same as the empty placeholder, not as a real answer."""
        norm_description = _normalize_option_text(description)
        for reader in (lambda: locator.text_content(), lambda: locator.input_value()):
            try:
                text = (await self._call(reader) or "").strip()
            except Exception:
                continue
            if not text or _PLACEHOLDER_OPTION_RE.match(text):
                continue
            norm_text = _normalize_option_text(text)
            if norm_description and (norm_text == norm_description or norm_text in norm_description):
                continue
            return True
        return False

    async def _read_select_options(self, locator: Any) -> list[dict[str, str]]:
        """Real <option> value/label text for a <select> Locator. This SDK's
        Locator has no evaluate() (checked against the installed package), so
        this reads inner_html() and regex-parses it instead — which reuses
        exactly the same cross-frame resolution that already makes
        fill()/click() work on iframed ATS forms (Greenhouse embeds its form
        in an iframe; confirmed in live testing that Locator calls reach into
        it correctly), rather than needing a separate iframe workaround."""
        try:
            raw_html = await self._call(lambda: locator.inner_html())
            return _parse_select_options(raw_html)
        except Exception:
            return []

    async def _select_with_match(self, locator: Any, action: Any, value: str) -> None:
        """select_option(), but resolved against the select's real option
        text first. Raises if options WERE read but nothing — including the
        EEO decline fallback — matched, which _apply_answer()'s existing
        except Exception turns into a clean "skipped" rather than a wrong
        click."""
        options = await self._read_select_options(locator)
        if not options:
            # No <option> tags found in this element's own inner_html() at
            # all — this is very likely not a native <select> in the first
            # place but a custom JS combobox/dropdown widget (react-select
            # and similar are common on Greenhouse's embedded EEO fields):
            # visually identical "Select…" + chevron styling, but the real
            # options only exist in a portal-rendered listbox that appears
            # after a click, which select_option() has no way to drive at
            # all (confirmed: it only operates on genuine <select> elements).
            # act() is the one primitive that can open-then-pick a widget
            # like that, since it drives real interaction rather than
            # reading static markup.
            description = getattr(action, "description", "") or "this field"
            # act()'s own timeout= (forwarded to _call()) is what stops this
            # from hanging: if `value` doesn't correspond to anything
            # actually in the widget (very possible, since this path only
            # runs when option text couldn't be read up front and the LLM
            # had to guess blind), act() has no natural stop condition and
            # can run long hunting for a match that isn't there — this is
            # what a run stuck on "Finishing the last few fields…" for
            # minutes turned out to be. 45s (a bit under _call()'s general
            # default) is enough for a real open-then-pick interaction
            # without waiting as long as a plain page read is allowed to.
            #
            # act() completing without an exception is NOT trusted as proof
            # the value actually landed — confirmed live: handing this same
            # widget's own observe()-reported method+selector straight back
            # to act() as a structured Action returned cleanly while the
            # field was still showing "Select…" on the real page. Every
            # attempt below is followed by reading the field's own displayed
            # text directly (not another LLM read) before it's trusted.
            try:
                await self.act(
                    f'Open the dropdown for "{description}" and click the option that best '
                    f"matches: {value}",
                    timeout=45.0,
                )
                if await self._dropdown_shows_a_value(locator, description):
                    return
            except Exception:
                pass
            # Last resort — behaves exactly as before this fallback existed,
            # for the case where it genuinely is a plain <select> whose
            # inner_html() just couldn't be read.
            await self._call(lambda: locator.select_option(value))
            if not await self._dropdown_shows_a_value(locator, description):
                raise RuntimeError(f"dropdown still shows no value after every attempt for {value!r}")
            return
        match = _best_option_match(value, options)
        if not match and _looks_like_eeo_field(getattr(action, "description", "")):
            match = _find_decline_option(options)
        if not match:
            raise RuntimeError(f"no matching <option> for {value!r} on {getattr(action, 'selector', '')!r}")
        # select_option() takes one positional string with no way to say
        # "match by value" vs "match by label" (checked against the
        # installed SDK's signature) — try the option's underlying value
        # first, since that's what a <select> actually submits, falling back
        # to its visible label if the value string doesn't resolve.
        try:
            await self._call(lambda: locator.select_option(match["value"]))
        except Exception:
            await self._call(lambda: locator.select_option(match["label"]))

    async def set_field(self, description_hint: str, value: str) -> bool:
        """Targeted single-field fix — used for the email/name corruption
        repair, where the correct value is already known and no LLM call
        (or full-page observe scope) is needed."""
        actions = await self.observe(f"Find the form field for: {description_hint}")
        if not actions:
            return False
        return await self._apply_answer(actions[0], value)

    async def upload_resume(self, resume_path: str) -> bool:
        """Attach the resume PDF directly — a file picker is an OS dialog,
        not a DOM interaction, so this drives the file input over Playwright
        rather than through act()/fill_form()."""
        try:
            page = await self._active_page()
            uploaded_any = False
            # The form is usually inside an iframe on Greenhouse/Lever, and
            # the input is very often display:none, so every frame is
            # searched and set_input_files goes to the element handle
            # directly rather than a selector (which applies visibility
            # checks that would fail on exactly the inputs we need).
            # .locator()/.nth() are plain synchronous constructors (confirmed
            # against the installed SDK) — only .count()/.set_input_files()
            # are actual RPC calls that need _call()'s retry/thread routing.
            handles = page.locator('input[type="file"]')
            count = await self._call(lambda: handles.count())
            for idx in range(count):
                try:
                    one = handles.nth(idx)
                    await self._call(lambda h=one: h.set_input_files(resume_path))
                    uploaded_any = True
                except Exception:
                    continue
            if uploaded_any:
                await asyncio.sleep(1.5)  # let the ATS parse/echo the upload(s)
            return uploaded_any
        except Exception:
            logger.exception("resume upload failed for session %s", self.session_id)
            return False

    async def _active_page(self) -> Any:
        return await self._call(lambda: self._browser.context.active_page())

    async def end(self) -> None:
        try:
            await self._call(lambda: self._sh.close())
        except Exception:
            logger.warning("could not cleanly close local browser session %s", self.session_id, exc_info=True)


def _schema_to_model(schema: dict):
    """Convert the flat JSON-schema dicts extract() call sites already use
    (PAGE_SCHEMA / VERIFY_SCHEMA / CONFIRM_SCHEMA in runner.py) into the
    Pydantic model class Stagehand v4's extract() requires. Keeping this
    conversion here — rather than rewriting those constants as Pydantic
    models in runner.py — keeps runner.py oblivious to which SDK generation
    is actually installed, matching this file's original "quarantine
    everything stagehand-shaped in browser.py" design.

    Only handles the shapes runner.py actually uses: flat objects with
    string/boolean/array-of-string properties. Good enough for PAGE_SCHEMA,
    VERIFY_SCHEMA, and CONFIRM_SCHEMA — not a general JSON-schema converter.

    Every property is made a required Pydantic field (`...`, no default) —
    OpenAI's structured-output mode rejects a schema unless `required`
    includes every key in `properties` (confirmed by a live 400: "'required'
    is required to be supplied and to be an array including every key in
    properties"). A property missing from the *original* dict schema's
    `required` list is instead made nullable (Optional[...]) so the model can
    legally return null for it — that's the correct "optional" encoding in
    strict mode, not leaving it out of `required`. Every call site in
    runner.py already reads these fields via `.get(...) or <fallback>` /
    plain truthiness checks, so a None here behaves exactly like the old
    dict-default (""/False/[]) did — no downstream changes needed.
    """
    from typing import Optional

    from pydantic import create_model

    type_map = {"string": str, "boolean": bool, "array": list[str]}
    required = set(schema.get("required") or [])
    fields = {}
    for name, spec in (schema.get("properties") or {}).items():
        py_type = type_map.get(spec.get("type"), str)
        fields[name] = (py_type, ...) if name in required else (Optional[py_type], ...)
    return create_model("ExtractSchema", **fields)


# Observed in practice: a run's own headless session gets flagged
# has_captcha=True on a form the same user opens cleanly by hand a moment
# later, from the same network/IP — so it isn't network reputation deciding
# this, it's the browser itself reading as automated. CDP-driven Chromium
# sets navigator.webdriver=true by default; Cloudflare-style bot management
# checks exactly this. This isn't "evading detection" in the
# adversarial-scraping sense — this is the user's own agent, filling out the
# user's own application with the user's own data, on their explicit
# consent; the fingerprint is just an accident of how CDP automation works,
# not a signal that means anything about this use.
#
# Only the launch flag below, not a hand-rolled navigator.webdriver
# override — live-tested both: the flag alone cleanly passed a bot-detection
# test page's WebDriver check, but adding an Object.defineProperty override
# on top of it made a *stricter* check on the same page fail that had
# passed without it. A naive property override can read as more suspicious
# than the absence it's trying to fake once a detector specifically checks
# for tampered descriptors — matching real stealth libraries' actual
# complexity (dozens of coordinated patches, not four lines) rather than
# risk shipping something that's net-negative and hard to verify further.
async def open_browser() -> LocalBrowser:
    """Launch a local Chromium via Stagehand and return a bound session.
    Headless by default (config.headless() — see its docstring: a real
    deploy has no display to show a headed browser on). Raises if
    stagehand/playwright aren't installed, or if Chromium itself isn't
    (`playwright install chromium`)."""
    async def _open() -> LocalBrowser:
        from stagehand import Stagehand, local_browser

        browser = await local_browser.launch(
            headless=config.headless(),
            viewport_width=1400,
            viewport_height=1000,
            args=["--disable-blink-features=AutomationControlled"],
        )
        stagehand = await Stagehand.create(
            browser=browser,
            model=config.model_name(),
            model_api_key=config.model_api_key(),
        )
        return LocalBrowser(stagehand, browser)

    return await _run_playwright(_open())
