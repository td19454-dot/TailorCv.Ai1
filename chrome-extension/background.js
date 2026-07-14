// TailorCV Resume Tailor — Background Service Worker
// Switch to 'https://thetailorcv.com' when deploying to production
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
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['sidebar.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    // chrome:// pages, the Web Store and PDF viewers can never be injected into.
    console.warn('TailorCV: cannot run on this page —', e.message);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'GET_PROFILE') {
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

      } else if (msg.type === 'GET_BASE_RESUME') {
        const res = await fetch(`${BASE_URL}/api/extension/base-resume`, { credentials: 'include' });
        if (!res.ok) {
          sendResponse({ error: 'Not logged in to TailorCV.' });
          return;
        }
        sendResponse({ data: await res.json() });

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
            try {
              const data = await res.json();
              if (res.status === 401) detail = 'Not logged in to TailorCV. Open the TailorCV panel to log in.';
              else if (res.status === 402 || data.error === 'upgrade_required') detail = 'Free tailoring limit reached. Upgrade to Pro at thetailorcv.com.';
              else if (res.status === 404) detail = 'No base resume set. Set one up at thetailorcv.com/extension.';
              else if (data.detail) detail = data.detail;
            } catch (_) { /* ignore parse errors, use default detail */ }
            sendResponse({ error: detail });
            return;
          }

          const buffer = await res.arrayBuffer();
          // Service workers have no DOM (no URL.createObjectURL), so build a data URL.
          const dataUrl = `data:application/pdf;base64,${arrayBufferToBase64(buffer)}`;
          await chrome.downloads.download({
            url: dataUrl,
            filename: 'tailored_resume.pdf',
            saveAs: false,
          });
          sendResponse({ data: { success: true } });
        } catch (e) {
          sendResponse({ error: e.message });
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
