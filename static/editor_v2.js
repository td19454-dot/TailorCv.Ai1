/* ──────────────────────────────────────────────────────────────────────────
   Resume Editor v2

   Replaces the dark preview-with-controls screen with a light, two-tab
   editor: Resume Content (editable fields) and Design. The AI actions live
   in the top bar - "See what changed" and "One Click Optimizer" - rather
   than in a tab of their own.

   The renderer stays on the server. _render_resume_html() is what produces
   the downloaded PDF, so re-implementing it in the browser would give a
   preview that drifts from the file the candidate actually sends. Edits are
   debounced and re-rendered through the same endpoint instead, which keeps
   one source of truth at the cost of ~200ms.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
    "use strict";

    const STORAGE_KEY = "tailorcv_optimized_editor_payload";
    const DESIGN_KEY  = "tailorcv_editor_design";

    /* ── Icons ───────────────────────────────────────────────────────────── */
    const SVG = {
        home:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
        pencil:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        cloud:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 18H7a4 4 0 1 1 .9-7.9A6 6 0 0 1 19.6 11 3.5 3.5 0 0 1 18 18Z"/></svg>',
        rocket:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M14.5 3.5C18 3 21 6 20.5 9.5 20 13.5 15 18 12 19l-7-7c1-3 5.5-8 9.5-8.5Z"/><circle cx="14.5" cy="9.5" r="1.8"/></svg>',
        download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>',
        person:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
        sparkle:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 13.7 9 19 10.7 13.7 12.4 12 18l-1.7-5.6L5 10.7 10.3 9Z"/><path d="M18.5 16.5 19 18l1.5.5L19 19l-.5 1.5L18 19l-1.5-.5L18 18Z"/></svg>',
        palette:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-1.4-1-1.7-1-2.7 0-.8.7-1.5 1.5-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"/><circle cx="7.5" cy="11.5" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor"/><circle cx="15" cy="8.5" r="1.1" fill="currentColor"/></svg>',
        panel:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16"/></svg>',
        eye:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>',
        eyeOff:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.9"/><path d="M6.2 8.2A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5c1.4 0 2.6-.2 3.7-.6"/><path d="M9.5 9.6a2.7 2.7 0 0 0 3.8 3.8"/></svg>',
        edit:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10"/><path d="M4 12h7"/><path d="M4 17h5"/><path d="m15 16 5-5 2 2-5 5-2.6.6Z"/></svg>',
        copy:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
        trash:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>',
        reset:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/></svg>',
        plus:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
        diff:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/></svg>',
    };

    /* How many AI changes this resume carries. Mirrors the modal's own count
       so the badge and the panel cannot disagree. */
    function countChanges() {
        const ch = (payload && payload.resume_data && payload.resume_data.changes) || {};
        const entries = Array.isArray(ch.entries) ? ch.entries : [];
        const bullets = entries.reduce(
            (n, e) => n + (e.bullets || []).filter(b => b.status !== "unchanged").length, 0);
        const added = Array.isArray(ch.skills_added) ? ch.skills_added.length : 0;
        const summ = ch.summary && ch.summary.status && ch.summary.status !== "unchanged" ? 1 : 0;
        return bullets + added + summ;
    }

    /* In-app toast. Never alert() - it blocks the page, looks like a browser
       error rather than our product, and "reload the page" is not a fix a
       user should be asked to perform. */
    function toast(message, retryFn) {
        let host = document.getElementById("edv2-toasts");
        if (!host) {
            host = el("div", "edv2-toasts");
            host.id = "edv2-toasts";
            document.body.appendChild(host);
        }
        const t = el("div", "edv2-toast");
        t.appendChild(el("span", null, message));
        if (retryFn) {
            const r = el("button", "edv2-toast-btn", "Retry");
            r.type = "button";
            r.addEventListener("click", () => { t.remove(); retryFn(); });
            t.appendChild(r);
        }
        const x = el("button", "edv2-toast-x", "×");
        x.type = "button";
        x.setAttribute("aria-label", "Dismiss");
        x.addEventListener("click", () => t.remove());
        t.appendChild(x);
        host.appendChild(t);
        setTimeout(() => t.remove(), 8000);
    }

    /* Wait briefly for a hook from optimized_editor.js, then report in-app.
       The hooks are now published before that module's init(), so this should
       resolve on the first attempt; the retry covers script-order races. */
    function callHook(name, arg, label, onFail) {
        let tries = 0;
        return new Promise(resolve => {
            (function attempt() {
                const fn = window[name];
                if (typeof fn === "function") { resolve(fn(arg)); return; }
                if (++tries < 20) { setTimeout(attempt, 100); return; }
                console.warn("[TailorCV] " + name + " unavailable - " + label + " did nothing.");
                if (onFail) onFail();
                resolve(undefined);
            })();
        });
    }

    /* Open the implemented change-review modal directly.

       The v2 shell used to click the hidden legacy button first. That made
       integration depend on old DOM wiring even though optimized_editor.js
       already publishes a stable hook for this exact action. */
    function openChanges() {
        callHook("tcvShowChangesModal", payload, "See what changed",
            () => {
                const legacy = document.getElementById("see-changes-btn")
                            || document.getElementById("see-changes-btn-mobile");
                if (legacy) { legacy.click(); return; }
                toast("Couldn't load changes.", openChanges);
            });
    }

    /* ── Design defaults. Mirrors the reference "Style Settings" panel. ──── */
    const DESIGN_DEFAULTS = {
        paper: "A4",
        font: "Times New Roman",
        fontSize: 11,
        lineHeight: 1.125,
        // A resume's own template already carries page padding, so stacking a
        // 1.4in margin on top left roughly two inches of dead space above the
        // name. 0.5in matches what the reference design renders.
        marginX: 0.39,
        marginY: 0.39,
        accent: "#000000",
        link: "#000000",
        nameCase: "capitalize",
        delimiter: "◇",
        listStyle: "•",
        dateFormat: "MMM 'YY",
    };

    const SWATCHES = ["#000000", "#0b7de3", "#7c3aed", "#ff5a5f",
                      "#f5a623", "#2ec9bd", "#d61f32"];

    const FONTS = ["Georgia", "Times New Roman", "Garamond", "Calibri",
                   "Arial", "Helvetica", "Verdana", "Tahoma", "Cambria"];

    const DATE_FORMATS = [
        ["MMM 'YY",      "Jan '26 (MMM 'YY)"],
        ["MMM YYYY",     "Jan 2026 (MMM YYYY)"],
        ["MM/YYYY",      "01/2026 (MM/YYYY)"],
        ["YYYY",         "2026 (YYYY)"],
        ["MMMM YYYY",    "January 2026 (MMMM YYYY)"],
    ];

    /* ── State ───────────────────────────────────────────────────────────── */
    let payload = null;        // { html, resume_data, template_id, style_id }
    let data = null;           // resume_data, the thing being edited
    let design = { ...DESIGN_DEFAULTS };
    let hidden = {};           // "path" -> true when a field is hidden
    let renderTimer = null;
    let pageCount = 1;         // what the UI shows: WeasyPrint's count when known
    // Page count reported by WeasyPrint for the CURRENT html, or 0 when we
    // have not heard back yet. This is the number the PDF will really have,
    // so it outranks the preview's own DOM-based split.
    let serverPageCount = 0;
    // The document's original top-level blocks, captured before the first
    // pagination. Re-paginating rebuilds from these, so repeated passes can
    // never drop or duplicate content.
    let frameSource = [];
    // Wrapper chain the blocks came out of (e.g. .resume-container), cloned
    // empty. Every sheet rebuilds it so the template's own CSS still applies.
    let frameWrappers = [];
    // Preview scale: the sheets are laid out at real paper size in CSS px and
    // shrunk to the column, so the browser's line breaks match WeasyPrint's.
    let frameScale = 1;
    let root, frameEl, saveBtn, pagesEl, pageHintEl, tipEl;

    /* ── Helpers ─────────────────────────────────────────────────────────── */
    const el = (tag, cls, txt) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (txt != null) n.textContent = txt;
        return n;
    };
    const icon = (name, cls) => {
        const s = el("span", cls);
        s.innerHTML = SVG[name] || "";
        return s;
    };

    function loadPayload() {
        let p = null;
        try { p = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null"); }
        catch (e) { p = null; }
        if (p && p.html) return p;
        // sessionStorage is empty on a direct visit, a reload or a new tab.
        // Without this the editor returned early and the LEGACY page that the
        // template still ships stayed on screen - indistinguishable from the
        // new editor having been reverted. The server seeds the user's most
        // recent saved resume so it mounts with real content instead.
        const boot = window.__TCV_EDITOR_BOOTSTRAP__;
        if (boot && boot.html) {
            try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(boot)); }
            catch (e) {}
            return boot;
        }
        return p;
    }
    function savePayload() {
        try {
            payload.resume_data = data;
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {}
    }

    window.tcvGetEditorV2Html = function () {
        return buildDesignedHtml(payload && payload.html ? payload.html : "");
    };
    function loadDesign() {
        try {
            const d = JSON.parse(localStorage.getItem(DESIGN_KEY) || "null");
            if (d && typeof d === "object") design = { ...DESIGN_DEFAULTS, ...d };
        } catch (e) {}
    }
    function saveDesign() {
        try { localStorage.setItem(DESIGN_KEY, JSON.stringify(design)); } catch (e) {}
    }

    /* ── Live preview ────────────────────────────────────────────────────── */

    /* Design settings that are pure presentation are applied straight to the
       rendered document, so moving a slider is instant. Anything that changes
       CONTENT goes back through the server renderer instead. */
    /* Page geometry, in inches, so the sheet matches the PDF's paper size. */
    function paperSize() {
        return design.paper === "Letter" ? { w: 8.5, h: 11 } : { w: 8.27, h: 11.69 };
    }

    function cssString(value) {
        return JSON.stringify(String(value == null ? "" : value));
    }

    /* --- Contrast safety -------------------------------------------------
       The Design tab's accent must never be painted onto an element that
       already sits on an accent-coloured background: picking blue turned
       template 7's name card into blue-on-blue and the summary banner into
       an invisible heading. These helpers pick a readable ink for a given
       background instead, so the rule holds for EVERY accent the user can
       choose, not just the ones we happened to test. */
    function parseColor(c) {
        const s = String(c || "").trim();
        let m = /^#([0-9a-f]{3})$/i.exec(s);
        if (m) {
            const h = m[1];
            return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16),
                    parseInt(h[2] + h[2], 16)];
        }
        m = /^#([0-9a-f]{6})$/i.exec(s);
        if (m) {
            const h = m[1];
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
                    parseInt(h.slice(4, 6), 16)];
        }
        m = /^rgba?\(([^)]+)\)$/i.exec(s);
        if (m) {
            const p = m[1].split(",").map(v => parseFloat(v));
            if (p.length >= 3 && p.every(v => !isNaN(v))) return [p[0], p[1], p[2]];
        }
        return null;
    }

    /* Relative luminance per WCAG 2.1. */
    function luminance(rgb) {
        const f = rgb.map(v => {
            const x = Math.min(255, Math.max(0, v)) / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    }

    function contrastRatio(a, b) {
        const la = luminance(a), lb = luminance(b);
        const hi = Math.max(la, lb), lo = Math.min(la, lb);
        return (hi + 0.05) / (lo + 0.05);
    }

    function toHex(rgb) {
        return "#" + rgb.map(v => Math.round(Math.min(255, Math.max(0, v)))
            .toString(16).padStart(2, "0")).join("");
    }

    /* Readable ink for text sitting ON `bg`: white on dark, near-black on
       light. A MID-TONE surface (e.g. template 8's teal #2f9b95) clears 4.5:1
       against neither plain white nor #1f2937, so the better of the two is
       then pushed further - lightened toward white or darkened toward black -
       until it actually passes. Returning "close enough" here is what ships
       unreadable text. */
    function inkOn(bg) {
        const rgb = parseColor(bg);
        if (!rgb) return "#ffffff";
        const white = [255, 255, 255], dark = [31, 41, 55];
        const useWhite = contrastRatio(rgb, white) >= contrastRatio(rgb, dark);
        let ink = useWhite ? white.slice() : dark.slice();
        let guard = 0;
        while (contrastRatio(rgb, ink) < 4.5 && guard++ < 32) {
            ink = useWhite ? ink.map(v => Math.min(255, v + 8))
                           : ink.map(v => Math.max(0, v - 8));
            // Already at an extreme and still short: nothing more to give.
            if (useWhite && ink.every(v => v >= 255)) break;
            if (!useWhite && ink.every(v => v <= 0)) break;
        }
        return toHex(ink);
    }

    /* An accent safe to use as TEXT on the white paper. A very light accent
       (pale yellow, mint) is unreadable as a heading, so it is darkened
       until it clears 4.5:1 rather than silently shipping faint text. */
    function accentOnPaper(accent) {
        let rgb = parseColor(accent);
        if (!rgb) return accent;
        const paper = [255, 255, 255];
        let guard = 0;
        while (contrastRatio(rgb, paper) < 4.5 && guard++ < 24) {
            rgb = rgb.map(v => Math.max(0, v * 0.88));
        }
        return "#" + rgb.map(v => Math.round(v).toString(16)
            .padStart(2, "0")).join("");
    }

    /* The template's own coloured-surface colour (sidebar / name card /
       banner), read from the rendered document so each template keeps its own
       palette. Falls back to a dark panel when we cannot measure - white ink
       on dark is the safer default for these surfaces. */
    function surfaceColor() {
        const doc = frameEl && frameEl.contentDocument;
        if (!doc || !doc.body) return "#3d66a8";
        const el = doc.querySelector(
            ".sidebar, .name-card, .banner, .header-band, .summary-banner");
        if (!el || !frameEl.contentWindow) return "#3d66a8";
        try {
            const cs = frameEl.contentWindow.getComputedStyle(el);
            // A gradient lives in background-image; take its first colour.
            const img = cs.backgroundImage || "";
            const g = /(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i.exec(img);
            if (g && parseColor(g[1])) return g[1];
            const bg = cs.backgroundColor;
            const rgb = parseColor(bg);
            // Skip fully transparent backgrounds.
            if (rgb && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) return bg;
        } catch (e) {}
        return "#3d66a8";
    }

    /* Give every element that sits on a COLOURED background a readable ink,
       measured from the rendered document instead of guessed from class
       names. Runs after the design CSS is applied, so it corrects whatever
       that CSS just painted.

       Scoped to templates 7-12: those are the ones with coloured banners and
       sidebars, and 1-6 render correctly today - touching them would risk a
       regression for no gain. */
    const INK_TEMPLATES = [7, 8, 9, 10, 11, 12];

    function paintSafeInk() {
        const doc = frameEl && frameEl.contentDocument;
        const win = frameEl && frameEl.contentWindow;
        if (!doc || !doc.body || !win) return;

        // Clears BOTH the surface markers and the inline colours pushed onto
        // their text-bearing children, so a re-run never layers stale ink.
        const clearInk = () => {
            doc.querySelectorAll("[data-edv2-ink]").forEach(el => {
                el.removeAttribute("data-edv2-ink");
                el.style.removeProperty("--edv2-ink");
                el.style.removeProperty("background-image");
                el.style.removeProperty("background-color");
            });
            doc.querySelectorAll("[data-edv2-kid]").forEach(el => {
                el.removeAttribute("data-edv2-kid");
                el.style.removeProperty("color");
            });
        };

        const tid = Number((payload && payload.template_id) || 0);
        if (INK_TEMPLATES.indexOf(tid) === -1) { clearInk(); return; }
        clearInk();

        // Walk every element; mark the ones that PAINT their own background.
        doc.querySelectorAll("*").forEach(el => {
            let bg = null;
            try {
                const cs = win.getComputedStyle(el);
                const img = cs.backgroundImage || "";
                const g = /(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i.exec(img);
                if (g && parseColor(g[1])) {
                    bg = g[1];
                } else {
                    const col = cs.backgroundColor || "";
                    // Skip transparent / fully see-through backgrounds.
                    if (col && !/transparent/i.test(col) &&
                        !/rgba\([^)]*,\s*0(\.0+)?\s*\)/.test(col) &&
                        parseColor(col)) {
                        bg = col;
                    }
                }
            } catch (e) { return; }
            if (!bg) return;

            const rgb = parseColor(bg);
            if (!rgb) return;
            // White-ish paper needs no correction: the normal ink is fine and
            // overriding it would flatten the template's own text colours.
            if (luminance(rgb) > 0.82) return;

            const ink = inkOn(bg);
            el.setAttribute("data-edv2-ink", "1");
            el.style.setProperty("--edv2-ink", ink);

            // Descendants that carry text but paint NO background of their own
            // take this surface's ink directly. Done per element rather than
            // with an inherit rule, so a nested surface (a skill chip on its
            // own dark pill) keeps the ink computed for ITS background instead
            // of the container's - that mismatch rendered chips as empty
            // capsules, dark text on a dark pill.
            el.querySelectorAll("*").forEach(kid => {
                if (kid.hasAttribute("data-edv2-ink")) return;
                // Only the NEAREST marked ancestor may colour this node.
                // Template 7 nests a dark name-card and a dark sidebar inside
                // lighter wrappers; without this check an outer light surface
                // walked all the way in and painted the sidebar's contact and
                // skills lines dark-on-dark, blanking them.
                let near = kid.parentElement;
                while (near && !near.hasAttribute("data-edv2-ink")) {
                    near = near.parentElement;
                }
                if (near !== el) return;
                let kbg = "";
                try {
                    const kcs = win.getComputedStyle(kid);
                    kbg = kcs.backgroundColor || "";
                    if (kcs.backgroundImage && kcs.backgroundImage !== "none") return;
                } catch (e) { return; }
                const opaque = kbg && !/transparent/i.test(kbg) &&
                    !/rgba\([^)]*,\s*0(\.0+)?\s*\)/.test(kbg);
                if (opaque) return;          // has its own surface; leave it
                kid.setAttribute("data-edv2-kid", "1");
                kid.style.setProperty("color", ink, "important");
            });

            // A mid-tone surface can fall just short of 4.5:1 even with the
            // best ink (template 7's name card sits at 4.47 with pure white).
            // The SURFACE may be nudged to close that gap - but only slightly,
            // and only DARKER.
            //
            // The previous version lightened a surface whenever the ink was
            // dark (`v * 1.06 + 4`, up to 24 times). That bleached template
            // 12's blue skill pills to near-white until they vanished against
            // the paper, and `background-image: none` destroyed every gradient
            // it touched. A template's own colour is part of its design: adjust
            // it barely, never repaint it.
            const inkRgb = parseColor(ink);
            if (!inkRgb) return;
            if (contrastRatio(rgb, inkRgb) >= 4.5) return;   // already fine
            if (luminance(inkRgb) <= 0.5) return;  // dark ink: leave the
                                                   // surface alone entirely
            let surf = rgb.slice(), guard = 0;
            // At most 6 gentle steps, so the colour stays recognisably itself.
            while (contrastRatio(surf, inkRgb) < 4.5 && guard++ < 6) {
                surf = surf.map(v => Math.max(0, v * 0.94));
            }
            // Only repaint a FLAT colour; a gradient keeps its own painting.
            if (guard > 0) {
                let hasImage = false;
                try {
                    const cs2 = win.getComputedStyle(el);
                    hasImage = cs2.backgroundImage && cs2.backgroundImage !== "none";
                } catch (e) {}
                if (!hasImage) {
                    el.style.setProperty("background-color", toHex(surf), "important");
                }
            }
        });
    }

    function buildDesignCss() {
        const P = paperSize();
        const nameCase = design.nameCase === "uppercase" ? "uppercase"
                       : design.nameCase === "lowercase" ? "lowercase" : "none";
        const px = Math.max(8, Number(design.fontSize || 10.5) * 96 / 72);
        const delimiter = String(design.delimiter || "|");
        // Accent, guaranteed readable as text on white paper.
        const safeAccent = accentOnPaper(design.accent);
        // Ink for text on the template's coloured surfaces. The surface colour
        // is read from the live document when we can see it, so each template
        // keeps its own palette; the accent is never used here.
        const surface = surfaceColor();
        const sidebarInk = inkOn(surface);
        const nameCardInk = sidebarInk;
        // Ink for text sitting on an accent-FILLED chip/pill/badge. Computed
        // from the raw accent, which is what the fill actually uses.
        const accentInk = inkOn(design.accent);
        return `
            :root, .resume-container {
                --body-size: ${px}px !important;
                --body-line: ${design.lineHeight} !important;
                --contact-size: ${Math.max(7, px * 0.78)}px !important;
                --header-size: ${Math.max(18, px * 2.35)}px !important;
                --section-size: ${Math.max(10, px * 1.18)}px !important;
                --title-size: ${Math.max(9, px * 1.08)}px !important;
                --meta-size: ${Math.max(8, px * 0.92)}px !important;
                --project-title-size: ${Math.max(9, px * 1.08)}px !important;
                --project-meta-size: ${Math.max(8, px * 0.92)}px !important;
                --skill-size: ${Math.max(9, px * 0.96)}px !important;
                --bullet-line: ${design.lineHeight} !important;
            }
            html, body {
                font-family: ${cssString(design.font)}, serif !important;
                font-size: ${design.fontSize}pt !important;
                line-height: ${design.lineHeight} !important;
            }
            body, body p, body li, body div, body span, body td,
            body h1, body h2, body h3, body h4 {
                line-height: ${design.lineHeight} !important;
                font-family: ${cssString(design.font)}, serif !important;
            }
            body {
                padding: 0 !important;
                margin: 0 !important;
            }
            body > *:first-child { margin-top: 0 !important; }
            /* Accent text on the white page, darkened if the picked accent is
               too light to read. Deliberately NOT applied inside a coloured
               banner or sidebar - those are handled below. */
            h1, .name, .resume-name, .header-name {
                text-transform: ${nameCase} !important;
            }
            h1:not(.on-accent), .resume-name, .header-name,
            .name:not(.on-accent) {
                color: ${safeAccent} !important;
            }
            h2, .section-title, .section-heading, .sec-title {
                color: ${safeAccent} !important;
            }
            /* Template 7 (Navy Sidebar; .resume-wrap exists in no other
               template): the name, the sidebar headings and the summary
               heading sit on the template's own blue surfaces, which the
               accent never changes. The two rules above turned them dark on
               blue in the PDF. The live preview hid it - paintSafeInk() fixes
               the preview DOM, but Download sends the raw HTML plus THIS
               stylesheet, so the fix has to live here. */
            .resume-wrap .name-card .name,
            .resume-wrap .name-card .headline,
            .resume-wrap .sidebar-section h2,
            .resume-wrap .summary-card h2 {
                color: #ffffff !important;
            }

            /* Text on a coloured surface is handled by paintSafeInk(), which
               MEASURES each element's real background in the rendered document.
               Listing class names here was the bug: the selectors guessed at
               ".banner"/".header-band", which exist in no template, while the
               real surfaces are .header, .contact-strip, .contact-bar, .top,
               .name-block - so the accent won and painted dark-red text on a
               dark navy banner. */
            /* Each marked element carries its OWN ink. Descendants are NOT
               forced to inherit: a skill chip paints its own dark pill, and
               inheriting the outer sheet's dark ink turned every chip into an
               empty capsule. paintSafeInk() marks each coloured surface
               individually, so the nearest one always wins naturally. */
            [data-edv2-ink] { color: var(--edv2-ink) !important; }
            /* No faded ghost text on coloured surfaces. */
            [data-edv2-ink] { opacity: 1 !important; }
            /* Long contact URLs must wrap inside the column, not overlap the
               line below. */
            .sidebar a, .contact-list a, .contact a, .contact-item {
                overflow-wrap: anywhere !important;
                word-break: break-word !important;
                max-width: 100% !important;
            }

            /* Chips/pills/badges are FILLED with the accent by several
               templates (".chip-list li { background: var(--accent) }") while
               hardcoding white text. A pale accent then gives white-on-pale
               and the chips disappear, so the ink is computed from the fill
               itself rather than assumed. */
            .chip, .pill, .badge, .tag, .chip-list li, .pill-wrap li,
            .badge-list li, .skills li.skill, .skill {
                color: ${accentInk} !important;
                overflow-wrap: anywhere !important;
                max-width: 100% !important;
            }
            .chip a, .pill a, .badge a, .chip-list li a, .pill-wrap li a {
                color: ${accentInk} !important;
            }

            a, .contact a, .links a { color: ${design.link} !important; }
            /* A link on a coloured surface must stay legible too. */
            .sidebar a, .name-card a, .banner a, .header-band a {
                color: ${sidebarInk} !important;
            }
            .contact-item + .contact-item::before,
            .project-state-contact-separator::before {
                content: " ${delimiter.replace(/\\/g, "\\\\").replace(/"/g, '\\"')} " !important;
            }
            /* Set the MARKER only. The indent belongs to the template:
               `.bullets { margin: 0.9mm 0 0 3mm; padding: 0 }` in t15/t18.
               Forcing `padding-left: 1.15em` on top of that, and wiping the
               template's margin-left, pushed bullets right - and the two
               indents compounded where a list continued onto a second page
               (measured: bullets at 54px on page 1, 66px on page 2). */
            ul, ol {
                list-style-type: ${listStyleCss(design.listStyle)} !important;
                list-style-position: outside !important;
            }
            /* Only lists with NO indent of their own get one, so markers are
               never clipped against the container edge. */
            ul:not([class]), ol:not([class]) {
                padding-left: 1.15em;
            }
            ul li, ol li { list-style: inherit !important; display: list-item !important; }
            @page { size: ${P.w}in ${P.h}in; margin: ${design.marginY}in ${design.marginX}in; }
            html { padding: 0 !important; margin: 0 !important; }
            h2, h3, .section-title, .section-heading, .sec-title {
                break-after: avoid-page; page-break-after: avoid;
                break-inside: avoid; page-break-inside: avoid;
            }
            .entry, .experience-item, .project-item, .education-item,
            .exp-entry, .edu-entry, .proj-entry, .item {
                break-inside: avoid; page-break-inside: avoid;
            }
            li { break-inside: avoid; page-break-inside: avoid;
                 orphans: 2; widows: 2; }
            p  { orphans: 2; widows: 2; }
            .education, .certifications, .awards, .achievements,
            section.education, section.certifications {
                break-inside: avoid; page-break-inside: avoid;
            }
        `;
    }

    function buildDesignedHtml(html) {
        html = String(html || "").trim();
        if (!html) return "";
        try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            let st = doc.getElementById("edv2-design");
            if (!st) {
                st = doc.createElement("style");
                st.id = "edv2-design";
                doc.head.appendChild(st);
            }
            st.textContent = buildDesignCss();
            return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
        } catch (e) {
            return html;
        }
    }

    function refreshDesignPreview() {
        applyDesignToFrame();
        layoutPages();
        fitFrame();
        countPages();
    }

    function applyDesignToFrame() {
        const doc = frameEl && frameEl.contentDocument;
        if (!doc || !doc.head) return;
        let st = doc.getElementById("edv2-design");
        if (!st) {
            st = doc.createElement("style");
            st.id = "edv2-design";
            doc.head.appendChild(st);
        }
        st.textContent = buildDesignCss();
        // Must run AFTER the design CSS lands: it corrects the text colour on
        // coloured surfaces that the accent rule would otherwise make
        // unreadable (dark-red name on a dark navy banner).
        paintSafeInk();
        fitFrame();
    }

    function listStyleCss(glyph) {
        if (glyph === "○") return "circle";
        if (glyph === "■") return "square";
        if (glyph === "1")      return "decimal";
        if (glyph === "none")   return "none";
        return "disc";
    }

    /* Grow the iframe to its content so the page is never cropped and the
       column keeps a single scrollbar. */
    function fitFrame() {
        const doc = frameEl && frameEl.contentDocument;
        if (!doc) return;
        const h = Math.max(
            doc.body ? doc.body.scrollHeight : 0,
            doc.documentElement ? doc.documentElement.scrollHeight : 0);
        // The body is scaled down to the column width, so its layout height has
        // to be scaled too or the frame reserves the unscaled height and leaves
        // a long blank gap under the resume.
        if (h > 0) frameEl.style.height = (h * frameScale + 8) + "px";
    }

    function paintFrame(html) {
        if (!frameEl) return;
        frameEl.srcdoc = html;
    }

    /* Draw the page boundaries onto the single rendered document.

       One frame renders the whole resume continuously; a gap and a label are
       drawn at each page boundary inside it. Keeping ONE render is what makes
       the preview agree with the PDF - slicing the HTML into separate sheets
       would need a second layout engine in the browser, which is exactly the
       thing that drifts. The page count comes from WeasyPrint, so the seams
       land where the real breaks are. */
    /* Split the rendered document into real page sheets.

       The previous version drew a grey bar over one long page at each page
       boundary. That HID the content underneath it - a whole bullet vanished
       behind the "Page 2 of 2" bar - which is worse than no pagination at
       all, because the reader cannot tell anything is missing.

       This measures every top-level block against the printable height and
       MOVES it into the next sheet when it does not fit. Nothing is covered,
       so every line appears exactly once. */
    /* Pull the real page blocks out of the document.

       Almost every template wraps the whole resume in a single
       `.resume-container`, so taking BODY's children gave exactly ONE block:
       nothing could ever be moved to a second sheet and the preview claimed
       "1 page" however long the resume was. Descend through single-element
       wrappers until there is something to split, and remember the wrappers
       (cloned empty) so each sheet can rebuild the chain - the template's CSS
       hangs off those classes. */
    function captureSource(doc) {
        const isOurs = n => n.classList && (n.classList.contains("edv2-sheet") ||
                                            n.classList.contains("edv2-sheetlabel"));
        let nodes = Array.from(doc.body.children).filter(n => !isOurs(n));
        const wrappers = [];
        while (nodes.length === 1 && nodes[0].children && nodes[0].children.length > 1
               && wrappers.length < 4) {
            wrappers.push(nodes[0].cloneNode(false));
            nodes = Array.from(nodes[0].children);
        }
        frameWrappers = wrappers;
        frameSource = nodes.map(n => n.cloneNode(true));
    }

    function layoutPages() {
        const doc = frameEl && frameEl.contentDocument;
        if (!doc || !doc.body) { updatePageHint(); return; }

        const P = paperSize();
        // Lay the sheets out at TRUE paper size in CSS px (96 per inch, the
        // same unit WeasyPrint uses) and scale the whole body down to the
        // column. Measuring at the column's own width instead made every line
        // wrap at a different place than the PDF, so the break estimate was
        // off before a single block had been moved.
        const pageW = P.w * 96, pageH = P.h * 96;
        const printable = (P.h - design.marginY * 2) * 96;
        if (!(printable > 50)) { updatePageHint(); return; }
        const avail = frameEl.clientWidth || pageW;
        frameScale = Math.min(1, avail / pageW);

        // Source blocks, captured once so re-paginating never loses content.
        if (!doc.body.dataset.edv2Src) {
            doc.body.dataset.edv2Src = "1";
            captureSource(doc);
        }
        if (!frameSource.length) { updatePageHint(); return; }

        let st = doc.getElementById("edv2-pagecss");
        if (!st) {
            st = doc.createElement("style");
            st.id = "edv2-pagecss";
            doc.head.appendChild(st);
        }
        st.textContent = `
            html { background: #eef0f4 !important; padding: 0 !important;
                   margin: 0 !important; }
            body { background: #eef0f4 !important; padding: 0 !important;
                   margin: 0 !important; width: ${pageW}px !important;
                   transform: scale(${frameScale}); transform-origin: top left; }
            .edv2-sheet {
                background: #fff; box-sizing: border-box;
                width: ${pageW}px; min-height: ${pageH}px;
                padding: ${design.marginY}in ${design.marginX}in;
                margin: 0 0 8px; box-shadow: 0 1px 3px rgba(17,24,39,.12);
            }
            /* Blocks live in this box and IT is what gets measured. The sheet
               carries a full-page min-height, so its own scrollHeight is
               always >= a whole page: measuring the sheet made the fit test
               true for every block and put each one on its own sheet - an
               8-page preview for a 2-page resume. */
            .edv2-sheetinner { width: 100%; }
            /* Same problem, for the off-screen probe that asks whether a
               single block is taller than a page. */
            .edv2-sheet.edv2-measuring { min-height: 0 !important; }
            .edv2-sheetlabel {
                text-align: center; font: 500 11px system-ui, sans-serif;
                color: #6b7280; margin: 0 0 24px;
            }
        `;

        // Rebuild from the captured source every time.
        doc.body.innerHTML = "";
        // Each sheet carries its measuring box (_inner) and the deepest
        // rebuilt wrapper that blocks get appended to (_host).
        const newSheet = () => {
            const s = doc.createElement("div");
            s.className = "edv2-sheet";
            const inner = doc.createElement("div");
            inner.className = "edv2-sheetinner";
            s.appendChild(inner);
            let host = inner;
            frameWrappers.forEach(w => {
                const c = w.cloneNode(false);
                host.appendChild(c);
                host = c;
            });
            s._inner = inner;
            s._host = host;
            doc.body.appendChild(s);
            return s;
        };

        // Paginate over the blocks that actually flow. A template that wraps
        // everything in one root container (.page/.resume) would otherwise be
        // a single un-splittable node, so we descend into it first.
        let blocks = frameSource;
        while (blocks.length === 1 && blocks[0].children &&
               blocks[0].children.length > 1) {
            blocks = Array.from(blocks[0].children);
        }

        // Descend into any block that is TALLER THAN A PAGE, otherwise it can
        // only ever be moved whole. Templates 10/11 are `<header>` + `.layout`,
        // where .layout is the entire two-column body: the header stayed on
        // page 1 and the whole body jumped to page 2, leaving page 1 empty
        // below the banner. Measured against the real printable height, so a
        // block that genuinely fits is never taken apart.
        const probe = doc.createElement("div");
        probe.className = "edv2-sheet edv2-measuring";
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        doc.body.appendChild(probe);
        const tooTall = node => {
            probe.innerHTML = "";
            probe.appendChild(node.cloneNode(true));
            return probe.scrollHeight > printable;
        };
        for (let pass = 0; pass < 4; pass++) {
            let changed = false;
            const next = [];
            blocks.forEach(b => {
                // Never take apart a multi-column container: its children are
                // the columns themselves, and splitting them across sheets
                // would put the sidebar on one page and the main column on
                // another. Such a block stays whole and overflows instead.
                let multiCol = false;
                try {
                    const d = frameEl.contentWindow.getComputedStyle(b).display;
                    multiCol = d === "grid" || d === "flex";
                } catch (e) {}
                if (!multiCol && b.children && b.children.length > 1 &&
                    tooTall(b)) {
                    next.push(...Array.from(b.children));
                    changed = true;
                } else {
                    next.push(b);
                }
            });
            blocks = next;
            if (!changed) break;
        }
        probe.remove();

        let sheet = newSheet();
        blocks.forEach(node => {
            const block = node.cloneNode(true);
            sheet._host.appendChild(block);
            // Overflowed this sheet: move the block to a fresh one. A block
            // taller than a whole page stays put - splitting mid-element
            // would need its own layout pass and is what page-break CSS in
            // the PDF handles.
            if (sheet._inner.scrollHeight > printable && sheet._host.children.length > 1) {
                sheet._host.removeChild(block);
                sheet = newSheet();
                sheet._host.appendChild(block);
            }
        });

        // Label each sheet underneath it. The COUNT shown to the user comes
        // from WeasyPrint (countPages -> /api/estimate-html-pages) whenever we
        // have it, because that is the engine that produces the actual PDF;
        // the JS split above only decides where to draw the sheet boundaries
        // in the preview. Letting the DOM count win here is what made the
        // banner disagree with the downloaded file.
        const sheets = Array.from(doc.querySelectorAll(".edv2-sheet"));
        const sheetCount = Math.max(1, sheets.length);
        pageCount = serverPageCount || sheetCount;
        // The labels must not contradict the banner, so they carry whichever
        // total is larger: a preview that drew fewer sheets than the PDF has
        // still says "of 3" rather than quietly promising a shorter file.
        const total = Math.max(sheetCount, pageCount);
        sheets.forEach((s, i) => {
            const lab = doc.createElement("div");
            lab.className = "edv2-sheetlabel";
            lab.textContent = `Page ${i + 1} of ${total}`;
            s.insertAdjacentElement("afterend", lab);
        });

        // This function rebuilds body from cloned nodes, which drops the ink
        // attributes set on the previous DOM - re-apply them to the new one.
        paintSafeInk();
        fitFrame();
        updatePageHint();
    }

    /* Page count for the current HTML, from the same engine as the PDF.
       Counted on the DESIGNED html - the same bytes Download sends - so font
       size, spacing and margins are in the count. */
    async function countPages() {
        if (!payload || !payload.html) return;
        try {
            const res = await fetch("/api/estimate-html-pages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ html: buildDesignedHtml(payload.html), pdf_scale: 1 }),
            });
            if (!res.ok) return;
            const out = await res.json();
            if (out && out.pages) {
                serverPageCount = out.pages;
                pageCount = out.pages;
                layoutPages();
            }
        } catch (e) {}
    }

    function updatePageHint() {
        if (!pageHintEl) return;
        pageHintEl.textContent = pageCount === 1 ? "1 page" : `${pageCount} pages`;
        if (tipEl) {
            tipEl.hidden = pageCount <= 1;
            tipEl.textContent = pageCount <= 1 ? "" :
                `Your resume is ${pageCount} pages. Try reducing font size or margins in the Design tab to fit 1 page.`;
        }
    }

    /* Re-render through the server so the preview and the PDF cannot diverge.
       Debounced: typing in a field should not fire a request per keystroke. */
    function scheduleRender() {
        savePayload();
        clearTimeout(renderTimer);
        setSaving(true);
        renderTimer = setTimeout(doRender, 400);
    }

    async function doRender() {
        try {
            const res = await fetch("/api/editor/render", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    resume_data: data,
                    template_id: payload.template_id || 1,
                    style_id: payload.style_id || 1,
                    design: design,
                    hidden: hidden,
                    // The server counts pages with WeasyPrint. Without the
                    // design CSS it counts a document nobody downloads -
                    // font size, spacing and margins all move the breaks -
                    // so send the exact stylesheet the preview and the PDF use.
                    design_css: buildDesignCss(),
                }),
            });
            if (res.ok) {
                const out = await res.json();
                if (out && out.html) {
                    payload.html = out.html;
                    paintFrame(out.html);
                    savePayload();
                    // Page count comes back from WeasyPrint with the render,
                    // so the markers move in step with the content.
                    if (out.pages) {
                        serverPageCount = out.pages;
                        pageCount = out.pages;
                        updatePageHint();
                    } else {
                        // No count this time: drop the stale one so the
                        // preview falls back to its own split rather than
                        // showing a number from the previous content.
                        serverPageCount = 0;
                    }
                }
            }
        } catch (e) {
            // Offline or the endpoint is unavailable: the last good render
            // stays on screen rather than blanking the preview.
        } finally {
            setSaving(false);
        }
    }

    function setSaving(on) {
        if (saveBtn) saveBtn.classList.toggle("saving", !!on);
    }

    /* ── Field builders ──────────────────────────────────────────────────── */

    function fieldRow(label, value, onInput, opts) {
        opts = opts || {};
        const wrap = el("div", "edv2-field");
        if (opts.path && hidden[opts.path]) wrap.classList.add("off");

        const lab = el("div", "edv2-label");
        lab.appendChild(document.createTextNode(label));
        if (opts.info) {
            const i = el("span", "edv2-info", "i");
            i.title = opts.info;
            lab.appendChild(i);
        }
        wrap.appendChild(lab);

        const box = el("div", "edv2-inputwrap" + (opts.path ? " has-eye" : ""));
        const input = opts.textarea ? el("textarea", "edv2-input")
                    : opts.select   ? el("select", "edv2-input")
                    : el("input", "edv2-input");
        if (opts.select) {
            opts.select.forEach(([v, t]) => {
                const o = el("option", null, t);
                o.value = v;
                input.appendChild(o);
            });
        }
        input.value = value == null ? "" : value;
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.addEventListener("input", () => onInput(input.value));
        box.appendChild(input);

        if (opts.path) {
            const btn = el("button", "edv2-eye");
            btn.type = "button";
            const paint = () => {
                btn.innerHTML = hidden[opts.path] ? SVG.eyeOff : SVG.eye;
                btn.title = hidden[opts.path] ? "Hidden from resume" : "Shown on resume";
                wrap.classList.toggle("off", !!hidden[opts.path]);
            };
            paint();
            btn.addEventListener("click", () => {
                hidden[opts.path] = !hidden[opts.path];
                paint();
                scheduleRender();
            });
            box.appendChild(btn);
        }

        wrap.appendChild(box);
        return wrap;
    }

    function card(title, opts) {
        opts = opts || {};
        const c = el("div", "edv2-card");
        const head = el("button", "edv2-cardhead");
        head.type = "button";
        head.setAttribute("aria-expanded", opts.open === false ? "false" : "true");

        if (opts.drag) {
            const d = el("span", "edv2-drag", "⋮⋮");
            d.title = "Drag to reorder";
            head.appendChild(d);
        }
        head.appendChild(el("span", "edv2-cardtitle", title));
        if (opts.plus) {
            const p = el("span", "edv2-info", "+");
            p.title = "Add custom field";
            head.appendChild(p);
        }
        head.appendChild(el("span", "edv2-chev"));

        const body = el("div", "edv2-cardbody");
        if (opts.open === false) body.hidden = true;
        head.addEventListener("click", () => {
            const open = !body.hidden;
            body.hidden = open;
            head.setAttribute("aria-expanded", String(!open));
        });
        c.append(head, body);
        c._body = body;
        return c;
    }

    /* ── Tab: Resume Content ─────────────────────────────────────────────── */

    function buildContentPane(pane) {
        pane.innerHTML = "";

        // Personal Information
        const pi = card("Personal Information", { plus: true });
        pi._body.appendChild(el("div", "edv2-sub", "Basics"));
        const names = el("div", "edv2-row");
        const full = String(data.name || "").trim().split(/\s+/);
        names.appendChild(fieldRow("First Name", full[0] || "", v => {
            const rest = String(data.name || "").trim().split(/\s+/).slice(1).join(" ");
            data.name = (v + " " + rest).trim();
            scheduleRender();
        }));
        names.appendChild(fieldRow("Last Name", full.slice(1).join(" "), v => {
            const first = String(data.name || "").trim().split(/\s+/)[0] || "";
            data.name = (first + " " + v).trim();
            scheduleRender();
        }));
        pi._body.appendChild(names);

        // Contact details live under data.contact in the optimizer's schema,
        // not at the top level - reading them from the root returned undefined
        // and every one of these inputs rendered blank while the preview,
        // which reads the real path, showed the values.
        const c = data.contact = data.contact || {};

        pi._body.appendChild(fieldRow("Headline / Target Job Title", data.title || "",
            v => { data.title = v; scheduleRender(); }, { path: "title" }));
        pi._body.appendChild(fieldRow("Email", c.email || "",
            v => { c.email = v; scheduleRender(); },
            { path: "contact.email", info: "Shown in the contact line" }));
        pi._body.appendChild(fieldRow("Phone Number", c.phone || "",
            v => { c.phone = v; scheduleRender(); }, { path: "contact.phone" }));

        pi._body.appendChild(el("div", "edv2-sub", "Location"));
        pi._body.appendChild(fieldRow("Address", c.address || "",
            v => { c.address = v; scheduleRender(); }, { path: "contact.address" }));

        pi._body.appendChild(el("div", "edv2-sub", "Links"));
        [["LinkedIn", "linkedin"], ["GitHub", "github"], ["Portfolio", "portfolio"],
         ["LeetCode", "leetcode"], ["Kaggle", "kaggle"]].forEach(([label, key]) => {
            pi._body.appendChild(fieldRow(label, c[key] || "",
                v => { c[key] = v; scheduleRender(); }, { path: "contact." + key }));
        });
        pane.appendChild(pi);

        // Summary
        const sum = card("Summary", { drag: true, open: false });
        sum._body.appendChild(fieldRow("Professional Summary", data.summary || "",
            v => { data.summary = v; scheduleRender(); },
            { path: "summary", textarea: true }));
        pane.appendChild(sum);

        // Entry sections
        buildEntrySection(pane, "Experience", "experience",
            e => `${e.title || e.role || "Role"} at ${e.company || e.organization || "Company"}`);
        buildEntrySection(pane, "Projects", "projects", e => e.name || "Project");
        buildEntrySection(pane, "Education", "education",
            e => e.degree ? `${e.degree}${e.school ? " — " + e.school : ""}` : (e.school || "Education"));
        buildEntrySection(pane, "Leadership / Extracurricular", "extracurriculars",
            e => `${e.role || "Role"}${e.organization ? " at " + e.organization : ""}`);

        // Skills
        const sk = card("Skills", { drag: true, open: false });
        sk._body.appendChild(fieldRow("Skills (comma separated)",
            (data.skills || []).join(", "),
            v => {
                data.skills = v.split(",").map(s => s.trim()).filter(Boolean);
                scheduleRender();
            }, { textarea: true }));
        pane.appendChild(sk);
    }

    function buildEntrySection(pane, title, key, labelOf) {
        const list = Array.isArray(data[key]) ? data[key] : [];
        const sec = card(title, { drag: true, open: key === "experience" });

        list.forEach((entry, i) => {
            const ec = card(labelOf(entry), { open: false });
            ec.style.marginBottom = "10px";

            const isProject = key === "projects";
            if (!isProject) {
                ec._body.appendChild(fieldRow("Company Name",
                    entry.company || entry.organization || entry.school || "",
                    v => { (entry.company !== undefined ? entry.company = v
                          : entry.organization !== undefined ? entry.organization = v
                          : entry.school = v); scheduleRender(); },
                    { path: `${key}.${i}.company` }));
                ec._body.appendChild(fieldRow("Company URL", entry.url || "",
                    v => { entry.url = v; scheduleRender(); },
                    { path: `${key}.${i}.url`, info: "Linked from the company name" }));
                ec._body.appendChild(fieldRow("Job Title", entry.title || entry.role || entry.degree || "",
                    v => { (entry.title !== undefined ? entry.title = v
                          : entry.role !== undefined ? entry.role = v
                          : entry.degree = v); scheduleRender(); },
                    { path: `${key}.${i}.title` }));
            } else {
                ec._body.appendChild(fieldRow("Project Title", entry.name || "",
                    v => { entry.name = v; scheduleRender(); }, { path: `${key}.${i}.name` }));
                ec._body.appendChild(fieldRow("Project URL", entry.url || "",
                    v => { entry.url = v; scheduleRender(); },
                    { path: `${key}.${i}.url`, info: "Linked from the project title" }));
            }

            ec._body.appendChild(fieldRow("City, State", entry.location || "",
                v => { entry.location = v; scheduleRender(); },
                { path: `${key}.${i}.location`, info: "Right-aligned beside the dates" }));
            ec._body.appendChild(fieldRow("Dates", entry.dates || entry.date || "",
                v => { (entry.dates !== undefined ? entry.dates = v : entry.date = v); scheduleRender(); },
                { path: `${key}.${i}.dates` }));

            // Bullets
            ec._body.appendChild(el("div", "edv2-sub", "Bullets"));
            const holder = el("div", "edv2-bullets");
            renderBullets(holder, entry, `${key}.${i}`);
            ec._body.appendChild(holder);

            const add = el("button", "edv2-addbtn");
            add.type = "button";
            add.appendChild(icon("plus"));
            add.appendChild(document.createTextNode("Add Bullet"));
            add.addEventListener("click", () => {
                entry.bullets = entry.bullets || [];
                entry.bullets.push("New bullet");
                renderBullets(holder, entry, `${key}.${i}`);
                scheduleRender();
            });
            ec._body.appendChild(add);

            sec._body.appendChild(ec);
        });

        if (!list.length) {
            sec._body.appendChild(el("div", "edv2-empty",
                "No entries in this section yet."));
        }
        pane.appendChild(sec);
    }

    function renderBullets(holder, entry, pathBase) {
        holder.innerHTML = "";
        (entry.bullets || []).forEach((text, bi) => {
            const path = `${pathBase}.b${bi}`;
            const row = el("div", "edv2-bullet");
            if (hidden[path]) row.classList.add("off");
            row.draggable = true;

            const grip = el("span", "edv2-drag", "⋮⋮");
            grip.title = "Drag to reorder";
            row.appendChild(grip);

            const body = el("div", "edv2-bullet-text", text);
            body.contentEditable = "true";
            body.addEventListener("input", () => {
                entry.bullets[bi] = body.textContent;
                scheduleRender();
            });
            row.appendChild(body);

            // Floating toolbar
            const bar = el("div", "edv2-bartools");
            const mk = (ic, title, fn, extra) => {
                const b = el("button", "edv2-tool" + (extra ? " " + extra : ""));
                b.type = "button";
                b.title = title;
                b.innerHTML = SVG[ic] || "";
                b.addEventListener("click", fn);
                return b;
            };
            bar.appendChild(mk("edit", "Edit", () => body.focus()));
            bar.appendChild(mk("copy", "Duplicate", () => {
                entry.bullets.splice(bi + 1, 0, entry.bullets[bi]);
                renderBullets(holder, entry, pathBase);
                scheduleRender();
            }));
            const eyeBtn = mk(hidden[path] ? "eyeOff" : "eye", "Show / hide", () => {
                hidden[path] = !hidden[path];
                renderBullets(holder, entry, pathBase);
                scheduleRender();
            });
            bar.appendChild(eyeBtn);
            bar.appendChild(mk("trash", "Delete", () => {
                entry.bullets.splice(bi, 1);
                renderBullets(holder, entry, pathBase);
                scheduleRender();
            }));

            const ai = el("button", "edv2-tool edv2-tool-ai");
            ai.type = "button";
            ai.title = "Rewrite using AI";
            ai.innerHTML = SVG.sparkle;
            ai.appendChild(document.createTextNode("Rewrite with AI"));
            ai.addEventListener("click", () => rewriteBullet(entry, bi, body));
            bar.appendChild(ai);
            row.appendChild(bar);

            // Drag to reorder within the entry.
            row.addEventListener("dragstart", e => {
                e.dataTransfer.setData("text/plain", String(bi));
                e.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragover", e => { e.preventDefault(); });
            row.addEventListener("drop", e => {
                e.preventDefault();
                const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
                if (Number.isNaN(from) || from === bi) return;
                const [moved] = entry.bullets.splice(from, 1);
                entry.bullets.splice(bi, 0, moved);
                renderBullets(holder, entry, pathBase);
                scheduleRender();
            });

            holder.appendChild(row);
        });
    }

    async function rewriteBullet(entry, bi, node) {
        const original = entry.bullets[bi];
        node.textContent = "Rewriting…";
        try {
            const res = await fetch("/api/editor/rewrite-bullet", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bullet: original, jd: payload.jd_string || "" }),
            });
            const out = res.ok ? await res.json() : null;
            const next = (out && out.bullet) || original;
            entry.bullets[bi] = next;
            node.textContent = next;
            scheduleRender();
        } catch (e) {
            entry.bullets[bi] = original;
            node.textContent = original;
        }
    }

    /* ── Tab: Design ─────────────────────────────────────────────────────── */

    function buildDesignPane(pane) {
        pane.innerHTML = "";
        const c = card("Style Settings");
        const b = c._body;

        b.appendChild(fieldRow("Paper Size", design.paper, v => {
            design.paper = v; saveDesign(); scheduleRender();
        }, { select: [["Letter", "Letter (8.5x11 Inches)"], ["A4", "A4 (8.27x11.69 Inches)"]] }));

        b.appendChild(fieldRow("Font", design.font, v => {
            design.font = v; saveDesign(); refreshDesignPreview();
        }, { select: FONTS.map(f => [f, f]) }));

        b.appendChild(slider("Font Size", design.fontSize, 7, 14, 0.5, "pt", v => {
            design.fontSize = v; saveDesign(); refreshDesignPreview();
        }));
        b.appendChild(slider("Line Height", design.lineHeight, 1, 2.4, 0.025, "", v => {
            design.lineHeight = v; saveDesign(); refreshDesignPreview();
        }));
        b.appendChild(slider("Left & Right Margins", design.marginX, 0.2, 1.5, 0.01, "in", v => {
            design.marginX = v; saveDesign(); refreshDesignPreview();
        }));
        b.appendChild(slider("Top & Bottom Margins", design.marginY, 0.2, 2, 0.01, "in", v => {
            design.marginY = v; saveDesign(); refreshDesignPreview();
        }));

        b.appendChild(swatchRow("Accent Color", design.accent, v => {
            design.accent = v; saveDesign(); refreshDesignPreview();
        }));
        b.appendChild(swatchRow("Link Color", design.link, v => {
            design.link = v; saveDesign(); refreshDesignPreview();
        }));

        b.appendChild(segRow("Name", [["capitalize", "Capitalize"],
                                      ["uppercase", "Uppercase"],
                                      ["lowercase", "Lowercase"]],
            design.nameCase, v => { design.nameCase = v; saveDesign(); refreshDesignPreview(); }));

        b.appendChild(segRow("Header Delimiter",
            [["|", "|"], ["•", "•"], ["-", "-"], ["◇", "◇"], ["❖", "❖"]],
            design.delimiter, v => { design.delimiter = v; saveDesign(); refreshDesignPreview(); }));

        b.appendChild(segRow("List Style",
            [["•", "•"], ["○", "○"], ["■", "■"],
             ["1", "Number"], ["none", "None"]],
            design.listStyle, v => { design.listStyle = v; saveDesign(); refreshDesignPreview(); }));

        b.appendChild(fieldRow("Date Range", design.dateFormat, v => {
            design.dateFormat = v; saveDesign(); scheduleRender();
        }, { select: DATE_FORMATS }));

        const rr = el("div", "edv2-resetrow");
        const reset = el("button", "edv2-reset");
        reset.type = "button";
        reset.innerHTML = SVG.reset;
        reset.appendChild(document.createTextNode("Reset to default"));
        reset.addEventListener("click", () => {
            design = { ...DESIGN_DEFAULTS };
            saveDesign();
            buildDesignPane(pane);
            refreshDesignPreview();
            scheduleRender();
        });
        rr.appendChild(reset);
        b.appendChild(rr);

        pane.appendChild(c);
    }

    function slider(label, value, min, max, step, unit, onChange) {
        const wrap = el("div", "edv2-field");
        wrap.appendChild(el("div", "edv2-label", label));
        const row = el("div", "edv2-slider");
        const range = el("input", "edv2-range");
        range.type = "range";
        range.min = min; range.max = max; range.step = step; range.value = value;
        const num = el("input", "edv2-num");
        num.type = "text";
        num.value = unit ? `${value} ${unit}` : String(value);
        // Slider and box stay in sync in both directions.
        range.addEventListener("input", () => {
            const v = parseFloat(range.value);
            num.value = unit ? `${v} ${unit}` : String(v);
            onChange(v);
        });
        num.addEventListener("change", () => {
            const v = parseFloat(String(num.value).replace(/[^0-9.]/g, ""));
            if (Number.isNaN(v)) return;
            const clamped = Math.min(max, Math.max(min, v));
            range.value = clamped;
            num.value = unit ? `${clamped} ${unit}` : String(clamped);
            onChange(clamped);
        });
        row.append(range, num);
        wrap.appendChild(row);
        return wrap;
    }

    function swatchRow(label, value, onChange) {
        const wrap = el("div", "edv2-field");
        wrap.appendChild(el("div", "edv2-label", label));
        const row = el("div", "edv2-swatches");
        const paint = () => Array.from(row.children).forEach(ch =>
            ch.classList.toggle("on", ch.dataset.color === value));
        SWATCHES.forEach(col => {
            const s = el("button", "edv2-swatch");
            s.type = "button";
            s.style.background = col;
            s.dataset.color = col;
            s.title = col;
            s.addEventListener("click", () => { value = col; paint(); onChange(col); });
            row.appendChild(s);
        });
        // Custom picker, shown as the multicolour chip in the reference.
        const pick = el("input", "edv2-swatch");
        pick.type = "color";
        pick.value = value;
        pick.title = "Custom colour";
        pick.style.background =
            "conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7,#ef4444)";
        pick.addEventListener("input", () => { value = pick.value; paint(); onChange(pick.value); });
        row.appendChild(pick);
        paint();
        wrap.appendChild(row);
        return wrap;
    }

    function segRow(label, options, value, onChange) {
        const wrap = el("div", "edv2-field");
        wrap.appendChild(el("div", "edv2-label", label));
        const row = el("div", "edv2-seg");
        const paint = () => Array.from(row.children).forEach(ch =>
            ch.classList.toggle("on", ch.dataset.val === value));
        options.forEach(([v, t]) => {
            const b = el("button", "edv2-segbtn", t);
            b.type = "button";
            b.dataset.val = v;
            b.addEventListener("click", () => { value = v; paint(); onChange(v); });
            row.appendChild(b);
        });
        paint();
        wrap.appendChild(row);
        return wrap;
    }


    /* Hide any floating widget pinned to the bottom-right.

       Support bubbles are injected at runtime under vendor-specific names, so
       a CSS list of selectors keeps missing new ones. Matching on POSITION
       catches them all. A MutationObserver re-runs it because these widgets
       mount late and re-mount themselves. */
    function hideFloatingWidgets() {
        const sweep = () => {
            const vh = window.innerHeight, vw = window.innerWidth;
            document.querySelectorAll("body > *").forEach(node => {
                if (node.nodeType !== 1 || node === root) return;
                if (node.classList && node.classList.contains("edv2")) return;
                let cs;
                try { cs = getComputedStyle(node); } catch (e) { return; }
                if (cs.position !== "fixed" || cs.display === "none") return;
                const r = node.getBoundingClientRect();
                if (!r.width || !r.height) return;
                // Bottom-right corner, and small enough to be a widget rather
                // than a full-screen overlay such as the changes modal.
                if (r.bottom > vh - 200 && r.right > vw - 200
                    && r.width < 460 && r.height < 620) {
                    node.dataset.edv2Hidden = "1";
                    node.style.setProperty("display", "none", "important");
                }
            });
        };
        sweep();
        setTimeout(sweep, 800);
        setTimeout(sweep, 2500);
        try {
            new MutationObserver(sweep).observe(document.body, { childList: true });
        } catch (e) {}
    }

    /* ── Tab: AI Assistant ───────────────────────────────────────────────── */

    function buildAiPane(pane) {
        pane.innerHTML = "";
        const c = card("AI Tools");
        const b = c._body;

        const action = (title, desc, label, fn) => {
            const box = el("div", "edv2-field");
            box.appendChild(el("div", "edv2-sub", title));
            box.appendChild(el("div", "edv2-note", desc));
            const btn = el("button", "edv2-addbtn");
            btn.type = "button";
            btn.style.marginTop = "10px";
            btn.innerHTML = SVG.sparkle;
            btn.appendChild(document.createTextNode(label));
            btn.addEventListener("click", fn);
            box.appendChild(btn);
            return box;
        };

        const n = countChanges();
        b.appendChild(action(
            "See what changed",
            n ? `${n} rewrites, each with the original text beside it.`
              : "No AI changes recorded for this resume yet.",
            "Open change review",
            openChanges));

        b.appendChild(action(
            "One Click Optimizer",
            "Re-run the tailoring pass against the same job description.",
            "Re-optimise resume",
            () => {
                try { sessionStorage.setItem("tcv_open_changes", "1"); } catch (e) {}
                window.location.href = "/solutions";
            }));

        b.appendChild(action(
            "Rewrite a bullet",
            "Hover any bullet in Resume Content and use “Rewrite with AI” "
            + "to reword that line on its own.",
            "Go to Resume Content",
            () => {
                const tab = root.querySelector(".edv2-tab");
                if (tab) tab.click();
            }));

        pane.appendChild(c);
    }

    /* ── Shell ───────────────────────────────────────────────────────────── */

    function buildShell() {
        root = el("div", "edv2");
        document.body.classList.add("edv2-active");
        hideFloatingWidgets();

        // Top bar
        const top = el("div", "edv2-topbar");
        const crumbs = el("div", "edv2-crumbs");

        const home = el("a", "edv2-crumb");
        home.href = "/dashboard";
        home.appendChild(icon("home"));
        crumbs.appendChild(home);
        crumbs.appendChild(el("span", "edv2-crumb-sep", "›"));

        const list = el("a", "edv2-crumb", "Job Tailored Resumes");
        list.href = "/my-resumes";
        crumbs.appendChild(list);
        crumbs.appendChild(el("span", "edv2-crumb-sep", "›"));

        const titleText = payload.job_title && payload.company
            ? `${payload.job_title} at ${payload.company}`
            : (data.title || "Tailored Resume");
        const cur = el("span", "edv2-crumb current", titleText);
        crumbs.appendChild(cur);

        const rename = el("button", "edv2-rename");
        rename.type = "button";
        rename.title = "Rename";
        rename.innerHTML = SVG.pencil;
        rename.addEventListener("click", () => {
            const next = prompt("Rename this resume", cur.textContent);
            if (next && next.trim()) {
                cur.textContent = next.trim();
                payload.display_name = next.trim();
                savePayload();
            }
        });
        crumbs.appendChild(rename);
        top.appendChild(crumbs);

        const actions = el("div", "edv2-actions");
        // Live page count, so the length cost of an edit is visible while
        // making it rather than at download time.
        pageHintEl = el("span", "edv2-pages", "1 page");
        actions.appendChild(pageHintEl);

        saveBtn = el("button", "edv2-btn edv2-btn-outline edv2-save-btn");
        saveBtn.type = "button";
        saveBtn.title = "Save to My Resumes";
        saveBtn.innerHTML = SVG.cloud;
        const saveText = el("span", null, "Save to My Resumes");
        saveBtn.appendChild(saveText);
        saveBtn.addEventListener("click", async () => {
            saveBtn.disabled = true;
            saveText.textContent = "Saving...";
            const ok = await callHook("tcvSaveToMyResumes", undefined, "Save to My Resumes",
                () => toast("Couldn't save this resume.",
                            () => callHook("tcvSaveToMyResumes", undefined, "Save to My Resumes")));
            saveBtn.disabled = false;
            saveBtn.classList.toggle("saved", ok === true);
            saveText.textContent = ok === true ? "Saved to My Resumes" : "Save to My Resumes";
        });
        actions.appendChild(saveBtn);

        // "See what changed" only appears when there is something to review,
        // and carries the count so the review has a visible size before it is
        // opened. Sits left of the optimiser, per the reference bar.
        const n = countChanges();
        if (n > 0) {
            const seen = el("button", "edv2-btn edv2-btn-outline");
            seen.type = "button";
            seen.innerHTML = SVG.diff;
            seen.appendChild(el("span", null, "See what changed"));
            seen.appendChild(el("span", "edv2-badge", String(n)));
            seen.addEventListener("click", openChanges);
            actions.appendChild(seen);
        }

        const opt = el("button", "edv2-btn edv2-btn-primary");
        opt.type = "button";
        opt.innerHTML = SVG.rocket;
        opt.appendChild(el("span", null, "One Click Optimizer"));
        opt.addEventListener("click", () => {
            // Coming back from a re-optimise, the review should be waiting
            // rather than needing to be found.
            try { sessionStorage.setItem("tcv_open_changes", "1"); } catch (e) {}
            window.location.href = "/solutions";
        });
        actions.appendChild(opt);

        const dl = el("button", "edv2-btn edv2-btn-outline");
        dl.type = "button";
        dl.innerHTML = SVG.download;
        dl.appendChild(el("span", null, "Download Resume"));
        dl.addEventListener("click", () => {
            callHook("tcvDownloadEditedPdf", undefined, "Download Resume",
                () => toast("Couldn't start the download.",
                            () => callHook("tcvDownloadEditedPdf", undefined, "Download Resume")));
        });
        actions.appendChild(dl);
        top.appendChild(actions);
        root.appendChild(top);

        // Body
        const body = el("div", "edv2-body");
        const panel = el("div", "edv2-panel");

        const tabs = el("div", "edv2-tabs");
        const panes = el("div", "edv2-tabpanes");
        const paneMap = {};

        [["content", "person", "Resume Content"],
         ["ai", "sparkle", "AI Assistant"],
         ["design", "palette", "Design"]].forEach(([key, ic, label], i) => {
            const selected = key === "design";
            const t = el("button", "edv2-tab" + (selected ? " on" : ""));
            t.type = "button";
            t.innerHTML = SVG[ic];
            t.appendChild(el("span", null, label));
            const pane = el("div", "edv2-pane");
            if (!selected) pane.hidden = true;
            paneMap[key] = pane;
            panes.appendChild(pane);
            t.addEventListener("click", () => {
                Array.from(tabs.querySelectorAll(".edv2-tab"))
                    .forEach(x => x.classList.remove("on"));
                t.classList.add("on");
                Object.keys(paneMap).forEach(k => { paneMap[k].hidden = k !== key; });
            });
            tabs.appendChild(t);
        });

        const collapse = el("button", "edv2-collapse");
        collapse.type = "button";
        collapse.title = "Collapse panel";
        collapse.innerHTML = SVG.panel;
        collapse.addEventListener("click", () => root.classList.toggle("panel-collapsed"));
        tabs.appendChild(collapse);

        panel.append(tabs, panes);
        body.appendChild(panel);

        const preview = el("div", "edv2-preview");
        tipEl = el("div", "edv2-tip");
        tipEl.hidden = true;
        preview.appendChild(tipEl);
        const page = el("div", "edv2-page");
        frameEl = el("iframe", "edv2-frame");
        frameEl.setAttribute("title", "Resume preview");
        frameEl.setAttribute("scrolling", "no");
        frameEl.addEventListener("load", () => {
            applyDesignToFrame();
            fitFrame();
            layoutPages();
        });
        page.appendChild(frameEl);
        preview.appendChild(page);
        body.appendChild(preview);

        root.appendChild(body);
        document.body.appendChild(root);

        buildContentPane(paneMap.content);
        buildAiPane(paneMap.ai);
        buildDesignPane(paneMap.design);

        if (payload.html) paintFrame(payload.html);
        // The page count only arrived with a render response, and nothing
        // renders until the first edit - so the bar said "1 page" however long
        // the resume was. Ask once on open.
        countPages();
        window.addEventListener("resize", () => { fitFrame(); layoutPages(); });

        // Returning from a re-optimise: open the review without being asked.
        try {
            if (sessionStorage.getItem("tcv_open_changes") === "1") {
                sessionStorage.removeItem("tcv_open_changes");
                if (countChanges() > 0) setTimeout(openChanges, 600);
            }
        } catch (e) {}
    }

    /* ── Boot ────────────────────────────────────────────────────────────── */
    function init() {
        payload = loadPayload();
        // The editor mounts even with no resume.
        //
        // This used to `return` when sessionStorage was empty, leaving the
        // LEGACY editor markup that the template still ships on screen - which
        // is indistinguishable from the new editor having been reverted. It is
        // empty on a direct visit, a reload, a new tab, and for any account
        // that has not saved a resume yet (verified: user 1099 has 0 rows in
        // saved_resumes), so that was most visits. An empty shell the person
        // can start typing into beats silently showing them the old page.
        if (!payload) payload = {};
        if (!payload.resume_data) payload.resume_data = {};

        // One line that says whether the shared actions registered. If a
        // button ever misbehaves again, this answers "is the hook there?"
        // immediately instead of costing a round of guesswork.
        console.info("[TailorCV] editor v2 ready.", {
            changesHook: typeof window.tcvShowChangesModal === "function",
            downloadHook: typeof window.tcvDownloadEditedPdf === "function",
            changes: (payload.resume_data || {}).changes ? countChanges() : 0,
        });
        data = payload.resume_data || {};
        loadDesign();
        try { hidden = JSON.parse(sessionStorage.getItem("tailorcv_editor_hidden") || "{}"); }
        catch (e) { hidden = {}; }
        buildShell();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
