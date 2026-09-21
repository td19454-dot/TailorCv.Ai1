// The whole pipeline — discover → decide → write → verify — against realistic
// ATS form shapes.
//
// The unit suites each prove one layer. This proves they compose: that a
// Greenhouse form really does end up with a name in the name box, the resume
// question routed to the attach path, the work-authorization dropdown answered
// from the stored profile and nowhere else, and the salary question handed back
// to the user rather than guessed.
//
// The server is stubbed, deliberately and visibly: what it returns is fixed, so
// a failure here is always a failure in the extension.
//
// Run: node test/integration.test.mjs

import { test, run, ok, notOk, eq } from './harness.mjs';
import { mount, polyfillFileApis } from './dom.mjs';
import * as fixtures from './fixtures.mjs';
import * as d from '../src/autofill/discover.js';
import * as p from '../src/autofill/plan.js';
import * as run_ from '../src/autofill/run.js';
import { setTiming } from '../src/autofill/timing.js';

// The production waits exist to let a framework re-render before a field is read
// back, and to let a portal-rendered menu appear. In jsdom both happen on the
// next microtask, so paying the real waits here would put this suite at several
// minutes — long enough that it stops being run on every change, which is the
// thing worth avoiding. The waits themselves are exercised by write.test.mjs
// against real React.
setTiming({ settleMs: 0, optionWaitMs: 20, revealWatchMs: 10 });

const BANK = {
  full_name: 'Ada Lovelace',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  phone: '+91 98765 43210',
  location: 'Kolkata, West Bengal, India',
  address_city: 'Kolkata',
  address_state: 'West Bengal',
  address_country: 'India',
  postal_code: '700001',
  linkedin_url: 'https://linkedin.com/in/adalovelace',
  github_url: 'https://github.com/ada',
  university: 'Indian Institute of Technology Delhi',
  degree: 'B.Tech',
  major: 'Computer Science and Engineering',
  graduation_date: 'Jun 2024',
  gpa: '8.7/10',
  current_company: 'Acme Corp',
  current_job_title: 'Software Engineer II',
  years_of_experience: '2',
  available_start_date: '01/09/2026',
  how_did_you_hear_about_us: 'Company website',
  authorized_to_work_in_country: 'No',
  requires_visa_sponsorship: 'Yes',
  gender: 'Female',
  veteran_status: 'I am not a protected veteran',
  accepts_employer_terms_and_privacy_policy: 'Yes',
  marketing_or_promotional_emails_opt_in: 'Yes',
};

const CTX = {
  answerBank: BANK, hasResume: true, hasCoverLetter: false, blockers: [],
  quota: { exhausted: false, isPro: false },
};

/**
 * Stand up a fixture with everything run.js needs: the globals, the probe, a
 * stubbed chrome.runtime and a fake server.
 *
 * `serverAnswers` maps a field LABEL to the value the plan endpoint would return
 * for it — by label rather than index so a test reads as what it means.
 */
async function withForm(html, opts, fn) {
  const options = opts || {};
  const env = mount(html);
  polyfillFileApis(env.window);

  const saved = {};
  const names = ['document', 'location', 'Event', 'InputEvent', 'KeyboardEvent',
                 'MouseEvent', 'PointerEvent', 'DragEvent', 'DataTransfer', 'File',
                 'MutationObserver', 'HTMLInputElement', 'HTMLTextAreaElement',
                 'HTMLSelectElement', 'chrome'];
  for (const n of names) saved[n] = { had: n in globalThis, value: globalThis[n] };
  const put = (n, v) => Object.defineProperty(globalThis, n,
    { value: v, writable: true, configurable: true, enumerable: true });

  put('document', env.document);
  put('location', env.window.location);
  for (const n of names) {
    if (['document', 'location', 'chrome'].includes(n)) continue;
    if (env.window[n]) put(n, env.window[n]);
  }
  globalThis.__tcvFieldProbe = env.probe;

  const sent = [];
  put('chrome', {
    runtime: {
      sendMessage(msg, cb) {
        sent.push(msg);
        cb(handleMessage(msg, options));
      },
    },
  });

  await run_.clearState();
  try {
    return await fn(env, sent);
  } finally {
    await run_.clearState();
    run_.stopWatchingUserEdits();
    for (const [n, { had, value }] of Object.entries(saved)) {
      if (had) put(n, value);
      else delete globalThis[n];
    }
    delete globalThis.__tcvFieldProbe;
  }
}

/** The fake background worker / server. */
function handleMessage(msg, options) {
  switch (msg.type) {
    case 'AF_STATE_GET': return { data: null };
    case 'AF_STATE_SET': return { data: { ok: true } };
    case 'AF_STATE_CLEAR': return { data: { ok: true } };
    case 'AF_SAVE_ANSWERS': return { data: { saved: (msg.payload.answers || []).length } };
    case 'AF_GET_RESUME_FILE':
      return options.noResumeBytes
        ? { error: 'no_file' }
        // "%PDF-1.4" — enough to be a plausible file.
        : { data: { base64: 'JVBERi0xLjQK', filename: 'ada_lovelace.pdf',
                    mime: 'application/pdf' } };
    case 'AF_PLAN': {
      if (options.serverError) return { error: options.serverError, code: options.serverCode };
      const answers = {};
      for (const field of msg.payload.fields || []) {
        const value = (options.serverAnswers || {})[field.label];
        if (value === undefined) continue;
        answers[String(field.i)] = {
          value, source: 'ai',
          confidence: options.serverConfidence == null ? 0.8 : options.serverConfidence,
        };
      }
      return { data: { answers, ask: [], sensitiveSkipped: [], neverFill: [] } };
    }
    default: return { data: null };
  }
}

const byLabel = (decisions, needle) =>
  decisions.find(x => (x.label || '').toLowerCase().includes(needle.toLowerCase()));

const valueOf = (env, selector) => {
  const el = env.document.querySelector(selector);
  return el ? String(el.value || '') : null;
};

// ── detection ────────────────────────────────────────────────

test('every fixture is detected as an application form', async () => {
  for (const [name, html] of Object.entries(fixtures.ALL)) {
    await withForm(html, {}, () => {
      const form = d.isApplicationPage();
      ok(form, `${name} was not detected`);
      ok((form.fields || []).length >= 5, `${name} found only ${form.fields.length} fields`);
    });
  }
});

test('decoy forms on the page are never chosen', async () => {
  await withForm(fixtures.DECOYS, {}, () => {
    eq(d.findForm(), null, 'a search box, newsletter and login form are not applications');
  });
});

test('the real form wins on a page that also has decoys', async () => {
  await withForm(fixtures.DECOYS + fixtures.GREENHOUSE, {}, () => {
    const form = d.findForm();
    eq(form.root.id, 'application-form');
  });
});

test('each fixture is attributed to the right ATS by URL', () => {
  eq(d.detectAts('https://boards.greenhouse.io/acme/jobs/1'), 'greenhouse');
  eq(d.detectAts('https://jobs.lever.co/acme/x/apply'), 'lever');
  eq(d.detectAts('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/apply'), 'workday');
  eq(d.detectAts('https://jobs.ashbyhq.com/acme/abc-123/application'), 'ashby');
});

// ── Greenhouse end to end ────────────────────────────────────

test('Greenhouse: identity fields are filled from the profile', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '#first_name'), 'Ada');
    eq(valueOf(env, '#last_name'), 'Lovelace');
    eq(valueOf(env, '#email'), 'ada@example.com');
    eq(valueOf(env, '#phone'), '+919876543210');
    eq(valueOf(env, '#q_linkedin'), 'https://linkedin.com/in/adalovelace');
  });
});

test('Greenhouse: work authorization comes from the profile, not the model', async () => {
  await withForm(fixtures.GREENHOUSE, {
    // The stub would happily answer these if they were ever sent.
    serverAnswers: {
      'Are you legally authorized to work in the United States? *': 'Yes',
      'Will you now or in the future require sponsorship? *': 'No',
    },
  }, async (env, sent) => {
    const result = await run_.runAutofill(CTX, null);
    eq(valueOf(env, '#q_auth'), '0', 'the stored answer is No, so option value 0');
    eq(valueOf(env, '#q_sponsor'), '1', 'the stored answer is Yes, so option value 1');

    // And the proof of the structural rule: they never left the browser.
    const planCall = sent.find(m => m.type === 'AF_PLAN');
    const labels = planCall ? planCall.payload.fields.map(f => f.label) : [];
    notOk(labels.some(l => /authorized to work/i.test(l)),
          `work authorization was sent: ${labels.join(' | ')}`);
    notOk(labels.some(l => /sponsorship/i.test(l)), 'sponsorship was sent');
    void result;
  });
});

test('Greenhouse: salary is left for the user, never guessed', async () => {
  await withForm(fixtures.GREENHOUSE, {
    serverAnswers: { 'What are your salary expectations?': '2,500,000' },
  }, async (env, sent) => {
    const result = await run_.runAutofill(CTX, null);
    eq(valueOf(env, '#q_salary'), '', 'nothing may be written here');
    const row = byLabel(result.decisions, 'salary');
    ok(row, 'the salary field must appear in the results');
    eq(row.action, p.PROFILE, `got ${row.action}`);
    const planCall = sent.find(m => m.type === 'AF_PLAN');
    const labels = planCall ? planCall.payload.fields.map(f => f.label) : [];
    notOk(labels.some(l => /salary/i.test(l)), 'salary was sent to the server');
  });
});

test('Greenhouse: EEO fields take the stored answer and resolve it to the form wording', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    await run_.runAutofill(CTX, null);
    eq(valueOf(env, '#eeo_gender'), 'f', 'Female');
    // "I am not a protected veteran" is stored; this form words it identically.
    eq(valueOf(env, '#eeo_vet'), '2');
  });
});

test('Greenhouse: an EEO decline is matched against the form’s own wording', async () => {
  const ctx = Object.assign({}, CTX, {
    answerBank: Object.assign({}, BANK, {
      gender: 'Decline to self-identify',
      veteran_status: 'Decline to self-identify',
    }),
  });
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    await run_.runAutofill(ctx, null);
    eq(valueOf(env, '#eeo_gender'), 'd', '"Decline To Self Identify"');
    eq(valueOf(env, '#eeo_vet'), '3', '"I don\'t wish to answer" is the same intent');
  });
});

test('Greenhouse: the resume is attached to the hidden input behind the Attach button', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    const input = env.document.querySelector('#resume');
    eq(input.files.length, 1, 'the hidden input must still receive the file');
    eq(input.files[0].name, 'ada_lovelace.pdf');
    const row = byLabel(result.decisions, 'resume');
    eq(row.action, p.DOCUMENT);
    eq(row.outcome, 'ok');
  });
});

test('Greenhouse: a cover letter we do not have is reported, not faked', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'cover letter');
    eq(row.action, p.ASK, 'we must never claim an attach we cannot do');
    eq(env.document.querySelector('#cover_letter').files.length, 0);
  });
});

test('Greenhouse: an unknown product question is answered by the server tier', async () => {
  await withForm(fixtures.GREENHOUSE, {
    serverAnswers: { 'Have you used our developer platform? *': 'Yes' },
  }, async (env) => {
    await run_.runAutofill(CTX, null);
    eq(valueOf(env, '#q_product'), '1');
  });
});

test('Greenhouse: prose is written but flagged for review', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, BANK, {
        why_do_you_want_this_role: 'x'.repeat(300),
      }),
    });
    const result = await run_.runAutofill(ctx, null);
    const row = byLabel(result.decisions, 'why do you want');
    eq(row.action, p.SUGGEST, 'the user must read it before submitting');
    eq(valueOf(env, '#q_why').length, 300, 'but it IS written, so they can read it');
  });
});

test('Greenhouse: the marketing opt-in checkbox is ticked', async () => {
  await withForm(fixtures.GREENHOUSE, {
    serverAnswers: { "I'd like to receive updates about future roles": 'yes' },
  }, async (env) => {
    await run_.runAutofill(CTX, null);
    ok(env.document.querySelector('[name=consent_marketing]').checked);
  });
});

test('Greenhouse: nothing in the run touches the submit button', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    let submitted = 0;
    env.document.querySelector('#application-form')
       .addEventListener('submit', (e) => { submitted++; e.preventDefault(); });
    env.document.querySelector('#submit_app')
       .addEventListener('click', () => { submitted++; });
    await run_.runAutofill(CTX, null);
    eq(submitted, 0, 'THE most important assertion in this file');
  });
});

// ── Lever ────────────────────────────────────────────────────

test('Lever: bracketed field names and span-wrapped labels resolve', async () => {
  await withForm(fixtures.LEVER, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '[name=name]'), 'Ada Lovelace');
    eq(valueOf(env, '[name=email]'), 'ada@example.com');
    eq(valueOf(env, '[name="urls[LinkedIn]"]'), 'https://linkedin.com/in/adalovelace');
    eq(valueOf(env, '[name="urls[GitHub]"]'), 'https://github.com/ada');
    eq(valueOf(env, '[name=org]'), 'Acme Corp');
  });
});

test('Lever: a radio group for work authorization is answered from the profile', async () => {
  await withForm(fixtures.LEVER, {}, async (env) => {
    await run_.runAutofill(CTX, null);
    const yes = env.document.querySelector('[value=Yes]');
    const no = env.document.querySelector('[value=No]');
    ok(no.checked, 'the stored answer is No');
    notOk(yes.checked);
  });
});

test('Lever: "How did you hear" is filled from the profile', async () => {
  await withForm(fixtures.LEVER, {}, async (env) => {
    await run_.runAutofill(CTX, null);
    eq(valueOf(env, '[name="cards[source][field0]"]'), 'Company website');
  });
});

// ── Workday ──────────────────────────────────────────────────

test('Workday: fields resolve and the address parts go in separately', async () => {
  await withForm(fixtures.WORKDAY, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '#wd-first'), 'Ada');
    eq(valueOf(env, '#wd-last'), 'Lovelace');
    eq(valueOf(env, '#wd-email'), 'ada@example.com');
    eq(valueOf(env, '#wd-city'), 'Kolkata');
    eq(valueOf(env, '#wd-zip'), '700001');
  });
});

test('Workday: a nameless radiogroup is one field, answered from the profile', async () => {
  await withForm(fixtures.WORKDAY, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    const radios = result.decisions.filter(x => x.kind === 'radio');
    eq(radios.length, 1, 'two radios with no shared name must be ONE question');
    ok(env.document.querySelector('[data-automation-id=sponsorYes]').checked,
       'the stored sponsorship answer is Yes');
  });
});

test('Workday: a phone beside a country picker gets the national number only', async () => {
  await withForm(fixtures.WORKDAY, {}, async (env) => {
    await run_.runAutofill(CTX, null);
    eq(valueOf(env, '#wd-phone'), '9876543210',
       'the +91 belongs in the country select, not in the number box');
  });
});

// ── Workday, as it really renders ────────────────────────────

test('Workday (real markup): applyFlowPage with no <form> is detected', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, () => {
    const form = d.isApplicationPage();
    ok(form, 'a Workday page has no <form> element and must still be found');
    eq(form.root.getAttribute('data-automation-id'), 'applyFlowPage');
  });
});

test('Workday (real markup): the button dropdown is discovered as a combobox', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, () => {
    const rows = d.describeFields(d.findForm());
    const country = rows.find(r => /country/i.test(r.label));
    ok(country, `no Country field among: ${rows.map(r => r.label).join(' | ')}`);
    eq(country.kind, 'combobox');
    notOk(country.filled, '"Select One" is a placeholder, not an answer');
    eq(country.label.replace(/\*/g, '').trim(), 'Country',
       'the label must not include the button value or "Required"');
    ok(country.required);
  });
});

test('Workday (real markup): a button already showing a value reads as filled', async () => {
  await withForm(fixtures.WORKDAY_MYINFO.replace('>Select One</button>', '>India</button>'), {},
    () => {
      const rows = d.describeFields(d.findForm());
      const country = rows.find(r => /country/i.test(r.label));
      ok(country.filled);
      eq(country.value, 'India');
    });
});

test('Workday (real markup): the multiselect prompt is a combobox, not a text box', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, () => {
    const rows = d.describeFields(d.findForm());
    const source = rows.find(r => /hear about/i.test(r.label));
    ok(source, 'How Did You Hear About Us? must be discovered');
    eq(source.kind, 'combobox',
       'typing into this box is not an answer, so it must not be treated as text');
  });
});

test('Workday (real markup): the three date spinbuttons are one field', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, () => {
    const rows = d.describeFields(d.findForm());
    const dates = rows.filter(r => /start date|month|day|year/i.test(r.label));
    eq(dates.length, 1, `got ${dates.map(r => r.label).join(' | ')}`);
    eq(dates[0].kind, 'date-parts');
    eq(dates[0].label.trim(), 'Available Start Date');
    eq(dates[0].members.length, 3);
  });
});

test('Workday (real markup): the Save and Continue button is never a field', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, () => {
    const rows = d.describeFields(d.findForm());
    notOk(rows.some(r => /save and continue/i.test(r.label)));
  });
});

test('Workday (real markup): names, city and email fill and verify', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, async (env) => {
    fixtures.wireWorkday(env.document);
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '#input-5'), 'Ada');
    eq(valueOf(env, '#input-6'), 'Lovelace');
    eq(valueOf(env, '#input-8'), 'Kolkata');
    eq(valueOf(env, '#input-9'), 'ada@example.com');
  });
});

test('Workday (real markup): the Country button dropdown is committed and verified', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, async (env) => {
    fixtures.wireWorkday(env.document);
    const result = await run_.runAutofill(CTX, null);
    const button = env.document.querySelector('[data-automation-id=countryDropdown]');
    eq(button.textContent.trim(), 'India');
    const row = byLabel(result.decisions, 'country');
    eq(row.outcome, 'ok', `${row.action} / ${row.reason}`);
    eq(env.document.getElementById('wd-portal').innerHTML, '',
       'the listbox must be closed afterwards');
  });
});

test('Workday (real markup): How Did You Hear commits a selectedItem, not typed text', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, async (env) => {
    fixtures.wireWorkday(env.document);
    const result = await run_.runAutofill(CTX, null);
    const items = [...env.document.querySelectorAll('[data-automation-id=selectedItem]')]
      .map(n => n.textContent.trim());
    eq(items.join(','), 'Company Website');
    const row = byLabel(result.decisions, 'hear about');
    eq(row.outcome, 'ok', `${row.action} / ${row.reason}`);
  });
});

test('Workday (real markup): typing that never commits is NOT reported as filled', async () => {
  // The false success this layer exists to prevent: the text sits in the
  // search box, the input reads back "non-empty", and nothing was selected.
  await withForm(fixtures.WORKDAY_MYINFO, {}, async (env) => {
    // No wireWorkday(): the widget shows no options and never commits.
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'hear about');
    notOk(row.outcome === 'ok', 'an uncommitted multiselect must not be a success');
    eq(env.document.querySelectorAll('[data-automation-id=selectedItem]').length, 0);
  });
});

test('Workday (real markup): the date parts are written', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, async (env) => {
    fixtures.wireWorkday(env.document);
    await run_.runAutofill(CTX, null);
    // available_start_date is "01/09/2026" in the bank.
    eq(valueOf(env, '[data-automation-id=dateSectionMonth-input]'), '01');
    eq(valueOf(env, '[data-automation-id=dateSectionDay-input]'), '09');
    eq(valueOf(env, '[data-automation-id=dateSectionYear-input]'), '2026');
  });
});

test('Workday (real markup): the Citi-employment question is asked, never guessed', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, async (env) => {
    fixtures.wireWorkday(env.document);
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'employed by citi');
    ok(row, 'the radio group must be found, labelled by its legend');
    eq(row.action, p.ASK);
    notOk(env.document.querySelector('#radio-yes').checked);
    notOk(env.document.querySelector('#radio-no').checked);
  });
});

test('both real failing Workday URLs are recognised as application pages', () => {
  ok(d.looksLikeApplyUrl('https://citi.wd5.myworkdayjobs.com/en-US/2/job/Pune-Maharashtra-India/'
    + 'Machine-Learning-with-Gen-AI_26991325/apply/applyManually'));
  ok(d.looksLikeApplyUrl('https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/'
    + 'job/Kolkata/Business-Analyst-Data-Modelling-Associate----Kolkata-Y-14---Technology-'
    + 'Consulting_315280WD/apply/applyManually?source=LinkedIn'));
  eq(d.detectAts('https://pwc.wd3.myworkdayjobs.com/en-US/x/job/y/apply/applyManually'), 'workday');
});

test('diagnose() reports a found Workday form and its fields', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, () => {
    const report = d.diagnose();
    ok(report.summary.formFound);
    ok(/applyFlowPage/.test(report.summary.root), report.summary.root);
    ok(report.fields.some(f => /country/i.test(f.label) && f.kind === 'combobox'));
  });
});

test('diagnose() explains why decoys were rejected', async () => {
  await withForm(fixtures.DECOYS, {}, () => {
    const report = d.diagnose();
    notOk(report.summary.formFound);
    const reasons = report.roots.map(r => r.rejected).join(' | ');
    ok(/search/.test(reasons), reasons);
    ok(/password/.test(reasons), reasons);
  });
});

test('diagnose() lists interactive controls nothing handles', async () => {
  await withForm(`<div data-automation-id="applyFlowPage">
      <input name="a"><input name="b" type="email">
      <div role="switch" aria-checked="false" data-automation-id="optInSwitch">Opt in</div>
    </div>`, {}, () => {
    const report = d.diagnose();
    ok(report.uncovered.some(u => u.role === 'switch'),
       JSON.stringify(report.uncovered));
  });
});

// ── Workday Legal Name section (the reported middle-name bug) ─

const LEGAL_NAME = `
<div data-automation-id="applyFlowPage">
  <div data-automation-id="formField-legalNameSection_firstName">
    <label for="n1">First Name<abbr>*</abbr></label>
    <input id="n1" data-automation-id="legalNameSection_firstName" type="text" aria-required="true"></div>
  <div data-automation-id="formField-legalNameSection_middleName">
    <label for="n2">Middle Name</label>
    <input id="n2" data-automation-id="legalNameSection_middleName" type="text"></div>
  <div data-automation-id="formField-legalNameSection_lastName">
    <label for="n3">Family Name<abbr>*</abbr></label>
    <input id="n3" data-automation-id="legalNameSection_lastName" type="text" aria-required="true"></div>
  <div data-automation-id="formField-email">
    <label for="n4">Email Address<abbr>*</abbr></label>
    <input id="n4" type="email"></div>
</div>`;

test('Legal Name: no middle name means the Middle Name box stays EMPTY', async () => {
  await withForm(LEGAL_NAME, {
    // The stub model would happily return the full name if it were ever asked.
    serverAnswers: { 'Middle Name': 'Ada Lovelace' },
  }, async (env, sent) => {
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, BANK, { full_name: 'Ada Lovelace' }),
    });
    await run_.runAutofill(ctx, null);
    eq(valueOf(env, '#n1'), 'Ada');
    eq(valueOf(env, '#n2'), '', 'the middle name box must not get the full name');
    eq(valueOf(env, '#n3'), 'Lovelace');
    const plan = sent.find(msg => msg.type === 'AF_PLAN');
    const middle = plan && plan.payload.fields.find(f => /middle/i.test(f.label));
    ok(!middle || middle.recallOnly, 'if sent at all, only for saved-answer recall');
  });
});

test('Legal Name: a stored middle name goes in the Middle Name box', async () => {
  await withForm(LEGAL_NAME, {}, async (env) => {
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, BANK, { middle_name: 'Augusta' }),
    });
    await run_.runAutofill(ctx, null);
    eq(valueOf(env, '#n2'), 'Augusta');
  });
});

// ── Workday Address section (the reported city bug) ──────────

const ADDRESS = `
<div data-automation-id="applyFlowPage">
  <div data-automation-id="formField-addressSection_addressLine1">
    <label for="a1">Address Line 1<abbr>*</abbr></label><input id="a1" type="text" aria-required="true"></div>
  <div data-automation-id="formField-addressSection_addressLine2">
    <label for="a2">Address Line 2<abbr>*</abbr></label><input id="a2" type="text" aria-required="true"></div>
  <div data-automation-id="formField-addressSection_city">
    <label for="a3">City<abbr>*</abbr></label><input id="a3" type="text" aria-required="true"></div>
  <div data-automation-id="formField-addressSection_postalCode">
    <label for="a4">Postal Code<abbr>*</abbr></label><input id="a4" type="text" aria-required="true"></div>
  <div data-automation-id="formField-addressSection_countryRegion">
    <label for="a5">Region</label>
    <button type="button" aria-haspopup="listbox" id="a5">Select One</button></div>
</div>`;

// What the server now sends for "36/F Sitalatala Lane, Kolkata, 700011".
const ADDRESS_BANK = Object.assign({}, BANK, {
  address: '36/F Sitalatala Lane, Kolkata, 700011',
  address_line1: '36/F Sitalatala Lane',
  address_city: 'Kolkata',
  postal_code: '700011',
});
delete ADDRESS_BANK.address_state;
delete ADDRESS_BANK.address_country;

test('Address: line 1 gets the street, City gets the city', async () => {
  await withForm(ADDRESS, {
    serverAnswers: { 'Region': 'Kolkata', 'Address Line 2*': 'Kolkata' },
  }, async (env) => {
    const result = await run_.runAutofill(Object.assign({}, CTX, { answerBank: ADDRESS_BANK }), null);
    eq(valueOf(env, '#a1'), '36/F Sitalatala Lane');
    eq(valueOf(env, '#a3'), 'Kolkata', 'the city, not the street');
    eq(valueOf(env, '#a4'), '700011');
    eq(valueOf(env, '#a2'), '', 'nothing on file for line 2, and the model must not invent one');
    eq(byLabel(result.decisions, 'line 2').action, p.ASK, 'required, so it is asked');
    eq(env.document.getElementById('a5').textContent, 'Select One',
       'no region on file: left alone rather than tried and failed');
  });
});

// ── Ashby ────────────────────────────────────────────────────

test('Ashby: ARIA-labelled fields resolve and the date is shaped for the input', async () => {
  await withForm(fixtures.ASHBY, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '#a-name'), 'Ada Lovelace');
    eq(valueOf(env, '#a-email'), 'ada@example.com');
    // Stored as "01/09/2026"; an <input type=date> needs ISO.
    eq(valueOf(env, '#a-start'), '2026-01-09');
  });
});

test('Ashby: the education dropdown is matched to one of its real options', async () => {
  await withForm(fixtures.ASHBY, {
    serverAnswers: { 'Highest level of education': "Bachelor's Degree" },
  }, async (env) => {
    await run_.runAutofill(CTX, null);
    eq(valueOf(env, '#a-degree'), 'ba');
  });
});

// ── Generic ──────────────────────────────────────────────────

test('Generic: a plain careers form is filled including education facts', async () => {
  await withForm(fixtures.GENERIC, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '#g-name'), 'Ada Lovelace');
    eq(valueOf(env, '#g-email'), 'ada@example.com');
    eq(valueOf(env, '#g-uni'), 'Indian Institute of Technology Delhi');
    eq(valueOf(env, '#g-major'), 'Computer Science and Engineering');
    eq(valueOf(env, '#g-gpa'), '8.7/10');
  });
});

test('Generic: a YYYY-placeholder graduation field gets a year-shaped value', async () => {
  await withForm(fixtures.GENERIC, {}, async (env) => {
    await run_.runAutofill(CTX, null);
    const v = valueOf(env, '#g-grad');
    ok(/2024/.test(v), `expected the graduation year, got ${JSON.stringify(v)}`);
  });
});

test('Generic: the privacy-policy checkbox is accepted', async () => {
  await withForm(fixtures.GENERIC, {
    serverAnswers: { 'I accept the privacy policy': 'yes' },
  }, async (env) => {
    await run_.runAutofill(CTX, null);
    ok(env.document.querySelector('[name=terms]').checked);
  });
});

// ── drop-only uploaders ──────────────────────────────────────

const DROP_ONLY = `
<form id="drop-form">
  <label for="do-name">Full name</label><input id="do-name" name="name" required>
  <label for="do-email">Email</label><input id="do-email" name="email" type="email" required>
  <label for="do-phone">Phone</label><input id="do-phone" name="phone" type="tel">
  <label>Resume/CV *</label>
  <div class="filepond--root" id="do-zone">Drop your resume here</div>
</form>`;

test('a drop-only uploader with no file input is still discovered', async () => {
  await withForm(DROP_ONLY, {}, () => {
    const rows = d.describeFields(d.findForm());
    const zone = rows.find(r => r.dropOnly);
    ok(zone, `not found among: ${rows.map(r => r.key).join(', ')}`);
    eq(zone.kind, 'file');
    eq(zone.documentSlot, 'resume');
    ok(zone.required, 'the asterisk in the label marks it required');
  });
});

test('a drop-only uploader receives a real drop event', async () => {
  await withForm(DROP_ONLY, {}, async (env) => {
    let dropped = null;
    env.document.getElementById('do-zone').addEventListener('drop', (e) => {
      dropped = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    });
    await run_.runAutofill(CTX, null);
    ok(dropped, 'the zone must receive the file');
    eq(dropped.name, 'ada_lovelace.pdf');
  });
});

test('a drop-only attach is reported as needing the user, not as done', async () => {
  await withForm(DROP_ONLY, {}, async (env) => {
    void env;
    const result = await run_.runAutofill(CTX, null);
    const row = result.decisions.find(x => x.row && x.row.dropOnly);
    ok(row, 'the zone must appear in the results');
    eq(row.action, p.ASK,
       'there is no way to read a drop zone back, so it cannot be claimed as done');
    ok(/yourself/.test(row.reason), row.reason);
  });
});

test('a nested drop zone does not become two fields', async () => {
  await withForm(`
    <form id="f">
      <input name="a"><input name="b" type="email"><input name="c" type="tel">
      <div class="uppy-Dashboard"><div class="uppy-DragDrop">Drop here</div></div>
    </form>`, {}, () => {
    const rows = d.describeFields(d.findForm());
    eq(rows.filter(r => r.dropOnly).length, 1, 'only the innermost zone counts');
  });
});

test('a drop zone that DOES have a file input is not double-counted', async () => {
  await withForm(`
    <form id="f">
      <input name="a"><input name="b" type="email">
      <div class="dropzone"><label for="r">Resume</label>
        <input id="r" type="file" name="resume"></div>
    </form>`, {}, () => {
    const rows = d.describeFields(d.findForm());
    eq(rows.filter(r => r.dropOnly).length, 0, 'the input is the field');
    eq(rows.filter(r => r.kind === 'file').length, 1);
  });
});

// ── behaviour across the whole pipeline ──────────────────────

test('one plan request per form, at most', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    void env;
    await run_.runAutofill(CTX, null);
    const planCalls = sent.filter(m => m.type === 'AF_PLAN');
    ok(planCalls.length <= 1, `${planCalls.length} plan requests for one form`);
  });
});

test('a form of only known fields needs no plan request at all', async () => {
  await withForm(fixtures.LEVER, {}, async (env, sent) => {
    void env;
    await run_.runAutofill(CTX, null);
    const planCalls = sent.filter(m => m.type === 'AF_PLAN');
    eq(planCalls.length, 0, 'Lever asks nothing we do not already know');
  });
});

test('a field the user already filled is never overwritten', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const el = env.document.querySelector('#first_name');
    el.value = 'Augusta';            // as if they had typed it
    await run_.runAutofill(CTX, null);
    eq(el.value, 'Augusta', 'their value stands');
  });
});

test('a field the user edits mid-run is excluded from later passes', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const form = d.findForm();
    run_.watchUserEdits(form, null);
    const el = env.document.querySelector('#q_linkedin');
    el.value = 'https://linkedin.com/in/someone-else';
    el.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    const result = await run_.runAutofill(CTX, null);
    eq(el.value, 'https://linkedin.com/in/someone-else');
    const row = byLabel(result.decisions, 'linkedin');
    eq(row.action, p.SKIP);
    ok(/you edited/.test(row.reason), row.reason);
  });
});

test('a failed plan request still fills everything the profile answered', async () => {
  await withForm(fixtures.GREENHOUSE, { serverError: 'server exploded' },
    async (env) => {
      const result = await run_.runAutofill(CTX, null);
      notOk(result.error, 'a plan failure is not a run failure');
      eq(valueOf(env, '#first_name'), 'Ada', 'the deterministic tier is unaffected');
      eq(valueOf(env, '#email'), 'ada@example.com');
    });
});

test('quota exhaustion still fills the deterministic fields', async () => {
  await withForm(fixtures.GREENHOUSE,
    { serverError: 'out of autofills', serverCode: 'upgrade_required' },
    async (env) => {
      await run_.runAutofill(CTX, null);
      eq(valueOf(env, '#first_name'), 'Ada');
    });
});

test('a missing resume file is reported honestly', async () => {
  await withForm(fixtures.GREENHOUSE, { noResumeBytes: true }, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'resume');
    eq(row.action, p.ASK);
    eq(env.document.querySelector('#resume').files.length, 0);
  });
});

test('every filled field verifies against the page afterwards', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    void env;
    const result = await run_.runAutofill(CTX, null);
    const claimed = result.decisions.filter(x => x.action === p.FILL || x.action === p.SUGGEST);
    ok(claimed.length >= 5, `only ${claimed.length} fields claimed as filled`);
    const unverified = claimed.filter(x => x.outcome !== 'ok');
    eq(unverified.length, 0,
       `claimed but not verified: ${unverified.map(x => `${x.label}=${x.outcome}`).join(', ')}`);
  });
});

test('the counts add up to the number of fields found', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    void env;
    const result = await run_.runAutofill(CTX, null);
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    eq(total, result.decisions.length, 'every field must land in exactly one group');
  });
});

test('answering from the panel writes the value and records it', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'salary');
    eq(row.action, p.PROFILE);
    const res = await run_.answerField(row, '2500000', false);
    ok(res.ok, JSON.stringify(res));
    eq(valueOf(env, '#q_salary'), '2500000');
    eq(row.action, p.FILL);
    eq(row.source, 'you');
  });
});

test('a sensitive answer typed into the panel is not sent to the answer store', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    void env;
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'salary');
    // remember=true, but salary is sensitive — the request must not be made.
    await run_.answerField(row, '2500000', true);
    notOk(sent.some(m => m.type === 'AF_SAVE_ANSWERS'),
          'a salary figure must not be stored as a reusable answer');
  });
});

test('an ordinary answer typed into the panel IS offered to the store', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    void env;
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'developer platform');
    ok(row, 'the product question should need an answer');
    await run_.answerField(row, 'Yes', true);
    const save = sent.find(m => m.type === 'AF_SAVE_ANSWERS');
    ok(save, 'this one is worth remembering');
    eq(save.payload.answers[0].answer, 'Yes');
  });
});

test('learnable answers exclude the sensitive and the secret', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    const form = d.findForm();
    run_.watchUserEdits(form, null);
    // The user answers three things by hand: one ordinary, one sensitive, one secret.
    const fill = (selector, value) => {
      const el = env.document.querySelector(selector);
      el.value = value;
      el.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    };
    fill('#q_salary', '2500000');
    fill('#q_linkedin', 'https://linkedin.com/in/ada2');
    const learnable = run_.learnableAnswers(result.decisions);
    const questions = learnable.map(l => l.question.toLowerCase());
    notOk(questions.some(q => /salary/.test(q)), 'salary must never be learned');
    ok(questions.some(q => /linkedin/.test(q)), 'an ordinary correction is learnable');
  });
});

await run('integration');
