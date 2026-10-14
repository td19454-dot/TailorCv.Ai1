// Workday "My Experience": Work Experience 1, 2, … filled from the profile's
// job list, pressing the section's own "Add Another" for each further job.
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
// Every section (Education, Websites, Certifications…) has an identical
// add-button, so the button is only ever taken from inside this section.
//
// Why the general planner can't do this: it answers each box as one question,
// so every block's "Job Title" got the current job. And the page-wide scan
// merges the blocks' "I currently work here" boxes into one field because
// they share name="currentlyWorkHere" — so each block is read on its own here.

import { describeFields, isVisible } from './discover.js';
import { applyDecision } from './write.js';
import { tileAnswer, press } from './tiles.js';
import { FILL, ASK } from './plan.js';
import { TIMING, sleep } from './timing.js';

const probe = () => globalThis.__tcvFieldProbe;
const MAX_JOBS = 20;   // the profile page's own cap (routers/profile_page.py MAX_JOBS)

function headingText(group) {
  const id = group.getAttribute('aria-labelledby') || '';
  const doc = group.ownerDocument || globalThis.document;
  const h = id && doc.getElementById(id);
  return ((h && h.textContent) || '').replace(/\s+/g, ' ').trim();
}

/** The Work Experience section, or null. */
export function experienceSection(doc) {
  const d = doc || globalThis.document;
  for (const g of d.querySelectorAll('[role="group"][aria-labelledby]')) {
    if (/^(work )?experience$/i.test(headingText(g))) return g;
  }
  return null;
}

/** The section's Work Experience N blocks, in page order. */
export function experiencePanels(section) {
  return Array.from(section.querySelectorAll('[role="group"][aria-labelledby]'))
    .filter(g => /\b\d+$/.test(headingText(g)) && g.parentElement
                 && g.parentElement.closest('[role="group"][aria-labelledby]') === section);
}

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
  return describeFields({ root: panel, fields: els });
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
 * Fill one block from `entry`: only empty boxes. The "currently work here" box
 * goes first and the block is re-read after it, because ticking it removes or
 * disables "To" on Workday.
 */
async function fillPanel(panel, entry) {
  const filled = [];
  let rows = panelRows(panel);
  const current = rows.find(r => r.kind === 'checkbox' && /current/i.test(r.label || ''));
  if (current && entry.current && !current.filled) {
    const res = await applyDecision({ row: current, value: 'Yes', candidates: ['Yes'], label: current.label });
    if (res.ok) filled.push('Currently work here');
    else log(`"${current.label}" did not take (${res.outcome})`);
    await sleep(TIMING.settleMs + 100);
    rows = panelRows(panel);
  }
  for (const row of rows) {
    if (row.kind === 'checkbox' || row.kind === 'file') continue;
    if (row.filled && !row.invalid) continue;            // what Workday filled stays
    const value = experienceAnswer(row, entry);
    if (!value) continue;
    const res = await applyDecision({ row, value, candidates: [value], label: row.label });
    if (res.ok) filled.push(String(row.label || '').replace(/\s*\*$/, ''));
    else log(`"${row.label}" did not take (${res.outcome})`);
  }
  return filled;
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
export async function fillExperienceSection(ctx, progress, doc) {
  const section = experienceSection(doc);
  const jobs = ((ctx && ctx.facts && ctx.facts.workExperience) || []).slice(0, MAX_JOBS);
  if (!section || !jobs.length) return [];

  const out = [];
  const decisionFor = (job, n) => {
    const d = { key: `repeater:experience:${n}`, kind: 'tile', row: { el: section, kind: 'tile' },
                label: `Experience: ${[job.title, job.company].filter(Boolean).join(' · ') || `job ${n + 1}`}`,
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
  };

  // Block N takes job N (profile order, newest first, as the resume lists
  // them). Counted, never skipped: an earlier version skipped a block that
  // already had text it didn't recognise and put that job in a NEW block, so
  // block 1 stayed half-filled and job 1 landed in block 2 (PwC, Oct 2026).
  const existing = experiencePanels(section);
  log(`${existing.length} block(s) on the page, ${jobs.length} job(s) in the profile`);
  const plan = assignJobs(existing.map(panelRows), jobs);
  const placed = new Set();
  for (let b = 0; b < existing.length; b++) {
    const a = plan[b];
    if (a.job == null) {
      if (a.reason) log(`block ${b + 1}: left alone — ${a.reason}`);
      continue;
    }
    placed.add(a.job);
    const job = jobs[a.job];
    const d = decisionFor(job, a.job);
    log(`block ${b + 1} ← job ${a.job + 1} (${job.company || job.title})${a.why ? ' — ' + a.why : ''}`);
    if (progress) progress('filling', { detail: d.label });
    finish(d, existing[b], await fillPanel(existing[b], job));
  }

  // The jobs without a block: one "Add Another" each. With no block on the
  // page at all, the first press opens Work Experience 1.
  const rest = jobs.map((job, i) => i).filter(i => !placed.has(i));
  for (let r = 0; r < rest.length; r++) {
    const i = rest[r];
    const d = decisionFor(jobs[i], i);
    const add = addButton(section);
    if (!add) {
      d.reason = 'could not find "Add Another" — add this job yourself';
      continue;
    }
    const before = experiencePanels(section).length;
    press(add);
    const ok = await waitFor(() => experiencePanels(section).length > before, TIMING.tileOpenMs);
    if (!ok) {
      // Not pressed again: a second press that lands late would add an empty block.
      d.reason = 'pressing "Add Another" did not add a block — add this job yourself';
      for (const j of rest.slice(r + 1)) decisionFor(jobs[j], j).reason = 'add this job yourself';
      log(`"Add Another" did not add a block (still ${before}) — stopped`);
      break;
    }
    await sleep(TIMING.settleMs + 150);
    const panel = experiencePanels(section)[before];
    log(`added block ${before + 1} ← job ${i + 1} (${jobs[i].company || jobs[i].title})`);
    if (progress) progress('filling', { detail: d.label });
    finish(d, panel, await fillPanel(panel, jobs[i]));
  }
  return out;
}

function log(msg) {
  try { console.info(`[TailorCV] work experience: ${msg}`); } catch (e) { /* no console */ }
}

const normText = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The company a block already shows, or ''. */
function blockCompany(rows) {
  const r = rows.find(x => x.kind !== 'checkbox' && /company|employer|organi[sz]ation/i.test(x.label || ''));
  return (r && r.filled && r.value) || '';
}

const sameCompany = (a, b) => {
  const x = normText(a), y = normText(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/**
 * Which job each block on the page takes: [{ job: index|null, why, reason }].
 *
 *  - An empty block takes the next unplaced job, in order.
 *  - A block that already shows a company takes the job with that company
 *    (Workday's resume read, or an earlier run), wherever it is in the list.
 *  - A block showing a company no job has is left alone — it's someone's own
 *    entry, and filling its empty boxes from a different job would mix two jobs.
 *  - Text but no company (a half-typed block): positional, like an empty one.
 */
export function assignJobs(blocks, jobs) {
  const taken = new Set();
  const plan = blocks.map(rows => {
    const company = blockCompany(rows);
    if (!company) return { job: null, positional: true };
    const i = jobs.findIndex((j, k) => !taken.has(k) && sameCompany(company, j.company));
    if (i < 0) return { job: null, reason: `it already holds "${company}", which is not in your profile` };
    taken.add(i);
    return { job: i, why: `already shows ${company}` };
  });
  let next = 0;
  for (const a of plan) {
    if (!a.positional) continue;
    while (next < jobs.length && taken.has(next)) next++;
    if (next >= jobs.length) { a.job = null; continue; }
    taken.add(next);
    a.job = next++;
  }
  return plan;
}
