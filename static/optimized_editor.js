(function () {
    "use strict";

    /* ─────────────────────────────────────────────────────────────────────────
       CONSTANTS & CONFIG
    ───────────────────────────────────────────────────────────────────────── */
    const STORAGE_KEY           = "tailorcv_optimized_editor_payload";
    const AUTO_DOWNLOAD_ON_OPEN = true;

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

        const wasEditable = body.contentEditable === "true" || body.isContentEditable;
        if (wasEditable) { body.contentEditable = "false"; void body.offsetHeight; }

        captureBaseFonts(doc);
        applyFontScale(doc, currentZoom);

        captureBaseLineSpacing(doc);
        applyLineSpacing(doc, currentLineSpacing);

        if (currentAccentColor) {
            applyAccentColor(doc, currentAccentColor);
        }

        const availableWidth = previewWrap ? Math.max(320, previewWrap.clientWidth - 32) : 760;
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

        lastFillRatio  = contentHeightPx / A4_HEIGHT_PX;
        estimatedPages = Math.max(1,
            lastFillRatio > 1.01 ? Math.ceil(lastFillRatio) : 1
        );

        if (wasEditable) body.contentEditable = "true";

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
  min-height: ${(estimatedPages * A4_HEIGHT_PX) + PAGE_GAP_PX * (estimatedPages + 1)}px !important;
  display: block !important;
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
}
`;

        if (!fitStyle) {
            fitStyle = doc.createElement("style");
            fitStyle.id = "tailorcv-preview-fit-style";
            doc.head.appendChild(fitStyle);
        }
        fitStyle.textContent = wordCss;

        renderPageBreaks(doc, estimatedPages);

        frame.style.width           = `${A4_WIDTH_PX}px`;
        frame.style.height          = `${Math.ceil(contentHeightPx + PAGE_GAP_PX * (estimatedPages + 1))}px`;
        frame.style.transform       = `scale(${viewScale})`;
        frame.style.transformOrigin = "top left";
        frame.style.display         = "block";
        frame.style.background      = "transparent";
        frame.style.border          = "none";

        if (previewWrap) {
            const visibleH = Math.ceil((contentHeightPx + PAGE_GAP_PX * (estimatedPages + 1)) * viewScale);
            frame.parentElement.style.minHeight = `${visibleH + 32}px`;
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
       PDF DOWNLOAD
    ───────────────────────────────────────────────────────────────────────── */
    async function downloadEditedPdf(isAuto = false) {
        if (!frame || !frame.contentDocument) { setStatus("Preview not ready."); return; }

        const html = buildExportHtml();
        if (!html) { setStatus("Could not read resume content."); return; }

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
            setStatus(isAuto
                ? "Auto-download complete. Adjust font size then click Download Edited PDF."
                : "PDF downloaded successfully.");
        } catch {
            setStatus(isAuto
                ? "Auto-download failed — use Download Edited PDF button."
                : "Could not download PDF. Please try again.");
        } finally {
            if (downloadBtn) downloadBtn.disabled = false;
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
  overflow-x: auto !important;
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
        { id: 1,  name: "Modern Professional",      image: "pic1.jpg"  },
        { id: 2,  name: "Executive Minimal",         image: "pic2.jpg"  },
        { id: 3,  name: "Creative Tech",             image: "pic3.jpg"  },
        { id: 4,  name: "Classic Academic",          image: "pic4.jpg"  },
        { id: 5,  name: "Modern Elegant",            image: "pic5.jpg"  },
        { id: 6,  name: "Professional Classic",      image: "pic6.jpg"  },
        { id: 7,  name: "Navy Sidebar",              image: "pic7.jpg"  },
        { id: 8,  name: "Teal Sidebar",              image: "pic8.jpg"  },
        { id: 9,  name: "Burgundy Sidebar",          image: "pic9.jpg"  },
        { id: 10, name: "Slate Sidebar",             image: "pic10.jpg" },
        { id: 11, name: "Forest Sidebar",            image: "pic11.jpg" },
        { id: 12, name: "Skyline Blue",              image: "pic12.jpg" },
        { id: 13, name: "Gray Executive Panel",      image: "pic13.png" },
        { id: 14, name: "Olive Timeline Pro",        image: "pic14.png" },
        { id: 15, name: "Aqua Timeline Modern",      image: "pic15.png" },
        { id: 16, name: "Navy Rail Editorial",       image: "pic16.png" },
        { id: 17, name: "Executive Gray Board",      image: "pic17.png" },
        { id: 18, name: "Classic Gray Professional", image: "pic18.png" },
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
    object-fit: cover; display: block;
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
                            <img src="/static/${t.image}?v=8" alt="${t.name}" loading="lazy">
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

            if (AUTO_DOWNLOAD_ON_OPEN && !hasAutoDownloaded) {
                hasAutoDownloaded = true;
                setTimeout(() => {
                    downloadEditedPdf(true).catch(() => {});
                    setStatus("Tip: Click inside the resume preview to edit text live.");
                }, 350);
            }
        });

        window.addEventListener("resize", () => applyWordStylePreview(), { passive: true });

        fontDecreaseBtn?.addEventListener("click", () => changeFontScale(-0.05));
        fontIncreaseBtn?.addEventListener("click", () => changeFontScale(+0.05));
        fontResetBtn?.addEventListener("click",    () => resetFontScale());

        document.getElementById("spacing-decrease-btn")?.addEventListener("click", () => changeLineSpacing(-0.05));
        document.getElementById("spacing-increase-btn")?.addEventListener("click", () => changeLineSpacing(+0.05));
        document.getElementById("spacing-reset-btn")?.addEventListener("click", resetLineSpacing);

        downloadBtn?.addEventListener("click", () => downloadEditedPdf(false));

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

})();