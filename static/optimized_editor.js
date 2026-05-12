(function () {
    "use strict";

    /* ─────────────────────────────────────────────────────────────────────────
       CONSTANTS & CONFIG
    ───────────────────────────────────────────────────────────────────────── */
    const STORAGE_KEY        = "tailorcv_optimized_editor_payload";
    const AUTO_DOWNLOAD_ON_OPEN = true;

    // A4 paper dimensions (mm → px at 96 dpi)
    const A4_WIDTH_MM        = 210;
    const A4_HEIGHT_MM       = 297;
    const MM_TO_PX           = 96 / 25.4;          // ≈ 3.7795 px/mm
    const A4_WIDTH_PX        = A4_WIDTH_MM  * MM_TO_PX; // ≈ 794 px
    const A4_HEIGHT_PX       = A4_HEIGHT_MM * MM_TO_PX; // ≈ 1123 px

    // Gap between page sheets (Word-style grey gutter)
    const PAGE_GAP_PX        = 24;

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
    let currentHtml        = "";
    let currentZoom        = 1.0;     // user font-scale multiplier (0.6 – 1.8)
    let templateId         = 1;
    let estimatedPages     = 1;
    let lastFillRatio      = 1;
    let hasAutoDownloaded  = false;

    // Base font sizes captured once after first load (for templates 7+)
    let baseFontsCaptured  = false;

    // Server-side page-count polling
    let estimateTimer      = null;
    let estimateRequestId  = 0;

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
       Injected into the iframe so the user can click-and-type directly.
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
       FONT SCALE HELPERS (templates 7+)
       For templates 1-6 the CSS transform approach already works well;
       for 7+ we scale individual font-size properties.
    ───────────────────────────────────────────────────────────────────────── */
    function captureBaseFonts(doc) {
        if (baseFontsCaptured || !doc || !doc.body) return;
        const SEL = "h1,h2,h3,h4,h5,h6,p,li,span,a,strong,em,b,i,small,label,td,th";
        doc.body.querySelectorAll(SEL).forEach(node => {
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
        const SEL = "h1,h2,h3,h4,h5,h6,p,li,span,a,strong,em,b,i,small,label,td,th";
        doc.body.querySelectorAll(SEL).forEach(node => {
            const base = parseFloat(node.getAttribute("data-base-font") || "");
            if (!Number.isFinite(base) || base <= 0) return;
            node.style.setProperty("font-size", `${Math.max(8, Math.min(72, base * scale))}px`, "important");
        });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CORE: applyWordStylePreview
       ─────────────────────────────────────────────────────────────────────────
       This is the heart of the MS-Word-style renderer.

       Approach:
         1.  The iframe is given a fixed A4 width (794 px) and a very tall height
             so it can lay out its content naturally, without any clipping.
         2.  We measure the true scrollHeight of the content.
         3.  We calculate how many A4 pages that content spans.
         4.  We set the outer #resume-preview-frame height to exactly
             (pages × A4_HEIGHT + gaps) so the frame scrolls naturally inside
             the .editor-preview-wrap scrollable container.
         5.  We inject a CSS style tag into the iframe that:
               • Removes any previous transform-scaling.
               • Sets the body width to A4_WIDTH_PX so the template lays out
                 as if it were being printed.
               • Adds a "page-break shadow" every A4_HEIGHT interval using a
                 repeating-linear-gradient on the <html> element.
               • Adds a subtle drop-shadow under each page to mimic paper.
         6.  Page-break dividers (solid lines + "Page N" labels) are injected
             as absolutely-positioned elements inside the iframe body.
    ───────────────────────────────────────────────────────────────────────── */
    function applyWordStylePreview() {
        if (!frame || !frame.contentDocument) return;
        const doc  = frame.contentDocument;
        const root = doc.documentElement;
        const body = doc.body;
        if (!root || !body) return;

        const isT1to6 = templateId >= 1 && templateId <= 6;

        /* ── Step 1: strip old preview style & page guides ── */
        let fitStyle = doc.getElementById("tailorcv-preview-fit-style");
        if (fitStyle) fitStyle.textContent = "";

        removePageGuides(doc);

        /* ── Step 2: temporarily disable contentEditable for accurate measurement ── */
        const wasEditable = body.contentEditable === "true" || body.isContentEditable;
        if (wasEditable) { body.contentEditable = "false"; void body.offsetHeight; }

        /* ── Step 3: apply font scaling BEFORE measuring content height ── */
        if (!isT1to6) {
            captureBaseFonts(doc);
            applyFontScale(doc, currentZoom);
        }

        /* ── Step 4: measure content dimensions at natural (un-scaled) layout ── */
        // We need to know the A4 scale factor: how much do we need to zoom the
        // 794px-wide document to fit inside the available preview panel width?
        const availableWidth  = previewWrap ? Math.max(320, previewWrap.clientWidth - 32) : 760;
        const viewScale       = Math.min(1, availableWidth / A4_WIDTH_PX); // never zoom >100%

        // Set the iframe to "natural" A4 width so content reflows correctly
        frame.style.width  = `${A4_WIDTH_PX}px`;
        frame.style.height = "9999px"; // temp tall height for measurement

        // Force layout
        void root.offsetHeight;

        // Measure the primary content container if possible
        const primaryEl = body.querySelector(".page, .resume-shell, .resume-container, .page-wrap, .cv-page");
        let contentHeightPx = primaryEl
            ? Math.max(primaryEl.scrollHeight || 0, primaryEl.offsetHeight || 0)
            : 0;
        if (contentHeightPx < 100) {
            contentHeightPx = Math.max(body.scrollHeight || 0, body.offsetHeight || 0, 100);
        }

        /* ── Step 5: calculate page count ── */
        lastFillRatio  = contentHeightPx / A4_HEIGHT_PX;
        estimatedPages = Math.max(1,
            lastFillRatio > 1.01 ? Math.ceil(lastFillRatio) : 1
        );

        /* ── Step 6: restore contentEditable ── */
        if (wasEditable) body.contentEditable = "true";

        /* ── Step 7: build the Word-style CSS ── */
        // Total height of all page sheets stacked with gaps
        const totalSheetHeight = (estimatedPages * A4_HEIGHT_PX) + ((estimatedPages - 1) * PAGE_GAP_PX);

        // For templates 1-6 we still use transform-scale on the body to handle
        // their fixed-width layouts; for 7+ font-scale is already applied above.
        const bodyScaleForT1to6 = isT1to6 ? currentZoom : 1;

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
  min-height: ${totalSheetHeight + PAGE_GAP_PX * 2}px !important;
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
  transform: ${isT1to6 ? `scale(${bodyScaleForT1to6})` : "none"} !important;
  transform-origin: ${isT1to6 ? "top center" : "unset"} !important;
  left: auto !important;
  right: auto !important;
  border-radius: 2px !important;
}
`;

        /* ── Step 8: inject / update the style tag ── */
        if (!fitStyle) {
            fitStyle = doc.createElement("style");
            fitStyle.id = "tailorcv-preview-fit-style";
            doc.head.appendChild(fitStyle);
        }
        fitStyle.textContent = wordCss;

        /* ── Step 9: render page-break dividers inside the iframe ── */
        renderPageBreaks(doc, estimatedPages);

        /* ── Step 10: size the outer iframe wrapper ── */
        // The iframe itself needs to be tall enough to hold all pages +
        // the grey gaps. We then scale the whole thing down with CSS zoom
        // to fit the panel width.
        const scaledTotalHeight = totalSheetHeight + PAGE_GAP_PX * 2;
        frame.style.width       = `${A4_WIDTH_PX}px`;
        frame.style.height      = `${Math.ceil(contentHeightPx + PAGE_GAP_PX * (estimatedPages + 1))}px`;
        frame.style.transform   = `scale(${viewScale})`;
        frame.style.transformOrigin = "top left";
        frame.style.display     = "block";
        frame.style.background  = "transparent";
        frame.style.border      = "none";

        // Make the wrapper match the visual (scaled) height so the outer
        // scrollbar reflects real content, not iframe overflow
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
       Injects horizontal "page break" lines + "Page N" labels between pages
       directly inside the iframe document, absolutely positioned.
    ───────────────────────────────────────────────────────────────────────── */
    function removePageGuides(doc) {
        const el = doc.getElementById("tailorcv-page-guides");
        if (el) el.remove();
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
            const y = A4_HEIGHT_PX * i; // position of each break in doc-pixels

            // ── White gap strip (simulates paper edge / gutter) ──
            const gap = doc.createElement("div");
            Object.assign(gap.style, {
                position:   "absolute",
                left:       "-40px",
                right:      "-40px",
                top:        `${y - 10}px`,
                height:     "20px",
                background: "#525659",
                zIndex:     "2147483645",
            });
            host.appendChild(gap);

            // ── Dashed page boundary line ──
            const line = doc.createElement("div");
            Object.assign(line.style, {
                position:    "absolute",
                left:        "0",
                right:       "0",
                top:         `${y}px`,
                height:      "0",
                borderTop:   "2px dashed rgba(37,99,235,0.75)",
                boxShadow:   "0 0 6px rgba(37,99,235,0.3)",
                zIndex:      "2147483647",
            });
            host.appendChild(line);

            // ── "Page N starts" label ──
            const label = doc.createElement("div");
            label.textContent = `Page ${i + 1} starts here`;
            Object.assign(label.style, {
                position:       "absolute",
                left:           "50%",
                top:            `${y - 22}px`,
                transform:      "translateX(-50%)",
                padding:        "3px 12px",
                borderRadius:   "999px",
                background:     "rgba(15,23,42,0.92)",
                border:         "1px solid rgba(37,99,235,0.85)",
                color:          "#bfdbfe",
                fontSize:       "11px",
                fontWeight:     "700",
                letterSpacing:  "0.03em",
                fontFamily:     "Inter, system-ui, sans-serif",
                whiteSpace:     "nowrap",
                boxShadow:      "0 2px 8px rgba(2,6,23,0.4)",
                zIndex:         "2147483647",
                pointerEvents:  "none",
            });
            host.appendChild(label);
        }

        // Ensure body is positioned so absolute children work
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
       SERVER-SIDE PAGE COUNT ESTIMATE (secondary validation)
    ───────────────────────────────────────────────────────────────────────── */
    function scheduleServerEstimate() {
        if (estimateTimer) { clearTimeout(estimateTimer); estimateTimer = null; }
        estimateTimer = setTimeout(() => refreshServerEstimate().catch(() => {}), 120);
    }

    function buildExportHtml() {
        if (!frame || !frame.contentDocument) return "";
        const src    = frame.contentDocument;
        const clone  = src.documentElement.cloneNode(true);
        const body   = clone.querySelector("body");
        clone.querySelector("#tailorcv-preview-fit-style")?.remove();
        clone.querySelector("#tailorcv-page-guides")?.remove();
        clone.querySelectorAll("script").forEach(s => s.remove());
        if (body) {
            body.removeAttribute("contenteditable");
            body.removeAttribute("spellcheck");
            ["transform","transform-origin","width","max-width",
             "overflow-x","overflow-y","margin"].forEach(p => body.style.removeProperty(p));
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
                    pdf_scale: (templateId >= 1 && templateId <= 6)
                        ? 1
                        : Math.max(0.6, Math.min(1.8, currentZoom))
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
                // Re-render page breaks to match server truth
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
        downloadBtn.disabled = true;
        try {
            const res = await fetch("/api/download-html-pdf", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    html,
                    pdf_scale: (templateId >= 1 && templateId <= 6)
                        ? 1
                        : Math.max(0.6, Math.min(1.8, currentZoom))
                }),
            });
            if (!res.ok) throw new Error(await res.text() || "Server error");
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href     = url;
            a.download = "optimized_resume_edited.pdf";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setStatus(isAuto
                ? "Auto-download complete. Adjust font size then click Download Edited PDF."
                : "PDF downloaded successfully.");
        } catch (err) {
            setStatus(isAuto
                ? "Auto-download failed — use Download Edited PDF button."
                : "Could not download PDF. Please try again.");
        } finally {
            downloadBtn.disabled = false;
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CSS for .editor-preview-wrap  (injected once into the host page)
       We override the outer container so it becomes the Word-app background.
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
  /* Allow the iframe to size the scroll area naturally */
  display: block !important;
}
#resume-preview-frame {
  display: block !important;
  border: 0 !important;
  background: transparent !important;
  /* transform + transform-origin set dynamically by JS */
}
`;
        document.head.appendChild(s);
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

        templateId        = Number(payload.template_id || 1);
        baseFontsCaptured = false;
        currentHtml       = addEditingOverlay(payload.html);

        injectHostPageStyles();

        frame.srcdoc = currentHtml;
        frame.addEventListener("load", function onLoad() {
            applyWordStylePreview();
            updateFontSizeBadge();
            updatePageBadge();
            setStatus("Tip: Click inside the resume to edit text live.");

            if (AUTO_DOWNLOAD_ON_OPEN && !hasAutoDownloaded) {
                hasAutoDownloaded = true;
                setTimeout(() => downloadEditedPdf(true).catch(() => {}), 300);
            }
        });

        // Re-apply on window resize (panel width change)
        window.addEventListener("resize", () => applyWordStylePreview(), { passive: true });

        // Font controls
        fontDecreaseBtn?.addEventListener("click", () => changeFontScale(-0.05));
        fontIncreaseBtn?.addEventListener("click", () => changeFontScale(+0.05));
        fontResetBtn?.addEventListener("click",    () => resetFontScale());

        // Download
        downloadBtn?.addEventListener("click", () => downloadEditedPdf(false));

        // Pulse animation cleanup
        const pulseTarget = fitGuidance || statusEl;
        pulseTarget?.addEventListener("animationend", e => {
            if (e?.animationName === "pulse-success")
                pulseTarget.classList.remove("pulse-success");
        });
    }

    init();
})();