// SAP SuccessFactors' career-site application page (career4.successfactors.com
// /portalcareer, ExxonMobil, Oct 2026): one long page of collapsible sections —
// My Documents, Profile Information, Previous Employment, Formal Education,
// Job-Specific Information — each a <button class="rcmFormSectionTopBar"
// aria-expanded="false"> over a closed <div class="sectionContentClosed">.
// Closed, their fields are hidden, and a hidden field is no field to us: only
// ten of a hundred were read.

import { press } from './tiles.js';

const CLOSED_SECTION_SEL = 'button.rcmFormSectionTopBar[aria-expanded="false"]';
// A repeating row of Previous Employment / Formal Education / Languages.
const ROW_SEL = '[id$="_bgElementContainer"]';

const FOLLOW_UP_START_RE = /^\s*if (yes|you (hold|have|are|were|answered))\b/i;

/**
 * Mark the optional fields that belong to the "If yes…" above them. Only the
 * first of a block says so: under "If yes, please provide type of employment"
 * come Start Date, End Date, Department and Job Title, and Job Title got the
 * current job, under a question answered No (ExxonMobil, Oct 2026). The block
 * ends at the next required question.
 */
export function markFollowUps(rows) {
  let open = false;
  for (const row of inPageOrder(rows || [])) {
    if (row.required) { open = false; continue; }
    if (FOLLOW_UP_START_RE.test(String(row.label || ''))) open = true;
    if (open) row.afterFollowUp = true;
  }
}

/**
 * The rows as the page shows them. Fields are read light DOM first, so every UI5
 * date (in a shadow root) comes last: PwC's optional Start Date fell out of its
 * "If yes" block, and got the available start date.
 */
function inPageOrder(rows) {
  const placeOf = (row) => {
    let n = row.el;
    for (let root = n && n.getRootNode && n.getRootNode(); root && root.nodeType === 11; root = n.getRootNode()) n = root.host;
    return n;
  };
  return rows.slice().sort((a, b) => {
    const x = placeOf(a), y = placeOf(b);
    if (!x || !y || x === y) return 0;
    return x.compareDocumentPosition(y) & 2 ? 1 : -1;   // 2: y precedes x
  });
}

/**
 * The answers in the Formal Education row that is the highest degree, in the
 * form's own wording. The Job-Specific section asks them again, from lists of
 * thousands shown a page at a time: "Chemical Engineering" against one page of
 * them chose "Engineer-Mining". The row already holds the form's own option.
 */
export function educationFromRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row.value || !inRepeatingRow(row) || !row.el.closest) continue;
    const box = row.el.closest('.rcmSectionComponent');
    if (!box) continue;
    if (!groups.has(box)) groups.set(box, {});
    const g = groups.get(box);
    const label = String(row.label || '').replace(/\*+\s*$/, '').trim();
    if (/^highest degree$/i.test(label)) g.highest = row.value;
    else if (/^degree$/i.test(label)) g.degree = row.value;
    else if (/^major\b/i.test(label)) g.major = row.value;
    else if (/^institution\/university country/i.test(label)) g.country = row.value;
    else if (/^institution\/university$/i.test(label)) g.institution = row.value;
  }
  const entries = Array.from(groups.values()).filter(g => g.degree || g.major || g.institution);
  const highest = entries.filter(g => /^yes\b/i.test(g.highest || ''));
  if (highest.length === 1) return highest[0];
  return entries.length === 1 ? entries[0] : null;
}

/** Open every closed section; the number opened. */
export function expandSections(doc) {
  const d = doc || globalThis.document;
  let closed = [];
  try { closed = Array.from(d.querySelectorAll(CLOSED_SECTION_SEL)); } catch (e) { closed = []; }
  for (const button of closed) press(button);
  return closed.length;
}

/**
 * Whether a field sits in a repeating row. SuccessFactors fills those rows from
 * the candidate profile itself, and they are not ours to plan as single
 * questions: row 2's "Company Name" would get the current company.
 */
export function inRepeatingRow(row) {
  for (let n = row && row.el, i = 0; n && i < 40; i++) {
    if (n.matches && n.matches(ROW_SEL)) return true;
    n = n.parentElement || (n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : null);
  }
  return false;
}
