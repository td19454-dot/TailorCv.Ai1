// Workday "My Experience": Work Experience 1, 2, … filled from the profile's
// job list, and Education 1, 2, … from its school list, pressing each
// section's own "Add" / "Add Another" for every further entry.
//
// Markup (real PwC capture, Oct 2026):
//
//   <div role="group" aria-labelledby="Work-Experience-section">
//     <h4 id="Work-Experience-section">Work Experience</h4>
//     <div role="group" aria-labelledby="Work-Experience-1-panel">
//       <h5 id="Work-Experience-1-panel">Work Experience 1</h5>
//       formField-jobTitle / companyName / location / currentlyWorkHere /
//       startDate + endDate (month + year spinbuttons) / roleDescription
//     </div>
//     … <button data-automation-id="add-button">Add Another</button>
//   </div>
//
// Education is the same shape: "Education" / "Education N" blocks holding
// School or University, Degree (a dropdown), Field of Study, Overall Result
// (GPA), and From / To (Actual or Expected) as year-only spinbuttons. Both
// sections start with no block and an "Add" button until the first is added.
//
// Every section (Education, Websites, Certifications…) has an identical
// add-button, so the button is only ever taken from inside this section.
//
// Why the general planner can't do this: it answers each box as one question,
// so every block's "Job Title" got the current job. And the page-wide scan
// merges the blocks' "I currently work here" boxes into one field because
// they share name="currentlyWorkHere" — so each block is read on its own here.

import { describeFields, isVisible, readComboboxOptions } from './discover.js';
import { applyDecision } from './write.js';
import { tileAnswer, press } from './tiles.js';
import { FILL, ASK } from './plan.js';
import { classifySensitive } from './match.js';
import { TIMING, sleep } from './timing.js';

const probe = () => globalThis.__tcvFieldProbe;
const MAX_JOBS = 20;   // the profile page's own cap (routers/profile_page.py MAX_JOBS)
const MAX_SCHOOLS = 10;   // routers/profile_page.py MAX_SCHOOLS

function headingText(group) {
  const id = group.getAttribute('aria-labelledby') || '';
  const doc = group.ownerDocument || globalThis.document;
  const h = id && doc.getElementById(id);
  return ((h && h.textContent) || '').replace(/\s+/g, ' ').trim();
}

function sectionByHeading(re, doc) {
  const d = doc || globalThis.document;
  for (const g of d.querySelectorAll('[role="group"][aria-labelledby]')) {
    if (re.test(headingText(g))) return g;
  }
  return null;
}

/** The Work Experience section, or null. */
export function experienceSection(doc) {
  return sectionByHeading(/^(work )?experience$/i, doc);
}

/** The Education section, or null. */
export function educationSection(doc) {
  return sectionByHeading(/^education$/i, doc);
}

/** A section's numbered blocks ("Work Experience 2", "Education 1"), in page order. */
export function sectionPanels(section) {
  return Array.from(section.querySelectorAll('[role="group"][aria-labelledby]'))
    .filter(g => /\b\d+$/.test(headingText(g)) && g.parentElement
                 && g.parentElement.closest('[role="group"][aria-labelledby]') === section);
}

export const experiencePanels = sectionPanels;

/** "Add Another" sits outside every block, so its nearest labelled group is the section. */
function addButton(section) {
  return Array.from(section.querySelectorAll('button'))
    .find(b => /^add( another)?$/i.test((b.textContent || '').trim())
               && b.closest('[role="group"][aria-labelledby]') === section) || null;
}

/** Whether a described row sits inside the section — the general planner skips these. */
export function inSection(section, row) {
  if (!section || !row) return false;
  const els = (row.members && row.members.length ? row.members : [row.el]).filter(Boolean);
  return els.some(el => section.contains(el));
}

function panelRows(panel) {
  const p = probe();
  if (!p) return [];
  const els = p.fillableIn(panel).elements.filter(isVisible);
  // Each row is found again inside this block, never another block's field
  // of the same name — see reresolve() in discover.js.
  return describeFields({ root: panel, fields: els }).map(r => Object.assign(r, { scope: panel }));
}

/** "04/2023" / "2023-04" → "2023-04-01" for the split-date writer; else ''. */
function isoMonth(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`;
  m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  return '';
}

/** "2023" → "2023-01-01": the split-date writer fills only the boxes a date has. */
function isoYear(v) {
  const y = (String(v || '').match(/\b(19|20)\d{2}\b/) || [])[0];
  return y ? `${y}-01-01` : '';
}

/** What one box of a block gets from `entry`, or null to leave it. */
export function experienceAnswer(row, entry) {
  const label = String(row.label || '').replace(/\*\s*$/, '').trim();
  if (row.kind === 'date-parts') {
    if (/\b(from|start|begin)/i.test(label)) return isoMonth(entry.from) || null;
    if (/\b(to|end)\b/i.test(label)) return entry.current ? null : (isoMonth(entry.to) || null);
    return null;
  }
  if (row.kind === 'checkbox') return /current/i.test(label) && entry.current ? 'Yes' : null;
  if (/\blocation\b|\bcity\b/i.test(label)) return entry.location || null;
  const shapes = tileAnswer('experience', label, entry);
  return shapes && shapes.length ? shapes[0] : null;
}

/**
 * What one box of an Education block gets from `entry`: [value, ...other
 * shapes], or null to leave it. Degree comes back in every phrasing a list
 * might use ("Bachelor's Degree" for "B.Tech"); From / To are years only.
 */
export function educationAnswer(row, entry) {
  const label = String(row.label || '').replace(/\*\s*$/, '').trim();
  if (row.kind === 'date-parts') {
    if (/\b(from|start|begin)/i.test(label)) return isoYear(entry.from) ? [isoYear(entry.from)] : null;
    if (/\b(to|end|graduat|complet)/i.test(label)) return isoYear(entry.to) ? [isoYear(entry.to)] : null;
    return null;
  }
  if (row.kind === 'checkbox') return null;
  const shapes = tileAnswer('education', label, entry);
  return shapes && shapes.length ? shapes : null;
}

// The two sections, as the shared filler below needs them.
const SECTIONS = {
  experience: {
    find: experienceSection,
    max: MAX_JOBS,
    noun: 'job',
    title: 'Experience',
    shapes: (row, entry) => { const v = experienceAnswer(row, entry); return v ? [v] : null; },
    // Workday's resume read fills the company first; a block showing one is
    // matched to that job wherever it is in the list.
    identityRe: /company|employer|organi[sz]ation/i,
    identity: e => e.company,
    describe: e => [e.title, e.company].filter(Boolean).join(' · '),
    describeFull: e => [e.title, e.company, e.location, e.current ? `${e.from || ''} – present` : [e.from, e.to].filter(Boolean).join(' – ')]
      .filter(Boolean).join(' · '),
    currentBox: true,
  },
  education: {
    find: educationSection,
    max: MAX_SCHOOLS,
    noun: 'school',
    title: 'Education',
    shapes: educationAnswer,
    identityRe: /school|university|college|institution/i,
    identity: e => e.school,
    describe: e => [e.school, e.degree].filter(Boolean).join(' · '),
    describeFull: e => [e.school, e.degree, e.field, [e.from, e.to].filter(Boolean).join(' – ')]
      .filter(Boolean).join(' · '),
    currentBox: false,
  },
};

/**
 * Fill one block from `entry`: only empty boxes. For Work Experience the
 * "currently work here" box goes first and the block is re-read after it,
 * because ticking it removes or disables "To" on Workday.
 */
async function fillPanel(panel, entry, spec, ask) {
  const filled = [];
  const byAi = [];
  let rows = panelRows(panel);
  const current = spec.currentBox && rows.find(r => r.kind === 'checkbox' && /current/i.test(r.label || ''));
  if (current && entry.current && !current.filled) {
    const res = await applyDecision({ row: current, value: 'Yes', candidates: ['Yes'], label: current.label });
    if (res.ok) filled.push('Currently work here');
    else log(spec, `"${current.label}" did not take (${res.outcome})`);
    await sleep(TIMING.settleMs + 100);
    rows = panelRows(panel);
  }
  for (const row of rows) {
    if (row.kind === 'checkbox' || row.kind === 'file') continue;
    if (row.filled && !row.invalid) continue;            // what Workday filled stays
    const name = String(row.label || '').replace(/\s*\*$/, '');
    const shapes = spec.shapes(row, entry);
    let res = null;
    if (shapes && shapes.length) {
      const decision = { row, value: shapes[0], candidates: shapes, label: row.label };
      // A degree list is chosen from with the planner's own rules (same level
      // only — never "Master's" for "Bachelor's"), not by resemblance.
      if (spec === SECTIONS.education && /degree|qualification/i.test(row.label || '')) {
        decision.readFirst = { key: 'degree', stored: entry.degree };
      }
      res = await applyDecision(decision);
      if (res.ok) { filled.push(name); continue; }
      log(spec, `"${row.label}" did not take (${res.outcome})`);
    }
    // A required list the rules could not answer: the model chooses one of its
    // options for this entry. Visa's degree list is worded by ISCED level and
    // stayed "Select One" — and stopped auto-apply — with nothing else to try.
    const picked = await askModel(row, entry, spec, ask);
    if (picked) { filled.push(name); byAi.push(name); }
  }
  filled.byAi = byAi;
  return filled;
}

const LIST_KINDS = new Set(['combobox', 'select', 'radio', 'choice']);

/** One required list answered by the model from this entry; true when it took. */
async function askModel(row, entry, spec, ask) {
  if (typeof ask !== 'function' || !row.required || !LIST_KINDS.has(row.kind)) return false;
  if (classifySensitive(row.label)) return false;
  let options = (row.options || []).map(o => (typeof o === 'string' ? o : o && o.label)).filter(Boolean);
  if (!options.length && row.kind === 'combobox') {
    try { options = await readComboboxOptions(row); } catch (e) { options = []; }
  }
  if (!options.length) return false;
  let value = null;
  try { value = await ask(row, spec.describeFull(entry), options); } catch (e) { value = null; }
  if (!value) return false;
  const res = await applyDecision({ row, value, candidates: [value], label: row.label });
  if (!res.ok) log(spec, `"${row.label}": the model's "${value}" did not take (${res.outcome})`);
  return !!res.ok;
}

function stillMissing(panel) {
  return panelRows(panel).filter(r => r.required && (!r.filled || r.invalid))
    .map(r => String(r.label || '').replace(/\s*\*$/, ''));
}

async function waitFor(fn, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(100);
  }
}

/**
 * Fill the Work Experience section from ctx.facts.workExperience. Returns one
 * decision per job for the results panel: FILL when the block holds it, ASK
 * with the reason otherwise. Never presses Save and Continue.
 */
export function fillExperienceSection(ctx, progress, doc, ask) {
  const jobs = (ctx && ctx.facts && ctx.facts.workExperience) || [];
  return fillSection(SECTIONS.experience, jobs, progress, doc, ask);
}

/**
 * Fill the Education section from ctx.facts.educationEntries, the same way.
 * The first school takes the profile's single GPA when it has none of its own
 * — that GPA is the one every single-box form already gets.
 */
export function fillEducationSection(ctx, progress, doc, ask) {
  const facts = (ctx && ctx.facts) || {};
  const bankGpa = String(((ctx && ctx.answerBank) || {}).gpa || '').trim();
  const schools = (facts.educationEntries || [])
    .map((s, i) => (i === 0 && !s.gpa && bankGpa ? Object.assign({}, s, { gpa: bankGpa }) : s));
  return fillSection(SECTIONS.education, schools, progress, doc, ask);
}

async function fillSection(spec, allEntries, progress, doc, ask) {
  const section = spec.find(doc);
  const entries = (allEntries || []).slice(0, spec.max);
  if (!section || !entries.length) return [];

  const out = [];
  const decisionFor = (entry, n) => {
    const d = { key: `repeater:${spec === SECTIONS.education ? 'education' : 'experience'}:${n}`,
                kind: 'tile', row: { el: section, kind: 'tile' },
                label: `${spec.title}: ${spec.describe(entry) || `${spec.noun} ${n + 1}`}`,
                action: ASK, value: '', source: '', reason: '', outcome: '' };
    out.push(d);
    return d;
  };
  const finish = (d, panel, filled) => {
    const missing = stillMissing(panel);
    if (missing.length) {
      d.reason = `still needs: ${missing.join(', ')} — fix it yourself`;
      return;
    }
    d.action = FILL; d.source = 'profile'; d.outcome = 'ok';
    d.value = d.shown = filled.length ? filled.join(' · ') : 'already filled';
    if (filled.byAi && filled.byAi.length) {
      d.source = 'ai_forced';
      d.reason = `${filled.byAi.join(', ')} picked by AI from your resume — check ${filled.byAi.length === 1 ? 'it' : 'them'}`;
    }
  };

  // Block N takes entry N (profile order, newest first, as the resume lists
  // them). Counted, never skipped: an earlier version skipped a block that
  // already had text it didn't recognise and put that job in a NEW block, so
  // block 1 stayed half-filled and job 1 landed in block 2 (PwC, Oct 2026).
  const existing = sectionPanels(section);
  log(spec, `${existing.length} block(s) on the page, ${entries.length} ${spec.noun}(s) in the profile`);
  const plan = assignEntries(existing.map(panelRows), entries, spec);
  const placed = new Set();
  for (let b = 0; b < existing.length; b++) {
    const a = plan[b];
    if (a.job == null) {
      if (a.reason) log(spec, `block ${b + 1}: left alone — ${a.reason}`);
      continue;
    }
    placed.add(a.job);
    const entry = entries[a.job];
    const d = decisionFor(entry, a.job);
    log(spec, `block ${b + 1} ← ${spec.noun} ${a.job + 1} (${spec.describe(entry)})${a.why ? ' — ' + a.why : ''}`);
    if (progress) progress('filling', { detail: d.label });
    finish(d, existing[b], await fillPanel(existing[b], entry, spec, ask));
  }

  // The entries without a block: one "Add Another" each. With no block on the
  // page at all, the first press ("Add") opens block 1.
  const rest = entries.map((e, i) => i).filter(i => !placed.has(i));
  for (let r = 0; r < rest.length; r++) {
    const i = rest[r];
    const d = decisionFor(entries[i], i);
    const add = addButton(section);
    if (!add) {
      d.reason = `could not find "Add Another" — add this ${spec.noun} yourself`;
      continue;
    }
    const before = sectionPanels(section).length;
    press(add);
    const ok = await waitFor(() => sectionPanels(section).length > before, TIMING.tileOpenMs);
    if (!ok) {
      // Not pressed again: a second press that lands late would add an empty block.
      d.reason = `pressing "Add Another" did not add a block — add this ${spec.noun} yourself`;
      for (const j of rest.slice(r + 1)) decisionFor(entries[j], j).reason = `add this ${spec.noun} yourself`;
      log(spec, `"Add Another" did not add a block (still ${before}) — stopped`);
      break;
    }
    await sleep(TIMING.settleMs + 150);
    const panel = sectionPanels(section)[before];
    log(spec, `added block ${before + 1} ← ${spec.noun} ${i + 1} (${spec.describe(entries[i])})`);
    if (progress) progress('filling', { detail: d.label });
    finish(d, panel, await fillPanel(panel, entries[i], spec, ask));
  }
  return out;
}

function log(spec, msg) {
  const name = spec === SECTIONS.education ? 'education' : 'work experience';
  try { console.info(`[TailorCV] ${name}: ${msg}`); } catch (e) { /* no console */ }
}

const normText = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The company (or school) a block already shows, or ''. */
function blockIdentity(rows, spec) {
  const r = rows.find(x => x.kind !== 'checkbox' && spec.identityRe.test(x.label || ''));
  return (r && r.filled && r.value) || '';
}

const sameName = (a, b) => {
  const x = normText(a), y = normText(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/**
 * Which entry each block on the page takes: [{ job: index|null, why, reason }].
 *
 *  - An empty block takes the next unplaced entry, in order.
 *  - A block that already shows a company (school) takes the entry with that
 *    name (Workday's resume read, or an earlier run), wherever it is in the list.
 *  - A block showing a name no entry has is left alone — it's someone's own
 *    entry, and filling its empty boxes from a different one would mix two.
 *  - Text but no name (a half-typed block): positional, like an empty one.
 */
function assignEntries(blocks, entries, spec) {
  const taken = new Set();
  const plan = blocks.map(rows => {
    const name = blockIdentity(rows, spec);
    if (!name) return { job: null, positional: true };
    const i = entries.findIndex((e, k) => !taken.has(k) && sameName(name, spec.identity(e)));
    if (i < 0) return { job: null, reason: `it already holds "${name}", which is not in your profile` };
    taken.add(i);
    return { job: i, why: `already shows ${name}` };
  });
  let next = 0;
  for (const a of plan) {
    if (!a.positional) continue;
    while (next < entries.length && taken.has(next)) next++;
    if (next >= entries.length) { a.job = null; continue; }
    taken.add(next);
    a.job = next++;
  }
  return plan;
}

/** Work Experience's block assignment (kept for callers and tests). */
export function assignJobs(blocks, jobs) {
  return assignEntries(blocks, jobs, SECTIONS.experience);
}
