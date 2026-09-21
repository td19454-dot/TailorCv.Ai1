// Finding the application form and describing its fields. Deterministic: no
// LLM is involved in deciding what is on the page.
//
// This deliberately replaces the server engine's observe() call rather than
// porting it. observe() is an LLM page-read, and it is not exhaustive: the same
// Greenhouse page returned 22, 19 and 18 candidates on three consecutive runs
// (see the comment at auto_apply/runner.py:794). That non-determinism is why
// the server needs _MAX_FILL_SWEEPS = 3, and it is how a final "Do you consent
// to receive marketing?" question went unanswered — it was never surfaced, so
// it appeared in neither the filled list nor the missing list. A DOM query
// returns the same set every time, which makes one pass sufficient and makes
// "we saw N fields" an honest number.

import { questionSignature, documentSlotFor } from './match.js';
import { TIMING } from './timing.js';

const probe = () => globalThis.__tcvFieldProbe;

// ── visibility ───────────────────────────────────────────────

/**
 * Whether a field is really on screen for the user.
 *
 * Checked on the WRAPPER, not the control: react-select's inner input and
 * Greenhouse's file input are legitimately zero-size or display:none while the
 * field itself is plainly visible (which is the same reason the server engine
 * discriminates file inputs by attribute rather than by observing them).
 *
 * Fails OPEN. Where no layout information is available at all — a detached
 * node, a zero-size document, jsdom — this returns true. Dropping a field we
 * could not measure would silently shrink the form; including one that turns
 * out to be hidden costs at most a wasted write that verification then reports.
 */
export function isVisible(el) {
  if (!el) return false;
  const p = probe();
  const node = (p && p.fieldWrapper(el)) || el;

  if (el.disabled === true) return false;
  if (el.readOnly === true && (el.tagName || '').toLowerCase() !== 'select') return false;
  const type = (el.getAttribute && (el.getAttribute('type') || '').toLowerCase()) || '';
  if (type === 'hidden') return false;
  // A file input is a field even when the site hides it behind an Attach
  // button, so it skips every geometric test below.
  if (type === 'file') return !inAriaHidden(node);
  if (inAriaHidden(node)) return false;

  if (hiddenByStyle(node)) return false;

  if (typeof node.getBoundingClientRect === 'function') {
    const r = node.getBoundingClientRect();
    // All-zero is what a detached node and jsdom both report, and is not
    // evidence of being hidden — see "fails open" above.
    const measured = r && (r.width || r.height || r.top || r.left);
    if (measured && r.width < 2 && r.height < 2) return false;
  }
  return true;
}

/**
 * Whether this node or any ancestor is styled out of existence.
 *
 * The ancestor walk is the point. `display` is not an inherited property, so
 * getComputedStyle(child).display on the child of a display:none parent
 * reports the child's OWN display ("block", "inline-block") in every engine —
 * it does not report "none". Checking only the node itself therefore misses
 * the single most common way a form hides a field (a collapsed step, an
 * inactive tab, a closed accordion), and those fields would be offered to the
 * user as though they were on screen.
 *
 * offsetParent === null and getClientRects().length === 0 are the usual
 * shortcuts, but both are layout reads, and layout is exactly what is
 * unavailable where these tests run — so this walks the cascade explicitly and
 * works with or without a layout engine.
 */
function hiddenByStyle(node) {
  const win = node.ownerDocument && node.ownerDocument.defaultView;
  if (!win || typeof win.getComputedStyle !== 'function') return false;
  let n = node, depth = 0;
  while (n && n.nodeType === 1 && depth < 25) {
    let cs = null;
    try { cs = win.getComputedStyle(n); } catch (e) { cs = null; }
    if (cs) {
      if (cs.display === 'none') return true;
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
      if (cs.opacity !== '' && cs.opacity != null && parseFloat(cs.opacity) === 0) return true;
    }
    n = n.parentElement;
    depth++;
  }
  return false;
}

function inAriaHidden(node) {
  let n = node, depth = 0;
  while (n && n.nodeType === 1 && depth < 25) {
    if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true;
    if (n.hidden === true) return true;
    n = n.parentElement; depth++;
  }
  return false;
}

// ── form root ────────────────────────────────────────────────

const APP_ROOT_SELECTORS = [
  'form',
  '[role="form"]',
  '[class*="application" i]',
  '[id*="application" i]',
  // Workday. There is no <form> element on a Workday application at all; every
  // step renders inside applyFlowPage. (An earlier version listed
  // "jobApplication" here — an invented id that matched nothing real.)
  '[data-automation-id="applyFlowPage"]',
  '[data-automation-id*="applyFlow" i]',
  '[data-ui="application-form"]',      // Ashby
  '#application-form',                 // Greenhouse classic
  '.application--form',                // Lever
];

const SEARCHY = /search|filter|newsletter|subscribe|login|sign ?in|sign ?up|cookie|consent ?banner/i;

/** Is this container a search/filter/login box rather than an application? */
function looksLikeNotAnApplication(el) {
  if (!el) return true;
  try {
    if (el.matches('[role="search"]')) return true;
    if (el.querySelector('input[type="search"]')) return true;
    if (el.querySelector('input[type="password"]')) return true;   // a login form
    const action = (el.getAttribute && el.getAttribute('action')) || '';
    const id = (el.getAttribute && (el.getAttribute('id') || '')) || '';
    const cls = (el.className && String(el.className)) || '';
    if (SEARCHY.test(action) || SEARCHY.test(id) || SEARCHY.test(cls)) return true;
  } catch (e) { /* treat an unqueryable node as unusable */ }
  return false;
}

function scoreRoot(el, doc) {
  const p = probe();
  if (!p) return null;
  if (looksLikeNotAnApplication(el)) return null;
  if (el.closest && el.closest('#tailorcv-sidebar')) return null;

  const { elements, opaqueHosts } = p.fillableIn(el);
  const visible = elements.filter(isVisible);
  if (visible.length < 2) return null;

  let score = visible.length;
  const has = sel => { try { return !!el.querySelector(sel); } catch (e) { return false; } };
  if (has('input[type="email"]') || has('input[type="tel"]')) score += 3;
  if (has('input[type="file"]')) score += 3;
  if (has('button[type="submit"], input[type="submit"]')) score += 2;
  // A <form> is a stronger signal than a div that happens to contain inputs.
  if ((el.tagName || '').toLowerCase() === 'form') score += 2;
  // A container an ATS names as its application flow is stronger still — and on
  // Workday it is the ONLY signal, since there is no <form> to score.
  const automation = (el.getAttribute && el.getAttribute('data-automation-id')) || '';
  if (/applyFlow/i.test(automation)) score += 4;
  void doc;
  return { root: el, score, fields: visible, opaqueHosts };
}

const APPLY_URL_RE = new RegExp([
  /\/apply(\/|$|\?)/.source,
  /\/application(s)?(\/|$|\?)/.source,
  /jobs\.lever\.co\/[^/]+\/[^/]+\/apply/.source,
  /(job-boards|boards)\.greenhouse\.io\/[^/]+\/jobs\//.source,
  /greenhouse\.io\/embed\/job_app/.source,
  /myworkdayjobs\.com\/.*\/job\//.source,
  /\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{8,}/.source,
  /smartrecruiters\.com\/.*\/.*\/?(apply)?/.source,
  /workable\.com\/j\//.source,
  /icims\.com\/jobs\//.source,
  /jobvite\.com\/.*\/job\//.source,
  /bamboohr\.com\/(careers|jobs)\//.source,
]. join('|'), 'i');

/** Which ATS we appear to be on, for telemetry and per-site quirks. */
export function detectAts(url) {
  const u = String(url || '').toLowerCase();
  if (/greenhouse\.io/.test(u)) return 'greenhouse';
  if (/lever\.co/.test(u)) return 'lever';
  if (/ashbyhq\.com/.test(u)) return 'ashby';
  if (/myworkdayjobs\.com|myworkdaysite\.com/.test(u)) return 'workday';
  if (/smartrecruiters\.com/.test(u)) return 'smartrecruiters';
  if (/workable\.com/.test(u)) return 'workable';
  if (/icims\.com/.test(u)) return 'icims';
  if (/jobvite\.com/.test(u)) return 'jobvite';
  if (/bamboohr\.com/.test(u)) return 'bamboohr';
  if (/taleo\.net/.test(u)) return 'taleo';
  if (/successfactors\.(com|eu)/.test(u)) return 'successfactors';
  return 'generic';
}

const MIN_CONFIDENT_SCORE = 6;

/**
 * The application form on this page, or null.
 *
 * `{ root, score, fields, opaqueHosts, ats, isForm }`. Cheap enough (one
 * querySelectorAll per candidate) to call on every sidebar render.
 */
export function findForm(doc) {
  const d = doc || globalThis.document;
  if (!d || !probe()) return null;

  const seen = new Set();
  const scored = [];
  for (const sel of APP_ROOT_SELECTORS) {
    let nodes = [];
    try { nodes = Array.prototype.slice.call(d.querySelectorAll(sel)); } catch (e) { continue; }
    for (const node of nodes) {
      if (seen.has(node)) continue;
      seen.add(node);
      const s = scoreRoot(node, d);
      if (s) scored.push(s);
    }
  }

  // Nothing convincing declared itself. Fall back to the smallest element that
  // contains every visible fillable control on the page — a careers page that
  // renders its form into bare divs still has one. Run not only when nothing
  // scored but also when everything that did is tiny: otherwise a stray
  // two-field box in a page header wins by default and the real form, which
  // matched no selector, is never considered.
  if (!scored.length || scored.every(s => s.fields.length < 3)) {
    const all = probe().fillableIn(d).elements.filter(isVisible);
    if (all.length >= 2) {
      const root = commonAncestor(all);
      const s = root && scoreRoot(root, d);
      if (s) scored.push(s);
    }
  }
  if (!scored.length) return null;

  // Prefer the highest score; on a tie prefer the TIGHTEST root, so a <form>
  // inside a page wrapper wins over the wrapper.
  scored.sort((a, b) => (b.score - a.score) || (a.fields.length - b.fields.length));
  const best = scored[0];
  const url = (d.defaultView && d.defaultView.location && d.defaultView.location.href) || '';
  return {
    root: best.root,
    score: best.score,
    fields: best.fields,
    opaqueHosts: best.opaqueHosts,
    ats: detectAts(url),
    url,
    isForm: best.score >= MIN_CONFIDENT_SCORE || APPLY_URL_RE.test(url),
  };
}

function commonAncestor(els) {
  let node = els[0];
  for (let i = 1; i < els.length; i++) {
    node = pairAncestor(node, els[i]);
    if (!node) return null;
  }
  // Never return <body>/<html> as a form root: scoring it would sweep in the
  // page nav and the sidebar's own controls.
  while (node && ['body', 'html'].includes((node.tagName || '').toLowerCase())) {
    return node;   // caller's scoreRoot will reject it on the searchy/size tests
  }
  return node;
}

function pairAncestor(a, b) {
  if (!a || !b) return null;
  if (a === b) return a;
  if (a.contains && a.contains(b)) return a;
  if (b.contains && b.contains(a)) return b;
  let n = a.parentElement;
  while (n) {
    if (n.contains(b)) return n;
    n = n.parentElement;
  }
  return null;
}

/** Whether a URL has the shape of an application page. */
export function looksLikeApplyUrl(url) {
  return APPLY_URL_RE.test(String(url || ''));
}

/**
 * Everything detection saw on this page, for the console.
 *
 * Built for the case where autofill does not appear and nobody can see why. The
 * point is to print the page's own markup back — which candidate containers
 * scored what, why each rejected one was rejected, and which interactive-looking
 * controls no part of discovery handles — so an unsupported ATS widget becomes a
 * visible, specific gap rather than a mystery.
 */
export function diagnose(doc) {
  const d = doc || globalThis.document;
  const p = probe();
  const report = { summary: {}, roots: [], fields: [], uncovered: [] };
  if (!p) { report.summary.error = 'field probe not installed'; return report; }

  const seen = new Set();
  for (const sel of APP_ROOT_SELECTORS) {
    let nodes = [];
    try { nodes = Array.prototype.slice.call(d.querySelectorAll(sel)); } catch (e) { continue; }
    for (const node of nodes.slice(0, 12)) {
      if (seen.has(node)) continue;
      seen.add(node);
      const all = p.fillableIn(node).elements;
      const scored = scoreRoot(node, d);
      report.roots.push({
        selector: sel,
        node: describeNode(node),
        fillable: all.length,
        visible: all.filter(isVisible).length,
        score: scored ? scored.score : null,
        rejected: scored ? '' : rootRejection(node, all),
      });
    }
  }

  const form = findForm(d);
  if (form) {
    for (const row of describeFields(form)) {
      report.fields.push({
        label: String(row.label || '').slice(0, 60), kind: row.kind, key: row.key,
        filled: row.filled, required: row.required, readable: row.readable,
      });
    }
  }

  // Interactive-looking controls discovery does not select at all.
  const covered = new Set(form ? form.fields : []);
  let candidates = [];
  try {
    candidates = Array.prototype.slice.call(d.querySelectorAll(
      '[aria-haspopup], [role="listbox"], [role="spinbutton"], [role="radio"], '
      + '[role="checkbox"], [role="switch"], [role="textbox"], [data-automation-id]'));
  } catch (e) { candidates = []; }
  for (const el of candidates) {
    if (covered.has(el) || (el.closest && el.closest('#tailorcv-sidebar'))) continue;
    if (el.matches && el.matches(p.FILLABLE_SEL)) continue;
    const role = el.getAttribute('role') || '';
    const automation = el.getAttribute('data-automation-id') || '';
    // Only report data-automation-id nodes that look like inputs.
    if (!role && !el.getAttribute('aria-haspopup')
        && !/input|select|dropdown|radio|checkbox|date|prompt|textbox/i.test(automation)) continue;
    report.uncovered.push({ node: describeNode(el), role, automation,
                            text: clean(el.textContent).slice(0, 40) });
    if (report.uncovered.length >= 40) break;
  }

  report.summary = {
    url: (d.defaultView && d.defaultView.location && d.defaultView.location.href) || '',
    applyShapedUrl: looksLikeApplyUrl(d.defaultView && d.defaultView.location
                                      && d.defaultView.location.href),
    formFound: !!form,
    isForm: !!(form && form.isForm),
    root: form ? describeNode(form.root) : null,
    fieldCount: form ? form.fields.length : 0,
    totalFillableOnPage: p.fillableIn(d).elements.length,
    opaqueHosts: form ? form.opaqueHosts : 0,
  };
  return report;
}

function rootRejection(node, fillable) {
  if (node.closest && node.closest('#tailorcv-sidebar')) return 'inside the TailorCV panel';
  try {
    if (node.matches('[role="search"]')) return 'role=search';
    if (node.querySelector('input[type="search"]')) return 'contains a search input';
    if (node.querySelector('input[type="password"]')) return 'contains a password field';
  } catch (e) { /* ignore */ }
  const text = `${node.getAttribute('action') || ''} ${node.id || ''} ${node.className || ''}`;
  if (SEARCHY.test(text)) return `id/class/action looks like search/login: ${text.trim().slice(0, 60)}`;
  const visible = fillable.filter(isVisible).length;
  if (visible < 2) return `only ${visible} visible field(s)`;
  return 'unknown';
}

function describeNode(el) {
  if (!el || !el.tagName) return '';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const automation = el.getAttribute && el.getAttribute('data-automation-id');
  const cls = typeof el.className === 'string' && el.className
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
  return `${tag}${id}${automation ? `[data-automation-id=${automation}]` : ''}${cls}`.slice(0, 120);
}

/** The cheap public predicate content.js calls on every render. */
export function isApplicationPage(doc) {
  const form = findForm(doc);
  return form && form.isForm ? form : null;
}

// ── field descriptors ────────────────────────────────────────

/**
 * Describe every field in `form`, collapsing radio/checkbox groups and
 * assigning each a key that survives a re-render.
 *
 * The key is questionSignature(ident), exactly the server engine's registry
 * key: ident comes from name || label || id, so a react-select id carrying a
 * render-order counter cannot change it. Duplicate keys on one page are
 * suffixed by document order rather than merged — two fields that genuinely
 * ask the same thing (a second "Company" row in a work-history repeater) are
 * different fields.
 */
export function describeFields(form) {
  const p = probe();
  if (!p || !form) return [];

  const out = [];
  const groupKeys = new Map();   // logical identity -> index in `out`
  const keyCounts = new Map();
  const dateGroups = new Map();  // date wrapper -> its row

  for (const el of form.fields) {
    // Workday dates: three spinbutton inputs (month, day, year) that are one
    // question. Described individually they come out as three fields labelled
    // "Month", "Day" and "Year", none of which matches anything the user has
    // on file — so the date is never filled, and three noise rows appear.
    const dateWrap = dateWrapperOf(el);
    if (dateWrap) {
      const existing = dateGroups.get(dateWrap);
      if (existing) { existing.members.push(el); continue; }
      const row = dateRow(dateWrap, el, p, keyCounts);
      dateGroups.set(dateWrap, row);
      out.push(row);
      continue;
    }

    const d = p.describeEl(el);
    // No stable identity. Reported rather than dropped, so the review UI can
    // say "we could not read N fields" instead of quietly showing a short list.
    if (!d) {
      out.push(unreadable(el, p));
      continue;
    }

    const kind = d.kind;
    const logical = groupIdentity(el, d, kind);
    if (logical && groupKeys.has(logical)) {
      // Another member of a group already seen: add its option, don't add a field.
      const existing = out[groupKeys.get(logical)];
      existing.members.push(el);
      const label = p.labelFor(el) || el.value || '';
      if (label) existing.options.push({ value: el.value || label, label, el });
      if (el.checked) { existing.filled = true; existing.value = label; }
      if (p.requiredFor(el)) existing.required = true;
      continue;
    }

    let key = questionSignature(d.ident);
    if (!key) { out.push(unreadable(el, p)); continue; }
    const n = (keyCounts.get(key) || 0) + 1;
    keyCounts.set(key, n);
    if (n > 1) key = `${key}#${n}`;

    const row = {
      key,
      el,
      members: [el],
      kind,
      label: (d.label || '').trim() || d.ident,
      ident: d.ident,
      // Collapsed the same way the server engine collapses it: a value is only
      // carried when the field is genuinely filled. An unfilled <select> still
      // reports its placeholder ("Select…") as displayed text, and `value` feeds
      // the anti-downgrade guard, which treats any non-empty current value as a
      // real answer worth protecting — so leaking a placeholder through here
      // makes it refuse a legitimate first "prefer not to answer".
      value: d.filled ? (d.value || '') : '',
      filled: !!d.filled,
      invalid: !!d.invalid,
      required: !!d.required,
      options: normalizeOptions(d.options),
      readable: true,
      documentSlot: null,
      hints: fieldHints(el),
      // A separate country-code picker beside a phone box means the box wants
      // the national number only; pasting "+91 98765 43210" into it produces a
      // doubled dial code the form then rejects.
      hasCountryWidget: hasCountryWidget(el),
    };

    if (kind === 'radio' || kind === 'checkbox') {
      const label = p.labelFor(el) || el.value || '';
      row.options = label ? [{ value: el.value || label, label, el }] : [];
      row.optionLabel = label;
      if (logical) groupKeys.set(logical, out.length);
    }

    if (isFileField(el)) {
      row.kind = 'file';
      row.documentSlot = documentSlotFor(row.label) || documentSlotFor(d.ident) || null;
    }
    out.push(row);
  }

  // Drag-and-drop uploaders that have no <input type="file"> at all.
  //
  // Most do have one, hidden, and it is found by the scan above. A few (FilePond
  // and Uppy in some configurations) render only a drop target. Those are real
  // required fields, and leaving them undiscovered is the worst outcome
  // available: the user is told the form is filled and never learns a document
  // slot was missed. Surfaced here so they appear in the results either way.
  for (const zone of dropOnlyZones(form.root)) {
    const label = zoneLabel(zone, p);
    const key = questionSignature(label) || `dropzone ${out.length}`;
    if (keyCounts.has(key)) continue;
    keyCounts.set(key, 1);
    out.push({
      key, el: zone, members: [zone], kind: 'file',
      label: label || 'File upload', ident: key, value: '',
      filled: false, invalid: false, required: /\*|\(required\)/.test(label),
      options: [], readable: true,
      documentSlot: documentSlotFor(label),
      hints: { tag: 'dropzone' }, dropOnly: true,
    });
  }

  // The group question can only be worked out once every option is known, so it
  // is a second pass: during the first, a group's later members have not been
  // seen yet and the smallest-common-ancestor search would find the wrong node.
  for (const row of out) {
    if (row.kind === 'date-parts') {
      const now = readDateParts(row);
      row.filled = now.filled;
      row.value = now.value;
      continue;
    }
    if (row.kind !== 'radio' && row.kind !== 'checkbox') continue;
    const question = groupLabel(row.members, p);
    // A lone checkbox is its own question ("I agree to the terms"), so its own
    // label is the right one and a wrapper search would only find something
    // broader and less specific.
    if (question && (row.members.length > 1 || row.kind === 'radio')) {
      row.label = question;
      // The required marker lives on the QUESTION (Workday puts the asterisk in
      // the fieldset legend), never on "Yes"/"No". Read only off the options, a
      // required group looked optional — and an optional unknown is skipped
      // rather than asked, so the user was never told it needed an answer.
      if (/\*|\(required\)/i.test(question)) row.required = true;
      const group = row.members[0].closest && row.members[0].closest('fieldset, [role="radiogroup"]');
      if (group && group.getAttribute('aria-required') === 'true') row.required = true;
    } else if (row.optionLabel) row.label = row.optionLabel;
  }
  return out;
}

function unreadable(el, p) {
  return {
    key: '', el, members: [el], kind: 'unknown',
    label: (p.labelFor(el) || '').trim(), ident: '', value: '',
    filled: false, invalid: false, required: !!p.requiredFor(el),
    options: [], readable: false, documentSlot: null, hints: fieldHints(el),
  };
}

const DATE_PART_RE = /dateSection(Month|Day|Year)/i;

function dateWrapperOf(el) {
  const automation = (el.getAttribute && el.getAttribute('data-automation-id')) || '';
  if (!DATE_PART_RE.test(automation)) return null;
  return (el.closest && el.closest('[data-automation-id="dateInputWrapper"]'))
      || el.parentElement;
}

function dateRow(wrap, first, p, keyCounts) {
  let label = '';
  const by = wrap.getAttribute && wrap.getAttribute('aria-labelledby');
  if (by) {
    const ref = wrap.ownerDocument.getElementById(by);
    if (ref) label = clean(ref.textContent);
  }
  if (!label) {
    const field = wrap.closest && wrap.closest('[data-automation-id^="formField"]');
    const lab = field && field.querySelector('label, legend');
    if (lab) label = clean(lab.textContent);
  }
  label = label || 'Date';
  let key = questionSignature(label) || 'date';
  const n = (keyCounts.get(key) || 0) + 1;
  keyCounts.set(key, n);
  if (n > 1) key = `${key}#${n}`;
  return {
    key, el: first, members: [first], kind: 'date-parts', label, ident: label,
    value: '', filled: false, invalid: false,
    required: /\*/.test(label) || (first.getAttribute && first.getAttribute('aria-required') === 'true'),
    options: [], readable: true, documentSlot: null,
    hints: { type: 'date-parts', tag: 'input' },
  };
}

/** Which part of a date a Workday spinbutton holds: 'month', 'day' or 'year'. */
export function datePartOf(el) {
  const automation = (el.getAttribute && el.getAttribute('data-automation-id')) || '';
  const m = automation.match(DATE_PART_RE);
  return m ? m[1].toLowerCase() : '';
}

function isFileField(el) {
  return (el.getAttribute && (el.getAttribute('type') || '').toLowerCase() === 'file');
}

const DROP_ZONE_SEL = [
  '[class*="dropzone" i]', '[class*="drop-zone" i]', '[class*="filepond" i]',
  '[class*="uppy" i]', '[data-uppy]', '[data-filepond]',
].join(', ');

/** Drop targets in `root` that contain no file input of their own. */
function dropOnlyZones(root) {
  if (!root) return [];
  let zones = [];
  try { zones = Array.prototype.slice.call(root.querySelectorAll(DROP_ZONE_SEL)); }
  catch (e) { return []; }
  const out = [];
  for (const zone of zones) {
    let hasInput = false;
    try { hasInput = !!zone.querySelector('input[type="file"]'); } catch (e) { hasInput = true; }
    // Nested matches (an Uppy root inside an Uppy dashboard) would otherwise each
    // become a field; keep only the innermost.
    const nested = out.some(other => zone.contains(other) || other.contains(zone));
    if (!hasInput && !nested && isVisible(zone)) out.push(zone);
  }
  return out;
}

function zoneLabel(zone, p) {
  const aria = zone.getAttribute && zone.getAttribute('aria-label');
  if (aria) return aria.trim();
  const viaProbe = p.labelFor(zone);
  if (viaProbe) return viaProbe;
  // The label usually sits just above the zone.
  const prev = zone.previousElementSibling;
  if (prev && /^(label|legend|h[1-6]|p|span|div)$/i.test(prev.tagName || '')) {
    const text = clean(prev.textContent);
    if (text && text.length < 120) return text;
  }
  return clean(zone.textContent).slice(0, 80);
}

/**
 * The identity that makes several controls ONE field.
 *
 * A shared `name` is what collapses three radios into one question. Workday
 * renders radio groups with no name at all, so a [role=radiogroup] or fieldset
 * ancestor is the fallback — without it each option reads as its own yes/no
 * field and the group gets three conflicting answers.
 */
function groupIdentity(el, d, kind) {
  if (kind !== 'radio' && kind !== 'checkbox') return null;
  const name = el.getAttribute && el.getAttribute('name');
  if (name) return `name:${kind}:${name}`;
  const group = el.closest && el.closest('[role="radiogroup"], fieldset');
  if (group) {
    if (!group.__tcvGroupId) {
      group.__tcvGroupId = `g${Math.random().toString(36).slice(2, 10)}`;
    }
    return `grp:${kind}:${group.__tcvGroupId}`;
  }
  void d;
  return null;
}

/**
 * The QUESTION a radio/checkbox group asks — not the label of one option.
 *
 * describeEl's label for a radio is its own option text ("Yes"), which is the
 * right answer for that element and the wrong one for the field. A fieldset
 * legend or a radiogroup's aria-label gives the question directly; where neither
 * exists (Lever wraps the question in a plain <label> beside the options, with no
 * fieldset anywhere) the smallest ancestor containing every member is found and
 * searched for a label that does not itself wrap a control.
 *
 * Getting this wrong is not cosmetic: with "Yes" as the question, the group is
 * unanswerable, and a group we cannot name is a required field left blank.
 */
function groupLabel(members, p) {
  const el = members[0];
  const group = el.closest && el.closest('[role="radiogroup"], fieldset');
  if (group) {
    const aria = group.getAttribute && group.getAttribute('aria-label');
    if (aria) return aria.trim();
    const legend = group.querySelector && group.querySelector('legend');
    if (legend) return clean(legend.textContent);
    const viaProbe = p.labelFor(group);
    if (viaProbe) return viaProbe;
  }

  // Smallest ancestor that contains all the options.
  let n = el.parentElement, depth = 0;
  while (n && depth < 6) {
    if (members.every(m => n.contains(m))) {
      const found = questionLabelIn(n);
      if (found) return found;
    }
    n = n.parentElement; depth++;
  }
  return '';
}

/** A label inside `node` that describes the group rather than one option. */
function questionLabelIn(node) {
  let labels = null;
  try { labels = node.querySelectorAll('label, legend'); } catch (e) { return ''; }
  for (const label of labels) {
    // A label wrapping a control is that control's own option text.
    if (label.querySelector && label.querySelector(probe().CONTROL_SEL)) continue;
    if (label.getAttribute && label.getAttribute('for')) continue;
    const text = clean(label.textContent);
    // An option label is short and answer-shaped; a question is not.
    if (text && !/^(yes|no|n\/a|other|male|female)$/i.test(text)) return text;
  }
  return '';
}

function clean(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
}

/**
 * Whether this control sits next to its own country/dial-code picker.
 *
 * Bounded to the field's immediate surroundings rather than the whole form: a
 * Country field elsewhere on the application says nothing about how the phone
 * box wants its value.
 */
function hasCountryWidget(el) {
  let n = el.parentElement, depth = 0;
  while (n && depth < 3) {
    try {
      const found = n.querySelector(
        '[class*="country" i], [class*="dial" i], [data-country], [class*="flag" i]');
      if (found && found !== el) return true;
    } catch (e) { /* ignore */ }
    n = n.parentElement; depth++;
  }
  return false;
}

/** Everything a writer needs to shape a value for this specific control. */
function fieldHints(el) {
  const g = a => (el.getAttribute && el.getAttribute(a)) || '';
  return {
    type: g('type').toLowerCase(),
    placeholder: g('placeholder'),
    pattern: g('pattern'),
    maxLength: el.maxLength > 0 ? el.maxLength : null,
    autocomplete: g('autocomplete').toLowerCase(),
    inputmode: g('inputmode').toLowerCase(),
    multiple: el.multiple === true,
    tag: (el.tagName || '').toLowerCase(),
  };
}

// ── custom dropdown option reading ───────────────────────────

const MAX_OPTIONS_READ = 200;

/**
 * Open a custom combobox and read the options it really offers.
 *
 * Needed because native <select> option lists come free but react-select's do
 * not: no <option> tags exist, the menu is portal-rendered into <body>, and it
 * only exists after a click. Without this the answering tier names values
 * blind, which is how "Where are you currently based?" — whose only choices
 * were USA / Canada / Located Elsewhere — got answered "India": a perfectly
 * sensible answer to the question, and not on the menu.
 *
 * Callers MUST NOT call this for a field that already holds a value.
 * react-select filters its menu against the current selection, so re-reading a
 * filled field returns fewer options or none, and losing the list is how a
 * correct "I am not a military Veteran" became "I do not wish to answer" on a
 * later pass (auto_apply/browser.py:911).
 */
export async function readComboboxOptions(row) {
  const p = probe();
  if (!p || !row || !row.el) return [];
  const el = row.el;

  // Already in the DOM? Read it without touching anything.
  const existing = p.listboxFor(el);
  if (existing) {
    const labels = optionLabelsIn(existing);
    if (labels.length) return labels;
  }

  try {
    scrollIntoView(el);
    clickOpen(el);
    const labels = await waitForOptions();
    return labels;
  } catch (e) {
    return [];
  } finally {
    dismissListbox(el);
  }
}

function optionLabelsIn(node) {
  const p = probe();
  const nodes = p && p.optionNodes ? p.optionNodes(node) : [];
  const out = [];
  for (const n of nodes) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (t && out.length < MAX_OPTIONS_READ) out.push(t);
  }
  return out;
}

function waitForOptions() {
  return new Promise(resolve => {
    const doc = globalThis.document;
    // Captured now, not read inside the timer: the timer can outlive the frame
    // (or, in tests, the mounted document), and probe() would then be undefined.
    const p = probe();
    const read = () => (p ? p.visibleOptionLabels(MAX_OPTIONS_READ) : []);
    const immediate = read();
    if (immediate.length) { resolve(immediate); return; }

    let done = false;
    const finish = labels => {
      if (done) return;
      done = true;
      try { obs.disconnect(); } catch (e) {}
      clearTimeout(timer);
      resolve(labels);
    };
    // The menu is portalled to <body>, so the whole document is the scope.
    const obs = new globalThis.MutationObserver(() => {
      const labels = read();
      if (labels.length) finish(labels);
    });
    try { obs.observe(doc.body, { childList: true, subtree: true }); } catch (e) {}
    const timer = setTimeout(() => finish(read()), TIMING.optionWaitMs);
  });
}

export function scrollIntoView(el) {
  try {
    const p = probe();
    const node = (p && p.fieldWrapper(el)) || el;
    if (node.scrollIntoView) node.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch (e) { /* not fatal */ }
}

export function clickOpen(el) {
  const p = probe();
  const target = pickClickTarget(el, p);
  try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (_) {} }
  try { target.click(); } catch (e) { /* fall through */ }
}

/**
 * What to click to open a widget. The combobox input itself is usually right,
 * but Workday and some design systems render a button and keep the input for
 * typing only, in which case clicking the input does nothing.
 */
function pickClickTarget(el, p) {
  const role = el.getAttribute && el.getAttribute('role');
  if (role === 'combobox' || role === 'button') return el;
  // A native <button> dropdown (Workday) is its own trigger. Searching its
  // wrapper for "something clickable" instead finds unrelated controls.
  if ((el.tagName || '').toLowerCase() === 'button') return el;
  const wrap = (p && p.rsContainer(el)) || el.parentElement;
  if (wrap) {
    let ctl = null;
    try { ctl = wrap.querySelector('[role="combobox"], [role="button"], [class*="control"]'); }
    catch (e) { ctl = null; }
    if (ctl) return ctl;
  }
  return el;
}

/**
 * Read a Workday date back as one value. Filled only when EVERY part is: a date
 * with a month and a year but no day is not an answer the form will accept.
 */
function readDateParts(row) {
  const parts = {};
  for (const el of row.members || []) {
    if (!el.isConnected) continue;
    const part = datePartOf(el);
    if (part) parts[part] = String(el.value || '').trim();
  }
  const order = ['month', 'day', 'year'].filter(k => k in parts);
  const values = order.map(k => parts[k]);
  const filled = order.length > 0 && values.every(Boolean);
  const invalid = (row.members || []).some(el => el.getAttribute
    && el.getAttribute('aria-invalid') === 'true');
  return { value: filled ? values.join('/') : '', filled, invalid, required: !!row.required,
           parts };
}

/** Escape, unconditionally — cheap, idempotent, never worth failing on. */
export function dismissListbox(el) {
  try {
    const target = el && el.isConnected ? el : globalThis.document.activeElement;
    if (!target) return;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new globalThis.KeyboardEvent(type, {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
      }));
    }
  } catch (e) { /* best effort by design */ }
}

/** Re-describe one row in place, after a write or a re-render. */
export function reprobe(row) {
  const p = probe();
  if (!p || !row) return null;
  if (row.kind === 'date-parts') return readDateParts(row);
  let el = row.el;
  if (!el || !el.isConnected) {
    el = reresolve(row);
    if (!el) return null;
    row.el = el;
  }
  const d = p.describeEl(el);
  if (!d) return null;
  if (row.kind === 'radio' || row.kind === 'checkbox') {
    // Read the group, not the one member we happen to hold.
    const checked = row.members.filter(x => x.isConnected && x.checked);
    return {
      value: checked.map(x => p.labelFor(x) || x.value || '').filter(Boolean).join(' | '),
      filled: checked.length > 0,
      invalid: checked.length > 0 && !!d.invalid,
      required: !!d.required,
    };
  }
  return {
    value: d.value || '', filled: !!d.filled, invalid: !!d.invalid, required: !!d.required,
  };
}

/**
 * Find a row's element again after the framework replaced it.
 *
 * Keyed on the identity, not a selector: React hands out a new node for the
 * same logical field on re-render, and a stored selector would either miss or —
 * worse — resolve to a different field.
 */
function reresolve(row) {
  const p = probe();
  const doc = globalThis.document;
  if (!p || !row.ident) return null;
  const esc = s => String(s).replace(/["\\]/g, '\\$&');
  for (const sel of [`[name="${esc(row.ident)}"]`, `#${cssId(row.ident)}`]) {
    if (!sel || sel === '#') continue;
    let el = null;
    try { el = doc.querySelector(sel); } catch (e) { el = null; }
    if (el && isVisible(el)) return el;
  }
  // Last resort: rescan and match on the normalised key.
  const form = findForm(doc);
  if (!form) return null;
  for (const el of form.fields) {
    const d = p.describeEl(el);
    if (d && questionSignature(d.ident) === row.key.split('#')[0]) return el;
  }
  return null;
}

function cssId(ident) {
  return /^[A-Za-z_][\w-]*$/.test(ident) ? ident : '';
}
