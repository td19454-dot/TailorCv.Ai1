/* First-run setup for Auto Apply Job (templates/onboarding.html).

   The profile, one step at a time: resume, education, experience, work
   authorization, EEO, skills, personal, links. Each step is drawn from the
   profile model (saved values, else what the resume suggests) and saved with
   POST /api/profile — the same request and validation the profile page uses —
   so nothing here is stored differently. The resume goes through
   POST /api/extension/base-resume and is then read once
   (POST /api/profile/resume-projects), and the steps after it open pre-filled.
   Finishing, or skipping, lands on /profile. */
(function () {
  "use strict";

  var D = window.TCV_ONBOARDING || {};
  var fields = D.fields || {};
  var OPT = D.options || {};
  var STEPS = ["resume", "documents", "education", "experience", "authorization", "eeo", "skills", "personal", "links"];
  var COPY = {
    resume: ["Let's set up your profile.",
             "This takes about 5 minutes. Everything is saved as you go, so leave anything blank and come back later."],
    documents: ["Pick your resume template and cover letter.",
                "Every resume the extension tailors downloads in this template, and the cover letter is attached when an application asks for one."],
    education: ["Let's start with your education.",
                "Most recent first. Years only — “To” can be your expected graduation year."],
    experience: ["Now, your work experience.",
                 "The more detail here, the better your tailored resumes and filled applications."],
    authorization: ["Next, work authorization.",
                    "Applications ask these on almost every form. Autofill only ever answers them from here — never guessed."],
    eeo: ["Equal employment information.",
          "Voluntary. Left as “Not set”, forms are answered “Decline to self-identify”."],
    skills: ["Show off your skills.",
             "Every skill here can be added to the skill boxes on application forms."],
    personal: ["Almost there — a few last questions.",
               "Your date of birth is only filled into forms that ask for it, and never sent to the AI."],
    links: ["Last step: your links.",
            "Paste the full link or just your username — either works."]
  };

  var $ = function (id) { return document.getElementById(id); };
  var body = $("ob-body"), errEl = $("ob-error"), nextBtn = $("ob-next"), skipBtn = $("ob-skip");
  var step = STEPS.indexOf(D.step) >= 0 ? D.step : "resume";
  var pendingFile = null;

  function csrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function val(key) { var f = fields[key]; return f ? f.value : ""; }
  function showError(text) { errEl.textContent = text || ""; errEl.hidden = !text; }
  function detail(data, fallback) {
    if (data && typeof data.detail === "string") return data.detail;
    if (data && Array.isArray(data.detail) && data.detail.length) return data.detail.map(function (d) { return d.msg; }).join(" ");
    return fallback;
  }

  // ── saving ─────────────────────────────────────────────────
  function saveValues(values) {
    return fetch("/api/profile", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
      body: JSON.stringify({ values: values })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(r.status === 401 ? "Your session expired. Please log in again."
                                                    : detail(data, "Could not save. Please try again."));
        if (data && data.fields) fields = data.fields;
        return data;
      });
    });
  }

  function finish() {
    // Saving nothing still creates the profile, so this setup isn't shown again.
    nextBtn.disabled = skipBtn.disabled = true;
    saveValues({}).catch(function () { /* the profile page still opens */ })
      .then(function () { location.href = "/profile"; });
  }

  function go(next) {
    showError("");
    if (next >= STEPS.length) { finish(); return; }
    step = STEPS[next];
    history.replaceState(null, "", "/onboarding?step=" + step);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── small builders ─────────────────────────────────────────
  function input(id, label, value, attrs) {
    return '<label class="ob-field"><span>' + esc(label) + '</span><input id="' + id + '" value="' + esc(value) + '"' + (attrs || "") + '></label>';
  }
  function select(id, label, options, value) {
    return '<label class="ob-field"><span>' + esc(label) + '</span><select id="' + id + '">' +
      (options || []).map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? " selected" : "") + '>' + esc(o[1]) + '</option>';
      }).join("") + '</select></label>';
  }
  function yesNo(key, question) {
    var v = val(key);
    return '<div class="ob-q" data-key="' + key + '"><span>' + esc(question) + '</span><div class="ob-choice">' +
      ["yes", "no"].map(function (c) {
        return '<button type="button" class="ob-pick' + (v === c ? " on" : "") + '" data-v="' + c + '">' + (c === "yes" ? "Yes" : "No") + '</button>';
      }).join("") + '</div></div>';
  }
  function picks() {
    var out = {};
    Array.prototype.forEach.call(body.querySelectorAll(".ob-q"), function (q) {
      var on = q.querySelector(".ob-pick.on");
      out[q.getAttribute("data-key")] = on ? on.getAttribute("data-v") : "";
    });
    return out;
  }

  // ── list editors (education, experience) ───────────────────
  var LISTS = {
    education: {
      key: "educationHistory", noun: "Education",
      cols: [["school", "School or university", "wide"], ["degree", "Degree", ""], ["field", "Field of study", ""],
             ["from", "From (year)", "", "2023"], ["to", "To (year)", "", "2027"], ["gpa", "GPA / %", "", "8.5/10"]]
    },
    experience: {
      key: "workExperience", noun: "Work experience",
      cols: [["title", "Position title", "wide"], ["company", "Company", ""], ["location", "Location", ""],
             ["from", "Start (MM/YYYY)", "", "06/2024"], ["to", "End (MM/YYYY)", "", "05/2025"],
             ["current", "I currently work here", "check"], ["description", "Description", "area"]]
    }
  };

  function entryHtml(spec, e, n) {
    return '<div class="ob-entry"><div class="ob-entry-head"><b>' + spec.noun + ' ' + (n + 1) + '</b>' +
      '<button type="button" class="ob-del" aria-label="Remove">' +
      '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></div>' +
      '<div class="ob-grid">' + spec.cols.map(function (c) {
        var v = e[c[0]];
        if (c[2] === "check") {
          return '<label class="ob-check wide"><input type="checkbox" data-f="' + c[0] + '"' + (v ? " checked" : "") + '> ' + esc(c[1]) + '</label>';
        }
        if (c[2] === "area") {
          return '<label class="ob-field wide"><span>' + esc(c[1]) + '</span><textarea data-f="' + c[0] + '" rows="5">' + esc(v) + '</textarea></label>';
        }
        return '<label class="ob-field' + (c[2] === "wide" ? " wide" : "") + '"><span>' + esc(c[1]) + '</span>' +
          '<input data-f="' + c[0] + '" value="' + esc(v) + '" placeholder="' + esc(c[3] || "") + '"></label>';
      }).join("") + '</div></div>';
  }

  function listHtml(spec) {
    var entries = val(spec.key);
    if (!Array.isArray(entries) || !entries.length) entries = [{}];
    return '<div class="ob-list" data-list="' + spec.key + '">' + entries.map(function (e, n) { return entryHtml(spec, e, n); }).join("") + '</div>' +
      '<button type="button" class="ob-add">+ Add ' + spec.noun.toLowerCase() + '</button>';
  }

  function readList(spec) {
    return Array.prototype.map.call(body.querySelectorAll(".ob-entry"), function (node) {
      var e = {};
      spec.cols.forEach(function (c) {
        var el = node.querySelector('[data-f="' + c[0] + '"]');
        if (!el) return;
        e[c[0]] = c[2] === "check" ? el.checked : el.value.trim();
      });
      return e;
    }).filter(function (e) {
      return Object.keys(e).some(function (k) { return k !== "current" && e[k]; });
    });
  }

  function wireList(spec) {
    function renumber() {
      Array.prototype.forEach.call(body.querySelectorAll(".ob-entry-head b"), function (b, n) { b.textContent = spec.noun + " " + (n + 1); });
    }
    body.addEventListener("click", function (e) {
      var del = e.target.closest(".ob-del");
      if (del) { del.closest(".ob-entry").remove(); renumber(); return; }
      if (e.target.closest(".ob-add")) {
        var list = body.querySelector(".ob-list");
        list.insertAdjacentHTML("beforeend", entryHtml(spec, {}, list.children.length));
        var first = list.lastElementChild.querySelector("input");
        if (first) first.focus();
      }
    });
  }

  // ── steps ──────────────────────────────────────────────────
  var STEP = {
    resume: {
      html: function () {
        var on = D.hasResume
          ? '<div class="ob-file"><div><b>Resume on file</b><small>' + esc(D.resumeFilename) +
            (D.resumeUploaded ? " · uploaded " + esc(D.resumeUploaded) : "") + '</small></div></div>'
          : "";
        return '<div class="ob-grid">' + input("ob-first", "First name", val("firstName")) + input("ob-last", "Last name", val("lastName")) + '</div>' +
          '<h3 class="ob-sub">Upload your resume</h3>' +
          '<div class="ob-note">We read your resume and fill in the next steps from it. PDF only, up to 10 MB.</div>' + on +
          '<label class="ob-drop" id="ob-drop"><input type="file" id="ob-file" accept="application/pdf,.pdf" hidden>' +
          '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 17v-6M9 14l3-3 3 3"/></svg>' +
          '<b id="ob-drop-text">' + (D.hasResume ? "Continue, or upload a new resume" : "Click to upload or drag and drop") + '</b>' +
          '<small>PDF up to 10 MB</small></label>' +
          '<button type="button" class="ob-link" id="ob-skip-all">Skip setup for now →</button>';
      },
      wire: function () {
        var drop = $("ob-drop"), file = $("ob-file");
        function take(f) {
          if (!f) return;
          if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { showError("Please upload a PDF."); return; }
          if (f.size > 10 * 1024 * 1024) { showError("That PDF is over 10 MB — please upload a smaller file."); return; }
          showError("");
          pendingFile = f;
          $("ob-drop-text").textContent = "✓ " + f.name;
          drop.classList.add("has-file");
        }
        file.addEventListener("change", function () { take(file.files && file.files[0]); });
        ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
        ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
        drop.addEventListener("drop", function (e) { take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
        $("ob-skip-all").addEventListener("click", finish);
      },
      save: function () {
        if (!pendingFile && !D.hasResume) return Promise.reject(new Error("Upload your resume, or skip this step."));
        return saveValues({ firstName: $("ob-first").value.trim(), lastName: $("ob-last").value.trim() })
          .then(function () { return pendingFile ? uploadAndRead(pendingFile) : null; });
      }
    },
    documents: {
      html: function () {
        var cover = D.hasCover
          ? '<div class="ob-file"><div><b>Cover letter on file</b><small>' + esc(D.coverFilename) +
            ' · attached when an application asks for one</small></div></div>'
          : '<div class="ob-note">No cover letter yet. Upload your own below — or skip, and one is written from your resume when you upload it.</div>';
        return '<h3 class="ob-sub ob-sub-first">Resume template</h3>' +
          '<div class="ob-tpls" id="ob-tpls"><p class="ob-muted">Loading templates…</p></div>' +
          '<h3 class="ob-sub">Cover letter</h3>' + cover +
          '<label class="ob-drop ob-drop-sm" id="ob-cl-drop"><input type="file" id="ob-cl-file" accept="application/pdf,.pdf" hidden>' +
          '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 17v-6M9 14l3-3 3 3"/></svg>' +
          '<b id="ob-cl-text">' + (D.hasCover ? "Upload your own cover letter instead (optional)" : "Upload your cover letter") + '</b>' +
          '<small>PDF up to 10 MB</small></label>';
      },
      wire: function () {
        var NAMES = {
          1: "ATS Friendly Classic", 2: "Modern Minimal", 3: "Professional Clean", 4: "Executive Edge",
          5: "Corporate Blue", 6: "Compact One-Page", 7: "Fresh Graduate", 8: "Skill Spotlight",
          9: "Chronological Pro", 10: "Creative Balanced", 11: "Elegant Serif", 12: "Impact Resume",
          13: "Tech Specialist", 14: "Data Analyst Pro", 15: "Product Manager Fit", 16: "Marketing Highlight",
          17: "Modern ATS Plus", 18: "Premium Executive", 19: "LaTeX Academic", 20: "ATS Friendly",
          21: "Modern Tech", 22: "Academic Serif"
        };
        var grid = $("ob-tpls");
        STEP.documents.chosen = String(D.templateId || 1);
        function mark() {
          Array.prototype.forEach.call(grid.querySelectorAll(".ob-tpl"), function (c) {
            var on = c.getAttribute("data-id") === STEP.documents.chosen;
            c.classList.toggle("on", on);
            c.setAttribute("aria-pressed", on ? "true" : "false");
          });
        }
        fetch("/api/resume-templates", { credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.json() : { templates: [] }; })
          .catch(function () { return { templates: [] }; })
          .then(function (data) {
            grid.innerHTML = (data.templates || []).map(function (t) {
              return '<button type="button" class="ob-tpl" data-id="' + esc(t.id) + '">' +
                '<span class="ob-tpl-shot"><img src="/static/pic' + encodeURIComponent(t.id) + '.webp?v=9" alt="" loading="lazy" decoding="async"></span>' +
                '<span class="ob-tpl-name">' + esc(NAMES[t.id] || t.name || ("Template " + t.id)) + '</span></button>';
            }).join("") || '<p class="ob-muted">Could not load the templates — you can pick one later on your profile.</p>';
            mark();
          });
        grid.addEventListener("click", function (e) {
          var c = e.target.closest(".ob-tpl");
          if (c) { STEP.documents.chosen = c.getAttribute("data-id"); mark(); }
        });

        var drop = $("ob-cl-drop"), file = $("ob-cl-file");
        STEP.documents.cover = null;
        function take(f) {
          if (!f) return;
          if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { showError("Please upload the cover letter as a PDF."); return; }
          if (f.size > 10 * 1024 * 1024) { showError("That PDF is over 10 MB — please upload a smaller file."); return; }
          showError("");
          STEP.documents.cover = f;
          $("ob-cl-text").textContent = "✓ " + f.name;
          drop.classList.add("has-file");
        }
        file.addEventListener("change", function () { take(file.files && file.files[0]); });
        ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
        ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
        drop.addEventListener("drop", function (e) { take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
      },
      save: function () {
        var id = STEP.documents.chosen || String(D.templateId || 1);
        var saveTemplate;
        if (D.hasResume) {
          var fd = new FormData();
          fd.set("template_id", id);
          fd.set("style_id", String(D.styleId || 1));
          fd.set("cover_template", D.coverTemplate || "classic");
          saveTemplate = fetch("/api/extension/base-resume", {
            method: "POST", body: fd, credentials: "same-origin", headers: { "X-CSRFToken": csrfToken() }
          });
        } else {
          saveTemplate = fetch("/api/preferences/template", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
            body: JSON.stringify({ template_id: Number(id) })
          });
        }
        return saveTemplate.then(function (r) {
          if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) {
            throw new Error(detail(d, "Could not save your template. Please try again."));
          });
          D.templateId = Number(id);
          var f = STEP.documents.cover;
          if (!f) return null;
          var cf = new FormData();
          cf.set("file", f);
          return fetch("/api/dashboard/base-cover-letter/upload", {
            method: "POST", body: cf, credentials: "same-origin", headers: { "X-CSRFToken": csrfToken() }
          }).then(function (r2) {
            return r2.json().catch(function () { return {}; }).then(function (d) {
              if (!r2.ok) throw new Error(detail(d, "Could not upload your cover letter. Please try again."));
              D.hasCover = true; D.coverFilename = f.name;
            });
          });
        });
      }
    },
    education: {
      html: function () { return listHtml(LISTS.education); },
      wire: function () { wireList(LISTS.education); },
      save: function () { return saveValues({ educationHistory: readList(LISTS.education) }); }
    },
    experience: {
      html: function () {
        return '<label class="ob-check"><input type="checkbox" id="ob-first-job"> I\'m looking for my first job (no prior experience)</label>' + listHtml(LISTS.experience);
      },
      wire: function () {
        wireList(LISTS.experience);
        $("ob-first-job").addEventListener("change", function () {
          var off = this.checked;
          Array.prototype.forEach.call(body.querySelectorAll(".ob-list, .ob-add"), function (n) { n.hidden = off; });
        });
      },
      save: function () {
        return saveValues({ workExperience: $("ob-first-job").checked ? [] : readList(LISTS.experience) });
      }
    },
    authorization: {
      html: function () {
        return yesNo("workAuthorized", "Are you authorized to work in the countries you apply to?") +
          yesNo("requiresSponsorship", "Will you now or in the future need visa sponsorship?") +
          '<div class="ob-grid">' + select("ob-nationality", "Country of citizenship", OPT.country, val("nationality")) + '</div>';
      },
      wire: wirePicks,
      save: function () {
        var p = picks();
        return saveValues({ workAuthorized: p.workAuthorized, requiresSponsorship: p.requiresSponsorship,
                            nationality: $("ob-nationality").value });
      }
    },
    eeo: {
      html: function () {
        return '<div class="ob-grid">' +
          select("ob-gender", "Gender", OPT.gender, val("gender")) +
          select("ob-race", "Race / ethnicity", OPT.race, val("raceEthnicity")) +
          select("ob-veteran", "Veteran status", OPT.veteran, val("veteranStatus")) +
          select("ob-disability", "Disability", OPT.disability, val("disabilityStatus")) +
          select("ob-lgbtq", "Do you identify as LGBTQ+?", OPT.lgbtq, val("lgbtqIdentity")) + '</div>';
      },
      save: function () {
        return saveValues({ gender: $("ob-gender").value, raceEthnicity: $("ob-race").value,
                            veteranStatus: $("ob-veteran").value, disabilityStatus: $("ob-disability").value,
                            lgbtqIdentity: $("ob-lgbtq").value });
      }
    },
    skills: {
      html: function () {
        return '<label class="ob-field wide"><span>What skills do you have or enjoy working with?</span>' +
          '<div class="ob-combo"><input id="ob-skill-input" placeholder="Search all skills…" autocomplete="off" ' +
          'role="combobox" aria-expanded="false" aria-controls="ob-skill-list" aria-autocomplete="list">' +
          '<svg class="ob-combo-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
          '<ul class="ob-combo-list" id="ob-skill-list" role="listbox" hidden></ul></div></label>' +
          '<h3 class="ob-sub">Selected skills</h3><div class="ob-chips" id="ob-chips"></div>';
      },
      wire: function () {
        var list = String(val("skills") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        var chips = $("ob-chips"), inp = $("ob-skill-input"), menu = $("ob-skill-list");
        var catalog = [], shown = [], active = -1;
        var has = function (s) { return list.some(function (x) { return x.toLowerCase() === s.toLowerCase(); }); };

        function draw() {
          chips.innerHTML = list.length ? list.map(function (s, i) {
            return '<span class="ob-chip">' + esc(s) + '<button type="button" data-i="' + i + '" aria-label="Remove ' + esc(s) + '">×</button></span>';
          }).join("") : '<p class="ob-muted">No skills yet — search above, or type your own and press Enter.</p>';
        }
        function add(s) {
          s = String(s || "").trim();
          if (s && !has(s)) list.push(s);
          draw();
        }
        // The whole list, filtered as you type: names starting with the query first.
        function open() {
          var q = inp.value.trim().toLowerCase();
          var pool = catalog.filter(function (s) { return !has(s); });
          if (q) {
            var starts = pool.filter(function (s) { return s.toLowerCase().indexOf(q) === 0; });
            var inside = pool.filter(function (s) { var i = s.toLowerCase().indexOf(q); return i > 0; });
            pool = starts.concat(inside);
          }
          shown = pool.slice(0, 200);
          active = shown.length ? 0 : -1;
          var custom = q && !catalog.some(function (s) { return s.toLowerCase() === q; }) && !has(inp.value.trim());
          menu.innerHTML = shown.map(function (s, i) {
            return '<li role="option" data-i="' + i + '"' + (i === active ? ' class="on" aria-selected="true"' : "") + '>' + esc(s) + '</li>';
          }).join("") + (custom ? '<li role="option" class="ob-combo-custom" data-custom="1">+ Add “' + esc(inp.value.trim()) + '”</li>' : "") +
            (!shown.length && !custom ? '<li class="ob-combo-empty">No matching skills</li>' : "");
          menu.hidden = false;
          inp.setAttribute("aria-expanded", "true");
        }
        function close() { menu.hidden = true; inp.setAttribute("aria-expanded", "false"); }
        function move(d) {
          var items = menu.querySelectorAll("li[data-i]");
          if (!items.length) return;
          active = (active + d + items.length) % items.length;
          Array.prototype.forEach.call(items, function (li, i) { li.classList.toggle("on", i === active); });
          items[active].scrollIntoView({ block: "nearest" });
        }
        function pick(li) {
          if (!li) return;
          add(li.getAttribute("data-custom") ? inp.value : shown[Number(li.getAttribute("data-i"))]);
          inp.value = "";
          open();
          inp.focus();
        }

        inp.addEventListener("focus", open);
        inp.addEventListener("input", open);
        inp.addEventListener("keydown", function (e) {
          if (e.key === "ArrowDown") { e.preventDefault(); if (menu.hidden) open(); else move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Escape") { close(); }
          else if (e.key === "Enter") {
            e.preventDefault();
            var on = menu.querySelector("li.on");
            if (on && !menu.hidden) pick(on);
            else if (inp.value.trim()) { add(inp.value); inp.value = ""; open(); }
          }
        });
        menu.addEventListener("mousedown", function (e) {
          e.preventDefault();   // keep the focus in the box
          pick(e.target.closest("li[data-i], li[data-custom]"));
        });
        document.addEventListener("click", function (e) { if (!e.target.closest(".ob-combo")) close(); });
        chips.addEventListener("click", function (e) {
          var b = e.target.closest("button[data-i]");
          if (b) { list.splice(Number(b.getAttribute("data-i")), 1); draw(); if (!menu.hidden) open(); }
        });

        fetch("/static/skills_catalog.json?v=1", { credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.json() : []; })
          .catch(function () { return []; })
          .then(function (data) { catalog = Array.isArray(data) ? data : []; if (!menu.hidden) open(); });

        STEP.skills.list = function () { if (inp.value.trim()) { add(inp.value); inp.value = ""; } return list; };
        draw();
      },
      save: function () { return saveValues({ skills: STEP.skills.list().join(", ") }); }
    },
    personal: {
      html: function () {
        var ph = val("phone") || {};
        var today = new Date().toISOString().slice(0, 10);
        return '<div class="ob-grid">' +
          input("ob-location", "Where are you currently located?", val("location"), ' placeholder="City, Country"') +
          input("ob-dob", "Date of birth", val("dateOfBirth"), ' type="date" max="' + today + '"') +
          '<label class="ob-field"><span>Country code</span><input id="ob-code" value="' + esc(ph.code || "") + '" placeholder="+91" maxlength="6" inputmode="tel"></label>' +
          '<label class="ob-field"><span>Phone number</span><input id="ob-phone" value="' + esc(ph.number || "") + '" maxlength="20" inputmode="tel"></label>' +
          '</div>';
      },
      save: function () {
        return saveValues({ location: $("ob-location").value.trim(), dateOfBirth: $("ob-dob").value,
                            phone: { code: $("ob-code").value.trim(), number: $("ob-phone").value.trim() } });
      }
    },
    links: {
      html: function () {
        return '<div class="ob-grid">' +
          input("ob-li", "LinkedIn", val("linkedinUrl"), ' placeholder="linkedin.com/in/…"') +
          input("ob-gh", "GitHub", val("githubUrl"), ' placeholder="github.com/…"') +
          input("ob-pf", "Portfolio / website", val("portfolioUrl"), ' placeholder="https://…"') + '</div>';
      },
      save: function () {
        return saveValues({ linkedinUrl: $("ob-li").value.trim(), githubUrl: $("ob-gh").value.trim(),
                            portfolioUrl: $("ob-pf").value.trim() });
      }
    }
  };

  function wirePicks() {
    body.addEventListener("click", function (e) {
      var b = e.target.closest(".ob-pick");
      if (!b) return;
      var on = b.classList.contains("on");
      Array.prototype.forEach.call(b.parentNode.children, function (x) { x.classList.remove("on"); });
      if (!on) b.classList.add("on");
    });
  }

  // ── resume: upload, then read it once, then the next steps open pre-filled ──
  function uploadAndRead(f) {
    var fd = new FormData();
    fd.set("file", f);
    fd.set("template_id", String(D.templateId || 1));
    fd.set("style_id", String(D.styleId || 1));
    fd.set("cover_template", D.coverTemplate || "classic");
    $("ob-card").hidden = true;
    $("ob-parse").hidden = false;
    var pct = 0, fill = $("ob-parse-fill"), label = $("ob-parse-pct");
    var timer = setInterval(function () {
      pct = Math.min(92, pct + Math.max(0.4, (92 - pct) / 30));
      fill.style.width = pct + "%"; label.textContent = Math.round(pct) + "%";
    }, 400);
    function done() {
      clearInterval(timer);
      fill.style.width = "100%"; label.textContent = "100%";
    }
    return fetch("/api/extension/base-resume", {
      method: "POST", body: fd, credentials: "same-origin", headers: { "X-CSRFToken": csrfToken() }
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) {
        throw new Error(detail(d, "Could not upload your resume. Please try again."));
      });
      // Read once now, so education, experience and skills open filled in.
      return fetch("/api/profile/resume-projects", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() }, body: "{}"
      }).catch(function () { /* the steps still open; the profile page reads it later */ });
    }).then(function () {
      done();
      // Reload on the next step: the page arrives with everything just read.
      location.href = "/onboarding?step=documents";
      return new Promise(function () {});   // navigating away
    }, function (err) {
      done();
      $("ob-parse").hidden = true;
      $("ob-card").hidden = false;
      throw err;
    });
  }

  // ── frame ──────────────────────────────────────────────────
  function render() {
    var i = STEPS.indexOf(step);
    Array.prototype.forEach.call(document.querySelectorAll(".ob-tab"), function (t, n) {
      t.classList.toggle("on", n === i);
      t.classList.toggle("done", n < i);
      if (n === i) t.setAttribute("aria-current", "step"); else t.removeAttribute("aria-current");
    });
    $("ob-title").textContent = COPY[step][0];
    $("ob-tip-text").textContent = COPY[step][1];
    // A fresh body element, so listeners from the previous step don't pile up.
    var fresh = body.cloneNode(false);
    body.parentNode.replaceChild(fresh, body);
    body = fresh;
    body.innerHTML = STEP[step].html();
    if (STEP[step].wire) STEP[step].wire();
    nextBtn.textContent = i === STEPS.length - 1 ? "Finish" : "Save and continue";
    nextBtn.disabled = skipBtn.disabled = false;
  }

  nextBtn.addEventListener("click", function () {
    showError("");
    nextBtn.disabled = skipBtn.disabled = true;
    nextBtn.textContent = "Saving…";
    Promise.resolve().then(function () { return STEP[step].save(); })
      .then(function () { go(STEPS.indexOf(step) + 1); })
      .catch(function (err) {
        showError(err && err.message ? err.message : "Could not save. Please try again.");
        nextBtn.disabled = skipBtn.disabled = false;
        nextBtn.textContent = STEPS.indexOf(step) === STEPS.length - 1 ? "Finish" : "Save and continue";
      });
  });
  skipBtn.addEventListener("click", function () { go(STEPS.indexOf(step) + 1); });
  Array.prototype.forEach.call(document.querySelectorAll(".ob-tab"), function (t) {
    t.addEventListener("click", function () { go(STEPS.indexOf(t.getAttribute("data-step"))); });
  });

  render();
})();
