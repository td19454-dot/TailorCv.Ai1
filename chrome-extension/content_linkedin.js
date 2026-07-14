// ═══════════════════════════════════════════════════════
// TailorCV Auto Apply  —  LinkedIn Jobs Content Script
// ═══════════════════════════════════════════════════════

(function () {
  'use strict';

  let tcvBusy = false;

  // ── Utilities ────────────────────────────────────────

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function textOf(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
    }
    return '';
  }

  function tailorAndDownload(payload) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'TAILOR_AND_DOWNLOAD', payload }, res => resolve(res || {}));
    });
  }

  // ── JD extraction ─────────────────────────────────────
  // LinkedIn's class names shift periodically, so fall back through a few
  // known selectors for the description panel, same defensive approach as
  // the Naukri job-card collector.

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

  // ── Panel ────────────────────────────────────────────

  function createPanel() {
    if (document.getElementById('tailorcv-sidebar')) return;

    const launcher = document.createElement('button');
    launcher.id = 'tailorcv-launcher';
    launcher.title = 'Open TailorCV';
    launcher.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="TailorCV">`;
    document.body.appendChild(launcher);

    const sb = document.createElement('div');
    sb.id = 'tailorcv-sidebar';
    sb.innerHTML = `
      <div class="tcv-header">
        <span class="tcv-logo">TailorCV</span>
        <button class="tcv-toggle" title="Minimize">✕</button>
      </div>
      <button class="tcv-btn tcv-btn-start" id="tcvTailorBtn">✦ Tailor &amp; Download Resume</button>
      <div class="tcv-status-text" id="tcvStatus">Ready · LinkedIn</div>
      <div class="tcv-log" id="tcvLog"></div>
    `;
    document.body.appendChild(sb);

    document.getElementById('tcvTailorBtn').addEventListener('click', runTailor);
    sb.querySelector('.tcv-toggle').addEventListener('click', () => {
      sb.classList.add('tcv-collapsed');
      launcher.classList.add('tcv-visible');
    });
    launcher.addEventListener('click', () => {
      sb.classList.remove('tcv-collapsed');
      launcher.classList.remove('tcv-visible');
    });
  }

  function setStatus(txt) {
    const el = document.getElementById('tcvStatus');
    if (el) el.textContent = txt;
  }

  function addLog(type, text) {
    const log = document.getElementById('tcvLog');
    if (!log) return;
    const div = document.createElement('div');
    div.className = `tcv-log-item tcv-${type}`;
    div.textContent = `${{ success: '✓', fail: '✗', info: '·' }[type] || '·'} ${text}`;
    log.prepend(div);
    while (log.children.length > 10) log.removeChild(log.lastChild);
  }

  // ── Main action ──────────────────────────────────────

  async function runTailor() {
    if (tcvBusy) return;
    const btn = document.getElementById('tcvTailorBtn');

    const jd_string = extractJobDescription();
    if (!jd_string || jd_string.length < 80) {
      addLog('fail', 'Could not find a job description on this page.');
      setStatus('No job description found');
      return;
    }

    const role = extractJobTitle() || 'Job';
    const company = extractCompany() || '';

    tcvBusy = true;
    btn.disabled = true;
    setStatus('Tailoring…');
    addLog('info', `${role}${company ? ' @ ' + company : ''}`);

    const res = await tailorAndDownload({ jd_string, role, company, url: window.location.href });

    tcvBusy = false;
    btn.disabled = false;

    if (res.error) {
      addLog('fail', res.error);
      setStatus('Failed');
    } else {
      addLog('success', 'Downloaded tailored resume');
      setStatus('Done');
    }
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
      maybeInject();
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
