// TailorCV — AI Resume Optimizer — Background Service Worker
const BASE_URL = 'https://thetailorcv.com';

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

// Clicking the toolbar icon toggles the sidebar on the active LinkedIn tab
// (no popup — the sidebar is the extension's only UI surface).
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
  } catch (e) {
    // No content script listening in this tab yet — typically because the
    // tab was already open before the extension was installed/reloaded, so
    // it never got the normal manifest content-script injection. Inject it
    // now instead of silently doing nothing.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['sidebar.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_linkedin.js'] });
    } catch (_) {
      // Not a linkedin.com/jobs/* tab, or injection not permitted — nothing to do.
    }
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
