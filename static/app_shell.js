/* App shell: top bar + icon rail on tool pages (Jobscan-style).
   Shown for logged-in and guest users on known tool pages so navigation stays
   consistent. Guests get Log in / Get Started instead of the profile menu. */
(function () {
    // Logged-out feature landings opt out of the app shell so they keep the
    // normal marketing header + footer (set server-side via the <html> attr).
    if (document.documentElement.getAttribute("data-guest-landing") === "1") return;
    // /dashboard already has its own sidebar, so it's intentionally excluded.
    var APP_PREFIXES = [
        "/solutions", "/ats-analysis", "/optimize", "/modify-cv", "/cover-letter",
        "/auto-apply", "/my-resumes", "/interview-prep", "/mock-interview",
        "/optimized-editor", "/templates", "/portfolio", "/portfolio-builder",
        "/my-portfolios", "/extension"
    ];

    function getUser() {
        try { return JSON.parse(localStorage.getItem("tailorcv_user") || "null"); }
        catch (e) { return null; }
    }
    function path() { return (location.pathname || "/").replace(/\/+$/, "") || "/"; }
    function isAppPage() {
        var p = path();
        return APP_PREFIXES.some(function (pre) { return p === pre || p.indexOf(pre + "/") === 0; });
    }
    function nextUrl() {
        return encodeURIComponent(location.pathname + location.search + location.hash);
    }

    var user = getUser();
    if (!isAppPage()) return;

    // Flag <html> early so the CSS hides the marketing navbar with minimal flash.
    document.documentElement.classList.add("tcv-app");
    if (!user) document.documentElement.classList.add("tcv-app-guest");

    // Monochrome SVG icons (stroke=currentColor) so the whole rail is one color.
    function svg(inner) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            + 'stroke-linecap="round" stroke-linejoin="round" width="20" height="20">' + inner + '</svg>';
    }
    var IC = {
        home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/>'),
        cv: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
        opt: svg('<path d="M12 3l1.8 4.9L18.7 9l-4.9 1.8L12 16l-1.8-5.2L5.3 9l4.9-1.1z"/>'),
        ats: svg('<path d="M3 20h18"/><path d="M6 20V11"/><path d="M12 20V5"/><path d="M18 20v-6"/>'),
        mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
        send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
        folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
        help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 4.7 1.4c0 1.7-2.2 2.1-2.2 3.4"/><path d="M12 17h.01"/>'),
        mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>'),
        grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
        portfolio: svg('<rect x="2.5" y="3" width="19" height="18" rx="3"/><circle cx="12" cy="9" r="2.6"/><path d="M7 18a5 5 0 0 1 10 0"/>'),
        puzzle: svg('<path d="M10 3.5a1.5 1.5 0 0 1 3 0V5h2.5A1.5 1.5 0 0 1 17 6.5V9h1.5a1.5 1.5 0 0 1 0 3H17v2.5a1.5 1.5 0 0 1-1.5 1.5H13v1.5a1.5 1.5 0 0 1-3 0V16H7.5A1.5 1.5 0 0 1 6 14.5V12H4.5a1.5 1.5 0 0 1 0-3H6V6.5A1.5 1.5 0 0 1 7.5 5H10z"/>'),
        out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>')
    };
    var LINKS = [
        ["/dashboard", IC.home, "Home"],
        ["/modify-cv", IC.cv, "Resume Builder"],
        ["/optimize", IC.opt, "AI Optimize (Resume + JD)"],
        ["/solutions", IC.ats, "Get ATS Score"],
        ["/cover-letter", IC.mail, "Cover Letter"],
        ["/my-resumes", IC.folder, "My Resumes"],
        ["/portfolio", IC.portfolio, "Portfolio Website"],
        ["/templates", IC.grid, "Templates"],
        ["/interview-prep", IC.help, "Interview Prep"],
        ["/mock-interview", IC.mic, "Mock Interview"],
        ["/extension", IC.puzzle, "Chrome Extension"]
    ];

    function build() {
        var here = path();
        var initial = user ? ((user.name || user.email || "U").trim().charAt(0) || "U").toUpperCase() : "";

        // Top bar
        var top = document.createElement("header");
        top.className = "tcv-top";
        function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

        var topRight = user
            ? '<div class="tcv-top-right">'
            + '<div class="tcv-profile">'
            +   '<button class="tcv-avatar" id="tcvAvatarBtn" aria-haspopup="true" aria-expanded="false">' + initial + '</button>'
            +   '<div class="tcv-profile-menu">'
            +     '<div class="tcv-profile-head"><span class="tcv-pf-av">' + initial + '</span>'
            +       '<div class="tcv-pf-id"><strong>' + esc(user.name || "User") + '</strong><small>' + esc(user.email || "") + '</small></div></div>'
            +     '<div id="tcvProLinks"></div>'
            +     '<a class="tcv-pf-link" href="/pricing">Get free scans</a>'
            +     '<a class="tcv-pf-link" href="/pricing">Account Settings</a>'
            +     '<a class="tcv-pf-link" href="/privacy">Privacy Policy</a>'
            +     '<a class="tcv-pf-link" href="/terms">Terms</a>'
            +     '<a class="tcv-pf-link" href="#" id="tcvProfileLogout">Log out</a>'
            +   '</div>'
            + '</div>'
            + '</div>'
            : '<div class="tcv-top-right tcv-top-guest">'
            + '<a class="tcv-guest-login" href="/login?next=' + nextUrl() + '">Log in</a>'
            + '<a class="tcv-guest-signup" href="/signup?next=' + nextUrl() + '">Get Started</a>'
            + '</div>';

        top.innerHTML =
            '<button class="tcv-burger" id="tcvBurger" aria-label="Toggle menu" title="Collapse menu">☰</button>'
            + '<a class="tcv-top-logo" href="' + (user ? "/dashboard" : "/") + '"><img class="tcv-top-mark" src="/static/logo-mark.webp" alt=""><span class="tcv-top-word">thetailorcv</span></a>'
            + topRight;

        // Slim icon rail with hover tooltips
        var items = LINKS.map(function (l) {
            var active = (here === l[0].replace(/\/+$/, "")) ? " active" : "";
            return '<a class="tcv-rail-link' + active + '" href="' + l[0] + '" aria-label="' + l[2] + '">'
                + '<span class="tcv-rail-ic">' + l[1] + '</span>'
                + '<span class="tcv-rail-tip">' + l[2] + '</span></a>';
        }).join("");
        var rail = document.createElement("aside");
        rail.className = "tcv-rail";
        rail.id = "tcvRail";
        var railFoot = user
            ? '<div class="tcv-rail-foot"><a class="tcv-rail-link" href="#" id="tcvLogout" aria-label="Logout">'
                + '<span class="tcv-rail-ic">' + IC.out + '</span><span class="tcv-rail-tip">Logout</span></a></div>'
            : '<div class="tcv-rail-foot"><a class="tcv-rail-link" href="/login?next=' + nextUrl() + '" aria-label="Log in">'
                + '<span class="tcv-rail-ic">' + IC.out + '</span><span class="tcv-rail-tip">Log in</span></a></div>';

        rail.innerHTML =
            '<button class="tcv-rail-close" id="tcvRailClose" aria-label="Close menu" title="Close">&times;</button>'
            + '<nav class="tcv-rail-nav">' + items + '</nav>'
            + railFoot;

        var backdrop = document.createElement("div");
        backdrop.className = "tcv-side-backdrop";
        backdrop.id = "tcvSideBackdrop";

        document.body.appendChild(top);
        document.body.appendChild(rail);
        document.body.appendChild(backdrop);

        var root = document.documentElement;
        function isMobile() { return window.matchMedia("(max-width: 860px)").matches; }

        document.getElementById("tcvBurger").addEventListener("click", function () {
            if (isMobile()) {
                var open = !rail.classList.contains("open");
                rail.classList.toggle("open", open);
                backdrop.classList.toggle("open", open);
            } else {
                root.classList.toggle("tcv-collapsed");
            }
        });
        backdrop.addEventListener("click", function () {
            rail.classList.remove("open");
            backdrop.classList.remove("open");
        });
        var railClose = document.getElementById("tcvRailClose");
        if (railClose) railClose.addEventListener("click", function () {
            rail.classList.remove("open");
            backdrop.classList.remove("open");
        });

        if (user) {
            function doLogout(e) {
                e.preventDefault();
                fetch("/logout", { method: "POST" }).then(function () {
                    try { if (window.TailorCVAuth) window.TailorCVAuth.clearUser(); } catch (e) {}
                    window.location.href = "/login";
                }).catch(function () { window.location.href = "/login"; });
            }
            var logout = document.getElementById("tcvLogout");
            if (logout) logout.addEventListener("click", doLogout);
            var pLogout = document.getElementById("tcvProfileLogout");
            if (pLogout) pLogout.addEventListener("click", doLogout);
        }
    }

    function applyProStatus(isPro) {
        // Avatar badge
        var btn = document.getElementById("tcvAvatarBtn");
        if (btn && isPro && !btn.querySelector(".tcv-pro-badge")) {
            var badge = document.createElement("span");
            badge.className = "tcv-pro-badge";
            badge.textContent = "Pro";
            btn.appendChild(badge);
        }
        // Profile menu links
        var linksDiv = document.getElementById("tcvProLinks");
        if (!linksDiv) return;
        if (isPro) {
            linksDiv.innerHTML =
                '<span class="tcv-pf-link" style="color:#7dd3fc;font-weight:700;cursor:default;">Pro ✓</span>'
                + '<a class="tcv-pf-link" href="/manage-subscription">Manage subscription</a>';
        } else {
            linksDiv.innerHTML = '<a class="tcv-pf-link" href="/pricing">Upgrade to Pro</a>';
        }

        // Inject badge style if needed
        if (!document.getElementById("tcv-pro-badge-style")) {
            var s = document.createElement("style");
            s.id = "tcv-pro-badge-style";
            s.textContent =
                ".tcv-pro-badge{position:absolute;top:-5px;right:-7px;background:linear-gradient(135deg,#2563eb,#0ea5e9);" +
                "color:#fff;font-size:.56rem;font-weight:800;letter-spacing:.04em;border-radius:999px;" +
                "padding:1px 5px;line-height:1.5;pointer-events:none;}" +
                "#tcvAvatarBtn{position:relative;}";
            document.head.appendChild(s);
        }
    }

    function fetchProStatus() {
        fetch("/api/auth/me", { headers: { "X-Requested-With": "XMLHttpRequest" } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (d) applyProStatus(!!d.is_pro);
            })
            .catch(function () {});
    }

    if (document.body) { build(); if (user) fetchProStatus(); }
    else document.addEventListener("DOMContentLoaded", function () { build(); if (user) fetchProStatus(); });
})();
