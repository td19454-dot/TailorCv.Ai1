// jobsource.js — which posting an application page belongs to, and reading it.
//
// Run: node test/jobsource.test.mjs

import { test, run, ok, notOk, eq } from './harness.mjs';
import '../jobsource.js';

const J = globalThis.TCVJobSource;

// ── jobKey: application URLs from real forms ─────────────────

test('Workday: an apply URL names its posting and the public posting data', () => {
  const k = J.jobKey('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/'
    + 'US%2C-NY%2C-Remote/Solutions-Architect--Financial-Services-Capital-Markets_JR2019386/apply/applyManually?source=jobboardlinkedin');
  eq(k.ats, 'workday');
  eq(k.key, 'workday:nvidia.wd5.myworkdayjobs.com:JR2019386');
  eq(k.api, 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/'
    + 'US%2C-NY%2C-Remote/Solutions-Architect--Financial-Services-Capital-Markets_JR2019386');
});

test('Workday: the posting URL and every apply step share one key', () => {
  const base = 'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US/job/Charlotte/Risk-Analysis-Specialist-II_26034392';
  const keys = [base, base + '/apply', base + '/apply/applyManually'].map(u => J.jobKey(u).key);
  eq(new Set(keys).size, 1, keys.join(' | '));
});

test('Greenhouse: board URL and the embedded application both resolve', () => {
  const a = J.jobKey('https://job-boards.greenhouse.io/robinhood/jobs/7263592?t=gh_src%3D');
  eq(a.key, 'greenhouse:robinhood:7263592');
  eq(a.api, 'https://boards-api.greenhouse.io/v1/boards/robinhood/jobs/7263592');
  const b = J.jobKey('https://job-boards.greenhouse.io/embed/job_app?for=airbnb&token=8123037');
  eq(b.key, 'greenhouse:airbnb:8123037');
});

test('Lever: the /apply page and the posting share a key', () => {
  const id = '5f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f';
  eq(J.jobKey(`https://jobs.lever.co/acme/${id}/apply`).key, J.jobKey(`https://jobs.lever.co/acme/${id}`).key);
  eq(J.jobKey(`https://jobs.lever.co/acme/${id}`).api, `https://api.lever.co/v0/postings/acme/${id}`);
});

test('Oracle Candidate Experience: each application section maps to the requisition', () => {
  const k = J.jobKey('https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210768873/apply/section/1');
  eq(k.key, 'oracle:jpmc.fa.oraclecloud.com:210768873');
  ok(k.api.includes('recruitingCEJobRequisitionDetails') && k.api.includes('210768873') && k.api.includes('CX_1001'), k.api);
});

test('pages that are not a known ATS posting resolve to nothing', () => {
  for (const u of ['https://www.linkedin.com/jobs/view/4428170145/', 'https://careers.airbnb.com/positions/8123037/',
                   'not a url', '']) {
    eq(J.jobKey(u), null, u);
  }
});

test('postingUrl turns an application step back into the posting a person would open', () => {
  eq(J.postingUrl('https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210768873/apply/section/1'),
     'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210768873');
  eq(J.postingUrl('https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US/job/Charlotte/Risk-Analysis-Specialist-II_26034392/apply/applyManually'),
     'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US/job/Charlotte/Risk-Analysis-Specialist-II_26034392');
  eq(J.postingUrl('https://job-boards.greenhouse.io/embed/job_app?for=airbnb&token=8123037'),
     'https://job-boards.greenhouse.io/airbnb/jobs/8123037');
  eq(J.postingUrl('https://careers.airbnb.com/positions/8123037/'), 'https://careers.airbnb.com/positions/8123037/',
     'an unknown site is left as it is');
});

// ── parsePosting: each ATS's data shape ──────────────────────

test('parsePosting reads Workday, Greenhouse, Lever and Oracle data', () => {
  const wd = J.parsePosting('workday', { jobPostingInfo: { title: 'Solutions Architect',
    jobDescription: '<p>Build <b>AI</b> platforms.</p><ul><li>Python</li><li>CUDA</li></ul>' } });
  eq(wd.role, 'Solutions Architect');
  ok(/Build AI platforms\.\n+- Python\n- CUDA$/.test(wd.jd_string), JSON.stringify(wd.jd_string));

  // Greenhouse sends its HTML entity-escaped.
  const gh = J.parsePosting('greenhouse', { title: 'Software Engineer, Backend', company_name: 'Robinhood',
    content: '&lt;p&gt;Join us &amp;amp; build.&lt;/p&gt;' });
  eq(gh.role, 'Software Engineer, Backend');
  eq(gh.company, 'Robinhood');
  eq(gh.jd_string, 'Join us & build.');

  const lv = J.parsePosting('lever', { text: 'Data Engineer', descriptionPlain: 'About the role.',
    lists: [{ text: 'Requirements', content: '<li>SQL</li><li>Spark</li>' }], additionalPlain: 'Benefits.' });
  ok(/About the role\.[\s\S]*Requirements[\s\S]*- SQL[\s\S]*Benefits\./.test(lv.jd_string), lv.jd_string);

  const or = J.parsePosting('oracle', { items: [{ Title: 'Global Technology Strategy, Analyst',
    ExternalDescriptionStr: '<p>The team.</p>', ExternalQualificationsStr: '<p>Required skills.</p>' }] });
  eq(or.role, 'Global Technology Strategy, Analyst');
  ok(/The team\.[\s\S]*Required skills\./.test(or.jd_string), or.jd_string);
});

test('parsePosting returns nothing when there is no description', () => {
  eq(J.parsePosting('workday', { jobPostingInfo: { title: 'X' } }), null);
  eq(J.parsePosting('greenhouse', null), null);
});

test('jobPostingFromHtml reads a schema.org JobPosting', () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Data Scientist I',
    hiringOrganization: { '@type': 'Organization', name: 'Bank of America' },
    description: '<p>Model risk.</p>' })}</script></head><body></body></html>`;
  const job = J.jobPostingFromHtml(html);
  eq(job.role, 'Data Scientist I');
  eq(job.company, 'Bank of America');
  eq(job.jd_string, 'Model risk.');
  eq(J.jobPostingFromHtml('<html></html>'), null);
});

test('sameRole matches the same job, not a different one', () => {
  ok(J.sameRole('Solutions Architect, Financial Services Capital Markets',
                'Solutions Architect - Financial Services Capital Markets'));
  notOk(J.sameRole('Data Scientist I', 'Risk Analysis Specialist II'));
  notOk(J.sameRole('', 'Data Scientist'));
});

await run('jobsource.js');
