// One dropdown's fill, step by step, for the console.
//
// A form that fails now and then cannot be fixed by reading the code: what matters
// is which step went wrong on that run, and which wait ran out. Measurement only,
// like the clock in timing.js. Nothing here changes what a fill does, and nothing
// here leaves the browser: field labels and answers stay in the console.
//
// Printed as text, not tables or objects: those paste out of the console as
// "Array(2)" and "Object".

const SLOW_MS = 3000;
const MAX_EVENTS = 80;
const MAX_KEPT = 80;
// Row changes closer together than this are one line, with a count. A 240-row
// country list marks every row at once, and listing each one used every slot
// before the fill's own steps could be recorded (Keka, Nov 2026).
const BURST_MS = 50;
const ROW_STEPS = new Set(['rows redrawn', 'row marked']);
const MAX_ROW_EVENTS = 20;

let current = null;
let finished = [];

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Rows redrawn, marked or ticked, and answers reaching the field, while this dropdown fills. */
function watchRows(el) {
  const doc = el && el.ownerDocument;
  const Observer = globalThis.MutationObserver;
  if (!doc || !doc.body || !Observer) return null;
  const p = globalThis.__tcvFieldProbe;
  const ROW = (p && p.OPTION_SEL) || '[role="option"]';
  const PILL = '[data-automation-id="selectedItem"]';
  const has = (node, sel) => node.nodeType === 1 && (node.matches(sel) || !!node.querySelector(sel));
  const ownPage = node => !(node.closest && node.closest('#tailorcv-sidebar'));
  const observer = new Observer((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (!ownPage(m.target) || !m.target.matches(ROW)) continue;
        const said = m.target.getAttribute(m.attributeName) || '';
        if (m.attributeName === 'aria-label') {
          if (/\bchecked\b/i.test(said) && !/\bnot checked\b/i.test(said)) note('row ticked', clean(said));
        } else {
          note('row marked', m.attributeName);
        }
        continue;
      }
      if (m.target.nodeType !== 1 || !ownPage(m.target)) continue;
      const added = Array.from(m.addedNodes);
      const pill = added.find(n => has(n, PILL));
      if (pill) note('answer on field', clean(pill.textContent));
      else if (added.concat(Array.from(m.removedNodes)).some(n => has(n, ROW))) note('rows redrawn');
    }
  });
  try {
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true,
                                 attributeFilter: ['aria-label', 'aria-selected', 'data-automation-selected'] });
  } catch (e) { return null; }
  return observer;
}

/** Start recording one dropdown's fill. */
export function beginTimeline(row) {
  if (current) endTimeline('unfinished');
  current = {
    field: clean(row && row.label).replace(/\s*\*$/, '').slice(0, 70),
    start: Date.now(),
    events: [],
    rowEvents: 0,
    rowHtml: '',
    observer: null,
  };
  try { current.observer = watchRows(row && row.el); } catch (e) { current.observer = null; }
}

/** A step of the dropdown being filled. Does nothing when none is. */
export function note(step, detail) {
  if (!current || current.events.length >= MAX_EVENTS) return;
  const at = Date.now() - current.start;
  const last = current.events[current.events.length - 1];
  if (ROW_STEPS.has(step)) {
    if (last && last.step === step && at - last.at < BURST_MS) {
      last.at = at;
      last.count = (last.count || 1) + 1;
      return;
    }
    if (current.rowEvents >= MAX_ROW_EVENTS) return;
    current.rowEvents++;
  }
  current.events.push({ at, step, detail: detail == null ? '' : String(detail) });
}

/** A wait that ended: which one, how long of how long, and whether it ran out. */
export function noteWait(name, limitMs, startedAt, ranOut) {
  if (!current) return;
  note(`wait ${name}`, `${Date.now() - startedAt} of ${limitMs} ms${ranOut ? ', RAN OUT' : ''}`);
}

/** The row pressed, as text, with its markup kept for a failure's report. */
export function noteClick(node, label) {
  if (!current) return;
  note('click', clean(label));
  try { current.rowHtml = String(node.outerHTML || '').slice(0, 600); } catch (e) { current.rowHtml = ''; }
}

const firstAt = (events, steps) => {
  const e = events.find(x => steps.includes(x.step));
  return e ? e.at : null;
};

/** Where one fill's time went, in milliseconds. A step that did not happen is null. */
export function summarize(t) {
  const ev = t.events;
  const clicks = ev.filter(e => e.step === 'click');
  const clickAt = clicks.length ? clicks[clicks.length - 1].at : null;
  let search = null;
  let open = null;
  let resultsAt = null;
  ev.forEach((e, i) => {
    if (open === null && (e.step === 'search' || e.step === 'wait list' || e.step === 'click')) open = e.at;
    if (e.step !== 'search') return;
    const done = ev.slice(i + 1).find(x => x.step === 'results' || x.step === 'search');
    if (done && done.step === 'results') {
      search = (search || 0) + (done.at - e.at);
      if (clickAt === null || done.at <= clickAt) resultsAt = done.at;
    }
  });
  const redraws = ev.filter(e => e.step === 'rows redrawn' && resultsAt !== null && e.at >= resultsAt
                                 && (clickAt === null || e.at <= clickAt));
  const settle = resultsAt === null ? null
    : (redraws.length ? redraws[redraws.length - 1].at - resultsAt : 0);
  const heldAt = clickAt === null ? null
    : ev.filter(e => e.at >= clickAt).find(e => e.step === 'answer on field' || e.step === 'held');
  const after = clickAt === null ? null : (heldAt ? heldAt.at : t.totalMs) - clickAt;
  return {
    field: t.field,
    open,
    search,
    settle,
    afterClick: after,
    total: t.totalMs,
    names: ev.filter(e => e.step === 'search').length,
    ranOut: ev.filter(e => /^wait /.test(e.step) && /RAN OUT/.test(e.detail)).length,
    result: t.outcome,
  };
}

/** One fill in full, one step a line. */
export function timelineText(t) {
  const lines = t.events.map(e => `  +${e.at} ${e.step}${e.count > 1 ? ` x${e.count}` : ''}${e.detail ? `: ${e.detail}` : ''}`);
  if (t.outcome !== 'ok' && t.rowHtml) lines.push(`  row clicked: ${t.rowHtml}`);
  return `[TailorCV] timeline: ${t.field} — ${t.outcome} in ${t.totalMs} ms\n${lines.join('\n')}`;
}

/**
 * Finish the dropdown being filled. Its steps print now, in order with the
 * failure report beside them, only when it failed or was slow: a long form's
 * every dropdown would bury the one worth reading.
 */
export function endTimeline(outcome) {
  const t = current;
  if (!t) return;
  current = null;
  try { if (t.observer) t.observer.disconnect(); } catch (e) { /* already gone */ }
  t.observer = null;
  t.totalMs = Date.now() - t.start;
  t.outcome = outcome || '';
  // A native <select> is set at once, with no list to tell of.
  if (!t.events.length) return;
  if (finished.length < MAX_KEPT) finished.push(t);
  if (t.outcome !== 'ok' || t.totalMs >= SLOW_MS) {
    try { console.info(timelineText(t)); } catch (e) { /* no console */ }
  }
}

/** A new run: the last one's dropdowns have been printed. */
export function clearTimelines() {
  finished = [];
}

/** The run's dropdowns, one line each, in the order they were filled. */
export function timelinesText() {
  if (!finished.length) return '';
  const ms = v => (v === null ? '-' : String(v));
  const lines = finished.map(summarize).map(s => `${s.result.padEnd(9)} total ${ms(s.total)} | open ${ms(s.open)} | `
    + `search ${ms(s.search)} (${s.names} name${s.names === 1 ? '' : 's'}) | settle ${ms(s.settle)} | `
    + `after click ${ms(s.afterClick)} | waits ran out ${s.ranOut} | ${s.field}`);
  return `[TailorCV] dropdown timelines (ms), in fill order:\n${lines.join('\n')}`;
}

export function printTimelines() {
  const text = timelinesText();
  if (text) { try { console.info(text); } catch (e) { /* no console */ } }
}
