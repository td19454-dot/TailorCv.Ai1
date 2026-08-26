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

// Session-scoped cache for GET_PROFILE / GET_BASE_RESUME — every content-script
// injection (new tab, hard reload) used to redo both real network calls even
// though the answer rarely changes within a browsing session. chrome.storage.
// session (not .local) survives this service worker being killed/restarted
// between messages, but is wiped the moment the browser fully closes — that
// caps worst-case staleness to "one browser session" for free. Explicit
// invalidation (login, logout, base-resume-save, and a live 401/404 from any
// uncached call) keeps it correct sooner than that; AUTH_CACHE_TTL_MS is only
// a backstop for a session cookie silently expiring with none of those firing.
const AUTH_CACHE_KEY = 'tcv_auth_cache';
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;

async function readAuthCache() {
  const stored = await chrome.storage.session.get(AUTH_CACHE_KEY);
  const cache = stored[AUTH_CACHE_KEY];
  if (!cache || (Date.now() - cache.cachedAt) > AUTH_CACHE_TTL_MS) return null;
  return cache;
}

async function writeAuthCacheField(field, value) {
  const stored = await chrome.storage.session.get(AUTH_CACHE_KEY);
  const existing = stored[AUTH_CACHE_KEY];
  const cache = (existing && (Date.now() - existing.cachedAt) <= AUTH_CACHE_TTL_MS)
    ? { ...existing } : { cachedAt: Date.now() };
  cache[field] = value;
  cache.cachedAt = Date.now();
  await chrome.storage.session.set({ [AUTH_CACHE_KEY]: cache });
}

async function clearAuthCache() {
  await chrome.storage.session.remove(AUTH_CACHE_KEY);
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
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['analytics.bundle.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['styles.bundle.js'] });
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
  (async () => {
    // Clear before broadcasting so every tab that reacts to REFRESH_AUTH is
    // guaranteed a fresh fetch instead of racing a cache write that hasn't
    // landed yet.
    await clearAuthCache();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_AUTH' }).catch(() => {});
    }
    sendResponse({ ok: true });
  })();
  return true; // keep the message channel open for the async response
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
        const cached = await readAuthCache();
        if (cached && cached.profile) {
          sendResponse(cached.profile);
          return;
        }
        const res = await fetch(`${BASE_URL}/api/extension/profile`, {
          credentials: 'include',
        });
        if (!res.ok) {
          const result = { error: 'Not logged in to TailorCV.' };
          await writeAuthCacheField('profile', result);
          sendResponse(result);
          return;
        }
        const result = { data: await res.json() };
        await writeAuthCacheField('profile', result);
        sendResponse(result);

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
          await clearAuthCache();
          sendResponse({ data });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'LOGOUT') {
        try {
          // Clear unconditionally, even if the fetch below throws — content.js
          // calls refreshFull() right after LOGOUT regardless of outcome, and a
          // stale "logged in" cache in *other* open tabs is the main new risk
          // this caching layer introduces.
          await clearAuthCache();
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
        const cached = await readAuthCache();
        if (cached && cached.baseResume) {
          sendResponse(cached.baseResume);
          return;
        }
        const res = await fetch(`${BASE_URL}/api/extension/base-resume`, { credentials: 'include' });
        if (!res.ok) {
          const result = { error: 'Not logged in to TailorCV.' };
          await writeAuthCacheField('baseResume', result);
          sendResponse(result);
          return;
        }
        const result = { data: await res.json() };
        await writeAuthCacheField('baseResume', result);
        sendResponse(result);

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
            if (code) await clearAuthCache();   // live call disproved the cached auth/base-resume state
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
            if (code) await clearAuthCache();   // live call disproved the cached auth/base-resume state
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
            if (code) await clearAuthCache();   // live call disproved the cached auth/base-resume state
            sendResponse({ error: detail, code });
            return;
          }

          // The endpoint returns JSON now (not a raw PDF) so the "See what
          // changed" diff and the skill lists can travel alongside the PDF —
          // a response header cannot carry bullet-level before/after text.
          const data = await res.json();
          const afterScore = typeof data.skill_match_after === 'number' ? data.skill_match_after : null;
          // Skills this job asked for that the resume shows no evidence of. The
          // website shows these so the candidate can tick the ones they really
          // have; without this the extension silently dropped them and the user
          // never knew the job wanted something they might well be able to claim.
          const skillsAdded = Array.isArray(data.skills_added) ? data.skills_added : [];
          const skillGaps = Array.isArray(data.skill_gaps) ? data.skill_gaps : [];
          const changes = data.changes || {};

          // Service workers have no DOM (no URL.createObjectURL), so build a data URL.
          const dataUrl = `data:application/pdf;base64,${data.pdf_base64}`;
          await chrome.downloads.download({
            url: dataUrl,
            filename: data.filename || 'tailored_resume.pdf',
            saveAs: false,
          });
          sendResponse({ data: { success: true, afterScore, skillsAdded, skillGaps, changes } });
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
