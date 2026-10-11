(function () {
  "use strict";

  const STORAGE_KEY = "atsAnalysisPayload";
  const STORAGE_LOCAL_KEY = "tailorcv_ats_payload_guest";

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
    },
    "formatting.single_column": {
      title: "Single-Column Layout", category: "Formatting",
      why_it_matters: "Many ATS parsers read left to right across the page, so a second column gets skipped or merged into the first.",
      success_explanation: "Your resume uses a single-column layout that every ATS can read in order.",
      success_action: "No action required."
    },
    "projects.project_links": {
      title: "Project Links", category: "Projects",
      why_it_matters: "A link lets a recruiter see the work itself, not just a description of it.",
      success_explanation: "Your projects include links recruiters can open.",
      success_action: "No action required."
    }
  };

  /* Fail copy for presence checks — the model only returns true/false for these,
     so without this a failing row would just repeat "why it matters". */
  const FAIL_COPY = {
    "contact_information.email":    ["We couldn't find an email address.", "Add a professional email in your header so recruiters can reach you."],
    "contact_information.phone":    ["We couldn't find a phone number.", "Add a phone number in your header; most first screens happen by phone."],
    "contact_information.linkedin": ["We couldn't find a LinkedIn profile.", "Add your LinkedIn URL to your header. Recruiters use it to verify your history."],
    "sections.experience": ["We couldn't find a work experience section.", "Use a standard heading such as \"Work Experience\" or \"Professional Experience\" so the ATS recognises it."],
    "sections.education":  ["We couldn't find an education section.", "Add a section headed \"Education\", even if it only lists one qualification."],
    "sections.skills":     ["We couldn't find a skills section.", "Add a section headed \"Skills\" listing the tools from the job description you have actually used."],
    "sections.projects":   ["We couldn't find a projects section.", "Add a \"Projects\" section with 1–3 projects relevant to this role."],
    "experience.company_names": ["Company names aren't clearly listed.", "Put the employer name on its own line or next to each job title."],
    "experience.job_titles":    ["Job titles aren't clearly identified.", "Start each role with your exact job title so the ATS can map it to the posting."],
  };

  /* Short labels for the presence rows, phrased the way a reader scans them. */
  const PASS_COPY = {
    "contact_information.email":    "You provided your email. Recruiters use it to contact you about this job.",
    "contact_information.phone":    "You provided your phone number.",
    "contact_information.linkedin": "You linked your LinkedIn profile. Recruiters use it to validate your experience.",
    "sections.experience": "We found a work experience section in your resume.",
    "sections.education":  "We found an education section in your resume.",
    "sections.skills":     "We found a skills section in your resume.",
    "sections.projects":   "We found a projects section in your resume.",
  };

  /* ─── Utilities ──────────────────────────────────────────────────────────── */
  function load() {
    try {
      let raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem(STORAGE_LOCAL_KEY);
        if (raw) {
          try { sessionStorage.setItem(STORAGE_KEY, raw); } catch {}
        }
      }
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function bool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "string")  return v.trim().toLowerCase() === "true";
    return !!v;
  }

  function defined(v) { return v !== undefined && v !== null && v !== ""; }

  // Model output goes into innerHTML below, so escape it.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls)  e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // Bands must match the server's match_level (functions.py compute_* / main.py),
  // otherwise the ring says "Good Match" while the payload says "Fair".
  //   <40 Poor · <60 Fair · <75 Good · <90 Strong · else Excellent
  function scoreColor(score) {
    if (score >= 90) return { stroke: "#16a34a", label: "Excellent Match" };
    if (score >= 75) return { stroke: "#16a34a", label: "Strong Match"    };
    if (score >= 60) return { stroke: "#f5a524", label: "Good Match"      };
    if (score >= 40) return { stroke: "#f5a524", label: "Fair Match"      };
    return               { stroke: "#e5484d", label: "Needs Work"      };
  }

  const ICONS = {
    pass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  };

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
      // single_column and project_links are both scored server-side; leaving
      // them out made the "N passed / N failed" pills disagree with the score.
      d?.formatting?.single_column?.passed,
      d?.formatting?.photos_or_graphics?.passed,
      d?.formatting?.excessive_design?.passed,
      d?.formatting?.unnecessary_sections?.passed,
      d?.projects?.project_links?.passed,
      d?.education?.qualification_match?.passed,
      d?.experience?.experience_match?.passed,
      d?.experience?.company_names?.present,
      d?.experience?.job_titles?.present,
      d?.experience?.action_verbs?.passed,
      d?.experience?.quantified_impact?.passed,
      d?.projects?.action_verbs?.passed,
      d?.projects?.quantified_impact?.passed,
    ];
    checks.forEach(v => {
      if (v === undefined || v === null) return;
      bool(v) ? passed++ : failed++;
    });
    return { passed, failed };
  }

  /* ─── Check model ────────────────────────────────────────────────────────────
     A "check" is { key, value, exp, act }. checkView() turns it into display
     state; status is pass | fail, or warn for informational rows. */
  function checkView(c) {
    const rule = ATS_RULES[c.key] || {};
    const passed = bool(c.value);
    if (passed) {
      return { status: "pass", text: PASS_COPY[c.key] || rule.success_explanation || "Check passed.", fix: "" };
    }
    const fc = FAIL_COPY[c.key];
    const text = (c.exp && String(c.exp).trim()) || (fc && fc[0]) || rule.why_it_matters || "This check did not pass.";
    const fix  = (c.act && String(c.act).trim()) || (fc && fc[1]) || "";
    return { status: "fail", text, fix };
  }

  function c(key, value, exp, act) { return { key, value, exp: exp || "", act: act || "" }; }

  /* Groups per report section. Each group is one row of the table. */
  function buildGroups(d) {
    const ci = d?.contact_information  || {};
    const sg = d?.spelling_and_grammar || {};
    const sc = d?.sections             || {};
    const fm = d?.formatting           || {};
    const ed = d?.education            || {};
    const ex = d?.experience           || {};
    const pr = d?.projects             || {};

    return {
      searchability: [
        { label: "Contact Information", help: "Recruiters and the ATS read your header to contact you and validate your identity.",
          checks: [c("contact_information.email", ci.email?.present),
                   c("contact_information.phone", ci.phone?.present),
                   c("contact_information.linkedin", ci.linkedin?.present)] },
        { label: "Section Headings", help: "An ATS sorts your resume into fields by its section headings. Non-standard headings get misfiled or skipped.",
          checks: [c("sections.experience", sc.experience?.present),
                   c("sections.education", sc.education?.present),
                   c("sections.skills", sc.skills?.present),
                   c("sections.projects", sc.projects?.present)] },
        { label: "Date Formatting", help: ATS_RULES["sections.chronological_dates"].why_it_matters,
          checks: [c("sections.chronological_dates", sc.chronological_dates?.passed, sc.chronological_dates?.explanation)] },
      ],
      experience: [
        { label: "Experience Level Match", help: ATS_RULES["experience.experience_match"].why_it_matters,
          checks: [c("experience.experience_match", ex.experience_match?.passed, ex.experience_match?.explanation, ex.experience_match?.action)] },
        { label: "Job Titles", help: ATS_RULES["experience.job_titles"].why_it_matters,
          checks: [c("experience.job_titles", ex.job_titles?.present)] },
        { label: "Company Names", help: ATS_RULES["experience.company_names"].why_it_matters,
          checks: [c("experience.company_names", ex.company_names?.present)] },
        { label: "Action Verbs", help: ATS_RULES["experience.action_verbs"].why_it_matters,
          checks: [c("experience.action_verbs", ex.action_verbs?.passed, ex.action_verbs?.explanation, ex.action_verbs?.action)] },
        { label: "Measurable Results", help: ATS_RULES["experience.quantified_impact"].why_it_matters,
          checks: [c("experience.quantified_impact", ex.quantified_impact?.passed, ex.quantified_impact?.explanation, ex.quantified_impact?.action)] },
      ],
      education: [
        { label: "Qualification Match", help: ATS_RULES["education.qualification_match"].why_it_matters,
          checks: [c("education.qualification_match", ed.qualification_match?.passed, ed.qualification_match?.explanation, ed.qualification_match?.action)] },
      ],
      projects: [
        { label: "Project Links", help: ATS_RULES["projects.project_links"].why_it_matters,
          checks: [c("projects.project_links", pr.project_links?.passed, pr.project_links?.explanation, pr.project_links?.action)] },
        { label: "Action Verbs", help: ATS_RULES["projects.action_verbs"].why_it_matters,
          checks: [c("projects.action_verbs", pr.action_verbs?.passed, pr.action_verbs?.explanation, pr.action_verbs?.action)] },
        { label: "Measurable Results", help: ATS_RULES["projects.quantified_impact"].why_it_matters,
          checks: [c("projects.quantified_impact", pr.quantified_impact?.passed, pr.quantified_impact?.explanation, pr.quantified_impact?.action)] },
        { label: "Portfolio", help: "A live portfolio gives a recruiter proof they can click.",
          checks: [], portfolio: true },
      ],
      writing: [
        { label: "Spelling", help: ATS_RULES["spelling_and_grammar.spelling"].why_it_matters,
          checks: [c("spelling_and_grammar.spelling", sg.spelling?.passed, sg.spelling?.explanation, sg.spelling?.action)] },
        { label: "Grammar", help: ATS_RULES["spelling_and_grammar.grammar"].why_it_matters,
          checks: [c("spelling_and_grammar.grammar", sg.grammar?.passed, sg.grammar?.explanation, sg.grammar?.action)] },
        { label: "Buzzwords", help: ATS_RULES["spelling_and_grammar.buzzwords"].why_it_matters,
          checks: [c("spelling_and_grammar.buzzwords", sg.buzzwords?.passed, sg.buzzwords?.explanation, sg.buzzwords?.action)] },
        { label: "Personal Pronouns", help: ATS_RULES["spelling_and_grammar.personal_pronouns"].why_it_matters,
          checks: [c("spelling_and_grammar.personal_pronouns", sg.personal_pronouns?.passed, sg.personal_pronouns?.explanation, sg.personal_pronouns?.action)] },
      ],
      formatting: [
        { label: "Layout", help: ATS_RULES["formatting.single_column"].why_it_matters,
          checks: [c("formatting.single_column", fm.single_column?.passed, fm.single_column?.explanation)] },
        { label: "Photos & Graphics", help: ATS_RULES["formatting.photos_or_graphics"].why_it_matters,
          checks: [c("formatting.photos_or_graphics", fm.photos_or_graphics?.passed, fm.photos_or_graphics?.explanation)] },
        { label: "Visual Design", help: ATS_RULES["formatting.excessive_design"].why_it_matters,
          checks: [c("formatting.excessive_design", fm.excessive_design?.passed, fm.excessive_design?.explanation)] },
        { label: "Relevant Sections", help: ATS_RULES["formatting.unnecessary_sections"].why_it_matters,
          checks: [c("formatting.unnecessary_sections", fm.unnecessary_sections?.passed, fm.unnecessary_sections?.explanation)] },
      ],
    };
  }

  // Drop checks the payload doesn't contain, and groups left empty.
  function present(groups) {
    return groups
      .map(g => Object.assign({}, g, { checks: g.checks.filter(x => defined(x.value)) }))
      .filter(g => g.checks.length || g.portfolio);
  }

  function tally(groups) {
    let pass = 0, fail = 0;
    groups.forEach(g => g.checks.forEach(x => bool(x.value) ? pass++ : fail++));
    return { pass, fail, total: pass + fail };
  }

  /* ─── Table rendering ────────────────────────────────────────────────────── */
  // One check: optional title, what we found, why it matters, how to fix.
  function itemHTML({ status, title, text, why, fix, extra }) {
    return `
      <div class="ats-item ${status}">
        <span class="ats-ic ${status}" role="img" aria-label="${status === "pass" ? "Passed" : status === "fail" ? "Needs fixing" : "Suggestion"}">${ICONS[status]}</span>
        <div class="ats-item-body">
          ${title ? `<div class="ats-item-title">${esc(title)}</div>` : ""}
          <div class="ats-item-text">${esc(text)}</div>
          ${why ? `<div class="ats-item-why"><strong>Why it matters:</strong> ${esc(why)}</div>` : ""}
          ${fix ? `<div class="ats-item-fix"><strong>How to fix:</strong> ${esc(fix)}</div>` : ""}
          ${extra || ""}
        </div>
      </div>`;
  }

  function renderTable(targetId, groups, d) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = "";
    const sec = target.closest(".ats-sec");
    if (sec) sec.hidden = !groups.length;
    groups.forEach(g => {
      const row = el("div", "ats-group");
      // A row with several checks titles each one; a single check is already
      // named by the row label, and shares the row's "why" when it has none.
      const multi = g.checks.length > 1;
      let items = g.checks.map(x => {
        const v = checkView(x);
        const rule = ATS_RULES[x.key] || {};
        return itemHTML({
          status: v.status,
          title: multi ? rule.title : "",
          text: v.text,
          why: rule.why_it_matters || (multi ? "" : g.help),
          fix: v.fix,
        });
      }).join("");

      // Portfolio is a suggestion, not a scored check. There is no portfolio
      // term in the scoring math, so it must never read as costing points.
      if (g.portfolio) {
        items += d && d.has_portfolio
          ? itemHTML({ status: "pass", text: "You linked a portfolio website. Recruiters can see your live work.", why: g.help })
          : itemHTML({ status: "warn",
                       text: "No portfolio link found. This does not affect your score.",
                       why: g.help,
                       extra: '<a class="ats-item-note" href="/portfolio">Build a portfolio from this resume &rarr;</a>' });
      }

      row.innerHTML = `
        <div class="ats-group-label"><span>${esc(g.label)}</span></div>
        <div class="ats-items">${items}</div>`;
      target.appendChild(row);
    });
  }

  /* ─── Skills ─────────────────────────────────────────────────────────────── */
  const SKILL_ROWS_VISIBLE = 12;

  function copyText(text, btn) {
    const done = () => {
      const orig = btn.innerHTML;
      btn.innerHTML = ICONS.copy + " Copied";
      setTimeout(() => { btn.innerHTML = orig; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, cb) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
    cb();
  }

  function renderSkillBlock(targetId, kind, skillSet) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const matched = (skillSet?.matched || []).filter(Boolean);
    const missing = (skillSet?.missing || []).filter(Boolean);
    const uid = targetId;

    if (!matched.length && !missing.length) {
      target.innerHTML = `<div class="ats-table"><div class="ats-group"><div class="ats-skill-none">No ${kind} skills were detected in this job description.</div></div></div>`;
      return;
    }

    // Missing first — that's the list the reader acts on.
    const rows = missing.map(s => ({ s, ok: false })).concat(matched.map(s => ({ s, ok: true })));
    const rowHTML = (r, hidden) => `
      <tr${hidden ? ' class="ats-more-row" hidden' : ""}>
        <td>${esc(r.s)}</td>
        <td class="c">${r.ok ? '<span class="mark-yes" aria-label="In resume">✓</span>' : '<span class="mark-no" aria-label="Not in resume">✕</span>'}</td>
        <td class="c"><span class="ats-chip ${r.ok ? "matched" : "missing"}">${r.ok ? "Matched" : "Missing"}</span></td>
      </tr>`;

    const pills = (items, cls, label) => `
      <div class="ats-pill-group">
        <div class="ats-pill-label">${label} (${items.length})</div>
        <div class="ats-pills">${items.length ? items.map(s => `<span class="ats-pill ${cls}">${esc(s)}</span>`).join("") : '<span class="ats-pill empty">None</span>'}</div>
      </div>`;

    target.innerHTML = `
      <div class="ats-skill-tabs" role="tablist">
        <button type="button" class="ats-skill-tab" role="tab" id="${uid}-t1" aria-controls="${uid}-p1" aria-selected="true">Skills Comparison</button>
        <button type="button" class="ats-skill-tab" role="tab" id="${uid}-t2" aria-controls="${uid}-p2" aria-selected="false" tabindex="-1">Highlighted Skills</button>
      </div>
      <div class="ats-skill-panel" role="tabpanel" id="${uid}-p1" aria-labelledby="${uid}-t1">
        <table class="ats-skill-table">
          <thead><tr>
            <th><span class="ats-th-wrap">Skill ${missing.length ? `<button type="button" class="ats-copy" data-copy>${ICONS.copy} Copy missing</button>` : ""}</span></th>
            <th class="c">Resume</th>
            <th class="c">Status</th>
          </tr></thead>
          <tbody>${rows.map((r, i) => rowHTML(r, i >= SKILL_ROWS_VISIBLE)).join("")}</tbody>
        </table>
        ${rows.length > SKILL_ROWS_VISIBLE ? `<button type="button" class="ats-show-more" data-more>Show all ${rows.length} skills</button>` : ""}
      </div>
      <div class="ats-skill-panel" role="tabpanel" id="${uid}-p2" aria-labelledby="${uid}-t2" hidden>
        ${pills(missing, "missing", "Missing from your resume")}
        ${pills(matched, "matched", "Found in your resume")}
      </div>`;

    const tabs = target.querySelectorAll(".ats-skill-tab");
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => selectTab(i));
      tab.addEventListener("keydown", e => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); selectTab(i ? 0 : 1); tabs[i ? 0 : 1].focus(); }
      });
    });
    function selectTab(idx) {
      tabs.forEach((t, j) => {
        t.setAttribute("aria-selected", j === idx ? "true" : "false");
        t.tabIndex = j === idx ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = j !== idx;
      });
    }

    const copyBtn = target.querySelector("[data-copy]");
    if (copyBtn) copyBtn.addEventListener("click", () => copyText(missing.join(", "), copyBtn));

    const more = target.querySelector("[data-more]");
    if (more) more.addEventListener("click", () => {
      target.querySelectorAll(".ats-more-row").forEach(r => { r.hidden = false; });
      more.remove();
    });
  }

  /* ─── Score gauge ────────────────────────────────────────────────────────── */
  function renderScore(score) {
    const style  = scoreColor(score);
    const circ   = 2 * Math.PI * 86;
    const offset = circ - (score / 100) * circ;

    const numEl   = document.getElementById("score-number");
    const ringEl  = document.getElementById("ring-fill");
    const titleEl = document.getElementById("match-badge");
    const reduce  = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target  = Math.round(score);

    if (ringEl) {
      ringEl.style.strokeDasharray = circ;
      if (reduce) {
        ringEl.style.stroke = style.stroke;
        ringEl.style.strokeDashoffset = offset;
      } else {
        ringEl.style.stroke = scoreColor(0).stroke;
        ringEl.style.strokeDashoffset = circ;
        requestAnimationFrame(() => requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offset; }));
      }
    }
    if (numEl) {
      if (reduce) {
        numEl.textContent = target;
      } else {
        // Count 0 → score in sync with the 1.2s ring fill, sweeping the ring
        // color red → amber → green through the same thresholds as the badge.
        let start = null;
        const dur = 1200;
        const step = (ts) => {
          if (start === null) start = ts;
          const t = Math.min((ts - start) / dur, 1);
          const cur = target * (1 - Math.pow(1 - t, 3));
          numEl.textContent = Math.round(cur);
          if (ringEl) ringEl.style.stroke = scoreColor(cur).stroke;
          if (t < 1) requestAnimationFrame(step);
          else { numEl.textContent = String(target); if (ringEl) ringEl.style.stroke = style.stroke; }
        };
        requestAnimationFrame(step);
      }
    }
    if (titleEl) {
      titleEl.textContent = style.label;
      titleEl.style.color = style.stroke;
    }
  }

  /* ─── Left column category bars ──────────────────────────────────────────── */
  function renderCategories(cats) {
    const nav = document.getElementById("ats-cats");
    if (!nav) return;
    nav.innerHTML = "";
    cats.forEach(cat => {
      if (!cat.total) return;   // nothing scored in this payload — no bar
      const pct = cat.total ? Math.round((cat.pass / cat.total) * 100) : 100;
      const level = pct >= 70 ? "" : pct >= 40 ? "mid" : "low";
      const a = el("a", "ats-cat");
      a.href = "#" + cat.section;
      a.innerHTML = `
        <div class="ats-cat-row">
          <span class="ats-cat-name">${esc(cat.name)}</span>
          <span class="ats-cat-issues ${cat.fail ? "" : "ok"}">${cat.fail ? `${cat.fail} ${cat.fail === 1 ? "issue" : "issues"} to fix` : "All good"}</span>
        </div>
        <div class="ats-cat-bar" role="progressbar" aria-label="${esc(cat.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
          <span class="${level}${pct >= 100 ? " full" : ""}"></span>
        </div>`;
      nav.appendChild(a);
      const bar = a.querySelector(".ats-cat-bar span");
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + "%"; }));
    });
  }

  function skillTally(set) {
    const pass = (set?.matched || []).length, fail = (set?.missing || []).length;
    return { pass, fail, total: pass + fail };
  }

  /* ─── Priority fixes ─────────────────────────────────────────────────────── */
  function renderPriorityFixes(d) {
    const target = document.getElementById("priority-fixes");
    if (!target) return;
    const fixes = Array.isArray(d?.top_priority_fixes) ? d.top_priority_fixes.filter(f => f && (f.issue || f.action)) : [];
    target.innerHTML = "";
    if (!fixes.length) {
      target.innerHTML = `<div class="ats-empty"><span class="ats-ic pass">${ICONS.pass}</span>No critical issues found. Your resume passed the key checks for this job.</div>`;
      return;
    }
    fixes.forEach((fix, i) => {
      target.appendChild(el("div", "ats-fix", `
        <div class="ats-fix-num">${i + 1}</div>
        <div>
          <div class="ats-fix-issue">${esc(fix.issue || "Issue")}</div>
          ${fix.action ? `<div class="ats-fix-action">${esc(fix.action)}</div>` : ""}
        </div>`));
    });
  }

  /* ─── Header, CTA, guest banner ──────────────────────────────────────────── */
  function renderTitle(d) {
    const role = d?.job_title_match?.job_title_in_jd;
    const t = document.getElementById("ats-title");
    if (role && t) t.textContent = role;
  }

  // Next step depends on the score: above 70 → apply with a cover letter;
  // otherwise → tailor the resume first.
  function renderCta(score) {
    const title = document.getElementById("ats-cta-title");
    const sub   = document.getElementById("ats-cta-sub");
    const p     = document.getElementById("ats-cta-primary");
    const s     = document.getElementById("ats-cta-secondary");
    if (!title || !p || !s) return;
    if (score > 70) {
      title.textContent = "Strong match — you're ready to apply";
      sub.textContent   = "Send it with a cover letter written for this job, or tailor it further with AI.";
      p.href = "/cover-letter";
      p.querySelector("span").textContent = "Write cover letter";
      s.href = "/solutions";
      s.querySelector("span").textContent = "AI Optimize";
    }
  }

  function renderGuestBanner(d) {
    const loggedIn = typeof isUserLoggedIn === "function" && isUserLoggedIn();
    const isGuest = !!(d && d.guest_scan) || !loggedIn;
    if (!isGuest || loggedIn) return;

    const main = document.getElementById("ats-main");
    if (!main || document.getElementById("guest-signup-banner")) return;

    const nextUrl = encodeURIComponent("/ats-analysis");
    const banner = el("div", "guest-signup-banner");
    banner.id = "guest-signup-banner";
    banner.innerHTML = `
      <p>Your score is ready. Create a free account to save this report, scan again, and optimize your resume.</p>
      <div class="guest-signup-actions">
        <a href="/signup?next=${nextUrl}" class="ats-btn ats-btn-primary">Sign up free</a>
        <a href="/login?next=${nextUrl}" class="ats-btn ats-btn-ghost">Log in</a>
      </div>`;
    main.insertBefore(banner, main.firstChild);
  }

  function wireActions() {
    const pr = document.getElementById("ats-print-btn");
    if (pr) pr.addEventListener("click", () => window.print());
  }

  /* ─── No-data fallback ───────────────────────────────────────────────────── */
  function showNoData() {
    const layout = document.querySelector(".ats-layout");
    if (!layout) return;
    const actions = document.querySelector(".ats-top-actions");
    if (actions) actions.style.display = "none";
    layout.innerHTML = `
      <div class="ats-nodata">
        <div>
          <h2>No analysis found</h2>
          <p>Run an ATS scan first — upload your resume and paste the job description.</p>
          <a href="/solutions#ats-tool" class="ats-btn ats-btn-primary">Scan my resume</a>
        </div>
      </div>`;
  }

  /* ─── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    wireActions();

    const d = load();
    if (!d) { showNoData(); return; }

    const score  = Math.round(Math.max(0, Math.min(100, Number(d.match_rate || 0))));
    const counts = countChecks(d);
    const groups = buildGroups(d);
    const search = present(groups.searchability);
    const exp    = present(groups.experience);
    const edu    = present(groups.education);
    const proj   = present(groups.projects);
    const writ   = present(groups.writing);
    const fmt    = present(groups.formatting);

    renderTitle(d);
    renderGuestBanner(d);
    renderScore(score);

    const stats = document.getElementById("score-stats-text");
    if (stats) stats.textContent = `${counts.passed} checks passed · ${counts.failed} to fix`;

    renderCategories([
      Object.assign({ name: "Searchability",  section: "sec-searchability" }, tally(search)),
      Object.assign({ name: "Hard Skills",    section: "sec-hard" },          skillTally(d?.skills?.hard_skills)),
      Object.assign({ name: "Soft Skills",    section: "sec-soft" },          skillTally(d?.skills?.soft_skills)),
      Object.assign({ name: "Experience",     section: "sec-experience" },    tally(exp)),
      Object.assign({ name: "Projects",       section: "sec-projects" },      tally(proj)),
      Object.assign({ name: "Education",      section: "sec-education" },     tally(edu)),
      Object.assign({ name: "Writing & Tone", section: "sec-writing" },       tally(writ)),
      Object.assign({ name: "Formatting",     section: "sec-formatting" },    tally(fmt)),
    ]);

    renderPriorityFixes(d);
    renderTable("tbl-searchability", search, d);
    renderSkillBlock("skills-hard", "hard", d?.skills?.hard_skills);
    renderSkillBlock("skills-soft", "soft", d?.skills?.soft_skills);
    renderTable("tbl-experience", exp, d);
    renderTable("tbl-education", edu, d);
    renderTable("tbl-projects", proj, d);
    renderTable("tbl-writing", writ, d);
    renderTable("tbl-formatting", fmt, d);
    renderCta(score);

    // Expose score globally as fallback for the share modal listener
    window._atsFinalScore = score;
    // Fire event so the share modal can react to the final score
    document.dispatchEvent(new CustomEvent("atsScoreReady", { detail: { score } }));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
