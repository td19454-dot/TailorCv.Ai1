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
        if (isFormLevel(n)) break;
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
    function isFormLevel(n) {
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
        if (isFormLevel(n)) break;
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
        if (isFormLevel(n)) break;
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
      let aria = attr(el, "aria-label");
      if (shown) aria = aria.split(shown).join(" ");
      return aria.replace(/\brequired\b/ig, "").replace(/\s+/g, " ").trim();
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
    function optionNodes(scope) {
      let nodes = [];
      try {
        nodes = Array.prototype.slice.call((scope || document).querySelectorAll(OPTION_SEL));
      } catch (e) {
        return [];
      }
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
    FIELD_SYNONYMS: () => FIELD_SYNONYMS,
    LABEL_STOPWORDS: () => LABEL_STOPWORDS,
    OPTION_MATCH_THRESHOLD: () => OPTION_MATCH_THRESHOLD,
    SENSITIVE_PATTERNS: () => SENSITIVE_PATTERNS,
    bestOptionMatch: () => bestOptionMatch,
    classifySensitive: () => classifySensitive,
    commitMatches: () => commitMatches,
    distinctive: () => distinctive,
    documentSlotFor: () => documentSlotFor,
    findDeclineOption: () => findDeclineOption,
    formatDateForField: () => formatDateForField,
    isNeverFill: () => isNeverFill,
    isPlaceholderOption: () => isPlaceholderOption,
    labelsMatch: () => labelsMatch,
    looksLikeDecline: () => looksLikeDecline,
    looksLikeEeoField: () => looksLikeEeoField,
    looksSecret: () => looksSecret,
    matchFieldKey: () => matchFieldKey,
    normalizeOptionText: () => normalizeOptionText,
    parseLooseDate: () => parseLooseDate,
    questionSignature: () => questionSignature,
    similarity: () => similarity,
    splitPhone: () => splitPhone
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
      let score = similarity(normValue, normLabel);
      if (normLabel.includes(normValue) || normValue.includes(normLabel)) {
        score = Math.max(score, 0.75);
      }
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
    ["sponsorship", /\bsponsor\w*|\bvisa\b|\bh1b\b|\bh 1b\b|\bwork permit\b|\bimmigration status\b|\bopt\b|\bcpt\b/],
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
    ["citizenship", /\bcitizen\w*|\bnationality\b|\bpermanent resident\b|\bgreen card\b/],
    ["clearance", /\bsecurity clearance\b|\bclearance level\b|\bpolygraph\b/],
    ["criminal", /\b(convict\w*|criminal|felony|misdemeanor|background check)\b/],
    ["salary", /\b(salary|compensation|pay|wage|rate|ctc)\b[\s\S]*\b(expect\w*|desir\w*|requir\w*|range|current|minimum)\b|\b(expect\w*|desir\w*|current|minimum)\b[\s\S]*\b(salary|compensation|pay|wage|rate|ctc)\b/],
    // The EEO block. browser.py _EEO_FIELD_MARKERS, as alternations.
    ["demographic", /\bgender\b|\brac(e|ial)\b|\bethnic\w*|\bveteran\b|\bmilitary\b|\bdisab\w*|\bpronoun\w*/],
    ["demographic", /\bhispanic\b|\blatino\b|\blgbtq?\b|\bsexual orientation\b|\btransgender\b/]
  ];
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
  function classifySensitive(label) {
    const sig = questionSignature(label);
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
    /\bpassword\b|\bpasscode\b|\bone time (code|password)\b|\botp\b/,
    /\bdate of birth\b|\bbirth date\b|\bbirthdate\b|\bdob\b/
  ];
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
  var FIELD_SYNONYMS = [
    // identity
    { key: "first_name", labels: ["first name", "given name", "forename", "legal first name"] },
    { key: "last_name", labels: ["last name", "surname", "family name", "legal last name"] },
    { key: "full_name", labels: ["full name", "your name", "name", "legal name", "candidate name"] },
    { key: "preferred_name", labels: ["preferred name", "nickname", "preferred first name"] },
    { key: "email", labels: ["email", "email address", "e mail", "contact email"] },
    { key: "phone", labels: ["phone", "phone number", "mobile", "mobile number", "telephone", "contact number", "cell"] },
    // location
    { key: "location", labels: ["location", "current location", "where are you based", "where do you live"] },
    { key: "address", labels: ["address", "street address", "address line 1", "mailing address"] },
    { key: "address_city", labels: ["city", "town", "current city", "city of residence"] },
    { key: "address_state", labels: ["state", "province", "region", "state province"] },
    { key: "address_country", labels: ["country", "country of residence"] },
    { key: "postal_code", labels: ["zip", "zip code", "postal code", "postcode", "pin code"] },
    // links
    { key: "linkedin_url", labels: ["linkedin", "linkedin profile", "linkedin url"] },
    { key: "github_url", labels: ["github", "github profile", "github url"] },
    { key: "portfolio_or_website", labels: ["portfolio", "website", "personal website", "portfolio url", "personal site", "web site"] },
    // experience
    { key: "current_job_title", labels: ["current title", "current job title", "current role", "job title", "most recent title", "occupation"] },
    { key: "current_company", labels: ["current company", "current employer", "most recent company", "most recent employer", "company name", "employer"] },
    { key: "years_of_experience", labels: ["years of experience", "total experience", "years experience", "how many years of experience", "relevant experience years"] },
    { key: "top_skills", labels: ["skills", "key skills", "technical skills", "core skills"] },
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
    { key: "cover_letter", labels: ["cover letter", "additional information", "anything else", "tell us about yourself", "introduce yourself"] },
    // sensitive — stored answers only, never inferred
    { key: "authorized_to_work_in_country", sensitive: true, labels: ["authorized to work", "legally authorized to work", "work authorization", "eligible to work", "employment eligibility", "right to work"] },
    { key: "requires_visa_sponsorship", sensitive: true, labels: ["require sponsorship", "need sponsorship", "visa sponsorship", "require visa", "sponsorship now or in the future"] },
    { key: "visa_status", sensitive: true, labels: ["visa status", "immigration status", "work permit status", "current visa"] },
    { key: "expected_salary", sensitive: true, labels: ["expected salary", "salary expectation", "desired salary", "compensation expectation", "expected ctc", "desired compensation"] },
    { key: "gender", sensitive: true, labels: ["gender", "gender identity"] },
    { key: "race_ethnicity", sensitive: true, labels: ["race", "ethnicity", "race ethnicity", "racial identity", "hispanic or latino"] },
    { key: "veteran_status", sensitive: true, labels: ["veteran status", "military status", "protected veteran", "military service"] },
    { key: "disability_status", sensitive: true, labels: ["disability status", "disability", "disabled"] },
    { key: "gender_pronouns", sensitive: true, labels: ["pronouns", "preferred pronouns"] },
    { key: "lgbtq_identity", sensitive: true, labels: ["lgbtq", "sexual orientation", "transgender"] }
  ];
  function synonymMatches(syn, label) {
    const ds = distinctive(syn), dl = distinctive(label);
    if (!ds.size || !dl.size) return false;
    if (!isSubset(ds, dl)) return false;
    if (ds.size === 1 && dl.size > 2) return false;
    return true;
  }
  function matchFieldKey(label) {
    const sig = questionSignature(label);
    if (!sig) return null;
    for (const entry of FIELD_SYNONYMS) {
      for (const syn of entry.labels) {
        if (questionSignature(syn) === sig) return entry;
      }
    }
    let best = null, bestWeight = -1;
    for (const entry of FIELD_SYNONYMS) {
      for (const syn of entry.labels) {
        if (!synonymMatches(syn, label)) continue;
        const weight = distinctive(syn).size;
        if (weight > bestWeight) {
          best = entry;
          bestWeight = weight;
        }
      }
    }
    return best;
  }

  // src/autofill/timing.js
  var TIMING = {
    // How long to let a framework re-render before reading a field back.
    settleMs: 60,
    // How long to wait for a custom dropdown's menu to appear after opening it.
    optionWaitMs: 600,
    // How long to watch for fields that appear in response to an answer.
    revealWatchMs: 900
  };
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  function looksLikeNotAnApplication(el) {
    if (!el) return true;
    try {
      if (el.matches('[role="search"]')) return true;
      if (el.querySelector('input[type="search"]')) return true;
      if (el.querySelector('input[type="password"]')) return true;
      const action = el.getAttribute && el.getAttribute("action") || "";
      const id = el.getAttribute && (el.getAttribute("id") || "") || "";
      const cls = el.className && String(el.className) || "";
      if (SEARCHY.test(action) || SEARCHY.test(id) || SEARCHY.test(cls)) return true;
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
    if (visible.length < 2) return null;
    let score = visible.length;
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
      const all = probe().fillableIn(d).elements.filter(isVisible);
      if (all.length >= 2) {
        const root = commonAncestor(all);
        const s = root && scoreRoot(root, d);
        if (s) scored.push(s);
      }
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score || a.fields.length - b.fields.length);
    const best = scored[0];
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
      if (node.querySelector('input[type="password"]')) return "contains a password field";
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
    return form && form.isForm ? form : null;
  }
  function describeFields(form) {
    const p = probe();
    if (!p || !form) return [];
    const out = [];
    const groupKeys = /* @__PURE__ */ new Map();
    const keyCounts = /* @__PURE__ */ new Map();
    const dateGroups = /* @__PURE__ */ new Map();
    for (const el of form.fields) {
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
      const d = p.describeEl(el);
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
        hasCountryWidget: hasCountryWidget(el)
      };
      if (kind === "radio" || kind === "checkbox") {
        const label = p.labelFor(el) || el.value || "";
        row.options = label ? [{ value: el.value || label, label, el }] : [];
        row.optionLabel = label;
        if (logical) groupKeys.set(logical, out.length);
      }
      if (isFileField(el)) {
        row.kind = "file";
        row.documentSlot = documentSlotFor(row.label) || documentSlotFor(d.ident) || null;
      }
      out.push(row);
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
        filled: false,
        invalid: false,
        required: /\*|\(required\)/.test(label),
        options: [],
        readable: true,
        documentSlot: documentSlotFor(label),
        hints: { tag: "dropzone" },
        dropOnly: true
      });
    }
    for (const row of out) {
      if (row.kind === "date-parts") {
        const now = readDateParts(row);
        row.filled = now.filled;
        row.value = now.value;
        continue;
      }
      if (row.kind !== "radio" && row.kind !== "checkbox") continue;
      const question = groupLabel(row.members, p);
      if (question && (row.members.length > 1 || row.kind === "radio")) {
        row.label = question;
        if (/\*|\(required\)/i.test(question)) row.required = true;
        const group = row.members[0].closest && row.members[0].closest('fieldset, [role="radiogroup"]');
        if (group && group.getAttribute("aria-required") === "true") row.required = true;
      } else if (row.optionLabel) row.label = row.optionLabel;
    }
    return out;
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
        hasInput = !!zone.querySelector('input[type="file"]');
      } catch (e) {
        hasInput = true;
      }
      const nested = out.some((other) => zone.contains(other) || other.contains(zone));
      if (!hasInput && !nested && isVisible(zone)) out.push(zone);
    }
    return out;
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
    try {
      scrollIntoView(el);
      clickOpen(el);
      const labels = await waitForOptions();
      return labels;
    } catch (e) {
      return [];
    } finally {
      dismissListbox(el);
    }
  }
  function optionLabelsIn(node) {
    const p = probe();
    const nodes = p && p.optionNodes ? p.optionNodes(node) : [];
    const out = [];
    for (const n of nodes) {
      const t = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (t && out.length < MAX_OPTIONS_READ) out.push(t);
    }
    return out;
  }
  function waitForOptions() {
    return new Promise((resolve) => {
      const doc = globalThis.document;
      const p = probe();
      const read = () => p ? p.visibleOptionLabels(MAX_OPTIONS_READ) : [];
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
      const timer = setTimeout(() => finish(read()), TIMING.optionWaitMs);
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
    try {
      target.click();
    } catch (e) {
    }
  }
  function pickClickTarget(el, p) {
    const role = el.getAttribute && el.getAttribute("role");
    if (role === "combobox" || role === "button") return el;
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
  function readDateParts(row) {
    const parts = {};
    for (const el of row.members || []) {
      if (!el.isConnected) continue;
      const part = datePartOf(el);
      if (part) parts[part] = String(el.value || "").trim();
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
    const esc2 = (s) => String(s).replace(/["\\]/g, "\\$&");
    for (const sel of [`[name="${esc2(row.ident)}"]`, `#${cssId(row.ident)}`]) {
      if (!sel || sel === "#") continue;
      let el = null;
      try {
        el = doc.querySelector(sel);
      } catch (e) {
        el = null;
      }
      if (el && isVisible(el)) return el;
    }
    const form = findForm(doc);
    if (!form) return null;
    for (const el of form.fields) {
      const d = p.describeEl(el);
      if (d && questionSignature(d.ident) === row.key.split("#")[0]) return el;
    }
    return null;
  }
  function cssId(ident) {
    return /^[A-Za-z_][\w-]*$/.test(ident) ? ident : "";
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
    const answered = server && server.answers || {};
    const registry = state2 && state2.registry || {};
    const userEdited = new Set(state2 && state2.userEdited || []);
    return (rows || []).map((row, position) => {
      const d = base(row);
      if (userEdited.has(row.key)) {
        return done(d, SKIP, "", "", 0, "you edited this");
      }
      if (row.key && registry[row.key] !== void 0 && row.filled && !row.invalid) {
        return done(d, SKIP, registry[row.key], "profile", 1, "already filled");
      }
      if (!row.readable) {
        return done(d, SKIP, "", "", 0, "could not read this field");
      }
      if (isNeverFill(row.label)) {
        return done(d, SKIP, "", "", 0, "we never fill this kind of field");
      }
      if (row.kind === "file" || row.documentSlot) {
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
      if (row.filled && !row.invalid) {
        return done(d, SKIP, row.value, "", 0, "already filled in");
      }
      const category = classifySensitive(row.label);
      if (category) {
        d.sensitive = category;
        const entry2 = matchFieldKey(row.label);
        const stored = entry2 && entry2.sensitive ? bank[entry2.key] : "";
        if (!stored) {
          return done(d, PROFILE, "", "", 0, profileHint(category));
        }
        const value = coerce(stored, row);
        if (value === null) {
          return done(d, ASK, "", "", 0, `none of the options match your stored answer (${stored})`);
        }
        if (row.value && looksLikeDecline(value) && !looksLikeDecline(row.value)) {
          return done(d, SKIP, row.value, "", 0, "keeping the answer already there");
        }
        return done(d, FILL, value, "profile", 0.95, "");
      }
      const entry = matchFieldKey(row.label);
      if (entry && bank[entry.key]) {
        const value = coerce(bank[entry.key], row);
        if (value !== null) {
          const action = isProse(entry.key, value) ? SUGGEST : FILL;
          return done(d, action, value, "profile", 0.95, "");
        }
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
      const choice = row.kind === "select" || row.kind === "combobox" || row.kind === "radio" || row.kind === "checkbox";
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
  function base(row) {
    return {
      key: row.key,
      row,
      label: row.label,
      kind: row.kind,
      required: !!row.required,
      options: row.options || [],
      sensitive: null,
      slot: null
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
  function profileHint(category) {
    switch (category) {
      case "work_authorization":
        return "add your work authorization to your profile";
      case "sponsorship":
        return "add your sponsorship answer to your profile";
      case "citizenship":
        return "answer this one yourself";
      case "clearance":
        return "answer this one yourself";
      case "criminal":
        return "answer this one yourself";
      case "salary":
        return "add your salary expectation to your profile";
      case "demographic":
        return "set your voluntary disclosures in your profile";
      default:
        return "answer this one yourself";
    }
  }
  function coerce(value, row) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return null;
    if (row.kind === "checkbox" || row.kind === "radio") {
      return coerceChoice(text, row);
    }
    if (row.kind === "date-parts") {
      return formatDateForField(text, { type: "date" }) || null;
    }
    if (row.kind === "select" || row.kind === "combobox") {
      const options = (row.options || []).map((o) => typeof o === "string" ? o : o.label);
      if (!options.length) return text;
      const match = bestOptionMatch(text, options);
      if (match != null) return typeof match === "string" ? match : match.label;
      return declineFallback(text, options);
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
  function coerceChoice(text, row) {
    const options = (row.options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean);
    const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(text);
    if (!options.length || options.length === 1 && row.kind === "checkbox") {
      return truthy ? "yes" : null;
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
      if (d.action !== ASK && !d.askable) return;
      if (d.sensitive || d.slot) return;
      if (isNeverFill(d.label)) return;
      if (classifySensitive(d.label)) return;
      out.push({
        i,
        label: d.label,
        kind: d.kind,
        required: !!d.required,
        sensitive: false,
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
  function setText(el, value) {
    if (!el) return false;
    focus(el);
    if (String(el.value || "") !== "") {
      writeValue(el, "");
      fire(el, "input");
    }
    const ok = writeValue(el, value);
    fire(el, "input");
    fire(el, "change");
    blur(el);
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
  function setCheckable(row, value) {
    const members = (row.members || []).filter((el) => el && el.isConnected);
    if (!members.length) return false;
    const p = probe2();
    let target = null;
    if (members.length === 1 && row.kind === "checkbox") {
      const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(String(value));
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
  async function commitCombobox(row, value) {
    const el = row.el;
    if (!el) return false;
    const current = row.value || "";
    if (current && looksLikeDecline(value) && !looksLikeDecline(current)) return true;
    const isButton = (el.tagName || "").toLowerCase() === "button";
    try {
      scrollIntoView(el);
      dismissListbox(el);
      openWidget(row);
      await sleep(TIMING.settleMs);
      let options;
      if (isButton) {
        options = await waitForOptions2(el, TIMING.optionWaitMs);
      } else {
        const input = typableInput(row) || el;
        setText(input, value);
        focus(input);
        options = await waitForOptions2(el, TIMING.optionWaitMs);
        if (!options.length) {
          await typeText(input, value, 8);
          options = await waitForOptions2(el, TIMING.optionWaitMs);
        }
        if (!options.length) {
          fireKey(input, "keydown", "Enter");
          fireKey(input, "keyup", "Enter");
          options = await waitForOptions2(el, TIMING.optionWaitMs);
        }
      }
      if (options.length && await clickMatchingOption(el, value, options)) {
        await sleep(TIMING.settleMs);
        if (committed(row, value)) return true;
      }
      if (!isButton) {
        const input = typableInput(row) || el;
        fireKey(input, "keydown", "Enter");
        fireKey(input, "keyup", "Enter");
        await sleep(TIMING.settleMs);
        if (committed(row, value)) return true;
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      dismissListbox(row.el);
    }
  }
  function openWidget(row) {
    const p = probe2();
    const el = row.el;
    const role = el.getAttribute && el.getAttribute("role");
    const isButton = (el.tagName || "").toLowerCase() === "button";
    let target = el;
    if (role !== "combobox" && !isButton) {
      const wrap = p && p.rsContainer(el) || el.parentElement;
      if (wrap) {
        let ctl = null;
        try {
          ctl = wrap.querySelector('[role="combobox"], [role="button"], [class*="control"], [class*="toggle"]');
        } catch (e) {
          ctl = null;
        }
        target = ctl || el;
      }
    }
    focus(target);
    pressPointer(target);
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
  function visibleOptionNodes(doc) {
    const p = probe2();
    const nodes = p && p.optionNodes ? p.optionNodes(doc) : [];
    return nodes.filter((n) => (n.textContent || "").trim());
  }
  function waitForOptions2(el, timeout) {
    return new Promise((resolve) => {
      const doc = el.ownerDocument || globalThis.document;
      const immediate = visibleOptionNodes(doc);
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
        resolve(visibleOptionNodes(doc));
      };
      const obs = new globalThis.MutationObserver(() => {
        if (visibleOptionNodes(doc).length) finish();
      });
      try {
        obs.observe(doc.body, { childList: true, subtree: true });
      } catch (e) {
      }
      const timer = setTimeout(finish, timeout);
    });
  }
  async function clickMatchingOption(el, value, nodes) {
    const labels = nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());
    let idx = labels.findIndex((t) => commitMatches(value, t));
    if (idx < 0) {
      const best = bestOptionMatch(value, labels);
      idx = best == null ? -1 : labels.indexOf(best);
    }
    if (idx < 0) return false;
    const node = nodes[idx];
    try {
      node.scrollIntoView({ block: "nearest" });
    } catch (e) {
    }
    pressPointer(node);
    return true;
  }
  function committed(row, value) {
    const after = reprobe(row);
    if (!after) return false;
    if (after.invalid) return false;
    if (!after.filled) return false;
    return commitMatches(value, after.value);
  }
  function attachFile(input, file) {
    if (!input || !file) return false;
    try {
      const dt = new globalThis.DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      fire(input, "input");
      fire(input, "change");
      return input.files && input.files.length > 0;
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
  async function applyDecision(decision) {
    const row = decision.row;
    const value = decision.value;
    if (!row || !row.el || !value) return { ok: false, outcome: "failed", shown: "" };
    let wrote = false;
    switch (row.kind) {
      case "date-parts":
        wrote = await setDateParts(row, value);
        break;
      case "select":
        wrote = setSelect(row.el, value);
        if (!wrote) wrote = await commitCombobox(row, value);
        break;
      case "combobox":
        wrote = await commitCombobox(row, value);
        break;
      case "radio":
      case "checkbox":
        wrote = setCheckable(row, value);
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
    await sleep(TIMING.settleMs);
    const after = reprobe(row);
    if (!after) return { ok: wrote, outcome: wrote ? "ok" : "failed", shown: "" };
    if (after.invalid) return { ok: false, outcome: "rejected", shown: after.value };
    if (!after.filled) return { ok: false, outcome: "empty", shown: "" };
    if (!commitMatches(value, after.value)) {
      return { ok: false, outcome: "mismatch", shown: after.value };
    }
    return { ok: true, outcome: "ok", shown: after.value };
  }

  // src/autofill/run.js
  var MAX_REPAIR_SWEEPS = 1;
  var MAX_REVEAL_ROUNDS = 2;
  var MAX_PAGES = 4;
  var STATE_TTL_MS = 30 * 60 * 1e3;
  var MAX_DROPDOWNS_TO_OPEN = 25;
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
      answeredByUser: state.answeredByUser
    } });
  }
  async function clearState() {
    state = { registry: {}, userEdited: [], answeredByUser: {}, page: 1, startedAt: 0, origin: "" };
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
    for (const row of describeFields(form)) {
      for (const el of row.members || []) rows.set(el, row);
    }
    const handler = (event) => {
      const row = rows.get(event.target);
      if (!row || !row.key) return;
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
      if (d.sensitive || classifySensitive(d.label)) continue;
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
  async function runAutofill(ctx, onProgress) {
    const progress = (phase, extra) => {
      if (typeof onProgress === "function") {
        try {
          onProgress(Object.assign({ phase }, extra || {}));
        } catch (e) {
        }
      }
    };
    const form = findForm();
    if (!form) return { error: "no_form", decisions: [], counts: summarize([]) };
    if (!state.startedAt) {
      state.startedAt = Date.now();
      state.origin = globalThis.location.origin;
    }
    progress("scanning");
    let rows = describeFields(form);
    if (!rows.length) return { error: "no_fields", decisions: [], counts: summarize([]) };
    let decisions = await planFor(rows, ctx, progress);
    progress("filling", { done: 0, total: decisionsToWrite(decisions).length });
    await writeAll(decisions, ctx, progress);
    for (let sweep = 0; sweep < MAX_REPAIR_SWEEPS; sweep++) {
      const broken = decisions.filter((d) => d.outcome && d.outcome !== "ok" && d.value);
      if (!broken.length) break;
      progress("repairing", { total: broken.length });
      await writeAll(broken, ctx, progress, true);
    }
    let revealed = 0;
    while (revealed < MAX_REVEAL_ROUNDS) {
      const before = new Set(rows.map((r) => r.key));
      await sleep(TIMING.revealWatchMs);
      const fresh = describeFields(findForm() || form);
      const added = fresh.filter((r) => r.key && !before.has(r.key));
      if (!added.length) break;
      revealed++;
      progress("scanning", { detail: `${added.length} new field(s) appeared` });
      const extra = await planFor(added, ctx, progress);
      await writeAll(extra, ctx, progress);
      decisions = decisions.concat(extra);
      rows = fresh;
    }
    await saveState();
    watchUserEdits(form, null);
    return {
      decisions,
      counts: summarize(decisions),
      page: state.page,
      opaqueHosts: form.opaqueHosts || 0,
      ats: form.ats
    };
  }
  function decisionsToWrite(decisions) {
    return decisions.filter((d) => d.action === FILL || d.action === SUGGEST || d.action === DOCUMENT);
  }
  async function planFor(rows, ctx, progress) {
    let decisions = decide(rows, ctx, null, state);
    const needOptions = decisions.filter((d) => (d.action === ASK || d.action === PROFILE) && (d.kind === "combobox" || d.kind === "select" && !d.options.length) && !d.row.filled).slice(0, MAX_DROPDOWNS_TO_OPEN);
    if (needOptions.length) {
      progress("reading", { total: needOptions.length });
      for (const d of needOptions) {
        const labels = await readComboboxOptions(d.row);
        if (labels.length) {
          d.row.options = labels.map((l) => ({ value: l, label: l }));
          d.options = d.row.options;
        }
      }
      decisions = decide(rows, ctx, null, state);
    }
    const toAsk = fieldsForServer(decisions);
    if (!toAsk.length) return decisions;
    progress("thinking", { total: toAsk.length });
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
  async function writeAll(decisions, ctx, progress, isRepair) {
    const todo = isRepair ? decisions : decisionsToWrite(decisions);
    let done2 = 0;
    for (const d of todo) {
      progress(
        isRepair ? "repairing" : "filling",
        { done: done2, total: todo.length, detail: d.label }
      );
      done2++;
      if (d.action === DOCUMENT) {
        const result2 = await attachDocument(d, ctx);
        d.outcome = result2.ok ? "ok" : "failed";
        d.shown = result2.shown || "";
        if (!result2.ok) {
          d.action = ASK;
          d.reason = "attach this one yourself";
        }
        continue;
      }
      const result = await applyDecision(d);
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
  async function attachDocument(decision, ctx) {
    const slot = decision.slot;
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
      await sleep(TIMING.settleMs + 120);
      return { ok: false, shown: dropped ? `${file.name} (check it attached)` : "" };
    }
    let ok = attachFile(target, file);
    if (!ok || !(target.files && target.files.length)) {
      const zone = findDropZone(target);
      if (zone) ok = dropFile(zone, file) || ok;
    }
    await sleep(TIMING.settleMs + 120);
    const attached = !!(target.files && target.files.length);
    return { ok: ok && attached, shown: attached ? file.name : "" };
  }
  async function answerField(decision, value, remember) {
    decision.value = String(value == null ? "" : value);
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
    if (remember && result.ok && !decision.sensitive && !classifySensitive(decision.label) && !isNeverFill(decision.label) && !looksSecret(decision.value)) {
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
    return res && res.data || { saved: 0 };
  }

  // src/autofill/ui.js
  var ui_exports = {};
  __export(ui_exports, {
    PHASE_TEXT: () => PHASE_TEXT,
    clearHighlights: () => clearHighlights,
    highlight: () => highlight,
    jumpTo: () => jumpTo,
    renderReady: () => renderReady,
    renderResults: () => renderResults,
    renderRunning: () => renderRunning,
    setPhase: () => setPhase
  });
  var probe3 = () => globalThis.__tcvFieldProbe;
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
    const p = probe3();
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
    const p = probe3();
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
    { action: PROFILE, title: "Set once in your profile", badge: "ask", icon: "?" }
  ];
  var SOURCE_LABEL = {
    profile: "your profile",
    saved_answer: "a saved answer",
    ai: "AI",
    you: "you"
  };
  function renderReady(body, form, ctx, handlers, extra) {
    const count = (form && form.fields || []).length;
    const blockers = ctx && ctx.blockers || [];
    const quotaOut = ctx && ctx.quota && ctx.quota.exhausted;
    const page = extra && extra.page || 0;
    body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-job-info">${page > 1 ? `Page ${esc(page)} of this application` : "Application form detected"}</div>
      <div class="tcv-source">${esc(count)} field${count === 1 ? "" : "s"} on this page${form && form.ats && form.ats !== "generic" ? ` \xB7 ${esc(form.ats)}` : ""}</div>
      ${blockers.length ? `
        <div class="tcv-af-note">
          ${esc(blockers[0])}
          <a href="#" id="tcvAfProfileLink">Open your profile \u2192</a>
        </div>` : ""}
      ${quotaOut ? `
        <div class="tcv-af-note">
          You've used your free autofills. <a href="#" id="tcvAfUpgrade">Upgrade to Pro \u2192</a>
        </div>` : `
        <button class="tcv-btn tcv-btn-start" id="tcvAfFillBtn">${page > 1 ? "\u270E Autofill this page" : "\u270E Autofill this application"}</button>`}
      <button class="tcv-btn tcv-btn-ghost" id="tcvAfTailorBtn">\u2726 Tailor my resume for this job</button>
      <div class="tcv-af-note tcv-af-note-quiet">
        TailorCV never submits an application. You review everything and send it yourself.
      </div>
    </div>`;
    const fill = body.querySelector("#tcvAfFillBtn");
    if (fill) fill.addEventListener("click", () => handlers.onFill());
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
    body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-af-summary" id="tcvAfSummary">
        ${pill("ok", `${filled} filled`)}
        ${counts[SUGGEST] ? pill("review", `${counts[SUGGEST]} to review`) : ""}
        ${counts[ASK] ? pill("ask", `${counts[ASK]} need you`) : ""}
        ${counts[PROFILE] ? pill("ask", `${counts[PROFILE]} for your profile`) : ""}
      </div>
      ${result.page > 1 ? `<div class="tcv-source">Page ${esc(result.page)} of this application</div>` : ""}
      ${result.serverError ? `<div class="tcv-af-note">${esc(result.serverError)}</div>` : ""}
      ${result.opaqueHosts ? `<div class="tcv-af-note tcv-af-note-quiet">
        ${esc(result.opaqueHosts)} field group(s) on this page are built in a way
        we can't read \u2014 check those by hand.</div>` : ""}
      <div id="tcvAfBody">${GROUPS.map((g) => groupHtml(g, decisions)).join("")}</div>
      <div class="tcv-af-note tcv-af-note-quiet">
        Review everything, then submit the application yourself. TailorCV never
        submits for you.
      </div>
      <button class="tcv-btn tcv-btn-ghost" id="tcvAfRerun">\u21BB Scan again</button>
    </div>`;
    wireRows(body, decisions, ctx, handlers);
    const rerun = body.querySelector("#tcvAfRerun");
    if (rerun) rerun.addEventListener("click", () => handlers.onFill());
    if (decisions.length && decisions[0].row) highlight(decisions);
    offerToRemember(body, result, handlers);
  }
  function pill(kind, text) {
    return `<span class="tcv-af-summary-pill tcv-af-${esc(kind)}">${esc(text)}</span>`;
  }
  function groupHtml(group, decisions) {
    const rows = decisions.filter((d) => d.action === group.action);
    if (!rows.length) return "";
    return `
    <div class="tcv-af-group">
      <div class="tcv-af-group-title">${esc(group.title)} \xB7 ${rows.length}</div>
      ${rows.map((d) => rowHtml(group, d, decisions.indexOf(d))).join("")}
    </div>`;
  }
  function rowHtml(group, d, index) {
    const needsInput = d.action === ASK && d.kind !== "file" && !d.slot;
    const value = d.shown || d.value;
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
    return `
    <div class="tcv-af-ask-form">
      ${control}
      <label class="tcv-af-remember">
        <input type="checkbox" class="tcv-af-remember-box" data-index="${index}" checked>
        Remember this answer
      </label>
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
    const learnable = result.learnable || (decisions.length && decisions[0].row ? learnableAnswers(decisions) : []);
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
      const res = handlers && handlers.onRemember ? await handlers.onRemember(learnable) : await rememberAnswers(learnable);
      btn.textContent = res && res.saved ? `\u2713 Saved ${res.saved}` : "Could not save";
    });
  }
  function renderRunning(body, phase) {
    body.innerHTML = `
    <div class="tcv-af-panel">
      <div class="tcv-status-text" id="tcvAfPhase">${esc(phase || "Reading the form\u2026")}</div>
    </div>`;
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
    repairing: "Fixing what didn\u2019t take\u2026"
  };

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
      outcome: d.outcome,
      shown: d.shown,
      options: (d.options || []).map((o) => typeof o === "string" ? o : o.label).filter(Boolean)
    };
  }
  var lastRunDecisions = [];
  async function handleFrameMessage(msg) {
    switch (msg && msg.type) {
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
      // Inspection, for the panel and for debugging a page by hand.
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
      if (!announce()) setTimeout(announce, 2500);
    }, 800);
  }
})();
