/* Global toast notification + CSRF helper */
(function () {
    // ── Toast styles ────────────────────────────────────────────────────────
    const style = document.createElement("style");
    style.textContent = `
        #tc-toast-container {
            position: fixed; bottom: 24px; right: 24px;
            z-index: 99999; display: flex; flex-direction: column;
            gap: 10px; pointer-events: none;
        }
        .tc-toast {
            display: flex; align-items: flex-start; gap: 10px;
            min-width: 280px; max-width: 420px;
            background: rgba(10, 20, 48, 0.97);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 12px; padding: 13px 16px;
            box-shadow: 0 12px 32px rgba(0,0,0,0.5);
            backdrop-filter: blur(16px);
            pointer-events: auto;
            animation: tcToastIn .28s cubic-bezier(.4,0,.2,1);
            font-family: Inter, -apple-system, sans-serif;
        }
        .tc-toast.tc-hide {
            animation: tcToastOut .28s cubic-bezier(.4,0,.2,1) forwards;
        }
        .tc-toast-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .tc-toast-body { flex: 1; }
        .tc-toast-title { font-weight: 700; font-size: 13.5px; color: #f1f5f9; }
        .tc-toast-msg   { font-size: 13px; color: #94a3b8; margin-top: 3px; line-height: 1.45; }
        .tc-toast-close {
            background: none; border: none; color: #64748b;
            font-size: 16px; cursor: pointer; padding: 0; flex-shrink: 0;
            line-height: 1; align-self: flex-start;
        }
        .tc-toast-close:hover { color: #f1f5f9; }
        .tc-toast.tc-error  { border-color: rgba(239,68,68,0.45); }
        .tc-toast.tc-success{ border-color: rgba(34,197,94,0.45); }
        .tc-toast.tc-warn   { border-color: rgba(234,179,8,0.45); }
        .tc-toast.tc-info   { border-color: rgba(59,130,246,0.45); }
        @keyframes tcToastIn  { from { opacity:0; transform:translateY(14px) scale(.97); } to { opacity:1; transform:none; } }
        @keyframes tcToastOut { to   { opacity:0; transform:translateY(14px) scale(.97); } }
        @media (max-width: 520px) {
            #tc-toast-container { left: 12px; right: 12px; bottom: 16px; }
            .tc-toast { min-width: 0; max-width: 100%; }
        }
    `;
    document.head.appendChild(style);

    const container = document.createElement("div");
    container.id = "tc-toast-container";
    document.body.appendChild(container);

    const ICONS = { error: "❌", success: "✅", warn: "⚠️", info: "ℹ️" };
    const TITLES = { error: "Error", success: "Success", warn: "Warning", info: "Info" };
    const DURATION = { error: 6000, success: 4000, warn: 5000, info: 4500 };

    window.showToast = function (message, type = "info", title = "") {
        const toast = document.createElement("div");
        toast.className = `tc-toast tc-${type}`;
        toast.innerHTML = `
            <span class="tc-toast-icon">${ICONS[type] || ICONS.info}</span>
            <div class="tc-toast-body">
                <div class="tc-toast-title">${title || TITLES[type] || "Notice"}</div>
                <div class="tc-toast-msg">${message}</div>
            </div>
            <button class="tc-toast-close" aria-label="Dismiss">&times;</button>
        `;
        container.appendChild(toast);

        function dismiss() {
            toast.classList.add("tc-hide");
            toast.addEventListener("animationend", () => toast.remove(), { once: true });
        }
        toast.querySelector(".tc-toast-close").addEventListener("click", dismiss);
        setTimeout(dismiss, DURATION[type] || 5000);
    };

    // ── Timeout wrapper for heavy fetches ───────────────────────────────────
    // Usage: fetchWithTimeout(url, options, 30000)
    window.fetchWithTimeout = function (input, init = {}, ms = 30000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        return _origFetch(input, { ...init, signal: controller.signal })
            .finally(() => clearTimeout(timer));
    };
})();
