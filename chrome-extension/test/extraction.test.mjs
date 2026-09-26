// Regression guard for the job-description reader.
//
// content.js is the extension's original feature and the autofill work touched
// it. Its four extraction layers were not modified — the edits were one flag,
// one button, one branch and two guards — but "I only added things" is a claim,
// and this is the check.
//
// content.js is one IIFE that exports nothing, so it cannot be imported. It is
// instead EVALUATED inside a jsdom page, exactly as Chrome evaluates it, with
// chrome.* stubbed. That also exercises the real injection contract: if the file
// throws at load, or the top-frame guard rejects a page it should accept, or a
// missing global breaks it, this fails.
//
// Run: node test/extraction.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { test, run, ok, notOk, eq } from './harness.mjs';
import * as fixtures from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_JS = readFileSync(resolve(HERE, '../content.js'), 'utf8');
const ENV_JS = readFileSync(resolve(HERE, '../env.js'), 'utf8');
const PROBE_JS = readFileSync(resolve(HERE, '../../auto_apply/field_probe.js'), 'utf8');
const AUTOFILL_BUNDLE = readFileSync(resolve(HERE, '../autofill.bundle.js'), 'utf8');

/**
 * Load content.js into a page the way Chrome does.
 *
 * `withAutofill` loads the real autofill bundle first, matching the manifest's
 * script order — so these tests cover both the with-autofill and the
 * bundle-failed-to-load paths.
 */
function loadPage(html, url, withAutofill, opts) {
  const options = opts || {};
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: url || 'https://example.test/jobs/view/12345',
  });
  const { window } = dom;
  polyfillInnerText(window);

  const sent = [];
  const listeners = [];   // content.js's chrome.runtime.onMessage handlers
  // A logged-in user with a base resume, so the panel reaches the job/apply view
  // rather than stopping at login. These are the real response shapes the
  // background worker returns; see refreshFull() in content.js.
  const reply = (msg) => {
    switch (msg.type) {
      case 'GET_ANALYTICS_ID': return { id: 'test-install' };
      case 'GET_PROFILE':
        if (options.loggedOut) return { error: 'Not logged in to TailorCV.' };
        return { data: { name: 'Ada Lovelace', email: 'ada@example.com',
                         has_resume: true, auto_add_skills: false } };
      case 'GET_BASE_RESUME':
        return { data: { has_base_resume: true, filename: 'ada.pdf' } };
      case 'GET_SKILL_MATCH': return { data: { score: 72 } };
      case 'AF_GET_CONTEXT':
        return { data: { answerBank: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
                         hasResume: true, blockers: [],
                         quota: { exhausted: false, isPro: false } } };
      // A form inside an iframe (Greenhouse embedded on careers.airbnb.com),
      // as background.js reports it once the frame announces itself.
      case 'AF_FRAME_DISCOVER': return { data: options.frames || [] };
      default: return { data: null };
    }
  };
  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (typeof cb !== 'function') return;
        // A login check that has to go to the network (no cached answer).
        if (msg.type === 'GET_PROFILE' && options.profileDelayMs) {
          setTimeout(() => cb(reply(msg)), options.profileDelayMs);
          return;
        }
        cb(reply(msg));
      },
      onMessage: { addListener(fn) { listeners.push(fn); } },
      getURL: path => `chrome-extension://test/${path}`,
      id: 'test',
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  };
  window.__tcvSidebarCss = '/* test */';
  // Real manifest order: env.js, then the bundles, then content.js. The
  // analytics bundle is not loaded; content.js guards for that already.
  window.eval(ENV_JS);
  if (withAutofill) {
    window.eval(PROBE_JS);
    window.eval(AUTOFILL_BUNDLE);
  }
  window.eval(CONTENT_JS);
  // Deliver a message from the background worker, as chrome.tabs.sendMessage would.
  const push = (msg) => listeners.forEach(fn => fn(msg, {}, () => {}));
  return { dom, window, document: window.document, sent, push };
}

const JSON_LD_PAGE = `<!doctype html><html><head>
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Senior Backend Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Acme Corp' },
    description: '<p>We are looking for a senior backend engineer.</p>'
      + '<p>Responsibilities: build and operate services. '
      + 'Requirements: 5+ years of experience with Python and distributed systems. '
      + 'What you will do: design APIs, mentor engineers, own reliability. '
      + 'Qualifications: strong CS fundamentals. Benefits: healthcare, equity.</p>'
      + '<p>'.padEnd(400, 'More detail about the role and the team. ') + '</p>',
  })}</script></head><body><h1>Senior Backend Engineer</h1></body></html>`;

const HEURISTIC_PAGE = `<!doctype html><html><body>
  <h1>Staff Data Engineer</h1>
  <nav><a href="/company/acme">Acme Corp</a></nav>
  <article>
    <h2>About the role</h2>
    <p>${'We are looking for a Staff Data Engineer to own our pipelines. '.repeat(8)}</p>
    <h2>Responsibilities</h2>
    <p>${'You will design, build and operate batch and streaming pipelines. '.repeat(8)}</p>
    <h2>Requirements</h2>
    <p>${'5+ years of experience with Python, SQL and Spark is required. '.repeat(8)}</p>
    <h2>Qualifications</h2>
    <p>${'Strong fundamentals in distributed systems and data modelling. '.repeat(8)}</p>
    <h2>Benefits</h2>
    <p>${'Healthcare, equity and a learning budget. '.repeat(6)}</p>
  </article></body></html>`;

test('content.js evaluates without throwing', () => {
  const page = loadPage(JSON_LD_PAGE);
  ok(page.window.__tailorcvInjected, 'the injection guard must be set');
});

test('env.js supplies the backend URL to content.js', () => {
  const page = loadPage(JSON_LD_PAGE);
  const env = page.window.__TCV_ENV;
  ok(env && env.BASE_URL, 'env.js must set __TCV_ENV.BASE_URL');
  ok(/^https?:\/\//.test(env.BASE_URL), `not a URL: ${env.BASE_URL}`);
});

test('content.js falls back to production when env.js did not load', () => {
  // The fallback matters: a package missing env.js must still reach the real
  // backend rather than crash or point nowhere.
  const dom = new JSDOM(JSON_LD_PAGE, { runScripts: 'dangerously',
                                        url: 'https://example.test/jobs/view/1' });
  dom.window.chrome = { runtime: { sendMessage: (m, cb) => cb && cb({ data: null }),
                                   onMessage: { addListener() {} }, getURL: p => p },
                        storage: { session: {} } };
  dom.window.__tcvSidebarCss = '';
  dom.window.eval(CONTENT_JS);        // no env.js
  ok(dom.window.__tailorcvInjected, 'it must still load');
  // The URL is a closure constant, so assert on what it produces: the login link.
  const source = CONTENT_JS;
  ok(/\|\| 'https:\/\/thetailorcv\.com'/.test(source),
     'the production URL must be the hardcoded fallback');
});

test('content.js evaluates with the autofill bundle loaded', () => {
  const page = loadPage(JSON_LD_PAGE, undefined, true);
  ok(page.window.__tailorcvInjected);
  ok(page.window.__tcvAutofill, 'the autofill global must be installed');
});

test('the autofill bundle installs the shared probe', () => {
  const page = loadPage(JSON_LD_PAGE, undefined, true);
  ok(page.window.__tcvFieldProbe, 'field_probe must be available in the page');
  ok(typeof page.window.__tcvFieldProbe.describeEl === 'function');
});

test('layer 1: a JSON-LD JobPosting is read', async () => {
  const page = loadPage(JSON_LD_PAGE, undefined, true);
  const panel = await waitForPanel(page);
  ok(panel, 'the sidebar must appear on a job page');
  const text = panel.textContent || '';
  ok(/Senior Backend Engineer/.test(text), `title missing from: ${text.slice(0, 300)}`);
  ok(/Acme Corp/.test(text), 'company missing');
});

test('layer 1 still works with the autofill bundle absent', async () => {
  const page = loadPage(JSON_LD_PAGE, undefined, false);
  const panel = await waitForPanel(page);
  ok(panel, 'a missing autofill bundle must not stop the sidebar');
  ok(/Senior Backend Engineer/.test(panel.textContent || ''));
});

test('layer 3: the text-density heuristic finds a description', async () => {
  const page = loadPage(HEURISTIC_PAGE, 'https://careers.acme.com/jobs/staff-data-engineer', true);
  const panel = await waitForPanel(page);
  ok(panel, 'the sidebar must appear');
  ok(/Staff Data Engineer/.test(panel.textContent || ''),
     `got: ${(panel.textContent || '').slice(0, 300)}`);
});

test('a job page with no description falls through to the paste box', async () => {
  const page = loadPage(
    '<!doctype html><html><body><h1>Some role</h1><p>Apply soon.</p></body></html>',
    'https://example.test/jobs/view/999', true);
  const panel = await waitForPanel(page, 14000);
  ok(panel, 'the sidebar must still appear');
  const text = panel.textContent || '';
  ok(/paste|description|selection/i.test(text),
     `expected the manual-entry view, got: ${text.slice(0, 300)}`);
});

test('the sidebar is NOT injected into a sub-frame', async () => {
  // A REAL iframe, not a faked window.top: jsdom defines `top` as
  // non-configurable, so it cannot be reassigned, and a fake would not exercise
  // the same comparison anyway. This is the guard that stops the panel painting
  // inside the Greenhouse iframe (and inside every ad frame on LinkedIn).
  const dom = new JSDOM(
    `<!doctype html><html><body><iframe id="f" srcdoc="${
      JSON_LD_PAGE.replace(/"/g, '&quot;')}"></iframe></body></html>`,
    { runScripts: 'dangerously', resources: 'usable',
      url: 'https://example.test/jobs/view/1' });

  const frameWindow = await new Promise((resolve) => {
    const iframe = dom.window.document.getElementById('f');
    if (iframe.contentWindow && iframe.contentWindow.document.body) {
      resolve(iframe.contentWindow);
      return;
    }
    iframe.addEventListener('load', () => resolve(iframe.contentWindow));
    setTimeout(() => resolve(iframe.contentWindow), 2000);
  });
  ok(frameWindow, 'the iframe must have a window');
  notOk(frameWindow === frameWindow.top, 'sanity: this really is a sub-frame');

  frameWindow.chrome = {
    runtime: { sendMessage: () => {}, onMessage: { addListener() {} }, getURL: p => p },
    storage: { session: {} },
  };
  frameWindow.__tcvSidebarCss = '';
  frameWindow.eval(CONTENT_JS);
  eq(frameWindow.document.getElementById('tailorcv-sidebar'), null,
     'a frame must never get a sidebar');
  eq(dom.window.document.getElementById('tailorcv-sidebar'), null,
     'and must not reach into the parent either');
});

test('an application page with no description shows the autofill panel', async () => {
  const page = loadPage(`<!doctype html><html><body>
    <form id="application-form">
      <label for="a">First Name *</label><input id="a" name="first_name" required>
      <label for="b">Last Name *</label><input id="b" name="last_name" required>
      <label for="c">Email *</label><input id="c" name="email" type="email" required>
      <label for="d">Phone</label><input id="d" name="phone" type="tel">
      <label for="e">Resume *</label><input id="e" name="resume" type="file" required>
      <button type="submit">Submit</button>
    </form></body></html>`,
    'https://job-boards.greenhouse.io/acme/jobs/123', true);
  const panel = await waitForPanel(page, 14000);
  ok(panel, 'the sidebar must appear on an apply page');
  const text = panel.textContent || '';
  ok(/Application form detected|Autofill this application/i.test(text),
     `expected the apply panel, got: ${text.slice(0, 400)}`);
  ok(/never submits/i.test(text), 'the no-submit promise must be stated in the UI');
});

// ── late-rendering forms (the Workday failure) ───────────────
//
// Workday renders its application several seconds after the page loads, and
// moves between steps without changing the URL. Detection that runs once at load
// finds nothing, and the posting's JSON-LD is still on the page, so the panel
// showed the job view with no Autofill button at all. These use the two real
// URLs that failed.

const CITI_URL = 'https://citi.wd5.myworkdayjobs.com/en-US/2/job/Pune-Maharashtra-India/'
  + 'Machine-Learning-with-Gen-AI_26991325/apply/applyManually';
const PWC_URL = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/'
  + 'Kolkata/Business-Analyst-Data-Modelling-Associate----Kolkata-Y-14---Technology-'
  + 'Consulting_315280WD/apply/applyManually?source=LinkedIn';

/** Insert markup into a live page after a delay, as a SPA would. */
function renderLater(page, html, ms) {
  setTimeout(() => {
    const host = page.document.createElement('div');
    host.innerHTML = html;
    page.document.body.appendChild(host);
  }, ms);
}

async function waitForText(page, re, timeout) {
  const deadline = Date.now() + (timeout || 15000);
  while (Date.now() < deadline) {
    const panel = page.document.getElementById('tailorcv-sidebar');
    if (panel && re.test(panel.textContent || '')) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

test('Workday: a form rendered AFTER load still gets the Autofill button (Citi URL)', async () => {
  // JSON-LD present, so the job view renders first — exactly the screenshot.
  const page = loadPage(JSON_LD_PAGE, CITI_URL, true);
  ok(await waitForText(page, /Senior Backend Engineer/, 10000), 'the job view must render first');
  renderLater(page, fixtures.WORKDAY_MYINFO, 2500);
  ok(await waitForText(page, /Autofill this application/, 15000),
     'the button must appear once the form renders, without a reload');
  ok(/Tailor/.test(page.document.getElementById('tailorcv-sidebar').textContent),
     'the resume actions must still be there');
});

test('Workday: a late form on a page with no description shows the apply panel (PwC URL)', async () => {
  const page = loadPage('<!doctype html><html><body><div id="wd-app">Loading…</div></body></html>',
                        PWC_URL, true);
  renderLater(page, fixtures.WORKDAY_MYINFO, 2500);
  ok(await waitForText(page, /Application form detected|Autofill this application/, 20000),
     'the apply panel must appear once the form renders');
});

test('Workday: a new step on the SAME URL is offered as the next page', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true);
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');

  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 20000), 'the first fill must finish');

  // "Save and Continue": Workday swaps the step's fields in place, URL unchanged.
  const step = page.document.querySelector('[data-automation-id="applyFlowMyInfoPage"]');
  step.setAttribute('data-automation-id', 'applyFlowMyExpPage');
  step.innerHTML = `
    <div data-automation-id="formField-school"><label for="s1">School or University*</label>
      <input id="s1" type="text" aria-required="true"></div>
    <div data-automation-id="formField-degree"><label for="s2">Degree*</label>
      <input id="s2" type="text" aria-required="true"></div>
    <div data-automation-id="formField-field"><label for="s3">Field of Study</label>
      <input id="s3" type="text"></div>`;
  ok(await waitForText(page, /Page 2/, 15000), 'the next step must be offered as page 2');
});

test('Workday: a next step with nothing to fill yet still offers "Autofill this page"', async () => {
  // nvidia.wd5: after My Information, "My Experience" holds only Add buttons —
  // no fields until an entry is opened. The sidebar stayed on page 1's results.
  const withHeading = fixtures.WORKDAY_MYINFO.replace(
    '<div data-automation-id="applyFlowMyInfoPage">',
    '<h2>My Information</h2><div data-automation-id="applyFlowMyInfoPage">');
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true);
  renderLater(page, withHeading, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');
  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 20000), 'the first fill must finish');

  page.document.querySelector('[data-automation-id="applyFlowPage"] h2').textContent = 'My Experience';
  page.document.querySelector('[data-automation-id="applyFlowMyInfoPage"]').innerHTML = `
    <h3>Work Experience</h3><button type="button" data-automation-id="add-button">Add</button>
    <h3>Education</h3><button type="button" data-automation-id="add-button">Add</button>`;
  ok(await waitForText(page, /Page 2/, 15000), 'the new step is shown');
  ok(await waitForText(page, /Autofill this page/, 5000), 'with a button to fill it');
  ok(await waitForText(page, /No fields found on this step yet/, 5000), 'and says what to do');
});

test('Workday: the next step is shown even when the page passes through "no form" on the way', async () => {
  // nvidia.wd5: page 1 is torn down (a moment with no form at all) before page
  // 2 renders. The watcher saw page 2 as a form "appearing", left the results
  // view alone, and the sidebar kept page 1's results until a tab switch.
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true);
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');
  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 20000), 'the first fill must finish');

  const step = page.document.querySelector('[data-automation-id="applyFlowMyInfoPage"]');
  step.innerHTML = '<div class="loading">Loading…</div>';          // between steps
  await new Promise(r => setTimeout(r, 2600));                       // the watcher sees "no form"
  step.innerHTML = `
    <div data-automation-id="formField-resume"><label for="r1">Resume/CV*</label>
      <input id="r1" type="file"></div>
    <div data-automation-id="formField-linkedin"><label for="w1">LinkedIn</label>
      <input id="w1" type="text"></div>
    <div data-automation-id="formField-website"><label for="w2">Website</label>
      <input id="w2" type="text"></div>`;
  ok(await waitForText(page, /Page 2/, 15000), 'page 2 replaces page 1\'s results');
  ok(await waitForText(page, /Autofill this page/, 5000), 'with its own button');
});

test('the form watcher does not repaint the login view', async () => {
  const page = loadPage(JSON_LD_PAGE, CITI_URL, true, { loggedOut: true });
  ok(await waitForText(page, /log ?in|sign ?in|password/i, 10000), 'login view first');
  renderLater(page, fixtures.WORKDAY_MYINFO, 500);
  await new Promise(r => setTimeout(r, 4000));
  notOk(/Autofill this application/.test(page.document.getElementById('tailorcv-sidebar').textContent),
        'a logged-out user must stay on the login view');
});

const GREENHOUSE_FRAME = { frameId: 7, fieldCount: 12, url: 'https://job-boards.greenhouse.io/embed/job_app?for=airbnb', ats: 'greenhouse' };

test('a posting whose form is in an iframe offers Autofill (careers.airbnb.com)', async () => {
  const page = loadPage(JSON_LD_PAGE, 'https://careers.airbnb.com/positions/8123037/', true,
                        { frames: [GREENHOUSE_FRAME] });
  ok(await waitForText(page, /Autofill this application/, 10000),
     'the job view must lead with Autofill when a frame holds the form');
  const tab = page.document.querySelector('.tcv-tab[data-tab="autofill"]');
  notOk(tab.disabled, 'the Autofill tab must be enabled');
});

test('a frame form that appears after the panel drew is picked up', async () => {
  const options = { frames: [] };
  const page = loadPage(JSON_LD_PAGE, 'https://careers.airbnb.com/positions/8123037/', true, options);
  ok(await waitForText(page, /Start Application/, 10000), 'no form yet: Start Application');
  options.frames.push(GREENHOUSE_FRAME);        // the Greenhouse iframe finishes rendering
  page.push({ type: 'AF_FRAME_FOUND' });
  ok(await waitForText(page, /Autofill this application/, 5000), 'redrawn with Autofill');
});

// Watches the panel body from the first moment it exists.
async function sawAuthenticating(page, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const body = page.document.getElementById('tcvBody');
    if (body && /Authenticating/.test(body.textContent)) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return false;
}

test('a cached login does not replay "Authenticating" on every new careers site', async () => {
  const page = loadPage(JSON_LD_PAGE, 'https://careers.airbnb.com/positions/8123037/', true);
  notOk(await sawAuthenticating(page, 2500), 'an instant (cached) login check shows no lock animation');
  ok(await waitForText(page, /Senior Backend Engineer/, 5000), 'straight to the job view');
});

test('a slow (uncached) login check still shows "Authenticating"', async () => {
  const page = loadPage(JSON_LD_PAGE, 'https://careers.airbnb.com/positions/8123037/', true,
                        { profileDelayMs: 700 });
  ok(await sawAuthenticating(page, 3000), 'a real network check is worth the animation');
});

// LinkedIn's search view after the redesign: hashed class names everywhere, the
// company and its logo as /company/ links above the title, and a tab title that
// names the SEARCH, not the job. The adapter's company selectors match nothing.
const JD_TEXT = `${'Build models that detect fraud and forecast demand. '.repeat(6)}
  ${'Requirements: Python, SQL, statistics and experience shipping ML to production. '.repeat(5)}`;
const LINKEDIN_NEW_UI = `<!doctype html><html><head><title>bank of america jobs | LinkedIn</title></head><body>
  <div class="a8f3k2">
    <div class="q1w2e3">
      <a href="https://www.linkedin.com/company/bankofamerica/life/"><img
         alt="Bank of America logo" src="https://media.licdn.com/dms/image/v2/C4E0/company-logo_100_100/bofa.png"></a>
      <a href="https://www.linkedin.com/company/bankofamerica/life/">Bank of America</a>
    </div>
    <h1 class="z9x8c7">Data Scientist I</h1>
    <div class="r5t6y7">Charlotte, NC · 1 week ago</div>
  </div>
  <div class="m3n4b5">
    <h2>About the job</h2>
    <p>${JD_TEXT}</p>
  </div></body></html>`;

test('LinkedIn (hashed classes): the company and its logo come from the /company/ link', async () => {
  const page = loadPage(LINKEDIN_NEW_UI,
    'https://www.linkedin.com/jobs/search-results/?currentJobId=4428170145', true);
  ok(await waitForText(page, /Data Scientist I/, 10000), 'the job view renders');
  ok(await waitForText(page, /Bank of America/, 3000), 'the company is shown on the job card');
  const img = page.document.querySelector('#tcvJobAvatar img');
  ok(img, 'the avatar shows the logo, not a letter');
  eq(img && img.getAttribute('src'),
     'https://media.licdn.com/dms/image/v2/C4E0/company-logo_100_100/bofa.png');
});

const CAREERS_SITE = `<!doctype html><html><head>
  <title>Senior Data Scientist - Payments | Airbnb Careers</title>
  <meta property="og:site_name" content="Airbnb Careers">
  <link rel="icon" href="/favicon-192.png">
</head><body>
  <h1>Senior Data Scientist - Payments</h1>
  <div><h2>About the role</h2><p>${JD_TEXT}</p></div></body></html>`;

test("a company's own careers site: its name and icon", async () => {
  const page = loadPage(CAREERS_SITE, 'https://careers.airbnb.com/positions/8123037/', true);
  ok(await waitForText(page, /Senior Data Scientist/, 10000), 'the job view renders');
  ok(await waitForText(page, /Airbnb/, 3000), 'the company comes from the site name');
  notOk(/Airbnb Careers ·/.test(page.document.getElementById('tailorcv-sidebar').textContent),
        '"Careers" is dropped from the name');
  const img = page.document.querySelector('#tcvJobAvatar img');
  eq(img && img.getAttribute('src'), 'https://careers.airbnb.com/favicon-192.png');
});

test('the rest of a job title is never taken for the company', async () => {
  const html = CAREERS_SITE
    .replace('<meta property="og:site_name" content="Airbnb Careers">', '')
    .replace('| Airbnb Careers', '| Careers');
  const page = loadPage(html, 'https://jobs.example.com/positions/1/', true);
  ok(await waitForText(page, /Detected on this page|Read from/, 10000), 'the job view renders');
  const meta = page.document.querySelector('.tcv-job-meta');
  notOk(/Payments ·/.test(meta ? meta.textContent : ''), `got "${meta && meta.textContent}"`);
});

test("LinkedIn's single-job title names the company when no link does", async () => {
  const html = LINKEDIN_NEW_UI
    .replace('<title>bank of america jobs | LinkedIn</title>', '<title>Data Scientist I | Bank of America | LinkedIn</title>')
    .replace(/<div class="q1w2e3">[\s\S]*?<\/div>/, '');
  const page = loadPage(html, 'https://www.linkedin.com/jobs/view/4428170145/', true);
  ok(await waitForText(page, /Data Scientist I/, 10000), 'the job view renders');
  ok(await waitForText(page, /Bank of America/, 3000), 'the company comes from the tab title');
});

test('content.js contains no code that submits a form', () => {
  // The invariant, asserted against the source rather than trusted. Comments and
  // the user-facing copy legitimately contain the word, so those are stripped
  // first; what is left must not call submit() or click a submit control.
  const code = CONTENT_JS
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`[^`]*`/g, '``')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
  notOk(/\.submit\s*\(/.test(code), 'content.js must never call .submit()');
  notOk(/requestSubmit/.test(code), 'content.js must never call requestSubmit()');
});

test('the autofill bundle contains no code that submits a form', () => {
  const code = AUTOFILL_BUNDLE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`[^`]*`/g, '``')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
  notOk(/\.submit\s*\(/.test(code), 'the bundle must never call .submit()');
  notOk(/requestSubmit/.test(code), 'the bundle must never call requestSubmit()');
});

/**
 * Approximate innerText with textContent.
 *
 * jsdom does not implement innerText at all, and extraction layers 2 and 3 read
 * it on every candidate node — so without this they see "" everywhere and the
 * heuristic cannot run. The approximation is real and worth stating: innerText
 * respects line breaks and skips hidden elements, textContent does neither. That
 * makes this good enough to exercise the scoring and selection logic (which is
 * what could regress from the autofill edits) and NOT a fidelity test of what
 * Chrome would extract. The fixture pages under test/fixtures/pages cover that.
 */
function polyfillInnerText(window) {
  const proto = window.HTMLElement.prototype;
  if ('innerText' in proto) return;
  Object.defineProperty(proto, 'innerText', {
    configurable: true,
    get() {
      // Collapse runs of whitespace but keep block boundaries as newlines, which
      // is the part of innerText's behaviour the length/signal scoring cares about.
      const text = String(this.textContent || '');
      return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n');
    },
  });
}

/** The sidebar is created on a timer; poll for it. */
async function waitForPanel(page, timeout) {
  const deadline = Date.now() + (timeout || 12000);
  while (Date.now() < deadline) {
    const panel = page.document.getElementById('tailorcv-sidebar');
    const bodyEl = panel && panel.querySelector('#tcvBody');
    if (bodyEl && (bodyEl.textContent || '').trim()
        && !/Authenticating|Reading the job/i.test(bodyEl.textContent)) {
      return panel;
    }
    await new Promise(r => setTimeout(r, 120));
  }
  return page.document.getElementById('tailorcv-sidebar');
}

await run('extraction (regression)');
