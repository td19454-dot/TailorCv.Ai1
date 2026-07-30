// TailorCV — AI Resume Optimizer — Background Service Worker
const BASE_URL = 'http://127.0.0.1:8005';

async function getCsrfToken() {
  // Make sure a csrftoken cookie exists (the server sets one on every response),
  // then read it back — the double-submit CSRF pattern needs it echoed as a header.
  await fetch(`${BASE_URL}/api/auth/me`, { credentials: 'include' }).catch(() => {});
  const cookie = await chrome.cookies.get({ url: BASE_URL, name: 'csrftoken' });
  return cookie ? cookie.value : '';
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Clicking the toolbar icon toggles the sidebar (no popup — the sidebar is the
// extension's only UI surface). On the job boards we declare in the manifest the
// content script is already there, so we just toggle it. On ANY other site —
// Mercor, Outlier, Alignerr, a company careers page — nothing is loaded yet, so
// the click itself grants us that one tab via activeTab and we inject on demand.
// That is what lets the extension work everywhere without asking every user for
// "read your data on all websites" at install time.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  // chrome.permissions is not exposed to content scripts at all, and a
  // request() relayed through this service worker via runtime messaging does
  // not reliably count as user-gesture-triggered — Chrome silently denies it
  // with no visible prompt (see requestBroadPermission() in content.js,
  // where a "please click the toolbar icon" flag is set instead of calling
  // request() directly). A native toolbar click IS a trusted gesture, so
  // this is where the actual prompt fires.
  const { tcv_permission_pending } = await chrome.storage.local.get('tcv_permission_pending');
  if (tcv_permission_pending) {
    try {
      await chrome.permissions.request({ origins: ['*://*/*'] });
    } catch (e) {
      console.warn('TailorCV: permission request failed —', e.message);
    }
    await chrome.storage.local.remove('tcv_permission_pending');
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
    return;   // content script was already running — toggled it
  } catch (_) {
    // No listener on that tab: not a declared site, so inject now.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__tailorcvFromToolbar = true; },
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['analytics.bundle.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['styles.bundle.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['autofill.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    // chrome:// pages, the Web Store and PDF viewers can never be injected into.
    console.warn('TailorCV: cannot run on this page —', e.message);
  }
});

// The login page (opened with ?ext=1 — see content.js) calls
// chrome.runtime.sendMessage(EXTENSION_ID, ...) directly once login succeeds,
// via the "externally_connectable" channel declared in the manifest. This is
// deliberately NOT window.opener + postMessage: that approach broke because
// Google's Identity Services script severs window.opener as a side effect of
// its own COOP/popup handling, regardless of which login method was used.
// externally_connectable doesn't depend on any window relationship at all, so
// it isn't affected by that. We don't know which tab originally opened the
// login flow (there's no window reference here), so broadcast to every open
// tab the extension runs on — content.js only acts on it if its own sidebar
// is actually showing the logged-out state.
// Same channel as the login flow above, fired instead by the "Set up your
// extension" page (see templates/extension.html) once a base resume is
// actually saved, or by the website's /profile page (see templates/
// profile.html) once application details are saved there — so a panel stuck
// on "no base resume set", or a sidebar still holding a stale cached
// profile, catches up on its own instead of the user having to notice and
// refresh it by hand.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  const KNOWN_TYPES = ['tailorcv-login-success', 'tailorcv-base-resume-updated', 'tailorcv-apply-profile-updated'];
  if (!msg || !KNOWN_TYPES.includes(msg.type)) return;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_AUTH' }).catch(() => {});
    }
  });
  sendResponse({ ok: true });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'GET_ANALYTICS_ID') {
        // One stable id per install, shared across every tab/site the content
        // script runs on — chrome.storage.local (not localStorage, which is
        // partitioned per-site and would fragment identity across job boards).
        const stored = await chrome.storage.local.get('tcv_distinct_id');
        let id = stored.tcv_distinct_id;
        if (!id) {
          id = crypto.randomUUID();
          await chrome.storage.local.set({ tcv_distinct_id: id });
        }
        sendResponse({ id });

      } else if (msg.type === 'GET_PROFILE') {
        const res = await fetch(`${BASE_URL}/api/extension/profile`, {
          credentials: 'include',
        });
        if (!res.ok) {
          sendResponse({ error: 'Not logged in to TailorCV.' });
          return;
        }
        sendResponse({ data: await res.json() });

      } else if (msg.type === 'LOGIN') {
        try {
          const csrfToken = await getCsrfToken();
          const res = await fetch(`${BASE_URL}/api/login`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': csrfToken,
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ email: msg.email, password: msg.password }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            sendResponse({ error: data.detail || 'Login failed. Check your email and password.' });
            return;
          }
          sendResponse({ data });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'LOGOUT') {
        try {
          const csrfToken = await getCsrfToken();
          await fetch(`${BASE_URL}/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'X-CSRFToken': csrfToken,
              'X-Requested-With': 'XMLHttpRequest',
            },
          });
          sendResponse({ data: { success: true } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'GET_BASE_RESUME') {
        const res = await fetch(`${BASE_URL}/api/extension/base-resume`, { credentials: 'include' });
        if (!res.ok) {
          sendResponse({ error: 'Not logged in to TailorCV.' });
          return;
        }
        sendResponse({ data: await res.json() });

      } else if (msg.type === 'GET_SKILL_MATCH') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/skill-match`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jd_string: msg.jd_string }),
          });
          if (!res.ok) {
            const code = res.status === 404 ? 'no_base_resume' : res.status === 401 ? 'not_logged_in' : null;
            sendResponse({ error: 'Could not compute match score.', code });
            return;
          }
          sendResponse({ data: await res.json() });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'COVER_LETTER') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/cover-letter`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.payload),
          });

          if (!res.ok) {
            let detail = 'Could not write your cover letter.';
            let code = null;
            try {
              const data = await res.json();
              if (res.status === 401) {
                detail = 'Not logged in to TailorCV. Open the TailorCV panel to log in.';
                code = 'not_logged_in';
              } else if (res.status === 402 || data.error === 'upgrade_required') {
                detail = 'Free cover letter used. Upgrade to Pro at thetailorcv.com.';
                code = 'upgrade_required';
              } else if (res.status === 404) {
                detail = 'No base resume set. Set one up at thetailorcv.com/extension.';
                code = 'no_base_resume';
              } else if (data.detail) {
                detail = data.detail;
              }
            } catch (_) { /* keep the default */ }
            sendResponse({ error: detail, code });
            return;
          }

          const buffer = await res.arrayBuffer();
          const dataUrl = `data:application/pdf;base64,${arrayBufferToBase64(buffer)}`;
          await chrome.downloads.download({
            url: dataUrl,
            filename: 'cover_letter.pdf',
            saveAs: false,
          });
          sendResponse({ data: { success: true } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'TAILOR_AND_DOWNLOAD') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/tailor-resume`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.payload),
          });

          if (!res.ok) {
            let detail = 'Could not tailor your resume.';
            let code = null;
            try {
              const data = await res.json();
              if (res.status === 401) {
                detail = 'Not logged in to TailorCV. Open the TailorCV panel to log in.';
                code = 'not_logged_in';
              } else if (res.status === 402 || data.error === 'upgrade_required') {
                detail = 'Free tailoring limit reached.';
                code = 'upgrade_required';
              } else if (res.status === 404) {
                detail = 'No base resume set. Set one up at thetailorcv.com/extension.';
                code = 'no_base_resume';
              } else if (data.detail) {
                detail = data.detail;
              }
            } catch (_) { /* ignore parse errors, use default detail */ }
            sendResponse({ error: detail, code });
            return;
          }

          const afterScoreHeader = res.headers.get('X-Skill-Match-After');
          const afterScore = afterScoreHeader ? parseInt(afterScoreHeader, 10) : null;

          const buffer = await res.arrayBuffer();
          // Service workers have no DOM (no URL.createObjectURL), so build a data URL.
          const pdfBase64 = arrayBufferToBase64(buffer);
          await chrome.downloads.download({
            url: `data:application/pdf;base64,${pdfBase64}`,
            filename: 'tailored_resume.pdf',
            saveAs: false,
          });
          // pdfBase64 rides along so the apply-autofill flow can drop the exact
          // same PDF into the ATS's resume upload field via a DataTransfer, with
          // no second request — existing callers that only read afterScore are
          // unaffected by the extra field.
          sendResponse({ data: { success: true, afterScore, pdfBase64 } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'GET_BASE_RESUME_FILE') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/base-resume/file`, { credentials: 'include' });
          if (!res.ok) {
            const code = res.status === 404 ? 'no_base_resume' : res.status === 401 ? 'not_logged_in' : null;
            sendResponse({ error: 'Could not fetch your base resume.', code });
            return;
          }
          const buffer = await res.arrayBuffer();
          const pdfBase64 = arrayBufferToBase64(buffer);
          await chrome.downloads.download({
            url: `data:application/pdf;base64,${pdfBase64}`,
            filename: 'resume.pdf',
            saveAs: false,
          });
          sendResponse({ data: { success: true, pdfBase64 } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'GET_APPLY_PROFILE') {
        const res = await fetch(`${BASE_URL}/api/extension/apply-profile`, { credentials: 'include' });
        if (!res.ok) {
          sendResponse({ error: 'Not logged in to TailorCV.' });
          return;
        }
        sendResponse({ data: await res.json() });

      } else if (msg.type === 'GET_APPLY_ANSWERS') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/apply-answers`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.payload),
          });
          if (!res.ok) {
            let detail = 'Could not generate answers for this form.';
            let code = null;
            try {
              const data = await res.json();
              if (res.status === 401) {
                detail = 'Not logged in to TailorCV. Open the TailorCV panel to log in.';
                code = 'not_logged_in';
              } else if (res.status === 404) {
                detail = 'No base resume set. Set one up at thetailorcv.com/extension.';
                code = 'no_base_resume';
              } else if (data.detail) {
                detail = data.detail;
              }
            } catch (_) { /* ignore parse errors, use default detail */ }
            sendResponse({ error: detail, code });
            return;
          }
          sendResponse({ data: await res.json() });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'CHECK_BROAD_PERMISSION') {
        // Read-only — no gesture requirement, safe to relay (unlike request()).
        try {
          const granted = await chrome.permissions.contains({ origins: ['*://*/*'] });
          sendResponse({ granted });
        } catch (e) {
          sendResponse({ granted: false, error: e.message });
        }

      } else {
        sendResponse({ error: 'Unknown message type' });
      }
    } catch (e) {
      sendResponse({ error: e.message });
    }
  })();
  return true; // keep channel open for async response
});

// Picks up a pending apply-chain (see autofill.js's startChain/tryResumeChain)
// on whatever tab it lands on next — a LinkedIn Apply click commonly opens a
// new tab, and a click-through interstitial navigates the current one, so
// this listens on every tab rather than tracking a specific tab id. Content
// scripts only auto-inject via manifest declarations on the 4 named ATS
// hosts; everywhere else (an arbitrary company careers page) needs this
// explicit injection, gated on actually holding permission for that host —
// wrapped in try/catch since injection legitimately fails for chrome://
// pages, the Web Store, PDF viewers, and any host we were never granted.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || !/^https?:/i.test(tab.url)) return;
  let hostname;
  try { hostname = new URL(tab.url).hostname; } catch (_) { return; }
  if (/(^|\.)linkedin\.com$/i.test(hostname)) return; // chain resume never re-enters linkedin.com

  const stored = await chrome.storage.local.get('tcv_apply_chain');
  if (!stored.tcv_apply_chain) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['analytics.bundle.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['styles.bundle.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['autofill.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (_) {
    // No permission for this host, or a page we can't inject into — the chain
    // will time out via its own TTL/hop cap in autofill.js rather than hang.
  }
});
