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
      // The job-description sources for a form-only page (background.js).
      case 'JOB_REMEMBER': return { data: { ok: true } };
      case 'JOB_RECALL': return { data: options.recall || {} };
      case 'JOB_FETCH': return { data: options.fetched || {} };
      // The autofill plan endpoint, when a test supplies one.
      case 'AF_PLAN': return { data: options.plan ? options.plan(msg.payload) : null };
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

test('SuccessFactors: every section closed still offers Autofill, which opens them and fills', async () => {
  // Candidate Profile (Oct 2026): closed sections hide every field, so there was
  // no form, no Autofill to press — and pressing it is what opens them. Rendered
  // after the panel has given up reading a posting (about 9s), so only the
  // watcher can notice a form with no visible field.
  const page = loadPage('<!doctype html><html><body></body></html>',
    'https://career4.successfactors.com/portalcareer', true);
  page.document.addEventListener('click', (e) => {
    const bar = e.target.closest && e.target.closest('button.rcmFormSectionTopBar');
    if (!bar) return;
    bar.setAttribute('aria-expanded', 'true');
    bar.closest('.rcmFormSection').querySelector('.sectionContent').style.display = '';
  });
  renderLater(page, `<form id="careerform">
    ${['Profile Information', 'Job-Specific Information'].map((title, i) => `<div class="rcmFormSection">
      <h2><button type="button" class="topBar rcmFormSectionTopBar" aria-expanded="false">${title}</button></h2>
      <div class="sectionContent sectionContentClosed" style="display:none">
        ${i === 0 ? '<label for="mail">Email</label><input id="mail" name="contactEmail" type="text">'
                  : '<label for="note">Notes</label><input id="note" name="notes" type="text">'}
      </div></div>`).join('')}
  </form>`, 12000);

  ok(await waitForText(page, /Autofill this application/, 25000), 'Autofill is offered');
  ok(await waitForText(page, /closed sections/, 2000), 'and says what it will do');
  const bars = () => Array.from(page.document.querySelectorAll('button.rcmFormSectionTopBar'));
  ok(bars().every(b => b.getAttribute('aria-expanded') === 'false'), 'nothing opens until it is pressed');

  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 30000), 'the fill finishes');
  ok(bars().every(b => b.getAttribute('aria-expanded') === 'true'), 'the sections were opened');
  eq(page.document.getElementById('mail').value, 'ada@example.com');
});

test('Workday: a new step on the SAME URL is offered as the next page', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true);
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');

  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 30000), 'the first fill must finish');

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
  ok(await waitForText(page, /filled/i, 30000), 'the first fill must finish');

  page.document.querySelector('[data-automation-id="applyFlowPage"] h2').textContent = 'My Experience';
  page.document.querySelector('[data-automation-id="applyFlowMyInfoPage"]').innerHTML = `
    <h3>Work Experience</h3><button type="button" data-automation-id="add-button">Add</button>
    <h3>Education</h3><button type="button" data-automation-id="add-button">Add</button>`;
  ok(await waitForText(page, /Page 2/, 15000), 'the new step is shown');
  ok(await waitForText(page, /Autofill this page/, 5000), 'with a button to fill it');
  ok(await waitForText(page, /No fields found on this step yet/, 5000), 'and says what to do');
});

// Real Workday markup (PwC, Oct 2026): the <h2> is the JOB TITLE, the same on
// every step; the step is named by the progress bar and an <h3>.
const progressBar = (active) => {
  const steps = ['My Information', 'My Experience', 'Application Questions', 'Voluntary Disclosures', 'Review'];
  return '<ol data-automation-id="progressBar">' + steps.map((s, i) => s === active
    ? `<li data-automation-id="progressBarActiveStep"><label>current step ${i + 1} of 5</label><label>${s}</label></li>`
    : `<li data-automation-id="progressBarInactiveStep"><label>step ${i + 1} of 5</label><label>${s}</label></li>`).join('') + '</ol>';
};
const realWorkday = (step) => fixtures.WORKDAY_MYINFO.replace(
  '<div data-automation-id="applyFlowMyInfoPage">',
  `<h2 data-automation-id="jobTitleHeading">Senior Associate</h2><div id="pb">${progressBar(step)}</div>`
  + `<h3 id="step-h3">${step}</h3><div data-automation-id="applyFlowMyInfoPage">`);

test('Workday (real markup): Save and Continue to the next step is offered as the next page', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', PWC_URL, true);
  renderLater(page, realWorkday('Application Questions'), 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');
  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 30000), 'the first fill must finish');

  // The job title stays; the progress bar, the step heading and the fields change.
  page.document.getElementById('pb').innerHTML = progressBar('Voluntary Disclosures');
  page.document.getElementById('step-h3').textContent = 'Voluntary Disclosures';
  page.document.querySelector('[data-automation-id="applyFlowMyInfoPage"]').innerHTML = `
    <div data-automation-id="formField-maritalStatus"><label for="ms">Marital Status*</label>
      <input id="ms" type="text" aria-required="true"></div>
    <div data-automation-id="formField-cityOfBirth"><label for="cb">City of Birth*</label>
      <input id="cb" type="text" aria-required="true"></div>`;
  ok(await waitForText(page, /Page \d/, 15000), 'the next step must be offered as a new page');
  ok(await waitForText(page, /Autofill this page/, 5000), 'with the autofill button');
});

test('Workday (real markup): a step that grows blocks keeps its results', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', PWC_URL, true);
  renderLater(page, realWorkday('My Experience'), 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');
  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 30000), 'the fill must finish');
  let blocks = '';
  for (let n = 1; n <= 4; n++) {
    blocks += `<div role="group" aria-labelledby="Education-${n}-panel"><h5 id="Education-${n}-panel">Education ${n}</h5>
      <label for="sch${n}">School or University*</label><input id="sch${n}" type="text">
      <label for="deg${n}">Degree*</label><input id="deg${n}" type="text"></div>`;
  }
  page.document.querySelector('[data-automation-id="applyFlowMyInfoPage"]').insertAdjacentHTML('beforeend', blocks);
  await new Promise(r => setTimeout(r, 4000));
  const text = page.document.getElementById('tailorcv-sidebar').textContent;
  ok(!/Page 2/.test(text), 'still the same step — no "Page 2"');
  ok(/filled/i.test(text), 'the results are still shown');
});

// ── Auto-apply ──────────────────────────────────────────────
// A three-step Workday application in real markup. Save and Continue moves to
// the next step; the last step is Review, whose button SUBMITS. opts.blocker:
// step 2 holds a required question no profile answers. opts.errorOnFirst: the
// first Save and Continue shows Workday's error banner and stays put.
function wireAutoApplyPage(page, opts = {}) {
  const doc = page.document;
  const log = { next: 0, submit: 0, filled: {} };
  const steps = [
    { name: 'My Information', html: `<div data-automation-id="formField-email"><label for="e1">Email Address<abbr>*</abbr></label>
        <input id="e1" type="text" aria-required="true"></div>` },
    { name: 'Application Questions', html: `<div data-automation-id="formField-email2"><label for="e2">Email Address<abbr>*</abbr></label>
        <input id="e2" type="text" aria-required="true"></div>${opts.blocker ? `
      <div data-automation-id="formField-colour"><label for="q1">What is your favourite colour?<abbr>*</abbr></label>
        <input id="q1" type="text" aria-required="true"></div>` : ''}` },
    { name: 'Review', html: '<p>Review your application.</p>', submit: true },
  ];
  let at = 0;
  let errored = false;
  const render = () => {
    const s = steps[at];
    doc.body.innerHTML = `<div data-automation-id="applyFlowPage">
      <h2 data-automation-id="jobTitleHeading">Senior Associate</h2>
      <ol data-automation-id="progressBar">${steps.map((x, i) => i === at
        ? `<li data-automation-id="progressBarActiveStep"><label>current step ${i + 1} of 3</label><label>${x.name}</label></li>`
        : `<li data-automation-id="progressBarInactiveStep"><label>step ${i + 1} of 3</label><label>${x.name}</label></li>`).join('')}</ol>
      <h3>${s.name}</h3>
      <div data-automation-id="applyFlowStepPage">${s.html}</div>
      <div data-automation-id="pageFooter"><button data-automation-id="pageFooterNextButton">${s.submit ? 'Submit' : 'Save and Continue'}</button></div>
    </div>`;
    if (opts.uploadNotice && at === 0) {
      // Its own section among several fields, as on Workday's My Experience —
      // beside a lone field the probe would read it as that field's error.
      doc.querySelector('[data-automation-id="applyFlowStepPage"]').insertAdjacentHTML('beforeend',
        `<div data-automation-id="formField-website"><label for="w1">Website</label><input id="w1" type="text"></div>
         <section><div role="alert">SHUBHAM_SARKAR_JU.pdf successfully uploaded</div></section>`);
    }
    doc.querySelector('[data-automation-id="pageFooterNextButton"]').addEventListener('click', () => {
      for (const el of doc.querySelectorAll("input")) if (el.value) log.filled[el.id] = el.value;
      if (steps[at].submit) { log.submit++; return; }
      log.next++;
      if ((opts.errorOnFirst && !errored) || opts.errorAlways) {
        errored = true;
        doc.querySelector('[data-automation-id="applyFlowPage"]').insertAdjacentHTML('afterbegin',
          '<div data-automation-id="errorBanner">Errors Found: Phone Number is required</div>');
        return;
      }
      // Workday's quiet refusal: an empty required field is outlined, no banner.
      if (opts.validate) {
        const empty = Array.from(doc.querySelectorAll('input[aria-required="true"]')).filter(el => !el.value);
        for (const el of empty) el.setAttribute('aria-invalid', 'true');
        if (empty.length) { log.refused = (log.refused || 0) + 1; return; }
      }
      // Refused once on step 2 even though it was filled — the form cleared it.
      if (opts.refuseOnceAt === at && !errored) {
        errored = true;
        const el = doc.querySelector('input[aria-required="true"]');
        el.value = '';
        el.setAttribute('aria-invalid', 'true');
        log.refused = (log.refused || 0) + 1;
        return;
      }
      const advance = () => {
        at++;
        render();
        if (opts.footerStays) {
          // NVIDIA: the footer stays from the last step; the step's fields are
          // drawn a moment after the progress bar moves.
          const stepPage = doc.querySelector('[data-automation-id="applyFlowStepPage"]');
          const html = stepPage.innerHTML;
          stepPage.innerHTML = '';
          setTimeout(() => { stepPage.innerHTML = html; }, opts.footerStays);
        }
        if (opts.lagMs) {
          // Workday: the progress bar moves at once; the page and its footer are
          // drawn a moment later.
          doc.querySelector('[data-automation-id="applyFlowStepPage"]').innerHTML = '';
          doc.querySelector('[data-automation-id="pageFooter"]').remove();
          setTimeout(render, opts.lagMs);
        }
      };
      // Workday saves the step before it moves on — a second or more.
      if (opts.saveMs) setTimeout(advance, opts.saveMs);
      else advance();
    });
  };
  // Workday drops a field's error outline as soon as it gets a value.
  for (const type of ['input', 'change']) {
    doc.body.addEventListener(type, (e) => {
      if (e.target && e.target.value) e.target.setAttribute('aria-invalid', 'false');
    });
  }
  return { log, filled: log.filled, render, goTo: (i) => { at = i; render(); } };
}

// The sidebar lives in <body>: render the steps into a container instead of
// replacing the body, so the panel survives each "page".
function autoApplyPage(opts) {
  return loadPage('<!doctype html><html><body><div id="wd-root"></div></body></html>', PWC_URL, true, opts);
}

function mountSteps(page, opts) {
  const root = page.document.getElementById('wd-root');
  const shim = { document: { body: root, getElementById: id => page.document.getElementById(id),
                             querySelector: s => root.querySelector(s),
                             querySelectorAll: s => root.querySelectorAll(s) } };
  const app = wireAutoApplyPage(shim, opts);
  app.render();
  return app;
}

async function startAuto(page) {
  ok(await waitForText(page, /Auto-apply all pages/, 15000), 'the auto-apply button is offered on Workday');
  page.document.getElementById('tcvAfAutoBtn').click();
}

test('Auto-apply: fills every step, clicks Save and Continue, stops at Review without submitting', async () => {
  const page = autoApplyPage();
  const app = mountSteps(page);
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 60000), 'it stops on the Review page');
  eq(app.log.next, 2, 'Save and Continue pressed once per step before Review');
  eq(app.log.submit, 0, 'Submit is NEVER pressed');
});

// The next `misses` looks for a form find none: a page just changed (Barclays, Nov 2026).
function missForm(page, misses) {
  const AF = page.window.__tcvAutofill;
  const real = AF.isApplicationPage;
  const state = { left: misses, calls: 0 };
  AF.isApplicationPage = (...args) => {
    state.calls++;
    if (state.left > 0) { state.left--; return null; }
    return real(...args);
  };
  return state;
}

test('Auto-apply: a form missed for a moment is looked for again, and the page is filled without a pause', async () => {
  const page = autoApplyPage();
  const app = mountSteps(page);
  ok(await waitForText(page, /Auto-apply all pages/, 15000), 'the auto-apply button is offered');
  const missed = missForm(page, 1);
  page.document.getElementById('tcvAfAutoBtn').click();
  ok(await waitForText(page, /Ready to submit/, 60000),
     `it reaches Review: ${page.document.getElementById('tailorcv-sidebar').textContent.replace(/\s+/g, ' ').slice(0, 400)}`);
  eq(missed.left, 0, 'the form really was missed');
  ok(app.filled.e2, 'the page after it was filled too');
  eq(app.log.next, 2);
  eq(app.log.submit, 0);
});

test('Auto-apply: a page that truly has no form still pauses, after looking again', async () => {
  const page = autoApplyPage();
  const app = mountSteps(page);
  ok(await waitForText(page, /Auto-apply all pages/, 15000), 'the auto-apply button is offered');
  const missed = missForm(page, Infinity);
  page.document.getElementById('tcvAfAutoBtn').click();
  ok(await waitForText(page, /Auto-apply paused/, 60000), 'it pauses');
  ok(/No application form found/.test(page.document.getElementById('tailorcv-sidebar').textContent), 'and says why');
  ok(missed.calls > 3, `it looked more than once: ${missed.calls}`);
  eq(app.log.next, 0, 'nothing was pressed');
  eq(app.log.submit, 0);
});

test('Auto-apply: pauses on a required field it cannot fill, and Continue resumes', async () => {
  const page = autoApplyPage();
  const app = mountSteps(page, { blocker: true });
  await startAuto(page);
  ok(await waitForText(page, /Auto-apply paused/, 60000), 'it pauses on step 2');
  ok(/favourite colour/i.test(page.document.getElementById('tailorcv-sidebar').textContent), 'listing the field');
  eq(app.log.next, 1, 'it did not press Save and Continue past the blocker');

  const q = page.document.getElementById('q1');
  q.value = 'Blue';
  q.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  q.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  page.document.getElementById('tcvAfAutoContinue').click();
  ok(await waitForText(page, /Ready to submit/, 60000), 'it carries on to Review');
  eq(app.log.next, 2);
  eq(app.log.submit, 0);
  // What they answered on the page is remembered, without being asked.
  const saved = page.sent.filter(m => m.type === 'AF_SAVE_ANSWERS')
    .flatMap(m => (m.payload && m.payload.answers) || []);
  ok(saved.some(a => /favourite colour/i.test(a.question) && a.answer === 'Blue'),
     `saved on Continue: ${JSON.stringify(saved)}`);
});

test('Auto-apply: a required question the AI skipped is asked again with force, and the run goes on', async () => {
  const forced = [];
  const page = autoApplyPage({
    plan: (payload) => {
      if (!payload.force) return { answers: {} };           // the first pass skips it
      forced.push(...payload.fields.map(f => f.label));
      const f = payload.fields.find(x => /colour/i.test(x.label));
      return { answers: f ? { [f.i]: { value: 'Blue', source: 'ai_forced', confidence: 0.6 } } : {} };
    },
  });
  const app = mountSteps(page, { blocker: true });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 60000), 'it reaches Review without pausing');
  ok(forced.some(l => /colour/i.test(l)), `the question was sent with force: ${forced.join(', ')}`);
  eq(app.log.next, 2);
  eq(app.log.submit, 0);
});

test('Auto-apply: a sensitive required question is never forced — it still pauses', async () => {
  const forced = [];
  const page = autoApplyPage({
    plan: (payload) => { if (payload.force) forced.push(...payload.fields.map(f => f.label)); return { answers: {} }; },
  });
  const root = page.document.getElementById('wd-root');
  mountSteps(page);
  root.querySelector('[data-automation-id="applyFlowStepPage"]').insertAdjacentHTML('beforeend',
    `<div data-automation-id="formField-auth"><label for="wa">Will you now or in the future require visa sponsorship?<abbr>*</abbr></label>
      <input id="wa" type="text" aria-required="true"></div>`);
  await startAuto(page);
  ok(await waitForText(page, /Auto-apply paused/, 60000), 'it pauses for the sponsorship question');
  ok(!forced.some(l => /sponsorship/i.test(l)), `never sent with force: ${forced.join(', ')}`);
});

test('Auto-apply: a page drawn after its step changes is still filled before moving on', async () => {
  // NVIDIA: the progress bar moved, the page came a moment later — the fill
  // found nothing ("0 filled") and Save and Continue was not there yet.
  const page = autoApplyPage();
  const app = mountSteps(page, { lagMs: 1500 });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 60000), 'it reaches Review');
  eq(app.log.next, 2);
  eq(app.log.submit, 0);
  ok(app.filled.e2, 'step 2 was filled after it was drawn');
});

test('Auto-apply: a "successfully uploaded" notice is not an error', async () => {
  const page = autoApplyPage();
  const app = mountSteps(page, { uploadNotice: true, saveMs: 1500 });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 60000),
     `it reaches Review: ${page.document.getElementById('tailorcv-sidebar').textContent.replace(/\s+/g, ' ').slice(0, 600)}`);
  eq(app.log.next, 2);
  eq(app.log.submit, 0);
});

test('Auto-apply: the footer stays while the next step is drawn — the step is still filled', async () => {
  // NVIDIA Voluntary Disclosures: Save and Continue never left the screen, the
  // fields came 2 s later, the fill ran on the empty step ("0 filled") and
  // Workday refused the press.
  const page = autoApplyPage();
  const app = mountSteps(page, { footerStays: 2000, validate: true });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 60000), 'it reaches Review');
  ok(app.filled.e2, 'step 2 was filled once drawn');
  eq(app.log.refused || 0, 0, 'Workday never had to refuse a press');
  eq(app.log.submit, 0);
});

test('Auto-apply: a press Workday quietly refuses is filled again and pressed once more', async () => {
  const page = autoApplyPage();
  const app = mountSteps(page, { refuseOnceAt: 1 });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 90000),
     `it reaches Review after the retry: ${page.document.getElementById('tailorcv-sidebar').textContent
       .replace(/\s+/g, ' ').slice(280, 900)} log=${JSON.stringify(app.log)}`);
  eq(app.log.refused, 1);
  eq(app.log.next, 3, 'step 1, step 2 refused, step 2 again');
  eq(app.log.submit, 0);
});

test('Auto-apply: Workday\'s error banner gets one refill and one more press', async () => {
  // Visa: "School or University is required" beside a box showing the school —
  // committed after the press. The second press goes through.
  const page = autoApplyPage();
  const app = mountSteps(page, { errorOnFirst: true });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 90000), 'it reaches Review after the retry');
  eq(app.log.next, 3, 'step 1 refused, step 1 again, step 2');
  eq(app.log.submit, 0);
});

test('Auto-apply: Workday refusing twice with an error pauses, showing the error', async () => {
  const page = autoApplyPage();
  const app = mountSteps(page, { errorAlways: true });
  await startAuto(page);
  ok(await waitForText(page, /Phone Number is required/, 90000), 'the error is shown in the sidebar');
  ok(/Auto-apply paused/.test(page.document.getElementById('tailorcv-sidebar').textContent));
  eq(app.log.next, 2, 'pressed twice, not more');
});

// ── Auto-apply on Oracle ────────────────────────────────────
// A four-page Oracle Candidate Experience application in the markup of a JPMC
// capture: the sections are all on the page and only the active one is shown,
// the page menu marks the current page, and the last page has Submit, no Next.
const ORACLE_URL = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/1/apply/section/1/';

function oracleRow(id, label, extra = '') {
  return `<div class="input-row input-row--text">
    <label class="input-row__label input-row__label--required" for="${id}"><span class="input-row__linebreak">${label}</span></label>
    <div class="input-row__control-container"><input class="input-row__control" id="${id}" name="${id}" type="text" aria-required="true" aria-invalid="false" ${extra}></div>
  </div>`;
}

function oraclePage(opts = {}) {
  const page = loadPage(`<!doctype html><html><body><main><section class="apply-flow__content-container">
    <form class="apply-flow__content apply-flow__content-form" novalidate method="post">
      <div class="apply-flow-page">
        ${[1, 2, 3, 4].map(n => `<apply-flow-section id="section-${n}" aria-hidden="false">
          <div class="apply-flow-section" data-section-number="${n}"${n === 1 ? '' : ' style="display:none"'}>
            ${(opts.sections || {})[n] || oracleRow(`email-${n}`, 'Email Address') + oracleRow(`name-${n}`, 'Full Name')}
          </div></apply-flow-section>`).join('')}
        <apply-flow-pagination><div class="apply-flow-pagination"><div class="apply-flow-pagination__buttons"></div></div></apply-flow-pagination>
      </div>
    </form></section></main></body></html>`, opts.url || ORACLE_URL, true, opts);
  const doc = page.document;
  const log = { next: 0, back: 0, submit: 0, formSubmits: 0, refused: 0 };
  let at = 1;
  doc.addEventListener('submit', () => { log.formSubmits++; });
  const renderFooter = () => {
    const links = [1, 2, 3, 4].map(n => `<li><a href="#" class="apply-flow-navigation-pages__link${n === at
      ? ' apply-flow-navigation-pages__link--current' : ''}" aria-label="${n}">${n}</a></li>`).join('');
    doc.querySelector('.apply-flow-pagination__buttons').innerHTML = `
      <button type="button" class="button apply-flow-pagination__button" id="back" title="Back" aria-label="Back"><span class="button__label">Back</span></button>
      <div class="apply-flow-navigation-pages" role="navigation"><ul>${links}</ul></div>
      ${at === 4
    ? '<button type="button" class="button apply-flow-pagination__button apply-flow-pagination__submit-button" id="submit"><span class="button__label">Submit</span></button>'
    : `<button${opts.nextHasNoType ? '' : ' type="button"'} class="button apply-flow-pagination__button" id="next"${
      opts.nextName ? '' : ' title="Next" aria-label="Next"'}><span class="button__label">${opts.nextName || 'Next'}</span></button>`}`;
    doc.getElementById('back').addEventListener('click', () => { log.back++; });
    const next = doc.getElementById('next');
    if (next) next.addEventListener('click', () => {
      log.next++;
      const shown = doc.querySelector(`[data-section-number="${at}"]`);
      const empty = [...shown.querySelectorAll('input[aria-required="true"]')].filter(i => !i.value);
      if (opts.refuseAlways || (opts.refuseOnceAt === at && !log.refused)) {
        log.refused++;
        const row = shown.querySelector('.input-row');
        row.classList.add('input-row--invalid');
        row.querySelector('input').setAttribute('aria-invalid', 'true');
        return;
      }
      if (empty.length) { log.refused++; for (const i of empty) i.closest('.input-row').classList.add('input-row--invalid'); return; }
      shown.style.display = 'none';
      at++;
      page.window.history.pushState({}, '', (opts.url || ORACLE_URL).replace(/section\/1\//, `section/${at}/`));
      doc.querySelector(`[data-section-number="${at}"]`).style.display = '';
      renderFooter();
    });
    const submit = doc.getElementById('submit');
    if (submit) submit.addEventListener('click', () => { log.submit++; });
  };
  renderFooter();
  // Oracle drops a field's outline as soon as it gets a value.
  for (const type of ['input', 'change']) {
    doc.body.addEventListener(type, (e) => {
      const row = e.target && e.target.closest && e.target.closest('.input-row');
      if (row && e.target.value) {
        row.classList.remove('input-row--invalid');
        e.target.setAttribute('aria-invalid', 'false');
      }
    });
  }
  return { page, doc, log, at: () => at };
}

test('Auto-apply on Oracle: fills every page, clicks Next, stops at the Submit page without pressing it', async () => {
  const { page, doc, log, at } = oraclePage();
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 90000),
     `it stops on the last page: ${doc.getElementById('tailorcv-sidebar').textContent.replace(/\s+/g, ' ').slice(0, 500)}`);
  eq(at(), 4, 'it reached page 4');
  eq(log.next, 3, 'Next pressed once per page before the last');
  eq(log.submit, 0, 'Submit is NEVER pressed');
  eq(log.back, 0, 'Back is never pressed');
  for (const n of [1, 2, 3, 4]) ok(doc.getElementById(`name-${n}`).value, `page ${n} was filled`);
});

test('Auto-apply on Oracle: works on a company\'s own domain (careers.oracle.com)', async () => {
  const { page, log, at } = oraclePage({ url: 'https://careers.oracle.com/en/sites/jobsearch/jobs/preview/337914/apply/section/1/?location=India&locationId=300000000106947&locationLevel=country&mode=location' });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 90000), 'it stops on the last page');
  eq(at(), 4);
  eq(log.next, 3);
  eq(log.submit, 0, 'Submit is NEVER pressed');
});

test('Auto-apply on Oracle: a Next with no type inside the form can never submit the form', async () => {
  const { page, log } = oraclePage({ nextHasNoType: true });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 90000), 'it reaches the last page');
  eq(log.next, 3);
  eq(log.formSubmits, 0, 'the press never submits the form');
  eq(log.submit, 0);
});

test('Auto-apply on Oracle: a page Oracle refuses once is filled again and pressed once more', async () => {
  const { page, log } = oraclePage({ refuseOnceAt: 2 });
  await startAuto(page);
  ok(await waitForText(page, /Ready to submit/, 90000), 'it reaches the last page after the retry');
  eq(log.refused, 1);
  eq(log.next, 4, 'page 1, page 2 refused, page 2 again, page 3');
  eq(log.submit, 0);
});

test('Auto-apply on Oracle: refused twice, it pauses and names the outlined field', async () => {
  const { page, doc, log } = oraclePage({ refuseAlways: true });
  await startAuto(page);
  ok(await waitForText(page, /Auto-apply paused/, 90000), 'it pauses');
  ok(/Oracle did not (accept|move on)/.test(doc.getElementById('tailorcv-sidebar').textContent), 'says what happened');
  ok(/Email Address/.test(doc.getElementById('tailorcv-sidebar').textContent), 'names the field');
  eq(log.next, 2, 'pressed twice, not more');
  eq(log.submit, 0);
});

test('Auto-apply on Oracle: a footer button that is not called Next is never pressed', async () => {
  const { page, doc, log } = oraclePage({ nextName: 'Proceed' });
  await startAuto(page);
  ok(await waitForText(page, /Couldn.t find Next/, 90000),
     `it pauses: ${doc.getElementById('tailorcv-sidebar').textContent.replace(/\s+/g, ' ').slice(0, 500)}`);
  eq(log.next, 0);
  eq(log.back, 0);
  eq(log.submit, 0);
});

test('Auto-apply on Oracle: a required question it cannot fill pauses before Next', async () => {
  const { page, doc, log } = oraclePage({ sections: { 2: oracleRow('email-2', 'Email Address') + oracleRow('colour', 'What is your favourite colour?') } });
  await startAuto(page);
  ok(await waitForText(page, /Auto-apply paused/, 90000), 'it pauses on page 2');
  ok(/favourite colour/i.test(doc.getElementById('tailorcv-sidebar').textContent), 'listing the question');
  eq(log.next, 1, 'Next was not pressed past it');
  eq(log.submit, 0);
});

test('Workday: a step that grows blocks under the same heading keeps its results', async () => {
  // nvidia.wd5 "My Experience": the run itself pressed Add and created Work
  // Experience / Education blocks. Compared with the fields from BEFORE the
  // run, that read as a new step, and the results gave way to "Page 2 — ready
  // to autofill". The heading had not changed, so it was the same step.
  const withHeading = fixtures.WORKDAY_MYINFO.replace(
    '<div data-automation-id="applyFlowMyInfoPage">',
    '<h2>My Experience</h2><div data-automation-id="applyFlowMyInfoPage">');
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true);
  renderLater(page, withHeading, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');
  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 30000), 'the fill must finish');

  const step = page.document.querySelector('[data-automation-id="applyFlowMyInfoPage"]');
  let blocks = '';
  for (let n = 1; n <= 4; n++) {
    blocks += `<div role="group" aria-labelledby="Education-${n}-panel"><h5 id="Education-${n}-panel">Education ${n}</h5>
      <label for="sch${n}">School or University*</label><input id="sch${n}" type="text">
      <label for="deg${n}">Degree*</label><input id="deg${n}" type="text">
      <label for="gpa${n}">Overall Result (GPA)</label><input id="gpa${n}" type="text"></div>`;
  }
  step.insertAdjacentHTML('beforeend', blocks);
  await new Promise(r => setTimeout(r, 4000));                       // the watcher runs
  const text = page.document.getElementById('tailorcv-sidebar').textContent;
  ok(!/Page 2/.test(text), 'still the same step — no "Page 2"');
  ok(/filled/i.test(text), 'the results are still shown');
});

test('Workday: the next step is shown even when the page passes through "no form" on the way', async () => {
  // nvidia.wd5: page 1 is torn down (a moment with no form at all) before page
  // 2 renders. The watcher saw page 2 as a form "appearing", left the results
  // view alone, and the sidebar kept page 1's results until a tab switch.
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true);
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'first step must be offered');
  page.document.getElementById('tcvAfFillBtn').click();
  ok(await waitForText(page, /filled/i, 30000), 'the first fill must finish');

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

// A page that only holds the application: the Tailor tab finds the posting's
// description instead of asking for it to be pasted.
const CITI_JD = 'Build and deploy generative AI systems for risk. '.repeat(20);

test('form-only page: the Tailor tab shows the job for review, then a Tailor my resume button', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true, {
    recall: { job: { role: 'Machine Learning with Gen AI', company: 'Citi', jd_string: CITI_JD,
                     url: 'https://citi.wd5.myworkdayjobs.com/en-US/2/job/Pune/ML_26991325' }, source: 'remembered' },
  });
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'the apply view comes first');
  page.document.querySelector('.tcv-tab[data-tab="tailor"]').click();
  ok(await waitForText(page, /Job details are ready to review/, 5000), 'the review form');
  const val = id => page.document.getElementById(id).value;
  eq(val('tcvRvTitle'), 'Machine Learning with Gen AI');
  eq(val('tcvRvCompany'), 'Citi');
  eq(val('tcvRvUrl'), 'https://citi.wd5.myworkdayjobs.com/en-US/2/job/Pune/ML_26991325');
  ok(val('tcvRvJd').startsWith('Build and deploy generative AI'), 'the description, editable');
  ok(await waitForText(page, /Tailor my resume/, 2000), 'with the Tailor button');
  notOk(page.document.getElementById('tcvManualJd'), 'no separate paste box');
});

test('form-only page: what is tailored is the description as the person edited it', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true, {
    recall: { job: { role: 'ML Engineer', company: 'Citi', jd_string: CITI_JD }, source: 'remembered' },
  });
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'the apply view comes first');
  page.document.querySelector('.tcv-tab[data-tab="tailor"]').click();
  ok(await waitForText(page, /Job details are ready to review/, 5000), 'the review form');
  const edited = 'Edited: design retrieval pipelines and evaluate LLM agents. '.repeat(6);
  page.document.getElementById('tcvRvJd').value = edited;
  page.document.getElementById('tcvRvTailor').click();
  await new Promise(r => setTimeout(r, 300));
  const call = page.sent.find(m => m.type === 'TAILOR_AND_DOWNLOAD');
  ok(call, 'tailoring started');
  eq(call && call.payload.jd_string, edited.trim(), 'with the edited description');
});

test('form-only page: the posting is fetched when nothing was remembered', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true, {
    fetched: { job: { role: 'Machine Learning with Gen AI', company: 'Citi', jd_string: CITI_JD }, source: 'posting' },
  });
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'the apply view comes first');
  page.document.querySelector('.tcv-tab[data-tab="tailor"]').click();
  ok(await waitForText(page, /read from the job posting/, 5000), 'read from the posting data');
  const recall = page.sent.findIndex(m => m.type === 'JOB_RECALL');
  const fetchAt = page.sent.findIndex(m => m.type === 'JOB_FETCH');
  ok(recall >= 0 && fetchAt > recall, 'memory first, then the posting');
});

test('form-only page: when nothing is found, the same form asks for the description', async () => {
  const page = loadPage('<!doctype html><html><body></body></html>', CITI_URL, true);
  renderLater(page, fixtures.WORKDAY_MYINFO, 200);
  ok(await waitForText(page, /Autofill this application/, 15000), 'the apply view comes first');
  page.document.querySelector('.tcv-tab[data-tab="tailor"]').click();
  ok(await waitForText(page, /couldn't find this job's description/, 5000), 'says why it is asking');
  eq(page.document.getElementById('tcvRvJd').value, '', 'an empty description to paste into');
  page.document.getElementById('tcvRvTailor').click();
  ok(await waitForText(page, /Add the job title/, 2000), 'a title is required');
  page.document.getElementById('tcvRvTitle').value = 'Machine Learning with Gen AI';
  page.document.getElementById('tcvRvTailor').click();
  ok(await waitForText(page, /Add the job description/, 2000), 'and will not tailor without a description');
  notOk(page.sent.some(m => m.type === 'TAILOR_AND_DOWNLOAD'), 'nothing sent');
});

test('a posting page remembers its description for the application that follows', async () => {
  const page = loadPage(JSON_LD_PAGE, 'https://job-boards.greenhouse.io/acme/jobs/1234567', true);
  ok(await waitForText(page, /Senior Backend Engineer/, 10000), 'the job view renders');
  const remember = page.sent.find(m => m.type === 'JOB_REMEMBER');
  ok(remember, 'JOB_REMEMBER sent');
  ok(remember && /senior backend engineer/i.test(remember.job.jd_string), 'with the description');
  ok(remember && remember.urls.includes('https://job-boards.greenhouse.io/acme/jobs/1234567'), 'under this posting');
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
