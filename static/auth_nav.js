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
    return _origFetch(input, init);
  };
})();

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
          <a class="profile-link tc-myresumes-link" href="/dashboard">
            <span class="tc-pl-ic">📊</span>
            <span class="tc-pl-tx"><strong>Dashboard</strong><small>Your job-hunt home base</small></span>
          </a>
          <a class="profile-link tc-myresumes-link" href="/my-resumes">
            <span class="tc-pl-ic">📄</span>
            <span class="tc-pl-tx"><strong>My Resumes</strong><small>Saved resumes &amp; job tracker</small></span>
          </a>
          <button type="button" class="profile-logout" id="logoutBtn">Logout</button>
        </div>
      </div>
    `;
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
      .profile-dropdown .tc-myresumes-link {
        display: flex; align-items: center; gap: 10px; padding: 9px 10px; margin: 4px 0;
        border-radius: 9px; text-decoration: none; color: inherit;
        background: rgba(59,130,246,.12); border: 1px solid rgba(59,130,246,.28); }
      .profile-dropdown .tc-myresumes-link:hover { background: rgba(59,130,246,.22); }
      .profile-dropdown .tc-pl-ic { font-size: 18px; line-height: 1; }
      .profile-dropdown .tc-pl-tx { display: flex; flex-direction: column; line-height: 1.25; }
      .profile-dropdown .tc-pl-tx strong { font-size: .9rem; color: #eaf1ff; font-weight: 700; }
      .profile-dropdown .tc-pl-tx small { font-size: .72rem; color: #9fb0cc; }
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

  function initAuthNav() {
    const slot = document.getElementById("auth-nav-slot");
    if (!slot) return;

    const user = getStoredUser();
    slot.innerHTML = createAuthWidget(user);

    if (!user) return;

    injectAuthStyles();
    showMyResumesHint();
    const myResumesLink = document.querySelector(".tc-myresumes-link");
    if (myResumesLink) myResumesLink.addEventListener("click", markHintSeen);

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
