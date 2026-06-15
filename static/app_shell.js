/* Logged-in app shell: a top bar + persistent sidebar on tool pages (Jobscan-style).
   Loaded everywhere via _nav.html but only activates for a logged-in user on a
   known tool page — marketing pages and logged-out visitors stay untouched. */
(function () {
    // /dashboard already has its own sidebar, so it's intentionally excluded.
    var APP_PREFIXES = [
        "/solutions", "/ats-analysis", "/optimize", "/modify-cv", "/cover-letter",
        "/auto-apply", "/my-resumes", "/interview-prep", "/mock-interview",
        "/optimized-editor", "/templates"
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

    var user = getUser();
    if (!user || !isAppPage()) return;

    // Flag <html> early so the CSS hides the marketing navbar with minimal flash.
    document.documentElement.classList.add("tcv-app");

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
        out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>')
    };
    var LINKS = [
        ["/dashboard", IC.home, "Home"],
        ["/modify-cv", IC.cv, "Resume Builder"],
        ["/optimize", IC.opt, "AI Optimize (Resume + JD)"],
        ["/solutions", IC.ats, "Get ATS Score"],
        ["/cover-letter", IC.mail, "Cover Letter"],
        ["/my-resumes", IC.folder, "My Resumes"],
        ["/templates", IC.grid, "Templates"],
        ["/interview-prep", IC.help, "Interview Prep"],
        ["/mock-interview", IC.mic, "Mock Interview"]
    ];

    function build() {
        var here = path();
        var initial = ((user.name || user.email || "U").trim().charAt(0) || "U").toUpperCase();

        // Top bar
        var top = document.createElement("header");
        top.className = "tcv-top";
        function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
        top.innerHTML =
            '<button class="tcv-burger" id="tcvBurger" aria-label="Toggle menu" title="Collapse menu">☰</button>'
            + '<a class="tcv-top-logo" href="/dashboard"><img src="/static/logo6.png" alt="theTailorCV"></a>'
            + '<div class="tcv-top-right">'
            + '<div class="tcv-profile">'
            +   '<button class="tcv-avatar" aria-haspopup="true" aria-expanded="false">' + initial + '</button>'
            +   '<div class="tcv-profile-menu">'
            +     '<div class="tcv-profile-head"><span class="tcv-pf-av">' + initial + '</span>'
            +       '<div class="tcv-pf-id"><strong>' + esc(user.name || "User") + '</strong><small>' + esc(user.email || "") + '</small></div></div>'
            +     '<a class="tcv-pf-link" href="/pricing">Get free scans</a>'
            +     '<a class="tcv-pf-link" href="/pricing">Account Settings</a>'
            +     '<a class="tcv-pf-link" href="/privacy">Privacy Policy</a>'
            +     '<a class="tcv-pf-link" href="/terms">Terms</a>'
            +     '<a class="tcv-pf-link" href="#" id="tcvProfileLogout">Log out</a>'
            +   '</div>'
            + '</div>'
            + '</div>';

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
        rail.innerHTML =
            '<button class="tcv-rail-close" id="tcvRailClose" aria-label="Close menu" title="Close">&times;</button>'
            + '<nav class="tcv-rail-nav">' + items + '</nav>'
            + '<div class="tcv-rail-foot"><a class="tcv-rail-link" href="#" id="tcvLogout" aria-label="Logout">'
            + '<span class="tcv-rail-ic">' + IC.out + '</span><span class="tcv-rail-tip">Logout</span></a></div>';

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

    if (document.body) build();
    else document.addEventListener("DOMContentLoaded", build);
})();
