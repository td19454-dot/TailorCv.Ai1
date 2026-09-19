// PostHog client for the extension's content-script context.
//
// This used to be a hand-rolled fetch()-based client because posthog-js's
// default browser bundle dynamically injects <script> tags to fetch remote
// config/toolbar/site-app assets at runtime, which Chrome's Manifest V3
// review rejects as "remotely hosted code" even with those features disabled
// via config. PostHog has since published an official MV3-safe path for
// exactly this (posthog.com/docs/advanced/browser-extension): a "no-external"
// core build with no dynamic script injection, plus a purpose-built recorder
// module (built without the base64-encoded code that trips store review),
// all statically bundled at build time by esbuild — so no remote code is
// ever fetched, and session recording works.
import { PostHog } from 'posthog-js/dist/module.no-external';
import 'posthog-js/dist/posthog-recorder';

const PROJECT_TOKEN = 'phc_uGU456NXKhzPnNpdMsiPpDZrXY2ydg67rP2ixQT6QEkE';
const API_HOST = 'https://us.i.posthog.com';

const posthog = new PostHog();

// A content script runs in the isolated world of whatever site it's injected
// into (LinkedIn, Indeed, Naukri, ...) so anything keyed off localStorage
// would fragment identity per-site. Instead we bootstrap the distinct_id
// from chrome.storage.local (shared across every tab/site) via background.js.
let ready = null;
function init() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_ANALYTICS_ID' }, (res) => {
      const distinctId = (res && res.id) || crypto.randomUUID();
      posthog.init(PROJECT_TOKEN, {
        api_host: API_HOST,
        bootstrap: { distinctID: distinctId },
        disable_external_dependency_loading: true,
        // localStorage (not posthog's own 'memory' default for content
        // scripts) so a recording/session survives SPA navigation on the
        // same job-board origin, not just a single page view.
        persistence: 'localStorage',
        capture_pageview: false,
        autocapture: false,
        // sendBeacon from a content script is subject to the HOST PAGE's
        // CSP connect-src, unlike fetch/XHR which run in the extension's
        // own network context — force fetch/XHR so a strict job-board CSP
        // can't silently drop events/recordings on tab close.
        opt_out_useBeacon: true,
      });
      posthog.register({ source: 'chrome_extension' });
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
  init().then(() => posthog.identify(email, { email }));
};

init();
