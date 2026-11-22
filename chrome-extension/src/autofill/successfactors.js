// SAP SuccessFactors' career-site application page (career4.successfactors.com
// /portalcareer, ExxonMobil, Oct 2026): one long page of collapsible sections —
// My Documents, Profile Information, Previous Employment, Formal Education,
// Job-Specific Information — each a <button class="rcmFormSectionTopBar"
// aria-expanded="false"> over a closed <div class="sectionContentClosed">.
// Closed, their fields are hidden, and a hidden field is no field to us: only
// ten of a hundred were read.

import { press } from './tiles.js';
import { isNodeVisible } from './discover.js';
import { documentSlotFor } from './match.js';
import { degreeRank } from './plan.js';
import { sleep } from './timing.js';

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
 * Fields under a heading that names one school or job (Deloitte, Oct 2026): one
 * long section whose blocks are only bold notes — "Highest Education Details",
 * "2nd Highest Education Details", "Current Work Experience Details", "Previous
 * Work Experience Details" — over the same labels. Each field under one gets
 * `row.block` = { kind, entry, heading }: the school of that rank (highest
 * degree first) or that job. An entry the profile lacks is {}: the block stays
 * empty for the person, never a copy of the highest degree. See blockBank().
 */
export function noteBlocks(rows, schools, jobs) {
  const first = (rows || []).find(r => r.el);
  if (!first) return;
  const doc = first.el.ownerDocument;
  let notes = [];
  try { notes = Array.from(doc.querySelectorAll('.RCMFormField.instructionField')); } catch (e) { notes = []; }
  // A heading is a short note; "Note: If you are a fresher, Put NA…" and the
  // diversity statement are not.
  const headings = notes.map(n => ({ n, text: (n.textContent || '').replace(/\s+/g, ' ').trim() }))
    .filter(h => h.text && h.text.length <= 60 && !/^(note|please)\b/i.test(h.text));
  if (!headings.length) return;
  const ranked = (schools || []).map((s, i) => ({ s, i }))
    .sort((a, b) => (degreeRank(a.s.degree) - degreeRank(b.s.degree)) || (a.i - b.i)).map(x => x.s);
  for (const row of rows) {
    if (!row.el || inRepeatingRow(row)) continue;
    const at = placeOf(row);
    let heading = null;
    for (const h of headings) {
      if (h.n.compareDocumentPosition(at) & 4) heading = h;   // 4: the field follows it
      else break;
    }
    const block = heading ? blockFor(heading.text, ranked, jobs || []) : null;
    if (block) row.block = block;
  }
}

const ORDINAL_RE = /^(?:(2nd|second)|(3rd|third)|(4th|fourth))\b/i;

function blockFor(text, schools, jobs) {
  const ord = ORDINAL_RE.exec(text);
  const n = !ord ? 0 : ord[1] ? 1 : ord[2] ? 2 : 3;
  if (/\b(education|qualification|academic)/i.test(text)) {
    // Only headings that rank the schools: "Graduation Details" names a level, not a rank.
    if (!/\bhighest\b/i.test(text)) return null;
    return { kind: 'education', entry: schools[n] || {}, heading: text };
  }
  if (/\b(experience|employment|employer)\b/i.test(text)) {
    if (/\b(current|present)\b/i.test(text)) {
      return { kind: 'experience', entry: jobs.find(j => j.current) || {}, heading: text };
    }
    if (/\b(previous|past|last|prior)\b/i.test(text)) {
      return { kind: 'experience', entry: jobs.filter(j => !j.current)[n] || {}, heading: text };
    }
  }
  return null;
}

/** The light-DOM element a field shows as: a UI5 date's host, not its shadow input. */
function placeOf(row) {
  let n = row.el;
  for (let root = n && n.getRootNode && n.getRootNode(); root && root.nodeType === 11; root = n.getRootNode()) n = root.host;
  return n;
}

/**
 * The rows as the page shows them. Fields are read light DOM first, so every UI5
 * date (in a shadow root) comes last: PwC's optional Start Date fell out of its
 * "If yes" block, and got the available start date.
 */
function inPageOrder(rows) {
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

// ── document uploads ─────────────────────────────────────────
//
// No file input until the box's "+" is pressed: that opens a menu (Upload from
// Device / Dropbox / Google) holding <input type="file" class="fileUpload">, whose
// onchange starts the upload. So the file goes in directly and no file picker
// ever opens (Capgemini, Oct 2026).

const UPLOAD_INPUT_WAIT_MS = 3000;

/** The Resume and Cover Letter boxes on the page: [{ field, slot, label, required }]. */
export function attachmentBoxes(doc) {
  const d = doc || globalThis.document;
  let fields = [];
  try { fields = Array.from(d.querySelectorAll('.RCMFormField.attachmentField')); } catch (e) { fields = []; }
  const boxes = [];
  for (const field of fields) {
    const node = field.querySelector('label');
    const label = ((node && node.textContent) || '').replace(/\s+/g, ' ').replace(/^\s*\*+\s*/, '').trim();
    const slot = documentSlotFor(label);
    if (slot) boxes.push({ field, slot, label, required: !!(node && node.querySelector('.requiredField')) });
  }
  return boxes;
}

/** Whether the box shows a file: its download link is showing. */
export function boxHasFile(field) {
  const link = field && field.querySelector('[id$="_attachDownloadLabel"]');
  return !!link && !link.classList.contains('displayNone');
}

/** Press the box's "+" and wait for the file input in the menu it opens, or null. */
export async function openUploadInput(field, doc) {
  const d = doc || globalThis.document;
  const icon = field.querySelector('[id$="_attachIcon"]');
  if (!icon) return null;
  press(icon);
  const deadline = Date.now() + UPLOAD_INPUT_WAIT_MS;
  for (;;) {
    // The menu's, not the input's own visibility: a styled upload hides the input.
    const inputs = Array.from(d.querySelectorAll('input.fileUpload[type="file"]'))
      .filter(i => isNodeVisible(i.closest('.attachmentUploadOptions') || i.parentElement));
    if (inputs.length) return inputs[inputs.length - 1];
    if (Date.now() >= deadline) return null;
    await sleep(100);
  }
}

/** Wait for the page to show the file in this box. */
export async function waitForUpload(field, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (boxHasFile(field)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(150);
  }
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
