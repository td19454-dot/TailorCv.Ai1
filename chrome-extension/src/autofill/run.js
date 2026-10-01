// The orchestrator: scan, plan, apply, verify, repair, report.
//
// One invariant governs this file and is worth stating before the code: THERE IS
// NO PATH HERE THAT SUBMITS AN APPLICATION. Nothing clicks a submit button,
// nothing presses Enter on a form, and there is no fallback that might. The
// user reviews what we filled and submits it themselves. That is what makes
// every other failure in here recoverable — a wrong value is something they can
// see and fix, not something already sent under their name.
//
// Sequencing notes:
//   * One /plan request per page. The deterministic tier runs first and locally,
//     so a form of ordinary identity fields costs no network call at all.
//   * That request is NOT waited on before writing. The profile answers are
//     typed while it is in flight, and the server's answers (including the
//     slow, AI-written ones) are written when they arrive — see fillInTwoWaves.
//   * Exactly one repair sweep, and it costs no LLM call: it retries only the
//     fields the page disagreed about, using the other mechanism.
//   * Fields that appear in response to an answer get one extra round, capped.

import { describeFields, findForm, isApplicationPage, readComboboxOptions, reprobe, hasUploadedFile,
         profileTileBlocks }
  from './discover.js';
import { fillProfileTiles } from './tiles.js';
import { decide, fieldsForServer, summarize, FILL, SUGGEST, ASK, PROFILE, DOCUMENT, SKIP }
  from './plan.js';
import { applyDecision, attachFile, dropFile, findDropZone, fileFromBase64, settlesTo } from './write.js';
import { questionSignature, isNeverFill, looksSecret, classifySensitive, splitPhone }
  from './match.js';
import { TIMING, sleep } from './timing.js';

const MAX_REPAIR_SWEEPS = 1;
const MAX_REVEAL_ROUNDS = 2;
const MAX_PAGES = 4;
const STATE_TTL_MS = 30 * 60 * 1000;
// A dropdown's real options are only read for fields we intend to answer, and
// reading one costs a click plus a render wait, so the count is bounded.
const MAX_DROPDOWNS_TO_OPEN = 25;


/** Messages to the background worker. */
function send(msg) {
  return new Promise(resolve => {
    try {
      globalThis.chrome.runtime.sendMessage(msg, res => resolve(res || {}));
    } catch (e) {
      resolve({ error: String((e && e.message) || e) });
    }
  });
}

// ── run state, across page navigations ───────────────────────

let state = {
  registry: {},      // key -> value we wrote and verified
  userEdited: [],    // keys the person typed in themselves
  answeredByUser: {},// key -> answer they gave in the sidebar
  imported: {},      // application -> when the resume went into its profile import
  page: 1,
  startedAt: 0,
  origin: '',
};

export function getState() {
  return state;
}

async function loadState() {
  const res = await send({ type: 'AF_STATE_GET' });
  const saved = res && res.data;
  const origin = globalThis.location.origin;
  if (!saved || saved.origin !== origin) return false;
  if (!saved.startedAt || Date.now() - saved.startedAt > STATE_TTL_MS) return false;
  state = Object.assign(state, saved);
  return true;
}

async function saveState() {
  await send({ type: 'AF_STATE_SET', data: {
    v: 1,
    origin: state.origin,
    page: state.page,
    startedAt: state.startedAt,
    registry: state.registry,
    userEdited: state.userEdited,
    answeredByUser: state.answeredByUser,
    imported: state.imported,
  } });
}

export async function clearState() {
  state = { registry: {}, userEdited: [], answeredByUser: {}, imported: {}, page: 1, startedAt: 0, origin: '' };
  await send({ type: 'AF_STATE_CLEAR' });
}

/**
 * Resume a run in progress after the form navigated to its next page.
 *
 * Returns the restored page number, or 0 when there is nothing to resume.
 * Multi-step applications destroy the content script on every navigation, so
 * without this each page would look like a fresh form and the user would be
 * told "12 fields filled" four times with no sense of progress.
 */
export async function resumeIfContinuing() {
  const form = isApplicationPage();
  if (!form) return 0;
  if (!(await loadState())) return 0;
  if (state.page >= MAX_PAGES) return 0;
  state.page += 1;
  await saveState();
  return state.page;
}

/**
 * Advance to the next step of an application that did NOT navigate.
 *
 * Workday moves between steps by swapping the form in place, so the content
 * script survives and resumeIfContinuing (which runs on a fresh load) never
 * fires. The registry is kept: it is what stops a field that persists across
 * steps from being overwritten, and what tells the user it was already filled.
 */
export async function nextPage() {
  if (!state.startedAt) {
    state.startedAt = Date.now();
    state.origin = globalThis.location.origin;
  }
  if (state.page < MAX_PAGES) state.page += 1;
  await saveState();
  return state.page;
}

// ── watching what the user types ─────────────────────────────

let editWatcher = null;

/**
 * Record which fields the person edits themselves.
 *
 * Capture phase and passive: this must never interfere with the page's own
 * handlers. Nothing is transmitted — the keys are used locally to stop us
 * overwriting their work, and the values only ever leave the browser if they
 * explicitly click Save on the offer to remember an answer.
 */
export function watchUserEdits(form, onEdit) {
  stopWatchingUserEdits();
  if (!form || !form.root) return;
  const rows = new Map();
  for (const row of describeFields(form)) {
    for (const el of row.members || []) rows.set(el, row);
  }
  const handler = (event) => {
    const row = rows.get(event.target);
    if (!row || !row.key) return;
    if (!state.userEdited.includes(row.key)) state.userEdited.push(row.key);
    if (typeof onEdit === 'function') {
      try { onEdit(row, event); } catch (e) { /* the UI must not break the page */ }
    }
  };
  editWatcher = { root: form.root, handler };
  for (const type of ['change', 'blur']) {
    form.root.addEventListener(type, handler, { capture: true, passive: true });
  }
}

export function stopWatchingUserEdits() {
  if (!editWatcher) return;
  for (const type of ['change', 'blur']) {
    try {
      editWatcher.root.removeEventListener(type, editWatcher.handler, { capture: true });
    } catch (e) { /* ignore */ }
  }
  editWatcher = null;
}

/**
 * Answers worth offering to remember: ones the user typed into a field we could
 * not answer. Filtered here as well as on the server, because the cheapest way
 * to keep a password out of the answer store is never to consider it.
 */
export function learnableAnswers(decisions) {
  const out = [];
  for (const d of decisions || []) {
    if (!state.userEdited.includes(d.key)) continue;
    const after = reprobe(d.row);
    const value = (after && after.value) || '';
    if (!value || !after.filled) continue;
    if (d.sensitive || classifySensitive(d.label)) continue;
    if (isNeverFill(d.label) || looksSecret(value)) continue;
    if (d.row.kind === 'file') continue;
    const type = (d.row.hints && d.row.hints.type) || '';
    if (type === 'password') continue;
    const autocomplete = (d.row.hints && d.row.hints.autocomplete) || '';
    if (/^cc-|one-time-code/.test(autocomplete)) continue;
    if (!questionSignature(d.label)) continue;
    out.push({ key: d.key, question: d.label, answer: value });
  }
  return out;
}

// ── the run ──────────────────────────────────────────────────

/**
 * Fill the application on this page.
 *
 * `onProgress({phase, done, total, detail})` is called as it goes; the sidebar
 * uses it for the progress ring. Returns the decision list, which is what the
 * results view renders.
 */
export async function runAutofill(ctx, onProgress) {
  const progress = (phase, extra) => {
    if (typeof onProgress === 'function') {
      try { onProgress(Object.assign({ phase }, extra || {})); } catch (e) { /* ignore */ }
    }
  };

  // A page of only Education / Experience tiles (Oracle) has no fillable box
  // until an entry is opened; it is still an application page with work to do.
  let form = findForm();
  if (!form) {
    const page = isApplicationPage();
    if (page && page.tilesOnly) form = page;
  }
  if (!form) return { error: 'no_form', decisions: [], counts: summarize([]) };
  const hasTiles = profileTileBlocks().some(b => b.kind);

  if (!state.startedAt) {
    state.startedAt = Date.now();
    state.origin = globalThis.location.origin;
  }

  attachedThisRun.clear();
  progress('scanning');
  let rows = describeFields(form);
  if (!rows.length && !hasTiles) return { error: 'no_fields', decisions: [], counts: summarize([]) };

  // Documents first, then the form as it stands AFTER them. Oracle's "Import
  // your profile" upload reads the resume and fills name, country, state… and
  // clears what it did not find (a Title picked earlier went blank while the
  // panel said filled). So the upload goes first, the form reads it, and only
  // then is the form read and planned: what the ATS filled is left as it filled
  // it (plan.js skips a filled, valid field) and only the gaps are ours.
  let decisions = [];
  const fileRows = rows.filter(r => r.kind === 'file');
  if (fileRows.length) {
    const filledBefore = new Set(rows.filter(r => r.filled).map(r => r.key));
    // Decided locally: which file goes where never needs the server, and waiting
    // on it here would hold every profile answer back behind the model.
    decisions = decide(fileRows, ctx, null, state);
    // Oracle keeps its "Import your profile" upload on every step. Importing
    // the resume again on a later step would re-read it into the form and undo
    // what was filled and fixed since — so it goes in once per application.
    const app = applicationKey();
    const step = Number((globalThis.location.pathname.match(/\/section\/(\d+)/) || [])[1] || 1);
    for (const d of decisions) {
      if (d.action === DOCUMENT && isProfileImport(d.row)
          && ((state.imported && state.imported[app]) || step > 1)) {
        d.action = SKIP;
        d.reason = 'your resume was already imported on an earlier page of this application';
      }
    }
    await writeAll(decisions, ctx, progress);
    if (decisions.some(d => d.action === DOCUMENT && d.outcome === 'ok' && isProfileImport(d.row))) {
      state.imported = Object.assign({}, state.imported, { [app]: Date.now() });
    }
    if (decisions.some(d => d.action === DOCUMENT && d.outcome === 'ok')) {
      // The form read the resume (Oracle): let it finish redrawing what it
      // filled — the address block reloads for the country it found.
      if (decisions.some(d => d.formRead)) {
        progress('scanning', { detail: 'letting the form read your resume' });
        await waitForQuiet(form.root);
      }
      rows = describeFields(findForm() || form);
      // Only what the upload filled: a value already there before it (the
      // account email, a country the page pre-set) did not come from the resume.
      for (const r of rows) {
        if (r.kind !== 'file' && r.filled && !r.invalid && !filledBefore.has(r.key)) r.filledByForm = true;
      }
    }
  }
  const fieldRows = rows.filter(r => r.kind !== 'file');
  decisions = decisions.concat(await fillInTwoWaves(await planFor(fieldRows, ctx, progress), ctx, progress));
  for (const d of decisions) {
    if (d.row && d.row.filledByForm && d.action === SKIP) {
      d.byForm = true;
      d.reason = 'filled by the form from your resume — check it';
    }
  }

  // One repair sweep, no LLM: retry only what the page disagreed about.
  for (let sweep = 0; sweep < MAX_REPAIR_SWEEPS; sweep++) {
    let broken = decisions.filter(d => d.outcome && d.outcome !== 'ok' && d.value);
    if (!broken.length) break;
    // Re-read before retrying. A pick can land after its check gave up — on
    // Oracle, Country took, the address block redrew, and the "repair" then typed
    // the dial code "+91" over a Country that already read India.
    await sleep(TIMING.settleMs);
    for (const d of broken) {
      const shapes = [d.value].concat(d.candidates || []);
      if (d.row && d.row.kind !== 'file' && await settlesTo(d.row, shapes, 0)) {
        const now = reprobe(d.row);
        d.outcome = 'ok';
        d.shown = (now && now.value) || d.value;
        if (d.key) state.registry[d.key] = d.value;
      }
    }
    broken = broken.filter(d => d.outcome !== 'ok');
    if (!broken.length) break;
    // A phone number the form rejected is retried in the OTHER shape, not the
    // same one again: some forms want "+918240044652", others (with their own
    // country-code field) only "8240044652", and the markup does not always say
    // which. The form's own validation error is what settles it.
    for (const d of broken) {
      if (d.row && isPhoneRow(d.row)) {
        const alt = alternatePhone(d.value, ctx);
        // Beside a country-code picker the box wants the national number, and
        // a rejection there means the PICKER is empty, not that the format is
        // wrong — switching to "+91…" only made it worse (Oracle).
        if (d.row.hasCountryWidget && String(alt).startsWith('+')) continue;
        if (alt && alt !== d.value) d.value = alt;
        continue;
      }
      // A dropdown that did not take is retried with the NEXT shape of the
      // answer, not the same string again — re-sending "India" to a list of
      // dial codes fails exactly as it did the first time. The writer tries
      // every remaining shape against the open list, so this costs one open.
      const next = nextCandidate(d);
      if (next) {
        d.candidates = d.candidates.filter(c => c !== d.value);
        d.value = next;
      }
    }
    progress('repairing', { total: broken.length });
    await writeAll(broken, ctx, progress, true);
  }

  // Fields revealed by an answer we just gave (a "Yes" that opens a follow-up).
  let revealed = 0;
  while (revealed < MAX_REVEAL_ROUNDS) {
    const before = new Set(rows.map(r => r.key));
    await waitForQuiet(form.root);
    const fresh = describeFields(findForm() || form);
    // Never the profile import: it was handled (or deliberately skipped) above.
    const added = fresh.filter(r => r.key && !before.has(r.key) && !(r.kind === 'file' && isProfileImport(r)));
    if (!added.length) break;
    revealed++;
    progress('scanning', { detail: `${added.length} new field(s) appeared` });
    const extra = await fillInTwoWaves(await planFor(added, ctx, progress), ctx, progress);
    decisions = decisions.concat(extra);
    rows = fresh;
  }

  // Education / Experience entries the form flags (Oracle's tiles): opened,
  // filled from the matching profile entry, saved, and checked.
  if (hasTiles) decisions = decisions.concat(await fillProfileTiles(ctx, progress));

  await refillCleared(decisions, progress);

  await saveState();
  watchUserEdits(form, null);

  return {
    decisions,
    counts: summarize(decisions),
    serverError: decisions.serverError || '',
    page: state.page,
    opaqueHosts: form.opaqueHosts || 0,
    ats: form.ats,
  };
}

function isPhoneRow(row) {
  const label = row.label || '';
  if (/extension|\bext\b|device|type|code/i.test(label)) return false;
  return (row.hints && row.hints.type === 'tel') || /\b(phone|mobile)\b/i.test(label);
}

/** One application across its steps: Oracle's URL ends in /apply/section/N. */
function applicationKey() {
  const loc = globalThis.location;
  return `${loc.origin}${loc.pathname.replace(/\/section\/\d+\/?$/, '').replace(/\/+$/, '')}`;
}

/** An upload that feeds the ATS's resume reader (Oracle's "Import your profile"). */
function isProfileImport(row) {
  if (!row) return false;
  if (/\bimport\b|\bpars(e|er|ing)\b/i.test(row.label || '')) return true;
  const cls = (row.el && row.el.className) || '';
  return /profile-import/i.test(String(cls));
}

/**
 * The last look before the panel says "filled": every field we filled is read
 * again, and one the page has since EMPTIED is filled once more — or, if it
 * will not stay, handed to the person. A page can clear an answer after it was
 * checked (Oracle's resume import cleared Title and the panel still said Mr.).
 * Only emptied fields: one the page reformatted ("+91" for "+91 (India)", a
 * spaced phone number) still holds the answer and is left alone, and a field
 * the person changed is theirs.
 */
async function refillCleared(decisions, progress) {
  const lost = decisions.filter(d => {
    if (!(d.action === FILL || d.action === SUGGEST) || d.outcome !== 'ok') return false;
    if (!d.row || d.row.kind === 'file' || d.row.kind === 'tile') return false;
    if (d.key && state.userEdited.includes(d.key)) return false;
    const now = reprobe(d.row);
    return !!now && !now.filled;
  });
  if (!lost.length) return;
  console.info(`[TailorCV] the form emptied ${lost.length} answer(s) after they were filled — filling again:`,
               lost.map(d => d.label).join(' | '));
  progress('repairing', { total: lost.length, detail: 'the form cleared some answers — filling them again' });
  for (const d of lost) {
    const result = await applyDecision(d);
    d.outcome = result.outcome;
    d.shown = result.shown;
    if (!result.ok) {
      d.action = ASK;
      d.reason = 'the form cleared this after we filled it';
    }
  }
}

/**
 * Wait for fields an answer reveals: at least revealWatchMs, then for as long
 * as the page keeps changing (until revealQuietMs pass with no change), capped
 * at revealMaxMs. Oracle builds Address Line 1 / Pin Code / City / State only
 * after Country is picked, loading them from its server ("dependency fields
 * loading" → "Address form loaded"); a single look at 900 ms could miss them.
 * A page that is not changing still costs only revealWatchMs.
 */
function waitForQuiet(root) {
  const doc = (root && root.ownerDocument) || globalThis.document;
  const target = (doc && doc.body) || root;
  return new Promise(resolve => {
    const start = Date.now();
    let last = start;
    let obs = null;
    try {
      obs = new globalThis.MutationObserver(() => { last = Date.now(); });
      obs.observe(target, { childList: true, subtree: true, attributes: true });
    } catch (e) { obs = null; }
    const tick = () => {
      const now = Date.now();
      const waited = now - start;
      const quiet = now - last;
      if (waited >= TIMING.revealMaxMs
          || (waited >= TIMING.revealWatchMs && (quiet >= TIMING.revealQuietMs || last === start))) {
        try { if (obs) obs.disconnect(); } catch (e) { /* ignore */ }
        resolve();
        return;
      }
      setTimeout(tick, 100);
    };
    setTimeout(tick, Math.min(100, TIMING.revealWatchMs));
  });
}

/** The next shape of the answer this row has not tried yet, or ''. */
function nextCandidate(d) {
  if (!d || !d.candidates || d.candidates.length < 2) return '';
  const current = String(d.value || '').toLowerCase();
  const next = d.candidates.find(c => String(c).toLowerCase() !== current);
  return next || '';
}

/** The same number in the other shape: E.164 <-> national. */
function alternatePhone(value, ctx) {
  const stored = String((ctx && ctx.answerBank && ctx.answerBank.phone) || value || '');
  const parts = splitPhone(stored);
  if (!parts.dialCode) return '';
  return String(value).startsWith('+') ? parts.national : parts.e164;
}

function decisionsToWrite(decisions) {
  return decisions.filter(d => (d.action === FILL || d.action === SUGGEST || d.action === DOCUMENT));
}

/** Decide a batch of rows, reading dropdown options and calling the server once. */
async function planFor(rows, ctx, progress) {
  // First pass with no server help. This is what answers a plain identity form
  // offline, and it also tells us which dropdowns are worth opening.
  let decisions = decide(rows, ctx, null, state);

  // Read the real options of the dropdowns we still need help with. Only for
  // fields we intend to answer and that are NOT already filled: react-select
  // filters its menu against the current selection, so re-reading a filled
  // field returns fewer options or none — and losing the list is how a correct
  // "I am not a military Veteran" became "I do not wish to answer" on a later
  // pass of the server engine.
  const needOptions = decisions.filter(d =>
    (d.action === ASK || d.action === PROFILE)
    && (d.kind === 'combobox' || (d.kind === 'select' && !d.options.length))
    && !d.row.filled).slice(0, MAX_DROPDOWNS_TO_OPEN);

  if (needOptions.length) {
    progress('reading', { total: needOptions.length });
    for (const d of needOptions) {
      const labels = await readComboboxOptions(d.row);
      if (labels.length) {
        d.row.options = labels.map(l => ({ value: l, label: l }));
        d.options = d.row.options;
      }
    }
    // Re-decide: a stored answer that had nothing to match against may now match.
    decisions = decide(rows, ctx, null, state);
  }

  const toAsk = fieldsForServer(decisions);
  if (!toAsk.length) return { decisions, server: null };

  // Started here, awaited by fillInTwoWaves only after the local answers are in.
  return { decisions, server: askServer(rows, ctx, decisions, toAsk) };
}

/** The /plan request. Resolves to the full re-decided list, never rejects. */
async function askServer(rows, ctx, decisions, toAsk) {
  const res = await send({
    type: 'AF_PLAN',
    payload: {
      url: globalThis.location.href,
      host: globalThis.location.hostname,
      ats: (findForm() || {}).ats || 'generic',
      jobTitle: (ctx && ctx.jobTitle) || '',
      jobCompany: (ctx && ctx.jobCompany) || '',
      jdExcerpt: String((ctx && ctx.jdExcerpt) || '').slice(0, 2000),
      fields: toAsk,
    },
  });
  if (res.error) {
    // A failed plan is not a failed run: everything the deterministic tier
    // answered has already been decided, and the rest becomes "needs you".
    decisions.forEach(d => { if (d.action === ASK && !d.reason) d.reason = res.error; });
    decisions.serverError = res.error;
    decisions.quotaExhausted = res.code === 'upgrade_required';
    return decisions;
  }
  return decide(rows, ctx, res.data || {}, state);
}

/**
 * Write a plan's answers in two waves.
 *
 * Wave 1 is everything decided locally — the profile, EEO, documents — written
 * immediately, while the /plan request (and its AI calls, which take seconds)
 * is still in flight. Wave 2 is whatever the server answered, written when it
 * arrives. Nothing clashes: wave 2 only ever writes fields wave 1 left alone.
 *
 * The person is looking at the form during wave 1 and may start typing. A field
 * they filled while we waited is theirs, so it is re-read before wave 2 writes.
 */
async function fillInTwoWaves(plan, ctx, progress) {
  const local = plan.decisions;
  progress('filling', { done: 0, total: decisionsToWrite(local).length });
  await writeAll(local, ctx, progress);
  if (!plan.server) return local;

  progress('thinking');
  const answered = await plan.server;
  const wroteLocally = new Set(decisionsToWrite(local));
  const merged = answered.map((d, i) => (wroteLocally.has(local[i]) ? local[i] : d));
  merged.serverError = answered.serverError;
  merged.quotaExhausted = answered.quotaExhausted;

  const wave2 = merged.filter((d, i) => d !== local[i] && decisionsToWrite([d]).length);
  for (const d of wave2) {
    const now = reprobe(d.row);
    if (now && now.filled && !d.row.filled) {
      d.action = SKIP;
      d.reason = 'you filled this while we were writing';
      if (d.key && !state.userEdited.includes(d.key)) state.userEdited.push(d.key);
    }
  }
  await writeAll(wave2, ctx, progress);
  return merged;
}

/** Write a batch of decisions and record what the page did with each. */
async function writeAll(decisions, ctx, progress, isRepair) {
  const todo = isRepair ? decisions : decisionsToWrite(decisions);
  let done = 0;
  for (const d of todo) {
    progress(isRepair ? 'repairing' : 'filling',
             { done, total: todo.length, detail: d.label });
    done++;
    if (d.action === DOCUMENT) {
      const result = await attachDocument(d, ctx);
      d.outcome = result.ok ? 'ok' : 'failed';
      d.shown = result.shown || '';
      d.formRead = !!result.formRead;
      if (!result.ok) {
        d.action = ASK;
        d.reason = 'attach this one yourself';
      }
      continue;
    }
    const result = await applyDecision(d);
    d.outcome = result.outcome;
    d.shown = result.shown;
    if (result.ok) {
      if (d.key) state.registry[d.key] = d.value;
    } else if (!isRepair) {
      // Left as-is for the repair sweep; the final action is set below.
    }
  }
  // After the last attempt, a field the page did not accept is the user's.
  if (isRepair) {
    for (const d of todo) {
      if (d.outcome !== 'ok') {
        d.action = ASK;
        d.reason = outcomeReason(d);
      }
    }
  }
  return decisions;
}

function outcomeReason(d) {
  switch (d.outcome) {
    case 'rejected': return `the form rejected "${d.value}"`;
    case 'empty': return 'we could not get this to stick';
    case 'mismatch': return `the form shows "${d.shown}" instead`;
    default: return 'we could not fill this one';
  }
}

// Documents already sent to an upload field during this run, by slot. Workday
// redraws the upload box after taking a file — a new <input type=file>, the
// filename only listed once its server has the file — and the pass that looks
// for fields revealed by an answer saw that redrawn box as a new, empty upload
// and attached the resume a second time. One document goes up once per run;
// "Autofill this page" starts a new run, where the filled-upload check applies.
const attachedThisRun = new Set();

async function attachDocument(decision, ctx) {
  const slot = decision.slot;
  if (slot && attachedThisRun.has(slot)) {
    console.info(`[TailorCV] ${slot} already attached this run — skipping "${decision.label}"`);
    return { ok: true, shown: 'already attached' };
  }
  console.info(`[TailorCV] attaching ${slot || 'a document'} to "${decision.label}"`);
  const res = await send({ type: 'AF_GET_RESUME_FILE', doc: slot });
  if (res.error || !res.data || !res.data.base64) {
    return { ok: false, shown: '' };
  }
  const { base64, filename, mime } = res.data;
  let file;
  try {
    file = fileFromBase64(base64, filename, mime);
  } catch (e) {
    return { ok: false, shown: '' };
  }

  const target = decision.row.el;
  void ctx;

  // A drop-target with no file input of its own. There is nothing to write to,
  // so the drop event IS the mechanism — and there is also nothing to read back,
  // so success cannot be verified the way an input's .files can be. Reported as
  // needing the user's eyes rather than as done, because an unverifiable attach
  // claimed as successful is exactly the lie this whole layer avoids.
  if (decision.row.dropOnly) {
    const dropped = dropFile(target, file);
    if (slot && dropped) attachedThisRun.add(slot);
    await sleep(TIMING.settleMs + 120);
    return { ok: false, shown: dropped ? `${file.name} (check it attached)` : '' };
  }

  const set = attachFile(target, file);
  if (slot) attachedThisRun.add(slot);

  // Uppy, Dropzone and FilePond listen for `drop` and never for `change`, so
  // the zone is the fallback — but only when the input write itself failed.
  // An input that took the file and is now empty was EMPTIED BY THE PAGE, which
  // is how Workday says "got it"; dropping the file on the zone as well
  // uploaded the resume twice.
  if (!set) {
    const zone = findDropZone(target);
    if (zone) dropFile(zone, file);
  }
  // Taken when the input still holds it, or when the page shows its name —
  // Workday uploads first, then clears the input and lists the file, so
  // reading the input alone reported a finished upload as a failure.
  const deadline = Date.now() + TIMING.uploadConfirmMs;
  let attached = false;
  await sleep(TIMING.settleMs + 120);
  for (;;) {
    attached = !!(target.files && target.files.length) || hasUploadedFile(target);
    if (attached || Date.now() >= deadline) break;
    await sleep(150);
  }
  const formRead = await waitWhileReadingResume(target);
  // What the page shows is the verdict, however the file got there.
  return { ok: attached, shown: attached ? file.name : '', formRead };
}

/**
 * Some ATSs read an uploaded resume and pre-fill the form from it. Oracle's
 * "Import your profile" upload does, and disables itself while it reads
 * (`disable: isResumeParsingInProgress` in its markup). Confirmed on JPMC:
 * uploading the resume by hand filled name, country and state, and cleared a
 * Title picked before it. The run reads the form only after this returns, so
 * what the import filled is left alone and only the gaps are filled.
 * An upload that never disables itself costs a 300 ms look. Returns whether
 * the form read the resume.
 */
async function waitWhileReadingResume(input) {
  await sleep(TIMING.resumeParseStartMs);
  if (!input || !input.isConnected || !input.disabled) return false;
  console.info('[TailorCV] the form is reading the resume — waiting for it to finish before filling on');
  const deadline = Date.now() + TIMING.resumeParseMaxMs;
  while (input.isConnected && input.disabled && Date.now() < deadline) await sleep(250);
  await sleep(TIMING.settleMs + 300);    // let it write what it read
  return true;
}

// ── answering a field from the sidebar ───────────────────────

/**
 * Write an answer the user typed into the panel, and optionally remember it.
 *
 * Remembering is opt-in per answer and defaults off for anything sensitive —
 * those belong in their profile as one deliberate answer, not captured from
 * whatever they typed into one employer's form.
 */
export async function answerField(decision, value, remember) {
  decision.value = String(value == null ? '' : value);
  const result = await applyDecision(decision);
  decision.outcome = result.outcome;
  decision.shown = result.shown;
  if (result.ok) {
    decision.action = FILL;
    decision.source = 'you';
    decision.confidence = 1;
    decision.reason = 'you answered this';
    if (decision.key) {
      state.registry[decision.key] = decision.value;
      state.answeredByUser[decision.key] = decision.value;
      if (!state.userEdited.includes(decision.key)) state.userEdited.push(decision.key);
    }
    await saveState();
  } else {
    decision.reason = outcomeReason(decision);
  }

  if (remember && result.ok
      && !decision.sensitive && !classifySensitive(decision.label)
      && !isNeverFill(decision.label) && !looksSecret(decision.value)) {
    await send({ type: 'AF_SAVE_ANSWERS', payload: { answers: [
      { question: decision.label, answer: decision.value },
    ] } });
  }
  return result;
}

/** Save answers the user has already typed into the page themselves. */
export async function rememberAnswers(items) {
  const answers = (items || [])
    .filter(i => i && i.question && i.answer)
    .map(i => ({ question: i.question, answer: i.answer }))
    .slice(0, 25);
  if (!answers.length) return { saved: 0 };
  const res = await send({ type: 'AF_SAVE_ANSWERS', payload: { answers } });
  return (res && res.data) || { saved: 0 };
}

export { FILL, SUGGEST, ASK, PROFILE, DOCUMENT, SKIP };
