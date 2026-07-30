// ═══════════════════════════════════════════════════════
// TailorCV — Apply autofill engine
//
// Scans the application form on the current ATS/company-career page and fills
// what it can safely fill: deterministic personal-info fields from the user's
// stored "Application details" profile, and free-text/ambiguous fields via a
// batched LLM call grounded in the resume + JD. Checkboxes/radios are never
// auto-clicked and Submit is never clicked — the run always ends with the
// user reviewing and submitting by hand. If a captcha appears, the run pauses
// until the user clicks Resume (never auto-detected/auto-solved).
//
// Exposed as window.__tcvAutofill = { run(opts) } for content.js to call.
// The generic run() (any ATS/company-career page) never clicks Submit — the
// run always ends on a review banner. LinkedIn's own in-page Easy Apply modal
// is the one documented exception: runLinkedInEasyApply() below fills every
// step AND clicks the final Submit application button, only pausing if a
// required question can't be confidently answered (see startChain()).
// ═══════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window.__tcvAutofill) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ── DOM value-setting (React-safe) ──────────────────
  // Setting `.value` directly on a controlled React input updates the DOM node
  // but not React's own internal state (its change handler never fires), so
  // the field LOOKS filled but is treated as empty at validate/submit time —
  // the documented Workday quirk. Calling the native property setter (which
  // React's synthetic-event layer doesn't intercept) and then dispatching real
  // input/change events makes React's own listeners observe the change. Works
  // for <input>, <textarea>, and <select> alike since each defines its own
  // 'value' accessor on its own prototype.
  function setNativeValue(el, value) {
    const proto = el.constructor && el.constructor.prototype;
    const descriptor = (proto && Object.getOwnPropertyDescriptor(proto, 'value'))
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    const setter = descriptor && descriptor.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function focusBlur(el) {
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  // Types one character at a time with short delays, re-checking the element
  // is still attached before every keystroke. react-select and similar
  // widgets destroy/recreate their DOM on every keystroke, so a cached
  // reference can go stale mid-type (documented quirk) — getEl() is called
  // fresh each time to guard against that.
  async function typeIntoField(getEl, text) {
    let el = getEl();
    if (!el) return false;
    el.focus();
    setNativeValue(el, '');
    for (const ch of text) {
      el = getEl();
      if (!el || !el.isConnected) return false;
      setNativeValue(el, (el.value || '') + ch);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await sleep(35);
    }
    return true;
  }

  // ── Field scanning ───────────────────────────────────

  const FIELD_SELECTOR = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), textarea, select';

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function nearestLabelText(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) {
        const t = (lbl.innerText || lbl.textContent || '').trim();
        if (t) return t;
      }
    }

    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();

    const ariaBy = el.getAttribute('aria-labelledby');
    if (ariaBy) {
      const parts = ariaBy.split(/\s+/).map((id) => {
        const n = document.getElementById(id);
        return n ? (n.innerText || n.textContent || '') : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ').trim();
    }

    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll('input, textarea, select').forEach((n) => n.remove());
      const t = (clone.innerText || clone.textContent || '').trim();
      if (t) return t;
    }

    // Walk up a few ancestors looking for a preceding label-like sibling — the
    // common pattern for custom-styled (non-<label>) question wrappers.
    let node = el;
    for (let i = 0; i < 4 && node && node.parentElement; i++) {
      const container = node.parentElement;
      const candidates = container.querySelectorAll(':scope > label, :scope > span, :scope > div, :scope > p, :scope > legend');
      for (const c of candidates) {
        if (c.contains(el)) continue;
        const t = (c.innerText || c.textContent || '').trim();
        if (t && t.length > 1 && t.length < 300) return t;
      }
      node = container;
    }

    return el.getAttribute('placeholder') || el.getAttribute('name') || '';
  }

  function classifyType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'file') return 'file';
    // react-select and similar comboboxes render a real <input> inside a
    // styled wrapper — these attributes/class hints are how they're told
    // apart from a plain text field so typing + option-click logic applies.
    if (el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete')
        || (typeof el.className === 'string' && /select|combobox|autocomplete/i.test(el.className))) {
      return 'combobox';
    }
    return type === 'email' || type === 'tel' || type === 'number' ? type : 'text';
  }

  // LinkedIn's Easy Apply form marks a required question with a trailing "*"
  // in the visible label text alone — no `required` attribute, no
  // `aria-required` — so relying on either of those DOM signals silently
  // treats a required, empty field as optional and skips it with no fill and
  // no review flag. The generic ATS matchers in run() rarely rely on this
  // (most set the real attribute), so this is additive, not a replacement.
  function labelLooksRequired(label) {
    return /\*\s*$/.test(label || '');
  }

  // `root` scopes the scan to a container (e.g. the Easy Apply modal) instead
  // of the whole document — needed so a LinkedIn step-by-step scan doesn't
  // pick up fields from underneath the modal. `skipChoices` omits
  // checkbox/radio inputs, which the Easy Apply flow scans and fills
  // separately via scanRadioGroups()/scanCheckboxes() (fillField() below has
  // no real effect on them — see those functions for why radios/checkboxes
  // need their own click-based fill path).
  function scanFields(root = document, { skipChoices = false } = {}) {
    const fields = [];
    for (const el of root.querySelectorAll(FIELD_SELECTOR)) {
      if (!visible(el)) continue;
      if (el.closest('#tailorcv-sidebar') || el.closest('#tcv-af-banner')) continue;
      if (el.disabled || el.readOnly) continue;

      const fieldType = classifyType(el);
      if (skipChoices && (fieldType === 'checkbox' || fieldType === 'radio')) continue;
      const label = nearestLabelText(el).replace(/\s+/g, ' ').trim().slice(0, 300);
      const required = el.required || el.getAttribute('aria-required') === 'true' || labelLooksRequired(label);
      const options = fieldType === 'select'
        ? Array.from(el.options).map((o) => o.textContent.trim()).filter(Boolean)
        : null;
      const limit = el.maxLength && el.maxLength > 0 ? el.maxLength : null;

      fields.push({ el, fieldType, label, required, options, limit, id: `f${fields.length}` });
    }
    return fields;
  }

  // Radios/checkboxes are surfaced in the end-of-run summary (never filled) —
  // grouping just avoids listing the same "name" group once per option.
  function scanChoiceGroups() {
    const seen = new Set();
    const groups = [];
    for (const el of document.querySelectorAll('input[type=checkbox], input[type=radio]')) {
      if (!visible(el)) continue;
      if (el.closest('#tailorcv-sidebar') || el.closest('#tcv-af-banner')) continue;
      const key = el.name || el.id || el;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({ label: nearestLabelText(el) || el.name || `${el.type} group` });
    }
    return groups;
  }

  // ── Captcha detection ────────────────────────────────

  const CAPTCHA_SELECTORS = [
    'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]',
    '.g-recaptcha', '.h-captcha', '.cf-turnstile', '#px-captcha',
  ];

  function captchaVisible() {
    return CAPTCHA_SELECTORS.some((sel) => {
      const el = document.querySelector(sel);
      return el && visible(el);
    });
  }

  async function pauseForCaptcha() {
    const banner = showBanner(`
      <div class="tcv-af-title">⚠️ Captcha detected</div>
      <div>Solve it above, then click Resume to continue filling the rest of the form.</div>
      <button id="tcvAfCaptchaResume">Resume</button>
    `);
    await new Promise((resolve) => {
      banner.querySelector('#tcvAfCaptchaResume').addEventListener('click', resolve, { once: true });
    });
    removeBanner();
  }

  // ── UI: banner ────────────────────────────────────────

  let styleInjected = false;
  function ensureBannerStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.id = 'tcv-autofill-styles';
    style.textContent = `
      #tcv-af-banner {
        position: fixed; top: 16px; right: 16px; z-index: 2147483000;
        max-width: 340px; background: #12172b; color: #f1f5f9;
        border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
        padding: 14px 16px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0,0,0,0.35);
      }
      #tcv-af-banner b { color: #fff; }
      #tcv-af-banner .tcv-af-title { font-weight: 700; margin-bottom: 6px; }
      #tcv-af-banner ul { margin: 8px 0 0; padding-left: 18px; max-height: 140px; overflow-y: auto; }
      #tcv-af-banner li { margin-bottom: 3px; }
      #tcv-af-banner button {
        margin-top: 10px; width: 100%; padding: 9px 12px; border: none; border-radius: 8px;
        background: linear-gradient(90deg, #4f7fff, #c9b8ff); color: #0b0f1f; font-weight: 700;
        cursor: pointer; font-size: 13px;
      }
      #tcv-af-banner button.tcv-af-secondary {
        margin-top: 6px; background: rgba(255,255,255,0.1); color: #f1f5f9; font-weight: 600;
      }
      .tcv-af-highlight { outline: 2px solid #fbbf24 !important; outline-offset: 2px !important; }
    `;
    document.head.appendChild(style);
  }

  function showBanner(html) {
    ensureBannerStyles();
    let banner = document.getElementById('tcv-af-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'tcv-af-banner';
      document.body.appendChild(banner);
    }
    banner.innerHTML = html;
    return banner;
  }

  function removeBanner() {
    const b = document.getElementById('tcv-af-banner');
    if (b) b.remove();
  }

  function highlight(el) {
    if (el) el.classList.add('tcv-af-highlight');
  }

  // ── Deterministic matchers ───────────────────────────
  // Order matters: more specific patterns must be tried before generic ones
  // (e.g. "first name" before a bare "name").

  const MATCHERS = [
    { re: /first\s*name/i, get: (p) => (p.name || '').trim().split(/\s+/)[0] || '' },
    { re: /last\s*name|surname/i, get: (p) => (p.name || '').trim().split(/\s+/).slice(1).join(' ') },
    { re: /full\s*name|your\s*name|^name$/i, get: (p) => p.name },
    { re: /e-?mail/i, get: (p) => p.email },
    { re: /phone|mobile|contact\s*number/i, get: (p) => p.phone },
    { re: /linkedin/i, get: (p) => p.linkedin_url },
    { re: /github/i, get: (p) => p.github_url },
    { re: /portfolio|personal\s*website|website/i, get: (p) => p.portfolio_url },
    { re: /city/i, get: (p) => p.city },
    { re: /state|province/i, get: (p) => p.state },
    { re: /country/i, get: (p) => p.country },
    { re: /notice\s*period/i, get: (p) => p.notice_period },
    // "CTC" (Cost to Company) is the standard Indian-job-posting term for
    // salary — "expected/desired CTC" is desired_salary, "current CTC" is
    // current_salary, just regional wording either way. Deliberately NOT
    // matching a bare "ctc" with no desired/expected/current qualifier: an
    // unqualified salary question is ambiguous between the two, and guessing
    // which one risks answering with the wrong figure — better to fall
    // through to the AI (which will correctly skip, ungrounded) and pause for
    // the user than answer a factual question with the wrong number.
    { re: /(desired|expected)\s*(salary|ctc)|salary\s*expect/i, get: (p) => p.desired_salary },
    { re: /current\s*(salary|ctc)|present\s*(salary|ctc)/i, get: (p) => p.current_salary },
    { re: /university|college|\bschool\b/i, get: (p) => firstEdu(p, 'school') },
    { re: /degree/i, get: (p) => firstEdu(p, 'degree') },
    { re: /field\s*of\s*study|major/i, get: (p) => firstEdu(p, 'field_of_study') },
    { re: /gpa/i, get: (p) => firstEdu(p, 'gpa') },
    // EEO (Equal Employment Opportunity) fields — always self-identified and
    // voluntary, so these only ever fill in with the exact string the user
    // chose on their profile page (see templates/profile.html); an unset
    // profile value is "" (falsy), which correctly leaves the question
    // unanswered here rather than defaulting to any particular option.
    { re: /\bgender\b/i, get: (p) => p.gender },
    { re: /ethnicity|\brace\b/i, get: (p) => p.ethnicity },
    { re: /veteran/i, get: (p) => p.veteran_status },
    { re: /disab(led|ility)/i, get: (p) => p.disability_status },
  ];

  function firstEdu(profile, key) {
    return (profile.education && profile.education[0] && profile.education[0][key]) || '';
  }

  const YES_NO_MATCHERS = [
    { re: /work\s*authoriz|authorized\s*to\s*work|legally\s*(authorized|eligible)/i, get: (p) => p.work_authorized },
    { re: /(require|need).{0,20}sponsor|visa\s*sponsor/i, get: (p) => p.needs_sponsorship },
    { re: /relocat/i, get: (p) => p.willing_to_relocate },
  ];

  function boolToYesNo(v, options) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(options) && options.length) {
      const yes = options.find((o) => /^yes\b/i.test(o));
      const no = options.find((o) => /^no\b/i.test(o));
      return v ? (yes || options[0]) : (no || options[1] || options[0]);
    }
    return v ? 'Yes' : 'No';
  }

  function fillSelectByText(el, text) {
    if (!text) return false;
    const lower = String(text).trim().toLowerCase();
    const opts = Array.from(el.options);
    const match = opts.find((o) => o.textContent.trim().toLowerCase() === lower)
      || opts.find((o) => o.textContent.trim().toLowerCase().includes(lower));
    if (!match) return false;
    setNativeValue(el, match.value);
    return true;
  }

  // For react-select-style comboboxes: type the value, then click the first
  // rendered option that textually matches (per the documented per-keystroke
  // DOM-rebuild quirk — never cache the options list from before typing).
  async function fillComboboxField(el, value) {
    const ok = await typeIntoField(() => el, String(value));
    if (!ok) return false;
    await sleep(250); // let the dropdown render
    const lower = String(value).trim().toLowerCase();
    const candidates = document.querySelectorAll('[role="option"], [class*="option"]');
    for (const opt of candidates) {
      if (!visible(opt)) continue;
      const t = (opt.textContent || '').trim().toLowerCase();
      if (t && (t === lower || t.includes(lower))) {
        opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        opt.click();
        return true;
      }
    }
    // No matching dropdown option rendered — the typed text is still in the
    // field, which is enough for free-text comboboxes, so don't hard-fail.
    return true;
  }

  async function fillField(field, value) {
    if (value === null || value === undefined || value === '') return false;
    const el = field.el;
    if (field.fieldType === 'select') return fillSelectByText(el, value);
    if (field.fieldType === 'combobox') return fillComboboxField(el, value);
    setNativeValue(el, String(value));
    focusBlur(el);
    return true;
  }

  // ── Radio groups & checkboxes (LinkedIn Easy Apply only) ─
  // The generic run() above leaves every checkbox/radio for the user by
  // design — but LinkedIn's Easy Apply modal gates its own Next/Submit button
  // on required radios (work authorization, sponsorship, EEO questions) and
  // required consent checkboxes, so skipping them there just means the flow
  // can never advance. setNativeValue()'s React-property-setter trick (used
  // for text inputs) has no equivalent for radios/checkboxes — the only way
  // to select one that both the DOM and any React listener agree on is a
  // real .click(), which is what these use instead of fillField().

  function radioOptionLabel(radioEl) {
    if (radioEl.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(radioEl.id)}"]`);
      if (lbl) {
        const t = (lbl.innerText || lbl.textContent || '').trim();
        if (t) return t;
      }
    }
    const wrapping = radioEl.closest('label');
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll('input').forEach((n) => n.remove());
      const t = (clone.innerText || clone.textContent || '').trim();
      if (t) return t;
    }
    return '';
  }

  function scanRadioGroups(root) {
    const seen = new Set();
    const groups = [];
    for (const el of root.querySelectorAll('input[type=radio]')) {
      if (!visible(el)) continue;
      if (el.closest('#tailorcv-sidebar') || el.closest('#tcv-af-banner')) continue;
      const key = el.name || 'unnamed';
      if (seen.has(key)) continue;
      seen.add(key);

      const fieldset = el.closest('fieldset') || el.closest('[role="radiogroup"]') || root;
      const radios = Array.from(el.name
        ? fieldset.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)
        : [el]).filter(visible);
      if (!radios.length) continue;

      const legend = fieldset.querySelector('legend, [data-test-form-builder-radio-button-form-component__title]');
      let label = legend ? (legend.innerText || legend.textContent || '').trim() : '';
      if (!label) label = nearestLabelText(el);
      label = label.replace(/\s+/g, ' ').trim().slice(0, 300);

      const options = radios.map((r) => ({ el: r, label: radioOptionLabel(r) || r.value || '' }))
        .filter((o) => o.label);
      if (!label || !options.length) continue;

      const required = radios.some((r) => r.required || r.getAttribute('aria-required') === 'true')
        || fieldset.getAttribute('aria-required') === 'true'
        || labelLooksRequired(label);
      groups.push({ fieldType: 'radio', label, options: options.map((o) => o.label), radios: options, required, id: `r${groups.length}` });
    }
    return groups;
  }

  // Standalone checkboxes only — a checkbox that's part of a radio-style
  // "select all that apply" question isn't something Easy Apply asks, so no
  // grouping logic is needed here the way scanRadioGroups() needs one for radios.
  function scanCheckboxes(root) {
    const boxes = [];
    for (const el of root.querySelectorAll('input[type=checkbox]')) {
      if (!visible(el)) continue;
      if (el.closest('#tailorcv-sidebar') || el.closest('#tcv-af-banner')) continue;
      if (el.disabled) continue;
      const label = nearestLabelText(el).replace(/\s+/g, ' ').trim().slice(0, 300);
      const required = el.required || el.getAttribute('aria-required') === 'true' || labelLooksRequired(label);
      boxes.push({ fieldType: 'checkbox', label, el, required, id: `c${boxes.length}` });
    }
    return boxes;
  }

  // Exact match first, then a "decline / prefer not to say" phrase fallback —
  // EEO-style options are rarely worded identically to our own "Decline".
  const DECLINE_PHRASES = ['decline', 'prefer not', 'not wish', 'not want', "don't wish"];

  function clickRadioOption(radioGroup, optionLabelText) {
    if (!optionLabelText) return false;
    const lower = String(optionLabelText).trim().toLowerCase();
    let match = radioGroup.radios.find((o) => o.label.toLowerCase() === lower)
      || radioGroup.radios.find((o) => o.label.toLowerCase().includes(lower) || lower.includes(o.label.toLowerCase()));
    if (!match && DECLINE_PHRASES.some((p) => lower.includes(p))) {
      match = radioGroup.radios.find((o) => DECLINE_PHRASES.some((p) => o.label.toLowerCase().includes(p)));
    }
    if (!match) return false;
    const target = match.el.closest('label') || match.el;
    target.click();
    return match.el.checked;
  }

  function clickCheckbox(field, shouldCheck) {
    if (field.el.checked === shouldCheck) return true;
    const target = field.el.closest('label') || field.el;
    target.click();
    return field.el.checked === shouldCheck;
  }

  // ── Resume file injection ────────────────────────────

  function base64ToBlob(base64, mime) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // File inputs are almost always visually hidden (styled via a wrapping
  // button/label) — unlike every other field type here, this deliberately
  // does NOT filter by visible(), only by attachment/disabled state.
  function tryFillResumeFile(pdfBase64) {
    if (!pdfBase64) return false;
    const fileInputs = Array.from(document.querySelectorAll('input[type=file]'))
      .filter((el) => el.isConnected && !el.disabled && !el.closest('#tailorcv-sidebar'));
    let target = fileInputs.find((el) => /resume|cv\b/i.test(nearestLabelText(el)));
    if (!target && fileInputs.length === 1) target = fileInputs[0];
    if (!target) return false;
    try {
      const blob = base64ToBlob(pdfBase64, 'application/pdf');
      const file = new File([blob], 'tailored_resume.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.files = dt.files;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      if (visible(target)) highlight(target);
      return true;
    } catch (e) {
      console.warn('[TailorCV] resume file inject failed:', e);
      return false;
    }
  }

  // ── Knock-out pre-scan ────────────────────────────────
  // Deterministic keyword check (no LLM agent reading the page here) for the
  // categories career-ops documents as most likely to auto-reject: visa
  // sponsorship and work authorization mismatches against the stored profile.

  const KNOCKOUT_PATTERNS = [
    { re: /sponsor/i, check: (p) => p.needs_sponsorship === true,
      warn: 'This form asks about visa sponsorship, and your profile says you need it — some employers auto-filter this.' },
    { re: /authoriz.{0,15}work|legally\s*(authorized|eligible)/i, check: (p) => p.work_authorized === false,
      warn: 'This form asks about work authorization, and your profile says you are not authorized — some employers auto-filter this.' },
  ];

  function knockoutWarnings(fields, profile) {
    const warnings = new Set();
    for (const f of fields) {
      for (const k of KNOCKOUT_PATTERNS) {
        if (k.re.test(f.label) && k.check(profile)) warnings.add(k.warn);
      }
    }
    return Array.from(warnings);
  }

  // ── Orchestration ────────────────────────────────────

  async function run(opts) {
    const { jdText, role, company, tailoredPdfBase64, profile, getApplyAnswers } = opts || {};
    const safeProfile = profile || {};
    ensureBannerStyles();

    if (captchaVisible()) await pauseForCaptcha();

    const fields = scanFields();
    const choiceGroups = scanChoiceGroups();

    const warnings = knockoutWarnings(fields, safeProfile);
    if (warnings.length) {
      const proceed = await new Promise((resolve) => {
        const banner = showBanner(`
          <div class="tcv-af-title">⚠️ Possible knock-out question${warnings.length > 1 ? 's' : ''}</div>
          <ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
          <button id="tcvAfProceed">Fill anyway</button>
          <button id="tcvAfCancel" class="tcv-af-secondary">Not now</button>
        `);
        banner.querySelector('#tcvAfProceed').addEventListener('click', () => resolve(true), { once: true });
        banner.querySelector('#tcvAfCancel').addEventListener('click', () => resolve(false), { once: true });
      });
      removeBanner();
      if (!proceed) return;
    }

    const resumeFilled = tryFillResumeFile(tailoredPdfBase64);

    let filledCount = 0;
    const unresolved = [];
    const skipped = [];

    for (const field of fields) {
      if (field.fieldType === 'file') continue; // handled above
      if (!field.label) { unresolved.push(field); continue; }

      let matched = false;

      for (const m of YES_NO_MATCHERS) {
        if (!m.re.test(field.label)) continue;
        matched = true;
        const text = boolToYesNo(m.get(safeProfile), field.options);
        if (text) {
          if (await fillField(field, text)) filledCount += 1;
          else skipped.push({ field, reason: 'could not be filled automatically' });
        } else {
          skipped.push({ field, reason: 'not set in your Application details' });
        }
        break;
      }
      if (matched) continue;

      for (const m of MATCHERS) {
        if (!m.re.test(field.label)) continue;
        matched = true;
        const value = m.get(safeProfile);
        if (value) {
          if (await fillField(field, value)) filledCount += 1;
          else skipped.push({ field, reason: 'could not be filled automatically' });
        } else {
          skipped.push({ field, reason: 'not set in your Application details' });
        }
        break;
      }
      if (matched) continue;

      unresolved.push(field);
    }

    if (captchaVisible()) await pauseForCaptcha();

    if (unresolved.length && typeof getApplyAnswers === 'function') {
      const questions = unresolved.map((f) => ({
        id: f.id,
        label: f.label || f.el.getAttribute('placeholder') || f.el.name || 'question',
        field_type: f.fieldType,
        options: f.options || undefined,
        limit: f.limit || undefined,
      }));
      let res;
      try {
        res = await getApplyAnswers({ jd_string: jdText, role, company, questions });
      } catch (e) {
        res = null;
      }
      const byId = new Map(((res && res.answers) || []).map((a) => [a.id, a]));
      for (const field of unresolved) {
        const ans = byId.get(field.id);
        if (!ans || ans.skip || !ans.answer) {
          skipped.push({ field, reason: 'needs your review' });
          continue;
        }
        if (await fillField(field, ans.answer)) filledCount += 1;
        else skipped.push({ field, reason: 'could not be filled automatically' });
      }
    } else {
      for (const field of unresolved) skipped.push({ field, reason: 'needs your review' });
    }

    if (captchaVisible()) await pauseForCaptcha();

    for (const s of skipped) highlight(s.field.el);

    const total = fields.filter((f) => f.fieldType !== 'file').length;
    showBanner(`
      <div class="tcv-af-title">✅ Filled ${filledCount} of ${total} fields</div>
      ${tailoredPdfBase64 && !resumeFilled ? '<div>Could not find a resume upload field — attach the tailored PDF yourself (it was also downloaded).</div>' : ''}
      ${skipped.length ? `<div>Review the highlighted field${skipped.length > 1 ? 's' : ''} before submitting:</div>
      <ul>${skipped.slice(0, 8).map((s) => `<li>${escapeHtml(s.field.label || 'a field')} — ${escapeHtml(s.reason)}</li>`).join('')}</ul>` : ''}
      ${choiceGroups.length ? `<div style="margin-top:6px;">${choiceGroups.length} checkbox/radio question${choiceGroups.length > 1 ? 's' : ''} left for you (never auto-checked).</div>` : ''}
      <div style="margin-top:8px;"><b>Review everything, then click Submit yourself.</b></div>
      <button id="tcvAfDismiss">Got it</button>
    `).querySelector('#tcvAfDismiss').addEventListener('click', removeBanner, { once: true });
  }

  // ── Click-through chain (LinkedIn Apply → destination ATS/company page) ──
  //
  // "Apply with Tailored Resume" is often clicked on a page that has no form
  // yet — a LinkedIn posting, or a company page with an interstitial "Apply
  // Now" splash before the real application. Since each hop is a fresh page
  // (a new tab, in LinkedIn's case), state can't live in memory — it's
  // handed off via chrome.storage.local and picked back up by tryResumeChain()
  // on whatever page loads next. Never runs anything inside linkedin.com
  // itself beyond a single click on its own Apply control; LinkedIn's Easy
  // Apply (an in-page multi-step form) is explicitly excluded.

  const CHAIN_KEY = 'tcv_apply_chain';
  const CHAIN_MAX_HOPS = 4;
  const CHAIN_TTL_MS = 3 * 60 * 1000;

  async function getChainSession() {
    const stored = await chrome.storage.local.get(CHAIN_KEY);
    const session = stored[CHAIN_KEY];
    if (!session) return null;
    if (Date.now() - session.startedAt > CHAIN_TTL_MS) {
      await chrome.storage.local.remove(CHAIN_KEY);
      return null;
    }
    return session;
  }

  function setChainSession(session) {
    return chrome.storage.local.set({ [CHAIN_KEY]: session });
  }

  function clearChainSession() {
    return chrome.storage.local.remove(CHAIN_KEY);
  }

  // Heuristic for "this page has a real application form, not just a splash
  // page" — a known ATS host is a strong enough signal on its own; otherwise
  // require either a resume-upload field or a handful of fillable fields.
  const KNOWN_ATS_HOST_RE = /(^|\.)(greenhouse\.io|job-boards\.greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|ashbyhq\.com)$/i;

  function looksLikeApplicationForm() {
    if (KNOWN_ATS_HOST_RE.test(location.hostname)) return true;
    const fileInputs = Array.from(document.querySelectorAll('input[type=file]'))
      .filter((el) => el.isConnected && !el.disabled);
    if (fileInputs.some((el) => /resume|cv\b/i.test(nearestLabelText(el)))) return true;
    return scanFields().length >= 3;
  }

  // Generic "Apply"-style control for click-through interstitials on any site.
  const APPLY_TEXT_RE = /^(apply( now)?|apply for this (job|position|role)|start (your )?application|continue to application|apply to this job|apply on company site)$/i;

  function findApplyControl() {
    for (const el of document.querySelectorAll('button, a[href]')) {
      if (!visible(el)) continue;
      if (el.closest('#tailorcv-sidebar') || el.closest('#tcv-af-banner')) continue;
      const text = (el.textContent || '').trim();
      if (APPLY_TEXT_RE.test(text)) return el;
    }
    return null;
  }

  // LinkedIn-specific: distinguishes Easy Apply (an in-page modal
  // runLinkedInEasyApply() drives directly) from an external Apply that
  // hands off to the real employer application. Prefers aria-label — LinkedIn
  // sets it to "Easy Apply to <job> at <company>"/"Apply to <job> at
  // <company>", which is more stable than the visible text (which can carry
  // extra whitespace or a nested icon's own accessible name). Prefix match
  // (not exact) so trailing text in either source doesn't cause a miss; the
  // job page's other buttons ("Save", "Share", ...) don't start with either
  // phrase, so this doesn't need to be an exact match to stay safe.
  function controlLabel(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return (aria || text).toLowerCase();
  }

  // The search-results page's "Easy Apply" filter pill (a role="radio" toggle,
  // id="searchFilter_applyWithLinkedin") has aria-label "Easy Apply filter." —
  // that also matches a naive /^easy apply/ text test, and it comes BEFORE the
  // real per-job Easy Apply button in DOM order, so it wins a plain textual
  // scan. It's a filter toggle, never an apply action, so exclude anything
  // that looks like one by role rather than by wording (wording alone isn't a
  // safe enough signal here).
  function isFilterOrToggleControl(el) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'radio' || role === 'checkbox' || role === 'switch') return true;
    if (el.hasAttribute('aria-checked')) return true;
    if (el.id && /^searchFilter/i.test(el.id)) return true;
    return false;
  }

  function findLinkedInApplyControl() {
    // LinkedIn ships a dedicated test hook on the real per-job Apply/Easy
    // Apply CTA (data-live-test-job-apply-button) — unambiguous in a way text
    // scanning across every <button> on the page isn't (that scan is also how
    // the search-results "Easy Apply" FILTER pill got clicked instead of the
    // real button — see isFilterOrToggleControl). Prefer it when present,
    // fall back to the text scan for any layout that doesn't carry it.
    const testHooked = document.querySelector('button[data-live-test-job-apply-button]');
    if (testHooked && visible(testHooked) && !isFilterOrToggleControl(testHooked)) {
      return { el: testHooked, easyApply: /^easy apply\b/.test(controlLabel(testHooked)) };
    }

    const buttons = document.querySelectorAll('button');
    for (const el of buttons) {
      if (!visible(el) || isFilterOrToggleControl(el)) continue;
      if (/^easy apply\b/.test(controlLabel(el))) return { el, easyApply: true };
    }
    for (const el of buttons) {
      if (!visible(el) || isFilterOrToggleControl(el)) continue;
      if (/^apply\b/.test(controlLabel(el))) return { el, easyApply: false };
    }
    return null;
  }

  function showSimpleBanner(title, body) {
    const banner = showBanner(`
      <div class="tcv-af-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(body)}</div>
      <button id="tcvAfDismiss">Got it</button>
    `);
    banner.querySelector('#tcvAfDismiss').addEventListener('click', removeBanner, { once: true });
  }

  // ── LinkedIn Easy Apply ───────────────────────────────
  // A multi-step in-page modal (contact info → resume → questions → review →
  // submit), each step gated on its own required fields before LinkedIn will
  // even render the next one. Unlike run() above, this fills radios/checkboxes
  // (see clickRadioOption/clickCheckbox) and DOES click the final "Submit
  // application" button — a deliberate, narrower exception to the "never
  // submit" rule, scoped to this one flow. If a required question can't be
  // confidently answered, the loop pauses on that step and highlights it
  // rather than guessing (see pauseForReview) — it does not skip to Submit
  // with an unanswered required field.

  // A pause (needs-your-input or a LinkedIn validation error) re-scans the
  // same visual step via `continue`, which still consumes a loop slot without
  // actually advancing — so this needs headroom beyond the real step count
  // for a flow with a couple of pauses in it, not just one-slot-per-step.
  const EASY_APPLY_MAX_STEPS = 20;

  // Temporary while this flow is still being verified against LinkedIn's live
  // DOM (which can't be tested outside a real browser session) — lets a
  // failure be diagnosed from the console instead of guessing blind.
  function easyApplyLog(...args) {
    console.log('[TailorCV EasyApply]', ...args);
  }

  function easyApplyModal() {
    const candidates = document.querySelectorAll(
      '.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], .artdeco-modal--layer-default[role="dialog"]'
    );
    for (const el of candidates) if (visible(el)) return el;
    return null;
  }

  async function waitForEasyApplyModal(timeoutMs = 10000) {
    const start = Date.now();
    let attempts = 0;
    while (Date.now() - start < timeoutMs) {
      attempts += 1;
      const modal = easyApplyModal();
      if (modal) {
        easyApplyLog('modal found after', Date.now() - start, 'ms,', attempts, 'polls');
        return modal;
      }
      await sleep(200);
    }
    easyApplyLog('modal NOT found within', timeoutMs, 'ms —',
      'raw candidate count right now:', document.querySelectorAll('.artdeco-modal, [role="dialog"]').length);
    return null;
  }

  // The advancing button's text/aria-label changes per step ("Next" mid-flow,
  // "Review"/"Review your application" on the second-to-last, "Submit
  // application" on the last) — exact-match only, since the same footer also
  // has "Back", "Save", and "Discard" buttons a looser match could catch.
  const EASY_APPLY_ADVANCE_RE = /^(next|review|review your application|continue to next step)$/i;
  const EASY_APPLY_SUBMIT_RE = /^submit application$/i;

  function findEasyApplyAdvanceButton(modal) {
    // LinkedIn ships dedicated test hooks on these footer buttons — confirmed
    // data-live-test-easy-apply-review-button on a real Review button that
    // had NO aria-label at all (its name comes only from a nested <span>,
    // which is exactly the kind of structure a pure text/aria scan can miss).
    // "next"/"submit" siblings are inferred from the same naming convention,
    // not independently confirmed, so this is tried first but the text scan
    // below still runs as a fallback if no attribute matches.
    const hooked = Array.from(modal.querySelectorAll('button'))
      .filter((el) => visible(el) && !el.disabled)
      .map((el) => ({ el, attr: Array.from(el.attributes).find((a) => /^data-live-test-easy-apply-.*-button$/.test(a.name)) }))
      .find((x) => x.attr);
    if (hooked) return { el: hooked.el, submit: /submit/i.test(hooked.attr.name) };

    const buttons = modal.querySelectorAll('button');
    for (const el of buttons) {
      if (!visible(el) || el.disabled) continue;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (EASY_APPLY_SUBMIT_RE.test(label)) return { el, submit: true };
    }
    for (const el of buttons) {
      if (!visible(el) || el.disabled) continue;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (EASY_APPLY_ADVANCE_RE.test(label)) return { el, submit: false };
    }
    return null;
  }

  function easyApplyErrorText(modal) {
    const err = modal.querySelector('[role="alert"], .artdeco-inline-feedback--error');
    if (err && visible(err)) return (err.innerText || err.textContent || '').trim();
    return '';
  }

  function dismissEasyApplySuccessModal() {
    const dismiss = document.querySelector(
      '.artdeco-modal button[aria-label="Dismiss"], .artdeco-modal button[aria-label="Done"]'
    );
    if (dismiss && visible(dismiss)) dismiss.click();
  }

  // LinkedIn frequently pre-fills contact fields (phone, country code, ...)
  // from the user's own LinkedIn profile before our script ever touches the
  // step — that's an already-correct answer, not a gap. Skip anything that's
  // already answered instead of overwriting it or flagging it for review.
  function looksLikePlaceholderOption(text) {
    return !text || /^(select|choose|please select|--|select an option)/i.test(text.trim());
  }

  function fieldAlreadyAnswered(field) {
    if (field.fieldType === 'select') {
      const opt = field.el.selectedOptions && field.el.selectedOptions[0];
      return !!(field.el.value && opt && !looksLikePlaceholderOption(opt.textContent));
    }
    return !!(field.el.value && String(field.el.value).trim());
  }

  function radioGroupAlreadyAnswered(group) {
    return group.radios.some((r) => r.el.checked);
  }

  // Fills one visible step of the modal: deterministic profile matches first
  // (reusing the same MATCHERS/YES_NO_MATCHERS as run()), then a single
  // batched AI call for whatever's left, exactly like run()'s unresolved-field
  // pass. Required consent checkboxes are checked outright — LinkedIn Easy
  // Apply's required checkboxes are near-universally "I have read/understood
  // the above" boilerplate, not a factual claim an AI needs to ground, so
  // sending them to the AI would just cost a round trip for a guaranteed skip.
  function countScannableCandidates(root) {
    return scanFields(root, { skipChoices: true }).length + scanRadioGroups(root).length + scanCheckboxes(root).length;
  }

  async function fillEasyApplyStep(root, opts) {
    const { profile, jdText, role, company, getApplyAnswers } = opts;
    const textFields = scanFields(root, { skipChoices: true }).filter((f) => !fieldAlreadyAnswered(f));
    const radioGroups = scanRadioGroups(root).filter((g) => !radioGroupAlreadyAnswered(g));
    const checkboxes = scanCheckboxes(root);

    let filledCount = 0;
    const needsReview = [];

    for (const field of textFields) {
      if (!field.label) { if (field.required) needsReview.push(field); continue; }
      let matched = false;
      for (const m of YES_NO_MATCHERS) {
        if (!m.re.test(field.label)) continue;
        matched = true;
        const text = boolToYesNo(m.get(profile), field.options);
        if (text && await fillField(field, text)) filledCount += 1;
        else if (field.required) needsReview.push(field);
        break;
      }
      if (matched) continue;
      for (const m of MATCHERS) {
        if (!m.re.test(field.label)) continue;
        matched = true;
        const value = m.get(profile);
        if (value && await fillField(field, value)) filledCount += 1;
        else if (field.required) needsReview.push(field);
        break;
      }
      if (!matched) field._unresolved = true;
    }

    for (const group of radioGroups) {
      let matched = false;
      for (const m of YES_NO_MATCHERS) {
        if (!m.re.test(group.label)) continue;
        matched = true;
        const text = boolToYesNo(m.get(profile), group.options);
        if (text && clickRadioOption(group, text)) filledCount += 1;
        else if (group.required) needsReview.push(group);
        break;
      }
      if (matched) continue;
      // String-valued profile fields (EEO questions especially — gender,
      // ethnicity, veteran/disability status — are near-universally rendered
      // as radio groups rather than selects on real ATS forms) need the same
      // MATCHERS pass the text-field loop above already gets, just filled via
      // clickRadioOption()'s fuzzy option match instead of fillField().
      for (const m of MATCHERS) {
        if (!m.re.test(group.label)) continue;
        matched = true;
        const value = m.get(profile);
        if (value && clickRadioOption(group, value)) filledCount += 1;
        else if (group.required) needsReview.push(group);
        break;
      }
      if (!matched) group._unresolved = true;
    }

    for (const box of checkboxes) {
      if (!box.required) continue;
      if (clickCheckbox(box, true)) filledCount += 1;
      else needsReview.push(box);
    }

    const unresolvedText = textFields.filter((f) => f._unresolved && f.label);
    const unresolvedRadios = radioGroups.filter((g) => g._unresolved && g.label);

    if ((unresolvedText.length || unresolvedRadios.length) && typeof getApplyAnswers === 'function') {
      const questions = [
        ...unresolvedText.map((f) => ({ id: f.id, label: f.label, field_type: f.fieldType, options: f.options || undefined, limit: f.limit || undefined })),
        ...unresolvedRadios.map((g) => ({ id: g.id, label: g.label, field_type: 'radio', options: g.options })),
      ];
      let res;
      try { res = await getApplyAnswers({ jd_string: jdText, role, company, questions }); } catch (e) { res = null; }
      const byId = new Map(((res && res.answers) || []).map((a) => [a.id, a]));

      for (const f of unresolvedText) {
        const ans = byId.get(f.id);
        if (ans && !ans.skip && ans.answer && await fillField(f, ans.answer)) filledCount += 1;
        else if (f.required) needsReview.push(f);
      }
      for (const g of unresolvedRadios) {
        const ans = byId.get(g.id);
        if (ans && !ans.skip && ans.answer && clickRadioOption(g, ans.answer)) filledCount += 1;
        else if (g.required) needsReview.push(g);
      }
    } else {
      for (const f of unresolvedText) if (f.required) needsReview.push(f);
      for (const g of unresolvedRadios) if (g.required) needsReview.push(g);
    }

    return { filledCount, needsReview };
  }

  async function pauseForReview(items) {
    for (const item of items) highlight(item.el || (item.radios && item.radios[0] && item.radios[0].el));
    const labels = items.map((i) => i.label || 'a question').slice(0, 6);
    const banner = showBanner(`
      <div class="tcv-af-title">✋ Needs your input</div>
      <div>TailorCV couldn't confidently answer the highlighted required question${items.length > 1 ? 's' : ''} on this step.</div>
      <ul>${labels.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
      <div>Answer them, then click Resume to let TailorCV continue.</div>
      <button id="tcvAfEasyApplyResume">Resume</button>
    `);
    await new Promise((resolve) => {
      banner.querySelector('#tcvAfEasyApplyResume').addEventListener('click', resolve, { once: true });
    });
    removeBanner();
  }

  async function runLinkedInEasyApply(opts, easyApplyBtnEl) {
    ensureBannerStyles();
    showSimpleBanner('Opening Easy Apply…', 'TailorCV will fill each step automatically.');
    easyApplyLog('clicking Easy Apply button — label:', controlLabel(easyApplyBtnEl), '| connected:', easyApplyBtnEl.isConnected);
    easyApplyBtnEl.click();

    const modal = await waitForEasyApplyModal();
    if (!modal) {
      showSimpleBanner('Couldn’t open Easy Apply', 'Please open it and apply manually.');
      return;
    }

    let totalFilled = 0;
    for (let step = 0; step < EASY_APPLY_MAX_STEPS; step++) {
      easyApplyLog('step', step, 'start');
      if (captchaVisible()) await pauseForCaptcha();

      const currentModal = easyApplyModal();
      if (!currentModal) {
        easyApplyLog('modal gone at start of step', step, '— stopping');
        return;
      }

      tryFillResumeFile(opts.tailoredPdfBase64);

      // A step can scan as empty for two very different reasons: it
      // genuinely has no fields (e.g. the resume-picker step, which uses
      // custom controls this scan doesn't look at), or LinkedIn just hasn't
      // finished mounting this step's form yet — the same SPA-timing race the
      // advance-button poll below exists for. A scan that runs too early
      // can't tell the difference, so it silently treats a not-yet-rendered
      // required field as "nothing to do" and walks straight to Review,
      // which is exactly what happened to the CTC/notice-period fields
      // before this retry existed — LinkedIn's own validation caught it
      // after the fact instead of this scan catching it before.
      let scanModal = currentModal;
      for (let attempt = 0; attempt < 3 && countScannableCandidates(scanModal) === 0; attempt++) {
        await sleep(500);
        scanModal = easyApplyModal() || scanModal;
      }

      const { filledCount, needsReview } = await fillEasyApplyStep(scanModal, opts);
      totalFilled += filledCount;
      easyApplyLog('step', step, 'filled', filledCount, 'needsReview:', needsReview.map((i) => `"${i.label}"(required=${i.required})`).join(' | ') || '(none)');

      if (needsReview.length) {
        await pauseForReview(needsReview);
        continue; // re-scan this same step now that the user has filled it in
      }

      // findEasyApplyAdvanceButton() only ever returns an ENABLED button (it
      // skips disabled ones outright) — so a single check right after landing
      // on a step can race LinkedIn's own async validation (e.g. "a resume is
      // selected, now enable Next"), which can take a beat longer than the
      // fixed 700ms sleep below. Poll briefly instead of giving up on one miss.
      let control = findEasyApplyAdvanceButton(currentModal);
      const advanceWaitStart = Date.now();
      while (!control && Date.now() - advanceWaitStart < 4000) {
        await sleep(300);
        control = findEasyApplyAdvanceButton(easyApplyModal() || currentModal);
      }
      if (!control) {
        const liveModal = easyApplyModal() || currentModal;
        easyApplyLog('step', step, 'no advance button found — modal buttons were:',
          Array.from(liveModal.querySelectorAll('button'))
            .map((b) => `"${(b.getAttribute('aria-label') || b.textContent.trim())}"(visible=${visible(b)},disabled=${b.disabled})`)
            .join(' | '));
        showSimpleBanner('Stuck on an Easy Apply step', 'TailorCV filled what it could — please finish this step manually.');
        return;
      }

      easyApplyLog('step', step, 'clicking', control.submit ? 'Submit application' : 'advance button');
      control.el.click();
      await sleep(700); // let the SPA render the next step before the loop re-scans

      const afterModal = easyApplyModal();
      const errText = afterModal ? easyApplyErrorText(afterModal) : '';
      if (errText) {
        // LinkedIn's own validation caught something our scan missed — pause
        // and let the user fix it in place, then re-scan the same step,
        // rather than dead-ending the run here. The scan-retry above should
        // make this rare now, but it's the same safety net either way: never
        // guess an answer just to get past a rejected step.
        easyApplyLog('step', step, 'LinkedIn validation error:', errText);
        await pauseForReview([{ label: errText }]);
        continue;
      }

      if (control.submit) {
        await sleep(1200); // let LinkedIn's "Application sent" confirmation render
        dismissEasyApplySuccessModal();
        showSimpleBanner('✅ Applied via Easy Apply', `Filled ${totalFilled} field${totalFilled === 1 ? '' : 's'} and submitted your application.`);
        return;
      }
    }

    easyApplyLog('hit EASY_APPLY_MAX_STEPS without finishing');
    showSimpleBanner('Couldn’t finish Easy Apply automatically', 'TailorCV filled what it could — please finish and submit manually.');
  }

  // Entry point for "Apply with Tailored Resume": fills the current page
  // immediately if it's already the real form (today's single-page
  // behavior, unchanged); otherwise clicks through to find it.
  async function startChain(opts) {
    const { isLinkedIn } = opts || {};

    if (looksLikeApplicationForm()) {
      return run(opts);
    }

    if (isLinkedIn) {
      const found = findLinkedInApplyControl();
      if (!found) {
        showSimpleBanner('Couldn’t find an Apply button', 'Click it yourself, then use "Apply with Tailored Resume" again on the application page.');
        return;
      }
      if (found.easyApply) {
        return runLinkedInEasyApply(opts, found.el);
      }
      await setChainSession({ ...opts, hops: 0, startedAt: Date.now() });
      showSimpleBanner('Opening the application…', 'TailorCV will keep going once it loads.');
      found.el.click();
      return;
    }

    const control = findApplyControl();
    if (!control) {
      showSimpleBanner('Couldn’t find the application form', 'Navigate to it yourself, then click "Apply with Tailored Resume" again.');
      return;
    }
    await setChainSession({ ...opts, hops: 0, startedAt: Date.now() });
    showSimpleBanner('Continuing to the application…', 'TailorCV will keep going once it loads.');
    control.click();
  }

  // Called unconditionally on every page load. A no-op unless a chain is
  // actually pending — cheap enough to always check.
  async function tryResumeChain(getApplyAnswers) {
    if (/(^|\.)linkedin\.com$/i.test(location.hostname)) return false; // never auto-act back on LinkedIn itself

    const session = await getChainSession();
    if (!session) return false;

    if (looksLikeApplicationForm()) {
      await clearChainSession();
      await run({ ...session, getApplyAnswers });
      return true;
    }

    if (session.hops >= CHAIN_MAX_HOPS) {
      await clearChainSession();
      showSimpleBanner('Couldn’t reach the application form automatically', 'Please continue manually — your tailored resume was already downloaded.');
      return true;
    }

    let control = findApplyControl();
    if (!control) {
      await sleep(1500); // give an SPA a moment to hydrate before giving up on this hop
      control = findApplyControl();
    }
    if (!control) {
      await clearChainSession();
      showSimpleBanner('Couldn’t reach the application form automatically', 'Please continue manually — your tailored resume was already downloaded.');
      return true;
    }

    await setChainSession({ ...session, hops: session.hops + 1 });
    control.click();
    return true;
  }

  // Lets content.js tell Easy Apply (stays on linkedin.com, no extra host
  // permission needed) apart from an external Apply (hops to an unknown ATS
  // host, which does need it) BEFORE deciding whether to gate on that
  // permission — see requestBroadPermission() in content.js.
  function linkedInApplyKind() {
    const found = findLinkedInApplyControl();
    if (!found) return null;
    return found.easyApply ? 'easy' : 'external';
  }

  window.__tcvAutofill = { run, startChain, tryResumeChain, looksLikeApplicationForm, linkedInApplyKind };
})();
