// Which backend the extension talks to. THE ONLY PLACE THIS IS DECIDED.
//
// Flip it with the npm scripts rather than by hand:
//   npm run dev    -> http://localhost:8005   (local uvicorn)
//   npm run prod   -> https://thetailorcv.com (the default, and what ships)
//
// `npm run package` REFUSES to build a store package unless this says
// production, because a shipped extension pointing at localhost is a total
// outage with no error message that would explain it — every request simply
// fails to connect.
//
// Loaded first by both consumers: importScripts() at the top of background.js,
// and as the first entry in the manifest's content_scripts (and in the
// toolbar-click injection chain, which is a separate code path). Not an ES
// module, because neither of those files is one.
//
// NOTE FOR LOCAL DEV — two things that catch people out:
//
//  1. The URL below carries a port; the manifest's host_permissions CANNOT.
//     Chrome match patterns have no port component at all, so a pattern like
//     "http://localhost:8005/*" is invalid and Chrome rejects the whole
//     manifest. "http://localhost/*" is the correct pattern and covers every
//     port.
//  2. Prefer 127.0.0.1 over localhost if requests hang. `uvicorn --host
//     127.0.0.1` binds IPv4 only, while "localhost" resolves to ::1 first on
//     Windows — so the connection goes to a port nothing is listening on. Run
//     uvicorn with --host 0.0.0.0, or set the URL below to 127.0.0.1.
(function () {
  var BASE_URL = 'http://localhost:8005';   // tcv:base-url

  var self_ = typeof self !== 'undefined' ? self : window;
  self_.__TCV_ENV = { BASE_URL: BASE_URL };

  if (BASE_URL.indexOf('thetailorcv.com') === -1) {
    // Loud on purpose. A dev build left in the browser looks identical to a
    // production one until something fails to load, and then the reason is
    // invisible — so it says so once, on every page it runs on.
    console.warn('[TailorCV] DEV BUILD — backend is ' + BASE_URL);
  }
})();
