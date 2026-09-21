// Profile page: save the form, manage saved answers, keep the extension in sync.
(function () {
  "use strict";

  var form = document.getElementById("pf-form");
  if (!form) return;
  var statusEl = document.getElementById("pf-status");
  var saveBtn = document.getElementById("pf-save");
  var answersEl = document.getElementById("pf-answers");

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

  // ── collecting the form ────────────────────────────────────

  function collect() {
    var values = {};
    Array.prototype.forEach.call(form.querySelectorAll(".jd-field[data-key]"), function (wrap) {
      var key = wrap.getAttribute("data-key");
      if (key === "email") return;   // read-only: the account email
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

  function renderAnswers(list) {
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
          if (res.ok) notifyExtension();
          else {
            btn.disabled = false;
            setStatus((res.body && res.body.detail) || "Couldn't save that answer.", "err");
          }
        })
        .catch(function () { btn.disabled = false; btn.textContent = "Save"; });
    } else if (e.target.classList.contains("pf-ans-del")) {
      if (!window.confirm("Forget this answer? Autofill will ask you again next time.")) return;
      fetch("/api/profile/answers/" + id, { method: "DELETE", headers: jsonHeaders() })
        .then(function (r) {
          if (r.ok) { card.remove(); notifyExtension(); }
          if (!answersEl.querySelector(".pf-answer")) renderAnswers([]);
        });
    }
  });

  loadAnswers();
})();
