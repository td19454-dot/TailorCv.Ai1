// ═══════════════════════════════════════════════════════
// TailorCV Auto Apply  —  Internshala Content Script
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

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
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
      <div class="tcv-status-text" id="tcvStatus">Ready · Internshala</div>
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
    const strategies = [
      // Standard internship listing containers
      () => document.querySelectorAll('.internship_meta'),
      () => document.querySelectorAll('[class*="internship-listing"]'),
      () => document.querySelectorAll('.individual_internship'),
      () => document.querySelectorAll('[id^="internship_"]'),
      // Job listings (Internshala also has job listings)
      () => document.querySelectorAll('.job_meta'),
      () => document.querySelectorAll('[class*="job-listing"]'),
      () => document.querySelectorAll('.individual_job'),
      // Generic fallback: any container within the main result list
      () => {
        const list = document.querySelector(
          '#internship_list_container_1, #job_list_container_1, [id*="list_container"]'
        );
        return list ? list.querySelectorAll('[id^="internship_"], [id^="job_"]') : [];
      },
    ];

    for (const fn of strategies) {
      const nodes = fn();
      if (nodes && nodes.length > 0) return Array.from(nodes);
    }
    return [];
  }

  // Find the apply button inside a card or the details panel
  function findApplyButton(context) {
    const direct = [
      '.apply_now_btn',
      '[class*="apply-now"]',
      '[class*="apply_now"]',
      'a.easy_apply',
      '[class*="easy-apply"]',
      'button.apply',
      'a[href*="apply"]',
    ];
    for (const s of direct) {
      const el = context.querySelector(s);
      if (el && isVisible(el)) return el;
    }
    return findByText(['easy apply', 'apply now', 'apply'], context);
  }

  // ── Application modal handler ────────────────────────
  // Internshala typically shows a modal with availability, cover letter, and consent

  async function handleApplicationModal() {
    await sleep(1500);

    // Wait for the modal to appear
    let modal = null;
    try {
      modal = await waitFor(
        '#apply-modal, [class*="apply-modal"], [class*="applyModal"], .modal.in',
        6000
      );
    } catch {
      // No modal appeared — could be a redirect-based application
      return;
    }

    for (let step = 0; step < 15; step++) {
      if (tcvStop) throw new Error('Stopped by user');

      await sleep(800);

      // Check for success
      const bodyText = document.body.innerText.toLowerCase();
      if (
        bodyText.includes('application submitted') ||
        bodyText.includes('successfully applied') ||
        bodyText.includes('applied successfully') ||
        bodyText.includes('your application has been sent')
      ) return;

      // If modal is gone, treat as success
      const currentModal = document.querySelector(
        '#apply-modal, [class*="apply-modal"], [class*="applyModal"], .modal.in'
      );
      if (!currentModal || !isVisible(currentModal)) return;

      // Fill availability if empty
      const availInput = currentModal.querySelector(
        'input[name*="availability"], input[placeholder*="availability"], input[placeholder*="joining"]'
      );
      if (availInput && !availInput.value.trim()) {
        availInput.value = '1';
        availInput.dispatchEvent(new Event('input', { bubbles: true }));
        availInput.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(300);
      }

      // Fill cover letter if empty (fill with a generic placeholder)
      const coverLetter = currentModal.querySelector(
        'textarea[name*="cover"], textarea[placeholder*="cover"], textarea[name*="sop"]'
      );
      if (coverLetter && !coverLetter.value.trim()) {
        coverLetter.value =
          'I am excited about this opportunity and believe my skills align well with the requirements. I look forward to contributing to the team.';
        coverLetter.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
      }

      // Check unchecked checkboxes (consent)
      const checkbox = currentModal.querySelector('input[type="checkbox"]:not(:checked)');
      if (checkbox) { checkbox.click(); await sleep(300); continue; }

      // Handle radio groups — pick first option
      const radioGroup = currentModal.querySelector('[role="radiogroup"], .radio-group');
      if (radioGroup) {
        const firstRadio = radioGroup.querySelector('input[type="radio"], [role="radio"]');
        if (firstRadio && !firstRadio.checked) { firstRadio.click(); await sleep(300); }
      }

      // Click Submit / Continue / Next
      const btn = findByText(['submit application', 'submit', 'continue', 'next', 'apply'], currentModal);
      if (!btn) { await sleep(1200); continue; }

      const txt = btn.textContent.trim().toLowerCase();
      btn.click();
      await sleep(1200);

      if (txt.includes('submit')) {
        await sleep(2000);
        return;
      }
    }

    throw new Error('Modal steps exhausted without submission');
  }

  // ── Process one job card ─────────────────────────────

  async function processJob(card, index) {
    setStatus(`Processing ${index + 1}/${tcvTotal}…`);

    const titleEl   = card.querySelector('.profile a, h3 a, .job-title a, [class*="title"] a');
    const companyEl = card.querySelector('.company_name a, .company-name, [class*="company"]');
    const title   = (titleEl?.textContent || `Listing ${index + 1}`).trim();
    const company = (companyEl?.textContent || 'Unknown Company').trim();

    addLog('info', `${title} @ ${company}`);

    try {
      // Internshala shows a details panel on the right when a card is clicked
      card.click();
      await sleep(2000);

      // The "Apply Now" button may be on the right-side details panel
      let applyBtn =
        findApplyButton(card) ||
        findApplyButton(
          document.querySelector(
            '.internship_details, #right-internship-detail-container, [class*="detail-panel"]'
          ) || document
        );

      if (!applyBtn) throw new Error('No apply button found');
      if (!isVisible(applyBtn)) throw new Error('Apply button not visible');

      // Internshala sometimes opens jobs in new tabs — skip those
      if (applyBtn.tagName === 'A' && applyBtn.target === '_blank') {
        throw new Error('External application — skipped');
      }

      applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      applyBtn.click();
      await sleep(1500);

      await handleApplicationModal();

      await logApplication({ company, role: title, url: window.location.href, source: 'internshala' });
      tcvApplied++;
      updateStats();
      addLog('success', `Applied: ${title} @ ${company}`);

    } catch (err) {
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
      addLog('fail', 'No listings found. Make sure you are on an Internshala search results page.');
      stopAutoApply();
      return;
    }

    addLog('info', `Found ${jobs.length} listings. Starting…`);

    for (let i = 0; i < jobs.length; i++) {
      if (tcvStop) break;
      await processJob(jobs[i], i);
      if (!tcvStop) await randomDelay(3500, 8000);
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
    return /internshala\.com\/(internships|jobs)\//i.test(url);
  }

  if (isSearchPage()) {
    setTimeout(createSidebar, 2000);
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (isSearchPage()) setTimeout(createSidebar, 2000);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

})();
