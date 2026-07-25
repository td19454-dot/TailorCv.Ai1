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
// Deliberately never runs on linkedin.com — see manifest.json's content_script
// matches; this file only ever executes on the ATS/company-page side.
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

  function scanFields() {
    const fields = [];
    for (const el of document.querySelectorAll(FIELD_SELECTOR)) {
      if (!visible(el)) continue;
      if (el.closest('#tailorcv-sidebar') || el.closest('#tcv-af-banner')) continue;
      if (el.disabled || el.readOnly) continue;

      const fieldType = classifyType(el);
      const label = nearestLabelText(el).replace(/\s+/g, ' ').trim().slice(0, 300);
      const required = el.required || el.getAttribute('aria-required') === 'true';
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
    { re: /(desired|expected)\s*salary|salary\s*expect/i, get: (p) => p.desired_salary },
    { re: /university|college|\bschool\b/i, get: (p) => firstEdu(p, 'school') },
    { re: /degree/i, get: (p) => firstEdu(p, 'degree') },
    { re: /field\s*of\s*study|major/i, get: (p) => firstEdu(p, 'field_of_study') },
    { re: /gpa/i, get: (p) => firstEdu(p, 'gpa') },
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

  // LinkedIn-specific: distinguishes Easy Apply (an in-page modal this
  // feature never touches) from an external Apply that hands off to the
  // real employer application. Exact-text matches only — LinkedIn's job page
  // has many other buttons ("Save", "Share", ...) that a looser regex could
  // misfire on.
  function findLinkedInApplyControl() {
    const buttons = document.querySelectorAll('button');
    for (const el of buttons) {
      if (!visible(el)) continue;
      if (/^easy apply$/i.test((el.textContent || '').trim())) return { el, easyApply: true };
    }
    for (const el of buttons) {
      if (!visible(el)) continue;
      if (/^apply$/i.test((el.textContent || '').trim())) return { el, easyApply: false };
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
        showSimpleBanner('This posting uses LinkedIn Easy Apply', 'That in-page flow isn’t automated — please complete it manually.');
        return;
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

  window.__tcvAutofill = { run, startChain, tryResumeChain, looksLikeApplicationForm };
})();
