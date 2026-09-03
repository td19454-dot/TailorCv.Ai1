(function () {
  "use strict";

  var grid = document.getElementById("jd-grid");
  var emptyEl = document.getElementById("jd-empty");
  var statusEl = document.getElementById("jd-status");
  var loadMoreStatusEl = document.getElementById("jd-loadmore-status");
  var sentinel = document.getElementById("jd-sentinel");
  var nudgeEl = document.getElementById("jd-nudge");
  var form = document.getElementById("jd-search-form");
  var qInput = document.getElementById("jd-q");
  var locInput = document.getElementById("jd-location");
  var tabButtons = document.querySelectorAll(".jd-viewtabs button");

  var currentView = "all";
  var currentPage = 1;
  var hasMore = false;
  var isLoading = false;

  // Auto-apply state. Cards are rebuilt on every render, so the button node and
  // the latest known run are tracked per job id rather than held in closures.
  var autoAvailable = true;
  var autoUnavailableReason = "";
  var autoByJobId = {};
  var autoBtnByJobId = {};
  var autoJobById = {};
  var autoPollers = {};
  var autoRemaining = null;

  function setStatus(text) {
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
  }

  function setLoadMoreStatus(text) {
    if (!text) {
      loadMoreStatusEl.hidden = true;
      loadMoreStatusEl.textContent = "";
      return;
    }
    loadMoreStatusEl.hidden = false;
    loadMoreStatusEl.textContent = text;
  }

  function matchTier(score) {
    if (score === null || score === undefined) return null;
    if (score >= 75) return "good";
    if (score >= 45) return "mid";
    return "low";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // "Apply manually" is still just a logged click that opens the posting.
  // Auto-apply no longer logs here — the server writes the application row only
  // when a run actually reaches a terminal outcome, so history can't claim the
  // user applied to something the browser never submitted.
  function logApplication(job, method) {
    fetch("/api/dashboard/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, method: method }),
    }).catch(function () {});
  }

  function onApply(job) {
    logApplication(job, "manual");
    window.open(job.applyUrl, "_blank", "noopener");
  }

  function redirectToLogin() {
    window.location.href = "/login?next=/dashboard/jobs";
  }

  function jsonOrNull(r) {
    return r.json().catch(function () {
      return null;
    });
  }

  // ── Auto-apply ────────────────────────────────────────────────────────────

  var AUTO_LABELS = {
    queued: "Queued…",
    running: "Applying…",
    submitted: "Applied ✓",
    needs_input: "Try again",
    failed: "Retry",
    dry_run: "Dry run done",
  };

  var AUTO_CLASSES = {
    queued: "running",
    running: "running",
    submitted: "done",
    needs_input: "review",
    failed: "failed",
    dry_run: "done",
  };

  function isTerminal(run) {
    return !!run && !!run.terminal;
  }

  function stopPoller(jobId) {
    if (autoPollers[jobId]) {
      clearTimeout(autoPollers[jobId]);
      delete autoPollers[jobId];
    }
  }

  function stopAllPollers() {
    Object.keys(autoPollers).forEach(stopPoller);
  }

  function noteFor(jobId) {
    var btn = autoBtnByJobId[jobId];
    if (!btn) return null;
    var actions = btn.parentNode;
    if (!actions) return null;
    var note = actions.querySelector(".jd-run-note");
    if (!note) {
      note = el("div", "jd-run-note");
      actions.appendChild(note);
    }
    return note;
  }

  function setNote(jobId, text, isError, links) {
    var note = noteFor(jobId);
    if (!note) return;
    note.innerHTML = "";
    note.className = "jd-run-note" + (isError ? " err" : "");
    if (!text) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    note.appendChild(document.createTextNode(text));
    (links || []).forEach(function (link, i) {
      note.appendChild(document.createTextNode(i === 0 ? " " : " · "));
      var a = el("a", null, link.label);
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener";
      note.appendChild(a);
    });
  }

  function paintAuto(jobId) {
    var btn = autoBtnByJobId[jobId];
    if (!btn) return;
    var run = autoByJobId[jobId];
    var job = autoJobById[jobId];

    btn.classList.remove("running", "done", "review", "failed");

    if (!autoAvailable) {
      btn.disabled = true;
      btn.textContent = "Auto-apply";
      btn.title = autoUnavailableReason || "Auto-apply is unavailable right now.";
      return;
    }
    btn.title = "";

    if (!run) {
      btn.disabled = false;
      btn.textContent = "Auto-apply";
      setNote(jobId, "");
      return;
    }

    btn.textContent = AUTO_LABELS[run.status] || "Auto-apply";
    if (AUTO_CLASSES[run.status]) btn.classList.add(AUTO_CLASSES[run.status]);
    // failed and needs_input are both worth retrying — needs_input isn't only
    // CAPTCHA/login walls, it also covers an ambiguous "did it submit?" read
    // that can genuinely go through on a second try. A submitted run must not
    // be resubmittable, and an in-flight one is already running.
    btn.disabled = run.status !== "failed" && run.status !== "needs_input";

    var links = [];
    if (run.status === "needs_input") {
      if (run.liveViewUrl) links.push({ label: "Watch / finish it", href: run.liveViewUrl });
      else if (run.replayUrl) links.push({ label: "See what happened", href: run.replayUrl });
      if (job && job.applyUrl) links.push({ label: "Open the form yourself", href: job.applyUrl });
    } else if (run.status === "running" && run.liveViewUrl) {
      links.push({ label: "Watch it live", href: run.liveViewUrl });
    } else if (run.status === "submitted" && run.replayUrl) {
      links.push({ label: "See the replay", href: run.replayUrl });
    }

    setNote(jobId, run.detail || "", run.status === "failed" || run.status === "needs_input", links);

    // A specific, answerable gap (see buildAnswerModal's comment) rather than
    // an environmental blocker (CAPTCHA, login wall) — those don't carry
    // missingFields, so this link only appears when there's something the
    // user can actually do about it beyond "open the form yourself".
    if (run.status === "needs_input" && run.missingFields && run.missingFields.length) {
      var note = noteFor(jobId);
      if (note) {
        note.appendChild(document.createTextNode(" · "));
        var answerLink = el("a", null, "Answer & retry");
        answerLink.href = "#";
        answerLink.addEventListener("click", function (e) {
          e.preventDefault();
          buildAnswerModal(jobId, run.runId, run.missingFields, function () {
            onAutoApply(job);
          });
        });
        note.appendChild(answerLink);
      }
    }
  }

  function adoptRun(jobId, run) {
    autoByJobId[jobId] = run;
    paintAuto(jobId);
    if (isTerminal(run)) {
      stopPoller(jobId);
    } else {
      pollRun(jobId, run.runId, 2000);
    }
  }

  // Backoff so a 4-minute run doesn't cost 120 requests, with a hard ceiling
  // slightly past the server-side run timeout.
  function pollRun(jobId, runId, delay, elapsed) {
    stopPoller(jobId);
    var waited = elapsed || 0;
    if (waited > 8 * 60 * 1000) {
      autoByJobId[jobId] = {
        runId: runId,
        status: "failed",
        detail: "Lost track of this application. Reload to check.",
        terminal: true,
      };
      paintAuto(jobId);
      return;
    }
    autoPollers[jobId] = setTimeout(function () {
      fetch("/api/dashboard/auto-apply/" + runId)
        .then(function (r) {
          if (r.status === 401) {
            redirectToLogin();
            return null;
          }
          if (!r.ok) throw new Error("poll failed");
          return r.json();
        })
        .then(function (run) {
          if (!run) return;
          autoByJobId[jobId] = run;
          paintAuto(jobId);
          if (!isTerminal(run)) {
            pollRun(jobId, runId, Math.min(8000, Math.round(delay * 1.4)), waited + delay);
          }
        })
        .catch(function () {
          pollRun(jobId, runId, Math.min(8000, Math.round(delay * 1.4)), waited + delay);
        });
    }, delay);
  }

  function onAutoApply(job) {
    var jobId = job.id;
    autoByJobId[jobId] = { status: "queued", detail: "Queued…", terminal: false };
    paintAuto(jobId);

    fetch("/api/dashboard/auto-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: jobId }),
    })
      .then(function (r) {
        if (r.status === 401) {
          redirectToLogin();
          return null;
        }
        return jsonOrNull(r).then(function (body) {
          return { status: r.status, ok: r.ok, body: body };
        });
      })
      .then(function (res) {
        if (!res) return;
        var body = res.body || {};
        var detail = body.detail;

        if (res.status === 202) {
          if (autoRemaining !== null) autoRemaining = Math.max(0, autoRemaining - 1);
          adoptRun(jobId, body);
          return;
        }
        if (res.status === 409) {
          // Either a run is already in flight (adopt it) or this job is done.
          if (body.runId) adoptRun(jobId, body);
          else failLocal(jobId, typeof detail === "string" ? detail : "You already applied to this job.");
          return;
        }
        if (res.status === 400 && detail && detail.needsProfile) {
          delete autoByJobId[jobId];
          paintAuto(jobId);
          openProfileModal(detail.message, function () {
            onAutoApply(job);
          });
          return;
        }
        if (res.status === 429) {
          var limit = detail && detail.limit;
          var isPro = detail && detail.isPro;
          failLocal(
            jobId,
            "You've used all " + (limit || "your") + " auto-applies this month." +
              (isPro ? "" : " Upgrade to Pro for more.")
          );
          return;
        }
        if (res.status === 503) {
          autoAvailable = false;
          autoUnavailableReason = typeof detail === "string" ? detail : "Auto-apply is unavailable right now.";
          delete autoByJobId[jobId];
          repaintAllAuto();
          return;
        }
        failLocal(jobId, typeof detail === "string" ? detail : "Couldn't start auto-apply. Try again.");
      })
      .catch(function () {
        failLocal(jobId, "Couldn't reach the server. Try again.");
      });
  }

  function failLocal(jobId, message) {
    autoByJobId[jobId] = { status: "failed", detail: message, terminal: true };
    paintAuto(jobId);
  }

  function repaintAllAuto() {
    Object.keys(autoBtnByJobId).forEach(paintAuto);
  }

  // Hydration after every render, so a job applied to in an earlier session
  // shows "Applied ✓" rather than an inviting live button.
  function refreshAutoStates(jobIds) {
    if (!jobIds || !jobIds.length) return;
    fetch("/api/dashboard/auto-apply/status?jobIds=" + jobIds.join(","))
      .then(function (r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        autoAvailable = !!data.available;
        autoUnavailableReason = data.reason || "";
        autoRemaining = typeof data.remaining === "number" ? data.remaining : null;
        Object.keys(data.runs || {}).forEach(function (jobId) {
          var run = data.runs[jobId];
          autoByJobId[jobId] = run;
          if (!isTerminal(run)) pollRun(jobId, run.runId, 2000);
        });
        repaintAllAuto();
      })
      .catch(function () {});
  }

  // ── Application profile modal ────────────────────────────────────────────
  // The one place auto-apply ever asks the user anything. Everything a form
  // could ask lives here — work authorization, sponsorship, EEO, salary — so
  // that once it's filled in, every later Auto-apply click runs straight
  // through with no prompts.

  var YES_NO = [
    { value: "", label: "Select…" },
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ];
  var REMOTE_OPTS = [
    { value: "", label: "Select…" },
    { value: "remote", label: "Remote" },
    { value: "hybrid", label: "Hybrid" },
    { value: "onsite", label: "Onsite" },
    { value: "flexible", label: "Flexible" },
  ];
  var DECLINE = "Decline to self-identify";
  var CUSTOM_OPT = { value: "custom", label: "I'll type my own answer" };
  var GENDER_OPTS = [
    { value: "Male", label: "Male" },
    { value: "Female", label: "Female" },
    { value: "Non-binary", label: "Non-binary" },
    { value: DECLINE, label: DECLINE },
    CUSTOM_OPT,
  ];
  var RACE_OPTS = [
    { value: "American Indian or Alaska Native", label: "American Indian or Alaska Native" },
    { value: "Asian", label: "Asian" },
    { value: "Black or African American", label: "Black or African American" },
    { value: "Hispanic or Latino", label: "Hispanic or Latino" },
    { value: "Native Hawaiian or Other Pacific Islander", label: "Native Hawaiian or Other Pacific Islander" },
    { value: "White", label: "White" },
    { value: "Two or more races", label: "Two or more races" },
    { value: DECLINE, label: DECLINE },
    CUSTOM_OPT,
  ];
  var VETERAN_OPTS = [
    { value: "I am not a protected veteran", label: "I am not a protected veteran" },
    { value: "I identify as a protected veteran", label: "I identify as a protected veteran" },
    { value: DECLINE, label: DECLINE },
    CUSTOM_OPT,
  ];
  var DISABILITY_OPTS = [
    { value: "Yes, I have a disability", label: "Yes, I have a disability" },
    { value: "No, I don't have a disability", label: "No, I don't have a disability" },
    { value: DECLINE, label: DECLINE },
    CUSTOM_OPT,
  ];
  var PRONOUN_OPTS = [
    { value: "He/Him", label: "He/Him" },
    { value: "She/Her", label: "She/Her" },
    { value: "They/Them", label: "They/Them" },
    { value: DECLINE, label: DECLINE },
    CUSTOM_OPT,
  ];
  var LGBTQ_OPTS = [
    { value: "Yes", label: "Yes" },
    { value: "No", label: "No" },
    { value: DECLINE, label: DECLINE },
    CUSTOM_OPT,
  ];
  // Every option set above ends in DECLINE + CUSTOM_OPT — a fixed value from
  // one of these gives fill_form() something reliable to match against the
  // real form's <select> (see auto_apply/browser.py's option-matching); the
  // custom escape hatch is what preserves free text a user already saved
  // before this became a select (see fillProfileModal() below), and covers
  // any employer-specific option none of these lists anticipated.
  var EEO_FIELDS = [
    { key: "gender", label: "Gender", choices: GENDER_OPTS },
    { key: "raceEthnicity", label: "Race / ethnicity", choices: RACE_OPTS },
    { key: "veteranStatus", label: "Veteran status", choices: VETERAN_OPTS },
    { key: "disabilityStatus", label: "Disability status", choices: DISABILITY_OPTS },
    { key: "genderPronouns", label: "Gender pronouns", choices: PRONOUN_OPTS },
    { key: "lgbtqIdentity", label: "LGBTQ+ identity", choices: LGBTQ_OPTS },
  ];
  var EEO_KEYS = EEO_FIELDS.map(function (f) { return f.key; });

  var modalEl = null;
  var modalFields = {};
  var modalOnSaved = null;

  function field(container, key, labelText, type, opts) {
    var wrap = el("div", "jd-field" + (opts && opts.wide ? " wide" : ""));
    var label = el("label", null, labelText);
    label.setAttribute("for", "jd-f-" + key);
    wrap.appendChild(label);

    var input;
    if (type === "select") {
      input = el("select");
      (opts.choices || []).forEach(function (c) {
        var o = el("option", null, c.label);
        o.value = c.value;
        input.appendChild(o);
      });
    } else if (type === "textarea") {
      input = el("textarea");
    } else {
      input = el("input");
      input.type = type || "text";
    }
    input.id = "jd-f-" + key;
    if (opts && opts.placeholder) input.placeholder = opts.placeholder;
    wrap.appendChild(input);

    // A select with a "custom" option gets a paired free-text input, hidden
    // until "custom" is chosen — the escape hatch for anything the fixed
    // option list didn't anticipate, and how an existing user's already-saved
    // free text round-trips in once these fields stop being plain text
    // (see fillProfileModal()).
    if (type === "select" && opts && opts.customValue) {
      var customInput = el("input");
      customInput.type = "text";
      customInput.id = "jd-f-" + key + "Custom";
      customInput.placeholder = "Type your answer";
      customInput.hidden = true;
      wrap.appendChild(customInput);
      modalFields[key + "Custom"] = customInput;
      input.addEventListener("change", function () {
        customInput.hidden = input.value !== opts.customValue;
      });
    }

    container.appendChild(wrap);
    modalFields[key] = input;
    return input;
  }

  function buildApplyProfileModal() {
    var overlay = el("div", "jd-modal");
    overlay.hidden = true;
    overlay.id = "jd-apply-modal";

    var card = el("div", "jd-modal-card");
    card.appendChild(el("h2", null, "Application profile"));
    card.appendChild(
      el(
        "p",
        "jd-modal-intro",
        "Auto-apply fills every application from this — including questions we can't safely " +
          "guess, like work authorization and sponsorship. Fill it in once and every future " +
          "Auto-apply click runs without interruption."
      )
    );

    var errBox = el("div", "jd-modal-err");
    errBox.hidden = true;
    modalFields = { _err: errBox };

    card.appendChild(el("div", "jd-modal-sec", "Contact"));
    var contactGrid = el("div", "jd-fields");
    field(contactGrid, "phone", "Phone", "tel", { placeholder: "+1 555 000 1111" });
    field(contactGrid, "location", "Location", "text", { placeholder: "City, Country" });
    field(contactGrid, "linkedinUrl", "LinkedIn", "text", { placeholder: "linkedin.com/in/…" });
    field(contactGrid, "githubUrl", "GitHub", "text", { placeholder: "github.com/…" });
    field(contactGrid, "portfolioUrl", "Portfolio", "text", { placeholder: "https://…" });
    field(contactGrid, "currentTitle", "Current title", "text", {});
    card.appendChild(contactGrid);

    card.appendChild(el("div", "jd-modal-sec", "Eligibility"));
    var eligGrid = el("div", "jd-fields");
    field(eligGrid, "workAuthorized", "Authorized to work in the job's country?", "select", { choices: YES_NO });
    field(eligGrid, "requiresSponsorship", "Require visa sponsorship?", "select", { choices: YES_NO });
    field(eligGrid, "visaStatus", "Visa status (optional)", "text", { placeholder: "e.g. Citizen, H-1B, OPT" });
    field(eligGrid, "willingToRelocate", "Willing to relocate?", "select", { choices: YES_NO });
    field(eligGrid, "remotePreference", "Work preference", "select", { choices: REMOTE_OPTS });
    field(eligGrid, "yearsExperience", "Years of experience", "text", { placeholder: "e.g. 4" });
    card.appendChild(eligGrid);

    card.appendChild(el("div", "jd-modal-sec", "Logistics"));
    var logGrid = el("div", "jd-fields");
    field(logGrid, "noticePeriod", "Notice period", "text", { placeholder: "e.g. 2 weeks" });
    field(logGrid, "expectedSalary", "Expected salary", "text", { placeholder: "e.g. $120,000" });
    field(logGrid, "availableStartDate", "Available start date", "text", { placeholder: "e.g. Immediately" });
    field(logGrid, "howDidYouHear", "How did you hear about us?", "text", { placeholder: "e.g. Company website" });
    field(logGrid, "whyThisRole", "Why this kind of role (used for free-text questions)", "textarea", { wide: true });
    card.appendChild(logGrid);

    card.appendChild(el("div", "jd-modal-sec", "Voluntary self-identification"));
    card.appendChild(
      el("p", "jd-modal-intro", "Optional on every real form. Defaults to declining unless you set otherwise.")
    );
    var eeoGrid = el("div", "jd-fields");
    EEO_FIELDS.forEach(function (f) {
      var input = field(eeoGrid, f.key, f.label, "select", { choices: f.choices, customValue: "custom" });
      input.value = DECLINE;
    });
    card.appendChild(eeoGrid);

    var termsCheck = el("label", "jd-check");
    var termsInput = document.createElement("input");
    termsInput.type = "checkbox";
    termsInput.id = "jd-f-agreeToEmployerTerms";
    modalFields.agreeToEmployerTerms = termsInput;
    termsCheck.appendChild(termsInput);
    termsCheck.appendChild(
      document.createTextNode("Accept each employer's terms and privacy policy on my behalf when applying.")
    );
    card.appendChild(termsCheck);

    var consentCheck = el("label", "jd-check");
    var consentInput = document.createElement("input");
    consentInput.type = "checkbox";
    consentInput.id = "jd-f-consent";
    modalFields.consent = consentInput;
    consentCheck.appendChild(consentInput);
    consentCheck.appendChild(
      document.createTextNode(
        "I authorize TailorCV to fill in and submit job applications on my behalf using these answers."
      )
    );
    card.appendChild(consentCheck);

    card.appendChild(errBox);

    var actions = el("div", "jd-modal-actions");
    var cancelBtn = el("button", "jd-modal-cancel", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", closeProfileModal);
    var saveBtn = el("button", "jd-modal-save", "Save profile");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", submitProfileModal);
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    overlay.appendChild(card);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeProfileModal();
    });
    document.body.appendChild(overlay);
    modalEl = overlay;
  }

  function fillProfileModal(data) {
    Object.keys(modalFields).forEach(function (key) {
      if (key === "_err" || key.slice(-6) === "Custom") return;
      var input = modalFields[key];
      var value = data[key];
      if (input.type === "checkbox") {
        input.checked = !!value;
      } else if (EEO_KEYS.indexOf(key) !== -1) {
        // A value that matches one of this field's fixed options selects it
        // directly; anything else (a legacy free-text answer from before
        // this was a select, or a genuinely custom one) goes into "custom"
        // plus its paired text input, so nothing already saved is lost.
        var customInput = modalFields[key + "Custom"];
        var isFixedOption = Array.prototype.some.call(input.options, function (o) {
          return o.value === value;
        });
        if (value && !isFixedOption) {
          input.value = "custom";
          if (customInput) {
            customInput.value = value;
            customInput.hidden = false;
          }
        } else if (value) {
          input.value = value;
        }
      } else if (value) {
        input.value = value;
      }
    });
  }

  function openProfileModal(message, onSaved) {
    if (!modalEl) buildApplyProfileModal();
    modalOnSaved = onSaved || null;
    modalFields._err.hidden = !message;
    modalFields._err.textContent = message || "";

    fetch("/api/apply-profile")
      .then(function (r) {
        if (r.status === 401) {
          redirectToLogin();
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data) fillProfileModal(data);
      })
      .catch(function () {});

    modalEl.hidden = false;
    document.addEventListener("keydown", onModalKeydown);
  }

  function closeProfileModal() {
    if (modalEl) modalEl.hidden = true;
    document.removeEventListener("keydown", onModalKeydown);
  }

  function onModalKeydown(e) {
    if (e.key === "Escape") closeProfileModal();
  }

  function submitProfileModal() {
    var payload = {};
    var customTextMissing = null;
    Object.keys(modalFields).forEach(function (key) {
      if (key === "_err" || key.slice(-6) === "Custom") return;
      var input = modalFields[key];
      payload[key] = input.type === "checkbox" ? input.checked : input.value.trim();
    });
    // Resolve each EEO field's "custom" choice to its paired text input's
    // value — the backend only ever sees a plain string, never "custom".
    EEO_KEYS.forEach(function (key) {
      if (payload[key] !== "custom") return;
      var customValue = (modalFields[key + "Custom"].value || "").trim();
      if (!customValue && !customTextMissing) customTextMissing = key;
      payload[key] = customValue;
    });

    if (customTextMissing) {
      modalFields._err.hidden = false;
      modalFields._err.textContent = "Type your own answer for the field you set to “I'll type my own answer,” or pick a listed option instead.";
      return;
    }
    if (!payload.phone) {
      modalFields._err.hidden = false;
      modalFields._err.textContent = "Add a phone number.";
      return;
    }
    if (payload.workAuthorized !== "yes" && payload.workAuthorized !== "no") {
      modalFields._err.hidden = false;
      modalFields._err.textContent = "Answer the work authorization question.";
      return;
    }
    if (payload.requiresSponsorship !== "yes" && payload.requiresSponsorship !== "no") {
      modalFields._err.hidden = false;
      modalFields._err.textContent = "Answer the visa sponsorship question.";
      return;
    }
    if (!payload.consent) {
      modalFields._err.hidden = false;
      modalFields._err.textContent = "You need to authorize us to submit applications on your behalf.";
      return;
    }

    var saveBtn = modalEl.querySelector(".jd-modal-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    fetch("/api/apply-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        if (r.status === 401) {
          redirectToLogin();
          return null;
        }
        if (!r.ok) throw new Error("save failed");
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        closeProfileModal();
        var cb = modalOnSaved;
        modalOnSaved = null;
        if (cb) cb();
      })
      .catch(function () {
        modalFields._err.hidden = false;
        modalFields._err.textContent = "Couldn't save your profile. Try again.";
      })
      .then(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save profile";
      });
  }

  // A needs_input run whose missingFields is non-empty means fill_form()
  // genuinely had nothing on file to answer these with — not a session to
  // resume (auto_apply_runs is one row per attempt by design, the browser
  // session is already gone), but a specific, answerable gap. This modal
  // collects the answers, saves them (POST .../answers), and then just
  // triggers a normal fresh onAutoApply() click — reusing the same "Try
  // again" mechanism that already exists for needs_input runs, now informed
  // by real answers instead of repeating the same failure.
  function buildAnswerModal(jobId, runId, missingFields, onDone) {
    var overlay = el("div", "jd-modal");
    var card = el("div", "jd-modal-card");
    card.appendChild(el("h2", null, "A couple of questions from this employer"));
    card.appendChild(
      el(
        "p",
        "jd-modal-intro",
        "We couldn't answer these from your profile. Answer them once and we'll remember them next time."
      )
    );

    var grid = el("div", "jd-fields");
    var qaInputs = missingFields.map(function (question, i) {
      var wrap = el("div", "jd-field wide");
      var label = el("label", null, question);
      label.setAttribute("for", "jd-qa-" + i);
      wrap.appendChild(label);
      var input = el("input");
      input.type = "text";
      input.id = "jd-qa-" + i;
      // Chrome ignores a plain autocomplete="off" for field types it
      // pattern-matches from nearby label text (an id/label like "Location
      // (City)" reads as an address field to it) and silently fills in a
      // saved address/answer — which then looks like a real answer already
      // typed in, not a browser guess. "new-password" is a well-known,
      // reliably-respected way to opt an arbitrary text field out of that.
      input.autocomplete = "new-password";
      input.placeholder = "Your answer";
      wrap.appendChild(input);
      grid.appendChild(wrap);
      return { question: question, input: input };
    });
    card.appendChild(grid);

    var errBox = el("div", "jd-modal-err");
    errBox.hidden = true;
    card.appendChild(errBox);

    var actions = el("div", "jd-modal-actions");
    var cancelBtn = el("button", "jd-modal-cancel", "Not now");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", function () {
      overlay.remove();
    });
    var saveBtn = el("button", "jd-modal-save", "Save & retry");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", function () {
      var answers = qaInputs
        .filter(function (qa) {
          return qa.input.value.trim();
        })
        .map(function (qa) {
          return { question: qa.question, answer: qa.input.value.trim() };
        });
      if (!answers.length) {
        errBox.hidden = false;
        errBox.textContent = "Answer at least one question.";
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      fetch("/api/dashboard/auto-apply/" + runId + "/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answers }),
      })
        .then(function (r) {
          if (r.status === 401) {
            redirectToLogin();
            return null;
          }
          return r.ok ? r.json() : Promise.reject(new Error("save failed"));
        })
        .then(function (data) {
          if (!data) return;
          overlay.remove();
          onDone();
        })
        .catch(function () {
          errBox.hidden = false;
          errBox.textContent = "Couldn't save your answers. Try again.";
          saveBtn.disabled = false;
          saveBtn.textContent = "Save & retry";
        });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    overlay.appendChild(card);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  var profileLinkBtn = document.getElementById("jd-profile-link");
  if (profileLinkBtn) {
    profileLinkBtn.addEventListener("click", function () {
      openProfileModal("", null);
    });
  }

  function onSave(job, btn) {
    var willSave = !btn.classList.contains("saved");
    var req = willSave
      ? fetch("/api/saved-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id }),
        })
      : fetch("/api/saved-jobs/" + job.id, { method: "DELETE" });

    req
      .then(function (r) {
        if (!r.ok) throw new Error("save failed");
        job.saved = willSave;
        btn.classList.toggle("saved", willSave);
        btn.textContent = willSave ? "Saved" : "Save";
        if (currentView === "saved" && !willSave) {
          loadSaved();
        }
      })
      .catch(function () {});
  }

  function buildCard(job) {
    var card = el("article", "jd-card");
    card.setAttribute("data-job-id", job.id);

    var top = el("div", "jd-card-top");
    top.appendChild(el("span", "jd-source", job.source || ""));
    card.appendChild(top);

    card.appendChild(el("h3", null, job.title || "Untitled role"));
    if (job.company) card.appendChild(el("div", "jd-company", job.company));

    var meta = el("div", "jd-meta");
    if (job.location) meta.appendChild(el("span", null, job.location));
    card.appendChild(meta);

    if (job.description) card.appendChild(el("p", "jd-desc", job.description));

    var tier = matchTier(job.matchScore);
    if (tier) {
      var match = el("div", "jd-match");
      var row = el("div", "jd-match-row");
      row.appendChild(el("span", "jd-match-label", "Match score"));
      row.appendChild(el("span", "jd-match-pct " + tier, job.matchScore + "%"));
      match.appendChild(row);
      var bar = el("div", "jd-match-bar");
      var fill = el("div", "jd-match-bar-fill " + tier);
      fill.style.width = Math.max(0, Math.min(100, job.matchScore)) + "%";
      bar.appendChild(fill);
      match.appendChild(bar);
      card.appendChild(match);
    }

    var actions = el("div", "jd-actions");

    var saveBtn = el("button", "jd-btn-save", job.saved ? "Saved" : "Save");
    saveBtn.type = "button";
    if (job.saved) saveBtn.classList.add("saved");
    saveBtn.addEventListener("click", function () {
      onSave(job, saveBtn);
    });
    actions.appendChild(saveBtn);

    var applyBtn = el("button", "jd-btn-apply", "Apply manually");
    applyBtn.type = "button";
    applyBtn.addEventListener("click", function () {
      onApply(job);
    });
    actions.appendChild(applyBtn);

    var autoBtn = el("button", "jd-btn-autoapply", "Auto-apply");
    autoBtn.type = "button";
    autoBtn.addEventListener("click", function () {
      onAutoApply(job);
    });
    actions.appendChild(autoBtn);
    autoBtnByJobId[job.id] = autoBtn;
    autoJobById[job.id] = job;

    card.appendChild(actions);
    paintAuto(job.id);
    return card;
  }

  function jobIdsOf(jobs) {
    return (jobs || []).map(function (job) {
      return job.id;
    });
  }

  // Infinite scroll appends, so the button/job maps are merged here and only
  // reset in renderJobs (which clears the grid).
  function appendJobs(jobs) {
    jobs.forEach(function (job) {
      grid.appendChild(buildCard(job));
    });
    refreshAutoStates(jobIdsOf(jobs));
  }

  function renderJobs(jobs) {
    stopAllPollers();
    autoBtnByJobId = {};
    autoJobById = {};
    grid.innerHTML = "";
    if (!jobs || !jobs.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    appendJobs(jobs);
  }

  function buildSkeletonCard() {
    var card = el("div", "jd-skel");
    card.appendChild(el("div", "jd-skel-bar w60"));
    card.appendChild(el("div", "jd-skel-bar w40"));
    card.appendChild(el("div", "jd-skel-bar w90"));
    card.appendChild(el("div", "jd-skel-bar w75"));
    var actions = el("div", "jd-skel-actions");
    actions.appendChild(el("div", "jd-skel-bar"));
    actions.appendChild(el("div", "jd-skel-bar"));
    actions.appendChild(el("div", "jd-skel-bar"));
    card.appendChild(actions);
    return card;
  }

  function renderSkeletons(count) {
    grid.innerHTML = "";
    for (var i = 0; i < count; i++) grid.appendChild(buildSkeletonCard());
  }

  function loadAll() {
    currentView = "all";
    currentPage = 1;
    hasMore = false;
    setStatus("Searching jobs…");
    setLoadMoreStatus("");
    emptyEl.hidden = true;
    renderSkeletons(6);

    // A brand-new (query, location) pair pays a one-time cold-cache cost
    // (live external fetch + scoring) that can take 20-30s; escalate the
    // status message so a slow first search doesn't read as frozen.
    var slowHintTimer = setTimeout(function () {
      setStatus("First look at this search — pulling fresh listings, this can take up to 30 seconds…");
    }, 4000);

    var params = new URLSearchParams();
    if (qInput.value.trim()) params.set("q", qInput.value.trim());
    if (locInput.value.trim()) params.set("location", locInput.value.trim());
    params.set("page", "1");

    isLoading = true;
    fetch("/api/dashboard/jobs?" + params.toString())
      .then(function (r) {
        if (r.status === 401) {
          window.location.href = "/login?next=/dashboard/jobs";
          return null;
        }
        if (!r.ok) throw new Error("request failed");
        return r.json();
      })
      .then(function (data) {
        isLoading = false;
        clearTimeout(slowHintTimer);
        if (!data) return;
        setStatus("");
        nudgeEl.hidden = !!data.hasResume;
        hasMore = !!data.hasMore;
        renderJobs(data.jobs);
      })
      .catch(function () {
        isLoading = false;
        clearTimeout(slowHintTimer);
        grid.innerHTML = "";
        setStatus("Couldn't load jobs right now. Try again in a moment.");
      });
  }

  function loadMoreAll() {
    if (currentView !== "all" || isLoading || !hasMore) return;

    var nextPage = currentPage + 1;
    var params = new URLSearchParams();
    if (qInput.value.trim()) params.set("q", qInput.value.trim());
    if (locInput.value.trim()) params.set("location", locInput.value.trim());
    params.set("page", String(nextPage));

    isLoading = true;
    setLoadMoreStatus("Loading more jobs…");
    // Running low can trigger a fresh live fetch server-side (see
    // EXPAND_COOLDOWN_MINUTES), which takes longer than a plain cached page.
    var slowHintTimer = setTimeout(function () {
      setLoadMoreStatus("Still looking for more jobs — this can take a bit longer than a normal page…");
    }, 4000);
    fetch("/api/dashboard/jobs?" + params.toString())
      .then(function (r) {
        if (r.status === 401) {
          window.location.href = "/login?next=/dashboard/jobs";
          return null;
        }
        if (!r.ok) throw new Error("request failed");
        return r.json();
      })
      .then(function (data) {
        isLoading = false;
        clearTimeout(slowHintTimer);
        setLoadMoreStatus("");
        if (!data) return;
        currentPage = nextPage;
        hasMore = !!data.hasMore;
        appendJobs(data.jobs);
      })
      .catch(function () {
        isLoading = false;
        clearTimeout(slowHintTimer);
        setLoadMoreStatus("Couldn't load more jobs. Scroll to try again.");
      });
  }

  function loadSaved() {
    currentView = "saved";
    hasMore = false;
    setStatus("Loading saved jobs…");
    setLoadMoreStatus("");
    grid.innerHTML = "";
    emptyEl.hidden = true;
    nudgeEl.hidden = true;

    fetch("/api/saved-jobs")
      .then(function (r) {
        if (r.status === 401) {
          window.location.href = "/login?next=/dashboard/jobs";
          return null;
        }
        if (!r.ok) throw new Error("request failed");
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        setStatus("");
        renderJobs(data.jobs);
      })
      .catch(function () {
        setStatus("Couldn't load saved jobs right now. Try again in a moment.");
      });
  }

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        if (entries[0].isIntersecting) loadMoreAll();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(sentinel);
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabButtons.forEach(function (b) {
        b.classList.remove("on");
      });
      btn.classList.add("on");
      if (btn.dataset.tab === "saved") {
        loadSaved();
      } else {
        loadAll();
      }
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    tabButtons.forEach(function (b) {
      b.classList.toggle("on", b.dataset.tab === "all");
    });
    loadAll();
  });

  loadAll();
})();
