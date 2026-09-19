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

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_JS = readFileSync(resolve(HERE, '../content.js'), 'utf8');
const PROBE_JS = readFileSync(resolve(HERE, '../../auto_apply/field_probe.js'), 'utf8');
const AUTOFILL_BUNDLE = readFileSync(resolve(HERE, '../autofill.bundle.js'), 'utf8');

/**
 * Load content.js into a page the way Chrome does.
 *
 * `withAutofill` loads the real autofill bundle first, matching the manifest's
 * script order — so these tests cover both the with-autofill and the
 * bundle-failed-to-load paths.
 */
function loadPage(html, url, withAutofill) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: url || 'https://example.test/jobs/view/12345',
  });
  const { window } = dom;
  polyfillInnerText(window);

  const sent = [];
  // A logged-in user with a base resume, so the panel reaches the job/apply view
  // rather than stopping at login. These are the real response shapes the
  // background worker returns; see refreshFull() in content.js.
  const reply = (msg) => {
    switch (msg.type) {
      case 'GET_ANALYTICS_ID': return { id: 'test-install' };
      case 'GET_PROFILE':
        return { data: { name: 'Ada Lovelace', email: 'ada@example.com',
                         has_resume: true, auto_add_skills: false } };
      case 'GET_BASE_RESUME':
        return { data: { has_base_resume: true, filename: 'ada.pdf' } };
      case 'GET_SKILL_MATCH': return { data: { score: 72 } };
      case 'AF_GET_CONTEXT':
        return { data: { answerBank: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
                         hasResume: true, blockers: [],
                         quota: { exhausted: false, isPro: false } } };
      case 'AF_FRAME_DISCOVER': return { data: [] };
      default: return { data: null };
    }
  };
  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (typeof cb === 'function') cb(reply(msg));
      },
      onMessage: { addListener() {} },
      getURL: path => `chrome-extension://test/${path}`,
      id: 'test',
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  };
  window.__tcvSidebarCss = '/* test */';
  // The analytics bundle is not loaded; content.js guards for that already.
  if (withAutofill) {
    window.eval(PROBE_JS);
    window.eval(AUTOFILL_BUNDLE);
  }
  window.eval(CONTENT_JS);
  return { dom, window, document: window.document, sent };
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
