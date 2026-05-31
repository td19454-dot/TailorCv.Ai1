(function () {
  "use strict";

  const STORAGE_KEY = "atsAnalysisPayload";

  /* ══════════════════════════════════════════════════════════════════
     ATS_RULES — master schema for titles, why-it-matters, and the
     default success copy shown when the LLM returns true.
     When the LLM returns false the LLM's own explanation + action
     replace the success defaults.
  ══════════════════════════════════════════════════════════════════ */
  const ATS_RULES = {
    "contact_information.email": {
      title: "Email Address",
      why_it_matters: "Recruiters need a way to contact candidates.",
      success_explanation: "Professional email address detected.",
      success_action: "No action required."
    },
    "contact_information.phone": {
      title: "Phone Number",
      why_it_matters: "Recruiters often use phone screening.",
      success_explanation: "Phone number is present.",
      success_action: "No action required."
    },
    "contact_information.linkedin": {
      title: "LinkedIn Profile",
      why_it_matters: "LinkedIn helps recruiters validate experience.",
      success_explanation: "LinkedIn profile detected.",
      success_action: "No action required."
    },
    "sections.projects": {
      title: "Projects Section",
      why_it_matters: "Projects demonstrate practical experience.",
      success_explanation: "Projects section is present.",
      success_action: "No action required."
    },
    "sections.experience": {
      title: "Work Experience",
      why_it_matters: "Work experience is a primary hiring signal.",
      success_explanation: "Experience section detected.",
      success_action: "No action required."
    },
    "sections.skills": {
      title: "Skills Section",
      why_it_matters: "ATS systems rely heavily on skills matching.",
      success_explanation: "Skills section detected.",
      success_action: "No action required."
    },
    "sections.education": {
      title: "Education Section",
      why_it_matters: "Education is commonly required for screening.",
      success_explanation: "Education section detected.",
      success_action: "No action required."
    },
    "sections.chronological_dates": {
      title: "Chronological Dates",
      why_it_matters: "Recruiters need a clear timeline.",
      success_explanation: "Dates appear in logical chronological order.",
      success_action: "No action required."
    },
    "formatting.single_column": {
      title: "Single Column Layout",
      why_it_matters: "ATS systems parse single-column resumes more reliably.",
      success_explanation: "Resume uses ATS-friendly single-column formatting.",
      success_action: "No action required."
    },
    "formatting.photos_or_graphics": {
      title: "Photos & Graphics",
      why_it_matters: "Images can break ATS parsing.",
      success_explanation: "No problematic photos or graphics detected.",
      success_action: "No action required."
    },
    "formatting.excessive_design": {
      title: "Visual Design",
      why_it_matters: "Over-designed resumes often confuse ATS systems.",
      success_explanation: "Resume design remains ATS-friendly.",
      success_action: "No action required."
    },
    "formatting.unnecessary_sections": {
      title: "Resume Relevance",
      why_it_matters: "Irrelevant sections waste valuable resume space.",
      success_explanation: "No unnecessary sections detected.",
      success_action: "No action required."
    },
    "education.qualification_match": {
      title: "Qualification Match",
      why_it_matters: "Employers often require specific educational backgrounds.",
      success_explanation: "Education meets job requirements.",
      success_action: "No action required."
    },
    "experience.experience_match": {
      title: "Experience Match",
      why_it_matters: "Years and type of experience must align with the JD.",
      success_explanation: "Experience level matches the job requirements.",
      success_action: "No action required."
    },
    "experience.company_names": {
      title: "Company Names",
      why_it_matters: "Recruiters expect company names for credibility.",
      success_explanation: "Company names are clearly listed.",
      success_action: "No action required."
    },
    "experience.job_titles": {
      title: "Job Titles",
      why_it_matters: "Titles help ATS map experience to requirements.",
      success_explanation: "Job titles are clearly identified.",
      success_action: "No action required."
    },
    "experience.quantified_impact": {
      title: "Quantified Impact",
      why_it_matters: "Numbers increase recruiter confidence.",
      success_explanation: "Achievements include measurable impact.",
      success_action: "No action required."
    },
    "projects.project_links": {
      title: "Project Links",
      why_it_matters: "Recruiters can verify project work.",
      success_explanation: "Project links are present.",
      success_action: "No action required."
    },
    "experience.action_verbs": {
      title: "Action Verbs in Experience",
      why_it_matters: "Strong action verbs signal ownership and impact to recruiters.",
      success_explanation: "Experience bullets begin with strong action verbs.",
      success_action: "No action required."
    },
    "projects.action_verbs": {
      title: "Action Verbs in Projects",
      why_it_matters: "Action verbs make project contributions concrete and credible.",
      success_explanation: "Project descriptions use strong action verbs.",
      success_action: "No action required."
    },
    "projects.quantified_impact": {
      title: "Project Impact",
      why_it_matters: "Metrics demonstrate project effectiveness.",
      success_explanation: "Projects contain measurable outcomes.",
      success_action: "No action required."
    },
    "spelling_and_grammar.spelling": {
      title: "Spelling",
      why_it_matters: "Spelling errors hurt professionalism.",
      success_explanation: "No spelling issues detected.",
      success_action: "No action required."
    },
    "spelling_and_grammar.grammar": {
      title: "Grammar",
      why_it_matters: "Grammar errors reduce credibility.",
      success_explanation: "Grammar appears correct.",
      success_action: "No action required."
    },
    "spelling_and_grammar.buzzwords": {
      title: "Buzzwords",
      why_it_matters: "Overused buzzwords reduce impact.",
      success_explanation: "Resume avoids excessive buzzwords.",
      success_action: "No action required."
    },
    "spelling_and_grammar.personal_pronouns": {
      title: "Personal Pronouns",
      why_it_matters: "Professional resumes generally avoid first-person pronouns.",
      success_explanation: "No unnecessary personal pronouns detected.",
      success_action: "No action required."
    }
  };

  /* ══════════════════════════════════════════════════════════════════
     resolve() — the single source of truth for what text to display.

     Logic:
       • passed = true  → use ATS_RULES success_explanation + success_action
       • passed = false → use LLM's explanation + action (fallback to rule
                          why_it_matters if LLM left those fields empty)
  ══════════════════════════════════════════════════════════════════ */
  function resolve(ruleKey, passed, llmExplanation, llmAction) {
    const rule = ATS_RULES[ruleKey] || {};
    const title = rule.title || ruleKey;

    if (passed) {
      return {
        title,
        why: rule.why_it_matters  || "",
        explanation: rule.success_explanation || "Check passed.",
        action:      rule.success_action      || "No action required."
      };
    }

    // Failure: prefer LLM text; fall back to rule copy so nothing is ever blank
    return {
      title,
      why: rule.why_it_matters || "",
      explanation: (llmExplanation && llmExplanation.trim())
                    ? llmExplanation.trim()
                    : (rule.why_it_matters || "This check did not pass."),
      action: (llmAction && llmAction.trim())
               ? llmAction.trim()
               : "Review and update your resume to address this issue."
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     General utilities
  ══════════════════════════════════════════════════════════════════ */
  function load() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /** Safely coerce "true"/"false" strings and booleans → boolean */
  function bool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "string")  return v.trim().toLowerCase() === "true";
    return !!v;
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls)  e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function pill(text, kind) {
    const s = el("span", `pill ${kind}`);
    s.textContent = text;
    return s;
  }

  function scoreColor(score) {
    if (score >= 75) return { stroke: "#22c55e", label: "Strong Match", labelCls: "pass" };
    if (score >= 55) return { stroke: "#f59e0b", label: "Good Match",   labelCls: "warn" };
    return               { stroke: "#ef4444", label: "Needs Work",   labelCls: "fail" };
  }

  /* ══════════════════════════════════════════════════════════════════
     Count checks for mini-stat row
  ══════════════════════════════════════════════════════════════════ */
  function countChecks(d) {
    let passed = 0, failed = 0;
    const checks = [
      d?.contact_information?.email?.present,
      d?.contact_information?.phone?.present,
      d?.contact_information?.linkedin?.present,
      d?.spelling_and_grammar?.spelling?.passed,
      d?.spelling_and_grammar?.grammar?.passed,
      d?.spelling_and_grammar?.buzzwords?.passed,
      d?.spelling_and_grammar?.personal_pronouns?.passed,
      d?.sections?.projects?.present,
      d?.sections?.experience?.present,
      d?.sections?.skills?.present,
      d?.sections?.education?.present,
      d?.sections?.chronological_dates?.passed,
      d?.formatting?.single_column?.passed,
      d?.formatting?.photos_or_graphics?.passed,
      d?.formatting?.excessive_design?.passed,
      d?.formatting?.unnecessary_sections?.passed,
      d?.education?.qualification_match?.passed,
      d?.experience?.experience_match?.passed,
      d?.experience?.company_names?.present,
      d?.experience?.job_titles?.present,
      d?.experience?.action_verbs?.passed,
      d?.experience?.quantified_impact?.passed,
      d?.projects?.project_links?.passed,
      d?.projects?.action_verbs?.passed,
      d?.projects?.quantified_impact?.passed,
    ];
    checks.forEach(v => {
      if (v === undefined || v === null) return;
      bool(v) ? passed++ : failed++;
    });
    return { passed, failed, warned: 0 };
  }

  /* ══════════════════════════════════════════════════════════════════
     Score ring
  ══════════════════════════════════════════════════════════════════ */
  function renderScore(score) {
    const style = scoreColor(score);
    const circ  = 2 * Math.PI * 65;
    const offset = circ - (score / 100) * circ;

    const numEl   = document.getElementById("score-number");
    const ringEl  = document.getElementById("ring-fill");
    const badgeEl = document.getElementById("match-badge");

    if (numEl) numEl.textContent = Math.round(score);
    if (ringEl) {
      ringEl.style.stroke = style.stroke;
      ringEl.style.strokeDasharray  = circ;
      ringEl.style.strokeDashoffset = circ;
      requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offset; });
    }
    if (badgeEl) {
      badgeEl.textContent      = style.label;
      badgeEl.className        = `match-badge ${style.labelCls}`;
      badgeEl.style.color      = style.stroke;
      badgeEl.style.borderColor= style.stroke + "55";
      badgeEl.style.background = style.stroke + "18";
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     Mini stats
  ══════════════════════════════════════════════════════════════════ */
  function renderMiniStats(counts) {
    const grid = document.getElementById("score-stats-row");
    if (!grid) return;
    grid.innerHTML = `
      <div class="mini-stat pass">
        <span class="mini-stat-num">${counts.passed}</span>
        <span class="mini-stat-label">Passed</span>
      </div>
      <div class="mini-stat fail">
        <span class="mini-stat-num">${counts.failed}</span>
        <span class="mini-stat-label">Failed</span>
      </div>
      <div class="mini-stat warn">
        <span class="mini-stat-num">${counts.warned}</span>
        <span class="mini-stat-label">Warnings</span>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════════════
     checkRow — used in the Overview "All Checks" panel.
     Pulls resolved text via resolve() so the detail shown is always
     the success copy (pass) or the LLM text (fail).
  ══════════════════════════════════════════════════════════════════ */
  function checkRow(ruleKey, passed, llmExplanation, llmAction) {
    const { title, explanation } = resolve(ruleKey, passed, llmExplanation, llmAction);
    const cls  = passed ? "pass" : "fail";
    const icon = passed ? "✓" : "✗";
    const row  = el("div", `check-row ${cls}`);
    row.innerHTML = `
      <div class="check-icon">${icon}</div>
      <div class="check-body">
        <div class="check-label">${title}</div>
        <div class="check-detail">${explanation}</div>
      </div>`;
    return row;
  }

  /* ══════════════════════════════════════════════════════════════════
     Overview checks panel
  ══════════════════════════════════════════════════════════════════ */
  function renderOverviewChecks(d) {
    const container = document.getElementById("overview-checks");
    if (!container) return;
    container.innerHTML = "";

    const ci = d?.contact_information    || {};
    const sg = d?.spelling_and_grammar   || {};
    const sc = d?.sections               || {};
    const fm = d?.formatting             || {};
    const ed = d?.education              || {};
    const ex = d?.experience             || {};
    const pr = d?.projects               || {};

    // [ruleKey, passedValue, llmExplanation, llmAction]
    const rows = [
      ["contact_information.email",              ci.email?.present,                  "",                                  ""],
      ["contact_information.phone",              ci.phone?.present,                  "",                                  ""],
      ["contact_information.linkedin",           ci.linkedin?.present,               "",                                  ""],
      ["spelling_and_grammar.spelling",          sg.spelling?.passed,                sg.spelling?.explanation,            sg.spelling?.action],
      ["spelling_and_grammar.grammar",           sg.grammar?.passed,                 sg.grammar?.explanation,             sg.grammar?.action],
      ["spelling_and_grammar.buzzwords",         sg.buzzwords?.passed,               sg.buzzwords?.explanation,           sg.buzzwords?.action],
      ["spelling_and_grammar.personal_pronouns", sg.personal_pronouns?.passed,       sg.personal_pronouns?.explanation,   sg.personal_pronouns?.action],
      ["sections.projects",                      sc.projects?.present,               "",                                  ""],
      ["sections.experience",                    sc.experience?.present,             "",                                  ""],
      ["sections.skills",                        sc.skills?.present,                 "",                                  ""],
      ["sections.education",                     sc.education?.present,              "",                                  ""],
      ["sections.chronological_dates",           sc.chronological_dates?.passed,     sc.chronological_dates?.explanation, ""],
      ["formatting.single_column",               fm.single_column?.passed,           fm.single_column?.explanation,       ""],
      ["formatting.photos_or_graphics",          fm.photos_or_graphics?.passed,      fm.photos_or_graphics?.explanation,  ""],
      ["formatting.excessive_design",            fm.excessive_design?.passed,        fm.excessive_design?.explanation,    ""],
      ["formatting.unnecessary_sections",        fm.unnecessary_sections?.passed,    fm.unnecessary_sections?.explanation,""],
      ["education.qualification_match",          ed.qualification_match?.passed,     ed.qualification_match?.explanation, ""],
      ["experience.experience_match",            ex.experience_match?.passed,        ex.experience_match?.explanation,    ex.experience_match?.action],
      ["experience.company_names",               ex.company_names?.present,          "",                                  ""],
      ["experience.job_titles",                  ex.job_titles?.present,             "",                                  ""],
      ["experience.action_verbs",                ex.action_verbs?.passed,            ex.action_verbs?.explanation,        ex.action_verbs?.action],
      ["experience.quantified_impact",           ex.quantified_impact?.passed,       ex.quantified_impact?.explanation,   ex.quantified_impact?.action],
      ["projects.project_links",                 pr.project_links?.passed,           pr.project_links?.explanation,       pr.project_links?.action],
      ["projects.action_verbs",                  pr.action_verbs?.passed,            pr.action_verbs?.explanation,        pr.action_verbs?.action],
      ["projects.quantified_impact",             pr.quantified_impact?.passed,       pr.quantified_impact?.explanation,   pr.quantified_impact?.action],
    ];

    rows.forEach(([ruleKey, rawPassed, llmExp, llmAct]) => {
      container.appendChild(checkRow(ruleKey, bool(rawPassed), llmExp, llmAct));
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     Accordion item — resolve() drives what body text is shown.
     On pass: shows why_it_matters + success copy (subtle, reassuring).
     On fail: shows why_it_matters + LLM's specific explanation + action.
  ══════════════════════════════════════════════════════════════════ */
  function accItem(ruleKey, rawPassed, llmExplanation, llmAction) {
    const passed  = bool(rawPassed);
    const r       = resolve(ruleKey, passed, llmExplanation, llmAction);
    const cls     = passed ? "pass" : "fail";
    const icon    = passed ? "✓" : "✗";

    const item = el("div", "acc-item");
    const head = el("div", `acc-head ${cls}`);
    head.innerHTML = `
      <div class="acc-head-left">
        <div class="check-icon">${icon}</div>
        <span class="acc-head-title">${r.title}</span>
      </div>
      <span class="acc-chevron">▼</span>`;

    const body = el("div", "acc-body");

    // Why it matters — always shown
    if (r.why) {
      const whyRow = el("div", "acc-row");
      whyRow.appendChild(el("div", "acc-row-label", "Why it matters"));
      whyRow.appendChild(el("div", "acc-row-text",  r.why));
      body.appendChild(whyRow);
    }

    // Explanation
    if (r.explanation) {
      const expRow = el("div", "acc-row");
      expRow.appendChild(el("div", "acc-row-label", passed ? "Status" : "Problem found"));
      expRow.appendChild(el("div", "acc-row-text",  r.explanation));
      body.appendChild(expRow);
    }

    // Action — only meaningful to show on fail (success action is always "No action required.")
    if (r.action && !passed) {
      const actRow = el("div", "acc-row");
      actRow.appendChild(el("div", "acc-row-label", "Recommended fix"));
      actRow.appendChild(el("div", "acc-row-action", "💡 " + r.action));
      body.appendChild(actRow);
    }

    head.addEventListener("click", () => item.classList.toggle("open"));
    item.appendChild(head);
    item.appendChild(body);
    return item;
  }

  /* ══════════════════════════════════════════════════════════════════
     Contact tab
  ══════════════════════════════════════════════════════════════════ */
  function renderContact(d) {
    const target = document.getElementById("contact-list");
    if (!target) return;
    target.innerHTML = "";

    const ci = d?.contact_information || {};
    const defs = [
      { icon: "✉️", key: "email",    ruleKey: "contact_information.email"    },
      { icon: "📞", key: "phone",    ruleKey: "contact_information.phone"    },
      { icon: "🔗", key: "linkedin", ruleKey: "contact_information.linkedin" },
    ];

    defs.forEach(({ icon, key, ruleKey }) => {
      const passed = bool(ci[key]?.present);
      const r      = resolve(ruleKey, passed, "", "");
      const div    = el("div", `contact-item ${passed ? "pass" : "fail"}`);
      div.innerHTML = `
        <span class="contact-icon">${icon}</span>
        <div class="contact-info">
          <div class="contact-name">${r.title}</div>
          <div class="contact-status">${r.explanation}</div>
          <div class="contact-why">${r.why}</div>
        </div>
        <div class="check-icon">${passed ? "✓" : "✗"}</div>`;
      target.appendChild(div);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     Skills tab
  ══════════════════════════════════════════════════════════════════ */
  function renderSkills(d) {
    const skills = d?.skills || {};
    const hard   = skills.hard_skills || {};
    const soft   = skills.soft_skills || {};

    const groups = [
      { id: "hard-matched", items: hard.matched || [], kind: "matched", label: "Matched Hard Skills"  },
      { id: "hard-missing", items: hard.missing || [], kind: "missing", label: "Missing Hard Skills"  },
      { id: "soft-matched", items: soft.matched || [], kind: "matched", label: "Matched Soft Skills"  },
      { id: "soft-missing", items: soft.missing || [], kind: "missing", label: "Missing Soft Skills"  },
    ];

    groups.forEach(({ id, items, kind, label }) => {
      const container = document.getElementById(id);
      if (!container) return;
      container.innerHTML = "";
      container.appendChild(el("div", "pill-group-label", label));
      const list = el("div", "pill-list");
      if (items.length) items.forEach(s => list.appendChild(pill(s, kind)));
      else              list.appendChild(pill("None detected", "empty"));
      container.appendChild(list);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     Sections tab
  ══════════════════════════════════════════════════════════════════ */
  function renderSectionsAudit(d) {
    const target = document.getElementById("sections-accordion");
    if (!target) return;
    target.innerHTML = "";
    const sc = d?.sections || {};

    [
      ["sections.projects",             sc.projects?.present,           "",                                  ""],
      ["sections.experience",           sc.experience?.present,         "",                                  ""],
      ["sections.skills",               sc.skills?.present,             "",                                  ""],
      ["sections.education",            sc.education?.present,          "",                                  ""],
      ["sections.chronological_dates",  sc.chronological_dates?.passed, sc.chronological_dates?.explanation, ""],
    ].forEach(([ruleKey, v, exp, act]) => target.appendChild(accItem(ruleKey, v, exp, act)));
  }

  /* ══════════════════════════════════════════════════════════════════
     Formatting tab
  ══════════════════════════════════════════════════════════════════ */
  function renderFormattingAudit(d) {
    const target = document.getElementById("formatting-accordion");
    if (!target) return;
    target.innerHTML = "";
    const fm = d?.formatting || {};

    [
      ["formatting.single_column",        fm.single_column?.passed,        fm.single_column?.explanation,       ""],
      ["formatting.photos_or_graphics",   fm.photos_or_graphics?.passed,   fm.photos_or_graphics?.explanation,  ""],
      ["formatting.excessive_design",     fm.excessive_design?.passed,     fm.excessive_design?.explanation,    ""],
      ["formatting.unnecessary_sections", fm.unnecessary_sections?.passed, fm.unnecessary_sections?.explanation,""],
    ].forEach(([ruleKey, v, exp, act]) => target.appendChild(accItem(ruleKey, v, exp, act)));
  }

  /* ══════════════════════════════════════════════════════════════════
     Education tab
  ══════════════════════════════════════════════════════════════════ */
  function renderEducationAudit(d) {
    const target = document.getElementById("education-accordion");
    if (!target) return;
    target.innerHTML = "";
    const qm = d?.education?.qualification_match || {};
    target.appendChild(accItem("education.qualification_match", qm.passed, qm.explanation, ""));
  }

  /* ══════════════════════════════════════════════════════════════════
     Experience tab
  ══════════════════════════════════════════════════════════════════ */
  function renderExperienceAudit(d) {
    const target = document.getElementById("experience-accordion");
    if (!target) return;
    target.innerHTML = "";
    const ex = d?.experience || {};

    [
      ["experience.experience_match",  ex.experience_match?.passed,  ex.experience_match?.explanation,  ex.experience_match?.action],
      ["experience.company_names",     ex.company_names?.present,    "",                                ""],
      ["experience.job_titles",        ex.job_titles?.present,       "",                                ""],
      ["experience.action_verbs",      ex.action_verbs?.passed,      ex.action_verbs?.explanation,      ex.action_verbs?.action],
      ["experience.quantified_impact", ex.quantified_impact?.passed, ex.quantified_impact?.explanation, ex.quantified_impact?.action],
    ].forEach(([ruleKey, v, exp, act]) => target.appendChild(accItem(ruleKey, v, exp, act)));
  }

  /* ══════════════════════════════════════════════════════════════════
     Projects tab
  ══════════════════════════════════════════════════════════════════ */
  function renderProjectsAudit(d) {
    const target = document.getElementById("projects-accordion");
    if (!target) return;
    target.innerHTML = "";
    const pr = d?.projects || {};

    [
      ["projects.project_links",     pr.project_links?.passed,     pr.project_links?.explanation,     pr.project_links?.action],
      ["projects.action_verbs",      pr.action_verbs?.passed,      pr.action_verbs?.explanation,      pr.action_verbs?.action],
      ["projects.quantified_impact", pr.quantified_impact?.passed, pr.quantified_impact?.explanation, pr.quantified_impact?.action],
    ].forEach(([ruleKey, v, exp, act]) => target.appendChild(accItem(ruleKey, v, exp, act)));
  }

  /* ══════════════════════════════════════════════════════════════════
     Priority fixes tab
  ══════════════════════════════════════════════════════════════════ */
  function renderPriorityFixes(d) {
    const target = document.getElementById("priority-fixes");
    if (!target) return;
    target.innerHTML = "";
    const fixes = Array.isArray(d?.top_priority_fixes) ? d.top_priority_fixes : [];

    if (!fixes.length) {
      target.innerHTML = `
        <div class="check-row pass">
          <div class="check-icon">✓</div>
          <div class="check-body">
            <div class="check-label">No critical issues found</div>
            <div class="check-detail">Great work — your resume passed all key checks.</div>
          </div>
        </div>`;
      return;
    }

    fixes.forEach((fix, i) => {
      const div = el("div", "fix-item");
      div.innerHTML = `
        <div class="fix-num">${i + 1}</div>
        <div class="fix-body">
          <div class="fix-issue">${fix.issue  || "Issue"}</div>
          <div class="fix-action">${fix.action || ""}</div>
        </div>`;
      target.appendChild(div);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     Meta bar
  ══════════════════════════════════════════════════════════════════ */
  function renderMeta(d) {
    const metaEl = document.getElementById("analysis-meta");
    if (!metaEl) return;
    const rate  = d?.match_rate  ? Math.round(Number(d.match_rate)) + "% match · " : "";
    const level = d?.match_level ? d.match_level + " · " : "";
    const date  = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    metaEl.textContent = `${rate}${level}${date}`;
  }

  /* ══════════════════════════════════════════════════════════════════
     Tabs + actions
  ══════════════════════════════════════════════════════════════════ */
  function wireTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach(btn => {
      btn.addEventListener("click", () => {
        tabs.forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const panel = document.getElementById("tab-" + btn.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });
  }

  function wireActions() {
    const back = document.getElementById("back-to-resume-btn");
    if (back) back.addEventListener("click", () => { window.location.href = "/solutions"; });

    const dl = document.getElementById("download-report-btn");
    if (dl) dl.addEventListener("click", () => {
      const raw  = sessionStorage.getItem(STORAGE_KEY) || "{}";
      const blob = new Blob([raw], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "ats-analysis-report.json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     No-data fallback
  ══════════════════════════════════════════════════════════════════ */
  function showNoData() {
    const shell = document.querySelector(".analysis-shell");
    if (!shell) return;
    shell.innerHTML = `
      <div style="text-align:center;padding:80px 20px;">
        <div style="font-size:48px;margin-bottom:16px;">📄</div>
        <h2 style="margin-bottom:8px;">No analysis found</h2>
        <p style="color:var(--muted);margin-bottom:24px;">Run an ATS analysis first from the Solutions page.</p>
        <a href="/solutions" class="btn-primary" style="text-decoration:none;display:inline-flex;padding:12px 28px;">← Back to Solutions</a>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════════════
     Init
  ══════════════════════════════════════════════════════════════════ */
  function init() {
    wireTabs();
    wireActions();

    const d = load();
    if (!d) { showNoData(); return; }

    const score  = Math.round(Math.max(0, Math.min(100, Number(d.match_rate || 0))));
    const counts = countChecks(d);

    renderMeta(d);
    renderScore(score);
    renderMiniStats(counts);
    renderOverviewChecks(d);
    renderContact(d);
    renderSkills(d);
    renderSectionsAudit(d);
    renderFormattingAudit(d);
    renderEducationAudit(d);
    renderExperienceAudit(d);
    renderProjectsAudit(d);
    renderPriorityFixes(d);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();