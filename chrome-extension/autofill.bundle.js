(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // ../auto_apply/field_probe.js
  (() => {
    if (globalThis.__tcvFieldProbe) return;
    const txt = (n) => n && n.textContent ? n.textContent.replace(/\s+/g, " ").trim() : "";
    const attr = (n, a) => (n && n.getAttribute && n.getAttribute(a) || "").trim();
    const isEditable = (n) => !!n && (n.isContentEditable === true || n.hasAttribute && n.hasAttribute("contenteditable") && attr(n, "contenteditable").toLowerCase() !== "false");
    function resolve(pair) {
      if (!pair || !pair[1]) return null;
      const kind = pair[0], sel = pair[1];
      const byXPath = () => {
        try {
          const r = document.evaluate(sel, document, null, 9, null);
          return r ? r.singleNodeValue : null;
        } catch (e) {
          return null;
        }
      };
      const byCss = () => {
        try {
          return document.querySelector(sel);
        } catch (e) {
          return null;
        }
      };
      let n = kind === "xpath" ? byXPath() || byCss() : byCss() || byXPath();
      while (n && n.nodeType !== 1) n = n.parentNode;
      return n && n.nodeType === 1 ? n : null;
    }
    const CONTROL_SEL = 'select, textarea, input:not([type="hidden"]):not([type="file"]), [role="combobox"], [contenteditable="true"]';
    function control(n) {
      if (!n) return null;
      const tag = (n.tagName || "").toLowerCase();
      if (tag === "label") {
        const f = attr(n, "for");
        if (f) {
          let t = null;
          try {
            t = document.getElementById(f);
          } catch (e) {
          }
          if (t) return t;
        }
        const inner = n.querySelector(CONTROL_SEL);
        if (inner) return inner;
      }
      if (tag === "input" || tag === "select" || tag === "textarea") return n;
      if (attr(n, "role") === "combobox" || isEditable(n)) return n;
      if (tag === "button" && attr(n, "aria-haspopup") === "listbox") return n;
      const own = only(n);
      if (own) return own;
      const wide = n.closest && n.closest('fieldset, [class*="field"], [class*="form-group"]');
      return wide && only(wide) || null;
    }
    function only(n) {
      let found;
      try {
        found = n.querySelectorAll(CONTROL_SEL);
      } catch (e) {
        return null;
      }
      return found && found.length === 1 ? found[0] : null;
    }
    function labelFor(el) {
      if (!el) return "";
      const aria = attr(el, "aria-label");
      if (aria) return aria;
      const by = attr(el, "aria-labelledby");
      if (by) {
        const t = by.split(/\s+/).map((id2) => {
          let e = null;
          try {
            e = document.getElementById(id2);
          } catch (x) {
          }
          return e ? txt(e) : "";
        }).filter(Boolean).join(" ");
        if (t) return t;
      }
      const id = attr(el, "id");
      if (id) {
        let lab = null;
        try {
          lab = document.querySelector('label[for="' + id.replace(/["\\]/g, "\\$&") + '"]');
        } catch (e) {
        }
        if (lab) return txt(lab);
      }
      const anc = el.closest && el.closest("label");
      if (anc) return txt(anc);
      const sibling = siblingLabel(el);
      if (sibling) return sibling;
      const fs = el.closest && el.closest("fieldset");
      if (fs) {
        const lg = fs.querySelector("legend");
        if (lg) return txt(lg);
      }
      return attr(el, "placeholder");
    }
    function siblingLabel(el) {
      let n = el.parentElement, depth = 0;
      while (n && depth < 3) {
        if (only(n) !== el) break;
        if (isFormLevel2(n)) break;
        let labels = null;
        try {
          labels = n.querySelectorAll("label");
        } catch (e) {
          labels = null;
        }
        if (labels) {
          for (let i = 0; i < labels.length; i++) {
            if (labels[i].querySelector(CONTROL_SEL)) continue;
            const t = txt(labels[i]);
            if (t) return t;
          }
        }
        const prev = n.previousElementSibling;
        if (prev && (prev.tagName || "").toLowerCase() === "label" && !prev.querySelector(CONTROL_SEL)) {
          const t = txt(prev);
          if (t) return t;
        }
        n = n.parentElement;
        depth++;
      }
      return "";
    }
    function rsContainer(el) {
      let n = el.parentElement, depth = 0, best = null;
      while (n && depth < 5) {
        if (only(n) !== el) break;
        const cls = n.className && String(n.className) || "";
        if (/container|control|select|field/i.test(cls)) best = n;
        n = n.parentElement;
        depth++;
      }
      return best;
    }
    function isFormLevel2(n) {
      if (!n) return true;
      const tag = (n.tagName || "").toLowerCase();
      return tag === "form" || tag === "body" || tag === "main" || attr(n, "role") === "form";
    }
    function hasAnyValue(el) {
      if (!el) return false;
      const type = attr(el, "type").toLowerCase();
      if (type === "radio" || type === "checkbox") return !!el.checked;
      if (isEditable(el)) return !!txt(el);
      return !!(el.value != null && String(el.value).trim());
    }
    function isInvalid(el) {
      if (!el) return false;
      if (attr(el, "aria-invalid") === "true") return true;
      try {
        if (el.willValidate && !el.checkValidity() && hasAnyValue(el)) return true;
      } catch (e) {
      }
      let n = el.parentElement, depth = 0;
      while (n && depth < 4) {
        if (only(n) !== el) break;
        if (isFormLevel2(n)) break;
        let errs = null;
        try {
          errs = n.querySelectorAll('[class*="error"], [class*="invalid"], [role="alert"]');
        } catch (e) {
          errs = null;
        }
        if (errs) {
          for (let i = 0; i < errs.length; i++) {
            if (txt(errs[i])) return true;
          }
        }
        n = n.parentElement;
        depth++;
      }
      return false;
    }
    function describeEl(el) {
      if (!el) return null;
      const tag = (el.tagName || "").toLowerCase();
      const type = attr(el, "type").toLowerCase();
      const name = attr(el, "name");
      const id = attr(el, "id");
      const label = labelFor(el);
      let kind = tag, ident = "", value = "", filled = false;
      if (tag === "input" && (type === "radio" || type === "checkbox")) {
        kind = type;
        let group = [el];
        if (name) {
          try {
            group = Array.prototype.slice.call(
              document.querySelectorAll('input[type="' + type + '"]')
            ).filter((x) => x.name === name);
          } catch (e) {
            group = [el];
          }
        }
        const checked = group.filter((x) => x.checked);
        filled = checked.length > 0;
        value = checked.map((x) => labelFor(x) || x.value || "").filter(Boolean).join(" | ");
        ident = name || label || id;
      } else if (tag === "select") {
        kind = "select";
        const opt = el.selectedIndex >= 0 && el.options ? el.options[el.selectedIndex] : null;
        value = opt ? txt(opt) : "";
        filled = !!(el.value && String(el.value).trim()) && !!value;
        ident = name || label || id;
      } else if (isEditable(el)) {
        kind = "contenteditable";
        value = txt(el);
        filled = !!value;
        ident = label || name || id;
      } else if (tag === "input" && workdayMultiselect(el)) {
        kind = "combobox";
        const box = workdayMultiselect(el);
        let items = [];
        try {
          items = Array.prototype.slice.call(box.querySelectorAll('[data-automation-id="selectedItem"]'));
        } catch (e) {
          items = [];
        }
        value = items.map(txt).filter(Boolean).join(" | ");
        filled = !!value;
        ident = name || label || id;
      } else if (tag === "button" && attr(el, "aria-haspopup") === "listbox") {
        kind = "combobox";
        const shown = txt(el);
        value = shown && !PLACEHOLDER_OPTION_RE2.test(shown) && !/^(select one|none selected|choose one)$/i.test(shown) ? shown : "";
        filled = !!value;
        const own = buttonLabel(el, shown);
        ident = name || attr(el, "data-automation-id") || own || id;
        return {
          ident,
          kind,
          label: own,
          value,
          filled,
          invalid: attr(el, "aria-invalid") === "true",
          required: /\*/.test(own) || /\brequired\b/i.test(attr(el, "aria-label")) || attr(el, "aria-required") === "true",
          options: null
        };
      } else if (tag === "textarea" || tag === "input" || attr(el, "role") === "combobox") {
        const cont = rsContainer(el);
        const single = cont && cont.querySelector('[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"]');
        const ph = cont && cont.querySelector('[class*="placeholder"]');
        const hidden = cont && cont.querySelector('input[type="hidden"][name]');
        const isCombo = !!(single || ph || attr(el, "role") === "combobox" || attr(el, "aria-haspopup") === "listbox");
        if (isCombo && cont) {
          kind = "combobox";
          if (single) {
            value = txt(single);
          } else if (hidden && hidden.value) {
            value = String(hidden.value).trim();
          } else if (String(el.value || "").trim() && attr(el, "aria-expanded") === "false" && attr(el, "role") === "combobox") {
            value = String(el.value).trim();
          } else if (ph) {
            value = "";
          } else if (cont.querySelector('[role="option"], [role="listbox"], [class*="menu"]')) {
            value = "";
          } else {
            const shown = txt(cont);
            value = label && shown.indexOf(label) === 0 ? shown.slice(label.length).trim() : shown;
          }
          filled = !!value;
          ident = (hidden ? attr(hidden, "name") : "") || name || label || id;
        } else {
          kind = tag === "textarea" ? "textarea" : "text";
          value = String(el.value || "").trim();
          filled = !!value;
          ident = name || label || id;
        }
      } else {
        value = txt(el);
        filled = !!value;
        ident = name || label || id;
      }
      if (!ident) return null;
      return {
        ident,
        kind,
        label,
        value,
        filled: !!filled,
        invalid: isInvalid(el),
        required: requiredFor(el),
        options: optionsFor(el)
      };
    }
    function requiredFor(el) {
      if (!el) return false;
      if (el.required === true) return true;
      if (attr(el, "aria-required") === "true") return true;
      const lab = labelFor(el);
      if (/\*/.test(lab) || /\(required\)/i.test(lab)) return true;
      let n = el.parentElement, depth = 0;
      while (n && depth < 3) {
        if (only(n) !== el) break;
        if (isFormLevel2(n)) break;
        try {
          if (n.querySelector('[class*="required"], abbr[title*="required" i]')) return true;
        } catch (e) {
        }
        n = n.parentElement;
        depth++;
      }
      return false;
    }
    const PLACEHOLDER_OPTION_RE2 = /^(select|choose|please select)\b.*\.{0,3}$|^--+$/i;
    function optionsFor(el) {
      if (!el || (el.tagName || "").toLowerCase() !== "select") return null;
      const out = [], opts = el.options || [];
      for (let i = 0; i < opts.length; i++) {
        const label = txt(opts[i]);
        if (!label || PLACEHOLDER_OPTION_RE2.test(label)) continue;
        const raw = opts[i].value;
        const value = raw != null && String(raw).trim() ? String(raw) : label;
        if (!value) continue;
        out.push({ value, label });
      }
      return out;
    }
    function fieldWrapper(el) {
      if (!el) return null;
      if (rsContainer(el)) return rsContainer(el);
      let wide = null;
      try {
        wide = el.closest('[data-automation-id^="formField"], label, [class*="field"], [class*="form-group"]');
      } catch (e) {
      }
      return wide || el;
    }
    function workdayMultiselect(el) {
      if (!el || !el.closest) return null;
      let inner = null;
      try {
        inner = el.closest('[data-automation-id="multiselectInputContainer"]');
      } catch (e) {
      }
      if (!inner) return null;
      let box = null;
      try {
        box = el.closest('[data-automation-id="multiSelectContainer"]') || el.closest('[data-automation-id^="formField"]');
      } catch (e) {
      }
      return box || inner;
    }
    function buttonLabel(el, shown) {
      const id = attr(el, "id");
      if (id) {
        let lab = null;
        try {
          lab = document.querySelector('label[for="' + id.replace(/["\\]/g, "\\$&") + '"]');
        } catch (e) {
        }
        if (lab && txt(lab)) return txt(lab);
      }
      const by = attr(el, "aria-labelledby");
      if (by) {
        const t = by.split(/\s+/).map((ref) => {
          let e = null;
          try {
            e = document.getElementById(ref);
          } catch (x) {
          }
          return e ? txt(e) : "";
        }).filter(Boolean).join(" ");
        if (t) return t;
      }
      let wrap = null;
      try {
        wrap = el.closest('[data-automation-id^="formField"]');
      } catch (e) {
      }
      if (wrap) {
        const lab = wrap.querySelector("label");
        if (lab && txt(lab)) return txt(lab);
      }
      const q = questionTextAround(el);
      if (q) return q;
      let aria = attr(el, "aria-label");
      if (shown) aria = aria.split(shown).join(" ");
      return aria.replace(/\brequired\b/ig, "").replace(/\s+/g, " ").trim();
    }
    const QUESTION_CONTROL_SEL = 'button[aria-haspopup="listbox"], select, textarea, input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"])';
    function questionTextAround(el) {
      let fs = null;
      try {
        fs = el.closest("fieldset");
      } catch (e) {
        fs = null;
      }
      if (fs) {
        let buttons = 0;
        try {
          buttons = fs.querySelectorAll('button[aria-haspopup="listbox"]').length;
        } catch (e) {
          buttons = 2;
        }
        const lg = buttons === 1 ? fs.querySelector("legend") : null;
        const t = lg ? txt(lg) : "";
        if (t && /[a-z]{3}/i.test(t)) return t.slice(0, 600);
      }
      let n = el.parentElement;
      for (let depth = 0; n && depth < 5; depth++, n = n.parentElement) {
        if (isFormLevel2(n)) return "";
        let controls = 0, buttons = 0;
        try {
          buttons = n.querySelectorAll('button[aria-haspopup="listbox"]').length;
          controls = n.querySelectorAll(QUESTION_CONTROL_SEL).length;
        } catch (e) {
          return "";
        }
        if (buttons > 1 || controls > 2) return "";
        let clone = null;
        try {
          clone = n.cloneNode(true);
          const drop = clone.querySelectorAll('button, input, select, textarea, [role="listbox"], [role="option"], [role="alert"], [aria-live], [class*="error" i], [class*="validation" i], [class*="invalid" i], [class*="helper" i], [class*="hint" i], [class*="message" i], [id*="error" i]');
          for (let i = 0; i < drop.length; i++) drop[i].remove();
        } catch (e) {
          return "";
        }
        const t = txt(clone);
        if (/^\s*(this (information|field|question) is required|(this )?(field )?is required|required|please (select|choose|make a selection|answer)(\s+(one|an?\s+(option|value|answer|response|item)|this (question|field)))?(\s+(from (the|this|a) (list|dropdown|options)|below))?|select (one|an option)|choose one)\s*[.*!]*\s*$/i.test(t)) continue;
        if (t && /[a-z]{3}/i.test(t)) return t.slice(0, 600);
      }
      return "";
    }
    function listboxFor(el) {
      if (!el) return null;
      const id = attr(el, "aria-controls") || attr(el, "aria-owns");
      if (id) {
        try {
          const n = document.getElementById(id);
          if (n) return n;
        } catch (e) {
        }
      }
      const cont = rsContainer(el);
      if (cont) {
        try {
          return cont.querySelector('[role="listbox"], [class*="menu"]');
        } catch (e) {
        }
      }
      return null;
    }
    const OPTION_SEL = '[role="option"], [data-automation-id="promptOption"]';
    function comboGridCells(scope) {
      let cells = [];
      try {
        cells = Array.prototype.slice.call((scope || document).querySelectorAll('[role="grid"] [role="gridcell"]'));
      } catch (e) {
        return [];
      }
      const owned = /* @__PURE__ */ new Map();
      return cells.filter((c) => {
        const grid = c.closest('[role="grid"]');
        if (!grid || !grid.id) return false;
        if (!owned.has(grid)) {
          let owner = null;
          try {
            owner = (grid.ownerDocument || document).querySelector(`[role="combobox"][aria-controls~="${grid.id}"], [role="combobox"][aria-owns~="${grid.id}"]`);
          } catch (e) {
            owner = null;
          }
          owned.set(grid, !!owner);
        }
        return owned.get(grid);
      });
    }
    function optionNodes(scope) {
      let nodes = [];
      try {
        nodes = Array.prototype.slice.call((scope || document).querySelectorAll(OPTION_SEL));
      } catch (e) {
        return [];
      }
      nodes = nodes.concat(comboGridCells(scope));
      return nodes.filter((n) => !nodes.some((o) => o !== n && o.contains(n)));
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
    const NON_FIELD_INPUT_TYPES = ["hidden", "file", "submit", "button", "reset", "image"];
    const FILLABLE_SEL = [
      "select",
      "textarea",
      "input" + NON_FIELD_INPUT_TYPES.map((t) => `:not([type="${t}"])`).join(""),
      '[role="combobox"]',
      '[contenteditable="true"]',
      'input[type="file"]',
      // re-added deliberately: a field, but never typed into
      // A <button> that opens a listbox is a dropdown — Workday builds every one of
      // its dropdowns this way. Deliberately NOT added to CONTROL_SEL: that one
      // defines the single-control test the server engine's identity rules rest
      // on, and widening it would change which fields they consider distinct.
      'button[aria-haspopup="listbox"]'
    ].join(", ");
    function fillableIn(root) {
      const els = [], seen = /* @__PURE__ */ new Set();
      let opaqueHosts = 0, shadowRoots = 0;
      const walk = (node, depth) => {
        if (!node || depth > 6) return;
        let found = [];
        try {
          found = Array.prototype.slice.call(node.querySelectorAll(FILLABLE_SEL));
        } catch (e) {
        }
        for (let i = 0; i < found.length; i++) {
          if (!seen.has(found[i])) {
            seen.add(found[i]);
            els.push(found[i]);
          }
        }
        let all = [];
        try {
          all = Array.prototype.slice.call(node.querySelectorAll("*"));
        } catch (e) {
        }
        for (let i = 0; i < all.length; i++) {
          const h = all[i];
          if (h.shadowRoot) {
            shadowRoots++;
            walk(h.shadowRoot, depth + 1);
          } else if (/-/.test(h.tagName || "") && !h.firstElementChild) opaqueHosts++;
        }
      };
      walk(root || document, 0);
      return { elements: els, opaqueHosts, shadowRoots };
    }
    function describe(pair) {
      const node = resolve(pair);
      if (!node) return null;
      return describeEl(control(node));
    }
    function describeAll(pairs) {
      const out = [];
      for (let i = 0; i < (pairs || []).length; i++) {
        try {
          out.push(describe(pairs[i]));
        } catch (e) {
          out.push(null);
        }
      }
      return out;
    }
    globalThis.__tcvFieldProbe = {
      describe,
      describeAll,
      describeEl,
      control,
      only,
      labelFor,
      rsContainer,
      isInvalid,
      requiredFor,
      optionsFor,
      fieldWrapper,
      listboxFor,
      visibleOptionLabels,
      optionNodes,
      OPTION_SEL,
      workdayMultiselect,
      fillableIn,
      CONTROL_SEL,
      FILLABLE_SEL
    };
  })();

  // src/autofill/match.js
  var match_exports = {};
  __export(match_exports, {
    DECLINE_OPTION_MARKERS: () => DECLINE_OPTION_MARKERS,
    DOCUMENT_FIELD_MARKERS: () => DOCUMENT_FIELD_MARKERS,
    EEO_FIELD_MARKERS: () => EEO_FIELD_MARKERS,
    EEO_GROUPS: () => EEO_GROUPS,
    FIELD_SYNONYMS: () => FIELD_SYNONYMS,
    LABEL_STOPWORDS: () => LABEL_STOPWORDS,
    OPTION_MATCH_THRESHOLD: () => OPTION_MATCH_THRESHOLD,
    READ_FIRST_KEYS: () => READ_FIRST_KEYS,
    SENSITIVE_PATTERNS: () => SENSITIVE_PATTERNS,
    STORABLE_SENSITIVE: () => STORABLE_SENSITIVE,
    bestOptionMatch: () => bestOptionMatch,
    classifySensitive: () => classifySensitive,
    commitMatches: () => commitMatches,
    distinctive: () => distinctive,
    documentSlotFor: () => documentSlotFor,
    eeoGroup: () => eeoGroup,
    eeoOptionAllowed: () => eeoOptionAllowed,
    eeoShapes: () => eeoShapes,
    findDeclineOption: () => findDeclineOption,
    formatDateForField: () => formatDateForField,
    hasHonorificOptions: () => hasHonorificOptions,
    isConditionalFollowUp: () => isConditionalFollowUp,
    isMotivationQuestion: () => isMotivationQuestion,
    isNeverFill: () => isNeverFill,
    isPlaceholderOption: () => isPlaceholderOption,
    labelsMatch: () => labelsMatch,
    looksLikeDecline: () => looksLikeDecline,
    looksLikeEeoField: () => looksLikeEeoField,
    looksLikeOpaqueId: () => looksLikeOpaqueId,
    looksSecret: () => looksSecret,
    matchFieldKey: () => matchFieldKey,
    matchSensitiveKey: () => matchSensitiveKey,
    normalizeOptionText: () => normalizeOptionText,
    parseLooseDate: () => parseLooseDate,
    questionSignature: () => questionSignature,
    similarity: () => similarity,
    splitPhone: () => splitPhone,
    stripRegionSuffix: () => stripRegionSuffix,
    withoutEmployer: () => withoutEmployer
  });
  function questionSignature(text) {
    let s = String(text == null ? "" : text).toLowerCase().trim();
    s = s.replace(/[^a-z0-9\s]/g, " ");
    return s.replace(/\s+/g, " ").trim().slice(0, 160);
  }
  function normalizeOptionText(text) {
    let s = String(text == null ? "" : text).toLowerCase().trim();
    s = s.replace(/[^a-z0-9\s]/g, " ");
    return s.replace(/\s+/g, " ").trim();
  }
  var OPTION_MATCH_THRESHOLD = 0.55;
  function stripRegionSuffix(label) {
    let s = String(label == null ? "" : label).trim();
    for (let i = 0; i < 3; i++) {
      const m = s.match(/^(.*\S)\s*\(([^()]*)\)\s*$/);
      if (!m || /hispanic|latin|not\b|non\b|only|alone|origin|\d/i.test(m[2])) break;
      s = m[1].trim();
    }
    return s;
  }
  var PLACEHOLDER_OPTION_RE = /^(select|choose|please select)\b.*\.{0,3}$|^--+$/i;
  function isPlaceholderOption(label) {
    return PLACEHOLDER_OPTION_RE.test(String(label == null ? "" : label).trim());
  }
  function commitMatches(wanted, shown) {
    const want = new Set(normalizeOptionText(wanted).split(" ").filter(Boolean));
    const got = new Set(normalizeOptionText(shown).split(" ").filter(Boolean));
    if (!want.size) return true;
    if (!got.size) return false;
    return isSubset(want, got) || isSubset(got, want);
  }
  function isSubset(small, large) {
    for (const t of small) if (!large.has(t)) return false;
    return true;
  }
  function similarity(a, b) {
    const s = String(a == null ? "" : a), t = String(b == null ? "" : b);
    if (!s.length && !t.length) return 1;
    if (!s.length || !t.length) return 0;
    return 2 * matchingBlockTotal(s, t) / (s.length + t.length);
  }
  function matchingBlockTotal(a, b) {
    const b2j = /* @__PURE__ */ new Map();
    for (let j = 0; j < b.length; j++) {
      const arr = b2j.get(b[j]);
      if (arr) arr.push(j);
      else b2j.set(b[j], [j]);
    }
    const findLongest = (alo, ahi, blo, bhi) => {
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = /* @__PURE__ */ new Map();
      for (let i = alo; i < ahi; i++) {
        const next = /* @__PURE__ */ new Map();
        const indices = b2j.get(a[i]);
        if (indices) {
          for (let x = 0; x < indices.length; x++) {
            const j = indices[x];
            if (j < blo) continue;
            if (j >= bhi) break;
            const k = (j2len.get(j - 1) || 0) + 1;
            next.set(j, k);
            if (k > bestsize) {
              besti = i - k + 1;
              bestj = j - k + 1;
              bestsize = k;
            }
          }
        }
        j2len = next;
      }
      return [besti, bestj, bestsize];
    };
    let total = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = findLongest(alo, ahi, blo, bhi);
      if (!k) continue;
      total += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
    return total;
  }
  var DECLINE_OPTION_MARKERS = [
    "decline",
    "prefer not",
    "rather not",
    "not disclose",
    "not wish to",
    "don't wish to",
    "not want to",
    "don't want to",
    "not to answer"
  ];
  function looksLikeDecline(text) {
    const lowered = String(text == null ? "" : text).toLowerCase();
    return DECLINE_OPTION_MARKERS.some((m) => lowered.includes(m));
  }
  function findDeclineOption(options) {
    for (const opt of options || []) {
      if (looksLikeDecline(optLabel(opt))) return opt;
    }
    return null;
  }
  function optLabel(opt) {
    if (opt == null) return "";
    return typeof opt === "string" ? opt : String(opt.label == null ? "" : opt.label);
  }
  var CONTAINMENT_MIN_COVERAGE = 0.5;
  function tokenSet(text) {
    return new Set(String(text || "").split(" ").filter(Boolean));
  }
  function containmentScore(normValue, normLabel) {
    const want = tokenSet(normValue);
    const got = tokenSet(normLabel);
    if (!want.size || !got.size) return 0;
    if (isSubset(got, want)) return 0.75;
    if (isSubset(want, got)) {
      return want.size / got.size >= CONTAINMENT_MIN_COVERAGE ? 0.75 : 0;
    }
    return 0;
  }
  function bestOptionMatch(value, options) {
    const normValue = normalizeOptionText(value);
    const list = options || [];
    if (!normValue || !list.length) return null;
    for (const opt of list) {
      if (normalizeOptionText(optLabel(opt)) === normValue) return opt;
    }
    let best = null, bestScore = 0;
    for (const opt of list) {
      const normLabel = normalizeOptionText(optLabel(opt));
      if (!normLabel) continue;
      let score = Math.max(
        similarity(normValue, normLabel),
        containmentScore(normValue, normLabel)
      );
      if (score > bestScore) {
        best = opt;
        bestScore = score;
      }
    }
    return bestScore >= OPTION_MATCH_THRESHOLD ? best : null;
  }
  var LABEL_STOPWORDS = new Set(`
a an and any are as at be by can do does for from have has how i if in is it
me my no not of on or please provide select that the their this to us was we
what when where which who will with would you your now future
`.trim().split(/\s+/));
  function distinctive(label) {
    return new Set(
      questionSignature(label).split(" ").filter((t) => t && !LABEL_STOPWORDS.has(t))
    );
  }
  function labelsMatch(a, b) {
    const na = questionSignature(a), nb = questionSignature(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const da = distinctive(a), db = distinctive(b);
    if (!da.size || !db.size) return false;
    const [small, large] = da.size <= db.size ? [da, db] : [db, da];
    return small.size >= 2 && isSubset(small, large);
  }
  var DOCUMENT_FIELD_MARKERS = [
    "cover letter",
    "resume",
    "cv",
    "writing sample",
    "attach",
    "upload",
    "document"
  ];
  var DOCUMENT_SLOT_MARKERS = [
    ["cover_letter", ["cover letter", "coverletter"]],
    ["resume", ["resum", "cv", "curriculum"]]
  ];
  function documentSlotFor(label) {
    const lowered = String(label == null ? "" : label).toLowerCase();
    for (const [slot, markers] of DOCUMENT_SLOT_MARKERS) {
      if (markers.some((m) => lowered.includes(m))) return slot;
    }
    return null;
  }
  var SENSITIVE_PATTERNS = [
    // category, matcher (against the normalised signature)
    // \bopt\b is OPT, the US work authorisation — NOT the "opt" of "opt in".
    // Without the lookahead, "Do you opt-in to receive WhatsApp messages?"
    // classified as an immigration question, so a marketing checkbox was locked
    // behind the sponsorship tier and reported as "add your sponsorship answer
    // to your profile".
    ["sponsorship", /\bsponsor\w*|\bvisa\b|\bh1b\b|\bh 1b\b|\bwork permit\b|\bimmigration status\b|\bopt\b(?!\s+(in|out)\b)|\bcpt\b/],
    ["work_authorization", new RegExp([
      /\bright to work\b/.source,
      // standalone, UK phrasing
      /\bwork (authori\w*|eligib\w*|status)\b/.source,
      // "work authorization"
      /\bemployment eligib\w*/.source,
      /\b(authori[sz]\w*|eligib\w*) to (work|be employed)\b/.source,
      // The general shape: an eligibility word somewhere before a work word.
      /\b(authori[sz]\w*|eligib\w*|legal\w*)\b[\s\S]*\b(work|employ\w*)\b/.source
    ].join("|"))],
    ["citizenship", /\bcitizen\w*|\bnationality\b|\bpermanent resident\b|\bgreen card\b|\bpassports?\b/],
    // Date and place of birth: the profile's own answer or nothing — never the
    // model, which answered PwC's "Country / Territory of Birth" from a
    // nationality. After citizenship, so "citizen by birth" stays citizenship.
    ["birth", /\b(date|country|territory|city|town|place|region|state|province) of birth\b|\bbirth ?(date|day|place|country|city)\b|\bdob\b|\bborn\b/],
    ["clearance", /\bsecurity clearance\b|\bclearance level\b|\bpolygraph\b/],
    ["criminal", /\b(convict\w*|criminal|felony|misdemeanor|background check)\b/],
    // Anti-bribery declarations: "Are you (or have you been within the last 12
    // months) a Government Official?", "Are any of your immediate family members
    // Government Officials?" (Walmart, Oct 2026). Answered from the profile's two
    // answers only (governmentOfficialAnswer in plan.js). Ahead of
    // 'government_employment': their definitions say "employee of any government
    // agency", and "Are you a government official?" has no employment word at all —
    // it was not sensitive, and went to the model.
    ["government_official", /\b(government|public|foreign) officials?\b|\bofficials? (or employees? )?of (a|an|any|the) (government|public|foreign)\b|\bpolitically exposed\b/],
    // Employment by a government, the military, a state-owned enterprise
    // (Snowflake: "Have you ever been directly employed by (1) any government or
    // military entity, state-owned enterprise…"). An employment-history question,
    // not military SERVICE — read as the veteran question it had no profile
    // answer and could not be saved. Needs BOTH an employment word and a
    // government word, and sits ahead of 'demographic' so "served in the
    // military" stays a veteran question.
    ["government_employment", /\b(employ\w*|worked for|working for)\b[\s\S]*\b(government|military|state owned|publicly funded|public sector|civil service)\b|\b(government|military|state owned|public sector)\b[\s\S]*\bemploy\w*/],
    ["salary", /\b(salary|compensation|pay|wage|rate|ctc)\b[\s\S]*\b(expect\w*|desir\w*|requir\w*|range|current|minimum)\b|\b(expect\w*|desir\w*|current|minimum)\b[\s\S]*\b(salary|compensation|pay|wage|rate|ctc)\b/],
    // The EEO block. browser.py _EEO_FIELD_MARKERS, as alternations.
    // "sex" too: "What is your sex?" was no EEO question without it, and went to
    // the model (Oct 2026). \bsex\b, so "sexual" is not it.
    ["demographic", /\bgender\b|\bsex\b|\brac(e|ial)\b|\bethnic\w*|\bveteran\b|\bmilitary\b|\bdisab\w*|\bpronoun\w*/],
    // Military service asked without the word "military": Oracle's India form
    // asks "Have you served in any of the below India Uniformed forces?" and the
    // model answered it.
    ["demographic", /\b(armed|uniformed|defen[cs]e) forces?\b|\bparamilitary\b/],
    // Neurodivergence is disability data (DoorDash's survey, Oct 2026) — it went
    // to the model without this.
    ["demographic", /\bhispanic\b|\blatino\b|\blgbtq?\b|\bsexual orientation\b|\btransgender\b|\bneuro\s?diver\w*/]
  ];
  var STORABLE_SENSITIVE = /* @__PURE__ */ new Set([
    "clearance",
    "criminal",
    "citizenship",
    "government_employment",
    "birth",
    "government_official",
    "demographic"
  ]);
  var EEO_FIELD_MARKERS = [
    "gender",
    "race",
    "ethnic",
    "veteran",
    "military",
    "disab",
    "pronoun",
    "hispanic",
    "latino"
  ];
  function looksLikeEeoField(label) {
    const lowered = String(label == null ? "" : label).toLowerCase();
    return EEO_FIELD_MARKERS.some((m) => lowered.includes(m));
  }
  var EMPLOYER_SUFFIX_RE = /[\s,]+(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc)\.?$/i;
  var VISA_WORDING_BEFORE_RE = /\b(work|h-?1b|student|employment|immigration|immigrant|nonimmigrant|tourist|business|dependent|valid|current|sponsored|a|an|your|any|which|what|l-?1|o-?1|tn|e-?3|f-?1|j-?1|opt)\s*$/i;
  var VISA_WORDING_AFTER_RE = /^\s*(sponsor\w*|status|type|holder|category|categories|transfer|requirement|support|application|petition|stamp|expir\w*)/i;
  function withoutEmployer(label, employer) {
    const text = String(label == null ? "" : label);
    let name = String(employer || "").trim();
    while (EMPLOYER_SUFFIX_RE.test(name)) name = name.replace(EMPLOYER_SUFFIX_RE, "").trim();
    if (!name || !classifySensitive(name)) return text;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    return text.replace(re, (m, at) => {
      if (!/^[A-Z]/.test(m)) return m;
      if (VISA_WORDING_BEFORE_RE.test(text.slice(0, at))) return m;
      if (VISA_WORDING_AFTER_RE.test(text.slice(at + m.length))) return m;
      return "the company";
    });
  }
  function classifySensitive(label, employer) {
    const sig = questionSignature(employer ? withoutEmployer(label, employer) : label);
    if (!sig) return null;
    for (const [category, re] of SENSITIVE_PATTERNS) {
      if (re.test(sig)) return category;
    }
    return null;
  }
  var NEVER_FILL_PATTERNS = [
    /\bssn\b|\bsocial security\b|\bnational insurance\b|\btax id\b|\bpan (card|number)\b|\baadhaar\b/,
    /\biban\b|\bswift\b|\bsort code\b|\bcvv\b|\bcredit card\b|\bcard number\b/,
    /\b(bank|routing|account) (number|no|details)\b/,
    /\bpassword\b|\bpasscode\b|\bone time (code|password)\b|\botp\b/
    // Date of birth is no longer here: it is the 'birth' sensitive category,
    // filled from the profile's own answer only.
  ];
  function looksLikeOpaqueId(label) {
    if (/^\s*(this (information|field|question) is required|(this )?(field )?is required|required|please (select|choose|make a selection|answer)(\s+(one|an?\s+(option|value|answer|response|item)|this (question|field)))?(\s+(from (the|this|a) (list|dropdown|options)|below))?|select (one|an option)|choose one)\s*[.*!]*\s*$/i.test(String(label || ""))) return true;
    const t = String(label || "").replace(/\*+\s*$/, "").trim();
    if (t.length < 12 || /\s/.test(t) || !/^[\w.:-]+$/.test(t)) return false;
    const hex = t.match(/[0-9a-f]{10,}/ig) || [];
    return hex.some((run) => (run.match(/\d/g) || []).length >= 3) || /\d{8,}/.test(t);
  }
  function isNeverFill(label) {
    const sig = questionSignature(label);
    return NEVER_FILL_PATTERNS.some((re) => re.test(sig));
  }
  var SECRET_VALUE_PATTERNS = [
    /^\d{3}-?\d{2}-?\d{4}$/,
    // US SSN
    /^(?:\d[ -]*?){13,19}$/,
    // card-shaped
    /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i
    // IBAN
  ];
  function looksSecret(value) {
    const v = String(value == null ? "" : value).trim();
    if (!v) return false;
    return SECRET_VALUE_PATTERNS.some((re) => re.test(v));
  }
  function splitPhone(phone) {
    const raw = String(phone == null ? "" : phone).trim();
    const out = { dialCode: "", national: raw, e164: raw };
    if (!raw.startsWith("+")) return out;
    const digits = raw.slice(1).replace(/\D/g, "");
    if (!digits) return out;
    const KNOWN = [
      "1",
      "7",
      "20",
      "27",
      "30",
      "31",
      "32",
      "33",
      "34",
      "36",
      "39",
      "40",
      "41",
      "43",
      "44",
      "45",
      "46",
      "47",
      "48",
      "49",
      "51",
      "52",
      "54",
      "55",
      "56",
      "57",
      "58",
      "60",
      "61",
      "62",
      "63",
      "64",
      "65",
      "66",
      "81",
      "82",
      "84",
      "86",
      "90",
      "91",
      "92",
      "93",
      "94",
      "95",
      "98",
      "211",
      "212",
      "213",
      "234",
      "254",
      "353",
      "358",
      "359",
      "370",
      "371",
      "372",
      "380",
      "420",
      "421",
      "852",
      "880",
      "886",
      "966",
      "971",
      "972",
      "974",
      "977"
    ];
    let dial = "";
    for (const code of KNOWN.slice().sort((a, b) => b.length - a.length)) {
      if (digits.startsWith(code)) {
        dial = code;
        break;
      }
    }
    if (!dial) return out;
    out.dialCode = "+" + dial;
    out.national = digits.slice(dial.length);
    out.e164 = "+" + digits;
    return out;
  }
  var MONTHS = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };
  function parseLooseDate(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return null;
    if (/^(present|current|now|immediately|asap)$/i.test(raw)) return null;
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (m) return ymd(+m[1], +m[2], 1);
    m = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (m) {
      const a = +m[1], bb = +m[2];
      return a > 12 ? ymd(+m[3], bb, a) : ymd(+m[3], a, bb);
    }
    m = raw.match(/^(\d{1,2})[/.](\d{4})$/);
    if (m) return ymd(+m[2], +m[1], 1);
    m = raw.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
    if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[2], MONTHS[m[1].toLowerCase()], 1);
    m = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
    if (m && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    m = raw.match(/^(\d{4})$/);
    if (m) return ymd(+m[1], 1, 1);
    return null;
  }
  function ymd(y, mo, d) {
    if (!y || y < 1900 || y > 2100) return null;
    if (!mo || mo < 1 || mo > 12) return null;
    if (!d || d < 1 || d > 31) return null;
    return { y, m: mo, d };
  }
  var pad = (n) => String(n).padStart(2, "0");
  function formatDateForField(value, hints) {
    const d = parseLooseDate(value);
    if (!d) return "";
    const h = hints || {};
    const type = String(h.type || "").toLowerCase();
    if (type === "date") return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    if (type === "month") return `${d.y}-${pad(d.m)}`;
    const hint = `${h.placeholder || ""} ${h.pattern || ""} ${h.format || ""}`.toLowerCase();
    if (/yyyy[-/.]mm[-/.]dd|iso/.test(hint)) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    if (/dd[-/.]mm[-/.]yyyy/.test(hint)) return `${pad(d.d)}/${pad(d.m)}/${d.y}`;
    if (/mm[-/.]yyyy/.test(hint)) return `${pad(d.m)}/${d.y}`;
    if (/mm[-/.]dd[-/.]yyyy/.test(hint)) return `${pad(d.m)}/${pad(d.d)}/${d.y}`;
    return `${pad(d.m)}/${pad(d.d)}/${d.y}`;
  }
  var DECLINE_WORDS = /\b(decline|prefer not|don'?t wish|do not wish|not wish to|rather not|choose not)\b/i;
  var EEO_GROUPS = {
    gender: [
      {
        test: /\b(trans(gender)?\s*(woman|female)|trans\s*fem\w*|mtf)\b/i,
        shapes: ["Transgender woman", "Trans woman"]
      },
      {
        test: /\b(trans(gender)?\s*(man|male)|trans\s*masc\w*|ftm)\b/i,
        shapes: ["Transgender man", "Trans man"]
      },
      {
        test: /\b(non[\s-]?binary|genderqueer|gender\s*non[\s-]?conforming|enby)\b/i,
        shapes: ["Non-binary", "Nonbinary", "Non-binary / non-conforming", "Genderqueer"]
      },
      {
        test: /^(?!.*\btrans)(?=.*\b(female|woman|women|girl)\b)/i,
        shapes: ["Female", "Woman", "Cisgender woman", "Cis woman"]
      },
      {
        test: /^(?!.*\btrans)(?=.*\b(male|man|men|boy)\b)/i,
        shapes: ["Male", "Man", "Cisgender man", "Cis man"]
      }
    ],
    veteran_status: [
      // Before the veteran rows: "not a protected veteran" contains "protected veteran".
      {
        test: /\b(never served|not (a |an )?(protected )?veteran|non[\s-]?veteran|no military|have not served|haven'?t served|not served)\b|^\s*no\b/i,
        not: /\bnon[\s-]?protected veteran\b/i,
        shapes: [
          "I am not a protected veteran",
          "I am not a veteran",
          "Not a veteran",
          "I have never served in the military",
          "No"
        ]
      },
      {
        test: /\bnon[\s-]?protected veteran\b|\bveteran,? but not (a )?protected\b/i,
        // One-way: on a form that only asks protected-or-not, "not a protected
        // veteran" is true of them. "Never served" is not, so no group-level merge.
        widensTo: /^\s*(i am )?not a protected veteran\s*$/i,
        shapes: [
          "I identify as a non-protected veteran",
          "Non-protected veteran",
          "I am not a protected veteran"
        ]
      },
      {
        test: /\b(protected veteran|disabled veteran|recently separated|armed forces service medal)\b/i,
        shapes: [
          "I identify as one or more of the classifications of protected veteran",
          "I identify as a protected veteran",
          "Protected veteran"
        ]
      },
      { test: /\b(active duty)\b/i, shapes: ["I am on active duty", "Active duty"] },
      {
        test: /\b(national guard|reserves?)\b/i,
        shapes: ["I am part of the national guard or on reserve", "National Guard or Reserve"]
      }
    ],
    disability_status: [
      {
        test: /\b(no disability|not disabled|(don'?t|do not) have a disability|without a disability)\b|^\s*no\b/i,
        shapes: [
          "No, I don't have a disability",
          "No, I do not have a disability",
          "No, I don't have a disability and have not had one in the past",
          "No disability",
          "No"
        ]
      },
      {
        test: /\b(have (had )?a disability|disabled|with a disability)\b|^\s*yes\b/i,
        not: /\b(don'?t|do not|not) (have|had)\b|\bnot disabled\b/i,
        shapes: [
          "Yes, I have a disability (or previously had a disability)",
          "Yes, I have a disability",
          "Yes"
        ]
      }
    ],
    // No profile field: read off the LGBTQ+ answer "No" (plan.js), so the only
    // group ever asked for is heterosexual / straight.
    sexual_orientation: [
      {
        test: /\b(hetero\w*|straight)\b/i,
        not: /\bnot\b/i,
        shapes: [
          "Heterosexual/Straight",
          "Heterosexual / Straight",
          "Heterosexual or Straight",
          "Straight/Heterosexual",
          "Heterosexual",
          "Straight"
        ]
      }
    ]
  };
  function eeoOptionAllowed(key, want, option) {
    if (want < 0) return true;
    if (eeoGroup(key, option) === want) return true;
    const g = (EEO_GROUPS[key] || [])[want];
    return !!(g && g.widensTo && g.widensTo.test(String(option || "")));
  }
  function eeoGroup(key, text) {
    const t = String(text || "");
    if (!t || DECLINE_WORDS.test(t)) return -1;
    return (EEO_GROUPS[key] || []).findIndex((g) => g.test.test(t) && !(g.not && g.not.test(t)));
  }
  function eeoShapes(key, text) {
    const i = eeoGroup(key, text);
    return i < 0 ? [] : EEO_GROUPS[key][i].shapes;
  }
  var MOTIVATION_RE = [
    /\bwhy\b[^?]{0,60}\b(join|work|interested|interest|apply|applying|want|us|role|position|company|team|opportunity|here)\b/i,
    /^\s*why\s+[^\s?][^?]{0,40}\?\s*\*?\s*$/i,
    // "Why Anthropic?" / "Why Robinhood?*"
    /\bwhat (excites|interests|draws|attracts|motivates) you\b/i,
    /\bwhat about (this|the) (role|position|company|team|job)\b/i,
    /\bmotivat(ion|es|ed)\b/i,
    /\bcover letter\b/i,
    /\btell us (about yourself|why)\b/i
  ];
  var CHOICE_KINDS = /* @__PURE__ */ new Set(["select", "combobox", "radio", "checkbox", "file", "date-parts"]);
  function isMotivationQuestion(label, kind) {
    if (kind && CHOICE_KINDS.has(kind)) return false;
    const text = String(label || "");
    return MOTIVATION_RE.some((re) => re.test(text));
  }
  function isConditionalFollowUp(label) {
    const text = String(label || "").replace(/[“”"']/g, "");
    return /^\s*(if|where) (you (answered|selected|chose|checked|said)|yes|so|applicable|the answer)\b/i.test(text) || /\bif you answered yes\b/i.test(text) || /^\s*(please )?(explain|elaborate|specify|provide details)\b[^.?]{0,40}\bif (yes|so|applicable)\b/i.test(text);
  }
  var READ_FIRST_KEYS = /* @__PURE__ */ new Set([
    "gender",
    "race_ethnicity",
    "veteran_status",
    "disability_status",
    "gender_pronouns",
    "lgbtq_identity",
    "citizenship_status",
    "sexual_orientation"
  ]);
  var NAME_FIELD_WORDS = [
    "name",
    "current",
    "currently",
    "most",
    "recent",
    "present",
    "latest",
    "last",
    "previous",
    "enter",
    "if",
    "any",
    "applicable",
    "who"
  ];
  var FIELD_SYNONYMS = [
    // identity
    { key: "first_name", labels: ["first name", "given name", "forename", "legal first name"] },
    { key: "middle_name", labels: ["middle name", "middle names", "middle initial", "legal middle name"] },
    { key: "last_name", labels: ["last name", "surname", "family name", "legal last name"] },
    { key: "full_name", labels: ["full name", "your name", "name", "legal name", "candidate name"] },
    { key: "preferred_name", labels: ["preferred name", "nickname", "preferred first name"] },
    // Mr. / Ms. / Dr. A bare "Title" also means job title, so plan.js fills this
    // only into a field whose options are honorifics (hasHonorificOptions).
    { key: "name_title", labels: ["title", "salutation", "name prefix", "honorific", "prefix"] },
    { key: "email", labels: ["email", "email address", "e mail", "contact email"] },
    { key: "phone", labels: ["phone", "phone number", "mobile", "mobile number", "telephone", "contact number", "cell"] },
    // location
    { key: "location", labels: ["location", "current location", "where are you based", "where do you live"] },
    // Where the person would like to WORK (Oracle: "Select up to 3 work
    // locations"). Not where they live, and no profile value answers it — listed
    // so "Preferred Location" stops matching the home location above through the
    // "preferred" qualifier. plan.js leaves it to the person.
    { key: "preferred_work_location", labels: ["preferred location", "preferred locations", "preferred work location", "preferred work locations", "location preference", "desired location", "desired work location"] },
    // Line 1 / line 2 are their own keys. "address line 1" used to map to the
    // whole-address key, which held city+state+country — so a street box got a
    // place name.
    { key: "address_line1", labels: ["address line 1", "address line1", "address 1", "street address", "street", "street line 1"] },
    { key: "address_line2", labels: ["address line 2", "address line2", "address 2", "apartment", "suite", "street line 2"] },
    { key: "address", labels: ["address", "mailing address", "full address", "residential address", "postal address"] },
    { key: "address_city", labels: ["city", "town", "current city", "city of residence"] },
    { key: "address_state", labels: ["state", "province", "region", "state province"] },
    // The phone's dial code, asked on its own ("Country code" beside the number
    // on Oracle, "Country Phone Code" on Workday). Answered from the stored phone
    // number — before this it matched nothing, went to the model, and Oracle's
    // picker was left empty, so the form rejected the number beside it.
    { key: "phone_country_code", labels: ["country code", "phone country code", "country phone code", "dial code", "dialing code", "calling code", "country calling code", "phone code"] },
    { key: "address_country", labels: ["country", "country of residence"] },
    { key: "postal_code", labels: ["zip", "zip code", "postal code", "postcode", "pin code"] },
    // links
    { key: "linkedin_url", labels: ["linkedin", "linkedin profile", "linkedin url"] },
    { key: "github_url", labels: ["github", "github profile", "github url"] },
    { key: "portfolio_or_website", labels: ["portfolio", "website", "personal website", "portfolio url", "personal site", "web site"] },
    // experience
    // Name fields: matched only when the label asks for the name itself — its
    // other words must be in `only`. "How much notice must you provide your
    // current employer before leaving?" holds "current employer", and the
    // employer's name was written into a notice-period box; "Why are you leaving
    // your current employer?" and "How long have you been in your current role?"
    // were the same mistake waiting to happen.
    {
      key: "current_job_title",
      labels: ["current title", "current job title", "current role", "job title", "most recent title", "occupation"],
      only: NAME_FIELD_WORDS.concat(["job", "title", "role", "position", "designation", "occupation", "company", "employer"])
    },
    {
      key: "current_company",
      labels: ["current company", "current employer", "most recent company", "most recent employer", "company name", "employer"],
      only: NAME_FIELD_WORDS.concat(["company", "employer", "organization", "organisation", "business"])
    },
    { key: "years_of_experience", labels: ["years of experience", "total experience", "years experience", "how many years of experience", "relevant experience years"] },
    // "Type to Add Skills": Workday's skills prompt (NVIDIA). The bare "skills"
    // is one word and may only absorb one extra; this label has two.
    { key: "top_skills", labels: ["skills", "key skills", "technical skills", "core skills", "add skills", "type to add skills"] },
    // education
    { key: "university", labels: ["university", "college", "school", "institution", "school name", "university name", "alma mater"] },
    { key: "degree", labels: ["degree", "degree type", "highest degree", "qualification", "level of education"] },
    { key: "major", labels: ["major", "field of study", "discipline", "specialization", "course of study", "branch"] },
    { key: "graduation_date", labels: ["graduation date", "graduation year", "year of graduation", "expected graduation", "end date of education", "completion date"] },
    { key: "gpa", labels: ["gpa", "cgpa", "grade point average", "percentage marks", "academic score"] },
    // logistics
    { key: "notice_period", labels: ["notice period", "how much notice", "notice"] },
    { key: "available_start_date", labels: ["start date", "available start date", "when can you start", "earliest start date", "availability date"] },
    { key: "willing_to_relocate", labels: ["relocate", "willing to relocate", "open to relocation"] },
    { key: "remote_work_preference", labels: ["remote preference", "work preference", "work arrangement", "onsite or remote", "hybrid preference"] },
    { key: "how_did_you_hear_about_us", labels: ["how did you hear", "how did you find", "referral source", "where did you hear about us", "source"] },
    // narrative
    { key: "why_do_you_want_this_role", labels: ["why this role", "why do you want to work here", "why are you interested", "why us", "why this company", "motivation"] },
    // Not "additional information" / "anything else": those are mostly follow-ups
    // ("If you answered Yes, please provide additional information") and got the
    // stored motivation sentence pasted into them.
    { key: "cover_letter", labels: ["cover letter", "tell us about yourself", "introduce yourself"] },
    // sensitive — stored answers only, never inferred
    { key: "authorized_to_work_in_country", sensitive: true, labels: ["authorized to work", "legally authorized to work", "work authorization", "eligible to work", "employment eligibility", "right to work"] },
    { key: "requires_visa_sponsorship", sensitive: true, labels: ["require sponsorship", "need sponsorship", "visa sponsorship", "require visa", "sponsorship now or in the future", "sponsor work permit", "sponsor work visa", "sponsor employment visa"] },
    { key: "visa_status", sensitive: true, labels: ["visa status", "immigration status", "work permit status", "current visa"] },
    // Sensitive on purpose. Nationality sits beside the right-to-work questions,
    // and a guess from a dial code or an address would be an immigration-adjacent
    // declaration the person never made.
    // The US status question (citizen / permanent resident / refugee / …), not a
    // country. Matched before 'nationality' because exact signatures win first.
    { key: "citizenship_status", sensitive: true, labels: ["citizenship status", "citizen status", "us citizenship status", "citizenship immigration status"] },
    { key: "nationality", sensitive: true, labels: ["nationality", "citizenship", "country of citizenship", "nationality or citizenship", "what is your nationality", "indicate your nationality"] },
    // Birth details: the profile's own answers, never the model's.
    { key: "date_of_birth", sensitive: true, labels: ["date of birth", "birth date", "birthdate", "dob", "birthday"] },
    { key: "country_of_birth", sensitive: true, labels: ["country of birth", "country territory of birth", "birth country", "country where you were born"] },
    { key: "city_of_birth", sensitive: true, labels: ["city of birth", "place of birth", "birth city", "town of birth", "birthplace"] },
    { key: "expected_salary", sensitive: true, labels: ["expected salary", "salary expectation", "desired salary", "compensation expectation", "expected ctc", "desired compensation"] },
    { key: "gender", sensitive: true, labels: ["gender", "gender identity", "gender do you identify as", "gender you identify with", "gender identify", "sex"] },
    // "identify your race": the bare 'race' is one word, and one-word synonyms
    // absorb only one extra word — Greenhouse's "Please identify your race" has two.
    { key: "race_ethnicity", sensitive: true, labels: ["race", "ethnicity", "race ethnicity", "racial identity", "hispanic or latino", "identify your race", "identify your ethnicity"] },
    // "Have you ever served or are you currently serving in the United States
    // military?" — the same fact as veteran status, asked as a Yes/No.
    { key: "veteran_status", sensitive: true, labels: ["veteran status", "military status", "protected veteran", "military service", "served in the military", "serving in the military", "served military", "serving military", "uniformed forces", "armed forces", "defence forces", "defense forces"] },
    { key: "disability_status", sensitive: true, labels: ["disability status", "disability", "disabled"] },
    { key: "gender_pronouns", sensitive: true, labels: ["pronouns", "preferred pronouns"] },
    { key: "lgbtq_identity", sensitive: true, labels: ["lgbtq", "sexual orientation", "transgender"] }
  ];
  function synonymMatches(syn, label, entry) {
    const ds = distinctive(syn), dl = distinctive(label);
    if (!ds.size || !dl.size) return false;
    if (!isSubset(ds, dl)) return false;
    if (entry && entry.only && [...dl].some((w) => !ds.has(w) && !entry.only.includes(w))) return false;
    if (ds.size === 1) {
      if (dl.size > 2) return false;
      if (dl.size === 2) {
        const [word] = ds;
        const extra = [...dl].find((w) => w !== word);
        const siblings = /* @__PURE__ */ new Set();
        for (const s of entry && entry.labels || []) {
          for (const w of distinctive(s)) siblings.add(w);
        }
        if (!NEUTRAL_QUALIFIERS.has(extra) && !siblings.has(extra)) return false;
      }
    }
    return true;
  }
  var NEUTRAL_QUALIFIERS = /* @__PURE__ */ new Set([
    "current",
    "present",
    "primary",
    "legal",
    "full",
    "official",
    "home",
    "permanent",
    "personal",
    "contact",
    "main",
    "preferred"
  ]);
  var HONORIFIC_RE = /^(mr|mrs|ms|miss|mx|dr|doctor|prof|professor|sir|madam)\.?$/i;
  function hasHonorificOptions(options) {
    const labels = (options || []).map((o) => String(o && (o.label || o.value) || "").trim()).filter((l) => l && !/^(select|choose|none|--)/i.test(l));
    if (labels.length < 2) return false;
    return labels.filter((l) => HONORIFIC_RE.test(l)).length / labels.length >= 0.6;
  }
  var OPTIONALITY_RE = /\(\s*(optional|required)\s*\)|\s+[-–—]?\s*optional\s*$/ig;
  var BRITISH_SPELLINGS = [
    [/\bauthoris(e|ed|es|ing|ation|ations)\b/gi, "authoriz$1"],
    [/\borganis(e|ed|es|ing|ation|ations)\b/gi, "organiz$1"],
    [/\brecognis(e|ed|es|ing)\b/gi, "recogniz$1"],
    [/\bspecialis(e|ed|es|ing|ation|ations)\b/gi, "specializ$1"],
    [/\blabour\b/gi, "labor"],
    [/\bprogramme(s)?\b/gi, "program$1"],
    [/\bcentre(s)?\b/gi, "center$1"],
    [/\blicence(s)?\b/gi, "license$1"]
  ];
  function matchFieldKey(label, entries) {
    label = String(label || "").replace(OPTIONALITY_RE, " ").trim();
    for (const [re, us] of BRITISH_SPELLINGS) label = label.replace(re, us);
    const sig = questionSignature(label);
    if (!sig) return null;
    const pool = entries || FIELD_SYNONYMS;
    for (const entry of pool) {
      for (const syn of entry.labels) {
        if (questionSignature(syn) === sig) return entry;
      }
    }
    let best = null, bestWeight = -1;
    for (const entry of pool) {
      for (const syn of entry.labels) {
        if (!synonymMatches(syn, label, entry)) continue;
        const weight = distinctive(syn).size;
        if (weight > bestWeight) {
          best = entry;
          bestWeight = weight;
        }
      }
    }
    return best;
  }
  var SELF_ID_RE = /\b(voluntary\s+)?self[\s-]*identification(\s+of)?\b|\bvoluntary\s+disclosures?(\s+of)?\b/gi;
  var CATEGORY_KEYS = {
    sponsorship: ["requires_visa_sponsorship", "visa_status"],
    work_authorization: ["authorized_to_work_in_country"],
    citizenship: ["citizenship_status", "nationality"],
    birth: ["date_of_birth", "country_of_birth", "city_of_birth"],
    salary: ["expected_salary"],
    demographic: [
      "gender",
      "race_ethnicity",
      "veteran_status",
      "disability_status",
      "gender_pronouns",
      "lgbtq_identity"
    ]
  };
  function matchSensitiveKey(label, category) {
    label = String(label || "").replace(SELF_ID_RE, " ").trim() || label;
    const keys = CATEGORY_KEYS[category];
    if (keys) {
      const own = matchFieldKey(label, FIELD_SYNONYMS.filter((e) => keys.includes(e.key)));
      if (own) return own;
    }
    const any = matchFieldKey(label);
    if (any && any.sensitive) return any;
    if (category === "sponsorship" && /\bsponsor/.test(questionSignature(label))) {
      return FIELD_SYNONYMS.find((e) => e.key === "requires_visa_sponsorship") || null;
    }
    if (category === "work_authorization") {
      return FIELD_SYNONYMS.find((e) => e.key === "authorized_to_work_in_country") || null;
    }
    if (category === "salary" && !/\b(current|present|last|previous|existing)\b/.test(questionSignature(label))) {
      return FIELD_SYNONYMS.find((e) => e.key === "expected_salary") || null;
    }
    if (category === "demographic") {
      const sig = questionSignature(label);
      if (/\bspouses?\b|\bpartners?\b/.test(sig)) return null;
      const keys2 = EEO_SUBJECTS.filter(([, re]) => re.test(sig)).map(([key]) => key);
      if (keys2.length === 1) return FIELD_SYNONYMS.find((e) => e.key === keys2[0]) || null;
    }
    return null;
  }
  var EEO_SUBJECTS = [
    ["disability_status", /\bdisab\w*/],
    ["veteran_status", /\bveteran\w*|\bmilitary\b|\b(armed|uniformed|defen[cs]e) forces?\b|\bparamilitary\b/],
    ["gender_pronouns", /\bpronoun\w*/],
    ["lgbtq_identity", /\blgbtq?\w*|\bsexual orientation\b|\btransgender\b/],
    ["race_ethnicity", /\brac(e|ial)\b|\bethnic\w*|\bhispanic\b|\blatin[oax]\b/],
    ["gender", /\bgender\b|\bsex\b/]
  ];

  // src/autofill/timing.js
  var TIMING = {
    // How long to let a framework re-render before reading a field back.
    settleMs: 60,
    // How long to wait for a custom dropdown's menu to appear after opening it.
    optionWaitMs: 600,
    // How long a search-as-you-type list may keep showing "Loading..." before
    // giving up. Ashby's Location searches its server per keystroke; from India
    // that round trip outlasted every wait above, and the field stayed empty.
    remoteSearchMs: 5e3,
    // How long to watch for fields that appear in response to an answer.
    revealWatchMs: 900,
    // ...and, while the page is still changing, how much longer. Oracle loads its
    // Address Line / City / State boxes only after Country is picked, from its
    // server; looking once at 900 ms saw none of them.
    revealQuietMs: 700,
    revealMaxMs: 5e3,
    // How long a picked dropdown option may take to show as committed. Oracle
    // keeps the field flagged invalid for a moment after a correct pick, then
    // redraws it — a single early read called a good pick a failure.
    commitWaitMs: 2e3,
    // How long an upload may take to show as taken. Workday sends the file to its
    // server first and only then shows the filename (clearing the input).
    uploadConfirmMs: 4e3,
    // How long an ATS may take to read an uploaded resume into its form (Oracle's
    // "Import your profile") before filling carries on regardless.
    resumeParseMaxMs: 3e4,
    // How long after an upload to look for the form starting to read it.
    resumeParseStartMs: 300,
    // Oracle's Education / Experience tiles: how long an entry's form may take
    // to open after Edit, and to close after Save.
    tileOpenMs: 3e3,
    tileSaveMs: 4e3
  };
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var now = () => globalThis.performance && globalThis.performance.now ? globalThis.performance.now() : Date.now();
  function startClock() {
    const start = now();
    const phases = {};
    const fields = [];
    const quietWaits = [];
    const add = (phase, ms) => {
      phases[phase] = (phases[phase] || 0) + ms;
    };
    return {
      add,
      async time(phase, fn) {
        const t = now();
        try {
          return await fn();
        } finally {
          add(phase, now() - t);
        }
      },
      field(info) {
        fields.push(info);
      },
      quiet(res) {
        if (res) quietWaits.push(res);
      },
      summary() {
        const round = (ms) => Math.round(ms || 0);
        const out = {};
        for (const k of Object.keys(phases)) out[k] = round(phases[k]);
        return {
          totalMs: round(now() - start),
          phases: out,
          quietWaits: quietWaits.map((q) => ({ ms: round(q.ms), capped: !!q.capped })),
          slowFields: fields.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map((f) => ({ label: f.label || "", kind: f.kind || "", ms: round(f.ms), outcome: f.outcome || "" }))
        };
      },
      now
    };
  }

  // src/autofill/discover.js
  var probe = () => globalThis.__tcvFieldProbe;
  function isVisible(el) {
    if (!el) return false;
    const p = probe();
    const node = p && p.fieldWrapper(el) || el;
    if (el.disabled === true) return false;
    if (el.readOnly === true && (el.tagName || "").toLowerCase() !== "select") return false;
    const type = el.getAttribute && (el.getAttribute("type") || "").toLowerCase() || "";
    if (type === "hidden") return false;
    if (type === "file") return !inAriaHidden(node);
    if (inAriaHidden(node)) return false;
    if (hiddenByStyle(node)) return false;
    if (typeof node.getBoundingClientRect === "function") {
      const r = node.getBoundingClientRect();
      const measured = r && (r.width || r.height || r.top || r.left);
      if (measured && r.width < 2 && r.height < 2) return false;
    }
    return true;
  }
  function isChosenValue(node) {
    try {
      return !!(node && node.closest && node.closest('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"]'));
    } catch (e) {
      return false;
    }
  }
  function isListboxCompanion(el) {
    if (!el || (el.tagName || "").toLowerCase() !== "input") return false;
    const type = String(el.getAttribute("type") || "text").toLowerCase();
    if (type !== "text" && type !== "") return false;
    const unreachable = !isNodeVisible(el) || el.getAttribute("tabindex") === "-1" || el.getAttribute("aria-hidden") === "true";
    if (!unreachable) return false;
    let n = el.parentElement;
    for (let depth = 0; n && depth < 3; depth++, n = n.parentElement) {
      let buttons = [];
      try {
        buttons = n.querySelectorAll('button[aria-haspopup="listbox"]');
      } catch (e) {
        return false;
      }
      if (buttons.length === 1) return true;
      if (buttons.length > 1) return false;
    }
    return false;
  }
  function isNodeVisible(node) {
    if (!node) return false;
    if (inAriaHidden(node)) return false;
    return isNodeDrawn(node);
  }
  function isNodeDrawn(node) {
    if (!node) return false;
    if (hiddenByStyle(node)) return false;
    if (typeof node.getBoundingClientRect === "function") {
      const r = node.getBoundingClientRect();
      const measured = r && (r.width || r.height || r.top || r.left);
      if (measured && r.width < 2 && r.height < 2) return false;
    }
    return true;
  }
  function hiddenReason(node) {
    if (!node) return "gone";
    if (hiddenByStyle(node)) return "style";
    if (inAriaHidden(node)) return "aria-hidden";
    return isNodeDrawn(node) ? "" : "size";
  }
  function hiddenByStyle(node) {
    const win = node.ownerDocument && node.ownerDocument.defaultView;
    if (!win || typeof win.getComputedStyle !== "function") return false;
    let n = node, depth = 0;
    while (n && n.nodeType === 1 && depth < 25) {
      let cs = null;
      try {
        cs = win.getComputedStyle(n);
      } catch (e) {
        cs = null;
      }
      if (cs) {
        if (cs.display === "none") return true;
        if (cs.visibility === "hidden" || cs.visibility === "collapse") return true;
        if (cs.opacity !== "" && cs.opacity != null && parseFloat(cs.opacity) === 0) return true;
      }
      n = n.parentElement;
      depth++;
    }
    return false;
  }
  function inAriaHidden(node) {
    let n = node, depth = 0;
    while (n && n.nodeType === 1 && depth < 25) {
      if (n.getAttribute && n.getAttribute("aria-hidden") === "true") return true;
      if (n.hidden === true) return true;
      n = n.parentElement;
      depth++;
    }
    return false;
  }
  var CHOICE_SEL = 'button:not([type="submit"]), [role="radio"]:not(input), [role="button"][aria-pressed]';
  var NAV_TEXT = /^(back|next|previous|prev|continue|submit|save|cancel|close|add|remove|delete|edit|upload|browse|attach|apply|search|sign in|log in|\d+|[<>‹›«»←→]+)$/i;
  function choiceText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }
  function isChoiceMirror(el) {
    if (!el || (el.tagName || "").toLowerCase() !== "input") return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type !== "checkbox" && type !== "radio") return false;
    if (el.getAttribute("tabindex") !== "-1") return false;
    if (el.closest && el.closest("label")) return false;
    const id = el.getAttribute("id");
    if (id && el.ownerDocument && Array.from(el.ownerDocument.querySelectorAll("label[for]")).some((l) => l.getAttribute("for") === id)) return false;
    const parent = el.parentElement;
    if (!parent) return false;
    const buttons = Array.from(parent.children).filter((c) => c.matches && c.matches(CHOICE_SEL));
    return buttons.length >= 2;
  }
  function mirrorLabel(group) {
    const mirror = Array.from(group.querySelectorAll("input")).find(isChoiceMirror);
    const key = mirror && (mirror.getAttribute("id") || mirror.getAttribute("name"));
    if (!key) return null;
    return Array.from(group.ownerDocument.querySelectorAll("label[for]")).find((l) => l.getAttribute("for") === key) || null;
  }
  function mirrorQuestion(group) {
    const label = mirrorLabel(group);
    const text = label ? choiceText(label) : "";
    return text && !PROMPT_ONLY_RE.test(text) ? text.slice(0, 600) : "";
  }
  function realInputsIn(node) {
    return Array.from(node.querySelectorAll('input:not([type="hidden"]), select, textarea')).filter((x) => !isChoiceMirror(x));
  }
  function isChoiceSelected(el) {
    if (!el) return false;
    const a = (n) => el.getAttribute && el.getAttribute(n) || "";
    if (a("aria-pressed") === "true" || a("aria-checked") === "true" || a("aria-selected") === "true") return true;
    const cls = el.className && String(el.className) || "";
    return /(^|[\s_-])(selected|active|is-selected|checked|pressed)($|[\s_-])/i.test(cls);
  }
  var NOT_QUESTION_SEL = '[role="alert"], [aria-live], [class*="error" i], [class*="validation" i], [class*="invalid" i], [class*="helper" i], [class*="hint" i], [class*="message" i], [id*="error" i]';
  var PROMPT_ONLY_RE = /^\s*(this (information|field|question) is required|(this )?(field )?is required|required|please (select|choose|make a selection|answer)(\s+(one|an?\s+(option|value|answer|response|item)|this (question|field)))?(\s+(from (the|this|a) (list|dropdown|options)|below))?|select (one|an option)|choose one)\s*[.*!]*\s*$/i;
  function questionTextOf(node, dropSel) {
    let clone = null;
    try {
      clone = node.cloneNode(true);
      for (const x of clone.querySelectorAll(dropSel + ", " + NOT_QUESTION_SEL)) x.remove();
    } catch (e) {
      return "";
    }
    const t = choiceText(clone);
    return PROMPT_ONLY_RE.test(t) ? "" : t;
  }
  function choiceQuestion(group) {
    const rg = group.closest && group.closest('[role="radiogroup"]');
    if (rg) {
      const by = rg.getAttribute("aria-labelledby") || "";
      const named = by.split(/\s+/).map((id) => {
        try {
          const e = rg.ownerDocument.getElementById(id);
          return e ? choiceText(e) : "";
        } catch (x) {
          return "";
        }
      }).filter(Boolean).join(" ") || rg.getAttribute("aria-label") || "";
      if (named && !PROMPT_ONLY_RE.test(named)) return named.slice(0, 600);
    }
    const labelled = mirrorQuestion(group);
    if (labelled) return labelled;
    let n = group;
    for (let depth = 0; n && depth < 4; depth++, n = n.parentElement) {
      if (isFormLevel(n)) break;
      let groups = 0, fields = 0;
      try {
        groups = n.querySelectorAll(CHOICE_SEL).length;
        fields = realInputsIn(n).length;
      } catch (e) {
        return "";
      }
      if (fields > 0 || groups > group.querySelectorAll(CHOICE_SEL).length) {
        if (depth > 0) break;
      }
      const t = questionTextOf(n, CHOICE_SEL);
      if (t && /[a-z]{3}/i.test(t)) return t.slice(0, 600);
    }
    return "";
  }
  function choiceGroups(root) {
    if (!root || !root.querySelectorAll) return [];
    const byParent = /* @__PURE__ */ new Map();
    let all = [];
    try {
      all = Array.from(root.querySelectorAll(CHOICE_SEL));
    } catch (e) {
      return [];
    }
    for (const b of all) {
      if (b.closest('#tailorcv-sidebar, nav, header, footer, [role="navigation"], [role="tablist"], [role="menu"]')) continue;
      if (notAField(b)) continue;
      if (!isVisible(b)) continue;
      const t = choiceText(b);
      if (!t || t.length > 40 || NAV_TEXT.test(t)) continue;
      const parent = b.closest('[role="radiogroup"]') || b.parentElement;
      if (!parent) continue;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(b);
    }
    const out = [];
    for (const [group, buttons] of byParent) {
      if (buttons.length < 2 || buttons.length > 6) continue;
      try {
        if (realInputsIn(group).length) continue;
      } catch (e) {
        continue;
      }
      const question = choiceQuestion(group);
      if (!question) continue;
      out.push({ group, buttons, question });
    }
    return out;
  }
  var APP_ROOT_SELECTORS = [
    "form",
    '[role="form"]',
    '[class*="application" i]',
    '[id*="application" i]',
    // Workday. There is no <form> element on a Workday application at all; every
    // step renders inside applyFlowPage. (An earlier version listed
    // "jobApplication" here — an invented id that matched nothing real.)
    '[data-automation-id="applyFlowPage"]',
    '[data-automation-id*="applyFlow" i]',
    '[data-ui="application-form"]',
    // Ashby
    "#application-form",
    // Greenhouse classic
    ".application--form"
    // Lever
  ];
  var SEARCHY = /search|filter|newsletter|subscribe|login|sign ?in|sign ?up|cookie|consent ?banner/i;
  function hasApplicationSignal(el) {
    const has = (sel) => {
      try {
        return !!el.querySelector(sel);
      } catch (e) {
        return false;
      }
    };
    if (has('input[type="file"]')) return true;
    if (has('input[type="email"]') || has('input[type="tel"]')) return true;
    if (has('button[type="submit"], input[type="submit"]')) return true;
    const p = probe();
    if (!p) return false;
    try {
      return p.fillableIn(el).elements.filter(isVisible).length > SEARCH_VETO_MAX_FIELDS;
    } catch (e) {
      return false;
    }
  }
  var SEARCH_VETO_MAX_FIELDS = 3;
  var ACCOUNT_FORM_MAX_FIELDS = 6;
  function isApplicationWithAccount(el) {
    const has = (sel) => {
      try {
        return !!el.querySelector(sel);
      } catch (e) {
        return false;
      }
    };
    if (has('input[type="file"]')) return true;
    const p = probe();
    if (!p) return false;
    try {
      return p.fillableIn(el).elements.filter(isVisible).length > ACCOUNT_FORM_MAX_FIELDS;
    } catch (e) {
      return false;
    }
  }
  function looksLikeNotAnApplication(el) {
    if (!el) return true;
    try {
      if (el.matches('[role="search"]')) return true;
      if (el.querySelector('input[type="password"]') && !isApplicationWithAccount(el)) return true;
      const action = el.getAttribute && el.getAttribute("action") || "";
      const id = el.getAttribute && (el.getAttribute("id") || "") || "";
      const cls = el.className && String(el.className) || "";
      if (SEARCHY.test(action) || SEARCHY.test(id) || SEARCHY.test(cls)) return true;
      if (el.querySelector('input[type="search"]') && !hasApplicationSignal(el)) return true;
    } catch (e) {
    }
    return false;
  }
  function scoreRoot(el, doc) {
    const p = probe();
    if (!p) return null;
    if (looksLikeNotAnApplication(el)) return null;
    if (el.closest && el.closest("#tailorcv-sidebar")) return null;
    const { elements, opaqueHosts } = p.fillableIn(el);
    const visible = elements.filter(isVisible);
    const choices = choiceGroups(el).length;
    if (visible.length + choices < 2) return null;
    let score = visible.length + choices;
    const has = (sel) => {
      try {
        return !!el.querySelector(sel);
      } catch (e) {
        return false;
      }
    };
    if (has('input[type="email"]') || has('input[type="tel"]')) score += 3;
    if (has('input[type="file"]')) score += 3;
    if (has('button[type="submit"], input[type="submit"]')) score += 2;
    if ((el.tagName || "").toLowerCase() === "form") score += 2;
    const automation = el.getAttribute && el.getAttribute("data-automation-id") || "";
    if (/applyFlow/i.test(automation)) score += 4;
    return { root: el, score, fields: visible, opaqueHosts };
  }
  var APPLY_URL_RE = new RegExp([
    /\/apply(\/|$|\?)/.source,
    /\/application(s)?(\/|$|\?)/.source,
    /jobs\.lever\.co\/[^/]+\/[^/]+\/apply/.source,
    /(job-boards|boards)\.greenhouse\.io\/[^/]+\/jobs\//.source,
    /greenhouse\.io\/embed\/job_app/.source,
    /myworkdayjobs\.com\/.*\/job\//.source,
    /\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{8,}/.source,
    /smartrecruiters\.com\/.*\/.*\/?(apply)?/.source,
    /workable\.com\/j\//.source,
    /icims\.com\/jobs\//.source,
    /jobvite\.com\/.*\/job\//.source,
    /bamboohr\.com\/(careers|jobs)\//.source
  ].join("|"), "i");
  function detectAts(url) {
    const u = String(url || "").toLowerCase();
    if (/greenhouse\.io/.test(u)) return "greenhouse";
    if (/lever\.co/.test(u)) return "lever";
    if (/ashbyhq\.com/.test(u)) return "ashby";
    if (/myworkdayjobs\.com|myworkdaysite\.com/.test(u)) return "workday";
    if (/smartrecruiters\.com/.test(u)) return "smartrecruiters";
    if (/workable\.com/.test(u)) return "workable";
    if (/icims\.com/.test(u)) return "icims";
    if (/jobvite\.com/.test(u)) return "jobvite";
    if (/bamboohr\.com/.test(u)) return "bamboohr";
    if (/taleo\.net/.test(u)) return "taleo";
    if (/successfactors\.(com|eu)/.test(u)) return "successfactors";
    if (/oraclecloud\.com\/hcmui\/candidateexperience/.test(u)) return "oracle";
    return "generic";
  }
  var MIN_CONFIDENT_SCORE = 6;
  function findForm(doc) {
    const d = doc || globalThis.document;
    if (!d || !probe()) return null;
    const seen = /* @__PURE__ */ new Set();
    const scored = [];
    for (const sel of APP_ROOT_SELECTORS) {
      let nodes = [];
      try {
        nodes = Array.prototype.slice.call(d.querySelectorAll(sel));
      } catch (e) {
        continue;
      }
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        const s = scoreRoot(node, d);
        if (s) scored.push(s);
      }
    }
    if (!scored.length || scored.every((s) => s.fields.length < 3)) {
      const all = probe().fillableIn(d).elements.filter(isVisible).concat(choiceGroups(d.body).map((c) => c.group));
      if (all.length >= 2) {
        const root = commonAncestor(all);
        const s = root && scoreRoot(root, d);
        if (s) scored.push(s);
      }
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score || a.fields.length - b.fields.length);
    const best = ashbyWholeForm(scored[0], d);
    const url = d.defaultView && d.defaultView.location && d.defaultView.location.href || "";
    return {
      root: best.root,
      score: best.score,
      fields: best.fields,
      opaqueHosts: best.opaqueHosts,
      ats: detectAts(url),
      url,
      isForm: best.score >= MIN_CONFIDENT_SCORE || APPLY_URL_RE.test(url)
    };
  }
  var NOT_A_FIELD_SEL = ".ashby-application-form-autofill-uploader";
  function notAField(el) {
    return !!(el && el.closest && el.closest(NOT_A_FIELD_SEL));
  }
  function ashbyWholeForm(best, d) {
    const SEL = ".ashby-application-form-container";
    let parts = [];
    try {
      parts = Array.from(d.querySelectorAll(SEL));
    } catch (e) {
      return best;
    }
    if (parts.length < 2 || !parts.some((c) => c === best.root || c.contains(best.root))) return best;
    const root = commonAncestor(parts);
    if (!root || root === best.root || isFormLevel(root)) return best;
    const p = probe();
    const { elements, opaqueHosts } = p.fillableIn(root);
    const fields = elements.filter((el) => isVisible(el) && !notAField(el));
    return { root, score: best.score, fields, opaqueHosts };
  }
  function commonAncestor(els) {
    let node = els[0];
    for (let i = 1; i < els.length; i++) {
      node = pairAncestor(node, els[i]);
      if (!node) return null;
    }
    while (node && ["body", "html"].includes((node.tagName || "").toLowerCase())) {
      return node;
    }
    return node;
  }
  function pairAncestor(a, b) {
    if (!a || !b) return null;
    if (a === b) return a;
    if (a.contains && a.contains(b)) return a;
    if (b.contains && b.contains(a)) return b;
    let n = a.parentElement;
    while (n) {
      if (n.contains(b)) return n;
      n = n.parentElement;
    }
    return null;
  }
  function looksLikeApplyUrl(url) {
    return APPLY_URL_RE.test(String(url || ""));
  }
  function diagnose(doc) {
    const d = doc || globalThis.document;
    const p = probe();
    const report = { summary: {}, roots: [], fields: [], uncovered: [] };
    if (!p) {
      report.summary.error = "field probe not installed";
      return report;
    }
    const seen = /* @__PURE__ */ new Set();
    for (const sel of APP_ROOT_SELECTORS) {
      let nodes = [];
      try {
        nodes = Array.prototype.slice.call(d.querySelectorAll(sel));
      } catch (e) {
        continue;
      }
      for (const node of nodes.slice(0, 12)) {
        if (seen.has(node)) continue;
        seen.add(node);
        const all = p.fillableIn(node).elements;
        const scored = scoreRoot(node, d);
        report.roots.push({
          selector: sel,
          node: describeNode(node),
          fillable: all.length,
          visible: all.filter(isVisible).length,
          score: scored ? scored.score : null,
          rejected: scored ? "" : rootRejection(node, all)
        });
      }
    }
    const form = findForm(d);
    if (form) {
      for (const row of describeFields(form)) {
        report.fields.push({
          label: String(row.label || "").slice(0, 60),
          kind: row.kind,
          key: row.key,
          filled: row.filled,
          required: row.required,
          readable: row.readable
        });
      }
    }
    const covered = new Set(form ? form.fields : []);
    let candidates = [];
    try {
      candidates = Array.prototype.slice.call(d.querySelectorAll(
        '[aria-haspopup], [role="listbox"], [role="spinbutton"], [role="radio"], [role="checkbox"], [role="switch"], [role="textbox"], [data-automation-id]'
      ));
    } catch (e) {
      candidates = [];
    }
    for (const el of candidates) {
      if (covered.has(el) || el.closest && el.closest("#tailorcv-sidebar")) continue;
      if (el.matches && el.matches(p.FILLABLE_SEL)) continue;
      const role = el.getAttribute("role") || "";
      const automation = el.getAttribute("data-automation-id") || "";
      if (!role && !el.getAttribute("aria-haspopup") && !/input|select|dropdown|radio|checkbox|date|prompt|textbox/i.test(automation)) continue;
      report.uncovered.push({
        node: describeNode(el),
        role,
        automation,
        text: clean(el.textContent).slice(0, 40)
      });
      if (report.uncovered.length >= 40) break;
    }
    report.summary = {
      url: d.defaultView && d.defaultView.location && d.defaultView.location.href || "",
      applyShapedUrl: looksLikeApplyUrl(d.defaultView && d.defaultView.location && d.defaultView.location.href),
      formFound: !!form,
      isForm: !!(form && form.isForm),
      root: form ? describeNode(form.root) : null,
      fieldCount: form ? form.fields.length : 0,
      totalFillableOnPage: p.fillableIn(d).elements.length,
      opaqueHosts: form ? form.opaqueHosts : 0
    };
    return report;
  }
  function rootRejection(node, fillable) {
    if (node.closest && node.closest("#tailorcv-sidebar")) return "inside the TailorCV panel";
    try {
      if (node.matches('[role="search"]')) return "role=search";
      if (node.querySelector('input[type="search"]')) return "contains a search input";
      if (node.querySelector('input[type="password"]') && !isApplicationWithAccount(node)) {
        return "contains a password field (and is login/sign-up sized)";
      }
    } catch (e) {
    }
    const text = `${node.getAttribute("action") || ""} ${node.id || ""} ${node.className || ""}`;
    if (SEARCHY.test(text)) return `id/class/action looks like search/login: ${text.trim().slice(0, 60)}`;
    const visible = fillable.filter(isVisible).length;
    if (visible < 2) return `only ${visible} visible field(s)`;
    return "unknown";
  }
  function describeNode(el) {
    if (!el || !el.tagName) return "";
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const automation = el.getAttribute && el.getAttribute("data-automation-id");
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `${tag}${id}${automation ? `[data-automation-id=${automation}]` : ""}${cls}`.slice(0, 120);
  }
  function isApplicationPage(doc) {
    const form = findForm(doc);
    if (form && form.isForm) return form;
    return tilesOnlyForm(doc);
  }
  var TILE_BLOCK_SEL = ".apply-flow-block--tile-profile-items";
  var TILE_SEL = "article.apply-flow-profile-item-tile";
  function profileTileBlocks(doc) {
    const d = doc || globalThis.document;
    let blocks = [];
    try {
      blocks = Array.from(d.querySelectorAll(TILE_BLOCK_SEL));
    } catch (e) {
      return [];
    }
    return blocks.filter(isNodeVisible).map((block) => {
      const heading = block.querySelector(".apply-flow-block__title");
      const title = (heading && heading.textContent || "").replace(/\s+/g, " ").trim();
      const kind = /educat|school|qualification/i.test(title) ? "education" : /experience|employment|work history/i.test(title) ? "experience" : "";
      return { block, kind, title };
    });
  }
  function tilesOnlyForm(doc) {
    const d = doc || globalThis.document;
    const blocks = profileTileBlocks(d).filter((b) => b.kind);
    if (!blocks.length) return null;
    const url = d.defaultView && d.defaultView.location && d.defaultView.location.href || "";
    return {
      root: blocks[0].block.closest("form") || blocks[0].block.parentElement || d.body,
      score: 0,
      fields: [],
      opaqueHosts: 0,
      ats: detectAts(url),
      url,
      isForm: true,
      tilesOnly: true
    };
  }
  function describeFields(form) {
    const p = probe();
    if (!p || !form) return [];
    const out = [];
    const groupKeys = /* @__PURE__ */ new Map();
    const keyCounts = /* @__PURE__ */ new Map();
    const dateGroups = /* @__PURE__ */ new Map();
    const fields = (form.fields || []).concat(orphanFileInputs(form));
    for (const el of fields) {
      if (isListboxCompanion(el)) continue;
      if (isChoiceMirror(el)) continue;
      const dateWrap = dateWrapperOf(el);
      if (dateWrap) {
        const existing = dateGroups.get(dateWrap);
        if (existing) {
          existing.members.push(el);
          continue;
        }
        const row2 = dateRow(dateWrap, el, p, keyCounts);
        dateGroups.set(dateWrap, row2);
        out.push(row2);
        continue;
      }
      let d = p.describeEl(el);
      if (!d && isFileField(el)) {
        const named = uploadGroupLabel(el);
        if (named) {
          d = {
            ident: named,
            kind: "file",
            label: named,
            value: "",
            filled: false,
            invalid: false,
            required: false,
            options: null
          };
        }
      }
      if (!d) {
        out.push(unreadable(el, p));
        continue;
      }
      const kind = d.kind;
      const logical = groupIdentity(el, d, kind);
      if (logical && groupKeys.has(logical)) {
        const existing = out[groupKeys.get(logical)];
        existing.members.push(el);
        const label = p.labelFor(el) || el.value || "";
        if (label) existing.options.push({ value: el.value || label, label, el });
        if (el.checked) {
          existing.filled = true;
          existing.value = label;
        }
        if (p.requiredFor(el)) existing.required = true;
        continue;
      }
      let key = questionSignature(d.ident);
      if (!key) {
        out.push(unreadable(el, p));
        continue;
      }
      const n = (keyCounts.get(key) || 0) + 1;
      keyCounts.set(key, n);
      if (n > 1) key = `${key}#${n}`;
      const row = {
        key,
        el,
        members: [el],
        kind,
        label: (d.label || "").trim() || d.ident,
        ident: d.ident,
        // Collapsed the same way the server engine collapses it: a value is only
        // carried when the field is genuinely filled. An unfilled <select> still
        // reports its placeholder ("Select…") as displayed text, and `value` feeds
        // the anti-downgrade guard, which treats any non-empty current value as a
        // real answer worth protecting — so leaking a placeholder through here
        // makes it refuse a legitimate first "prefer not to answer".
        value: d.filled ? d.value || "" : "",
        filled: !!d.filled,
        invalid: !!d.invalid,
        required: !!d.required,
        options: normalizeOptions(d.options),
        readable: true,
        documentSlot: null,
        hints: fieldHints(el),
        // A separate country-code picker beside a phone box means the box wants
        // the national number only; pasting "+91 98765 43210" into it produces a
        // doubled dial code the form then rejects.
        hasCountryWidget: hasCountryWidget(el),
        // Workday's search-and-tick prompt (Skills, Field of Study): Enter runs
        // the search and each answer is a clicked result. See commitPromptMulti.
        multiPrompt: !!(p.workdayMultiselect && p.workdayMultiselect(el))
      };
      if (PLACEHOLDER_LABEL_RE.test(row.label)) {
        const named = sectionNameOf(el) || (PLACEHOLDER_LABEL_RE.test(d.ident) ? "" : d.ident);
        if (named) row.label = named;
      }
      if (kind === "radio" || kind === "checkbox") {
        const label = p.labelFor(el) || el.value || "";
        row.options = label ? [{ value: el.value || label, label, el }] : [];
        row.optionLabel = label;
        if (logical) groupKeys.set(logical, out.length);
      }
      if (isFileField(el)) {
        row.kind = "file";
        let slot = documentSlotFor(row.label) || documentSlotFor(d.ident) || null;
        if (!slot || UPLOAD_ACTION_RE.test(row.label)) {
          const group = uploadGroupLabel(el);
          const groupSlot = documentSlotFor(group);
          if (group && (groupSlot || UPLOAD_ACTION_RE.test(row.label))) {
            row.label = group;
            slot = groupSlot || slot;
          }
        }
        if (!slot) {
          const heading = sectionHeadingBefore(el);
          const headingSlot = documentSlotFor(heading);
          if (headingSlot) {
            slot = headingSlot;
            row.label = heading;
          }
        }
        if (!slot && CATCH_ALL_UPLOAD_RE.test(row.label) && /cover ?letter/i.test(fieldDescription(el))) {
          slot = "cover_letter";
          row.catchAllUpload = true;
        }
        row.documentSlot = slot;
        row.filled = hasUploadedFile(el);
      }
      out.push(row);
    }
    for (const { group, buttons, question } of choiceGroups(form.root)) {
      let key = questionSignature(question) || `choice ${out.length}`;
      const n = (keyCounts.get(key) || 0) + 1;
      keyCounts.set(key, n);
      if (n > 1) key = `${key}#${n}`;
      const selected = buttons.find(isChoiceSelected);
      out.push({
        key,
        el: group,
        members: buttons,
        kind: "choice",
        label: question,
        ident: key,
        value: selected ? choiceText(selected) : "",
        filled: !!selected,
        invalid: false,
        required: /\*\s*$|\*|\(required\)/.test(question) || labelMarkedRequired(mirrorLabel(group)),
        options: buttons.map((b) => ({ value: choiceText(b), label: choiceText(b), el: b })),
        readable: true,
        documentSlot: null,
        hints: { tag: "choice" }
      });
    }
    for (const zone of dropOnlyZones(form.root)) {
      const label = zoneLabel(zone, p);
      const key = questionSignature(label) || `dropzone ${out.length}`;
      if (keyCounts.has(key)) continue;
      keyCounts.set(key, 1);
      out.push({
        key,
        el: zone,
        members: [zone],
        kind: "file",
        label: label || "File upload",
        ident: key,
        value: "",
        filled: hasUploadedFile(zone),
        invalid: false,
        required: /\*|\(required\)/.test(label),
        options: [],
        readable: true,
        documentSlot: documentSlotFor(label),
        hints: { tag: "dropzone" },
        dropOnly: true
      });
    }
    if (out.some((r) => r.documentSlot === "cover_letter" && !r.catchAllUpload)) {
      for (const r of out) if (r.catchAllUpload) {
        r.documentSlot = null;
        r.catchAllUpload = false;
      }
    }
    const phoneCode = out.find((r) => PHONE_CODE_RE.test(r.label || ""));
    if (phoneCode) {
      for (const row of out) {
        if (row === phoneCode) continue;
        if (row.hints && row.hints.type === "tel" || /\b(phone|mobile)\b/i.test(row.label || "")) {
          if (!/extension|\bext\b|device|type|code/i.test(row.label || "")) row.hasCountryWidget = true;
        }
      }
    }
    for (const row of out) {
      if (row.kind === "date-parts") {
        const now2 = readDateParts(row);
        row.filled = now2.filled;
        row.value = now2.value;
        continue;
      }
      if (row.kind !== "radio" && row.kind !== "checkbox") continue;
      const question = groupLabel(row.members, p);
      if (question && (row.members.length > 1 || row.kind === "radio")) {
        row.label = question;
        if (/\*|\(required\)/i.test(question)) row.required = true;
        const group = row.members[0].closest && row.members[0].closest('fieldset, [role="radiogroup"]');
        if (group && group.getAttribute("aria-required") === "true") row.required = true;
        if (group && labelMarkedRequired(fieldsetQuestionLabel(group, row.members))) row.required = true;
      } else if (row.optionLabel) row.label = row.optionLabel;
    }
    return out;
  }
  var CATCH_ALL_UPLOAD_RE = /\b(additional|other|supporting|supplementary|optional)\b.*\b(attachments?|documents?|files?|materials?)\b|^\s*(attachments?|documents?)\s*\*?\s*$/i;
  function fieldDescription(el) {
    const wrap = el.closest && el.closest(
      '[data-field-path], .ashby-application-form-field-entry, [class*="fieldEntry" i], [class*="field-entry" i], [class*="form-group" i], fieldset'
    );
    if (!wrap || isFormLevel(wrap)) return "";
    try {
      const clone = wrap.cloneNode(true);
      for (const x of clone.querySelectorAll("button, input, select, textarea")) x.remove();
      const doc = wrap.ownerDocument;
      const walker = doc.createTreeWalker(
        clone,
        4
        /* NodeFilter.SHOW_TEXT */
      );
      const parts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue);
      return clean(parts.join(" ")).slice(0, 400);
    } catch (e) {
      return "";
    }
  }
  function unreadable(el, p) {
    return {
      key: "",
      el,
      members: [el],
      kind: "unknown",
      label: (p.labelFor(el) || "").trim(),
      ident: "",
      value: "",
      filled: false,
      invalid: false,
      required: !!p.requiredFor(el),
      options: [],
      readable: false,
      documentSlot: null,
      hints: fieldHints(el)
    };
  }
  var DATE_PART_RE = /dateSection(Month|Day|Year)/i;
  var PHONE_CODE_RE = /\b(phone|dial(ing)?|calling|country)\s*(\/\s*territory\s*)?(phone\s*)?code\b/i;
  function dateWrapperOf(el) {
    const automation = el.getAttribute && el.getAttribute("data-automation-id") || "";
    if (!DATE_PART_RE.test(automation)) return null;
    return el.closest && el.closest('[data-automation-id="dateInputWrapper"]') || el.parentElement;
  }
  function dateRow(wrap, first, p, keyCounts) {
    let label = "";
    const by = wrap.getAttribute && wrap.getAttribute("aria-labelledby");
    if (by) {
      const ref = wrap.ownerDocument.getElementById(by);
      if (ref) label = clean(ref.textContent);
    }
    if (!label) {
      const field = wrap.closest && wrap.closest('[data-automation-id^="formField"]');
      const lab = field && field.querySelector("label, legend");
      if (lab) label = clean(lab.textContent);
    }
    label = label || "Date";
    let key = questionSignature(label) || "date";
    const n = (keyCounts.get(key) || 0) + 1;
    keyCounts.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    return {
      key,
      el: first,
      members: [first],
      kind: "date-parts",
      label,
      ident: label,
      value: "",
      filled: false,
      invalid: false,
      required: /\*/.test(label) || first.getAttribute && first.getAttribute("aria-required") === "true",
      options: [],
      readable: true,
      documentSlot: null,
      hints: { type: "date-parts", tag: "input" }
    };
  }
  function datePartOf(el) {
    const automation = el.getAttribute && el.getAttribute("data-automation-id") || "";
    const m = automation.match(DATE_PART_RE);
    return m ? m[1].toLowerCase() : "";
  }
  function isFileField(el) {
    return el.getAttribute && (el.getAttribute("type") || "").toLowerCase() === "file";
  }
  var UPLOAD_ACTION_RE = /^(attach|upload|browse|choose|select|add|replace)(\s+(a|an|your)?\s*(file|document|resume|cv|another))?\.?$/i;
  var UPLOADED_NAME_RE = /[\w)\]-]\.(pdf|docx?|rtf|txt|odt|pages)\b/i;
  function hasUploadedFile(el) {
    try {
      if (el.files && el.files.length) return true;
    } catch (e) {
    }
    const own = (el.tagName || "").toLowerCase() !== "input" ? el : null;
    if (own && UPLOADED_NAME_RE.test(own.textContent || "")) return true;
    let n = el.parentElement, depth = 0;
    while (n && depth < 6) {
      let files = 0;
      try {
        files = n.querySelectorAll('input[type="file"]').length;
      } catch (e) {
        break;
      }
      if (files > 1) break;
      if (isFormLevel(n)) break;
      if (UPLOADED_NAME_RE.test(n.textContent || "")) return true;
      n = n.parentElement;
      depth++;
    }
    return false;
  }
  var PLACEHOLDER_LABEL_RE = /^\s*(please\s+)?(select|choose)(\s+(one|an?\s+option))?\s*[:.*]?\s*$/i;
  function sectionNameOf(el) {
    const clean2 = (s) => (s || "").replace(/\s+/g, " ").trim();
    try {
      const group = el.closest('[role="group"][aria-labelledby], fieldset');
      if (group && !group.closest("#tailorcv-sidebar")) {
        let text = "";
        if (group.tagName === "FIELDSET") {
          const legend = group.querySelector("legend");
          text = clean2(legend && legend.textContent);
        } else {
          const doc = el.ownerDocument;
          text = clean2(group.getAttribute("aria-labelledby").split(/\s+/).map((id) => {
            const n = doc.getElementById(id);
            return n ? n.textContent : "";
          }).join(" "));
        }
        if (text && text.length <= 80 && !PLACEHOLDER_LABEL_RE.test(text)) return text;
      }
    } catch (e) {
    }
    return sectionHeadingBefore(el);
  }
  function sectionHeadingBefore(el) {
    const doc = el.ownerDocument;
    if (!doc) return "";
    const FOLLOWS = 4;
    let heading = null;
    try {
      for (const h of doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
        if (h.closest("#tailorcv-sidebar")) continue;
        if (h.compareDocumentPosition(el) & FOLLOWS) heading = h;
        else break;
      }
      if (!heading) return "";
      for (const other of doc.querySelectorAll('input[type="file"]')) {
        if (other === el) continue;
        const afterHeading = heading.compareDocumentPosition(other) & FOLLOWS;
        const beforeEl = other.compareDocumentPosition(el) & FOLLOWS;
        if (afterHeading && beforeEl) return "";
      }
    } catch (e) {
      return "";
    }
    const text = (heading.textContent || "").replace(/\s+/g, " ").trim();
    return text.length <= 60 ? text : "";
  }
  function uploadGroupLabel(el) {
    const doc = el.ownerDocument;
    if (!doc) return "";
    const text = (n2) => n2 && n2.textContent ? n2.textContent.replace(/\s+/g, " ").trim() : "";
    let n = el.parentElement, depth = 0;
    while (n && depth < 6) {
      let files = 0;
      try {
        files = n.querySelectorAll('input[type="file"]').length;
      } catch (e) {
        break;
      }
      if (files > 1) break;
      if (isFormLevel(n)) break;
      const by = n.getAttribute && n.getAttribute("aria-labelledby") || "";
      if (by) {
        const named2 = by.split(/\s+/).map((id) => {
          try {
            return text(doc.getElementById(id));
          } catch (e) {
            return "";
          }
        }).filter(Boolean).join(" ");
        if (named2 && !UPLOAD_ACTION_RE.test(named2)) return named2;
      }
      if ((n.tagName || "").toLowerCase() === "fieldset") {
        const lg = n.querySelector("legend");
        const named2 = text(lg);
        if (named2 && !UPLOAD_ACTION_RE.test(named2)) return named2;
      }
      let named = "";
      try {
        const texts = Array.from(
          n.querySelectorAll('button, label, legend, [role="button"], h1, h2, h3, h4')
        ).map(text).filter((t) => t && t.length <= 60);
        named = texts.find((t) => documentSlotFor(t)) || "";
        if (!named && depth === 0) named = texts.find((t) => !UPLOAD_ACTION_RE.test(t)) || "";
      } catch (e) {
      }
      if (named) return named;
      n = n.parentElement;
      depth++;
    }
    return "";
  }
  function orphanFileInputs(form) {
    const root = form && form.root;
    const doc = root && root.ownerDocument;
    if (!doc) return [];
    try {
      if (root.querySelectorAll('input[type="file"]').length) return [];
      return Array.from(doc.querySelectorAll('input[type="file"]')).filter((el) => !root.contains(el) && !(el.closest && el.closest("form")) && isVisible(el)).slice(0, 2);
    } catch (e) {
      return [];
    }
  }
  function isFormLevel(el) {
    const tag = (el.tagName || "").toLowerCase();
    return tag === "form" || tag === "body" || tag === "html" || tag === "main";
  }
  var DROP_ZONE_SEL = [
    '[class*="dropzone" i]',
    '[class*="drop-zone" i]',
    '[class*="filepond" i]',
    '[class*="uppy" i]',
    "[data-uppy]",
    "[data-filepond]"
  ].join(", ");
  function dropOnlyZones(root) {
    if (!root) return [];
    let zones = [];
    try {
      zones = Array.prototype.slice.call(root.querySelectorAll(DROP_ZONE_SEL));
    } catch (e) {
      return [];
    }
    const out = [];
    for (const zone of zones) {
      let hasInput = false;
      try {
        hasInput = !!zone.querySelector('input[type="file"]') || besideFileInput(zone);
      } catch (e) {
        hasInput = true;
      }
      const nested = out.some((other) => zone.contains(other) || other.contains(zone));
      if (!hasInput && !nested && isVisible(zone) && !notAField(zone)) out.push(zone);
    }
    return out;
  }
  function besideFileInput(zone) {
    let n = zone.parentElement;
    for (let i = 0; n && i < 3 && !isFormLevel(n); i++, n = n.parentElement) {
      if (Array.from(n.children).some((c) => (c.tagName || "").toLowerCase() === "input" && (c.getAttribute("type") || "").toLowerCase() === "file")) return true;
    }
    return false;
  }
  function zoneLabel(zone, p) {
    const aria = zone.getAttribute && zone.getAttribute("aria-label");
    if (aria) return aria.trim();
    const viaProbe = p.labelFor(zone);
    if (viaProbe) return viaProbe;
    const prev = zone.previousElementSibling;
    if (prev && /^(label|legend|h[1-6]|p|span|div)$/i.test(prev.tagName || "")) {
      const text = clean(prev.textContent);
      if (text && text.length < 120) return text;
    }
    return clean(zone.textContent).slice(0, 80);
  }
  function groupIdentity(el, d, kind) {
    if (kind !== "radio" && kind !== "checkbox") return null;
    const name = el.getAttribute && el.getAttribute("name");
    if (name) return `name:${kind}:${name}`;
    const group = el.closest && el.closest('[role="radiogroup"], fieldset');
    if (group) {
      if (!group.__tcvGroupId) {
        group.__tcvGroupId = `g${Math.random().toString(36).slice(2, 10)}`;
      }
      return `grp:${kind}:${group.__tcvGroupId}`;
    }
    return null;
  }
  function groupLabel(members, p) {
    const el = members[0];
    const group = el.closest && el.closest('[role="radiogroup"], fieldset');
    if (group) {
      const aria = group.getAttribute && group.getAttribute("aria-label");
      if (aria) return aria.trim();
      const legend = group.querySelector && group.querySelector("legend");
      if (legend) return clean(legend.textContent);
      const viaProbe = p.labelFor(group);
      if (viaProbe) return viaProbe;
      const question = fieldsetQuestionLabel(group, members);
      if (question) return clean(question.textContent);
    }
    let n = el.parentElement, depth = 0;
    while (n && depth < 6) {
      if (members.every((m) => n.contains(m))) {
        const found = questionLabelIn(n);
        if (found) return found;
      }
      n = n.parentElement;
      depth++;
    }
    return "";
  }
  function fieldsetQuestionLabel(group, members) {
    const ids = new Set(members.map((m) => m.id).filter(Boolean));
    const doc = group.ownerDocument;
    let labels = [];
    try {
      labels = Array.from(group.querySelectorAll("label"));
    } catch (e) {
      return null;
    }
    return labels.find((label) => {
      if (label.querySelector(probe().CONTROL_SEL)) return false;
      const target = label.getAttribute("for");
      if (!target || ids.has(target)) return false;
      if (doc && doc.getElementById(target)) return false;
      return !!clean(label.textContent);
    }) || null;
  }
  function labelMarkedRequired(label) {
    const cls = label && label.className && String(label.className) || "";
    return /(^|[\s_-])required($|[\s_-])/i.test(cls);
  }
  function questionLabelIn(node) {
    let labels = null;
    try {
      labels = node.querySelectorAll("label, legend");
    } catch (e) {
      return "";
    }
    for (const label of labels) {
      if (label.querySelector && label.querySelector(probe().CONTROL_SEL)) continue;
      if (label.getAttribute && label.getAttribute("for")) continue;
      const text = clean(label.textContent);
      if (text && !/^(yes|no|n\/a|other|male|female)$/i.test(text)) return text;
    }
    return "";
  }
  function clean(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }
  function normalizeOptions(options) {
    if (!Array.isArray(options)) return [];
    return options.map((o) => typeof o === "string" ? { value: o, label: o } : o);
  }
  function hasCountryWidget(el) {
    let n = el.parentElement, depth = 0;
    while (n && depth < 3) {
      try {
        const found = n.querySelector(
          '[class*="country" i], [class*="dial" i], [data-country], [class*="flag" i]'
        );
        if (found && found !== el) return true;
      } catch (e) {
      }
      n = n.parentElement;
      depth++;
    }
    return false;
  }
  function fieldHints(el) {
    const g = (a) => el.getAttribute && el.getAttribute(a) || "";
    return {
      type: g("type").toLowerCase(),
      placeholder: g("placeholder"),
      pattern: g("pattern"),
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      autocomplete: g("autocomplete").toLowerCase(),
      inputmode: g("inputmode").toLowerCase(),
      multiple: el.multiple === true,
      tag: (el.tagName || "").toLowerCase()
    };
  }
  var MAX_OPTIONS_READ = 200;
  async function readComboboxOptions(row) {
    const p = probe();
    if (!p || !row || !row.el) return [];
    const el = row.el;
    const existing = p.listboxFor(el);
    if (existing) {
      const labels = optionLabelsIn(existing);
      if (labels.length) return labels;
    }
    const stale = new Set(visibleOptionNodes(p));
    try {
      scrollIntoView(el);
      clickOpen(el);
      let labels = await waitForOptions(stale, TIMING.optionWaitMs);
      if (!labels.length && isOpen(el) && showsPlaceholder(p, stale)) {
        labels = await waitForOptions(stale, TIMING.remoteSearchMs);
      }
      return labels;
    } catch (e) {
      return [];
    } finally {
      dismissListbox(el);
    }
  }
  function isOpen(el) {
    for (let n = el, i = 0; n && i < 3; n = n.parentElement, i++) {
      if (n.getAttribute && n.getAttribute("aria-expanded") === "true") return true;
    }
    return false;
  }
  function showsPlaceholder(p, stale) {
    return visibleOptionNodes(p).some((n) => !stale.has(n) && isDisabledOption(n));
  }
  function isDisabledOption(n) {
    return !!(n.getAttribute && n.getAttribute("aria-disabled") === "true");
  }
  function optionLabelsIn(node) {
    const p = probe();
    const nodes = p && p.optionNodes ? p.optionNodes(node) : [];
    const out = [];
    for (const n of nodes) {
      if (isChosenValue(n) || isDisabledOption(n)) continue;
      const t = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (t && out.length < MAX_OPTIONS_READ) out.push(t);
    }
    return out;
  }
  function visibleOptionNodes(p) {
    if (!p || !p.optionNodes) return [];
    try {
      return p.optionNodes(globalThis.document).filter((n) => isNodeVisible(n));
    } catch (e) {
      return [];
    }
  }
  function waitForOptions(stale, timeout) {
    const skip = stale || /* @__PURE__ */ new Set();
    return new Promise((resolve) => {
      const doc = globalThis.document;
      const p = probe();
      const read = () => {
        if (!p || !p.optionNodes) return [];
        const out = [];
        for (const n of p.optionNodes(doc)) {
          if (skip.has(n) || !isNodeVisible(n) || isChosenValue(n) || isDisabledOption(n)) continue;
          const t = (n.textContent || "").replace(/\s+/g, " ").trim();
          if (t && out.length < MAX_OPTIONS_READ) out.push(t);
        }
        return out;
      };
      const immediate = read();
      if (immediate.length) {
        resolve(immediate);
        return;
      }
      let done2 = false;
      const finish = (labels) => {
        if (done2) return;
        done2 = true;
        try {
          obs.disconnect();
        } catch (e) {
        }
        clearTimeout(timer);
        resolve(labels);
      };
      const obs = new globalThis.MutationObserver(() => {
        const labels = read();
        if (labels.length) finish(labels);
      });
      try {
        obs.observe(doc.body, { childList: true, subtree: true });
      } catch (e) {
      }
      const timer = setTimeout(() => finish(read()), timeout == null ? TIMING.optionWaitMs : timeout);
    });
  }
  function scrollIntoView(el) {
    try {
      const p = probe();
      const node = p && p.fieldWrapper(el) || el;
      if (node.scrollIntoView) node.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (e) {
    }
  }
  function clickOpen(el) {
    const p = probe();
    const target = pickClickTarget(el, p);
    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      try {
        target.focus();
      } catch (_) {
      }
    }
    const win = el.ownerDocument && el.ownerDocument.defaultView || globalThis;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        const Ctor = type.startsWith("pointer") && win.PointerEvent ? win.PointerEvent : win.MouseEvent;
        target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: win, button: 0 }));
      } catch (e) {
      }
    }
  }
  function controlAncestor(el) {
    for (let n = el && el.parentElement, i = 0; n && i < 6; n = n.parentElement, i++) {
      if (Array.from(n.classList || []).some((c) => /(^|[-_])control$/i.test(c))) return n;
    }
    return null;
  }
  function pickClickTarget(el, p) {
    const role = el.getAttribute && el.getAttribute("role");
    if (role === "combobox") {
      const ctl = controlAncestor(el);
      if (ctl && ctl !== el) return ctl;
      return el;
    }
    if (role === "button") return el;
    if ((el.tagName || "").toLowerCase() === "button") return el;
    const wrap = p && p.rsContainer(el) || el.parentElement;
    if (wrap) {
      let ctl = null;
      try {
        ctl = wrap.querySelector('[role="combobox"], [role="button"], [class*="control"]');
      } catch (e) {
        ctl = null;
      }
      if (ctl) return ctl;
    }
    return el;
  }
  function liveMember(el, row) {
    if (!el || el.isConnected) return el;
    const scope = row.scope && row.scope.isConnected ? row.scope : null;
    const id = el.getAttribute && el.getAttribute("id");
    if (!scope || !id) return el;
    try {
      return Array.from(scope.querySelectorAll("[id]")).find((n) => n.id === id) || el;
    } catch (e) {
      return el;
    }
  }
  function readDateParts(row) {
    const parts = {};
    for (const member of row.members || []) {
      const el = liveMember(member, row);
      if (!el.isConnected) continue;
      const part = datePartOf(el);
      if (part) parts[part] = String(el.value || "").trim();
    }
    for (const k of ["month", "day"]) {
      if (/^\d$/.test(parts[k] || "")) parts[k] = "0" + parts[k];
    }
    const order = ["month", "day", "year"].filter((k) => k in parts);
    const values = order.map((k) => parts[k]);
    const filled = order.length > 0 && values.every(Boolean);
    const invalid = (row.members || []).some((el) => el.getAttribute && el.getAttribute("aria-invalid") === "true");
    return {
      value: filled ? values.join("/") : "",
      filled,
      invalid,
      required: !!row.required,
      parts
    };
  }
  function dismissListbox(el) {
    try {
      const target = el && el.isConnected ? el : globalThis.document.activeElement;
      if (!target) return;
      for (const type of ["keydown", "keyup"]) {
        target.dispatchEvent(new globalThis.KeyboardEvent(type, {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        }));
      }
    } catch (e) {
    }
  }
  function reprobe(row) {
    const p = probe();
    if (!p || !row) return null;
    if (row.kind === "date-parts") return readDateParts(row);
    if (row.kind === "choice") {
      const selected = (row.members || []).find((b) => b.isConnected && isChoiceSelected(b));
      return {
        value: selected ? choiceText(selected) : "",
        filled: !!selected,
        invalid: false,
        required: !!row.required
      };
    }
    let el = row.el;
    if (!el || !el.isConnected) {
      el = reresolve(row);
      if (!el) return null;
      row.el = el;
    }
    const d = p.describeEl(el);
    if (!d) return null;
    if (row.kind === "radio" || row.kind === "checkbox") {
      const checked = row.members.filter((x) => x.isConnected && x.checked);
      return {
        value: checked.map((x) => p.labelFor(x) || x.value || "").filter(Boolean).join(" | "),
        filled: checked.length > 0,
        invalid: checked.length > 0 && !!d.invalid,
        required: !!d.required
      };
    }
    return {
      value: d.value || "",
      filled: !!d.filled,
      invalid: !!d.invalid,
      required: !!d.required
    };
  }
  function reresolve(row) {
    const p = probe();
    const doc = globalThis.document;
    if (!p || !row.ident) return null;
    const scope = row.scope && row.scope.isConnected ? row.scope : null;
    const root = scope || doc;
    const esc2 = (s) => String(s).replace(/["\\]/g, "\\$&");
    for (const sel of [`[name="${esc2(row.ident)}"]`, `#${cssId(row.ident)}`]) {
      if (!sel || sel === "#") continue;
      let el = null;
      try {
        el = root.querySelector(sel);
      } catch (e) {
        el = null;
      }
      if (el && isVisible(el)) return el;
    }
    const fields = scope ? p.fillableIn(scope).elements : (findForm(doc) || {}).fields || [];
    if (!fields.length) return null;
    for (const el of fields) {
      const d = p.describeEl(el);
      if (d && questionSignature(d.ident) === row.key.split("#")[0]) return el;
    }
    return null;
  }
  function cssId(ident) {
    return /^[A-Za-z_][\w-]*$/.test(ident) ? ident : "";
  }

  // src/autofill/countries.js
  var TABLE = `
Afghanistan|Afghan
Albania|Albanian
Algeria|Algerian
Andorra|Andorran
Angola|Angolan
Antigua and Barbuda|Antiguan
Argentina|Argentine|Argentinian
Armenia|Armenian
Australia|Australian
Austria|Austrian
Azerbaijan|Azerbaijani
Bahamas|The Bahamas|Bahamian
Bahrain|Bahraini
Bangladesh|Bangladeshi
Barbados|Barbadian
Belarus|Belarusian
Belgium|Belgian
Belize|Belizean
Benin|Beninese
Bhutan|Bhutanese
Bolivia|Plurinational State of Bolivia|Bolivia, Plurinational State of|Bolivian
Bosnia and Herzegovina|Bosnian
Botswana|Motswana|Botswanan
Brazil|Brazilian
Brunei|Brunei Darussalam|Bruneian
Bulgaria|Bulgarian
Burkina Faso|Burkinabe
Burundi|Burundian
Cabo Verde|Cape Verde|Cape Verdean
Cambodia|Cambodian
Cameroon|Cameroonian
Canada|Canadian
Central African Republic|Central African
Chad|Chadian
Chile|Chilean
China|People's Republic of China|PRC|Chinese
Colombia|Colombian
Comoros|Comoran
Congo|Republic of the Congo|Congo, Republic of the|Congolese
Democratic Republic of the Congo|DR Congo|DRC|Congo, Democratic Republic of the|Congo, The Democratic Republic of the
Costa Rica|Costa Rican
Cote d'Ivoire|C\xF4te d'Ivoire|Ivory Coast|Ivorian
Croatia|Croatian
Cuba|Cuban
Cyprus|Cypriot
Czech Republic|Czechia|Czech
Denmark|Danish|Dane
Djibouti|Djiboutian
Dominica|Dominican (Dominica)
Dominican Republic|Dominican
Ecuador|Ecuadorian
Egypt|Egyptian
El Salvador|Salvadoran
Equatorial Guinea|Equatoguinean
Eritrea|Eritrean
Estonia|Estonian
Eswatini|Swaziland|Swazi
Ethiopia|Ethiopian
Fiji|Fijian
Finland|Finnish|Finn
France|French
Gabon|Gabonese
Gambia|The Gambia|Gambian
Georgia|Georgian
Germany|German
Ghana|Ghanaian
Greece|Greek
Grenada|Grenadian
Guatemala|Guatemalan
Guinea|Guinean
Guinea-Bissau|Bissau-Guinean
Guyana|Guyanese
Haiti|Haitian
Honduras|Honduran
Hong Kong|Hong Kong SAR|Hong Kong SAR China|Hong Kong SAR, China|Hong Konger
Hungary|Hungarian
Iceland|Icelandic|Icelander
India|Republic of India|Indian
Indonesia|Indonesian
Iran|Iran, Islamic Republic of|Islamic Republic of Iran|Iranian
Iraq|Iraqi
Ireland|Republic of Ireland|Irish
Israel|Israeli
Italy|Italian
Jamaica|Jamaican
Japan|Japanese
Jordan|Jordanian
Kazakhstan|Kazakhstani|Kazakh
Kenya|Kenyan
Kiribati|I-Kiribati
Kosovo|Kosovar
Kuwait|Kuwaiti
Kyrgyzstan|Kyrgyz
Laos|Lao People's Democratic Republic|Lao|Laotian
Latvia|Latvian
Lebanon|Lebanese
Lesotho|Basotho
Liberia|Liberian
Libya|Libyan
Liechtenstein|Liechtensteiner
Lithuania|Lithuanian
Luxembourg|Luxembourgish|Luxembourger
Macau|Macao|Macao SAR China|Macanese
Madagascar|Malagasy
Malawi|Malawian
Malaysia|Malaysian
Maldives|Maldivian
Mali|Malian
Malta|Maltese
Marshall Islands|Marshallese
Mauritania|Mauritanian
Mauritius|Mauritian
Mexico|Mexican
Micronesia|Micronesia, Federated States of|Micronesian
Moldova|Moldova, Republic of|Republic of Moldova|Moldovan
Monaco|Monegasque
Mongolia|Mongolian
Montenegro|Montenegrin
Morocco|Moroccan
Mozambique|Mozambican
Myanmar|Burma|Burmese
Namibia|Namibian
Nauru|Nauruan
Nepal|Nepalese|Nepali
Netherlands|The Netherlands|Holland|Dutch
New Zealand|New Zealander
Nicaragua|Nicaraguan
Niger|Nigerien
Nigeria|Nigerian
North Korea|Korea, Democratic People's Republic of|Democratic People's Republic of Korea|North Korean
North Macedonia|Macedonia|Macedonian
Norway|Norwegian
Oman|Omani
Pakistan|Pakistani
Palau|Palauan
Palestine|Palestine, State of|State of Palestine|Palestinian Territory|Palestinian
Panama|Panamanian
Papua New Guinea|Papua New Guinean
Paraguay|Paraguayan
Peru|Peruvian
Philippines|The Philippines|Filipino|Philippine
Poland|Polish
Portugal|Portuguese
Puerto Rico|Puerto Rican
Qatar|Qatari
Romania|Romanian
Russia|Russian Federation|Russian
Rwanda|Rwandan
Saint Kitts and Nevis|Kittitian
Saint Lucia|Saint Lucian
Saint Vincent and the Grenadines|Vincentian
Samoa|Samoan
San Marino|Sammarinese
Sao Tome and Principe|S\xE3o Tom\xE9 and Pr\xEDncipe|Santomean
Saudi Arabia|Saudi|Saudi Arabian
Senegal|Senegalese
Serbia|Serbian
Seychelles|Seychellois
Sierra Leone|Sierra Leonean
Singapore|Singaporean
Slovakia|Slovak Republic|Slovak
Slovenia|Slovenian|Slovene
Solomon Islands|Solomon Islander
Somalia|Somali
South Africa|South African
South Korea|Korea, Republic of|Republic of Korea|Korea|Korean|South Korean
South Sudan|South Sudanese
Spain|Spanish|Spaniard
Sri Lanka|Sri Lankan
Sudan|Sudanese
Suriname|Surinamese
Sweden|Swedish|Swede
Switzerland|Swiss
Syria|Syrian Arab Republic|Syrian
Taiwan|Taiwan, Province of China|Taiwanese
Tajikistan|Tajik
Tanzania|Tanzania, United Republic of|United Republic of Tanzania|Tanzanian
Thailand|Thai
Timor-Leste|East Timor|Timorese
Togo|Togolese
Tonga|Tongan
Trinidad and Tobago|Trinidadian|Tobagonian
Tunisia|Tunisian
Turkey|T\xFCrkiye|Turkiye|Turkish
Turkmenistan|Turkmen
Tuvalu|Tuvaluan
Uganda|Ugandan
Ukraine|Ukrainian
United Arab Emirates|UAE|Emirati
United Kingdom|UK|U.K.|Great Britain|Britain|British|England|Scotland|Wales|Northern Ireland|English|Scottish|Welsh
United States|United States of America|USA|U.S.A.|US|U.S.|America|American
Uruguay|Uruguayan
Uzbekistan|Uzbek
Vanuatu|Ni-Vanuatu
Vatican City|Holy See|Holy See (Vatican City State)
Venezuela|Venezuela, Bolivarian Republic of|Venezuelan
Vietnam|Viet Nam|Vietnamese
Yemen|Yemeni
Zambia|Zambian
Zimbabwe|Zimbabwean
`;
  var CASE_SENSITIVE = /* @__PURE__ */ new Set(["US", "U.S.", "UK", "U.K.", "USA", "U.S.A.", "UAE", "PRC", "DRC"]);
  var ENTRIES = TABLE.trim().split("\n").map((line) => {
    const names = line.split("|").map((s) => s.trim()).filter(Boolean);
    return { name: names[0], names };
  });
  function norm(text) {
    return String(text == null ? "" : text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
  }
  var BY_NAME = /* @__PURE__ */ new Map();
  for (const e of ENTRIES) {
    for (const n of e.names) {
      const k = norm(n);
      if (k && !BY_NAME.has(k)) BY_NAME.set(k, e.name);
    }
  }
  var COUNTRY_NAMES = ENTRIES.map((e) => e.name);
  function countryOf(text, inParens = false) {
    const raw = String(text == null ? "" : text).trim();
    if (!raw) return "";
    const whole = BY_NAME.get(norm(raw));
    if (whole) return whole;
    const outside = BY_NAME.get(norm(raw.replace(/\([^)]*\)/g, " ")));
    if (outside) return outside;
    if (inParens) {
      const inside = /\(([^)]+)\)/.exec(raw);
      if (inside) {
        const c = BY_NAME.get(norm(inside[1]));
        if (c) return c;
      }
    }
    return BY_NAME.get(norm(raw.split(/\s*[›>]\s*|\s[-–—:]\s/)[0])) || "";
  }
  function countryShapes(country) {
    const e = ENTRIES.find((x) => x.name === country);
    return e ? e.names.slice() : country ? [country] : [];
  }
  var labelOf = (o) => typeof o === "string" ? o : o && o.label || "";
  function countryOption(country, options) {
    if (!country) return null;
    const labels = (options || []).map(labelOf);
    const same = labels.filter((l) => countryOf(l) === country);
    if (!same.length) return null;
    return same.find((l) => norm(l) === norm(country)) || same[0];
  }
  function countryShare(options) {
    const labels = (options || []).map(labelOf).filter(Boolean);
    if (!labels.length) return 0;
    return labels.filter((l) => countryOf(l)).length / labels.length;
  }
  function countryNamedIn(question) {
    const raw = String(question || "");
    const padded = " " + norm(raw) + " ";
    const hits = [];
    for (const e of ENTRIES) {
      for (const n of e.names) {
        if (CASE_SENSITIVE.has(n)) {
          const esc2 = n.replace(/\./g, "\\.");
          if (new RegExp(`(^|[^A-Za-z.])${esc2}(?![A-Za-z])`).test(raw)) hits.push([e.name, norm(n)]);
          continue;
        }
        const k = norm(n);
        if (k.length > 2 && padded.includes(" " + k + " ")) hits.push([e.name, k]);
      }
    }
    const kept = hits.filter(([c, k]) => !hits.some(([c2, k2]) => c2 !== c && k2 !== k && (" " + k2 + " ").includes(" " + k + " ")));
    const countries = new Set(kept.map(([c]) => c));
    return countries.size === 1 ? Array.from(countries)[0] : "";
  }

  // src/autofill/plan.js
  var AUTOFILL_MIN = 0.8;
  var SUGGEST_MIN = 0.5;
  var PROSE_LENGTH = 180;
  var PROSE_KEYS = /* @__PURE__ */ new Set(["cover_letter", "why_do_you_want_this_role"]);
  var FILL = "fill";
  var SUGGEST = "suggest";
  var ASK = "ask";
  var PROFILE = "profile";
  var DOCUMENT = "document";
  var SKIP = "skip";
  function decide(rows, ctx, server, state2) {
    const bank = ctx && ctx.answerBank || {};
    const employer = String(ctx && ctx.jobCompany || "");
    const answered = server && server.answers || {};
    const registry = state2 && state2.registry || {};
    const userEdited = new Set(state2 && state2.userEdited || []);
    return (rows || []).map((row, position) => {
      const d = base(row);
      d.employer = employer;
      if (userEdited.has(row.key)) {
        return done(d, SKIP, "", "", 0, "you edited this");
      }
      if (row.key && registry[row.key] !== void 0 && row.filled && !row.invalid) {
        return done(d, SKIP, registry[row.key], "profile", 1, "already filled");
      }
      if (!row.readable) {
        return done(d, SKIP, "", "", 0, "could not read this field");
      }
      if (looksLikeOpaqueId(row.label)) {
        d.noServer = true;
        return row.required ? done(d, ASK, "", "", 0, "we couldn't read this question \u2014 please answer it") : done(d, SKIP, "", "", 0, "we couldn't read this question");
      }
      if (isNeverFill(row.label)) {
        return done(d, SKIP, "", "", 0, "we never fill this kind of field");
      }
      if (row.kind === "file" || row.documentSlot) {
        if (row.filled) return done(d, SKIP, "", "", 0, "already has a file");
        const slot = row.documentSlot;
        const have = slot === "cover_letter" ? ctx && ctx.hasCoverLetter : slot === "resume" ? ctx && ctx.hasResume : false;
        d.slot = slot;
        return have ? done(d, DOCUMENT, "", "profile", 0.95, "") : done(
          d,
          ASK,
          "",
          "",
          0,
          slot ? "attach this yourself" : "we could not tell which file this wants"
        );
      }
      const additiveSkills = row.multiPrompt && (matchFieldKey(row.label) || {}).key === "top_skills";
      if (row.filled && !row.invalid && !additiveSkills) {
        return done(d, SKIP, row.value, "", 0, "already filled in");
      }
      const prior = previousEmployerAnswer(row, ctx, bank);
      if (prior) {
        if (prior.ask) return done(d, ASK, "", "", 0, prior.ask);
        if (prior.readFirst) d.readFirst = prior.readFirst;
        return done(d, FILL, prior.value, "profile", 0.9, prior.reason);
      }
      const outside = outsideEmploymentAnswer(row);
      if (outside !== null) {
        return done(d, FILL, outside, "profile", 0.9, "no outside employment \u2014 always No");
      }
      const category = classifySensitive(row.label, employer);
      if (category) {
        d.sensitive = category;
        const entry2 = matchSensitiveKey(row.label, category);
        let stored = entry2 ? bank[entry2.key] : "";
        if (entry2 && entry2.key === "country_of_birth") {
          const raw = String(stored || bank.nationality || "").trim();
          stored = countryOf(raw) || raw;
          if (countryOf(raw)) d.candidates = countryShapes(countryOf(raw));
        }
        const savedDemographic = () => {
          if (category !== "demographic") return null;
          const saved = savedSensitiveAnswer(row.label, ctx && ctx.savedSensitive);
          const value2 = saved ? coerce(saved, row) : null;
          return value2 === null ? null : done(d, FILL, value2, "saved_answer", 0.9, "your saved answer to this question");
        };
        if (STORABLE_SENSITIVE.has(category) && category !== "demographic") {
          const saved = savedSensitiveAnswer(row.label, ctx && ctx.savedSensitive);
          const value2 = saved ? coerce(saved, row) : null;
          if (value2 !== null) {
            return done(d, FILL, value2, "saved_answer", 0.9, "your saved answer to this question");
          }
        }
        if (category === "government_official" || category === "criminal") {
          const g = category === "criminal" ? criminalHistoryAnswer(row, bank) : governmentOfficialAnswer(row, bank);
          if (g.followUp) {
            return row.required ? done(d, ASK, "", "", 0, "only needed for some answers to the question above") : done(d, SKIP, "", "", 0, "only needed if you answered Yes above");
          }
          if (g.profile) return done(d, ASK, "", "", 0, `${g.profile}, or choose your answer here`);
          if (g.ask) return done(d, ASK, "", "", 0, g.ask);
          return done(d, FILL, g.value, "profile", 0.95, g.reason);
        }
        if (category === "citizenship") {
          const c = citizenshipAnswer(row, bank, entry2);
          if (c && c.ask) return done(d, ASK, "", "", 0, c.ask);
          if (c) {
            if (c.candidates && c.candidates.length > 1) d.candidates = c.candidates;
            if (c.drill) d.drill = c.drill;
            if (c.readFirst) d.readFirst = c.readFirst;
            if (row.value && looksLikeDecline(c.value) && !looksLikeDecline(row.value)) {
              return done(d, SKIP, row.value, "", 0, "keeping the answer already there");
            }
            return done(d, FILL, c.value, "profile", 0.95, "");
          }
        }
        if (!stored) {
          const fromSaved = savedDemographic();
          if (fromSaved) return fromSaved;
          const onProfile = PROFILE_CATEGORIES.has(category) && (category !== "demographic" && category !== "birth" || !!entry2) || !!(entry2 && entry2.sensitive);
          return onProfile ? done(d, PROFILE, "", "", 0, profileHint(category, entry2)) : done(d, ASK, "", "", 0, "we never guess this \u2014 choose your answer");
        }
        let key = entry2 ? entry2.key : "";
        let answer = stored;
        if (key === "race_ethnicity" && isHispanicYesNoQuestion(row.label)) {
          const yesNo = hispanicYesNo(stored);
          if (yesNo === null) {
            return done(d, ASK, "", "", 0, `your stored answer (${stored}) doesn't say \u2014 choose your answer`);
          }
          if (yesNo) {
            key = "hispanic_latino";
            answer = yesNo;
          }
        }
        if (key === "lgbtq_identity" && !looksLikeDecline(stored)) {
          const sig = questionSignature(row.label);
          const orientation = /\borientation\b/.test(sig);
          if (orientation || /\btransgender\b/.test(sig)) {
            if (!/^no\b/i.test(String(stored).trim())) {
              const fromSaved = savedDemographic();
              if (fromSaved) return fromSaved;
              return done(d, ASK, "", "", 0, `your LGBTQ+ answer (${stored}) doesn't say \u2014 choose your answer`);
            }
            if (orientation) {
              key = "sexual_orientation";
              answer = "Heterosexual";
            }
          }
        }
        const shapes = candidatesFor(key, answer, bank);
        if (shapes.length > 1) d.candidates = shapes;
        if (READ_FIRST_KEYS.has(key) || key === "hispanic_latino") d.readFirst = { key, stored: answer };
        const sponsorship = key === "authorized_to_work_in_country" ? bank.requires_visa_sponsorship : void 0;
        if (sponsorship !== void 0) d.readFirst = { key, stored: answer, sponsorship };
        const value = coerce(answer, Object.assign(
          {},
          row,
          { candidates: shapes, candidateKey: key, sponsorship }
        ));
        if (value === null) {
          const fromSaved = savedDemographic();
          if (fromSaved) return fromSaved;
          return done(d, ASK, "", "", 0, `none of the options match your stored answer (${stored})`);
        }
        if (row.value && looksLikeDecline(value) && !looksLikeDecline(row.value)) {
          return done(d, SKIP, row.value, "", 0, "keeping the answer already there");
        }
        return done(d, FILL, value, "profile", 0.95, "");
      }
      if (isConditionalFollowUp(row.label)) {
        d.noServer = true;
        return row.required ? done(d, ASK, "", "", 0, "only needed for some answers to the question above") : done(d, SKIP, "", "", 0, "only needed if you answered Yes above");
      }
      if (isMotivationQuestion(row.label, row.kind)) {
        d.compose = true;
        const written = answered[String(row.serverIndex != null ? row.serverIndex : position)];
        const text = written ? String(written.value || "").trim() : "";
        if (text) {
          return done(
            d,
            SUGGEST,
            text,
            written.source || "ai_written",
            Number(written.confidence) || 0.55,
            "written for this job \u2014 read it before you submit"
          );
        }
        d.askable = true;
        return row.required ? done(d, ASK, "", "", 0, "needs an answer written for this job") : done(d, SKIP, "", "", 0, "optional \u2014 no answer written yet");
      }
      if (row.kind === "checkbox" && looksLikeTermsAgreement(row.label) && bank.accepts_employer_terms_and_privacy_policy === "Yes") {
        const value = coerce("yes", row);
        if (value !== null) {
          return done(d, FILL, value, "profile", 0.95, "you allowed agreeing to employers' terms");
        }
      }
      const ageAnswer = adultAgeAnswer(row.label);
      if (ageAnswer) {
        const value = coerce(ageAnswer, row);
        if (value !== null) {
          return done(d, FILL, value, "standard", 0.95, "");
        }
      }
      let entry = matchFieldKey(row.label);
      if (entry && entry.key === "name_title" && !hasHonorificOptions(row.options)) entry = null;
      if (entry && entry.key === "preferred_work_location") {
        return row.required ? done(d, ASK, "", "", 0, "which locations you would like to work in") : done(d, SKIP, "", "", 0, "optional \u2014 your work-location preference");
      }
      const storedValue = entry ? bankValue(entry.key, bank) : "";
      if (entry && storedValue) {
        const raw = entry.key === "middle_name" && /\binitial\b/i.test(row.label) ? String(storedValue).trim().charAt(0).toUpperCase() : storedValue;
        const shapes = candidatesFor(entry.key, raw, bank);
        d.candidates = shapes.length > 1 ? shapes : [];
        if (entry.key === "degree" && (row.kind === "combobox" || row.kind === "select")) {
          d.readFirst = { key: "degree", stored: raw };
        }
        if (entry.key === "top_skills" && row.multiPrompt) {
          const skills = splitSkills(raw);
          if (skills.length) {
            d.multiValues = skills;
            return done(d, FILL, skills.join(", "), "profile", 0.95, "");
          }
        }
        if (entry.key === "how_did_you_hear_about_us" && row.kind === "combobox") {
          d.hierarchy = { leaf: HEARD_VIA, parents: HEARD_VIA_PARENTS, fallback: HEARD_VIA_FALLBACK };
        }
        const value = coerce(raw, Object.assign(
          {},
          row,
          { candidates: shapes, candidateKey: entry.key }
        ));
        if (value !== null) {
          const action = isProse(entry.key, value) ? SUGGEST : FILL;
          return done(d, action, value, "profile", 0.95, "");
        }
        if (entry.key === "how_did_you_hear_about_us") {
          return done(d, ASK, "", "", 0, "no LinkedIn or External Agency option here \u2014 choose your answer");
        }
        const other = row.options && row.options.length ? findOtherOption(row.options) : null;
        if (other) {
          return done(
            d,
            SUGGEST,
            other,
            "profile",
            0.5,
            `"${truncate(String(raw), 40)}" isn't offered here; chose "${other}"`
          );
        }
      }
      if (entry && !storedValue && !PROSE_KEYS.has(entry.key)) {
        d.knownEmpty = true;
        const recalled = answered[String(row.serverIndex != null ? row.serverIndex : position)];
        if (recalled && recalled.source === "saved_answer" && String(recalled.value || "").trim()) {
          const value = coerce(recalled.value, row);
          if (value !== null) {
            return done(
              d,
              Number(recalled.confidence) >= AUTOFILL_MIN ? FILL : SUGGEST,
              value,
              "saved_answer",
              Number(recalled.confidence) || 0,
              recalled.matchedQuestion ? `from your answer to "${truncate(recalled.matchedQuestion, 60)}"` : ""
            );
          }
        }
        return row.required ? done(d, ASK, "", "", 0, "not in your profile") : done(d, SKIP, "", "", 0, "not in your profile");
      }
      const fromServer = answered[String(row.serverIndex != null ? row.serverIndex : position)];
      if (fromServer && String(fromServer.value || "").trim()) {
        const value = coerce(fromServer.value, row);
        if (value !== null) {
          const confidence = Number(fromServer.confidence) || 0;
          const prose = isProse("", value);
          const action = confidence >= AUTOFILL_MIN && !prose ? FILL : confidence >= SUGGEST_MIN ? SUGGEST : ASK;
          return done(
            d,
            action,
            value,
            fromServer.source || "ai",
            confidence,
            fromServer.matchedQuestion ? `from your answer to "${truncate(fromServer.matchedQuestion, 60)}"` : ""
          );
        }
      }
      if (row.required) {
        return done(d, ASK, "", "", 0, "we have no answer for this on file");
      }
      const choice = row.kind === "select" || row.kind === "combobox" || row.kind === "radio" || row.kind === "checkbox" || row.kind === "choice";
      d.askable = looksLikeConsent(row.label) || choice || !!entry;
      return done(d, SKIP, "", "", 0, "optional, and we have no answer for it");
    });
  }
  var CONSENT_RE = new RegExp([
    /\bconsent\b|\bi agree\b|\bagree to\b|\baccept\b|\backnowledge\b/.source,
    /\bprivacy (policy|notice)\b|\bterms\b|\bgdpr\b/.source,
    /\bopt[ -]?in\b|\bsubscribe\b|\bmarketing\b|\bpromotional\b/.source,
    /\bupdates about\b|\btalent (pool|community|network)\b|\bfuture (roles|openings|opportunities)\b/.source,
    /\bcontact me\b|\bkeep me\b|\bnotify me\b/.source
  ].join("|"), "i");
  function looksLikeConsent(label) {
    return CONSENT_RE.test(String(label == null ? "" : label));
  }
  var TERMS_RE = /\bterms\b|\bprivacy (policy|notice|statement)\b|\bi agree\b|\bagree to\b|\bi accept\b|\baccept (the|our|these)\b|\backnowledge\b|\bi certify\b|\bcertify that\b|\battest\b|\bi have read\b|\bread and (understood|understand|agree|accept|consent)\b|\bconsent to the (above|terms|foregoing|following)\b/i;
  var OPT_IN_RE = /\bmarketing\b|\bpromotional\b|\bnewsletter\b|\bsubscribe\b|\btext messages?\b|\bsms\b|\bwhatsapp\b|\bupdates about\b|\btalent (pool|community|network)\b|\bfuture (roles|openings|opportunities)\b|\bjob alerts?\b|\bcontact me\b|\bkeep me\b|\bnotify me\b/i;
  var ADULT_RE = /\b(at least|over|above|older than|minimum age of|aged?)\s*(the age of\s*)?(18|eighteen|16|sixteen)\b|\b(18|eighteen|16|sixteen)\s*(years?\s*(of age|old)?|\+)?\s*(or|and)\s*(older|over|above)\b|\b(18|eighteen)\s*\+|\blegal (working )?age\b|\bage of majority\b/i;
  var MINOR_RE = /\b(under|younger than|below)\s*(the age of\s*)?(18|eighteen|16|sixteen)\b/i;
  function adultAgeAnswer(label) {
    const t = String(label == null ? "" : label);
    if (MINOR_RE.test(t)) return "no";
    if (ADULT_RE.test(t)) return "yes";
    return "";
  }
  function looksLikeTermsAgreement(label) {
    const t = String(label == null ? "" : label);
    return TERMS_RE.test(t) && !OPT_IN_RE.test(t);
  }
  function base(row) {
    return {
      key: row.key,
      row,
      label: row.label,
      kind: row.kind,
      required: !!row.required,
      options: row.options || [],
      sensitive: null,
      slot: null,
      // Shapes the answer may take, best first. One entry for an ordinary field;
      // several for the ones whose label does not say what the box wants.
      candidates: []
    };
  }
  function done(d, action, value, source, confidence, reason) {
    d.action = action;
    d.value = value == null ? "" : String(value);
    d.source = source || "";
    d.confidence = confidence || 0;
    d.reason = reason || "";
    return d;
  }
  function isProse(key, value) {
    return PROSE_KEYS.has(key) || String(value).length > PROSE_LENGTH;
  }
  function truncate(s, n) {
    const t = String(s || "");
    return t.length <= n ? t : `${t.slice(0, n - 1)}\u2026`;
  }
  var PROFILE_CATEGORIES = /* @__PURE__ */ new Set(["work_authorization", "sponsorship", "salary", "demographic", "birth"]);
  function profileHint(category, entry) {
    if (entry && entry.key === "nationality") return "add your country of citizenship to your profile";
    if (category === "citizenship") return "add your country of citizenship to your profile";
    if (entry && entry.key === "citizenship_status") return "add your citizenship status to your profile";
    switch (category) {
      case "work_authorization":
        return "add your work authorization to your profile";
      case "sponsorship":
        return "add your sponsorship answer to your profile";
      case "salary":
        return "add your salary expectation to your profile";
      case "demographic":
        return "set your voluntary disclosures in your profile";
      case "birth":
        return "add your date / place of birth to your profile";
      default:
        return "";
    }
  }
  var LOCATION_KEYS = /* @__PURE__ */ new Set(["location", "address_city", "address_state", "address_country"]);
  var DEGREE_LEVELS = [
    {
      test: /\b(ph\.? ?d|doctorate|doctoral|d\.?phil)\b/i,
      // Level phrasings only. "Doctor of Philosophy" is a SPECIFIC degree and
      // reads as a near-match for "Doctor of Medicine (M.D.)", which it is not.
      shapes: ["Doctorate", "Doctoral Degree", "PhD"]
    },
    // "graduate" is master-level in US phrasing; \b keeps it out of
    // "undergraduate", which is the bachelor's row below. Every shape a level
    // offers must itself name that level, or the level guard has nothing to
    // check and a generic "Postgraduate Degree" drifts onto "Associate's Degree".
    {
      test: /\b(m\.? ?tech|m\.? ?sc|m\.? ?s|m\.? ?a|m\.? ?eng|mba|mca|m\.? ?com|master'?s?|post ?graduate|graduate)\b/i,
      shapes: ["Master's Degree", "Masters", "Master", "Postgraduate Degree", "Graduate Degree"]
    },
    {
      test: /\b(b\.? ?tech|b\.? ?e|b\.? ?sc|b\.? ?s|b\.? ?a|b\.? ?eng|bca|b\.? ?com|bachelor'?s?|under ?graduate)\b/i,
      shapes: ["Bachelor's Degree", "Bachelors", "Bachelor", "Undergraduate Degree", "Undergraduate"]
    },
    {
      test: /\bassociate'?s?\b/i,
      shapes: ["Associate's Degree", "Associates", "Associate"]
    },
    {
      test: /\b(high school|secondary school|higher secondary|12th|hsc)\b/i,
      shapes: ["High School", "High School Diploma", "Secondary School"]
    },
    // A diploma on its own is post-school (a polytechnic "Diploma in Mechanical
    // Engineering", a "Diploma in Fine Arts") — not a high-school qualification.
    // Listed after high school so "High School Diploma" still reads as that.
    // Before, any "diploma" was the high-school level, and a Diploma in Fine
    // Arts was entered on Oracle as "High School Diploma".
    {
      test: /\bdiploma\b/i,
      shapes: ["Diploma"]
    }
  ];
  var ETHNICITY_GROUPS = [
    // Ordered before the Asian row: "American Indian" and "Asian Indian" share a
    // word, and only the tribal-affiliation sense belongs here.
    {
      test: /\b(american indian|alaska(n)? native|native american|indigenous|first nations?|aboriginal)\b/i,
      shapes: [
        "American Indian or Alaska Native",
        "Indigenous / First Nations",
        "Indigenous",
        "First Nations",
        "Native American"
      ]
    },
    {
      test: /\b(native hawaiian|pacific islander)\b/i,
      shapes: [
        "Native Hawaiian or Other Pacific Islander",
        "Pacific Islander",
        "Native Hawaiian"
      ]
    },
    {
      test: /\b(south asian|east asian|southeast asian|asian|desi|chinese|japanese|korean|filipino|vietnamese|asian indian|indian subcontinent)\b/i,
      shapes: ["Asian", "Asian or Pacific Islander", "Asian (Not Hispanic or Latino)"]
    },
    // Before the Black row: "North African" contains "African", and checked
    // after it, "Middle Eastern or North African" was recorded as Black.
    {
      test: /\b(middle eastern|north african|arab|mena)\b/i,
      shapes: [
        "Middle Eastern or North African",
        "Middle Eastern / North African",
        "Middle Eastern",
        "MENA"
      ]
    },
    {
      test: /\b(black|african american|afro|african)\b/i,
      shapes: [
        "Black or African American",
        "Black or African",
        "Black",
        "African American",
        "Black (Not Hispanic or Latino)"
      ]
    },
    {
      test: /\b(hispanic|latino|latina|latinx|latin american)\b/i,
      shapes: ["Hispanic or Latino", "Hispanic / Latino", "Hispanic", "Latino"]
    },
    {
      test: /\b(white|caucasian|european)\b/i,
      shapes: [
        "White",
        "White / European",
        "Caucasian",
        "White (Not Hispanic or Latino)"
      ]
    },
    {
      test: /\b(two or more|multiracial|multi racial|mixed|biracial)\b/i,
      shapes: ["Two or More Races", "Multiracial", "Two or more races (Not Hispanic or Latino)"]
    }
  ];
  function eeoGuardFor(key, stored) {
    const want = eeoGroup(key, stored);
    return function eeoGuard(candidate, option) {
      return eeoOptionAllowed(key, want, option);
    };
  }
  function ethnicityGroup(text) {
    const t = String(text || "").replace(/\(\s*not hispanic or latino\s*\)/ig, " ");
    return ETHNICITY_GROUPS.findIndex((g) => g.test.test(t));
  }
  function isHispanicYesNoQuestion(label) {
    const text = String(label || "");
    return /\b(hispanic|latin[oax])\b/i.test(text) && !/\b(race|racial|ethnicity)\b/i.test(text);
  }
  function hispanicYesNo(stored) {
    if (looksLikeDecline(stored)) return "";
    const group = ethnicityGroup(stored);
    if (group < 0) return null;
    const shapes = ETHNICITY_GROUPS[group].shapes;
    if (shapes.includes("Hispanic or Latino")) return "Yes";
    if (shapes.includes("Two or More Races")) return null;
    return "No";
  }
  var HEARD_VIA = "LinkedIn";
  var HEARD_VIA_FALLBACK = "External Agency";
  var HEARD_VIA_PARENTS = [
    "Social Platform",
    "Social Media",
    "Professional Network",
    "Job Posting Sites",
    "Job Posting",
    "Job Portal",
    "Job Board",
    "Online Job Board",
    "Internet"
  ];
  var CITIZENSHIP_GROUPS = [
    // "…AND I am NOT a U.S. person" (Snowflake's export-control list) mentions
    // "citizen" earlier in the same option; read as the citizen row it was the
    // pick for a U.S. citizen. Any "not … person / citizen" is a "none".
    { name: "none", test: /\bnot (a |an )?(u\.? ?s\.?|united states)? ?(citizen|national|person)\b|\bnon[- ]?(u\.? ?s\.? )?citizen\b|\bforeign national\b|\bother\b|\bnone of (the )?above\b/i },
    { name: "daca", test: /\bdaca\b|\bdeferred action\b/i },
    { name: "asylee", test: /\basyl(ee|um)\b/i },
    { name: "refugee", test: /\brefugee\b/i },
    { name: "permanent_resident", test: /\bpermanent resident\b|\bgreen card\b/i },
    { name: "citizen", test: /\bcitizen\b|\bnational of the united states\b|\bu\.? ?s\.? national\b/i }
  ];
  function citizenshipGroup(text) {
    const g = CITIZENSHIP_GROUPS.find((group) => group.test.test(String(text || "")));
    return g ? g.name : "";
  }
  function citizenshipOption(stored, options) {
    const want = citizenshipGroup(stored);
    if (!want) return null;
    const same = (options || []).filter((o) => citizenshipGroup(o) === want);
    return same.length === 1 ? same[0] : null;
  }
  var US_CITIZEN = "U.S. citizen or national";
  var NOT_US = "Not a U.S. citizen or permanent resident";
  function usStatus(bank, country) {
    const explicit = String(bank && bank.citizenship_status || "").trim();
    if (explicit) return explicit;
    if (!country) return "";
    return country === "United States" ? US_CITIZEN : NOT_US;
  }
  var BEYOND_CITIZEN_RE = /\bpermanent resident|\bgreen card\b|\bperson\b|\blawful|\bprotected individual\b|\brefugee\b|\basylee\b/i;
  var PLACEHOLDER_RE = /^(select|choose|please select|--|—)/i;
  function isYesNoRow(row, labels) {
    const real = labels.filter((l) => l && !PLACEHOLDER_RE.test(l.trim()));
    if (real.length) return real.every((l) => /^(yes|no)\b/i.test(l.trim()) || looksLikeDecline(l));
    return /^\s*(are|is|do|does|have|has|will|were)\b/i.test(row.label || "");
  }
  function citizenshipAnswer(row, bank, entry) {
    const country = countryOf(bank && bank.nationality || "");
    const labels = (row.options || []).map((o) => typeof o === "string" ? o : o && o.label || "").filter(Boolean);
    const named = countryNamedIn(row.label);
    if (named && isYesNoRow(row, labels)) {
      const explicitGroup = citizenshipGroup(bank && bank.citizenship_status || "");
      if (!country && !(named === "United States" && explicitGroup)) return null;
      let yes;
      if (!country) {
        yes = explicitGroup === "citizen" || BEYOND_CITIZEN_RE.test(row.label || "") && explicitGroup === "permanent_resident";
      } else if (named === country) {
        yes = true;
      } else if (BEYOND_CITIZEN_RE.test(row.label || "")) {
        const explicit = String(bank && bank.citizenship_status || "").trim();
        if (named !== "United States" || !explicit) {
          return { ask: `you're a citizen of ${country} \u2014 your profile doesn't say whether you hold residence there` };
        }
        const group = citizenshipGroup(explicit);
        yes = group === "citizen" || group === "permanent_resident" || (group === "refugee" || group === "asylee") && /\bperson\b|\bprotected individual\b/i.test(row.label);
      } else {
        yes = false;
      }
      const value = coerce(yes ? "Yes" : "No", Object.assign({}, row, { candidateKey: "" }));
      return value === null ? { ask: "none of the options say Yes or No" } : { value };
    }
    if (labels.length) {
      const own = countryOption(country, labels);
      if (own) return { value: own, drill: row.kind === "combobox" ? "Citizen" : "" };
      const theirs = country ? labels.filter((l) => countryOf(l, true) === country) : [];
      const pick = theirs.length ? citizenshipOption("Citizen", theirs) : null;
      if (pick) return { value: pick };
      if (countryShare(labels) >= 0.5) {
        return country ? { ask: `${country} isn't one of this list's options \u2014 choose your answer` } : null;
      }
      if (entry && entry.key === "nationality") return null;
      const status = usStatus(bank, country);
      if (!status) return null;
      const value = citizenshipOption(status, labels);
      return value ? { value, readFirst: { key: "citizenship_status", stored: status, country } } : { ask: `none of the options match your citizenship (${country || status})` };
    }
    if (named && entry && entry.key === "citizenship_status") {
      const status = usStatus(bank, country);
      return status ? { value: status, readFirst: { key: "citizenship_status", stored: status, country } } : null;
    }
    if (!country) return null;
    return { value: country, candidates: countryShapes(country), drill: row.kind === "combobox" ? "Citizen" : "" };
  }
  var PRIOR_EMPLOYER_RE = new RegExp(
    "^\\s*(?:(?:have|had)\\s+you\\s+(?:ever\\s+)?(?:been\\s+)?(?:previously\\s+)?(?:employed|worked|work)|(?:are|were)\\s+you\\s+(?:ever\\s+)?(?:a\\s+)?(?:former|previous|past)\\s+(?:employee|worker|intern|contractor))\\s+(?:directly\\s+)?(?:by|for|at|of)\\s+(.+?)(?=\\s+(?:previously|before|in the past|ever|or\\b|and\\b|as\\b|in any|whether)|\\s*[?(,:*]|$)",
    "i"
  );
  var COMPANY_SUFFIX_RE = /\b(inc|incorporated|ltd|limited|llc|llp|plc|pvt|private|corp|corporation|co|company|gmbh|ag|sa|group|holdings|technologies|technology|solutions|services|analytics|india|global)\b/g;
  var OUR_COMPANY_RE = /^(us|our (company|firm|organi[sz]ation)|this (company|firm|organi[sz]ation)|the company)$/i;
  function companyKey(name) {
    return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(COMPANY_SUFFIX_RE, " ").replace(/\s+/g, " ").trim();
  }
  function sameCompany(a, b) {
    const x = companyKey(a), y = companyKey(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (short.length < 3) return false;
    return (" " + long + " ").includes(" " + short + " ") || short.length >= 4 && long.startsWith(short);
  }
  function previousEmployerAnswer(row, ctx, bank) {
    const kind = row.kind;
    if (kind !== "radio" && kind !== "choice" && kind !== "select" && kind !== "combobox") return null;
    const opts = (row.options || []).map((o) => String(typeof o === "string" ? o : o && o.label || "").trim()).filter((o) => o && !PLACEHOLDER_RE.test(o));
    const yesNo = opts.some((o) => /^yes\b/i.test(o)) && opts.some((o) => /^no\b/i.test(o));
    if (opts.length && !yesNo && !opts.some((o) => EMPLOYER_NEVER_RE.test(o))) return null;
    const m = PRIOR_EMPLOYER_RE.exec(String(row.label || "").replace(/\*+\s*$/, ""));
    if (!m) return null;
    let company = m[1].trim().replace(/^(the|a|an)\s+/i, "");
    if (OUR_COMPANY_RE.test(company)) company = String(ctx && ctx.jobCompany || "").trim();
    if (!company || /^(your|my|any)\b/i.test(company) || /\b(government|military|agency|state.owned|public sector)\b/i.test(company)) return null;
    const jobs = (ctx && ctx.facts && ctx.facts.workExperience || []).map((j) => j && j.company).filter(Boolean);
    const named = [bank.current_company, bank.previous_company].filter(Boolean);
    const employers = jobs.concat(named);
    const was = employers.find((e) => sameCompany(e, company));
    const value = coerce(was ? "Yes" : "No", Object.assign({}, row, { candidateKey: "previous_employer" }));
    if (value === null) {
      return opts.length && !yesNo ? { ask: `none of the options plainly says ${was ? `you worked at ${company}` : `you never worked at ${company}`}` } : null;
    }
    return {
      value,
      readFirst: { key: "previous_employer", stored: was ? "Yes" : "No" },
      reason: was ? `you worked at ${was}` : `${company} isn't in your work history`
    };
  }
  var EMPLOYER_NEVER_RE = /\b(not|never)\b[^.]*\b(work\w*|employ\w*)\b|\bhaven'?t\b[^.]*\bwork\w*/i;
  var EMPLOYER_BEFORE_RE = /\b(previous|former|past|currently|current)\b[^.]*\b(employee|employed|staff)\b|\bi (have|used to) work(ed)? (at|for)\b/i;
  function previousEmployerOption(answer, options) {
    const labels = (options || []).map((o) => String(typeof o === "string" ? o : o && o.label || "").trim()).filter(Boolean);
    const no = /^no$/i.test(String(answer || "").trim());
    const plain = labels.filter((o) => (no ? /^no\b/i : /^yes\b/i).test(o));
    if (plain.length === 1) return plain[0];
    const said = labels.filter((o) => no ? EMPLOYER_NEVER_RE.test(o) : EMPLOYER_BEFORE_RE.test(o) && !EMPLOYER_NEVER_RE.test(o));
    return said.length === 1 ? said[0] : null;
  }
  var OUTSIDE_WORK_RE = new RegExp([
    /\boutside\s+(employment|jobs?|business(es)?|work|activit(y|ies)|engagements?|interests?)\b/.source,
    /\bsecond(ary)?\s+(employment|jobs?|business(es)?)\b/.source,
    /\b(other|additional)\s+(employment|jobs?)\b(?!\s+(offers?|experience|history))/.source,
    /\bmoonlight\w*|\bside\s+(business|jobs?|gigs?|hustle)\b/.source
  ].join("|"), "i");
  var ASKS_IF_RE = /^\s*(are|do|will|would|have|is)\s+you\b/i;
  function outsideEmploymentAnswer(row) {
    const kind = row.kind;
    if (kind !== "radio" && kind !== "choice" && kind !== "select" && kind !== "combobox") return null;
    const opts = (row.options || []).map((o) => String(typeof o === "string" ? o : o && o.label || "").trim()).filter((o) => o && !PLACEHOLDER_RE.test(o));
    if (opts.length && !(opts.some((o) => /^yes\b/i.test(o)) && opts.some((o) => /^no\b/i.test(o)))) return null;
    const head = String(row.label || "").split(/[[(]/)[0];
    if (!ASKS_IF_RE.test(head) || !OUTSIDE_WORK_RE.test(head)) return null;
    return coerce("No", Object.assign({}, row, { candidateKey: "" }));
  }
  var GOV_NEGATED_RE = /\b(not|neither|nor|none)\b/i;
  var GOV_OTHERS_RE = /\bassociates?\b|\bbusiness (partners?|relationships?)\b|\bfriends?\b|\bclose (personal|business)\b|\bpolitically exposed\b/i;
  var GOV_FAMILY_RE = /\bfamily\b|\brelatives?\b|\bspouses?\b|\bpartners?\b|\bparents?\b|\bsiblings?\b|\bbrothers?\b|\bsisters?\b|\bchild(ren)?\b|\bsons?\b|\bdaughters?\b|\bin-?laws?\b|\bhousehold\b|\brelated to\b/i;
  var GOV_SELF_RE = /\b(are|were) you\b|\bhave you (ever )?(been|held|served|occupied)\b|\bdo you (currently )?(hold|occupy|serve)\b|\bi (am|was|have been)\b/i;
  var GOV_OPEN_ENDED_RE = /\bever\b|\bat any time\b|\bnow or in the past\b|\b(past|current) or (present|former)\b|\bformer(ly)?\b|\bha(ve|s) (you |\w+ )?been\b/i;
  var GOV_TIME_LIMIT_RE = /\b(within|during|in) the (last|past|previous|preceding)\b|\b(last|past|previous|preceding) (\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/i;
  function governmentOfficialAnswer(row, bank) {
    const label = String(row.label || "");
    if (isConditionalFollowUp(label)) return { followUp: true };
    const kind = row.kind;
    if (kind !== "radio" && kind !== "choice" && kind !== "select" && kind !== "combobox") {
      return { ask: "we fill this question as a Yes / No only \u2014 choose your answer" };
    }
    const head = (label.includes("?") ? label.split("?")[0] : label.split(/\.\s/)[0]).slice(0, 400);
    if (GOV_NEGATED_RE.test(head)) return { ask: 'worded as a "not" statement \u2014 choose your answer' };
    if (GOV_OTHERS_RE.test(head)) return { ask: "asks about people your profile answers don't cover \u2014 choose your answer" };
    const family = GOV_FAMILY_RE.test(head);
    const self = GOV_SELF_RE.test(head.replace(/\b(are|were) you (related|connected) to\b/ig, ""));
    if (!family && !self) return { ask: "we could not tell whose government role this asks about \u2014 choose your answer" };
    const answers = [];
    if (self) answers.push(String(bank && bank.is_government_official || ""));
    if (family) answers.push(String(bank && bank.family_government_official || ""));
    if (answers.some((a) => a !== "Yes" && a !== "No")) {
      return { profile: "add your government-official answers to your profile" };
    }
    let answer = null;
    if (answers.every((a) => a === "No")) answer = "No";
    else if (answers.length === 1 && GOV_OPEN_ENDED_RE.test(head) && !GOV_TIME_LIMIT_RE.test(head)) answer = "Yes";
    if (!answer) return { ask: "your profile says Yes \u2014 check it applies to what this question asks" };
    const value = coerce(answer, Object.assign({}, row, { candidateKey: "" }));
    if (value === null) return { ask: `none of the options match your profile answer (${answer})` };
    const whose = self && family ? "you or your family" : self ? "you" : "your family";
    return { value, reason: `your profile: ${answer === "No" ? "no government official" : "a government official"} (${whose})` };
  }
  var CRIME_HISTORY_RE = /\bconvict\w*|\bcriminal (record|history|charges?|offen[cs]es?|convictions?|proceedings?|cases?)\b|\bfelon(y|ies)\b|\bmisdemean\w*|\bpending (criminal )?charges?\b|\bcharged with\b|\bpleaded? (guilty|no contest)\b/i;
  var CRIME_EXCLUSION_RE = /\b(other than|excluding|except( for)?|not including|apart from)\b[^,;)?]*|\b(that|which) (has|have) not been [^,;)?]*/gi;
  var CRIME_CONSENT_RE = /\bconsent\w*|\bauthori[sz]\w*|\bagree\w*|\bwilling\b|\bsubmit to\b|\bundergo\b|\bpass\b/i;
  var CRIME_STATEMENT_RE = /\b(confirm|certify|declare|attest)\b|\bi (have|had|am) (no|not|never)\b|\b(not|never|neither|nor|none)\b/i;
  var CRIME_UNCOVERED_RE = /\barrest\w*|\bdetain\w*|\bcaution\w*|\binvestigat\w*|\btraffic\b|\bdriving\b|\bmoving violations?\b|\bdisciplin\w*|\bdismiss\w*|\bterminat\w*|\bfamily\b|\brelatives?\b|\bspouse\b/i;
  var CRIME_SELF_RE = /\b(have|are|were|do|did) you\b|\byou (have|are|were)\b|\bi (have|am|was)\b/i;
  function criminalHistoryAnswer(row, bank) {
    const label = String(row.label || "");
    if (isConditionalFollowUp(label)) return { followUp: true };
    const head = (label.includes("?") ? label.split("?")[0] : label.split(/\.\s/)[0]).slice(0, 400);
    const core = head.replace(CRIME_EXCLUSION_RE, " ");
    if (!CRIME_HISTORY_RE.test(core) || CRIME_CONSENT_RE.test(core)) {
      return { ask: "we never guess this \u2014 choose your answer" };
    }
    const kind = row.kind;
    if (kind !== "radio" && kind !== "choice" && kind !== "select" && kind !== "combobox") {
      return { ask: "we fill this question as a Yes / No only \u2014 choose your answer" };
    }
    if (CRIME_STATEMENT_RE.test(core)) return { ask: "worded as a statement \u2014 choose your answer" };
    if (CRIME_UNCOVERED_RE.test(core)) return { ask: "asks more than your profile answer covers \u2014 choose your answer" };
    if (!CRIME_SELF_RE.test(core)) return { ask: "we never guess this \u2014 choose your answer" };
    const stored = String(bank && bank.has_criminal_history || "");
    if (stored !== "Yes" && stored !== "No") return { profile: "add your criminal-history answer to your profile" };
    if (stored === "Yes") return { ask: "your profile says Yes \u2014 check it applies to what this question asks" };
    const value = coerce("No", Object.assign({}, row, { candidateKey: "" }));
    if (value === null) return { ask: "none of the options match your profile answer (No)" };
    return { value, reason: "your profile: no criminal convictions or pending charges" };
  }
  var MAX_PROMPT_SKILLS = 10;
  function splitSkills(text) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const part of String(text || "").split(/[,;|\n]+/)) {
      const s = part.trim();
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      out.push(s);
      if (out.length >= MAX_PROMPT_SKILLS) break;
    }
    return out;
  }
  function savedSensitiveAnswer(label, saved) {
    const sig = questionSignature(label);
    if (!sig) return "";
    const hit = (saved || []).find((s) => s && questionSignature(s.question) === sig);
    return hit ? String(hit.answer || "").trim() : "";
  }
  var YES_RE = /^(yes|y|true)$/i;
  var NO_RE = /^(no|n|false)$/i;
  function workAuthStatement(authorized, sponsorship, options) {
    const auth = String(authorized || "").trim();
    const spons = String(sponsorship || "").trim();
    let test;
    if (YES_RE.test(spons)) {
      test = (o) => /\b(require|need)s?\b.*\bsponsor/i.test(o) && !/\b(not|don'?t|never)\b/i.test(o);
    } else if (YES_RE.test(auth) && NO_RE.test(spons)) {
      test = (o) => /\bauthori[sz]ed\b/i.test(o) && /\bany employer\b/i.test(o) && !/\bnot\b/i.test(o);
    } else if (NO_RE.test(auth) && NO_RE.test(spons)) {
      test = (o) => /\bnot (legally )?authori[sz]ed\b|\bunauthori[sz]ed\b/i.test(o) && !/\bsponsor/i.test(o);
    } else {
      return null;
    }
    const hits = (options || []).filter(test);
    return hits.length === 1 ? hits[0] : null;
  }
  function ethnicityShapes(text) {
    const i = ethnicityGroup(text);
    return i < 0 ? [] : ETHNICITY_GROUPS[i].shapes;
  }
  function ethnicityGuardFor(stored) {
    return function ethnicityGuard(candidate, option) {
      const want = ethnicityGroup(candidate);
      if (want < 0) return true;
      if (ethnicityGroup(option) !== want) return false;
      const plain = String(option).replace(/\s*\(\s*not hispanic or latino\s*\)\s*/i, " ").trim();
      return sameText(candidate, option) || sameText(candidate, plain) || widensOrEquals(stored, option) || widensOrEquals(stored, plain);
    };
  }
  function sameText(a, b) {
    return normalizeOptionText(a) === normalizeOptionText(b);
  }
  function widensOrEquals(stored, option) {
    const a = normalizeOptionText(stored);
    const b = normalizeOptionText(option);
    if (!a || !b) return false;
    if (a === b) return true;
    const want = new Set(a.split(" ").filter(Boolean));
    const got = new Set(b.split(" ").filter(Boolean));
    return [...got].every((t) => want.has(t));
  }
  function degreeLevel(text) {
    return DEGREE_LEVELS.findIndex((l) => l.test.test(String(text || "")));
  }
  function degreeShapes(text) {
    const i = degreeLevel(text);
    return i < 0 ? [] : DEGREE_LEVELS[i].shapes;
  }
  function degreeLevelAgrees(candidate, option) {
    const want = degreeLevel(candidate);
    if (want < 0) return true;
    return degreeLevel(option) === want;
  }
  function degreeReadsTheSame(candidate, option) {
    const a = normalizeOptionText(candidate);
    const b = normalizeOptionText(option);
    if (!a || !b) return false;
    if (a === b) return true;
    const want = new Set(a.split(" ").filter(Boolean));
    const got = new Set(b.split(" ").filter(Boolean));
    const subset = (small, large) => [...small].every((t) => large.has(t));
    if (subset(got, want)) return true;
    if (subset(want, got)) return want.size / got.size >= 0.5;
    return false;
  }
  function degreeGuard(candidate, option) {
    return degreeLevelAgrees(candidate, option) && degreeReadsTheSame(candidate, option);
  }
  var DEGREE_CATALOG = [
    {
      test: /\bph\.? ?d\b|doctor of philosophy|\bdoctorate\b|\bdoctoral\b/i,
      spellings: ["PhD", "Doctor of Philosophy (Ph.D.)", "Doctor of Philosophy"],
      level: "phd"
    },
    {
      test: /\bm\.d\.?(?![a-z])|^md$|doctor of medicine/i,
      spellings: ["MD", "Doctor of Medicine (M.D.)", "Doctor of Medicine"],
      level: null
    },
    {
      test: /\bj\.d\.?(?![a-z])|^jd$|juris doctor/i,
      spellings: ["JD", "Juris Doctor (J.D.)", "Juris Doctor"],
      level: null
    },
    {
      test: /\bm\.? ?tech\b|master of technology/i,
      spellings: ["MTech", "Master of Technology"],
      level: "master"
    },
    {
      test: /\bm\.e\.?(?![a-z])|^me$|master of engineering/i,
      spellings: ["M.E.", "Master of Engineering"],
      level: "master"
    },
    {
      test: /\bmca\b|master of computer application/i,
      spellings: ["MCA", "Master of Computer Applications"],
      level: "master"
    },
    {
      test: /\bm\.? ?b\.? ?a\b|master of business administration/i,
      spellings: ["MBA", "Master of Business Administration (M.B.A.)", "Master of Business Administration"],
      level: "master"
    },
    {
      test: /\bm\.? ?sc\b|\bm\.s\.?(?![a-z])|^ms$|master of science/i,
      spellings: ["M.Sc", "M.S.", "Master of Science", "Master of Science (M.S.)"],
      level: "master"
    },
    {
      test: /\bm\.a\.?(?![a-z])|^ma$|master of arts/i,
      spellings: ["M.A.", "Master of Arts"],
      level: "master"
    },
    {
      test: /\bm\.? ?com\b|master of commerce/i,
      spellings: ["M.Com", "Master of Commerce"],
      level: "master"
    },
    {
      test: /\bb\.? ?tech\b|bachelor of technology/i,
      spellings: ["BTech", "Bachelor of Technology"],
      level: "bachelor"
    },
    {
      test: /\bb\.e\.?(?![a-z])|^be$|bachelor of engineering/i,
      spellings: ["B.E.", "Bachelor of Engineering"],
      level: "bachelor"
    },
    {
      test: /\bbca\b|bachelor of computer application/i,
      spellings: ["BCA", "Bachelor of Computer Applications"],
      level: "bachelor"
    },
    {
      test: /\bbba\b|bachelor of business administration/i,
      spellings: ["BBA", "Bachelor of Business Administration"],
      level: "bachelor"
    },
    {
      test: /\bb\.? ?sc\b|\bb\.s\.?(?![a-z])|^bs$|bachelor of science/i,
      spellings: ["B.Sc", "B.S.", "Bachelor of Science", "Bachelor of Science (B.S.)"],
      level: "bachelor"
    },
    {
      test: /\bb\.a\.?(?![a-z])|^ba$|bachelor of arts/i,
      spellings: ["B.A.", "Bachelor of Arts"],
      level: "bachelor"
    },
    {
      test: /\bb\.? ?com\b|bachelor of commerce/i,
      spellings: ["B.Com", "Bachelor of Commerce"],
      level: "bachelor"
    },
    {
      test: /\bassociate'?s?\b/i,
      spellings: ["Associate's Degree", "Associates", "Associate"],
      level: "associate"
    },
    // Status answers (Workday NVIDIA's list) — exact only. "Some post college"
    // before "Some college", and post-diploma before diploma.
    { test: /some post ?college/i, spellings: ["Some post college"], level: null },
    { test: /some college/i, spellings: ["Some college"], level: null },
    { test: /technical|other training/i, spellings: ["Technical/other training"], level: null },
    { test: /post[- ]?diploma/i, spellings: ["Post-diploma studies"], level: null },
    { test: /\bno degree\b|^none$/i, spellings: ["No Degree", "None"], level: null },
    {
      test: /\b(high school|secondary school|higher secondary|12th|hsc)\b/i,
      spellings: ["High School", "High School or equivalent", "High School Diploma", "Secondary School"],
      level: "high school"
    },
    // A university diploma is not a polytechnic one: each is offered only as itself.
    { test: /university diploma/i, spellings: ["University Diploma"], level: null },
    // Not widened: the only "diploma level" phrasing is "Diploma" itself, and
    // widening would read "University Diploma" as containing it.
    { test: /\bdiploma\b/i, spellings: ["Diploma"], level: null }
  ];
  function degreeEntry(text) {
    const t = String(text || "").trim();
    return t ? DEGREE_CATALOG.find((e) => e.test.test(t)) || null : null;
  }
  var compactDegree = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function degreeOption(stored, options) {
    const labels = (options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean);
    if (!labels.length) return null;
    const entry = degreeEntry(stored);
    if (!entry) {
      return bestCandidateMatch(uniq(degreeShapes(stored).concat([stored])), labels, degreeGuard) || iscedOption(stored, null, labels);
    }
    const byCompact = new Map(labels.map((l) => [compactDegree(l), l]));
    for (const s of [stored].concat(entry.spellings)) {
      const hit = byCompact.get(compactDegree(s));
      if (hit) return hit;
    }
    if (!entry.level) return null;
    return bestCandidateMatch(degreeShapes(entry.level), labels, degreeGuard) || iscedOption(stored, entry, labels);
  }
  var ISCED_BY_LEVEL = [8, 7, 6, 5, 3, null];
  var ISCED_RE = /\bISCED\s*(\d)(?:\s*[–-]\s*(\d))?/i;
  function iscedLevelOf(stored, entry) {
    const i = degreeLevel(entry && entry.level ? entry.level : stored);
    return i < 0 ? null : ISCED_BY_LEVEL[i];
  }
  function iscedCovers(option, n) {
    const m = ISCED_RE.exec(option);
    if (!m) return false;
    const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : lo;
    return n >= lo && n <= hi;
  }
  function iscedOption(stored, entry, labels) {
    const n = iscedLevelOf(stored, entry);
    if (n == null) return null;
    const same = labels.filter((l) => iscedCovers(l, n));
    if (same.length <= 1) return same[0] || null;
    const lead = (l) => l.split("(")[0];
    if (entry) {
      const own = same.filter((l) => entry.test.test(lead(l)));
      if (own.length === 1) return own[0];
    }
    const generic = same.filter((l) => {
      const e = degreeEntry(lead(l));
      return !e || e === entry;
    });
    return generic.length === 1 ? generic[0] : null;
  }
  function uniq(list) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const v of list) {
      const t = String(v == null ? "" : v).trim();
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out;
  }
  function bankValue(key, bank) {
    const b = bank || {};
    if (key === "phone_country_code") return splitPhone(String(b.phone || "")).dialCode || "";
    if (key === "how_did_you_hear_about_us") return HEARD_VIA;
    return b[key];
  }
  function candidatesFor(key, value, bank) {
    const b = bank || {};
    const text = String(value == null ? "" : value).trim();
    if (key === "phone_country_code") {
      const country2 = String(b.address_country || "").trim();
      return uniq([
        country2 ? `${text} (${country2})` : "",
        country2 ? `${country2} (${text})` : "",
        text,
        country2
      ]);
    }
    if (key === "degree") {
      const entry = degreeEntry(text);
      if (!entry) return uniq(degreeShapes(text).concat([text]));
      return uniq([text].concat(entry.spellings, entry.level ? degreeShapes(entry.level) : []));
    }
    if (key === "race_ethnicity") return uniq([text].concat(ethnicityShapes(text)));
    if (key === "how_did_you_hear_about_us") return [HEARD_VIA, HEARD_VIA_FALLBACK];
    if (EEO_GROUPS[key]) return uniq([text].concat(eeoShapes(key, text)));
    if (!LOCATION_KEYS.has(key)) return text ? [text] : [];
    const city = String(b.address_city || "").trim();
    const state2 = String(b.address_state || "").trim();
    const country = String(b.address_country || "").trim();
    const full = String(b.location || "").trim();
    if (key === "address_country") {
      const plus = splitPhone(String(b.phone || "")).dialCode;
      return uniq([text, plus, plus && country ? `${country} (${plus})` : ""]);
    }
    const cityStateCountry = city && state2 && country ? `${city}, ${state2}, ${country}` : "";
    const cityState = city && state2 ? `${city}, ${state2}` : "";
    if (key === "address_city") {
      return uniq([cityStateCountry, cityState, city && country ? `${city}, ${country}` : "", city, text]);
    }
    if (key === "address_state") {
      return uniq([cityStateCountry, state2 && country ? `${state2}, ${country}` : "", state2, text]);
    }
    return uniq([
      full,
      cityStateCountry,
      cityState,
      city,
      state2 && country ? `${state2}, ${country}` : "",
      state2,
      country,
      text
    ]);
  }
  var OTHER_OPTION_MARKERS = [
    "other",
    "none of the above",
    "not listed",
    "not applicable",
    "n/a",
    "outside",
    "elsewhere",
    "rest of world"
  ];
  function findOtherOption(options) {
    for (const opt of options || []) {
      const label = String(typeof opt === "string" ? opt : opt && opt.label || "").toLowerCase().trim();
      if (!label) continue;
      if (OTHER_OPTION_MARKERS.some((m) => label === m || label.startsWith(m + " ") || label.startsWith(m + ","))) {
        return typeof opt === "string" ? opt : opt.label;
      }
    }
    return null;
  }
  function bestCandidateMatch(candidates, options, guard) {
    if (!options || !options.length) return null;
    const labels = options.map((o) => typeof o === "string" ? o : o.label);
    for (const candidate of candidates || []) {
      const allowed = guard ? labels.filter((l) => guard(candidate, l)) : labels;
      if (!allowed.length) continue;
      const hit = bestOptionMatch(candidate, allowed);
      if (hit == null) continue;
      const label = typeof hit === "string" ? hit : hit.label;
      if (sharesWord(candidate, label)) return label;
    }
    return null;
  }
  function sharesWord(a, b) {
    const wordsOf = (t) => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
    const left = wordsOf(a);
    for (const w of wordsOf(b)) if (left.has(w)) return true;
    return false;
  }
  function coerce(value, row) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return null;
    if (row.kind === "checkbox" || row.kind === "radio" || row.kind === "choice") {
      return coerceChoice(text, row);
    }
    if (row.kind === "date-parts") {
      return formatDateForField(text, { type: "date" }) || null;
    }
    if (row.kind === "select" || row.kind === "combobox") {
      const options = (row.options || []).map((o) => typeof o === "string" ? o : o.label);
      if (!options.length) {
        return LOCATION_KEYS.has(row.candidateKey) && row.candidates && row.candidates.length ? row.candidates[0] : text;
      }
      return pickFromOptions(text, row, options);
    }
    const hints = row.hints || {};
    if (hints.type === "date" || hints.type === "month" || looksLikeDateField(row)) {
      const shaped = formatDateForField(text, hints);
      return shaped || null;
    }
    if (hints.type === "tel" || /phone|mobile|contact number/i.test(row.label || "")) {
      return shapePhone(text, row);
    }
    if (hints.type === "number") {
      const numeric = text.replace(/[^\d.]/g, "");
      return numeric || null;
    }
    if (hints.maxLength && text.length > hints.maxLength) {
      return text.length > PROSE_LENGTH ? null : text.slice(0, hints.maxLength);
    }
    return text;
  }
  function declineFallback(text, options) {
    if (!looksLikeDecline(text)) return null;
    const found = findDeclineOption(options);
    return found == null ? null : typeof found === "string" ? found : found.label;
  }
  function looksLikeDateField(row) {
    const hint = `${row.hints && row.hints.placeholder || ""} ${row.label || ""}`;
    return /\b(date|dd\s*\/\s*mm|mm\s*\/\s*dd|yyyy)\b/i.test(hint);
  }
  function pickFromOptions(text, row, options) {
    if (row.candidateKey === "citizenship_status") {
      return row.country && countryOption(row.country, options) || citizenshipOption(text, options);
    }
    if (row.candidateKey === "degree") return degreeOption(text, options);
    if (row.candidateKey === "previous_employer") return previousEmployerOption(text, options);
    const country = countryOf(text);
    if (country && countryShare(options) >= 0.5) return countryOption(country, options);
    if (row.candidateKey === "authorized_to_work_in_country" && !options.some((o) => YES_RE.test(o.trim()) || NO_RE.test(o.trim()))) {
      return workAuthStatement(text, row.sponsorship, options);
    }
    const candidates = row.candidates && row.candidates.length ? row.candidates : [text];
    const guard = row.candidateKey === "degree" ? degreeGuard : row.candidateKey === "race_ethnicity" ? ethnicityGuardFor(candidates[0]) : EEO_GROUPS[row.candidateKey] ? eeoGuardFor(row.candidateKey, candidates[0]) : null;
    const bare = READ_FIRST_KEYS.has(row.candidateKey) ? options.map(stripRegionSuffix) : options;
    const match = bestCandidateMatch(candidates, bare, guard);
    if (match != null) return options[bare.indexOf(match)];
    return declineFallback(text, options);
  }
  function guardedKey(key) {
    return key === "race_ethnicity" || key === "citizenship_status" || key === "hispanic_latino" || !!EEO_GROUPS[key];
  }
  function coerceChoice(text, row) {
    const options = (row.options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean);
    const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(text);
    if (!options.length || options.length === 1 && row.kind === "checkbox") {
      return truthy ? "yes" : null;
    }
    if (row.candidateKey) {
      const picked = pickFromOptions(text, row, options);
      if (picked != null || guardedKey(row.candidateKey)) return picked;
    }
    const match = bestOptionMatch(text, options);
    if (match) return typeof match === "string" ? match : match.label;
    const polarity = truthy ? /\b(yes|i am|i do|i have)\b/i : /\b(no|not|n['’]t)\b/i;
    const found = options.find((o) => polarity.test(o));
    return found || null;
  }
  function shapePhone(text, row) {
    const parts = splitPhone(text);
    return row.hasCountryWidget ? parts.national || text : parts.e164 || text;
  }
  function fieldsForServer(decisions) {
    const out = [];
    decisions.forEach((d, i) => {
      if (d.action !== ASK && !d.askable && !d.knownEmpty) return;
      if (d.sensitive || d.slot || d.noServer) return;
      if (isNeverFill(d.label)) return;
      if (classifySensitive(d.label, d.employer)) return;
      out.push({
        i,
        label: d.label,
        kind: d.kind,
        required: !!d.required,
        sensitive: false,
        // A field we can name but have no value for: recall a saved answer, but
        // never let the model compose one. Enforced on the server as well.
        recallOnly: !!d.knownEmpty,
        compose: !!d.compose,
        documentSlot: null,
        options: (d.options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean).slice(0, 300)
      });
    });
    return out;
  }
  function summarize(decisions) {
    const counts = { fill: 0, suggest: 0, ask: 0, profile: 0, document: 0, skip: 0 };
    for (const d of decisions || []) counts[d.action] = (counts[d.action] || 0) + 1;
    return counts;
  }

  // src/autofill/write.js
  var probe2 = () => globalThis.__tcvFieldProbe;
  function fire(el, type, init) {
    try {
      el.dispatchEvent(new globalThis.Event(type, Object.assign({ bubbles: true }, init || {})));
    } catch (e) {
    }
  }
  function fireKey(el, type, key) {
    try {
      el.dispatchEvent(new globalThis.KeyboardEvent(type, {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
        keyCode: KEY_CODES[key] || 0,
        which: KEY_CODES[key] || 0
      }));
    } catch (e) {
    }
  }
  var KEY_CODES = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, Backspace: 8 };
  function pressPointer(el) {
    const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        const Ctor = type.startsWith("pointer") && globalThis.PointerEvent ? globalThis.PointerEvent : globalThis.MouseEvent;
        el.dispatchEvent(new Ctor(type, opts));
      } catch (e) {
        if (type === "click") {
          try {
            el.click();
          } catch (_) {
          }
        }
      }
    }
  }
  function focus(el) {
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      try {
        el.focus();
      } catch (_) {
      }
    }
  }
  function blur(el) {
    try {
      el.blur();
    } catch (e) {
    }
  }
  function nativeSetter(el) {
    const win = el.ownerDocument && el.ownerDocument.defaultView || globalThis;
    const protoFor = () => {
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "textarea") return win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype;
      if (tag === "select") return win.HTMLSelectElement && win.HTMLSelectElement.prototype;
      return win.HTMLInputElement && win.HTMLInputElement.prototype;
    };
    const proto = protoFor();
    if (!proto) return null;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    return desc && desc.set ? desc.set : null;
  }
  function writeValue(el, value) {
    const setter = nativeSetter(el);
    if (setter) {
      try {
        setter.call(el, value);
        return true;
      } catch (e) {
      }
    }
    try {
      el.value = value;
      return true;
    } catch (e) {
      return false;
    }
  }
  function setText(el, value, opts) {
    if (!el) return false;
    const wantBlur = !opts || opts.blur !== false;
    focus(el);
    if (String(el.value || "") !== "") {
      writeValue(el, "");
      fire(el, "input");
    }
    const ok = writeValue(el, value);
    fire(el, "input");
    fire(el, "change");
    if (wantBlur) blur(el);
    return ok;
  }
  async function typeText(el, value, delay) {
    if (!el) return false;
    focus(el);
    writeValue(el, "");
    fire(el, "input");
    const text = String(value || "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      fireKey(el, "keydown", ch);
      writeValue(el, text.slice(0, i + 1));
      try {
        el.dispatchEvent(new globalThis.InputEvent("input", {
          bubbles: true,
          data: ch,
          inputType: "insertText"
        }));
      } catch (e) {
        fire(el, "input");
      }
      fireKey(el, "keyup", ch);
      if (delay) await sleep(delay);
    }
    return true;
  }
  function setContentEditable(el, value) {
    if (!el) return false;
    focus(el);
    let ok = false;
    try {
      const doc = el.ownerDocument;
      const sel = doc.defaultView.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      ok = doc.execCommand("insertText", false, String(value));
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      try {
        el.textContent = String(value);
        ok = true;
      } catch (e) {
        ok = false;
      }
      fire(el, "input");
    }
    fire(el, "change");
    blur(el);
    return ok;
  }
  function setSelect(el, value) {
    if (!el || !el.options) return false;
    const options = Array.prototype.slice.call(el.options).map((o) => ({
      value: o.value,
      label: (o.textContent || "").replace(/\s+/g, " ").trim(),
      node: o
    }));
    const match = bestOptionMatch(value, options);
    if (!match) return false;
    focus(el);
    if (el.multiple) {
      match.node.selected = true;
    } else {
      if (!writeValue(el, match.value)) return false;
      try {
        el.selectedIndex = match.node.index;
      } catch (e) {
      }
    }
    fire(el, "input");
    fire(el, "change");
    blur(el);
    return true;
  }
  function setChoice(row, value) {
    const buttons = (row.members || []).filter((el) => el && el.isConnected);
    const labels = buttons.map((b) => (b.textContent || "").replace(/\s+/g, " ").trim());
    const match = bestOptionMatch(value, labels);
    const target = match != null ? buttons[labels.indexOf(match)] : null;
    if (!target) return false;
    if (isChoiceSelected(target)) return true;
    scrollIntoView(target);
    focus(target);
    pressPointer(target);
    return isChoiceSelected(target);
  }
  function setCheckable(row, value) {
    const members = (row.members || []).filter((el) => el && el.isConnected);
    if (!members.length) return false;
    const p = probe2();
    let target = null;
    if (members.length === 1 && row.kind === "checkbox") {
      const plain = (s) => String(s || "").replace(/\*+\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
      const own = [row.optionLabel, row.label, p && p.labelFor(members[0])].map(plain).filter(Boolean);
      const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(String(value)) || own.includes(plain(value));
      if (!truthy) return false;
      target = members[0];
    } else {
      const labelled = members.map((el) => ({
        el,
        label: p && p.labelFor(el) || el.value || ""
      }));
      const match = bestOptionMatch(value, labelled.map((x) => x.label));
      if (match) {
        const found = labelled.find((x) => x.label === match);
        target = found && found.el;
      }
      if (!target) {
        const byValue = members.find((el) => commitMatches(value, el.value || ""));
        target = byValue || null;
      }
    }
    if (!target) return false;
    if (target.checked) return true;
    scrollIntoView(target);
    focus(target);
    pressPointer(target);
    if (!target.checked) {
      try {
        target.checked = true;
      } catch (e) {
        return false;
      }
      fire(target, "input");
      fire(target, "change");
    }
    return !!target.checked;
  }
  function dedupe(list) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const v of list) {
      const t = String(v == null ? "" : v).trim();
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out;
  }
  function searchToken(value) {
    const text = String(value == null ? "" : value).trim();
    const head = text.split(",")[0].trim();
    return head.length >= 2 ? head : text;
  }
  async function commitCombobox(row, value, candidates, readFirst, drill) {
    const el = row.el;
    if (!el) return false;
    const shapes = dedupe([value].concat(candidates || []));
    const current = row.value || "";
    if (current && looksLikeDecline(value) && !looksLikeDecline(current)) return true;
    const isButton = (el.tagName || "").toLowerCase() === "button";
    try {
      scrollIntoView(el);
      dismissListbox(el);
      openWidget(row);
      await sleep(TIMING.settleMs);
      let options = [];
      if (readFirst && !isButton) options = await waitForOpenedList(el);
      if (options.length) {
      } else if (isButton) {
        options = await waitForOpenedList(el);
      } else {
        const input = typableInput(row) || el;
        const queries = dedupe(shapes.map(searchToken)).slice(0, 4);
        row.searchTrace = [];
        const p = probe2();
        const wdPrompt = !!(p && p.workdayMultiselect && p.workdayMultiselect(input));
        for (const query of queries) {
          setText(input, query, { blur: false });
          focus(input);
          if (wdPrompt) {
            fireKey(input, "keydown", "Enter");
            fireKey(input, "keyup", "Enter");
            const isSet = () => shapes.some((s) => committed(row, s));
            options = await waitForPromptResults(el, shapes, isSet);
            row.searchTrace.push(Object.assign(searchStep(query, input, el, options), { searchedWithEnter: true }));
            if (isSet()) return true;
            if (options.length && listOffersAny(shapes, options)) break;
            continue;
          }
          options = await waitForOptions2(el, TIMING.optionWaitMs);
          options = await waitOutLoading(el, shapes, options);
          if (!options.length && listStillLoading(el.ownerDocument || globalThis.document, el)) {
            row.searchTrace.push(Object.assign(searchStep(query, input, el, options), { stillLoading: true }));
            break;
          }
          if (!options.length || !listOffersAny(shapes, options)) {
            await typeText(input, query, 8);
            options = await waitForMatchingOptions(el, shapes, TIMING.optionWaitMs * 2);
            options = await waitOutLoading(el, shapes, options);
          }
          if (!options.length) {
            fireKey(input, "keydown", "Enter");
            fireKey(input, "keyup", "Enter");
            options = await waitForOptions2(el, TIMING.optionWaitMs);
          }
          row.searchTrace.push(searchStep(query, input, el, options));
          if (options.length && listOffersAny(shapes, options)) break;
        }
      }
      if (readFirst) {
        const labels = options.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
        const pick = pickReadFirst(readFirst, labels);
        if (!pick) {
          reportDropdownFailure(row, value, options);
          return false;
        }
        const node = options[labels.indexOf(pick)];
        try {
          node.scrollIntoView({ block: "nearest" });
        } catch (e) {
        }
        pressPointer(node);
        return settlesTo(row, [pick].concat(shapes));
      }
      for (const shape of options.length ? shapes : []) {
        const before = options.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
        if (!await clickMatchingOption(el, shape, options)) continue;
        if (drill && isWorkdayPrompt(el)) {
          const drilled = await drillDown(row, el, shapes, drill, before);
          if (drilled !== null) return drilled;
        }
        if (await settlesTo(row, shapes)) return true;
        break;
      }
      if (!isButton && highlightedMatches(el, shapes)) {
        const input = typableInput(row) || el;
        fireKey(input, "keydown", "Enter");
        fireKey(input, "keyup", "Enter");
        await sleep(TIMING.settleMs);
        if (committed(row, value)) return true;
      }
      reportDropdownFailure(row, value, options);
      return false;
    } catch (e) {
      return false;
    } finally {
      dismissListbox(row.el);
    }
  }
  function searchStep(query, input, el, options) {
    const doc = el.ownerDocument || globalThis.document;
    let cells = 0;
    try {
      cells = doc.querySelectorAll('[role="gridcell"], [role="option"]').length;
    } catch (e) {
      cells = -1;
    }
    return {
      typed: query,
      boxNowHolds: input ? String(input.value || "") : "",
      stillOnPage: !!el.isConnected,
      listOpen: el.getAttribute ? el.getAttribute("aria-expanded") : null,
      optionsMatched: (options || []).length,
      rowsOnPage: cells,
      rowsSkipped: (options || []).length ? void 0 : rowsRejected(doc),
      firstOffered: (options || []).slice(0, 5).map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
    };
  }
  function reportDropdownFailure(row, value, options) {
    try {
      row.seenOptions = (options || []).map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 200);
    } catch (e) {
    }
    try {
      const after = reprobe(row);
      const el = row.el;
      console.groupCollapsed(
        `%c[TailorCV] dropdown did not commit: ${row.label}`,
        "color:#b91c1c;font-weight:700"
      );
      console.log("wanted  :", value);
      console.log("control :", el && el.outerHTML ? el.outerHTML.slice(0, 400) : el);
      console.log("options seen:", (options || []).map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 30));
      console.log(
        "option markup (first):",
        options && options[0] && options[0].outerHTML ? options[0].outerHTML.slice(0, 400) : "(none)"
      );
      console.log("field now reads:", after);
      console.log("report: " + JSON.stringify({
        field: row.label,
        stillOnPage: !!(el && el.isConnected),
        boxHolds: el ? String(el.value || "") : "",
        steps: row.searchTrace || [],
        fieldNow: after ? { filled: after.filled, value: after.value, invalid: after.invalid } : null
      }));
      console.groupEnd();
    } catch (e) {
    }
  }
  function openWidget(row) {
    const p = probe2();
    const el = row.el;
    const role = el.getAttribute && el.getAttribute("role");
    const isButton = (el.tagName || "").toLowerCase() === "button";
    let target = el;
    const wrap = p && p.rsContainer(el) || el.parentElement;
    if (role !== "combobox" && !isButton) {
      if (wrap) {
        let ctl = null;
        try {
          ctl = wrap.querySelector('[role="combobox"], [role="button"], [class*="control"], [class*="toggle"]');
        } catch (e) {
          ctl = null;
        }
        target = ctl || el;
      }
    } else if (role === "combobox" && wrap) {
      const ctl = controlAncestor(el);
      if (ctl && ctl.contains(el) && (!wrap || wrap.contains(ctl) || ctl.contains(wrap))) target = ctl;
    }
    focus(target);
    pressPointer(target);
    if (target !== el) focus(el);
  }
  function typableInput(row) {
    const el = row.el;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return el;
    const p = probe2();
    const wrap = p && p.rsContainer(el) || el.parentElement;
    if (!wrap) return null;
    try {
      return wrap.querySelector('input:not([type="hidden"]), textarea');
    } catch (e) {
      return null;
    }
  }
  function visibleOptionNodes2(doc, el) {
    const p = probe2();
    const nodes = p && p.optionNodes ? p.optionNodes(doc) : [];
    const onScreen = isWorkdayPrompt(el) ? isNodeDrawn : isNodeVisible;
    const shown = nodes.filter((n) => (n.textContent || "").trim() && onScreen(n) && !isChosenValue(n) && !(n.getAttribute && n.getAttribute("aria-disabled") === "true"));
    return el ? ownOptions(doc, el, shown) : shown;
  }
  function isWorkdayPrompt(el) {
    if (!el) return false;
    const p = probe2();
    try {
      if (p && p.workdayMultiselect && p.workdayMultiselect(el)) return true;
      return !!(el.querySelector && el.querySelector('[data-automation-id="multiselectInputContainer"]'));
    } catch (e) {
      return false;
    }
  }
  function rowsRejected(doc) {
    const p = probe2();
    const nodes = p && p.optionNodes ? p.optionNodes(doc) : [];
    const counts = {};
    for (const n of nodes) {
      const why = !(n.textContent || "").trim() ? "empty" : isChosenValue(n) ? "chosen" : n.getAttribute && n.getAttribute("aria-disabled") === "true" ? "disabled" : hiddenReason(n) || "taken-or-not-own";
      counts[why] = (counts[why] || 0) + 1;
    }
    return counts;
  }
  function ownOptions(doc, el, nodes) {
    const ref = (n) => n && n.getAttribute && (n.getAttribute("aria-controls") || n.getAttribute("aria-owns")) || "";
    let mine = null;
    for (let n = el, i = 0; n && i < 4 && !mine; n = n.parentElement, i++) {
      const id = ref(n).split(/\s+/)[0];
      if (id) {
        try {
          mine = doc.getElementById(id);
        } catch (e) {
          mine = null;
        }
      }
    }
    if (mine) {
      const inMine = nodes.filter((n) => mine.contains(n));
      if (inMine.length) return inMine;
    }
    return nodes.filter((n) => {
      const lb = n.closest && n.closest('[role="listbox"]');
      if (!lb || !lb.id) return true;
      let owner = null;
      try {
        owner = doc.querySelector(`[aria-controls~="${lb.id}"], [aria-owns~="${lb.id}"]`);
      } catch (e) {
        owner = null;
      }
      return !owner || owner === el || owner.contains(el) || el.contains(owner);
    });
  }
  async function waitForOpenedList(el) {
    const nodes = await waitForOptions2(el, TIMING.optionWaitMs);
    if (nodes.length || !isExpanded(el)) return nodes;
    return waitForOptions2(el, TIMING.remoteSearchMs);
  }
  function isExpanded(el) {
    for (let n = el, i = 0; n && i < 3; n = n.parentElement, i++) {
      if (n.getAttribute && n.getAttribute("aria-expanded") === "true") return true;
    }
    return false;
  }
  function waitForOptions2(el, timeout) {
    return new Promise((resolve) => {
      const doc = el.ownerDocument || globalThis.document;
      const immediate = visibleOptionNodes2(doc, el);
      if (immediate.length) {
        resolve(immediate);
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          obs.disconnect();
        } catch (e) {
        }
        clearTimeout(timer);
        resolve(visibleOptionNodes2(doc, el));
      };
      const obs = new globalThis.MutationObserver(() => {
        if (visibleOptionNodes2(doc, el).length) finish();
      });
      try {
        obs.observe(doc.body, { childList: true, subtree: true });
      } catch (e) {
      }
      const timer = setTimeout(finish, timeout);
    });
  }
  async function waitOutLoading(el, shapes, options) {
    const doc = el.ownerDocument || globalThis.document;
    const deadline = Date.now() + TIMING.remoteSearchMs;
    let nodes = options || [];
    while ((!nodes.length || !listOffersAny(shapes, nodes)) && listStillLoading(doc, el) && Date.now() < deadline) {
      await sleep(100);
      nodes = visibleOptionNodes2(doc, el);
    }
    return nodes.length ? nodes : visibleOptionNodes2(doc, el);
  }
  var LOADING_TEXT_RE = /^\s*(loading|searching)\b[.…\s]*$/i;
  function listStillLoading(doc, el) {
    let id = "";
    for (let n = el, i = 0; n && i < 4 && !id; n = n.parentElement, i++) {
      id = (n.getAttribute && (n.getAttribute("aria-controls") || n.getAttribute("aria-owns")) || "").split(/\s+/)[0];
    }
    if (!id) return false;
    let list = null;
    try {
      list = doc.getElementById(id);
    } catch (e) {
      list = null;
    }
    if (!list) return false;
    try {
      if (list.matches('[aria-busy="true"], [data-loading]') || list.querySelector('[aria-busy="true"], [data-loading], [role="progressbar"]')) return true;
    } catch (e) {
      return false;
    }
    return LOADING_TEXT_RE.test(list.textContent || "");
  }
  async function waitForMatchingOptions(el, shapes, timeout) {
    const doc = el.ownerDocument || globalThis.document;
    const deadline = Date.now() + timeout;
    let nodes = [];
    for (; ; ) {
      nodes = visibleOptionNodes2(doc, el);
      if (nodes.length && listOffersAny(shapes, nodes)) return nodes;
      if (Date.now() >= deadline) return nodes;
      await sleep(100);
    }
  }
  function highlightedMatches(el, shapes) {
    const doc = el.ownerDocument || globalThis.document;
    let hl = null;
    const active = el.getAttribute && el.getAttribute("aria-activedescendant") || "";
    if (active) {
      try {
        hl = doc.getElementById(active);
      } catch (e) {
        hl = null;
      }
    }
    if (!hl) {
      hl = visibleOptionNodes2(doc, el).find((n) => n.getAttribute("aria-selected") === "true" || /(^|[\s_-])(focused|highlighted|active|hover)($|[\s_-])/i.test(String(n.className || "")));
    }
    if (!hl) return false;
    const text = (hl.textContent || "").replace(/\s+/g, " ").trim();
    return shapes.some((sh) => commitMatches(sh, text));
  }
  function listOffersAny(shapes, nodes) {
    const labels = nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
    return shapes.some((sh) => labels.some((t) => commitMatches(sh, t)) || bestOptionMatch(sh, labels) != null);
  }
  async function clickMatchingOption(el, value, nodes) {
    const labels = nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
    const want = normalizeOptionText(value);
    let idx = want ? labels.findIndex((t) => normalizeOptionText(t) === want) : -1;
    const country = countryOf(value);
    if (idx < 0 && country && countryShare(labels) >= 0.5) {
      const pick = countryOption(country, labels);
      idx = pick == null ? -1 : labels.indexOf(pick);
      if (idx < 0) return false;
    }
    if (idx < 0) idx = labels.findIndex((t) => commitMatches(value, t));
    if (idx < 0) {
      const best = bestOptionMatch(value, labels);
      idx = best == null ? -1 : labels.indexOf(best);
    }
    if (idx < 0) return false;
    const node = nodes[idx];
    let target = node;
    const WD_ROW = '[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]';
    let workdayRow = false;
    try {
      workdayRow = node.matches(WD_ROW) || !!node.querySelector(WD_ROW);
    } catch (e) {
      workdayRow = false;
    }
    if (workdayRow) {
      for (const d of node.querySelectorAll("*")) {
        if ((d.textContent || "").replace(/\s+/g, " ").trim() === labels[idx]) target = d;
      }
    }
    try {
      target.scrollIntoView({ block: "nearest" });
    } catch (e) {
    }
    pressPointer(target);
    return true;
  }
  async function waitForPromptResults(el, shapes, done2) {
    const doc = el.ownerDocument || globalThis.document;
    const start = Date.now();
    const deadline = start + Math.max(TIMING.remoteSearchMs, TIMING.optionWaitMs * 2);
    const offers = (nodes) => {
      const labels = nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
      return shapes.some((s) => promptResultFor(s, labels) >= 0);
    };
    for (; ; ) {
      if (done2 && done2()) return [];
      const nodes = visibleOptionNodes2(doc, el);
      if (nodes.length && offers(nodes)) return nodes;
      if (Date.now() - start > 1500 && saysNoItems(doc)) return nodes;
      if (Date.now() >= deadline) return nodes;
      await sleep(100);
    }
  }
  function saysNoItems(doc) {
    const roots = Array.from(doc.querySelectorAll('[data-automation-id="activeListContainer"], [role="listbox"]'));
    return roots.some((root) => {
      const walker = doc.createTreeWalker(
        root,
        4
        /* NodeFilter.SHOW_TEXT */
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (/^\s*no (items|results|matches)( found)?\.?\s*$/i.test(n.nodeValue || "") && isNodeVisible(n.parentElement)) return true;
      }
      return false;
    });
  }
  function promptPills(row) {
    const p = probe2();
    const box = p && p.workdayMultiselect && p.workdayMultiselect(typableInput(row) || row.el);
    if (!box) return [];
    return Array.from(box.querySelectorAll('[data-automation-id="selectedItem"]')).map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  function promptResultFor(want, labels) {
    const exact = normalizeOptionText(want);
    let idx = labels.findIndex((t) => normalizeOptionText(t) === exact);
    if (idx < 0) idx = labels.findIndex((t) => commitMatches(want, t));
    return idx;
  }
  async function commitPromptMulti(row, values) {
    const el = row.el;
    const input = typableInput(row) || el;
    const out = { added: [], already: [], missing: [], pills: [] };
    const shown = () => promptPills(row);
    const has = (pills, skill) => pills.some((t) => promptResultFor(skill, [t]) === 0);
    const writeSearch = (text) => {
      focus(input);
      writeValue(input, text);
      fire(input, "input");
    };
    const pillWaitMs = Math.max(TIMING.commitWaitMs * 2, 300);
    const addOne = async (skill) => {
      writeSearch(skill);
      fireKey(input, "keydown", "Enter");
      fireKey(input, "keyup", "Enter");
      const options = await waitForPromptResults(el, [skill]);
      const labels = options.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
      const idx = promptResultFor(skill, labels);
      if (idx < 0) return "missing";
      const label = labels[idx];
      if (shown().includes(label)) return "already";
      await sleep(Math.max(TIMING.settleMs, 150));
      const rowNow = () => visibleOptionNodes2(el.ownerDocument || globalThis.document, el).find((n) => (n.textContent || "").replace(/\s+/g, " ").trim() === label) || null;
      const press2 = (node2) => {
        let target = node2;
        for (const d of node2.querySelectorAll("*")) {
          if ((d.textContent || "").replace(/\s+/g, " ").trim() === label) target = d;
        }
        try {
          target.scrollIntoView({ block: "nearest" });
        } catch (e) {
        }
        pressPointer(target);
      };
      const ticked = (node2) => !!node2 && (node2.getAttribute("aria-selected") === "true" || node2.getAttribute("aria-checked") === "true" || !!node2.querySelector('input:checked, [aria-checked="true"]'));
      let node = rowNow() || options[idx];
      press2(node);
      const deadline = Date.now() + pillWaitMs;
      let retried = false;
      while (!has(shown(), skill) && Date.now() < deadline) {
        await sleep(100);
        if (!retried && Date.now() > deadline - pillWaitMs / 2) {
          retried = true;
          const again = rowNow();
          if (again && !ticked(again) && !has(shown(), skill)) {
            node = again;
            press2(again);
          }
        }
      }
      if (has(shown(), skill)) return "added";
      try {
        console.info(`[TailorCV] skills: clicked "${label}" but no pill appeared \u2014 row was ${node && node.isConnected ? "on the page" : "gone"}: ` + String(node && node.outerHTML || "").slice(0, 400));
      } catch (e) {
      }
      return "missing";
    };
    try {
      scrollIntoView(input);
      openWidget(row);
      await sleep(TIMING.settleMs);
      for (const skill of values) {
        if (has(shown(), skill)) {
          out.already.push(skill);
          continue;
        }
        out[await addOne(skill)].push(skill);
      }
      const lost = out.added.concat(out.already).filter((s) => !has(shown(), s));
      for (const skill of lost) {
        console.info(`[TailorCV] skills: "${skill}" disappeared \u2014 adding it again`);
        if (await addOne(skill) !== "added") {
          for (const list of [out.added, out.already]) {
            const i = list.indexOf(skill);
            if (i >= 0) list.splice(i, 1);
          }
          out.missing.push(skill);
        }
      }
    } catch (e) {
    } finally {
      try {
        writeSearch("");
      } catch (e) {
      }
      dismissListbox(el);
    }
    out.pills = shown();
    console.info(`[TailorCV] skills: added ${out.added.length}, already there ${out.already.length}` + (out.missing.length ? `, not offered: ${out.missing.join(", ")}` : ""));
    return out;
  }
  async function drillDown(row, el, shapes, drill, before) {
    const doc = el.ownerDocument || globalThis.document;
    const isSet = () => shapes.some((s) => committed(row, s));
    const was = new Set(before);
    const deadline = Date.now() + Math.max(TIMING.commitWaitMs, 300);
    let level = [];
    for (; ; ) {
      if (isSet()) return true;
      const nodes = visibleOptionNodes2(doc, el);
      const labels = nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
      if (labels.length && labels.some((l) => !was.has(l))) {
        const pick = citizenshipOption(drill, labels);
        if (pick) {
          await sleep(Math.max(TIMING.settleMs, 100));
          const fresh = visibleOptionNodes2(doc, el);
          const node = fresh.find((n) => (n.textContent || "").replace(/\s+/g, " ").trim() === pick) || nodes[labels.indexOf(pick)];
          let target = node;
          for (const d of node.querySelectorAll("*")) {
            if ((d.textContent || "").replace(/\s+/g, " ").trim() === pick) target = d;
          }
          try {
            target.scrollIntoView({ block: "nearest" });
          } catch (e) {
          }
          pressPointer(target);
          if (await settlesTo(row, shapes.concat([pick]))) return true;
          console.info(
            "[TailorCV] dropdown did not commit after choosing",
            JSON.stringify(pick),
            "in the level that opened:",
            labels.slice(0, 10)
          );
          return false;
        }
        level = labels;
      }
      if (Date.now() >= deadline) break;
      await sleep(100);
    }
    if (level.length) {
      console.info("[TailorCV] a level opened with no", JSON.stringify(drill), "row:", level.slice(0, 10));
      return false;
    }
    return null;
  }
  async function commitHierarchyPick(row, leaf, parents, fallback) {
    const deadline = Date.now() + TIMING.remoteSearchMs + Math.max(TIMING.commitWaitMs * 2, 1e3);
    const first = await pickInHierarchy(row, leaf, parents, deadline);
    if (first.ok) return true;
    if (!fallback || !first.sawRows || Date.now() >= deadline) return false;
    return (await pickInHierarchy(row, fallback, [], deadline)).ok;
  }
  async function pickInHierarchy(row, leaf, parents, deadline) {
    const el = row.el;
    const doc = el.ownerDocument || globalThis.document;
    const input = typableInput(row) || el;
    const listWaitMs = Math.max(TIMING.optionWaitMs * 2, 1e3);
    const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
    const want = normalizeOptionText(leaf);
    const rowsNow = () => visibleOptionNodes2(doc, el);
    const leafRow = () => rowsNow().find((n) => normalizeOptionText(text(n)) === want) || null;
    const isSet = () => committed(row, leaf);
    const press2 = (node) => {
      let target = node;
      for (const d of node.querySelectorAll("*")) if (text(d) === text(node)) target = d;
      try {
        target.scrollIntoView({ block: "nearest" });
      } catch (e) {
      }
      pressPointer(target);
    };
    const takeLeaf = async () => {
      if (!leafRow()) return false;
      await sleep(Math.max(TIMING.settleMs, 100));
      const node = leafRow();
      if (!node) return false;
      press2(node);
      return settlesTo(row, [leaf]);
    };
    let sawRows = false;
    const waitRows = async (test) => {
      const until = Math.min(deadline, Date.now() + listWaitMs);
      for (; ; ) {
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
    const NAV_SEL = '[class*="chevron" i], [class*="caret-right" i], [class*="arrow-right" i], [aria-haspopup="true"], [aria-expanded]';
    const opensList = (node) => {
      try {
        return node.matches(NAV_SEL) || !!node.querySelector(NAV_SEL);
      } catch (e) {
        return false;
      }
    };
    const reopen = async () => {
      dismissListbox(el);
      await sleep(TIMING.settleMs);
      openWidget(row);
      return waitRows((nodes) => parents.some((p) => nodes.some((n) => isParent(text(n), p))));
    };
    let seen = [];
    try {
      scrollIntoView(el);
      dismissListbox(el);
      openWidget(row);
      await sleep(TIMING.settleMs);
      focus(input);
      writeValue(input, leaf);
      fire(input, "input");
      fireKey(input, "keydown", "Enter");
      fireKey(input, "keyup", "Enter");
      await waitForPromptResults(el, [leaf], isSet);
      if (rowsNow().length) sawRows = true;
      if (isSet()) return { ok: true, sawRows: true };
      if (await takeLeaf()) return { ok: true, sawRows: true };
      focus(input);
      writeValue(input, "");
      fire(input, "input");
      let top = await reopen();
      if (await takeLeaf()) return { ok: true, sawRows: true };
      for (const parent of parents) {
        if (Date.now() >= deadline) break;
        seen = top.map(text);
        const cat = top.find((n) => isParent(text(n), parent) && opensList(n));
        if (!cat) continue;
        const before = new Set(seen);
        press2(cat);
        await waitRows((nodes) => nodes.some((n) => !before.has(text(n))));
        if (isSet()) return { ok: true, sawRows: true };
        if (await takeLeaf()) return { ok: true, sawRows: true };
        top = await reopen();
      }
      console.info(
        "[TailorCV] no",
        JSON.stringify(leaf),
        "in this list \u2014 rows seen:",
        seen.slice(0, 15),
        "| first row:",
        (top[0] && top[0].outerHTML || "").slice(0, 300)
      );
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
      kind: "combobox",
      options: labels,
      candidates: candidatesFor(readFirst.key, readFirst.stored, {}),
      candidateKey: readFirst.key,
      sponsorship: readFirst.sponsorship,
      country: readFirst.country
    });
    return pick != null && labels.includes(pick) ? pick : null;
  }
  function committed(row, value) {
    const after = reprobe(row);
    if (!after) return false;
    if (after.invalid) return false;
    if (!after.filled) return false;
    if (differentCountries(value, after.value)) return false;
    return commitMatches(value, after.value);
  }
  function differentCountries(value, shown) {
    const a = countryOf(value), b = countryOf(shown);
    return !!(a && b && a !== b);
  }
  async function settlesTo(row, shapes, ms) {
    const deadline = Date.now() + (ms == null ? TIMING.commitWaitMs : ms);
    for (; ; ) {
      if ((shapes || []).some((sh) => committed(row, sh))) return true;
      if (Date.now() >= deadline) return false;
      await sleep(Math.max(TIMING.settleMs, 100));
    }
  }
  function attachFile(input, file) {
    if (!input || !file) return false;
    try {
      const dt = new globalThis.DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      const set = !!(input.files && input.files.length > 0);
      fire(input, "input");
      fire(input, "change");
      return set;
    } catch (e) {
      return false;
    }
  }
  function dropFile(zone, file) {
    if (!zone || !file) return false;
    try {
      const dt = new globalThis.DataTransfer();
      dt.items.add(file);
      for (const type of ["dragenter", "dragover", "drop"]) {
        const ev = new globalThis.DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt
        });
        zone.dispatchEvent(ev);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  function findDropZone(input) {
    if (!input) return null;
    let n = input.parentElement, depth = 0;
    while (n && depth < 5) {
      const cls = n.className && String(n.className) || "";
      if (/dropzone|drop-zone|filepond|uppy|drag/i.test(cls)) return n;
      const auto = n.getAttribute && n.getAttribute("data-automation-id") || "";
      if (/drop-?zone/i.test(auto)) return n;
      if (n.hasAttribute && (n.hasAttribute("data-uppy") || n.hasAttribute("data-filepond"))) return n;
      n = n.parentElement;
      depth++;
    }
    return null;
  }
  var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var B64_LOOKUP = (() => {
    const table = new Uint8Array(256).fill(255);
    for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
    table["=".charCodeAt(0)] = 0;
    return table;
  })();
  function base64ToBytes(base64) {
    const src = String(base64 || "").replace(/[\s]/g, "");
    const clean2 = src.replace(/[^A-Za-z0-9+/=]/g, "");
    const padding = clean2.endsWith("==") ? 2 : clean2.endsWith("=") ? 1 : 0;
    const out = new Uint8Array(Math.floor(clean2.length / 4) * 3 - padding);
    let o = 0;
    for (let i = 0; i + 3 < clean2.length; i += 4) {
      const a = B64_LOOKUP[clean2.charCodeAt(i)];
      const b = B64_LOOKUP[clean2.charCodeAt(i + 1)];
      const c = B64_LOOKUP[clean2.charCodeAt(i + 2)];
      const dd = B64_LOOKUP[clean2.charCodeAt(i + 3)];
      const chunk = a << 18 | b << 12 | c << 6 | dd;
      if (o < out.length) out[o++] = chunk >> 16 & 255;
      if (o < out.length) out[o++] = chunk >> 8 & 255;
      if (o < out.length) out[o++] = chunk & 255;
    }
    return out;
  }
  function fileFromBase64(base64, filename, mime) {
    const bytes = base64ToBytes(base64);
    return new globalThis.File(
      [bytes],
      filename || "resume.pdf",
      { type: mime || "application/pdf" }
    );
  }
  async function setDateParts(row, iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const want = { year: m[1], month: m[2], day: m[3] };
    let wrote = 0;
    for (const el of row.members || []) {
      const part = datePartOf(el);
      if (!part || !want[part]) continue;
      await typeText(el, want[part], 0);
      fire(el, "change");
      blur(el);
      wrote++;
    }
    return wrote > 0;
  }
  function accepts(decision, value, shown) {
    if (differentCountries(value, shown)) return false;
    if (decision && decision.row && decision.row.kind === "date-parts") return sameDate(value, shown);
    if (commitMatches(value, shown)) return true;
    if (commitMatches(value, shown)) return true;
    for (const candidate of decision && decision.candidates || []) {
      if (commitMatches(candidate, shown)) return true;
    }
    if (decision && decision.readFirst && shown && pickReadFirst(decision.readFirst, [shown]) === shown) return true;
    return isPhoneField(decision && decision.row) && samePhone(value, shown);
  }
  function sameDate(iso, shown) {
    const want = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(String(iso || "").trim());
    const got = String(shown || "").split("/").map((s) => s.trim());
    if (!want || !got.every((s) => /^\d+$/.test(s))) return false;
    const [, y, m, d] = want;
    const read = got.length === 3 ? { m: got[0], d: got[1], y: got[2] } : got.length === 2 ? { m: got[0], y: got[1] } : { y: got[0] };
    const same = (a, b) => a === void 0 || b === void 0 || Number(a) === Number(b);
    return same(y, read.y) && same(m, read.m) && same(d, read.d);
  }
  function isPhoneField(row) {
    if (!row) return false;
    const label = row.label || "";
    if (/extension|\bext\b|device|type|code/i.test(label)) return false;
    return row.hints && row.hints.type === "tel" || /\b(phone|mobile|telephone)\b/i.test(label);
  }
  function samePhone(wanted, shown) {
    const a = String(wanted || "").replace(/\D/g, "");
    const b = String(shown || "").replace(/\D/g, "");
    if (a.length < 6 || b.length < 6) return false;
    return a === b || a.endsWith(b) || b.endsWith(a);
  }
  async function applyDecision(decision) {
    const row = decision.row;
    const value = decision.value;
    if (!row || !row.el || !value) return { ok: false, outcome: "failed", shown: "" };
    if (decision.multiValues && decision.multiValues.length && row.multiPrompt) {
      const res = await commitPromptMulti(row, decision.multiValues);
      if (res.missing.length) decision.reason = `not in this employer's list: ${res.missing.join(", ")} \u2014 add any yourself`;
      const ok = res.pills.length > 0 && res.added.length + res.already.length > 0;
      return { ok, outcome: ok ? "ok" : "empty", shown: res.pills.join(" | ") };
    }
    let wrote = false;
    switch (row.kind) {
      case "date-parts":
        wrote = await setDateParts(row, value);
        break;
      case "select":
        wrote = setSelect(row.el, value);
        if (!wrote) wrote = await commitCombobox(row, value, decision.candidates, decision.readFirst, decision.drill);
        break;
      case "combobox":
        wrote = decision.hierarchy && isWorkdayPrompt(row.el) ? await commitHierarchyPick(
          row,
          decision.hierarchy.leaf,
          decision.hierarchy.parents,
          decision.hierarchy.fallback
        ) : await commitCombobox(row, value, decision.candidates, decision.readFirst, decision.drill);
        break;
      case "radio":
      case "checkbox":
        wrote = setCheckable(row, value);
        break;
      case "choice":
        wrote = setChoice(row, value);
        break;
      case "contenteditable":
        wrote = setContentEditable(row.el, value);
        break;
      default:
        wrote = setText(row.el, value);
        if (wrote) {
          await sleep(TIMING.settleMs);
          const check = reprobe(row);
          if (check && !check.filled) {
            await typeText(row.el, value, 8);
            blur(row.el);
          }
        }
        break;
    }
    const result = await verdict(decision, row, value, wrote);
    if (!result.ok && (row.kind === "combobox" || row.kind === "select") && !(decision.options && decision.options.length)) {
      let labels = row.seenOptions && row.seenOptions.length ? row.seenOptions : [];
      if (!labels.length) {
        const input = typableInput(row) || row.el;
        const after = reprobe(row);
        if (input && input.value && !(after && after.filled)) setText(input, "");
        else blur(row.el);
        await sleep(TIMING.settleMs);
        try {
          labels = await readComboboxOptions(row);
        } catch (e) {
          labels = [];
        }
      }
      if (labels.length) decision.options = labels.map((label) => ({ value: label, label }));
    }
    return result;
  }
  async function verdict(decision, row, value, wrote) {
    await sleep(TIMING.settleMs);
    const after = reprobe(row);
    if (!after) return { ok: wrote, outcome: wrote ? "ok" : "failed", shown: "" };
    if (after.invalid) return { ok: false, outcome: "rejected", shown: after.value };
    if (!after.filled) return { ok: false, outcome: "empty", shown: "" };
    const loneCheckboxTicked = row.kind === "checkbox" && (row.options || []).length <= 1 && /^(yes|true|on|checked)$/i.test(String(value));
    if (!loneCheckboxTicked && !accepts(decision, value, after.value)) {
      return { ok: false, outcome: "mismatch", shown: after.value };
    }
    return { ok: true, outcome: "ok", shown: after.value };
  }

  // src/autofill/tiles.js
  var probe3 = () => globalThis.__tcvFieldProbe;
  var norm2 = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  var MONTHS2 = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  function tileText(tile) {
    const summary = tile.querySelector(".apply-flow-profile-item-tile__summary");
    return (summary && summary.getAttribute("aria-label") || tile.textContent || "").replace(/\s+/g, " ").trim();
  }
  function tileFlagged(tile) {
    return tile.classList.contains("apply-flow-profile-item-tile--invalid") || /fields to fix/i.test(tile.textContent || "");
  }
  function tileTitle(tile) {
    const t = tile.querySelector(".apply-flow-profile-item-tile__summary-title");
    const s = tile.querySelector(".apply-flow-profile-item-tile__summary-subtitle");
    return [t && t.textContent, s && s.textContent].map((x) => (x || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" \xB7 ");
  }
  function matchTileEntry(kind, text, entries) {
    const t = norm2(text);
    const years = new Set(String(text).match(/\b(19|20)\d{2}\b/g) || []);
    const scored = (entries || []).map((e, i) => {
      let score = 0;
      const name = norm2(kind === "education" ? e.school : e.company);
      if (name && t.includes(name)) score += 3;
      if (kind === "experience" && e.title && t.includes(norm2(e.title))) score += 3;
      const yearOf2 = (v) => (String(v || "").match(/\b(19|20)\d{2}\b/) || [])[0];
      if (yearOf2(e.to) && years.has(yearOf2(e.to))) score += 2;
      if (yearOf2(e.from) && years.has(yearOf2(e.from))) score += 1;
      return { e, i, score };
    }).sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].score < 2) return null;
    if (scored[1] && scored[1].score === scored[0].score) return null;
    return scored[0].e;
  }
  function monthShapes(mmYYYY) {
    const m = String(mmYYYY || "").match(/^(\d{1,2})\//);
    if (!m) return null;
    const n = Number(m[1]);
    if (n < 1 || n > 12) return null;
    const name = MONTHS2[n - 1];
    return [name, name.slice(0, 3), String(n).padStart(2, "0"), String(n)];
  }
  var yearOf = (v) => (String(v || "").match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  function tileAnswer(kind, label, entry) {
    const l = String(label || "").toLowerCase();
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
    if (kind === "education") {
      if (/\bc?gpa\b|overall result|grade point|\bgrade\b|percentage/.test(l)) return entry.gpa ? [entry.gpa] : null;
      if (/degree|qualification/.test(l)) return entry.degree ? candidatesFor("degree", entry.degree) : null;
      if (/area of study|major|field of study|discipline|speciali|subject/.test(l)) return entry.field ? [entry.field] : null;
      if (/school|university|college|institution|establishment/.test(l)) return entry.school ? [entry.school] : null;
      return null;
    }
    if (/description|responsibilit|duties|summary|achievement/.test(l)) return entry.description ? [entry.description] : null;
    if (/job title|\btitle\b|position|role|designation/.test(l)) return entry.title ? [entry.title] : null;
    if (/company|employer|organi[sz]ation/.test(l)) return entry.company ? [entry.company] : null;
    if (/current/.test(l)) return entry.current ? ["Yes"] : null;
    return null;
  }
  async function waitFor(fn, ms) {
    const deadline = Date.now() + ms;
    for (; ; ) {
      const v = fn();
      if (v) return v;
      if (Date.now() >= deadline) return null;
      await sleep(100);
    }
  }
  function openEditor(block) {
    const f = block.querySelector(".profile-item-content--form");
    return f && isNodeVisible(f) ? f : null;
  }
  function press(el) {
    const doc = el.ownerDocument || globalThis.document;
    const noSubmit = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    doc.addEventListener("submit", noSubmit, true);
    try {
      try {
        el.scrollIntoView({ block: "center" });
      } catch (e) {
      }
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        try {
          el.dispatchEvent(new globalThis.MouseEvent(type, { bubbles: true, cancelable: true, view: globalThis.window || null }));
        } catch (e) {
        }
      }
      const click = new globalThis.MouseEvent("click", { bubbles: true, cancelable: true, view: globalThis.window || null });
      const cancelDefault = (e) => {
        if (e === click) e.preventDefault();
      };
      doc.defaultView.addEventListener("click", cancelDefault);
      try {
        el.dispatchEvent(click);
      } finally {
        doc.defaultView.removeEventListener("click", cancelDefault);
      }
    } finally {
      doc.removeEventListener("submit", noSubmit, true);
    }
  }
  function editorRows(editor) {
    const p = probe3();
    if (!p) return [];
    const els = p.fillableIn(editor).elements.filter(isVisible);
    return describeFields({ root: editor, fields: els });
  }
  async function fillEditor(kind, editor, entry) {
    const filled = [];
    for (const row of editorRows(editor)) {
      if (row.kind === "file") continue;
      if (row.filled && !row.invalid) continue;
      const shapes = tileAnswer(kind, row.label, entry);
      if (!shapes || !shapes.length) continue;
      let value = shapes[0];
      if (row.kind === "combobox" || row.kind === "select") {
        if (!(row.options || []).length) {
          const labels = await readComboboxOptions(row);
          if (labels.length) row.options = labels.map((l) => ({ value: l, label: l }));
        }
        const key = kind === "education" && /degree|qualification/i.test(row.label) ? "degree" : "";
        if ((row.options || []).length) {
          value = coerce(shapes[0], Object.assign({}, row, { candidates: shapes, candidateKey: key }));
          if (value == null) continue;
        } else if (key === "degree") {
          continue;
        }
      }
      const res = await applyDecision({ row, value, candidates: [value].concat(shapes), label: row.label });
      if (res.ok) filled.push(`${row.label.replace(/\s*\*$/, "")}: ${res.shown || value}`);
    }
    return filled;
  }
  function stillRejected(editor) {
    return editorRows(editor).filter((r) => r.invalid || r.required && !r.filled).map((r) => r.label);
  }
  async function fillProfileTiles(ctx, progress) {
    const facts = ctx && ctx.facts || {};
    const lists = {
      education: facts.educationEntries || [],
      experience: facts.workExperience || []
    };
    const out = [];
    for (const { block, kind } of profileTileBlocks()) {
      if (!kind) continue;
      const count = block.querySelectorAll(TILE_SEL).length;
      for (let i = 0; i < count; i++) {
        const tile = block.querySelectorAll(TILE_SEL)[i];
        if (!tile || !tileFlagged(tile)) continue;
        const shownAs = tileTitle(tile);
        const label = `${kind === "education" ? "Education" : "Experience"}: ${shownAs}`;
        const decision = {
          key: `tile:${kind}:${i}`,
          label,
          kind: "tile",
          row: { el: tile, kind: "tile" },
          action: ASK,
          value: "",
          source: "",
          reason: "",
          outcome: ""
        };
        out.push(decision);
        const entry = matchTileEntry(kind, tileText(tile), lists[kind]);
        if (!entry) {
          decision.reason = lists[kind].length ? `we could not tell which ${kind === "education" ? "school" : "job"} in your profile this is \u2014 open it and fix it` : `add your ${kind} to your profile, or fix this one here`;
          continue;
        }
        if (progress) progress("filling", { detail: label });
        const edit = tile.querySelector(".apply-flow-profile-item-tile__edit-item-icon");
        if (!edit) {
          decision.reason = "open this entry and fix it yourself";
          continue;
        }
        press(edit);
        const editor = await waitFor(() => openEditor(block), TIMING.tileOpenMs);
        if (!editor) {
          decision.reason = "the entry did not open \u2014 fix it yourself";
          continue;
        }
        await sleep(TIMING.settleMs + 150);
        const filled = await fillEditor(kind, editor, entry);
        const save = block.querySelector('.profile-item-footer .save-btn, [data-qa="profileItemInlineSaveButton"]');
        if (!save) {
          decision.reason = "fix this entry and save it yourself";
          continue;
        }
        press(save);
        const closed = await waitFor(() => !openEditor(block), TIMING.tileSaveMs);
        if (!closed) {
          const missing = stillRejected(editor);
          const cancel = block.querySelector(".profile-item-footer .cancel-btn");
          if (cancel) press(cancel);
          await waitFor(() => !openEditor(block), TIMING.tileSaveMs);
          decision.reason = missing.length ? `still needs: ${missing.join(", ")} \u2014 fix it yourself` : "it would not save \u2014 fix it yourself";
          continue;
        }
        await sleep(TIMING.settleMs + 150);
        const after = block.querySelectorAll(TILE_SEL)[i];
        if (after && tileFlagged(after)) {
          decision.reason = "saved, but the form still flags it \u2014 open it and check";
          continue;
        }
        decision.action = FILL;
        decision.source = "profile";
        decision.outcome = "ok";
        decision.value = filled.join(" \xB7 ") || "saved";
        decision.shown = decision.value;
      }
    }
    return out;
  }

  // src/autofill/repeaters.js
  var probe4 = () => globalThis.__tcvFieldProbe;
  var MAX_JOBS = 20;
  var MAX_SCHOOLS = 10;
  function headingText(group) {
    const id = group.getAttribute("aria-labelledby") || "";
    const doc = group.ownerDocument || globalThis.document;
    const h = id && doc.getElementById(id);
    return (h && h.textContent || "").replace(/\s+/g, " ").trim();
  }
  function sectionByHeading(re, doc) {
    const d = doc || globalThis.document;
    for (const g of d.querySelectorAll('[role="group"][aria-labelledby]')) {
      if (re.test(headingText(g))) return g;
    }
    return null;
  }
  function experienceSection(doc) {
    return sectionByHeading(/^(work )?experience$/i, doc);
  }
  function educationSection(doc) {
    return sectionByHeading(/^education$/i, doc);
  }
  function sectionPanels(section) {
    return Array.from(section.querySelectorAll('[role="group"][aria-labelledby]')).filter((g) => /\b\d+$/.test(headingText(g)) && g.parentElement && g.parentElement.closest('[role="group"][aria-labelledby]') === section);
  }
  function addButton(section) {
    return Array.from(section.querySelectorAll("button")).find((b) => /^add( another)?$/i.test((b.textContent || "").trim()) && b.closest('[role="group"][aria-labelledby]') === section) || null;
  }
  function inSection(section, row) {
    if (!section || !row) return false;
    const els = (row.members && row.members.length ? row.members : [row.el]).filter(Boolean);
    return els.some((el) => section.contains(el));
  }
  function panelRows(panel) {
    const p = probe4();
    if (!p) return [];
    const els = p.fillableIn(panel).elements.filter(isVisible);
    return describeFields({ root: panel, fields: els }).map((r) => Object.assign(r, { scope: panel }));
  }
  function isoMonth(v) {
    const s = String(v || "").trim();
    let m = s.match(/^(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[2]}-${m[1].padStart(2, "0")}-01`;
    m = s.match(/^(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-01`;
    return "";
  }
  function isoYear(v) {
    const y = (String(v || "").match(/\b(19|20)\d{2}\b/) || [])[0];
    return y ? `${y}-01-01` : "";
  }
  function experienceAnswer(row, entry) {
    const label = String(row.label || "").replace(/\*\s*$/, "").trim();
    if (row.kind === "date-parts") {
      if (/\b(from|start|begin)/i.test(label)) return isoMonth(entry.from) || null;
      if (/\b(to|end)\b/i.test(label)) return entry.current ? null : isoMonth(entry.to) || null;
      return null;
    }
    if (row.kind === "checkbox") return /current/i.test(label) && entry.current ? "Yes" : null;
    if (/\blocation\b|\bcity\b/i.test(label)) return entry.location || null;
    const shapes = tileAnswer("experience", label, entry);
    return shapes && shapes.length ? shapes[0] : null;
  }
  function educationAnswer(row, entry) {
    const label = String(row.label || "").replace(/\*\s*$/, "").trim();
    if (row.kind === "date-parts") {
      if (/\b(from|start|begin)/i.test(label)) return isoYear(entry.from) ? [isoYear(entry.from)] : null;
      if (/\b(to|end|graduat|complet)/i.test(label)) return isoYear(entry.to) ? [isoYear(entry.to)] : null;
      return null;
    }
    if (row.kind === "checkbox") return null;
    const shapes = tileAnswer("education", label, entry);
    return shapes && shapes.length ? shapes : null;
  }
  var SECTIONS = {
    experience: {
      find: experienceSection,
      max: MAX_JOBS,
      noun: "job",
      title: "Experience",
      shapes: (row, entry) => {
        const v = experienceAnswer(row, entry);
        return v ? [v] : null;
      },
      // Workday's resume read fills the company first; a block showing one is
      // matched to that job wherever it is in the list.
      identityRe: /company|employer|organi[sz]ation/i,
      identity: (e) => e.company,
      describe: (e) => [e.title, e.company].filter(Boolean).join(" \xB7 "),
      describeFull: (e) => [e.title, e.company, e.location, e.current ? `${e.from || ""} \u2013 present` : [e.from, e.to].filter(Boolean).join(" \u2013 ")].filter(Boolean).join(" \xB7 "),
      currentBox: true
    },
    education: {
      find: educationSection,
      max: MAX_SCHOOLS,
      noun: "school",
      title: "Education",
      shapes: educationAnswer,
      identityRe: /school|university|college|institution/i,
      identity: (e) => e.school,
      describe: (e) => [e.school, e.degree].filter(Boolean).join(" \xB7 "),
      describeFull: (e) => [e.school, e.degree, e.field, [e.from, e.to].filter(Boolean).join(" \u2013 ")].filter(Boolean).join(" \xB7 "),
      currentBox: false
    }
  };
  async function fillPanel(panel, entry, spec, ask) {
    const filled = [];
    const byAi = [];
    let rows = panelRows(panel);
    const current = spec.currentBox && rows.find((r) => r.kind === "checkbox" && /current/i.test(r.label || ""));
    if (current && entry.current && !current.filled) {
      const res = await applyDecision({ row: current, value: "Yes", candidates: ["Yes"], label: current.label });
      if (res.ok) filled.push("Currently work here");
      else log(spec, `"${current.label}" did not take (${res.outcome})`);
      await sleep(TIMING.settleMs + 100);
      rows = panelRows(panel);
    }
    for (const row of rows) {
      if (row.kind === "checkbox" || row.kind === "file") continue;
      if (row.filled && !row.invalid) continue;
      const name = String(row.label || "").replace(/\s*\*$/, "");
      const shapes = spec.shapes(row, entry);
      let res = null;
      if (shapes && shapes.length) {
        const decision = { row, value: shapes[0], candidates: shapes, label: row.label };
        if (spec === SECTIONS.education && /degree|qualification/i.test(row.label || "")) {
          decision.readFirst = { key: "degree", stored: entry.degree };
        }
        res = await applyDecision(decision);
        if (res.ok) {
          filled.push(name);
          continue;
        }
        log(spec, `"${row.label}" did not take (${res.outcome})`);
      }
      const picked = await askModel(row, entry, spec, ask);
      if (picked) {
        filled.push(name);
        byAi.push(name);
      }
    }
    filled.byAi = byAi;
    return filled;
  }
  var LIST_KINDS = /* @__PURE__ */ new Set(["combobox", "select", "radio", "choice"]);
  async function askModel(row, entry, spec, ask) {
    if (typeof ask !== "function" || !row.required || !LIST_KINDS.has(row.kind)) return false;
    if (classifySensitive(row.label)) return false;
    let options = (row.options || []).map((o) => typeof o === "string" ? o : o && o.label).filter(Boolean);
    if (!options.length && row.kind === "combobox") {
      try {
        options = await readComboboxOptions(row);
      } catch (e) {
        options = [];
      }
    }
    if (!options.length) return false;
    let value = null;
    try {
      value = await ask(row, spec.describeFull(entry), options);
    } catch (e) {
      value = null;
    }
    if (!value) return false;
    const res = await applyDecision({ row, value, candidates: [value], label: row.label });
    if (!res.ok) log(spec, `"${row.label}": the model's "${value}" did not take (${res.outcome})`);
    return !!res.ok;
  }
  function stillMissing(panel) {
    return panelRows(panel).filter((r) => r.required && (!r.filled || r.invalid)).map((r) => String(r.label || "").replace(/\s*\*$/, ""));
  }
  async function waitFor2(fn, ms) {
    const deadline = Date.now() + ms;
    for (; ; ) {
      const v = fn();
      if (v) return v;
      if (Date.now() >= deadline) return null;
      await sleep(100);
    }
  }
  function fillExperienceSection(ctx, progress, doc, ask) {
    const jobs = ctx && ctx.facts && ctx.facts.workExperience || [];
    return fillSection(SECTIONS.experience, jobs, progress, doc, ask);
  }
  function fillEducationSection(ctx, progress, doc, ask) {
    const facts = ctx && ctx.facts || {};
    const bankGpa = String((ctx && ctx.answerBank || {}).gpa || "").trim();
    const schools = (facts.educationEntries || []).map((s, i) => i === 0 && !s.gpa && bankGpa ? Object.assign({}, s, { gpa: bankGpa }) : s);
    return fillSection(SECTIONS.education, schools, progress, doc, ask);
  }
  async function fillSection(spec, allEntries, progress, doc, ask) {
    const section = spec.find(doc);
    const entries = (allEntries || []).slice(0, spec.max);
    if (!section || !entries.length) return [];
    const out = [];
    const decisionFor = (entry, n) => {
      const d = {
        key: `repeater:${spec === SECTIONS.education ? "education" : "experience"}:${n}`,
        kind: "tile",
        row: { el: section, kind: "tile" },
        label: `${spec.title}: ${spec.describe(entry) || `${spec.noun} ${n + 1}`}`,
        action: ASK,
        value: "",
        source: "",
        reason: "",
        outcome: ""
      };
      out.push(d);
      return d;
    };
    const finish = (d, panel, filled) => {
      const missing = stillMissing(panel);
      if (missing.length) {
        d.reason = `still needs: ${missing.join(", ")} \u2014 fix it yourself`;
        return;
      }
      d.action = FILL;
      d.source = "profile";
      d.outcome = "ok";
      d.value = d.shown = filled.length ? filled.join(" \xB7 ") : "already filled";
      if (filled.byAi && filled.byAi.length) {
        d.source = "ai_forced";
        d.reason = `${filled.byAi.join(", ")} picked by AI from your resume \u2014 check ${filled.byAi.length === 1 ? "it" : "them"}`;
      }
    };
    const existing = sectionPanels(section);
    log(spec, `${existing.length} block(s) on the page, ${entries.length} ${spec.noun}(s) in the profile`);
    const plan = assignEntries(existing.map(panelRows), entries, spec);
    const placed = /* @__PURE__ */ new Set();
    for (let b = 0; b < existing.length; b++) {
      const a = plan[b];
      if (a.job == null) {
        if (a.reason) log(spec, `block ${b + 1}: left alone \u2014 ${a.reason}`);
        continue;
      }
      placed.add(a.job);
      const entry = entries[a.job];
      const d = decisionFor(entry, a.job);
      log(spec, `block ${b + 1} \u2190 ${spec.noun} ${a.job + 1} (${spec.describe(entry)})${a.why ? " \u2014 " + a.why : ""}`);
      if (progress) progress("filling", { detail: d.label });
      finish(d, existing[b], await fillPanel(existing[b], entry, spec, ask));
    }
    const rest = entries.map((e, i) => i).filter((i) => !placed.has(i));
    for (let r = 0; r < rest.length; r++) {
      const i = rest[r];
      const d = decisionFor(entries[i], i);
      const add = addButton(section);
      if (!add) {
        d.reason = `could not find "Add Another" \u2014 add this ${spec.noun} yourself`;
        continue;
      }
      const before = sectionPanels(section).length;
      press(add);
      const ok = await waitFor2(() => sectionPanels(section).length > before, TIMING.tileOpenMs);
      if (!ok) {
        d.reason = `pressing "Add Another" did not add a block \u2014 add this ${spec.noun} yourself`;
        for (const j of rest.slice(r + 1)) decisionFor(entries[j], j).reason = `add this ${spec.noun} yourself`;
        log(spec, `"Add Another" did not add a block (still ${before}) \u2014 stopped`);
        break;
      }
      await sleep(TIMING.settleMs + 150);
      const panel = sectionPanels(section)[before];
      log(spec, `added block ${before + 1} \u2190 ${spec.noun} ${i + 1} (${spec.describe(entries[i])})`);
      if (progress) progress("filling", { detail: d.label });
      finish(d, panel, await fillPanel(panel, entries[i], spec, ask));
    }
    return out;
  }
  function log(spec, msg) {
    const name = spec === SECTIONS.education ? "education" : "work experience";
    try {
      console.info(`[TailorCV] ${name}: ${msg}`);
    } catch (e) {
    }
  }
  var normText = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function blockIdentity(rows, spec) {
    const r = rows.find((x) => x.kind !== "checkbox" && spec.identityRe.test(x.label || ""));
    return r && r.filled && r.value || "";
  }
  var sameName = (a, b) => {
    const x = normText(a), y = normText(b);
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
  };
  function assignEntries(blocks, entries, spec) {
    const taken = /* @__PURE__ */ new Set();
    const plan = blocks.map((rows) => {
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
      if (next >= entries.length) {
        a.job = null;
        continue;
      }
      taken.add(next);
      a.job = next++;
    }
    return plan;
  }

  // src/autofill/run.js
  function storable(label, sensitive, employer) {
    const category = sensitive || classifySensitive(label, employer);
    return !category || STORABLE_SENSITIVE.has(category);
  }
  var MAX_REPAIR_SWEEPS = 1;
  var MAX_REVEAL_ROUNDS = 2;
  var MAX_PAGES = 4;
  var STATE_TTL_MS = 30 * 60 * 1e3;
  var MAX_DROPDOWNS_TO_OPEN = 25;
  var clock = startClock();
  function send(msg) {
    return new Promise((resolve) => {
      try {
        globalThis.chrome.runtime.sendMessage(msg, (res) => resolve(res || {}));
      } catch (e) {
        resolve({ error: String(e && e.message || e) });
      }
    });
  }
  var state = {
    registry: {},
    // key -> value we wrote and verified
    userEdited: [],
    // keys the person typed in themselves
    answeredByUser: {},
    // key -> answer they gave in the sidebar
    imported: {},
    // application -> when the resume went into its profile import
    page: 1,
    startedAt: 0,
    origin: ""
  };
  function getState() {
    return state;
  }
  async function loadState() {
    const res = await send({ type: "AF_STATE_GET" });
    const saved = res && res.data;
    const origin = globalThis.location.origin;
    if (!saved || saved.origin !== origin) return false;
    if (!saved.startedAt || Date.now() - saved.startedAt > STATE_TTL_MS) return false;
    state = Object.assign(state, saved);
    return true;
  }
  async function saveState() {
    await send({ type: "AF_STATE_SET", data: {
      v: 1,
      origin: state.origin,
      page: state.page,
      startedAt: state.startedAt,
      registry: state.registry,
      userEdited: state.userEdited,
      answeredByUser: state.answeredByUser,
      imported: state.imported
    } });
  }
  async function clearState() {
    state = { registry: {}, userEdited: [], answeredByUser: {}, imported: {}, page: 1, startedAt: 0, origin: "" };
    await send({ type: "AF_STATE_CLEAR" });
  }
  async function resumeIfContinuing() {
    const form = isApplicationPage();
    if (!form) return 0;
    if (!await loadState()) return 0;
    if (state.page >= MAX_PAGES) return 0;
    state.page += 1;
    await saveState();
    return state.page;
  }
  async function nextPage() {
    if (!state.startedAt) {
      state.startedAt = Date.now();
      state.origin = globalThis.location.origin;
    }
    if (state.page < MAX_PAGES) state.page += 1;
    await saveState();
    return state.page;
  }
  var editWatcher = null;
  function watchUserEdits(form, onEdit) {
    stopWatchingUserEdits();
    if (!form || !form.root) return;
    const rows = /* @__PURE__ */ new Map();
    const before = /* @__PURE__ */ new Map();
    for (const row of describeFields(form)) {
      for (const el of row.members || []) rows.set(el, row);
      if (row.key) before.set(row.key, currentValue(row));
    }
    const handler = (event) => {
      const row = rows.get(event.target);
      if (!row || !row.key) return;
      const value = currentValue(row);
      if (!value || value === before.get(row.key)) return;
      if (!state.userEdited.includes(row.key)) state.userEdited.push(row.key);
      if (typeof onEdit === "function") {
        try {
          onEdit(row, event);
        } catch (e) {
        }
      }
    };
    editWatcher = { root: form.root, handler };
    for (const type of ["change", "blur"]) {
      form.root.addEventListener(type, handler, { capture: true, passive: true });
    }
  }
  function currentValue(row) {
    const now2 = reprobe(row);
    return now2 && now2.filled ? String(now2.value || "") : "";
  }
  function stopWatchingUserEdits() {
    if (!editWatcher) return;
    for (const type of ["change", "blur"]) {
      try {
        editWatcher.root.removeEventListener(type, editWatcher.handler, { capture: true });
      } catch (e) {
      }
    }
    editWatcher = null;
  }
  function learnableAnswers(decisions) {
    const out = [];
    for (const d of decisions || []) {
      if (!state.userEdited.includes(d.key)) continue;
      const after = reprobe(d.row);
      const value = after && after.value || "";
      if (!value || !after.filled) continue;
      if (!storable(d.label, d.sensitive, d.employer)) continue;
      if (isNeverFill(d.label) || looksSecret(value)) continue;
      if (d.row.kind === "file") continue;
      const type = d.row.hints && d.row.hints.type || "";
      if (type === "password") continue;
      const autocomplete = d.row.hints && d.row.hints.autocomplete || "";
      if (/^cc-|one-time-code/.test(autocomplete)) continue;
      if (!questionSignature(d.label)) continue;
      out.push({ key: d.key, question: d.label, answer: value });
    }
    return out;
  }
  function pageBlockers(decisions) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const d of decisions || []) {
      const row = d && d.row;
      if (!row || !row.required || seen.has(d.key)) continue;
      let reason = "";
      if (row.kind === "file") {
        if (!hasUploadedFile(row.el)) reason = "needs a file";
      } else {
        const now2 = reprobe(row);
        if (!now2) continue;
        if (now2.invalid) reason = "the form rejected this";
        else if (!now2.filled) reason = "needs an answer";
      }
      if (reason) {
        seen.add(d.key);
        out.push({ key: d.key, label: d.label || "(unlabelled field)", reason, decision: d });
      }
    }
    return out;
  }
  var MAX_FORCED = 15;
  async function forceAnswers(ctx, decisions, onProgress) {
    const progress = typeof onProgress === "function" ? onProgress : () => {
    };
    const targets = pageBlockers(decisions).map((b) => b.decision).filter((d) => d.row && d.row.kind !== "file" && !d.slot && !d.knownEmpty && !d.sensitive && !classifySensitive(d.label, d.employer) && !isNeverFill(d.label)).slice(0, MAX_FORCED);
    if (!targets.length) return { forced: 0 };
    for (const d of targets) {
      if (d.kind === "combobox" && !(d.options && d.options.length)) {
        const labels = await readComboboxOptions(d.row);
        if (labels.length) {
          d.row.options = labels.map((l) => ({ value: l, label: l }));
          d.options = d.row.options;
        }
      }
    }
    const fields = targets.map((d) => ({
      i: decisions.indexOf(d),
      label: d.label,
      kind: d.kind,
      required: true,
      sensitive: false,
      recallOnly: false,
      compose: false,
      documentSlot: null,
      options: (d.options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean).slice(0, 300)
    }));
    const res = await send({
      type: "AF_PLAN",
      payload: {
        url: globalThis.location.href,
        host: globalThis.location.hostname,
        ats: (findForm() || {}).ats || "generic",
        jobTitle: ctx && ctx.jobTitle || "",
        jobCompany: ctx && ctx.jobCompany || "",
        jdExcerpt: String(ctx && ctx.jdExcerpt || "").slice(0, 2e3),
        force: true,
        fields
      }
    });
    if (res.error) return { error: res.error };
    const answers = res.data && res.data.answers || {};
    const answered = [];
    for (const d of targets) {
      const a = answers[String(decisions.indexOf(d))];
      if (!a || !String(a.value || "").trim()) continue;
      d.value = String(a.value);
      d.action = FILL;
      d.source = "ai_forced";
      d.confidence = Number(a.confidence) || 0.6;
      d.candidates = [];
      d.reason = ctx && ctx.resumePass ? "best answer from your resume \u2014 check it" : "best answer from your resume, so auto-apply could continue \u2014 check it";
      answered.push(d);
    }
    if (answered.length) {
      stopWatchingUserEdits();
      try {
        await writeAll(answered, ctx, progress, true);
      } finally {
        watchUserEdits(findForm(), null);
      }
    }
    return { forced: answered.length };
  }
  function askBlockField(ctx) {
    return async (row, entryText, options) => {
      const label = String(row.label || "").replace(/\s*\*+\s*$/, "");
      const res = await send({
        type: "AF_PLAN",
        payload: {
          url: globalThis.location.href,
          host: globalThis.location.hostname,
          ats: (findForm() || {}).ats || "generic",
          jobTitle: ctx && ctx.jobTitle || "",
          jobCompany: ctx && ctx.jobCompany || "",
          jdExcerpt: "",
          force: true,
          fields: [{
            i: 0,
            label: entryText ? `${label} \u2014 for: ${entryText}` : label,
            kind: row.kind,
            required: true,
            sensitive: false,
            recallOnly: false,
            compose: false,
            documentSlot: null,
            options: options.slice(0, 300)
          }]
        }
      });
      const a = !res.error && res.data && res.data.answers && res.data.answers["0"];
      const value = a && String(a.value || "").trim();
      return value && options.includes(value) ? value : null;
    };
  }
  async function runAutofill(ctx, onProgress) {
    const progress = (phase, extra) => {
      if (typeof onProgress === "function") {
        try {
          onProgress(Object.assign({ phase }, extra || {}));
        } catch (e) {
        }
      }
    };
    clock = startClock();
    let form = findForm();
    if (!form) {
      const page = isApplicationPage();
      if (page && page.tilesOnly) form = page;
    }
    if (!form) return { error: "no_form", decisions: [], counts: summarize([]) };
    const hasTiles = profileTileBlocks().some((b) => b.kind);
    if (!state.startedAt) {
      state.startedAt = Date.now();
      state.origin = globalThis.location.origin;
    }
    attachedThisRun.clear();
    progress("scanning");
    let rows = await clock.time("scan", () => describeFields(form));
    if (!rows.length && !hasTiles) return { error: "no_fields", decisions: [], counts: summarize([]) };
    let decisions = [];
    const fileRows = rows.filter((r) => r.kind === "file");
    const docsStart = clock.now();
    if (fileRows.length) {
      const filledBefore = new Set(rows.filter((r) => r.filled).map((r) => r.key));
      decisions = decide(fileRows, ctx, null, state);
      const app = applicationKey();
      const step = Number((globalThis.location.pathname.match(/\/section\/(\d+)/) || [])[1] || 1);
      for (const d of decisions) {
        if (d.action === DOCUMENT && isProfileImport(d.row) && (state.imported && state.imported[app] || step > 1)) {
          d.action = SKIP;
          d.reason = "your resume was already imported on an earlier page of this application";
        }
      }
      await writeAll(decisions, ctx, progress);
      if (decisions.some((d) => d.action === DOCUMENT && d.outcome === "ok" && isProfileImport(d.row))) {
        state.imported = Object.assign({}, state.imported, { [app]: Date.now() });
      }
      if (decisions.some((d) => d.action === DOCUMENT && d.outcome === "ok")) {
        if (decisions.some((d) => d.formRead)) {
          progress("scanning", { detail: "letting the form read your resume" });
          clock.quiet(await waitForQuiet(form.root));
        }
        rows = describeFields(findForm() || form);
        for (const r of rows) {
          if (r.kind !== "file" && r.filled && !r.invalid && !filledBefore.has(r.key)) r.filledByForm = true;
        }
      }
      clock.add("documents", clock.now() - docsStart);
    }
    const jobs = ctx && ctx.facts && ctx.facts.workExperience || [];
    const expSection = jobs.length ? experienceSection() : null;
    const schools = ctx && ctx.facts && ctx.facts.educationEntries || [];
    const eduSection = schools.length ? educationSection() : null;
    const inRepeater = (r) => inSection(expSection, r) || inSection(eduSection, r);
    const fieldRows = rows.filter((r) => r.kind !== "file" && !inRepeater(r));
    decisions = decisions.concat(await fillInTwoWaves(await planFor(fieldRows, ctx, progress), ctx, progress));
    if (expSection) {
      await clock.time("experience", async () => {
        clock.quiet(await waitForQuiet(form.root));
        decisions = decisions.concat(await fillExperienceSection(ctx, progress, void 0, askBlockField(ctx)));
      });
    }
    if (eduSection) {
      await clock.time("education", async () => {
        clock.quiet(await waitForQuiet(form.root));
        decisions = decisions.concat(await fillEducationSection(ctx, progress, void 0, askBlockField(ctx)));
      });
    }
    for (const d of decisions) {
      if (d.row && d.row.filledByForm && d.action === SKIP) {
        d.byForm = true;
        d.reason = "filled by the form from your resume \u2014 check it";
      }
    }
    const repairStart = clock.now();
    for (let sweep = 0; sweep < MAX_REPAIR_SWEEPS; sweep++) {
      let broken = decisions.filter((d) => d.outcome && d.outcome !== "ok" && d.value);
      if (!broken.length) break;
      await sleep(TIMING.settleMs);
      for (const d of broken) {
        const shapes = [d.value].concat(d.candidates || []);
        if (d.row && d.row.kind !== "file" && await settlesTo(d.row, shapes, 0)) {
          const now2 = reprobe(d.row);
          d.outcome = "ok";
          d.shown = now2 && now2.value || d.value;
          if (d.key) state.registry[d.key] = d.value;
        }
      }
      broken = broken.filter((d) => d.outcome !== "ok");
      if (!broken.length) break;
      for (const d of broken) {
        if (d.row && isPhoneRow(d.row)) {
          const alt = alternatePhone(d.value, ctx);
          if (d.row.hasCountryWidget && String(alt).startsWith("+")) continue;
          if (alt && alt !== d.value) d.value = alt;
          continue;
        }
        const next = nextCandidate(d);
        if (next) {
          d.candidates = d.candidates.filter((c) => c !== d.value);
          d.value = next;
        }
      }
      progress("repairing", { total: broken.length });
      await writeAll(broken, ctx, progress, true);
    }
    clock.add("repair", clock.now() - repairStart);
    const revealStart = clock.now();
    let revealed = 0;
    while (revealed < MAX_REVEAL_ROUNDS) {
      const before = new Set(rows.map((r) => r.key));
      clock.quiet(await waitForQuiet(form.root));
      const fresh = describeFields(findForm() || form);
      const added = fresh.filter((r) => r.key && !before.has(r.key) && !(r.kind === "file" && isProfileImport(r)) && !inRepeater(r));
      if (!added.length) break;
      revealed++;
      progress("scanning", { detail: `${added.length} new field(s) appeared` });
      const extra = await fillInTwoWaves(await planFor(added, ctx, progress), ctx, progress);
      decisions = decisions.concat(extra);
      rows = fresh;
    }
    clock.add("reveal", clock.now() - revealStart);
    if (hasTiles) {
      const tiled = await clock.time("tiles", () => fillProfileTiles(ctx, progress));
      decisions = decisions.concat(tiled);
    }
    await clock.time("refill", () => refillCleared(decisions, progress, form.root));
    await clock.time("reread_options", () => rereadEmptyLists(decisions));
    if (ctx && ctx.resumePass && pageBlockers(decisions).length) {
      progress("resume", {});
      await clock.time("resume_pass", () => forceAnswers(ctx, decisions, progress));
    }
    await saveState();
    watchUserEdits(form, null);
    const timing = clock.summary();
    console.info(`[TailorCV] autofill took ${timing.totalMs} ms`);
    console.table(timing.phases);
    if (timing.slowFields.length) console.table(timing.slowFields);
    if (timing.quietWaits.length) console.table(timing.quietWaits);
    return {
      timing,
      decisions,
      counts: summarize(decisions),
      serverError: decisions.serverError || "",
      page: state.page,
      opaqueHosts: form.opaqueHosts || 0,
      ats: form.ats
    };
  }
  function isPhoneRow(row) {
    const label = row.label || "";
    if (/extension|\bext\b|device|type|code/i.test(label)) return false;
    return row.hints && row.hints.type === "tel" || /\b(phone|mobile)\b/i.test(label);
  }
  function applicationKey() {
    const loc = globalThis.location;
    return `${loc.origin}${loc.pathname.replace(/\/section\/\d+\/?$/, "").replace(/\/+$/, "")}`;
  }
  function isProfileImport(row) {
    if (!row) return false;
    if (/\bimport\b|\bpars(e|er|ing)\b/i.test(row.label || "")) return true;
    const cls = row.el && row.el.className || "";
    return /profile-import/i.test(String(cls));
  }
  var REFILL_ROUNDS = 2;
  async function refillCleared(decisions, progress, root) {
    const emptied = () => decisions.filter((d) => {
      if (!(d.action === FILL || d.action === SUGGEST) || d.outcome !== "ok") return false;
      if (!d.row || d.row.kind === "file" || d.row.kind === "tile") return false;
      if (d.key && state.userEdited.includes(d.key)) return false;
      const now2 = reprobe(d.row);
      return !!now2 && !now2.filled;
    });
    for (let round = 0; round < REFILL_ROUNDS; round++) {
      const lost = emptied();
      if (!lost.length) return;
      console.info(
        `[TailorCV] the form emptied ${lost.length} answer(s) after they were filled \u2014 filling again:`,
        lost.map((d) => d.label).join(" | ")
      );
      progress("repairing", { total: lost.length, detail: "the form cleared some answers \u2014 filling them again" });
      for (const d of lost) {
        const result = await applyDecision(d);
        d.outcome = result.outcome;
        d.shown = result.shown;
        if (!result.ok) {
          d.action = ASK;
          d.reason = "the form cleared this after we filled it";
        }
        clock.quiet(await waitForQuiet(root));
      }
    }
    for (const d of emptied()) {
      d.action = ASK;
      d.outcome = "cleared";
      d.reason = "the form cleared this after it was filled \u2014 choose it again";
    }
  }
  var OWN_UI = "#tailorcv-sidebar, #tailorcv-launcher";
  function isOwnUi(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    try {
      return !!(el && el.closest && el.closest(OWN_UI));
    } catch (e) {
      return false;
    }
  }
  function waitForQuiet(root) {
    const doc = root && root.ownerDocument || globalThis.document;
    const target = doc && doc.body || root;
    return new Promise((resolve) => {
      const start = Date.now();
      let last = start;
      let obs = null;
      try {
        obs = new globalThis.MutationObserver((records) => {
          if (records.some((r) => !isOwnUi(r.target))) last = Date.now();
        });
        obs.observe(target, { childList: true, subtree: true, attributes: true });
      } catch (e) {
        obs = null;
      }
      const tick = () => {
        const now2 = Date.now();
        const waited = now2 - start;
        const quiet = now2 - last;
        const capped = waited >= TIMING.revealMaxMs;
        if (capped || waited >= TIMING.revealWatchMs && (quiet >= TIMING.revealQuietMs || last === start)) {
          try {
            if (obs) obs.disconnect();
          } catch (e) {
          }
          resolve({ ms: waited, capped });
          return;
        }
        setTimeout(tick, 100);
      };
      setTimeout(tick, Math.min(100, TIMING.revealWatchMs));
    });
  }
  function nextCandidate(d) {
    if (!d || !d.candidates || d.candidates.length < 2) return "";
    const current = String(d.value || "").toLowerCase();
    const next = d.candidates.find((c) => String(c).toLowerCase() !== current);
    return next || "";
  }
  function alternatePhone(value, ctx) {
    const stored = String(ctx && ctx.answerBank && ctx.answerBank.phone || value || "");
    const parts = splitPhone(stored);
    if (!parts.dialCode) return "";
    return String(value).startsWith("+") ? parts.national : parts.e164;
  }
  function decisionsToWrite(decisions) {
    return decisions.filter((d) => d.action === FILL || d.action === SUGGEST || d.action === DOCUMENT);
  }
  var MAX_REREADS = 8;
  async function rereadEmptyLists(decisions) {
    const empty = decisions.filter((d) => (d.action === ASK || d.action === PROFILE) && d.kind === "combobox" && d.row && d.row.el && d.row.el.isConnected && !(d.options && d.options.length)).slice(0, MAX_REREADS);
    for (const d of empty) {
      const now2 = reprobe(d.row);
      if (now2 && now2.filled) continue;
      const labels = await readComboboxOptions(d.row);
      if (labels.length) {
        d.row.options = labels.map((l) => ({ value: l, label: l }));
        d.options = d.row.options;
      }
    }
  }
  async function planFor(rows, ctx, progress) {
    let decisions = decide(rows, ctx, null, state);
    const needOptions = decisions.filter((d) => (d.action === ASK || d.action === PROFILE) && (d.kind === "combobox" || d.kind === "select" && !d.options.length) && !d.row.filled).slice(0, MAX_DROPDOWNS_TO_OPEN);
    if (needOptions.length) {
      progress("reading", { total: needOptions.length });
      await clock.time("read_options", async () => {
        for (const d of needOptions) {
          const labels = await readComboboxOptions(d.row);
          if (labels.length) {
            d.row.options = labels.map((l) => ({ value: l, label: l }));
            d.options = d.row.options;
          }
        }
      });
      decisions = decide(rows, ctx, null, state);
    }
    const toAsk = fieldsForServer(decisions);
    if (!toAsk.length) return { decisions, server: null };
    return { decisions, server: askServer(rows, ctx, decisions, toAsk) };
  }
  async function askServer(rows, ctx, decisions, toAsk) {
    const res = await send({
      type: "AF_PLAN",
      payload: {
        url: globalThis.location.href,
        host: globalThis.location.hostname,
        ats: (findForm() || {}).ats || "generic",
        jobTitle: ctx && ctx.jobTitle || "",
        jobCompany: ctx && ctx.jobCompany || "",
        jdExcerpt: String(ctx && ctx.jdExcerpt || "").slice(0, 2e3),
        fields: toAsk
      }
    });
    if (res.error) {
      decisions.forEach((d) => {
        if (d.action === ASK && !d.reason) d.reason = res.error;
      });
      decisions.serverError = res.error;
      decisions.quotaExhausted = res.code === "upgrade_required";
      return decisions;
    }
    return decide(rows, ctx, res.data || {}, state);
  }
  async function fillInTwoWaves(plan, ctx, progress) {
    const local = plan.decisions;
    progress("filling", { done: 0, total: decisionsToWrite(local).length });
    await clock.time("local_writes", () => writeAll(local, ctx, progress));
    if (!plan.server) return local;
    progress("thinking");
    const answered = await clock.time("server_wait", () => plan.server);
    const wroteLocally = new Set(decisionsToWrite(local));
    const merged = answered.map((d, i) => wroteLocally.has(local[i]) ? local[i] : d);
    merged.serverError = answered.serverError;
    merged.quotaExhausted = answered.quotaExhausted;
    const wave2 = merged.filter((d, i) => d !== local[i] && decisionsToWrite([d]).length);
    for (const d of wave2) {
      const now2 = reprobe(d.row);
      if (now2 && now2.filled && !d.row.filled) {
        d.action = SKIP;
        d.reason = "you filled this while we were writing";
        if (d.key && !state.userEdited.includes(d.key)) state.userEdited.push(d.key);
      }
    }
    await clock.time("server_writes", () => writeAll(wave2, ctx, progress));
    return merged;
  }
  async function writeAll(decisions, ctx, progress, isRepair) {
    const todo = isRepair ? decisions : decisionsToWrite(decisions);
    let done2 = 0;
    for (const d of todo) {
      progress(
        isRepair ? "repairing" : "filling",
        { done: done2, total: todo.length, detail: d.label }
      );
      done2++;
      const fieldStart = clock.now();
      if (d.action === DOCUMENT) {
        const result2 = await attachDocument(d, ctx);
        clock.field({ label: d.label, kind: "file", ms: clock.now() - fieldStart, outcome: result2.ok ? "ok" : "failed" });
        d.outcome = result2.ok ? "ok" : "failed";
        d.shown = result2.shown || "";
        d.formRead = !!result2.formRead;
        if (!result2.ok) {
          d.action = ASK;
          d.reason = "attach this one yourself";
        }
        continue;
      }
      const result = await applyDecision(d);
      clock.field({
        label: d.label,
        kind: d.row && d.row.kind,
        ms: clock.now() - fieldStart,
        outcome: result.outcome
      });
      d.outcome = result.outcome;
      d.shown = result.shown;
      if (result.ok) {
        if (d.key) state.registry[d.key] = d.value;
      } else if (!isRepair) {
      }
    }
    if (isRepair) {
      for (const d of todo) {
        if (d.outcome !== "ok") {
          d.action = ASK;
          d.reason = outcomeReason(d);
        }
      }
    }
    return decisions;
  }
  function outcomeReason(d) {
    switch (d.outcome) {
      case "rejected":
        return `the form rejected "${d.value}"`;
      case "empty":
        return "we could not get this to stick";
      case "mismatch":
        return `the form shows "${d.shown}" instead`;
      default:
        return "we could not fill this one";
    }
  }
  var attachedThisRun = /* @__PURE__ */ new Set();
  async function attachDocument(decision, ctx) {
    const slot = decision.slot;
    if (slot && attachedThisRun.has(slot)) {
      console.info(`[TailorCV] ${slot} already attached this run \u2014 skipping "${decision.label}"`);
      return { ok: true, shown: "already attached" };
    }
    console.info(`[TailorCV] attaching ${slot || "a document"} to "${decision.label}"`);
    const res = await send({ type: "AF_GET_RESUME_FILE", doc: slot });
    if (res.error || !res.data || !res.data.base64) {
      return { ok: false, shown: "" };
    }
    const { base64, filename, mime } = res.data;
    let file;
    try {
      file = fileFromBase64(base64, filename, mime);
    } catch (e) {
      return { ok: false, shown: "" };
    }
    const target = decision.row.el;
    if (decision.row.dropOnly) {
      const dropped = dropFile(target, file);
      if (slot && dropped) attachedThisRun.add(slot);
      await sleep(TIMING.settleMs + 120);
      return { ok: false, shown: dropped ? `${file.name} (check it attached)` : "" };
    }
    const set = attachFile(target, file);
    if (slot) attachedThisRun.add(slot);
    if (!set) {
      const zone = findDropZone(target);
      if (zone) dropFile(zone, file);
    }
    const deadline = Date.now() + TIMING.uploadConfirmMs;
    let attached = false;
    await sleep(TIMING.settleMs + 120);
    for (; ; ) {
      attached = !!(target.files && target.files.length) || hasUploadedFile(target);
      if (attached || Date.now() >= deadline) break;
      await sleep(150);
    }
    const formRead = await waitWhileReadingResume(target);
    return { ok: attached, shown: attached ? file.name : "", formRead };
  }
  async function waitWhileReadingResume(input) {
    await sleep(TIMING.resumeParseStartMs);
    if (!input || !input.isConnected || !input.disabled) return false;
    console.info("[TailorCV] the form is reading the resume \u2014 waiting for it to finish before filling on");
    const deadline = Date.now() + TIMING.resumeParseMaxMs;
    while (input.isConnected && input.disabled && Date.now() < deadline) await sleep(250);
    await sleep(TIMING.settleMs + 300);
    return true;
  }
  async function answerField(decision, value, remember) {
    decision.value = String(value == null ? "" : value);
    if (decision.readFirst) decision.readFirst = { key: "", stored: decision.value };
    decision.candidates = [];
    decision.drill = null;
    decision.hierarchy = null;
    const result = await applyDecision(decision);
    decision.outcome = result.outcome;
    decision.shown = result.shown;
    if (result.ok) {
      decision.action = FILL;
      decision.source = "you";
      decision.confidence = 1;
      decision.reason = "you answered this";
      if (decision.key) {
        state.registry[decision.key] = decision.value;
        state.answeredByUser[decision.key] = decision.value;
        if (!state.userEdited.includes(decision.key)) state.userEdited.push(decision.key);
      }
      await saveState();
    } else {
      decision.reason = outcomeReason(decision);
    }
    if (remember && result.ok && storable(decision.label, decision.sensitive, decision.employer) && !isNeverFill(decision.label) && !looksSecret(decision.value)) {
      await send({ type: "AF_SAVE_ANSWERS", payload: { answers: [
        { question: decision.label, answer: decision.value }
      ] } });
    }
    return result;
  }
  async function rememberAnswers(items) {
    const answers = (items || []).filter((i) => i && i.question && i.answer).map((i) => ({ question: i.question, answer: i.answer })).slice(0, 25);
    if (!answers.length) return { saved: 0 };
    const res = await send({ type: "AF_SAVE_ANSWERS", payload: { answers } });
    if (res && res.data) return res.data;
    const reloaded = "The extension was reloaded \u2014 refresh this page and try again.";
    const error = res && res.error;
    return { saved: 0, error: !error || /context invalidated/i.test(error) ? reloaded : error };
  }

  // src/autofill/ui.js
  var ui_exports = {};
  __export(ui_exports, {
    PHASE_TEXT: () => PHASE_TEXT,
    clearHighlights: () => clearHighlights,
    displayDate: () => displayDate,
    highlight: () => highlight,
    jumpTo: () => jumpTo,
    renderReady: () => renderReady,
    renderResults: () => renderResults,
    renderRunning: () => renderRunning,
    setPhase: () => setPhase
  });
  var probe5 = () => globalThis.__tcvFieldProbe;
  var HIGHLIGHT_STYLE_ID = "tailorcv-af-styles";
  var HIGHLIGHT_CSS = `
.tcv-af-hl { outline: 2px solid rgba(79,127,255,0.9) !important;
  outline-offset: 2px !important; border-radius: 4px !important; }
.tcv-af-hl-ok { outline-color: rgba(74,222,128,0.9) !important; }
.tcv-af-hl-review { outline-color: rgba(252,211,77,0.95) !important; }
.tcv-af-hl-ask { outline-color: rgba(96,165,250,0.95) !important; }
.tcv-af-hl-bad { outline-color: rgba(248,113,113,0.95) !important; }
@keyframes tcvAfPulse {
  0%, 100% { outline-color: rgba(79,127,255,0.25); }
  50% { outline-color: rgba(79,127,255,1); }
}
.tcv-af-pulse { animation: tcvAfPulse 0.6s ease-in-out 2 !important; }
`;
  function ensureHighlightStyles() {
    const doc = globalThis.document;
    if (doc.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = HIGHLIGHT_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
  function esc(s) {
    const d = globalThis.document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  var highlighted = [];
  var HL_CLASS = {
    [FILL]: "tcv-af-hl-ok",
    [SUGGEST]: "tcv-af-hl-review",
    [ASK]: "tcv-af-hl-ask",
    [PROFILE]: "tcv-af-hl-ask",
    [DOCUMENT]: "tcv-af-hl-ok"
  };
  function highlight(decisions) {
    clearHighlights();
    ensureHighlightStyles();
    const p = probe5();
    for (const d of decisions || []) {
      if (d.action === SKIP) continue;
      const el = d.row && d.row.el;
      if (!el || !el.isConnected) continue;
      const node = p && p.fieldWrapper(el) || el;
      const cls = d.outcome && d.outcome !== "ok" && d.value ? "tcv-af-hl-bad" : HL_CLASS[d.action];
      if (!cls) continue;
      node.classList.add("tcv-af-hl", cls);
      highlighted.push([node, cls]);
    }
  }
  function clearHighlights() {
    for (const [node, cls] of highlighted) {
      try {
        node.classList.remove("tcv-af-hl", cls, "tcv-af-pulse");
      } catch (e) {
      }
    }
    highlighted = [];
  }
  function jumpTo(decision) {
    const p = probe5();
    const el = decision.row && decision.row.el;
    if (!el || !el.isConnected) return;
    const node = p && p.fieldWrapper(el) || el;
    try {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (e) {
    }
    ensureHighlightStyles();
    node.classList.add("tcv-af-hl", "tcv-af-pulse");
    setTimeout(() => {
      try {
        node.classList.remove("tcv-af-pulse");
      } catch (e) {
      }
    }, 1400);
  }
  var GROUPS = [
    { action: FILL, title: "Filled", badge: "ok", icon: "\u2713" },
    { action: SUGGEST, title: "Needs your review", badge: "review", icon: "!" },
    { action: DOCUMENT, title: "Attached", badge: "ok", icon: "\u2713" },
    { action: ASK, title: "Needs your answer", badge: "ask", icon: "?" },
    { action: PROFILE, title: "Set once in your profile", badge: "ask", icon: "?" },
    // Left exactly as the ATS filled them from the resume (Oracle's profile
    // import). Listed so a misread value is easy to spot; never overwritten.
    {
      title: "Filled by the form from your resume \u2014 check these",
      badge: "review",
      icon: "\u2713",
      match: (d) => d.byForm
    }
  ];
  var SOURCE_LABEL = {
    profile: "your profile",
    saved_answer: "a saved answer",
    ai: "AI",
    ai_written: "AI, written for this job",
    ai_forced: "AI, from your resume",
    standard: "a standard answer",
    you: "you"
  };
  function renderReady(body, form, ctx, handlers, extra) {
    const count = (form && form.fields || []).length;
    const blockers = ctx && ctx.blockers || [];
    const quotaOut = ctx && ctx.quota && ctx.quota.exhausted;
    const page = extra && extra.page || 0;
    body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-card tcv-job-card">
        <div class="tcv-job-main">
          <div class="tcv-job-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>
          </div>
          <div class="tcv-job-text">
            <div class="tcv-job-title">${page > 1 ? `Page ${esc(page)} of this application` : "Application form detected"}</div>
            <div class="tcv-job-meta">${esc(count)} field${count === 1 ? "" : "s"} on this page${form && form.ats && form.ats !== "generic" ? ` \xB7 ${esc(form.ats)}` : ""}</div>
          </div>
        </div>
      </div>
      ${form && form.tilesOnly ? `
        <div class="tcv-af-note">
          This step lists your Education and Experience entries. Autofill opens
          each one the form marks as needing a fix, fills it from your profile,
          and saves it.
        </div>` : !count ? `
        <div class="tcv-af-note">
          No fields found on this step yet. If a section opens with <b>Add</b>
          (Work Experience, Education), open it first, then autofill this page.
        </div>` : ""}
      ${blockers.length ? `
        <div class="tcv-af-note">
          ${esc(blockers[0])}
          <a href="#" id="tcvAfProfileLink">Open your profile \u2192</a>
        </div>` : ""}
      ${quotaOut ? `
        <div class="tcv-af-note">
          You've used your free autofills. <a href="#" id="tcvAfUpgrade">Upgrade to Pro \u2192</a>
        </div>` : `
        <button class="tcv-btn tcv-btn-start tcv-btn-cta" id="tcvAfFillBtn">${page > 1 ? "Autofill this page" : "Autofill this application"} <span aria-hidden="true">\u25B8</span></button>
        ${form && form.ats === "workday" && handlers.onAutoApply ? `
        <button class="tcv-btn tcv-btn-outline-accent" id="tcvAfAutoBtn">\u23E9 Auto-apply all pages</button>
        <div class="tcv-af-note tcv-af-note-quiet">Fills each page and clicks Save and Continue,
          pausing only for what it can't fill. It stops at Review \u2014 you click Submit.</div>` : ""}`}
      <button class="tcv-btn tcv-btn-outline-accent" id="tcvAfTailorBtn">\u2726 Tailor my resume for this job</button>
      <div class="tcv-af-note tcv-af-note-quiet">
        TailorCV never submits an application. You review everything and send it yourself.
      </div>
    </div>`;
    const fill = body.querySelector("#tcvAfFillBtn");
    if (fill) fill.addEventListener("click", () => handlers.onFill());
    const auto = body.querySelector("#tcvAfAutoBtn");
    if (auto) auto.addEventListener("click", () => handlers.onAutoApply());
    const tailor = body.querySelector("#tcvAfTailorBtn");
    if (tailor) tailor.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onTailor();
    });
    bindLink(body, "#tcvAfProfileLink", handlers.onOpenProfile);
    bindLink(body, "#tcvAfUpgrade", handlers.onUpgrade);
  }
  function bindLink(body, selector, fn) {
    const el = body.querySelector(selector);
    if (el && typeof fn === "function") {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        fn();
      });
    }
  }
  function renderResults(body, result, ctx, handlers) {
    const decisions = result.decisions || [];
    const counts = result.counts || {};
    const filled = (counts[FILL] || 0) + (counts[DOCUMENT] || 0);
    const byForm = decisions.filter((d) => d.byForm).length;
    body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-af-summary" id="tcvAfSummary">
        ${pill("ok", `${filled} filled`)}
        ${byForm ? pill("review", `${byForm} from your resume`) : ""}
        ${counts[SUGGEST] ? pill("review", `${counts[SUGGEST]} to review`) : ""}
        ${counts[ASK] ? pill("ask", `${counts[ASK]} need you`) : ""}
        ${counts[PROFILE] ? pill("ask", `${counts[PROFILE]} for your profile`) : ""}
      </div>
      ${result.page > 1 ? `<div class="tcv-source">Page ${esc(result.page)} of this application</div>` : ""}
      ${autoBannerHtml(handlers.auto, decisions)}
      <button class="tcv-btn tcv-btn-start" id="tcvAfRerun">\u21BB Autofill this page</button>
      ${result.serverError ? `<div class="tcv-af-note">${esc(result.serverError)}</div>` : ""}
      ${result.opaqueHosts ? `<div class="tcv-af-note tcv-af-note-quiet">
        ${esc(result.opaqueHosts)} field group(s) on this page are built in a way
        we can't read \u2014 check those by hand.</div>` : ""}
      <div id="tcvAfBody">${GROUPS.map((g) => groupHtml(g, decisions)).join("")}</div>
      <div class="tcv-af-note tcv-af-note-quiet">
        Review everything, then submit the application yourself. TailorCV never
        submits for you.
      </div>
      <div class="tcv-af-note tcv-af-note-quiet">
        Something filled wrong? <a href="#" id="tcvAfEditProfile">Edit your application
        profile</a> \u2014 name, address, phone and eligibility answers all come from there.
      </div>
    </div>`;
    wireRows(body, decisions, ctx, handlers);
    wireAutoBanner(body, handlers.auto);
    const rerun = body.querySelector("#tcvAfRerun");
    if (rerun) rerun.addEventListener("click", () => handlers.onFill());
    bindLink(body, "#tcvAfEditProfile", handlers.onOpenProfile);
    if (decisions.length && decisions[0].row) highlight(decisions);
    offerToRemember(body, result, handlers);
  }
  function autoBannerHtml(auto, decisions) {
    if (!auto) return "";
    const blockers = auto.blockers || [];
    const list = blockers.length ? `<ul class="tcv-af-auto-list">${blockers.map((b) => {
      const i = decisions.indexOf(b.decision);
      return `<li>${esc(b.label)} \u2014 ${esc(b.reason)}${i >= 0 ? ` <a href="#" class="tcv-af-jump" data-index="${i}">show</a>` : ""}</li>`;
    }).join("")}</ul>` : "";
    const title = auto.state === "done" ? "\u2713 Ready to submit" : auto.state === "paused" ? `\u23F8 Auto-apply paused${blockers.length ? ` \u2014 ${blockers.length} field${blockers.length === 1 ? "" : "s"} need${blockers.length === 1 ? "s" : ""} you` : ""}` : "Auto-apply stopped";
    return `
    <div class="tcv-af-auto tcv-af-auto-${esc(auto.state || "paused")}" id="tcvAfAuto">
      <div class="tcv-af-auto-title">${esc(title)}</div>
      ${auto.message ? `<div class="tcv-af-auto-msg">${esc(auto.message)}</div>` : ""}
      ${list}
      ${auto.state === "paused" ? `
        <div class="tcv-af-auto-actions">
          <button class="tcv-btn tcv-btn-start tcv-btn-cta" id="tcvAfAutoContinue">Continue auto-apply \u25B8</button>
          <button class="tcv-btn tcv-btn-outline-accent" id="tcvAfAutoStop">Stop</button>
        </div>` : ""}
    </div>`;
  }
  function wireAutoBanner(body, auto) {
    if (!auto) return;
    const go = body.querySelector("#tcvAfAutoContinue");
    if (go && auto.onContinue) go.addEventListener("click", () => auto.onContinue());
    const stop = body.querySelector("#tcvAfAutoStop");
    if (stop && auto.onStop) stop.addEventListener("click", () => auto.onStop());
  }
  function pill(kind, text) {
    return `<span class="tcv-af-summary-pill tcv-af-${esc(kind)}">${esc(text)}</span>`;
  }
  function groupHtml(group, decisions) {
    const rows = decisions.filter(group.match || ((d) => d.action === group.action));
    if (!rows.length) return "";
    return `
    <div class="tcv-af-group">
      <div class="tcv-af-group-title">${esc(group.title)} \xB7 ${rows.length}</div>
      ${rows.map((d) => rowHtml(group, d, decisions.indexOf(d))).join("")}
    </div>`;
  }
  function displayDate(text) {
    const s = String(text || "").trim();
    const pad2 = (n) => String(n).padStart(2, "0");
    let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
    if (m) return m[3] ? `${pad2(m[2])}-${pad2(m[3])}-${m[1]}` : `${pad2(m[2])}-${m[1]}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${pad2(m[1])}-${pad2(m[2])}-${m[3]}`;
    m = /^(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${pad2(m[1])}-${m[2]}`;
    return s;
  }
  function rowHtml(group, d, index) {
    const needsInput = d.action === ASK && d.kind !== "file" && !d.slot;
    const value = d.kind === "date-parts" ? displayDate(d.shown || d.value) : d.shown || d.value;
    return `
    <div class="tcv-af-row" data-index="${index}">
      <div class="tcv-af-row-head">
        <span class="tcv-af-badge tcv-af-${esc(group.badge)}">${esc(group.icon)}</span>
        <span class="tcv-af-row-label">${esc(d.label || "(unlabelled field)")}</span>
        <a href="#" class="tcv-af-jump" data-index="${index}">show</a>
      </div>
      ${value ? `<div class="tcv-af-row-value">${esc(truncate2(value, 120))}</div>` : ""}
      ${d.source ? `<div class="tcv-af-row-src">from ${esc(SOURCE_LABEL[d.source] || d.source)}${d.reason ? ` \xB7 ${esc(d.reason)}` : ""}</div>` : d.reason ? `<div class="tcv-af-row-src">${esc(d.reason)}</div>` : ""}
      ${needsInput ? askFormHtml(d, index) : ""}
    </div>`;
  }
  function askFormHtml(d, index) {
    const options = (d.options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean);
    const control = options.length && options.length <= 40 ? `<select class="tcv-af-ask-select" data-index="${index}">
         <option value="">Choose\u2026</option>
         ${options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
       </select>` : `<input class="tcv-af-ask-input" data-index="${index}" type="text"
              placeholder="Your answer">`;
    const neverSaved = d.sensitive && !STORABLE_SENSITIVE.has(d.sensitive);
    return `
    <div class="tcv-af-ask-form">
      ${control}
      ${neverSaved ? `
      <div class="tcv-af-remember">Used on this form only \u2014 never saved.</div>` : `
      <label class="tcv-af-remember">
        <input type="checkbox" class="tcv-af-remember-box" data-index="${index}" checked>
        Remember this answer
      </label>`}
      <button class="tcv-btn tcv-btn-outline tcv-af-ask-save" data-index="${index}">
        Save &amp; fill
      </button>
    </div>`;
  }
  function truncate2(s, n) {
    const t = String(s == null ? "" : s);
    return t.length <= n ? t : `${t.slice(0, n - 1)}\u2026`;
  }
  function wireRows(body, decisions, ctx, handlers) {
    for (const link of body.querySelectorAll(".tcv-af-jump")) {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const index = Number(link.dataset.index);
        const d = decisions[index];
        if (!d) return;
        if (d.row) jumpTo(d);
        else if (handlers.onJump) handlers.onJump(index);
      });
    }
    for (const btn of body.querySelectorAll(".tcv-af-ask-save")) {
      btn.addEventListener("click", async () => {
        const index = Number(btn.dataset.index);
        const d = decisions[index];
        if (!d) return;
        const input = body.querySelector(
          `.tcv-af-ask-input[data-index="${index}"], .tcv-af-ask-select[data-index="${index}"]`
        );
        const value = input ? String(input.value || "").trim() : "";
        if (!value) return;
        const rememberBox = body.querySelector(`.tcv-af-remember-box[data-index="${index}"]`);
        const remember = rememberBox ? rememberBox.checked : false;
        btn.disabled = true;
        btn.textContent = "Saving\u2026";
        const res = d.row ? await answerField(d, value, remember) : await handlers.onAnswer(index, value, remember);
        if (res && res.ok) {
          handlers.onRefresh();
        } else {
          btn.disabled = false;
          btn.textContent = "Save & fill";
          const row = btn.closest(".tcv-af-row");
          if (row) {
            const note = globalThis.document.createElement("div");
            note.className = "tcv-af-row-src";
            note.textContent = res && res.reason || d.reason || "That did not take \u2014 try filling it directly.";
            row.appendChild(note);
          }
        }
      });
    }
  }
  function offerToRemember(body, result, handlers) {
    const decisions = result.decisions || [];
    const local = !!(decisions.length && decisions[0].row);
    const learnable = result.learnable || (local ? learnableAnswers(decisions) : []);
    if (!learnable.length) return;
    const host = body.querySelector("#tcvAfBody");
    if (!host) return;
    const box = globalThis.document.createElement("div");
    box.className = "tcv-af-group";
    box.innerHTML = `
    <div class="tcv-af-group-title">Remember for next time \xB7 ${learnable.length}</div>
    <div class="tcv-af-row">
      <div class="tcv-af-row-src">
        You answered ${learnable.length} question${learnable.length === 1 ? "" : "s"} we
        didn't have. Save ${learnable.length === 1 ? "it" : "them"} for future applications?
      </div>
      <div class="tcv-af-row-value">${learnable.map((l) => esc(truncate2(l.question, 70))).join("<br>")}</div>
      <button class="tcv-btn tcv-btn-outline" id="tcvAfRemember">Save ${learnable.length === 1 ? "answer" : "answers"}</button>
    </div>`;
    host.appendChild(box);
    const btn = box.querySelector("#tcvAfRemember");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Saving\u2026";
      const res = !local && handlers && handlers.onRemember ? await handlers.onRemember(learnable) : await rememberAnswers(learnable);
      if (res && res.saved) {
        btn.textContent = `\u2713 Saved ${res.saved}`;
        return;
      }
      btn.textContent = "Could not save";
      const why = res && res.error ? res.error : res && res.rejected ? "We don't store answers to sensitive questions \u2014 set these in your profile." : "Nothing was saved.";
      const note = globalThis.document.createElement("div");
      note.className = "tcv-af-row-src";
      note.textContent = why;
      btn.after(note);
    });
  }
  function renderRunning(body, phase, auto) {
    body.innerHTML = `
    <div class="tcv-af-panel">
      ${auto ? `<div class="tcv-af-auto tcv-af-auto-running">
        <div class="tcv-af-auto-title">\u23E9 Auto-apply \xB7 page ${esc(auto.page || 1)}</div>
        <div class="tcv-af-auto-msg">Filling each page and moving on. It stops at Review.</div>
      </div>` : ""}
      <div class="tcv-status-text" id="tcvAfPhase">${esc(phase || "Reading the form\u2026")}</div>
      ${auto && auto.onStop ? `<button class="tcv-btn tcv-btn-outline-accent" id="tcvAfAutoStop">Stop after this page</button>` : ""}
    </div>`;
    const stop = body.querySelector("#tcvAfAutoStop");
    if (stop) {
      stop.addEventListener("click", () => {
        stop.disabled = true;
        stop.textContent = "Stopping after this page\u2026";
        auto.onStop();
      });
    }
  }
  function setPhase(body, text) {
    const el = body.querySelector("#tcvAfPhase");
    if (el) el.textContent = text;
  }
  var PHASE_TEXT = {
    scanning: "Reading the form\u2026",
    reading: "Checking what the dropdowns offer\u2026",
    thinking: "Working out the answers\u2026",
    filling: "Filling the form\u2026",
    repairing: "Fixing what didn\u2019t take\u2026",
    resume: "Answering the required questions left, from your resume\u2026"
  };

  // src/autofill/capture.js
  var MAX_CHARS = 4e5;
  var EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  var PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
  function stripQuery(url) {
    try {
      const u = new URL(url, globalThis.location && globalThis.location.href);
      return `${u.origin}${u.pathname}`;
    } catch (e) {
      return "";
    }
  }
  var MAX_ATTR_CHARS = 300;
  function scrubText(text, secrets) {
    let t = String(text || "");
    for (const re of secrets) t = t.replace(re, "[redacted]");
    return t.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[number]");
  }
  function secretsFrom(values) {
    const out = /* @__PURE__ */ new Set();
    for (const v of values || []) {
      const s = String(v == null ? "" : v).trim();
      if (s.length >= 3) out.add(s);
    }
    return [...out].sort((a, b) => b.length - a.length).map((s) => new RegExp(`(?<![A-Za-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "gi"));
  }
  function sanitize(node, secrets) {
    for (const el of node.querySelectorAll("script, style, noscript, link, meta, template")) el.remove();
    for (const el of node.querySelectorAll("svg")) el.replaceChildren();
    for (const el of node.querySelectorAll("textarea")) el.textContent = "";
    for (const el of node.querySelectorAll('[contenteditable="true"]')) el.textContent = "";
    for (const el of node.querySelectorAll('button[aria-haspopup="listbox"]')) {
      if (!/^(select one|none selected|choose one)$/i.test((el.textContent || "").trim())) el.textContent = "[chosen value]";
    }
    for (const el of node.querySelectorAll('[data-automation-id="selectedItem"]')) el.textContent = "[chosen value]";
    for (const el of [node, ...node.querySelectorAll("*")]) {
      const tag = (el.tagName || "").toLowerCase();
      const type = (el.getAttribute && (el.getAttribute("type") || "")).toLowerCase();
      for (const attr of Array.from(el.attributes || [])) {
        const name = attr.name.toLowerCase();
        if (name === "style" || name === "params" || name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === "value" && !(tag === "option" || type === "radio" || type === "checkbox" || type === "submit" || type === "button")) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === "href" || name === "src" || name === "action" || name === "srcset") {
          el.setAttribute(attr.name, name === "srcset" ? "" : stripQuery(attr.value));
          continue;
        }
        let clean2 = scrubText(attr.value, secrets).replace(/\s+/g, " ").trim();
        if (clean2.length > MAX_ATTR_CHARS) clean2 = clean2.slice(0, MAX_ATTR_CHARS) + "\u2026";
        if (clean2 !== attr.value) el.setAttribute(attr.name, clean2);
      }
    }
    const walker = node.ownerDocument.createTreeWalker(node, 128 | 4);
    const drop = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 8) {
        drop.push(n);
        continue;
      }
      const collapsed = n.nodeValue.replace(/\s+/g, " ");
      if (collapsed === " ") {
        n.nodeValue = "\n";
        continue;
      }
      n.nodeValue = scrubText(collapsed, secrets);
    }
    for (const n of drop) n.remove();
  }
  function capturePageStructure(doc, profileValues) {
    const d = doc || globalThis.document;
    const secrets = secretsFrom(profileValues);
    const form = findForm(d);
    let root = form ? form.root : d.body;
    for (let i = 0; i < 2 && root.parentElement && root.parentElement !== d.body && root.parentElement !== d.documentElement; i++) {
      root = root.parentElement;
    }
    const clone = root.cloneNode(true);
    for (const el of clone.querySelectorAll("#tailorcv-sidebar, #tailorcv-launcher")) el.remove();
    sanitize(clone, secrets);
    const popups = new Set(d.querySelectorAll('[role="listbox"], [role="grid"]'));
    for (const c of d.querySelectorAll('[aria-expanded="true"][aria-controls]')) {
      const target = d.getElementById(c.getAttribute("aria-controls"));
      if (target) popups.add(target);
    }
    const lists = Array.from(popups).filter((l) => !root.contains(l) && !l.closest("#tailorcv-sidebar")).filter((l, _, all) => !all.some((o) => o !== l && o.contains(l))).map((l) => {
      const c = l.cloneNode(true);
      sanitize(c, secrets);
      return c.outerHTML;
    });
    let detected = [];
    try {
      detected = (form ? describeFields(form) : []).map((r) => ({
        label: scrubText(r.label, secrets).slice(0, 160),
        kind: r.kind,
        required: !!r.required,
        options: (r.options || []).length
      }));
    } catch (e) {
      detected = [{ error: String(e && e.message) }];
    }
    const url = stripQuery(d.location ? d.location.href : "");
    const header = [
      "<!-- TailorCV page structure",
      `  url: ${url}`,
      `  ats: ${detectAts(d.location ? d.location.href : "")}`,
      `  form found: ${form ? "yes (score " + form.score + ")" : "no"}`,
      `  captured: ${(/* @__PURE__ */ new Date()).toISOString()}`,
      `  detected fields: ${JSON.stringify(detected)}`,
      "-->"
    ].join("\n");
    let text = `${header}
${clone.outerHTML}` + (lists.length ? `
<!-- open option lists -->
${lists.join("\n")}` : "");
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n<!-- truncated -->";
    return text;
  }

  // src/autofill.js
  var isTopFrame = globalThis.window === globalThis.window.parent;
  function serializeDecision(d, index) {
    return {
      index,
      key: d.key,
      label: d.label,
      kind: d.kind,
      required: d.required,
      sensitive: d.sensitive,
      slot: d.slot,
      action: d.action,
      value: d.value,
      source: d.source,
      confidence: d.confidence,
      reason: d.reason,
      byForm: !!d.byForm,
      outcome: d.outcome,
      shown: d.shown,
      options: (d.options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean)
    };
  }
  var lastRunDecisions = [];
  async function handleFrameMessage(msg) {
    switch (msg && msg.type) {
      case "AF_FRAME_CAPTURE":
        return { text: capturePageStructure(globalThis.document, msg.profileValues) };
      case "AF_PING": {
        const form = isApplicationPage();
        return form ? {
          found: true,
          fieldCount: (form.fields || []).length,
          url: globalThis.location.href,
          ats: form.ats
        } : { found: false };
      }
      case "AF_FRAME_APPLY": {
        const result = await runAutofill(msg.ctx, null);
        lastRunDecisions = result.decisions || [];
        return {
          error: result.error,
          counts: result.counts,
          page: result.page,
          ats: result.ats,
          opaqueHosts: result.opaqueHosts,
          serverError: result.serverError,
          timing: result.timing,
          decisions: lastRunDecisions.map(serializeDecision),
          learnable: learnableAnswers(lastRunDecisions).map((l) => ({
            key: l.key,
            question: l.question,
            answer: l.answer
          }))
        };
      }
      case "AF_FRAME_ANSWER": {
        const d = lastRunDecisions[msg.index];
        if (!d) return { error: "stale_index" };
        const res = await answerField(d, msg.value, msg.remember);
        return {
          ok: res.ok,
          outcome: res.outcome,
          shown: res.shown,
          decision: serializeDecision(d, msg.index)
        };
      }
      case "AF_FRAME_JUMP": {
        const d = lastRunDecisions[msg.index];
        if (!d) return { error: "stale_index" };
        jumpTo(d);
        return { ok: true };
      }
      case "AF_FRAME_REMEMBER":
        return await rememberAnswers(msg.items);
      case "AF_FRAME_CLEAR":
        clearHighlights();
        return { ok: true };
      default:
        return null;
    }
  }
  if (!globalThis.__tcvAutofill) {
    globalThis.__tcvAutofill = {
      // Detection — cheap enough for content.js to call on every render.
      isApplicationPage,
      findForm,
      detectAts,
      isNodeVisible,
      looksLikeApplyUrl,
      diagnose,
      isTopFrame,
      serializeDecision,
      // The run.
      runAutofill,
      resumeIfContinuing,
      nextPage,
      clearState,
      getState,
      answerField,
      rememberAnswers,
      learnableAnswers,
      watchUserEdits,
      stopWatchingUserEdits,
      pageBlockers,
      waitForQuiet,
      forceAnswers,
      // Inspection, for the panel and for debugging a page by hand.
      capturePageStructure,
      describeFields,
      decide,
      summarize,
      fieldsForServer,
      reprobe,
      // The panel.
      ui: ui_exports,
      ACTIONS: { ASK, FILL, SUGGEST, PROFILE, DOCUMENT, SKIP },
      // Exposed so a page can be diagnosed from the console without a rebuild —
      // the same reasoning as content.js's logDiagnostics(): a real page's own
      // shape is worth more than any amount of guessing from outside the browser.
      match: match_exports,
      selfTest,
      handleFrameMessage
    };
  }
  async function selfTest() {
    const ctx = globalThis.__tcvFixtureCtx;
    if (!ctx) {
      console.warn("[TailorCV] selfTest() needs window.__tcvFixtureCtx \u2014 see test/fixtures/pages");
      return null;
    }
    const plan = globalThis.__tcvFixturePlan || { answers: {} };
    const bytes = globalThis.__tcvFixtureResume || "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDM+PnN0cmVhbQpCVAplbmRzdHJlYW0=";
    const realSend = globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.sendMessage;
    const stub = (msg, cb) => {
      const reply = {
        AF_PLAN: { data: plan },
        AF_GET_RESUME_FILE: { data: {
          base64: bytes,
          filename: "fixture.pdf",
          mime: "application/pdf"
        } },
        AF_SAVE_ANSWERS: { data: { saved: 0 } }
      }[msg.type] || { data: null };
      cb(reply);
    };
    if (!globalThis.chrome) globalThis.chrome = { runtime: {} };
    if (!globalThis.chrome.runtime) globalThis.chrome.runtime = {};
    globalThis.chrome.runtime.sendMessage = stub;
    try {
      await clearState();
      const result = await runAutofill(ctx, (p) => console.log("[TailorCV]", p.phase, p.detail || ""));
      const expected = globalThis.__tcvFixtureExpect || {};
      const rows = (result.decisions || []).map((d) => ({
        field: d.label,
        action: d.action,
        expected: expected[d.key] || expected[d.label] || "(unspecified)",
        match: !expected[d.key] && !expected[d.label] ? "\u2014" : (expected[d.key] || expected[d.label]) === d.action ? "OK" : "MISMATCH",
        value: String(d.value || "").slice(0, 50),
        verified: d.outcome || "",
        why: d.reason || ""
      }));
      console.table(rows);
      const bad = rows.filter((r) => r.match === "MISMATCH");
      const unverified = rows.filter((r) => r.value && r.verified && r.verified !== "ok");
      console.log(`[TailorCV] ${rows.length} fields \xB7 ${bad.length} mismatched \xB7 ${unverified.length} written but not verified`);
      if (bad.length) console.warn("[TailorCV] mismatches:", bad);
      if (unverified.length) console.warn("[TailorCV] unverified:", unverified);
      highlight(result.decisions || []);
      return { result, rows, mismatches: bad, unverified };
    } finally {
      if (realSend) globalThis.chrome.runtime.sendMessage = realSend;
    }
  }
  if (!isTopFrame && globalThis.chrome && globalThis.chrome.runtime) {
    let logFrameDiagnostics = function() {
      if (!looksLikeApplyUrl(globalThis.location.href)) return;
      try {
        const report = diagnose();
        console.groupCollapsed(
          "%c[TailorCV] autofill could not find a form in this frame \u2014 diagnostics",
          "color:#7c3aed;font-weight:700"
        );
        console.log("frame:", globalThis.location.href);
        console.log(report.summary);
        if (report.roots.length) console.table(report.roots);
        if (report.fields.length) console.table(report.fields);
        if (report.uncovered.length) console.table(report.uncovered);
        console.groupEnd();
      } catch (e) {
        console.warn("[TailorCV] frame diagnostics failed \u2014", e && e.message);
      }
    };
    globalThis.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !String(msg.type || "").startsWith("AF_")) return void 0;
      handleFrameMessage(msg).then((res) => sendResponse(res || {}));
      return true;
    });
    const announce = () => {
      let form = null;
      try {
        form = isApplicationPage();
      } catch (e) {
        form = null;
      }
      if (!form) return false;
      try {
        globalThis.chrome.runtime.sendMessage({
          type: "AF_FRAME_ANNOUNCE",
          fieldCount: (form.fields || []).length,
          url: globalThis.location.href,
          ats: form.ats
        });
      } catch (e) {
      }
      return true;
    };
    setTimeout(() => {
      if (announce()) return;
      setTimeout(() => {
        if (!announce()) logFrameDiagnostics();
      }, 2500);
    }, 800);
  }
})();
