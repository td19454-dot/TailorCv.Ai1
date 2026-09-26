// The autofill panel and the in-page highlighting.
//
// Renders into the existing sidebar's #tcvBody, following the conventions
// already established there: a template literal assigned to innerHTML, then
// listeners bound by re-querying — no framework, no diffing. Every interpolated
// string goes through esc().
//
// The results view is the whole point of v1. Filling a form is only useful if
// the person can see what went in, what needs a second look, and what still
// needs them — so the four groups are the deliverable, not decoration.

import { ASK, DOCUMENT, FILL, PROFILE, SKIP, SUGGEST } from './plan.js';
import { answerField, learnableAnswers, rememberAnswers } from './run.js';

const probe = () => globalThis.__tcvFieldProbe;

const HIGHLIGHT_STYLE_ID = 'tailorcv-af-styles';

// Injected as a <style> node from a bundled string rather than fetched, for the
// same reason the sidebar's own CSS is (see ensureStyles in content.js):
// LinkedIn's connect-src blocks chrome-extension:// requests, and rules added
// through the engine are invisible to session replay.
const HIGHLIGHT_CSS = `
.tcv-af-hl { outline: 2px solid rgba(79,127,255,0.9) !important;
  outline-offset: 2px !important; border-radius: 4px !important; }
.tcv-af-hl-ok { outline-color: rgba(74,222,128,0.9) !important; }
.tcv-af-hl-review { outline-color: rgba(252,211,77,0.95) !important; }
.tcv-af-hl-ask { outline-color: rgba(96,165,250,0.95) !important; }
.tcv-af-hl-bad { outline-color: rgba(248,113,113,0.95) !important; }
@keyframes tcvAfPulse {
  0%, 100% { outline-color: rgba(79,127,255,0.25); }
  50% { outline-color: rgba(79,127,255,1); }
}
.tcv-af-pulse { animation: tcvAfPulse 0.6s ease-in-out 2 !important; }
`;

function ensureHighlightStyles() {
  const doc = globalThis.document;
  if (doc.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = HIGHLIGHT_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

function esc(s) {
  const d = globalThis.document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// ── highlighting ─────────────────────────────────────────────

let highlighted = [];

const HL_CLASS = {
  [FILL]: 'tcv-af-hl-ok',
  [SUGGEST]: 'tcv-af-hl-review',
  [ASK]: 'tcv-af-hl-ask',
  [PROFILE]: 'tcv-af-hl-ask',
  [DOCUMENT]: 'tcv-af-hl-ok',
};

/**
 * Outline each field with what happened to it.
 *
 * The class goes on the WRAPPER, not the control: react-select's real input is
 * zero-size, so an outline on it would be invisible. Nothing is reparented and
 * no element is inserted into the form — moving host DOM around breaks React's
 * reconciliation, and an autofill that corrupts the page it filled is worse than
 * one that does nothing.
 */
export function highlight(decisions) {
  clearHighlights();
  ensureHighlightStyles();
  const p = probe();
  for (const d of decisions || []) {
    if (d.action === SKIP) continue;
    const el = d.row && d.row.el;
    if (!el || !el.isConnected) continue;
    const node = (p && p.fieldWrapper(el)) || el;
    const cls = d.outcome && d.outcome !== 'ok' && d.value ? 'tcv-af-hl-bad' : HL_CLASS[d.action];
    if (!cls) continue;
    node.classList.add('tcv-af-hl', cls);
    highlighted.push([node, cls]);
  }
}

export function clearHighlights() {
  for (const [node, cls] of highlighted) {
    try { node.classList.remove('tcv-af-hl', cls, 'tcv-af-pulse'); } catch (e) { /* ignore */ }
  }
  highlighted = [];
}

function jumpTo(decision) {
  const p = probe();
  const el = decision.row && decision.row.el;
  if (!el || !el.isConnected) return;
  const node = (p && p.fieldWrapper(el)) || el;
  try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  ensureHighlightStyles();
  node.classList.add('tcv-af-hl', 'tcv-af-pulse');
  setTimeout(() => {
    try { node.classList.remove('tcv-af-pulse'); } catch (e) {}
  }, 1400);
}

// ── the panel ────────────────────────────────────────────────

const GROUPS = [
  { action: FILL, title: 'Filled', badge: 'ok', icon: '✓' },
  { action: SUGGEST, title: 'Needs your review', badge: 'review', icon: '!' },
  { action: DOCUMENT, title: 'Attached', badge: 'ok', icon: '✓' },
  { action: ASK, title: 'Needs your answer', badge: 'ask', icon: '?' },
  { action: PROFILE, title: 'Set once in your profile', badge: 'ask', icon: '?' },
];

const SOURCE_LABEL = {
  profile: 'your profile',
  saved_answer: 'a saved answer',
  ai: 'AI',
  ai_written: 'AI, written for this job',
  you: 'you',
};

/**
 * Draw the "ready to fill" view: what we found, and the button.
 * `onFill` runs the autofill; `onTailor` falls through to the resume flow.
 */
export function renderReady(body, form, ctx, handlers, extra) {
  const count = ((form && form.fields) || []).length;
  const blockers = (ctx && ctx.blockers) || [];
  const quotaOut = ctx && ctx.quota && ctx.quota.exhausted;
  const page = (extra && extra.page) || 0;

  body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-card tcv-job-card">
        <div class="tcv-job-main">
          <div class="tcv-job-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>
          </div>
          <div class="tcv-job-text">
            <div class="tcv-job-title">${page > 1
              ? `Page ${esc(page)} of this application`
              : 'Application form detected'}</div>
            <div class="tcv-job-meta">${esc(count)} field${count === 1 ? '' : 's'} on this page${
              form && form.ats && form.ats !== 'generic' ? ` · ${esc(form.ats)}` : ''}</div>
          </div>
        </div>
      </div>
      ${blockers.length ? `
        <div class="tcv-af-note">
          ${esc(blockers[0])}
          <a href="#" id="tcvAfProfileLink">Open your profile →</a>
        </div>` : ''}
      ${quotaOut ? `
        <div class="tcv-af-note">
          You've used your free autofills. <a href="#" id="tcvAfUpgrade">Upgrade to Pro →</a>
        </div>` : `
        <button class="tcv-btn tcv-btn-start tcv-btn-cta" id="tcvAfFillBtn">${page > 1
          ? 'Autofill this page' : 'Autofill this application'} <span aria-hidden="true">▸</span></button>`}
      <button class="tcv-btn tcv-btn-outline-accent" id="tcvAfTailorBtn">✦ Tailor my resume for this job</button>
      <div class="tcv-af-note tcv-af-note-quiet">
        TailorCV never submits an application. You review everything and send it yourself.
      </div>
    </div>`;

  const fill = body.querySelector('#tcvAfFillBtn');
  if (fill) fill.addEventListener('click', () => handlers.onFill());
  const tailor = body.querySelector('#tcvAfTailorBtn');
  if (tailor) tailor.addEventListener('click', (e) => { e.preventDefault(); handlers.onTailor(); });
  bindLink(body, '#tcvAfProfileLink', handlers.onOpenProfile);
  bindLink(body, '#tcvAfUpgrade', handlers.onUpgrade);
}

function bindLink(body, selector, fn) {
  const el = body.querySelector(selector);
  if (el && typeof fn === 'function') {
    el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
  }
}

/**
 * Draw the results of a run.
 *
 * Works for a run in this frame and for one in an embedded frame. The difference
 * is only in `handlers`: a local run gets handlers that act on the live decision
 * objects, a framed run gets ones that message the frame by index. Everything
 * the view itself reads — label, action, value, reason, options — is present in
 * both shapes, so there is one results view rather than two.
 */
export function renderResults(body, result, ctx, handlers) {
  const decisions = result.decisions || [];
  const counts = result.counts || {};
  const filled = (counts[FILL] || 0) + (counts[DOCUMENT] || 0);

  body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-af-summary" id="tcvAfSummary">
        ${pill('ok', `${filled} filled`)}
        ${counts[SUGGEST] ? pill('review', `${counts[SUGGEST]} to review`) : ''}
        ${counts[ASK] ? pill('ask', `${counts[ASK]} need you`) : ''}
        ${counts[PROFILE] ? pill('ask', `${counts[PROFILE]} for your profile`) : ''}
      </div>
      ${result.page > 1 ? `<div class="tcv-source">Page ${esc(result.page)} of this application</div>` : ''}
      ${result.serverError ? `<div class="tcv-af-note">${esc(result.serverError)}</div>` : ''}
      ${result.opaqueHosts ? `<div class="tcv-af-note tcv-af-note-quiet">
        ${esc(result.opaqueHosts)} field group(s) on this page are built in a way
        we can't read — check those by hand.</div>` : ''}
      <div id="tcvAfBody">${GROUPS.map(g => groupHtml(g, decisions)).join('')}</div>
      <div class="tcv-af-note tcv-af-note-quiet">
        Review everything, then submit the application yourself. TailorCV never
        submits for you.
      </div>
      <button class="tcv-btn tcv-btn-ghost" id="tcvAfRerun">↻ Scan again</button>
      <div class="tcv-af-note tcv-af-note-quiet">
        Something filled wrong? <a href="#" id="tcvAfEditProfile">Edit your application
        profile</a> — name, address, phone and eligibility answers all come from there.
      </div>
    </div>`;

  wireRows(body, decisions, ctx, handlers);
  const rerun = body.querySelector('#tcvAfRerun');
  if (rerun) rerun.addEventListener('click', () => handlers.onFill());
  bindLink(body, '#tcvAfEditProfile', handlers.onOpenProfile);
  // Only a local run can highlight: the fields of an embedded form are not in
  // this document, so the frame highlights its own when it fills them.
  if (decisions.length && decisions[0].row) highlight(decisions);
  offerToRemember(body, result, handlers);
}

function pill(kind, text) {
  return `<span class="tcv-af-summary-pill tcv-af-${esc(kind)}">${esc(text)}</span>`;
}

function groupHtml(group, decisions) {
  const rows = decisions.filter(d => d.action === group.action);
  if (!rows.length) return '';
  return `
    <div class="tcv-af-group">
      <div class="tcv-af-group-title">${esc(group.title)} · ${rows.length}</div>
      ${rows.map(d => rowHtml(group, d, decisions.indexOf(d))).join('')}
    </div>`;
}

function rowHtml(group, d, index) {
  const needsInput = d.action === ASK && d.kind !== 'file' && !d.slot;
  const value = d.shown || d.value;
  return `
    <div class="tcv-af-row" data-index="${index}">
      <div class="tcv-af-row-head">
        <span class="tcv-af-badge tcv-af-${esc(group.badge)}">${esc(group.icon)}</span>
        <span class="tcv-af-row-label">${esc(d.label || '(unlabelled field)')}</span>
        <a href="#" class="tcv-af-jump" data-index="${index}">show</a>
      </div>
      ${value ? `<div class="tcv-af-row-value">${esc(truncate(value, 120))}</div>` : ''}
      ${d.source ? `<div class="tcv-af-row-src">from ${esc(SOURCE_LABEL[d.source] || d.source)}${
        d.reason ? ` · ${esc(d.reason)}` : ''}</div>`
        : (d.reason ? `<div class="tcv-af-row-src">${esc(d.reason)}</div>` : '')}
      ${needsInput ? askFormHtml(d, index) : ''}
    </div>`;
}

function askFormHtml(d, index) {
  const options = (d.options || []).map(o => (typeof o === 'string' ? o : o.label)).filter(Boolean);
  const control = options.length && options.length <= 40
    ? `<select class="tcv-af-ask-select" data-index="${index}">
         <option value="">Choose…</option>
         ${options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
       </select>`
    : `<input class="tcv-af-ask-input" data-index="${index}" type="text"
              placeholder="Your answer">`;
  // Remembering defaults ON for an ordinary question and is replaced by a link
  // to the profile for anything sensitive — those belong on file as one
  // deliberate answer, not captured from one employer's form.
  return `
    <div class="tcv-af-ask-form">
      ${control}
      <label class="tcv-af-remember">
        <input type="checkbox" class="tcv-af-remember-box" data-index="${index}" checked>
        Remember this answer
      </label>
      <button class="tcv-btn tcv-btn-outline tcv-af-ask-save" data-index="${index}">
        Save &amp; fill
      </button>
    </div>`;
}

function truncate(s, n) {
  const t = String(s == null ? '' : s);
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function wireRows(body, decisions, ctx, handlers) {
  for (const link of body.querySelectorAll('.tcv-af-jump')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const index = Number(link.dataset.index);
      const d = decisions[index];
      if (!d) return;
      // A live decision is scrolled to directly; a serialized one belongs to
      // another frame, which has to do the scrolling itself.
      if (d.row) jumpTo(d);
      else if (handlers.onJump) handlers.onJump(index);
    });
  }
  for (const btn of body.querySelectorAll('.tcv-af-ask-save')) {
    btn.addEventListener('click', async () => {
      const index = Number(btn.dataset.index);
      const d = decisions[index];
      if (!d) return;
      const input = body.querySelector(
        `.tcv-af-ask-input[data-index="${index}"], .tcv-af-ask-select[data-index="${index}"]`);
      const value = input ? String(input.value || '').trim() : '';
      if (!value) return;
      const rememberBox = body.querySelector(`.tcv-af-remember-box[data-index="${index}"]`);
      const remember = rememberBox ? rememberBox.checked : false;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const res = d.row
        ? await answerField(d, value, remember)
        : await handlers.onAnswer(index, value, remember);
      if (res && res.ok) {
        handlers.onRefresh();
      } else {
        btn.disabled = false;
        btn.textContent = 'Save & fill';
        const row = btn.closest('.tcv-af-row');
        if (row) {
          const note = globalThis.document.createElement('div');
          note.className = 'tcv-af-row-src';
          note.textContent = (res && res.reason) || d.reason
            || 'That did not take — try filling it directly.';
          row.appendChild(note);
        }
      }
    });
  }
  void ctx;
}

/**
 * Offer to remember answers the user typed into the page themselves.
 *
 * Offered, never automatic. Silently uploading everything someone types into a
 * third-party form is a privacy problem regardless of intent, and it would also
 * bake a typo in as their permanent answer to a question. One row, one button.
 */
function offerToRemember(body, result, handlers) {
  const decisions = result.decisions || [];
  // A local run computes this from live rows; a framed run had the frame compute
  // it and send the list along, since only the frame can read its own fields.
  const learnable = result.learnable
    || (decisions.length && decisions[0].row ? learnableAnswers(decisions) : []);
  if (!learnable.length) return;
  const host = body.querySelector('#tcvAfBody');
  if (!host) return;
  const box = globalThis.document.createElement('div');
  box.className = 'tcv-af-group';
  box.innerHTML = `
    <div class="tcv-af-group-title">Remember for next time · ${learnable.length}</div>
    <div class="tcv-af-row">
      <div class="tcv-af-row-src">
        You answered ${learnable.length} question${learnable.length === 1 ? '' : 's'} we
        didn't have. Save ${learnable.length === 1 ? 'it' : 'them'} for future applications?
      </div>
      <div class="tcv-af-row-value">${
        learnable.map(l => esc(truncate(l.question, 70))).join('<br>')}</div>
      <button class="tcv-btn tcv-btn-outline" id="tcvAfRemember">Save ${
        learnable.length === 1 ? 'answer' : 'answers'}</button>
    </div>`;
  host.appendChild(box);
  const btn = box.querySelector('#tcvAfRemember');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const res = handlers && handlers.onRemember
      ? await handlers.onRemember(learnable)
      : await rememberAnswers(learnable);
    btn.textContent = res && res.saved ? `✓ Saved ${res.saved}` : 'Could not save';
  });
}

export { jumpTo };

/** The "we're working" view, for the duration of a run. */
export function renderRunning(body, phase) {
  body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-status-text" id="tcvAfPhase">${esc(phase || 'Reading the form…')}</div>
    </div>`;
}

export function setPhase(body, text) {
  const el = body.querySelector('#tcvAfPhase');
  if (el) el.textContent = text;
}

export const PHASE_TEXT = {
  scanning: 'Reading the form…',
  reading: 'Checking what the dropdowns offer…',
  thinking: 'Working out the answers…',
  filling: 'Filling the form…',
  repairing: 'Fixing what didn’t take…',
};
