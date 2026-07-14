// ═══════════════════════════════════════════════════════
// TailorCV Resume Tailor — LinkedIn Jobs Content Script
// The injected sidebar is the extension's only UI surface: it handles the
// login check, the base-resume check, and the Tailor & Download action.
// ═══════════════════════════════════════════════════════

(function () {
  'use strict';

  const BASE_URL = 'http://127.0.0.1:8005';
  let tcvBusy = false;
  let currentJob = null;
  let sb, body, launcher, globalStatus;
  // Cached once login + base-resume checks succeed, so switching between job
  // postings only re-extracts the JD instead of re-hitting the server for
  // things that don't change mid-session.
  let sessionReady = false;

  // ── Utilities ────────────────────────────────────────

  function textOf(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
    }
    return '';
  }

  function sendMessage(msg) {
    return new Promise(resolve => chrome.runtime.sendMessage(msg, res => resolve(res || {})));
  }

  // ── JD extraction ─────────────────────────────────────
  // LinkedIn's class names shift periodically, so fall back through a few
  // known selectors for the description panel.

  function extractJobDescription() {
    return textOf([
      '.jobs-description__content',
      '.jobs-box__html-content',
      '#job-details',
      '.jobs-description-content__text',
      '[class*="jobs-description"]',
    ]);
  }

  function extractJobTitle() {
    return textOf([
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1',
    ]);
  }

  function extractCompany() {
    return textOf([
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      '[class*="company-name"]',
    ]);
  }

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
      <div class="tcv-status-text" id="tcvGlobalStatus"></div>
    `;
    document.body.appendChild(sb);
    body = sb.querySelector('#tcvBody');
    // Lives outside #tcvBody so it survives per-job re-renders — an in-flight
    // tailor request stays visible even after switching to a different job.
    globalStatus = sb.querySelector('#tcvGlobalStatus');

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
        <div class="tcv-error" id="tcvLoginError">${errorMsg || ''}</div>
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
      <a class="tcv-link" href="${BASE_URL}/my-resumes" target="_blank">Set one up on TailorCV →</a>
    `;
  }

  function renderNoJobDescription() {
    body.innerHTML = `
      <div class="tcv-msg">Could not find a job description on this page.</div>
      <button class="tcv-btn tcv-btn-start" id="tcvRetryBtn">Retry</button>
    `;
    body.querySelector('#tcvRetryBtn').addEventListener('click', renderJobFromPage);
  }

  function renderReady(job) {
    currentJob = job;
    const label = `${job.role || 'this job'}${job.company ? ' at ' + job.company : ''}`;
    body.innerHTML = `
      <div class="tcv-job-info">Tailoring for: <b>${job.role || 'this job'}</b>${job.company ? ' at ' + job.company : ''}</div>
      <button class="tcv-btn tcv-btn-start" id="tcvTailorBtn">
        ${tcvBusy ? 'Tailoring another job…' : '✦ Tailor & Download Resume'}
      </button>
    `;
    const btn = body.querySelector('#tcvTailorBtn');
    if (tcvBusy) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => runTailor(job, label));
    }
  }

  async function runTailor(job, label) {
    if (tcvBusy || !job) return;
    const jobUrl = window.location.href; // snapshot now — navigation shouldn't retag this request
    tcvBusy = true;
    renderJobFromPage(); // re-render current button as disabled/"busy"
    globalStatus.className = 'tcv-status-text';
    globalStatus.textContent = `Tailoring "${label}"… this can take up to a minute.`;

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
    globalStatus.className = res.error ? 'tcv-status-text tcv-error' : 'tcv-status-text tcv-ok';
    globalStatus.textContent = res.error ? `✗ ${label}: ${res.error}` : `✓ Downloaded resume for "${label}"`;

    // Refresh whichever job is on screen now that we're free to tailor again.
    if (sessionReady) renderJobFromPage();
  }

  // ── State machine ────────────────────────────────────
  // refreshFull() re-verifies login + base-resume with the server — used on
  // first injection, after logging in, and whenever those checks last failed.
  // renderJobFromPage() only re-reads the DOM for the job currently on screen
  // — used when switching between job postings once the session is known good.

  function renderJobFromPage() {
    const jd_string = extractJobDescription();
    if (!jd_string || jd_string.length < 80) {
      renderNoJobDescription();
      return;
    }
    renderReady({ jd_string, role: extractJobTitle(), company: extractCompany() });
  }

  async function refreshFull() {
    renderLoading();
    sessionReady = false;

    const profileRes = await sendMessage({ type: 'GET_PROFILE' });
    if (profileRes.error || !profileRes.data) {
      renderLogin();
      return;
    }

    const baseRes = await sendMessage({ type: 'GET_BASE_RESUME' });
    if (baseRes.error || !baseRes.data || !baseRes.data.has_base_resume) {
      renderNoBaseResume();
      return;
    }

    sessionReady = true;
    renderJobFromPage();
  }

  function refreshOnNavigation() {
    if (sessionReady) renderJobFromPage();
    else refreshFull();
  }

  // ── Init: only inject on job pages ───────────────────

  function isJobPage() {
    return /linkedin\.com\/jobs\//i.test(window.location.href);
  }

  function maybeInject() {
    if (isJobPage()) setTimeout(createPanel, 1500);
  }

  maybeInject();
  // LinkedIn is a client-routed SPA — re-check on navigation.
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        if (!isJobPage()) return;
        if (document.getElementById('tailorcv-sidebar')) refreshOnNavigation();
        else createPanel();
      }, 1200);
    }
  }).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE_PANEL') togglePanel();
  });

})();
