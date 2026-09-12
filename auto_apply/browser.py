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
import os
import platform
import re
import tempfile
import threading
import time
from typing import Any, Coroutine

from auto_apply import config
from auto_apply.profile import question_signature
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


async def _run_playwright(coro: Coroutine, timeout: float | None = None) -> Any:
    """Run a Playwright/Stagehand coroutine on a loop that actually supports
    subprocess transports, regardless of which loop is driving the current
    request, bounded by `timeout`. On non-Windows this is a plain wait_for.

    The Windows branch deliberately does NOT use
    `asyncio.wait_for(asyncio.wrap_future(fut))`, which is the obvious way to
    write this and is quietly broken here. wait_for, on timing out, cancels
    the inner awaitable and then *waits for that cancellation to be
    acknowledged*. A concurrent.futures.Future already executing on another
    thread cannot acknowledge it — Future.cancel() returns False once running
    and nothing ever completes the wrapper — so wait_for itself blocks
    forever, defeating the very timeout it implements. Observed in practice:
    a run sat in "Finishing the last few fields…" for 777 seconds, blowing
    through both the 60s per-call bound and the 420s run-level bound without
    either firing.

    Polling fut.done() instead keeps the decision entirely on this side of
    the thread boundary: we never await anything that depends on the other
    thread cooperating. The abandoned work does keep running over there
    (genuinely unavoidable — there is no way to force-kill it), but this
    side stops waiting and the run moves on, which is the part that matters.
    """
    if not _IS_WINDOWS:
        return await asyncio.wait_for(coro, timeout) if timeout else await coro

    loop = _get_playwright_loop()
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    deadline = None if timeout is None else time.monotonic() + timeout
    while True:
        if fut.done():
            return fut.result()
        if deadline is not None and time.monotonic() >= deadline:
            fut.cancel()  # best effort: only takes effect if it hasn't started
            raise TimeoutError(f"playwright call exceeded {timeout:.0f}s")
        await asyncio.sleep(0.05)


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
# Browser launch is a cold Chromium start plus Stagehand attach — slower than
# any single RPC, so it gets its own, longer bound.
_LAUNCH_TIMEOUT_SECONDS = 120.0
# Teardown gets a short bound of its own: a close that is going to work is
# near-instant, and end() runs in a finally, so a long wait here would delay
# the run reaching a terminal state for no gain. The OS reclaims a Chromium
# we give up on; the startup sweep catches whatever survives.
_CLOSE_TIMEOUT_SECONDS = 20.0
# How far past `timeout` the retries may collectively run. >1 so a transient
# error still gets a real second chance, but small enough that the caller's
# stated bound stays meaningful.
_CALL_TOTAL_BUDGET_FACTOR = 2.0
# Single keystroke / scroll / screenshot. These are local browser operations
# with no LLM in the loop, so anything past a few seconds is a hang.
_DROPDOWN_KEY_TIMEOUT_SECONDS = 10.0
# Temporary attribute used to re-find a field after its widget re-renders.
_FIELD_MARK_ATTR = "data-autoapply-target"
# Cap on how many options are pulled out of a widget at all, and (lower) on
# how many are worth spending prompt tokens listing. See the call sites.
_MAX_COMBOBOX_OPTIONS_READ = 200
_MAX_COMBOBOX_OPTIONS_IN_PROMPT = 40
# The act()-driven custom-dropdown fallback. Kept well under the general
# per-call bound: a genuine open-then-pick finishes in a few seconds, so a
# call still going at this point is hunting for an option that isn't there,
# and every second past that is pure waste multiplied by however many
# dropdowns the form has (GitLab's has 11+).
_DROPDOWN_ACT_TIMEOUT_SECONDS = 15.0
# After this many custom-dropdown fallbacks fail on one page, stop trying the
# rest. They're the same widget from the same UI library — if two in a row
# can't be driven, the twelfth won't be either, and paying the timeout for
# each is what turned one form into a multi-minute stall.
_DROPDOWN_FALLBACK_FAILURE_LIMIT = 2

_XPATH_PREFIX_RE = re.compile(r"^\s*xpath\s*=\s*", re.IGNORECASE)


def _selector_kind(selector: str | None) -> tuple[str, str]:
    """('xpath'|'css'|'', normalized) for a Stagehand Action.selector.

    Stagehand accepts three shapes for the same element — "xpath=/html/…", a
    bare "/html/…", and CSS — and its content-script normalizes them itself
    (_extension/content-script.js: `isXPath = s.startsWith("xpath=") ||
    s.startsWith("/")`). Every Locator call in this file therefore works.

    The field probe was the one consumer resolving the raw string by hand, and
    an "xpath="-prefixed value resolves under NEITHER engine: document.evaluate
    parses it as a boolean expression ("xpath" = /html/…) and then raises
    because FIRST_ORDERED_NODE_TYPE was requested, while querySelector rejects
    it as invalid CSS. So every probe entry came back null, _probe_fields
    returned {}, and the fill registry, the anti-downgrade guard and the
    missing-field reconciliation were all silently inert — for every run.

    Deliberately in Python rather than inside _FIELD_PROBE_JS: the JS string is
    unreachable from the test suite (which stubs the browser call and feeds
    canned JSON), which is precisely how this survived. Here it is one pure
    function with unit tests."""
    raw = str(selector or "").strip()
    if not raw:
        return "", ""
    stripped = _XPATH_PREFIX_RE.sub("", raw).strip()
    if not stripped:
        return "", ""
    if _XPATH_PREFIX_RE.match(raw) or stripped[0] in "/(":
        return "xpath", stripped
    return "css", stripped


# One read-only Page.evaluate per fill_form pass, resolving every observed
# field at once to a STABLE logical identity plus its current value.
#
# Why this exists: observe() gives a different selector and a different
# free-text description for the same field on different passes (see
# _dropdown_shows_a_value's docstring), and fill_form used to key answers by
# position in the observe() list. So nothing could tell "a field we already
# filled" from "a new field", and every later pass re-filled the whole form —
# sometimes replacing a correct answer with a worse one when the option list
# happened not to be readable the second time round.
#
# Returns JSON.stringify'd output: a plain string is the return shape already
# proven against this SDK (_marked_widget_text), where a nested dict is not.
# One entry per input xpath, null where unresolvable, so the caller can zip
# positionally. Read-only by design — unlike _mark_focused_field this writes
# no attributes, so even a badly-resolved xpath cannot disturb the page.
_FIELD_PROBE_JS = r"""
(() => {
  const XPATHS = __XPATHS__;
  const txt = (n) => (n && n.textContent ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const attr = (n, a) => ((n && n.getAttribute && n.getAttribute(a)) || '').trim();

  // Each entry is [kind, selector], already classified and normalized by
  // _selector_kind() in Python — see its docstring for why the raw string
  // could not be resolved here. Both engines stay as mutual fallbacks in case
  // a selector is classified wrongly.
  function resolve(pair) {
    if (!pair || !pair[1]) return null;
    const kind = pair[0], sel = pair[1];
    const byXPath = () => {
      try {
        const r = document.evaluate(sel, document, null, 9, null); // FIRST_ORDERED_NODE_TYPE
        return r ? r.singleNodeValue : null;
      } catch (e) { return null; }
    };
    const byCss = () => {
      try { return document.querySelector(sel); } catch (e) { return null; }
    };
    let n = (kind === 'xpath') ? (byXPath() || byCss()) : (byCss() || byXPath());
    while (n && n.nodeType !== 1) n = n.parentNode;
    return (n && n.nodeType === 1) ? n : null;
  }

  // The same field resolves to the <input>, a wrapper div, or a bare <label>
  // depending on the pass. Normalise all three onto one control.
  const CONTROL_SEL = 'select, textarea, input:not([type="hidden"]):not([type="file"]), [role="combobox"], [contenteditable="true"]';
  function control(n) {
    if (!n) return null;
    const tag = (n.tagName || '').toLowerCase();
    if (tag === 'label') {
      const f = attr(n, 'for');
      if (f) { let t = null; try { t = document.getElementById(f); } catch (e) {} if (t) return t; }
      const inner = n.querySelector(CONTROL_SEL);
      if (inner) return inner;
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return n;
    if (attr(n, 'role') === 'combobox' || n.isContentEditable) return n;
    // Never GUESS which control a multi-control node means. observe() can hand
    // back a broad wrapper (a page-level <div class="application-container">),
    // and taking its first control would give a dozen different fields the
    // identity of whichever one happens to come first — usually First Name,
    // which is filled. With the registry live that is actively dangerous: an
    // empty field would be skipped as "already filled", and filled_field_labels
    // would report a label that clears a genuinely-missing field, letting an
    // incomplete form reach submit. Returning null instead means no identity,
    // which means never skippable — the safe direction.
    const own = only(n);
    if (own) return own;
    // Widening list deliberately excludes [class*="container"]: it matches
    // page-level wrappers as readily as field ones. react-select is unaffected
    // — it has its own rsContainer() lookup below.
    const wide = n.closest && n.closest('fieldset, [class*="field"], [class*="form-group"]');
    return (wide && only(wide)) || null;
  }

  // The single control inside `n`, or null when it holds none or several.
  function only(n) {
    let found;
    try { found = n.querySelectorAll(CONTROL_SEL); } catch (e) { return null; }
    return found && found.length === 1 ? found[0] : null;
  }

  function labelFor(el) {
    if (!el) return '';
    const aria = attr(el, 'aria-label');
    if (aria) return aria;
    const by = attr(el, 'aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(id => {
        let e = null; try { e = document.getElementById(id); } catch (x) {} return e ? txt(e) : '';
      }).filter(Boolean).join(' ');
      if (t) return t;
    }
    const id = attr(el, 'id');
    if (id) {
      let lab = null;
      try { lab = document.querySelector('label[for="' + id.replace(/["\\]/g, '\\$&') + '"]'); } catch (e) {}
      if (lab) return txt(lab);
    }
    const anc = el.closest && el.closest('label');
    if (anc) return txt(anc);
    const fs = el.closest && el.closest('fieldset');
    if (fs) { const lg = fs.querySelector('legend'); if (lg) return txt(lg); }
    return attr(el, 'placeholder');
  }

  // The react-select wrapper for THIS control, or null.
  //
  // Must never climb past the widget. A plain el.closest('[class*="container"]')
  // matches a page-level <div class="application-container"> just as happily,
  // and then every text input on the form reads the FIRST react-select's
  // .singleValue and hidden input — so a dozen distinct fields collapse onto
  // one identity and one value. With the registry live that is worse than
  // useless: empty fields get skipped as "already filled" and bogus labels
  // clear genuinely-missing fields, letting an incomplete form reach submit.
  // Climb only while the ancestor still wraps this one control and nothing
  // else, which is exactly what a widget wrapper does and a form wrapper
  // never does.
  function rsContainer(el) {
    let n = el.parentElement, depth = 0, best = null;
    while (n && depth < 5) {
      if (only(n) !== el) break;   // now covering other controls: too far
      const cls = (n.className && String(n.className)) || '';
      if (/container|control|select|field/i.test(cls)) best = n;
      n = n.parentElement; depth++;
    }
    return best;
  }

  // Whether the form is currently REJECTING this field's value.
  //
  // "Filled" is not the same as "accepted". A phone field reading
  // "+246 8240044652" under a red "Phone number is too long" is filled and
  // wrong, and treating it as done let an invalid application be submitted,
  // then blocked the retry that was supposed to fix it (the registry skipped
  // it as already filled). An invalid field must count as NOT done, so it
  // stays fillable, stays in the missing list, and can be rewritten.
  function isInvalid(el) {
    if (!el) return false;
    if (attr(el, 'aria-invalid') === 'true') return true;
    try { if (el.willValidate && !el.checkValidity()) return true; } catch (e) {}
    // Custom validation (what Greenhouse actually uses): an error node inside
    // the field's own wrapper. Bounded climb, same reasoning as rsContainer —
    // a form-level error banner must not condemn every field on the page.
    let n = el.parentElement, depth = 0;
    while (n && depth < 4) {
      if (only(n) !== el) break;   // now covering other controls: too far
      let errs = null;
      try { errs = n.querySelectorAll('[class*="error"], [class*="invalid"], [role="alert"]'); }
      catch (e) { errs = null; }
      if (errs) {
        for (let i = 0; i < errs.length; i++) {
          if (txt(errs[i])) return true;
        }
      }
      n = n.parentElement; depth++;
    }
    return false;
  }

  function describe(sel) {
    const node = resolve(sel);
    if (!node) return null;
    const el = control(node);
    if (!el) return null;

    const tag = (el.tagName || '').toLowerCase();
    const type = attr(el, 'type').toLowerCase();
    const name = attr(el, 'name');
    const id = attr(el, 'id');
    const label = labelFor(el);
    let kind = tag, ident = '', value = '', filled = false;

    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
      kind = type;
      // A shared name collapses the whole group into ONE logical field, which
      // is what stops three radios reading as three separate fields.
      let group = [el];
      if (name) {
        try {
          group = Array.prototype.slice.call(
            document.querySelectorAll('input[type="' + type + '"]')
          ).filter(x => x.name === name);
        } catch (e) { group = [el]; }
      }
      const checked = group.filter(x => x.checked);
      filled = checked.length > 0;
      value = checked.map(x => labelFor(x) || x.value || '').filter(Boolean).join(' | ');
      ident = name || label || id;

    } else if (tag === 'select') {
      kind = 'select';
      const opt = (el.selectedIndex >= 0 && el.options) ? el.options[el.selectedIndex] : null;
      value = opt ? txt(opt) : '';
      // A non-empty value rejects <option value="">Select…</option> without
      // needing to re-implement the placeholder regex here.
      filled = !!(el.value && String(el.value).trim()) && !!value;
      ident = name || label || id;

    } else if (el.isContentEditable) {
      kind = 'contenteditable';
      value = txt(el); filled = !!value; ident = label || name || id;

    } else if (tag === 'textarea' || tag === 'input' || attr(el, 'role') === 'combobox') {
      const cont = rsContainer(el);
      const single = cont && cont.querySelector('[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"]');
      const ph = cont && cont.querySelector('[class*="placeholder"]');
      const hidden = cont && cont.querySelector('input[type="hidden"][name]');
      const isCombo = !!(single || ph || attr(el, 'role') === 'combobox'
                         || attr(el, 'aria-haspopup') === 'listbox');
      if (isCombo && cont) {
        kind = 'combobox';
        // react-select renders the committed value into the wrapper and
        // CLEARS the inner input, so the input is not the place to look.
        if (single) { value = txt(single); }
        else if (hidden && hidden.value) { value = String(hidden.value).trim(); }
        else if (ph) { value = ''; }
        else if (cont.querySelector('[role="option"], [role="listbox"], [class*="menu"]')) {
          // The menu is OPEN, so nothing has been chosen yet. Falling through
          // to the container's text here would return the whole option list as
          // the field's "value" — and since that list contains the option we
          // were trying to pick, the did-it-commit check would match it and
          // call an uncommitted dropdown a success.
          value = '';
        }
        else {
          const shown = txt(cont);
          value = (label && shown.indexOf(label) === 0) ? shown.slice(label.length).trim() : shown;
        }
        filled = !!value;
        ident = (hidden ? attr(hidden, 'name') : '') || name || label || id;
      } else {
        kind = (tag === 'textarea') ? 'textarea' : 'text';
        value = String(el.value || '').trim();
        filled = !!value;
        ident = name || label || id;
      }
    } else {
      value = txt(el); filled = !!value; ident = name || label || id;
    }

    // No stable identity => the caller must NOT be able to skip this field.
    if (!ident) return null;
    return { ident: ident, kind: kind, label: label, value: value,
             filled: !!filled, invalid: isInvalid(el) };
  }

  const out = [];
  for (let i = 0; i < XPATHS.length; i++) {
    try { out.push(describe(XPATHS[i])); } catch (e) { out.push(null); }
  }
  return JSON.stringify(out);
})()
"""

# Which <input type=file> is the cover-letter slot vs. the resume one, by the
# input's own attributes. Deliberately attribute-based rather than via
# observe(): Greenhouse fronts these inputs with an "Attach" button and hides
# the input itself, so observe() reports the *button*, and set_input_files()
# on a button fails. `i` is CSS case-insensitive attribute matching.
_COVER_LETTER_ATTR_MATCH = '[name*="cover" i], [id*="cover" i], [aria-label*="cover" i]'
_COVER_LETTER_INPUT_SELECTOR = ", ".join(
    f'input[type="file"]{part.strip()}' for part in _COVER_LETTER_ATTR_MATCH.split(",")
)
_RESUME_INPUT_SELECTOR = (
    'input[type="file"]:not([name*="cover" i]):not([id*="cover" i]):not([aria-label*="cover" i])'
)


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
  authorized submitting on their behalf. This includes opt-ins to receive marketing, promotional,
  recruiting or other communications ("Do you consent to receive marketing?"): answer "yes".
  Never leave one of these unanswered — an unanswered consent question blocks the whole
  submission, and these are all reversible by unsubscribing later.
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


def _commit_matches(wanted: str, shown: str | None) -> bool:
    """Whether a combobox's displayed text is actually the option we asked for.

    The widget's own filter decides what Enter selects, and its first hit is
    not always the right one — "India" highlights "British Indian Ocean
    Territory (+246)" before "India (+91)". So a commit that *worked* can still
    be wrong, and the old check (did anything land?) could not tell.

    The shown text legitimately carries extra decoration — a dial code, a flag,
    the label echoed alongside the value — so this compares WHOLE WORDS and
    allows either side to carry extras, rather than raw substrings or a
    similarity ratio. Both of those are far too loose for exactly the values
    that go wrong here: "india" is a substring of "british INDIAn ocean
    territory", and "Austria" scores 0.75 against "Australia".
    """
    want = set(_normalize_option_text(wanted).split())
    got = set(_normalize_option_text(shown or "").split())
    if not want:
        return True
    if not got:
        return False
    return want <= got or got <= want


def _looks_like_decline(text: str) -> bool:
    """Whether a value is a 'prefer not to answer'-style non-answer."""
    lowered = (text or "").lower()
    return any(m in lowered for m in _DECLINE_OPTION_MARKERS)


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
        # Circuit breaker for the custom-dropdown act() fallback — see
        # _DROPDOWN_FALLBACK_FAILURE_LIMIT.
        self._dropdown_fallback_failures = 0
        # Logical field key -> the value we wrote there, for the whole run.
        # ONLY ever holds keys this session filled itself, which is what makes
        # the skip in fill_form safe: a field can never be skipped the first
        # time it is seen, and a field the ATS pre-filled from the resume is
        # still overwritten with our value exactly as before.
        self._filled_fields: dict[str, str] = {}
        # What the last _probe_fields call actually managed to resolve, so the
        # run's step history records it rather than it only reaching a logger.
        self._last_probe_note: str = "probe not run"
        self._probe_resolved: int = 0

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
        can mark that one field/step failed and let the run move on.

        The bound is handed to _run_playwright rather than applied here with
        asyncio.wait_for — see its docstring: wait_for around a cross-thread
        future deadlocks on Windows instead of timing out.

        `timeout` bounds the whole call, retries and backoff included — not
        each attempt separately. Without that distinction a nominally "60s"
        call could legitimately run 4 x 60s plus backoff (~261s), which is why
        a run could blow past budgets that all looked correct in isolation.
        Each attempt gets whatever is left of the budget, so the caller's
        number means what it says."""
        delay = _RETRY_BASE_DELAY
        budget_ends = time.monotonic() + timeout * _CALL_TOTAL_BUDGET_FACTOR
        for attempt in range(_RETRY_ATTEMPTS):
            remaining = budget_ends - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"stagehand call exhausted its {timeout:.0f}s budget over {attempt} attempts")
            try:
                return await _run_playwright(coro_factory(), timeout=min(timeout, remaining))
            except (asyncio.TimeoutError, TimeoutError) as exc:
                raise TimeoutError(f"stagehand call exceeded {timeout:.0f}s") from exc
            except Exception as exc:
                is_last = attempt == _RETRY_ATTEMPTS - 1
                if is_last or not _is_transient(exc):
                    raise
                logger.warning(
                    "stagehand call hit a transient error (attempt %s/%s), retrying in %.0fs: %s",
                    attempt + 1, _RETRY_ATTEMPTS, delay, exc,
                )
                await asyncio.sleep(min(delay, max(0.0, budget_ends - time.monotonic())))
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
            return {"filled": [], "skipped": [], "already_filled": [], "probe": "observe found nothing"}

        candidates, dropped = [], []
        for i, a in enumerate(actions):
            desc = (getattr(a, "description", "") or "").lower()
            if any(m in desc for m in _SKIP_DESCRIPTION_MARKERS):
                dropped.append(getattr(a, "description", ""))
            else:
                candidates.append((i, a))
        # A dropped candidate used to appear in NONE of filled/skipped/
        # already_filled — it just vanished. That is exactly the signature of a
        # field that goes unanswered for no visible reason, and the markers are
        # bare substrings ("cv" matches inside any word containing those two
        # letters), so a false positive here is silent and untraceable.
        if dropped:
            logger.info("fill_form: skipped %d attachment-ish field(s): %s", len(dropped), dropped)
        if not candidates:
            return {"filled": [], "skipped": [], "already_filled": [], "probe": self._last_probe_note}

        # Drop fields THIS RUN already filled, before anything else touches
        # them. This has to happen here — above the option-reading loop, not
        # down at the write — for three reasons:
        #
        #  1. _read_combobox_options() below *clicks the widget open* to read
        #     its choices. On a field that already holds a value that is not a
        #     harmless read: react-select filters its menu against the current
        #     selection, so the second pass often reads back fewer options or
        #     none. Losing the option list drops the "[OPTIONS — pick exactly
        #     one]" constraint from the prompt, and the model then answers from
        #     the generic profile value instead — which is how a correct
        #     "I am not a military Veteran" became "I do not wish to answer" on
        #     a later pass. Skipping early removes that click entirely.
        #  2. A skipped field never enters fields_block, so it has no index and
        #     the model *cannot* return a value for it. There is no second path
        #     by which an already-correct answer can be overwritten.
        #  3. Each skipped dropdown saves six browser round-trips.
        probed = await self._probe_fields([a for _, a in candidates])
        kept, already, rejected = [], [], []
        for pos, (i, action) in enumerate(candidates):
            info = probed.get(pos)
            if info and info.get("invalid"):
                # Filled but the form is rejecting it. Re-fill rather than
                # skip, and say so — this is the case where a run submitted a
                # phone number the site called too long and then could not
                # repair it, because "already filled" had won.
                rejected.append(action.description)
            # All three conditions required. The registry says we wrote this
            # field; the probe confirms the page still shows a value. If the
            # form cleared it, or nothing actually landed (e.g. the model said
            # "No" to every radio in a group so nothing was clicked), filled is
            # False and the field is filled again rather than wrongly skipped.
            if info and info["key"] in self._filled_fields and info["filled"]:
                already.append(action.description)
                logger.info(
                    "fill_form: skipping %r — already filled this run (key=%r, shows %r)",
                    action.description, info["key"], info["value"][:60],
                )
                continue
            kept.append((i, action, info))
        if rejected:
            logger.info("fill_form: %d field(s) the form is rejecting, re-filling: %s",
                        len(rejected), rejected)
        if not kept:
            logger.info("fill_form: all %d field(s) already filled this run; nothing to do", len(already))
            return {"filled": [], "skipped": [], "already_filled": already,
                    "rejected": rejected, "probe": self._last_probe_note}
        candidates = [(i, a) for i, a, _ in kept]
        probe_by_index = {i: info for i, _, info in kept if info}

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
            # Substring match, for the same reason _apply_answer() uses one:
            # observe() reports these as "selectOptionFromDropdown", never a
            # bare "select". An equality check here silently skipped every
            # custom dropdown — so the options were never read, and the model
            # kept answering "India" to a field offering only USA / Canada /
            # Located Elsewhere.
            method = (getattr(action, "method", "") or "").lower()
            if "select" not in method and "dropdown" not in method:
                continue
            locator = page.locator(action.selector)
            opts = await self._read_select_options(locator)
            labels = [o["label"] for o in opts if o.get("label")]
            if not labels:
                # Not a native <select> — open the custom widget and read what
                # it really offers.
                labels = await self._read_combobox_options(locator)
            # A very long list is a country/state picker: the natural answer
            # ("India") is in there and typing it works, so spending hundreds
            # of prompt tokens listing them buys nothing. It's the SHORT,
            # idiosyncratic lists that blind guessing gets wrong, and those
            # are cheap to include.
            if labels and len(labels) <= _MAX_COMBOBOX_OPTIONS_IN_PROMPT:
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
            return {
                "filled": [],
                "skipped": [a.description for _, a in candidates],
                "already_filled": already,
                "probe": self._last_probe_note,
            }

        # unanswered: the LLM had nothing in CANDIDATE_DATA for these — a
        # profile/QA gap. apply_failed: it DID answer, but writing the value
        # into the page failed — a DOM/interaction problem, not a data gap.
        # Logged separately (rather than one flat "skipped" reason) because
        # the fix for each is completely different, and conflating them made
        # a real DOM-write failure indistinguishable from a genuinely missing
        # answer when reading the run's outcome after the fact.
        filled, unanswered, apply_failed = [], [], []
        # Per-field trace for the run's own step history. Every previous round
        # of this bug was diagnosed from a bare count ("12 filled") that could
        # not say WHICH field took WHICH value, nor whether the page agreed
        # afterwards — so a dropdown that reported success while the form still
        # showed "This field is required" looked identical to a real fill.
        trace = []
        for i, action in candidates:
            value = answers.get(str(i))
            desc = (action.description or "")[:70]
            if value is None or str(value).strip() == "":
                unanswered.append(action.description)
                trace.append(f"- {desc} -> NO DATA")
                continue
            info = probe_by_index.get(i)
            was = (info or {}).get("value", "")
            ok = await self._apply_answer(action, str(value), current=was)
            if ok and info:
                # Registered only on success, and only for a field we wrote —
                # this is the sole thing that ever adds to the registry.
                self._filled_fields[info["key"]] = str(value)
            # Read the field back after writing it: "the write didn't raise" is
            # not evidence the value landed.
            after = None
            if info:
                verify = await self._probe_one(action)
                if verify is not None:
                    after = verify
            mark = "OK" if ok else "FAILED"
            if after is not None:
                if after["invalid"]:
                    mark = "WROTE BUT FORM REJECTS IT"
                elif not after["filled"]:
                    mark = "WROTE BUT PAGE STILL EMPTY"
                elif not _commit_matches(str(value), after["value"]):
                    mark = f"PAGE SHOWS {after['value'][:40]!r} INSTEAD"
            trace.append(
                f"- {desc} -> {mark}: wanted {str(value)[:40]!r}"
                + (f", was {was[:30]!r}" if was else "")
                + (f", now {after['value'][:40]!r}" if after else "")
            )
            (filled if ok else apply_failed).append(f"{action.description} (tried: {value!r})")
        if trace:
            logger.info("fill_form field trace:\n%s", "\n".join(trace))
        logger.info(
            "fill_form: %d filled, %d already filled this run, %d unanswered (no data on file): %s, "
            "%d apply failed: %s",
            len(filled), len(already), len(unanswered), unanswered, len(apply_failed), apply_failed,
        )
        return {
            "filled": filled,
            "skipped": unanswered + apply_failed,
            "already_filled": already,
            "rejected": rejected,
            "probe": self._last_probe_note,
            "trace": trace,
        }

    async def _apply_answer(self, action: Any, value: str, current: str = "") -> bool:
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
                await self._select_with_match(locator, action, value, current=current)
                return True
            # Default: plain text/textarea fill. If that fails on what turns
            # out to be a select/checkbox observe() mis-typed, fall back to
            # select_option once before giving up on this field.
            try:
                await self._call(lambda: locator.fill(value))
                return True
            except Exception:
                await self._select_with_match(locator, action, value, current=current)
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

    def probe_healthy(self) -> bool:
        """Whether the last probe actually resolved fields.

        Gate any *repeat* full-page pass on this. When the probe resolves
        nothing the registry is inert, so a second pass is not a cheap
        top-up — it is a full destructive re-fill that re-opens every dropdown
        with the anti-downgrade guard also disabled, i.e. precisely the
        overwriting this whole mechanism exists to prevent."""
        return self._probe_resolved > 0

    async def _probe_fields(self, actions: list) -> dict[int, dict]:
        """Stable logical identity + current value for every observed field.

        One read-only Page.evaluate for the whole list — see _FIELD_PROBE_JS.
        Keyed by position in `actions` so the caller can look up by the same
        index it already uses.

        Entirely best-effort: every failure path returns {} (or simply omits
        that index), and the caller treats a missing entry as "fill it", so a
        probe that cannot run degrades exactly to the previous behaviour
        rather than skipping something it shouldn't. That matters here because
        Greenhouse serves its form in an iframe while Page.evaluate runs
        against the top document, so some forms may resolve nothing at all.
        """
        if not config.field_registry_enabled() or not actions:
            return {}
        try:
            raw_selectors = [str(getattr(a, "selector", "") or "") for a in actions]
            xpaths = [list(_selector_kind(s)) for s in raw_selectors]
            # One raw selector, once per pass, at DEBUG: the entire probe rests
            # on what shape this SDK actually emits, and nothing used to record
            # it — which is why a total resolution failure looked like "no
            # fields were already filled" instead of a bug.
            if raw_selectors:
                logger.debug("field probe: first raw selector %r", raw_selectors[0][:160])
            # ensure_ascii escapes every non-ASCII char, so nothing in a
            # selector can terminate the JS string. .replace() rather than
            # .format() because the JS is full of braces.
            js = _FIELD_PROBE_JS.replace("__XPATHS__", json.dumps(xpaths))
            page = await self._active_page()
            raw = await self._call(
                lambda: page.evaluate(js), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS
            )
            # str is the shape this SDK is known to return; accept an already
            # -decoded list too rather than depend on that staying true.
            if isinstance(raw, str):
                parsed = json.loads(raw)
            elif isinstance(raw, list):
                parsed = raw
            else:
                self._probe_resolved = 0
                self._last_probe_note = f"probe returned {type(raw).__name__}, not JSON"
                logger.warning("field probe: unexpected evaluate result %r", type(raw).__name__)
                return {}
            if not isinstance(parsed, list) or len(parsed) != len(xpaths):
                self._probe_resolved = 0
                self._last_probe_note = "probe returned a malformed result"
                logger.warning(
                    "field probe: expected a list of %d, got %r", len(xpaths), type(parsed).__name__
                )
                return {}

            probed: dict[int, dict] = {}
            for i, entry in enumerate(parsed):
                if not isinstance(entry, dict):
                    continue
                key = question_signature(str(entry.get("ident") or ""))
                if not key:
                    continue
                invalid = bool(entry.get("invalid"))
                # A field the form is rejecting is NOT done, however full it
                # looks. Collapsing that here means every consumer gets it
                # right at once: the registry won't skip it, the missing-list
                # reconciliation won't clear it, and the post-rejection repair
                # pass can actually rewrite it.
                filled = bool(entry.get("filled")) and not invalid
                # Only carry a value when the field is genuinely filled. An
                # unfilled <select> still reports its placeholder ("Select…")
                # as displayed text, and `value` feeds the anti-downgrade
                # guard, which treats any non-empty current value as a real
                # answer worth protecting — so leaking a placeholder through
                # here would make it refuse a legitimate first "prefer not to
                # answer" on an empty field.
                probed[i] = {
                    "key": key,
                    "kind": str(entry.get("kind") or ""),
                    "label": str(entry.get("label") or "").strip(),
                    "value": str(entry.get("value") or "").strip() if filled else "",
                    "filled": filled,
                    "invalid": invalid,
                }
            # Telemetry, not decoration: this returned {} identically whether
            # the call raised, the JSON was malformed, or it resolved 0 of 18
            # selectors — and a silent 0/18 (a selector-format mismatch) went
            # unnoticed through several runs because nothing distinguished
            # them. Now the run's own step history says which.
            self._probe_resolved = len(probed)
            self._last_probe_note = f"probe resolved {len(probed)}/{len(xpaths)} field(s)"
            if not probed and xpaths:
                logger.warning(
                    "field probe resolved 0 of %d selectors — registry, downgrade guard and "
                    "missing-field reconciliation are all inactive this pass. First selector: %r",
                    len(xpaths), xpaths[0][:120],
                )
            else:
                logger.info("field probe resolved %d/%d selectors", len(probed), len(xpaths))
            return probed
        except Exception as exc:
            self._probe_resolved = 0
            self._last_probe_note = f"probe raised: {exc!r}"
            logger.warning("field identity probe failed; filling every field as before", exc_info=True)
            return {}

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

    async def _mark_focused_field(self) -> bool:
        """Tag the currently-focused element so we can find it again after the
        widget has re-rendered. Returns False if nothing was focused."""
        try:
            page = await self._active_page()
            got = await self._call(
                lambda: page.evaluate(
                    "(() => { const el = document.activeElement;"
                    " if (!el || el === document.body) return false;"
                    f" el.setAttribute('{_FIELD_MARK_ATTR}', '1'); return true; }})()"
                ),
                timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS,
            )
            return bool(got)
        except Exception:
            logger.debug("could not mark the focused field", exc_info=True)
            return False

    async def _unmark_field(self) -> None:
        try:
            page = await self._active_page()
            await self._call(
                lambda: page.evaluate(
                    f"(() => {{ for (const el of document.querySelectorAll('[{_FIELD_MARK_ATTR}]'))"
                    f" el.removeAttribute('{_FIELD_MARK_ATTR}'); return true; }})()"
                ),
                timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS,
            )
        except Exception:
            logger.debug("could not unmark the field", exc_info=True)

    async def _marked_widget_text(self) -> str | None:
        """The text the marked field's *widget* is displaying right now.

        react-select (what every dropdown on Greenhouse's boards actually is —
        13 of them on the GitLab form, and zero native <select>) renders the
        chosen value into the control wrapper and CLEARS the inner <input>.
        Reading the input, as the old check did, therefore returns "" for a
        field that is correctly filled: probed live, the control goes
        "Select..." -> "India" while input.value goes "India" -> "". That false
        negative is what made good fills look failed, which tripped the
        circuit breaker and skipped every remaining dropdown."""
        try:
            page = await self._active_page()
            text = await self._call(
                lambda: page.evaluate(
                    f"(() => {{ const el = document.querySelector('[{_FIELD_MARK_ATTR}]');"
                    " if (!el) return null;"
                    " const ctl = el.closest('[class*=\"control\"]')"
                    "   || el.closest('[class*=\"container\"]') || el.parentElement;"
                    " return ctl ? ctl.textContent.trim() : null; })()"
                ),
                timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS,
            )
            return text if isinstance(text, str) else None
        except Exception:
            logger.debug("could not read the marked widget's text", exc_info=True)
            return None

    async def _probe_one(self, action: Any) -> dict | None:
        """Probe a single field by its observe() selector — the read-back used
        to check that a write actually landed.

        Saves and restores the pass-level probe telemetry: this runs once per
        field, and without it `probe resolved N/M` (and probe_healthy(), which
        gates re-sweeping) would end up reporting the last single-field probe
        instead of the whole pass."""
        note, resolved = self._last_probe_note, self._probe_resolved
        try:
            probed = await self._probe_fields([action])
            return probed.get(0)
        finally:
            self._last_probe_note, self._probe_resolved = note, resolved

    async def _probe_marked_field(self) -> dict | None:
        """Run the field probe against the currently-marked element.

        This is the ground truth for "did the dropdown actually take a value",
        and it exists because the older checks could not tell a COMMITTED value
        from the text we had just typed. react-select keeps typed text in the
        input and only writes a .singleValue node once an option is really
        chosen — so input_value() reads back our own keystrokes and reports
        success for a field the form is still rejecting as required. Observed
        live: four EEO dropdowns showed their answer as typed text under a red
        "This field is required.", were logged as filled, and were re-filled on
        every subsequent pass.

        Reuses _FIELD_PROBE_JS (via a CSS selector, which it now handles) so
        there is exactly one definition of filled/invalid in the codebase."""
        try:
            page = await self._active_page()
            js = _FIELD_PROBE_JS.replace(
                "__XPATHS__", json.dumps([["css", f"[{_FIELD_MARK_ATTR}]"]])
            )
            raw = await self._call(lambda: page.evaluate(js), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if not isinstance(parsed, list) or not parsed or not isinstance(parsed[0], dict):
                return None
            entry = parsed[0]
            return {
                "value": str(entry.get("value") or "").strip(),
                "filled": bool(entry.get("filled")),
                "invalid": bool(entry.get("invalid")),
            }
        except Exception:
            logger.debug("could not probe the marked field", exc_info=True)
            return None

    async def _click_matching_option(self, page: Any, value: str) -> bool:
        """Pick the option whose text matches `value` by clicking it.

        Preferred over typing then pressing Enter. Enter takes whatever the
        widget has highlighted, which is not necessarily what we asked for
        ("India" highlights "British Indian Ocean Territory" first), and on
        some builds it does not commit at all — leaving the typed text sitting
        in the input while the form still counts the field as empty. Clicking
        the option row is what a person does and is unambiguous about which
        option is chosen.
        """
        try:
            labels = await self._call(
                lambda: page.evaluate(
                    "(() => Array.from(document.querySelectorAll('[role=option]'))"
                    ".map(o => (o.textContent || '').replace(/\\s+/g, ' ').trim()))()"
                ),
                timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS,
            )
            if not isinstance(labels, list) or not labels:
                return False
            idx = next((i for i, t in enumerate(labels) if _commit_matches(value, str(t))), None)
            if idx is None:
                logger.info("no visible option matches %r; offered: %s", value, labels[:12])
                return False
            option = page.locator('[role="option"]').nth(idx)
            await self._call(lambda: option.click(), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
            logger.info("clicked option %r for %r", labels[idx], value)
            return True
        except Exception:
            logger.debug("could not click a matching option for %r", value, exc_info=True)
            return False

    async def _read_combobox_options(self, locator: Any) -> list[str]:
        """Open a react-select widget and read the choices it actually offers.

        _read_select_options() finds nothing on these (no <option> tags exist —
        every dropdown on Greenhouse's boards is react-select), so the model
        was naming values blind. That is why "Where are you currently based?",
        whose only choices are USA / Canada / Located Elsewhere, got "India":
        a perfectly sensible answer to the question, and not on the menu.

        Only used to enrich the prompt, so it is entirely best-effort: on any
        failure the caller just gets no options, exactly as before.
        """
        try:
            await self._call(lambda: locator.scroll_to("center"), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
            await self._call(lambda: locator.click(), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
            if not await self._mark_focused_field():
                return []
            page = await self._active_page()
            opts = await self._call(
                lambda: page.evaluate(
                    f"(() => {{ const el = document.querySelector('[{_FIELD_MARK_ATTR}]');"
                    " if (!el) return [];"
                    " const wrap = el.closest('[class*=\"container\"]') || el.parentElement;"
                    " let menu = wrap && wrap.querySelector('[class*=\"menu\"]');"
                    " let opts = menu ? Array.from(menu.querySelectorAll('[role=option]')) : [];"
                    " if (!opts.length) {"
                    "   const id = el.getAttribute('aria-controls');"
                    "   const list = id ? document.getElementById(id) : null;"
                    "   if (list) opts = Array.from(list.querySelectorAll('[role=option]'));"
                    " }"
                    f" return opts.map(o => o.textContent.trim()).filter(Boolean).slice(0, {_MAX_COMBOBOX_OPTIONS_READ}); }})()"
                ),
                timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS,
            )
            return [o for o in opts if isinstance(o, str)] if isinstance(opts, list) else []
        except Exception:
            logger.debug("could not read combobox options", exc_info=True)
            return []
        finally:
            await self._unmark_field()
            await self._dismiss_open_listbox()

    async def _dismiss_open_listbox(self) -> None:
        """Escape, unconditionally. Cheap, idempotent, and never worth failing on."""
        try:
            page = await self._active_page()
            await self._call(lambda: page.key_press("Escape"), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
        except BaseException:  # noqa: BLE001 — best effort by design
            logger.debug("could not send Escape to close a dropdown", exc_info=True)

    async def _capture_dropdown_failure(self, description: str) -> str | None:
        """Screenshot the page when a dropdown won't commit.

        Every previous round of this bug was diagnosed by inference from an
        empty field; a picture of the actual widget state (open? filtered to
        nothing? overlaid?) is what turns the next failure into evidence."""
        try:
            page = await self._active_page()
            safe = re.sub(r"[^a-z0-9]+", "-", description.lower())[:40] or "dropdown"
            path = os.path.join(
                tempfile.gettempdir(), f"autoapply-{self.session_id}-{safe}-{int(time.time())}.png"
            )
            await self._call(lambda: page.screenshot(path=path), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
            return path
        except BaseException:  # noqa: BLE001
            logger.debug("could not capture a dropdown failure screenshot", exc_info=True)
            return None

    async def _commit_combobox(self, locator: Any, description: str, value: str, current: str = "") -> bool:
        """Drive a custom combobox from the keyboard: open, type, Enter.

        Returns True only if the field's own displayed text then shows a real
        value — act() has already been caught reporting success on a field
        still reading "Select…", so nothing here is trusted without that
        ground-truth read. Escape runs in the finally whether this succeeded or
        not, so no listbox is ever left open to block the fields below."""
        # Backstop for the case fill_form's registry didn't catch (probe
        # returned nothing for this field, so it wasn't skipped). Never trade a
        # real answer for a "prefer not to say" one: a later pass that lost the
        # option list answers from the generic profile value, and without this
        # it would type that straight over a correct earlier answer.
        if current and _looks_like_decline(value) and not _looks_like_decline(current):
            logger.info(
                "dropdown %r already reads %r; refusing to overwrite it with the decline answer %r",
                description, current[:60], value,
            )
            return True
        try:
            await self._call(lambda: locator.scroll_to("center"), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
            await self._call(lambda: locator.click(), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
            # Mark while focused: the widget re-renders on commit and the
            # observe() selector may no longer resolve to the same node.
            marked = await self._mark_focused_field()
            await self._call(
                lambda: locator.type(value, delay=30), timeout=_DROPDOWN_ACT_TIMEOUT_SECONDS
            )
            page = await self._active_page()

            # Click the matching option first. Enter is the fallback: it takes
            # whatever the widget highlights, which may be the wrong option, and
            # on Greenhouse's EEO dropdowns it often commits nothing at all —
            # leaving the typed text visible while the field stays required.
            how = "option-click"
            if not await self._click_matching_option(page, value):
                how = "enter-key"
                await self._call(lambda: page.key_press("Enter"), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)

            committed, shown, why = await self._verify_commit(locator, description, value, marked)
            if committed:
                logger.info("dropdown %r committed %r via %s (now shows %r)",
                            description, value, how, shown[:60])
                return True

            # Second chance with the other mechanism before giving up: these
            # two fail in different ways, so one often works where the other
            # silently does nothing.
            if how == "option-click":
                await self._call(lambda: page.key_press("Enter"), timeout=_DROPDOWN_KEY_TIMEOUT_SECONDS)
                committed, shown, why = await self._verify_commit(locator, description, value, marked)
                if committed:
                    logger.info("dropdown %r committed %r via enter-key retry", description, value)
                    return True

            shot = await self._capture_dropdown_failure(description)
            logger.warning(
                "dropdown %r did not take %r (%s; shows %r)%s",
                description, value, why, shown[:60], f"; screenshot: {shot}" if shot else "",
            )
            return False
        except Exception as exc:
            logger.warning("keyboard entry failed on dropdown %r: %s", description, exc)
            return False
        finally:
            await self._unmark_field()
            await self._dismiss_open_listbox()

    async def _verify_commit(
        self, locator: Any, description: str, value: str, marked: bool
    ) -> tuple[bool, str, str]:
        """(committed, shown_text, reason) — did the widget really take `value`?

        Prefers the field probe, which distinguishes a committed value from
        text merely typed into the input and also notices the form rejecting
        the field. The old element-level read could not: input_value() returns
        our own keystrokes, so an uncommitted dropdown reported success and was
        recorded as filled while the page still showed "This field is
        required."
        """
        info = await self._probe_marked_field() if marked else None
        if info is not None:
            shown = info["value"]
            if info["invalid"]:
                return False, shown, "the form is still rejecting this field"
            if not info["filled"]:
                return False, shown, "no value committed (text was only typed in)"
            if not _commit_matches(value, shown):
                return False, shown, f"committed a different option than {value!r}"
            return True, shown, ""
        # No mark (nothing focused, or a cross-frame form) — fall back to the
        # weaker element-level read rather than nothing.
        shown_text = (await self._marked_widget_text() if marked else None) or ""
        if await self._dropdown_shows_a_value(locator, description):
            if not _commit_matches(value, shown_text or value):
                return False, shown_text, f"committed a different option than {value!r}"
            return True, shown_text, ""
        return False, shown_text, "no value visible after the attempt"

    async def _select_with_match(self, locator: Any, action: Any, value: str, current: str = "") -> None:
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
            # Keyboard first, act() only as a backstop. These comboboxes filter
            # as you type, so click → type → Enter commits the highlighted
            # option through the widget's own keyboard handling, without
            # needing a stable selector for the portal-rendered option row —
            # which observe() does not reliably give (it returned the input,
            # a wrapper div, and once a bare <label> for the same field).
            #
            # This attempt is ALWAYS made, never gated on the circuit breaker.
            # The breaker exists to avoid paying act()'s timeout over and over;
            # the keyboard path costs a few seconds and is the one most likely
            # to work, so skipping it saved nothing and cost everything — a run
            # with two early failures skipped 11 untried dropdowns, including
            # every EEO field, which is exactly the reported symptom.
            if await self._commit_combobox(locator, description, value, current=current):
                self._dropdown_fallback_failures = 0
                return
            if self._dropdown_fallback_failures >= _DROPDOWN_FALLBACK_FAILURE_LIMIT:
                raise RuntimeError(
                    "custom dropdowns on this form can't be driven "
                    f"({self._dropdown_fallback_failures} already failed); skipping the slow "
                    f"act() retry for {value!r} rather than paying the timeout again"
                )
            try:
                await self.act(
                    f'Open the dropdown for "{description}" and click the option that best '
                    f"matches: {value}",
                    timeout=_DROPDOWN_ACT_TIMEOUT_SECONDS,
                )
                if await self._dropdown_shows_a_value(locator, description):
                    self._dropdown_fallback_failures = 0
                    return
                self._dropdown_fallback_failures += 1
            except Exception:
                self._dropdown_fallback_failures += 1
            finally:
                # Unconditional: act() leaves the listbox open when it fails to
                # pick (seen on the "Where are you currently based?" field), and
                # an open portal listbox overlays the fields *below* it and
                # swallows their clicks. That turns one unfillable dropdown into
                # every subsequent field failing, which is the most likely reason
                # all the EEO fields came back empty rather than just some.
                await self._dismiss_open_listbox()
            # Last resort — behaves exactly as before this fallback existed,
            # for the case where it genuinely is a plain <select> whose
            # inner_html() just couldn't be read.
            await self._call(lambda: locator.select_option(value))
            if not await self._dropdown_shows_a_value(locator, description):
                raise RuntimeError(f"dropdown still shows no value after every attempt for {value!r}")
            return
        match = _best_option_match(value, options)
        # `not current` for the same reason as the combobox guard above: the
        # decline fallback is a last resort for an unanswerable field, not
        # something to apply to a field that already holds a real answer.
        if not match and not current and _looks_like_eeo_field(getattr(action, "description", "")):
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
            # Every file input EXCEPT any that identifies itself as the
            # cover-letter slot. Uploading the resume to a spare/decoy input
            # is harmless (an "autofill from resume" uploader just re-parses
            # the same PDF), but uploading it into the Cover Letter input is
            # not — that files the resume as the cover letter, and it's the
            # very input upload_cover_letter() is about to fill.
            uploaded_any = await self._set_files_on(page, _RESUME_INPUT_SELECTOR, resume_path)
            if uploaded_any:
                await asyncio.sleep(1.5)  # let the ATS parse/echo the upload(s)
            return uploaded_any
        except Exception:
            logger.exception("resume upload failed for session %s", self.session_id)
            return False

    async def filled_field_labels(self) -> list[str]:
        """Labels of every field on this form that currently holds a value.

        Ground truth for reconciling the verify step's missing_required list.
        That list is an LLM reading of the page, and it routinely names fields
        that are demonstrably filled: on a react-select the chosen value lives
        in a wrapper div while the underlying input reads empty, so the model
        sees no value and reports the field as still required. Observed on a
        real Robinhood/Greenhouse form — a repair pass filled 11 fields and
        the recheck then listed all 14 of them as missing, which ended the run
        without ever submitting a fully-completed application.

        Best-effort: on any failure this returns [], and the caller then falls
        back to trusting missing_required exactly as before.
        """
        try:
            actions = await self.observe(
                "Find every fillable field in this job application form: text inputs, textareas, "
                "selects, checkboxes, radio buttons, and comboboxes. Skip search boxes, filters, "
                "and site navigation controls."
            )
            if not actions:
                return []
            probed = await self._probe_fields(actions)
            labels: list[str] = []
            for i, info in probed.items():
                if not info["filled"]:
                    continue
                # Prefer the DOM label; fall back to observe()'s description
                # and then the identity key, so a field with an aria-label but
                # no visible <label> still contributes something matchable.
                labels.append(
                    info["label"]
                    or str(getattr(actions[i], "description", "") or "")
                    or info["key"]
                )
            return [l for l in labels if l.strip()]
        except Exception:
            logger.debug("could not read filled field labels", exc_info=True)
            return []

    async def attached_documents(self) -> dict[str, list[str]]:
        """Which document slots actually hold a file right now.

        Ground truth read off the inputs themselves, for the same reason
        _dropdown_shows_a_value exists: neither the upload call returning True
        nor the verify LLM's reading of the page is reliable on its own. The
        upload only proves *some* file input took the file (a form can have a
        decoy "autofill from resume" uploader beside the required Resume
        field), and the LLM routinely reports Resume/CV as still-missing on
        Greenhouse because the real <input type=file> is hidden behind an
        "Attach" button, so there is no visible filename for it to see.

        <input type="file"> exposes "C:\\fakepath\\<name>" through .value once
        a file is set and "" when empty — verified against Chromium including
        display:none inputs. Read via Locator (not Page.evaluate) because the
        form is usually inside an iframe, which Locator resolves into and a
        top-document evaluate does not.
        """
        page = await self._active_page()
        return {
            "resume": await self._attached_filenames(page, _RESUME_INPUT_SELECTOR),
            "cover_letter": await self._attached_filenames(page, _COVER_LETTER_INPUT_SELECTOR),
        }

    async def _attached_filenames(self, page: Any, selector: str) -> list[str]:
        """Basenames of the files currently sitting in inputs matching selector."""
        names: list[str] = []
        try:
            handles = page.locator(selector)
            count = await self._call(lambda: handles.count())
        except Exception:
            logger.debug("could not count file inputs for %r", selector, exc_info=True)
            return names
        for idx in range(count):
            try:
                one = handles.nth(idx)
                raw = await self._call(lambda h=one: h.input_value())
            except Exception:
                continue
            raw = (raw or "").strip()
            if raw:
                names.append(raw.replace("\\", "/").rsplit("/", 1)[-1])
        return names

    async def _set_files_on(self, page: Any, selector: str, file_path: str) -> bool:
        """set_input_files across every input matching `selector`. Individual
        failures are ignored — one unusable input must not stop the rest."""
        uploaded_any = False
        handles = page.locator(selector)
        try:
            count = await self._call(lambda: handles.count())
        except Exception:
            return False
        for idx in range(count):
            try:
                one = handles.nth(idx)
                await self._call(lambda h=one: h.set_input_files(file_path))
                uploaded_any = True
            except Exception:
                continue
        return uploaded_any

    async def upload_cover_letter(self, cover_letter_path: str) -> bool:
        """Attach the base cover letter PDF to the input actually asking for
        one — never blindly to every file input, which would overwrite the
        resume attachment.

        Targeted by CSS attribute selectors rather than observe(): on a real
        Greenhouse form the visible control is an "Attach" *button* with the
        real <input type=file> hidden behind it, so observe() hands back the
        button's selector and set_input_files() on a <button> fails. Matching
        the input's own name/id/aria-label is deterministic, needs no LLM
        call, and finds the hidden input the button is fronting."""
        try:
            page = await self._active_page()
            uploaded_any = await self._set_files_on(page, _COVER_LETTER_INPUT_SELECTOR, cover_letter_path)
            if uploaded_any:
                await asyncio.sleep(1.5)  # let the ATS parse/echo the upload(s)
            return uploaded_any
        except Exception:
            logger.exception("cover letter upload failed for session %s", self.session_id)
            return False

    async def _active_page(self) -> Any:
        return await self._call(lambda: self._browser.context.active_page())

    async def end(self) -> None:
        """Tear down both handles.

        Closing Stagehand does NOT close the Chromium underneath it: the
        browser was launched by us and passed in via `browser=`, so Stagehand
        never owns it. Closing only `_sh` (as this used to) is what leaked 27
        Chromium processes. Both are closed independently so a failure in one
        still attempts the other, and BaseException is caught because
        CancelledError is not an Exception — a cancelled run would otherwise
        skip cleanup entirely, which is precisely when it is needed most.
        """
        # StagehandBrowser.close() is a *sync* method returning
        # asyncio.shield(task) — a Future, not a coroutine — and
        # run_coroutine_threadsafe accepts only a coroutine. Passing it
        # directly raised "A coroutine object is required" and the Chromium
        # was never closed at all (confirmed in a live run). Wrapping it in a
        # coroutine both satisfies that and keeps the create_task() inside
        # close() on the Playwright loop, where it has to run.
        async def _close_chromium() -> None:
            # Closing Stagehand usually takes the browser down with it, and a
            # second close() on an already-closed browser blocks until the
            # timeout (measured: a full 20s stall on every teardown). The
            # close still has to be attempted, because Stagehand does NOT own
            # a browser passed in via browser= and won't always close it.
            if getattr(self._browser, "closed", False):
                return
            await self._browser.close()

        for label, closer in (
            ("stagehand", lambda: self._sh.close()),
            ("chromium", _close_chromium),
        ):
            try:
                await self._call(closer, timeout=_CLOSE_TIMEOUT_SECONDS)
            except BaseException:  # noqa: BLE001 — cleanup must never propagate
                logger.warning(
                    "could not cleanly close %s for session %s", label, self.session_id, exc_info=True
                )


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
        try:
            stagehand = await Stagehand.create(
                browser=browser,
                model=config.model_name(),
                model_api_key=config.model_api_key(),
            )
        except BaseException:
            # Chromium is already up at this point. Without this, a failed
            # create() (bad model key, network blip) orphans a live browser
            # that nothing holds a reference to and nothing will ever close.
            try:
                await browser.close()
            except BaseException:  # noqa: BLE001
                logger.warning("could not close browser after failed Stagehand.create", exc_info=True)
            raise
        return LocalBrowser(stagehand, browser)

    # Launching Chromium + attaching Stagehand is the one call that can
    # legitimately take a while (a cold browser start), so it gets a longer
    # bound than a normal RPC — but it still gets one, so a wedged launch
    # can't sit forever the way an unbounded call could.
    return await _run_playwright(_open(), timeout=_LAUNCH_TIMEOUT_SECONDS)
