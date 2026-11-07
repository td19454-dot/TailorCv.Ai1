// Profile page: read-only cards with per-card editing, the career-hub panels,
// profile strength, saved answers, and keeping the extension in sync.
(function () {
  "use strict";

  var form = document.getElementById("pf-form");
  if (!form) return;
  var answersEl = document.getElementById("pf-saved-list");
  var answersStatusEl = document.getElementById("pf-answers-status");
  var answersCountEl = document.getElementById("pf-answers-count");
  var hasResume = form.getAttribute("data-has-resume") === "true";

  // Every JSON write echoes the csrftoken cookie as X-CSRFToken — the server's
  // double-submit check rejects a JSON POST without it.
  function csrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function jsonHeaders() {
    return { "Content-Type": "application/json", "X-CSRFToken": csrfToken() };
  }

  // Tell the Chrome extension its cached copy of the profile is stale, so the
  // next autofill uses these values rather than a copy up to ten minutes old.
  function notifyExtension() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    (window.TAILORCV_EXTENSION_IDS || []).forEach(function (id) {
      try {
        chrome.runtime.sendMessage(id, { type: "tailorcv-profile-updated" }, function () {
          void chrome.runtime.lastError;
        });
      } catch (e) { /* extension not installed */ }
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var escAttr = esc;
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  var toastEl = document.getElementById("pf-toast");
  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  // ── hubs (left-hand "career hub" panels) ───────────────────
  // #personal and #preferences open those panels; #saved-answers keeps working
  // as the link the extension uses. A #pf-<section> link opens that section's hub.

  var HUB_HASH = { profile: "", personal: "#personal", preferences: "#preferences", answers: "#saved-answers" };

  function showHub(name, keepHash) {
    if (!(name in HUB_HASH)) name = "profile";
    each(document.querySelectorAll("[data-hub-panel]"), function (p) {
      p.hidden = p.getAttribute("data-hub-panel") !== name;
    });
    each(document.querySelectorAll(".pf-hub a[data-hub]"), function (a) {
      var on = a.getAttribute("data-hub") === name;
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (!keepHash) history.replaceState(null, "", location.pathname + HUB_HASH[name]);
    if (name === "answers") refreshAnswers();
  }

  function hubOfSection(sid) {
    var card = document.getElementById("pf-" + sid);
    var panel = card && card.closest("[data-hub-panel]");
    return panel ? panel.getAttribute("data-hub-panel") : "profile";
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest("a[data-hub]");
    if (!link) return;
    e.preventDefault();
    showHub(link.getAttribute("data-hub"));
    var main = document.querySelector(".pf-main");
    if (main && main.getBoundingClientRect().top < 0) main.scrollIntoView({ behavior: "smooth" });
  });

  // ── job and school lists: one card per entry, in Workday's shapes ──
  // Work: My Experience (title, company, location, From/To as MM/YYYY, "I
  // currently work here", role description). Education: School or University,
  // Degree, Field of Study, From/To as years.

  var MONTH_YEAR = /^(0[1-9]|1[0-2])\/\d{4}$/;
  var YEAR = /^(19|20)\d{2}$/;

  function input(f, label, value, attrs) {
    return '<label><span>' + label + '</span><input data-f="' + f + '" value="' + escAttr(value) + '" ' + (attrs || "") + '></label>';
  }

  // Degree as a dropdown of actual degrees (routers/profile_page.py
  // DEGREE_GROUPS); autofill turns each into what a given employer's list calls
  // it. A degree saved before this, or read from the resume, that is not in the
  // list stays selectable as "(saved)" so saving never drops it.
  function degreeSelect(value) {
    var groups = window.TAILORCV_DEGREE_GROUPS || [];
    var current = String(value || "");
    var known = groups.some(function (g) { return g[1].indexOf(current) !== -1; });
    var opt = function (v, text) {
      return '<option value="' + escAttr(v) + '"' + (v === current ? " selected" : "") + ">" + escAttr(text) + "</option>";
    };
    var html = opt("", "Select your degree");
    if (current && !known) html += opt(current, current + " (saved)");
    groups.forEach(function (g) {
      html += '<optgroup label="' + escAttr(g[0]) + '">' +
        g[1].map(function (d) { return opt(d, d); }).join("") + "</optgroup>";
    });
    return '<label>Degree<select data-f="degree">' + html + "</select></label>";
  }

  // Field of study as Workday's own list (routers/profile_page.py
  // FIELD_OF_STUDY_OPTIONS), spelled as Workday spells it so autofill puts an
  // option there verbatim. A value saved before this stays as "(saved)".
  function fieldSelect(value) {
    var options = window.TAILORCV_FIELD_OPTIONS || [];
    var current = String(value || "");
    var opt = function (v, text) {
      return '<option value="' + escAttr(v) + '"' + (v === current ? " selected" : "") + ">" + escAttr(text) + "</option>";
    };
    var html = opt("", "Select your field of study");
    if (current && options.indexOf(current) === -1) html += opt(current, current + " (saved)");
    html += options.map(function (f) { return opt(f, f); }).join("");
    return '<label>Field of study<select data-f="field">' + html + "</select></label>";
  }

  var LISTS = {
    experience: {
      noun: "job",
      fields: ["title", "company", "location", "from", "to", "description"],
      render: function (job) {
        return input("title", "Job title", job.title, 'maxlength="160"') +
          input("company", "Company", job.company, 'maxlength="160"') +
          input("location", "Location", job.location, 'maxlength="160" placeholder="City, State, Country"') +
          '<div class="pf-job-dates">' +
            input("from", "From", job.from, 'maxlength="7" placeholder="MM/YYYY" inputmode="numeric"') +
            input("to", "To", job.to, 'maxlength="7" placeholder="MM/YYYY" inputmode="numeric"') +
          '</div>' +
          '<label class="pf-check"><input type="checkbox" data-f="current"' + (job.current ? " checked" : "") +
            '><span>I currently work here</span></label>' +
          '<label>Role description<textarea data-f="description" maxlength="5000" rows="5">' +
            escAttr(job.description) + '</textarea></label>';
      },
    },
    projects: {
      noun: "project",
      fields: ["name", "role", "url", "from", "to", "description"],
      render: function (p) {
        return input("name", "Project name", p.name, 'maxlength="160"') +
          input("role", "Your role <small class=\"pf-help\">(optional)</small>", p.role, 'maxlength="160" placeholder="e.g. Lead developer"') +
          input("url", "Link <small class=\"pf-help\">(optional)</small>", p.url, 'maxlength="300" placeholder="github.com/you/project"') +
          '<div class="pf-job-dates">' +
            input("from", "From", p.from, 'maxlength="7" placeholder="MM/YYYY" inputmode="numeric"') +
            input("to", "To", p.to, 'maxlength="7" placeholder="MM/YYYY" inputmode="numeric"') +
          '</div>' +
          '<label class="pf-check"><input type="checkbox" data-f="current"' + (p.current ? " checked" : "") +
            '><span>Ongoing</span></label>' +
          '<label>Description<textarea data-f="description" maxlength="5000" rows="5">' +
            escAttr(p.description) + '</textarea></label>';
      },
    },
    education: {
      noun: "school",
      fields: ["school", "degree", "field", "gpa", "from", "to"],
      // In the order and words of Workday's Education block, which autofill
      // fills from these: School or University, Degree, Field of Study,
      // Overall Result (GPA), From, To (Actual or Expected).
      render: function (s) {
        return input("school", "School or university", s.school, 'maxlength="200"') +
          degreeSelect(s.degree) +
          fieldSelect(s.field) +
          input("gpa", "CGPA / percentage", s.gpa, 'maxlength="20" placeholder="e.g. 8.7 CGPA or 85%"') +
          '<div class="pf-job-dates">' +
            input("from", "From", s.from, 'maxlength="4" placeholder="YYYY" inputmode="numeric"') +
            input("to", "To (actual or expected)", s.to, 'maxlength="4" placeholder="YYYY" inputmode="numeric"') +
          '</div>';
      },
    },
  };

  function entryCard(kind, entry) {
    var card = document.createElement("div");
    card.className = "pf-job";
    card.innerHTML = '<button type="button" class="pf-job-remove" aria-label="Remove this ' + LISTS[kind].noun +
      '" title="Remove this ' + LISTS[kind].noun + '">✕</button>' + LISTS[kind].render(entry || {});
    syncCurrent(card);
    return card;
  }

  // "I currently work here" means there is no end date.
  function syncCurrent(card) {
    var box = card.querySelector('[data-f="current"]');
    if (!box) return;
    var to = card.querySelector('[data-f="to"]');
    to.disabled = box.checked;
    if (box.checked) to.value = "";
  }

  function fillList(listEl, entries) {
    var kind = listEl.getAttribute("data-list");
    listEl.innerHTML = "";
    (entries && entries.length ? entries : [{}]).forEach(function (x) {
      listEl.appendChild(entryCard(kind, x));
    });
  }

  function readList(listEl) {
    var spec = LISTS[listEl.getAttribute("data-list")];
    return Array.prototype.map.call(listEl.querySelectorAll(".pf-job"), function (card) {
      var entry = {};
      spec.fields.forEach(function (f) {
        entry[f] = (card.querySelector('[data-f="' + f + '"]').value || "").trim();
      });
      var box = card.querySelector('[data-f="current"]');
      if (box) entry.current = box.checked;
      return entry;
    }).filter(function (entry) {
      return spec.fields.some(function (f) { return entry[f]; });
    });
  }

  each(form.querySelectorAll(".pf-exp-list[data-list]"), function (listEl) {
    var kind = listEl.getAttribute("data-list");
    var wrap = listEl.closest(".jd-field");
    var entries = [];
    try { entries = JSON.parse(wrap.querySelector(".pf-list-data").textContent) || []; } catch (e) { entries = []; }
    fillList(listEl, entries);

    wrap.querySelector(".pf-exp-add").addEventListener("click", function () {
      var card = entryCard(kind, {});
      listEl.appendChild(card);
      card.querySelector("input").focus();
      listEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
    listEl.addEventListener("click", function (e) {
      if (!e.target.classList.contains("pf-job-remove")) return;
      e.target.closest(".pf-job").remove();
      if (!listEl.querySelector(".pf-job")) listEl.appendChild(entryCard(kind, {}));
      listEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
    listEl.addEventListener("change", function (e) {
      if (e.target.getAttribute("data-f") === "current") syncCurrent(e.target.closest(".pf-job"));
    });
    // Work dates: "012026" or "1/2026" typed → 01/2026.
    if (kind === "experience" || kind === "projects") {
      listEl.addEventListener("blur", function (e) {
        var f = e.target.getAttribute && e.target.getAttribute("data-f");
        if (f !== "from" && f !== "to") return;
        var m = e.target.value.trim().match(/^(\d{1,2})\s*[\/.\-]?\s*(\d{4})$/);
        if (m && +m[1] >= 1 && +m[1] <= 12) e.target.value = (m[1].length === 1 ? "0" : "") + m[1] + "/" + m[2];
      }, true);
    }
  });

  // ── reading and writing a card's fields ────────────────────

  // The values under `root` (one card, or the whole form). Suggested values are
  // included: saving is how a suggestion becomes the user's confirmed answer.
  function collect(root) {
    var values = {};
    each(root.querySelectorAll(".jd-field[data-key]"), function (wrap) {
      var key = wrap.getAttribute("data-key");
      if (key === "email") return;   // read-only: the account email
      var listEl = wrap.querySelector(".pf-exp-list[data-list]");
      if (listEl) { values[key] = readList(listEl); return; }
      if (key === "phone") {
        values.phone = {
          code: (form.elements.phoneCode.value || "").trim(),
          number: (form.elements.phoneNumber.value || "").trim(),
        };
        return;
      }
      var el = form.elements[key];
      if (!el) return;
      values[key] = el.type === "checkbox" ? el.checked : (el.value || "").trim();
    });
    return values;
  }

  // Put values back (Cancel): the inverse of collect().
  function apply(root, values) {
    each(root.querySelectorAll(".jd-field[data-key]"), function (wrap) {
      var key = wrap.getAttribute("data-key");
      if (!(key in values)) return;
      var listEl = wrap.querySelector(".pf-exp-list[data-list]");
      if (listEl) { fillList(listEl, values[key]); return; }
      if (key === "phone") {
        form.elements.phoneCode.value = values.phone.code;
        form.elements.phoneNumber.value = values.phone.number;
        return;
      }
      var el = form.elements[key];
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!values[key]; else el.value = values[key];
    });
  }

  function validate(values) {
    var code = values.phone && values.phone.code;
    if (code && !/^\+?\d{1,4}$/.test(code)) return "The country code should look like +91.";
    var number = values.phone && values.phone.number;
    if (number && !/^[\d\s\-()]{4,20}$/.test(number)) {
      return "Enter the phone number without the country code, digits only.";
    }
    if (number && /^\+/.test(number)) return "Put the country code in its own box.";
    var jobs = values.workExperience || [];
    for (var i = 0; i < jobs.length; i++) {
      if (jobs[i].from && !MONTH_YEAR.test(jobs[i].from)) return "Job " + (i + 1) + ": From should look like 01/2026.";
      if (jobs[i].to && !MONTH_YEAR.test(jobs[i].to)) return "Job " + (i + 1) + ": To should look like 04/2026.";
    }
    var projects = values.projects || [];
    for (var k = 0; k < projects.length; k++) {
      if (projects[k].from && !MONTH_YEAR.test(projects[k].from)) return "Project " + (k + 1) + ": From should look like 01/2026.";
      if (projects[k].to && !MONTH_YEAR.test(projects[k].to)) return "Project " + (k + 1) + ": To should look like 04/2026.";
    }
    var schools = values.educationHistory || [];
    for (var j = 0; j < schools.length; j++) {
      if (schools[j].from && !YEAR.test(schools[j].from)) return "School " + (j + 1) + ": From should be a year, like 2023.";
      if (schools[j].to && !YEAR.test(schools[j].to)) return "School " + (j + 1) + ": To should be a year, like 2027.";
      if (schools[j].from && schools[j].to && schools[j].from > schools[j].to) return "School " + (j + 1) + ": From is after To.";
    }
    return "";
  }

  // ── read-only views ────────────────────────────────────────

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthYear(v) {
    var m = MONTH_YEAR.exec(v || "");
    return m ? MONTHS[+v.slice(0, 2) - 1] + " " + v.slice(3) : (v || "");
  }
  // A missing end shows the start alone ("Feb 2026"), never "Feb 2026 – ?".
  function span(from, to) {
    if (from && to) return from + " – " + to;
    return from || to || "";
  }
  function hue(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    return h;
  }
  // Company logos: we only have the name, so guess the website from it
  // ("Freelancer Technology" → freelancer.com, "Berger Paints Pvt Ltd" →
  // bergerpaints.com) and ask Google's favicon service for its icon. A wrong
  // guess comes back as Google's tiny default globe, so anything under 32px is
  // dropped and the coloured initial stays.
  var NAME_NOISE = /\b(pvt|private|ltd|limited|inc|llc|llp|plc|corp|corporation|co|company|group|technology|technologies|solutions|services|india|global|international|the)\b\.?/g;
  function logoDomain(company) {
    var c = String(company || "").toLowerCase().replace(/&/g, " and ");
    var site = c.match(/\b([a-z0-9-]+\.(?:com|io|ai|co|in|org|net|dev|app))\b/);
    if (site) return site[1];
    var slug = c.replace(NAME_NOISE, " ").replace(/[^a-z0-9]+/g, "");
    return slug.length >= 2 && slug.length <= 40 ? slug + ".com" : "";
  }
  // A website the user typed wins over the guess: "https://www.x.co/about" → x.co.
  function siteDomain(url) {
    var m = /^(?:[a-z]+:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(String(url || "").trim());
    return m ? m[1].toLowerCase() : "";
  }
  function logo(name, company, website) {
    var t = (name || "?").trim();
    var d = siteDomain(website) || logoDomain(company);
    return '<span class="pf-logo" style="--h:' + hue(t) + '" aria-hidden="true">' + esc(t.charAt(0).toUpperCase() || "?") +
      (d ? '<img class="pf-logo-img" alt="" loading="lazy" referrerpolicy="no-referrer" data-domain="' + esc(d) +
        '" src="https://' + esc(d) + '/apple-touch-icon.png">' : "") + '</span>';
  }
  // Sharpness first: a site's apple-touch-icon is a ~180px square made to be
  // shown full-bleed, so it fills the tile. Without one, Google's favicon —
  // often only 16–48px — is used only if it's at least 64px, and shown whole
  // on white rather than stretched or cropped. Smaller than that would look
  // smudged, so the coloured initial stays instead.
  function wireLogos(root) {
    each(root.querySelectorAll("img.pf-logo-img"), function (img) {
      var tile = img.parentNode, stage = "touch";
      function next() {
        if (stage === "touch") {
          stage = "favicon";
          img.src = "https://www.google.com/s2/favicons?sz=128&domain=" + encodeURIComponent(img.getAttribute("data-domain"));
        } else {
          img.remove();
        }
      }
      function loaded() {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (stage === "touch" && w >= 100 && Math.abs(w - h) <= w * 0.1) {
          tile.classList.add("has-img");
        } else if (stage === "favicon" && w >= 64) {
          tile.classList.add("has-img", "pf-logo-fit");
        } else {
          next();
        }
      }
      img.addEventListener("load", loaded);
      img.addEventListener("error", next);
      if (img.complete) { if (img.naturalWidth) loaded(); else next(); }
    });
  }
  function chips(list) {
    list = list.filter(Boolean);
    return list.length ? '<div class="pf-chips">' + list.map(function (c) {
      return '<span class="pf-chip">' + esc(c) + '</span>';
    }).join("") + '</div>' : "";
  }
  // PDF text keeps the page's line breaks, so one bullet can arrive as several
  // lines. Same rule as auto_apply/resume_facts.py join_wrapped_lines: a line
  // that ends a sentence starts the next bullet; one that stops mid-phrase, is
  // followed by lowercase, or ran the page's full width carries on. A line with
  // its own bullet symbol always starts a new bullet.
  var HANGING_END = /([,;:(&\/\-–]|\b(and|or|of|the|to|for|with|in|on|via|by|a|an|across|using|from|into|at))$/i;
  function continues(prev, cur) {
    if (/[.!?]$/.test(prev)) return false;
    if (/^[a-z]/.test(cur)) return true;
    if (HANGING_END.test(prev)) return true;
    return prev.length >= 70;
  }
  function bulletLines(text) {
    var out = [];
    String(text || "").split(/\n+/).forEach(function (raw) {
      var line = raw.trim();
      var m = /^[•\-*–·▪●◦]\s*/.exec(line);
      var body = (m ? line.slice(m[0].length) : line).trim();
      if (!body) return;
      if (out.length && !m && continues(out[out.length - 1], body)) out[out.length - 1] += " " + body;
      else out.push(body);
    });
    return out;
  }
  function bullets(text) {
    var lines = bulletLines(text);
    if (!lines.length) return "";
    if (lines.length === 1) return '<p class="pf-desc">' + esc(lines[0]) + '</p>';
    return '<ul class="pf-desc">' + lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>";
  }
  function emptyLine(text) { return '<p class="pf-empty">' + esc(text) + '</p>'; }
  var DASH = '<span class="pf-dash">—</span>';
  var BRIEFCASE = '<span class="pf-logo pf-logo-job" aria-hidden="true"><svg viewBox="0 0 24 24">' +
    '<rect x="2.75" y="7" width="18.5" height="13.5" rx="2.25"/><path d="M8.75 7V4.75a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V7"/>' +
    '<path d="M2.75 12.25c3 1.5 6 2.25 7.75 2.4M21.25 12.25c-3 1.5-6 2.25-7.75 2.4"/><rect x="10.5" y="12.75" width="3" height="3" rx=".6"/></svg></span>';
  function viewJobs(jobs) {
    if (!jobs.length) return emptyLine("No work experience added yet.");
    return jobs.map(function (j) {
        return '<article class="pf-entry">' + BRIEFCASE +
          '<div class="pf-entry-body"><h3>' + esc(j.title || "Untitled role") + '</h3>' +
          (j.company ? '<p class="pf-entry-org">' + esc(j.company) + '</p>' : "") +
          chips([j.location, span(monthYear(j.from), j.current ? "Present" : monthYear(j.to))]) +
          bullets(j.description) + '</div></article>';
      }).join("");
  }

  function viewProjects(projects) {
    if (!projects.length) return emptyLine("No projects added");
    return projects.map(function (p) {
      var h = href(p.url);
      return '<article class="pf-entry">' +
        '<span class="pf-logo pf-logo-proj" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>' +
        '<div class="pf-entry-body"><h3>' + esc(p.name || "Untitled project") + '</h3>' +
        (p.role ? '<p class="pf-entry-org">' + esc(p.role) + '</p>' : "") +
        chips([span(monthYear(p.from), p.current ? "Present" : monthYear(p.to))]) +
        (p.url ? '<p class="pf-proj-link">' + (h ? '<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(p.url) + '</a>' : esc(p.url)) + '</p>' : "") +
        bullets(p.description) + '</div></article>';
    }).join("");
  }

  // A school's result, labelled the way it was given: "85" or "85%" is a
  // percentage, up to 10 is a CGPA (Indian 10-point scale), "3.6/4" stays as
  // typed with "GPA". Anything else ("First class") is shown unchanged.
  function gradeLabel(raw) {
    var g = String(raw || "").trim();
    if (!g) return "";
    if (/%$/.test(g) || /percent/i.test(g)) return g.replace(/\s*(percent(age)?)\s*$/i, "%").replace(/\s+%$/, "%");
    if (/^(cgpa|gpa|sgpa)\b/i.test(g)) return g.replace(/^(\w+)\s*[:\-]?\s*/, function (m, w) { return w.toUpperCase() + " "; });
    var m = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/.exec(g);
    if (!m) return g;
    var n = parseFloat(m[1]), out = m[2] ? parseFloat(m[2]) : 0;
    if (out === 10 || (!out && n <= 10)) return "CGPA " + g.replace(/\s+/g, "");
    if (out === 4 || out === 5) return "GPA " + g.replace(/\s+/g, "");
    if (out === 100 || (!out && n > 10 && n <= 100)) return m[1] + "%";
    return g;
  }

  // `fallback` is the single GPA box: autofill uses it for the first (most
  // recent) school when that school's own result is empty, so it's shown there.
  function viewSchools(schools, fallback) {
    if (!schools.length) return emptyLine("No education added yet.");
    return schools.map(function (s, i) {
      return '<article class="pf-entry">' +
        '<span class="pf-logo pf-logo-edu" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/></svg></span>' +
        '<div class="pf-entry-body"><h3>' + esc(s.school || "Untitled school") + '</h3>' +
        chips([span(s.from, s.to), s.degree, s.field, gradeLabel(s.gpa || (i === 0 ? fallback : ""))]) + '</div></article>';
    }).join("");
  }

  var LINK_TILES = {
    linkedinUrl: { cls: "li", ico: '<b>in</b>' },
    githubUrl: { cls: "gh", ico: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>' },
    portfolioUrl: { cls: "pf", ico: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>' },
  };
  function href(url) {
    var u = String(url || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : "";
  }

  // Skills grouped under the resume's own headings ("Languages", "AI/ML"…),
  // as the resume lists them. The list itself is the saved/edited one: a skill
  // the user added that no heading holds goes under "Other skills", and a
  // heading whose skills were all removed is dropped.
  function chipRow(list) {
    return '<div class="pf-chips pf-skill-chips">' + list.map(function (s) {
      return '<span class="pf-chip">' + esc(s) + '</span>'; }).join("") + '</div>';
  }
  function skillRows(skills) {
    var groups = (window.TAILORCV_SKILL_GROUPS || []).filter(function (g) { return g && g.category; });
    if (!groups.length) return chipRow(skills);
    var left = skills.slice(), rows = [];
    function take(name) {
      var i = left.map(function (s) { return s.toLowerCase(); }).indexOf(String(name).toLowerCase());
      return i === -1 ? null : left.splice(i, 1)[0];
    }
    groups.forEach(function (g) {
      var mine = (g.skills || []).map(take).filter(Boolean);
      if (mine.length) rows.push([g.category, mine]);
    });
    if (left.length) rows.push([rows.length ? "Other skills" : "", left]);
    return '<div class="pf-skill-groups">' + rows.map(function (r) {
      return '<div class="pf-skill-group">' + (r[0] ? '<h4>' + esc(r[0]) + '</h4>' : "") + chipRow(r[1]) + '</div>';
    }).join("") + '</div>';
  }

  // One field's read-only rendering. Returns { html, wide, tile }.
  function viewField(wrap) {
    var key = wrap.getAttribute("data-key");
    var kind = wrap.getAttribute("data-kind");
    var label = wrap.getAttribute("data-label");
    var badge = "";
    var listEl = wrap.querySelector(".pf-exp-list[data-list]");

    if (listEl) {
      var entries = readList(listEl);
      return { wide: true, raw: true, html: kind === "experience" ? viewJobs(entries)
        : kind === "projects" ? viewProjects(entries)
        : viewSchools(entries, form.elements.gpa ? form.elements.gpa.value.trim() : "") };
    }
    // The single GPA box is shown on the first school's card above, not twice.
    if (key === "gpa") return { raw: true, html: "" };
    // Under the job list an empty "Years of experience —" row is only noise;
    // it shows once set, and stays editable in the card's editor.
    if (key === "yearsExperience" && !(form.elements.yearsExperience.value || "").trim()) return { raw: true, html: "" };
    if (key === "skills") {
      var skills = (form.elements.skills.value || "").split(/[,\n;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!skills.length) return { wide: true, raw: true, html: emptyLine("No skills added yet.") };
      return { wide: true, raw: true, html: skillRows(skills) };
    }
    if (LINK_TILES[key]) {
      var url = (form.elements[key].value || "").trim();
      var h = href(url);
      return { tile: true, html: '<div class="pf-link"><span class="pf-link-ico pf-link-' + LINK_TILES[key].cls + '" aria-hidden="true">' +
        LINK_TILES[key].ico + '</span><div><dt>' + esc(label) + badge + '</dt><dd>' +
        (url ? (h ? '<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' : esc(url)) : DASH) +
        '</dd></div></div>' };
    }
    if (kind === "checkbox") {
      var on = form.elements[key].checked;
      return { wide: true, raw: true, html: '<p class="pf-flag' + (on ? " on" : "") + '"><span aria-hidden="true">' +
        (on ? "✓" : "–") + '</span>' + esc(label) + '<em>' + (on ? "Allowed" : "Off") + '</em></p>' };
    }

    var value = "", muted = false;
    if (key === "phone") {
      var c = form.elements.phoneCode.value.trim(), n = form.elements.phoneNumber.value.trim();
      value = n ? (c ? c + " " : "") + n : "";
    } else if (key === "email") {
      value = (wrap.querySelector("input").value || "").trim();
    } else {
      var el = form.elements[key];
      if (kind === "select") {
        value = el.value ? el.options[el.selectedIndex].text : "";
        // Empty EEO answers say what forms get instead ("Decline to self-identify").
        if (!el.value && el.options[0] && el.options[0].text !== "Not set") { value = el.options[0].text; muted = true; }
      } else if (kind === "date" && el.value) {
        var d = new Date(el.value + "T00:00:00");
        value = isNaN(d) ? el.value : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      } else {
        value = (el.value || "").trim();
      }
    }
    return { wide: kind === "textarea", html: '<dt>' + esc(label) + badge + '</dt><dd' + (muted ? ' class="pf-muted-val"' : "") +
      (kind === "textarea" ? ' style="white-space:pre-line"' : "") + '>' + (value ? esc(value) : DASH) + '</dd>' };
  }

  function renderView(card) {
    var html = "", grid = "", tiles = "";
    function flush() {
      if (grid) html += '<dl class="pf-dl">' + grid + '</dl>';
      if (tiles) html += '<dl class="pf-links">' + tiles + '</dl>';
      grid = ""; tiles = "";
    }
    each(card.querySelectorAll(".jd-field[data-key]"), function (wrap) {
      var v = viewField(wrap);
      if (v.raw) { flush(); html += v.html; return; }
      if (v.tile) { tiles += v.html; return; }
      grid += '<div class="pf-dl-item' + (v.wide ? " wide" : "") + '">' + v.html + '</div>';
    });
    flush();
    var view = card.querySelector(".pf-view");
    view.innerHTML = html;
    wireLogos(view);
  }

  // ── per-card editing, saved automatically ──────────────────
  // A card opened with its pencil saves itself about a second after typing
  // stops, and again when the tab is hidden or closed — nothing typed is lost
  // on a refresh. Only that card's fields are sent (POST /api/profile is
  // partial). "Done" saves anything pending and closes the card.

  var lastSaved = {};   // section id -> JSON of the values last saved (or loaded)
  var timers = {}, inflight = {}, again = {};
  var AUTOSAVE_MS = 900;

  function cardStatus(card, text, kind) {
    var el = card.querySelector(".pf-card-actions .pf-status");
    el.textContent = text || "";
    el.className = "pf-status" + (kind ? " pf-" + kind : "");
  }

  function openEdit(card) {
    var sid = card.getAttribute("data-section");
    if (card.classList.contains("editing")) return;
    // Values only suggested from the resume aren't saved yet: leave the
    // baseline empty so the first save (or Done) confirms them.
    lastSaved[sid] = card.querySelector(".pf-badge-suggested") ? null : JSON.stringify(collect(card));
    card.classList.add("editing");
    card.querySelector(".pf-view").hidden = true;
    card.querySelector(".pf-editor").hidden = false;
    card.querySelector(".pf-edit").hidden = true;
    cardStatus(card, "Changes save automatically");
    var first = card.querySelector(".pf-editor input:not([readonly]):not([type=hidden]), .pf-editor select, .pf-editor textarea");
    if (first) first.focus({ preventScroll: true });
  }

  function closeEdit(card) {
    card.classList.remove("editing");
    card.querySelector(".pf-editor").hidden = true;
    card.querySelector(".pf-view").hidden = false;
    card.querySelector(".pf-edit").hidden = false;
    each(card.querySelectorAll(".pf-dirty"), function (n) { n.classList.remove("pf-dirty"); });
    renderView(card);
  }

  // A card counts as unsaved only after the user changed something in it here.
  // Without that, a card merely left open — in this tab or a forgotten second
  // one — re-sent the values it was opened with whenever the tab was hidden,
  // overwriting what was saved since (Address line 1 typed, then blanked).
  var touched = {};
  function hasUnsaved(card) {
    var sid = card.getAttribute("data-section");
    return !!touched[sid] && (!!timers[sid] || JSON.stringify(collect(card)) !== lastSaved[sid]);
  }

  function openSection(sid) {
    var card = document.getElementById("pf-" + sid);
    if (!card) return;
    showHub(hubOfSection(sid));
    openEdit(card);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scheduleSave(card) {
    var sid = card.getAttribute("data-section");
    clearTimeout(timers[sid]);
    cardStatus(card, "Saving…");
    timers[sid] = setTimeout(function () { save(card); }, AUTOSAVE_MS);
  }

  // Resolves true once the card's current values are on the server.
  function save(card, keepalive) {
    var sid = card.getAttribute("data-section");
    clearTimeout(timers[sid]);
    delete timers[sid];
    var values = collect(card);
    var json = JSON.stringify(values);
    if (json === lastSaved[sid]) {
      cardStatus(card, "✓ All changes saved", "ok");
      return Promise.resolve(true);
    }
    // Half-typed input ("1/202") waits for the user rather than being sent.
    var problem = validate(values);
    if (problem) { cardStatus(card, problem, "err"); return Promise.resolve(false); }
    if (inflight[sid]) { again[sid] = true; return inflight[sid]; }

    cardStatus(card, "Saving…");
    inflight[sid] = fetch("/api/profile", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ values: values }),
      keepalive: !!keepalive,
    })
      .then(function (r) {
        if (r.status === 401) { window.location.href = "/login?next=/profile"; return false; }
        return r.json().then(function (body) {
          if (!r.ok) {
            var d = body && body.detail;
            cardStatus(card, typeof d === "string" ? d : "Couldn't save. Try again.", "err");
            return false;
          }
          lastSaved[sid] = json;
          if (JSON.stringify(collect(card)) === json) touched[sid] = false;
          // Everything in this card is now saved, so none of it is a suggestion any more.
          each(card.querySelectorAll(".pf-editor .pf-badge-suggested"), function (n) { n.remove(); });
          each(card.querySelectorAll(".pf-dirty"), function (n) { n.classList.remove("pf-dirty"); });
          refreshSummary();
          notifyExtension();
          cardStatus(card, "✓ All changes saved", "ok");
          return true;
        });
      })
      .catch(function () {
        cardStatus(card, "Couldn't save — check your connection. It retries when you type.", "err");
        return false;
      })
      .then(function (ok) {
        inflight[sid] = null;
        if (again[sid]) { again[sid] = false; return save(card); }
        return ok;
      });
    return inflight[sid];
  }

  function done(card) {
    var btn = card.querySelector(".pf-save");
    btn.disabled = true;
    save(card).then(function (ok) {
      btn.disabled = false;
      if (ok) { closeEdit(card); toast("✓ Saved. Autofill will use these details from now on."); }
    });
  }

  form.addEventListener("click", function (e) {
    var card = e.target.closest(".pf-card[data-section]");
    if (!card) return;
    if (e.target.closest(".pf-edit")) openEdit(card);
    else if (e.target.closest(".pf-save")) done(card);
  });
  // Enter in a single-line box finishes that card rather than submitting the page.
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT" || e.target.type === "checkbox") return;
    var card = e.target.closest(".pf-card.editing");
    if (!card) return;
    e.preventDefault();
    done(card);
  });

  function onEdit(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var wrap = t.closest(".jd-field");
    if (wrap && e.type === "input") wrap.classList.add("pf-dirty");
    var card = t.closest(".pf-card.editing");
    if (card) { touched[card.getAttribute("data-section")] = true; scheduleSave(card); }
  }
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);

  // Leaving or refreshing: send whatever is pending right away. keepalive lets
  // the request finish after the page is gone.
  function flushAll() {
    each(form.querySelectorAll(".pf-card.editing"), function (card) {
      if (hasUnsaved(card)) save(card, true);
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushAll();
  });
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("beforeunload", function (e) {
    flushAll();
    // Only input that can't be saved yet (it fails validation) is at risk.
    var stuck = Array.prototype.some.call(form.querySelectorAll(".pf-card.editing"), function (card) {
      return !!validate(collect(card)) && hasUnsaved(card);
    });
    if (!stuck) return;
    e.preventDefault();
    e.returnValue = "";
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-open-section]");
    if (b) openSection(b.getAttribute("data-open-section"));
  });

  // ── identity card, strength, banners ───────────────────────

  // Each item is worth its weight when done; weights add up to 100.
  var CHECKS = [
    { label: "Add your resume", weight: 10, section: null,
      done: function () { return hasResume; } },
    { label: "Add your contact info", weight: 10, section: "contact",
      done: function (v) { return !!(v.firstName && v.lastName && v.phone && v.phone.number); } },
    { label: "Add your address", weight: 10, section: "address",
      done: function (v) { return !!(v.city || v.location); } },
    { label: "Add your work experience", weight: 20, section: "work",
      done: function (v) { return (v.workExperience || []).length > 0; } },
    { label: "Add your education journey", weight: 10, section: "education",
      done: function (v) { return (v.educationHistory || []).length > 0; } },
    { label: "Add your skills", weight: 10, section: "skills",
      done: function (v) { return !!v.skills; } },
    { label: "Add your personal links", weight: 10, section: "links",
      done: function (v) { return !!(v.linkedinUrl || v.githubUrl || v.portfolioUrl); } },
    { label: "Fill out your work eligibility", weight: 10, section: "eligibility",
      done: function (v) { return !!(v.workAuthorized && v.requiresSponsorship); } },
    { label: "Fill out your job preferences", weight: 10, section: "availability",
      done: function (v) { return !!(v.remotePreference || v.willingToRelocate || v.noticePeriod || v.expectedSalary); } },
  ];

  function level(pct) {
    if (pct >= 100) return "Autofill ready ✨";
    if (pct >= 70) return "Nearly there 🚀";
    if (pct >= 40) return "Building momentum 🔥";
    return "Getting started 🌱";
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
  }

  // A "location" read from a resume is often the whole contact line —
  // icon-font glyphs, links and the city run together with "•". Keep the place.
  function placeOnly(text) {
    var parts = String(text || "").replace(/[-]/g, "").split(/\s*[•·|]\s*/);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i].trim();
      if (!p || /[@\/]|\.(com|in|io|dev|org|net|me)\b|^\+?[\d\s\-()]{6,}$/i.test(p)) continue;
      return p;
    }
    return "";
  }

  var firstIncomplete = null;

  function refreshSummary() {
    var v = collect(form);

    // Identity card
    var nameEl = document.getElementById("pf-id-name");
    var name = [v.firstName, v.lastName].filter(Boolean).join(" ") || nameEl.getAttribute("data-account-name") || "Your profile";
    nameEl.textContent = name;
    document.getElementById("pf-avatar").textContent = initials(name);
    var job = (v.workExperience || [])[0];
    var head = job ? [job.title, job.company].filter(Boolean).join(" @ ") : "";
    var headEl = document.getElementById("pf-id-head");
    headEl.textContent = head || "Add your current role";
    headEl.classList.toggle("pf-placeholder", !head);
    var loc = [v.city, v.state].filter(Boolean).join(", ") || placeOnly(v.location) || v.country || "";
    var locEl = document.getElementById("pf-id-loc");
    locEl.textContent = loc;
    locEl.hidden = !loc;

    // Strength
    var pct = 0;
    firstIncomplete = null;
    var list = document.getElementById("pf-checklist");
    list.innerHTML = CHECKS.map(function (c, i) {
      var ok = c.done(v);
      if (ok) pct += c.weight;
      else if (!firstIncomplete) firstIncomplete = c;
      return '<li class="' + (ok ? "done" : "") + '"><button type="button" data-check="' + i + '"' +
        (ok ? ' tabindex="-1"' : "") + '><span class="pf-tick" aria-hidden="true">' + (ok ? "✓" : "") + '</span>' +
        '<span class="pf-check-label">' + esc(c.label) + (ok ? '<span class="pf-sr"> (done)</span>' : "") + '</span>' +
        '<span class="pf-weight">+' + c.weight + '%</span></button></li>';
    }).join("");
    document.getElementById("pf-bar-fill").style.width = pct + "%";
    document.getElementById("pf-bar").setAttribute("aria-valuenow", String(pct));
    document.getElementById("pf-pct").textContent = pct + "%";
    document.getElementById("pf-level").textContent = level(pct);

    // Hero banner
    var hero = document.getElementById("pf-hero");
    var complete = pct >= 100;
    hero.classList.toggle("complete", complete);
    document.getElementById("pf-hero-icon").textContent = complete ? "✓" : "!";
    document.getElementById("pf-hero-title").textContent = complete
      ? "Your profile is complete" : "Your profile is " + pct + "% complete";
    document.getElementById("pf-hero-sub").textContent = complete
      ? "Autofill has everything it needs. Keep it up to date and every application uses the latest details."
      : "Finish setting up your profile so autofill fills your job applications more accurately.";
    document.getElementById("pf-finish").hidden = complete;
  }

  function goToCheck(c) {
    if (!c) return;
    if (c.section) openSection(c.section);
    else {
      showHub("profile");
      document.getElementById("pf-resume").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  document.getElementById("pf-checklist").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-check]");
    if (!b || b.closest("li.done")) return;
    goToCheck(CHECKS[+b.getAttribute("data-check")]);
  });
  document.getElementById("pf-finish").addEventListener("click", function () { goToCheck(firstIncomplete); });

  var toggle = document.getElementById("pf-checklist-toggle");
  toggle.addEventListener("click", function () {
    var open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Hide checklist" : "Show checklist");
    document.getElementById("pf-checklist").hidden = !open;
  });
  // On a phone the sidebar sits above the cards; start the checklist folded so
  // the profile itself isn't pushed a screen down.
  if (window.matchMedia("(max-width: 900px)").matches) toggle.click();

  // ── resume upload ──────────────────────────────────────────
  // Same endpoint as the Chrome-extension settings page. It also stores the
  // resume template / style / cover design, and resets them to defaults when
  // they're left out — so the current ones are read first and sent back.
  // The server writes a fresh cover letter before answering (~30 s), then the
  // page reloads so work, education, projects and the letter all reflect the
  // new resume. Open cards have already autosaved by then.

  var resumeCard = document.getElementById("pf-resume");
  var resumeInput = document.getElementById("pf-resume-file");
  var resumeBtn = document.getElementById("pf-resume-btn");
  var resumeStatus = document.getElementById("pf-resume-status");
  var MAX_RESUME_MB = 10;

  function resumeMsg(text, kind) {
    resumeStatus.textContent = text || "";
    resumeStatus.className = "pf-status pf-cover-status" + (kind ? " pf-" + kind : "");
  }

  function uploadResume(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      resumeMsg("Please choose a PDF file.", "err");
      return;
    }
    if (file.size > MAX_RESUME_MB * 1024 * 1024) {
      resumeMsg("That PDF is over " + MAX_RESUME_MB + " MB — please upload a smaller one.", "err");
      return;
    }
    var label = resumeBtn.textContent;
    resumeBtn.disabled = true;
    resumeBtn.textContent = "Uploading…";
    resumeMsg("Uploading " + file.name + " and writing a matching cover letter — about half a minute.");
    fetch("/api/extension/base-resume", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (current) {
        var fd = new FormData();
        fd.set("file", file);
        fd.set("template_id", String(current.template_id || 1));
        fd.set("style_id", String(current.style_id || 1));
        fd.set("cover_template", current.cover_template || "classic");
        return fetch("/api/extension/base-resume", {
          method: "POST", body: fd, credentials: "same-origin",
          headers: { "X-CSRFToken": csrfToken() },
        });
      })
      .then(function (r) {
        if (r.status === 401) { window.location.href = "/login?next=/profile"; return null; }
        return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, body: b }; });
      })
      .then(function (res) {
        if (!res) return;
        if (!res.ok) {
          var d = res.body && res.body.detail;
          resumeMsg(typeof d === "string" ? d : "Couldn't upload your resume. Try again.", "err");
          resumeBtn.disabled = false;
          resumeBtn.textContent = label;
          return;
        }
        notifyExtension();
        try {
          chrome.runtime && (window.TAILORCV_EXTENSION_IDS || []).forEach(function (id) {
            chrome.runtime.sendMessage(id, { type: "tailorcv-base-resume-updated" }, function () { void chrome.runtime.lastError; });
          });
        } catch (e) { /* extension not installed */ }
        resumeMsg("✓ Resume uploaded. Refreshing your profile…", "ok");
        try { sessionStorage.removeItem("pf-resume-reloaded"); } catch (e) { /* storage blocked */ }
        flushAll();
        setTimeout(function () { window.location.reload(); }, 700);
      })
      .catch(function () {
        resumeMsg("Couldn't reach TailorCV. Check your connection and try again.", "err");
        resumeBtn.disabled = false;
        resumeBtn.textContent = label;
      });
  }

  if (resumeBtn && resumeInput) {
    resumeBtn.addEventListener("click", function () { resumeInput.click(); });
    resumeInput.addEventListener("change", function () {
      uploadResume(resumeInput.files && resumeInput.files[0]);
      resumeInput.value = "";
    });
    ["dragenter", "dragover"].forEach(function (t) {
      resumeCard.addEventListener(t, function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") === -1) return;
        e.preventDefault();
        resumeCard.classList.add("pf-drop");
      });
    });
    ["dragleave", "drop"].forEach(function (t) {
      resumeCard.addEventListener(t, function (e) {
        if (t === "dragleave" && resumeCard.contains(e.relatedTarget)) return;
        resumeCard.classList.remove("pf-drop");
      });
    });
    resumeCard.addEventListener("drop", function (e) {
      e.preventDefault();
      if (resumeBtn.disabled) return;
      uploadResume(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  // ── base cover letter ──────────────────────────────────────
  // One LLM call writes a general letter from the base resume and stores it as
  // a PDF (POST /api/dashboard/base-cover-letter/generate). It takes a while,
  // so the button says so and the card updates in place.

  var coverBtn = document.getElementById("pf-cover-btn");
  if (coverBtn) coverBtn.addEventListener("click", function () {
    var status = document.getElementById("pf-cover-status");
    var label = coverBtn.textContent;
    coverBtn.disabled = true;
    coverBtn.textContent = "Writing…";
    status.textContent = "Writing your cover letter from your resume — this takes about half a minute.";
    status.className = "pf-status pf-cover-status";
    fetch("/api/dashboard/base-cover-letter/generate", { method: "POST", headers: jsonHeaders(), body: "{}" })
      .then(function (r) {
        if (r.status === 401) { window.location.href = "/login?next=/profile"; return null; }
        return r.json().then(function (b) { return { ok: r.ok, body: b }; });
      })
      .then(function (res) {
        if (!res) return;
        if (!res.ok) {
          var d = res.body && res.body.detail;
          status.textContent = typeof d === "string" ? d : "Couldn't write the cover letter. Try again.";
          status.className = "pf-status pf-cover-status pf-err";
          coverBtn.textContent = label;
          return;
        }
        var today = new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
        document.getElementById("pf-cover-txt").innerHTML =
          '<strong>Cover letter <span class="pf-tag">Default</span></strong>' +
          '<small>Generated ' + esc(today) + ' · Attached when an application asks for one</small>';
        coverBtn.textContent = "Regenerate";
        status.textContent = "";
        notifyExtension();
        toast("✓ Cover letter ready. Autofill will attach it from now on.");
      })
      .catch(function () {
        status.textContent = "Couldn't reach TailorCV. Check your connection and try again.";
        status.className = "pf-status pf-cover-status pf-err";
        coverBtn.textContent = label;
      })
      .then(function () { coverBtn.disabled = false; });
  });

  // ── saved answers ──────────────────────────────────────────

  function setAnswersStatus(text, kind) {
    answersStatusEl.textContent = text || "";
    answersStatusEl.className = "pf-status" + (kind ? " pf-" + kind : "");
  }

  function updateCount() {
    var n = answersEl.querySelectorAll(".pf-answer").length;
    answersCountEl.textContent = String(n);
    answersCountEl.hidden = !n;
  }

  function renderAnswers(list) {
    renderAnswerList(list);
    updateCount();
  }

  function renderAnswerList(list) {
    if (!list.length) {
      answersEl.innerHTML = '<p class="pf-muted">None yet. When you answer a question in the ' +
        'extension\'s autofill panel with “Remember this answer” ticked, it appears here.</p>';
      return;
    }
    // One card per kind of option list the question was answered over: a
    // form reads the answer kept for its own kind of list, so that is what
    // each card edits (see UserApplyQA.variants).
    answersEl.innerHTML = list.map(function (a) {
      var variants = a.variants || [];
      if (!variants.length) return answerCard(a, a.answer, null);
      return variants.slice().reverse().map(function (v) { return answerCard(a, v.answer, v); }).join("");
    }).join("");
  }

  function listHint(options) {
    var shown = (options || []).map(function (o) {
      return String(o).replace(/^\(?[a-z0-9]{1,2}\)\s+/i, "");
    }).filter(function (o) { return o && !/^(select|choose|please select)/i.test(o); });
    if (!shown.length) return "";
    var more = shown.length > 3 ? ", +" + (shown.length - 3) : "";
    return '<div class="pf-answer-lists">On lists like: ' + esc(shown.slice(0, 3).join(", ")) + esc(more) + '</div>';
  }

  function answerCard(a, answer, v) {
    return '<div class="pf-answer" data-id="' + a.id + '"' +
        (v ? ' data-variant="' + v.index + '" data-was="' + esc(answer) + '"' : '') + '>' +
      '<div class="pf-answer-q">' + esc(a.question) + '</div>' +
      (v ? listHint(v.options) : '') +
      '<div class="pf-answer-row">' +
        '<textarea maxlength="2000" aria-label="Answer">' + esc(answer) + '</textarea>' +
        '<div class="pf-answer-actions">' +
          '<button type="button" class="pf-mini pf-ans-save" disabled>Save</button>' +
          '<button type="button" class="pf-mini pf-mini-danger pf-ans-del">Forget</button>' +
        '</div>' +
      '</div></div>';
  }

  function loadAnswers() {
    fetch("/api/profile/answers")
      .then(function (r) { return r.ok ? r.json() : { answers: [] }; })
      .then(function (data) { renderAnswers(data.answers || []); })
      .catch(function () {
        answersEl.innerHTML = '<p class="pf-muted">Couldn\'t load saved answers.</p>';
      });
  }

  answersEl.addEventListener("input", function (e) {
    var card = e.target.closest(".pf-answer");
    if (card) card.querySelector(".pf-ans-save").disabled = !e.target.value.trim();
  });

  // Saved answers are managed here, not by the profile cards — they are a
  // separate store and each edit applies on its own. They sit outside the
  // form, so collect() never includes them.

  answersEl.addEventListener("click", function (e) {
    var card = e.target.closest(".pf-answer");
    if (!card) return;
    var id = card.getAttribute("data-id");
    var variant = card.getAttribute("data-variant");
    if (e.target.classList.contains("pf-ans-save")) {
      var btn = e.target;
      var answer = card.querySelector("textarea").value.trim();
      var body = { answer: answer };
      if (variant !== null) {
        body.variant = Number(variant);
        body.was = card.getAttribute("data-was");
      }
      btn.disabled = true;
      btn.textContent = "Saving…";
      fetch("/api/profile/answers/" + id, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      })
        .then(function (r) {
          return r.json().then(function (b) { return { ok: r.ok, body: b }; });
        })
        .then(function (res) {
          btn.textContent = res.ok ? "✓ Saved" : "Save";
          if (res.ok) {
            if (variant !== null) card.setAttribute("data-was", answer);
            setAnswersStatus("");
            notifyExtension();
          }
          else {
            btn.disabled = false;
            setAnswersStatus((res.body && res.body.detail) || "Couldn't save that answer.", "err");
          }
        })
        .catch(function () { btn.disabled = false; btn.textContent = "Save"; });
    } else if (e.target.classList.contains("pf-ans-del")) {
      if (!window.confirm("Forget this answer? Autofill will ask you again next time.")) return;
      var query = variant === null ? "" : "?variant=" + encodeURIComponent(variant) +
        "&was=" + encodeURIComponent(card.getAttribute("data-was"));
      fetch("/api/profile/answers/" + id + query, { method: "DELETE", headers: jsonHeaders() })
        .then(function (r) {
          // The question's other cards are numbered after this one: re-read them.
          if (r.ok && variant !== null) { notifyExtension(); loadAnswers(); return; }
          if (r.ok) { card.remove(); notifyExtension(); }
          else setAnswersStatus("Couldn't forget that answer. Try again.", "err");
          if (!answersEl.querySelector(".pf-answer")) renderAnswers([]);
          else updateCount();
        });
    }
  });

  // The extension saves answers while this page sits open in another tab, and
  // a list read once at load showed the old count until a manual refresh.
  // Re-read on return and on opening the panel — unless an answer is mid-edit
  // (its Save is enabled), which a re-render would wipe.
  function refreshAnswers() {
    if (answersEl.querySelector(".pf-ans-save:not([disabled])")) return;
    loadAnswers();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshAnswers();
  });

  // ── projects from the resume ───────────────────────────────
  // The page loads without an LLM call; when the resume hasn't been read for
  // projects yet, ask for it now and fill the Projects card — only if the user
  // has none of their own and isn't editing it. They show as suggestions
  // (unsaved) exactly like work and education read from the resume.
  function loadResumeProjects() {
    if (form.getAttribute("data-needs-parse") !== "true") return;
    var card = document.getElementById("pf-projects");
    if (!card) return;
    var notice = document.getElementById("pf-resume-status");
    if (notice) {
      notice.textContent = "Reading your resume — work, education, projects and links fill in automatically in about half a minute.";
      notice.className = "pf-status pf-cover-status";
    }
    fetch("/api/profile/resume-projects", { method: "POST", headers: jsonHeaders(), body: "{}" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (notice) notice.textContent = "";
        // A fresh read refreshes every card at once — unless the user is in
        // the middle of editing one, when only the Projects card is filled.
        var reloaded = false;
        try { reloaded = sessionStorage.getItem("pf-resume-reloaded") === "1"; } catch (e) { /* storage blocked */ }
        if (data && data.parsed && !reloaded && !form.querySelector(".pf-card.editing")) {
          try { sessionStorage.setItem("pf-resume-reloaded", "1"); } catch (e) { /* storage blocked */ }
          flushAll();
          window.location.reload();
          return;
        }
        var found = data && data.projects;
        if (!found || !found.length || card.classList.contains("editing")) return;
        var listEl = card.querySelector('.pf-exp-list[data-list="projects"]');
        var mine = readList(listEl);
        if (mine.length) {
          // The user's own projects stay as they are, except that a link read
          // from the resume fills one left EMPTY on a project of the same name.
          var key = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); };
          // "TailorCV" here and "TailorCV.ai" on the resume are the same project.
          var withLinks = found.filter(function (p) { return p.url && key(p.name).length >= 4; });
          function linkFor(name) {
            var k = key(name);
            if (k.length < 4) return "";
            var hit = withLinks.filter(function (p) {
              var pk = key(p.name);
              return pk === k || pk.indexOf(k) === 0 || k.indexOf(pk) === 0;
            });
            return hit.length === 1 ? hit[0].url : "";   // ambiguous → leave it empty
          }
          var filled = 0;
          each(listEl.querySelectorAll(".pf-job"), function (entry) {
            var name = entry.querySelector('[data-f="name"]'), url = entry.querySelector('[data-f="url"]');
            var link = name && url && !url.value.trim() ? linkFor(name.value) : "";
            if (link) { url.value = link; filled++; }
          });
          if (filled) { renderView(card); save(card); }
          return;
        }
        fillList(listEl, found);
        var title = card.querySelector(".pf-exp-title");
        if (title && !title.querySelector(".pf-badge-suggested")) {
          title.insertAdjacentHTML("beforeend", '<span class="pf-badge pf-badge-suggested">Suggested</span>');
        }
        renderView(card);
        refreshSummary();
      })
      .catch(function () { if (notice) notice.textContent = ""; /* the cards simply stay as they were */ });
  }

  // ── start ──────────────────────────────────────────────────

  each(form.querySelectorAll(".pf-card[data-section]"), renderView);
  refreshSummary();

  var hash = location.hash.replace(/^#/, "");
  if (hash === "saved-answers") showHub("answers", true);
  else if (hash === "personal" || hash === "preferences" || hash === "profile") showHub(hash, true);
  else if (/^pf-/.test(hash) && document.getElementById(hash)) {
    showHub(hubOfSection(hash.slice(3)), true);
    document.getElementById(hash).scrollIntoView();
  } else showHub("profile", true);
  if (hash !== "saved-answers") loadAnswers();   // for the sidebar count
  loadResumeProjects();
})();
