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
