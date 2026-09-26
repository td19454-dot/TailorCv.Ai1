// Field probe -- the single definition of "what is this form field, and does it
// already hold an accepted value?" shared by BOTH consumers:
//
//   * auto_apply/browser.py  -- reads this file off disk and evaluates it in a
//     remote Playwright/Stagehand page (see _probe_js there).
//   * the Chrome extension   -- esbuild bundles it into autofill.bundle.js and
//     calls describeEl() with elements it already holds, no selector needed.
//
// It lived as a Python string literal in browser.py until this split. Keep the
// helpers below byte-identical when touching them: every comment in resolve /
// control / only / labelFor / rsContainer / isInvalid records a specific
// production failure (a dozen fields collapsing onto one identity, a filled
// field the form was rejecting counted as done, an open dropdown menu read as
// the field's own value), and the invariants they describe are load-bearing for
// the fill registry, the missing-field reconciliation and the review UI alike.
//
// Pure reads only. Nothing here clicks, types, focuses or writes an attribute
// on the host page -- a React re-render would wipe an attribute anyway, and
// Workday's own observers react to attribute churn.
(() => {
  if (globalThis.__tcvFieldProbe) return;   // idempotent: injected per frame, per pass

  const txt = (n) => (n && n.textContent ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const attr = (n, a) => ((n && n.getAttribute && n.getAttribute(a)) || '').trim();

  // isContentEditable is a computed property, and not every DOM implementation
  // provides it (jsdom, where the probe's unit tests run, does not). The
  // attribute is what CONTROL_SEL already matches on, so checking both keeps
  // classification consistent with selection. "" counts as true per the HTML
  // spec: contenteditable="" is editable.
  const isEditable = (n) => !!n && (n.isContentEditable === true
    || (n.hasAttribute && n.hasAttribute('contenteditable')
        && attr(n, 'contenteditable').toLowerCase() !== 'false'));

  // Each entry is [kind, selector], already classified and normalized by
  // _selector_kind() in Python — see its docstring for why the raw string
  // could not be resolved here. Both engines stay as mutual fallbacks in case
  // a selector is classified wrongly.
  function resolve(pair) {
    if (!pair || !pair[1]) return null;
    const kind = pair[0], sel = pair[1];
    const byXPath = () => {
      try {
        const r = document.evaluate(sel, document, null, 9, null); // FIRST_ORDERED_NODE_TYPE
        return r ? r.singleNodeValue : null;
      } catch (e) { return null; }
    };
    const byCss = () => {
      try { return document.querySelector(sel); } catch (e) { return null; }
    };
    let n = (kind === 'xpath') ? (byXPath() || byCss()) : (byCss() || byXPath());
    while (n && n.nodeType !== 1) n = n.parentNode;
    return (n && n.nodeType === 1) ? n : null;
  }

  // The same field resolves to the <input>, a wrapper div, or a bare <label>
  // depending on the pass. Normalise all three onto one control.
  const CONTROL_SEL = 'select, textarea, input:not([type="hidden"]):not([type="file"]), [role="combobox"], [contenteditable="true"]';
  function control(n) {
    if (!n) return null;
    const tag = (n.tagName || '').toLowerCase();
    if (tag === 'label') {
      const f = attr(n, 'for');
      if (f) { let t = null; try { t = document.getElementById(f); } catch (e) {} if (t) return t; }
      const inner = n.querySelector(CONTROL_SEL);
      if (inner) return inner;
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return n;
    if (attr(n, 'role') === 'combobox' || isEditable(n)) return n;
    // A <button> that opens a listbox is itself the dropdown (Workday).
    if (tag === 'button' && attr(n, 'aria-haspopup') === 'listbox') return n;
    // Never GUESS which control a multi-control node means. observe() can hand
    // back a broad wrapper (a page-level <div class="application-container">),
    // and taking its first control would give a dozen different fields the
    // identity of whichever one happens to come first — usually First Name,
    // which is filled. With the registry live that is actively dangerous: an
    // empty field would be skipped as "already filled", and filled_field_labels
    // would report a label that clears a genuinely-missing field, letting an
    // incomplete form reach submit. Returning null instead means no identity,
    // which means never skippable — the safe direction.
    const own = only(n);
    if (own) return own;
    // Widening list deliberately excludes [class*="container"]: it matches
    // page-level wrappers as readily as field ones. react-select is unaffected
    // — it has its own rsContainer() lookup below.
    const wide = n.closest && n.closest('fieldset, [class*="field"], [class*="form-group"]');
    return (wide && only(wide)) || null;
  }

  // The single control inside `n`, or null when it holds none or several.
  function only(n) {
    let found;
    try { found = n.querySelectorAll(CONTROL_SEL); } catch (e) { return null; }
    return found && found.length === 1 ? found[0] : null;
  }

  function labelFor(el) {
    if (!el) return '';
    const aria = attr(el, 'aria-label');
    if (aria) return aria;
    const by = attr(el, 'aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(id => {
        let e = null; try { e = document.getElementById(id); } catch (x) {} return e ? txt(e) : '';
      }).filter(Boolean).join(' ');
      if (t) return t;
    }
    const id = attr(el, 'id');
    if (id) {
      let lab = null;
      try { lab = document.querySelector('label[for="' + id.replace(/["\\]/g, '\\$&') + '"]'); } catch (e) {}
      if (lab) return txt(lab);
    }
    const anc = el.closest && el.closest('label');
    if (anc) return txt(anc);

    // A <label> that is a SIBLING of the control, with no `for` and no wrapping.
    // Lever writes every field this way
    // (<label class="application-label"><span>Current company</span></label>
    //  <input name="org">), and Workday and several hand-rolled careers pages do
    // the same. Without this the field has no label at all: it falls through to
    // `ident` (here, "org"), which matches no question and makes an ordinary
    // "Current company" box unanswerable.
    //
    // Scoped to the field's own wrapper, and only while that wrapper holds this
    // one control — the same bound rsContainer and isInvalid use. An unscoped
    // "nearest preceding label" search on a compact form reads the label of the
    // field ABOVE, which is worse than no label: it produces a confident wrong
    // answer instead of a question.
    const sibling = siblingLabel(el);
    if (sibling) return sibling;

    const fs = el.closest && el.closest('fieldset');
    if (fs) { const lg = fs.querySelector('legend'); if (lg) return txt(lg); }
    return attr(el, 'placeholder');
  }

  function siblingLabel(el) {
    let n = el.parentElement, depth = 0;
    while (n && depth < 3) {
      if (only(n) !== el) break;          // now covering other controls: too far
      if (isFormLevel(n)) break;
      let labels = null;
      try { labels = n.querySelectorAll('label'); } catch (e) { labels = null; }
      if (labels) {
        for (let i = 0; i < labels.length; i++) {
          // Skip a label that wraps a DIFFERENT control — on a radio group the
          // per-option labels live here too, and the group's question does not.
          if (labels[i].querySelector(CONTROL_SEL)) continue;
          const t = txt(labels[i]);
          if (t) return t;
        }
      }
      // The label may sit just before the wrapper rather than inside it.
      const prev = n.previousElementSibling;
      if (prev && (prev.tagName || '').toLowerCase() === 'label'
          && !prev.querySelector(CONTROL_SEL)) {
        const t = txt(prev);
        if (t) return t;
      }
      n = n.parentElement; depth++;
    }
    return '';
  }

  // The react-select wrapper for THIS control, or null.
  //
  // Must never climb past the widget. A plain el.closest('[class*="container"]')
  // matches a page-level <div class="application-container"> just as happily,
  // and then every text input on the form reads the FIRST react-select's
  // .singleValue and hidden input — so a dozen distinct fields collapse onto
  // one identity and one value. With the registry live that is worse than
  // useless: empty fields get skipped as "already filled" and bogus labels
  // clear genuinely-missing fields, letting an incomplete form reach submit.
  // Climb only while the ancestor still wraps this one control and nothing
  // else, which is exactly what a widget wrapper does and a form wrapper
  // never does.
  function rsContainer(el) {
    let n = el.parentElement, depth = 0, best = null;
    while (n && depth < 5) {
      if (only(n) !== el) break;   // now covering other controls: too far
      const cls = (n.className && String(n.className)) || '';
      if (/container|control|select|field/i.test(cls)) best = n;
      n = n.parentElement; depth++;
    }
    return best;
  }

  // Whether `n` is the form itself (or an equivalent whole-form container).
  //
  // The only(n) !== el guard below stops a wrapper climb as soon as the
  // ancestor covers more than this one control — which on a real form happens
  // within a step or two. But a form with a SINGLE control never trips it, so
  // the climb runs all the way to <form> and adopts the form's own error
  // banner or "* indicates required" legend as if it belonged to the field.
  // Anything at form level describes the whole form by definition.
  function isFormLevel(n) {
    if (!n) return true;
    const tag = (n.tagName || '').toLowerCase();
    return tag === 'form' || tag === 'body' || tag === 'main'
        || attr(n, 'role') === 'form';
  }

  // Whether this control holds anything at all — used to tell "empty" apart
  // from "rejected". Intentionally cruder than describeEl's per-kind read:
  // this only has to answer "is there something here to be invalid about?".
  function hasAnyValue(el) {
    if (!el) return false;
    const type = attr(el, 'type').toLowerCase();
    if (type === 'radio' || type === 'checkbox') return !!el.checked;
    if (isEditable(el)) return !!txt(el);
    return !!(el.value != null && String(el.value).trim());
  }

  // Whether the form is currently REJECTING this field's value.
  //
  // "Filled" is not the same as "accepted". A phone field reading
  // "+246 8240044652" under a red "Phone number is too long" is filled and
  // wrong, and treating it as done let an invalid application be submitted,
  // then blocked the retry that was supposed to fix it (the registry skipped
  // it as already filled). An invalid field must count as NOT done, so it
  // stays fillable, stays in the missing list, and can be rewritten.
  function isInvalid(el) {
    if (!el) return false;
    if (attr(el, 'aria-invalid') === 'true') return true;
    // Constraint validation, but only once there is something to reject. An
    // empty required field fails checkValidity() the moment the page loads,
    // and "not filled in yet" is a different state from "the form rejected
    // what we wrote" — the review UI shows the second as an error against the
    // value, and every untouched required field would have been reported that
    // way. aria-invalid and an explicit error node (below) still count on an
    // empty field, because there the site itself has said so.
    try {
      if (el.willValidate && !el.checkValidity() && hasAnyValue(el)) return true;
    } catch (e) {}
    // Custom validation (what Greenhouse actually uses): an error node inside
    // the field's own wrapper. Bounded climb, same reasoning as rsContainer —
    // a form-level error banner must not condemn every field on the page.
    let n = el.parentElement, depth = 0;
    while (n && depth < 4) {
      if (only(n) !== el) break;   // now covering other controls: too far
      if (isFormLevel(n)) break;   // its children are the whole form's, not this field's
      let errs = null;
      try { errs = n.querySelectorAll('[class*="error"], [class*="invalid"], [role="alert"]'); }
      catch (e) { errs = null; }
      if (errs) {
        for (let i = 0; i < errs.length; i++) {
          if (txt(errs[i])) return true;
        }
      }
      n = n.parentElement; depth++;
    }
    return false;
  }

  // The whole descriptor for one already-resolved control. Split out of
  // describe() so the extension -- which walks the DOM itself and therefore
  // already holds the element -- never has to round-trip through a selector.
  function describeEl(el) {
    if (!el) return null;
    const tag = (el.tagName || '').toLowerCase();
    const type = attr(el, 'type').toLowerCase();
    const name = attr(el, 'name');
    const id = attr(el, 'id');
    const label = labelFor(el);
    let kind = tag, ident = '', value = '', filled = false;

    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
      kind = type;
      // A shared name collapses the whole group into ONE logical field, which
      // is what stops three radios reading as three separate fields.
      let group = [el];
      if (name) {
        try {
          group = Array.prototype.slice.call(
            document.querySelectorAll('input[type="' + type + '"]')
          ).filter(x => x.name === name);
        } catch (e) { group = [el]; }
      }
      const checked = group.filter(x => x.checked);
      filled = checked.length > 0;
      value = checked.map(x => labelFor(x) || x.value || '').filter(Boolean).join(' | ');
      ident = name || label || id;

    } else if (tag === 'select') {
      kind = 'select';
      const opt = (el.selectedIndex >= 0 && el.options) ? el.options[el.selectedIndex] : null;
      value = opt ? txt(opt) : '';
      // A non-empty value rejects <option value="">Select…</option> without
      // needing to re-implement the placeholder regex here.
      filled = !!(el.value && String(el.value).trim()) && !!value;
      ident = name || label || id;

    } else if (isEditable(el)) {
      kind = 'contenteditable';
      value = txt(el); filled = !!value; ident = label || name || id;

    } else if (tag === 'input' && workdayMultiselect(el)) {
      // Workday's multiselect prompt ("How Did You Hear About Us?"). The input is
      // only a SEARCH box: whatever is typed into it is not an answer, and the
      // answer, once chosen, renders as separate selectedItem nodes while the
      // box is cleared. Reading the input as a text field would report typed
      // text as a filled field — a success on a field the form still rejects.
      kind = 'combobox';
      const box = workdayMultiselect(el);
      let items = [];
      try { items = Array.prototype.slice.call(box.querySelectorAll('[data-automation-id="selectedItem"]')); }
      catch (e) { items = []; }
      value = items.map(txt).filter(Boolean).join(' | ');
      filled = !!value;
      ident = name || label || id;

    } else if (tag === 'button' && attr(el, 'aria-haspopup') === 'listbox') {
      // A dropdown that is a <button>, as on Workday: the current value IS the
      // button's own text, and the options exist only in a portal listbox after
      // it is pressed. "Select One" means empty. The label comes from label[for]
      // before aria-label, because Workday's aria-label bundles the value and the
      // word "Required" into it ("Country India Required") — used as a label that
      // would change every time the answer did, and never match a question.
      kind = 'combobox';
      const shown = txt(el);
      value = (shown && !PLACEHOLDER_OPTION_RE.test(shown)
               && !/^(select one|none selected|choose one)$/i.test(shown)) ? shown : '';
      filled = !!value;
      const own = buttonLabel(el, shown);
      ident = name || attr(el, 'data-automation-id') || own || id;
      return { ident: ident, kind: kind, label: own, value: value, filled: filled,
               invalid: attr(el, 'aria-invalid') === 'true',
               required: /\*/.test(own) || /\brequired\b/i.test(attr(el, 'aria-label'))
                         || attr(el, 'aria-required') === 'true',
               options: null };

    } else if (tag === 'textarea' || tag === 'input' || attr(el, 'role') === 'combobox') {
      const cont = rsContainer(el);
      const single = cont && cont.querySelector('[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"]');
      const ph = cont && cont.querySelector('[class*="placeholder"]');
      const hidden = cont && cont.querySelector('input[type="hidden"][name]');
      const isCombo = !!(single || ph || attr(el, 'role') === 'combobox'
                         || attr(el, 'aria-haspopup') === 'listbox');
      if (isCombo && cont) {
        kind = 'combobox';
        // react-select renders the committed value into the wrapper and
        // CLEARS the inner input, so the input is not the place to look.
        if (single) { value = txt(single); }
        else if (hidden && hidden.value) { value = String(hidden.value).trim(); }
        else if (ph) { value = ''; }
        else if (cont.querySelector('[role="option"], [role="listbox"], [class*="menu"]')) {
          // The menu is OPEN, so nothing has been chosen yet. Falling through
          // to the container's text here would return the whole option list as
          // the field's "value" — and since that list contains the option we
          // were trying to pick, the did-it-commit check would match it and
          // call an uncommitted dropdown a success.
          value = '';
        }
        else {
          const shown = txt(cont);
          value = (label && shown.indexOf(label) === 0) ? shown.slice(label.length).trim() : shown;
        }
        filled = !!value;
        ident = (hidden ? attr(hidden, 'name') : '') || name || label || id;
      } else {
        kind = (tag === 'textarea') ? 'textarea' : 'text';
        value = String(el.value || '').trim();
        filled = !!value;
        ident = name || label || id;
      }
    } else {
      value = txt(el); filled = !!value; ident = name || label || id;
    }

    // No stable identity => the caller must NOT be able to skip this field.
    if (!ident) return null;
    return { ident: ident, kind: kind, label: label, value: value,
             filled: !!filled, invalid: isInvalid(el),
             required: requiredFor(el), options: optionsFor(el) };
  }


  // Whether the form marks this field as required.
  //
  // The wrapper climb is bounded by the same only(n) !== el test rsContainer
  // and isInvalid use: a form-level "* indicates a required field" legend must
  // not mark every field on the page as required, which is what an unbounded
  // .closest() search for [class*="required"] would do.
  function requiredFor(el) {
    if (!el) return false;
    if (el.required === true) return true;
    if (attr(el, 'aria-required') === 'true') return true;
    const lab = labelFor(el);
    if (/\*/.test(lab) || /\(required\)/i.test(lab)) return true;
    let n = el.parentElement, depth = 0;
    while (n && depth < 3) {
      if (only(n) !== el) break;
      if (isFormLevel(n)) break;   // "Fields marked * are required" is not this field
      try {
        if (n.querySelector('[class*="required"], abbr[title*="required" i]')) return true;
      } catch (e) { /* bad selector support: fall through */ }
      n = n.parentElement; depth++;
    }
    return false;
  }

  // A native <select>'s real choices. Null for anything else -- a custom
  // combobox's options only exist in a portal-rendered listbox that appears
  // after a click, which is the caller's job (it needs to await a render).
  //
  // The placeholder option ("Select...", empty value) is dropped rather than
  // returned: it is never a real answer, and leaving it in makes it a
  // candidate the option matcher could pick when a real answer scores low.
  // Same rule as _parse_select_options in browser.py.
  const PLACEHOLDER_OPTION_RE = /^(select|choose|please select)\b.*\.{0,3}$|^--+$/i;

  function optionsFor(el) {
    if (!el || (el.tagName || '').toLowerCase() !== 'select') return null;
    const out = [], opts = el.options || [];
    for (let i = 0; i < opts.length; i++) {
      const label = txt(opts[i]);
      if (!label || PLACEHOLDER_OPTION_RE.test(label)) continue;
      const raw = opts[i].value;
      const value = (raw != null && String(raw).trim()) ? String(raw) : label;
      if (!value) continue;
      out.push({ value: value, label: label });
    }
    return out;
  }

  // The node that visually represents this field. Visibility checks and the
  // review UI's highlight outline both go here rather than on the control:
  // react-select's inner input and Greenhouse's file input are legitimately
  // zero-size / display:none while the field itself is plainly visible.
  function fieldWrapper(el) {
    if (!el) return null;
    if (rsContainer(el)) return rsContainer(el);
    let wide = null;
    // Workday's per-field wrapper carries no class that says "field" — its
    // classes are generated hashes — but it is always data-automation-id
    // "formField-<name>", which is a far more stable signal anyway.
    try {
      wide = el.closest('[data-automation-id^="formField"], label, [class*="field"], [class*="form-group"]');
    } catch (e) {}
    return wide || el;
  }

  // The Workday multiselect container an input belongs to, or null.
  function workdayMultiselect(el) {
    if (!el || !el.closest) return null;
    let inner = null;
    try { inner = el.closest('[data-automation-id="multiselectInputContainer"]'); } catch (e) {}
    if (!inner) return null;
    let box = null;
    try {
      box = el.closest('[data-automation-id="multiSelectContainer"]')
         || el.closest('[data-automation-id^="formField"]');
    } catch (e) {}
    return box || inner;
  }

  // The question a <button aria-haspopup="listbox"> answers, without its value.
  function buttonLabel(el, shown) {
    const id = attr(el, 'id');
    if (id) {
      let lab = null;
      try { lab = document.querySelector('label[for="' + id.replace(/["\\]/g, '\\$&') + '"]'); } catch (e) {}
      if (lab && txt(lab)) return txt(lab);
    }
    const by = attr(el, 'aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(ref => {
        let e = null; try { e = document.getElementById(ref); } catch (x) {} return e ? txt(e) : '';
      }).filter(Boolean).join(' ');
      if (t) return t;
    }
    let wrap = null;
    try { wrap = el.closest('[data-automation-id^="formField"]'); } catch (e) {}
    if (wrap) {
      const lab = wrap.querySelector('label');
      if (lab && txt(lab)) return txt(lab);
    }
    // Workday's "Application Questions" step: the question is rich text in a
    // <fieldset><legend> (often after an intro paragraph), or a text block
    // beside the button, and the button carries only name="<hash>" with
    // aria-label "Select One Required". Without these the field was labelled
    // by that hash, and the model was asked to answer a question it could not
    // read — so it guessed.
    const q = questionTextAround(el);
    if (q) return q;
    // Last resort: aria-label with the current value and "Required" removed.
    let aria = attr(el, 'aria-label');
    if (shown) aria = aria.split(shown).join(' ');
    return aria.replace(/\brequired\b/ig, '').replace(/\s+/g, ' ').trim();
  }

  // Selects every control that is its own question, for the bounds below. The
  // companion text input Workday keeps beside a dropdown is allowed for.
  const QUESTION_CONTROL_SEL = 'button[aria-haspopup="listbox"], select, textarea, '
    + 'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"])';

  // The question text around a dropdown button: a fieldset legend holding only
  // this dropdown, else the text of the nearest wrapper that holds this one
  // control and no other question. Never wider — reaching into a wrapper with a
  // second question would label this field with the neighbour's text.
  function questionTextAround(el) {
    let fs = null;
    try { fs = el.closest('fieldset'); } catch (e) { fs = null; }
    if (fs) {
      let buttons = 0;
      try { buttons = fs.querySelectorAll('button[aria-haspopup="listbox"]').length; } catch (e) { buttons = 2; }
      const lg = buttons === 1 ? fs.querySelector('legend') : null;
      const t = lg ? txt(lg) : '';
      if (t && /[a-z]{3}/i.test(t)) return t.slice(0, 600);
    }
    let n = el.parentElement;
    for (let depth = 0; n && depth < 5; depth++, n = n.parentElement) {
      if (isFormLevel(n)) return '';
      let controls = 0, buttons = 0;
      try {
        buttons = n.querySelectorAll('button[aria-haspopup="listbox"]').length;
        controls = n.querySelectorAll(QUESTION_CONTROL_SEL).length;
      } catch (e) { return ''; }
      if (buttons > 1 || controls > 2) return '';   // this button + its companion input, at most
      let clone = null;
      try {
        clone = n.cloneNode(true);
        const drop = clone.querySelectorAll('button, input, select, textarea, [role="listbox"], [role="option"]');
        for (let i = 0; i < drop.length; i++) drop[i].remove();
      } catch (e) { return ''; }
      const t = txt(clone);
      if (t && /[a-z]{3}/i.test(t)) return t.slice(0, 600);
    }
    return '';
  }

  // An already-rendered listbox belonging to this control, if there is one.
  // react-select portals its menu to <body>, so aria-controls/aria-owns is the
  // only reliable link back to the field that owns it.
  function listboxFor(el) {
    if (!el) return null;
    const id = attr(el, 'aria-controls') || attr(el, 'aria-owns');
    if (id) {
      try { const n = document.getElementById(id); if (n) return n; } catch (e) {}
    }
    const cont = rsContainer(el);
    if (cont) {
      try { return cont.querySelector('[role="listbox"], [class*="menu"]'); } catch (e) {}
    }
    return null;
  }

  // Option labels currently on screen, from anywhere in the document. Scoping
  // this to the field's own subtree does not work: react-select renders its
  // menu into a <body>-level portal, so the options are not descendants of the
  // control at all.
  // Workday marks its rows data-automation-id="promptOption", sometimes without
  // role="option", so both are read. Where one row carries both (a role=option
  // wrapping a promptOption), only the outermost is kept, or every option would
  // be listed twice and the option-count guards would be off by double.
  const OPTION_SEL = '[role="option"], [data-automation-id="promptOption"]';

  function optionNodes(scope) {
    let nodes = [];
    try { nodes = Array.prototype.slice.call((scope || document).querySelectorAll(OPTION_SEL)); }
    catch (e) { return []; }
    return nodes.filter(n => !nodes.some(o => o !== n && o.contains(n)));
  }

  function visibleOptionLabels(limit) {
    const cap = limit || 200;
    const nodes = optionNodes(document);
    const out = [];
    for (let i = 0; i < nodes.length && out.length < cap; i++) {
      const t = txt(nodes[i]);
      if (t) out.push(t);
    }
    return out;
  }

  // Everything fillable under `root`, descending into OPEN shadow roots --
  // Workday and several component libraries put real form controls inside
  // them, and querySelectorAll stops dead at a shadow boundary.
  //
  // A CLOSED shadow root is indistinguishable from "no shadow root" from out
  // here, so opaque custom-element hosts are counted instead of guessed at.
  // The caller reports that count to the user ("N fields we could not read")
  // rather than silently returning a short list -- an undercount that looks
  // like a complete answer is the failure mode worth avoiding.
  // NOT derived from CONTROL_SEL by simple concatenation. CONTROL_SEL excludes
  // only hidden and file inputs, so it happily matches input[type=submit],
  // button, reset and image — harmless for the server engine, which is handed
  // its candidates by observe(), but the extension enumerates the DOM itself
  // and would otherwise offer the Submit button as a field to fill in.
  const NON_FIELD_INPUT_TYPES = ['hidden', 'file', 'submit', 'button', 'reset', 'image'];
  const FILLABLE_SEL = [
    'select',
    'textarea',
    'input' + NON_FIELD_INPUT_TYPES.map(t => `:not([type="${t}"])`).join(''),
    '[role="combobox"]',
    '[contenteditable="true"]',
    'input[type="file"]',     // re-added deliberately: a field, but never typed into
    // A <button> that opens a listbox is a dropdown — Workday builds every one of
    // its dropdowns this way. Deliberately NOT added to CONTROL_SEL: that one
    // defines the single-control test the server engine's identity rules rest
    // on, and widening it would change which fields they consider distinct.
    'button[aria-haspopup="listbox"]',
  ].join(', ');

  function fillableIn(root) {
    const els = [], seen = new Set();
    let opaqueHosts = 0, shadowRoots = 0;

    const walk = (node, depth) => {
      if (!node || depth > 6) return;
      let found = [];
      try { found = Array.prototype.slice.call(node.querySelectorAll(FILLABLE_SEL)); } catch (e) {}
      for (let i = 0; i < found.length; i++) {
        if (!seen.has(found[i])) { seen.add(found[i]); els.push(found[i]); }
      }
      let all = [];
      try { all = Array.prototype.slice.call(node.querySelectorAll('*')); } catch (e) {}
      for (let i = 0; i < all.length; i++) {
        const h = all[i];
        if (h.shadowRoot) { shadowRoots++; walk(h.shadowRoot, depth + 1); }
        else if (/-/.test(h.tagName || '') && !h.firstElementChild) opaqueHosts++;
      }
    };

    walk(root || document, 0);
    return { elements: els, opaqueHosts: opaqueHosts, shadowRoots: shadowRoots };
  }

  // What Python calls: resolve a [kind, selector] pair, then describe it.
  function describe(pair) {
    const node = resolve(pair);
    if (!node) return null;
    return describeEl(control(node));
  }

  function describeAll(pairs) {
    const out = [];
    for (let i = 0; i < (pairs || []).length; i++) {
      try { out.push(describe(pairs[i])); } catch (e) { out.push(null); }
    }
    return out;
  }

  globalThis.__tcvFieldProbe = {
    describe: describe,
    describeAll: describeAll,
    describeEl: describeEl,
    control: control,
    only: only,
    labelFor: labelFor,
    rsContainer: rsContainer,
    isInvalid: isInvalid,
    requiredFor: requiredFor,
    optionsFor: optionsFor,
    fieldWrapper: fieldWrapper,
    listboxFor: listboxFor,
    visibleOptionLabels: visibleOptionLabels,
    optionNodes: optionNodes,
    OPTION_SEL: OPTION_SEL,
    workdayMultiselect: workdayMultiselect,
    fillableIn: fillableIn,
    CONTROL_SEL: CONTROL_SEL,
    FILLABLE_SEL: FILLABLE_SEL,
  };
})();
