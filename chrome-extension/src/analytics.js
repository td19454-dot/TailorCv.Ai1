// PostHog client for the extension's content-script context.
//
// Chrome Web Store / Manifest V3 compliance: everything here is bundled into
// analytics.bundle.js at build time by esbuild — no code is ever fetched at
// runtime. We use PostHog's documented MV3 path
// (posthog.com/docs/advanced/browser-extension):
//   - `module.no-external`: the core build with no dynamic <script> injection.
//     (Never ship `posthog-js/dist/array.js` — that's the snippet loader that
//     pulls code from PostHog's CDN. A previous store submission was rejected
//     because node_modules, including that file, ended up in the zip; the zip
//     is now built from an allowlist by scripts/package.mjs.)
//   - `posthog-recorder`: the rrweb recorder built for extension stores.
// The only network traffic is JSON event/recording data sent to API_HOST.
//
// Privacy: the content script runs inside third-party job boards, so session
// replay is scoped to TailorCV's own UI — every other element of the host page
// is recorded as an empty placeholder box (blockSelector), inputs are masked,
// and URLs are reduced to origin + path before anything leaves the browser.
import { PostHog } from 'posthog-js/dist/module.no-external';
import 'posthog-js/dist/posthog-recorder';

const PROJECT_TOKEN = 'phc_uGU456NXKhzPnNpdMsiPpDZrXY2ydg67rP2ixQT6QEkE';
const API_HOST = 'https://us.i.posthog.com';

// The sidebar and its launcher are the extension's only UI (see content.js
// createPanel) plus the "See what changed" popup (#tailorcv-changes-modal),
// styled by the <style id="tailorcv-styles"> content.js adds to <head>.
// Everything else under <body> or <head> belongs to the host page.
const HOST_PAGE_SELECTOR = [
  'body > *:not(#tailorcv-sidebar):not(#tailorcv-launcher):not(#tailorcv-changes-modal)',
  'head > *:not(#tailorcv-styles)',
].join(', ');
// The account email, the pasted JD, and the "See what changed" popup (which
// quotes the user's resume bullets) are recorded as masked text.
const MASKED_TEXT_SELECTOR = '#tcvAccountEmail, #tcvManualJd, #tailorcv-changes-modal';

// Every URL-carrying property PostHog sets ($current_url, $referrer,
// $session_entry_url, $initial_*, ...) — matched by name, not a fixed list, so
// new SDK properties are covered too.
const URL_PROP = /(url|referrer|href)$/i;

function stripUrl(value) {
  if (typeof value !== 'string' || !/^https?:/i.test(value)) return value;
  try {
    const u = new URL(value);
    return u.origin + u.pathname;
  } catch (_) {
    return value;
  }
}

// Drops query strings and fragments (search terms, tracking ids, tokens) from
// every URL we send. In replay data that includes page hrefs in meta/custom
// events and the attributes rrweb resolves against the page URL (the sidebar's
// href="#" links become "<page url>?<query>#"), so the whole snapshot payload
// is walked — it stays uncompressed until the request is gzipped for exactly
// this reason (compress_events: false below).
function scrubSnapshot(node, depth) {
  if (depth > 60 || !node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (typeof v === 'string') {
      if (v.startsWith(location.origin) && /[?#]/.test(v)) node[key] = stripUrl(v);
    } else if (v && typeof v === 'object') {
      scrubSnapshot(v, depth + 1);
    }
  }
}

function minimizeUrls(event) {
  if (!event || !event.properties) return event;
  const props = event.properties;
  for (const key of Object.keys(props)) {
    if (URL_PROP.test(key)) props[key] = stripUrl(props[key]);
  }
  if (Array.isArray(props.$snapshot_data)) scrubSnapshot(props.$snapshot_data, 0);
  return event;
}

const posthog = new PostHog();

function sendRuntimeMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError; // extension reloaded/updated under this tab
        resolve(res || {});
      });
    } catch (_) {
      resolve({});
    }
  });
}

// A content script runs in whatever site it's injected into, so storage keyed
// to the page origin would fragment identity per job board. background.js
// keeps one install id plus a rolling session id in extension storage, and we
// bootstrap from those — one job hunt across LinkedIn → Greenhouse → Indeed
// reads as one person and one session. PostHog's own state stays in memory,
// so nothing is written into the host site's localStorage or cookies.
let ready = null;
function init() {
  if (ready) return ready;
  ready = sendRuntimeMessage({ type: 'GET_ANALYTICS_ID' }).then((res) => {
    const bootstrap = { distinctID: res.id || crypto.randomUUID() };
    if (res.sessionId) bootstrap.sessionID = res.sessionId;
    posthog.init(PROJECT_TOKEN, {
      api_host: API_HOST,
      bootstrap,
      persistence: 'memory',
      disable_external_dependency_loading: true,
      // Host-page behaviour is none of our business: no automatic capture of
      // the job board's clicks, pageviews, errors, performance or console.
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      enable_recording_console_log: false,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      // sendBeacon from a content script is subject to the HOST PAGE's CSP
      // connect-src, unlike fetch/XHR which run in the extension's own network
      // context — force fetch/XHR so a strict job-board CSP can't silently
      // drop events/recordings on tab close.
      opt_out_useBeacon: true,
      session_recording: {
        blockSelector: HOST_PAGE_SELECTOR,
        maskAllInputs: true,
        maskTextSelector: MASKED_TEXT_SELECTOR,
        recordCrossOriginIframes: false,
        recordHeaders: false,
        recordBody: false,
        captureCanvas: { recordCanvas: false },
        // Keep rrweb events readable by before_send (see scrubSnapshot); the
        // request body is still gzip-compressed on the wire.
        compress_events: false,
      },
      before_send: minimizeUrls,
    });
    posthog.register({
      source: 'chrome_extension',
      ext_version: chrome.runtime.getManifest().version,
      host: location.hostname,
    });
  });
  return ready;
}

// Keeps background.js's rolling session in step with this tab's activity (and
// with PostHog's own idle rotation), throttled to one message a minute.
let lastTouch = 0;
function touchSession() {
  const now = Date.now();
  if (now - lastTouch < 60_000) return;
  lastTouch = now;
  sendRuntimeMessage({ type: 'TOUCH_ANALYTICS_SESSION', sessionId: posthog.get_session_id() });
}

window.__tcvTrack = function (event, props) {
  init().then(() => {
    posthog.capture(event, props || {});
    touchSession();
  });
};

window.__tcvIdentify = function (email) {
  if (!email) return;
  init().then(() => {
    if (posthog.get_distinct_id() !== email) posthog.identify(email, { email });
  });
};

init();
