import { PostHog } from 'posthog-js/dist/module.no-external';
import 'posthog-js/dist/posthog-recorder';

const PROJECT_TOKEN = 'phc_uGU456NXKhzPnNpdMsiPpDZrXY2ydg67rP2ixQT6QEkE';
const API_HOST = 'https://us.i.posthog.com';

const posthog = new PostHog();

// A content script runs in the isolated world of whatever site it's injected
// into (LinkedIn, Indeed, Naukri, ...) so posthog's default localStorage
// persistence would fragment identity per-site. Instead we keep everything
// in memory and bootstrap the distinct_id from chrome.storage.local (shared
// across every tab/site the extension runs on) via background.js.
let ready = null;
function init() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_ANALYTICS_ID' }, (res) => {
      const distinctId = (res && res.id) || undefined;
      posthog.init(PROJECT_TOKEN, {
        api_host: API_HOST,
        persistence: 'memory',
        bootstrap: distinctId ? { distinctID: distinctId } : undefined,
        capture_pageview: false,
        autocapture: false,   // never auto-track clicks on the host page itself
        disable_external_dependency_loading: true,
      });
      resolve();
    });
  });
  return ready;
}

window.__tcvTrack = function (event, props) {
  init().then(() => posthog.capture(event, props || {}));
};

window.__tcvIdentify = function (email) {
  if (!email) return;
  init().then(() => posthog.identify(email));
};

init();
