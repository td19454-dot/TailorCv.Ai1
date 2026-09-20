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
        (function attempt() {
            const fn = window[name];
            if (typeof fn === "function") { fn(arg); return; }
            if (++tries < 20) { setTimeout(attempt, 100); return; }
            console.warn("[TailorCV] " + name + " unavailable - " + label + " did nothing.");
            if (onFail) onFail();
        })();
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
        font: "Georgia",
        fontSize: 10.5,
        lineHeight: 1.2,
        // A resume's own template already carries page padding, so stacking a
        // 1.4in margin on top left roughly two inches of dead space above the
        // name. 0.5in matches what the reference design renders.
        marginX: 0.5,
        marginY: 0.5,
        accent: "#111827",
        link: "#2563eb",
        nameCase: "capitalize",
        delimiter: "◇",
        listStyle: "•",
        dateFormat: "MMM 'YY",
    };

    const SWATCHES = ["#111827", "#2563eb", "#7c3aed", "#f87171",
                      "#f59e0b", "#14b8a6", "#dc2626"];

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
    let pageCount = 1;
    // The document's original top-level blocks, captured before the first
    // pagination. Re-paginating rebuilds from these, so repeated passes can
    // never drop or duplicate content.
    let frameSource = [];
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
        try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null"); }
        catch (e) { return null; }
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

    function buildDesignCss() {
        const P = paperSize();
        const nameCase = design.nameCase === "uppercase" ? "uppercase"
                       : design.nameCase === "lowercase" ? "lowercase" : "none";
        const px = Math.max(8, Number(design.fontSize || 10.5) * 96 / 72);
        const delimiter = String(design.delimiter || "|");
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
            h1, .name, .resume-name, .header-name {
                color: ${design.accent} !important;
                text-transform: ${nameCase} !important;
            }
            h2, .section-title, .section-heading, .sec-title {
                color: ${design.accent} !important;
            }
            a, .contact a, .links a { color: ${design.link} !important; }
            .contact-item + .contact-item::before,
            .project-state-contact-separator::before {
                content: " ${delimiter.replace(/\\/g, "\\\\").replace(/"/g, '\\"')} " !important;
            }
            ul, ol {
                list-style-type: ${listStyleCss(design.listStyle)} !important;
                list-style-position: outside !important;
                padding-left: 1.15em !important;
                margin-left: 0 !important;
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
        if (h > 0) frameEl.style.height = (h + 8) + "px";
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
    function layoutPages() {
        const doc = frameEl && frameEl.contentDocument;
        if (!doc || !doc.body) { updatePageHint(); return; }

        const P = paperSize();
        const pxPerIn = frameEl.clientWidth / P.w;
        const printable = (P.h - design.marginY * 2) * pxPerIn;
        if (!(printable > 50)) { updatePageHint(); return; }

        // Source blocks, captured once so re-paginating never loses content.
        if (!doc.body.dataset.edv2Src) {
            doc.body.dataset.edv2Src = "1";
            frameSource = Array.from(doc.body.children)
                .filter(n => !n.classList || !n.classList.contains("edv2-sheet"))
                .map(n => n.cloneNode(true));
        }
        if (!frameSource.length) { updatePageHint(); return; }

        let st = doc.getElementById("edv2-pagecss");
        if (!st) {
            st = doc.createElement("style");
            st.id = "edv2-pagecss";
            doc.head.appendChild(st);
        }
        st.textContent = `
            html, body { background: #eef0f4 !important; padding: 0 !important;
                         margin: 0 !important; }
            .edv2-sheet {
                background: #fff; box-sizing: border-box;
                width: 100%; min-height: ${P.h * pxPerIn}px;
                padding: ${design.marginY}in ${design.marginX}in;
                margin: 0 0 8px; box-shadow: 0 1px 3px rgba(17,24,39,.12);
                overflow: hidden;
            }
            .edv2-sheetlabel {
                text-align: center; font: 500 11px system-ui, sans-serif;
                color: #6b7280; margin: 0 0 24px;
            }
        `;

        // Rebuild from the captured source every time.
        doc.body.innerHTML = "";
        const newSheet = () => {
            const s = doc.createElement("div");
            s.className = "edv2-sheet";
            doc.body.appendChild(s);
            return s;
        };

        let sheet = newSheet();
        frameSource.forEach(node => {
            const block = node.cloneNode(true);
            sheet.appendChild(block);
            // Overflowed this sheet: move the block to a fresh one. A block
            // taller than a whole page stays put - splitting mid-element
            // would need its own layout pass and is what page-break CSS in
            // the PDF handles.
            if (sheet.scrollHeight > printable && sheet.children.length > 1) {
                sheet.removeChild(block);
                sheet = newSheet();
                sheet.appendChild(block);
            }
        });

        // Label each sheet underneath it.
        const sheets = Array.from(doc.querySelectorAll(".edv2-sheet"));
        pageCount = Math.max(1, sheets.length);
        sheets.forEach((s, i) => {
            const lab = doc.createElement("div");
            lab.className = "edv2-sheetlabel";
            lab.textContent = `Page ${i + 1} of ${pageCount}`;
            s.insertAdjacentElement("afterend", lab);
        });

        fitFrame();
        updatePageHint();
    }

    /* Page count for the current HTML, from the same engine as the PDF. */
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
                    if (out.pages) pageCount = out.pages;
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

        saveBtn = el("button", "edv2-iconbtn");
        saveBtn.type = "button";
        saveBtn.title = "Saved";
        saveBtn.innerHTML = SVG.cloud;
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
         ["design", "palette", "Design"]].forEach(([key, ic, label], i) => {
            const t = el("button", "edv2-tab" + (i === 0 ? " on" : ""));
            t.type = "button";
            t.innerHTML = SVG[ic];
            t.appendChild(el("span", null, label));
            const pane = el("div", "edv2-pane");
            if (i !== 0) pane.hidden = true;
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
        if (!payload || !payload.html) return;      // old editor handles this

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
