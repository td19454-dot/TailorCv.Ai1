// TailorCV — AI Resume Optimizer — Background Service Worker

// The backend URL lives in env.js so there is exactly one place to switch it —
// see the comments there. importScripts is available because this worker is not
// declared as a module; the fallback keeps the worker alive if env.js is ever
// missing from a package, rather than failing to register at all.
try {
  importScripts('env.js');
} catch (e) {
  console.error('TailorCV: env.js failed to load, falling back to production —', e);
}
const BASE_URL = (self.__TCV_ENV && self.__TCV_ENV.BASE_URL) || 'https://thetailorcv.com';

async function getCsrfToken() {
  // Make sure a csrftoken cookie exists (the server sets one on every response),
  // then read it back — the double-submit CSRF pattern needs it echoed as a header.
  await fetch(`${BASE_URL}/api/auth/me`, { credentials: 'include' }).catch(() => {});
  const cookie = await chrome.cookies.get({ url: BASE_URL, name: 'csrftoken' });
  return cookie ? cookie.value : '';
}

// Service workers have no DOM (no URL.createObjectURL), so build a data URL.
async function downloadPdfBase64(pdfBase64, filename) {
  await chrome.downloads.download({
    url: `data:application/pdf;base64,${pdfBase64}`,
    filename: filename || 'tailored_resume.pdf',
    saveAs: false,
  });
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

const AF_CONTEXT_KEY = 'tcv_autofill_context';
const AF_FILE_KEY = 'tcv_autofill_file';
// Short relative to the auth cache: the answer bank changes whenever the user
// edits their profile or saves an answer, and both of those happen mid-session.
// Explicit invalidation (below) is what keeps it correct sooner than this.
const AF_CONTEXT_TTL_MS = 10 * 60 * 1000;
const AF_FILE_TTL_MS = 30 * 60 * 1000;

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
  // The autofill context is a per-user artifact too — it carries the answer bank
  // and the quota state — so anything that invalidates the auth cache
  // invalidates it as well. Keeping them separate once let a logged-out user's
  // panel keep offering the previous user's answers.
  await chrome.storage.session.remove([AUTH_CACHE_KEY, AF_CONTEXT_KEY, AF_FILE_KEY]);
}

// Clicking the toolbar icon toggles the sidebar (no popup — the sidebar is the
// extension's only UI surface). On the job boards we declare in the manifest the
// content script is already there, so we just toggle it. On ANY other site —
// Mercor, Outlier, Alignerr, a company careers page — nothing is loaded yet, so
// the click itself grants us that one tab via activeTab and we inject on demand.
// That is what lets the extension work everywhere without asking every user for
// "read your data on all websites" at install time.
// ── SPA navigation ───────────────────────────────────────────
//
// A client-routed board (LinkedIn, Workday, Ashby, most careers sites built on
// React) changes the URL with history.pushState and never reloads, so the
// content script is never re-run and its view of "which job is this?" goes
// stale. It already noticed by comparing location.href inside a
// MutationObserver, which works only when the route change happens to mutate
// the DOM, and pays a callback on every mutation of every page we now run on.
//
// webNavigation reports the navigation itself. onHistoryStateUpdated covers
// pushState AND replaceState; onReferenceFragmentUpdated covers #fragment
// routing, which is how several older ATS SPAs page through an application.
//
// Top frame only (frameId 0): the sidebar lives there, and an embedded ATS
// iframe routing internally is the filler's business, not the panel's.
function notifyUrlChanged(details) {
  if (!details || details.frameId !== 0 || !details.tabId || details.tabId < 0) return;
  chrome.tabs.sendMessage(
    details.tabId, { type: 'URL_CHANGED', url: details.url }, { frameId: 0 },
  ).catch(() => { /* no content script in that tab (chrome://, the store) */ });
}

if (chrome.webNavigation) {
  chrome.webNavigation.onHistoryStateUpdated.addListener(notifyUrlChanged);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(notifyUrlChanged);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  // TOP FRAME ONLY. chrome.tabs.sendMessage broadcasts to every frame in the
  // tab, and the filler registers its own onMessage listener in each one
  // (src/autofill.js) — so on a company careers page that embeds its ATS form
  // in an iframe (Stripe embeds Greenhouse), the click could be answered by
  // that iframe, which ignores TOGGLE_PANEL. The result was a click that did
  // nothing at all: the top frame never got the message and never got the
  // content script either. frameId 0 addresses the page itself, so the reply
  // can only come from the frame that owns the sidebar.
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, { frameId: 0 });
    return;   // content script was already running — toggled it
  } catch (_) {
    // Nothing listening in the top frame: inject now.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__tailorcvFromToolbar = true; },
    });
    // The filler goes into EVERY frame: Greenhouse and Lever embed their form in
    // an iframe on company-branded domains, and the form is what we need to
    // reach. The sidebar and the job-description reader stay in the top frame
    // only — injecting those into every frame would paint a panel inside ad
    // iframes and run the div-walking JD heuristic dozens of times per page.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, files: ['autofill.bundle.js'],
    });
    // env.js before content.js, mirroring the manifest's script order — this is
    // the other place BASE_URL gets decided and it is easy to forget.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['env.js'] });
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
  // tailorcv-profile-updated: the application profile was saved on the website,
  // so the cached answer bank (see AF_GET_CONTEXT) is stale.
  if (!msg || !['tailorcv-login-success', 'tailorcv-base-resume-updated',
                'tailorcv-profile-updated'].includes(msg.type)) return;
  (async () => {
    // Clear before broadcasting so every tab that reacts to REFRESH_AUTH is
    // guaranteed a fresh fetch instead of racing a cache write that hasn't
    // landed yet.
    await clearAuthCache();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_AUTH', reason: msg.type }).catch(() => {});
      }
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

          // Missing skills to ask about: hold the download. content.js shows the
          // skills pop-up and then downloads either the re-rendered PDF
          // (ADD_SKILLS) or this one unchanged ("Not now" -> DOWNLOAD_PDF).
          if (data.pending_skill_choice && skillGaps.length) {
            sendResponse({ data: {
              success: true, pendingSkillChoice: true, afterScore, skillsAdded, skillGaps, changes,
              savedResumeId: data.saved_resume_id,
              pdfBase64: data.pdf_base64,
              filename: data.filename || 'tailored_resume.pdf',
            } });
            return;
          }

          await downloadPdfBase64(data.pdf_base64, data.filename);
          sendResponse({ data: { success: true, afterScore, skillsAdded, skillGaps, changes, autoAddSkills: !!data.auto_add_skills } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'ADD_SKILLS') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/add-skills`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            sendResponse({ error: data.detail || 'Could not add those skills.' });
            return;
          }
          // The profile carries auto_add_skills for the account-menu switch.
          if (msg.payload && msg.payload.enable_auto) await clearAuthCache();
          await downloadPdfBase64(data.pdf_base64, data.filename);
          sendResponse({ data: { success: true, added: data.added || [] } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'DOWNLOAD_PDF') {
        try {
          await downloadPdfBase64(msg.pdfBase64, msg.filename);
          sendResponse({ data: { success: true } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else if (msg.type === 'SET_AUTO_ADD_SKILLS') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/settings`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_add_skills: !!msg.value }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            sendResponse({ error: data.detail || 'Could not save that setting.' });
            return;
          }
          await clearAuthCache();
          sendResponse({ data: { autoAddSkills: !!data.auto_add_skills } });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      // ── Client-side application autofill ──────────────────────────────
      //
      // The content script owns the DOM; these four just move data. Note what
      // is NOT here: no endpoint that submits anything. The extension has no
      // code path that sends an application.

      } else if (msg.type === 'AF_GET_CONTEXT') {
        // Cached for the browser session and keyed on profileVersion, so a
        // second application on the same site costs one request, not three.
        const cached = await readAutofillContext();
        if (cached) {
          sendResponse({ data: cached });
          return;
        }
        const res = await fetch(`${BASE_URL}/api/extension/apply-context`, {
          credentials: 'include',
        });
        if (!res.ok) {
          sendResponse({
            error: res.status === 401
              ? 'Not logged in to TailorCV. Open the TailorCV panel to log in.'
              : 'Could not load your profile.',
            code: res.status === 401 ? 'not_logged_in' : null,
          });
          return;
        }
        const data = await res.json();
        await writeAutofillContext(data);
        sendResponse({ data });

      } else if (msg.type === 'AF_PLAN') {
        const res = await fetch(`${BASE_URL}/api/extension/autofill/plan`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload || {}),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const detail = data.detail || {};
          if (res.status === 402 || detail.error === 'upgrade_required') {
            sendResponse({
              error: "You've used your free autofills. Upgrade to Pro at thetailorcv.com.",
              code: 'upgrade_required',
            });
            return;
          }
          if (res.status === 401) {
            await clearAuthCache();
            await clearAutofillContext();
            sendResponse({ error: 'Not logged in to TailorCV.', code: 'not_logged_in' });
            return;
          }
          sendResponse({ error: 'Could not work out the answers for this form.' });
          return;
        }
        sendResponse({ data: await res.json() });

      } else if (msg.type === 'AF_SAVE_ANSWERS') {
        const res = await fetch(`${BASE_URL}/api/extension/apply-answers`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload || {}),
        });
        if (!res.ok) {
          sendResponse({ error: 'Could not save that answer.' });
          return;
        }
        // A saved answer changes what the next form can be filled from.
        await clearAutofillContext();
        sendResponse({ data: await res.json() });

      } else if (msg.type === 'AF_GET_RESUME_FILE') {
        // Fetched here and passed as base64 rather than as a blob URL: MV3
        // service workers have no URL.createObjectURL (the same constraint the
        // download helper above works around), and a URL minted here would not
        // be fetchable from a content script anyway.
        const doc = msg.doc === 'cover_letter' ? 'cover_letter' : 'resume';
        const cached = await readResumeFile(doc);
        if (cached) {
          sendResponse({ data: cached });
          return;
        }
        const res = await fetch(`${BASE_URL}/api/extension/base-resume/file?doc=${doc}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          sendResponse({ error: res.status === 404 ? 'no_file' : 'fetch_failed' });
          return;
        }
        const buffer = await res.arrayBuffer();
        const payload = {
          base64: arrayBufferToBase64(buffer),
          filename: filenameFromResponse(res, doc),
          mime: res.headers.get('content-type') || 'application/pdf',
        };
        await writeResumeFile(doc, payload);
        sendResponse({ data: payload });

      } else if (msg.type === 'AF_STATE_GET') {
        // Keyed on the sender's own tab id, which comes from Chrome and not from
        // the page, so one tab's run state can never be read or spoofed by
        // another. Wiped when the browser closes, like the auth cache.
        const key = autofillStateKey(sender);
        if (!key) { sendResponse({ data: null }); return; }
        const stored = await chrome.storage.session.get(key);
        sendResponse({ data: stored[key] || null });

      } else if (msg.type === 'AF_STATE_SET') {
        const key = autofillStateKey(sender);
        if (key) await chrome.storage.session.set({ [key]: msg.data });
        sendResponse({ data: { ok: true } });

      } else if (msg.type === 'AF_STATE_CLEAR') {
        const key = autofillStateKey(sender);
        if (key) await chrome.storage.session.remove(key);
        sendResponse({ data: { ok: true } });

      } else if (msg.type === 'AF_FRAME_ANNOUNCE') {
        recordFormFrame(sender, msg);
        sendResponse({ data: { ok: true } });

      } else if (msg.type === 'AF_FRAME_DISCOVER') {
        sendResponse({ data: discoverFormFrames(sender) });

      } else if (msg.type === 'AF_FRAME_SEND') {
        const tabId = sender.tab && sender.tab.id;
        if (!tabId) { sendResponse({ error: 'no_tab' }); return; }
        try {
          const res = await chrome.tabs.sendMessage(
            tabId, msg.payload || {}, { frameId: msg.frameId });
          sendResponse({ data: res });
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

// ── Autofill caches and helpers ────────────────────────────────────────────

async function readAutofillContext() {
  const stored = await chrome.storage.session.get(AF_CONTEXT_KEY);
  const entry = stored[AF_CONTEXT_KEY];
  if (!entry || (Date.now() - entry.cachedAt) > AF_CONTEXT_TTL_MS) return null;
  return entry.data;
}

async function writeAutofillContext(data) {
  await chrome.storage.session.set({
    [AF_CONTEXT_KEY]: { cachedAt: Date.now(), data },
  });
}

async function clearAutofillContext() {
  await chrome.storage.session.remove([AF_CONTEXT_KEY, AF_FILE_KEY]);
}

async function readResumeFile(doc) {
  const stored = await chrome.storage.session.get(AF_FILE_KEY);
  const entry = stored[AF_FILE_KEY];
  if (!entry || (Date.now() - entry.cachedAt) > AF_FILE_TTL_MS) return null;
  return entry[doc] || null;
}

async function writeResumeFile(doc, payload) {
  const stored = await chrome.storage.session.get(AF_FILE_KEY);
  const entry = stored[AF_FILE_KEY] || {};
  const fresh = (Date.now() - (entry.cachedAt || 0)) <= AF_FILE_TTL_MS
    ? { ...entry } : {};
  fresh[doc] = payload;
  fresh.cachedAt = Date.now();
  await chrome.storage.session.set({ [AF_FILE_KEY]: fresh });
}

function filenameFromResponse(res, doc) {
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (match) {
    try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
  }
  return doc === 'cover_letter' ? 'cover_letter.pdf' : 'resume.pdf';
}

function autofillStateKey(sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  return tabId ? `tcv_af:${tabId}` : null;
}

/**
 * Which frames of the sender's tab contain an application form.
 *
 * ANNOUNCE-based, and that shape is forced by two constraints. Enumerating
 * frames would need the webNavigation permission, which is a new install-time
 * prompt and a harder store review for one feature. And broadcasting an AF_PING
 * with chrome.tabs.sendMessage and no frameId fans out to every frame but only
 * ever resolves with the FIRST reply — which on a page full of ad iframes is
 * reliably the wrong one.
 *
 * So instead each sub-frame that finds a form announces itself once on load, and
 * Chrome stamps the announcement with a frameId the page cannot forge. This map
 * is the collected result.
 */
const formFrames = new Map();   // tabId -> Map(frameId -> {fieldCount, url, ats, at})

function recordFormFrame(sender, info) {
  const tabId = sender && sender.tab && sender.tab.id;
  const frameId = sender && sender.frameId;
  if (tabId == null || frameId == null) return;
  if (!formFrames.has(tabId)) formFrames.set(tabId, new Map());
  formFrames.get(tabId).set(frameId, {
    fieldCount: Number(info.fieldCount) || 0,
    url: String(info.url || ''),
    ats: String(info.ats || 'generic'),
    at: Date.now(),
  });
}

function discoverFormFrames(sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) return [];
  const frames = formFrames.get(tabId);
  if (!frames) return [];
  const out = [];
  for (const [frameId, info] of frames) {
    // Skip the top frame: the caller already knows whether it has a form of its
    // own, and it fills that one in-process with no messaging at all.
    if (frameId === 0) continue;
    out.push(Object.assign({ frameId }, info));
  }
  // The frame with the most fields is the application; an ad iframe with a
  // two-field newsletter box never wins.
  out.sort((a, b) => b.fieldCount - a.fieldCount);
  return out;
}

// A navigation replaces the frames, so their announcements are stale.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') formFrames.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  formFrames.delete(tabId);
  chrome.storage.session.remove(`tcv_af:${tabId}`).catch(() => {});
});
