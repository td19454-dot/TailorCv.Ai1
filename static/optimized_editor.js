(function () {
    const STORAGE_KEY = "tailorcv_optimized_editor_payload";
    const frame = document.getElementById("resume-preview-frame");
    const statusEl = document.getElementById("editor-status");
    const downloadBtn = document.getElementById("download-edited-btn");
    const fontDecreaseBtn = document.getElementById("font-decrease-btn");
    const fontResetBtn = document.getElementById("font-reset-btn");
    const fontIncreaseBtn = document.getElementById("font-increase-btn");
    const fontSizeBadge = document.getElementById("font-size-badge");
    const previewWrap = document.querySelector(".editor-preview-wrap");
    let currentHtml = "";
    let currentZoom = 1;
    let baseFitScale = 1;

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
        if (!previewWrap) return Math.max(500, window.innerHeight * 0.65);
        const rect = previewWrap.getBoundingClientRect();
        const bottomGap = 28;
        return Math.max(500, window.innerHeight - rect.top - bottomGap);
    }

    function calculateBaseFitScale() {
        if (!frame || !frame.contentDocument || !previewWrap) return 1;
        const doc = frame.contentDocument;
        const root = doc.documentElement;
        const body = doc.body;
        if (!root || !body) return 1;

        const contentWidth = Math.max(root.scrollWidth, body.scrollWidth, 1);
        const availableWidth = Math.max(320, previewWrap.clientWidth - 16);
        const fitByWidth = availableWidth / contentWidth;
        return Math.min(fitByWidth, 1);
    }

    function applyPreviewZoom() {
        if (!frame || !frame.contentDocument) return;
        const doc = frame.contentDocument;
        baseFitScale = calculateBaseFitScale();
        const effectiveScale = Math.max(0.3, Math.min(2.4, baseFitScale));
        let fitStyleTag = doc.getElementById("tailorcv-preview-fit-style");

        const fitCss = `
html {
  overflow-x: hidden !important;
  overflow-y: auto !important;
}
body {
  overflow-x: hidden !important;
  overflow-y: auto !important;
  transform: scale(${Math.max(0.3, Math.min(2.4, baseFitScale * currentZoom))}) !important;
  transform-origin: top left !important;
  width: ${100 / Math.max(0.3, Math.min(2.4, baseFitScale * currentZoom))}% !important;
  margin: 0 !important;
}
`;

        if (!fitStyleTag) {
            fitStyleTag = doc.createElement("style");
            fitStyleTag.id = "tailorcv-preview-fit-style";
            doc.head.appendChild(fitStyleTag);
        }

        fitStyleTag.textContent = fitCss;
        frame.style.height = `${Math.round(getAvailablePreviewHeight())}px`;
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
        const userFontStyle = exportDoc.querySelector("#tailorcv-user-font-style");
        if (userFontStyle) userFontStyle.remove();

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

        // Apply the chosen size directly to export HTML so downloaded PDF matches preview controls.
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

        const html = "<!DOCTYPE html>\n" + exportDoc.outerHTML;
        setStatus("Generating edited PDF...");
        downloadBtn.disabled = true;
        try {
            const response = await fetch("/api/download-html-pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    html,
                    pdf_scale: 1
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
        currentHtml = addEditingOverlay(payload.html);
        frame.srcdoc = currentHtml;
        frame.addEventListener("load", function () {
            applyPreviewZoom();
            updateFontSizeBadge();
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
