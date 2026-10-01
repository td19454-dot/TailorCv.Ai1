// Oracle Candidate Experience: Education and Experience entries as tiles.
//
// Each entry is a summary tile ("Unnamed Major / Jadavpur University 12/2027 /
// Fields to fix: 1") with an Edit button that opens the entry's form inline,
// and Save / Cancel under it. Oracle builds these tiles from the resume it
// imported, and flags the ones missing a required answer (Degree, here).
//
// So, per tile the form flags: find the entry in the person's profile it is
// (by school / company and dates — never guessed), open it, fill ONLY the boxes
// that are empty or rejected (what Oracle filled is left as it filled it), save,
// and check the tile is no longer flagged. A tile with no clear match, or one
// that will not save, is handed to the person with the reason.
//
// Markup from a real JPMC capture — see discover.js TILE_BLOCK_SEL.

import { describeFields, profileTileBlocks, TILE_SEL, isNodeVisible, isVisible, readComboboxOptions }
  from './discover.js';
import { applyDecision } from './write.js';
import { candidatesFor, coerce, FILL, ASK } from './plan.js';
import { TIMING, sleep } from './timing.js';

const probe = () => globalThis.__tcvFieldProbe;
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

function tileText(tile) {
  const summary = tile.querySelector('.apply-flow-profile-item-tile__summary');
  return ((summary && summary.getAttribute('aria-label')) || tile.textContent || '').replace(/\s+/g, ' ').trim();
}

function tileFlagged(tile) {
  return tile.classList.contains('apply-flow-profile-item-tile--invalid')
    || /fields to fix/i.test(tile.textContent || '');
}

function tileTitle(tile) {
  const t = tile.querySelector('.apply-flow-profile-item-tile__summary-title');
  const s = tile.querySelector('.apply-flow-profile-item-tile__summary-subtitle');
  return [t && t.textContent, s && s.textContent].map(x => (x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean).join(' · ');
}

/**
 * The profile entry a tile is, or null. Scored on what the tile shows: the
 * school / company name (strong), then years. Needs a clear winner — two
 * entries scoring the same is "not sure", and a wrong entry's degree in a
 * tile is worse than an unfilled one.
 */
export function matchTileEntry(kind, text, entries) {
  const t = norm(text);
  const years = new Set(String(text).match(/\b(19|20)\d{2}\b/g) || []);
  const scored = (entries || []).map((e, i) => {
    let score = 0;
    const name = norm(kind === 'education' ? e.school : e.company);
    if (name && t.includes(name)) score += 3;
    if (kind === 'experience' && e.title && t.includes(norm(e.title))) score += 3;
    const yearOf = v => (String(v || '').match(/\b(19|20)\d{2}\b/) || [])[0];
    if (yearOf(e.to) && years.has(yearOf(e.to))) score += 2;
    if (yearOf(e.from) && years.has(yearOf(e.from))) score += 1;
    return { e, i, score };
  }).sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < 2) return null;
  if (scored[1] && scored[1].score === scored[0].score) return null;
  return scored[0].e;
}

function monthShapes(mmYYYY) {
  const m = String(mmYYYY || '').match(/^(\d{1,2})\//);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 12) return null;
  const name = MONTHS[n - 1];
  return [name, name.slice(0, 3), String(n).padStart(2, '0'), String(n)];
}

const yearOf = v => (String(v || '').match(/\b(19|20)\d{2}\b/) || [])[0] || '';

/** What goes in one box of the entry's form, as [value, ...other shapes], or null. */
export function tileAnswer(kind, label, entry) {
  const l = String(label || '').toLowerCase();
  const isStart = /\b(start|from|begin)/.test(l);
  const isEnd = /\b(end|to|graduat|complet)/.test(l);
  if (/\bmonth\b/.test(l) && (isStart || isEnd)) {
    const shapes = monthShapes(isStart ? entry.from : entry.to);
    return shapes;
  }
  if (/\byear\b/.test(l) && (isStart || isEnd)) {
    const y = yearOf(isStart ? entry.from : entry.to);
    return y ? [y] : null;
  }
  if (kind === 'education') {
    if (/degree|qualification/.test(l)) return entry.degree ? candidatesFor('degree', entry.degree) : null;
    if (/area of study|major|field of study|discipline|speciali|subject/.test(l)) return entry.field ? [entry.field] : null;
    if (/school|university|college|institution|establishment/.test(l)) return entry.school ? [entry.school] : null;
    return null;
  }
  if (/job title|\btitle\b|position|role|designation/.test(l)) return entry.title ? [entry.title] : null;
  if (/company|employer|organi[sz]ation/.test(l)) return entry.company ? [entry.company] : null;
  if (/description|responsibilit|duties|summary|achievement/.test(l)) return entry.description ? [entry.description] : null;
  if (/current/.test(l)) return entry.current ? ['Yes'] : null;
  return null;
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

function openEditor(block) {
  const f = block.querySelector('.profile-item-content--form');
  return f && isNodeVisible(f) ? f : null;
}

/**
 * Press a tile's Edit / Save / Cancel. Oracle's are <button>s with no type
 * inside the application <form>, so a click is also a submit; Oracle's own
 * handler cancels it, but pressing one must never be able to submit the
 * application, so a submit during the press is cancelled here as well.
 */
function press(el) {
  const doc = el.ownerDocument || globalThis.document;
  const noSubmit = e => { e.preventDefault(); e.stopPropagation(); };
  doc.addEventListener('submit', noSubmit, true);
  try {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* no layout */ }
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try {
        el.dispatchEvent(new globalThis.MouseEvent(type, { bubbles: true, cancelable: true, view: globalThis.window || null }));
      } catch (e) { /* ignore */ }
    }
    // The click itself: its default (the implicit submit) is cancelled after
    // the page's own handlers have run.
    const click = new globalThis.MouseEvent('click', { bubbles: true, cancelable: true, view: globalThis.window || null });
    const cancelDefault = e => { if (e === click) e.preventDefault(); };
    doc.defaultView.addEventListener('click', cancelDefault);
    try { el.dispatchEvent(click); } finally { doc.defaultView.removeEventListener('click', cancelDefault); }
  } finally {
    doc.removeEventListener('submit', noSubmit, true);
  }
}

/** The boxes of the open entry form, described like any form's fields. */
function editorRows(editor) {
  const p = probe();
  if (!p) return [];
  const els = p.fillableIn(editor).elements.filter(isVisible);
  return describeFields({ root: editor, fields: els });
}

/** Fill one open entry form from `entry`: only boxes empty or rejected. */
async function fillEditor(kind, editor, entry) {
  const filled = [];
  for (const row of editorRows(editor)) {
    if (row.kind === 'file') continue;
    if (row.filled && !row.invalid) continue;            // what Oracle filled stays
    const shapes = tileAnswer(kind, row.label, entry);
    if (!shapes || !shapes.length) continue;
    let value = shapes[0];
    // A dropdown is answered the way the planner answers one: from its real
    // options, through the same guards. Straight to the writer, "Diploma in
    // Fine Arts" took "High School Diploma" for sharing the word "diploma".
    if (row.kind === 'combobox' || row.kind === 'select') {
      if (!(row.options || []).length) {
        const labels = await readComboboxOptions(row);
        if (labels.length) row.options = labels.map(l => ({ value: l, label: l }));
      }
      const key = kind === 'education' && /degree|qualification/i.test(row.label) ? 'degree' : '';
      if ((row.options || []).length) {
        value = coerce(shapes[0], Object.assign({}, row, { candidates: shapes, candidateKey: key }));
        if (value == null) continue;                      // nothing on the list is it
      } else if (key === 'degree') {
        // No list to check the level against: the writer's own matching would
        // take any option containing the word ("High School Diploma" for
        // "Diploma"). A qualification is not filled on a guess.
        continue;
      }
    }
    const res = await applyDecision({ row, value, candidates: [value].concat(shapes), label: row.label });
    if (res.ok) filled.push(`${row.label.replace(/\s*\*$/, '')}: ${res.shown || value}`);
  }
  return filled;
}

function stillRejected(editor) {
  return editorRows(editor).filter(r => r.invalid || (r.required && !r.filled)).map(r => r.label);
}

/**
 * Fix every flagged tile on screen. Returns decisions for the results panel,
 * one per tile touched: FILL when it saved and is no longer flagged, ASK when
 * it needs the person (no clear profile entry, or it would not save).
 */
export async function fillProfileTiles(ctx, progress) {
  const facts = (ctx && ctx.facts) || {};
  const lists = {
    education: facts.educationEntries || [],
    experience: facts.workExperience || [],
  };
  const out = [];
  for (const { block, kind } of profileTileBlocks()) {
    if (!kind) continue;
    const count = block.querySelectorAll(TILE_SEL).length;
    for (let i = 0; i < count; i++) {
      // Re-read each time: saving a tile redraws the list.
      const tile = block.querySelectorAll(TILE_SEL)[i];
      if (!tile || !tileFlagged(tile)) continue;
      const shownAs = tileTitle(tile);
      const label = `${kind === 'education' ? 'Education' : 'Experience'}: ${shownAs}`;
      const decision = { key: `tile:${kind}:${i}`, label, kind: 'tile', row: { el: tile, kind: 'tile' },
                         action: ASK, value: '', source: '', reason: '', outcome: '' };
      out.push(decision);

      const entry = matchTileEntry(kind, tileText(tile), lists[kind]);
      if (!entry) {
        decision.reason = lists[kind].length
          ? `we could not tell which ${kind === 'education' ? 'school' : 'job'} in your profile this is — open it and fix it`
          : `add your ${kind} to your profile, or fix this one here`;
        continue;
      }

      if (progress) progress('filling', { detail: label });
      const edit = tile.querySelector('.apply-flow-profile-item-tile__edit-item-icon');
      if (!edit) { decision.reason = 'open this entry and fix it yourself'; continue; }
      press(edit);
      const editor = await waitFor(() => openEditor(block), TIMING.tileOpenMs);
      if (!editor) { decision.reason = 'the entry did not open — fix it yourself'; continue; }
      await sleep(TIMING.settleMs + 150);

      const filled = await fillEditor(kind, editor, entry);
      const save = block.querySelector('.profile-item-footer .save-btn, [data-qa="profileItemInlineSaveButton"]');
      if (!save) { decision.reason = 'fix this entry and save it yourself'; continue; }
      press(save);
      const closed = await waitFor(() => !openEditor(block), TIMING.tileSaveMs);
      if (!closed) {
        const missing = stillRejected(editor);
        const cancel = block.querySelector('.profile-item-footer .cancel-btn');
        if (cancel) press(cancel);
        await waitFor(() => !openEditor(block), TIMING.tileSaveMs);
        decision.reason = missing.length
          ? `still needs: ${missing.join(', ')} — fix it yourself`
          : 'it would not save — fix it yourself';
        continue;
      }
      await sleep(TIMING.settleMs + 150);
      const after = block.querySelectorAll(TILE_SEL)[i];
      if (after && tileFlagged(after)) {
        decision.reason = 'saved, but the form still flags it — open it and check';
        continue;
      }
      decision.action = FILL;
      decision.source = 'profile';
      decision.outcome = 'ok';
      decision.value = filled.join(' · ') || 'saved';
      decision.shown = decision.value;
    }
  }
  return out;
}
