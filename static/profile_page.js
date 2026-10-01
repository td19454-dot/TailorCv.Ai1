// Profile page: save the form, manage saved answers, keep the extension in sync.
(function () {
  "use strict";

  var form = document.getElementById("pf-form");
  if (!form) return;
  var statusEl = document.getElementById("pf-status");
  var saveBtn = document.getElementById("pf-save");
  var answersEl = document.getElementById("pf-saved-list");
  var answersStatusEl = document.getElementById("pf-answers-status");
  var answersCountEl = document.getElementById("pf-answers-count");

  // Every JSON write echoes the csrftoken cookie as X-CSRFToken — the server's
  // double-submit check rejects a JSON POST without it.
  function csrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function jsonHeaders() {
    return { "Content-Type": "application/json", "X-CSRFToken": csrfToken() };
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "pf-status" + (kind ? " pf-" + kind : "");
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

  // ── tabs ───────────────────────────────────────────────────
  // "Your details" is the applicant's own profile; "Saved answers" holds
  // answers remembered from specific forms, which are mostly employer-specific
  // and would otherwise bury the profile. #saved-answers opens the second tab.

  function showTab(name) {
    ["details", "answers"].forEach(function (t) {
      var on = t === name;
      var tab = document.getElementById("pf-tab-" + t);
      tab.classList.toggle("on", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      document.getElementById("pf-panel-" + t).hidden = !on;
    });
  }

  document.getElementById("pf-tab-details").addEventListener("click", function () {
    showTab("details");
    history.replaceState(null, "", location.pathname);
  });
  document.getElementById("pf-tab-answers").addEventListener("click", function () {
    showTab("answers");
    history.replaceState(null, "", "#saved-answers");
  });
  document.addEventListener("click", function (e) {
    var link = e.target.closest("a[data-tab]");
    if (!link) return;
    e.preventDefault();
    document.getElementById("pf-tab-" + link.getAttribute("data-tab")).click();
  });
  if (location.hash === "#saved-answers") showTab("answers");

  // ── job and school lists: one card per entry, in Workday's shapes ──
  // Work: My Experience (title, company, location, From/To as MM/YYYY, "I
  // currently work here", role description). Education: School or University,
  // Degree, Field of Study, From/To as years.

  var MONTH_YEAR = /^(0[1-9]|1[0-2])\/\d{4}$/;
  var YEAR = /^(19|20)\d{2}$/;

  function escAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function input(f, label, value, attrs) {
    return '<label>' + label + '<input data-f="' + f + '" value="' + escAttr(value) + '" ' + (attrs || "") + '></label>';
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
    education: {
      noun: "school",
      fields: ["school", "degree", "field", "from", "to"],
      render: function (s) {
        return input("school", "School or university", s.school, 'maxlength="200"') +
          input("degree", "Degree", s.degree, 'maxlength="120" list="pf-degrees" placeholder="e.g. Bachelor of Technology (B.Tech)"') +
          input("field", "Field of study", s.field, 'maxlength="120" list="pf-fields" placeholder="e.g. Chemical Engineering"') +
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

  Array.prototype.forEach.call(form.querySelectorAll(".pf-exp-list[data-list]"), function (listEl) {
    var kind = listEl.getAttribute("data-list");
    var wrap = listEl.closest(".jd-field");
    var entries = [];
    try { entries = JSON.parse(wrap.querySelector(".pf-list-data").textContent) || []; } catch (e) { entries = []; }
    if (!entries.length) entries = [{}];
    entries.forEach(function (x) { listEl.appendChild(entryCard(kind, x)); });

    wrap.querySelector(".pf-exp-add").addEventListener("click", function () {
      var card = entryCard(kind, {});
      listEl.appendChild(card);
      card.querySelector("input").focus();
      form.dispatchEvent(new Event("change"));
    });
    listEl.addEventListener("click", function (e) {
      if (!e.target.classList.contains("pf-job-remove")) return;
      e.target.closest(".pf-job").remove();
      if (!listEl.querySelector(".pf-job")) listEl.appendChild(entryCard(kind, {}));
      form.dispatchEvent(new Event("change"));
    });
    listEl.addEventListener("change", function (e) {
      if (e.target.getAttribute("data-f") === "current") syncCurrent(e.target.closest(".pf-job"));
    });
    // Work dates: "012026" or "1/2026" typed → 01/2026.
    if (kind === "experience") {
      listEl.addEventListener("blur", function (e) {
        var f = e.target.getAttribute && e.target.getAttribute("data-f");
        if (f !== "from" && f !== "to") return;
        var m = e.target.value.trim().match(/^(\d{1,2})\s*[\/.\-]?\s*(\d{4})$/);
        if (m && +m[1] >= 1 && +m[1] <= 12) e.target.value = (m[1].length === 1 ? "0" : "") + m[1] + "/" + m[2];
      }, true);
    }
  });

  // ── collecting the form ────────────────────────────────────

  function collect() {
    var values = {};
    Array.prototype.forEach.call(form.querySelectorAll(".jd-field[data-key]"), function (wrap) {
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

  // Everything on screen is sent, suggested values included: saving is how a
  // suggestion becomes the user's confirmed answer.
  var initial = JSON.stringify(collect());
  var dirty = false;

  form.addEventListener("input", function (e) {
    var wrap = e.target.closest(".jd-field");
    if (wrap) wrap.classList.add("pf-dirty");
    dirty = JSON.stringify(collect()) !== initial;
    if (dirty) setStatus("Unsaved changes");
  });
  form.addEventListener("change", function () {
    dirty = JSON.stringify(collect()) !== initial;
    if (dirty) setStatus("Unsaved changes");
  });

  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

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
    var schools = values.educationHistory || [];
    for (var j = 0; j < schools.length; j++) {
      if (schools[j].from && !YEAR.test(schools[j].from)) return "School " + (j + 1) + ": From should be a year, like 2023.";
      if (schools[j].to && !YEAR.test(schools[j].to)) return "School " + (j + 1) + ": To should be a year, like 2027.";
      if (schools[j].from && schools[j].to && schools[j].from > schools[j].to) return "School " + (j + 1) + ": From is after To.";
    }
    return "";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var values = collect();
    var problem = validate(values);
    if (problem) { setStatus(problem, "err"); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    setStatus("");
    fetch("/api/profile", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ values: values }),
    })
      .then(function (r) {
        if (r.status === 401) { window.location.href = "/login?next=/profile"; return null; }
        return r.json().then(function (body) { return { ok: r.ok, body: body }; });
      })
      .then(function (res) {
        if (!res) return;
        if (!res.ok) {
          var d = res.body && res.body.detail;
          setStatus(typeof d === "string" ? d : "Couldn't save. Try again.", "err");
          return;
        }
        initial = JSON.stringify(collect());
        dirty = false;
        // Everything visible is now saved, so no value is a suggestion any more.
        Array.prototype.forEach.call(form.querySelectorAll(".pf-badge-suggested, .pf-dirty"),
          function (n) {
            if (n.classList.contains("pf-dirty")) n.classList.remove("pf-dirty");
            else n.remove();
          });
        var banner = document.querySelector(".pf-banner:not(.pf-banner-warn)");
        if (banner && /Suggested/.test(banner.textContent)) banner.remove();
        notifyExtension();
        setStatus("✓ Saved. Autofill will use these details from now on.", "ok");
      })
      .catch(function () { setStatus("Couldn't save. Check your connection and try again.", "err"); })
      .then(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save profile";
      });
  });

  // ── saved answers ──────────────────────────────────────────

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

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
    answersEl.innerHTML = list.map(function (a) {
      return '<div class="pf-answer" data-id="' + a.id + '">' +
        '<div class="pf-answer-q">' + esc(a.question) + '</div>' +
        '<div class="pf-answer-row">' +
          '<textarea maxlength="2000" aria-label="Answer">' + esc(a.answer) + '</textarea>' +
          '<div class="pf-answer-actions">' +
            '<button type="button" class="pf-mini pf-ans-save" disabled>Save</button>' +
            '<button type="button" class="pf-mini pf-mini-danger pf-ans-del">Forget</button>' +
          '</div>' +
        '</div></div>';
    }).join("");
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

  // Saved answers are managed here, not by the main Save button — they are a
  // separate store and each edit applies on its own. They sit outside every
  // .jd-field[data-key], so collect() never includes them.

  answersEl.addEventListener("click", function (e) {
    var card = e.target.closest(".pf-answer");
    if (!card) return;
    var id = card.getAttribute("data-id");
    if (e.target.classList.contains("pf-ans-save")) {
      var btn = e.target;
      btn.disabled = true;
      btn.textContent = "Saving…";
      fetch("/api/profile/answers/" + id, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ answer: card.querySelector("textarea").value.trim() }),
      })
        .then(function (r) {
          return r.json().then(function (b) { return { ok: r.ok, body: b }; });
        })
        .then(function (res) {
          btn.textContent = res.ok ? "✓ Saved" : "Save";
          if (res.ok) { setAnswersStatus(""); notifyExtension(); }
          else {
            btn.disabled = false;
            setAnswersStatus((res.body && res.body.detail) || "Couldn't save that answer.", "err");
          }
        })
        .catch(function () { btn.disabled = false; btn.textContent = "Save"; });
    } else if (e.target.classList.contains("pf-ans-del")) {
      if (!window.confirm("Forget this answer? Autofill will ask you again next time.")) return;
      fetch("/api/profile/answers/" + id, { method: "DELETE", headers: jsonHeaders() })
        .then(function (r) {
          if (r.ok) { card.remove(); notifyExtension(); }
          else setAnswersStatus("Couldn't forget that answer. Try again.", "err");
          if (!answersEl.querySelector(".pf-answer")) renderAnswers([]);
          else updateCount();
        });
    }
  });

  loadAnswers();
})();
