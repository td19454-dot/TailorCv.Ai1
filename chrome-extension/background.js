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
// actually saved — so a panel stuck on "no base resume set" catches up on
// its own instead of the user having to notice and refresh it by hand.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.type !== 'tailorcv-login-success' && msg.type !== 'tailorcv-base-resume-updated')) return;
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
          const dataUrl = `data:application/pdf;base64,${arrayBufferToBase64(buffer)}`;
          await chrome.downloads.download({
            url: dataUrl,
            filename: 'tailored_resume.pdf',
            saveAs: false,
          });
          sendResponse({ data: { success: true, afterScore } });
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
