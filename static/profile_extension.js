/* The profile is the Chrome extension's page (Nov 2026; logged-in /extension
   redirects to /profile). This is its "Resume template" row: the design every
   resume the extension tailors downloads in. "Choose template" opens the list
   of real previews beneath the row; picking one saves it and closes the list.

   Saved through POST /api/extension/base-resume, which stores template, style
   and cover-letter design together — so the saved cover design is sent back
   unchanged. That endpoint refuses when no resume is on file; then the
   template still saves through /api/preferences/template. */
(function () {
  "use strict";

  var btn = document.getElementById("pf-ext-template-btn");
  var picker = document.getElementById("pf-ext-template-picker");
  var grid = document.getElementById("pf-ext-template-grid");
  if (!btn || !picker || !grid) return;

  var tplInput = document.getElementById("pf-ext-template-id");
  var styleInput = document.getElementById("pf-ext-style-id");
  var coverInput = document.getElementById("pf-ext-cover-template");
  var nameEl = document.getElementById("pf-ext-template-name");
  var statusEl = document.getElementById("pf-ext-template-status");

  // The names the templates gallery shows.
  var NAMES = {
    1: "ATS Friendly Classic", 2: "Modern Minimal", 3: "Professional Clean", 4: "Executive Edge",
    5: "Corporate Blue", 6: "Compact One-Page", 7: "Fresh Graduate", 8: "Skill Spotlight",
    9: "Chronological Pro", 10: "Creative Balanced", 11: "Elegant Serif", 12: "Impact Resume",
    13: "Tech Specialist", 14: "Data Analyst Pro", 15: "Product Manager Fit", 16: "Marketing Highlight",
    17: "Modern ATS Plus", 18: "Premium Executive", 19: "LaTeX Academic", 20: "ATS Friendly",
    21: "Modern Tech", 22: "Academic Serif"
  };
  var loaded = false;

  function nameOf(id) { return NAMES[id] || ("Template " + id); }

  function csrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function say(text, isError) {
    statusEl.textContent = text || "";
    statusEl.classList.toggle("pf-err", !!isError);
  }

  function errorText(data, fallback) {
    if (typeof tcvErrorMessage === "function") return tcvErrorMessage(data, fallback);
    return (data && typeof data.detail === "string" && data.detail) || fallback;
  }

  function save() {
    var fd = new FormData();
    fd.set("template_id", tplInput.value || "1");
    fd.set("style_id", styleInput.value || "1");
    fd.set("cover_template", (coverInput && coverInput.value) || "classic");
    return fetch("/api/extension/base-resume", {
      method: "POST", body: fd, credentials: "same-origin",
      headers: { "X-CSRFToken": csrfToken() }
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 400) {
        // No resume on file yet: the template alone.
        return fetch("/api/preferences/template", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
          body: JSON.stringify({ template_id: Number(tplInput.value || 1) })
        }).then(function (r2) { return { ok: r2.ok, status: r2.status }; });
      }
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { ok: false, status: r.status, data: data };
      });
    });
  }

  function mark(id) {
    tplInput.value = String(id);
    nameEl.textContent = nameOf(id);
    Array.prototype.forEach.call(grid.querySelectorAll(".pf-tpl"), function (c) {
      var on = c.getAttribute("data-id") === String(id);
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // The picker opens over the page. It lives under <body>: inside the cards a
  // backdrop-filter ancestor would trap a position:fixed overlay in the card.
  var closeBtn = document.getElementById("pf-ext-template-close");
  document.body.appendChild(picker);

  function setOpen(open) {
    picker.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    document.documentElement.classList.toggle("pf-modal-open", open);
    if (open) {
      if (!loaded) load();
      if (closeBtn) closeBtn.focus();
    } else {
      btn.focus();
    }
  }
  if (closeBtn) closeBtn.addEventListener("click", function () { setOpen(false); });
  picker.addEventListener("click", function (e) { if (e.target === picker) setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !picker.hidden) setOpen(false);
  });

  function choose(id) {
    var before = tplInput.value;
    if (String(id) === before) { setOpen(false); return; }
    mark(id);
    setOpen(false);
    say("Saving…");
    save().then(function (res) {
      if (res.ok) return say("Saved — tailored resumes download in " + nameOf(id) + ".");
      mark(before);
      say(res.status === 401 ? "Your session expired. Please log in again."
                             : errorText(res.data, "Could not save. Please try again."), true);
    }).catch(function () {
      mark(before);
      say("Could not save. Please try again.", true);
    });
  }

  // The real previews the templates gallery uses, fetched the first time the list opens.
  function load() {
    loaded = true;
    grid.textContent = "Loading…";
    fetch("/api/resume-templates", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { templates: [] }; })
      .catch(function () { return { templates: [] }; })
      .then(function (data) {
        grid.textContent = "";
        (data.templates || []).forEach(function (t) {
          var card = document.createElement("button");
          card.type = "button";
          card.className = "pf-tpl";
          card.setAttribute("data-id", String(t.id));
          var shot = document.createElement("span");
          shot.className = "pf-tpl-shot";
          var img = document.createElement("img");
          img.src = "/static/pic" + encodeURIComponent(t.id) + ".webp?v=9";
          img.alt = "";
          img.loading = "lazy";
          img.decoding = "async";
          shot.appendChild(img);
          var label = document.createElement("span");
          label.className = "pf-tpl-name";
          label.textContent = NAMES[t.id] || t.name || ("Template " + t.id);
          card.appendChild(shot);
          card.appendChild(label);
          card.addEventListener("click", function () { choose(t.id); });
          grid.appendChild(card);
        });
        if (!grid.children.length) {
          loaded = false;   // try again next time it opens
          say("Could not load the templates. Please try again.", true);
          setOpen(false);
          return;
        }
        mark(tplInput.value || 1);
      });
  }

  btn.addEventListener("click", function () { setOpen(true); });
  nameEl.textContent = nameOf(tplInput.value || 1);
})();
