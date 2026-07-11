(function () {
    "use strict";

    /* ─────────────────────────────────────────────────────────────────────────
       CONSTANTS & CONFIG
    ───────────────────────────────────────────────────────────────────────── */
    const STORAGE_KEY           = "tailorcv_optimized_editor_payload";
    const AUTO_DOWNLOAD_ON_OPEN = false;

    const A4_WIDTH_MM  = 210;
    const A4_HEIGHT_MM = 297;
    const MM_TO_PX     = 96 / 25.4;
    const A4_WIDTH_PX  = A4_WIDTH_MM  * MM_TO_PX;
    const A4_HEIGHT_PX = A4_HEIGHT_MM * MM_TO_PX;
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
    let allTemplates             = [];

    /* ─────────────────────────────────────────────────────────────────────────
       HELPERS – STATUS / BADGE
    ───────────────────────────────────────────────────────────────────────── */
    function setStatus(msg) {
        if (fitGuidance) fitGuidance.textContent = msg || "";
        if (statusEl)    statusEl.textContent    = msg || "";
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
        const script = `<script>
document.addEventListener("DOMContentLoaded", function () {
  document.body.contentEditable = "true";
  document.body.spellcheck      = false;
  document.body.style.outline   = "none";
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

    function applyAccentColor(doc, hex) {
        if (!doc || !doc.body || !hex) return;

        let style = doc.getElementById("tailorcv-accent-override");
        if (!style) {
            style = doc.createElement("style");
            style.id = "tailorcv-accent-override";
            doc.head.appendChild(style);
        }

        const tint = lightenHex(hex, 40);

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

.sidebar, .cv-sidebar, .left-col, .left-panel,
[class*="sidebar"], [class*="side-col"],
.resume-header, .cv-header, .header-band,
.header-left, .top-band, .top-header,
.section-header, .name-band { background-color: ${hex} !important; }

h1, h2, h3,
.section-title, .section-heading,
[class*="section-title"], [class*="section-heading"],
.job-title, .cv-section-title { color: ${hex} !important; }

hr, .divider, [class*="divider"],
.section-rule, .separator { border-color: ${hex} !important; background: ${hex} !important; }

.timeline-dot, .bullet-dot,
[class*="accent-border"] { background: ${hex} !important; border-color: ${hex} !important; }

.sidebar *, .cv-sidebar *, .left-col *,
.left-panel *, .header-left * { color: #fff !important; }
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

        if (currentAccentColor) {
            applyAccentColor(doc, currentAccentColor);
        }

        const isMobile       = window.innerWidth <= 900;
        /* On mobile, use the full container width so the resume fills edge-to-edge.
           On desktop, subtract 32 px to leave a comfortable gutter. */
        const availableWidth = previewWrap
            ? Math.max(320, previewWrap.clientWidth - (isMobile ? 0 : 32))
            : 760;
        const viewScale      = Math.min(1, availableWidth / A4_WIDTH_PX);

        frame.style.width  = `${A4_WIDTH_PX}px`;
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
        contentHeightPx = Math.max(contentHeightPx, A4_HEIGHT_PX);

        lastFillRatio  = contentHeightPx / A4_HEIGHT_PX;
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
  width:  ${A4_WIDTH_PX}px !important;
  min-height: ${A4_HEIGHT_PX}px !important;
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
        const minFrameHeight = A4_HEIGHT_PX + PAGE_GAP_PX * 2;
        const frameHeight = Math.max(minFrameHeight, contentHeightPx + PAGE_GAP_PX * (estimatedPages + 1));

        frame.style.width           = `${A4_WIDTH_PX}px`;
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

        const host = doc.createElement("div");
        host.id = "tailorcv-page-guides";
        host.setAttribute("aria-hidden", "true");
        Object.assign(host.style, {
            position:      "absolute",
            top:           "0",
            left:          "0",
            width:         "100%",
            height:        `${A4_HEIGHT_PX * pages}px`,
            pointerEvents: "none",
            zIndex:        "2147483646",
            overflow:      "visible",
        });

        for (let i = 1; i < pages; i++) {
            const y = A4_HEIGHT_PX * i;

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
        if (!frame || !frame.contentDocument) return "";
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
    function showProDownloadPopup() {
        const existing = document.getElementById("tcv-pro-dl-overlay");
        if (existing) existing.remove();

        if (!document.getElementById("tcv-pro-dl-style")) {
            const s = document.createElement("style");
            s.id = "tcv-pro-dl-style";
            s.textContent = [
                "#tcv-pro-dl-overlay{position:fixed;inset:0;z-index:999999;",
                "background:rgba(2,8,28,.82);backdrop-filter:blur(6px);",
                "display:flex;align-items:center;justify-content:center;padding:20px;",
                "animation:tcvProDlIn .22s ease;}",

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
            document.head.appendChild(s);
        }

        const priceOnly = typeof _getUpgradePriceOnly === 'function'
            ? _getUpgradePriceOnly(_upgradeRegionCache) : '₹167/month';

        const overlay = document.createElement("div");
        overlay.id = "tcv-pro-dl-overlay";
        overlay.innerHTML =
            '<div id="tcv-pro-dl-modal">' +
                '<button id="tcv-pro-dl-close" aria-label="Close">&times;</button>' +

                '<div class="tcv-pro-dl-lock-wrap"><div class="tcv-pro-dl-lock">🔒</div></div>' +
                '<h2 class="tcv-pro-dl-title">Your resume is ready!</h2>' +
                '<p class="tcv-pro-dl-sub">You\'ve downloaded <strong>3 resumes</strong>. Keep tailoring ' +
                'to land your <strong>next job</strong>.</p>' +

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
                    '<a href="/pricing" class="tcv-pro-dl-cta" id="tcv-pro-dl-cta">' +
                        '<span class="tcv-pro-dl-cta-main">Unlock Unlimited Access</span>' +
                        '<span class="tcv-pro-dl-cta-sub" id="tcv-pro-dl-cta-price">' + priceOnly + ' · Cancel anytime</span>' +
                    '</a>' +
                '</div>' +

                '<div class="tcv-pro-dl-badges">' +
                    '<span>⚡ Instant access</span><span>🛡️ Secure payment</span><span>↺ Cancel anytime</span>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        // Update the price once the region fetch resolves (if not already cached).
        if (typeof _upgradeRegionFetch !== 'undefined' && !_upgradeRegionCache && _upgradeRegionFetch) {
            _upgradeRegionFetch.then(function(region) {
                var priceEl = document.getElementById('tcv-pro-dl-cta-price');
                if (priceEl && region && typeof _getUpgradePriceOnly === 'function') {
                    priceEl.textContent = _getUpgradePriceOnly(region) + ' · Cancel anytime';
                }
            });
        }

        function closePopup() { overlay.remove(); }
        overlay.querySelector("#tcv-pro-dl-close").addEventListener("click", closePopup);
        overlay.addEventListener("click", function (e) { if (e.target === overlay) closePopup(); });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       PDF DOWNLOAD
    ───────────────────────────────────────────────────────────────────────── */
    async function downloadEditedPdf(isAuto = false) {
        if (!frame || !frame.contentDocument) { setStatus("Preview not ready."); return; }

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
            if (!res.ok) throw new Error(await res.text() || "Server error");
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href = url; a.download = "optimized_resume_edited.pdf";
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
        } catch {
            setStatus("Could not download PDF. Please try again.");
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
            "\n\n— Created with TailorCV (www.thetailorcv.com)\n" +
            "Download the properly formatted PDF at www.thetailorcv.com/pricing";

        doc.addEventListener("copy", function (e) {
            const text = (doc.getSelection() || {}).toString() || "";
            if (text.length <= 150) return;
            e.preventDefault();
            try { e.clipboardData.setData("text/plain", text + SUFFIX); } catch (_) {}
            if (typeof showToast === "function") {
                showToast("Download the PDF for proper formatting.", "warn",
                          "Upgrade to download");
            }
        }, true);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       INIT
    ───────────────────────────────────────────────────────────────────────── */
    function init() {
        const payload = getPayload();
        if (!payload || !payload.html) {
            setStatus("No optimised resume found. Please optimise first.");
            return;
        }

        templateId               = Number(payload.template_id || 1);
        baseFontsCaptured        = false;
        baseLineSpacingsCaptured = false;
        currentLineSpacing       = 1;
        currentAccentColor       = null;
        currentHtml              = addEditingOverlay(payload.html);

        injectHostPageStyles();

        frame.srcdoc = currentHtml;
        frame.addEventListener("load", function onLoad() {
            applyWordStylePreview();
            captureBaseLineSpacing(frame.contentDocument);
            updateFontSizeBadge();
            updatePageBadge();
            setStatus("Tip: Click inside the resume to edit text live.");

            buildAccentPanel();
            applyFreeUserProtection(frame.contentDocument);

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

        downloadBtn?.addEventListener("click", () => downloadEditedPdf(false));
        saveBtn?.addEventListener("click", () => saveToMyResumes());

        document.getElementById("switch-template-btn")?.addEventListener("click", () => {
            buildTemplateSwitcher();
        });

        const pulseTarget = fitGuidance || statusEl;
        pulseTarget?.addEventListener("animationend", e => {
            if (e?.animationName === "pulse-success")
                pulseTarget.classList.remove("pulse-success");
        });
    }

    init();

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
            `What archetype are YOU? 👇\n${card.share_url}\n\n#CareerDNA #CareerPersonality #TailorCvAI`;

        bodyEl.innerHTML = `
            <div class="pc-card-inner" id="pc-capturable-card">
                <div class="pc-card-shimmer-inner"></div>
                <div class="pc-card-content" id="pc-card-content">
                    <div class="pc-brand-row">
                        <div class="pc-brand">TailorCv.AI &middot; Career DNA</div>
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
                if (err) alert("PNG generation failed. Use the View link to save the image.");
                else _triggerDownload(canvas, "career-dna-" + card.archetype.toLowerCase().replace(/\s+/g, "-") + ".png");
                btn.innerHTML = "&#8595; Save PNG"; btn.disabled = false;
            });
        };

        document.getElementById("pc-stories-btn").onclick = function () {
            const btn = this; btn.textContent = "…"; btn.disabled = true;
            _captureCard(1080, 1920, (err, canvas) => {
                if (err) alert("Stories export failed. Try Save PNG instead.");
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
