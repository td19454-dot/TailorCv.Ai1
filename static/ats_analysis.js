(function () {
  "use strict";

  const STORAGE_KEY = "atsAnalysisPayload";

  /* ─────────────────────────────────────────────────────────────────────────────
     ATS_RULES — master schema: title, category, why-it-matters, success copy.
     category is used for the right-hand label in the overview dot list.
  ───────────────────────────────────────────────────────────────────────────── */
  const ATS_RULES = {
    "contact_information.email": {
      title: "Email Address", category: "Contact",
      why_it_matters: "Recruiters need a way to contact candidates.",
      success_explanation: "Professional email address detected.",
      success_action: "No action required."
    },
    "contact_information.phone": {
      title: "Phone Number", category: "Contact",
      why_it_matters: "Recruiters often use phone screening.",
      success_explanation: "Phone number is present.",
      success_action: "No action required."
    },
    "contact_information.linkedin": {
      title: "LinkedIn Profile", category: "Contact",
      why_it_matters: "LinkedIn helps recruiters validate experience.",
      success_explanation: "LinkedIn profile detected.",
      success_action: "No action required."
    },
    "sections.projects": {
      title: "Projects Section", category: "Sections",
      why_it_matters: "Projects demonstrate practical experience.",
      success_explanation: "Projects section is present.",
      success_action: "No action required."
    },
    "sections.experience": {
      title: "Work Experience", category: "Sections",
      why_it_matters: "Work experience is a primary hiring signal.",
      success_explanation: "Experience section detected.",
      success_action: "No action required."
    },
    "sections.skills": {
      title: "Skills Section", category: "Sections",
      why_it_matters: "ATS systems rely heavily on skills matching.",
      success_explanation: "Skills section detected.",
      success_action: "No action required."
    },
    "sections.education": {
      title: "Education Section", category: "Sections",
      why_it_matters: "Education is commonly required for screening.",
      success_explanation: "Education section detected.",
      success_action: "No action required."
    },
    "sections.chronological_dates": {
      title: "Chronological Dates", category: "Sections",
      why_it_matters: "Recruiters need a clear timeline.",
      success_explanation: "Dates appear in logical chronological order.",
      success_action: "No action required."
    },
    "formatting.single_column": {
      title: "Single Column Layout", category: "Formatting",
      why_it_matters: "ATS systems parse single-column resumes more reliably.",
      success_explanation: "Resume uses ATS-friendly single-column formatting.",
      success_action: "No action required."
    },
    "formatting.photos_or_graphics": {
      title: "Photos & Graphics", category: "Formatting",
      why_it_matters: "Images can break ATS parsing.",
      success_explanation: "No problematic photos or graphics detected.",
      success_action: "No action required."
    },
    "formatting.excessive_design": {
      title: "Visual Design", category: "Formatting",
      why_it_matters: "Over-designed resumes often confuse ATS systems.",
      success_explanation: "Resume design remains ATS-friendly.",
      success_action: "No action required."
    },
    "formatting.unnecessary_sections": {
      title: "Resume Relevance", category: "Formatting",
      why_it_matters: "Irrelevant sections waste valuable resume space.",
      success_explanation: "No unnecessary sections detected.",
      success_action: "No action required."
    },
    "education.qualification_match": {
      title: "Qualification Match", category: "Education",
      why_it_matters: "Employers often require specific educational backgrounds.",
      success_explanation: "Education meets job requirements.",
      success_action: "No action required."
    },
    "experience.experience_match": {
      title: "Experience Match", category: "Experience",
      why_it_matters: "Years and type of experience must align with the JD.",
      success_explanation: "Experience level matches the job requirements.",
      success_action: "No action required."
    },
    "experience.company_names": {
      title: "Company Names", category: "Experience",
      why_it_matters: "Recruiters expect company names for credibility.",
      success_explanation: "Company names are clearly listed.",
      success_action: "No action required."
    },
    "experience.job_titles": {
      title: "Job Titles", category: "Experience",
      why_it_matters: "Titles help ATS map experience to requirements.",
      success_explanation: "Job titles are clearly identified.",
      success_action: "No action required."
    },
    "experience.quantified_impact": {
      title: "Quantified Impact", category: "Experience",
      why_it_matters: "Numbers increase recruiter confidence.",
      success_explanation: "Achievements include measurable impact.",
      success_action: "No action required."
    },
    "projects.project_links": {
      title: "Project Links", category: "Projects",
      why_it_matters: "Recruiters can verify project work.",
      success_explanation: "Project links are present.",
      success_action: "No action required."
    },
    "experience.action_verbs": {
      title: "Action Verbs in Experience", category: "Experience",
      why_it_matters: "Strong action verbs signal ownership and impact to recruiters.",
      success_explanation: "Experience bullets begin with strong action verbs.",
      success_action: "No action required."
    },
    "projects.action_verbs": {
      title: "Action Verbs in Projects", category: "Projects",
      why_it_matters: "Action verbs make project contributions concrete and credible.",
      success_explanation: "Project descriptions use strong action verbs.",
      success_action: "No action required."
    },
    "projects.quantified_impact": {
      title: "Project Impact", category: "Projects",
      why_it_matters: "Metrics demonstrate project effectiveness.",
      success_explanation: "Projects contain measurable outcomes.",
      success_action: "No action required."
    },
    "spelling_and_grammar.spelling": {
      title: "Spelling", category: "Quality",
      why_it_matters: "Spelling errors hurt professionalism.",
      success_explanation: "No spelling issues detected.",
      success_action: "No action required."
    },
    "spelling_and_grammar.grammar": {
      title: "Grammar", category: "Quality",
      why_it_matters: "Grammar errors reduce credibility.",
      success_explanation: "Grammar appears correct.",
      success_action: "No action required."
    },
    "spelling_and_grammar.buzzwords": {
      title: "Buzzwords", category: "Quality",
      why_it_matters: "Overused buzzwords reduce impact.",
      success_explanation: "Resume avoids excessive buzzwords.",
      success_action: "No action required."
    },
    "spelling_and_grammar.personal_pronouns": {
      title: "Personal Pronouns", category: "Quality",
      why_it_matters: "Professional resumes generally avoid first-person pronouns.",
      success_explanation: "No unnecessary personal pronouns detected.",
      success_action: "No action required."
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────────
     resolve() — single source of truth for display text.
     pass=true  → use ATS_RULES success copy.
     pass=false → use LLM explanation/action (fallback to rule copy if empty).
  ───────────────────────────────────────────────────────────────────────────── */
  function resolve(ruleKey, passed, llmExplanation, llmAction) {
    const rule = ATS_RULES[ruleKey] || {};
    const title    = rule.title    || ruleKey;
    const category = rule.category || "";

    if (passed) {
      return {
        title, category,
        why:         rule.why_it_matters      || "",
        explanation: rule.success_explanation || "Check passed.",
        action:      rule.success_action      || "No action required."
      };
    }

    return {
      title, category,
      why:         rule.why_it_matters || "",
      explanation: (llmExplanation && llmExplanation.trim())
                    ? llmExplanation.trim()
                    : (rule.why_it_matters || "This check did not pass."),
      action: (llmAction && llmAction.trim())
               ? llmAction.trim()
               : "Review and update your resume to address this issue."
    };
  }

  function enrichWhyText(why) {
    return (why || "").trim();
  }

  /* ─── Utilities ──────────────────────────────────────────────────────────── */
  function load() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

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
    if (score >= 75) return { stroke: "#20d870", label: "Strong Match" };
    if (score >= 55) return { stroke: "#ffb020", label: "Good Match"   };
    return               { stroke: "#ff4d6d", label: "Needs Work"   };
  }

  /* ─── Count checks ───────────────────────────────────────────────────────── */
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
    return { passed, failed };
  }

  /* ─── Score ring ─────────────────────────────────────────────────────────── */
  function renderScore(score) {
    const style  = scoreColor(score);
    const circ   = 2 * Math.PI * 65;
    const offset = circ - (score / 100) * circ;

    const numEl   = document.getElementById("score-number");
    const ringEl  = document.getElementById("ring-fill");
    const titleEl = document.getElementById("match-badge");

    if (numEl)  numEl.textContent = Math.round(score);
    if (ringEl) {
      ringEl.style.stroke = style.stroke;
      ringEl.style.strokeDasharray  = circ;
      ringEl.style.strokeDashoffset = circ;
      requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offset; });
    }
    if (titleEl) {
      titleEl.textContent = style.label;
      titleEl.style.color = style.stroke;
    }
  }

  /* ─── Mini stats → stat pills ────────────────────────────────────────────── */
  function renderMiniStats(counts) {
    const textEl = document.getElementById("score-stats-text");
    if (textEl) {
      textEl.textContent =
        `${counts.passed} checks passed · ${counts.failed} failed`;
    }

    const rowEl = document.getElementById("score-stats-row");
    if (!rowEl) return;
    rowEl.innerHTML = `
      <span class="stat-pill pass">${counts.passed} passed</span>
      <span class="stat-pill fail">${counts.failed} failed</span>`;
  }

  /* ─── Overview — dot check rows ──────────────────────────────────────────── */
  function ovCheckRow(ruleKey, rawPassed, llmExp, llmAct) {
    const passed = bool(rawPassed);
    const { title, category, explanation, why } = resolve(ruleKey, passed, llmExp, llmAct);
    const whyExpanded = enrichWhyText(why);
    const row = el("div", `ov-check-row ${passed ? "pass" : "fail"}`);
    row.innerHTML = `
      <div class="ov-dot ${passed ? "pass" : "fail"}"></div>
      <div class="ov-check-main">
        <div class="ov-check-label">${title}</div>
        <div class="ov-check-explanation">${explanation}</div>
        <div class="ov-check-why"><strong>Why it matters:</strong> ${whyExpanded}</div>
      </div>
      <span class="ov-check-category">${category}</span>`;
    return row;
  }

  function detailCheckRow(ruleKey, rawPassed, llmExp, llmAct) {
    const passed = bool(rawPassed);
    const { title, category, explanation, why, action } = resolve(ruleKey, passed, llmExp, llmAct);
    const whyExpanded = enrichWhyText(why);
    const row = el("div", `ov-check-row ${passed ? "pass" : "fail"}`);

    let extra = "";
    if (whyExpanded) {
      extra += `<div class="ov-check-why"><strong>Why it matters:</strong> ${whyExpanded}</div>`;
    }
    if (!passed && action) {
      extra += `<div class="ov-check-fix"><strong>How to fix:</strong> ${action}</div>`;
    }

    row.innerHTML = `
      <div class="ov-dot ${passed ? "pass" : "fail"}"></div>
      <div class="ov-check-main">
        <div class="ov-check-label">${title}</div>
        <div class="ov-check-explanation">${explanation}</div>
        ${extra}
      </div>
      <span class="ov-check-category">${category}</span>`;
    return row;
  }

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

    const rows = [
      ["contact_information.email",              ci.email?.present,               "", ""],
      ["contact_information.phone",              ci.phone?.present,               "", ""],
      ["contact_information.linkedin",           ci.linkedin?.present,            "", ""],
      ["spelling_and_grammar.spelling",          sg.spelling?.passed,             sg.spelling?.explanation,            sg.spelling?.action],
      ["spelling_and_grammar.grammar",           sg.grammar?.passed,              sg.grammar?.explanation,             sg.grammar?.action],
      ["spelling_and_grammar.buzzwords",         sg.buzzwords?.passed,            sg.buzzwords?.explanation,           sg.buzzwords?.action],
      ["spelling_and_grammar.personal_pronouns", sg.personal_pronouns?.passed,    sg.personal_pronouns?.explanation,   sg.personal_pronouns?.action],
      ["sections.projects",                      sc.projects?.present,            "", ""],
      ["sections.experience",                    sc.experience?.present,          "", ""],
      ["sections.skills",                        sc.skills?.present,              "", ""],
      ["sections.education",                     sc.education?.present,           "", ""],
      ["sections.chronological_dates",           sc.chronological_dates?.passed,  sc.chronological_dates?.explanation, ""],
      ["formatting.single_column",               fm.single_column?.passed,        fm.single_column?.explanation,       ""],
      ["formatting.photos_or_graphics",          fm.photos_or_graphics?.passed,   fm.photos_or_graphics?.explanation,  ""],
      ["formatting.excessive_design",            fm.excessive_design?.passed,     fm.excessive_design?.explanation,    ""],
      ["formatting.unnecessary_sections",        fm.unnecessary_sections?.passed, fm.unnecessary_sections?.explanation,""],
      ["education.qualification_match",          ed.qualification_match?.passed,  ed.qualification_match?.explanation, ""],
      ["experience.experience_match",            ex.experience_match?.passed,     ex.experience_match?.explanation,    ex.experience_match?.action],
      ["experience.company_names",               ex.company_names?.present,       "", ""],
      ["experience.job_titles",                  ex.job_titles?.present,          "", ""],
      ["experience.action_verbs",                ex.action_verbs?.passed,         ex.action_verbs?.explanation,        ex.action_verbs?.action],
      ["experience.quantified_impact",           ex.quantified_impact?.passed,    ex.quantified_impact?.explanation,   ex.quantified_impact?.action],
      ["projects.project_links",                 pr.project_links?.passed,        pr.project_links?.explanation,       pr.project_links?.action],
      ["projects.action_verbs",                  pr.action_verbs?.passed,         pr.action_verbs?.explanation,        pr.action_verbs?.action],
      ["projects.quantified_impact",             pr.quantified_impact?.passed,    pr.quantified_impact?.explanation,   pr.quantified_impact?.action],
    ];

    const grouped = new Map();
    rows.forEach(([ruleKey, rawPassed, llmExp, llmAct]) => {
      const category = resolve(ruleKey, bool(rawPassed), llmExp, llmAct).category || "Other";
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push([ruleKey, rawPassed, llmExp, llmAct]);
    });

    grouped.forEach((groupRows, category) => {
      const section = el("div", "ov-group");
      section.appendChild(el("div", "ov-group-title", category));
      const list = el("div", "ov-group-list");
      groupRows.forEach(([ruleKey, rawPassed, llmExp, llmAct]) => {
        list.appendChild(ovCheckRow(ruleKey, rawPassed, llmExp, llmAct));
      });
      section.appendChild(list);
      container.appendChild(section);
    });
  }

  /* ─── Accordion item ─────────────────────────────────────────────────────── */
  function accItem(ruleKey, rawPassed, llmExplanation, llmAction) {
    return detailCheckRow(ruleKey, rawPassed, llmExplanation, llmAction);
  }

  /* ─── Sidebar badges ─────────────────────────────────────────────────────── */
  function updateSidebarBadges(d) {
    const ci = d?.contact_information || {};
    const sc = d?.sections            || {};
    const fm = d?.formatting          || {};
    const ed = d?.education           || {};
    const ex = d?.experience          || {};
    const pr = d?.projects            || {};

    const sections = {
      contact:    [ci.email?.present, ci.phone?.present, ci.linkedin?.present],
      sections:   [sc.projects?.present, sc.experience?.present, sc.skills?.present,
                   sc.education?.present, sc.chronological_dates?.passed],
      formatting: [fm.single_column?.passed, fm.photos_or_graphics?.passed,
                   fm.excessive_design?.passed, fm.unnecessary_sections?.passed],
      education:  [ed.qualification_match?.passed],
      experience: [ex.experience_match?.passed, ex.company_names?.present,
                   ex.job_titles?.present, ex.action_verbs?.passed, ex.quantified_impact?.passed],
      projects:   [pr.project_links?.passed, pr.action_verbs?.passed, pr.quantified_impact?.passed],
    };

    Object.entries(sections).forEach(([tab, checks]) => {
      const badgeEl = document.getElementById(`badge-${tab}`);
      if (!badgeEl || !checks.length) return;
      const defined = checks.filter(v => v !== undefined && v !== null);
      if (!defined.length) return;
      const fails = defined.filter(v => !bool(v)).length;
      if (fails === 0) {
        badgeEl.textContent = "OK";
        badgeEl.className   = "sidebar-badge ok";
      } else {
        badgeEl.textContent = `${fails} fix`;
        badgeEl.className   = "sidebar-badge fix";
      }
      badgeEl.style.display = "";
    });

    // Skills badge: show if any missing skills
    const skillsBadge = document.getElementById("badge-skills");
    if (skillsBadge) {
      const missing = (d?.skills?.hard_skills?.missing?.length || 0) +
                      (d?.skills?.soft_skills?.missing?.length || 0);
      if (missing > 0) {
        skillsBadge.textContent = `${missing} gap`;
        skillsBadge.className   = "sidebar-badge warn";
        skillsBadge.style.display = "";
      } else {
        skillsBadge.textContent = "OK";
        skillsBadge.className   = "sidebar-badge ok";
        skillsBadge.style.display = "";
      }
    }
  }

  /* ─── Contact tab ────────────────────────────────────────────────────────── */
  function renderContact(d) {
    const target = document.getElementById("contact-list");
    if (!target) return;
    target.innerHTML = "";
    const ci   = d?.contact_information || {};
    const defs = [
      { key: "email",    ruleKey: "contact_information.email"    },
      { key: "phone",    ruleKey: "contact_information.phone"    },
      { key: "linkedin", ruleKey: "contact_information.linkedin" },
    ];
    defs.forEach(({ key, ruleKey }) => {
      target.appendChild(detailCheckRow(ruleKey, ci[key]?.present, "", ""));
    });
  }

  /* ─── Skills tab ─────────────────────────────────────────────────────────── */
  function renderSkills(d) {
    const skills = d?.skills || {};
    const hard   = skills.hard_skills || {};
    const soft   = skills.soft_skills || {};
    const groups = [
      { id: "hard-matched", items: hard.matched || [], kind: "matched", label: "Matched Hard Skills" },
      { id: "hard-missing", items: hard.missing || [], kind: "missing", label: "Missing Hard Skills" },
      { id: "soft-matched", items: soft.matched || [], kind: "matched", label: "Matched Soft Skills" },
      { id: "soft-missing", items: soft.missing || [], kind: "missing", label: "Missing Soft Skills" },
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

  /* ─── Sections tab ───────────────────────────────────────────────────────── */
  function renderSectionsAudit(d) {
    const target = document.getElementById("sections-accordion");
    if (!target) return;
    target.innerHTML = "";
    const sc = d?.sections || {};
    [
      ["sections.projects",            sc.projects?.present,           "",                                  ""],
      ["sections.experience",          sc.experience?.present,         "",                                  ""],
      ["sections.skills",              sc.skills?.present,             "",                                  ""],
      ["sections.education",           sc.education?.present,          "",                                  ""],
      ["sections.chronological_dates", sc.chronological_dates?.passed, sc.chronological_dates?.explanation, ""],
    ].forEach(([rk, v, exp, act]) => target.appendChild(accItem(rk, v, exp, act)));
  }

  /* ─── Formatting tab ─────────────────────────────────────────────────────── */
  function renderFormattingAudit(d) {
    const target = document.getElementById("formatting-accordion");
    if (!target) return;
    target.innerHTML = "";
    const fm = d?.formatting || {};
    [
      ["formatting.single_column",        fm.single_column?.passed,        fm.single_column?.explanation,        ""],
      ["formatting.photos_or_graphics",   fm.photos_or_graphics?.passed,   fm.photos_or_graphics?.explanation,   ""],
      ["formatting.excessive_design",     fm.excessive_design?.passed,     fm.excessive_design?.explanation,     ""],
      ["formatting.unnecessary_sections", fm.unnecessary_sections?.passed, fm.unnecessary_sections?.explanation, ""],
    ].forEach(([rk, v, exp, act]) => target.appendChild(accItem(rk, v, exp, act)));
  }

  /* ─── Education tab ──────────────────────────────────────────────────────── */
  function renderEducationAudit(d) {
    const target = document.getElementById("education-accordion");
    if (!target) return;
    target.innerHTML = "";
    const qm = d?.education?.qualification_match || {};
    target.appendChild(accItem("education.qualification_match", qm.passed, qm.explanation, ""));
  }

  /* ─── Experience tab ─────────────────────────────────────────────────────── */
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
    ].forEach(([rk, v, exp, act]) => target.appendChild(accItem(rk, v, exp, act)));
  }

  /* ─── Projects tab ───────────────────────────────────────────────────────── */
  function renderProjectsAudit(d) {
    const target = document.getElementById("projects-accordion");
    if (!target) return;
    target.innerHTML = "";
    const pr = d?.projects || {};
    [
      ["projects.project_links",     pr.project_links?.passed,     pr.project_links?.explanation,     pr.project_links?.action],
      ["projects.action_verbs",      pr.action_verbs?.passed,      pr.action_verbs?.explanation,      pr.action_verbs?.action],
      ["projects.quantified_impact", pr.quantified_impact?.passed, pr.quantified_impact?.explanation, pr.quantified_impact?.action],
    ].forEach(([rk, v, exp, act]) => target.appendChild(accItem(rk, v, exp, act)));
  }

  /* ─── Priority fixes tab ─────────────────────────────────────────────────── */
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

  /* ─── Job role display ───────────────────────────────────────────────────── */
  function renderJobRole(d) {
    const role = d?.job_title_match?.job_title_in_jd;
    if (!role) return;
    const titleEl   = document.getElementById("job-role-title");
    const displayEl = document.getElementById("job-role-display");
    if (titleEl)   titleEl.textContent  = role;
    if (displayEl) displayEl.style.display = "flex";
  }

  /* ─── Meta bar ───────────────────────────────────────────────────────────── */
  function renderMeta(d) {
    const metaEl = document.getElementById("analysis-meta");
    if (!metaEl) return;
    const rate  = d?.match_rate  ? Math.round(Number(d.match_rate)) + "% match · " : "";
    const level = d?.match_level ? d.match_level + " · " : "";
    const date  = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    metaEl.textContent = `${rate}${level}${date}`;
  }

  /* ─── Tabs (sidebar buttons) ─────────────────────────────────────────────── */
  function wireTabs() {
    const btns = document.querySelectorAll(".sidebar-btn");
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        btns.forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const panel = document.getElementById("tab-" + btn.dataset.tab);
        if (panel) panel.classList.add("active");

        // On mobile scroll content into view
        const content = document.querySelector(".content-area");
        if (content && window.innerWidth <= 760) {
          content.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  /* ─── Actions ────────────────────────────────────────────────────────────── */
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

  /* ─── No-data fallback ───────────────────────────────────────────────────── */
  function showNoData() {
    const layout = document.querySelector(".analysis-layout");
    if (!layout) return;
    layout.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:80px 20px;text-align:center;">
        <div>
          <div style="font-size:48px;margin-bottom:16px;">📄</div>
          <h2 style="margin-bottom:8px;color:var(--text);">No analysis found</h2>
          <p style="color:var(--muted);margin-bottom:24px;">Run an ATS analysis first from the Solutions page.</p>
          <a href="/solutions" class="btn-primary"
             style="text-decoration:none;display:inline-flex;padding:12px 28px;">← Back to Solutions</a>
        </div>
      </div>`;
  }

  /* ─── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    wireTabs();
    wireActions();

    const d = load();
    if (!d) { showNoData(); return; }

    const score  = Math.round(Math.max(0, Math.min(100, Number(d.match_rate || 0))));
    const counts = countChecks(d);

    renderMeta(d);
    renderJobRole(d);
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
    updateSidebarBadges(d);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
