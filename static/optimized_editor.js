(function () {
    "use strict";

    /* ─────────────────────────────────────────────────────────────────────────
       CONSTANTS & CONFIG
    ───────────────────────────────────────────────────────────────────────── */
    const STORAGE_KEY           = "tailorcv_optimized_editor_payload";
    const AUTO_DOWNLOAD_ON_OPEN = false;

    const A4_WIDTH_MM  = 210;
    const A4_HEIGHT_MM = 297;
    const LETTER_WIDTH_MM  = 215.9;
    const LETTER_HEIGHT_MM = 279.4;
    const MM_TO_PX     = 96 / 25.4;
    const A4_WIDTH_PX  = A4_WIDTH_MM  * MM_TO_PX;
    const A4_HEIGHT_PX = A4_HEIGHT_MM * MM_TO_PX;
    const LETTER_WIDTH_PX  = LETTER_WIDTH_MM  * MM_TO_PX;
    const LETTER_HEIGHT_PX = LETTER_HEIGHT_MM * MM_TO_PX;
    const PAGE_GAP_PX  = 24;

    /* ─────────────────────────────────────────────────────────────────────────
       DOM REFS
    ───────────────────────────────────────────────────────────────────────── */
    const frame           = document.getElementById("resume-preview-frame");
    const statusEl        = document.getElementById("editor-status");
    const downloadBtn     = document.getElementById("download-edited-btn");
    const saveBtn         = document.getElementById("save-resume-btn");
    const fontDecreaseBtn = document.getElementById("font-decrease-btn");
    const fontResetBtn    = document.getElementById("font-reset-btn");
    const fontIncreaseBtn = document.getElementById("font-increase-btn");
    const fontSizeBadge   = document.getElementById("font-size-badge");
    const pageIndexBadge  = document.getElementById("page-index-badge");
    const fitGuidance     = document.getElementById("fit-guidance");
    const previewWrap     = document.querySelector(".editor-preview-wrap");

    /* ─────────────────────────────────────────────────────────────────────────
       STATE
    ───────────────────────────────────────────────────────────────────────── */
    let currentHtml              = "";
    let currentZoom              = 1.0;
    let templateId               = 1;
    let estimatedPages           = 1;
    let lastFillRatio            = 1;
    let hasAutoDownloaded        = false;
    let baseFontsCaptured        = false;
    let estimateTimer            = null;
    let estimateRequestId        = 0;
    let currentLineSpacing       = 1;
    let baseLineSpacingsCaptured = false;
    let currentAccentColor       = null;
    let legacyDesign             = {
        paper: "A4",
        font: "Arial",
        nameCase: "capitalize",
        delimiter: "◇",
        listStyle: "disc",
        dateFormat: "MMM 'YY",
    };
    let allTemplates             = [];
    // The frame's load handler re-runs on every srcdoc swap, including the one
    // that applies confirmed skills, so the prompt is shown at most once.
    let hasShownSkillGapPrompt   = false;

    /* ─────────────────────────────────────────────────────────────────────────
       HELPERS – STATUS / BADGE
    ───────────────────────────────────────────────────────────────────────── */
    /* One status line only. This used to write the same text into #fit-guidance and
       #editor-status, so every message rendered twice in the sidebar (and two
       aria-live regions announced it twice). */
    function setStatus(msg) {
        if (statusEl) statusEl.textContent = msg || "";
    }

    function updateFontSizeBadge() {
        if (fontSizeBadge)
            fontSizeBadge.textContent = `${Math.round(currentZoom * 100)}%`;
    }

    function updatePageBadge() {
        if (!pageIndexBadge) return;
        const fillPct = Math.max(1, Math.min(100, Math.round(lastFillRatio * 100)));
        pageIndexBadge.textContent = `Pages: ${estimatedPages} | Fill: ${fillPct}%`;
        pageIndexBadge.classList.toggle("multipage", estimatedPages > 1);
    }

    function updateFitGuidance() {
        const fillPct = Math.max(1, Math.min(100, Math.round(lastFillRatio * 100)));
        if (estimatedPages > 1) {
            setStatus(`${estimatedPages} pages — press A- to shrink back to 1 page.`);
            return;
        }
        if (fillPct >= 90) { setStatus("Perfect fit on 1 page. Ready to download!"); return; }
        if (fillPct <= 78) { setStatus("Lots of space left — press A+ to increase font size."); return; }
        setStatus("Good fit. You can nudge font (A+) if you like.");
    }

    function pageWidthPx() {
        return legacyDesign.paper === "Letter" ? LETTER_WIDTH_PX : A4_WIDTH_PX;
    }

    function pageHeightPx() {
        return legacyDesign.paper === "Letter" ? LETTER_HEIGHT_PX : A4_HEIGHT_PX;
    }

    function paperCssSize() {
        return legacyDesign.paper === "Letter" ? "8.5in 11in" : "8.27in 11.69in";
    }

    /* ─────────────────────────────────────────────────────────────────────────
       PAYLOAD
    ───────────────────────────────────────────────────────────────────────── */
    function getPayload() {
        try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null"); }
        catch { return null; }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       EDITING OVERLAY
    ───────────────────────────────────────────────────────────────────────── */
    function addEditingOverlay(html) {
        // The preview body is contentEditable so the resume can be typed into.
        // A side effect is that browsers stop FOLLOWING links inside it - a click
        // just drops the caret - so the links looked broken even though the
        // exported PDF carries them correctly. The handler below restores plain
        // click-to-open, and alt+click still places the caret for editing the
        // label text.
        const script = `<script>
document.addEventListener("DOMContentLoaded", function () {
  document.body.contentEditable = "true";
  document.body.spellcheck      = false;
  document.body.style.outline   = "none";

  var style = document.createElement("style");
  style.textContent = "a[href]{cursor:pointer;}";
  document.head.appendChild(style);

  document.addEventListener("click", function (e) {
    if (e.altKey || e.defaultPrevented) return;
    var el = e.target;
    while (el && el.nodeName !== "A") el = el.parentElement;
    if (!el) return;
    var href = el.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#") return;
    e.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  });
});
<\/script>`;
        return html.includes("</body>")
            ? html.replace("</body>", script + "</body>")
            : html + script;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       FONT SCALE HELPERS
    ───────────────────────────────────────────────────────────────────────── */
    const FONT_SEL = "h1,h2,h3,h4,h5,h6,p,li,span,a,strong,em,b,i,small,label,td,th,div";

    function captureBaseFonts(doc) {
        if (baseFontsCaptured || !doc || !doc.body) return;
        doc.body.querySelectorAll(FONT_SEL).forEach(node => {
            if (node.children.length > 3) return;
            const fs = doc.defaultView
                ? parseFloat(doc.defaultView.getComputedStyle(node).fontSize)
                : NaN;
            if (Number.isFinite(fs) && fs > 0)
                node.setAttribute("data-base-font", String(fs));
        });
        baseFontsCaptured = true;
    }

    function applyFontScale(doc, scale) {
        if (!doc || !doc.body) return;
        doc.body.querySelectorAll(FONT_SEL).forEach(node => {
            const base = parseFloat(node.getAttribute("data-base-font") || "");
            if (!Number.isFinite(base) || base <= 0) return;
            node.style.setProperty("font-size", `${Math.max(6, Math.min(96, base * scale))}px`, "important");
        });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       LINE SPACING HELPERS
    ───────────────────────────────────────────────────────────────────────── */
    const SPACING_SEL = "p,li,span,td,th,div,a,strong,em";

    function captureBaseLineSpacing(doc) {
        if (baseLineSpacingsCaptured || !doc || !doc.body) return;
        doc.body.querySelectorAll(SPACING_SEL).forEach(node => {
            if (!doc.defaultView) return;
            const val = parseFloat(doc.defaultView.getComputedStyle(node).lineHeight || "");
            if (!Number.isFinite(val) || val <= 0) return;
            node.setAttribute("data-tailorcv-base-lh", String(val));
        });
        baseLineSpacingsCaptured = true;
    }

    function applyLineSpacing(doc, scale) {
        if (!doc || !doc.body) return;
        doc.body.querySelectorAll(SPACING_SEL).forEach(node => {
            const base = parseFloat(node.getAttribute("data-tailorcv-base-lh") || "");
            if (!Number.isFinite(base) || base <= 0) return;
            const next = Math.max(8, Math.min(80, base * scale));
            node.style.setProperty("line-height", `${next}px`, "important");
        });
    }

    function changeLineSpacing(delta) {
        currentLineSpacing = Math.max(0.7, Math.min(1.5, currentLineSpacing + delta));
        if (frame && frame.contentDocument) {
            captureBaseLineSpacing(frame.contentDocument);
            applyLineSpacing(frame.contentDocument, currentLineSpacing);
        }
        const badge    = document.getElementById("spacing-badge");
        const guidance = document.getElementById("spacing-guidance");
        if (badge) badge.textContent = `${Math.round(currentLineSpacing * 100)}%`;
        if (guidance) {
            if (currentLineSpacing < 0.85)       guidance.textContent = "Very tight — text may feel cramped.";
            else if (currentLineSpacing <= 0.95) guidance.textContent = "Compact — good for fitting one page.";
            else if (currentLineSpacing <= 1.05) guidance.textContent = "Default spacing.";
            else if (currentLineSpacing <= 1.2)  guidance.textContent = "Comfortable — good if you have space.";
            else                                 guidance.textContent = "Very loose — consider reducing if over one page.";
        }
        setStatus(`Line spacing: ${Math.round(currentLineSpacing * 100)}%.`);
        scheduleServerEstimate();
    }

    function resetLineSpacing() {
        currentLineSpacing = 1;
        if (frame && frame.contentDocument) {
            applyLineSpacing(frame.contentDocument, 1);
        }
        const badge    = document.getElementById("spacing-badge");
        const guidance = document.getElementById("spacing-guidance");
        if (badge) badge.textContent = "100%";
        if (guidance) guidance.textContent = "Default spacing.";
        setStatus("Line spacing reset to default.");
        scheduleServerEstimate();
    }

    /* ─────────────────────────────────────────────────────────────────────────
       STYLE SETTINGS PANEL
    ───────────────────────────────────────────────────────────────────────── */
    const DESIGN_TEXT_SEL = "body,h1,h2,h3,h4,h5,h6,p,li,span,a,strong,em,b,i,small,td,th,div";

    function cssString(value) {
        return JSON.stringify(String(value == null ? "" : value));
    }

    function listStyleCss(value) {
        if (value === "circle" || value === "square" || value === "decimal" || value === "none") return value;
        return "disc";
    }

    function nameTransformCss(value) {
        if (value === "uppercase") return "uppercase";
        if (value === "lowercase") return "lowercase";
        return "none";
    }

    function applyLegacyDesignSettings(doc) {
        if (!doc || !doc.head) return;
        let style = doc.getElementById("tailorcv-style-settings");
        if (!style) {
            style = doc.createElement("style");
            style.id = "tailorcv-style-settings";
            doc.head.appendChild(style);
        }
        style.textContent = `
@page { size: ${paperCssSize()}; margin: ${legacyDesign.marginY || 0.39}in ${legacyDesign.marginX || 0.39}in; }
${DESIGN_TEXT_SEL} {
  font-family: ${cssString(legacyDesign.font)}, serif !important;
}
body {
  padding: ${legacyDesign.marginY || 0.39}in ${legacyDesign.marginX || 0.39}in !important;
  box-sizing: border-box !important;
}
h1, .name, .resume-name, .header-name {
  text-transform: ${nameTransformCss(legacyDesign.nameCase)} !important;
}
ul, ol {
  list-style-type: ${listStyleCss(legacyDesign.listStyle)} !important;
}
a, .contact a, .links a {
  color: ${legacyDesign.link || "#000000"} !important;
}
.contact-item + .contact-item::before,
.project-state-contact-separator::before {
  content: " ${String(legacyDesign.delimiter || "◇").replace(/\\/g, "\\\\").replace(/"/g, '\\"')} " !important;
}
`;
        formatDates(doc);
    }

    const MONTHS = {
        jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
        apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
        aug: 8, august: 8, sep: 9, sept: 9, september: 9,
        oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    function formatDateToken(token) {
        const raw = String(token || "");
        let m = raw.match(/\b([A-Za-z]{3,9})\.?\s+('?\d{2}|\d{4})\b/);
        let month, year;
        if (m) {
            month = MONTHS[m[1].toLowerCase()];
            year = m[2].replace(/^'/, "");
        } else {
            m = raw.match(/\b(\d{1,2})\/(\d{2,4})\b/);
            if (!m) return raw;
            month = Number(m[1]);
            year = m[2];
        }
        if (!month || month < 1 || month > 12) return raw;
        const yyyy = year.length === 2 ? "20" + year : year;
        const yy = yyyy.slice(-2);
        if (legacyDesign.dateFormat === "MMM YYYY") return `${MONTH_ABBR[month - 1]} ${yyyy}`;
        if (legacyDesign.dateFormat === "MM/YYYY") return `${String(month).padStart(2, "0")}/${yyyy}`;
        if (legacyDesign.dateFormat === "YYYY") return yyyy;
        return `${MONTH_ABBR[month - 1]} '${yy}`;
    }

    function formatDates(doc) {
        if (!doc || !doc.body) return;
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT)$/i.test(parent.tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return /\b([A-Za-z]{3,9}\.?\s+'?\d{2,4}|\d{1,2}\/\d{2,4})\b/.test(node.nodeValue || "")
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            if (!node.parentElement.dataset.tailorcvOriginalDateText) {
                node.parentElement.dataset.tailorcvOriginalDateText = node.nodeValue;
            }
            const original = node.parentElement.dataset.tailorcvOriginalDateText;
            node.nodeValue = original.replace(/\b([A-Za-z]{3,9}\.?\s+'?\d{2,4}|\d{1,2}\/\d{2,4})\b/g, formatDateToken);
        });
    }

    function setSegmentedValue(control, value) {
        document.querySelectorAll(`.style-segmented[data-style-control="${control}"] button`).forEach(btn => {
            btn.classList.toggle("active", btn.dataset.value === value);
        });
    }

    function syncRangeNumber(rangeId, inputId, value, unit) {
        const range = document.getElementById(rangeId);
        const input = document.getElementById(inputId);
        if (range) range.value = String(value);
        if (input) input.value = unit ? `${value} ${unit}` : String(value);
    }

    function setFontSizePt(value) {
        const v = Math.max(7, Math.min(14, Number(value) || 11));
        currentZoom = v / 11;
        syncRangeNumber("font-size-range", "font-size-input", v, "pt");
        applyWordStylePreview();
        updateFontSizeBadge();
        setStatus(`Font size: ${v} pt.`);
    }

    function setLineHeightValue(value) {
        const v = Math.max(1, Math.min(2.4, Number(value) || 1.125));
        currentLineSpacing = v / 1.125;
        syncRangeNumber("line-height-range", "line-height-input", v, "");
        if (frame && frame.contentDocument) {
            captureBaseLineSpacing(frame.contentDocument);
            applyLineSpacing(frame.contentDocument, currentLineSpacing);
        }
        const guidance = document.getElementById("spacing-guidance");
        if (guidance) guidance.textContent = v <= 1.15 ? "Default spacing." : "Comfortable spacing.";
        applyWordStylePreview();
        setStatus(`Line height: ${v}.`);
    }

    function setMargin(axis, value) {
        const max = axis === "x" ? 1.5 : 2;
        const v = Math.max(0.2, Math.min(max, Number(value) || 0.39));
        if (axis === "x") {
            legacyDesign.marginX = v;
            syncRangeNumber("margin-x-range", "margin-x-input", v, "in");
        } else {
            legacyDesign.marginY = v;
            syncRangeNumber("margin-y-range", "margin-y-input", v, "in");
        }
        applyWordStylePreview();
        setStatus("Margins updated.");
    }

    function buildLinkColorPanel() {
        const container = document.getElementById("tc-link-panel-container");
        if (!container) return;
        const colors = ["#000000", "#0b7de3", "#7c3aed", "#ff5a5f", "#f5a623", "#2ec9bd", "#d61f32"];
        container.innerHTML = `
            <div class="tc-accent-presets">
                ${colors.map(c => `<button class="tc-accent-swatch ${legacyDesign.link === c ? "active" : ""}" type="button" data-hex="${c}" style="background:${c}" title="${c}"></button>`).join("")}
                <input class="tc-accent-swatch tc-accent-custom-input" type="color" value="${legacyDesign.link}" title="Custom link color">
            </div>
        `;
        container.querySelectorAll("button[data-hex]").forEach(btn => {
            btn.addEventListener("click", () => {
                legacyDesign.link = btn.dataset.hex;
                buildLinkColorPanel();
                applyWordStylePreview();
                setStatus(`Link color: ${legacyDesign.link}`);
            });
        });
        container.querySelector("input[type='color']")?.addEventListener("input", e => {
            legacyDesign.link = e.target.value;
            container.querySelectorAll(".tc-accent-swatch").forEach(s => s.classList.remove("active"));
            applyWordStylePreview();
            setStatus(`Link color: ${legacyDesign.link}`);
        });
    }

    function bindStyleSettings() {
        const paper = document.getElementById("paper-size-select");
        if (paper) {
            paper.value = legacyDesign.paper;
            paper.addEventListener("change", () => {
                legacyDesign.paper = paper.value === "Letter" ? "Letter" : "A4";
                applyWordStylePreview();
                setStatus(`Paper size: ${legacyDesign.paper}.`);
            });
        }

        const font = document.getElementById("font-family-select");
        if (font) {
            font.value = legacyDesign.font;
            font.addEventListener("change", () => {
                legacyDesign.font = font.value;
                applyWordStylePreview();
                setStatus(`Font: ${legacyDesign.font}.`);
            });
        }

        [
            ["font-size-range", "font-size-input", "pt", setFontSizePt],
            ["line-height-range", "line-height-input", "", setLineHeightValue],
            ["margin-x-range", "margin-x-input", "in", v => setMargin("x", v)],
            ["margin-y-range", "margin-y-input", "in", v => setMargin("y", v)],
        ].forEach(([rangeId, inputId, unit, fn]) => {
            const range = document.getElementById(rangeId);
            const input = document.getElementById(inputId);
            range?.addEventListener("input", () => fn(parseFloat(range.value)));
            input?.addEventListener("change", () => fn(parseFloat(String(input.value).replace(/[^0-9.]/g, ""))));
        });

        document.querySelectorAll(".style-segmented[data-style-control]").forEach(group => {
            group.addEventListener("click", e => {
                const btn = e.target.closest("button[data-value]");
                if (!btn) return;
                const control = group.dataset.styleControl;
                legacyDesign[control] = btn.dataset.value;
                setSegmentedValue(control, btn.dataset.value);
                applyWordStylePreview();
                setStatus("Style setting updated.");
            });
        });

        buildLinkColorPanel();
    }

    /* ─────────────────────────────────────────────────────────────────────────
       ACCENT COLOR
    ───────────────────────────────────────────────────────────────────────── */
    const ACCENT_PROPS = [
        "--accent", "--primary", "--brand", "--color-primary",
        "--cv-accent", "--sidebar-bg", "--header-bg"
    ];

    function detectTemplateAccent(doc) {
        if (!doc || !doc.body) return "#2563eb";
        const root = doc.documentElement;
        const cs   = doc.defaultView ? doc.defaultView.getComputedStyle(root) : null;

        if (cs) {
            for (const prop of ACCENT_PROPS) {
                const val = cs.getPropertyValue(prop).trim();
                if (val && val !== "none" && val !== "") return val;
            }
        }

        const sidebar = doc.body.querySelector(
            ".sidebar,.cv-sidebar,.left-col,.header,.cv-header,.resume-header,.section-title"
        );
        if (sidebar) {
            const bg = doc.defaultView
                ? doc.defaultView.getComputedStyle(sidebar).backgroundColor
                : null;
            if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
                return rgbToHex(bg);
            }
        }

        const h2 = doc.body.querySelector("h2");
        if (h2) {
            const col = doc.defaultView
                ? doc.defaultView.getComputedStyle(h2).color
                : null;
            if (col && col !== "rgb(0, 0, 0)") return rgbToHex(col);
        }

        return "#2563eb";
    }

    function rgbToHex(rgb) {
        const m = rgb.match(/\d+/g);
        if (!m || m.length < 3) return "#2563eb";
        return "#" + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, "0")).join("");
    }

    /* A "band" is an element that ALREADY has a solid, non-white background — a real
       sidebar or header block. Templates 1-6 are black-and-white: their .resume-header
       is just the name on white, so flood-filling it hid the name (same colour as its
       own background) and made the contact line unreadable. Only genuine bands get
       painted; everything else just takes the accent on text and rules. */
    const BAND_SELECTOR = [
        ".sidebar", ".cv-sidebar", ".left-col", ".left-panel",
        '[class*="sidebar"]', '[class*="side-col"]',
        ".resume-header", ".cv-header", ".header-band",
        ".header-left", ".top-band", ".top-header",
        ".section-header", ".name-band"
    ].join(",");

    function isSolidNonWhite(bg) {
        if (!bg) return false;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        if (!m) return false;
        const p = m[1].split(",").map(s => parseFloat(s));
        if (p.length < 3) return false;
        const alpha = p.length > 3 ? p[3] : 1;
        if (alpha < 0.5) return false;                             // transparent
        if (p[0] > 240 && p[1] > 240 && p[2] > 240) return false;  // white / near-white
        return true;
    }

    function markAccentBands(doc) {
        const win = doc.defaultView;
        doc.querySelectorAll(".tc-accent-band").forEach(el => el.classList.remove("tc-accent-band"));
        if (!win) return;
        doc.querySelectorAll(BAND_SELECTOR).forEach(el => {
            // Read the background BEFORE our override applies, so we judge the
            // template's own design rather than a colour we just painted on.
            if (isSolidNonWhite(win.getComputedStyle(el).backgroundColor)) {
                el.classList.add("tc-accent-band");
            }
        });
    }

    function darkenHex(hex, amount) {
        const num = parseInt(hex.replace("#", ""), 16);
        const r   = Math.max(0, (num >> 16) - amount);
        const g   = Math.max(0, ((num >> 8) & 0xff) - amount);
        const b   = Math.max(0, (num & 0xff) - amount);
        return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
    }


    /* -- Generic palette re-tinting -------------------------------------------
       Every template names its palette differently (--accent, --green, --teal,
       --blue, --primary, --pill, --teal-link, ...) and some colours are hardcoded
       rather than held in a variable. Enumerating names never scaled: each new
       template broke it. Instead we read the template's OWN stylesheet, work out
       its accent, and retint every colour in that accent's hue family, wherever it
       lives -- variables and hardcoded values alike.

       These names carry the page/body colours and are never recoloured, or the
       paper itself would change hue. */
    const NEUTRAL_VAR = /^--(paper|bg|background|page|surface|shell|side|ink|text|muted|sidebar-ink)$/i;

    function toHex(val) {
        if (!val) return null;
        val = String(val).trim();
        if (val.startsWith("#")) {
            if (val.length === 4) return "#" + val.slice(1).split("").map(c => c + c).join("");
            return val.length === 7 ? val.toLowerCase() : null;
        }
        const m = val.match(/\d+/g);
        if (!m || m.length < 3) return null;
        return "#" + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, "0")).join("");
    }

    function hexToHsl(hex) {
        const n = parseInt(hex.replace("#", ""), 16);
        const r = (n >> 16) / 255, g = ((n >> 8) & 0xff) / 255, b = (n & 0xff) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const d = max - min;
        let h = 0, s = 0;
        if (d) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if      (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else                h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h, s, l };
    }

    function hslToHex(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s = Math.min(1, Math.max(0, s));
        l = Math.min(1, Math.max(0, l));
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if      (h <  60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else              { r = c; b = x; }
        return "#" + [r, g, b]
            .map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0"))
            .join("");
    }

    function hueDistance(a, b) {
        const d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    /* Every style rule in the resume document (skipping our own override sheet). */
    function collectStyleRules(doc, skipNode) {
        const out = [];
        const push = (rules) => {
            for (const r of rules) {
                if (r.style && r.selectorText) out.push(r);
                else if (r.cssRules) push(r.cssRules);          // @media, @supports
            }
        };
        for (const sheet of Array.from(doc.styleSheets || [])) {
            if (skipNode && sheet.ownerNode === skipNode) continue;
            let rules;
            try { rules = sheet.cssRules; } catch (e) { continue; }   // cross-origin
            if (rules) push(rules);
        }
        return out;
    }

    /* Custom properties declared on :root / html. */
    function paletteVarNames(doc, skipNode) {
        const names = new Set();
        collectStyleRules(doc, skipNode).forEach((rule) => {
            const sel = rule.selectorText.trim().toLowerCase();
            if (sel !== ":root" && sel !== "html" && sel !== "*") return;
            for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith("--")) names.add(prop);
            }
        });
        return Array.from(names);
    }

    /* --accent-dark is usually MORE saturated than --accent, so "most saturated" alone
       picks the dark variant as the base and every derived shade lands too light.
       Prefer a plain name (no -dark/-light/-soft/-deep/-2 suffix), then saturation. */
    const MODIFIER_SUFFIX = /-(dark|darker|light|lighter|soft|deep|deeper|pale|tint|muted|hover|2)$/i;

    function findBaseAccent(doc, skipNode) {
        const win = doc.defaultView;
        if (!win) return null;
        const cs = win.getComputedStyle(doc.documentElement);

        const candidates = [];
        paletteVarNames(doc, skipNode).forEach((name) => {
            if (NEUTRAL_VAR.test(name)) return;
            const hx = toHex(cs.getPropertyValue(name));
            if (!hx) return;
            const c = hexToHsl(hx);
            if (c.s < 0.12 || c.l > 0.92 || c.l < 0.06) return;   // grey / near-white / near-black
            candidates.push({ name: name, hex: hx, hsl: c, plain: !MODIFIER_SUFFIX.test(name) });
        });
        if (candidates.length) {
            const plain = candidates.filter(c => c.plain);
            const pool  = plain.length ? plain : candidates;
            const best  = pool.reduce((a, b) => (b.hsl.s > a.hsl.s ? b : a));
            best.mono = false;
            return best;
        }

        /* Greyscale template (e.g. 13: --header #8d8d90, --accent #3a3d43). Nothing is
           saturated, so the hue-family test has nothing to match on. Treat it as
           monochrome: its non-neutral vars ARE the accent roles (header band, headings,
           rules), so map each onto the chosen hue at its own lightness. */
        const greys = [];
        paletteVarNames(doc, skipNode).forEach((name) => {
            if (NEUTRAL_VAR.test(name)) return;
            const hx = toHex(cs.getPropertyValue(name));
            if (!hx) return;
            const c = hexToHsl(hx);
            if (c.l > 0.95) return;                 // leave near-white alone
            greys.push({ name: name, hex: hx, hsl: c });
        });
        if (!greys.length) return null;

        const darkest = greys.reduce((a, b) => (b.hsl.l < a.hsl.l ? b : a));
        darkest.mono = true;
        return darkest;
    }

    /* Move a colour onto the new hue, keeping its own lightness/saturation offset so
       darks stay dark and pale tints stay pale. Returns null when the colour is NOT in
       the accent family (a grey, or a different hue) -- template 10's slate header and
       teal contact strip land here, so they keep the colours the designer chose. */
    function retintColor(hex, base, target) {
        const c = hexToHsl(hex);

        if (base.mono) {
            // Monochrome template: keep each grey's own lightness, take the new hue.
            // Lighter tones get less saturation so rules stay as subtle as the greys were.
            if (c.l > 0.95) return null;
            const s = target.s * (0.35 + 0.65 * (1 - c.l));
            return hslToHex(target.h, s, c.l);
        }

        if (c.s < 0.06) return null;                            // achromatic
        if (hueDistance(c.h, base.hsl.h) > 32) return null;     // different family
        return hslToHex(target.h,
                        target.s + (c.s - base.hsl.s),
                        target.l + (c.l - base.hsl.l));
    }

    const COLOR_TOKEN = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;

    /* Retint the colours inside a declaration value (gradients keep every stop).
       Alpha is preserved, so soft shadows stay soft. */
    function retintValue(val, base, target) {
        if (!val || val.indexOf("var(") !== -1) return null;    // vars handled separately
        let changed = false;
        const out = val.replace(COLOR_TOKEN, (tok) => {
            let alpha = null;
            if (/^rgba\(/i.test(tok)) {
                const parts = tok.slice(tok.indexOf("(") + 1, -1).split(",").map(x => x.trim());
                if (parts.length === 4) alpha = parts[3];
            }
            const hx = toHex(tok);
            if (!hx) return tok;
            const next = retintColor(hx, base, target);
            if (!next) return tok;
            changed = true;
            if (alpha !== null) {
                const n = parseInt(next.slice(1), 16);
                return "rgba(" + (n >> 16) + ", " + ((n >> 8) & 0xff) + ", " + (n & 0xff) + ", " + alpha + ")";
            }
            return next;
        });
        return changed ? out : null;
    }

    const COLOR_PROPS = [
        "background", "background-color", "background-image", "color",
        "border", "border-color", "border-top", "border-right", "border-bottom", "border-left",
        "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
        "outline-color", "fill", "stroke", "box-shadow", "text-decoration-color"
    ];

    /* The full override: retinted variables + retinted hardcoded declarations. */
    function buildThemedCss(doc, styleNode, base, hex) {
        const cs     = doc.defaultView.getComputedStyle(doc.documentElement);
        const target = hexToHsl(hex);

        const varDecls = [];
        paletteVarNames(doc, styleNode).forEach((name) => {
            if (NEUTRAL_VAR.test(name)) return;
            const hx = toHex(cs.getPropertyValue(name));
            if (!hx) return;
            const next = retintColor(hx, base, target);
            if (next) varDecls.push("    " + name + ": " + next + " !important;");
        });

        /* On a monochrome template only the VARIABLES are recoloured. Its hardcoded greys
           are body copy (template 13 sets contact/body text to #40454f), and tinting
           those would colour the reading text. Its accent roles all go through vars. */
        const ruleDecls = [];
        if (!base.mono) {
            collectStyleRules(doc, styleNode).forEach((rule) => {
                const parts = [];
                COLOR_PROPS.forEach((prop) => {
                    const next = retintValue(rule.style.getPropertyValue(prop), base, target);
                    if (next) parts.push(prop + ": " + next + " !important;");
                });
                if (parts.length) ruleDecls.push(rule.selectorText + " { " + parts.join(" ") + " }");
            });
        }

        return "/* TailorCV Accent Override - retinted from the template's own palette */\n"
             + (varDecls.length ? ":root {\n" + varDecls.join("\n") + "\n}\n" : "")
             + ruleDecls.join("\n") + "\n";
    }

    /* Templates 7+ ship their own palette (--accent, --accent-dark, --sidebar,
       --sidebar-deep, --line, ...). Templates 1-6 use style1.css, which is pure
       black-and-white with no palette at all. So we recolour them differently:
       a themed template gets its OWN variables driven (its design keeps all of its
       hierarchy), while a plain one only gets accent on text and rules. */
    function applyAccentColor(doc, hex) {
        if (!doc || !doc.body || !hex) return;

        let style = doc.getElementById("tailorcv-accent-override");
        if (!style) {
            style = doc.createElement("style");
            style.id = "tailorcv-accent-override";
            doc.head.appendChild(style);
        }

        // Clear first so detection sees the template's real design, not our own paint.
        style.textContent = "";
        doc.querySelectorAll(".tc-accent-band").forEach(el => el.classList.remove("tc-accent-band"));

        // A themed template carries its own palette: retint every colour in its accent's
        // hue family (variables AND hardcoded values), wherever they live. Works for any
        // template without knowing its variable names.
        const base = findBaseAccent(doc, style);
        if (base) {
            style.textContent = buildThemedCss(doc, style, base, hex);
            return;
        }

        // Plain black-and-white template (1-6): no palette at all, so just put the accent
        // on text and rules, and only fill elements that genuinely had a solid band.
        markAccentBands(doc);

        style.textContent = `
/* TailorCV Accent Override */
:root {
    --accent: ${hex} !important;
    --primary: ${hex} !important;
    --brand: ${hex} !important;
    --color-primary: ${hex} !important;
    --cv-accent: ${hex} !important;
    --sidebar-bg: ${hex} !important;
    --header-bg: ${hex} !important;
}

/* Text + rules take the accent (works on plain black-and-white templates). */
h1, h2, h3,
.section-title, .section-heading,
[class*="section-title"], [class*="section-heading"],
.cv-section-title { color: ${hex} !important; }

h2, .section-title, .section-heading,
[class*="section-title"], [class*="section-heading"] { border-color: ${hex} !important; }

hr, .divider, [class*="divider"],
.section-rule, .separator { border-color: ${hex} !important; background: ${hex} !important; }

.timeline-dot, .bullet-dot,
[class*="accent-border"] { background: ${hex} !important; border-color: ${hex} !important; }

/* Only elements that genuinely had a solid band get filled, and their contents
   go white so they stay readable on the accent. */
.tc-accent-band { background-color: ${hex} !important; }
.tc-accent-band, .tc-accent-band * { color: #fff !important; }
.tc-accent-band a { color: #fff !important; }
.tc-accent-band hr, .tc-accent-band .divider, .tc-accent-band .separator {
    border-color: rgba(255,255,255,0.55) !important;
    background: rgba(255,255,255,0.55) !important;
}
`;
    }

    function lightenHex(hex, amount) {
        const num = parseInt(hex.replace("#", ""), 16);
        const r   = Math.min(255, (num >> 16) + amount);
        const g   = Math.min(255, ((num >> 8) & 0xff) + amount);
        const b   = Math.min(255, (num & 0xff) + amount);
        return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CORE: applyWordStylePreview
    ───────────────────────────────────────────────────────────────────────── */
    function applyWordStylePreview() {
        if (!frame || !frame.contentDocument) return;
        const doc  = frame.contentDocument;
        const root = doc.documentElement;
        const body = doc.body;
        if (!root || !body) return;

        let fitStyle = doc.getElementById("tailorcv-preview-fit-style");
        if (fitStyle) fitStyle.textContent = "";

        removePageGuides(doc);

        captureBaseFonts(doc);
        applyFontScale(doc, currentZoom);

        captureBaseLineSpacing(doc);
        applyLineSpacing(doc, currentLineSpacing);
        applyLegacyDesignSettings(doc);

        if (currentAccentColor) {
            applyAccentColor(doc, currentAccentColor);
        }

        const isMobile       = window.innerWidth <= 900;
        /* On mobile, use the full container width so the resume fills edge-to-edge.
           On desktop, subtract 32 px to leave a comfortable gutter. */
        const availableWidth = previewWrap
            ? Math.max(320, previewWrap.clientWidth - (isMobile ? 0 : 32))
            : 760;
        const pageW          = pageWidthPx();
        const pageH          = pageHeightPx();
        const viewScale      = Math.min(1, availableWidth / pageW);

        frame.style.width  = `${pageW}px`;
        frame.style.height = "9999px";

        void root.offsetHeight;

        const primaryEl = body.querySelector(".page, .resume-shell, .resume-container, .page-wrap, .cv-page");
        let contentHeightPx = primaryEl
            ? Math.max(primaryEl.scrollHeight || 0, primaryEl.offsetHeight || 0)
            : 0;
        if (contentHeightPx < 100) {
            contentHeightPx = Math.max(body.scrollHeight || 0, body.offsetHeight || 0, 100);
        }
        
        // Ensure content fills at least one full page
        contentHeightPx = Math.max(contentHeightPx, pageH);

        lastFillRatio  = contentHeightPx / pageH;
        estimatedPages = Math.max(1,
            lastFillRatio > 1.01 ? Math.ceil(lastFillRatio) : 1
        );

        const wordCss = `
/* ── TailorCV Word-Style Preview ── */
html {
  background: #525659 !important;
  margin: 0 !important;
  padding: ${PAGE_GAP_PX}px 0 !important;
  box-sizing: border-box !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: thin !important;
  scrollbar-color: rgba(148,163,184,0.35) transparent !important;
  display: block !important;
  height: auto !important;
}
body {
  width:  ${pageW}px !important;
  min-height: ${pageH}px !important;
  margin: 0 auto !important;
  padding: 0 !important;
  background: #ffffff !important;
  box-shadow: 0 4px 24px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.25) !important;
  box-sizing: border-box !important;
  overflow: visible !important;
  position: relative !important;
  transform: none !important;
  left: auto !important;
  right: auto !important;
  border-radius: 2px !important;
  display: flex !important;
  flex-direction: column !important;
}
`;

        if (!fitStyle) {
            fitStyle = doc.createElement("style");
            fitStyle.id = "tailorcv-preview-fit-style";
            doc.head.appendChild(fitStyle);
        }
        fitStyle.textContent = wordCss;

        renderPageBreaks(doc, estimatedPages);

        // Ensure frame height is at least one full page, with appropriate gaps
        const minFrameHeight = pageH + PAGE_GAP_PX * 2;
        const frameHeight = Math.max(minFrameHeight, contentHeightPx + PAGE_GAP_PX * (estimatedPages + 1));

        frame.style.width           = `${pageW}px`;
        frame.style.height          = `${Math.ceil(frameHeight)}px`;
        frame.style.transform       = `scale(${viewScale})`;
        frame.style.transformOrigin = "top left";
        frame.style.display         = "block";
        frame.style.background      = "transparent";
        frame.style.border          = "none";

        if (previewWrap) {
            const visibleH = Math.ceil(frameHeight * viewScale);
            if (isMobile) {
                /* On mobile the iframe is scaled via transform; its layout dimensions stay
                   at A4 size. Pin the wrapper to the exact visual height so no grey gap
                   appears below the resume. */
                previewWrap.style.height    = `${visibleH}px`;
                previewWrap.style.minHeight = 'unset';
                previewWrap.style.overflow  = 'hidden';
            } else {
                previewWrap.style.height    = '';
                previewWrap.style.minHeight = `${visibleH + 32}px`;
                previewWrap.style.overflow  = '';
            }
            previewWrap.style.background = "#525659";
        }

        updatePageBadge();
        updateFitGuidance();
        scheduleServerEstimate();
    }

    /* ─────────────────────────────────────────────────────────────────────────
       PAGE BREAK DIVIDERS
    ───────────────────────────────────────────────────────────────────────── */
    function removePageGuides(doc) {
        doc.getElementById("tailorcv-page-guides")?.remove();
    }

    function renderPageBreaks(doc, pages) {
        removePageGuides(doc);
        if (pages <= 1) return;
        const pageH = pageHeightPx();

        const host = doc.createElement("div");
        host.id = "tailorcv-page-guides";
        host.setAttribute("aria-hidden", "true");
        Object.assign(host.style, {
            position:      "absolute",
            top:           "0",
            left:          "0",
            width:         "100%",
            height:        `${pageH * pages}px`,
            pointerEvents: "none",
            zIndex:        "2147483646",
            overflow:      "visible",
        });

        for (let i = 1; i < pages; i++) {
            const y = pageH * i;

            const gap = doc.createElement("div");
            Object.assign(gap.style, {
                position:   "absolute",
                left:       "-40px", right: "-40px",
                top:        `${y - 10}px`, height: "20px",
                background: "#525659", zIndex: "2147483645",
            });
            host.appendChild(gap);

            const line = doc.createElement("div");
            Object.assign(line.style, {
                position:  "absolute",
                left:      "0", right: "0",
                top:       `${y}px`, height: "0",
                borderTop: "2px dashed rgba(37,99,235,0.75)",
                boxShadow: "0 0 6px rgba(37,99,235,0.3)",
                zIndex:    "2147483647",
            });
            host.appendChild(line);

            const label = doc.createElement("div");
            label.textContent = `Page ${i + 1} starts here`;
            Object.assign(label.style, {
                position: "absolute", left: "50%",
                top: `${y - 22}px`, transform: "translateX(-50%)",
                padding: "3px 12px", borderRadius: "999px",
                background: "rgba(15,23,42,0.92)",
                border: "1px solid rgba(37,99,235,0.85)",
                color: "#bfdbfe", fontSize: "11px", fontWeight: "700",
                letterSpacing: "0.03em", fontFamily: "Inter, system-ui, sans-serif",
                whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(2,6,23,0.4)",
                zIndex: "2147483647", pointerEvents: "none",
            });
            host.appendChild(label);
        }

        if (!doc.body.style.position || doc.body.style.position === "static") {
            doc.body.style.position = "relative";
        }
        doc.body.appendChild(host);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       FONT SCALE CONTROLS
    ───────────────────────────────────────────────────────────────────────── */
    function changeFontScale(delta) {
        currentZoom = Math.max(0.6, Math.min(1.8, currentZoom + delta));
        applyWordStylePreview();
        updateFontSizeBadge();
        setStatus(`Font size: ${Math.round(currentZoom * 100)}%`);
    }

    function resetFontScale() {
        currentZoom = 1.0;
        applyWordStylePreview();
        updateFontSizeBadge();
        setStatus("Font size reset to 100%.");
    }

    /* ─────────────────────────────────────────────────────────────────────────
       SERVER-SIDE PAGE COUNT ESTIMATE
    ───────────────────────────────────────────────────────────────────────── */
    function scheduleServerEstimate() {
        if (estimateTimer) { clearTimeout(estimateTimer); estimateTimer = null; }
        estimateTimer = setTimeout(() => refreshServerEstimate().catch(() => {}), 120);
    }

    function buildExportHtml() {
        if (typeof window.tcvGetEditorV2Html === "function") {
            const v2Html = cleanExportHtml(window.tcvGetEditorV2Html());
            if (v2Html) return v2Html;
        }
        if (!frame || !frame.contentDocument) {
            const payload = getPayload();
            return cleanExportHtml(payload && payload.html ? payload.html : currentHtml);
        }
        const src   = frame.contentDocument;
        const clone = src.documentElement.cloneNode(true);
        const body  = clone.querySelector("body");
        clone.querySelector("#tailorcv-preview-fit-style")?.remove();
        clone.querySelector("#tailorcv-page-guides")?.remove();
        clone.querySelectorAll("script").forEach(s => s.remove());
        if (body) {
            body.removeAttribute("contenteditable");
            body.removeAttribute("spellcheck");
            ["transform", "transform-origin", "width", "max-width",
             "overflow-x", "overflow-y", "margin"].forEach(p => body.style.removeProperty(p));
        }
        return "<!DOCTYPE html>\n" + clone.outerHTML;
    }

    function cleanExportHtml(html) {
        html = String(html || "").trim();
        if (!html) return "";
        try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            doc.querySelector("#tailorcv-preview-fit-style")?.remove();
            doc.querySelector("#tailorcv-page-guides")?.remove();
            doc.querySelectorAll("script").forEach(s => s.remove());
            if (doc.body) {
                doc.body.removeAttribute("contenteditable");
                doc.body.removeAttribute("spellcheck");
                ["transform", "transform-origin", "width", "max-width",
                 "overflow-x", "overflow-y", "margin"].forEach(p => doc.body.style.removeProperty(p));
            }
            return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
        } catch (e) {
            return html;
        }
    }

    async function readDownloadError(res) {
        try {
            const text = await res.text();
            if (!text) return "Server error";
            try {
                const data = JSON.parse(text);
                return data && data.detail ? String(data.detail) : text;
            } catch (e) {
                return text;
            }
        } catch (e) {
            return "Server error";
        }
    }

    async function refreshServerEstimate() {
        const reqId = ++estimateRequestId;
        const html  = buildExportHtml();
        if (!html) return;
        try {
            const ctrl    = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 2400);
            const res     = await fetch("/api/estimate-html-pages", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    html,
                    pdf_scale: Math.max(0.6, Math.min(1.8, currentZoom))
                }),
                signal: ctrl.signal,
            });
            clearTimeout(timeout);
            if (!res.ok || reqId !== estimateRequestId) return;
            const data  = await res.json();
            const pages = Number(data?.pages);
            if (!Number.isFinite(pages) || pages < 1) return;
            const np = Math.max(1, Math.ceil(pages));
            if (np !== estimatedPages) {
                estimatedPages = np;
                updatePageBadge();
                updateFitGuidance();
                if (frame.contentDocument)
                    renderPageBreaks(frame.contentDocument, estimatedPages);
            }
        } catch { /* network error – keep local estimate */ }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       PRO UPGRADE POPUP (shown when free download quota exhausted)
    ───────────────────────────────────────────────────────────────────────── */
    /* The line under the heading. This used to read "You've downloaded 3
       resumes" no matter what the user had actually done — wrong for anyone who
       had used one, two, or a different free allowance entirely. The real count
       is rendered into the page by the server; fall back to the free limit only
       when it is genuinely unavailable, and never claim a count of zero. */
    function proDownloadSubline() {
        var used = parseInt(window.DOWNLOADS_USED, 10);
        var limit = parseInt(window.FREE_DOWNLOAD_LIMIT, 10);
        if (!isFinite(used) || used < 0) used = isFinite(limit) ? limit : 0;
        if (used < 1) {
            return "You're out of free downloads. Keep tailoring to land your " +
                   "<strong>next job</strong>.";
        }
        return "You've downloaded <strong>" + used + " resume" + (used === 1 ? "" : "s") +
               "</strong>. Keep tailoring to land your <strong>next job</strong>.";
    }

    function showProDownloadPopup(opts) {
        opts = opts || {};
        const targetDoc = opts.doc || document;
        const closable  = opts.closable !== false;

        const existing = targetDoc.getElementById("tcv-pro-dl-overlay");
        if (existing) existing.remove();

        if (!targetDoc.getElementById("tcv-pro-dl-style")) {
            const s = targetDoc.createElement("style");
            s.id = "tcv-pro-dl-style";
            s.textContent = [
                "#tcv-pro-dl-overlay{position:fixed;inset:0;z-index:999999;",
                "background:rgba(2,8,28,.82);backdrop-filter:blur(6px);",
                "display:flex;align-items:center;justify-content:center;padding:20px;",
                "animation:tcvProDlIn .22s ease;}",

                /* Mounted inside the resume iframe: the iframe box can be much taller than",
                   the visible viewport (auto-sized to the full multi-page resume), so",
                   vertical centering can push the card far below the fold. Pin it near",
                   the top of the iframe instead so it's visible immediately. */
                "#tcv-pro-dl-overlay.tcv-pro-dl-top{align-items:flex-start;padding-top:36px;}",

                "#tcv-pro-dl-overlay,#tcv-pro-dl-overlay *{box-sizing:border-box;}",
                "#tcv-pro-dl-modal{position:relative;background:linear-gradient(155deg,#0c1730,#071020);",
                "border:1px solid rgba(56,189,248,.35);border-radius:20px;padding:1.1rem 1.4rem 1.2rem;",
                "max-width:460px;width:100%;text-align:center;",
                "max-height:90vh;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;",
                "box-shadow:0 40px 90px rgba(0,5,20,.8),0 0 0 1px rgba(56,189,248,.12);",
                "animation:tcvProDlUp .3s ease;}",
                "#tcv-pro-dl-modal::-webkit-scrollbar{width:8px;}",
                "#tcv-pro-dl-modal::-webkit-scrollbar-thumb{background:rgba(148,163,184,.25);border-radius:8px;}",

                "#tcv-pro-dl-close{position:absolute;top:8px;right:8px;background:rgba(255,255,255,.06);",
                "border:none;color:#94a3b8;font-size:15px;cursor:pointer;line-height:1;",
                "width:22px;height:22px;border-radius:50%;z-index:2;}",
                "#tcv-pro-dl-close:hover{color:#f1f8ff;background:rgba(255,255,255,.12);}",

                /* Hero */
                ".tcv-pro-dl-lock-wrap{width:38px;height:38px;margin:0 auto .4rem;border-radius:50%;",
                "display:flex;align-items:center;justify-content:center;",
                "background:radial-gradient(circle,rgba(56,189,248,.18),transparent 70%);",
                "border:1px solid rgba(56,189,248,.35);}",
                ".tcv-pro-dl-lock{font-size:1.1rem;line-height:1;}",
                ".tcv-pro-dl-title{font-size:1.05rem;font-weight:800;color:#f1f8ff;margin:0 0 .3rem;}",
                ".tcv-pro-dl-sub{font-size:.76rem;color:#94a3b8;line-height:1.4;margin:0 0 .65rem;}",
                ".tcv-pro-dl-sub strong{color:#7dd3fc;font-weight:700;}",

                /* Stats row */
                ".tcv-pro-dl-stats{display:flex;gap:.5rem;align-items:flex-start;justify-content:space-between;",
                "background:rgba(255,255,255,.03);border:1px solid rgba(148,163,184,.14);",
                "border-radius:12px;padding:.6rem .55rem;margin:0 0 .8rem;text-align:left;}",
                ".tcv-pro-dl-stat{flex:1;min-width:0;}",
                ".tcv-pro-dl-stat b{display:block;font-size:.85rem;font-weight:800;color:#f1f8ff;}",
                ".tcv-pro-dl-stat span{display:block;font-size:.62rem;color:#8291ab;line-height:1.25;margin-top:1px;}",
                ".tcv-pro-dl-stat .tcv-stars{color:#fbbf24;font-size:.68rem;letter-spacing:1px;}",
                ".tcv-pro-dl-logos{font-size:.62rem;font-weight:700;color:#cbd5e1;margin-top:1px;}",
                ".tcv-pro-dl-avatars{display:flex;margin-bottom:3px;}",
                ".tcv-pro-dl-avatars img{width:20px;height:20px;border-radius:50%;object-fit:cover;",
                "border:1.5px solid #0c1730;margin-left:-6px;display:block;}",
                ".tcv-pro-dl-avatars img:first-child{margin-left:0;}",

                /* Testimonial */
                ".tcv-pro-dl-testi{background:rgba(255,255,255,.03);border:1px solid rgba(148,163,184,.14);",
                "border-radius:12px;padding:.6rem .75rem;margin:0 0 .7rem;text-align:left;position:relative;}",
                ".tcv-pro-dl-testi-mark{position:absolute;top:.3rem;left:.55rem;font-size:1.3rem;",
                "color:rgba(125,211,252,.35);font-weight:800;line-height:1;font-family:Georgia,serif;}",
                ".tcv-pro-dl-testi p{margin:0 0 .4rem;padding-left:1.05rem;font-size:.72rem;color:#dbe7ff;line-height:1.4;}",
                ".tcv-pro-dl-testi p strong{color:#7dd3fc;}",
                ".tcv-pro-dl-testi-foot{display:flex;align-items:center;justify-content:space-between;",
                "padding-left:1.05rem;}",
                ".tcv-pro-dl-testi-foot strong{font-size:.7rem;color:#f1f8ff;}",
                ".tcv-pro-dl-verified{display:inline-block;font-size:.54rem;font-weight:700;color:#a5b4fc;",
                "background:rgba(129,140,248,.15);border-radius:999px;padding:1px 6px;margin-left:4px;",
                "vertical-align:middle;}",
                ".tcv-pro-dl-testi-role{display:block;font-size:.6rem;color:#8291ab;margin-top:1px;}",
                ".tcv-pro-dl-testi-foot .tcv-stars{color:#fbbf24;font-size:.7rem;letter-spacing:1px;",
                "white-space:nowrap;}",

                /* Trust line */
                ".tcv-pro-dl-trustline{display:flex;align-items:center;gap:.4rem;font-size:.7rem;",
                "color:#9fb0c9;background:rgba(255,255,255,.02);border:1px solid rgba(148,163,184,.12);",
                "border-radius:10px;padding:.45rem .6rem;margin:0 0 .7rem;text-align:left;line-height:1.35;}",
                ".tcv-pro-dl-trustline .tcv-shield{flex:none;font-size:.85rem;}",
                ".tcv-pro-dl-trustline strong{color:#7dd3fc;}",

                /* CTA */
                ".tcv-pro-dl-cta-wrap{position:relative;margin:0 0 .6rem;}",
                ".tcv-pro-dl-ribbon{position:absolute;top:-8px;left:12px;z-index:2;",
                "background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:.58rem;",
                "font-weight:800;padding:3px 8px;border-radius:999px;",
                "box-shadow:0 4px 14px rgba(22,163,74,.5);transform:rotate(-3deg);}",
                ".tcv-pro-dl-cta{display:flex;flex-direction:column;align-items:center;justify-content:center;",
                "gap:1px;width:100%;padding:.65rem .9rem .6rem;border-radius:11px;",
                "background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;",
                "text-decoration:none;cursor:pointer;border:none;",
                "box-shadow:0 10px 30px rgba(37,99,235,.5);",
                "transition:opacity .2s,transform .2s;}",
                ".tcv-pro-dl-cta:hover{opacity:.92;transform:translateY(-2px);}",
                ".tcv-pro-dl-cta-main{font-size:.86rem;font-weight:800;}",
                ".tcv-pro-dl-cta-sub{font-size:.66rem;font-weight:600;color:rgba(255,255,255,.85);}",

                /* Bottom badges + note */
                ".tcv-pro-dl-badges{display:flex;justify-content:center;gap:.7rem;flex-wrap:wrap;",
                "font-size:.62rem;color:#8291ab;margin:0 0 .5rem;}",
                ".tcv-pro-dl-badges span{display:inline-flex;align-items:center;gap:3px;}",
                ".tcv-pro-dl-note{display:flex;gap:.35rem;align-items:flex-start;justify-content:center;",
                "font-size:.62rem;color:#64748b;line-height:1.35;margin:0;text-align:left;}",

                "@keyframes tcvProDlIn{from{opacity:0}to{opacity:1}}",
                "@keyframes tcvProDlUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}",

                "@media(max-width:420px){#tcv-pro-dl-modal{padding:1.1rem .9rem 1rem;border-radius:18px;}",
                ".tcv-pro-dl-stats{flex-wrap:wrap;}",
                ".tcv-pro-dl-title{font-size:1.05rem;}}",

                /* Desktop: scale the whole card up */
                "@media(min-width:640px){",
                "#tcv-pro-dl-modal{max-width:560px;padding:1.6rem 2rem 1.7rem;border-radius:24px;}",
                "#tcv-pro-dl-close{width:26px;height:26px;font-size:17px;top:12px;right:12px;}",
                ".tcv-pro-dl-lock-wrap{width:50px;height:50px;margin:0 auto .6rem;}",
                ".tcv-pro-dl-lock{font-size:1.4rem;}",
                ".tcv-pro-dl-title{font-size:1.35rem;margin:0 0 .45rem;}",
                ".tcv-pro-dl-sub{font-size:.92rem;line-height:1.5;margin:0 0 .9rem;}",
                ".tcv-pro-dl-stats{padding:.85rem .8rem;margin:0 0 1.05rem;}",
                ".tcv-pro-dl-stat b{font-size:1.05rem;}",
                ".tcv-pro-dl-stat span{font-size:.75rem;}",
                ".tcv-pro-dl-stat .tcv-stars{font-size:.8rem;}",
                ".tcv-pro-dl-logos{font-size:.75rem;}",
                ".tcv-pro-dl-avatars img{width:25px;height:25px;margin-left:-7px;}",
                ".tcv-pro-dl-trustline{font-size:.85rem;padding:.65rem .85rem;margin:0 0 .95rem;}",
                ".tcv-pro-dl-trustline .tcv-shield{font-size:1.05rem;}",
                ".tcv-pro-dl-testi{padding:.85rem 1.05rem;margin:0 0 .95rem;}",
                ".tcv-pro-dl-testi-mark{font-size:1.7rem;}",
                ".tcv-pro-dl-testi p{font-size:.9rem;margin:0 0 .55rem;}",
                ".tcv-pro-dl-testi-foot strong{font-size:.85rem;}",
                ".tcv-pro-dl-verified{font-size:.64rem;}",
                ".tcv-pro-dl-testi-role{font-size:.73rem;}",
                ".tcv-pro-dl-testi-foot .tcv-stars{font-size:.85rem;}",
                ".tcv-pro-dl-cta-wrap{margin:0 0 .85rem;}",
                ".tcv-pro-dl-ribbon{font-size:.68rem;padding:4px 10px;top:-10px;}",
                ".tcv-pro-dl-cta{padding:.9rem 1.1rem .85rem;border-radius:14px;}",
                ".tcv-pro-dl-cta-main{font-size:1.08rem;}",
                ".tcv-pro-dl-cta-sub{font-size:.8rem;}",
                ".tcv-pro-dl-badges{font-size:.75rem;gap:.9rem;margin:0 0 .65rem;}",
                "}",
            ].join("");
            targetDoc.head.appendChild(s);
        }

        const priceOnly = typeof _getUpgradePriceOnly === 'function'
            ? _getUpgradePriceOnly(_upgradeRegionCache) : '₹167/month';

        const overlay = targetDoc.createElement("div");
        overlay.id = "tcv-pro-dl-overlay";
        if (!closable) overlay.className = "tcv-pro-dl-top";
        overlay.innerHTML =
            '<div id="tcv-pro-dl-modal">' +
                (closable ? '<button id="tcv-pro-dl-close" aria-label="Close">&times;</button>' : '') +

                '<div class="tcv-pro-dl-lock-wrap"><div class="tcv-pro-dl-lock">🔒</div></div>' +
                '<h2 class="tcv-pro-dl-title">Your resume is ready!</h2>' +
                '<p class="tcv-pro-dl-sub">' + proDownloadSubline() + '</p>' +

                '<div class="tcv-pro-dl-stats">' +
                    '<div class="tcv-pro-dl-stat"><b>10,000+</b><span>resumes optimized by job seekers</span></div>' +
                    '<div class="tcv-pro-dl-stat"><b>4.8/5</b><span class="tcv-stars">★★★★★</span><span>Rated by 500+ users</span></div>' +
                    '<div class="tcv-pro-dl-stat"><div class="tcv-pro-dl-avatars">' +
                        '<img src="/static/pricing_user_images/2.jpg" alt="">' +
                        '<img src="/static/pricing_user_images/45.jpg" alt="">' +
                        '<img src="/static/pricing_user_images/56.jpg" alt="">' +
                    '</div><span>Loved by job seekers at top companies</span>' +
                        '<div class="tcv-pro-dl-logos">Google · Turing · Deloitte</div></div>' +
                '</div>' +

                '<div class="tcv-pro-dl-trustline"><span class="tcv-shield">✨</span>' +
                    '<span>Go Pro for <strong>unlimited access</strong> to resume optimizations, cover letters, mock interviews, portfolio site and more.</span></div>' +

                '<div class="tcv-pro-dl-testi">' +
                    '<span class="tcv-pro-dl-testi-mark">&ldquo;</span>' +
                    '<p>TailorCV helped me optimize my resume and land <strong>3 interview calls</strong> in just 2 weeks!</p>' +
                    '<div class="tcv-pro-dl-testi-foot">' +
                        '<div><strong>Sarah W.</strong><span class="tcv-pro-dl-verified">Verified User</span>' +
                            '<span class="tcv-pro-dl-testi-role">Marketing Coordinator</span></div>' +
                        '<div class="tcv-stars">★★★★★</div>' +
                    '</div>' +
                '</div>' +

                '<div class="tcv-pro-dl-cta-wrap">' +
                    '<span class="tcv-pro-dl-ribbon">Most Affordable</span>' +
                    '<a href="/pricing" target="_top" class="tcv-pro-dl-cta" id="tcv-pro-dl-cta">' +
                        '<span class="tcv-pro-dl-cta-main">Unlock Unlimited Access</span>' +
                        '<span class="tcv-pro-dl-cta-sub" id="tcv-pro-dl-cta-price">' + priceOnly + ' · Cancel anytime</span>' +
                    '</a>' +
                '</div>' +

                '<div class="tcv-pro-dl-badges">' +
                    '<span>⚡ Instant access</span><span>🛡️ Secure payment</span><span>↺ Cancel anytime</span>' +
                '</div>' +
            '</div>';

        // Mounting on documentElement (rather than <body>) keeps the overlay safe from
        // a contentEditable resume body's own edit/delete behaviour when doc is an iframe.
        targetDoc.documentElement.appendChild(overlay);

        // Update the price once the region fetch resolves (if not already cached).
        if (typeof _upgradeRegionFetch !== 'undefined' && !_upgradeRegionCache && _upgradeRegionFetch) {
            _upgradeRegionFetch.then(function(region) {
                var priceEl = targetDoc.getElementById('tcv-pro-dl-cta-price');
                if (priceEl && region && typeof _getUpgradePriceOnly === 'function') {
                    priceEl.textContent = _getUpgradePriceOnly(region) + ' · Cancel anytime';
                }
            });
        }

        if (closable) {
            function closePopup() { overlay.remove(); }
            overlay.querySelector("#tcv-pro-dl-close").addEventListener("click", closePopup);
            overlay.addEventListener("click", function (e) { if (e.target === overlay) closePopup(); });
        } else {
            // Non-closable (paywall) mode: guard against removal via editing/devtools.
            new MutationObserver(function () {
                if (!targetDoc.documentElement.contains(overlay)) {
                    targetDoc.documentElement.appendChild(overlay);
                }
            }).observe(targetDoc.documentElement, { childList: true });
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       PDF DOWNLOAD
    ───────────────────────────────────────────────────────────────────────── */
    async function downloadEditedPdf(isAuto = false) {
        const html = buildExportHtml();
        if (!html) { setStatus("Could not read resume content."); return; }

        // ── Atomic gate: check quota AND consume the slot before downloading ──
        // A single POST ensures the counter is committed before we proceed.
        // A separate fire-and-forget record call could fail silently, leaving
        // the counter at 0 forever and allowing unlimited free downloads.
        if (!isAuto) {
            let gateOk = false;
            try {
                const gateRes = await fetch("/api/billing/checkout-download", { method: "POST" });
                if (gateRes.status === 401) {
                    window.location.href = "/login?next=" + encodeURIComponent(location.pathname);
                    return;
                }
                if (gateRes.status === 402) {
                    showProDownloadPopup();
                    return;
                }
                if (gateRes.ok) {
                    gateOk = true;
                }
            } catch (e) {
                // Network error — fail closed: show popup rather than allow
                showProDownloadPopup();
                return;
            }
            if (!gateOk) {
                showProDownloadPopup();
                return;
            }
        }

        setStatus(isAuto ? "Auto-downloading optimised resume…" : "Generating PDF…");
        if (downloadBtn) downloadBtn.disabled = true;
        try {
            const res = await fetch("/api/download-html-pdf", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    html,
                    pdf_scale: Math.max(0.6, Math.min(1.8, currentZoom))
                }),
            });
            if (!res.ok) throw new Error(await readDownloadError(res));
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            const payload = getPayload() || {};
            a.href = url;
            a.download = payload.filename || "optimized_resume_edited.pdf";
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
            setStatus("PDF downloaded successfully.");
            if (!isAuto) {
                // Resume is NOT auto-saved to My Resumes anymore — the user must
                // explicitly click "Save to My Resumes". After a download we just
                // nudge them to save it.
                if (saveBtn && !saveBtn.dataset.saved) {
                    setStatus("Downloaded. Click “Save to My Resumes” to keep it.");
                }
                setTimeout(showPersonalityCornerPopup, 1500);
            }
        } catch (err) {
            console.error("[TailorCV] PDF download failed:", err);
            setStatus((err && err.message) ? err.message : "Could not download PDF. Please try again.");
        } finally {
            if (downloadBtn) downloadBtn.disabled = false;
        }
    }

    async function saveEditedResumeSilently(html) {
        if (!html) return false;

        let jd = "";
        try { jd = (localStorage.getItem("tailorcv_jobDescription") || "").trim(); } catch (e) {}

        let savedId = null;
        try { savedId = sessionStorage.getItem("tailorcv_current_resume_id"); } catch (e) {}

        const payload = getPayload() || null;
        try {
            const res = await fetch("/api/save-edited-resume", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    html,
                    template_id: templateId,
                    jd,
                    resume_id: savedId,
                    resume_data: payload && payload.resume_data ? payload.resume_data : null,
                    candidate_name: payload && payload.candidate_name ? payload.candidate_name : null
                }),
            });
            if (!res.ok) throw new Error("Save failed");
            try {
                const data = await res.json();
                if (data && data.id) {
                    sessionStorage.setItem("tailorcv_current_resume_id", String(data.id));
                }
            } catch (e) {}
            return true;
        } catch (e) {
            if (typeof showToast === "function") {
                showToast("PDF downloaded, but saving to My Resumes failed this time.", "error", "Save failed");
            }
            return false;
        }
    }

    /* Explicit "Save to My Resumes" — only runs when the user clicks the button,
       so nothing is stored unless they choose to save. */
    async function saveToMyResumes() {
        if (!frame || !frame.contentDocument) { setStatus("Preview not ready."); return; }
        const html = buildExportHtml();
        if (!html) { setStatus("Could not read resume content."); return; }

        let jd = "";
        try { jd = (localStorage.getItem("tailorcv_jobDescription") || "").trim(); } catch (e) {}
        let savedId = null;
        try { savedId = sessionStorage.getItem("tailorcv_current_resume_id"); } catch (e) {}
        const payload = getPayload() || null;

        const orig = saveBtn ? saveBtn.innerHTML : "";
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = "Saving…"; }
        setStatus("Saving to My Resumes…");
        try {
            const res = await fetch("/api/save-edited-resume", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    html,
                    template_id: templateId,
                    jd,
                    resume_id: savedId,
                    resume_data: payload && payload.resume_data ? payload.resume_data : null,
                    candidate_name: payload && payload.candidate_name ? payload.candidate_name : null
                }),
            });
            if (res.status === 401) {
                window.location.href = "/login?next=" + encodeURIComponent(location.pathname);
                return;
            }
            if (!res.ok) throw new Error("Save failed");
            try {
                const data = await res.json();
                if (data && data.id) sessionStorage.setItem("tailorcv_current_resume_id", String(data.id));
            } catch (e) {}
            if (saveBtn) {
                saveBtn.dataset.saved = "1";
                saveBtn.innerHTML = "✓ Saved to My Resumes";
                saveBtn.disabled = false;
            }
            const hint = document.getElementById("save-resume-hint");
            if (hint) hint.innerHTML = 'Saved — <a href="/my-resumes" style="color:#8b5cf6;text-decoration:underline;">View My Resumes →</a>';
            setStatus("Saved to My Resumes.");
            if (typeof showToast === "function") showToast("Resume saved to My Resumes.", "success", "Saved");
        } catch (e) {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = orig; }
            setStatus("Could not save. Please try again.");
            if (typeof showToast === "function") showToast("Could not save to My Resumes. Please try again.", "error", "Save failed");
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       HOST PAGE STYLES
    ───────────────────────────────────────────────────────────────────────── */
    function injectHostPageStyles() {
        if (document.getElementById("tailorcv-host-override")) return;
        const s = document.createElement("style");
        s.id = "tailorcv-host-override";
        s.textContent = `
.editor-preview-wrap {
  background: #525659 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  padding: 0 !important;
  border-radius: 10px !important;
  border: none !important;
  display: block !important;
}
#resume-preview-frame {
  display: block !important;
  border: 0 !important;
  background: transparent !important;
}
`;
        document.head.appendChild(s);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       TEMPLATE SWITCHER PANEL
    ───────────────────────────────────────────────────────────────────────── */
    const TEMPLATES = [
        { id: 1,  name: "Modern Professional",      image: "pic1.webp"  },
        { id: 2,  name: "Executive Minimal",         image: "pic2.webp"  },
        { id: 3,  name: "Creative Tech",             image: "pic3.webp"  },
        { id: 4,  name: "Classic Academic",          image: "pic4.webp"  },
        { id: 5,  name: "Modern Elegant",            image: "pic5.webp"  },
        { id: 6,  name: "Professional Classic",      image: "pic6.webp"  },
        { id: 7,  name: "Navy Sidebar",              image: "pic7.webp"  },
        { id: 8,  name: "Teal Sidebar",              image: "pic8.webp"  },
        { id: 9,  name: "Burgundy Sidebar",          image: "pic9.webp"  },
        { id: 10, name: "Slate Sidebar",             image: "pic10.webp" },
        { id: 11, name: "Forest Sidebar",            image: "pic11.webp" },
        { id: 12, name: "Skyline Blue",              image: "pic12.webp" },
        { id: 13, name: "Gray Executive Panel",      image: "pic13.webp" },
        { id: 14, name: "Olive Timeline Pro",        image: "pic14.webp" },
        { id: 15, name: "Aqua Timeline Modern",      image: "pic15.webp" },
        { id: 16, name: "Navy Rail Editorial",       image: "pic16.webp" },
        { id: 17, name: "Executive Gray Board",      image: "pic17.webp" },
        { id: 18, name: "Classic Gray Professional", image: "pic18.webp" },
        { id: 19, name: "LaTeX Academic",            image: "pic19.webp" },
        { id: 20, name: "ATS Friendly",              image: "pic20.webp" },
        { id: 21, name: "Modern Tech",               image: "pic21.webp" },
        { id: 22, name: "Academic Serif",            image: "pic22.webp" },
    ];

    function buildTemplateSwitcher() {
        if (!document.getElementById("tc-switcher-styles")) {
            const st = document.createElement("style");
            st.id = "tc-switcher-styles";
            st.textContent = `
#tc-switcher-overlay {
    position: fixed; inset: 0; z-index: 99998;
    display: flex; align-items: center; justify-content: center;
}
.tc-sw-backdrop {
    position: absolute; inset: 0;
    background: rgba(2,8,24,0.78);
    backdrop-filter: blur(7px);
    animation: tc-bgin 0.3s ease both;
}
@keyframes tc-bgin { from { opacity:0; } to { opacity:1; } }
.tc-sw-modal {
    position: relative; z-index: 2;
    background: linear-gradient(160deg, #0d1f3c, #0a1628);
    border: 1px solid rgba(59,130,246,0.35);
    border-radius: 20px;
    padding: 1.6rem 1.5rem 1.5rem;
    width: min(820px, 95vw);
    max-height: 88vh;
    overflow-y: auto;
    box-shadow: 0 30px 80px rgba(0,0,0,0.55);
    animation: tc-modal-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
}
@keyframes tc-modal-in {
    from { opacity:0; transform:scale(0.85) translateY(20px); }
    to   { opacity:1; transform:scale(1) translateY(0); }
}
.tc-sw-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1.1rem;
}
.tc-sw-header h2 {
    margin: 0; color: #e2e8f0; font-size: 1.3rem; font-weight: 700;
}
.tc-sw-close {
    background: none; border: 1px solid rgba(148,163,184,0.3);
    border-radius: 8px; color: #94a3b8; padding: 0.35rem 0.65rem;
    cursor: pointer; font-size: 1.1rem; line-height: 1;
    transition: all 0.2s;
}
.tc-sw-close:hover { border-color: #f87171; color: #f87171; }
.tc-sw-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
}
.tc-sw-card {
    border: 2px solid rgba(30,100,220,0.28);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
    background: rgba(4,20,48,0.6);
}
.tc-sw-card:hover { border-color: #60a5fa; transform: translateY(-2px); }
.tc-sw-card.active { border-color: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,0.3); }
.tc-sw-card img {
    width: 100%; aspect-ratio: 0.707;
    object-fit: contain; object-position: top center;
    display: block; background: rgba(255,255,255,0.06);
}
@media (max-width: 640px) {
    .tc-sw-modal { padding: 1rem 0.65rem; width: min(820px, 100vw); }
    .tc-sw-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
}
.tc-sw-card-name {
    padding: 0.4rem 0.5rem;
    font-size: 0.78rem; color: #93c5fd; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tc-sw-loading {
    display: flex; align-items: center; justify-content: center;
    gap: 0.6rem; padding: 1.2rem; color: #93c5fd; font-size: 0.95rem;
}
.tc-sw-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(59,130,246,0.25);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: tc-spin 0.7s linear infinite;
}
@keyframes tc-spin { to { transform: rotate(360deg); } }
`;
            document.head.appendChild(st);
        }

        const overlay = document.createElement("div");
        overlay.id = "tc-switcher-overlay";
        overlay.innerHTML = `
            <div class="tc-sw-backdrop" id="tc-sw-backdrop"></div>
            <div class="tc-sw-modal">
                <div class="tc-sw-header">
                    <h2>Switch Template</h2>
                    <button class="tc-sw-close" id="tc-sw-close" type="button">✕</button>
                </div>
                <div class="tc-sw-grid" id="tc-sw-grid">
                    ${TEMPLATES.map(t => `
                        <div class="tc-sw-card ${t.id === templateId ? "active" : ""}"
                             data-tid="${t.id}" title="${t.name}">
                            <img src="/static/${t.image}?v=9" alt="${t.name}" loading="lazy">
                            <div class="tc-sw-card-name">${t.name}</div>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => {
            overlay.style.opacity = "0";
            overlay.style.transition = "opacity 0.2s";
            setTimeout(() => overlay.remove(), 220);
        };

        document.getElementById("tc-sw-close").addEventListener("click", close);
        document.getElementById("tc-sw-backdrop").addEventListener("click", close);

        document.getElementById("tc-sw-grid").addEventListener("click", async (e) => {
            const card = e.target.closest(".tc-sw-card");
            if (!card) return;
            const tid = Number(card.dataset.tid);
            if (tid === templateId) { close(); return; }
            await switchTemplate(tid, close);
        });
    }

    async function switchTemplate(newTemplateId, closeModal) {
        const payload = getPayload();
        if (!payload) { setStatus("Cannot switch template — no resume payload found."); return; }

        const grid = document.getElementById("tc-sw-grid");
        if (grid) {
            grid.innerHTML = `
                <div class="tc-sw-loading" style="grid-column:1/-1">
                    <div class="tc-sw-spinner"></div>
                    Switching template…
                </div>
            `;
        }
        setStatus("Switching template…");

        try {
            const res = await fetch("/api/rerender-template", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    current_html: buildExportHtml(),
                    template_id:  newTemplateId,
                }),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                throw new Error(errText || `Server returned ${res.status}`);
            }

            const data = await res.json();
            if (!data || !data.html) {
                throw new Error("Empty response from rerender-template");
            }

            const updated = { ...payload, html: data.html, template_id: newTemplateId };
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

            templateId               = newTemplateId;
            baseFontsCaptured        = false;
            baseLineSpacingsCaptured = false;
            currentZoom              = 1.0;
            currentLineSpacing       = 1;
            currentAccentColor       = null;

            updateFontSizeBadge();

            const spacingBadge = document.getElementById("spacing-badge");
            if (spacingBadge) spacingBadge.textContent = "100%";

            currentHtml  = addEditingOverlay(data.html);
            frame.srcdoc = currentHtml;

            frame.addEventListener("load", function onSwitchLoad() {
                frame.removeEventListener("load", onSwitchLoad);
                applyWordStylePreview();
                captureBaseLineSpacing(frame.contentDocument);
                buildAccentPanel();
                applyFreeUserProtection(frame.contentDocument);
                updateFontSizeBadge();
                updatePageBadge();
                setStatus("Template switched! Your content is preserved — adjust font if needed.");
            });

            if (closeModal) closeModal();

        } catch (err) {
            console.error("rerender-template failed:", err);

            if (grid) {
                grid.innerHTML = `
                    <div style="grid-column:1/-1; padding:1.5rem; text-align:center; color:#fca5a5; font-size:0.9rem;">
                        <div style="font-size:1.5rem; margin-bottom:0.5rem;">⚠️</div>
                        <strong>Template switch failed</strong><br>
                        <span style="color:#94a3b8; font-size:0.82rem; margin-top:0.3rem; display:block;">
                            Make sure <code>rerender_template.py</code> is deployed and
                            <code>/api/rerender-template</code> is registered in your server.
                        </span>
                        <button onclick="document.getElementById('tc-switcher-overlay').remove()"
                                style="margin-top:1rem; padding:0.45rem 1rem; border-radius:8px;
                                       background:rgba(37,99,235,0.2); border:1px solid #3b82f6;
                                       color:#93c5fd; cursor:pointer; font-size:0.85rem;">
                            Close
                        </button>
                    </div>
                `;
            }
            setStatus("Template switch failed — see console for details.");
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       ACCENT COLOR PANEL
    ───────────────────────────────────────────────────────────────────────── */
    const PRESET_COLORS = [
        { label: "Ocean Blue",    hex: "#2563eb" },
        { label: "Midnight Navy", hex: "#1e3a5f" },
        { label: "Forest Green",  hex: "#166534" },
        { label: "Teal",          hex: "#0d9488" },
        { label: "Burgundy",      hex: "#7f1d1d" },
        { label: "Slate",         hex: "#334155" },
        { label: "Violet",        hex: "#6d28d9" },
        { label: "Copper",        hex: "#92400e" },
        { label: "Charcoal",      hex: "#1c1c1e" },
        { label: "Rose",          hex: "#be123c" },
    ];

    function buildAccentPanel() {
        const container = document.getElementById("tc-accent-panel-container");
        if (!container) return;

        const detectedAccent = frame && frame.contentDocument
            ? detectTemplateAccent(frame.contentDocument)
            : "#2563eb";

        if (!document.getElementById("tc-accent-styles")) {
            const st = document.createElement("style");
            st.id = "tc-accent-styles";
            st.textContent = `
.tc-accent-wrap {
    display: flex; flex-direction: column; gap: 0.6rem;
}
.tc-accent-presets {
    display: flex; flex-wrap: wrap; gap: 0.45rem;
}
.tc-accent-swatch {
    width: 28px; height: 28px; border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer; transition: all 0.18s;
    position: relative;
}
.tc-accent-swatch:hover { transform: scale(1.18); }
.tc-accent-swatch.active {
    border-color: #fff;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.5);
}
.tc-accent-custom-row {
    display: flex; align-items: center; gap: 0.6rem;
}
.tc-accent-custom-label {
    font-size: 0.82rem; color: #94a3b8;
}
.tc-accent-custom-input {
    width: 38px; height: 28px; border-radius: 6px;
    border: 1px solid rgba(148,163,184,0.3);
    cursor: pointer; padding: 0; background: none;
}
.tc-accent-reset {
    font-size: 0.78rem; color: #60a5fa; cursor: pointer;
    background: none; border: none; padding: 0; text-decoration: underline;
}
`;
            document.head.appendChild(st);
        }

        container.innerHTML = `
            <div class="tc-accent-wrap">
                <div class="tc-accent-presets" id="tc-accent-presets">
                    ${PRESET_COLORS.map(c => `
                        <div class="tc-accent-swatch ${(currentAccentColor || detectedAccent) === c.hex ? "active" : ""}"
                             style="background:${c.hex}"
                             data-hex="${c.hex}" title="${c.label}"></div>
                    `).join("")}
                </div>
                <div class="tc-accent-custom-row">
                    <span class="tc-accent-custom-label">Custom:</span>
                    <input type="color" class="tc-accent-custom-input" id="tc-accent-custom"
                           value="${currentAccentColor || detectedAccent}">
                    <button class="tc-accent-reset" id="tc-accent-reset" type="button">Reset</button>
                </div>
            </div>
        `;

        container.querySelector("#tc-accent-presets").addEventListener("click", (e) => {
            const sw = e.target.closest(".tc-accent-swatch");
            if (!sw) return;
            setAccentColor(sw.dataset.hex);
            container.querySelectorAll(".tc-accent-swatch").forEach(s => s.classList.remove("active"));
            sw.classList.add("active");
        });

        container.querySelector("#tc-accent-custom").addEventListener("input", (e) => {
            setAccentColor(e.target.value);
            container.querySelectorAll(".tc-accent-swatch").forEach(s => s.classList.remove("active"));
        });

        container.querySelector("#tc-accent-reset").addEventListener("click", () => {
            currentAccentColor = null;
            const accentStyle = frame && frame.contentDocument
                ? frame.contentDocument.getElementById("tailorcv-accent-override")
                : null;
            if (accentStyle) accentStyle.textContent = "";
            container.querySelectorAll(".tc-accent-swatch").forEach(s => s.classList.remove("active"));
            setStatus("Accent color reset to template default.");
        });
    }

    function setAccentColor(hex) {
        currentAccentColor = hex;
        if (frame && frame.contentDocument) {
            applyAccentColor(frame.contentDocument, hex);
        }
        setStatus(`Accent color: ${hex}`);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       FREE-USER COPY PROTECTION
    ───────────────────────────────────────────────────────────────────────── */
    function applyFreeUserProtection(doc) {
        if (window.IS_PRO === true) return;
        if (!doc || !doc.body) return;

        if (doc._tailorcvCopyProtected) return;
        doc._tailorcvCopyProtected = true;

        const SUFFIX =
            "— Created with TailorCV (www.thetailorcv.com)\n" +
            "Download the properly formatted PDF at www.thetailorcv.com/pricing";
        const SMALL_COPY_CHARS  = 60;   // still allow e.g. copying a phone number/email
        const SESSION_COPY_CAP  = 250;  // total chars a free user may extract before being cut off

        let copiedSoFar = 0;

        function warn() {
            if (typeof showToast === "function") {
                showToast("Download the PDF for proper formatting.", "warn",
                          "Upgrade to download");
            }
        }

        function guard(e) {
            const text = (doc.getSelection() || {}).toString() || "";
            if (!text) return;

            if (text.length <= SMALL_COPY_CHARS && copiedSoFar < SESSION_COPY_CAP) {
                copiedSoFar += text.length;
                return;
            }

            e.preventDefault();
            try { e.clipboardData.setData("text/plain", SUFFIX); } catch (_) {}
            copiedSoFar += text.length;
            warn();
        }

        doc.addEventListener("copy", guard, true);
        doc.addEventListener("cut", guard, true);

        doc.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            warn();
        }, true);

        doc.addEventListener("dragstart", function (e) {
            e.preventDefault();
        }, true);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       QUOTA-EXHAUSTED PAYWALL LOCK — shown once a free user's lifetime
       optimizations are used up. Reuses showProDownloadPopup() (the same modal
       shown after free downloads run out), mounted on the resume iframe itself
       (not the close-able page-wide overlay) so it blurs the resume behind it
       and can't be dismissed.
    ───────────────────────────────────────────────────────────────────────── */
    function applyQuotaExhaustedLock(doc) {
        if (window.IS_PRO === true) return;
        if (window.QUOTA_EXHAUSTED !== true) return;
        if (!doc || !doc.documentElement) return;

        if (doc._tailorcvQuotaLocked) return;
        doc._tailorcvQuotaLocked = true;

        showProDownloadPopup({ doc: doc, closable: false });

        // window.IS_PRO is stamped into the HTML when the page is rendered and
        // never changes again. But the user upgrades FROM this very popup, so by
        // the time the payment clears, the flag on this page is stale — and the
        // lock is deliberately not closable. A user who has just paid is left
        // staring at an "upgrade to Pro" wall over their own resume, with Pro
        // active in the database. Ask the server what it thinks now.
        refreshProStatus();
    }

    /* Re-check Pro against the server and lift the lock if the user has upgraded.
       Runs after the lock mounts and whenever the tab regains focus, which is
       exactly when someone returns from completing a payment. */
    var _proRefreshInFlight = false;
    async function refreshProStatus() {
        if (window.IS_PRO === true || _proRefreshInFlight) return;
        _proRefreshInFlight = true;
        try {
            const res = await fetch("/api/auth/me", { cache: "no-store" });
            if (!res.ok) return;
            const data = await res.json();
            if (!data || data.is_pro !== true) return;

            window.IS_PRO = true;
            window.QUOTA_EXHAUSTED = false;
            // Tear the lock down wherever it was mounted. The popup mounts either
            // on the page or inside the resume iframe (opts.doc), always as
            // #tcv-pro-dl-overlay, so both have to be cleared.
            [document, (typeof frame !== "undefined" && frame) ? frame.contentDocument : null]
                .forEach(function (doc) {
                    if (!doc) return;
                    const overlay = doc.getElementById("tcv-pro-dl-overlay");
                    if (overlay) overlay.remove();
                    // Clear the guards so nothing re-locks a resume this user has
                    // now paid for.
                    doc._tailorcvQuotaLocked = false;
                });
        } catch (e) {
            /* offline or blocked — leave the lock exactly as it was */
        } finally {
            _proRefreshInFlight = false;
        }
    }

    // Returning to the tab after paying in another window.
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) refreshProStatus();
    });
    window.addEventListener("focus", refreshProStatus);

    // The upgrade CTA is a same-tab link to /pricing, so the actual path a paying
    // user takes is: locked page -> /pricing -> pay -> BACK BUTTON. That restores
    // this page from the back-forward cache with the ORIGINAL IS_PRO=false still
    // in it, and no script re-runs — bfcache restores do not re-execute the page,
    // and focus/visibilitychange are not guaranteed to fire either. `pageshow`
    // with persisted=true is the one event that does, so it is the only thing
    // standing between a user who has just paid and a paywall over her own
    // resume. Also covers a plain reload from cache.
    window.addEventListener("pageshow", function (evt) {
        if (evt && evt.persisted) {
            // Values baked into the restored HTML are from before the payment.
            refreshProStatus();
        }
    });

    /* ─────────────────────────────────────────────────────────────────────────
       INIT
    ───────────────────────────────────────────────────────────────────────── */
    /* ─────────────────────────────────────────────────────────────────────────
       MISSING SKILLS — tick what you actually have

       The optimizer only writes a JD skill into the resume when the uploaded
       resume evidences it; everything else is reported as a gap. That keeps the
       AI from inventing credentials, but it also hides skills the candidate
       genuinely has and simply never wrote down. This box is where they say so.

       Nothing is pre-ticked, and the copy makes clear they are vouching for the
       skill — a tick is the candidate's own claim, not ours.
    ───────────────────────────────────────────────────────────────────────── */
    function savePayload(patch) {
        try {
            const current = getPayload() || {};
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
        } catch (e) {}
    }

    function injectSkillGapStyles() {
        if (document.getElementById("tc-gap-styles")) return;
        const st = document.createElement("style");
        st.id = "tc-gap-styles";
        st.textContent = `
#tc-gap-overlay {
    position: fixed; inset: 0; z-index: 99998;
    display: flex; align-items: center; justify-content: center;
}
.tc-gap-backdrop {
    position: absolute; inset: 0;
    background: rgba(8,15,40,0.62);
    backdrop-filter: blur(6px);
    animation: tc-bgin 0.3s ease both;
}
.tc-gap-modal {
    position: relative; z-index: 2; overflow: hidden;
    background: linear-gradient(170deg, #f6f9ff 0%, #ffffff 42%);
    border: 1px solid #c7d7f5;
    border-radius: 18px;
    padding: 1.9rem 2.1rem 1.6rem;
    width: min(720px, 94vw);
    max-height: 88vh; overflow-y: auto;
    box-shadow: 0 26px 70px rgba(15,32,80,0.30), 0 2px 8px rgba(15,32,80,0.10);
    animation: tc-modal-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
    -webkit-font-smoothing: antialiased;
}
/* Accent bar - the colour that makes the card read as ours, not a browser dialog. */
.tc-gap-modal::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 4px;
    background: linear-gradient(90deg, #1d4ed8, #4f46e5 55%, #7c3aed);
}
.tc-gap-modal h2 {
    margin: 0 0 0.28rem;
    color: #0b1220; font-size: 0.98rem; font-weight: 500; letter-spacing: -0.01em;
}
.tc-gap-modal h2 em { font-style: normal; font-weight: 600; color: #1d4ed8; }
.tc-gap-sub {
    margin: 0 0 1.15rem;
    color: #44506b; font-size: 0.78rem; font-weight: 400; line-height: 1.55;
}
.tc-gap-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.75rem; margin-bottom: 0.85rem;
    border-top: 1px solid #dbe5f7; padding-top: 0.95rem;
}
.tc-gap-count {
    color: #1e3a8a; font-size: 0.78rem; font-weight: 400; letter-spacing: 0.01em;
    background: #e4ecfd; border: 1px solid #c7d7f5;
    padding: 0.3rem 0.75rem; border-radius: 999px;
}
/* Deliberately the largest control in the header: ticking 15 pills one by one
   is the slow path, so the shortcut has to be the thing the eye lands on. */
.tc-gap-selectall {
    background: #fff; border: 1.5px solid #1d4ed8;
    padding: 0.5rem 1.25rem; border-radius: 999px;
    color: #1d4ed8; font-size: 0.9rem; font-weight: 500;
    cursor: pointer; text-decoration: none; white-space: nowrap;
    box-shadow: 0 2px 8px rgba(29,78,216,0.16);
    transition: all 0.18s ease;
}
.tc-gap-selectall:hover {
    background: linear-gradient(135deg, #1d4ed8, #6d28d9);
    border-color: transparent; color: #fff;
    box-shadow: 0 5px 16px rgba(29,78,216,0.36);
    transform: translateY(-1px);
}
.tc-gap-selectall:focus { outline: none; }
.tc-gap-selectall:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(29,78,216,0.26); }
.tc-gap-btn:focus { outline: none; }
.tc-gap-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(29,78,216,0.30); }
.tc-gap-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.4rem; }
.tc-gap-pill {
    display: inline-flex; align-items: center; gap: 0.4rem;
    background: #fff;
    border: 1px solid #c3d1ea;
    border-radius: 999px;
    padding: 0.4rem 0.85rem 0.4rem 0.55rem;
    color: #24324e; font-size: 0.76rem; font-weight: 400;
    cursor: pointer; transition: all 0.16s ease;
}
.tc-gap-pill:focus { outline: none; }
.tc-gap-pill:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(29,78,216,0.22); }
.tc-gap-pill:hover {
    border-color: #1d4ed8; background: #f0f5ff; color: #0b1220;
    transform: translateY(-1px);
    box-shadow: 0 3px 10px rgba(29,78,216,0.14);
}
.tc-gap-pill .tc-gap-tick {
    display: inline-flex; align-items: center; justify-content: center;
    width: 15px; height: 15px; border-radius: 50%;
    border: 1px solid #9db3d8; background: #fff;
    font-size: 9px; line-height: 1; color: transparent;
    transition: all 0.16s ease;
}
/* Selected reads as a solid brand-coloured chip - unmistakable at a glance. */
.tc-gap-pill[aria-pressed="true"] {
    background: linear-gradient(135deg, #1d4ed8, #4f46e5);
    border-color: transparent;
    color: #fff; font-weight: 400;
    box-shadow: 0 4px 12px rgba(29,78,216,0.34);
}
.tc-gap-pill[aria-pressed="true"]:hover { transform: translateY(-1px); }
.tc-gap-pill[aria-pressed="true"] .tc-gap-tick {
    background: #fff; border-color: #fff; color: #1d4ed8;
}
.tc-gap-actions {
    display: flex; justify-content: flex-end; align-items: center;
    gap: 0.5rem; flex-wrap: wrap;
}
.tc-gap-btn {
    border-radius: 9px; padding: 0.48rem 1rem;
    font-size: 0.78rem; font-weight: 400; cursor: pointer;
    transition: all 0.18s; border: 1px solid transparent;
}
.tc-gap-skip { background: #fff; border-color: #c3d1ea; color: #24324e; }
.tc-gap-skip:hover { border-color: #9db3d8; background: #f0f5ff; color: #0b1220; }
.tc-gap-add {
    background: linear-gradient(135deg, #1d4ed8, #6d28d9);
    color: #fff; box-shadow: 0 5px 16px rgba(29,78,216,0.38);
}
.tc-gap-add:hover:not(:disabled) { filter: brightness(1.08); box-shadow: 0 7px 20px rgba(29,78,216,0.46); }
.tc-gap-add:disabled {
    background: #dbe3f2; color: #8496b8; cursor: not-allowed; box-shadow: none;
}
@media (max-width: 480px) {
    .tc-gap-actions { flex-direction: column-reverse; }
    .tc-gap-btn { width: 100%; }
}
`;
        document.head.appendChild(st);
    }

    function showSkillGapPrompt(payload) {
        // Never offer a skill the resume already lists. The stored gap list can
        // outlive the add that satisfied it - a template switch or a reload
        // rewrites the payload while keeping the old gaps - and the box then
        // showed 15 pills that were already on the resume, so ticking them
        // correctly did nothing and read as broken.
        const present = new Set(
            ((payload && payload.resume_data && payload.resume_data.skills) || [])
                .map(s => String(s || "").trim().toLowerCase())
                .filter(Boolean)
        );
        const gaps = (Array.isArray(payload?.promptable_skill_gaps)
            ? payload.promptable_skill_gaps
            : []
        ).map(s => String(s || "").trim())
         .filter(s => s && !present.has(s.toLowerCase()));
        if (!gaps.length) return;
        if (document.getElementById("tc-gap-overlay")) return;
        // Answered already. The in-memory guard alone is not enough: switching
        // template re-runs the editor from scratch while the stored payload still
        // lists the same gaps, so the box came back after the user had dealt with
        // it. Persisting the decision keeps it dismissed for this resume.
        if (payload && payload.skill_prompt_answered) return;

        injectSkillGapStyles();

        const selected = new Set();

        const overlay = document.createElement("div");
        overlay.id = "tc-gap-overlay";
        overlay.innerHTML = `
            <div class="tc-gap-backdrop"></div>
            <div class="tc-gap-modal" role="dialog" aria-modal="true" aria-labelledby="tc-gap-title">
                <h2 id="tc-gap-title">This job asks for <em>${gaps.length}</em> skill${gaps.length === 1 ? "" : "s"} your resume doesn't show</h2>
                <p class="tc-gap-sub">
                    Tick the ones you genuinely have and could defend in an interview —
                    we'll add them to your resume. Leave the rest untouched.
                </p>
                <div class="tc-gap-toolbar">
                    <span class="tc-gap-count"></span>
                    <button type="button" class="tc-gap-selectall">Select all</button>
                </div>
                <div class="tc-gap-pills"></div>
                <div class="tc-gap-actions">
                    <button type="button" class="tc-gap-btn tc-gap-skip">Not now</button>
                    <button type="button" class="tc-gap-btn tc-gap-add" disabled>Add to resume</button>
                </div>
            </div>`;

        const pillWrap  = overlay.querySelector(".tc-gap-pills");
        const addBtn    = overlay.querySelector(".tc-gap-add");
        const skipBtn   = overlay.querySelector(".tc-gap-skip");
        const countEl   = overlay.querySelector(".tc-gap-count");
        const selectAll = overlay.querySelector(".tc-gap-selectall");
        const pillEls   = [];

        function refreshAddBtn() {
            addBtn.disabled = selected.size === 0;
            addBtn.textContent = selected.size
                ? `Add ${selected.size} skill${selected.size === 1 ? "" : "s"}`
                : "Add to resume";
            countEl.textContent = `${selected.size} of ${gaps.length} selected`;
            // Once everything is ticked the same control clears it, so a
            // mis-click on "Select all" is one click to undo.
            selectAll.textContent = selected.size === gaps.length ? "Clear all" : "Select all";
        }

        /* Ticks (or unticks) every pill. Deliberately fills the boxes rather
           than submitting: the user still sees exactly what is about to be
           claimed and can untick anything before pressing add. */
        function setAll(on) {
            pillEls.forEach(({ skill, el }) => {
                el.setAttribute("aria-pressed", on ? "true" : "false");
                if (on) selected.add(skill); else selected.delete(skill);
            });
            refreshAddBtn();
        }

        gaps.forEach(skill => {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "tc-gap-pill";
            pill.setAttribute("aria-pressed", "false");
            // textContent for the label so a skill like "C++" or any odd JD
            // wording can never be parsed as markup.
            const tick = document.createElement("span");
            tick.className = "tc-gap-tick";
            tick.textContent = "✓";
            const label = document.createElement("span");
            label.textContent = skill;
            pill.append(tick, label);

            pill.addEventListener("click", () => {
                const on = pill.getAttribute("aria-pressed") === "true";
                pill.setAttribute("aria-pressed", on ? "false" : "true");
                if (on) selected.delete(skill); else selected.add(skill);
                refreshAddBtn();
            });
            pillEls.push({ skill, el: pill });
            pillWrap.appendChild(pill);
        });

        selectAll.addEventListener("click", () => setAll(selected.size !== gaps.length));
        refreshAddBtn();

        function close() {
            overlay.remove();
            // Remember across template switches and reloads, not just this render.
            savePayload({ skill_prompt_answered: true });
        }

        skipBtn.addEventListener("click", close);
        overlay.querySelector(".tc-gap-backdrop").addEventListener("click", close);
        document.addEventListener("keydown", function onEsc(e) {
            if (e.key === "Escape" && document.getElementById("tc-gap-overlay")) {
                close();
                document.removeEventListener("keydown", onEsc);
            }
        });

        addBtn.addEventListener("click", async () => {
            if (!selected.size) return;
            const original = addBtn.textContent;
            addBtn.disabled = true;
            addBtn.textContent = "Adding…";

            let jd = "";
            try { jd = (localStorage.getItem("tailorcv_jobDescription") || "").trim(); } catch (e) {}
            const current = getPayload() || payload || {};

            try {
                // This route is not in EXEMPT_PATHS, so the double-submit CSRF
                // token is required or the middleware answers 403.
                const csrfToken = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "";
                const res = await fetch("/api/resume/add-confirmed-skills", {
                    method:  "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": csrfToken,
                        "X-Requested-With": "XMLHttpRequest",
                    },
                    body:    JSON.stringify({
                        // Read the payload NOW, not when the box was opened. A
                        // template switch rewrites it while the box is up, and
                        // sending the stale copy meant posting resume_data that
                        // no longer matched what is on screen.
                        resume_data: current.resume_data || null,
                        skills:      Array.from(selected),
                        jd_string:   jd,
                        template_id: Number(current.template_id || 1),
                        style_id:    Number(current.style_id || 1),
                    }),
                });
                if (res.status === 401) {
                    window.location.href = "/login?next=" + encodeURIComponent(location.pathname);
                    return;
                }
                if (!res.ok) {
                    // Surface what the server actually said. Replacing it with
                    // "Request failed" meant every cause - no resume_data, a
                    // skill no longer listed, a render error - reached the user
                    // as the same unactionable "Update failed".
                    let detail = "";
                    try {
                        const body = await res.json();
                        detail = tcvErrorMessage(body, "");
                    } catch (e) {}
                    throw new Error(detail || `Request failed (${res.status})`);
                }

                const data = await res.json();

                // Nothing to do: everything ticked is already on the resume
                // (a second click, or a click after switching template). The
                // server returns no HTML in that case - there is nothing to
                // re-render, and it is not an error.
                if (data && data.success && (!data.added || !data.added.length)) {
                    savePayload({ skill_prompt_answered: true });
                    close();
                    if (typeof showToast === "function") {
                        showToast("Those skills are already on your resume.", "info", "Nothing to add");
                    }
                    return;
                }

                if (!data || !data.html) throw new Error("No resume returned");

                // Persist first, so a refresh keeps the added skills.
                savePayload({
                    html: data.html,
                    resume_data: data.resume_data,
                    promptable_skill_gaps: data.promptable_skill_gaps || [],
                    skill_prompt_answered: true,
                });

                // Re-render the preview. captureBaseFonts/captureBaseLineSpacing
                // stamp data-base-font and data-base-lh onto the nodes of the
                // document they measure, and both are one-shot guarded. A fresh
                // srcdoc has none of those attributes, so leaving the flags set
                // means the A+/A-/S+/S- controls silently stop doing anything.
                // Same reset the template switcher does on its re-render.
                //
                // currentZoom, currentLineSpacing and currentAccentColor are
                // deliberately kept: the load handler's applyWordStylePreview()
                // re-applies them once the new document has been re-measured, so
                // the user's adjustments survive adding a skill.
                baseFontsCaptured        = false;
                baseLineSpacingsCaptured = false;

                currentHtml = addEditingOverlay(data.html);
                frame.srcdoc = currentHtml;

                close();
                const added = (data.added || []).join(", ");
                if (typeof showToast === "function") {
                    showToast(`Added ${added} to your resume.`, "success", "Skills updated");
                } else {
                    setStatus(`Added ${added} to your resume.`);
                }
            } catch (e) {
                addBtn.disabled = false;
                addBtn.textContent = original;
                const why = (e && e.message) ? String(e.message) : "Please try again.";
                if (typeof showToast === "function") {
                    showToast(why, "error", "Could not add skills");
                } else {
                    setStatus("Could not add skills: " + why);
                }
            }
        });

        document.body.appendChild(overlay);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       "SEE WHAT CHANGED" MODAL
    ───────────────────────────────────────────────────────────────────────── */
    /* Word-level LCS diff, split on whitespace so word tokens and the spaces
       between them are both diffed (keeps reconstructed spacing exact). Bullets
       are short (a sentence or two) so an O(n*m) DP table is fine. */
    function wordDiff(before, after) {
        const a = String(before || "").split(/(\s+)/).filter(Boolean);
        const b = String(after  || "").split(/(\s+)/).filter(Boolean);
        const n = a.length, m = b.length;
        const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const beforeParts = [], afterParts = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) {
                beforeParts.push({ text: a[i], same: true });
                afterParts.push({ text: b[j], same: true });
                i++; j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                beforeParts.push({ text: a[i], same: false });
                i++;
            } else {
                afterParts.push({ text: b[j], same: false });
                j++;
            }
        }
        while (i < n) { beforeParts.push({ text: a[i], same: false }); i++; }
        while (j < m) { afterParts.push({ text: b[j], same: false }); j++; }
        return { beforeParts, afterParts };
    }

    /* Builds diffed text as DOM nodes — every word is placed via textContent,
       never interpolated into innerHTML, so resume/JD text can never be parsed
       as markup (same rule showSkillPanel follows in the extension). */
    function renderDiffLine(parts, changedClass) {
        const frag = document.createDocumentFragment();
        parts.forEach(p => {
            if (p.same) {
                frag.appendChild(document.createTextNode(p.text));
            } else {
                const span = document.createElement("span");
                span.className = changedClass;
                span.textContent = p.text;
                frag.appendChild(span);
            }
        });
        return frag;
    }

    function injectChangesModalStyles() {
        if (document.getElementById("tc-chg-styles")) return;
        const st = document.createElement("style");
        st.id = "tc-chg-styles";
        st.textContent = `
#tc-chg-overlay {
    position: fixed; inset: 0; z-index: 2147483000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
}
/* Third-party support widgets mount themselves fixed in the bottom-right at a
   very high z-index, landing squarely on "Apply All and Continue". They are
   injected at runtime under names we do not control, so hide by POSITION while
   the modal is open rather than by chasing each vendor's class name. */
body.tc-chg-open iframe[src*="chat"],
body.tc-chg-open iframe[title*="hat"],
body.tc-chg-open iframe[id*="chat"],
body.tc-chg-open [class*="chat-widget"],
body.tc-chg-open [class*="chat-bubble"],
body.tc-chg-open [id*="chat-widget"],
body.tc-chg-open [id*="launcher"],
body.tc-chg-open .tcx-help-fab,
body.tc-chg-open #tcx-chat,
body.tc-chg-open #tawkchat-container,
body.tc-chg-open .crisp-client,
body.tc-chg-open #intercom-container { display: none !important; }
.tc-chg-backdrop {
    position: absolute; inset: 0; background: rgba(15,23,42,.45);
    animation: tc-chg-bgin .25s ease both;
}
@keyframes tc-chg-bgin { from { opacity: 0 } to { opacity: 1 } }
.tc-chg-modal {
    position: relative; z-index: 2; display: flex; flex-direction: column;
    background: #fff; border-radius: 12px; overflow: hidden;
    width: min(1400px, 96vw); height: min(900px, 94vh);
    box-shadow: 0 24px 64px rgba(15,23,42,.28);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    animation: tc-chg-in .28s cubic-bezier(.34,1.3,.64,1) both;
}
@keyframes tc-chg-in {
    from { opacity: 0; transform: scale(.97) translateY(12px) }
    to   { opacity: 1; transform: none }
}
.tc-chg-panes { flex: 1; display: grid; grid-template-columns: 40% 60%; min-height: 0; }
.tc-chg-rail {
    min-height: 0; overflow-y: auto; padding: 32px;
    border-right: 1px solid #e5e7eb;
}
.tc-chg-close {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; padding: 0;
    background: none; border: 0; border-radius: 6px; cursor: pointer;
    color: #6b7280; font-size: 1.35rem; line-height: 1;
    transition: background .15s ease, color .15s ease;
}
.tc-chg-close:hover { background: #f3f4f6; color: #111827; }
/* ── A. Hero heading ── */
.tc-chg-hero {
    margin: 0 0 28px; font-size: 40px; line-height: 1.15;
    font-weight: 700; color: #0f172a; letter-spacing: -.02em;
}
/* ── B/C. Score rows ── */
.tc-chg-scorerow { display: flex; align-items: flex-start; gap: 24px; padding: 4px 0 22px; }
.tc-chg-scorerow + .tc-chg-scorerow { border-top: 1px solid #e5e7eb; padding-top: 22px; }
.tc-chg-ring-wrap { flex: 0 0 auto; width: 100px; text-align: center; }
.tc-chg-ring { position: relative; width: 100px; height: 100px; }
.tc-chg-ring svg { width: 100px; height: 100px; transform: rotate(-90deg); }
.tc-chg-ring-track { fill: none; stroke: #e8eaed; stroke-width: 8; }
.tc-chg-ring-fill  { fill: none; stroke: #16a34a; stroke-width: 8; stroke-linecap: round; }
.tc-chg-ring-num {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem; font-weight: 600; color: #0f172a;
}
.tc-chg-improved {
    display: flex; align-items: flex-start; justify-content: center; gap: 4px;
    margin-top: 8px; color: #16a34a; font-size: .78rem; line-height: 1.3; text-align: left;
}
.tc-chg-improved svg { width: 13px; height: 13px; flex: 0 0 auto; margin-top: 1px; }
.tc-chg-scoretext { flex: 1; min-width: 0; padding-top: 6px; }
.tc-chg-scoretitle { font-size: 28px; font-weight: 400; color: #0f172a; margin: 0 0 8px; letter-spacing: -.01em; }
.tc-chg-scoredesc { font-size: .92rem; line-height: 1.55; color: #6b7280; margin: 0; }
/* ── D/E/F. Keyword cards ── */
.tc-chg-kwcard {
    border: 1px solid #e5e7eb; border-radius: 8px; background: #f8fafc;
    margin-top: 14px; overflow: hidden;
}
.tc-chg-kwcard.added { background: #f0fdf4; border-color: #bbf7d0; }
.tc-chg-kwhead {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 13px 15px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-kwtitle { flex: 1; font-size: .94rem; font-weight: 500; color: #111827; }
.tc-chg-kwcard.added .tc-chg-kwtitle { font-size: 1.05rem; }
.tc-chg-help {
    display: inline-flex; align-items: center; justify-content: center;
    width: 15px; height: 15px; border: 1px solid #9ca3af; border-radius: 50%;
    color: #6b7280; font-size: .6rem; flex: 0 0 auto;
}
.tc-chg-kwbody { padding: 0 15px 14px; display: flex; flex-wrap: wrap; gap: 7px; }
.tc-chg-chip {
    display: inline-flex; align-items: center; padding: 5px 11px;
    border-radius: 999px; font-size: .8rem; line-height: 1.2;
    background: #dcfce7; color: #14532d;
}
.tc-chg-chip.miss { background: #fee2e2; color: #7f1d1d; }
.tc-chg-ico { flex: 0 0 auto; width: 17px; height: 17px; }
/* Chevron: up = open, down = closed. */
.tc-chg-chev {
    flex: 0 0 auto; width: 9px; height: 9px; margin-left: 2px;
    border-right: 2px solid #6b7280; border-bottom: 2px solid #6b7280;
    transform: rotate(-135deg); transition: transform .2s ease;
}
[aria-expanded="false"] > .tc-chg-chev { transform: rotate(45deg); }
/* ── G. Nested change cards ── */
.tc-chg-sec {
    border: 1px solid #e5e7eb; border-radius: 8px; background: #fff;
    margin-top: 14px; overflow: hidden;
}
.tc-chg-sechead {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 15px 16px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-sectitle { flex: 1; font-size: 1.02rem; font-weight: 500; color: #111827; }
/* Level 1 chevron sits in a small square button, per the reference. */
.tc-chg-chevbox {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; flex: 0 0 auto;
    border: 1px solid #bfdbfe; border-radius: 6px; background: #eff6ff;
}
.tc-chg-chevbox .tc-chg-chev { border-color: #2563eb; margin: 0; }
.tc-chg-secbody { padding: 0 16px 14px; }
.tc-chg-entry { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; margin-top: 10px; overflow: hidden; }
.tc-chg-entryhead {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 13px 14px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-entrytitle { flex: 1; font-size: .95rem; font-weight: 500; color: #111827; }
.tc-chg-entrybody { padding: 0 14px 12px; }
.tc-chg-item { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; margin-top: 10px; overflow: hidden; }
.tc-chg-itemhead {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 12px 14px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-itemnum { flex: 1; font-size: .92rem; font-weight: 500; color: #111827; }
.tc-chg-provenance {
    margin-top: 10px; font-size: .78rem; line-height: 1.5; color: #6b7280;
}
.tc-chg-newtag {
    flex: 0 0 auto; padding: 2px 8px; border-radius: 999px;
    background: #dcfce7; color: #14532d; font-size: .7rem; font-weight: 600;
}
.tc-chg-itembody { padding: 0 14px 14px; }
.tc-chg-itembody-inner { border-top: 1px solid #e5e7eb; padding-top: 13px; }
.tc-chg-afterlabel { font-size: .95rem; font-weight: 500; color: #111827; margin-bottom: 7px; }
.tc-chg-aftertext { font-size: .88rem; line-height: 1.65; color: #4b5563; }
.tc-chg-compare-link {
    display: inline-block; margin-top: 12px; padding: 0;
    background: none; border: 0; cursor: pointer; font-family: inherit;
    font-size: .88rem; color: #2563eb;
}
.tc-chg-compare-link:hover { text-decoration: underline; }
.tc-chg-ba { margin-top: 12px; font-size: .86rem; line-height: 1.6; }
.tc-chg-ba-label {
    font-size: .72rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: .05em; color: #9ca3af; margin-bottom: 3px;
}
.tc-chg-ba-before { color: #6b7280; margin-bottom: 9px; }
.tc-chg-ba-after { color: #111827; }
.tc-chg-empty { font-size: .9rem; color: #6b7280; padding: 16px 0; line-height: 1.6; }
/* ── Right pane: document viewer ──
   Header holds the X on its own row, canvas is the ONLY scroller, and the
   page floats on grey with space above, left and right. Previously the page
   sat flush against the top and right edges with two nested scrollbars. */
.tc-chg-preview {
    position: relative;
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    background: #F1F3F6;
}
/* The header overlays rather than occupying a row - as a flex child it pushed
   the page down and stacked its own padding on top of the canvas padding. */
.tc-chg-preview-header {
    position: absolute; top: 8px; right: 12px; z-index: 5;
    display: flex; justify-content: flex-end;
}
.tc-chg-preview-canvas {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 24px 24px 32px;
}
/* Inner padding so the document reads as a printed page. Without it the
   resume text ran flush to both edges of the white sheet and looked cropped. */
.tc-chg-page {
    width: 100%; max-width: 794px; margin: 0 auto; background: #fff;
    box-shadow: 0 2px 12px rgba(0,0,0,.08); overflow: visible;
    padding: 40px 56px 48px; box-sizing: border-box;
}
/* Height is set from the mirrored document's own scrollHeight on load - a
   fixed A4 ratio cropped every resume that ran past one page. */
.tc-chg-mirror { display: block; width: 100%; min-height: 700px; border: 0; background: #fff; }
/* ── Sticky footer ── */
.tc-chg-footer {
    flex: 0 0 auto; display: flex; align-items: center;
    padding: 14px 24px; background: #fff; border-top: 1px solid #e5e7eb;
}
.tc-chg-sugg { margin-left: 40%; display: flex; align-items: center; gap: 8px; font-size: .9rem; color: #6b7280; }
.tc-chg-suggnum {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 24px; height: 22px; padding: 0 7px; border-radius: 999px;
    background: #dbeafe; color: #1d4ed8; font-size: .8rem; font-weight: 500;
}
.tc-chg-apply {
    margin-left: auto; padding: 10px 20px; border: 0; border-radius: 6px;
    background: #2563eb; color: #fff; cursor: pointer;
    font-family: inherit; font-size: .9rem; font-weight: 500;
    transition: background .15s ease;
}
.tc-chg-apply:hover { background: #1d4ed8; }
@media (max-width: 1024px) {
    .tc-chg-panes { grid-template-columns: 1fr; }
    .tc-chg-preview { display: none; }
    .tc-chg-rail { border-right: 0; padding: 24px 18px; }
    .tc-chg-hero { font-size: 28px; }
    .tc-chg-scoretitle { font-size: 21px; }
    .tc-chg-sugg { margin-left: 0; }
}
`;
        document.head.appendChild(st);
    }

    /* Merge change islands separated by only a word or two of survivor.

       Word-level LCS treats every shared token as a match, so a rewritten
       sentence keeps incidental words - "and", "to", "data" - and the diff
       fragments into eight separate red/green flickers across one bullet. The
       reader cannot see what was actually replaced.

       A short bridge between two changes is noise: absorb it into the change so
       the bullet shows a few clean chunks instead. Longer runs of unchanged
       text are real and stay untouched. */
    function coalesceDiff(beforeParts, afterParts, bridgeWords) {
        const LIMIT = bridgeWords == null ? 2 : bridgeWords;
        const runLen = (parts, i) => {
            let n = 0, k = i;
            while (k < parts.length && parts[k].same) {
                if (parts[k].text.trim()) n++;
                k++;
            }
            return { words: n, end: k };
        };
        const merge = parts => {
            const out = parts.map(p => ({ ...p }));
            let i = 0, seenChange = false;
            while (i < out.length) {
                if (!out[i].same) { seenChange = true; i++; continue; }
                const { words, end } = runLen(out, i);
                if (seenChange && end < out.length && words > 0 && words <= LIMIT) {
                    for (let k = i; k < end; k++) out[k].same = false;
                }
                i = end;
            }
            return out;
        };
        return { beforeParts: merge(beforeParts), afterParts: merge(afterParts) };
    }

    /* Draw the diff onto the mirrored resume itself.
       The rail says WHAT changed; without this the resume beside it is a clean
       copy and the reader has to find every edit by eye. Each changed bullet is
       located by its rewritten text and re-rendered with removed words struck
       through in red and added ones in green, using the same wordDiff the rail
       uses so the panes can never disagree.
       Returns "entry:bullet" -> element so a card can scroll to its change. */
    /* Text-identity index over the ORIGINAL resume.

       The server decides "new" by looking up an entry in the original document
       by a single identifier field, so a section the template renamed, or an
       entry whose role/company pair is written differently, fails the lookup
       and every bullet under it is reported as new. That is how four unchanged
       Leadership bullets came back fully green.

       Green has to mean "this text is not in the original", so the final say
       belongs to the text itself rather than to any name or id. */
    function buildOriginalIndex(originalText) {
        const exact = new Set();
        const lines = [];
        String(originalText || "").split(/\r?\n+/).forEach(raw => {
            const line = normaliseForCompare(raw);
            if (line.length < 12) return;       // headings, dates, stray tokens
            exact.add(line);
            lines.push(line);
        });
        return { exact, lines };
    }

    /* Lowercase, collapse whitespace, strip bullet glyphs and trailing
       punctuation, and flatten quote/dash variants - a template that swaps a
       hyphen for an en dash has not changed the candidate's words. */
    function normaliseForCompare(s) {
        return String(s || "")
            .replace(/[‘’‛]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[‐-―−]/g, "-")
            .replace(/^[\s•·\-\*●▪]+/, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .replace(/[.,;:!?]+$/, "")
            .trim();
    }

    function wordOverlap(a, b) {
        const A = new Set(normaliseForCompare(a).split(" ").filter(w => w.length > 2));
        const B = new Set(normaliseForCompare(b).split(" ").filter(w => w.length > 2));
        if (!A.size || !B.size) return 0;
        let hit = 0;
        A.forEach(w => { if (B.has(w)) hit++; });
        return hit / Math.max(A.size, B.size);
    }

    /* Re-decide a bullet's status against the original text.
       Returns null when the text is unchanged, so the caller can skip it
       entirely - no highlight, no change card, no suggestion counted. */
    function reconcileStatus(b, idx) {
        if (!idx || !b || !b.after) return b;
        const after = normaliseForCompare(b.after);
        if (!after) return b;

        // Present verbatim somewhere in the original: unchanged, whatever the
        // server called it and whichever section it now sits under.
        if (idx.exact.has(after)) return null;

        if (b.status === "reworded" && b.before) {
            return normaliseForCompare(b.before) === after ? null : b;
        }

        // Reported as new. Look for the original line it most resembles.
        let best = null, bestScore = 0;
        for (const line of idx.lines) {
            const score = wordOverlap(after, line);
            if (score > bestScore) { bestScore = score; best = line; }
        }
        if (bestScore >= 0.92) return null;                       // same words
        if (bestScore >= 0.5) return { ...b, status: "reworded", before: best };
        return b;                                                  // genuinely new
    }

    function markChangesInPreview(doc, entries, extras) {
        const index = new Map();
        if (!doc) return index;
        entries = Array.isArray(entries) ? entries : [];
        const origIdx = (extras && extras.originalIndex) || null;

        const norm = t => String(t || "").replace(/\s+/g, " ").trim();
        // Leaf blocks only: re-rendering a container would destroy its children.
        const blocks = Array.from(doc.querySelectorAll("li, p, div, td"))
            .filter(el => !el.querySelector("li, p, div, td"));

        // The summary and the skills lines are changed just as often as the
        // bullets, and the left panel reports them - but they live outside
        // `entries`, so they were rendering as plain text while every bullet
        // around them was highlighted. Treat them as ordinary change records.
        const synthetic = [];
        if (extras && extras.summary && extras.summary.status
            && extras.summary.status !== "unchanged" && extras.summary.after) {
            synthetic.push({ bullets: [{
                status: extras.summary.status,
                before: extras.summary.before,
                after:  extras.summary.after,
            }]});
        }
        if (extras && Array.isArray(extras.skillLines)) {
            extras.skillLines.forEach(line => synthetic.push({ bullets: [line] }));
        }
        const allEntries = entries.concat(synthetic);

        allEntries.forEach((entry, ei) => {
            (entry.bullets || []).forEach((change, bi) => {
                const b = reconcileStatus(change, origIdx);
                if (!b || b.status === "unchanged" || !b.after) return;
                const target = norm(b.after);
                if (!target) return;

                const el = blocks.find(x => !x.dataset.tcvMarked && norm(x.textContent) === target)
                        || blocks.find(x => !x.dataset.tcvMarked && norm(x.textContent).includes(target));
                if (!el) return;
                el.dataset.tcvMarked = "1";

                const key = ei + ":" + bi;
                el.setAttribute("data-tcv-change", key);
                index.set(key, el);

                // A skills line is a list, so diff it item by item: wrap only
                // the skill names that are new and leave the commas plain. A
                // word diff here marks punctuation and splits "Node.js".
                if (b._addedSkills && b._addedSkills.length) {
                    const addedKeys = new Set(b._addedSkills.map(skillKey));
                    el.textContent = "";
                    b.after.split(",").forEach((item, n) => {
                        const text = item.trim();
                        if (n) el.appendChild(doc.createTextNode(", "));
                        if (text && addedKeys.has(skillKey(text))) {
                            const tag = doc.createElement("ins");
                            tag.className = "tcv-mark-add";
                            tag.textContent = text;
                            el.appendChild(tag);
                        } else {
                            el.appendChild(doc.createTextNode(text));
                        }
                    });
                    el.style.textAlign = "left";
                    return;
                }

                // A new bullet has no "before" - the whole line reads as added.
                if (b.status !== "reworded" || !b.before) {
                    const t = el.textContent;
                    el.textContent = "";
                    const tag = doc.createElement("ins");
                    tag.className = "tcv-mark-add";
                    tag.textContent = t;
                    el.appendChild(tag);
                    el.style.textAlign = "left";
                    return;
                }

                const diff = wordDiff(b.before, b.after);
                const { beforeParts, afterParts } = coalesceDiff(diff.beforeParts, diff.afterParts);
                el.textContent = "";

                // Build ONE run per contiguous stretch of the same type, then
                // emit one element for it. Emitting a span per token put every
                // whitespace token inside its own coloured box, so the text
                // rendered as "potential - data - imbalances" with each word
                // boxed separately and the gaps stretched by justification.
                const runs = [];
                const pushRun = (kind, text) => {
                    if (!text) return;
                    const last = runs[runs.length - 1];
                    if (last && last.kind === kind) last.text += text;
                    else runs.push({ kind, text });
                };

                let bi2 = 0, ai = 0;
                while (bi2 < beforeParts.length || ai < afterParts.length) {
                    while (bi2 < beforeParts.length && !beforeParts[bi2].same) {
                        pushRun("del", beforeParts[bi2].text); bi2++;
                    }
                    while (ai < afterParts.length && !afterParts[ai].same) {
                        pushRun("add", afterParts[ai].text); ai++;
                    }
                    if (bi2 < beforeParts.length && ai < afterParts.length) {
                        pushRun("same", afterParts[ai].text); bi2++; ai++;
                    } else {
                        while (ai < afterParts.length) {
                            pushRun(afterParts[ai].same ? "same" : "add", afterParts[ai].text); ai++;
                        }
                        while (bi2 < beforeParts.length) {
                            if (!beforeParts[bi2].same) pushRun("del", beforeParts[bi2].text);
                            bi2++;
                        }
                    }
                }

                // Trim each highlighted run so the pink/green box hugs the
                // words and the surrounding spaces stay plain text.
                runs.forEach(r => {
                    if (r.kind === "same") { el.appendChild(doc.createTextNode(r.text)); return; }
                    const lead = r.text.match(/^\s*/)[0];
                    const tail = r.text.match(/\s*$/)[0];
                    const core = r.text.slice(lead.length, r.text.length - tail.length);
                    if (lead) el.appendChild(doc.createTextNode(lead));
                    if (core) {
                        const tag = doc.createElement(r.kind === "del" ? "del" : "ins");
                        tag.className = r.kind === "del" ? "tcv-mark-del" : "tcv-mark-add";
                        tag.textContent = core;
                        el.appendChild(tag);
                    }
                    if (tail) el.appendChild(doc.createTextNode(tail));
                });

                // Justified text stretches the spaces around the highlights
                // into visible gaps - force left alignment on marked bullets.
                el.style.textAlign = "left";
            });
        });
        return index;
    }

    /* Scores come from the ATS analysis the user already ran - reading its
       stored payload rather than re-scoring, because two runs on the same input
       disagree and the editor would contradict the score page. */
    /* Canonical form for comparing a skill written two ways.
       "Node.js", "nodejs" and "Node JS" are one skill; so are "CI/CD" and
       "CICD", "Postgres" and "PostgreSQL". Without this the missing-keywords
       list reported skills that were sitting in the resume in a different
       spelling. */
    const SKILL_ALIASES = {
        nodejs: "node", node: "node", nodejs2: "node",
        postgres: "postgresql", postgre: "postgresql", postgressql: "postgresql",
        cicd: "cicd", continuousintegration: "cicd",
        googlecloudplatform: "gcp", gcp: "gcp",
        amazonwebservices: "aws", aws: "aws",
        k8s: "kubernetes", kubernetes: "kubernetes",
        js: "javascript", javascript: "javascript",
        ts: "typescript", typescript: "typescript",
        golang: "go", go: "go",
        githubactions: "githubactions",
        restapis: "rest", restapi: "rest", rest: "rest",
        ms: "microsoft", googleanalytics4: "ga4", ga4: "ga4",
    };
    function skillKey(s) {
        const k = String(s || "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
        return SKILL_ALIASES[k] || k;
    }

    /* Which of the JD's skills the FINAL resume actually contains.
       The stored ATS analysis scored the ORIGINAL document, so its "missing"
       list still names everything the optimiser has since added - which is why
       the panel listed Java, Go, Docker and Kubernetes as missing while they
       sat in the rendered Technical Skills line. Re-checking against the full
       text of the new resume is a string comparison, not a second opinion, so
       it cannot contradict the score the way a re-scan would. */
    function partitionKeywords(candidates, resumeText, addedList) {
        const haystack = new Set();
        String(resumeText || "")
            .split(/[^A-Za-z0-9+#.]+/)
            .forEach(tok => { if (tok) haystack.add(skillKey(tok)); });
        // Multi-word skills never survive tokenising, so also keep a
        // whitespace-stripped blob to test them against.
        const blob = String(resumeText || "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
        const addedKeys = new Set((addedList || []).map(skillKey));

        const present = [], missing = [], added = [];
        (candidates || []).forEach(c => {
            const key = skillKey(c);
            if (!key) return;
            const found = haystack.has(key) || (key.length >= 3 && blob.includes(key));
            if (addedKeys.has(key)) added.push(c);
            else if (found) present.push(c);
            else missing.push(c);
        });
        return { present, missing, added };
    }

    /* The ATS analysis the user already ran, wherever it was stored.
       main_new.js writes "atsAnalysisPayload" on every scan and mirrors it to
       localStorage for guests; ats_analysis.js reads the same key. Checking
       both storages for each name matters because a guest's session copy is
       cleared while the local one survives. Re-scoring here instead would
       produce a second opinion that contradicts the score page. */
    function readAtsPayload() {
        const keys = [
            "atsAnalysisPayload",
            "tailorcv_ats_payload_guest",
            "tailorcv_ats_payload_local",
        ];
        for (const k of keys) {
            for (const store of [sessionStorage, localStorage]) {
                try {
                    const raw = store.getItem(k);
                    if (!raw) continue;
                    const d = JSON.parse(raw);
                    if (d && typeof d === "object") return d;
                } catch (e) {}
            }
        }
        return null;
    }

    function showChangesModal(payload) {
        if (document.getElementById("tc-chg-overlay")) return;
        injectChangesModalStyles();

        const changes = (payload && payload.resume_data && payload.resume_data.changes) || {};
        const skillsAdded = Array.isArray(changes.skills_added) ? changes.skills_added : [];
        const skillGaps   = Array.isArray(changes.skill_gaps)   ? changes.skill_gaps   : [];
        const entries     = Array.isArray(changes.entries)      ? changes.entries      : [];
        const summary     = changes.summary || null;

        const ats  = readAtsPayload() || {};
        const skillsBlock = ats.skills || (ats.data && ats.data.skills)
            || (ats.result && ats.result.skills) || {};
        const hard = skillsBlock.hard_skills || {};
        const rawMatched = Array.isArray(hard.matched) ? hard.matched : [];
        const rawMissing = Array.isArray(hard.missing) ? hard.missing : [];

        // Re-partition every JD skill against the FINAL resume text. The stored
        // analysis judged the original document, so its lists are stale the
        // moment the optimiser adds a skill.
        const finalText = [
            String((payload && payload.resume_data && payload.resume_data.summary) || ""),
            ((payload && payload.resume_data && payload.resume_data.skills) || []).join(" "),
            String(currentHtml || "").replace(/<[^>]*>/g, " "),
        ].join(" ");
        const part = partitionKeywords(
            rawMatched.concat(rawMissing), finalText, skillsAdded);
        const matchedKw = part.present;
        const missingKw = part.missing;

        const clampPct = v => Math.round(Math.max(0, Math.min(100, Number(v || 0))));
        // The score the user's own analysis produced. match_rate is what the ATS
        // page renders, so the editor cannot contradict the number they saw.
        // Several shapes reach this page depending on the route taken, so take
        // the first that carries a real number rather than assuming one.
        const firstNum = (...vals) => {
            for (const v of vals) {
                const n = Number(v);
                if (v != null && Number.isFinite(n) && n > 0) return n;
            }
            return 0;
        };
        const atsScore = clampPct(firstNum(
            ats.match_rate,
            ats.ats_score,
            ats.score,
            ats.data && ats.data.match_rate,
            ats.result && ats.result.match_rate,
            payload && payload.match_rate,
            payload && payload.ats_score,
            payload && payload.resume_data && payload.resume_data.ats_score
        ));

        // "Improved by" needs a genuine before-score. The extension flow stores
        // one (skill_match_before/after); the web flow has never had one, and
        // inventing a delta would tell the user their resume improved by a
        // number nobody measured. Absent or non-positive -> the line is hidden.
        const beforeScore =
            payload && payload.skill_match_before != null ? Number(payload.skill_match_before)
          : ats.skill_match_before != null ? Number(ats.skill_match_before)
          : ats.previous_score != null ? Number(ats.previous_score)
          : null;
        const afterScore =
            payload && payload.skill_match_after != null ? Number(payload.skill_match_after)
          : null;
        let improvedBy = null;
        if (beforeScore != null && Number.isFinite(beforeScore)) {
            const resolvedAfter =
                afterScore != null && Number.isFinite(afterScore) ? afterScore : atsScore;
            const delta = Math.round(resolvedAfter - beforeScore);
            if (delta > 0) improvedBy = delta;
        }

        // Built from the candidate's own text so every "new" claim can be
        // checked against it. Without this, a renamed section made untouched
        // bullets render fully green and inflated the suggestion count.
        const origIdx = buildOriginalIndex(
            (Array.isArray(changes.original_lines) ? changes.original_lines : []).join("\n"));

        // Reconcile once, here, so the preview, the change cards and the count
        // all describe the same set of changes.
        entries.forEach(e => {
            e.bullets = (e.bullets || [])
                .map(b => reconcileStatus(b, origIdx))
                .filter(Boolean);
        });

        const changedBullets = entries.reduce(
            (n, e) => n + (e.bullets || []).filter(b => b.status !== "unchanged").length, 0);
        const summaryChange = summary && summary.status && summary.status !== "unchanged"
            ? reconcileStatus(summary, origIdx) : null;
        const suggestionCount = changedBullets + skillsAdded.length +
            (summaryChange ? 1 : 0);

        const ICON = {
            trend:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
            check:   '<svg class="tc-chg-ico" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 12 6 17 15 8"/><polyline points="9 12 14 17 23 8"/></svg>',
            warn:    '<svg class="tc-chg-ico" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        };

        const overlay = document.createElement("div");
        overlay.id = "tc-chg-overlay";
        overlay.innerHTML = `
            <div class="tc-chg-backdrop"></div>
            <div class="tc-chg-modal" role="dialog" aria-modal="true" aria-labelledby="tc-chg-title">
                <div class="tc-chg-panes">
                    <div class="tc-chg-rail">
                        <h2 class="tc-chg-hero" id="tc-chg-title">Your new ATS-friendly resume is ready!</h2>
                        <div class="tc-chg-scores"></div>
                        <div class="tc-chg-body"></div>
                        <div class="tc-chg-keywords"></div>
                    </div>
                    <div class="tc-chg-preview">
                        <div class="tc-chg-preview-header">
                            <button type="button" class="tc-chg-close" aria-label="Close">&times;</button>
                        </div>
                        <div class="tc-chg-preview-canvas">
                            <div class="tc-chg-page"></div>
                        </div>
                    </div>
                </div>
                <div class="tc-chg-footer">
                    <span class="tc-chg-sugg">Suggestions
                        <span class="tc-chg-suggnum">${suggestionCount}</span></span>
                    <button type="button" class="tc-chg-apply">Apply All and Continue</button>
                </div>
            </div>`;

        const rail     = overlay.querySelector(".tc-chg-rail");
        const scoresEl = overlay.querySelector(".tc-chg-scores");
        const kwEl     = overlay.querySelector(".tc-chg-keywords");
        const body     = overlay.querySelector(".tc-chg-body");
        let markIndex  = new Map();

        /* ── Resume Analysis Results: one ring, driven by the real score ── */
        function ringColor(pct) {
            if (pct >= 75) return "#16a34a";   // green  - strong
            if (pct >= 50) return "#f59e0b";   // orange - middling
            return "#dc2626";                   // red    - weak
        }

        function addScoreRow(pct, improved, title, desc) {
            const C = 2 * Math.PI * 44;
            const row = document.createElement("div");
            row.className = "tc-chg-scorerow";
            row.innerHTML = `
                <div class="tc-chg-ring-wrap">
                    <div class="tc-chg-ring">
                        <svg viewBox="0 0 100 100">
                            <circle class="tc-chg-ring-track" cx="50" cy="50" r="44"/>
                            <circle class="tc-chg-ring-fill" cx="50" cy="50" r="44"
                                stroke="${ringColor(pct)}"
                                stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
                        </svg>
                        <div class="tc-chg-ring-num">0%</div>
                    </div>
                    ${improved != null ? `<div class="tc-chg-improved" style="color:${ringColor(pct)}">${ICON.trend}
                        <span>Improved<br>by ${improved}%</span></div>` : ""}
                </div>
                <div class="tc-chg-scoretext">
                    <div class="tc-chg-scoretitle"></div>
                    <p class="tc-chg-scoredesc"></p>
                </div>`;
            row.querySelector(".tc-chg-scoretitle").textContent = title;
            row.querySelector(".tc-chg-scoredesc").textContent = desc;
            scoresEl.appendChild(row);

            // Fill the ring and count the number up to the real value.
            const fill = row.querySelector(".tc-chg-ring-fill");
            const num  = row.querySelector(".tc-chg-ring-num");
            const reduce = window.matchMedia
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reduce) {
                fill.style.strokeDashoffset = String(C - (pct / 100) * C);
                num.textContent = pct + "%";
                return;
            }
            requestAnimationFrame(() => {
                fill.style.transition = "stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)";
                fill.style.strokeDashoffset = String(C - (pct / 100) * C);
            });
            const t0 = performance.now(), DUR = 1000;
            (function step(now) {
                const k = Math.min(1, (now - t0) / DUR);
                num.textContent = Math.round(pct * (1 - Math.pow(1 - k, 3))) + "%";
                if (k < 1) requestAnimationFrame(step);
            })(t0);
        }

        // The section renders whenever a score exists. When the user reached the
        // editor without running an analysis there is genuinely nothing to show,
        // and inventing a number would be worse than omitting the block.
        if (atsScore > 0) {
            addScoreRow(atsScore, improvedBy, "Resume Analysis Results",
                "We also analyzed your resume's content, based on the industry best practices for your role and experience level.");
        } else {
            // Says WHY the block is absent, so a missing score is diagnosable
            // from the console instead of looking like broken rendering.
            console.info(
                "[TailorCV] Resume Analysis Results hidden: no ATS score found.",
                { atsPayloadFound: !!readAtsPayload(), keysChecked:
                    ["atsAnalysisPayload", "tailorcv_ats_payload_guest", "tailorcv_ats_payload_local"] }
            );
        }

        /* ── D/E/F. Keyword cards ── */
        function addKeywordCard(icon, title, chips, chipClass, extraClass) {
            if (!chips.length) return;
            const card = document.createElement("div");
            card.className = "tc-chg-kwcard" + (extraClass ? " " + extraClass : "");
            const head = document.createElement("button");
            head.type = "button";
            head.className = "tc-chg-kwhead";
            head.setAttribute("aria-expanded", "true");
            head.innerHTML = `${icon}<span class="tc-chg-kwtitle"></span>
                <span class="tc-chg-help">?</span><span class="tc-chg-chev"></span>`;
            head.querySelector(".tc-chg-kwtitle").textContent = title;
            const bodyEl = document.createElement("div");
            bodyEl.className = "tc-chg-kwbody";
            chips.forEach(c => {
                const chip = document.createElement("span");
                chip.className = "tc-chg-chip" + (chipClass ? " " + chipClass : "");
                chip.textContent = c;
                bodyEl.appendChild(chip);
            });
            head.addEventListener("click", () => {
                const open = !bodyEl.hidden;
                bodyEl.hidden = open;
                head.setAttribute("aria-expanded", String(!open));
            });
            card.append(head, bodyEl);
            kwEl.appendChild(card);
        }

        // addKeywordCard already returns early on an empty list, so a card with
        // nothing to show never renders.
        addKeywordCard(ICON.check, "Strong match", matchedKw, "");
        // Everything the optimiser put on the skills line, whether it came from
        // the JD or was surfaced from the candidate's own projects.
        const skillDiffForCard = buildSkillLineDiffs();
        const allAdded = skillsAdded.slice();
        const seenAdd = new Set(allAdded.map(skillKey));
        (skillDiffForCard[0]?._addedSkills || []).forEach(s => {
            const k = skillKey(s);
            if (k && !seenAdd.has(k)) { seenAdd.add(k); allAdded.push(s); }
        });
        addKeywordCard(ICON.check, "Added Skills", allAdded, "", "added");
        // Gaps the optimiser withheld are genuinely absent from the new resume,
        // so they belong in the same Missing Keywords card rather than a second
        // list with a different name saying the same thing.
        const stillMissing = missingKw.concat(
            partitionKeywords(skillGaps, finalText, skillsAdded).missing);
        const seenMiss = new Set();
        const missingFinal = stillMissing.filter(k => {
            const key = skillKey(k);
            if (!key || seenMiss.has(key)) return false;
            seenMiss.add(key);
            return true;
        });
        addKeywordCard(ICON.warn, "Missing Keywords", missingFinal, "miss");

        /* ── G. Nested change cards: Section > Entry > Change #N ── */
        function collapsible(headEl, panelEl, openByDefault) {
            headEl.setAttribute("aria-expanded", openByDefault ? "true" : "false");
            if (!openByDefault) panelEl.hidden = true;
            headEl.addEventListener("click", ev => {
                if (ev.target.closest(".tc-chg-compare-link")) return;
                const open = !panelEl.hidden;
                panelEl.hidden = open;
                headEl.setAttribute("aria-expanded", String(!open));
            });
        }

        // Group entries by their resume section so each gets one Level-1 card.
        const SECTION_LABEL = {
            experience: "Work Experience", projects: "Projects",
            extracurricular: "Leadership & Activities", education: "Education",
        };
        const bySection = new Map();
        entries.forEach((entry, idx) => {
            const key = entry.section || "experience";
            if (!bySection.has(key)) bySection.set(key, []);
            bySection.get(key).push({ entry, idx });
        });

        // The summary is a change like any other - one card, not a dumped paragraph.
        if (summaryChange) {
            bySection.set("summary", [{
                entry: { label: "Professional Summary",
                         bullets: [{ status: summaryChange.status,
                                     before: summaryChange.before,
                                     after:  summaryChange.after }] },
                idx: -1,
            }]);
        }

        // Technical Skills gets its own section card. The additions are real
        // changes to the document and were previously reported nowhere.
        const skillDiff = buildSkillLineDiffs();
        if (skillDiff.length && skillDiff[0]._addedSkills.length) {
            const addedSkills = skillDiff[0]._addedSkills;
            const fromBody = skillsFoundInBody(addedSkills);
            bySection.set("skills", [{
                entry: {
                    label: "Technical Skills",
                    _chips: { added: addedSkills, fromBody: fromBody },
                    bullets: [],
                },
                idx: -1,
            }]);
        }

        let sectionNo = 0;
        bySection.forEach((list, sectionKey) => {
            const sec = document.createElement("div");
            sec.className = "tc-chg-sec";
            const secHead = document.createElement("button");
            secHead.type = "button";
            secHead.className = "tc-chg-sechead";
            secHead.innerHTML = `<span class="tc-chg-sectitle"></span>
                <span class="tc-chg-chevbox"><span class="tc-chg-chev"></span></span>`;
            secHead.querySelector(".tc-chg-sectitle").textContent =
                SECTION_LABEL[sectionKey] || (sectionKey === "summary" ? "Summary" : sectionKey);
            const secBody = document.createElement("div");
            secBody.className = "tc-chg-secbody";

            list.forEach(({ entry, idx }) => {
                const changed = (entry.bullets || []).filter(b => b.status !== "unchanged");
                // A chips-only entry (Technical Skills) has no bullets but is
                // still a real change worth showing.
                if (!changed.length && !entry._chips) return;

                const ent = document.createElement("div");
                ent.className = "tc-chg-entry";
                const entHead = document.createElement("button");
                entHead.type = "button";
                entHead.className = "tc-chg-entryhead";
                entHead.innerHTML = `<span class="tc-chg-entrytitle"></span><span class="tc-chg-chev"></span>`;
                entHead.querySelector(".tc-chg-entrytitle").textContent =
                    entry.label || entry.section || "";
                const entBody = document.createElement("div");
                entBody.className = "tc-chg-entrybody";

                if (entry._chips) {
                    const wrap = document.createElement("div");
                    wrap.className = "tc-chg-item";
                    const inner = document.createElement("div");
                    inner.className = "tc-chg-itembody-inner";
                    inner.style.borderTop = "0";
                    inner.style.paddingTop = "0";

                    const lbl = document.createElement("div");
                    lbl.className = "tc-chg-afterlabel";
                    lbl.textContent = "Added";
                    inner.appendChild(lbl);

                    const chips = document.createElement("div");
                    chips.className = "tc-chg-kwbody";
                    chips.style.padding = "0";
                    entry._chips.added.forEach(sk => {
                        const c = document.createElement("span");
                        c.className = "tc-chg-chip";
                        c.textContent = sk;
                        chips.appendChild(c);
                    });
                    inner.appendChild(chips);

                    // Says where the skill came from, so the addition reads as
                    // surfacing the candidate's own work rather than invention.
                    if (entry._chips.fromBody && entry._chips.fromBody.length) {
                        const note = document.createElement("div");
                        note.className = "tc-chg-provenance";
                        note.textContent = "Found in your Projects / Experience: "
                            + entry._chips.fromBody.join(", ");
                        inner.appendChild(note);
                    }

                    wrap.appendChild(inner);
                    entBody.appendChild(wrap);
                }

                (entry.bullets || []).forEach((b, i) => {
                    if (b.status === "unchanged") return;
                    const item = document.createElement("div");
                    item.className = "tc-chg-item";
                    const itemHead = document.createElement("button");
                    itemHead.type = "button";
                    itemHead.className = "tc-chg-itemhead";
                    itemHead.innerHTML = `<span class="tc-chg-itemnum"></span>` +
                        `<span class="tc-chg-newtag" hidden>New</span>` +
                        `<span class="tc-chg-chev"></span>`;
                    itemHead.querySelector(".tc-chg-itemnum").textContent = "#" + (i + 1);
                    // Content with no "before" is new rather than reworded, and
                    // saying so stops the reader hunting for what it replaced.
                    if (b.status !== "reworded" || !b.before) {
                        itemHead.querySelector(".tc-chg-newtag").hidden = false;
                    }

                    const itemBody = document.createElement("div");
                    itemBody.className = "tc-chg-itembody";
                    const inner = document.createElement("div");
                    inner.className = "tc-chg-itembody-inner";

                    const lbl = document.createElement("div");
                    lbl.className = "tc-chg-afterlabel";
                    lbl.textContent = "After";
                    const txt = document.createElement("div");
                    txt.className = "tc-chg-aftertext";
                    txt.textContent = b.after || "";
                    inner.append(lbl, txt);

                    if (b.status === "reworded" && b.before) {
                        const link = document.createElement("button");
                        link.type = "button";
                        link.className = "tc-chg-compare-link";
                        link.textContent = "Compare Before and After";
                        const ba = document.createElement("div");
                        ba.className = "tc-chg-ba";
                        ba.hidden = true;
                        const bl = document.createElement("div");
                        bl.className = "tc-chg-ba-label";
                        bl.textContent = "Before";
                        const bt = document.createElement("div");
                        bt.className = "tc-chg-ba-before";
                        bt.textContent = b.before;
                        const al = document.createElement("div");
                        al.className = "tc-chg-ba-label";
                        al.textContent = "After";
                        const at = document.createElement("div");
                        at.className = "tc-chg-ba-after";
                        at.textContent = b.after;
                        ba.append(bl, bt, al, at);
                        link.addEventListener("click", ev => {
                            ev.stopPropagation();
                            const open = !ba.hidden;
                            ba.hidden = open;
                            link.textContent = open ? "Compare Before and After" : "Hide comparison";
                        });
                        inner.append(link, ba);
                    }

                    itemBody.appendChild(inner);
                    collapsible(itemHead, itemBody, true);
                    item.append(itemHead, itemBody);

                    // Clicking a change scrolls the preview to the bullet it describes.
                    if (idx >= 0) {
                        itemHead.addEventListener("click", () => {
                            const el = markIndex.get(idx + ":" + i);
                            if (!el) return;
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                            el.classList.add("tcv-mark-focus");
                            setTimeout(() => el.classList.remove("tcv-mark-focus"), 1600);
                        });
                    }
                    entBody.appendChild(item);
                });

                collapsible(entHead, entBody, true);
                ent.append(entHead, entBody);
                secBody.appendChild(ent);
            });

            if (!secBody.children.length) return;
            collapsible(secHead, secBody, sectionNo === 0);
            sectionNo++;
            sec.append(secHead, secBody);
            body.appendChild(sec);
        });

        if (!scoresEl.children.length && !kwEl.children.length && !body.children.length) {
            const empty = document.createElement("div");
            empty.className = "tc-chg-empty";
            empty.textContent = "No meaningful changes were detected — your resume came through largely as written.";
            body.appendChild(empty);
        }

        /* ── Right pane ── */
        const previewEl = overlay.querySelector(".tc-chg-preview");
        const pageEl    = overlay.querySelector(".tc-chg-page");
        // Assigned below, read inside buildMirror's load handler. Declared here
        // so the handler can never hit it in the temporal dead zone.
        let previewExtras = { summary: null, skillLines: [] };

        const MARK_CSS =
            ".tcv-edit-controls,.tcv-add-btn,.tcv-del-btn,[data-tcv-control]{display:none!important}" +
            "body{cursor:default!important}" +
            "del.tcv-mark-del{background:#FDE2E2;color:#D93025;text-decoration:line-through;" +
            "padding:0 2px;border-radius:2px;}" +
            "ins.tcv-mark-add{background:#B7F5B0;color:inherit;text-decoration:none;" +
            "padding:0 2px;border-radius:2px;}" +
            // inline, never inline-block: a block box would break the line flow
            // and reintroduce the stretched gaps between highlighted words.
            "del.tcv-mark-del,ins.tcv-mark-add{display:inline;white-space:normal;" +
            "letter-spacing:normal;word-spacing:normal;}" +
            ".tcv-mark-focus{outline:2px solid #2563eb;outline-offset:2px;border-radius:3px;}";

        function buildMirror(target, html, marked) {
            const f = document.createElement("iframe");
            f.className = "tc-chg-mirror";
            f.setAttribute("title", "Resume preview");
            f.srcdoc = html;
            f.addEventListener("load", () => {
                try {
                    const d = f.contentDocument;
                    if (!d) return;
                    d.querySelectorAll("[contenteditable]").forEach(el => el.removeAttribute("contenteditable"));
                    const s = d.createElement("style");
                    s.textContent = MARK_CSS;
                    d.head && d.head.appendChild(s);
                    if (marked) markIndex = markChangesInPreview(d, entries, previewExtras);
                    // Grow the frame to the document's real height so a
                    // multi-page resume is scrolled, never cut off. Measured
                    // after marking, which can reflow the text.
                    const fit = () => {
                        const h = Math.max(
                            d.body ? d.body.scrollHeight : 0,
                            d.documentElement ? d.documentElement.scrollHeight : 0);
                        if (h > 0) f.style.height = h + "px";
                    };
                    fit();
                    setTimeout(fit, 120);
                } catch (e) {}
            });
            target.appendChild(f);
            return f;
        }

        /* Skills lines change on nearly every run - the optimiser adds JD
           skills the resume evidences - and they were the one visible part of
           the document with no highlighting at all. There is no server-side
           diff for them, so reconstruct one: the skills the resume ENDED with,
           minus the ones the optimiser reports adding, is what it started with. */
        function buildSkillLineDiffs() {
            const rd = (payload && payload.resume_data) || {};
            const finalSkills = Array.isArray(rd.skills) ? rd.skills.filter(Boolean) : [];
            if (!finalSkills.length) return [];

            // What the candidate listed before. Prefer the server's parse of
            // their own skills section; fall back to "final minus added" when
            // it is unavailable.
            let beforeList = Array.isArray(changes.original_skills)
                ? changes.original_skills.filter(Boolean) : [];
            if (!beforeList.length) {
                const addedKeys = new Set(skillsAdded.map(skillKey));
                beforeList = finalSkills.filter(s => !addedKeys.has(skillKey(s)));
            }

            const beforeKeys = new Set(beforeList.map(skillKey));
            // Item-by-item, not word-by-word: a word diff over a comma list
            // splits "Node.js" from its own punctuation and marks commas.
            // Normalised keys mean PostgreSQL/Postgres is not a change.
            const added = finalSkills.filter(s => !beforeKeys.has(skillKey(s)));
            if (!added.length) return [];

            return [{
                status: "reworded",
                before: beforeList.join(", "),
                after:  finalSkills.join(", "),
                _addedSkills: added,
            }];
        }

        /* Skills the optimiser lifted out of the candidate's own Projects and
           Experience - present in the document already, just never listed. */
        function skillsFoundInBody(added) {
            const rd = (payload && payload.resume_data) || {};
            const body = []
                .concat((rd.experience || []).flatMap(e => e.bullets || []))
                .concat((rd.projects   || []).flatMap(e => e.bullets || []))
                .join(" ")
                .toLowerCase();
            const blob = body.replace(/[^a-z0-9+#]/g, "");
            return (added || []).filter(s => {
                const k = skillKey(s);
                return k.length >= 3 && blob.includes(k);
            });
        }

        previewExtras = {
            summary: summaryChange,
            skillLines: buildSkillLineDiffs(),
            originalIndex: origIdx,
        };

        if (currentHtml) buildMirror(pageEl, currentHtml, true);


        // Belt and braces for the support widget: the CSS above catches the
        // vendors we can name, this catches anything else pinned to the bottom
        // right, which is where every one of them sits.
        document.body.classList.add("tc-chg-open");
        const hidden = [];
        try {
            const vh = window.innerHeight, vw = window.innerWidth;
            document.querySelectorAll("body > *").forEach(node => {
                if (node === overlay || node.nodeType !== 1) return;
                const cs = getComputedStyle(node);
                if (cs.position !== "fixed" || cs.display === "none") return;
                const r = node.getBoundingClientRect();
                if (!r.width || !r.height) return;
                if (r.bottom > vh - 160 && r.right > vw - 160 && r.width < 420) {
                    hidden.push([node, node.style.display]);
                    node.style.display = "none";
                }
            });
        } catch (e) {}

        function close() {
            overlay.remove();
            document.body.classList.remove("tc-chg-open");
            hidden.forEach(([node, prev]) => { node.style.display = prev; });
            document.removeEventListener("keydown", onEsc);
        }
        function onEsc(e) { if (e.key === "Escape") close(); }

        overlay.querySelector(".tc-chg-close").addEventListener("click", close);
        overlay.querySelector(".tc-chg-backdrop").addEventListener("click", close);
        overlay.querySelector(".tc-chg-apply").addEventListener("click", close);
        document.addEventListener("keydown", onEsc);

        document.body.appendChild(overlay);
    }

    function init() {
        const payload = getPayload();
        if (!payload || !payload.html) {
            setStatus("No resume found. Please build or optimise one first.");
            return;
        }

        templateId               = Number(payload.template_id || 1);
        baseFontsCaptured        = false;
        baseLineSpacingsCaptured = false;
        currentLineSpacing       = 1;
        currentAccentColor       = null;
        currentHtml              = addEditingOverlay(payload.html);

        injectHostPageStyles();
        bindStyleSettings();

        frame.srcdoc = currentHtml;
        frame.addEventListener("load", function onLoad() {
            applyWordStylePreview();
            captureBaseLineSpacing(frame.contentDocument);
            updateFontSizeBadge();
            updatePageBadge();
            setStatus("Tip: Click inside the resume to edit text live.");

            buildAccentPanel();
            applyFreeUserProtection(frame.contentDocument);
            applyQuotaExhaustedLock(frame.contentDocument);

            if (payload.source === "modify-cv") {
                setStatus("Tip: adjust size, spacing, and colour, then download your resume.");
            }

            // Ask about missing skills once the resume is on screen, so the
            // person can see what they are adding it to.
            if (!hasShownSkillGapPrompt) {
                hasShownSkillGapPrompt = true;
                setTimeout(() => showSkillGapPrompt(getPayload() || payload), 600);
            }

            if (AUTO_DOWNLOAD_ON_OPEN && !hasAutoDownloaded) {
                hasAutoDownloaded = true;
                setTimeout(() => {
                    downloadEditedPdf(true).catch(() => {});
                    setStatus("Tip: Click inside the resume preview to edit text live.");
                }, 350);
            }
        });

        window.addEventListener("resize", () => {
            // On mobile the soft keyboard firing resize must not disturb an active edit session.
            if (frame && frame.contentDocument && frame.contentDocument.hasFocus()) return;
            applyWordStylePreview();
        }, { passive: true });

        fontDecreaseBtn?.addEventListener("click", () => changeFontScale(-0.05));
        fontIncreaseBtn?.addEventListener("click", () => changeFontScale(+0.05));
        fontResetBtn?.addEventListener("click",    () => resetFontScale());

        document.getElementById("spacing-decrease-btn")?.addEventListener("click", () => changeLineSpacing(-0.05));
        document.getElementById("spacing-increase-btn")?.addEventListener("click", () => changeLineSpacing(+0.05));
        document.getElementById("spacing-reset-btn")?.addEventListener("click", resetLineSpacing);

        if (downloadBtn && !downloadBtn.dataset.tcvBound) {
            downloadBtn.dataset.tcvBound = "1";
            downloadBtn.addEventListener("click", () => downloadEditedPdf(false));
        }
        saveBtn?.addEventListener("click", () => saveToMyResumes());

        document.getElementById("switch-template-btn")?.addEventListener("click", () => {
            buildTemplateSwitcher();
        });

        // Desktop: card under the page title. Phones: copy in the fixed bottom bar.
        for (const id of ["see-changes-btn", "see-changes-btn-mobile"]) {
            const btn = document.getElementById(id);
            if (!btn || btn.dataset.tcvBound) continue;
            btn.dataset.tcvBound = "1";
            btn.addEventListener("click", () => {
                showChangesModal(getPayload() || payload);
            });
        }

        const pulseTarget = fitGuidance || statusEl;
        pulseTarget?.addEventListener("animationend", e => {
            if (e?.animationName === "pulse-success")
                pulseTarget.classList.remove("pulse-success");
        });
    }

    /* Published BEFORE init() on purpose.

       These used to sit at the very bottom of this file. init() runs first,
       and anything it throws stops the rest of the module from evaluating -
       so the hooks were never assigned and every "See what changed" click in
       the new editor fell through to a "not ready" message that reloading
       could not fix. Both functions are declarations, so they are hoisted and
       safe to reference here. */
    window.tcvDownloadEditedPdf = () => {
        // currentHtml is populated by init(). If that failed, fall back to the
        // stored payload so Download still produces the right document rather
        // than an empty file.
        if (!currentHtml) {
            const p = getPayload();
            if (p && p.html) currentHtml = addEditingOverlay(p.html);
        }
        return downloadEditedPdf(false);
    };
    window.tcvShowChangesModal  = (p) => {
        try {
            const data = p || getPayload();
            if (!data) {
                console.warn("[TailorCV] No editor payload - cannot open changes.");
                return false;
            }
            const existing = document.getElementById("tc-chg-overlay");
            if (existing) existing.remove();   // never refuse a second open
            showChangesModal(data);
            const ok = !!document.getElementById("tc-chg-overlay");
            if (!ok) {
                console.warn("[TailorCV] Changes modal built nothing.",
                             { hasChanges: !!(data.resume_data || {}).changes });
            }
            return ok;
        } catch (err) {
            console.error("[TailorCV] Changes modal failed:", err);
            return false;
        }
    };

    /* The two actions the new editor delegates to, bound OUTSIDE init().

       init() wires these near its end, after the preview setup - so anything
       that throws earlier in it leaves the buttons inert, and the new shell's
       click-through does nothing. Binding here first means the actions work
       even when the legacy preview fails to start. Both listeners are
       idempotent in effect: a second binding from init() just re-runs the
       same call. */
    try {
        for (const id of ["see-changes-btn", "see-changes-btn-mobile"]) {
            const b = document.getElementById(id);
            if (b && !b.dataset.tcvBound) {
                b.dataset.tcvBound = "1";
                b.addEventListener("click", () => {
                    try { showChangesModal(getPayload()); }
                    catch (err) { console.error("[TailorCV] Changes modal failed:", err); }
                });
            }
        }
        const dlb = document.getElementById("download-edited-btn");
        if (dlb && !dlb.dataset.tcvBound) {
            dlb.dataset.tcvBound = "1";
            dlb.addEventListener("click", () => {
                if (!currentHtml) {
                    const p = getPayload();
                    if (p && p.html) currentHtml = addEditingOverlay(p.html);
                }
                downloadEditedPdf(false);
            });
        }
    } catch (err) {
        console.error("[TailorCV] Early action binding failed:", err);
    }

    /* Isolated so a failure in the old preview wiring cannot take the rest of
       the module - and therefore every top-bar action - down with it. The new
       editor owns the screen now; this init only sets up the legacy preview
       and the state the hooks above depend on. */
    try {
        init();
    } catch (err) {
        console.error("[TailorCV] Legacy editor init failed:", err);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       PERSONALITY CARD — Corner popup + full modal
    ───────────────────────────────────────────────────────────────────────── */

    let _personalityPopupShown = false;

    function showPersonalityCornerPopup() {
        if (_personalityPopupShown) return;
        _personalityPopupShown = true;

        if (!document.getElementById("pc-popup-style")) {
            const s = document.createElement("style");
            s.id = "pc-popup-style";
            s.textContent = `
                #pc-corner-popup{
                    position:fixed;bottom:24px;right:24px;z-index:110000;
                    width:min(92vw,320px);
                    background:linear-gradient(145deg,#12003a,#1a0040);
                    border:1px solid rgba(167,139,250,.45);border-radius:18px;
                    padding:18px 20px;
                    box-shadow:0 16px 48px rgba(0,0,0,.6),0 0 40px rgba(139,92,246,.2);
                    font-family:Inter,system-ui,sans-serif;
                    animation:pcSlideUp .4s cubic-bezier(.34,1.56,.64,1);
                }
                @keyframes pcSlideUp{from{opacity:0;transform:translateY(24px) scale(.95)}to{opacity:1;transform:none}}
                #pc-corner-popup .pcp-shimmer{
                    position:absolute;top:0;left:0;right:0;height:2px;border-radius:18px 18px 0 0;
                    background:linear-gradient(90deg,#f59e0b,#8b5cf6,#ec4899,#3b82f6);
                    background-size:300%;animation:pcpShimmer 3s linear infinite;
                }
                @keyframes pcpShimmer{0%{background-position:0%}100%{background-position:300%}}
                #pc-corner-popup .pcp-close{
                    position:absolute;top:10px;right:14px;background:none;border:none;
                    color:rgba(255,255,255,.3);font-size:20px;cursor:pointer;line-height:1;padding:0;
                }
                #pc-corner-popup .pcp-close:hover{color:rgba(255,255,255,.7);}
                #pc-corner-popup .pcp-icon{font-size:1.5rem;margin-bottom:7px;display:block;}
                #pc-corner-popup .pcp-title{font-size:.95rem;font-weight:800;color:#eaf1ff;margin:0 0 5px;}
                #pc-corner-popup .pcp-sub{font-size:.77rem;color:#9fb0cc;margin:0 0 13px;line-height:1.5;}
                #pc-corner-popup .pcp-btn{
                    display:flex;align-items:center;justify-content:center;gap:6px;
                    background:linear-gradient(135deg,#7c3aed,#4c1d95);color:#fff;
                    border:none;border-radius:10px;padding:10px 18px;
                    font-size:.85rem;font-weight:700;cursor:pointer;width:100%;
                    transition:filter .15s;
                }
                #pc-corner-popup .pcp-btn:hover{filter:brightness(1.12);}
            `;
            document.head.appendChild(s);
        }

        const popup = document.createElement("div");
        popup.id = "pc-corner-popup";
        popup.innerHTML = `
            <div class="pcp-shimmer"></div>
            <button class="pcp-close" aria-label="Dismiss">&times;</button>
            <span class="pcp-icon">&#10024;</span>
            <div class="pcp-title">Your Career Personality is ready</div>
            <div class="pcp-sub">Discover your archetype and share it on LinkedIn</div>
            <button class="pcp-btn" id="pcp-discover-btn">Discover &amp; Share &#8594;</button>
        `;
        document.body.appendChild(popup);

        const autoDismiss = setTimeout(() => popup.remove(), 9000);

        popup.querySelector(".pcp-close").addEventListener("click", () => {
            clearTimeout(autoDismiss); popup.remove();
        });
        popup.querySelector("#pcp-discover-btn").addEventListener("click", () => {
            clearTimeout(autoDismiss); popup.remove();
            _openPersonalityCardFlow();
        });
    }

    function _openPersonalityCardFlow() {
        let resumeId = null;
        try { resumeId = sessionStorage.getItem("tailorcv_current_resume_id"); } catch (e) {}
        if (!resumeId) { _showPersonalitySaveFirst(); return; }
        _fetchAndShowPersonalityCard(parseInt(resumeId, 10));
    }

    function _showPersonalitySaveFirst() {
        if (!document.getElementById("pc-modal-style")) _injectPersonalityModalStyle();
        const overlay = document.createElement("div");
        overlay.id = "pc-modal-overlay";
        overlay.className = "pc-overlay";
        overlay.innerHTML = `
            <div class="pc-modal-box" role="dialog" aria-modal="true">
                <button class="pc-modal-close" onclick="document.getElementById('pc-modal-overlay').remove()">&times;</button>
                <div style="text-align:center;padding:20px 0;">
                    <div style="font-size:2.4rem;margin-bottom:14px;">&#10024;</div>
                    <div style="font-size:1.15rem;font-weight:800;color:#eaf1ff;margin-bottom:10px;">Save your resume first</div>
                    <div style="font-size:.88rem;color:#9fb0cc;line-height:1.6;margin-bottom:24px;">
                        Your Career Personality card is generated from your saved resume.<br>
                        Click Download again and save to your account to unlock it.
                    </div>
                    <button onclick="document.getElementById('pc-modal-overlay').remove()"
                        style="background:linear-gradient(135deg,#7c3aed,#4c1d95);color:#fff;border:none;
                        border-radius:10px;padding:12px 26px;font-size:.95rem;font-weight:700;cursor:pointer;">
                        Got it
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
        document.addEventListener("keydown", function pcEsc(e) {
            if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", pcEsc); }
        });
    }

    function _injectPersonalityModalStyle() {
        const s = document.createElement("style");
        s.id = "pc-modal-style";
        s.textContent = `
            .pc-overlay{
                position:fixed;inset:0;z-index:120000;display:flex;align-items:center;justify-content:center;
                background:rgba(6,11,26,.78);backdrop-filter:blur(6px);padding:16px;
                font-family:Inter,system-ui,sans-serif;animation:pcFadeIn .2s ease;
            }
            @keyframes pcFadeIn{from{opacity:0}to{opacity:1}}
            .pc-modal-box{
                position:relative;background:linear-gradient(145deg,#12003a,#0d1a3e);
                border:1px solid rgba(167,139,250,.35);border-radius:24px;padding:32px 28px;
                width:100%;max-width:520px;box-shadow:0 30px 80px rgba(0,0,0,.7);
                max-height:92vh;overflow-y:auto;
                animation:pcModalPop .3s cubic-bezier(.34,1.56,.64,1);
            }
            @keyframes pcModalPop{from{opacity:0;transform:translateY(16px) scale(.95)}to{opacity:1;transform:none}}
            .pc-modal-close{
                position:absolute;top:16px;right:20px;background:none;border:none;
                color:rgba(255,255,255,.3);font-size:26px;cursor:pointer;line-height:1;padding:0;
            }
            .pc-modal-close:hover{color:rgba(255,255,255,.7);}
            .pc-card-inner{
                background:linear-gradient(145deg,#16003a 0%,#1e0045 40%,#0d1a3e 100%);
                border:1px solid rgba(167,139,250,.35);border-radius:20px;
                margin:0 auto 20px;position:relative;overflow:hidden;
                aspect-ratio:9/16;width:100%;max-width:340px;
                box-shadow:0 12px 40px rgba(139,92,246,.2),0 24px 48px rgba(0,0,0,.6);
            }
            .pc-card-content{
                position:absolute;top:0;left:0;right:0;bottom:0;
                padding:20px 18px 16px;display:flex;flex-direction:column;gap:0;
                justify-content:space-between;
                transform-origin:top left;z-index:1;box-sizing:border-box;
            }
            .pc-card-shimmer-inner{
                position:absolute;top:0;left:0;right:0;height:3px;
                background:linear-gradient(90deg,#f59e0b,#8b5cf6,#ec4899,#3b82f6,#10b981);
                background-size:300%;animation:pcpShimmer 3s linear infinite;
            }
            .pc-brand-row{display:flex;align-items:center;justify-content:space-between;}
            .pc-brand{font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:rgba(167,139,250,.55);}
            .pc-brand-right{display:flex;flex-direction:column;align-items:flex-end;gap:1px;}
            .pc-cand{font-size:9px;color:rgba(255,255,255,.4);text-align:right;}
            .pc-brand-date{font-size:8px;color:rgba(255,255,255,.28);text-align:right;}
            .pc-rarity-row{
                display:flex;align-items:center;justify-content:space-between;gap:6px;
                background:linear-gradient(135deg,rgba(251,191,36,.16),rgba(251,191,36,.05));
                border:1px solid rgba(251,191,36,.42);border-radius:8px;padding:5px 9px;
            }
            .pc-rarity-badge{font-size:8px;font-weight:800;letter-spacing:.07em;color:#fbbf24;text-transform:uppercase;display:flex;align-items:center;gap:4px;}
            .pc-rarity-tier{font-size:7px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:rgba(251,191,36,.18);border:1px solid rgba(251,191,36,.38);border-radius:4px;padding:2px 6px;color:#fbbf24;}
            .pc-arch{
                font-size:38px;font-weight:900;
                background:linear-gradient(135deg,#fbbf24,#f472b6,#818cf8);
                -webkit-background-clip:text;-webkit-text-fill-color:transparent;
                background-clip:text;line-height:1.08;letter-spacing:-.02em;
            }
            .pc-tagline{font-size:9px;font-style:italic;color:rgba(226,232,240,.6);line-height:1.45;border-left:2px solid rgba(251,191,36,.4);padding-left:7px;margin-top:4px;}
            .pc-score-row{display:flex;align-items:center;gap:7px;}
            .pc-score-label{font-size:7px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.32);flex-shrink:0;}
            .pc-score-bar-wrap{flex:1;height:5px;background:rgba(255,255,255,.07);border-radius:99px;overflow:hidden;}
            .pc-score-bar-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#fbbf24,#f472b6);}
            .pc-score-num{font-size:14px;font-weight:900;color:#fbbf24;flex-shrink:0;min-width:24px;text-align:right;}
            .pc-stats{
                display:flex;justify-content:center;
                background:rgba(255,255,255,.04);
                border:1px solid rgba(255,255,255,.08);
                border-radius:10px;padding:8px 0;
            }
            .pc-stat{flex:1;text-align:center;}
            .pc-stat+.pc-stat{border-left:1px solid rgba(255,255,255,.08);}
            .pc-stat-val{font-size:18px;font-weight:800;color:#fbbf24;display:block;}
            .pc-stat-val-sm{font-size:11px;font-weight:800;color:#fbbf24;display:block;}
            .pc-stat-label{font-size:7px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.1em;}
            .pc-skills{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;}
            .pc-skill{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);border-radius:20px;padding:3px 10px;font-size:9px;color:#93c5fd;font-weight:600;}
            .pc-superpower-card{background:rgba(15,23,42,.5);border:1px solid rgba(167,139,250,.32);border-radius:10px;padding:9px 11px;}
            .pc-superpower-kicker{font-size:6.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fbbf24;margin-bottom:4px;display:block;}
            .pc-superpower-head{font-size:11px;font-weight:800;color:#eaf1ff;display:flex;align-items:center;gap:5px;margin-bottom:3px;}
            .pc-superpower-desc{font-size:9px;line-height:1.45;color:rgba(226,232,240,.72);}
            .pc-story{
                font-size:10.5px;color:rgba(244,247,255,.82);line-height:1.55;
                padding:9px 11px;background:rgba(139,92,246,.10);
                border-left:3px solid rgba(167,139,250,.6);border-radius:0 6px 6px 0;
            }
            .pc-traits{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;}
            .pc-trait-card{
                background:rgba(15,23,42,.45);border:1px solid rgba(139,92,246,.2);
                border-radius:10px;padding:9px 10px 8px;display:flex;flex-direction:column;
            }
            .pc-trait-head{
                display:flex;align-items:center;gap:4px;margin-bottom:4px;
                color:#ddd6fe;font-size:10px;font-weight:700;line-height:1.2;
            }
            .pc-trait-desc{font-size:9px;line-height:1.45;color:rgba(226,232,240,.72);}
            .pc-compat-row{font-size:8px;color:rgba(226,232,240,.5);line-height:1.6;display:flex;flex-direction:column;gap:1px;}
            .pc-compat-row em{color:rgba(226,232,240,.8);font-style:normal;font-weight:600;}
            .pc-footer-brand{font-size:7.5px;color:rgba(255,255,255,.18);text-align:center;}
            .pc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
            .pc-action-btn{
                flex:1;display:flex;align-items:center;justify-content:center;gap:7px;
                padding:11px 14px;border-radius:10px;border:none;
                font-size:.85rem;font-weight:700;cursor:pointer;
                transition:transform .15s,filter .15s;text-decoration:none;
                font-family:inherit;
            }
            .pc-action-btn:hover{transform:translateY(-2px);filter:brightness(1.1);}
            .pc-btn-li{background:linear-gradient(135deg,#0077b5,#005582);color:#fff;}
            .pc-btn-wa{background:linear-gradient(135deg,#25D366,#128C7E);color:#fff;}
            .pc-btn-dl{background:rgba(255,255,255,.07);color:#eaf1ff;border:1px solid rgba(255,255,255,.15)!important;}
            .pc-btn-stories{background:linear-gradient(135deg,#e1306c,#c13584,#833ab4);color:#fff;}
            .pc-btn-copy{background:rgba(139,92,246,.2);color:#c4b5fd;border:1px solid rgba(139,92,246,.4)!important;}
            .pc-btn-view{background:rgba(59,130,246,.12);color:#93c5fd;border:1px solid rgba(59,130,246,.35)!important;}
            .pc-spinner{
                width:36px;height:36px;border:3px solid rgba(139,92,246,.2);
                border-top-color:#8b5cf6;border-radius:50%;
                animation:pcSpin .7s linear infinite;margin:0 auto 14px;
            }
            @keyframes pcSpin{to{transform:rotate(360deg)}}
        `;
        document.head.appendChild(s);
    }

    async function _fetchAndShowPersonalityCard(resumeId) {
        if (!document.getElementById("pc-modal-style")) _injectPersonalityModalStyle();

        const overlay = document.createElement("div");
        overlay.id = "pc-modal-overlay";
        overlay.className = "pc-overlay";
        overlay.innerHTML = `
            <div class="pc-modal-box" role="dialog" aria-modal="true">
                <button class="pc-modal-close" onclick="document.getElementById('pc-modal-overlay').remove()">&times;</button>
                <div id="pc-modal-body">
                    <div style="text-align:center;padding:30px 0;">
                        <div class="pc-spinner"></div>
                        <p style="color:#c4b5fd;font-size:.9rem;">Discovering your career archetype…</p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
        document.addEventListener("keydown", function pcEsc(e) {
            if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", pcEsc); }
        });

        try {
            const csrfToken = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "";
            const res  = await fetch("/api/generate-personality-card", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken,
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: JSON.stringify({ resume_id: resumeId }),
            });
            const data = await res.json();
            if (!data.success) {
                const bodyEl = document.getElementById("pc-modal-body");
                if (bodyEl) bodyEl.innerHTML = `
                    <div style="text-align:center;padding:24px 0;">
                        <div style="font-size:2rem;margin-bottom:12px;">&#9888;&#65039;</div>
                        <p style="color:#fca5a5;font-size:.9rem;">${_escHtml(data.error || "Generation failed. Please try again.")}</p>
                    </div>`;
                return;
            }
            _renderPersonalityCardModal(data.card);
        } catch (_err) {
            const bodyEl = document.getElementById("pc-modal-body");
            if (bodyEl) bodyEl.innerHTML = `<div style="text-align:center;padding:24px;color:#fca5a5;">Network error. Please try again.</div>`;
        }
    }

    function fitPcCardContent() {
        const card  = document.getElementById("pc-capturable-card");
        const inner = document.getElementById("pc-card-content");
        if (!card || !inner) return;
        // Reset to measure natural (tightly packed) content height
        inner.style.transform = "none";
        inner.style.width     = "100%";
        inner.style.height    = "auto";
        const cardH    = card.clientHeight || card.offsetHeight;
        const contentH = inner.scrollHeight;
        if (contentH > cardH) {
            // Content overflows — scale down to fit
            const scale = cardH / contentH;
            inner.style.width  = (100 / scale) + "%";
            inner.style.height = (100 / scale) + "%";
            inner.style.transform = `scale(${scale})`;
        } else {
            // Content fits — stretch to fill full card height via space-between
            inner.style.height = "100%";
        }
    }

    function _renderPersonalityCardModal(card) {
        const bodyEl = document.getElementById("pc-modal-body");
        if (!bodyEl) return;

        const allTraits = card.traits || [];
        const superpower = allTraits[0] || null;
        const restTraits = allTraits.slice(1);

        const traitsHtml = restTraits.map(t =>
            `<div class="pc-trait-card">
                <div class="pc-trait-head"><span>${_escHtml(t.emoji)}</span><span>${_escHtml(t.label)}</span></div>
                <div class="pc-trait-desc">${_escHtml(t.description)}</div>
            </div>`
        ).join("");

        const s = card.stats || {};
        const yrs = s.years_experience || 0;
        const cos = s.companies_count  || 0;
        const statsHtml = [
            yrs > 0
                ? { v: yrs + "+", l: "Years",     cls: "pc-stat-val" }
                : { v: "Rising",  l: "Early Career", cls: "pc-stat-val-sm" },
            cos > 0
                ? { v: cos,       l: "Companies", cls: "pc-stat-val" }
                : { v: "Building", l: "Legacy",   cls: "pc-stat-val-sm" },
            { v: s.total_projects || 0, l: "Projects", cls: "pc-stat-val" },
        ].map(item =>
            `<div class="pc-stat"><span class="${item.cls}">${item.v}</span><span class="pc-stat-label">${item.l}</span></div>`
        ).join("");

        const skills = (s.top_3_skills || []).map(sk =>
            `<span class="pc-skill">${_escHtml(sk)}</span>`
        ).join("");

        const rarityPct  = card.rarity_pct  || 8;
        const tier       = card.tier         || "Rare";
        const careerScore= card.career_score || 82;
        const compat     = card.compatible_archetype || "The Analytical Sage";

        const nowMonths = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
        const d = new Date();
        const dateStamp = nowMonths[d.getMonth()] + " '" + String(d.getFullYear()).slice(-2);

        const shareText =
            `Just found out I'm in the top ${rarityPct}% of professionals with this career archetype 👀\n\n` +
            `${card.archetype} — only 1 in ${Math.round(100 / rarityPct)} people get this.\n\n` +
            `What archetype are YOU? 👇\n${card.share_url}\n\n#CareerDNA #CareerPersonality #TailorCV`;

        bodyEl.innerHTML = `
            <div class="pc-card-inner" id="pc-capturable-card">
                <div class="pc-card-shimmer-inner"></div>
                <div class="pc-card-content" id="pc-card-content">
                    <div class="pc-brand-row">
                        <div class="pc-brand">TailorCV &middot; Career DNA</div>
                        <div class="pc-brand-right">
                            ${card.candidate_name ? `<div class="pc-cand">${_escHtml(card.candidate_name)}</div>` : ""}
                            <div class="pc-brand-date">${dateStamp}</div>
                        </div>
                    </div>
                    <div class="pc-rarity-row">
                        <div class="pc-rarity-badge">&#11041; TOP ${rarityPct}% &nbsp;&middot;&nbsp; 1 in ${Math.round(100 / rarityPct)}</div>
                        <span class="pc-rarity-tier">${_escHtml(tier)}</span>
                    </div>
                    <div>
                        <div class="pc-arch" id="pc-arch-text">${_escHtml(card.archetype)}</div>
                        ${card.tagline ? `<div class="pc-tagline">"${_escHtml(card.tagline)}"</div>` : ""}
                    </div>
                    <div class="pc-score-row">
                        <span class="pc-score-label">Career Score</span>
                        <div class="pc-score-bar-wrap"><div class="pc-score-bar-fill" style="width:${careerScore}%"></div></div>
                        <span class="pc-score-num">${careerScore}</span>
                    </div>
                    <div class="pc-stats">${statsHtml}</div>
                    ${skills ? `<div class="pc-skills">${skills}</div>` : ""}
                    ${superpower ? `
                    <div class="pc-superpower-card">
                        <span class="pc-superpower-kicker">#1 Superpower</span>
                        <div class="pc-superpower-head"><span>${_escHtml(superpower.emoji)}</span><span>${_escHtml(superpower.label)}</span></div>
                        <div class="pc-superpower-desc">${_escHtml(superpower.description)}</div>
                    </div>` : ""}
                    ${card.story ? `<div class="pc-story">${_escHtml(card.story)}</div>` : ""}
                    ${traitsHtml ? `<div class="pc-traits">${traitsHtml}</div>` : ""}
                    <div class="pc-compat-row">
                        <span>&#10022; Pairs with: <em>${_escHtml(compat)}</em></span>
                        <span>&#10022; Tag a colleague &mdash; what&rsquo;s their archetype?</span>
                    </div>
                    <div class="pc-footer-brand">thetailorcv.com</div>
                </div>
            </div>
            <div class="pc-actions">
                <button class="pc-action-btn pc-btn-li" id="pc-li-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6.94 8.5H3.56V20h3.38V8.5zM5.25 3A1.97 1.97 0 1 0 5.3 6.94 1.97 1.97 0 0 0 5.25 3zM20.44 13.2c0-3.1-1.66-4.7-3.88-4.7-1.79 0-2.59.98-3.03 1.67V8.5h-3.38V20h3.38v-6.06c0-1.6.3-3.14 2.28-3.14 1.95 0 1.98 1.82 1.98 3.24V20H21v-6.8z"/></svg>
                    LinkedIn
                </button>
                <button class="pc-action-btn pc-btn-wa" id="pc-wa-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                </button>
            </div>
            <div class="pc-actions" style="margin-top:0;">
                <button class="pc-action-btn pc-btn-stories" id="pc-stories-btn">&#10024; Stories</button>
                <button class="pc-action-btn pc-btn-dl" id="pc-dl-btn">&#8595; Save PNG</button>
                <button class="pc-action-btn pc-btn-copy" id="pc-copy-btn">&#128279; Copy</button>
                <a class="pc-action-btn pc-btn-view" href="${_escHtml(card.share_url)}" target="_blank" rel="noopener">&#8599; View</a>
            </div>
        `;

        requestAnimationFrame(() => fitPcCardContent());
        setTimeout(fitPcCardContent, 150);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => requestAnimationFrame(fitPcCardContent));
        }

        document.getElementById("pc-li-btn").onclick = () => {
            window.open("https://www.linkedin.com/feed/", "_blank", "noopener,noreferrer");
            navigator.clipboard?.writeText(shareText).catch(() => {});
        };

        document.getElementById("pc-wa-btn").onclick = () => {
            window.open("https://wa.me/?text=" + encodeURIComponent(shareText), "_blank", "noopener,noreferrer");
        };

        function _captureCard(outW, outH, onDone) {
            const cardEl  = document.getElementById("pc-capturable-card");
            const archEl  = document.getElementById("pc-arch-text");
            const innerEl = document.getElementById("pc-card-content");
            const shimmer = cardEl ? cardEl.querySelector(".pc-card-shimmer-inner") : null;
            if (!cardEl || !archEl) { onDone(new Error("missing elements"), null); return; }

            const origArch           = archEl.style.cssText;
            const origInnerTransform = innerEl ? innerEl.style.transform : "";
            const origInnerWidth     = innerEl ? innerEl.style.width     : "";
            const origInnerHeight    = innerEl ? innerEl.style.height    : "";
            const origCardWidth      = cardEl.style.width;
            const origCardHeight     = cardEl.style.height;
            const origCardMaxWidth   = cardEl.style.maxWidth;
            const origCardAspect     = cardEl.style.aspectRatio;
            const origCardOverflow   = cardEl.style.overflow;

            archEl.style.cssText = origArch
                + ";-webkit-text-fill-color:#fbbf24!important;color:#fbbf24!important;"
                + "background:none!important;-webkit-background-clip:initial!important;background-clip:initial!important;";
            if (shimmer) shimmer.style.animation = "none";

            // Capture at a fixed 9:16 size (360×640) so the PNG is always the right ratio
            const captureW = 360;
            const captureH = Math.round(captureW * 16 / 9);  // 640
            cardEl.style.width       = captureW + "px";
            cardEl.style.maxWidth    = "none";
            cardEl.style.aspectRatio = "auto";
            cardEl.style.overflow    = "hidden";
            cardEl.style.height      = captureH + "px";

            // Fit content into capture dimensions (same logic as fitPcCardContent)
            if (innerEl) {
                innerEl.style.transform = "none";
                innerEl.style.width     = "100%";
                innerEl.style.height    = "auto";
                const captureContentH = innerEl.scrollHeight;
                if (captureContentH > captureH) {
                    const scale = captureH / captureContentH;
                    innerEl.style.width  = (100 / scale) + "%";
                    innerEl.style.height = (100 / scale) + "%";
                    innerEl.style.transform = `scale(${scale})`;
                } else {
                    innerEl.style.height = "100%";
                }
            }

            window.html2canvas(cardEl, {
                scale: outW / captureW,
                backgroundColor: null, useCORS: true, logging: false,
                width: captureW, height: captureH,
            }).then(content => {
                const out = document.createElement("canvas");
                out.width = outW; out.height = outH;
                const ctx = out.getContext("2d");
                // Fill background in case of transparent corners from border-radius
                const grad = ctx.createLinearGradient(0, 0, outW * 0.35, outH);
                grad.addColorStop(0, "#16003a"); grad.addColorStop(0.5, "#1e0045"); grad.addColorStop(1, "#0d1a3e");
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, outW, outH);
                // Card captured at exact 9:16 — draw at full output size
                ctx.drawImage(content, 0, 0, outW, outH);
                onDone(null, out);
            }).catch(err => onDone(err, null))
            .finally(() => {
                archEl.style.cssText = origArch;
                if (shimmer) shimmer.style.animation = "";
                if (innerEl) { innerEl.style.transform = origInnerTransform; innerEl.style.width = origInnerWidth; innerEl.style.height = origInnerHeight; }
                cardEl.style.width = origCardWidth; cardEl.style.height = origCardHeight;
                cardEl.style.maxWidth = origCardMaxWidth; cardEl.style.aspectRatio = origCardAspect;
                cardEl.style.overflow = origCardOverflow;
                fitPcCardContent();
            });
        }

        function _triggerDownload(canvas, filename) {
            const a = document.createElement("a");
            a.download = filename;
            a.href = canvas.toDataURL("image/png");
            a.click();
        }

        document.getElementById("pc-dl-btn").onclick = function () {
            const btn = this; btn.textContent = "…"; btn.disabled = true;
            _captureCard(1080, 1920, (err, canvas) => {
                if (err) window.showToast && window.showToast("PNG generation failed. Use the View link to save the image.");
                else _triggerDownload(canvas, "career-dna-" + card.archetype.toLowerCase().replace(/\s+/g, "-") + ".png");
                btn.innerHTML = "&#8595; Save PNG"; btn.disabled = false;
            });
        };

        document.getElementById("pc-stories-btn").onclick = function () {
            const btn = this; btn.textContent = "…"; btn.disabled = true;
            _captureCard(1080, 1920, (err, canvas) => {
                if (err) window.showToast && window.showToast("Stories export failed. Try Save PNG instead.");
                else _triggerDownload(canvas, "career-dna-story-" + card.archetype.toLowerCase().replace(/\s+/g, "-") + ".png");
                btn.innerHTML = "&#10024; Stories"; btn.disabled = false;
            });
        };

        document.getElementById("pc-copy-btn").onclick = function () {
            const btn = this;
            navigator.clipboard?.writeText(card.share_url).then(() => {
                btn.textContent = "✓ Copied!";
                setTimeout(() => { btn.innerHTML = "&#128279; Copy"; }, 2500);
            }).catch(() => { btn.textContent = card.share_url; });
        };
    }

    function _escHtml(str) {
        return String(str || "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

})();
