// Generate the browser fixture pages from the SAME markup the integration suite
// uses, so the two cannot drift apart.
//
// These pages exist for what jsdom cannot cover:
//   * real layout, so geometric visibility is genuinely exercised
//   * a real DataTransfer, so a file upload actually attaches
//   * a portal-rendered react-select menu driven by real pointer events
//   * innerText, which jsdom does not implement at all
//
// Run: node test/build-fixture-pages.mjs
// Then: python -m http.server 8765 --directory test/fixtures/pages
//       and open http://localhost:8765/ with the unpacked extension loaded.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as fixtures from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'fixtures/pages');
mkdirSync(OUT, { recursive: true });

// The same answer bank the integration suite uses.
const CTX = {
  answerBank: {
    full_name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace',
    email: 'ada@example.com', phone: '+91 98765 43210',
    location: 'Kolkata, West Bengal, India',
    address_city: 'Kolkata', address_state: 'West Bengal',
    address_country: 'India', postal_code: '700001',
    linkedin_url: 'https://linkedin.com/in/adalovelace',
    github_url: 'https://github.com/ada',
    university: 'Indian Institute of Technology Delhi',
    degree: 'B.Tech', major: 'Computer Science and Engineering',
    graduation_date: 'Jun 2024', gpa: '8.7/10',
    current_company: 'Acme Corp', current_job_title: 'Software Engineer II',
    years_of_experience: '2', available_start_date: '01/09/2026',
    how_did_you_hear_about_us: 'Company website',
    authorized_to_work_in_country: 'No', requires_visa_sponsorship: 'Yes',
    gender: 'Female', veteran_status: 'I am not a protected veteran',
    accepts_employer_terms_and_privacy_policy: 'Yes',
  },
  hasResume: true, hasCoverLetter: false, blockers: [],
  quota: { exhausted: false, isPro: false },
};

// What the stubbed /plan endpoint returns, keyed by the index the client sends.
// Left empty for most pages: the interesting cases are the deterministic ones,
// and a page that needs the model is covered by the integration suite.
const PLANS = {
  greenhouse: {},
  lever: {},
  workday: {},
  ashby: {},
  generic: {},
  'react-select': {},
  upload: {},
  multistep: {},
};

const PAGE = ({ title, body, note, plan }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TailorCV fixture — ${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 720px; margin: 0 auto; padding: 24px 16px 80px; }
  .tcv-fixture-note { background: #eef2ff; border: 1px solid #c7d2fe; color: #1e1b4b;
    border-radius: 10px; padding: 12px 14px; margin-bottom: 20px; font-size: 13px; }
  .tcv-fixture-note code { background: #fff; padding: 1px 5px; border-radius: 4px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b1020; color: #e5e7eb; }
    .tcv-fixture-note { background: #1e1b4b; border-color: #3730a3; color: #e0e7ff; }
    .tcv-fixture-note code { background: #0b1020; }
  }
  label { display: block; font-weight: 600; margin-top: 14px; font-size: 13px; }
  input:not([type=radio]):not([type=checkbox]), select, textarea {
    width: 100%; padding: 8px 10px; font: inherit; box-sizing: border-box;
    border: 1px solid #94a3b8; border-radius: 6px; margin-top: 4px; }
  label:has(input[type=radio]), label:has(input[type=checkbox]) {
    font-weight: 400; display: flex; gap: 8px; align-items: center; }
  fieldset { margin-top: 18px; border: 1px solid #cbd5e1; border-radius: 8px; }
  button { margin-top: 20px; padding: 10px 18px; font: inherit; border-radius: 8px;
    border: 1px solid #4f46e5; background: #4f46e5; color: #fff; cursor: pointer; }
  .attach-button { background: #f1f5f9; color: #0f172a; border-color: #94a3b8;
    margin-top: 4px; padding: 6px 12px; }
  .select__control { border: 1px solid #94a3b8; border-radius: 6px; padding: 8px 10px;
    margin-top: 4px; cursor: pointer; min-height: 20px; }
  .select__placeholder { color: #64748b; }
  .select__menu { border: 1px solid #94a3b8; border-radius: 6px; margin-top: 2px;
    background: Canvas; }
  .select__menu [role=option] { padding: 8px 10px; cursor: pointer; }
  .select__menu [role=option]:hover { background: #e0e7ff; }
</style>
</head>
<body>
<div class="tcv-fixture-note">
  <strong>TailorCV fixture: ${title}</strong><br>
  ${note}<br><br>
  Run it: open DevTools → Console, switch the context dropdown at the top of the
  console from <em>top</em> to <em>TailorCV</em> (extension globals live in the
  extension's isolated world and are invisible from <em>top</em>), then call
  <code>__tcvAutofill.selfTest()</code>. It runs the real pipeline with the network
  stubbed and prints a table of every field, what was written, and whether the page
  verified it — no login needed.
  <br>Or use the sidebar's <em>Autofill this application</em> button to test the
  real end-to-end flow with your own account.
</div>

${body}

<script>
  window.__tcvFixtureCtx = ${JSON.stringify(CTX, null, 2)};
  window.__tcvFixturePlan = { answers: ${JSON.stringify(plan || {})} };
</script>
</body>
</html>`;

const pages = {
  'greenhouse.html': {
    title: 'Greenhouse',
    note: 'react-select comboboxes, a file input hidden behind an Attach button, '
        + 'EEO dropdowns, and sensitive questions that must stay unanswered.',
    body: fixtures.GREENHOUSE,
    plan: PLANS.greenhouse,
  },
  'greenhouse-remix.html': {
    title: 'Greenhouse (current markup)',
    note: 'Today\'s job-boards.greenhouse.io: two sibling question sections, the '
        + 'phone country picker whose flyout holds an <code>input[type=search]</code>, '
        + 'and an upload named by its wrapping group rather than its Attach label. '
        + 'Real layout matters here — this is the shape that broke discovery.',
    body: fixtures.GREENHOUSE_REMIX,
    plan: PLANS.greenhouse,
  },
  'lever.html': {
    title: 'Lever',
    note: 'Labels that are SIBLINGS of their inputs with no <code>for</code>, '
        + 'bracketed field names, and a radio group with no fieldset.',
    body: fixtures.LEVER,
    plan: PLANS.lever,
  },
  'workday.html': {
    title: 'Workday',
    note: 'data-automation-id attributes, a radio group with no shared name, and a '
        + 'phone field beside its own country-code picker.',
    body: fixtures.WORKDAY,
    plan: PLANS.workday,
  },
  'ashby.html': {
    title: 'Ashby',
    note: 'ARIA-driven comboboxes and a native date input.',
    body: fixtures.ASHBY,
    plan: PLANS.ashby,
  },
  'generic.html': {
    title: 'Generic careers page',
    note: 'A plain hand-written form — the long-tail case with no ATS behind it.',
    body: fixtures.GENERIC,
    plan: PLANS.generic,
  },
  'decoys.html': {
    title: 'Decoys only',
    note: 'A search box, a newsletter signup and a login form. NOTHING should be '
        + 'detected here and no panel should offer to autofill.',
    body: fixtures.DECOYS,
    plan: {},
  },
};

// Workday as it really behaves: the form arrives ~3s after the page loads (so the
// sidebar first shows the job view, then gains the Autofill button without a
// reload), the dropdowns are listbox <button>s with portal menus, and "Save and
// Continue" swaps the step's fields in place without changing the URL.
pages['workday-real.html'] = {
  title: 'Workday (late render, real markup)',
  note: 'The form renders ~3 seconds after load, as on citi.wd5 / pwc.wd3.myworkdayjobs.com. '
      + 'The sidebar should first show nothing to fill, then offer '
      + '<strong>Autofill this application</strong> by itself. "Next step" below '
      + 'simulates Save and Continue: the fields change, the URL does not, and the '
      + 'sidebar should offer page 2.',
  body: `
<div id="wd-mount">Loading application…</div>
<button type="button" id="wd-next" style="display:none">Next step (simulated Save and Continue)</button>
<script>
  ${fixtures.wireWorkday.toString()}
  setTimeout(function () {
    document.getElementById('wd-mount').innerHTML = ${JSON.stringify(fixtures.WORKDAY_MYINFO)};
    wireWorkday(document);
    document.getElementById('wd-next').style.display = '';
  }, 3000);
  document.getElementById('wd-next').addEventListener('click', function () {
    var step = document.querySelector('[data-automation-id="applyFlowMyInfoPage"]');
    if (!step) return;
    step.setAttribute('data-automation-id', 'applyFlowMyExpPage');
    step.innerHTML =
      '<div data-automation-id="formField-school"><label for="s1">School or University*</label>'
      + '<input id="s1" type="text" aria-required="true"></div>'
      + '<div data-automation-id="formField-degree"><label for="s2">Degree*</label>'
      + '<input id="s2" type="text" aria-required="true"></div>'
      + '<div data-automation-id="formField-field"><label for="s3">Field of Study</label>'
      + '<input id="s3" type="text"></div>';
  });
</script>`,
  plan: {},
};

// Two pages that only make sense in a real browser, so they are not in
// fixtures.mjs: both depend on APIs jsdom does not implement.

pages['upload.html'] = {
  title: 'Upload variants',
  note: 'A plain file input, one hidden behind a button, and a drag-and-drop-only '
      + 'zone that listens for <code>drop</code> and ignores <code>change</code>. '
      + 'jsdom has no DataTransfer, so this page is the only place the attach path '
      + 'is genuinely proven.',
  body: `
<form id="upload-form">
  <label for="u-name">Full name</label><input id="u-name" name="name" required>
  <label for="u-email">Email</label><input id="u-email" name="email" type="email" required>

  <label for="u-plain">Resume (plain input)</label>
  <input id="u-plain" name="resume" type="file" required>

  <label for="u-hidden">Resume (hidden behind a button)</label>
  <button type="button" class="attach-button"
          onclick="document.getElementById('u-hidden').click()">Attach</button>
  <input id="u-hidden" name="resume_alt" type="file" style="display:none">

  <label>Cover letter (drop zone only)</label>
  <div class="dropzone" id="u-drop"
       style="border:2px dashed #94a3b8;border-radius:8px;padding:24px;text-align:center;margin-top:4px">
    Drop a file here
    <div id="u-drop-status" style="font-size:12px;color:#64748b;margin-top:6px">nothing yet</div>
  </div>
  <button type="submit">Submit</button>
</form>
<script>
  // Listens for drop and NOT for change — the Uppy/Dropzone/FilePond behaviour.
  var zone = document.getElementById('u-drop');
  ['dragenter','dragover'].forEach(function (t) {
    zone.addEventListener(t, function (e) { e.preventDefault(); });
  });
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    document.getElementById('u-drop-status').textContent =
      f ? ('received: ' + f.name + ' (' + f.size + ' bytes)') : 'drop with no file';
  });
</script>`,
  plan: {},
};

pages['react-select.html'] = {
  title: 'Portal-rendered dropdown',
  note: 'A dropdown whose menu is rendered into a <code>&lt;body&gt;</code>-level '
      + 'portal and which commits on <strong>mousedown</strong>, like react-select. '
      + 'Also a conditional field that only appears once the first is answered.',
  body: `
<form id="rs-form">
  <label for="rs-name">Full name</label><input id="rs-name" name="name" required>
  <label for="rs-email">Email</label><input id="rs-email" name="email" type="email" required>

  <label for="rs-country">Where are you currently based?</label>
  <div class="select__container">
    <div class="select__control" id="rs-control">
      <span class="select__placeholder" id="rs-display">Select...</span>
      <input role="combobox" id="rs-country" aria-haspopup="listbox"
             aria-autocomplete="list" style="border:none;width:100%;padding:0;margin:0">
    </div>
    <input type="hidden" name="country" id="rs-value">
  </div>

  <div id="rs-followup" style="display:none">
    <label for="rs-visa">Do you hold a work permit for that country?</label>
    <select id="rs-visa" name="work_permit">
      <option value="">Select...</option><option value="y">Yes</option><option value="n">No</option>
    </select>
  </div>
  <button type="submit">Submit</button>
</form>
<script>
  (function () {
    var ALL = ['USA', 'Canada', 'India', 'Located Elsewhere'];
    var input = document.getElementById('rs-country');
    var control = document.getElementById('rs-control');
    var display = document.getElementById('rs-display');
    var hidden = document.getElementById('rs-value');
    var menu = null;

    function close() { if (menu) { menu.remove(); menu = null; } }

    function open() {
      close();
      var q = (input.value || '').toLowerCase();
      var shown = ALL.filter(function (o) { return o.toLowerCase().indexOf(q) >= 0; });
      menu = document.createElement('div');
      menu.className = 'select__menu';
      menu.setAttribute('role', 'listbox');
      var box = control.getBoundingClientRect();
      menu.style.cssText = 'position:absolute;z-index:9999;left:' + (box.left + window.scrollX)
        + 'px;top:' + (box.bottom + window.scrollY) + 'px;width:' + box.width + 'px';
      shown.forEach(function (o) {
        var row = document.createElement('div');
        row.setAttribute('role', 'option');
        row.textContent = o;
        // MOUSEDOWN, not click — this is the react-select behaviour that makes a
        // bare .click() open the menu and change nothing.
        row.addEventListener('mousedown', function () {
          display.textContent = o;
          display.className = 'select__singleValue';
          hidden.value = o;
          input.value = '';
          close();
          // A conditional field, revealed by the answer.
          document.getElementById('rs-followup').style.display = o === 'Located Elsewhere' ? 'none' : 'block';
        });
        menu.appendChild(row);
      });
      document.body.appendChild(menu);   // the portal
    }

    control.addEventListener('mousedown', open);
    input.addEventListener('input', function () { if (menu) open(); else open(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }());
</script>`,
  plan: {},
};

const INDEX = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TailorCV autofill fixtures</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 680px; margin: 0 auto; padding: 32px 16px; }
  @media (prefers-color-scheme: dark) { body { background: #0b1020; color: #e5e7eb; } }
  li { margin-bottom: 10px; }
  code { background: rgba(127,127,127,0.18); padding: 1px 5px; border-radius: 4px; }
</style></head><body>
<h1>TailorCV autofill fixtures</h1>
<p>Load the unpacked extension, open a page, then in DevTools → Console switch the
context dropdown from <em>top</em> to <em>TailorCV</em> and call
<code>__tcvAutofill.selfTest()</code> (or <code>__tcvAutofill.diagnose()</code>).
Extension globals are not visible from the default <em>top</em> context. selfTest
runs the real pipeline with the network stubbed and prints a table of every field
and whether the page verified what was written.</p>
<p>These pages cover what the jsdom suites cannot: real layout (geometric
visibility), a real <code>DataTransfer</code> (file attach), portal-rendered
dropdown menus driven by real pointer events, and <code>innerText</code>.</p>
<ul>
${Object.entries(pages).map(([file, p]) =>
  `  <li><a href="${file}">${p.title}</a> — ${p.note.replace(/<[^>]+>/g, '')}</li>`).join('\n')}
</ul>
<h2>What to check</h2>
<ol>
  <li>Every field the table says was written shows <code>verified: ok</code>.</li>
  <li>Work authorization, sponsorship, salary and the EEO questions are
      <em>never</em> filled from anything but the stored profile values above.</li>
  <li>The upload page's drop zone reports the file it received.</li>
  <li>The portal dropdown commits a real option, and the conditional field that
      appears afterwards is picked up.</li>
  <li>The decoys page detects nothing.</li>
  <li>No page is ever submitted.</li>
</ol>
</body></html>`;

for (const [file, page] of Object.entries(pages)) {
  writeFileSync(resolve(OUT, file), PAGE(page), 'utf8');
}
writeFileSync(resolve(OUT, 'index.html'), INDEX, 'utf8');
console.log(`wrote ${Object.keys(pages).length + 1} pages to test/fixtures/pages`);
