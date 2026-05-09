(function () {
    const STORAGE_KEY = "tailorcv_optimized_editor_payload";
    const frame = document.getElementById("resume-preview-frame");
    const statusEl = document.getElementById("editor-status");
    const downloadBtn = document.getElementById("download-edited-btn");
    const fontDecreaseBtn = document.getElementById("font-decrease-btn");
    const fontResetBtn = document.getElementById("font-reset-btn");
    const fontIncreaseBtn = document.getElementById("font-increase-btn");
    const fontSizeBadge = document.getElementById("font-size-badge");
    const pageIndexBadge = document.getElementById("page-index-badge");
    const previewWrap = document.querySelector(".editor-preview-wrap");
    let currentHtml = "";
    let currentZoom = 1;
    let baseFitScale = 1;
    let templateId = 1;
    let intrinsicContentWidth = null;
    let intrinsicContentHeight = null;
    let baseFontsCaptured = false;
    let estimatedPages = 1;
    let currentPage = 1;
    let lastPageHeightDoc = 1;
    let estimateTimer = null;
    let estimateRequestId = 0;
    let serverEstimatedPages = null;

    function updatePageBadge() {
        if (pageIndexBadge) {
            pageIndexBadge.textContent = `Current Pages: ${estimatedPages}`;
        }
    }

    function setStatus(message) {
        if (statusEl) statusEl.textContent = message || "";
    }

    function updateFontSizeBadge() {
        if (fontSizeBadge) {
            fontSizeBadge.textContent = `${Math.round(currentZoom * 100)}%`;
        }
    }

    function getPayload() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
        } catch (error) {
            return null;
        }
    }

    function addEditingOverlay(html) {
        const editScript = `
<script>
document.addEventListener("DOMContentLoaded", function () {
  document.body.contentEditable = "true";
  document.body.spellcheck = false;
  document.body.style.outline = "none";
});
</script>`;
        if (html.includes("</body>")) {
            return html.replace("</body>", editScript + "</body>");
        }
        return html + editScript;
    }

    function getAvailablePreviewHeight() {
        if (!previewWrap) return Math.max(640, window.innerHeight * 0.82);
        const rect = previewWrap.getBoundingClientRect();
        const bottomGap = 10;
        return Math.max(640, window.innerHeight - rect.top - bottomGap);
    }

    function calculateBaseFitScale() {
        if (!frame || !frame.contentDocument || !previewWrap) return 1;
        const doc = frame.contentDocument;
        const root = doc.documentElement;
        const body = doc.body;
        if (!root || !body) return 1;

        const isTemplateOneToSix = templateId >= 1 && templateId <= 6;
        const rawWidth = Math.max(intrinsicContentWidth || root.scrollWidth || body.scrollWidth || 1, 1);
        const clientWidthRef = Math.max(root.clientWidth || 0, body.clientWidth || 0, 1);
        // Some templates (notably 1-6) can report very large scrollWidth because of
        // long inline runs, which makes preview text tiny. Clamp pathological width.
        const widthSpikeRatio = rawWidth / clientWidthRef;
        const contentWidth = widthSpikeRatio > 1.35
            ? Math.max(clientWidthRef * 1.08, 1)
            : rawWidth;
        const contentHeight = Math.max(intrinsicContentHeight || root.scrollHeight || body.scrollHeight || 1, 1);
        const safeSideGutter = (templateId >= 1 && templateId <= 6) ? 72 : 24;
        const availableWidth = Math.max(320, previewWrap.clientWidth - safeSideGutter);
        const availableHeight = Math.max(420, getAvailablePreviewHeight() - 16);
        const fitByWidth = availableWidth / contentWidth;
        const fitByHeight = availableHeight / contentHeight;
        // Bias toward readability: allow slight vertical overflow rather than over-shrinking.
        const easedHeightFit = fitByHeight * 1.22;
        return Math.min(fitByWidth, easedHeightFit, 1);
    }

    function captureIntrinsicMetrics(doc) {
        if (!doc || !doc.documentElement || !doc.body) return;
        const root = doc.documentElement;
        const body = doc.body;
        const styleTag = doc.getElementById("tailorcv-preview-fit-style");
        const prevCss = styleTag ? styleTag.textContent : null;
        if (styleTag) styleTag.textContent = "";
        intrinsicContentWidth = Math.max(root.scrollWidth || 0, body.scrollWidth || 0, 1);
        intrinsicContentHeight = Math.max(root.scrollHeight || 0, body.scrollHeight || 0, 1);
        if (styleTag && prevCss != null) styleTag.textContent = prevCss;
    }

    function captureBaseFontsForTemplate7Plus(doc) {
        if (baseFontsCaptured || !doc || !doc.body) return;
        const selectors = "h1,h2,h3,h4,h5,h6,p,li,span,a,strong,em,b,i,small,label,td,th";
        const nodes = doc.body.querySelectorAll(selectors);
        nodes.forEach((node) => {
            const computed = doc.defaultView ? doc.defaultView.getComputedStyle(node) : null;
            if (!computed) return;
            const value = parseFloat(computed.fontSize || "");
            if (!Number.isFinite(value) || value <= 0) return;
            node.setAttribute("data-tailorcv-base-font", String(value));
        });
        baseFontsCaptured = true;
    }

    function applyFontScaleForTemplate7Plus(doc, scale) {
        if (!doc || !doc.body) return;
        const selectors = "h1,h2,h3,h4,h5,h6,p,li,span,a,strong,em,b,i,small,label,td,th";
        const nodes = doc.body.querySelectorAll(selectors);
        nodes.forEach((node) => {
            const base = parseFloat(node.getAttribute("data-tailorcv-base-font") || "");
            if (!Number.isFinite(base) || base <= 0) return;
            const next = Math.max(8, Math.min(72, base * scale));
            node.style.setProperty("font-size", `${next}px`, "important");
        });
    }

    function getCssPxPerMm(doc) {
        if (!doc || !doc.body) return 96 / 25.4;
        const probe = doc.createElement("div");
        probe.style.position = "absolute";
        probe.style.left = "-99999px";
        probe.style.top = "0";
        probe.style.width = "100mm";
        probe.style.height = "1px";
        probe.style.visibility = "hidden";
        probe.style.pointerEvents = "none";
        doc.body.appendChild(probe);
        const px = probe.getBoundingClientRect().width;
        probe.remove();
        return (Number.isFinite(px) && px > 0) ? (px / 100) : (96 / 25.4);
    }

    function getRawCssPxPerMm(doc) {
        return getCssPxPerMm(doc);
    }

    function renderPageGuides(doc, pageHeightDoc, totalHeightDoc) {
        if (!doc || !doc.body) return;
        const old = doc.getElementById("tailorcv-page-guides");
        if (old) old.remove();
        if (!Number.isFinite(pageHeightDoc) || pageHeightDoc <= 0) return;
        if (!Number.isFinite(totalHeightDoc) || totalHeightDoc <= pageHeightDoc) return;

        const guideHost = doc.createElement("div");
        guideHost.id = "tailorcv-page-guides";
        guideHost.style.position = "absolute";
        guideHost.style.left = "0";
        guideHost.style.top = "0";
        guideHost.style.width = "100%";
        guideHost.style.height = `${Math.ceil(totalHeightDoc)}px`;
        guideHost.style.minHeight = `${Math.ceil(totalHeightDoc)}px`;
        guideHost.style.pointerEvents = "none";
        guideHost.style.zIndex = "2147483646";

        const breaks = Math.max(0, Math.ceil(totalHeightDoc / pageHeightDoc) - 1);
        for (let i = 1; i <= breaks; i += 1) {
            const y = i * pageHeightDoc;
            const line = doc.createElement("div");
            line.style.position = "absolute";
            line.style.left = "0";
            line.style.right = "0";
            line.style.top = `${y}px`;
            line.style.borderTop = "3px dotted rgba(29, 78, 216, 0.98)";
            line.style.boxShadow = "0 0 8px rgba(29,78,216,0.28)";
            guideHost.appendChild(line);

            const label = doc.createElement("div");
            label.textContent = `Page ${i + 1} starts`;
            label.style.position = "absolute";
            label.style.left = "50%";
            label.style.transform = "translateX(-50%)";
            label.style.top = `${y - 24}px`;
            label.style.padding = "3px 10px";
            label.style.borderRadius = "999px";
            label.style.background = "rgba(15, 23, 42, 0.9)";
            label.style.border = "1px solid rgba(29,78,216,0.95)";
            label.style.color = "#dbeafe";
            label.style.fontSize = "12px";
            label.style.fontWeight = "700";
            label.style.letterSpacing = "0.02em";
            label.style.boxShadow = "0 2px 8px rgba(2,6,23,0.35)";
            label.style.fontFamily = "Inter, sans-serif";
            guideHost.appendChild(label);
        }

        const currentPosition = doc.defaultView ? doc.defaultView.getComputedStyle(doc.body).position : "";
        if (!currentPosition || currentPosition === "static") {
            doc.body.style.position = "relative";
        }
        doc.body.appendChild(guideHost);
    }

    function applyPreviewZoom() {
        if (!frame || !frame.contentDocument) return;
        const doc = frame.contentDocument;
        const root = doc.documentElement;
        const body = doc.body;
        if (!root || !body) return;

        // STEP 1: strip fit CSS before measuring
        let fitStyleTag = doc.getElementById("tailorcv-preview-fit-style");
        const savedCss = fitStyleTag ? fitStyleTag.textContent : "";
        if (fitStyleTag) fitStyleTag.textContent = "";

        // STEP 2: temporarily disable contentEditable
        const wasEditable = body.contentEditable === "true" || body.isContentEditable;
        if (wasEditable) {
            body.contentEditable = "false";
            void body.offsetHeight;
        }

        // STEP 3: use scrollHeight/offsetHeight measurements in document pixels
        let rawContentHeight = 0;
        const primaryContainer = body.querySelector(
            ".page, .resume-shell, .resume-container, .page-wrap, .cv-page"
        );
        if (primaryContainer) {
            rawContentHeight = Math.max(
                primaryContainer.scrollHeight || 0,
                primaryContainer.offsetHeight || 0,
                1
            );
        }
        if (!rawContentHeight || rawContentHeight < 100) {
            rawContentHeight = Math.max(
                body.scrollHeight || 0,
                body.offsetHeight || 0,
                1
            );
        }
        const rawContentWidth = Math.max(
            root.scrollWidth || 0, body.scrollWidth || 0, 1
        );

        // STEP 4: restore contentEditable
        if (wasEditable) {
            body.contentEditable = "true";
        }

        // STEP 5: true px-per-mm
        const pxPerMm = getRawCssPxPerMm(doc);

        // STEP 6: page height in unscaled document pixels
        let pageHeightPx = 0;
        const pageEl = body.querySelector(".page");
        if (pageEl) {
            const candidate = Math.max(pageEl.scrollHeight || 0, pageEl.offsetHeight || 0);
            if (candidate > 100) {
                pageHeightPx = candidate;
            }
        }
        if (!pageHeightPx || !Number.isFinite(pageHeightPx)) {
            if (pageEl && doc.defaultView) {
                const styles = doc.defaultView.getComputedStyle(pageEl);
                const minH = parseFloat(styles.minHeight || "");
                const h = parseFloat(styles.height || "");
                const mt = parseFloat(styles.marginTop || "") || 0;
                const mb = parseFloat(styles.marginBottom || "") || 0;
                if (Number.isFinite(minH) && minH > 0) pageHeightPx = minH + mt + mb;
                else if (Number.isFinite(h) && h > 0 && styles.height !== "auto")
                    pageHeightPx = h + mt + mb;
            }
        }
        if (!pageHeightPx || !Number.isFinite(pageHeightPx)) {
            pageHeightPx = 297 * pxPerMm;
        }

        // STEP 7: 1% tolerance now that measurements are accurate
        const OVERFLOW_TOLERANCE = 0.01;
        const rawRatio = rawContentHeight / Math.max(1, pageHeightPx);
        estimatedPages = Math.max(1,
            rawRatio > 1 + OVERFLOW_TOLERANCE ? Math.ceil(rawRatio) : 1
        );
        lastPageHeightDoc = Math.max(1, pageHeightPx);
        intrinsicContentWidth = rawContentWidth;
        intrinsicContentHeight = rawContentHeight;

        // STEP 8: restore fit CSS
        if (fitStyleTag) fitStyleTag.textContent = savedCss;

        baseFitScale = calculateBaseFitScale();
        const isTemplateOneToSix = templateId >= 1 && templateId <= 6;
        const isTemplateOneToSeven = templateId >= 1 && templateId <= 7;
        const fitOnlyScale = Math.max(0.3, Math.min(2.4, baseFitScale));

const fitCss = `
html {
  background: transparent !important;
  display: flex !important;
  justify-content: center !important;
  padding: ${isTemplateOneToSix ? "14px 28px" : "10px 16px"} !important;
  box-sizing: border-box !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: none !important;
}
html::-webkit-scrollbar { display: none !important; }
body {
  overflow-x: hidden !important;
  overflow-y: auto !important;
  background: ${isTemplateOneToSeven ? "#ffffff" : "transparent"} !important;
  color: inherit !important;
  transform: scale(${Math.max(0.3, Math.min(2.4, fitOnlyScale * currentZoom))}) !important;
  transform-origin: top center !important;
  width: ${100 / fitOnlyScale}% !important;
  max-width: calc(100% - ${isTemplateOneToSix ? "40px" : "24px"}) !important;
  min-width: 0 !important;
  margin: 12px auto !important;
  left: auto !important;
  right: auto !important;
  border-radius: 10px !important;
  box-sizing: border-box !important;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2) !important;
}
`;

        if (!fitStyleTag) {
            fitStyleTag = doc.createElement("style");
            fitStyleTag.id = "tailorcv-preview-fit-style";
            doc.head.appendChild(fitStyleTag);
        }

        fitStyleTag.textContent = fitCss;
        if (previewWrap) {
            previewWrap.style.background = "linear-gradient(180deg, rgba(30, 41, 59, 0.45), rgba(15, 23, 42, 0.3))";
        }
        if (frame) {
            frame.style.background = "rgba(226, 232, 240, 0.15)";
        }
        if (!isTemplateOneToSix) {
            captureBaseFontsForTemplate7Plus(doc);
            applyFontScaleForTemplate7Plus(doc, currentZoom);
        }

        frame.style.height = `${Math.round(getAvailablePreviewHeight())}px`;
        currentPage = Math.min(currentPage, estimatedPages);
        updatePageBadge();
        renderPageGuides(doc, pageHeightPx, rawContentHeight);
        schedulePageEstimate();
    }

    function changeFontScale(delta) {
        currentZoom = Math.max(0.6, Math.min(1.8, currentZoom + delta));
        applyPreviewZoom();
        updateFontSizeBadge();
        setStatus(`Font size set to ${Math.round(currentZoom * 100)}%.`);
    }

    function resetFontScale() {
        currentZoom = 1;
        applyPreviewZoom();
        updateFontSizeBadge();
        setStatus("Font size reset to 100%.");
    }

    function bindPageTracking() {
        if (!frame || !frame.contentWindow) return;
        const win = frame.contentWindow;
        const onScroll = function () {
            if (!lastPageHeightDoc) return;
            const y = win.scrollY || win.pageYOffset || 0;
            currentPage = Math.max(1, Math.min(estimatedPages, Math.floor(y / lastPageHeightDoc) + 1));
            updatePageBadge();
        };
        win.addEventListener("scroll", onScroll, { passive: true });
    }

    function buildExportHtmlForEstimation() {
        if (!frame || !frame.contentDocument) return "";
        const sourceDoc = frame.contentDocument;
        const exportDoc = sourceDoc.documentElement.cloneNode(true);
        const exportBody = exportDoc.querySelector("body");
        const previewFitStyle = exportDoc.querySelector("#tailorcv-preview-fit-style");
        if (previewFitStyle) previewFitStyle.remove();
        const pageGuides = exportDoc.querySelector("#tailorcv-page-guides");
        if (pageGuides) pageGuides.remove();
        exportDoc.querySelectorAll("script").forEach((script) => script.remove());
        if (exportBody) {
            exportBody.removeAttribute("contenteditable");
            exportBody.removeAttribute("spellcheck");
            exportBody.style.removeProperty("transform");
            exportBody.style.removeProperty("transform-origin");
            exportBody.style.removeProperty("width");
            exportBody.style.removeProperty("max-width");
            exportBody.style.removeProperty("overflow-x");
            exportBody.style.removeProperty("overflow-y");
            exportBody.style.removeProperty("margin");
        }
        return "<!DOCTYPE html>\n" + exportDoc.outerHTML;
    }

    async function refreshEstimatedPagesFromServer() {
        const requestId = ++estimateRequestId;
        const html = buildExportHtmlForEstimation();
        if (!html) return;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2200);
            const response = await fetch("/api/estimate-html-pages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    html,
                    pdf_scale: templateId >= 1 && templateId <= 6 ? 1 : Math.max(0.6, Math.min(1.8, currentZoom))
                }),
                signal: controller.signal
            });
            clearTimeout(timeout);
            if (!response.ok) return;
            if (requestId !== estimateRequestId) return;
            const data = await response.json();
            const pages = Number(data && data.pages);
            if (!Number.isFinite(pages) || pages < 1) return;
            const normalizedPages = Math.max(1, Math.ceil(pages));
            const didChange = normalizedPages !== Math.max(1, Math.ceil(Number(serverEstimatedPages || 0)));
            serverEstimatedPages = pages;
            // Use server value for badge reliability, but keep visual break positions local.
            estimatedPages = normalizedPages;
            currentPage = Math.min(currentPage, estimatedPages);
            if (didChange) updatePageBadge();
            else updatePageBadge();
        } catch (error) {
            // Keep local estimate on network/server issues.
        }
    }

    function schedulePageEstimate() {
        if (estimateTimer) {
            clearTimeout(estimateTimer);
            estimateTimer = null;
        }
        estimateTimer = setTimeout(() => {
            refreshEstimatedPagesFromServer().catch(() => {});
        }, 90);
    }

    async function downloadEditedPdf() {
        if (!frame || !frame.contentDocument) {
            setStatus("Preview not ready.");
            return;
        }
        const sourceDoc = frame.contentDocument;
        const exportDoc = sourceDoc.documentElement.cloneNode(true);
        const exportBody = exportDoc.querySelector("body");

        // Remove preview-only scaling style so PDF uses normal template dimensions.
        const previewFitStyle = exportDoc.querySelector("#tailorcv-preview-fit-style");
        if (previewFitStyle) previewFitStyle.remove();
        const pageGuides = exportDoc.querySelector("#tailorcv-page-guides");
        if (pageGuides) pageGuides.remove();
        const isTemplateOneToSix = templateId >= 1 && templateId <= 6;
        // Remove edit-mode artifacts from export.
        exportDoc.querySelectorAll("script").forEach((script) => script.remove());
        if (exportBody) {
            exportBody.removeAttribute("contenteditable");
            exportBody.removeAttribute("spellcheck");
            exportBody.style.removeProperty("transform");
            exportBody.style.removeProperty("transform-origin");
            exportBody.style.removeProperty("width");
            exportBody.style.removeProperty("overflow-x");
            exportBody.style.removeProperty("overflow-y");
            exportBody.style.removeProperty("margin");
        }

        if (isTemplateOneToSix) {
            // Keep legacy export behavior for templates 1-6.
            const exportScale = Math.max(0.6, Math.min(1.8, currentZoom));
            let exportScaleStyle = exportDoc.querySelector("#tailorcv-export-scale-style");
            if (!exportScaleStyle) {
                exportScaleStyle = exportDoc.ownerDocument
                    ? exportDoc.ownerDocument.createElement("style")
                    : null;
            }
            if (!exportScaleStyle) {
                exportScaleStyle = sourceDoc.createElement("style");
            }
            exportScaleStyle.id = "tailorcv-export-scale-style";
            exportScaleStyle.textContent = `
html { overflow: hidden !important; }
body {
  transform: scale(${exportScale}) !important;
  transform-origin: top left !important;
  width: ${100 / exportScale}% !important;
}
`;
            const exportHead = exportDoc.querySelector("head");
            if (exportHead) exportHead.appendChild(exportScaleStyle);
        }

        const html = "<!DOCTYPE html>\n" + exportDoc.outerHTML;
        setStatus("Generating edited PDF...");
        downloadBtn.disabled = true;
        try {
            const response = await fetch("/api/download-html-pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    html,
                    pdf_scale: isTemplateOneToSix ? 1 : Math.max(0.6, Math.min(1.8, currentZoom))
                })
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || "Failed to generate PDF");
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "optimized_resume_edited.pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            setStatus("Edited PDF downloaded.");
        } catch (error) {
            setStatus("Could not download edited PDF.");
        } finally {
            downloadBtn.disabled = false;
        }
    }

    function init() {
        const payload = getPayload();
        if (!payload || !payload.html) {
            setStatus("No optimized resume found. Please optimize first.");
            return;
        }
        templateId = Number(payload.template_id || 1);
        baseFontsCaptured = false;
        currentHtml = addEditingOverlay(payload.html);
        frame.srcdoc = currentHtml;
        frame.addEventListener("load", function () {
            if (!(templateId >= 1 && templateId <= 6) && frame.contentDocument) {
                const doc = frame.contentDocument;
                intrinsicContentWidth = Math.max(
                    (doc.documentElement && doc.documentElement.scrollWidth) || 0,
                    (doc.body && doc.body.scrollWidth) || 0,
                    1
                );
            }
            applyPreviewZoom();
            updateFontSizeBadge();
            updatePageBadge();
            bindPageTracking();
            setStatus("Tip: Click inside resume preview and edit text live.");
        });
        window.addEventListener("resize", applyPreviewZoom);

        if (fontDecreaseBtn) fontDecreaseBtn.addEventListener("click", function () { changeFontScale(-0.05); });
        if (fontIncreaseBtn) fontIncreaseBtn.addEventListener("click", function () { changeFontScale(0.05); });
        if (fontResetBtn) fontResetBtn.addEventListener("click", resetFontScale);
        downloadBtn.addEventListener("click", downloadEditedPdf);
    }

    init();
})();
