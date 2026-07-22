(() => {
  // src/analytics.js
  var PROJECT_TOKEN = "phc_uGU456NXKhzPnNpdMsiPpDZrXY2ydg67rP2ixQT6QEkE";
  var CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";
  var distinctId = null;
  var ready = null;
  function init() {
    if (ready) return ready;
    ready = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_ANALYTICS_ID" }, (res) => {
        distinctId = res && res.id || crypto.randomUUID();
        resolve();
      });
    });
    return ready;
  }
  function send(event, properties) {
    const body = JSON.stringify({
      api_key: PROJECT_TOKEN,
      event,
      properties: { ...properties, distinct_id: distinctId, $lib: "tailorcv-extension" },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    fetch(CAPTURE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {
    });
  }
  window.__tcvTrack = function(event, props) {
    init().then(() => send(event, props || {}));
  };
  window.__tcvIdentify = function(email) {
    if (!email) return;
    init().then(() => {
      const previousId = distinctId;
      distinctId = email;
      send("$identify", { "$anon_distinct_id": previousId, "$set": { email } });
    });
  };
  init();
})();
