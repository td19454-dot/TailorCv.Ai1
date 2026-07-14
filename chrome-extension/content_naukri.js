// ═══════════════════════════════════════════════════════
// TailorCV Auto Apply  —  Naukri.com Content Script
// ═══════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────
  let tcvRunning  = false;
  let tcvStop     = false;
  let tcvApplied  = 0;
  let tcvFailed   = 0;
  let tcvTotal    = 0;
  let tcvProfile  = null;

  // ── Utilities ────────────────────────────────────────

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function randomDelay(min = 3000, max = 7000) {
    return sleep(min + Math.random() * (max - min));
  }

  function waitFor(selector, timeout = 8000, root = document) {
    return new Promise((resolve, reject) => {
      const found = root.querySelector(selector);
      if (found) { resolve(found); return; }
      const obs = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
    });
  }

  // Find the first button/link whose visible text matches any of the given strings
  function findByText(candidates, root = document) {
    const lower = candidates.map(c => c.toLowerCase());
    const nodes = root.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]');
    for (const node of nodes) {
      const t = (node.value || node.textContent || '').trim().toLowerCase();
      if (lower.some(c => t.includes(c))) return node;
    }
    return null;
  }

  function getProfile() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_PROFILE' }, res => resolve(res?.data || null));
    });
  }

  function logApplication(payload) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'LOG_APPLICATION', payload }, res => resolve(res));
    });
  }

  // ── Sidebar ──────────────────────────────────────────

  function createSidebar() {
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
      <div class="tcv-stats">
        <div class="tcv-stat">
          <span class="tcv-stat-num tcv-blue"  id="tcvTotal">0</span>
          <span class="tcv-stat-label">Found</span>
        </div>
        <div class="tcv-stat">
          <span class="tcv-stat-num tcv-green" id="tcvApplied">0</span>
          <span class="tcv-stat-label">Applied</span>
        </div>
        <div class="tcv-stat">
          <span class="tcv-stat-num tcv-red"   id="tcvFailed">0</span>
          <span class="tcv-stat-label">Failed</span>
        </div>
      </div>
      <button class="tcv-btn tcv-btn-start" id="tcvStartBtn">▶ Start Auto Apply</button>
      <button class="tcv-btn tcv-btn-stop"  id="tcvStopBtn"  style="display:none;">■ Stop</button>
      <div class="tcv-status-text" id="tcvStatus">Ready · Naukri</div>
      <div class="tcv-log" id="tcvLog"></div>
    `;
    document.body.appendChild(sb);

    document.getElementById('tcvStartBtn').addEventListener('click', startAutoApply);
    document.getElementById('tcvStopBtn').addEventListener('click', stopAutoApply);
    sb.querySelector('.tcv-toggle').addEventListener('click', () => {
      sb.classList.add('tcv-collapsed');
      launcher.classList.add('tcv-visible');
    });
    launcher.addEventListener('click', () => {
      sb.classList.remove('tcv-collapsed');
      launcher.classList.remove('tcv-visible');
    });
  }

  function updateStats() {
    const g = id => document.getElementById(id);
    if (g('tcvTotal'))   g('tcvTotal').textContent   = tcvTotal;
    if (g('tcvApplied')) g('tcvApplied').textContent = tcvApplied;
    if (g('tcvFailed'))  g('tcvFailed').textContent  = tcvFailed;
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
    while (log.children.length > 25) log.removeChild(log.lastChild);
  }

  // ── Job-card collection ──────────────────────────────

  function collectJobs() {
    // Naukri uses obfuscated class names — fall back through multiple strategies
    const strategies = [
      () => document.querySelectorAll('article.jobTuple'),
      () => document.querySelectorAll('[class*="srp-jobtuple"]'),
      () => document.querySelectorAll('[class*="jobTuple"]'),
      () => document.querySelectorAll('[data-job-id]'),
      // Last resort: any article inside the main list region
      () => {
        const list = document.querySelector('[class*="srp-results"], [class*="list-container"], .list');
        return list ? list.querySelectorAll('article, [class*="job-card"]') : [];
      },
    ];

    for (const fn of strategies) {
      const nodes = fn();
      if (nodes && nodes.length > 0) return Array.from(nodes);
    }
    return [];
  }

  // Find the apply button inside a card or the details panel that slides in
  function findApplyButton(context) {
    // Direct selectors first
    const direct = ['#apply-button', '[id*="apply-button"]', '[class*="applyBtn"]',
                    'button.apply-button', 'a.apply-button', '[class*="apply-btn"]'];
    for (const s of direct) {
      const el = context.querySelector(s);
      if (el && isVisible(el)) return el;
    }
    // Text-based
    return findByText(['easy apply', 'apply now', 'apply'], context);
  }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
  }

  // ── Easy Apply dialog handler ────────────────────────

  async function handleEasyApplyDialog() {
    await sleep(2000);

    for (let step = 0; step < 20; step++) {
      if (tcvStop) throw new Error('Stopped by user');

      // Success detection
      const bodyText = document.body.innerText.toLowerCase();
      if (
        bodyText.includes('application submitted') ||
        bodyText.includes('successfully applied') ||
        bodyText.includes('application sent') ||
        bodyText.includes('applied successfully')
      ) return;

      await sleep(1000);

      // Select unchecked checkboxes (consent / terms)
      const checkbox = document.querySelector(
        '[class*="chatbot"] input[type="checkbox"]:not(:checked),' +
        '[class*="applyModal"] input[type="checkbox"]:not(:checked)'
      );
      if (checkbox) { checkbox.click(); await sleep(400); continue; }

      // Pick first radio option if nothing selected yet
      const radioParent = document.querySelector(
        '[class*="chatbot"] [role="radiogroup"], [class*="applyModal"] [role="radiogroup"]'
      );
      if (radioParent) {
        const firstRadio = radioParent.querySelector('input[type="radio"], [role="radio"]');
        if (firstRadio && !firstRadio.checked) { firstRadio.click(); await sleep(400); }
      }

      // Proceed / Submit
      const btn = findByText(['submit application', 'submit', 'proceed', 'continue', 'next', 'apply']);
      if (!btn) {
        // Dialog may have closed silently
        const dialog = document.querySelector(
          '[class*="chatbot"], [class*="applyModal"], [class*="apply-drawer"], [class*="applyDrawer"]'
        );
        if (!dialog || !isVisible(dialog)) return; // treated as success
        await sleep(1500);
        continue;
      }

      const txt = btn.textContent.trim().toLowerCase();
      btn.click();
      await sleep(1400);

      if (txt.includes('submit')) {
        await sleep(2500);
        return; // submitted
      }
    }
    throw new Error('Max steps reached without submission');
  }

  // ── Process one job card ─────────────────────────────

  async function processJob(card, index) {
    setStatus(`Processing ${index + 1}/${tcvTotal}…`);

    const titleEl   = card.querySelector('[class*="title"] a, .title a, h2 a, h3 a, a[title]');
    const companyEl = card.querySelector('[class*="comp-name"], .comp-name, [class*="company"]');
    const title     = (titleEl?.textContent || titleEl?.title || `Job ${index + 1}`).trim();
    const company   = (companyEl?.textContent || 'Unknown Company').trim();

    addLog('info', `${title} @ ${company}`);

    try {
      // Click the card to load the details panel (Naukri SRP side-panel pattern)
      card.click();
      await sleep(1800);

      // Check for a details panel appearing on the right
      let applyBtn =
        findApplyButton(card) ||
        findApplyButton(
          document.querySelector('[class*="job-desc"], [class*="jobDesc"], [class*="details-panel"]') || document
        );

      if (!applyBtn) throw new Error('No apply button found');
      if (!isVisible(applyBtn)) throw new Error('Apply button not visible');

      // Skip external application links (new-tab jobs)
      if (applyBtn.tagName === 'A' && applyBtn.target === '_blank') {
        throw new Error('External application — skipped');
      }

      applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      applyBtn.click();
      await sleep(1500);

      await handleEasyApplyDialog();

      await logApplication({ company, role: title, url: window.location.href, source: 'naukri' });
      tcvApplied++;
      updateStats();
      addLog('success', `Applied: ${title} @ ${company}`);

    } catch (err) {
      // Dismiss any open dialog
      dismissDialog();
      tcvFailed++;
      updateStats();
      addLog('fail', `Failed: ${title} — ${err.message}`);
    }
  }

  function dismissDialog() {
    const closeBtn = findByText(['close', 'cancel', 'dismiss']);
    if (closeBtn) closeBtn.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  // ── Main loop ────────────────────────────────────────

  async function startAutoApply() {
    if (tcvRunning) return;

    tcvProfile = await getProfile();
    if (!tcvProfile) {
      addLog('fail', 'Not logged in to TailorCV. Please log in first.');
      return;
    }

    tcvRunning = true;
    tcvStop    = false;
    tcvApplied = 0;
    tcvFailed  = 0;

    document.getElementById('tcvStartBtn').style.display = 'none';
    document.getElementById('tcvStopBtn').style.display  = 'block';

    const jobs = collectJobs();
    tcvTotal   = jobs.length;
    updateStats();

    if (jobs.length === 0) {
      addLog('fail', 'No job listings found on this page. Make sure you are on a Naukri search results page.');
      stopAutoApply();
      return;
    }

    addLog('info', `Found ${jobs.length} listings. Starting…`);

    for (let i = 0; i < jobs.length; i++) {
      if (tcvStop) break;
      await processJob(jobs[i], i);
      if (!tcvStop) await randomDelay(3500, 8000); // human-like delay
    }

    tcvRunning = false;
    document.getElementById('tcvStartBtn').style.display = 'block';
    document.getElementById('tcvStopBtn').style.display  = 'none';
    setStatus(`Done — ✓ ${tcvApplied}  ✗ ${tcvFailed}`);
  }

  function stopAutoApply() {
    tcvStop    = true;
    tcvRunning = false;
    document.getElementById('tcvStartBtn').style.display = 'block';
    document.getElementById('tcvStopBtn').style.display  = 'none';
    setStatus('Stopped');
    addLog('info', 'Stopped by user');
  }

  // ── Init: only inject on search-results pages ────────

  function isSearchPage() {
    const url = window.location.href;
    return /naukri\.com\/.+jobs|naukri\.com\/jobs\//i.test(url);
  }

  if (isSearchPage()) {
    // Give the React app time to paint
    setTimeout(createSidebar, 2000);
    // Re-check after navigations (Naukri does SPA routing)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (isSearchPage()) setTimeout(createSidebar, 2000);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

})();
