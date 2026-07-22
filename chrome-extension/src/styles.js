import css from '../sidebar.css';

// content.js reads this synchronously to build its <style> tag — no runtime
// fetch, so there's no dependency on a host page's CSP allowing requests to
// chrome-extension:// origins (LinkedIn's does not).
window.__tcvSidebarCss = css;
