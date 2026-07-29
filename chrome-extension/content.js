// ═══════════════════════════════════════════════════════
// TailorCV — AI Resume Optimizer — job page content script
//
// Runs automatically on the job boards declared in the manifest, and on demand
// (via the toolbar button + activeTab) on any other site. The injected sidebar
// is the extension's only UI surface: login check, base-resume check, skill
// match score, and the Tailor & Download / Cover Letter actions.
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

  const BASE_URL = 'https://thetailorcv.com';
  const MIN_JD_LENGTH = 200;

  // analytics.bundle.js (loaded before this file, see manifest.json) installs
  // these globals — guarded in case it failed to load on some page.
  function track(event, props) {
    if (typeof window.__tcvTrack === 'function') window.__tcvTrack(event, props);
  }
  const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * 30; // r=30 in the SVG below
  // The lock-check.svg loop is 4.7s at 30fps (141 frames). Frame 74 is the last
  // moment before it starts turning green / drawing the checkmark, so looping
  // [0, 74) reads as a pure "spinning lock" — the tick only plays once we know
  // login actually succeeded.
  const LOCK_FPS = 30;
  const LOCK_LOOP_END = 74 / LOCK_FPS;   // seconds
  const LOCK_TOTAL_DUR = 4.7;            // seconds, matches the SVG's dur="4.7s"
  // The icon itself is scaled to 0 at t=0 and only reaches full size around
  // t≈0.33s (baked into the SVG's own animation) — resetting the loop to a
  // point just past that instead of literal 0 keeps the icon visible on every
  // lap instead of periodically flashing blank on each restart.
  const LOCK_LOOP_START = 0.35;          // seconds

  let tcvBusy = false;
  let sb, body, launcher, globalStatus, progressWrap, progressBar, progressPct, progressTimer;
  let accountBtn, accountMenu, accountEmailEl;
  let successTick, scoreCard, scoreBeforeEl, scoreAfterEl, successTickTimer;
  let sessionReady = false;
  // True only while renderNoBaseResume() is on screen — lets reopening the
  // panel (togglePanel) recheck without disturbing an in-progress login form.
  let noBaseResumeShown = false;
  let manualJd = '';   // set when the user pastes or selects the JD themselves
  let lockSvgEl = null;
  let lockLoopTimer = null;
  // Once the free quota is hit, every job switch shows the upgrade prompt
  // directly instead of a tailor button that's guaranteed to 402 again.
  let quotaExceeded = false;

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

  // LinkedIn (and similar boards) sometimes render the follower/employee/connection
  // count right next to the company name with no separating space in the DOM text,
  // so a naive innerText read glues them into one string, e.g.
  // "Tata Consultancy Services19,209,861 followers". Strip that suffix off rather
  // than pass it to the tailoring backend as part of the company name.
  function cleanCompany(s) {
    if (!s) return s;
    return s
      .replace(/[\d][\d,.]*\s*[KkMm]?\+?\s*(followers?|connections?|employees?)\b[\s\S]*$/i, '')
      .replace(/[·•|,-]\s*$/, '')
      .trim();
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
        company: cleanCompany(clean(typeof org === 'string' ? org : (org && org.name) || '')),
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
      company: cleanCompany(clean(textOf(a.company))),
      source: 'adapter',
    };
  }

  // ── Layer 2.5: heading-label scan ────────────────────
  // Sites redesign their markup constantly, but the human-visible section
  // labels barely change. Find one of these labels and walk up to whichever
  // ancestor actually holds the JD-sized text — resilient to class/id
  // renames in a way no hardcoded selector list can be (see the Naukri
  // adapter note above: guessing another brittle selector just rots again).

  const HEADING_LABEL_PATTERNS = [
    /^about the job$/i, /^about this role$/i, /^about the role$/i,
    /^role description$/i, /^job description$/i, /^position summary$/i,
    /^job summary$/i, /^the role$/i, /^what you.ll do$/i, /^what you.ll be doing$/i,
    /^responsibilit(y|ies)\s*:?$/i, /^requirements?\s*:?$/i, /^qualifications?\s*:?$/i,
    /^who you are$/i, /^your role$/i,
  ];

  // Some LinkedIn layouts (e.g. the jobs/collections views) render the
  // description collapsed behind a "…see more" toggle, so the text actually in
  // the DOM at read time can be too short/thin to pass as a JD. Expand it before
  // reading. Scoped to a container we've already matched via a real section
  // label, and to button-like elements only (never <a>, so this can't trigger
  // an actual navigation) — not safe to run this broadly across the whole page.
  function expandTruncatedText(container) {
    for (const el of container.querySelectorAll('button, [role="button"]')) {
      const label = (el.textContent || '').trim().toLowerCase();
      if (/^(see|show)\s+more$/.test(label)) {
        try { el.click(); } catch (_) { /* best effort */ }
      }
    }
  }

  function fromHeadingLabel() {
    // Real <h1-h5>/<strong>/<b> tags are the exception, not the rule — most job
    // boards (LinkedIn included) render section labels as a plain, CSS-bolded
    // span/div/p with no semantic tag at all. So the candidate pool is "any leaf
    // element with short text," filtered on the cheap `children.length` check
    // before we ever touch `textContent`, to keep this affordable on a page with
    // thousands of nodes.
    const candidates = document.querySelectorAll('h1, h2, h3, h4, h5, strong, b, p, span, div, li, [role="heading"]');
    for (const el of candidates) {
      if (el.children.length > 0) continue;   // only leaf nodes carry just the label text
      if (el.closest('#tailorcv-sidebar')) continue;   // never match our own panel
      const label = (el.textContent || '').trim();
      if (!label || label.length > 60) continue;
      if (!HEADING_LABEL_PATTERNS.some(p => p.test(label))) continue;

      let container = el.closest('section, article, div') || el;
      for (let i = 0; i < 6 && container; i++) {
        if (container === document.body || container === document.documentElement) break;
        expandTruncatedText(container);
        const text = (container.innerText || '').trim();
        if (text.length >= MIN_JD_LENGTH && text.length <= 25000 && jdScore(text) >= 3) {
          return { jd_string: clean(text), role: clean(guessRole()), company: cleanCompany(clean(guessCompany(container))), source: 'heading' };
        }
        container = container.parentElement;
      }
    }
    return null;
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
    let bestEl = null;
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
        bestEl = el;
        bestScore = score;
      }
    }

    if (!best) return null;
    return {
      jd_string: clean(best),
      role: clean(guessRole()),
      company: cleanCompany(clean(guessCompany(bestEl))),
      source: 'heuristic',
    };
  }

  function guessRole() {
    const h1 = textOf(['h1']);
    if (h1 && h1.length < 120) return h1;
    return (document.title || '').split(/[|–—-]/)[0].trim();
  }

  // A link to /company/... is LinkedIn's own URL-routing convention for "this is
  // the hiring company," not a CSS class — far more stable than guessing at
  // selectors. scopeEl (when given) is the JD container we already matched, so
  // walking up from it keeps the search inside the selected job's own detail
  // pane instead of finding some *other* job card's company link.
  function guessCompany(scopeEl) {
    const pickLink = (root) => {
      for (const a of root.querySelectorAll('a[href*="/company/"]')) {
        if (a.closest('#tailorcv-sidebar')) continue;
        const text = (a.textContent || '').trim();
        if (text && text.length <= 80) return text;
      }
      return null;
    };

    let node = scopeEl || null;
    for (let i = 0; i < 6 && node; i++) {
      const found = pickLink(node);
      if (found) return found;
      node = node.parentElement;
    }

    // No reliable signal found. Guessing from meta[og:site_name] or the hostname
    // used to fill this in, but both name the *site* (e.g. "LinkedIn"), not
    // necessarily the hiring company — a wrong guess is worse than no company
    // name at all, since renderReady()/label building already treat an empty
    // company as "omit the 'at <company>' part" rather than showing a blank.
    return '';
  }

  // ── The pipeline ─────────────────────────────────────

  function extractJob() {
    if (manualJd && manualJd.length >= MIN_JD_LENGTH) {
      return { jd_string: manualJd, role: guessRole(), company: cleanCompany(guessCompany()), source: 'manual' };
    }
    for (const layer of [fromJsonLd, fromAdapter, fromHeadingLabel, fromHeuristic]) {
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
    console.log('layer 2.5 — heading-label scan: found match:', !!fromHeadingLabel());

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
    heading: 'Detected on this page',
    heuristic: 'Detected on this page',
    manual: 'Using the text you provided',
  };

  // ── Panel shell ──────────────────────────────────────

  // sidebar.css is bundled into styles.bundle.js (loaded before this file —
  // see manifest.json) and inserted here as a real <style> node, rather than
  // declared in manifest.json's content_scripts.css (or chrome.scripting.
  // insertCSS): those inject rules straight into the render engine with no
  // backing DOM node, which session-replay tools like rrweb/PostHog can't
  // discover, so the panel recorded as unstyled markup (see
  // https://github.com/PostHog/posthog/issues/23765). A runtime fetch of
  // sidebar.css was tried instead, but content-script fetches to
  // chrome-extension:// origins are subject to the host page's CSP
  // connect-src, and LinkedIn's blocks it — hence bundling the CSS in ahead
  // of time instead of fetching it live.
  let stylesReady = null;
  function ensureStyles() {
    if (stylesReady) return stylesReady;
    if (!document.getElementById('tailorcv-styles') && window.__tcvSidebarCss) {
      const style = document.createElement('style');
      style.id = 'tailorcv-styles';
      style.textContent = window.__tcvSidebarCss;
      document.head.appendChild(style);
    }
    stylesReady = Promise.resolve();
    return stylesReady;
  }

  async function createPanel() {
    if (document.getElementById('tailorcv-sidebar')) return;
    await ensureStyles();
    if (document.getElementById('tailorcv-sidebar')) return;   // re-check: async gap may race a second call

    launcher = document.createElement('button');
    launcher.id = 'tailorcv-launcher';
    launcher.title = 'Open TailorCV';
    launcher.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="TailorCV">`;
    document.body.appendChild(launcher);

    sb = document.createElement('div');
    sb.id = 'tailorcv-sidebar';
    sb.innerHTML = `
      <div class="tcv-header">
        <div class="tcv-brand">
          <img class="tcv-logo-icon" src="${chrome.runtime.getURL('icons/icon48.png')}" alt="">
          <span class="tcv-logo">TailorCV</span>
        </div>
        <div class="tcv-header-actions">
          <button class="tcv-account-btn" id="tcvAccountBtn" title="Account"></button>
          <button class="tcv-toggle" title="Minimize">✕</button>
        </div>
        <div class="tcv-account-menu" id="tcvAccountMenu">
          <div class="tcv-account-email" id="tcvAccountEmail"></div>
          <a class="tcv-account-item" href="${BASE_URL}/extension#ext-base-resume" target="_blank">Change base resume</a>
          <a class="tcv-account-item" href="${BASE_URL}/extension#ext-resume-template" target="_blank">Change resume template</a>
          <a class="tcv-account-item" href="${BASE_URL}/extension#ext-cover-template" target="_blank">Change cover letter template</a>
          <a class="tcv-account-item" href="${BASE_URL}/extension" target="_blank">Extension settings</a>
          <button class="tcv-account-item tcv-account-logout" id="tcvAccountLogout" type="button">Log out</button>
        </div>
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
        </div>
      </div>
      <div class="tcv-success-tick" id="tcvSuccessTick"></div>
      <div class="tcv-score-card" id="tcvScoreCard">
        <div class="tcv-score-item">
          <span class="tcv-score-num" id="tcvScoreBefore">--%</span>
          <span class="tcv-score-label">Before</span>
        </div>
        <span class="tcv-score-arrow">→</span>
        <div class="tcv-score-item">
          <span class="tcv-score-num tcv-score-after" id="tcvScoreAfter">--%</span>
          <span class="tcv-score-label">After</span>
        </div>
      </div>
      <div class="tcv-status-text" id="tcvGlobalStatus"></div>
    `;
    document.body.appendChild(sb);

    // Auto-injected on a declared job board (page load, no explicit user
    // action yet): start icon-only. Auth + base-resume + JD detection still
    // run immediately in the background (refreshFull() below doesn't check
    // collapse state), so by the time the user clicks the icon the panel is
    // usually already sitting on the ready state. A toolbar click is an
    // explicit "open it now" request, so that path starts expanded instead.
    const openedFromToolbar = window.__tailorcvFromToolbar === true;
    if (!openedFromToolbar) {
      sb.classList.add('tcv-collapsed');
      launcher.classList.add('tcv-visible');
    } else {
      track('panel_opened', { host: location.hostname, via: 'toolbar' });
    }

    body = sb.querySelector('#tcvBody');
    // These live outside #tcvBody so they survive per-job re-renders — an
    // in-flight tailor request stays visible even after switching jobs.
    globalStatus = sb.querySelector('#tcvGlobalStatus');
    progressWrap = sb.querySelector('#tcvProgressWrap');
    progressBar = sb.querySelector('#tcvProgressBar');
    progressPct = sb.querySelector('#tcvProgressPct');
    successTick = sb.querySelector('#tcvSuccessTick');
    scoreCard = sb.querySelector('#tcvScoreCard');
    scoreBeforeEl = sb.querySelector('#tcvScoreBefore');
    scoreAfterEl = sb.querySelector('#tcvScoreAfter');
    accountBtn = sb.querySelector('#tcvAccountBtn');
    accountMenu = sb.querySelector('#tcvAccountMenu');
    accountEmailEl = sb.querySelector('#tcvAccountEmail');
    progressBar.style.strokeDasharray = String(PROGRESS_CIRCUMFERENCE);
    progressBar.style.strokeDashoffset = String(PROGRESS_CIRCUMFERENCE);

    sb.querySelector('.tcv-toggle').addEventListener('click', () => {
      sb.classList.add('tcv-collapsed');
      launcher.classList.add('tcv-visible');
      accountMenu.classList.remove('tcv-visible');
    });
    launcher.addEventListener('click', () => {
      sb.classList.remove('tcv-collapsed');
      launcher.classList.remove('tcv-visible');
      track('panel_opened', { host: location.hostname, via: 'launcher' });
    });

    accountBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      accountMenu.classList.toggle('tcv-visible');
    });
    document.addEventListener('click', (e) => {
      if (accountMenu.classList.contains('tcv-visible') && !accountMenu.contains(e.target) && e.target !== accountBtn) {
        accountMenu.classList.remove('tcv-visible');
      }
    });
    sb.querySelector('#tcvAccountLogout').addEventListener('click', async () => {
      const logoutBtn = sb.querySelector('#tcvAccountLogout');
      accountMenu.classList.remove('tcv-visible');
      logoutBtn.disabled = true;
      logoutBtn.textContent = 'Logging out…';
      await sendMessage({ type: 'LOGOUT' });
      logoutBtn.disabled = false;
      logoutBtn.textContent = 'Log out';
      accountBtn.classList.remove('tcv-visible');
      refreshFull();
    });

    refreshFull();
  }

  function togglePanel() {
    if (!document.getElementById('tailorcv-sidebar')) { createPanel(); return; }
    const wasCollapsed = sb.classList.contains('tcv-collapsed');
    sb.classList.toggle('tcv-collapsed');
    launcher.classList.toggle('tcv-visible');

    // The auto-injected panel starts its ~8s auto-detect window right on page
    // load, often before LinkedIn (and similar SPAs) have finished painting the
    // job pane — so it can land on the manual-paste fallback before the user
    // has even looked at the panel. Opening it is a natural moment to give
    // detection another shot, as long as we're not stomping on text the user
    // already typed into that same box.
    if (wasCollapsed && sessionReady && !tcvBusy) {
      const ta = body.querySelector('#tcvManualJd');
      if (ta && !ta.value.trim()) renderJobFromPage();
    } else if (wasCollapsed && noBaseResumeShown && !tcvBusy) {
      // Reopening is also a natural moment to recheck a base resume that may
      // have been set up (in another tab) since this state was last shown —
      // a cheap fallback alongside the push notification and retry link.
      refreshFull();
    }
  }

  // ── State renderers ──────────────────────────────────

  // An <img>-loaded SVG can't be scripted (isolated rendering context), so to
  // control playback — loop only the spinning-lock portion while we wait, then
  // let the green-tick ending play once login is confirmed — the SVG has to be
  // inlined into the page DOM instead.
  async function renderLoading() {
    body.innerHTML = `
      <div class="tcv-loading-anim" id="tcvLoadingAnim"></div>
      <div class="tcv-loading-label">Authenticating</div>
    `;
    const container = body.querySelector('#tcvLoadingAnim');
    lockSvgEl = null;
    clearInterval(lockLoopTimer);
    const svgUrl = chrome.runtime.getURL('icons/lock-check.svg');
    try {
      const res = await fetch(svgUrl);
      if (!res.ok) throw new Error(`fetch ${svgUrl} → HTTP ${res.status}`);
      const svgText = await res.text();
      if (!container.isConnected) return; // state already moved on while we were fetching
      container.innerHTML = svgText;
      const svgEl = container.querySelector('svg');
      if (!svgEl || typeof svgEl.setCurrentTime !== 'function') {
        throw new Error('lock-check.svg did not parse into a scriptable <svg> root');
      }
      lockSvgEl = svgEl;
      svgEl.setCurrentTime(0); // play the one-time scale-up intro on first show
      lockLoopTimer = setInterval(() => {
        if (svgEl.getCurrentTime() >= LOCK_LOOP_END) svgEl.setCurrentTime(LOCK_LOOP_START);
      }, 50);
    } catch (e) {
      // Frame-accurate looping needs the inline, scriptable SVG above. If that
      // failed for any reason, fall back to a plain <img> so the loading state
      // still animates — it just can't be cut off at frame 74 this way.
      console.warn('[TailorCV] lock animation fallback (frame control unavailable):', e);
      if (container.isConnected) {
        container.innerHTML = `<img src="${svgUrl}" alt="">`;
      }
    }
  }

  // Stops re-looping the lock so the SVG's own timeline keeps playing forward
  // into the unlock + green-tick ending. Returns how much longer that takes,
  // so the caller can let a real network call run in parallel instead of
  // tacking the wait on afterward.
  function finishLockAnimation() {
    clearInterval(lockLoopTimer);
    if (!lockSvgEl) return 0;
    return Math.max(0, (LOCK_TOTAL_DUR - lockSvgEl.getCurrentTime()) * 1000);
  }

  function renderLogin(errorMsg) {
    body.innerHTML = `
      <div class="tcv-msg">Log in to TailorCV to tailor your resume.</div>
      <form id="tcvLoginForm">
        <label class="tcv-field-label" for="tcvEmail">Email</label>
        <input type="email" id="tcvEmail" class="tcv-input" placeholder="you@example.com" required autocomplete="username">
        <label class="tcv-field-label" for="tcvPassword">Password</label>
        <input type="password" id="tcvPassword" class="tcv-input" placeholder="Your password" required autocomplete="current-password">
        <button type="submit" class="tcv-btn tcv-btn-start" id="tcvLoginBtn">Log in</button>
        <div class="tcv-error" id="tcvLoginError">${esc(errorMsg || '')}</div>
      </form>
      <div class="tcv-divider"><span>or</span></div>
      <a class="tcv-btn tcv-btn-outline tcv-btn-link" href="${BASE_URL}/login?ext=1" target="_blank">Continue with Google →</a>
      <div class="tcv-login-links">
        <a class="tcv-link" href="${BASE_URL}/login?ext=1" target="_blank">Forgot password?</a>
        <a class="tcv-link" href="#" id="tcvLoginRetry">Already logged in? Retry</a>
      </div>
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
    body.querySelector('#tcvLoginRetry').addEventListener('click', (e) => {
      e.preventDefault();
      refreshFull();
    });
  }

  function renderNoBaseResume() {
    body.innerHTML = `
      <div class="tcv-empty-state">
        <div class="tcv-doc-wrap">
          <svg viewBox="0 0 120 140" width="130" height="152" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="8" width="82" height="104" rx="7" fill="#E8ECF4" stroke="#B8C3D8" stroke-width="2.5" />
            <path d="M72 8 L92 28 L72 28 Z" fill="#B8C3D8" />
            <path d="M72 8 L72 28 L92 28" stroke="#B8C3D8" stroke-width="2.5" stroke-linejoin="round" />
            <rect x="22" y="42" width="46" height="5" rx="2.5" fill="#C8D0E4" />
            <rect x="22" y="55" width="38" height="5" rx="2.5" fill="#C8D0E4" />
            <rect x="22" y="68" width="42" height="5" rx="2.5" fill="#C8D0E4" />
            <g class="tcv-doc-badge" style="transform-origin: 82px 98px;">
              <circle cx="82" cy="98" r="22" fill="url(#tcvBadgeGrad)" />
              <text x="82" y="106" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
                    font-weight="700" font-size="28" fill="white" letter-spacing="-1">?</text>
            </g>
            <defs>
              <radialGradient id="tcvBadgeGrad" cx="38%" cy="32%" r="68%">
                <stop offset="0%" stop-color="#E82040" />
                <stop offset="100%" stop-color="#A00820" />
              </radialGradient>
            </defs>
          </svg>
        </div>
      </div>
      <div class="tcv-msg tcv-empty-msg">No base resume set yet.</div>
      <a class="tcv-btn tcv-btn-start tcv-btn-link" href="${BASE_URL}/extension#ext-base-resume" target="_blank">Set one up on TailorCV →</a>
      <a class="tcv-link tcv-retry-link" href="#" id="tcvNoResumeRetry">Already set one up? Retry</a>
    `;
    noBaseResumeShown = true;
    body.querySelector('#tcvNoResumeRetry').addEventListener('click', (e) => {
      e.preventDefault();
      refreshFull();
    });
  }

  function renderUpgradePrompt() {
    body.innerHTML = `
      <div class="tcv-upgrade-box">
        <div class="tcv-msg">You've used all your free resume tailors for this month.</div>
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

  // Layer 4. The page beat every extractor, so let the user hand us the text —
  // this is what keeps the extension useful on login-gated SPAs and odd career pages.
  function renderManual(prefill) {
    // No prefill means this is the auto-fallback (every extractor missed), not
    // the user deliberately opening "not right? edit" on an already-found job —
    // only that case gets a retry link, so we don't offer to overwrite an
    // in-progress edit of a job that WAS detected.
    const showRetry = !prefill;
    body.innerHTML = `
      <div class="tcv-msg">Paste the job description, or select it on the page and click Use&nbsp;selection.</div>
      <textarea id="tcvManualJd" class="tcv-textarea" rows="7"
                placeholder="Paste the job description here…">${esc(prefill || '')}</textarea>
      <button class="tcv-btn tcv-btn-ghost" id="tcvUseSelection">Use selection from page</button>
      <button class="tcv-btn tcv-btn-start" id="tcvManualGo">Use this description</button>
      <div class="tcv-error" id="tcvManualError"></div>
      ${showRetry ? '<a class="tcv-link tcv-retry-link" id="tcvRetryDetect" href="#">Job description visible now? Retry detection</a>' : ''}
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

    if (showRetry) {
      body.querySelector('#tcvRetryDetect').addEventListener('click', (e) => {
        e.preventDefault();
        renderJobFromPage();
      });
    }
  }

  function renderReady(job) {
    if (quotaExceeded) { renderUpgradePrompt(); return; }
    const label = `${job.role || 'this job'}${job.company ? ' at ' + job.company : ''}`;
    body.innerHTML = `
      <div class="tcv-job-info">Job Title: <b>${esc(job.role || 'this job')}</b>${job.company ? ' at ' + esc(job.company) : ''}</div>
      <div class="tcv-source">${SOURCE_LABEL[job.source] || ''} · <a href="#" id="tcvEditJd">not right?</a></div>
      <div class="tcv-match" id="tcvMatch">
        <div class="tcv-match-head">
          <span class="tcv-match-label">Skill match</span>
          <span class="tcv-match-value" id="tcvMatchBefore">…</span>
        </div>
        <div class="tcv-match-bar"><span class="tcv-match-fill" id="tcvMatchFill"></span></div>
      </div>
      <button class="tcv-btn tcv-btn-start" id="tcvTailorBtn">
        ${tcvBusy ? 'Working on another job…' : '✦ Tailor & Download Resume'}
      </button>
      <button class="tcv-btn tcv-btn-ghost" id="tcvCoverBtn">
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

  // Fires immediately whenever a job is detected — deterministic and LLM-free
  // server-side, so this should resolve within a second or two, well before
  // the user has decided whether to click "Tailor & Download."
  function loadBeforeScore(job) {
    const matchEl = body.querySelector('#tcvMatchBefore');
    sendMessage({ type: 'GET_SKILL_MATCH', jd_string: job.jd_string }).then((res) => {
      if (!matchEl.isConnected) return; // user already moved to a different job/state
      if (res.code === 'no_base_resume') {
        // The base resume was there when the panel loaded but has since been
        // deleted (e.g. from the website in another tab) — the Tailor/Cover
        // Letter buttons on screen would just fail, so send the user straight
        // to the real "set one up" page instead of a stale, broken job view.
        sessionReady = false;
        renderNoBaseResume();
        return;
      }
      const score = res.data && typeof res.data.score === 'number' ? res.data.score : null;
      if (score === null) {
        // The scorer found no named hard skills in this posting (common on
        // founder / generalist / "culture" JDs), so there is nothing to match
        // against. Say so plainly instead of leaving a broken-looking empty bar.
        paintMatchUnavailable();
        return;
      }
      job.beforeScore = score;
      paintMatch(score);
    });
  }

  // The bar and its colour carry the verdict, so the number does not have to: a bare
  // "38%" leaves the user guessing whether that is bad. Red < 40, amber < 70, green up.
  function paintMatch(score) {
    const wrap = body.querySelector('#tcvMatch');
    const valueEl = body.querySelector('#tcvMatchBefore');
    const fillEl = body.querySelector('#tcvMatchFill');
    if (!wrap || !valueEl || !fillEl) return;
    wrap.classList.remove('tcv-na');
    valueEl.textContent = score + '%';
    wrap.classList.remove('tcv-low', 'tcv-mid', 'tcv-high');
    wrap.classList.add(score < 40 ? 'tcv-low' : score < 70 ? 'tcv-mid' : 'tcv-high');
    requestAnimationFrame(() => { fillEl.style.width = Math.max(2, Math.min(100, score)) + '%'; });
  }

  function paintMatchUnavailable() {
    const wrap = body.querySelector('#tcvMatch');
    const valueEl = body.querySelector('#tcvMatchBefore');
    if (!wrap || !valueEl) return;
    wrap.classList.remove('tcv-low', 'tcv-mid', 'tcv-high');
    wrap.classList.add('tcv-na');
    valueEl.textContent = 'N/A';
    // Swap the bar for a one-line explanation so the box does not read as a bug.
    const bar = wrap.querySelector('.tcv-match-bar');
    if (bar) bar.outerHTML = '<div class="tcv-match-note">This posting lists no specific skills to match — you can still tailor to it.</div>';
  }

  // The backend gives no incremental progress events for a single tailor
  // request, so this eases toward ~92% over the typical request duration and
  // snaps to 100% the moment the response actually comes back — reads as
  // real progress (ring + live number) without lying about a completion
  // time we can't know in advance.
  function setProgress(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    progressBar.style.strokeDashoffset = String(PROGRESS_CIRCUMFERENCE * (1 - clamped / 100));
    progressPct.textContent = Math.round(clamped) + '%';
  }

  // Clears whatever the previous run left showing (tick / score card), so a
  // fresh tailor request starts from a clean slate.
  function hideSuccessExtras() {
    clearTimeout(successTickTimer);
    successTick.classList.remove('tcv-visible');
    scoreCard.classList.remove('tcv-visible');
  }

  function startProgress() {
    hideSuccessExtras();
    progressWrap.classList.add('tcv-visible');
    progressBar.style.transition = 'stroke-dashoffset 0.2s linear';
    setProgress(0);
    const startedAt = performance.now();
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      setProgress(92 * (1 - Math.exp(-elapsedSeconds / 7.5))); // eases toward 92% (2x speed), never quite reaches it
    }, 150);
  }

  function finishProgress(success) {
    clearInterval(progressTimer);
    progressBar.style.transition = 'stroke-dashoffset 0.4s ease';
    setProgress(100);
    // Let the ring visibly finish filling, then fade it out — the success tick
    // (if any) takes over from here; runTailor() triggers that separately once
    // it knows the before/after scores.
    setTimeout(() => progressWrap.classList.remove('tcv-visible'), success ? 500 : 700);
  }

  // An <img>-loaded SVG can't be scripted, but we don't need to control this
  // one's playback frame-by-frame like the lock — it just needs to play once
  // and go away, so inlining is only needed for the fallback-detection pattern
  // shared with the other icons in this file (fetch, fall back to <img> on
  // any failure rather than showing nothing).
  async function showSuccessTick(beforeScore, afterScore) {
    successTick.classList.add('tcv-visible');
    successTick.innerHTML = '';
    const svgUrl = chrome.runtime.getURL('icons/success-check.svg');
    try {
      const res = await fetch(svgUrl);
      if (!res.ok) throw new Error(`fetch ${svgUrl} → HTTP ${res.status}`);
      const svgText = await res.text();
      if (!successTick.isConnected) return;
      successTick.innerHTML = svgText;
    } catch (e) {
      console.warn('[TailorCV] success tick fallback:', e);
      if (successTick.isConnected) successTick.innerHTML = `<img src="${svgUrl}" alt="">`;
    }
    clearTimeout(successTickTimer);
    successTickTimer = setTimeout(() => {
      successTick.classList.remove('tcv-visible');
      showScoreCard(beforeScore, afterScore);
    }, 2200);
  }

  function showScoreCard(beforeScore, afterScore) {
    if (typeof afterScore !== 'number') return; // nothing meaningful to show
    scoreBeforeEl.textContent = typeof beforeScore === 'number' ? beforeScore + '%' : '—';
    scoreAfterEl.textContent = afterScore + '%';
    scoreCard.classList.add('tcv-visible');
  }

  async function runCoverLetter(job, label) {
    if (tcvBusy || !job) return;
    tcvBusy = true;
    renderJobFromPage();
    globalStatus.className = 'tcv-status-text';
    globalStatus.textContent = `Writing a cover letter for "${label}"…`;
    startProgress();
    track('cover_letter_started', { source: job.source });

    const res = await sendMessage({
      type: 'COVER_LETTER',
      payload: {
        jd_string: job.jd_string,
        role: job.role,
        company: job.company,
        url: window.location.href,
      },
    });

    finishProgress(!res.error);
    tcvBusy = false;

    if (res.code === 'upgrade_required') {
      quotaExceeded = true;
      globalStatus.className = 'tcv-status-text';
      globalStatus.textContent = '';
      track('cover_letter_upgrade_required');
      renderUpgradePrompt();
      return;
    }

    if (res.code === 'no_base_resume') {
      sessionReady = false;
      globalStatus.className = 'tcv-status-text';
      globalStatus.textContent = '';
      renderNoBaseResume();
      return;
    }

    globalStatus.className = res.error ? 'tcv-status-text tcv-error' : 'tcv-status-text tcv-ok';
    globalStatus.textContent = res.error
      ? `✗ ${label}: ${res.error}`
      : `✓ Downloaded cover letter for "${label}"`;
    // No skill-match score for a cover letter — showSuccessTick() with no
    // afterScore plays the tick and simply skips the score card afterward.
    if (!res.error) showSuccessTick();
    track(res.error ? 'cover_letter_failed' : 'cover_letter_downloaded', { error: res.error });

    if (sessionReady) renderJobFromPage();
  }

  async function runTailor(job, label) {
    if (tcvBusy || !job) return;
    const jobUrl = window.location.href; // snapshot now — navigation shouldn't retag this request
    tcvBusy = true;
    renderJobFromPage(); // re-render current button as disabled/"busy"
    globalStatus.className = 'tcv-status-text';
    globalStatus.textContent = `Tailoring "${label}"… this can take up to a minute.`;
    startProgress();
    track('tailor_started', { source: job.source });

    const res = await sendMessage({
      type: 'TAILOR_AND_DOWNLOAD',
      payload: {
        jd_string: job.jd_string,
        role: job.role,
        company: job.company,
        url: jobUrl,
      },
    });

    finishProgress(!res.error);
    tcvBusy = false;

    if (res.code === 'upgrade_required') {
      quotaExceeded = true;
      globalStatus.className = 'tcv-status-text';
      globalStatus.textContent = '';
      track('tailor_upgrade_required');
      renderUpgradePrompt();
      return;
    }

    if (res.code === 'no_base_resume') {
      sessionReady = false;
      globalStatus.className = 'tcv-status-text';
      globalStatus.textContent = '';
      renderNoBaseResume();
      return;
    }

    if (res.error) {
      globalStatus.className = 'tcv-status-text tcv-error';
      globalStatus.textContent = `✗ ${label}: ${res.error}`;
      track('tailor_failed', { error: res.error });
    } else {
      globalStatus.className = 'tcv-status-text tcv-ok';
      globalStatus.textContent = `✓ Downloaded resume for "${label}"`;
      const after = res.data && typeof res.data.afterScore === 'number' ? res.data.afterScore : null;
      showSuccessTick(job.beforeScore, after);
      track('tailor_downloaded', { before_score: job.beforeScore, after_score: after });
    }

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

  // LinkedIn's /jobs/collections view (list + detail panel) never renders the
  // detail pane's JD on this soft nav — confirmed by diagnostic logging (every
  // extractor layer still misses after a full 32s watch), so unlike every other
  // board here, waiting longer buys nothing on this one path. A hard reload
  // reliably lands on a warmer render instead — confirmed by hand. Given a
  // reload after only a couple of tries (~2.4s, past LinkedIn's own
  // pushState/currentJobId routing settle time — see the 1200ms debounce on
  // the URL-change observer below) rather than the normal EXTRACT_TRIES budget,
  // since sitting through the full ~8s here would just be a longer wait for
  // the same, already-known outcome. Deliberately scoped to just this one
  // path: every other declared board (manifest.json) matches its entire
  // domain, not just single-posting pages, so a broader gate here (e.g. "any
  // declared adapter host") previously also reloaded Workday application
  // forms mid-fill (wiping answers) and Wellfound-style job LIST pages
  // (disruptive mid-browse reload) whenever there was nothing to find. Only
  // ever fires once per exact URL (sessionStorage, survives the reload) so a
  // job that's genuinely unreadable falls through to the manual-paste screen
  // instead of reloading forever.
  const LINKEDIN_COLLECTIONS_RELOAD = /^\/jobs\/collections(\/|$)/;
  const LINKEDIN_COLLECTIONS_TRIES = 3;   // ~2.4s, vs the normal ~8s
  function isLinkedInCollectionsPage() {
    return /(^|\.)linkedin\.com$/i.test(location.hostname) && LINKEDIN_COLLECTIONS_RELOAD.test(location.pathname);
  }
  function tryAutoRefreshOnce() {
    if (!isLinkedInCollectionsPage()) return false;
    const key = 'tailorcv_auto_refreshed:' + location.href;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch (_) {
      return false;   // sessionStorage unavailable — don't reload blind
    }
    location.reload();
    return true;
  }

  function renderJobFromPage(attempt = 0, gen = ++extractGen) {
    if (gen !== extractGen) return;   // a newer page took over
    if (quotaExceeded) { renderUpgradePrompt(); return; }

    const job = extractJob();
    if (job) {
      if (attempt > 0) console.log(`[TailorCV] job description found after ${attempt} retries (${job.source})`);
      renderReady(job);
      return;
    }

    const maxTries = isLinkedInCollectionsPage() ? LINKEDIN_COLLECTIONS_TRIES : EXTRACT_TRIES;
    if (attempt >= maxTries) {
      if (tryAutoRefreshOnce()) return;   // page is reloading — nothing left to render
      logDiagnostics();
      renderManual();
      return;
    }

    body.innerHTML = `<div class="tcv-status-text">Reading the job description…</div>`;
    setTimeout(() => renderJobFromPage(attempt + 1, gen), EXTRACT_EVERY);
  }

  async function refreshFull() {
    await renderLoading();
    sessionReady = false;
    noBaseResumeShown = false;
    quotaExceeded = false;

    const profileRes = await sendMessage({ type: 'GET_PROFILE' });
    if (profileRes.error || !profileRes.data) {
      clearInterval(lockLoopTimer); // not authenticated — cut the loop, no unlock flourish
      accountBtn.classList.remove('tcv-visible');
      renderLogin();
      return;
    }

    const email = profileRes.data.email || '';
    accountEmailEl.textContent = email;
    accountBtn.textContent = email.trim().charAt(0).toUpperCase() || '?';
    accountBtn.classList.add('tcv-visible');
    if (typeof window.__tcvIdentify === 'function') window.__tcvIdentify(email);

    // Login confirmed: let the lock finish unlocking (green tick) while the
    // base-resume check runs at the same time, so the flourish adds no extra
    // wait beyond whichever of the two actually takes longer.
    const remainingMs = finishLockAnimation();
    const [baseRes] = await Promise.all([
      sendMessage({ type: 'GET_BASE_RESUME' }),
      new Promise((resolve) => setTimeout(resolve, remainingMs)),
    ]);
    if (baseRes.error || !baseRes.data || !baseRes.data.has_base_resume) { renderNoBaseResume(); return; }

    sessionReady = true;
    renderJobFromPage();
  }

  // ── Init ─────────────────────────────────────────────
  // On the boards we declare, only inject where the URL looks like a posting, so
  // we stay out of the way while someone browses. When the user opens us from the
  // toolbar (activeTab), that is an explicit request — inject regardless.

  const JOB_URL_HINT = /(job|career|opening|position|vacanc|posting|gig|apply)/i;

  // LinkedIn's whole /jobs/* tree matches the manifest (needed for both the
  // classic single-posting view and the collections/search list-with-detail
  // view), but the bare /jobs/ home and a search/collections list with no job
  // picked yet aren't actually showing a job — nothing to detect, so the panel
  // shouldn't fire there at all. A specific job is only genuinely on screen at
  // /jobs/view/<id>, or once the user picks one from a list view, which
  // LinkedIn signals by adding ?currentJobId=<id> to the URL (no full nav).
  const LINKEDIN_JOB_VIEW = /^\/jobs\/view\/\d+/;

  function looksLikeJobPage() {
    if (/(^|\.)linkedin\.com$/i.test(location.hostname)) {
      return LINKEDIN_JOB_VIEW.test(location.pathname) || /[?&]currentJobId=/.test(location.search);
    }
    return JOB_URL_HINT.test(location.pathname + location.search) || !!adapterForHost();
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
      if (!looksLikeJobPage()) return;   // e.g. LinkedIn nav'd back to a list with no job picked — nothing to (re-)detect
      if (sessionReady) renderJobFromPage();
      else refreshFull();
    }, 1200);
  }).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE_PANEL') {
      togglePanel();
    } else if (msg.type === 'REFRESH_AUTH') {
      // The login tab we opened (Continue with Google / Forgot password, both
      // carry ?ext=1) told background.js it succeeded via externally_connectable
      // — see tailorCvFinishLogin() in login.html — which broadcasts this to
      // every open tab. Re-check auth so the panel updates itself instead of
      // the user having to click "Already logged in? Retry".
      if (document.getElementById('tailorcv-sidebar')) refreshFull();
    }
  });

})();
