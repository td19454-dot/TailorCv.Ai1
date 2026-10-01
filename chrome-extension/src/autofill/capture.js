// "Copy page structure for TailorCV": the application form's markup, with the
// person's data taken out, for building ATS adapters and tests from real pages.
//
// Every ATS fix so far was built from screenshots and a guess at the markup
// behind them. This gives the markup itself — but a filled application is full
// of personal data, so everything a person typed or chose is removed before it
// leaves the page: input values, textarea contents, chosen dropdown values,
// query strings (Oracle's login links carry one-time codes), emails,
// phone-like numbers, and every value in their application profile.

import { findForm, describeFields, detectAts } from './discover.js';

const MAX_CHARS = 400000;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

function stripQuery(url) {
  try {
    const u = new URL(url, globalThis.location && globalThis.location.href);
    return `${u.origin}${u.pathname}`;
  } catch (e) { return ''; }
}

// Long attributes are either data blobs or HTML stuffed into an aria-label
// (Oracle puts tracking pixels there); the first part is enough to read.
const MAX_ATTR_CHARS = 300;

function scrubText(text, secrets) {
  let t = String(text || '');
  for (const re of secrets) t = t.replace(re, '[redacted]');
  return t.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[number]');
}

/**
 * Profile values worth hiding, as whole-word patterns, longest first. Whole
 * words only: a plain substring match turned Oracle's `validateValue` binding
 * into `validate[redacted]`, corrupting the structure the capture is for.
 */
function secretsFrom(values) {
  const out = new Set();
  for (const v of values || []) {
    const s = String(v == null ? '' : v).trim();
    if (s.length >= 3) out.add(s);
  }
  // A "word" edge is a letter or digit only: an underscore or dot around a
  // value still hides it, so "Shubham_Sarkar_JU.pdf" — a resume file name
  // Oracle shows — loses the name too.
  return [...out].sort((a, b) => b.length - a.length).map(s =>
    new RegExp(`(?<![A-Za-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'gi'));
}

function sanitize(node, secrets) {
  // Things that carry no structure, or carry data.
  for (const el of node.querySelectorAll('script, style, noscript, link, meta, template')) el.remove();
  for (const el of node.querySelectorAll('svg')) el.replaceChildren();
  for (const el of node.querySelectorAll('textarea')) el.textContent = '';
  for (const el of node.querySelectorAll('[contenteditable="true"]')) el.textContent = '';
  // A chosen value shown as text: Workday's button dropdown and selected tags.
  for (const el of node.querySelectorAll('button[aria-haspopup="listbox"]')) {
    if (!/^(select one|none selected|choose one)$/i.test((el.textContent || '').trim())) el.textContent = '[chosen value]';
  }
  for (const el of node.querySelectorAll('[data-automation-id="selectedItem"]')) el.textContent = '[chosen value]';

  for (const el of [node, ...node.querySelectorAll('*')]) {
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute && (el.getAttribute('type') || '')).toLowerCase();
    for (const attr of Array.from(el.attributes || [])) {
      const name = attr.name.toLowerCase();
      // `params` is Oracle's Knockout component wiring, repeated on every block.
      if (name === 'style' || name === 'params' || name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'value' && !(tag === 'option' || type === 'radio' || type === 'checkbox'
                                || type === 'submit' || type === 'button')) {
        el.removeAttribute(attr.name); continue;
      }
      if (name === 'href' || name === 'src' || name === 'action' || name === 'srcset') {
        el.setAttribute(attr.name, name === 'srcset' ? '' : stripQuery(attr.value)); continue;
      }
      let clean = scrubText(attr.value, secrets).replace(/\s+/g, ' ').trim();
      if (clean.length > MAX_ATTR_CHARS) clean = clean.slice(0, MAX_ATTR_CHARS) + '…';
      if (clean !== attr.value) el.setAttribute(attr.name, clean);
    }
  }
  // Text: comments dropped, whitespace collapsed (indentation was half of an
  // Oracle capture), the rest scrubbed.
  const walker = node.ownerDocument.createTreeWalker(node, 0x80 | 0x4);   // comments | text
  const drop = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 8) { drop.push(n); continue; }
    const collapsed = n.nodeValue.replace(/\s+/g, ' ');
    if (collapsed === ' ') { n.nodeValue = '\n'; continue; }
    n.nodeValue = scrubText(collapsed, secrets);
  }
  for (const n of drop) n.remove();
}

/**
 * The form on this page (with two levels of surrounding markup, for section
 * headings), any open option lists, and what the extension detected — all
 * scrubbed. `profileValues`: the person's application-profile values to hide.
 */
export function capturePageStructure(doc, profileValues) {
  const d = doc || globalThis.document;
  const secrets = secretsFrom(profileValues);
  const form = findForm(d);
  let root = form ? form.root : d.body;
  for (let i = 0; i < 2 && root.parentElement && root.parentElement !== d.body
       && root.parentElement !== d.documentElement; i++) {
    root = root.parentElement;
  }

  const clone = root.cloneNode(true);
  for (const el of clone.querySelectorAll('#tailorcv-sidebar, #tailorcv-launcher')) el.remove();
  sanitize(clone, secrets);

  // Option lists are often portalled to <body>, outside the form. Oracle's
  // is a role="grid", found through the open control's aria-controls.
  const popups = new Set(d.querySelectorAll('[role="listbox"], [role="grid"]'));
  for (const c of d.querySelectorAll('[aria-expanded="true"][aria-controls]')) {
    const target = d.getElementById(c.getAttribute('aria-controls'));
    if (target) popups.add(target);
  }
  const lists = Array.from(popups)
    .filter(l => !root.contains(l) && !l.closest('#tailorcv-sidebar'))
    .filter((l, _, all) => !all.some(o => o !== l && o.contains(l)))
    .map(l => { const c = l.cloneNode(true); sanitize(c, secrets); return c.outerHTML; });

  let detected = [];
  try {
    detected = (form ? describeFields(form) : []).map(r => ({
      label: scrubText(r.label, secrets).slice(0, 160), kind: r.kind,
      required: !!r.required, options: (r.options || []).length,
    }));
  } catch (e) { detected = [{ error: String(e && e.message) }]; }

  const url = stripQuery(d.location ? d.location.href : '');
  const header = [
    '<!-- TailorCV page structure',
    `  url: ${url}`,
    `  ats: ${detectAts(d.location ? d.location.href : '')}`,
    `  form found: ${form ? 'yes (score ' + form.score + ')' : 'no'}`,
    `  captured: ${new Date().toISOString()}`,
    `  detected fields: ${JSON.stringify(detected)}`,
    '-->',
  ].join('\n');

  let text = `${header}\n${clone.outerHTML}` + (lists.length ? `\n<!-- open option lists -->\n${lists.join('\n')}` : '');
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n<!-- truncated -->';
  return text;
}
