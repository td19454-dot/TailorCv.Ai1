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

import { commitMatches, bestOptionMatch, looksLikeDecline, normalizeOptionText } from './match.js';
import { coerce, candidatesFor, citizenshipOption } from './plan.js';
import { scrollIntoView, dismissListbox, reprobe, datePartOf, isNodeVisible, isNodeDrawn, hiddenReason,
         isChosenValue, isChoiceSelected, controlAncestor, readComboboxOptions, picklistButton }
  from './discover.js';
import { TIMING, sleep } from './timing.js';
import { countryOf, countryOption, countryShare } from './countries.js';

const probe = () => globalThis.__tcvFieldProbe;


// ── event plumbing ───────────────────────────────────────────

// Composed: an input inside a web component's shadow DOM (SuccessFactors' UI5
// date picker) must be heard by the component around it, and a non-composed
// event stops at the shadow root.
function fire(el, type, init) {
  try {
    el.dispatchEvent(new globalThis.Event(type, Object.assign({ bubbles: true, composed: true }, init || {})));
  } catch (e) { /* a detached node: the caller's verify will catch it */ }
}

function fireKey(el, type, key) {
  try {
    el.dispatchEvent(new globalThis.KeyboardEvent(type, {
      key, code: key, bubbles: true, cancelable: true, composed: true,
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

export function setText(el, value, opts) {
  if (!el) return false;
  // Blurring is the default because Workday and Formik validate on blur. It is
  // WRONG for a dropdown's search box: react-select closes its menu when the
  // input loses focus, so typing a query and then blurring leaves nothing to
  // pick from. Callers filtering a listbox pass { blur: false }.
  const wantBlur = !opts || opts.blur !== false;
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
  if (wantBlur) blur(el);
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
/** Press the choice button that answers `value` ("Yes" in "[Yes] [No]"). */
export function setChoice(row, value) {
  const buttons = (row.members || []).filter(el => el && el.isConnected);
  const labels = buttons.map(b => (b.textContent || '').replace(/\s+/g, ' ').trim());
  const match = bestOptionMatch(value, labels);
  const target = match != null ? buttons[labels.indexOf(match)] : null;
  if (!target) return false;
  if (isChoiceSelected(target)) return true;
  scrollIntoView(target);
  focus(target);
  pressPointer(target);
  return isChoiceSelected(target);
}

export function setCheckable(row, value) {
  const members = (row.members || []).filter(el => el && el.isConnected);
  if (!members.length) return false;
  const p = probe();

  let target = null;
  if (members.length === 1 && row.kind === 'checkbox') {
    // Its own label is a "tick it" too: a lone box's one option IS its label,
    // and the model, told to copy an option, sent "Yes, I have read and consent
    // to the above." — which failed here and stopped auto-apply (Citi).
    const plain = s => String(s || '').replace(/\*+\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const own = [row.optionLabel, row.label, p && p.labelFor(members[0])].map(plain).filter(Boolean);
    const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(String(value))
      || own.includes(plain(value));
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
/** Unique, non-empty, order preserved. */
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const t = String(v == null ? '' : v).trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/**
 * The part of an answer worth TYPING into a search box.
 *
 * The first comma segment: "Kolkata" of "Kolkata, West Bengal, India". A
 * remote-search widget queries an API with whatever is typed, and the full
 * string matches no record, so the menu comes back empty and the field is left
 * blank — the "writing the whole location does not stick" case. Short answers
 * and anything without a comma are typed as-is.
 */
function searchToken(value) {
  const text = String(value == null ? '' : value).trim();
  const head = text.split(',')[0].trim();
  return head.length >= 2 ? head : text;
}

export async function commitCombobox(row, value, candidates, readFirst, drill) {
  const el = row.el;
  if (!el) return false;
  // `value` stays the primary answer; the rest are other shapes of it that
  // this list might be the one to want. See candidatesFor() in plan.js.
  const shapes = dedupe([value].concat(candidates || []));

  // Never trade a real answer for a "prefer not to say" one. plan.js checks
  // this too; repeated here because a repair sweep can call the writer directly
  // and this is the cheap side of the trade.
  const current = row.value || '';
  if (current && looksLikeDecline(value) && !looksLikeDecline(current)) return true;

  const isButton = (el.tagName || '').toLowerCase() === 'button';

  try {
    scrollIntoView(el);
    // Stale options from some other widget must not be read as this one's.
    dismissListbox(el);
    openWidget(row);
    await sleep(TIMING.settleMs);

    let options = [];
    // A short EEO list filters by substring, so typing the stored "Male" hides
    // "Cisgender man" before it can be matched. Read the whole list first; type
    // only if opening it showed nothing. See READ_FIRST_KEYS in match.js.
    if (readFirst && !isButton) options = await waitForOpenedList(el);
    if (options.length) {
      // already open with the full list
    } else if (isButton) {
      // A <button> dropdown (Workday): there is no input to type into, and
      // writing a "value" onto a button changes nothing — pressing it is the
      // whole interaction, and the options appear in a portal.
      options = await waitForOpenedList(el);
    } else {
      // Type to filter. Whole-value write first (react-select reads the
      // input's onChange); per-character with key events if no menu appears,
      // for widgets that filter from keydown.
      const input = typableInput(row) || el;
      // What we TYPE and what we SELECT are different strings. A remote-search
      // city box returns nothing for "Kolkata, West Bengal, India" and the row
      // we want for "Kolkata", so each query is a short search term while the
      // selection is still matched against every full shape below.
      //
      // One query per shape, not just the first: a State box searched for
      // "West Bengal" may list only "Kolkata, West Bengal" — or nothing, while
      // "Kolkata" finds it. Before this only the first shape was ever searched,
      // and when that search came back empty the other shapes never got a list
      // to be matched against (Oracle's City and State both stayed empty).
      const queries = dedupe(shapes.map(searchToken)).slice(0, 4);
      row.searchTrace = [];
      // Workday's prompt boxes (Field of Study, "How Did You Hear About Us?"):
      // typing does not filter — the full list stays up — and only Enter runs
      // the search. The answer must then be clicked, or Workday erases the text
      // when focus moves on. Enter was pressed only when NO options showed, which
      // on Workday is never, so the search never ran (NVIDIA, Oct 2026). Only
      // here: on react-select and most others Enter SELECTS the highlighted row.
      const p = probe();
      const wdPrompt = !!(p && p.workdayMultiselect && p.workdayMultiselect(input));
      for (const query of queries) {
        // Keep the focus: this input IS the open menu's search box.
        setText(input, query, { blur: false });
        focus(input);
        if (wdPrompt) {
          fireKey(input, 'keydown', 'Enter');
          fireKey(input, 'keyup', 'Enter');
          // Workday's single-select prompt can commit the exact match on Enter
          // by itself: Field of Study was filled while this waited for a row
          // to click, then reported "did not commit" (NVIDIA, Oct 2026).
          const isSet = () => shapes.some(s => committed(row, s));
          options = await waitForPromptResults(el, shapes, isSet);
          row.searchTrace.push(Object.assign(searchStep(query, input, el, options), { searchedWithEnter: true }));
          if (isSet()) return true;
          if (options.length && listOffersAny(shapes, options)) break;
          continue;   // key-by-key typing does nothing here: next query, no retype
        }
        options = await waitForOptions(el, TIMING.optionWaitMs);
        // A remote search still answering: wait for it rather than retype,
        // which would only start the search over.
        options = await waitOutLoading(el, shapes, options);
        // Still loading after the whole wait: the search itself is not
        // answering. Retyping or trying the other words would only wait the
        // same again, once per word — stop and leave it to the person.
        if (!options.length && listStillLoading(el.ownerDocument || globalThis.document, el)) {
          row.searchTrace.push(Object.assign(searchStep(query, input, el, options), { stillLoading: true }));
          break;
        }
        if (!options.length || !listOffersAny(shapes, options)) {
          // Widgets that filter only on real keystrokes (Oracle): typed key by
          // key. Also when the list is NOT empty but lacks the answer — Oracle
          // opens on its full, unfiltered list (Andaman…, Andhra Pradesh…) and
          // draws only the rows in view, so "West Bengal" was never among them
          // and, with options showing, typing was never tried. The SHORT term:
          // typing the full "Kolkata, West Bengal, India" into a remote search
          // returns nothing.
          await typeText(input, query, 8);
          options = await waitForMatchingOptions(el, shapes, TIMING.optionWaitMs * 2);
          options = await waitOutLoading(el, shapes, options);
        }
        if (!options.length) {
          // Workday's multiselect search only shows results on Enter. Here Enter
          // runs the search; it does not pick anything, so it is safe to press
          // before an option is chosen.
          fireKey(input, 'keydown', 'Enter');
          fireKey(input, 'keyup', 'Enter');
          options = await waitForOptions(el, TIMING.optionWaitMs);
        }
        row.searchTrace.push(searchStep(query, input, el, options));
        if (options.length && listOffersAny(shapes, options)) break;
      }
    }

    // EEO: choose exactly as the planner would have with the list in hand —
    // same shapes, same guards, same decline fallback — never the bare fuzzy
    // matcher, which rates "Male" close to "Female".
    if (readFirst) {
      const labels = options.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
      const pick = pickReadFirst(readFirst, labels);
      if (!pick) {
        reportDropdownFailure(row, value, options);
        return false;
      }
      const node = options[labels.indexOf(pick)];
      try { node.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      pressPointer(node);
      return settlesTo(row, [pick].concat(shapes));
    }

    // Every shape, against the list we already have open: no extra open, no
    // extra wait, and the list itself settles what the field meant.
    for (const shape of options.length ? shapes : []) {
      const before = options.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
      if (!await clickMatchingOption(el, shape, options)) continue;
      // Workday's hierarchical prompt: the country row opens its own level
      // (India › Citizen / Permanent Resident) rather than selecting.
      if (drill && isWorkdayPrompt(el)) {
        const drilled = await drillDown(row, el, shapes, drill, before);
        if (drilled !== null) return drilled;
      }
      // Any wording we were prepared to use counts: Oracle picks "+91 (India)"
      // and then displays "+91" — the same answer, shown its own way.
      if (await settlesTo(row, shapes)) return true;
      // Clicked the answer and it never took: another shape will not help.
      break;
    }

    // Fallback: Enter on the highlighted row — only when that row IS one of the
    // answer's shapes. A list that never filtered highlights its first entry
    // ("Andhra Pradesh" on Oracle's State), and Enter would commit a wrong answer.
    // Not for a button dropdown, where the highlighted row is simply the first one.
    if (!isButton && highlightedMatches(el, shapes)) {
      const input = typableInput(row) || el;
      fireKey(input, 'keydown', 'Enter');
      fireKey(input, 'keyup', 'Enter');
      await sleep(TIMING.settleMs);
      if (committed(row, value)) return true;
    }

    reportDropdownFailure(row, value, options);
    return false;
  } catch (e) {
    return false;
  } finally {
    // Unconditional: an open listbox overlays the fields below it, so leaving
    // one open breaks every write after this one.
    dismissListbox(row.el);
  }
}

/**
 * Say, in the page console, exactly how a dropdown commit failed.
 *
 * A dropdown that "didn't take" has half a dozen possible causes — no options
 * appeared, options appeared but none matched, the click landed but the widget
 * committed nothing, the widget committed a different row — and they need
 * different fixes. This prints the evidence for whichever one happened, so a
 * failure on a live form is diagnosable from one paste instead of by guessing.
 */
/**
 * One search step, for the failure report: what was typed, what the box then
 * held, whether it was still on the page (Oracle redraws its whole address
 * block mid-fill), whether its list was open, and what was offered.
 */
function searchStep(query, input, el, options) {
  const doc = el.ownerDocument || globalThis.document;
  let cells = 0;
  try { cells = doc.querySelectorAll('[role="gridcell"], [role="option"]').length; } catch (e) { cells = -1; }
  return {
    typed: query,
    boxNowHolds: input ? String(input.value || '') : '',
    stillOnPage: !!(el.isConnected),
    listOpen: el.getAttribute ? el.getAttribute('aria-expanded') : null,
    optionsMatched: (options || []).length,
    rowsOnPage: cells,
    rowsSkipped: (options || []).length ? undefined : rowsRejected(doc),
    firstOffered: (options || []).slice(0, 5).map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()),
  };
}

function reportDropdownFailure(row, value, options) {
  // Kept on the row so the sidebar can offer these as a dropdown: the options of
  // a field answered from the profile are only read here, at write time.
  try {
    row.seenOptions = (options || []).map(n => (n.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean).slice(0, 200);
  } catch (e) { /* the report below still runs */ }
  try {
    const after = reprobe(row);
    const el = row.el;
    console.groupCollapsed(`%c[TailorCV] dropdown did not commit: ${row.label}`,
                           'color:#b91c1c;font-weight:700');
    console.log('wanted  :', value);
    console.log('control :', el && el.outerHTML ? el.outerHTML.slice(0, 400) : el);
    console.log('options seen:', (options || []).map(n =>
      (n.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 30));
    console.log('option markup (first):',
      options && options[0] && options[0].outerHTML ? options[0].outerHTML.slice(0, 400) : '(none)');
    console.log('field now reads:', after);
    // As text, so a pasted console copy carries it (objects paste as "Object").
    console.log('report: ' + JSON.stringify({
      field: row.label,
      stillOnPage: !!(el && el.isConnected),
      boxHolds: el ? String(el.value || '') : '',
      steps: row.searchTrace || [],
      fieldNow: after ? { filled: after.filled, value: after.value, invalid: after.invalid } : null,
    }));
    console.groupEnd();
  } catch (e) { /* diagnostics must never break a run */ }
}

function openWidget(row) {
  const p = probe();
  const el = row.el;
  const role = el.getAttribute && el.getAttribute('role');
  const isButton = (el.tagName || '').toLowerCase() === 'button';
  let target = el;
  const wrap = (p && p.rsContainer(el)) || el.parentElement;
  if (role !== 'combobox' && !isButton) {
    if (wrap) {
      let ctl = null;
      try {
        ctl = wrap.querySelector('[role="combobox"], [role="button"], [class*="control"], [class*="toggle"]');
      } catch (e) { ctl = null; }
      target = ctl || el;
    }
  } else if (role === 'combobox' && wrap) {
    // react-select listens for mousedown on its CONTROL, not on the inner
    // search input, and measurably so: pressing the input left the widget
    // closed (aria-expanded="false", "options seen: Array(0)") while pressing
    // the control opened it with its full list. The input is a child of the
    // control, so `contains` keeps this to the widget that owns this field.
    // A class ENDING in "control" only: Oracle's "input-row__control-container"
    // wraps every field, and pressing it instead of the input opens nothing.
    const ctl = controlAncestor(el);
    if (ctl && ctl.contains(el) && (!wrap || wrap.contains(ctl) || ctl.contains(wrap))) target = ctl;
    // SuccessFactors' picklist opens from its own button (see picklistButton).
    const sf = picklistButton(el);
    if (sf) target = sf;
  }
  focus(target);
  pressPointer(target);
  // Typing goes to the input, whatever we pressed to open the menu.
  if (target !== el) focus(el);
}

/** Whether `el` is the input inside a UI5 date picker's shadow DOM. */
function inUi5DatePicker(el) {
  const root = el && el.getRootNode && el.getRootNode();
  const host = root && root.nodeType === 11 ? root.host : null;
  return !!(host && /date-picker/i.test(host.tagName || ''));
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

function visibleOptionNodes(doc, el) {
  // Through the shared probe, which also reads Workday's promptOption rows and
  // de-duplicates a row that carries both markers.
  const p = probe();
  const nodes = p && p.optionNodes ? p.optionNodes(doc) : [];
  // ON SCREEN, not merely present. The query has to sweep the whole document
  // (react-select portals its menu to <body>), and a document holds option
  // rows that belong to CLOSED widgets: every Greenhouse form ships the
  // intl-tel-input country picker, whose 244 <li role="option"> country rows
  // sit in a display:none dropdown from first paint. Without this filter
  // waitForOptions returned those immediately, for every dropdown on the page
  // — so "Bachelor's Degree" was matched against a list of countries, matched
  // nothing, and every dropdown reported "we could not get this to stick".
  // Not a disabled option either: it cannot be picked, and Workday opens a
  // list with only its disabled "Select One" before the real options load —
  // read at that moment, the Degree list looked like it had nothing to offer.
  // A Workday prompt's results are judged by what is drawn, not aria-hidden:
  // Workday hides its whole page root from screen readers while the popup is
  // open, results included (see isNodeDrawn).
  const onScreen = isWorkdayPrompt(el) ? isNodeDrawn : isNodeVisible;
  const shown = nodes.filter(n => (n.textContent || '').trim() && onScreen(n) && !isChosenValue(n)
                                  && !(n.getAttribute && n.getAttribute('aria-disabled') === 'true'));
  return el ? ownOptions(doc, el, shown) : shown;
}

function isWorkdayPrompt(el) {
  if (!el) return false;
  const p = probe();
  try {
    if (p && p.workdayMultiselect && p.workdayMultiselect(el)) return true;
    // Or the field wrapper holding one.
    return !!(el.querySelector && el.querySelector('[data-automation-id="multiselectInputContainer"]'));
  } catch (e) { return false; }
}

/** Why the option rows on the page were not taken, counted ("aria-hidden: 6") — for failure reports. */
function rowsRejected(doc) {
  const p = probe();
  const nodes = p && p.optionNodes ? p.optionNodes(doc) : [];
  const counts = {};
  for (const n of nodes) {
    const why = !(n.textContent || '').trim() ? 'empty'
      : isChosenValue(n) ? 'chosen'
      : (n.getAttribute && n.getAttribute('aria-disabled') === 'true') ? 'disabled'
      : (hiddenReason(n) || 'taken-or-not-own');
    counts[why] = (counts[why] || 0) + 1;
  }
  return counts;
}

/**
 * Of the options on screen, the ones that belong to THIS control.
 *
 * The sweep above is document-wide, so a list another dropdown left open was
 * read as this one's. On Oracle Candidate Experience the phone "Country code"
 * list ("+91 (India)") was still up when the address "Country" opened, and
 * "India" matched "+91 (India)" in the wrong list — Country stayed empty.
 * A control that names its listbox (aria-controls / aria-owns) gets exactly
 * that list; otherwise a list some OTHER control claims is left out.
 */
function ownOptions(doc, el, nodes) {
  const ref = n => (n && n.getAttribute && (n.getAttribute('aria-controls') || n.getAttribute('aria-owns'))) || '';
  let mine = null;
  for (let n = el, i = 0; n && i < 4 && !mine; n = n.parentElement, i++) {
    const id = ref(n).split(/\s+/)[0];
    if (id) { try { mine = doc.getElementById(id); } catch (e) { mine = null; } }
  }
  if (mine) {
    const inMine = nodes.filter(n => mine.contains(n));
    if (inMine.length) return inMine;
  }
  return nodes.filter(n => {
    const lb = n.closest && n.closest('[role="listbox"]');
    if (!lb || !lb.id) return true;
    let owner = null;
    try { owner = doc.querySelector(`[aria-controls~="${lb.id}"], [aria-owns~="${lb.id}"]`); } catch (e) { owner = null; }
    return !owner || owner === el || owner.contains(el) || el.contains(owner);
  });
}

/**
 * The options of a list just opened. A list that is OPEN (aria-expanded) but
 * still has nothing pickable is loading — Workday's Degree shows only its
 * disabled "Select One" first — so it is given up to TIMING.remoteSearchMs,
 * returning the moment options arrive. Only for opening a list: a typed search
 * that matches nothing is expanded and empty too, and must not wait.
 */
async function waitForOpenedList(el) {
  const nodes = await waitForOptions(el, TIMING.optionWaitMs);
  if (nodes.length || !isExpanded(el)) return nodes;
  return waitForOptions(el, TIMING.remoteSearchMs);
}

function isExpanded(el) {
  for (let n = el, i = 0; n && i < 3; n = n.parentElement, i++) {
    if (n.getAttribute && n.getAttribute('aria-expanded') === 'true') return true;
  }
  return false;
}

function waitForOptions(el, timeout) {
  return new Promise(resolve => {
    const doc = (el.ownerDocument) || globalThis.document;
    const immediate = visibleOptionNodes(doc, el);
    if (immediate.length) { resolve(immediate); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { obs.disconnect(); } catch (e) {}
      clearTimeout(timer);
      resolve(visibleOptionNodes(doc, el));
    };
    // Observing the whole document, because react-select renders its menu into
    // a <body>-level portal rather than inside the field.
    const obs = new globalThis.MutationObserver(() => {
      if (visibleOptionNodes(doc, el).length) finish();
    });
    try { obs.observe(doc.body, { childList: true, subtree: true }); } catch (e) {}
    const timer = setTimeout(finish, timeout);
  });
}

/**
 * Keep waiting while this control's own list says it is still loading.
 *
 * Search-as-you-type lists that query a server show a placeholder until the
 * answer arrives — Ashby's Location shows "Loading..." in the listbox its
 * input aria-controls — and that round trip can outlast every fixed wait
 * here. Only a list that SAYS it is loading is waited on, so nothing changes
 * for lists that are simply empty. Capped by TIMING.remoteSearchMs.
 */
async function waitOutLoading(el, shapes, options) {
  const doc = el.ownerDocument || globalThis.document;
  const deadline = Date.now() + TIMING.remoteSearchMs;
  let nodes = options || [];
  while ((!nodes.length || !listOffersAny(shapes, nodes))
         && listStillLoading(doc, el) && Date.now() < deadline) {
    await sleep(100);
    nodes = visibleOptionNodes(doc, el);
  }
  return nodes.length ? nodes : visibleOptionNodes(doc, el);
}

const LOADING_TEXT_RE = /^\s*(loading|searching)\b[.…\s]*$/i;

/** Does the listbox this control owns show a loading state? */
function listStillLoading(doc, el) {
  let id = '';
  for (let n = el, i = 0; n && i < 4 && !id; n = n.parentElement, i++) {
    id = ((n.getAttribute && (n.getAttribute('aria-controls') || n.getAttribute('aria-owns'))) || '')
      .split(/\s+/)[0];
  }
  if (!id) return false;
  let list = null;
  try { list = doc.getElementById(id); } catch (e) { list = null; }
  if (!list) return false;
  try {
    if (list.matches('[aria-busy="true"], [data-loading]')
        || list.querySelector('[aria-busy="true"], [data-loading], [role="progressbar"]')) return true;
  } catch (e) { return false; }
  return LOADING_TEXT_RE.test(list.textContent || '');
}

/**
 * Wait for the list to show an option for the answer, up to `timeout`.
 *
 * After typing, the list re-renders on its own schedule — Oracle's City list
 * comes back from its server — so reading it at once returns the stale list
 * from before the keystrokes. Resolves with whatever is showing at the end.
 */
async function waitForMatchingOptions(el, shapes, timeout) {
  const doc = el.ownerDocument || globalThis.document;
  const deadline = Date.now() + timeout;
  let nodes = [];
  for (;;) {
    nodes = visibleOptionNodes(doc, el);
    if (nodes.length && listOffersAny(shapes, nodes)) return nodes;
    if (Date.now() >= deadline) return nodes;
    await sleep(100);
  }
}

/** The option the widget has highlighted (aria-activedescendant, or marked), if it is one of ours. */
function highlightedMatches(el, shapes) {
  const doc = el.ownerDocument || globalThis.document;
  let hl = null;
  const active = (el.getAttribute && el.getAttribute('aria-activedescendant')) || '';
  if (active) { try { hl = doc.getElementById(active); } catch (e) { hl = null; } }
  if (!hl) {
    hl = visibleOptionNodes(doc, el).find(n => n.getAttribute('aria-selected') === 'true'
      || /(^|[\s_-])(focused|highlighted|active|hover)($|[\s_-])/i.test(String(n.className || '')));
  }
  if (!hl) return false;
  const text = (hl.textContent || '').replace(/\s+/g, ' ').trim();
  return shapes.some(sh => commitMatches(sh, text));
}

/** Does this open list hold an option for any of the answer's shapes? */
function listOffersAny(shapes, nodes) {
  const labels = nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
  return shapes.some(sh => labels.some(t => commitMatches(sh, t)) || bestOptionMatch(sh, labels) != null);
}

async function clickMatchingOption(el, value, nodes) {
  const labels = nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
  // The exact option first. A whole-word match alone took the FIRST row holding
  // every word — Workday's results list "Computer & Info Science" above
  // "Computer Science", and the wrong one was clicked.
  const want = normalizeOptionText(value);
  let idx = want ? labels.findIndex(t => normalizeOptionText(t) === want) : -1;
  // A country in a list of countries: that country or nothing. "Indian" is a
  // whole word of "British Indian Ocean Territory", and PwC's Country of Birth
  // was filled with it (Oct 2026).
  const country = countryOf(value);
  if (idx < 0 && country && countryShare(labels) >= 0.5) {
    const pick = countryOption(country, labels);
    idx = pick == null ? -1 : labels.indexOf(pick);
    if (idx < 0) return false;
  }
  if (idx < 0) idx = labels.findIndex(t => commitMatches(value, t));
  if (idx < 0) {
    // No whole-word match among what is on screen. Fall back to the fuzzy
    // matcher, but only against the rows actually offered — so this can pick a
    // differently-worded real option and can still pick nothing.
    const best = bestOptionMatch(value, labels);
    idx = best == null ? -1 : labels.indexOf(best);
  }
  if (idx < 0) return false;
  const node = nodes[idx];
  // On a Workday result row, the innermost element holding the text: the click
  // then bubbles through whatever inside the row listens (promptLeafNode, the
  // radio, the row itself), as a person's click on the words does.
  let target = node;
  const WD_ROW = '[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]';
  let workdayRow = false;
  try { workdayRow = node.matches(WD_ROW) || !!node.querySelector(WD_ROW); } catch (e) { workdayRow = false; }
  if (workdayRow) {
    for (const d of node.querySelectorAll('*')) {
      if ((d.textContent || '').replace(/\s+/g, ' ').trim() === labels[idx]) target = d;
    }
  }
  try { target.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  pressPointer(target);
  return true;
}

/**
 * The results of a Workday prompt search, once they offer one of `shapes`.
 *
 * Workday searches its server after Enter, and that round trip regularly ran
 * past the 1.2 s this used to wait: the extension moved on to the next skill
 * just as the previous skill's results arrived (NVIDIA, Oct 2026). So it waits
 * up to TIMING.remoteSearchMs for results that offer the answer — returning
 * the moment they do, so a fast search costs nothing extra — and stops early
 * once Workday says "No Items" for a search that has had time to run.
 */
async function waitForPromptResults(el, shapes, done) {
  const doc = el.ownerDocument || globalThis.document;
  const start = Date.now();
  const deadline = start + Math.max(TIMING.remoteSearchMs, TIMING.optionWaitMs * 2);
  // The same strict test the pick uses (exact, or every word). The fuzzy
  // listOffersAny accepted the PREVIOUS search's results still on screen —
  // "Machine Learning Methods" for "Deep Learning" — so it stopped waiting,
  // found nothing to click, and moved on as the real results arrived.
  const offers = nodes => {
    const labels = nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
    return shapes.some(s => promptResultFor(s, labels) >= 0);
  };
  for (;;) {
    // Workday may select the answer itself on Enter (Field of Study, an exact
    // match): nothing to click then — clicking would only toggle it.
    if (done && done()) return [];
    const nodes = visibleOptionNodes(doc, el);
    if (nodes.length && offers(nodes)) return nodes;
    if (Date.now() - start > 1500 && saysNoItems(doc)) return nodes;
    if (Date.now() >= deadline) return nodes;
    await sleep(100);
  }
}

/** Workday's empty-search message ("No Items.") is on screen. */
function saysNoItems(doc) {
  const roots = Array.from(doc.querySelectorAll('[data-automation-id="activeListContainer"], [role="listbox"]'));
  return roots.some(root => {
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/^\s*no (items|results|matches)( found)?\.?\s*$/i.test(n.nodeValue || '')
          && isNodeVisible(n.parentElement)) return true;
    }
    return false;
  });
}

/** The answers a Workday prompt already shows as pills. */
function promptPills(row) {
  const p = probe();
  const box = p && p.workdayMultiselect && p.workdayMultiselect(typableInput(row) || row.el);
  if (!box) return [];
  return Array.from(box.querySelectorAll('[data-automation-id="selectedItem"]'))
    .map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The result row for `want`: the exact one, else the first holding all its words. Never fuzzy. */
function promptResultFor(want, labels) {
  const exact = normalizeOptionText(want);
  let idx = labels.findIndex(t => normalizeOptionText(t) === exact);
  if (idx < 0) idx = labels.findIndex(t => commitMatches(want, t));
  return idx;
}

/**
 * Add several answers to a Workday multi-select prompt ("Type to Add Skills").
 *
 * Workday's own sequence, per answer: write it, press Enter (typing alone does
 * not search — the old results stay up), wait for "Search Results", click the
 * row. The list stays open between answers. A skill already shown as a pill
 * is left alone: its row is a ticked checkbox, and clicking it again removes
 * it. A skill with no result containing its words is skipped and reported —
 * an approximate pick would be a skill the person never claimed.
 */
async function commitPromptMulti(row, values) {
  const el = row.el;
  const input = typableInput(row) || el;
  const out = { added: [], already: [], missing: [], pills: [] };
  const shown = () => promptPills(row);
  const has = (pills, skill) => pills.some(t => promptResultFor(skill, [t]) === 0);
  // The search text, with an input event only. setText's extra `change` is
  // nothing Workday's search box needs while its list is open.
  const writeSearch = (text) => { focus(input); writeValue(input, text); fire(input, 'input'); };

  // One skill: search with Enter, click its result, and WAIT for its pill.
  // Workday saves each pick to its server ("pill-REMOTE_SKILL-…") and redraws
  // the pills from the reply — the selection as it stood at that click, plus
  // the new skill. Clicking the next skill before the reply came back meant
  // that reply never held the earlier one: each new skill erased the one
  // before it, and the 0.1 s check logged every skill "not offered" (NVIDIA,
  // Oct 2026). A person is slower than the server; this waits for it.
  const pillWaitMs = Math.max(TIMING.commitWaitMs * 2, 300);
  const addOne = async (skill) => {
    writeSearch(skill);
    fireKey(input, 'keydown', 'Enter');
    fireKey(input, 'keyup', 'Enter');
    const options = await waitForPromptResults(el, [skill]);
    const labels = options.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
    const idx = promptResultFor(skill, labels);
    if (idx < 0) return 'missing';
    const label = labels[idx];
    if (shown().includes(label)) return 'already';   // ticked already, under another wording

    // Workday draws the results, then redraws them (the highlight on the first
    // row, the count): a row clicked the instant it appeared could already be
    // gone. Settle, then take the row as it is NOW.
    await sleep(Math.max(TIMING.settleMs, 150));
    const rowNow = () => visibleOptionNodes(el.ownerDocument || globalThis.document, el)
      .find(n => (n.textContent || '').replace(/\s+/g, ' ').trim() === label) || null;
    const press = (node) => {
      // The innermost element holding the text, so the click bubbles up through
      // whatever inside the row listens (the checkbox, the label, the row).
      let target = node;
      for (const d of node.querySelectorAll('*')) {
        if ((d.textContent || '').replace(/\s+/g, ' ').trim() === label) target = d;
      }
      try { target.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      pressPointer(target);
    };
    const ticked = (node) => !!node && (node.getAttribute('aria-selected') === 'true'
      || node.getAttribute('aria-checked') === 'true'
      || !!node.querySelector('input:checked, [aria-checked="true"]'));

    let node = rowNow() || options[idx];
    press(node);
    const deadline = Date.now() + pillWaitMs;
    let retried = false;
    while (!has(shown(), skill) && Date.now() < deadline) {
      await sleep(100);
      // Not ticked in the list either after a moment: the click did not land.
      // One more, on the row as it is now. Never when it shows ticked — a
      // second click on a ticked row would remove the skill.
      if (!retried && Date.now() > deadline - pillWaitMs / 2) {
        retried = true;
        const again = rowNow();
        if (again && !ticked(again) && !has(shown(), skill)) { node = again; press(again); }
      }
    }
    if (has(shown(), skill)) return 'added';
    try {
      console.info(`[TailorCV] skills: clicked "${label}" but no pill appeared — row was `
        + `${node && node.isConnected ? 'on the page' : 'gone'}: `
        + String(node && node.outerHTML || '').slice(0, 400));
    } catch (e) { /* diagnostics only */ }
    return 'missing';
  };

  try {
    scrollIntoView(input);
    openWidget(row);
    await sleep(TIMING.settleMs);
    for (const skill of values) {
      if (has(shown(), skill)) { out.already.push(skill); continue; }
      out[await addOne(skill)].push(skill);
    }
    // Belt and braces: anything that was on the field and is no longer —
    // whatever removed it — gets one more search and click.
    const lost = out.added.concat(out.already).filter(s => !has(shown(), s));
    for (const skill of lost) {
      console.info(`[TailorCV] skills: "${skill}" disappeared — adding it again`);
      if ((await addOne(skill)) !== 'added') {
        for (const list of [out.added, out.already]) {
          const i = list.indexOf(skill);
          if (i >= 0) list.splice(i, 1);
        }
        out.missing.push(skill);
      }
    }
  } catch (e) {
    // Reported through the counts below; the panel lists what did not land.
  } finally {
    // Nothing left in the search box for Workday to erase on blur, and no list
    // left open over the fields below.
    try { writeSearch(''); } catch (e) {}
    dismissListbox(el);
  }
  out.pills = shown();
  console.info(`[TailorCV] skills: added ${out.added.length}, already there ${out.already.length}`
               + (out.missing.length ? `, not offered: ${out.missing.join(', ')}` : ''));
  return out;
}

/** The option the planner's own rules choose for this EEO answer, or null. */
/**
 * After a click on a Workday prompt row: it either selected (done), or opened
 * the row's own level — Workday keeps citizenship per country, so "India"
 * opens "Citizen / Permanent Resident / …". Then the row stating `drill` is
 * picked, by citizenship group only: "Non-Citizen" is never "Citizen".
 *
 * true / false when settled here; null when the list never changed, so the
 * caller's ordinary commit check decides.
 */
async function drillDown(row, el, shapes, drill, before) {
  const doc = el.ownerDocument || globalThis.document;
  const isSet = () => shapes.some(s => committed(row, s));
  const was = new Set(before);
  const deadline = Date.now() + Math.max(TIMING.commitWaitMs, 300);
  let level = [];
  for (;;) {
    if (isSet()) return true;
    const nodes = visibleOptionNodes(doc, el);
    const labels = nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim());
    if (labels.length && labels.some(l => !was.has(l))) {
      const pick = citizenshipOption(drill, labels);
      if (pick) {
        await sleep(Math.max(TIMING.settleMs, 100));
        const fresh = visibleOptionNodes(doc, el);
        const node = fresh.find(n => (n.textContent || '').replace(/\s+/g, ' ').trim() === pick)
          || nodes[labels.indexOf(pick)];
        let target = node;
        for (const d of node.querySelectorAll('*')) {
          if ((d.textContent || '').replace(/\s+/g, ' ').trim() === pick) target = d;
        }
        try { target.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        pressPointer(target);
        if (await settlesTo(row, shapes.concat([pick]))) return true;
        console.info('[TailorCV] dropdown did not commit after choosing', JSON.stringify(pick),
                     'in the level that opened:', labels.slice(0, 10));
        return false;
      }
      level = labels;
    }
    if (Date.now() >= deadline) break;
    await sleep(100);
  }
  if (level.length) {
    console.info('[TailorCV] a level opened with no', JSON.stringify(drill), 'row:', level.slice(0, 10));
    return false;
  }
  return null;
}

/**
 * One answer inside a Workday two-level prompt: "How Did You Hear About Us?"
 * lists categories (Job Posting Sites ›, Social Platform ›, Referral ›…) and
 * LinkedIn sits inside one of them (PwC, Oct 2026). Searching the answer was
 * all the old writer did, and on these lists it found nothing to click.
 *
 * Search first — Workday's search can return the leaf itself. Otherwise open
 * the categories in `parents` order (only those: never a referral) and take
 * the leaf in the first one that has it. Capped, so this one field can never
 * hold up the rest of the page.
 */
async function commitHierarchyPick(row, leaf, parents, fallback) {
  // One budget for the whole field, LinkedIn and fallback together.
  const deadline = Date.now() + TIMING.remoteSearchMs + Math.max(TIMING.commitWaitMs * 2, 1000);
  const first = await pickInHierarchy(row, leaf, parents, deadline);
  if (first.ok) return true;
  // Not offered anywhere: the fallback answer ("External Agency"), searched or
  // on the top level, never inside a category. Not when the list never showed
  // a row at all: it is not answering, and asking again only waits again.
  if (!fallback || !first.sawRows || Date.now() >= deadline) return false;
  return (await pickInHierarchy(row, fallback, [], deadline)).ok;
}

async function pickInHierarchy(row, leaf, parents, deadline) {
  const el = row.el;
  const doc = el.ownerDocument || globalThis.document;
  const input = typableInput(row) || el;
  const listWaitMs = Math.max(TIMING.optionWaitMs * 2, 1000);
  const text = n => (n.textContent || '').replace(/\s+/g, ' ').trim();
  const want = normalizeOptionText(leaf);
  const rowsNow = () => visibleOptionNodes(doc, el);
  const leafRow = () => rowsNow().find(n => normalizeOptionText(text(n)) === want) || null;
  const isSet = () => committed(row, leaf);
  const press = (node) => {
    let target = node;
    for (const d of node.querySelectorAll('*')) if (text(d) === text(node)) target = d;
    try { target.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    pressPointer(target);
  };
  const takeLeaf = async () => {
    if (!leafRow()) return false;
    await sleep(Math.max(TIMING.settleMs, 100));
    const node = leafRow();
    if (!node) return false;
    press(node);
    return settlesTo(row, [leaf]);
  };
  let sawRows = false;
  // A list either shows its rows within about a second or is not going to.
  const waitRows = async (test) => {
    const until = Math.min(deadline, Date.now() + listWaitMs);
    for (;;) {
      const nodes = rowsNow();
      if (nodes.length) sawRows = true;
      if (nodes.length && test(nodes)) return nodes;
      if (Date.now() >= until) return nodes;
      await sleep(100);
    }
  };
  const isParent = (label, parent) => {
    const a = normalizeOptionText(label), b = normalizeOptionText(parent);
    return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  };
  // A row that OPENS a list: Workday draws a › on it. Pressing a plain row
  // selects it — on a flat list "Social Media" was chosen while looking for
  // the category LinkedIn might be in.
  const NAV_SEL = '[class*="chevron" i], [class*="caret-right" i], [class*="arrow-right" i], '
    + '[aria-haspopup="true"], [aria-expanded]';
  const opensList = (node) => {
    try { return node.matches(NAV_SEL) || !!node.querySelector(NAV_SEL); } catch (e) { return false; }
  };
  const reopen = async () => {
    dismissListbox(el);
    await sleep(TIMING.settleMs);
    openWidget(row);
    return waitRows(nodes => parents.some(p => nodes.some(n => isParent(text(n), p))));
  };

  let seen = [];
  try {
    scrollIntoView(el);
    dismissListbox(el);
    openWidget(row);
    await sleep(TIMING.settleMs);

    // 1. Search: write it, Enter, take the leaf if the results hold it.
    focus(input); writeValue(input, leaf); fire(input, 'input');
    fireKey(input, 'keydown', 'Enter'); fireKey(input, 'keyup', 'Enter');
    await waitForPromptResults(el, [leaf], isSet);
    if (rowsNow().length) sawRows = true;
    if (isSet()) return { ok: true, sawRows: true };
    if (await takeLeaf()) return { ok: true, sawRows: true };

    // 2. Browse: the top level itself, then each category that would hold it.
    focus(input); writeValue(input, ''); fire(input, 'input');
    let top = await reopen();
    if (await takeLeaf()) return { ok: true, sawRows: true };
    for (const parent of parents) {
      if (Date.now() >= deadline) break;
      seen = top.map(text);
      const cat = top.find(n => isParent(text(n), parent) && opensList(n));
      if (!cat) continue;
      const before = new Set(seen);
      press(cat);
      await waitRows(nodes => nodes.some(n => !before.has(text(n))));
      if (isSet()) return { ok: true, sawRows: true };
      if (await takeLeaf()) return { ok: true, sawRows: true };
      top = await reopen();                 // back to the top level
    }
    console.info('[TailorCV] no', JSON.stringify(leaf), 'in this list — rows seen:', seen.slice(0, 15),
                 '| first row:', (top[0] && top[0].outerHTML || '').slice(0, 300));
    reportDropdownFailure(row, leaf, rowsNow());
    return { ok: false, sawRows };
  } catch (e) {
    return { ok: false, sawRows };
  } finally {
    dismissListbox(row.el);
  }
}

function pickReadFirst(readFirst, labels) {
  const pick = coerce(readFirst.stored, {
    kind: 'combobox',
    options: labels,
    candidates: candidatesFor(readFirst.key, readFirst.stored, {}),
    candidateKey: readFirst.key,
    sponsorship: readFirst.sponsorship,
    country: readFirst.country,
  });
  return pick != null && labels.includes(pick) ? pick : null;
}

function committed(row, value) {
  const after = reprobe(row);
  if (!after) return false;
  if (after.invalid) return false;
  if (!after.filled) return false;          // typed but never committed
  if (differentCountries(value, after.value)) return false;
  return commitMatches(value, after.value);
}

/** Both name a country, and not the same one: never "the same answer", whatever words they share. */
function differentCountries(value, shown) {
  const a = countryOf(value), b = countryOf(shown);
  return !!(a && b && a !== b);
}

/**
 * Whether the field holds any of `shapes`, re-checked until `ms` has passed.
 *
 * One read straight after the click was too early for Oracle: the pick lands,
 * the field stays flagged invalid for a moment, then the whole block is redrawn
 * (reprobe follows the field to its new node). Reading once reported a correct
 * Country / City pick as a failure, and the repair that followed typed over it.
 * Returns as soon as it holds, so a quick widget costs no extra time.
 */
export async function settlesTo(row, shapes, ms) {
  const deadline = Date.now() + (ms == null ? TIMING.commitWaitMs : ms);
  for (;;) {
    if ((shapes || []).some(sh => committed(row, sh))) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.max(TIMING.settleMs, 100));
  }
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
    // Whether the WRITE took, read before the page reacts: Workday takes the
    // file in its change handler and clears the input at once, so reading it
    // afterwards reported a successful upload as a failure — and the caller
    // then dropped the file on the zone as well, uploading it twice.
    const set = !!(input.files && input.files.length > 0);
    fire(input, 'input');
    fire(input, 'change');
    return set;
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
    // Workday: hashed classes, but a stable automation id on the zone.
    const auto = (n.getAttribute && n.getAttribute('data-automation-id')) || '';
    if (/drop-?zone/i.test(auto)) return n;
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

// ── split dates (Workday) ────────────────────────────────────

/**
 * Write an ISO date ("2026-01-09") into Workday's separate month/day/year
 * spinbuttons.
 *
 * Typed a character at a time rather than set in one write: these inputs are
 * spinbuttons that format and advance focus from key events, and a whole-value
 * write can land in the DOM while the widget's own state stays empty.
 */
export async function setDateParts(row, iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const want = { year: m[1], month: m[2], day: m[3] };
  let wrote = 0;
  for (const el of row.members || []) {
    const part = datePartOf(el);
    if (!part || !want[part]) continue;
    await typeText(el, want[part], 0);
    fire(el, 'change');
    blur(el);
    wrote++;
  }
  return wrote > 0;
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
/**
 * Did the field end up holding what we asked for?
 *
 * Three ways of saying yes, because a widget is allowed to restate a value:
 *
 *  - the plain whole-word match, as before;
 *  - ANOTHER SHAPE of the same answer. A dial-code picker sent "India" shows
 *    "+91" — that is the widget agreeing with us, not disagreeing;
 *  - the same PHONE NUMBER, formatted. intl-tel-input rewrites a number as it
 *    is typed: "8240044652" becomes "82400 44652", and once a country is
 *    picked, "+91 82400 44652". Comparing those as words failed, the repair
 *    sweep then wrote the E.164 form into a box that already had a country
 *    code, and the person was left with a rejected number and a field we
 *    claimed we could not fill — when the first write had been correct.
 */
function accepts(decision, value, shown) {
  if (differentCountries(value, shown)) return false;
  // A split date is compared as a date: the profile's "2003-12-01" is the
  // form's "12/1/2003". As words they differ, and a correct Date of Birth (and
  // Workday's work-experience From / To) was reported as "the form shows … instead".
  if (decision && decision.row && decision.row.kind === 'date-parts') return sameDate(value, shown);
  if (commitMatches(value, shown)) return true;
  if (commitMatches(value, shown)) return true;
  for (const candidate of (decision && decision.candidates) || []) {
    if (commitMatches(candidate, shown)) return true;
  }
  // An EEO list worded its own way ("Cisgender man" for "Male") is still the
  // same answer if the planner's rules would have picked what is shown.
  if (decision && decision.readFirst && shown
      && pickReadFirst(decision.readFirst, [shown]) === shown) return true;
  return isPhoneField(decision && decision.row) && samePhone(value, shown);
}

/**
 * ISO "YYYY-MM-DD" / "YYYY-MM" / "YYYY" against a split date read back in the
 * form's order — month/day/year, month/year, or year (readDateParts) — by number.
 */
function sameDate(iso, shown) {
  const want = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(String(iso || '').trim());
  const got = String(shown || '').split('/').map(s => s.trim());
  if (!want || !got.every(s => /^\d+$/.test(s))) return false;
  const [, y, m, d] = want;
  const read = got.length === 3 ? { m: got[0], d: got[1], y: got[2] }
             : got.length === 2 ? { m: got[0], y: got[1] }
             : { y: got[0] };
  const same = (a, b) => a === undefined || b === undefined || Number(a) === Number(b);
  return same(y, read.y) && same(m, read.m) && same(d, read.d);
}

function isPhoneField(row) {
  if (!row) return false;
  const label = row.label || '';
  if (/extension|\bext\b|device|type|code/i.test(label)) return false;
  return (row.hints && row.hints.type === 'tel') || /\b(phone|mobile|telephone)\b/i.test(label);
}

/** The same number, ignoring spacing, punctuation and a leading dial code. */
function samePhone(wanted, shown) {
  const a = String(wanted || '').replace(/\D/g, '');
  const b = String(shown || '').replace(/\D/g, '');
  if (a.length < 6 || b.length < 6) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

export async function applyDecision(decision) {
  const row = decision.row;
  const value = decision.value;
  if (!row || !row.el || !value) return { ok: false, outcome: 'failed', shown: '' };

  // Workday's "Type to Add Skills": several answers, each its own search.
  if (decision.multiValues && decision.multiValues.length && row.multiPrompt) {
    const res = await commitPromptMulti(row, decision.multiValues);
    if (res.missing.length) decision.reason = `not in this employer's list: ${res.missing.join(', ')} — add any yourself`;
    const ok = res.pills.length > 0 && res.added.length + res.already.length > 0;
    return { ok, outcome: ok ? 'ok' : 'empty', shown: res.pills.join(' | ') };
  }

  let wrote = false;
  switch (row.kind) {
    case 'date-parts':
      wrote = await setDateParts(row, value);
      break;
    case 'select':
      wrote = setSelect(row.el, value);
      // A "select" that has no real <option> children is a custom widget
      // wearing a select's clothes.
      if (!wrote) wrote = await commitCombobox(row, value, decision.candidates, decision.readFirst, decision.drill);
      break;
    case 'combobox':
      wrote = decision.hierarchy && isWorkdayPrompt(row.el)
        ? await commitHierarchyPick(row, decision.hierarchy.leaf, decision.hierarchy.parents,
                                    decision.hierarchy.fallback)
        : await commitCombobox(row, value, decision.candidates, decision.readFirst, decision.drill);
      break;
    case 'radio':
    case 'checkbox':
      wrote = setCheckable(row, value);
      break;
    case 'choice':
      wrote = setChoice(row, value);
      break;
    case 'contenteditable':
      wrote = setContentEditable(row.el, value);
      break;
    default:
      wrote = setText(row.el, value);
      // A UI5 date picker (SuccessFactors) takes a typed date on Enter: the
      // input event alone leaves its own value — the one the form reads — empty.
      if (wrote && inUi5DatePicker(row.el)) {
        fireKey(row.el, 'keydown', 'Enter');
        fireKey(row.el, 'keyup', 'Enter');
        fire(row.el, 'change');
      }
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

  const result = await verdict(decision, row, value, wrote);

  // A dropdown that did not end up filled goes to the sidebar — with its real
  // options, so the person picks from the list instead of typing into a text
  // box that cannot match it. The options the writer saw if it saw any, else
  // read now: Oracle's "Uniformed forces" question reached the panel as a bare
  // text box because nothing had read its five choices.
  if (!result.ok && (row.kind === 'combobox' || row.kind === 'select')
      && !(decision.options && decision.options.length)) {
    let labels = (row.seenOptions && row.seenOptions.length) ? row.seenOptions : [];
    if (!labels.length) {
      // Our failed search text would filter the list down to nothing ("No
      // results were found"), and a box that still has focus does not reopen.
      const input = typableInput(row) || row.el;
      const after = reprobe(row);
      if (input && input.value && !(after && after.filled)) setText(input, '');
      else blur(row.el);
      await sleep(TIMING.settleMs);
      try { labels = await readComboboxOptions(row); } catch (e) { labels = []; }
    }
    if (labels.length) decision.options = labels.map(label => ({ value: label, label }));
  }
  return result;
}

async function verdict(decision, row, value, wrote) {
  await sleep(TIMING.settleMs);
  const after = reprobe(row);
  if (!after) return { ok: wrote, outcome: wrote ? 'ok' : 'failed', shown: '' };
  if (after.invalid) return { ok: false, outcome: 'rejected', shown: after.value };
  if (!after.filled) return { ok: false, outcome: 'empty', shown: '' };
  // A lone checkbox answered "yes" reads back as its own label once ticked —
  // "By selecting the checkbox, you agree…" — which never equals "yes". Ticked
  // IS the answer, so a filled single box is a success, not a mismatch.
  const loneCheckboxTicked = row.kind === 'checkbox' && (row.options || []).length <= 1
    && /^(yes|true|on|checked)$/i.test(String(value));
  if (!loneCheckboxTicked && !accepts(decision, value, after.value)) {
    return { ok: false, outcome: 'mismatch', shown: after.value };
  }
  return { ok: true, outcome: 'ok', shown: after.value };
}
