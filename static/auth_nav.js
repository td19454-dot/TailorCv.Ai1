// CSRF fetch interceptor — runs on every page since auth_nav.js is universal
(function () {
  function _getCsrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  var _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    var method = (init.method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].indexOf(method) === -1) {
      var token = _getCsrfToken();
      if (token) {
        init.headers = Object.assign({}, init.headers, {
          "X-CSRFToken": token,
          "X-Requested-With": "XMLHttpRequest"
        });
      }
    }
    return _origFetch(input, init).then(function (response) {
      if (response.status === 402) {
        // checkout-download is handled by the optimized editor with its own
        // richer popup — skip the generic modal for that endpoint.
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf("checkout-download") !== -1) return response;
        response.clone().json().then(function (body) {
          if (body && body.error === "upgrade_required") {
            showUpgradeModal(body.feature);
          }
        }).catch(function () {});
      }
      return response;
    });
  };
})();

// ── Upgrade paywall modal ──────────────────────────────────────────────────
var _upgradeModalOpen = false;

var FEATURE_LABELS = {
  ai_optimizations:   "Resume Optimization",
  cover_letters:      "Cover Letter",
  linkedin_imports:   "LinkedIn Import",
  mock_interviews:    "Mock Interview",
  interview_questions:"Interview Questions",
};

function showUpgradeModal(feature) {
  if (_upgradeModalOpen) return;
  _upgradeModalOpen = true;
  var label = FEATURE_LABELS[feature] || "this feature";

  // Inject modal styles once
  if (!document.getElementById("tc-upgrade-style")) {
    var s = document.createElement("style");
    s.id = "tc-upgrade-style";
    s.textContent = [
      "#tc-upgrade-overlay{position:fixed;inset:0;z-index:999998;background:rgba(2,8,28,.72);",
      "backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;",
      "animation:tcUpFadeIn .22s ease;}",
      "#tc-upgrade-modal{background:linear-gradient(155deg,#0e1a3a,#091228);",
      "border:1px solid rgba(56,189,248,.35);border-radius:20px;padding:2rem 2.2rem;",
      "max-width:420px;width:90%;box-shadow:0 32px 64px rgba(0,6,22,.7),0 0 0 1px rgba(56,189,248,.15);",
      "position:relative;animation:tcUpSlideUp .28s ease;}",
      "#tc-upgrade-modal h2{font-size:1.35rem;font-weight:800;color:#f1f8ff;margin:0 0 .6rem;}",
      "#tc-upgrade-modal p{font-size:.92rem;color:#94a3b8;margin:0 0 1.4rem;line-height:1.55;}",
      "#tc-upgrade-modal strong{color:#7dd3fc;}",
      ".tc-up-actions{display:flex;gap:.75rem;flex-wrap:wrap;}",
      ".tc-up-btn{flex:1;min-width:120px;padding:.65rem 1rem;border-radius:10px;font-size:.9rem;",
      "font-weight:700;cursor:pointer;border:none;text-align:center;text-decoration:none;",
      "display:inline-flex;align-items:center;justify-content:center;}",
      ".tc-up-primary{background:linear-gradient(135deg,#2563eb,#0ea5e9);color:#fff;",
      "box-shadow:0 4px 14px rgba(37,99,235,.4);}",
      ".tc-up-primary:hover{opacity:.9;}",
      ".tc-up-secondary{background:transparent;color:#64748b;border:1px solid rgba(100,116,139,.3);}",
      ".tc-up-secondary:hover{color:#94a3b8;border-color:rgba(100,116,139,.55);}",
      ".tc-up-close{position:absolute;top:12px;right:14px;background:none;border:none;",
      "color:#475569;font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;}",
      ".tc-up-close:hover{color:#94a3b8;}",
      "@keyframes tcUpFadeIn{from{opacity:0}to{opacity:1}}",
      "@keyframes tcUpSlideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}",
    ].join("");
    document.head.appendChild(s);
  }

  var overlay = document.createElement("div");
  overlay.id = "tc-upgrade-overlay";
  overlay.innerHTML =
    '<div id="tc-upgrade-modal">' +
      '<button class="tc-up-close" aria-label="Close">&times;</button>' +
      '<h2>Upgrade to Pro</h2>' +
      '<p>You\'ve used your <strong>1 free ' + label + '</strong>.<br>' +
      'Upgrade for unlimited access to all Pro features.</p>' +
      '<div class="tc-up-actions">' +
        '<a class="tc-up-btn tc-up-primary" href="/pricing">See Plans &rarr;</a>' +
        '<button class="tc-up-btn tc-up-secondary" id="tcUpDismiss">Maybe later</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  function closeModal() {
    overlay.remove();
    _upgradeModalOpen = false;
  }
  overlay.querySelector(".tc-up-close").addEventListener("click", closeModal);
  overlay.querySelector("#tcUpDismiss").addEventListener("click", closeModal);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
}

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

  function createAuthWidget(user, isPro) {
    if (!user) {
      return '<a class="login" href="/login">Login</a>';
    }

    const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();
    const safeName = user.name || user.email || "User";
    const safeEmail = user.email || "";
    const proBadge = isPro ? '<span class="tc-nav-probadge">Pro</span>' : '';
    const proSection = isPro
      ? '<span class="tc-nav-link tc-nav-pro-label">Pro ✓</span>'
        + '<a class="tc-nav-link tc-myresumes-link" href="/manage-subscription">Manage subscription</a>'
      : '<a class="tc-nav-link tc-myresumes-link" href="/pricing">Upgrade to Pro</a>';

    return `<div class="tc-nav-profile" id="profileMenu">
      <button type="button" class="tc-nav-trigger" id="profileTrigger" aria-haspopup="true" aria-expanded="false" title="${safeName}">
        <span class="tc-nav-avatar">${initial}</span>${proBadge}
      </button>
      <div class="tc-nav-dropdown" id="profileDropdown">
        <div class="tc-nav-head">
          <span class="tc-nav-hd-av">${initial}</span>
          <div class="tc-nav-hd-id"><strong>${safeName}</strong><small>${safeEmail}</small></div>
        </div>
        ${proSection}
        <a class="tc-nav-link tc-myresumes-link" href="/privacy">Privacy Policy</a>
        <a class="tc-nav-link tc-myresumes-link" href="/terms">Terms</a>
        <button type="button" class="tc-nav-logout" id="logoutBtn">Log out</button>
      </div>
    </div>`;
  }

  const HINT_SEEN_KEY = "tailorcv_seen_myresumes_hint";

  function markHintSeen() {
    try { localStorage.setItem(HINT_SEEN_KEY, "1"); } catch (e) {}
  }

  function injectAuthStyles() {
    if (document.getElementById("tc-auth-style")) return;
    const s = document.createElement("style");
    s.id = "tc-auth-style";
    s.textContent = `
      .tc-nav-profile { position: relative; }
      .tc-nav-trigger {
        position: relative; display: inline-flex; align-items: center; justify-content: center;
        border: none; background: transparent; cursor: pointer; padding: 0; }
      .tc-nav-avatar {
        width: 38px; height: 38px; border-radius: 50%;
        background: linear-gradient(135deg,#3392ff,#6d28d9); color: #fff;
        font-size: 16px; font-weight: 700;
        display: inline-flex; align-items: center; justify-content: center; }
      .tc-nav-probadge {
        position: absolute; top: -5px; right: -7px;
        background: linear-gradient(135deg,#2563eb,#0ea5e9); color: #fff;
        font-size: .56rem; font-weight: 800; letter-spacing: .04em;
        border-radius: 999px; padding: 1px 5px; line-height: 1.5; pointer-events: none; }
      .tc-nav-dropdown {
        position: absolute; right: 0; top: calc(100% + 12px); min-width: 250px;
        background: #0b1430; border: 1px solid rgba(99,130,200,.3); border-radius: 14px;
        overflow: hidden; display: none; z-index: 99999;
        box-shadow: 0 18px 48px rgba(0,0,0,.55); }
      .tc-nav-profile.open .tc-nav-dropdown { display: block; }
      .tc-nav-head {
        display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px;
        border-bottom: 1px solid rgba(99,130,200,.2); }
      .tc-nav-hd-av {
        width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
        background: linear-gradient(135deg,#3392ff,#6d28d9); color: #fff;
        font-weight: 700; font-size: 15px;
        display: flex; align-items: center; justify-content: center; }
      .tc-nav-hd-id { display: flex; flex-direction: column; line-height: 1.3; overflow: hidden; }
      .tc-nav-hd-id strong { color: #eaf1ff; font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tc-nav-hd-id small { color: #7d93b8; font-size: .75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tc-nav-link {
        display: block; padding: 9px 14px; color: #c8d8f0; font-size: .88rem;
        text-decoration: none; }
      .tc-nav-link:hover { color: #eaf1ff; background: rgba(99,130,200,.08); }
      .tc-nav-pro-label { color: #7dd3fc !important; font-weight: 700; cursor: default; }
      .tc-nav-logout {
        display: block; width: 100%; text-align: left; padding: 9px 14px;
        background: none; border: none; border-top: 1px solid rgba(99,130,200,.15);
        color: #c8d8f0; font-size: .88rem; cursor: pointer; }
      .tc-nav-logout:hover { color: #eaf1ff; background: rgba(99,130,200,.08); }
      #tc-myresumes-hint {
        position: fixed; top: 80px; right: 18px; z-index: 99998; max-width: 274px;
        background: linear-gradient(160deg,#16203c,#0e1730); border: 1px solid rgba(59,130,246,.55);
        border-radius: 14px; padding: 14px 32px 14px 14px; box-shadow: 0 18px 48px rgba(0,0,0,.55);
        color: #cdd9f0; font-family: Inter, -apple-system, sans-serif; font-size: .85rem; line-height: 1.5;
        animation: tcHintIn .3s ease; }
      #tc-myresumes-hint .tc-finger { position: absolute; top: -42px; right: 18px; font-size: 34px;
        animation: tcFinger 1s ease-in-out infinite; filter: drop-shadow(0 4px 6px rgba(0,0,0,.45)); }
      #tc-myresumes-hint strong { color: #eaf1ff; }
      #tc-myresumes-hint a { color: #9cc2ff; font-weight: 700; text-decoration: underline; }
      #tc-myresumes-hint .tc-hint-close { position: absolute; top: 6px; right: 9px; background: none; border: none;
        color: #8da3c6; font-size: 18px; cursor: pointer; line-height: 1; }
      #tc-myresumes-hint .tc-hint-close:hover { color: #eaf1ff; }
      @keyframes tcHintIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform:none; } }
      @keyframes tcFinger { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
    `;
    document.head.appendChild(s);
  }

  function renderMyResumesHint() {
    if (document.getElementById("tc-myresumes-hint")) return;
    markHintSeen(); // shown once — never again
    const hint = document.createElement("div");
    hint.id = "tc-myresumes-hint";
    hint.innerHTML =
      '<div class="tc-finger" aria-hidden="true">👆</div>' +
      '<button class="tc-hint-close" aria-label="Dismiss">&times;</button>' +
      '<strong>Optimize your resume?</strong><br>It\'s saved to <a href="/my-resumes">My Resumes</a> right here — view &amp; download it anytime.';
    document.body.appendChild(hint);

    const dismiss = () => { hint.remove(); };
    hint.querySelector(".tc-hint-close").addEventListener("click", dismiss);
    setTimeout(() => { if (document.body.contains(hint)) dismiss(); }, 13000);
  }

  function showMyResumesHint() {
    try {
      if (localStorage.getItem(HINT_SEEN_KEY)) return;
      // Already on the page? Consider it discovered.
      if (window.location.pathname === "/my-resumes") { markHintSeen(); return; }

      // Case A — right after login: teach the feature up front, even with zero
      //    resumes, since the message explains what WILL happen when they optimize.
      var justLoggedIn = false;
      try { justLoggedIn = localStorage.getItem("tailorcv_show_resume_finger") === "1"; } catch (e) {}
      if (justLoggedIn) {
        try { localStorage.removeItem("tailorcv_show_resume_finger"); } catch (e) {}
        renderMyResumesHint();
        return;
      }

      // Case B — returning users who already have resumes but never got the
      //    post-login flag. Server count is the source of truth; it never fires
      //    for empty accounts.
      fetch("/api/my-resumes/count", { headers: { "X-Requested-With": "XMLHttpRequest" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) { if (data && data.count > 0) renderMyResumesHint(); })
        .catch(function () {});
    } catch (e) {}
  }

  function wireDropdown() {
    const trigger = document.getElementById("profileTrigger");
    const menu = document.getElementById("profileMenu");
    const logoutBtn = document.getElementById("logoutBtn");

    if (trigger && menu) {
      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
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
        .then(() => { clearStoredUser(); window.location.href = "/login"; })
        .catch(() => { clearStoredUser(); window.location.href = "/login"; });
      });
    }
  }

  function initAuthNav() {
    const slot = document.getElementById("auth-nav-slot");
    if (!slot) return;

    const user = getStoredUser();

    // Render immediately from cache (fast, no flash)
    slot.innerHTML = createAuthWidget(user, user && user.is_pro);

    // "Get Started" CTA shows only on marketing pages when logged out
    const getStartedBtn = document.querySelector(".nav-getstarted");
    if (getStartedBtn) {
      const p = window.location.pathname;
      const onAllowedPage =
        p === "/" || p === "/pricing" || p === "/contact" ||
        p === "/about" || p === "/blog" || p.indexOf("/blog/") === 0;
      getStartedBtn.style.display = (!user && onAllowedPage) ? "" : "none";
    }

    if (!user) return;

    injectAuthStyles();
    showMyResumesHint();
    const myResumesLink = document.querySelector(".tc-myresumes-link");
    if (myResumesLink) myResumesLink.addEventListener("click", markHintSeen);
    wireDropdown();

    // Fetch live Pro status — re-render if it differs from cache
    fetch("/api/auth/me", { headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        const cachedPro = !!(user && user.is_pro);
        const livePro = !!data.is_pro;
        // Always persist latest data including Pro status
        const updated = Object.assign({}, user, { is_pro: livePro, pro_until: data.pro_until });
        try { localStorage.setItem("tailorcv_user", JSON.stringify(updated)); } catch (e) {}
        if (cachedPro !== livePro) {
          slot.innerHTML = createAuthWidget(updated, livePro);
          injectAuthStyles();
          const link = document.querySelector(".tc-myresumes-link");
          if (link) link.addEventListener("click", markHintSeen);
          wireDropdown();
        }
      })
      .catch(function () {});
  }

  window.TailorCVAuth = {
    saveUser(user) {
      localStorage.setItem("tailorcv_user", JSON.stringify(user));
      // Arm the one-time "your resumes live here 👆" finger pointer for the next
      // page load after login/signup (unless they've already seen it).
      try {
        if (!localStorage.getItem("tailorcv_seen_myresumes_hint")) {
          localStorage.setItem("tailorcv_show_resume_finger", "1");
        }
      } catch (e) {}
    },
    clearUser: clearStoredUser,
    getUser: getStoredUser,
  };

  document.addEventListener("DOMContentLoaded", initAuthNav);
})();
