// Minimal PostHog capture client — deliberately hand-rolled instead of using
// the posthog-js SDK. The SDK's browser bundle ships code that dynamically
// injects <script> tags to fetch remote config/toolbar/site-app assets at
// runtime (loadSiteApp/loadExternalDependency), which Chrome's Manifest V3
// review rejects as "remotely hosted code" even with those features disabled
// via config — the policy flags the code's presence, not whether it runs.
// Talking to the capture endpoint directly avoids shipping that code at all.

const PROJECT_TOKEN = 'phc_uGU456NXKhzPnNpdMsiPpDZrXY2ydg67rP2ixQT6QEkE';
const CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/';

// A content script runs in the isolated world of whatever site it's injected
// into (LinkedIn, Indeed, Naukri, ...) so anything keyed off localStorage
// would fragment identity per-site. Instead we bootstrap the distinct_id
// from chrome.storage.local (shared across every tab/site) via background.js
// and hold it in memory for the life of this content script injection.
let distinctId = null;
let ready = null;
function init() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_ANALYTICS_ID' }, (res) => {
      distinctId = (res && res.id) || crypto.randomUUID();
      resolve();
    });
  });
  return ready;
}

function send(event, properties) {
  const body = JSON.stringify({
    api_key: PROJECT_TOKEN,
    event,
    properties: { ...properties, distinct_id: distinctId, $lib: 'tailorcv-extension' },
    timestamp: new Date().toISOString(),
  });
  // keepalive lets the request finish even if the tab navigates away right
  // after a capture call (e.g. tracking a click that opens a new page).
  fetch(CAPTURE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

window.__tcvTrack = function (event, props) {
  init().then(() => send(event, props || {}));
};

window.__tcvIdentify = function (email) {
  if (!email) return;
  init().then(() => {
    const previousId = distinctId;
    distinctId = email;
    send('$identify', { '$anon_distinct_id': previousId, '$set': { email } });
  });
};

init();
