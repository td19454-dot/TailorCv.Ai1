(function () {
  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem("tailorcv_user") || "null");
    } catch (error) {
      return null;
    }
  }

  function clearStoredUser() {
    localStorage.removeItem("tailorcv_user");
  }

  function createAuthWidget(user) {
    if (!user) {
      return `
        <a class="login" href="/login">Login</a>
      `;
    }

    const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();
    const safeName = user.name || user.email || "User";

    return `
      <div class="profile-menu" id="profileMenu">
        <button type="button" class="profile-trigger" id="profileTrigger" aria-haspopup="true" aria-expanded="false" title="${safeName}">
          <span class="profile-avatar">${initial}</span>
          <span class="profile-display-name">${safeName}</span>
        </button>
        <div class="profile-dropdown" id="profileDropdown">
          <div class="profile-name">${safeName}</div>
          <button type="button" class="profile-logout" id="logoutBtn">Logout</button>
        </div>
      </div>
    `;
  }

  function initAuthNav() {
    const slot = document.getElementById("auth-nav-slot");
    if (!slot) return;

    const user = getStoredUser();
    slot.innerHTML = createAuthWidget(user);

    if (!user) return;

    const trigger = document.getElementById("profileTrigger");
    const menu = document.getElementById("profileMenu");
    const logoutBtn = document.getElementById("logoutBtn");

    if (trigger && menu) {
      trigger.addEventListener("click", function () {
        const isOpen = menu.classList.toggle("open");
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });

      document.addEventListener("click", function (event) {
        if (!menu.contains(event.target)) {
          menu.classList.remove("open");
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        fetch('/logout', {method: 'POST'})
        .then(() => {
          clearStoredUser();
          window.location.href = "/login";
        })
        .catch(() => {
          clearStoredUser();
          window.location.href = "/login";
        });
      });
    }
  }

  window.TailorCVAuth = {
    saveUser(user) {
      localStorage.setItem("tailorcv_user", JSON.stringify(user));
    },
    clearUser: clearStoredUser,
    getUser: getStoredUser,
  };

  // ── Extension install button ────────────────────────

  function injectExtButtonStyles() {
    if (document.getElementById('tcv-ext-styles')) return;
    const style = document.createElement('style');
    style.id = 'tcv-ext-styles';
    style.textContent = `
      .tcv-ext-nav-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:linear-gradient(135deg,rgba(79,127,255,.13),rgba(124,58,237,.13));border:1px solid rgba(79,127,255,.45);border-radius:8px;color:#a5b8ff;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .2s,border-color .2s,color .2s;font-family:inherit;}
      .tcv-ext-nav-btn:hover{background:linear-gradient(135deg,rgba(79,127,255,.27),rgba(124,58,237,.27));border-color:rgba(79,127,255,.8);color:#c9d8ff;}
      #tcv-ext-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:2147483646;align-items:center;justify-content:center;}
      #tcv-ext-modal-overlay.open{display:flex;}
      #tcv-ext-modal{background:linear-gradient(160deg,#0f1629,#0e1a2e);border:1px solid rgba(79,127,255,.3);border-radius:16px;padding:32px;max-width:440px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,.6);animation:tcvModalPop .2s ease;position:relative;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      @keyframes tcvModalPop{from{transform:translateY(8px) scale(.98);opacity:0;}to{transform:translateY(0) scale(1);opacity:1;}}
      #tcv-ext-modal .ext-modal-close{position:absolute;top:16px;right:16px;background:none;border:none;color:#64748b;font-size:20px;cursor:pointer;line-height:1;padding:4px;}
      #tcv-ext-modal .ext-modal-close:hover{color:#94a3b8;}
      #tcv-ext-modal h3{font-size:18px;font-weight:700;margin:0 0 6px;background:linear-gradient(135deg,#4f7fff,#c9b8ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
      #tcv-ext-modal .ext-modal-sub{font-size:13px;color:#64748b;margin:0 0 24px;}
      #tcv-ext-modal ol{margin:0 0 24px;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:14px;}
      #tcv-ext-modal ol li{display:flex;gap:12px;align-items:flex-start;font-size:13px;color:#cbd5e1;line-height:1.5;}
      #tcv-ext-modal ol li .step-num{min-width:24px;height:24px;border-radius:50%;background:rgba(79,127,255,.2);border:1px solid rgba(79,127,255,.4);color:#93c5fd;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;}
      #tcv-ext-modal ol li strong{color:#f1f5f9;}
      #tcv-ext-modal ol li code{background:rgba(255,255,255,.08);padding:1px 6px;border-radius:4px;font-size:12px;color:#a5b8ff;}
      #tcv-ext-modal .ext-modal-note{font-size:12px;color:#64748b;background:rgba(255,255,255,.04);border-radius:8px;padding:10px 14px;line-height:1.55;}
      @media(max-width:768px){.tcv-ext-nav-btn .ext-btn-label{display:none;}}
    `;
    document.head.appendChild(style);
  }

  function injectExtensionButton() {
    if (document.getElementById('tcv-ext-btn')) return;
    injectExtButtonStyles();

    // Button
    const btn = document.createElement('button');
    btn.id   = 'tcv-ext-btn';
    btn.type = 'button';
    btn.className = 'tcv-ext-nav-btn';
    btn.title = 'TailorCV Auto Apply — Chrome Extension';
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
        <line x1="16" y1="8" x2="2" y2="22"/>
        <line x1="17.5" y1="15" x2="9" y2="15"/>
      </svg>
      <span class="ext-btn-label">Auto Apply</span>
    `;
    btn.addEventListener('click', openExtModal);

    const slot = document.getElementById('auth-nav-slot');
    const navActions = slot && slot.parentElement;
    if (navActions) navActions.insertBefore(btn, slot);

    // Modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'tcv-ext-modal-overlay';
    overlay.innerHTML = `
      <div id="tcv-ext-modal" role="dialog" aria-modal="true" aria-labelledby="ext-modal-title">
        <button class="ext-modal-close" id="tcv-ext-modal-close" aria-label="Close">✕</button>
        <h3 id="ext-modal-title">TailorCV Auto Apply</h3>
        <p class="ext-modal-sub">Auto-apply to jobs on Naukri &amp; Internshala with one click.</p>
        <ol>
          <li>
            <span class="step-num">1</span>
            <span>Open Chrome and go to <code>chrome://extensions</code></span>
          </li>
          <li>
            <span class="step-num">2</span>
            <span>Turn on <strong>Developer mode</strong> (toggle in the top-right corner)</span>
          </li>
          <li>
            <span class="step-num">3</span>
            <span>Click <strong>Load unpacked</strong> and select the <code>chrome-extension</code> folder from your TailorCV project</span>
          </li>
          <li>
            <span class="step-num">4</span>
            <span><strong>Log in to TailorCV</strong> in the same Chrome browser</span>
          </li>
          <li>
            <span class="step-num">5</span>
            <span>Go to a <strong>Naukri</strong> or <strong>Internshala</strong> job search page — the sidebar appears automatically. Click <strong>▶ Start Auto Apply</strong></span>
          </li>
        </ol>
        <p class="ext-modal-note">Every successful application is saved to your TailorCV job tracker automatically.</p>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('tcv-ext-modal-close').addEventListener('click', closeExtModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeExtModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeExtModal();
    });
  }

  function openExtModal() {
    const overlay = document.getElementById('tcv-ext-modal-overlay');
    if (overlay) overlay.classList.add('open');
  }

  function closeExtModal() {
    const overlay = document.getElementById('tcv-ext-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  document.addEventListener("DOMContentLoaded", function () {
    initAuthNav();
    injectExtensionButton();
  });
})();
