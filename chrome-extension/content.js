// ═══════════════════════════════════════════════════════
// TailorCV Resume Tailor — job page content script
//
// Runs automatically on the job boards declared in the manifest, and on demand
// (via the toolbar button + activeTab) on any other site. The injected sidebar
// is the extension's only UI surface: login check, base-resume check, and the
// Tailor & Download action.
//
// The job description is read in four layers, cheapest and most reliable first:
//   1. schema.org JobPosting JSON-LD  — a spec, so it survives redesigns
//   2. a per-site adapter             — for boards that ship no JSON-LD
//   3. a generic content heuristic    — for the long tail of career pages
//   4. the user pastes/selects it     — so we are never useless on any page
// ═══════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window.__tailorcvInjected) return;   // toolbar click on an auto-injected page
  window.__tailorcvInjected = true;

  const BASE_URL = 'http://127.0.0.1:8005';  // switch to https://thetailorcv.com to ship
  const MIN_JD_LENGTH = 200;

  const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * 30; // r=30 in the SVG below

  let tcvBusy = false;
  let sb, body, launcher, globalStatus;
  let progressWrap, progressBar, progressPct, progressTimer, checkIcon;
  let sessionReady = false;
  let quotaExceeded = false;
  let lastBeforeScore = null;   // survives the re-render runTailor does while busy
  let manualJd = '';   // set when the user pastes or selects the JD themselves

  // ── Utilities ────────────────────────────────────────

  function textOf(selectors, root = document) {
    for (const sel of selectors) {
      let el;
      try { el = root.querySelector(sel); } catch (_) { continue; }
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
    }
    return '';
  }

  function htmlToText(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.innerText || d.textContent || '').trim();
  }

  function clean(s) {
    return (s || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function sendMessage(msg) {
    return new Promise(resolve => chrome.runtime.sendMessage(msg, res => resolve(res || {})));
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ── Layer 1: schema.org JobPosting ───────────────────
  // Indeed, Greenhouse, Lever, Workday, Naukri and most ATS platforms embed this
  // because Google Jobs requires it. It is a published spec rather than a class
  // name, so it does not break when they restyle the page.

  function walkForJobPosting(node, depth = 0) {
    if (!node || depth > 4) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walkForJobPosting(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof node !== 'object') return null;

    const type = node['@type'];
    const isJob = type === 'JobPosting' ||
                  (Array.isArray(type) && type.includes('JobPosting'));
    if (isJob && node.description) return node;

    if (node['@graph']) return walkForJobPosting(node['@graph'], depth + 1);
    return null;
  }

  function fromJsonLd() {
    const blocks = document.querySelectorAll('script[type="application/ld+json"]');
    for (const block of blocks) {
      let parsed;
      try { parsed = JSON.parse(block.textContent); } catch (_) { continue; }

      const job = walkForJobPosting(parsed);
      if (!job) continue;

      const org = job.hiringOrganization;
      return {
        jd_string: clean(htmlToText(job.description)),
        role: clean(job.title || ''),
        company: clean(typeof org === 'string' ? org : (org && org.name) || ''),
        source: 'jsonld',
      };
    }
    return null;
  }

  // ── Layer 2: per-site adapters ───────────────────────
  // Only for boards that ship no usable JSON-LD. Each is a few selectors, and a
  // miss here falls through to the heuristic rather than dead-ending.

  const ADAPTERS = [
    {
      host: /(^|\.)linkedin\.com$/i,
      jd: ['.jobs-description__content', '.jobs-box__html-content', '#job-details',
           '.jobs-description-content__text', '[class*="jobs-description"]'],
      role: ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', 'h1'],
      company: ['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name',
                '[class*="company-name"]'],
    },
    {
      host: /(^|\.)indeed\.com$/i,
      jd: ['#jobDescriptionText', '.jobsearch-JobComponent-description'],
      role: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h1'],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name]', '.jobsearch-CompanyInfoContainer a'],
    },
    {
      // Naukri ships React with hashed class names — styles_JDC__dang-inner-html__h0K4t
      // — and that trailing hash changes on every deploy of theirs. So match on the
      // stable substring instead of the whole class, or this adapter dies weekly.
      host: /(^|\.)naukri\.com$/i,
      jd: ['[class*="dang-inner-html"]', '[class*="job-desc"]', '[class*="JDC"] [class*="inner-html"]',
           'section[class*="job-desc"]', '#jobDescription'],
      role: ['[class*="jd-header-title"]', 'h1'],
      company: ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]', '[class*="comp-name"] a'],
    },
    {
      host: /(^|\.)(greenhouse\.io|job-boards\.greenhouse\.io)$/i,
      jd: ['#content', '.job__description', '.section-wrapper .body'],
      role: ['.app-title', 'h1.section-header', 'h1'],
      company: ['.company-name', '#header .company-name'],
    },
    {
      host: /(^|\.)lever\.co$/i,
      jd: ['.section-wrapper.page-full-width', '.posting-page .section-wrapper', '[data-qa="job-description"]'],
      role: ['.posting-headline h2', 'h2'],
      company: ['.main-header-logo img', '.posting-headline .sort-by-time'],
    },
    {
      host: /(^|\.)(myworkdayjobs\.com|workday\.com|wd1\.myworkdaysite\.com|wd5\.myworkdayjobs\.com)$/i,
      jd: ['[data-automation-id="jobPostingDescription"]', '[data-automation-id="job-posting-details"]'],
      role: ['[data-automation-id="jobPostingHeader"]', 'h1', 'h2'],
      company: ['[data-automation-id="companyName"]'],
    },
    {
      host: /(^|\.)ashbyhq\.com$/i,
      jd: ['._descriptionText_4fqrp_201', '[class*="descriptionText"]', '.ashby-job-posting-content'],
      role: ['h1', '[class*="jobPostingHeader"] h1'],
      company: ['[class*="companyName"]'],
    },
    {
      host: /(^|\.)glassdoor\.(com|co\.in|co\.uk)$/i,
      jd: ['.JobDetails_jobDescription__uW_fK', '[class*="jobDescriptionContent"]', '#JobDescriptionContainer'],
      role: ['[data-test="job-title"]', 'h1'],
      company: ['[data-test="employer-name"]'],
    },
    {
      host: /(^|\.)(ziprecruiter\.com|monster\.com|simplyhired\.com|dice\.com|wellfound\.com|angel\.co)$/i,
      jd: ['[class*="jobDescription"]', '[class*="job-description"]', '[data-testid="viewJobBodyJobFullDescriptionContent"]',
           '#jobDescriptionText'],
      role: ['h1'],
      company: ['[class*="companyName"]', '[class*="company-name"]'],
    },
  ];

  function adapterForHost() {
    return ADAPTERS.find(a => a.host.test(location.hostname)) || null;
  }

  function fromAdapter() {
    const a = adapterForHost();
    if (!a) return null;
    const jd = textOf(a.jd);
    if (!jd || jd.length < MIN_JD_LENGTH) return null;
    return {
      jd_string: clean(jd),
      role: clean(textOf(a.role)),
      company: clean(textOf(a.company)),
      source: 'adapter',
    };
  }

  // ── Layer 3: generic heuristic ───────────────────────
  // Score every sizeable text block by how much it reads like a job description,
  // and take the tightest-fitting winner. Catches company career pages and the
  // job boards nobody has written an adapter for.

  const JD_SIGNALS = [
    'responsibilit', 'requirement', 'qualification', 'what you.ll do', 'what you.ll bring',
    'about the role', 'about this role', 'about the job', 'who you are', 'your role',
    'experience', 'skills', 'we are looking for', 'we.re looking for', 'the ideal candidate',
    'benefits', 'preferred', 'must have', 'nice to have', 'job description', 'minimum',
  ];

  function jdScore(text) {
    const lower = text.toLowerCase();
    let score = 0;
    for (const sig of JD_SIGNALS) {
      if (new RegExp(sig).test(lower)) score += 1;
    }
    // Long enough to be a real posting, not so long it swallowed the whole page.
    if (text.length > 600) score += 1;
    if (text.length > 1500) score += 1;
    if (text.length > 12000) score -= 2;
    return score;
  }

  function fromHeuristic() {
    const nodes = document.querySelectorAll(
      'article, main, section, div[class*="descri"], div[class*="job"], div[id*="job"], div[class*="content"], div'
    );

    // Shortlist on textContent, which is free. innerText is what we actually want
    // to score (it respects line breaks and hidden elements) but every read forces
    // a layout reflow — on a heavy careers page, reading it for every div would
    // visibly jank the tab. So pay for it only on plausible blocks.
    const shortlist = [];
    for (const el of nodes) {
      if (el.closest('#tailorcv-sidebar')) continue;   // never score our own panel
      const len = (el.textContent || '').length;
      if (len < 400 || len > 25000) continue;
      shortlist.push(el);
    }
    // Score the tightest blocks first and cap the reflow budget there. Capping while
    // *collecting* would be a bug: on a deeply nested page the description is often
    // far down the node list, and we would drop it before ever scoring it.
    shortlist.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    const budget = shortlist.slice(0, 150);

    let best = null;
    let bestScore = 0;

    for (const el of budget) {
      const text = (el.innerText || '').trim();
      if (text.length < 400 || text.length > 25000) continue;

      const score = jdScore(text);
      if (score < 4) continue;

      // Prefer the tightest block at a given score: a child that still scores as
      // well as its parent is the description itself, not the page around it.
      if (score > bestScore || (score === bestScore && best && text.length < best.length)) {
        best = text;
        bestScore = score;
      }
    }

    if (!best) return null;
    return {
      jd_string: clean(best),
      role: clean(guessRole()),
      company: clean(guessCompany()),
      source: 'heuristic',
    };
  }

  function guessRole() {
    const h1 = textOf(['h1']);
    if (h1 && h1.length < 120) return h1;
    return (document.title || '').split(/[|–—-]/)[0].trim();
  }

  function guessCompany() {
    const meta = document.querySelector('meta[property="og:site_name"]');
    if (meta && meta.content) return meta.content.trim();
    const parts = location.hostname.replace(/^www\./, '').split('.');
    return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : '';
  }

  // ── The pipeline ─────────────────────────────────────

  function extractJob() {
    if (manualJd && manualJd.length >= MIN_JD_LENGTH) {
      return { jd_string: manualJd, role: guessRole(), company: guessCompany(), source: 'manual' };
    }
    for (const layer of [fromJsonLd, fromAdapter, fromHeuristic]) {
      let job = null;
      try { job = layer(); } catch (_) { /* a broken layer must not kill the panel */ }
      if (job && job.jd_string && job.jd_string.length >= MIN_JD_LENGTH) return job;
    }
    return null;
  }

  // When every layer misses, print what we saw. A site's real class names are worth
  // more than any amount of guessing from outside the browser — paste this at us and
  // the adapter becomes a one-line fix.
  function logDiagnostics() {
    const a = adapterForHost();
    const blocks = document.querySelectorAll('script[type="application/ld+json"]');

    console.groupCollapsed('%c[TailorCV] could not read this job page — diagnostics', 'color:#7c3aed;font-weight:700');
    console.log('host:', location.hostname);
    console.log('layer 1 — JSON-LD blocks on page:', blocks.length,
                '| JobPosting found:', !!fromJsonLd());
    console.log('layer 2 — site adapter:', a ? 'matched this host' : 'none for this host');
    if (a) {
      a.jd.forEach(sel => {
        let el = null;
        try { el = document.querySelector(sel); } catch (_) {}
        console.log(`   jd selector ${sel} →`, el ? `${(el.innerText || '').trim().length} chars` : 'no match');
      });
    }

    const top = [...document.querySelectorAll('div, section, article')]
      .filter(el => {
        const len = (el.textContent || '').length;
        return len > 400 && len < 25000 && !el.closest('#tailorcv-sidebar');
      })
      .sort((x, y) => (x.textContent || '').length - (y.textContent || '').length)
      .slice(0, 6)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        class: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
        chars: (el.textContent || '').length,
        score: jdScore(el.textContent || ''),
      }));
    console.log('layer 3 — best text blocks we could see (need score ≥ 4):');
    console.table(top);
    console.groupEnd();
  }

  const SOURCE_LABEL = {
    jsonld: 'Read from the job posting',
    adapter: 'Read from this page',
    heuristic: 'Detected on this page',
    manual: 'Using the text you provided',
  };

  // ── Panel shell ──────────────────────────────────────

  function createPanel() {
    if (document.getElementById('tailorcv-sidebar')) return;

    launcher = document.createElement('button');
    launcher.id = 'tailorcv-launcher';
    launcher.title = 'Open TailorCV';
    launcher.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="TailorCV">`;
    document.body.appendChild(launcher);

    sb = document.createElement('div');
    sb.id = 'tailorcv-sidebar';
    sb.innerHTML = `
      <div class="tcv-header">
        <span class="tcv-logo">TailorCV</span>
        <button class="tcv-toggle" title="Minimize">✕</button>
      </div>
      <div id="tcvBody"></div>
      <div class="tcv-progress-wrap" id="tcvProgressWrap">
        <div class="tcv-progress-circle">
          <svg class="tcv-progress-ring" width="88" height="88" viewBox="0 0 88 88">
            <defs>
              <linearGradient id="tcvProgressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#4f7fff"></stop>
                <stop offset="100%" stop-color="#c9b8ff"></stop>
              </linearGradient>
            </defs>
            <circle class="tcv-progress-track" cx="44" cy="44" r="30"></circle>
            <circle class="tcv-progress-bar" id="tcvProgressBar" cx="44" cy="44" r="30"></circle>
          </svg>
          <span class="tcv-progress-pct" id="tcvProgressPct">0%</span>
          <svg class="tcv-check-icon" id="tcvCheckIcon" width="88" height="88" viewBox="0 0 88 88">
            <path id="tcvCheckPath" d="M27 45 L39 57 L61 32" fill="none" stroke="#4ade80"
                  stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>
      </div>
      <div class="tcv-status-text" id="tcvGlobalStatus"></div>
    `;
    document.body.appendChild(sb);
    body = sb.querySelector('#tcvBody');
    // These live outside #tcvBody so they survive per-job re-renders — an in-flight
    // request stays visible even after switching to a different job.
    globalStatus = sb.querySelector('#tcvGlobalStatus');
    progressWrap = sb.querySelector('#tcvProgressWrap');
    progressBar = sb.querySelector('#tcvProgressBar');
    progressPct = sb.querySelector('#tcvProgressPct');
    checkIcon = sb.querySelector('#tcvCheckIcon');
    progressBar.style.strokeDasharray = String(PROGRESS_CIRCUMFERENCE);
    progressBar.style.strokeDashoffset = String(PROGRESS_CIRCUMFERENCE);

    sb.querySelector('.tcv-toggle').addEventListener('click', () => {
      sb.classList.add('tcv-collapsed');
      launcher.classList.add('tcv-visible');
    });
    launcher.addEventListener('click', () => {
      sb.classList.remove('tcv-collapsed');
      launcher.classList.remove('tcv-visible');
    });

    refreshFull();
  }

  function togglePanel() {
    if (!document.getElementById('tailorcv-sidebar')) { createPanel(); return; }
    sb.classList.toggle('tcv-collapsed');
    launcher.classList.toggle('tcv-visible');
  }

  // ── State renderers ──────────────────────────────────

  function renderLoading() {
    body.innerHTML = `<div class="tcv-status-text">Checking login…</div>`;
  }

  function renderLogin(errorMsg) {
    body.innerHTML = `
      <div class="tcv-msg">Log in to TailorCV to tailor your resume.</div>
      <form id="tcvLoginForm">
        <input type="email" id="tcvEmail" class="tcv-input" placeholder="Email" required autocomplete="username">
        <input type="password" id="tcvPassword" class="tcv-input" placeholder="Password" required autocomplete="current-password">
        <button type="submit" class="tcv-btn tcv-btn-start" id="tcvLoginBtn">Log in</button>
        <div class="tcv-error" id="tcvLoginError">${esc(errorMsg || '')}</div>
      </form>
    `;
    body.querySelector('#tcvLoginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = body.querySelector('#tcvEmail').value.trim();
      const password = body.querySelector('#tcvPassword').value;
      const btn = body.querySelector('#tcvLoginBtn');
      btn.disabled = true;
      btn.textContent = 'Logging in…';
      const res = await sendMessage({ type: 'LOGIN', email, password });
      if (res.error) {
        btn.disabled = false;
        btn.textContent = 'Log in';
        body.querySelector('#tcvLoginError').textContent = res.error;
        return;
      }
      refreshFull();
    });
  }

  function renderNoBaseResume() {
    body.innerHTML = `
      <div class="tcv-msg">No base resume set yet.</div>
      <a class="tcv-link" href="${BASE_URL}/extension" target="_blank">Set one up on TailorCV →</a>
    `;
  }

  // Layer 4. The page beat every extractor, so let the user hand us the text —
  // this is what keeps the extension useful on login-gated SPAs and odd career pages.
  function renderManual(prefill) {
    body.innerHTML = `
      <div class="tcv-msg">Paste the job description, or select it on the page and click Use&nbsp;selection.</div>
      <textarea id="tcvManualJd" class="tcv-textarea" rows="7"
                placeholder="Paste the job description here…">${esc(prefill || '')}</textarea>
      <button class="tcv-btn tcv-btn-outline" id="tcvUseSelection">Use selection from page</button>
      <button class="tcv-btn tcv-btn-start" id="tcvManualGo">Use this description</button>
      <div class="tcv-error" id="tcvManualError"></div>
    `;

    const ta = body.querySelector('#tcvManualJd');
    const err = body.querySelector('#tcvManualError');

    body.querySelector('#tcvUseSelection').addEventListener('click', () => {
      const sel = (window.getSelection() || '').toString().trim();
      if (!sel) {
        err.textContent = 'Select the job description on the page first, then click again.';
        return;
      }
      ta.value = sel;
      err.textContent = '';
    });

    body.querySelector('#tcvManualGo').addEventListener('click', () => {
      const text = ta.value.trim();
      if (text.length < MIN_JD_LENGTH) {
        err.textContent = `That is too short — paste at least ${MIN_JD_LENGTH} characters of the job description.`;
        return;
      }
      manualJd = text;
      renderJobFromPage();
    });
  }

  // ── Progress ring & upgrade prompt ───────────────────
  // From the LinkedIn panel: a ring that eases toward 92% while the model works,
  // then fills and draws a checkmark on success.

  function setProgress(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    progressBar.style.strokeDashoffset = String(PROGRESS_CIRCUMFERENCE * (1 - clamped / 100));
    progressPct.textContent = Math.round(clamped) + '%';
  }

  function startProgress() {
    progressWrap.classList.add('tcv-visible');
    progressBar.style.transition = 'stroke-dashoffset 0.2s linear';
    setProgress(0);
    const startedAt = performance.now();
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      setProgress(92 * (1 - Math.exp(-elapsedSeconds / 15))); // eases toward 92%, never quite reaches it
    }, 150);
  }

  function finishProgress(success) {
    clearInterval(progressTimer);
    progressBar.style.transition = 'stroke-dashoffset 0.4s ease';
    setProgress(100);

    if (!success) {
      setTimeout(() => progressWrap.classList.remove('tcv-visible'), 700);
      return;
    }

    // Let the ring visibly finish filling, then morph it into a drawn checkmark.
    setTimeout(() => {
      progressBar.classList.add('tcv-success');
      progressPct.classList.add('tcv-hidden');
      checkIcon.classList.add('tcv-visible');
    }, 350);
    setTimeout(() => {
      progressWrap.classList.remove('tcv-visible');
      progressBar.classList.remove('tcv-success');
      progressPct.classList.remove('tcv-hidden');
      checkIcon.classList.remove('tcv-visible');
    }, 1750);
  }

  function renderUpgradePrompt() {
    body.innerHTML = `
      <div class="tcv-upgrade-box">
        <div class="tcv-msg">You have used all your free tailors for this month.</div>
        <a class="tcv-btn tcv-btn-start tcv-btn-link" href="${BASE_URL}/pricing" target="_blank">⚡ Upgrade to Pro →</a>
        <a class="tcv-link tcv-retry-link" id="tcvRetryAfterUpgrade" href="#">Already upgraded? Retry</a>
      </div>
    `;
    body.querySelector('#tcvRetryAfterUpgrade').addEventListener('click', (e) => {
      e.preventDefault();
      quotaExceeded = false;
      renderJobFromPage();
    });
  }

  function renderReady(job) {
    const label = `${job.role || 'this job'}${job.company ? ' at ' + job.company : ''}`;
    body.innerHTML = `
      <div class="tcv-job-info">Tailoring for: <b>${esc(job.role || 'this job')}</b>${job.company ? ' at ' + esc(job.company) : ''}</div>
      <div class="tcv-match-row">Skill match: <span class="tcv-match-value" id="tcvMatchBefore">…</span></div>
      <div class="tcv-source">${SOURCE_LABEL[job.source] || ''} · <a href="#" id="tcvEditJd">not right?</a></div>
      <button class="tcv-btn tcv-btn-start" id="tcvTailorBtn">
        ${tcvBusy ? 'Working on another job…' : '✦ Tailor & Download Resume'}
      </button>
      <button class="tcv-btn tcv-btn-outline" id="tcvCoverBtn">
        ✉ Write a Cover Letter
      </button>
    `;

    body.querySelector('#tcvEditJd').addEventListener('click', (e) => {
      e.preventDefault();
      renderManual(job.jd_string);
    });

    // Both actions run off the same JD and the same stored base resume, so the cover
    // letter costs the user nothing extra to set up — it is the same click, once more.
    const btn = body.querySelector('#tcvTailorBtn');
    const coverBtn = body.querySelector('#tcvCoverBtn');
    if (tcvBusy) {
      btn.disabled = true;
      coverBtn.disabled = true;
    } else {
      btn.addEventListener('click', () => runTailor(job, label));
      coverBtn.addEventListener('click', () => runCoverLetter(job, label));
    }

    loadBeforeScore(job);
  }

  // Fires whenever a job is detected. The score is deterministic and LLM-free on
  // the server, so it lands within a second or two — well before the user has
  // decided whether to click Tailor.
  function loadBeforeScore(job) {
    const matchEl = body.querySelector('#tcvMatchBefore');
    if (!matchEl) return;
    sendMessage({ type: 'GET_SKILL_MATCH', jd_string: job.jd_string }).then((res) => {
      if (!matchEl.isConnected) return;   // user already moved to another job/state
      const score = res.data && typeof res.data.score === 'number' ? res.data.score : null;
      if (score === null) {
        matchEl.textContent = '—';
        return;
      }
      job.beforeScore = score;
      lastBeforeScore = score;
      matchEl.textContent = score + '%';
    });
  }

  async function runCoverLetter(job, label) {
    if (tcvBusy || !job) return;
    tcvBusy = true;
    renderJobFromPage();
    globalStatus.className = 'tcv-status-text';
    globalStatus.textContent = `Writing a cover letter for "${label}"…`;
    startProgress();

    const res = await sendMessage({
      type: 'COVER_LETTER',
      payload: {
        jd_string: job.jd_string,
        role: job.role,
        company: job.company,
        url: window.location.href,
      },
    });

    tcvBusy = false;
    finishProgress(!res.error);
    globalStatus.className = res.error ? 'tcv-status-text tcv-error' : 'tcv-status-text tcv-ok';
    globalStatus.textContent = res.error
      ? `✗ ${label}: ${res.error}`
      : `✓ Downloaded cover letter for "${label}"`;

    if (res.code === 'upgrade_required') quotaExceeded = true;

    if (sessionReady) renderJobFromPage();
  }

  async function runTailor(job, label) {
    if (tcvBusy || !job) return;
    const jobUrl = window.location.href; // snapshot now — navigation shouldn't retag this request
    tcvBusy = true;
    renderJobFromPage(); // re-render current button as disabled/"busy"
    globalStatus.className = 'tcv-status-text';
    globalStatus.textContent = `Tailoring "${label}"…`;
    startProgress();

    const res = await sendMessage({
      type: 'TAILOR_AND_DOWNLOAD',
      payload: {
        jd_string: job.jd_string,
        role: job.role,
        company: job.company,
        url: jobUrl,
      },
    });

    tcvBusy = false;
    finishProgress(!res.error);

    if (res.error) {
      globalStatus.className = 'tcv-status-text tcv-error';
      globalStatus.textContent = `✗ ${label}: ${res.error}`;
    } else {
      // The tailor response carries the post-tailor score in a header, so we can show
      // what the rewrite actually bought: "64% → 89%".
      const before = typeof job.beforeScore === 'number' ? job.beforeScore : lastBeforeScore;
      const after = res.data && typeof res.data.afterScore === 'number' ? res.data.afterScore : null;
      const matchText = after === null ? ''
        : (typeof before === 'number' ? ` — Match: ${before}% → ${after}%` : ` — Match: ${after}%`);
      globalStatus.className = 'tcv-status-text tcv-ok';
      globalStatus.textContent = `✓ Downloaded resume for "${label}"${matchText}`;
    }

    if (res.code === 'upgrade_required') quotaExceeded = true;

    // Refresh whichever job is on screen now that we're free to tailor again.
    if (sessionReady) renderJobFromPage();
  }

  // ── State machine ────────────────────────────────────

  // Sites like Naukri, Workday and most gig platforms paint the description with
  // JavaScript after the page loads, so a single read a second in finds nothing and
  // would strand the user on the paste box. Keep re-reading for a few seconds first.
  // extractGen invalidates an in-flight retry chain when the user navigates to
  // another posting, so a late result can't overwrite the new page's panel.
  let extractGen = 0;
  const EXTRACT_TRIES = 10;      // ~8s of watching before we ask the user
  const EXTRACT_EVERY = 800;

  function renderJobFromPage(attempt = 0, gen = ++extractGen) {
    if (gen !== extractGen) return;   // a newer page took over
    if (quotaExceeded) { renderUpgradePrompt(); return; }

    const job = extractJob();
    if (job) {
      if (attempt > 0) console.log(`[TailorCV] job description found after ${attempt} retries (${job.source})`);
      renderReady(job);
      return;
    }

    if (attempt >= EXTRACT_TRIES) {
      logDiagnostics();
      renderManual();
      return;
    }

    body.innerHTML = `<div class="tcv-status-text">Reading the job description…</div>`;
    setTimeout(() => renderJobFromPage(attempt + 1, gen), EXTRACT_EVERY);
  }

  async function refreshFull() {
    renderLoading();
    sessionReady = false;

    const profileRes = await sendMessage({ type: 'GET_PROFILE' });
    if (profileRes.error || !profileRes.data) { renderLogin(); return; }

    const baseRes = await sendMessage({ type: 'GET_BASE_RESUME' });
    if (baseRes.error || !baseRes.data || !baseRes.data.has_base_resume) { renderNoBaseResume(); return; }

    sessionReady = true;
    renderJobFromPage();
  }

  // ── Init ─────────────────────────────────────────────
  // On the boards we declare, only inject where the URL looks like a posting, so
  // we stay out of the way while someone browses. When the user opens us from the
  // toolbar (activeTab), that is an explicit request — inject regardless.

  const JOB_URL_HINT = /(job|career|opening|position|vacanc|posting|gig|apply)/i;

  // The URL must actually look like a posting. Matching merely because we have an
  // adapter for the host was wrong: it popped the panel open on naukri.com's logged-in
  // homepage, on Indeed's search page, on every page of a board the user was browsing.
  // The hostname counts too, so jobs.lever.co/<company>/<uuid> — whose path says nothing
  // — is still recognised.
  function looksLikeJobPage() {
    return JOB_URL_HINT.test(location.hostname + location.pathname + location.search);
  }

  const openedFromToolbar = window.__tailorcvFromToolbar === true;
  if (openedFromToolbar || looksLikeJobPage()) {
    setTimeout(createPanel, openedFromToolbar ? 0 : 1200);
  }

  // These boards are client-routed SPAs — re-read the page when the URL changes.
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    manualJd = '';   // a new posting: never carry the last one's text over
    setTimeout(() => {
      if (!document.getElementById('tailorcv-sidebar')) {
        if (looksLikeJobPage()) createPanel();
        return;
      }
      if (sessionReady) renderJobFromPage();
      else refreshFull();
    }, 1200);
  }).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE_PANEL') togglePanel();
  });

})();
