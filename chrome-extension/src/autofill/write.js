// Putting a value into a control so the page's own framework believes it.
//
// This is the part a naive autofill gets wrong. `el.value = x` does nothing
// durable on a React form: React keeps its own copy of the value on the DOM
// node and reverts to it on the next render, so the field visibly fills and
// then empties, or fills and submits empty. The fix is to call the value setter
// off the prototype — which bypasses React's overridden property descriptor and
// updates its internal tracker — and then dispatch the events the framework
// actually listens for.
//
// Nothing here trusts itself. Every writer reports what it did; run.js re-reads
// the field through the shared probe afterwards and decides whether it landed.
// "The write did not throw" is not evidence, which is the same discipline the
// server engine arrived at (auto_apply/browser.py around the _verify_commit
// calls) after a dropdown reported success while the form still showed "This
// field is required".

import { commitMatches, bestOptionMatch, looksLikeDecline } from './match.js';
import { scrollIntoView, dismissListbox, reprobe } from './discover.js';
import { TIMING, sleep } from './timing.js';

const probe = () => globalThis.__tcvFieldProbe;


// ── event plumbing ───────────────────────────────────────────

function fire(el, type, init) {
  try {
    el.dispatchEvent(new globalThis.Event(type, Object.assign({ bubbles: true }, init || {})));
  } catch (e) { /* a detached node: the caller's verify will catch it */ }
}

function fireKey(el, type, key) {
  try {
    el.dispatchEvent(new globalThis.KeyboardEvent(type, {
      key, code: key, bubbles: true, cancelable: true,
      keyCode: KEY_CODES[key] || 0, which: KEY_CODES[key] || 0,
    }));
  } catch (e) { /* ignore */ }
}

const KEY_CODES = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, Backspace: 8 };

/**
 * A full pointer interaction, not just .click().
 *
 * react-select commits an option on mousedown, not click — so a bare click()
 * opens the menu and changes nothing. Other widgets listen for pointerdown, and
 * a few only for click. Firing the whole sequence is what makes one code path
 * work across them; each dispatch is independently harmless.
 */
function pressPointer(el) {
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try {
      const Ctor = type.startsWith('pointer') && globalThis.PointerEvent
        ? globalThis.PointerEvent
        : globalThis.MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    } catch (e) {
      if (type === 'click') { try { el.click(); } catch (_) { /* ignore */ } }
    }
  }
}

function focus(el) {
  try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (_) {} }
}

function blur(el) {
  // Workday and Formik both validate on blur, and a field that never blurs can
  // stay silently un-validated until submit.
  try { el.blur(); } catch (e) { /* ignore */ }
}

/**
 * The prototype's value setter for this element.
 *
 * Reached off the prototype deliberately: React defines its own `value`
 * property on the instance, so assigning `el.value` writes React's shadow copy
 * and leaves its change-tracker thinking nothing happened.
 */
function nativeSetter(el) {
  const win = (el.ownerDocument && el.ownerDocument.defaultView) || globalThis;
  const protoFor = () => {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype;
    if (tag === 'select') return win.HTMLSelectElement && win.HTMLSelectElement.prototype;
    return win.HTMLInputElement && win.HTMLInputElement.prototype;
  };
  const proto = protoFor();
  if (!proto) return null;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  return desc && desc.set ? desc.set : null;
}

function writeValue(el, value) {
  const setter = nativeSetter(el);
  if (setter) {
    try { setter.call(el, value); return true; } catch (e) { /* fall through */ }
  }
  try { el.value = value; return true; } catch (e) { return false; }
}

// ── text-ish controls ────────────────────────────────────────

export function setText(el, value) {
  if (!el) return false;
  focus(el);
  // Clear first. A framework that appends rather than replaces (some masked
  // inputs do) otherwise ends up with the old value glued to the new one.
  if (String(el.value || '') !== '') {
    writeValue(el, '');
    fire(el, 'input');
  }
  const ok = writeValue(el, value);
  fire(el, 'input');
  fire(el, 'change');
  blur(el);
  return ok;
}

/**
 * Type a value one character at a time, with real key events.
 *
 * The fallback for controls that ignore a whole-value write: masked inputs that
 * reformat per keystroke, and combobox widgets that filter their menu from
 * keydown rather than from the input event.
 */
export async function typeText(el, value, delay) {
  if (!el) return false;
  focus(el);
  writeValue(el, '');
  fire(el, 'input');
  const text = String(value || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    fireKey(el, 'keydown', ch);
    writeValue(el, text.slice(0, i + 1));
    try {
      el.dispatchEvent(new globalThis.InputEvent('input', {
        bubbles: true, data: ch, inputType: 'insertText',
      }));
    } catch (e) { fire(el, 'input'); }
    fireKey(el, 'keyup', ch);
    if (delay) await sleep(delay);
  }
  return true;
}

export function setContentEditable(el, value) {
  if (!el) return false;
  focus(el);
  // execCommand produces genuine beforeinput/input events, which is what Slate,
  // Quill and ProseMirror accept; assigning textContent bypasses their model
  // entirely and the editor reverts on its next render.
  let ok = false;
  try {
    const doc = el.ownerDocument;
    const sel = doc.defaultView.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    ok = doc.execCommand('insertText', false, String(value));
  } catch (e) { ok = false; }
  if (!ok) {
    try { el.textContent = String(value); ok = true; } catch (e) { ok = false; }
    fire(el, 'input');
  }
  fire(el, 'change');
  blur(el);
  return ok;
}

// ── native select ────────────────────────────────────────────

export function setSelect(el, value) {
  if (!el || !el.options) return false;
  const options = Array.prototype.slice.call(el.options).map(o => ({
    value: o.value, label: (o.textContent || '').replace(/\s+/g, ' ').trim(), node: o,
  }));
  const match = bestOptionMatch(value, options);
  if (!match) return false;
  focus(el);
  if (el.multiple) {
    match.node.selected = true;
  } else {
    // Assigning selectedIndex as well as value: a few polyfilled selects track
    // one and not the other.
    if (!writeValue(el, match.value)) return false;
    try { el.selectedIndex = match.node.index; } catch (e) { /* ignore */ }
  }
  fire(el, 'input');
  fire(el, 'change');
  blur(el);
  return true;
}

// ── checkbox / radio ─────────────────────────────────────────

/**
 * Check the member of this group that answers `value`.
 *
 * Clicked, never assigned: `el.checked = true` updates the DOM without telling
 * React, so the visual tick appears and the form state does not change. The
 * click is also what triggers any conditional fields the choice reveals.
 */
export function setCheckable(row, value) {
  const members = (row.members || []).filter(el => el && el.isConnected);
  if (!members.length) return false;
  const p = probe();

  let target = null;
  if (members.length === 1 && row.kind === 'checkbox') {
    const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(String(value));
    if (!truthy) return false;
    target = members[0];
  } else {
    const labelled = members.map(el => ({
      el, label: (p && p.labelFor(el)) || el.value || '',
    }));
    const match = bestOptionMatch(value, labelled.map(x => x.label));
    if (match) {
      const found = labelled.find(x => x.label === match);
      target = found && found.el;
    }
    if (!target) {
      // Match on the underlying value attribute, for groups whose labels are
      // images or icons.
      const byValue = members.find(el => commitMatches(value, el.value || ''));
      target = byValue || null;
    }
  }
  if (!target) return false;

  if (target.checked) return true;    // already in the desired state
  scrollIntoView(target);
  focus(target);
  pressPointer(target);
  if (!target.checked) {
    // A label handler that preventDefault()s the click. Assign and announce it;
    // less reliable, but better than leaving a required box unticked.
    try { target.checked = true; } catch (e) { return false; }
    fire(target, 'input');
    fire(target, 'change');
  }
  return !!target.checked;
}

// ── custom comboboxes ────────────────────────────────────────

/**
 * Drive a custom dropdown: open, type, pick the matching row, verify.
 *
 * A port of the server engine's _commit_combobox, including the order of the
 * two commit mechanisms and why: clicking the option row comes FIRST and Enter
 * is only the fallback, because Enter takes whatever the widget has highlighted
 * and that is not always what we asked for — typing "India" highlights "British
 * Indian Ocean Territory" first on a real phone-code picker. On Greenhouse's
 * EEO dropdowns Enter frequently commits nothing at all, leaving the typed text
 * visible while the field stays required.
 */
export async function commitCombobox(row, value) {
  const el = row.el;
  if (!el) return false;

  // Never trade a real answer for a "prefer not to say" one. plan.js checks
  // this too; repeated here because a repair sweep can call the writer directly
  // and this is the cheap side of the trade.
  const current = row.value || '';
  if (current && looksLikeDecline(value) && !looksLikeDecline(current)) return true;

  try {
    scrollIntoView(el);
    openWidget(row);
    await sleep(TIMING.settleMs);

    // Type to filter. Whole-value write first (react-select reads the input's
    // onChange); per-character with key events if no menu appears, for widgets
    // that filter from keydown.
    const input = typableInput(row) || el;
    setText(input, value);
    focus(input);
    let options = await waitForOptions(el, TIMING.optionWaitMs);
    if (!options.length) {
      await typeText(input, value, 8);
      options = await waitForOptions(el, TIMING.optionWaitMs);
    }

    if (options.length && await clickMatchingOption(el, value, options)) {
      await sleep(TIMING.settleMs);
      if (committed(row, value)) return true;
    }

    // Fallback: Enter on whatever is highlighted.
    fireKey(input, 'keydown', 'Enter');
    fireKey(input, 'keyup', 'Enter');
    await sleep(TIMING.settleMs);
    if (committed(row, value)) return true;

    return false;
  } catch (e) {
    return false;
  } finally {
    // Unconditional: an open listbox overlays the fields below it, so leaving
    // one open breaks every write after this one.
    dismissListbox(row.el);
  }
}

function openWidget(row) {
  const p = probe();
  const el = row.el;
  const role = el.getAttribute && el.getAttribute('role');
  let target = el;
  if (role !== 'combobox') {
    const wrap = (p && p.rsContainer(el)) || el.parentElement;
    if (wrap) {
      let ctl = null;
      try {
        ctl = wrap.querySelector('[role="combobox"], [role="button"], [class*="control"], [class*="toggle"]');
      } catch (e) { ctl = null; }
      target = ctl || el;
    }
  }
  focus(target);
  pressPointer(target);
}

/** The text input inside a widget, which is not always the element we hold. */
function typableInput(row) {
  const el = row.el;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return el;
  const p = probe();
  const wrap = (p && p.rsContainer(el)) || el.parentElement;
  if (!wrap) return null;
  try { return wrap.querySelector('input:not([type="hidden"]), textarea'); }
  catch (e) { return null; }
}

function visibleOptionNodes(doc) {
  try {
    return Array.prototype.slice.call(doc.querySelectorAll('[role="option"]'))
      .filter(n => (n.textContent || '').trim());
  } catch (e) { return []; }
}

function waitForOptions(el, timeout) {
  return new Promise(resolve => {
    const doc = (el.ownerDocument) || globalThis.document;
    const immediate = visibleOptionNodes(doc);
    if (immediate.length) { resolve(immediate); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { obs.disconnect(); } catch (e) {}
      clearTimeout(timer);
      resolve(visibleOptionNodes(doc));
    };
    // Observing the whole document, because react-select renders its menu into
    // a <body>-level portal rather than inside the field.
    const obs = new globalThis.MutationObserver(() => {
      if (visibleOptionNodes(doc).length) finish();
    });
    try { obs.observe(doc.body, { childList: true, subtree: true }); } catch (e) {}
    const timer = setTimeout(finish, timeout);
  });
}

async function clickMatchingOption(el, value, nodes) {
  const labels = nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
  let idx = labels.findIndex(t => commitMatches(value, t));
  if (idx < 0) {
    // No whole-word match among what is on screen. Fall back to the fuzzy
    // matcher, but only against the rows actually offered — so this can pick a
    // differently-worded real option and can still pick nothing.
    const best = bestOptionMatch(value, labels);
    idx = best == null ? -1 : labels.indexOf(best);
  }
  if (idx < 0) return false;
  const node = nodes[idx];
  try { node.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  pressPointer(node);
  return true;
}

function committed(row, value) {
  const after = reprobe(row);
  if (!after) return false;
  if (after.invalid) return false;
  if (!after.filled) return false;          // typed but never committed
  return commitMatches(value, after.value);
}

// ── file inputs ──────────────────────────────────────────────

/**
 * Put a file on a page's file input.
 *
 * `input.files` is read-only in the sense that it takes a FileList, and
 * DataTransfer is the only way to construct one — this does work from a content
 * script. The events we dispatch are untrusted (isTrusted === false), which
 * React, Formik and Vue all ignore because they read event.target.files; a
 * small number of anti-bot-hardened forms do check, and there this fails
 * honestly rather than silently.
 */
export function attachFile(input, file) {
  if (!input || !file) return false;
  try {
    const dt = new globalThis.DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    fire(input, 'input');
    fire(input, 'change');
    return input.files && input.files.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Drop a file onto a drag-and-drop upload zone.
 *
 * Uppy, Dropzone and FilePond listen for `drop` and never for `change`, so a
 * form using one of those ignores attachFile() even when it succeeds. Tried in
 * addition to, not instead of, the input write.
 */
export function dropFile(zone, file) {
  if (!zone || !file) return false;
  try {
    const dt = new globalThis.DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const ev = new globalThis.DragEvent(type, {
        bubbles: true, cancelable: true, dataTransfer: dt,
      });
      zone.dispatchEvent(ev);
    }
    return true;
  } catch (e) {
    return false;
  }
}

/** The drop zone associated with a file input, if the form has one. */
export function findDropZone(input) {
  if (!input) return null;
  let n = input.parentElement, depth = 0;
  while (n && depth < 5) {
    const cls = (n.className && String(n.className)) || '';
    if (/dropzone|drop-zone|filepond|uppy|drag/i.test(cls)) return n;
    if (n.hasAttribute && (n.hasAttribute('data-uppy') || n.hasAttribute('data-filepond'))) return n;
    n = n.parentElement; depth++;
  }
  return null;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  table['='.charCodeAt(0)] = 0;
  return table;
})();

/**
 * Base64 to bytes, without atob.
 *
 * Self-contained on purpose. atob returns a STRING whose char codes happen to
 * be the bytes, so every caller has to do a second conversion pass and any
 * mistake there silently corrupts a PDF — and it is one more host global this
 * code would depend on being intact. Decoding straight to a Uint8Array is both
 * shorter at the call site and unambiguous about producing binary.
 */
export function base64ToBytes(base64) {
  const src = String(base64 || '').replace(/[\s]/g, '');
  const clean = src.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(Math.floor(clean.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const dd = B64_LOOKUP[clean.charCodeAt(i + 3)];
    const chunk = (a << 18) | (b << 12) | (c << 6) | dd;
    if (o < out.length) out[o++] = (chunk >> 16) & 0xff;
    if (o < out.length) out[o++] = (chunk >> 8) & 0xff;
    if (o < out.length) out[o++] = chunk & 0xff;
  }
  return out;
}

/** Build a File from the bytes the background worker fetched. */
export function fileFromBase64(base64, filename, mime) {
  const bytes = base64ToBytes(base64);
  return new globalThis.File([bytes], filename || 'resume.pdf',
                             { type: mime || 'application/pdf' });
}

// ── the dispatcher ───────────────────────────────────────────

/**
 * Write one decision into the page. Returns { ok, outcome, shown }.
 *
 * `outcome` is the verified state, not what we attempted:
 *   ok        — the page shows what we asked for
 *   rejected  — the value landed but the form is rejecting it
 *   empty     — the write reported success and the page is still blank
 *   mismatch  — the page shows a different value
 *   failed    — the write itself did not go through
 */
export async function applyDecision(decision) {
  const row = decision.row;
  const value = decision.value;
  if (!row || !row.el || !value) return { ok: false, outcome: 'failed', shown: '' };

  let wrote = false;
  switch (row.kind) {
    case 'select':
      wrote = setSelect(row.el, value);
      // A "select" that has no real <option> children is a custom widget
      // wearing a select's clothes.
      if (!wrote) wrote = await commitCombobox(row, value);
      break;
    case 'combobox':
      wrote = await commitCombobox(row, value);
      break;
    case 'radio':
    case 'checkbox':
      wrote = setCheckable(row, value);
      break;
    case 'contenteditable':
      wrote = setContentEditable(row.el, value);
      break;
    default:
      wrote = setText(row.el, value);
      if (wrote) {
        await sleep(TIMING.settleMs);
        const check = reprobe(row);
        // A masked or otherwise reformatting input can swallow a whole-value
        // write; typing it character by character is the second attempt.
        if (check && !check.filled) {
          await typeText(row.el, value, 8);
          blur(row.el);
        }
      }
      break;
  }

  await sleep(TIMING.settleMs);
  const after = reprobe(row);
  if (!after) return { ok: wrote, outcome: wrote ? 'ok' : 'failed', shown: '' };
  if (after.invalid) return { ok: false, outcome: 'rejected', shown: after.value };
  if (!after.filled) return { ok: false, outcome: 'empty', shown: '' };
  if (!commitMatches(value, after.value)) {
    return { ok: false, outcome: 'mismatch', shown: after.value };
  }
  return { ok: true, outcome: 'ok', shown: after.value };
}
