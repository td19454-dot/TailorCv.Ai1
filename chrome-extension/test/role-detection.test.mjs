// Job-title detection regression test.
//
// Two real failures this guards, both from the same root cause — guessRole()
// took the first <h1> on the page and called it the role:
//   1. "Job Title: Add this job to view your Match Score and tailor your
//      resume. at Show Premium Insights" — LinkedIn's premium upsell card
//      (an <h1>) plus its "Show Premium Insights" /company/ link.
//   2. "Job Title: About the job" — the section heading above the description,
//      which sits inside the very container the scoped scan looks in.
//
// Run: node test/role-detection.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, '..', 'content.js'), 'utf8');

// Expose the module-private detection functions to the test without touching
// the shipped file: the IIFE's last line is where we hook in.
const INSTRUMENTED = SOURCE.replace(
  '})();',
  'window.__tcvTest = { extractJob, guessRole, looksLikeRole, roleFromDocumentTitle, guessCompany };\n})();'
);
if (INSTRUMENTED === SOURCE) throw new Error('could not instrument content.js — IIFE tail moved');

const JD = `We are looking for a Senior Backend Engineer to own our payments platform.
Responsibilities:
- Design and ship Python services on AWS
- Own the Postgres schema and query performance
Requirements:
- 5+ years of backend experience
- Strong Python, PostgreSQL and Docker skills
Qualifications: BS in Computer Science or equivalent experience. Benefits include
health cover and a learning budget. The ideal candidate has shipped production
systems at scale and is comfortable with on-call. Nice to have: Kubernetes,
Terraform, and experience with high-volume transaction systems. Minimum
requirements are listed above.`;

function load(html, { url, title }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  window.document.title = title;
  window.chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + p,
      sendMessage: (_m, cb) => cb && cb({}),
      onMessage: { addListener() {} },
    },
  };
  // innerText is not implemented in jsdom; textContent is a close enough stand-in
  // for detection, which only reads it for length and pattern checks.
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
    configurable: true,
  });
  window.eval(INSTRUMENTED);
  return window.__tcvTest;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── The reported bugs, as seen on a LinkedIn job page ─────────────────────
// The upsell <h1> comes first in document order, and the "About the job"
// heading sits inside the description container — exactly as LinkedIn ships
// them.
const LINKEDIN = `<!doctype html><html><body>
  <h1>Add this job to view your Match Score and tailor your resume.</h1>
  <a href="/company/acme/insights/">Show Premium Insights</a>
  <div class="job-view-layout">
    <h1 class="t-24 job-details-jobs-unified-top-card__job-title">Senior Backend Engineer</h1>
    <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/acme/">Acme Corp</a></div>
    <div class="jobs-description__content">
      <h2>About the job</h2>
      <div id="job-details">${JD}</div>
    </div>
  </div>
</body></html>`;

test('linkedin: the premium upsell h1 is not mistaken for the job title', () => {
  const t = load(LINKEDIN, { url: 'https://www.linkedin.com/jobs/view/4123456789/', title: '(3) Acme Corp hiring Senior Backend Engineer in Bengaluru | LinkedIn' });
  const job = t.extractJob();
  eq(job.role, 'Senior Backend Engineer', 'role');
  eq(job.company, 'Acme Corp', 'company');
});

test('linkedin: "About the job" is a section label, not the job title', () => {
  // The real title element is gone, so the scoped scan's best remaining
  // candidate inside the JD container is the section heading itself.
  const stripped = LINKEDIN.replace(/<h1 class="t-24[^]*?<\/h1>/, '');
  const t = load(stripped, { url: 'https://www.linkedin.com/jobs/view/4123456789/', title: '(3) Acme Corp hiring Senior Backend Engineer in Bengaluru | LinkedIn' });
  const job = t.extractJob();
  eq(job.role, 'Senior Backend Engineer', 'role');   // from the tab title
});

test('json-ld title wins', () => {
  const html = `<!doctype html><html><body>
    <script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Data Engineer II',
      hiringOrganization: { name: 'Globex' }, description: JD,
    })}<\/script>
    <h1>Careers</h1>
  </body></html>`;
  const t = load(html, { url: 'https://boards.greenhouse.io/globex/jobs/1', title: 'Globex — Careers' });
  const job = t.extractJob();
  eq(job.role, 'Data Engineer II', 'role');
  eq(job.company, 'Globex', 'company');
});

test('json-ld with a junk title falls back to the page', () => {
  const html = `<!doctype html><html><body>
    <script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Apply now to view your match score and more.',
      description: JD,
    })}<\/script>
    <h1>Product Designer</h1>
  </body></html>`;
  const t = load(html, { url: 'https://example.com/jobs/1', title: 'Product Designer - Example' });
  eq(t.extractJob().role, 'Product Designer', 'role');
});

test('heuristic pages prefer the heading inside the JD container', () => {
  const html = `<!doctype html><html><body>
    <h1>Search results</h1>
    <main><article>
      <h2>Machine Learning Engineer</h2>
      <div>${JD}</div>
    </article></main>
  </body></html>`;
  const t = load(html, { url: 'https://careers.example.com/openings/42', title: 'Careers' });
  eq(t.extractJob().role, 'Machine Learning Engineer', 'role');
});

test('looksLikeRole rejects prose, upsell copy, section labels and furniture', () => {
  const t = load('<!doctype html><html><body></body></html>', { url: 'https://example.com/', title: 'x' });
  for (const bad of [
    'Add this job to view your Match Score and tailor your resume.',
    'Show Premium Insights',
    'About the job',
    'About this role',
    'Job description',
    'Responsibilities',
    'Qualifications',
    'Base pay range',
    'Seniority level',
    'Jobs you may be interested in',
    'Careers',
    'Sign in',
    'LinkedIn',
    '',
    'A'.repeat(120),
  ]) {
    if (t.looksLikeRole(bad)) throw new Error(`looksLikeRole accepted junk: ${JSON.stringify(bad)}`);
  }
  for (const good of [
    'Senior Backend Engineer', 'Data Analyst', 'VP, Engineering (Platform)',
    'SDE-2', 'LinkedIn Outreach Specialist', 'Quality Assurance Engineer',
  ]) {
    if (!t.looksLikeRole(good)) throw new Error(`looksLikeRole rejected a real title: ${JSON.stringify(good)}`);
  }
});

test('roleFromDocumentTitle unwraps the common tab-title shapes', () => {
  const cases = [
    ['(12) Acme hiring Senior Data Scientist in Pune | LinkedIn', 'Senior Data Scientist'],
    ['Backend Developer - Acme - Indeed.com', 'Backend Developer'],
    ['DevOps Engineer | Acme | Greenhouse', 'DevOps Engineer'],
    ['Careers', ''],
  ];
  for (const [title, expected] of cases) {
    const t = load('<!doctype html><html><body></body></html>', { url: 'https://example.com/', title });
    eq(t.roleFromDocumentTitle(), expected, `title ${JSON.stringify(title)}`);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
console.log(failed ? `\n${failed}/${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
