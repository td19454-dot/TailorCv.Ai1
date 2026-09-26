// esbuild entry for the autofill bundle.
//
// Bundled into autofill.bundle.js and loaded by the manifest BEFORE content.js,
// which consumes it through the single `window.__tcvAutofill` global with a
// feature check — so if this bundle fails to load for any reason, the extension
// degrades to exactly its previous behaviour rather than breaking.
//
// It also loads in sub-frames (see the frames-only content_scripts entry in
// manifest.json), because Greenhouse and Lever embed their form in an iframe on
// company-branded domains. In a sub-frame there is no sidebar and no
// job-description reading: the frame only answers messages about the form it
// contains.

import '../../auto_apply/field_probe.js';

import {
  findForm, isApplicationPage, describeFields, detectAts, reprobe, diagnose, looksLikeApplyUrl,
} from './autofill/discover.js';
import { decide, summarize, fieldsForServer, ASK, FILL, SUGGEST, PROFILE, DOCUMENT, SKIP }
  from './autofill/plan.js';
import {
  runAutofill, resumeIfContinuing, nextPage, clearState, getState,
  watchUserEdits, stopWatchingUserEdits, answerField, learnableAnswers, rememberAnswers,
} from './autofill/run.js';
import * as ui from './autofill/ui.js';
import * as match from './autofill/match.js';

const isTopFrame = globalThis.window === globalThis.window.parent;

/**
 * A decision as plain data, for crossing the frame boundary.
 *
 * Needed because a decision holds live element references, and structured clone
 * cannot carry a DOM node between frames. The top frame therefore renders from
 * these copies and refers back to the originals by index — which is why
 * lastRunDecisions below is kept.
 */
function serializeDecision(d, index) {
  return {
    index,
    key: d.key,
    label: d.label,
    kind: d.kind,
    required: d.required,
    sensitive: d.sensitive,
    slot: d.slot,
    action: d.action,
    value: d.value,
    source: d.source,
    confidence: d.confidence,
    reason: d.reason,
    outcome: d.outcome,
    shown: d.shown,
    options: (d.options || []).map(o => (typeof o === 'string' ? o : o.label)).filter(Boolean),
  };
}

// The decisions from the last run IN THIS FRAME, so the top frame can act on one
// by index without needing the element itself.
let lastRunDecisions = [];

/**
 * Handle a request aimed at the form in THIS frame.
 *
 * The top frame owns the sidebar; whichever frame holds the form owns the DOM.
 * Both run this same bundle, so a form inside an iframe is filled by exactly the
 * code path that fills one in the top document — there is no second
 * implementation for the embedded case.
 */
async function handleFrameMessage(msg) {
  switch (msg && msg.type) {
    case 'AF_PING': {
      const form = isApplicationPage();
      return form
        ? { found: true, fieldCount: (form.fields || []).length, url: globalThis.location.href,
            ats: form.ats }
        : { found: false };
    }
    case 'AF_FRAME_APPLY': {
      const result = await runAutofill(msg.ctx, null);
      lastRunDecisions = result.decisions || [];
      return {
        error: result.error,
        counts: result.counts,
        page: result.page,
        ats: result.ats,
        opaqueHosts: result.opaqueHosts,
        serverError: result.serverError,
        decisions: lastRunDecisions.map(serializeDecision),
        learnable: learnableAnswers(lastRunDecisions).map(l => ({
          key: l.key, question: l.question, answer: l.answer,
        })),
      };
    }
    case 'AF_FRAME_ANSWER': {
      const d = lastRunDecisions[msg.index];
      if (!d) return { error: 'stale_index' };
      const res = await answerField(d, msg.value, msg.remember);
      return { ok: res.ok, outcome: res.outcome, shown: res.shown,
               decision: serializeDecision(d, msg.index) };
    }
    case 'AF_FRAME_JUMP': {
      const d = lastRunDecisions[msg.index];
      if (!d) return { error: 'stale_index' };
      ui.jumpTo(d);
      return { ok: true };
    }
    case 'AF_FRAME_REMEMBER':
      return await rememberAnswers(msg.items);
    case 'AF_FRAME_CLEAR':
      ui.clearHighlights();
      return { ok: true };
    default:
      return null;
  }
}

if (!globalThis.__tcvAutofill) {
  globalThis.__tcvAutofill = {
    // Detection — cheap enough for content.js to call on every render.
    isApplicationPage,
    findForm,
    detectAts,
    looksLikeApplyUrl,
    diagnose,
    isTopFrame,
    serializeDecision,

    // The run.
    runAutofill,
    resumeIfContinuing,
    nextPage,
    clearState,
    getState,
    answerField,
    rememberAnswers,
    learnableAnswers,
    watchUserEdits,
    stopWatchingUserEdits,

    // Inspection, for the panel and for debugging a page by hand.
    describeFields,
    decide,
    summarize,
    fieldsForServer,
    reprobe,

    // The panel.
    ui,
    ACTIONS: { ASK, FILL, SUGGEST, PROFILE, DOCUMENT, SKIP },

    // Exposed so a page can be diagnosed from the console without a rebuild —
    // the same reasoning as content.js's logDiagnostics(): a real page's own
    // shape is worth more than any amount of guessing from outside the browser.
    match,

    selfTest,
    handleFrameMessage,
  };
}

/**
 * Run the whole pipeline against the page and report it, without a login.
 *
 * For the fixture pages in test/fixtures/pages, which exist to cover what jsdom
 * cannot: real layout (so geometric visibility is exercised), a real
 * DataTransfer (so an upload genuinely attaches), and a portal-rendered
 * react-select menu. The page supplies `__tcvFixtureCtx` (an answer bank) and
 * optionally `__tcvFixtureExpect` ({key: expectedAction}), so this needs no
 * server and no session.
 *
 * Dev-only by construction: it does nothing unless the page declares
 * __tcvFixtureCtx, so it cannot be triggered on a real application form.
 */
async function selfTest() {
  const ctx = globalThis.__tcvFixtureCtx;
  if (!ctx) {
    console.warn('[TailorCV] selfTest() needs window.__tcvFixtureCtx — see test/fixtures/pages');
    return null;
  }
  // Stub the background worker: the fixture pages run as plain file/http pages
  // with no extension messaging behind them.
  const plan = globalThis.__tcvFixturePlan || { answers: {} };
  const bytes = globalThis.__tcvFixtureResume
    || 'JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDM+PnN0cmVhbQpCVAplbmRzdHJlYW0=';
  const realSend = globalThis.chrome && globalThis.chrome.runtime
    && globalThis.chrome.runtime.sendMessage;
  const stub = (msg, cb) => {
    const reply = {
      AF_PLAN: { data: plan },
      AF_GET_RESUME_FILE: { data: { base64: bytes, filename: 'fixture.pdf',
                                    mime: 'application/pdf' } },
      AF_SAVE_ANSWERS: { data: { saved: 0 } },
    }[msg.type] || { data: null };
    cb(reply);
  };
  if (!globalThis.chrome) globalThis.chrome = { runtime: {} };
  if (!globalThis.chrome.runtime) globalThis.chrome.runtime = {};
  globalThis.chrome.runtime.sendMessage = stub;

  try {
    await clearState();
    const result = await runAutofill(ctx, p => console.log('[TailorCV]', p.phase, p.detail || ''));
    const expected = globalThis.__tcvFixtureExpect || {};
    const rows = (result.decisions || []).map(d => ({
      field: d.label,
      action: d.action,
      expected: expected[d.key] || expected[d.label] || '(unspecified)',
      match: !expected[d.key] && !expected[d.label]
        ? '—'
        : ((expected[d.key] || expected[d.label]) === d.action ? 'OK' : 'MISMATCH'),
      value: String(d.value || '').slice(0, 50),
      verified: d.outcome || '',
      why: d.reason || '',
    }));
    console.table(rows);
    const bad = rows.filter(r => r.match === 'MISMATCH');
    const unverified = rows.filter(r => r.value && r.verified && r.verified !== 'ok');
    console.log(`[TailorCV] ${rows.length} fields · ${bad.length} mismatched `
      + `· ${unverified.length} written but not verified`);
    if (bad.length) console.warn('[TailorCV] mismatches:', bad);
    if (unverified.length) console.warn('[TailorCV] unverified:', unverified);
    ui.highlight(result.decisions || []);
    return { result, rows, mismatches: bad, unverified };
  } finally {
    if (realSend) globalThis.chrome.runtime.sendMessage = realSend;
  }
}

// Sub-frames answer messages and do nothing else. The top frame's listener lives
// in content.js, alongside the rest of the panel's messaging.
if (!isTopFrame && globalThis.chrome && globalThis.chrome.runtime) {
  globalThis.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !String(msg.type || '').startsWith('AF_')) return undefined;
    handleFrameMessage(msg).then(res => sendResponse(res || {}));
    return true;   // keep the channel open for the async reply
  });

  // Announce a form in this frame so the top frame can find it without the
  // webNavigation permission — see discoverFormFrames in background.js. Delayed
  // because an embedded application form is usually rendered by the frame's own
  // JS after load, and retried once for the slower ones.
  const announce = () => {
    let form = null;
    try { form = isApplicationPage(); } catch (e) { form = null; }
    if (!form) return false;
    try {
      globalThis.chrome.runtime.sendMessage({
        type: 'AF_FRAME_ANNOUNCE',
        fieldCount: (form.fields || []).length,
        url: globalThis.location.href,
        ats: form.ats,
      });
    } catch (e) { /* the worker is asleep; the retry covers it */ }
    return true;
  };
  setTimeout(() => { if (!announce()) setTimeout(announce, 2500); }, 800);
}
