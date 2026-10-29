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

import { test, run, ok, notOk, eq, deepEq } from './harness.mjs';
import { mount, polyfillFileApis } from './dom.mjs';
import * as fixtures from './fixtures.mjs';
import * as d from '../src/autofill/discover.js';
import * as p from '../src/autofill/plan.js';
import * as run_ from '../src/autofill/run.js';
import * as tiles from '../src/autofill/tiles.js';
import * as ui from '../src/autofill/ui.js';
import { setTiming } from '../src/autofill/timing.js';

// The production waits exist to let a framework re-render before a field is read
// back, and to let a portal-rendered menu appear. In jsdom both happen on the
// next microtask, so paying the real waits here would put this suite at several
// minutes — long enough that it stops being run on every change, which is the
// thing worth avoiding. The waits themselves are exercised by write.test.mjs
// against real React.
setTiming({ settleMs: 0, optionWaitMs: 20, revealWatchMs: 10, revealQuietMs: 30, revealMaxMs: 400,
            commitWaitMs: 150, uploadConfirmMs: 400, resumeParseMaxMs: 2000, resumeParseStartMs: 20,
            tileOpenMs: 500, tileSaveMs: 500 });

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
        // A slow /plan, like a real one waiting on its model calls.
        if (msg.type === 'AF_PLAN' && options.planDelayMs) {
          setTimeout(() => cb(handleMessage(msg, options)), options.planDelayMs);
          return;
        }
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
      // The forced pass (auto-apply's required leftovers, a block's list the
      // rules could not answer): options.forceAnswer(field) -> value or null.
      if (msg.payload.force && options.forceAnswer) {
        for (const field of msg.payload.fields || []) {
          const value = options.forceAnswer(field);
          if (value) answers[String(field.i)] = { value, source: 'ai_forced', confidence: 0.6 };
        }
        return { data: { answers, ask: [], sensitiveSkipped: [], neverFill: [] } };
      }
      for (const field of msg.payload.fields || []) {
        // A motivation question the server writes for this job (_compose_answers).
        if (field.compose && options.composeAnswer) {
          answers[String(field.i)] = { value: options.composeAnswer, source: 'ai_written', confidence: 0.55 };
          continue;
        }
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

// ── waiting for the page to settle ───────────────────────────

// Our sidebar lives in the page's <body> and its progress ring redraws every
// 150 ms. Counted as the page changing, it kept every wait running to its cap.
const SIDEBAR = '<div id="tailorcv-sidebar"><span id="pct">0%</span></div>'
              + '<div id="page-area"></div>';

function churn(env, selector) {
  const node = env.document.querySelector(selector);
  let n = 0;
  return setInterval(() => {
    n++;
    node.textContent = `${n}%`;
    node.setAttribute('style', `opacity:${n % 2}`);
  }, 5);
}

test('waitForQuiet: our own sidebar redrawing does not keep the page "busy"', async () => {
  await withForm(fixtures.GREENHOUSE + SIDEBAR, {}, async (env) => {
    const timer = churn(env, '#pct');
    try {
      const res = await run_.waitForQuiet(env.document.body);
      notOk(res.capped, `waited ${res.ms} ms — the sidebar's churn was counted as the page changing`);
    } finally { clearInterval(timer); }
  });
});

test('waitForQuiet: the page itself changing still holds the wait open', async () => {
  await withForm(fixtures.GREENHOUSE + SIDEBAR, {}, async (env) => {
    const timer = churn(env, '#page-area');
    try {
      const res = await run_.waitForQuiet(env.document.body);
      ok(res.capped, 'a page still loading fields must be waited for (Oracle\'s address block)');
    } finally { clearInterval(timer); }
  });
});

test('a run reports where its time went', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async () => {
    const result = await run_.runAutofill(CTX, null);
    const t = result.timing;
    ok(t, 'the result must carry timing');
    ok(t.totalMs >= 0, 'a total');
    ok('scan' in t.phases && 'local_writes' in t.phases, `phases: ${JSON.stringify(t.phases)}`);
    ok(Array.isArray(t.slowFields) && t.slowFields.length > 0, 'the slowest fields');
    ok(t.quietWaits.length >= 1, 'every run waits at least once for revealed fields');
  });
});

// ── one label, several meanings, end to end ──────────────────

test('dropdowns: the option list decides what the label meant', async () => {
  await withForm(fixtures.DROPDOWN_MEANINGS, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '#d_country'), 'India', 'a list of country names');
    eq(valueOf(env, '#d_dial'), '+91', 'the same answer as a dial code');
    eq(valueOf(env, '#d_loc'), 'Kolkata, West Bengal, India', 'a list of full locations');
    eq(valueOf(env, '#d_state'), 'West Bengal', 'a list of states');
    // Four different meanings behind two labels, one pass, no extra opens.
  });
});

test('dropdowns: a closed office list takes the catch-all and says so', async () => {
  await withForm(fixtures.DROPDOWN_MEANINGS, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    eq(valueOf(env, '#d_office'), 'Other',
       'Kolkata is not on the list, so the catch-all rather than a wrong office');
    const row = result.decisions.find(x => x.row && x.row.el
      && x.row.el.id === 'd_office');
    ok(row, 'the office field must be reported');
    eq(row.action, p.SUGGEST, 'flagged for review, not filled silently');
  });
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

// Today's Greenhouse (the Remix rewrite), which failed in the field while the
// suite above stayed green: the country picker's <input type="search"> vetoed
// the <form>, discovery dropped to the custom-questions section alone, and the
// whole identity block — name, email, phone, country, resume — was missing from
// the panel entirely. Everything asserted here was silently absent, not wrong.
test('Greenhouse (current markup): the identity block is filled, not skipped', async () => {
  await withForm(fixtures.GREENHOUSE_REMIX, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    notOk(result.error, result.error);
    eq(valueOf(env, '#first_name'), 'Ada');
    eq(valueOf(env, '#last_name'), 'Lovelace');
    eq(valueOf(env, '#email'), 'ada@example.com');
    // National, not E.164: intl-tel-input's own dial-code picker sits beside
    // the box inside div.iti, so pasting "+91…" here would double the country
    // code. Verified against the live page, which resolves the picker at
    // depth 0 via .iti__country-container.
    eq(valueOf(env, '#phone'), '9876543210');
    // The custom questions kept working throughout; assert they still do.
    // (Website stays empty: this profile has no website, which is the correct
    // "not in your profile" outcome rather than an invented one.)
    eq(valueOf(env, '#question_3'), 'https://linkedin.com/in/adalovelace');
  });
});

test('Greenhouse (current markup): the resume reaches the upload behind "Attach"', async () => {
  await withForm(fixtures.GREENHOUSE_REMIX, {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);
    const input = env.document.querySelector('#resume');
    eq(input.files.length, 1, 'no file was attached');
    const row = result.decisions.find(x => x.row && x.row.el === input);
    ok(row, 'the resume must appear in the results');
    eq(row.slot, 'resume', `"Attach" must not be the field's name (got ${row.label})`);
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

test('Greenhouse: a motivation question is written for the job and flagged for review', async () => {
  const written = 'y'.repeat(300);
  await withForm(fixtures.GREENHOUSE, { composeAnswer: written }, async (env, sent) => {
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, BANK, { why_do_you_want_this_role: 'I want to build.' }),
    });
    const result = await run_.runAutofill(ctx, null);
    const row = byLabel(result.decisions, 'why do you want');
    eq(row.action, p.SUGGEST, 'the user must read it before submitting');
    eq(valueOf(env, '#q_why'), written, 'the written answer, not the stored sentence');
    const plan = sent.find(m => m.type === 'AF_PLAN');
    ok(plan && plan.payload.fields.some(f => f.compose), 'sent to the server to be written');
  });
});

test('profile answers are in the form while the server is still writing', async () => {
  await withForm(fixtures.GREENHOUSE, { composeAnswer: 'Written for this job.', planDelayMs: 1500 },
                 async (env) => {
    const running = run_.runAutofill(CTX, null);
    // The resume upload goes first (so an ATS's resume import cannot overwrite
    // answers), then the profile answers. What matters is the order: the
    // profile answers are in before the server's reply, not after it.
    const t0 = Date.now();
    while (!valueOf(env, '#first_name') && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10));
    eq(valueOf(env, '#first_name'), 'Ada', 'wave 1 must not wait for the server');
    eq(valueOf(env, '#q_why'), '', 'the server has not answered yet');
    const result = await running;
    eq(valueOf(env, '#q_why'), 'Written for this job.', 'wave 2 writes it when it arrives');
    eq(byLabel(result.decisions, 'why do you want').action, p.SUGGEST);
  });
});

test('a field the user fills while the server is thinking is never overwritten', async () => {
  await withForm(fixtures.GREENHOUSE, { composeAnswer: 'Written for this job.', planDelayMs: 400 },
                 async (env) => {
    const running = run_.runAutofill(CTX, null);
    await new Promise(r => setTimeout(r, 200));
    env.document.querySelector('#q_why').value = 'My own words.';
    const result = await running;
    eq(valueOf(env, '#q_why'), 'My own words.');
    eq(byLabel(result.decisions, 'why do you want').action, p.SKIP);
  });
});

// ── uploads that already hold a file ─────────────────────────

const resumeFetches = sent => sent.filter(m => m.type === 'AF_GET_RESUME_FILE' && m.doc === 'resume');
const addToBox = (env, inputId, html) =>
  env.document.getElementById(inputId).parentElement.insertAdjacentHTML('beforeend', html);

test('a resume the ATS already took (filename shown) is left alone', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    // What Greenhouse shows after an upload: the input cleared, the name beside it.
    addToBox(env, 'resume', '<span class="filename">Shubham_Sarkar_tailored.pdf</span> <button type="button">Remove</button>');
    const result = await run_.runAutofill(CTX, null);
    eq(byLabel(result.decisions, 'resume').action, p.SKIP);
    eq(resumeFetches(sent).length, 0, 'the base resume must not even be fetched');
  });
});

test('an upload input already holding a file is left alone', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    const input = env.document.getElementById('resume');
    const dt = new env.window.DataTransfer();
    dt.items.add(new env.window.File(['%PDF'], 'mine.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    await run_.runAutofill(CTX, null);
    eq(resumeFetches(sent).length, 0);
    eq(input.files[0].name, 'mine.pdf', 'their file stays');
  });
});

test('upload instructions mentioning .pdf are not mistaken for a file', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    addToBox(env, 'resume', '<small>Upload a .pdf or .docx (max 5MB). Accepted file types: pdf, doc, docx</small>');
    await run_.runAutofill(CTX, null);
    eq(resumeFetches(sent).length, 1, 'still attached');
  });
});

test("the cover letter's filename does not make the resume look uploaded", async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    addToBox(env, 'cover_letter', '<span class="filename">cover_letter.pdf</span>');
    await run_.runAutofill(CTX, null);
    eq(resumeFetches(sent).length, 1, 'the resume box is still empty, so it is attached');
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

test('Lever: "How did you hear" is filled with LinkedIn', async () => {
  await withForm(fixtures.LEVER, {}, async (env) => {
    await run_.runAutofill(CTX, null);
    eq(valueOf(env, '[name="cards[source][field0]"]'), 'LinkedIn');
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

// The Phone section of nvidia.wd5.myworkdayjobs.com, where "Phone Device Type"
// showed up twice (dropdown + text box) and its only "option" was the Country
// Phone Code's committed tag "India (+91)".
const WD_PHONE_SECTION = `
  <div data-automation-id="formField-countryPhoneCode">
    <label for="input-12">Country Phone Code<abbr title="required">*</abbr></label>
    <div data-automation-id="multiSelectContainer">
      <ul data-automation-id="selectedItemList">
        <li><div data-automation-id="selectedItem"><div data-automation-id="promptOption">India (+91)</div></div></li>
      </ul>
      <div data-automation-id="multiselectInputContainer">
        <input data-automation-id="searchBox" id="input-12" type="text" placeholder="Search">
      </div>
    </div>
  </div>
  <div data-automation-id="formField-phoneType">
    <label for="input-13">Phone Device Type<abbr title="required">*</abbr></label>
    <div>
      <button type="button" aria-haspopup="listbox" id="input-13"
              aria-label="Phone Device Type Select One Required">Select One</button>
      <input type="text" tabindex="-1" class="css-77hcv" value="">
    </div>
  </div>`;

function wirePhoneType(doc) {
  const portal = doc.getElementById('wd-portal');
  const button = doc.getElementById('input-13');
  button.addEventListener('mousedown', () => {
    portal.innerHTML = '<ul role="listbox">' + ['Home', 'Home Cellular'].map(o =>
      `<li role="option" data-automation-id="promptOption">${o}</li>`).join('') + '</ul>';
    for (const li of portal.querySelectorAll('[role=option]')) {
      li.addEventListener('mousedown', () => { button.textContent = li.textContent; portal.innerHTML = ''; });
    }
  });
}

test('Workday: a dropdown is one field, and another widget\'s chosen tag is not its option', async () => {
  const html = fixtures.WORKDAY_MYINFO.replace(
    '<div data-automation-id="formField-email">', WD_PHONE_SECTION + '\n    <div data-automation-id="formField-email">');
  await withForm(html, {}, async (env, sent) => {
    fixtures.wireWorkday(env.document);
    wirePhoneType(env.document);
    const result = await run_.runAutofill(CTX, null);
    const rows = result.decisions.filter(x => /phone device type/i.test(x.label || ''));
    eq(rows.length, 1, `one row, not a dropdown plus a text box (got ${rows.map(r => r.kind).join(', ')})`);
    eq(rows[0].kind, 'combobox');
    const plan = sent.find(m => m.type === 'AF_PLAN');
    const asked = plan && plan.payload.fields.filter(x => /phone device type/i.test(x.label));
    eq(asked.length, 1, 'asked about once');
    deepEq(asked[0].options, ['Home', 'Home Cellular'], 'its own options, not "India (+91)"');
  });
});

// Workday's "My Experience" upload (ghr.wd1.myworkdayjobs.com): the document is
// named only by the section heading; the box says "Upload a file (5MB max)" and
// the button "Select files". After a file is chosen Workday uploads it, clears
// the input, and lists the filename a moment later.
const WD_UPLOAD_SECTION = `
  <div data-automation-id="resumeSection">
    <h3>Resume/CV</h3>
    <div data-automation-id="formField-resume">
      <label>Upload a file (5MB max)<abbr title="required">*</abbr></label>
      <div data-automation-id="file-upload-drop-zone">
        <p>Drop files here</p>
        <p>or <button type="button" data-automation-id="select-files">Select files</button></p>
        <input type="file" data-automation-id="file-upload-input-ref" style="display:none">
      </div>
      <div data-automation-id="file-upload-list"></div>
    </div>
  </div>`;

function wireWorkdayUpload(doc) {
  const input = doc.querySelector('[data-automation-id="file-upload-input-ref"]');
  input.addEventListener('change', () => {
    const name = input.files && input.files[0] ? input.files[0].name : '';
    if (!name) return;
    setTimeout(() => {
      input.value = '';   // Workday keeps no FileList once it has the file
      doc.querySelector('[data-automation-id="file-upload-list"]').innerHTML =
        `<div data-automation-id="file-upload-item"><span>${name}</span><button type="button">Delete</button></div>`;
    }, 120);
  });
}

test('Workday: the Resume/CV upload is named by its section heading and attached', async () => {
  const html = fixtures.WORKDAY_MYINFO.replace(
    '<div data-automation-id="formField-email">', WD_UPLOAD_SECTION + '\n    <div data-automation-id="formField-email">');
  await withForm(html, {}, async (env, sent) => {
    fixtures.wireWorkday(env.document);
    wireWorkdayUpload(env.document);
    const result = await run_.runAutofill(Object.assign({}, CTX, { hasResume: true }), null);
    const row = result.decisions.find(x => x.slot === 'resume');
    ok(row, 'the upload is recognised as the resume slot');
    eq(row && row.label, 'Resume/CV');
    ok(sent.some(m => m.type === 'AF_GET_RESUME_FILE' && m.doc === 'resume'), 'the resume is fetched');
    eq(row && row.outcome, 'ok', 'the listed filename counts as attached, though the input was cleared');
  });
});

test('an unheaded upload after "Resume/CV" does not inherit it', async () => {
  const html = fixtures.WORKDAY_MYINFO.replace(
    '<div data-automation-id="formField-email">',
    WD_UPLOAD_SECTION +
    `<div data-automation-id="formField-other"><label>Upload a file</label>
       <input type="file" id="second-upload"></div>` +
    '\n    <div data-automation-id="formField-email">');
  await withForm(html, {}, async (env) => {
    const rows = d.describeFields(d.findForm());
    const second = rows.find(r => r.el && r.el.id === 'second-upload');
    ok(second, 'the second upload is found');
    notOk(second.documentSlot === 'resume', `got slot ${second.documentSlot}, label "${second.label}"`);
  });
});

// Workday "Application Questions" (Bank of America, ghr.wd1.myworkdayjobs.com):
// the question is rich text, the button carries only name="<hash>" and
// aria-label "Select One Required". The sidebar showed the hash as the
// question, and the model — unable to read it — answered at random.
const WD_QUESTIONS = `
  <div data-automation-id="primaryQuestionnairePage">
    <div data-fkit-id="primaryQuestionnaire--28bff8b9ac631003ae3f11b9c7ba0000">
      <div class="rich-text"><p>Do you reside in one of the five boroughs of New York City (including the Bronx, Brooklyn, Manhattan, Queens, or Staten Island)?</p><abbr>*</abbr></div>
      <div><button type="button" aria-haspopup="listbox" name="28bff8b9ac631003ae3f11b9c7ba0000"
              id="primaryQuestionnaire--28bff8b9ac631003ae3f11b9c7ba0000"
              aria-label="Select One Required">Select One</button>
        <input type="text" tabindex="-1" value=""></div>
    </div>
    <fieldset data-fkit-id="primaryQuestionnaire--28bff8b9ac631003ae3f125398df0003">
      <legend><div class="rich-text"><p>Bank of America has a longstanding commitment to hiring and supporting veterans and military spouses/domestic partners.</p>
        <p>Have you ever served or are you currently serving in the United States military (this includes the National Guard and Reserves)?</p></div><abbr>*</abbr></legend>
      <div><button type="button" aria-haspopup="listbox" name="28bff8b9ac631003ae3f125398df0003"
              aria-label="Select One Required">Select One</button>
        <input type="text" tabindex="-1" value=""></div>
    </fieldset>
    <div data-fkit-id="primaryQuestionnaire--28bff8b9ac631003ae3f125398df0006">
      <div><button type="button" aria-haspopup="listbox" name="28bff8b9ac631003ae3f125398df0006"
              aria-label="Select One Required">Select One</button></div>
    </div>
  </div>`;

test('Workday questionnaire: questions are read from their text, never the hash', async () => {
  const html = fixtures.WORKDAY_MYINFO.replace(
    '<div data-automation-id="formField-email">', WD_QUESTIONS + '\n    <div data-automation-id="formField-email">');
  await withForm(html, {}, async (env, sent) => {
    const rows = d.describeFields(d.findForm());
    const byName = n => rows.find(r => r.el && r.el.getAttribute('name') === n);
    const nyc = byName('28bff8b9ac631003ae3f11b9c7ba0000');
    const mil = byName('28bff8b9ac631003ae3f125398df0003');
    ok(/reside in one of the five boroughs/.test(nyc.label), `NYC label: "${nyc.label}"`);
    notOk(/military/i.test(nyc.label), 'no text borrowed from the next question');
    ok(/served or are you currently serving in the United States military/.test(mil.label), `military label: "${mil.label}"`);

    await run_.runAutofill(CTX, null);
    const plan = sent.find(m => m.type === 'AF_PLAN');
    const labels = plan ? plan.payload.fields.map(f => f.label) : [];
    notOk(labels.some(l => /^[0-9a-f]{20,}/i.test(l)), `a hash reached the model: ${labels.join(' | ')}`);
  });
});

test('a question that cannot be read at all is left for the person, never sent to the model', async () => {
  const html = fixtures.WORKDAY_MYINFO.replace(
    '<div data-automation-id="formField-email">', WD_QUESTIONS + '\n    <div data-automation-id="formField-email">');
  await withForm(html, {}, async (env, sent) => {
    const result = await run_.runAutofill(CTX, null);
    const blind = result.decisions.find(x => x.row && x.row.el
      && x.row.el.getAttribute('name') === '28bff8b9ac631003ae3f125398df0006');
    ok(blind, 'the unlabelled dropdown is still listed');
    notOk(blind.value, 'nothing is filled into it');
    const plan = sent.find(m => m.type === 'AF_PLAN');
    notOk(plan && plan.payload.fields.some(f => /125398df0006/.test(f.label)), 'never asked of the model');
  });
});

const WD_ETHNICITY = `
  <div data-automation-id="formField-ethnicityDropdown">
    <label for="input-30">What is your ethnicity?<abbr title="required">*</abbr></label>
    <button type="button" aria-haspopup="listbox" id="input-30"
            aria-label="What is your ethnicity? Select One Required">Select One</button>
  </div>`;
const WD_RACE_OPTIONS = [
  'American Indian or Alaska Native (Not Hispanic or Latino) (United States of America)',
  'Asian (Not Hispanic or Latino) (United States of America)',
  'Black or African American (Not Hispanic or Latino) (United States of America)',
  'Hispanic or Latino (United States of America)',
  'White (Not Hispanic or Latino) (United States of America)',
];
function wireEthnicity(doc) {
  const portal = doc.getElementById('wd-portal');
  const button = doc.getElementById('input-30');
  button.addEventListener('mousedown', () => {
    portal.innerHTML = '<ul role="listbox">' + WD_RACE_OPTIONS.map(o =>
      `<li role="option" data-automation-id="promptOption">${o}</li>`).join('') + '</ul>';
    for (const li of portal.querySelectorAll('[role=option]')) {
      li.addEventListener('mousedown', () => { button.textContent = li.textContent; portal.innerHTML = ''; });
    }
  });
}
const withEthnicity = html => html.replace('<div data-automation-id="formField-email">',
  WD_ETHNICITY + '\n    <div data-automation-id="formField-email">');

test('Workday: a stored "South Asian" fills the Asian option despite the country suffix', async () => {
  await withForm(withEthnicity(fixtures.WORKDAY_MYINFO), {}, async (env) => {
    fixtures.wireWorkday(env.document);
    wireEthnicity(env.document);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK, { race_ethnicity: 'South Asian' }) });
    const result = await run_.runAutofill(ctx, null);
    eq(env.document.getElementById('input-30').textContent.trim(),
       'Asian (Not Hispanic or Latino) (United States of America)');
    eq(byLabel(result.decisions, 'ethnicity').outcome, 'ok');
  });
});

test('a dropdown that could not be filled offers its real options in the sidebar', async () => {
  await withForm(withEthnicity(fixtures.WORKDAY_MYINFO), {}, async (env) => {
    fixtures.wireWorkday(env.document);
    wireEthnicity(env.document);
    // No option fits, so this one comes back to the person.
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK, { race_ethnicity: 'Middle Eastern or North African' }) });
    const result = await run_.runAutofill(ctx, null);
    const row = byLabel(result.decisions, 'ethnicity');
    eq(env.document.getElementById('input-30').textContent.trim(), 'Select One', 'never recorded as Black');
    const offered = (row.options || []).map(o => (typeof o === 'string' ? o : o.label));
    ok(offered.includes('Asian (Not Hispanic or Latino) (United States of America)'),
       `the sidebar gets the page's options, not a text box (got ${offered.length})`);
  });
});

test("Workday: the Terms and Conditions checkbox is ticked when the profile allows it", async () => {
  const html = fixtures.WORKDAY_MYINFO.replace('<div data-automation-id="formField-email">', `
    <div data-automation-id="formField-acceptTermsAndAgreements">
      <label for="input-40">By selecting the checkbox, you agree to our Terms and Conditions and Applicant Privacy Policy.<abbr title="required">*</abbr></label>
      <input type="checkbox" id="input-40" aria-required="true">
    </div>
    <div data-automation-id="formField-email">`);
  await withForm(html, {}, async (env) => {
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK,
      { accepts_employer_terms_and_privacy_policy: 'Yes' }) });
    const result = await run_.runAutofill(ctx, null);
    ok(env.document.getElementById('input-40').checked, 'the box is ticked');
    eq(byLabel(result.decisions, 'terms and conditions').outcome, 'ok');
  });
});

// Oracle Candidate Experience (jpmc.fa.oraclecloud.com): the phone "Country
// code" list stays up after a choice, and the address "Country" opens its own.
// Options were read from the whole page, so "India" was clicked in the stale
// "+91 (India)" row of the other list, and Country stayed empty.
const ORACLE_FORM = `
<form id="oracle-apply">
  <label for="fn">First Name *</label><input id="fn" name="firstName">
  <label for="em">Email *</label><input id="em" type="email" name="email">
  <div class="phone-row">
    <label for="cc">Country code</label>
    <div class="oj-select-container">
      <input id="cc" role="combobox" aria-controls="cc-list" aria-expanded="false" aria-autocomplete="list">
      <ul id="cc-list" role="listbox"><li role="option">+246 (British Indian Ocean Territory)</li><li role="option">+91 (India)</li><li role="option">+1 (United States)</li></ul>
    </div>
    <label for="ph">Phone Number *</label><input id="ph" type="tel" name="phone">
  </div>
  <div class="address-row">
    <label for="co">Country *</label>
    <div class="oj-select-container">
      <input id="co" role="combobox" aria-controls="co-list" aria-expanded="false" aria-autocomplete="list">
      <ul id="co-list" role="listbox"></ul>
    </div>
  </div>
  <button type="submit">Next</button>
</form>`;

function wireOracle(doc) {
  const combo = (inputId, listId, options, display, closeOnPick) => {
    const input = doc.getElementById(inputId);
    const list = doc.getElementById(listId);
    const show = () => {
      input.setAttribute('aria-expanded', 'true');
      const q = (input.value || '').toLowerCase().replace(/^\+/, '');
      list.innerHTML = options.filter(o => !q || o.toLowerCase().includes(q))
        .map(o => `<li role="option">${o}</li>`).join('');
      for (const li of list.querySelectorAll('[role=option]')) {
        li.addEventListener('mousedown', () => {
          input.value = display(li.textContent);
          input.setAttribute('aria-expanded', 'false');
          // Oracle keeps the (now closed) listbox element in the wrapper.
          if (closeOnPick) list.innerHTML = '';
        });
      }
    };
    input.addEventListener('mousedown', show);
    input.addEventListener('input', show);
  };
  // Country code: its options are on the page from the start (so the plan
  // picks "+91 (India)"), it closes after one choice, and then shows only "+91".
  combo('cc', 'cc-list', ['+246 (British Indian Ocean Territory)', '+91 (India)', '+1 (United States)'],
        t => t.split(' ')[0], true);
  combo('co', 'co-list', ['India', 'Indonesia', 'Ireland'], t => t, true);
}

test('Oracle: a filled dropdown whose closed listbox stays in the page reads as filled', async () => {
  await withForm(ORACLE_FORM, {}, async (env) => {
    wireOracle(env.document);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK,
      { phone: '+918240044652', address_country: 'India' }) });
    const result = await run_.runAutofill(ctx, null);
    eq(valueOf(env, '#co'), 'India', 'Country is filled');
    eq(valueOf(env, '#cc'), '+91', 'the country code shows its own short form');
    eq(byLabel(result.decisions, 'country code').outcome, 'ok', '"+91" counts as the chosen +91 (India)');
    eq(valueOf(env, '#ph'), '8240044652', 'national number beside the code picker');
  });
});

// Oracle Candidate Experience, page 2: every question is answered with pill
// buttons — no inputs, no dropdowns — and the page was reported as "no
// application form found".
const ORACLE_PILLS = `
<div class="apply-flow-section">
  <h3>Application Questions</h3>
  <p>Please complete the below questions.</p>
  <div class="question">
    <div class="question-label">Are you at least 18 years of age? *</div>
    <div class="cx-select-pills-container">
      <button type="button" class="cx-select-pill-section" aria-pressed="false">Yes</button>
      <button type="button" class="cx-select-pill-section" aria-pressed="false">No</button>
    </div>
  </div>
  <div class="question">
    <div class="question-label">For the position you are applying to, are you legally authorized to work in this country? *</div>
    <div class="cx-select-pills-container">
      <button type="button" class="cx-select-pill-section" aria-pressed="false">Yes</button>
      <button type="button" class="cx-select-pill-section" aria-pressed="false">No</button>
    </div>
  </div>
  <div class="question">
    <div class="question-label">Will you now or in the future require sponsorship for an employment-based visa status? *</div>
    <div class="cx-select-pills-container">
      <button type="button" class="cx-select-pill-section" aria-pressed="false">Yes</button>
      <button type="button" class="cx-select-pill-section" aria-pressed="false">No</button>
    </div>
  </div>
  <div class="apply-flow-pagination">
    <button type="button">BACK</button>
    <button type="button">1</button><button type="button">2</button><button type="button">3</button>
    <button type="button">NEXT</button>
  </div>
</div>`;

function wirePills(doc) {
  for (const group of doc.querySelectorAll('.cx-select-pills-container')) {
    for (const pill of group.querySelectorAll('button')) {
      pill.addEventListener('click', () => {
        for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
        pill.setAttribute('aria-pressed', 'true');
      });
    }
  }
}

test('Oracle: a page of Yes/No pill buttons is an application form, answered from the profile', async () => {
  await withForm(ORACLE_PILLS, {}, async (env) => {
    wirePills(env.document);
    ok(d.findForm(), 'detected as an application form');
    const rows = d.describeFields(d.findForm());
    const choices = rows.filter(r => r.kind === 'choice');
    eq(choices.length, 3, `three questions (got: ${choices.map(r => r.label).join(' | ')})`);
    notOk(rows.some(r => /^(back|next|\d)$/i.test(r.label || '')), 'navigation is never a question');

    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK,
      { authorized_to_work_in_country: 'Yes', requires_visa_sponsorship: 'No' }) });
    const result = await run_.runAutofill(ctx, null);
    const pressed = label => {
      const q = [...env.document.querySelectorAll('.question')]
        .find(x => x.textContent.includes(label));
      const on = q && q.querySelector('button[aria-pressed="true"]');
      return on ? on.textContent.trim() : '';
    };
    eq(pressed('legally authorized'), 'Yes');
    eq(pressed('sponsorship'), 'No');
    eq(pressed('at least 18'), 'Yes', 'every applicant is an adult');
    eq(byLabel(result.decisions, 'at least 18').action, p.FILL, 'filled, not left for review');
    eq(byLabel(result.decisions, 'legally authorized').outcome, 'ok');
  });
});

// The same Oracle page as it really renders: each pill group keeps its
// validation message ("This information is required.") inside the group's box —
// the nearest text to the buttons. It was read as the question for all of them.
const ORACLE_PILLS_WITH_ERRORS = ORACLE_PILLS
  .replace(/<div class="cx-select-pills-container">/g,
    '<div class="cx-select-pills-container"><div class="oj-message-error" aria-live="polite">This information is required.</div>')
  .replace('<div class="apply-flow-pagination">', `
  <div class="question">
    <div class="question-label">Do you hold an Indian Passport? *</div>
    <div class="cx-select-pills-container"><div class="oj-message-error" aria-live="polite">This information is required.</div>
      <button type="button" class="cx-select-pill-section" aria-pressed="false">Yes</button>
      <button type="button" class="cx-select-pill-section" aria-pressed="false">No</button>
    </div>
  </div>
  <div class="apply-flow-pagination">`);

test('Oracle: a validation message beside the buttons is never read as the question', async () => {
  await withForm(ORACLE_PILLS_WITH_ERRORS, {}, async (env, sent) => {
    wirePills(env.document);
    const rows = d.describeFields(d.findForm()).filter(r => r.kind === 'choice');
    notOk(rows.some(r => /information is required/i.test(r.label)),
          `labels: ${rows.map(r => r.label).join(' | ')}`);
    ok(rows.some(r => /at least 18 years of age/.test(r.label)), 'the real questions are read');

    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK,
      { authorized_to_work_in_country: 'Yes', requires_visa_sponsorship: 'No' }) });
    const result = await run_.runAutofill(ctx, null);
    const plan = sent.find(m => m.type === 'AF_PLAN');
    const asked = plan ? plan.payload.fields.map(f => f.label) : [];
    notOk(asked.some(l => /sponsorship|authorized|passport/i.test(l)),
          `sensitive questions reached the model: ${asked.join(' | ')}`);
    eq(byLabel(result.decisions, 'sponsorship').value, 'No', 'sponsorship from the profile');
    eq(byLabel(result.decisions, 'Indian Passport').action, p.ASK, 'a passport question is the person\'s');
    eq(byLabel(result.decisions, 'at least 18').value, 'Yes');
  });
});

// Trimmed from a real JPMC Oracle section 1 capture. On this form the
// "Import your profile" Resume button IS where the resume goes.
const ORACLE_IMPORT_THEN_UPLOAD = `
  <form class="apply-flow__content apply-flow__content-form">
    <div class="apply-flow-profile-import">
      <h2 class="apply-flow-block__title">Import your profile</h2>
      <div class="apply-flow-profile-import-awli__button--file-upload">
        <input type="file" accept=".doc,.docx,.pdf" class="apply-flow-profile-import-awli__file-upload"
               aria-labelledby="resumeParserLabel" aria-label="Import your profile from resume">
        <button class="apply-flow-profile-import-awli__button" type="button" tabindex="-1" aria-hidden="true">Resume</button>
      </div>
    </div>
    <div class="input-row input-row--has-picker">
      <label class="input-row__label" for="title-19"><span class="input-row__linebreak" id="labelText-title-19">Title</span></label>
      <div class="input-row__control-container" data-qa="title"><div>
        <ul role="radiogroup" aria-label="Title" class="cx-select-pills-container">
          <li role="presentation"><button type="button" role="radio" aria-checked="false" class="cx-select-pill-section"><span class="cx-select-pill-name"> Doctor</span></button></li>
          <li role="presentation"><button type="button" role="radio" aria-checked="false" class="cx-select-pill-section"><span class="cx-select-pill-name"> Miss</span></button></li>
          <li role="presentation"><button type="button" role="radio" aria-checked="false" class="cx-select-pill-section"><span class="cx-select-pill-name"> Mr.</span></button></li>
          <li role="presentation"><button type="button" role="radio" aria-checked="false" class="cx-select-pill-section"><span class="cx-select-pill-name"> Mrs.</span></button></li>
          <li role="presentation"><button type="button" role="radio" aria-checked="false" class="cx-select-pill-section"><span class="cx-select-pill-name"> Ms.</span></button></li>
        </ul></div></div>
    </div>
    <label for="firstName-20"><span>First Name</span><span class="input-row__label--required-star" aria-hidden="true"></span></label>
    <input class="input-row__control" id="firstName-20" name="firstName" autocomplete="given-name" aria-required="true">
    <label for="lastName-22"><span>Last Name</span></label>
    <input class="input-row__control" id="lastName-22" name="lastName" autocomplete="family-name" aria-required="true">
  </form>`;

function wireRadioPills(doc) {
  for (const group of doc.querySelectorAll('[role="radiogroup"]')) {
    for (const pill of group.querySelectorAll('[role="radio"]')) {
      pill.addEventListener('click', () => {
        for (const other of group.querySelectorAll('[role="radio"]')) other.setAttribute('aria-checked', 'false');
        pill.setAttribute('aria-checked', 'true');
      });
    }
  }
}

test('Oracle: the resume goes to the Import-your-profile Resume upload', async () => {
  await withForm(ORACLE_IMPORT_THEN_UPLOAD, {}, async (env, sent) => {
    wireRadioPills(env.document);
    const files = d.describeFields(d.findForm()).filter(r => r.kind === 'file');
    eq(files.length, 1);
    eq(files[0].documentSlot, 'resume');
    await run_.runAutofill(CTX, null);
    eq(env.document.querySelector('.apply-flow-profile-import-awli__file-upload').files.length, 1);
    ok(sent.some(m => m.type === 'AF_GET_RESUME_FILE'));
  });
});

test('Oracle: Title (Mr. / Ms. pills) is filled from the profile title', async () => {
  await withForm(ORACLE_IMPORT_THEN_UPLOAD, {}, async (env) => {
    wireRadioPills(env.document);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK, { name_title: 'Mr.' }) });
    await run_.runAutofill(ctx, null);
    const chosen = [...env.document.querySelectorAll('[role="radio"][aria-checked="true"]')].map(b => b.textContent.trim());
    deepEq(chosen, ['Mr.']);
  });
});

// Oracle's resume import, as confirmed on JPMC: the upload disables itself
// while it reads, then fills what it found in the resume and clears what it
// did not (a Title picked before it went blank).
function wireResumeImport(env, { readMs = 150, fills = {} } = {}) {
  const doc = env.document;
  const input = doc.querySelector('.apply-flow-profile-import-awli__file-upload');
  input.addEventListener('change', () => {
    input.disabled = true;
    setTimeout(() => {
      for (const b of doc.querySelectorAll('ul[aria-label="Title"] [role=radio]')) b.setAttribute('aria-checked', 'false');
      for (const [id, v] of Object.entries(fills)) doc.getElementById(id).value = v;
      input.disabled = false;
    }, readMs);
  });
}

test('Oracle: the resume import runs first; what it filled is left alone, only the gaps are filled', async () => {
  await withForm(ORACLE_IMPORT_THEN_UPLOAD, {}, async (env) => {
    wireRadioPills(env.document);
    wireResumeImport(env, { fills: { 'firstName-20': 'FromResume' } });
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK, { name_title: 'Mr.' }) });
    const result = await run_.runAutofill(ctx, null);
    const doc = env.document;

    eq(doc.getElementById('firstName-20').value, 'FromResume', 'what the import filled is untouched');
    ok(byLabel(result.decisions, 'First Name').byForm, 'and listed as filled by the form');
    eq(doc.getElementById('lastName-22').value, BANK.last_name, 'a gap the import left is filled');
    const chosen = [...doc.querySelectorAll('[role="radio"][aria-checked="true"]')].map(b => b.textContent.trim());
    deepEq(chosen, ['Mr.'], 'Title, cleared by the import, is filled after it');
    eq(byLabel(result.decisions, 'Title').action, p.FILL);
  });
});

test('a field the page empties after it was filled is filled again, never left showing ✓', async () => {
  await withForm(ORACLE_IMPORT_THEN_UPLOAD, {}, async (env) => {
    wireRadioPills(env.document);
    // Clears the Title once, a moment after it is picked — as a late re-render would.
    let cleared = false;
    for (const b of env.document.querySelectorAll('[role=radio]')) {
      b.addEventListener('click', () => {
        if (cleared) return;
        cleared = true;
        setTimeout(() => b.setAttribute('aria-checked', 'false'), 20);
      });
    }
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK, { name_title: 'Mr.' }) });
    const result = await run_.runAutofill(ctx, null);
    const chosen = [...env.document.querySelectorAll('[role="radio"][aria-checked="true"]')].map(b => b.textContent.trim());
    deepEq(chosen, ['Mr.']);
    eq(byLabel(result.decisions, 'Title').action, p.FILL);
  });
});

// ── Oracle Education / Experience tiles ───────────────────────
// Trimmed from a real JPMC section 3 capture. Each entry is a tile; Edit opens
// its form inline (Degree is Oracle's grid dropdown; School and End Date were
// filled by Oracle's resume import); Save refuses while Degree is empty, as
// Oracle does ("The Degree field is required.").

const TILES_PAGE = `
  <form class="apply-flow__content apply-flow__content-form">
    <div class="apply-flow-block apply-flow-block--tile-profile-items">
      <div class="apply-flow-block__header"><h2 class="apply-flow-block__title"><span>Education</span></h2></div>
      <div class="apply-flow-block__form-list" role="region" aria-label="Education">
        <div class="standard-apply-flow-profile-item">
          <div class="profile-item-list" role="group"></div>
          <div class="profile-add-item"><button type="button" class="button apply-flow-profile-item-tile__new-tile"><span class="button__label">Add Education</span></button></div>
          <div class="editor-slot"></div>
        </div>
      </div>
    </div>
  </form>`;

const DEGREES = ["Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate', 'High School Diploma'];

function editorHtml(item) {
  return `
    <div class="profile-item-content"><div class="profile-item-content--form"><form-builder>
      <div class="input-row input-row--has-picker">
        <label class="input-row__label input-row__label--required" for="contentItemId-26"><span class="input-row__linebreak">Degree</span><span class="input-row__label--required-star" aria-hidden="true"></span></label>
        <div class="input-row__control-container"><div class="cx-select-container"><div class="input-field-container">
          <div class="input-field-container__left"><input autocomplete="none" name="contentItemId" id="contentItemId-26" type="text" role="combobox"
            aria-autocomplete="list" aria-haspopup="grid" aria-controls="contentItemId-26-listbox" aria-expanded="false"
            aria-invalid="${item.degree ? 'false' : 'true'}" aria-required="true" class="cx-select-input" value="${item.degree}"></div>
          <div id="contentItemId-26-modal"></div>
        </div></div></div>
      </div>
      <div class="input-row input-row--text input-row--filled">
        <label class="input-row__label" for="educationalEstablishment-27"><span class="input-row__linebreak">School</span></label>
        <input autocomplete="none" name="educationalEstablishment" id="educationalEstablishment-27" type="text" role="combobox"
          aria-haspopup="grid" aria-controls="educationalEstablishment-27-listbox" aria-expanded="false" class="cx-select-input" value="${item.school}">
      </div>
      <div class="datepicker-row input-row" aria-label="End Date">
        <label class="input-row__label" for="endDate-28"><span class="input-row__linebreak" id="labelText-endDate-28">End Date</span></label>
        <span id="inputFieldLabel-month-endDate-28" class="input-field__label">Month</span>
        <input autocomplete="none" name="endDate" id="month-endDate-28" type="text" role="combobox" aria-haspopup="grid"
          aria-controls="month-endDate-28-listbox" aria-expanded="false" aria-labelledby="labelText-endDate-28 inputFieldLabel-month-endDate-28" value="${item.end.split('/')[0]}">
        <span id="inputFieldLabel-year-endDate-28" class="input-field__label">Year</span>
        <input autocomplete="none" name="endDate" id="year-endDate-28" type="text" role="combobox" aria-haspopup="grid"
          aria-controls="year-endDate-28-listbox" aria-expanded="false" aria-labelledby="labelText-endDate-28 inputFieldLabel-year-endDate-28" value="${item.end.split('/')[1]}">
      </div>
      <div class="input-row input-row--text">
        <label class="input-row__label" for="areaOfStudy-30"><span class="input-row__linebreak">Area of Study</span></label>
        <input class="input-row__control" id="areaOfStudy-30" name="areaOfStudy" value="${item.area}">
      </div>
    </form-builder></div>
    <div class="profile-item-footer"><div class="app-dialog__buttons-bar">
      <button type="button" class="button app-dialog__footer-button cancel-btn"><span class="button__label">Cancel</span></button>
      <button type="button" class="button app-dialog__footer-button save-btn" data-qa="profileItemInlineSaveButton"><span class="button__label">Save</span></button>
    </div></div></div>`;
}

/** Oracle's tiles over a small model; returns it, plus a log of what was opened. */
function wireTiles(env, items) {
  const doc = env.document;
  const list = doc.querySelector('.profile-item-list');
  const slot = doc.querySelector('.editor-slot');
  const log = { opened: [] };
  const render = () => {
    list.innerHTML = items.map(it => {
      const flagged = !it.degree;
      const title = it.area || 'Unnamed Major';
      const sub = `${it.school ? it.school + ' ' : ''}${it.end}`;
      return `<article class="apply-flow-profile-item-tile${flagged ? ' apply-flow-profile-item-tile--invalid' : ''}">
        <div class="apply-flow-profile-item-tile__summary" role="group" aria-label="${title} ${sub}">
          <div class="apply-flow-profile-item-tile__summary-content">
            <div class="apply-flow-profile-item-tile__summary-title"><span>${title}</span></div>
            <div class="apply-flow-profile-item-tile__summary-subtitle">${sub}</div>
            ${flagged ? '<div class="apply-flow-profile-item-tile__summary-validation"><span>Fields to fix: 1</span></div>' : ''}
          </div>
          <div class="apply-flow-profile-item-tile__actions-container">
            <button class="apply-flow-profile-item-tile__edit-item-icon" title="Edit" aria-label="Edit"></button>
            <button class="apply-flow-profile-item-tile__delete-icon" title="Delete" aria-label="Delete"></button>
          </div>
        </div></article>`;
    }).join('');
    list.querySelectorAll('.apply-flow-profile-item-tile__edit-item-icon').forEach((b, i) =>
      b.addEventListener('click', () => open(i)));
  };
  const open = (i) => {
    log.opened.push(i);
    const item = items[i];
    slot.innerHTML = editorHtml(item);
    const degree = doc.getElementById('contentItemId-26');
    const modal = doc.getElementById('contentItemId-26-modal');
    const draw = (opts) => {
      degree.setAttribute('aria-expanded', 'true');
      modal.innerHTML = `<div role="grid" id="contentItemId-26-listbox" aria-label="Degree">` + opts.map((o, k) =>
        `<div role="row"><div tabindex="-1" role="gridcell" id="contentItemId-26-listitem-${k}" class="cx-select__list-item">`
        + `<span class="cx-select__list-item--content">${o}</span></div></div>`).join('') + '</div>';
      modal.querySelectorAll('[role=gridcell]').forEach(c => c.addEventListener('click', () => {
        degree.value = c.textContent.trim();
        degree.setAttribute('aria-invalid', 'false');
        degree.setAttribute('aria-expanded', 'false');
        modal.innerHTML = '';
      }));
    };
    degree.addEventListener('focus', () => draw(DEGREES));
    degree.addEventListener('input', (e) => {
      if (!e.inputType) return;
      const q = degree.value.toLowerCase();
      draw(DEGREES.filter(d => d.toLowerCase().startsWith(q)));
    });
    slot.querySelector('.save-btn').addEventListener('click', () => {
      if (!degree.value) { degree.setAttribute('aria-invalid', 'true'); return; }   // stays open
      item.degree = degree.value;
      item.area = doc.getElementById('areaOfStudy-30').value;
      item.school = doc.getElementById('educationalEstablishment-27').value;
      slot.innerHTML = '';
      render();
    });
    slot.querySelector('.cancel-btn').addEventListener('click', () => { slot.innerHTML = ''; });
  };
  render();
  return log;
}

const JU_ENTRY = { school: 'Jadavpur University', degree: 'Bachelor of Engineering', field: 'Chemical Engineering', from: '2023', to: '2027' };

test('a page of only Education tiles is an application page (not "no form found")', async () => {
  await withForm(TILES_PAGE, {}, async (env) => {
    wireTiles(env, [{ school: 'Jadavpur University', end: '12/2027', degree: '', area: '' }]);
    const page = d.isApplicationPage();
    ok(page && page.tilesOnly, 'detected');
  });
});

test('Oracle tiles: a flagged entry is opened, filled from the matching profile school, saved', async () => {
  await withForm(TILES_PAGE, {}, async (env) => {
    const items = [{ school: 'Jadavpur University', end: '12/2027', degree: '', area: '' }];
    wireTiles(env, items);
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: [JU_ENTRY] } });
    const result = await run_.runAutofill(ctx, null);
    eq(items[0].degree, "Bachelor's Degree", 'the level Oracle offers, from "Bachelor of Engineering"');
    eq(items[0].area, 'Chemical Engineering', 'the empty Area of Study');
    eq(items[0].school, 'Jadavpur University', 'what Oracle filled is untouched');
    const tile = result.decisions.find(x => x.kind === 'tile');
    eq(tile.action, p.FILL, tile.reason);
    notOk(env.document.querySelector('.apply-flow-profile-item-tile--invalid'), 'no tile flagged any more');
  });
});

test('Oracle tiles: an entry no profile school clearly matches is left for the person, never opened', async () => {
  await withForm(TILES_PAGE, {}, async (env) => {
    const items = [{ school: 'Jadavpur University', end: '12/2027', degree: '', area: '' },
                   { school: '', end: '04/2022', degree: '', area: '' }];
    const log = wireTiles(env, items);
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: [JU_ENTRY] } });
    const result = await run_.runAutofill(ctx, null);
    deepEq(log.opened, [0], 'only the tile we could place was opened');
    eq(items[1].degree, '', 'nothing written into the unplaced one');
    const asked = result.decisions.filter(x => x.kind === 'tile' && x.action === p.ASK);
    eq(asked.length, 1);
    ok(/could not tell which school/.test(asked[0].reason), asked[0].reason);
  });
});

test('Oracle tiles: the second entry is placed by its year when the profile has it', async () => {
  await withForm(TILES_PAGE, {}, async (env) => {
    const items = [{ school: 'Jadavpur University', end: '12/2027', degree: '', area: '' },
                   { school: '', end: '04/2022', degree: '', area: '' }];
    wireTiles(env, items);
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: [JU_ENTRY,
      { school: 'Delhi Public School', degree: 'High School Diploma', field: '', from: '2020', to: '2022' }] } });
    await run_.runAutofill(ctx, null);
    eq(items[1].degree, 'High School Diploma');
    eq(items[0].degree, "Bachelor's Degree", 'and the first keeps its own');
  });
});

test('Oracle tiles: an entry that will not save is cancelled and handed over with what it still needs', async () => {
  await withForm(TILES_PAGE, {}, async (env) => {
    const items = [{ school: 'Jadavpur University', end: '12/2027', degree: '', area: '' }];
    wireTiles(env, items);
    // A degree Oracle's list does not have: Degree stays empty, Save refuses.
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: [Object.assign({}, JU_ENTRY, { degree: 'Diploma in Fine Arts' })] } });
    const result = await run_.runAutofill(ctx, null);
    notOk(env.document.querySelector('.profile-item-content--form'), 'the entry form is closed again');
    const tile = result.decisions.find(x => x.kind === 'tile');
    eq(tile.action, p.ASK, `degree became "${items[0].degree}"; ${tile.value}`);
    ok(/still needs: Degree/.test(tile.reason), tile.reason);
  });
});

test('Oracle\'s "I agree to receive marketing communications" is not ticked as a terms agreement', () => {
  const row = { key: 'optin', el: null, members: [], kind: 'checkbox', label: 'I agree to receive marketing communications',
    ident: 'optin', value: '', filled: false, invalid: false, required: false,
    options: [{ value: 'on', label: 'I agree to receive marketing communications' }], readable: true, hints: {} };
  const ctx = { answerBank: Object.assign({}, BANK, { accepts_employer_terms_and_privacy_policy: 'Yes' }) };
  const decision = p.decide([row], ctx, null, null)[0];
  notOk(decision.action === p.FILL && decision.source === 'profile',
        'the "agree to employer terms" permission does not cover marketing');
});

const ORACLE_UNIFORMED = `
  <form class="apply-flow__content"><input name="a"><input name="b">
    <div class="input-row input-row--has-picker">
      <label class="input-row__label" for="IN-DFF-indiaMilitaryStatus-ATTRIBUTE16-7"><span class="input-row__linebreak">Have you served in any of the below India Uniformed forces?</span></label>
      <div class="input-row__control-container reset-z-index"><div class="cx-select-container"><div class="input-field-container">
        <div class="input-field-container__left"><input autocomplete="none" name="IN-DFF-indiaMilitaryStatus-ATTRIBUTE16" id="IN-DFF-indiaMilitaryStatus-ATTRIBUTE16-7"
          type="text" role="combobox" aria-haspopup="grid" aria-controls="mil-listbox" aria-expanded="false" class="cx-select-input"></div>
        <div id="mil-modal"></div>
      </div></div></div>
    </div>
  </form>`;

function wireUniformed(env) {
  const input = env.document.getElementById('IN-DFF-indiaMilitaryStatus-ATTRIBUTE16-7');
  const modal = env.document.getElementById('mil-modal');
  const all = ['Defense Forces (Army, Navy, Airforce)', 'Paramilitary', 'Police Force', 'No', 'I do not wish to answer'];
  const draw = (opts) => {
    input.setAttribute('aria-expanded', 'true');
    modal.innerHTML = '<div role="grid" id="mil-listbox">' + opts.map(o =>
      `<div role="row"><div role="gridcell" class="cx-select__list-item">${o}</div></div>`).join('') + '</div>';
    modal.querySelectorAll('[role=gridcell]').forEach(c => c.addEventListener('click', () => {
      input.value = c.textContent; input.setAttribute('aria-expanded', 'false'); modal.innerHTML = '';
    }));
  };
  input.addEventListener('focus', () => draw(all));
  input.addEventListener('input', (e) => {
    if (!e.inputType) return;
    draw(all.filter(o => o.toLowerCase().includes(input.value.toLowerCase())));
  });
  return input;
}

test('Oracle "India Uniformed forces" is military service: answered from the profile, never by the model', async () => {
  await withForm(ORACLE_UNIFORMED, { serverAnswers: { 'Have you served in any of the below India Uniformed forces?': 'no' } },
    async (env, sent) => {
      const input = wireUniformed(env);
      const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK,
        { veteran_status: 'I have never served in the military' }) });
      await run_.runAutofill(ctx, null);
      eq(input.value, 'No');
      const plan = sent.find(m => m.type === 'AF_PLAN');
      const asked = plan ? plan.payload.fields.map(f => f.label) : [];
      notOk(asked.some(l => /uniformed/i.test(l)), `sent to the model: ${asked.join(' | ')}`);
    });
});

test('matchTileEntry: two profile entries fitting equally well is "not sure"', () => {
  const entries = [{ school: 'A College', to: '2022' }, { school: 'B College', to: '2022' }];
  eq(tiles.matchTileEntry('education', 'Unnamed Major 04/2022', entries), null);
  eq(tiles.matchTileEntry('education', 'Unnamed Major A College 04/2022', entries), entries[0]);
});

test('Oracle: the resume import is never used on a later step of the application', async () => {
  await withForm(ORACLE_IMPORT_THEN_UPLOAD, {}, async (env) => {
    env.dom.reconfigure({ url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/1/apply/section/3' });
    wireRadioPills(env.document);
    const result = await run_.runAutofill(CTX, null);
    eq(env.document.querySelector('.apply-flow-profile-import-awli__file-upload').files.length, 0,
       'no second import: it would re-read the resume over the answers');
    ok(/already imported/.test(byLabel(result.decisions, 'Import your profile').reason || ''));
  });
});

test('Oracle "Preferred Location" (work locations) never gets the home location', () => {
  const row = { key: 'preferredLocations', el: null, members: [], kind: 'combobox', label: 'Preferred Location',
    ident: 'preferredLocations', value: '', filled: false, invalid: false, required: false,
    options: [], readable: true, hints: {} };
  const ctx = { answerBank: Object.assign({}, BANK, { location: 'Kolkata, West Bengal, India',
                                                       current_city: 'Kolkata' }) };
  const decision = p.decide([row], ctx, null, null)[0];
  eq(decision.action, p.SKIP, `decided: ${decision.action} ${decision.value}`);
  eq(p.fieldsForServer([decision]).length, 0, 'not sent to the model either');
});

test('a job-history "Title" text box is never given the name title', () => {
  const row = { key: 'title', el: null, members: [], kind: 'text', label: 'Title', ident: 'title',
    value: '', filled: false, invalid: false, required: true, options: [], readable: true, hints: {} };
  const ctx = { answerBank: Object.assign({}, BANK, { name_title: 'Mr.' }) };
  const decision = p.decide([row], ctx, null, null)[0];
  notOk(decision.value === 'Mr.', `decided: ${decision.action} ${decision.value}`);
});

test('a label that is only a validation prompt is never sent to the model', () => {
  const rows = [{ key: 'x', el: null, members: [], kind: 'choice', label: 'This information is required.',
    ident: 'x', value: '', filled: false, invalid: false, required: true,
    options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }], readable: true, hints: {} }];
  const decision = p.decide(rows, CTX, null, null)[0];
  eq(decision.action, p.ASK);
  eq(p.fieldsForServer([decision]).length, 0);
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
    eq(items.join(','), 'LinkedIn');
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

test('Workday (real markup): the Citi-employment question is answered from the work history', async () => {
  await withForm(fixtures.WORKDAY_MYINFO, {}, async (env) => {
    fixtures.wireWorkday(env.document);
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'employed by citi');
    ok(row, 'the radio group must be found, labelled by its legend');
    eq(row.action, p.FILL, 'Citi is not in the work history (Acme Corp): No, without asking');
    notOk(env.document.querySelector('#radio-yes').checked);
    ok(env.document.querySelector('#radio-no').checked);
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

// ── Workday Phone section (the reported +91 bug) ─────────────

const PHONE = `
<div data-automation-id="applyFlowPage">
  <div data-automation-id="formField-phoneType">
    <label for="p1">Phone Device Type<abbr>*</abbr></label>
    <button type="button" aria-haspopup="listbox" id="p1">Select One</button></div>
  <div data-automation-id="formField-countryPhoneCode">
    <label for="p2">Country / Territory Phone Code<abbr>*</abbr></label>
    <div data-automation-id="multiSelectContainer">
      <ul><li><div data-automation-id="selectedItem">India (+91)</div></li></ul>
      <div data-automation-id="multiselectInputContainer"><input id="p2" type="text"></div>
    </div></div>
  <div data-automation-id="formField-phoneNumber">
    <label for="p3">Phone Number<abbr>*</abbr></label>
    <input id="p3" data-automation-id="phone-number" type="text" aria-required="true"></div>
  <div data-automation-id="formField-extension">
    <label for="p4">Phone Extension</label><input id="p4" type="text"></div>
</div>`;

test('Phone: with a separate country-code field, the number has no +91', async () => {
  await withForm(PHONE, {}, async (env) => {
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, BANK, { phone: '+91 8240044652' }),
    });
    await run_.runAutofill(ctx, null);
    eq(valueOf(env, '#p3'), '8240044652');
    eq(valueOf(env, '#p4'), '', 'the extension box is not a phone number');
  });
});

test('Phone: a rejected number is retried in the other format', async () => {
  // No country-code field this time, so +91 is tried first — and the form
  // rejects it the way Workday did ("Enter a valid format").
  await withForm(`<form>
      <div class="field"><label for="ph">Phone Number*</label><input id="ph" type="text"
        aria-required="true"><div class="err" id="err"></div></div>
      <input name="x"><input name="y" type="email"></form>`, {}, async (env) => {
    const input = env.document.getElementById('ph');
    const err = env.document.getElementById('err');
    const check = () => {
      const bad = String(input.value).startsWith('+');
      err.className = bad ? 'error' : '';
      err.textContent = bad ? 'Enter a valid format for Phone Number.' : '';
    };
    input.addEventListener('input', check);
    input.addEventListener('blur', check);
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, BANK, { phone: '+91 8240044652' }),
    });
    const result = await run_.runAutofill(ctx, null);
    eq(input.value, '8240044652', 'the national number must be tried after the rejection');
    eq(byLabel(result.decisions, 'phone number').outcome, 'ok');
  });
});

test('Region is filled with the state', async () => {
  await withForm(`<div data-automation-id="applyFlowPage">
      <div data-automation-id="formField-city"><label for="c">City*</label><input id="c" type="text"></div>
      <div data-automation-id="formField-region"><label for="r">Region</label>
        <select id="r"><option value="">Select One</option><option value="wb">West Bengal</option>
          <option value="mh">Maharashtra</option></select></div>
      <input name="x" type="email"></div>`, {}, async (env) => {
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, BANK, { address_state: 'West Bengal' }),
    });
    await run_.runAutofill(ctx, null);
    eq(valueOf(env, '#r'), 'wb');
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

// OpenAI on Ashby (Oct 2026): Yes / No buttons with a hidden mirror checkbox,
// and the EEO radios in a second, sibling form container.
const ashbyCtx = over => Object.assign({}, CTX, {
  answerBank: Object.assign({}, CTX.answerBank, {
    authorized_to_work_in_country: 'Yes', requires_visa_sponsorship: 'No',
    gender: 'Cisgender man', race_ethnicity: 'South Asian',
    veteran_status: 'I have never served in the military',
  }, over || {}),
});
const pressed = (env, id) => {
  const box = env.document.querySelector(`input[name="${id}"]`).parentElement;
  const on = box.querySelector('button[aria-pressed="true"]');
  return on ? on.textContent.trim() : '';
};
const checkedRadio = (env, field) => {
  const r = env.document.querySelector(`input[name="eeo__${field}"]:checked`);
  return r ? env.document.querySelector(`label[for="${r.id}"]`).textContent.trim() : '';
};

test('Ashby (OpenAI): Yes / No buttons are questions, not a hidden tickbox', async () => {
  await withForm(fixtures.ASHBY_OPENAI, {}, async (env) => {
    fixtures.wireAshbyYesNo(env.document);
    const result = await run_.runAutofill(ashbyCtx(), null);
    notOk(result.error, result.error);
    const auth = byLabel(result.decisions, 'authorized to work');
    eq(auth.kind, 'choice');
    eq(auth.label, 'Are you authorized to work in the country where the job is located?',
       'the question from its own label, without the description');
    const spons = byLabel(result.decisions, 'require sponsorship');
    eq(spons.label, 'Will you now or in the future require sponsorship for employment visa status in this country?');
    eq(pressed(env, 'q-authorized'), 'Yes');
    eq(pressed(env, 'q-sponsorship'), 'No');
    notOk(result.decisions.some(x => x.kind === 'checkbox' && /authorized|sponsorship|office/i.test(x.label)),
          'the mirror checkbox is not offered as a field of its own');
  });
});

test('Ashby (OpenAI): the EEO survey radios are found and filled from the profile', async () => {
  await withForm(fixtures.ASHBY_OPENAI, {}, async (env) => {
    fixtures.wireAshbyYesNo(env.document);
    const result = await run_.runAutofill(ashbyCtx(), null);
    eq(checkedRadio(env, 'gender'), 'Male');
    eq(checkedRadio(env, 'race'), 'Asian (Not Hispanic or Latino)');
    eq(checkedRadio(env, 'veteran_status'), 'I am not a protected veteran');
    // Found by their own question — Ashby writes it as a <label>, not a <legend>.
    // Before, each group took its first option as the question: Race became
    // "Hispanic or Latino" and was mistaken for the Hispanic Yes / No question.
    for (const label of ['Gender', 'Race', 'Veteran Status']) {
      ok(result.decisions.some(x => x.label === label && x.kind === 'radio'), label);
    }
  });
});

test('Ashby (OpenAI): a required Yes / No with no answer on file is asked, never pressed', async () => {
  await withForm(fixtures.ASHBY_OPENAI, {}, async (env) => {
    fixtures.wireAshbyYesNo(env.document);
    const result = await run_.runAutofill(ashbyCtx(), null);
    const office = byLabel(result.decisions, 'US office');
    ok(office.required, 'Ashby marks required on the label\'s class, not with an asterisk');
    eq(office.action, p.ASK);
    eq(pressed(env, 'q-office'), '');
  });
});

test('Ashby (OpenAI): a protected veteran is never filed as "not a protected veteran"', async () => {
  await withForm(fixtures.ASHBY_OPENAI, {}, async (env) => {
    fixtures.wireAshbyYesNo(env.document);
    await run_.runAutofill(ashbyCtx({ veteran_status: 'I identify as a protected veteran' }), null);
    eq(checkedRadio(env, 'veteran_status'),
       'I identify as one or more of the classifications of protected veteran listed above');
  });
});

test('Ashby (OpenAI): the resume goes to the Resume field, never to Ashby\'s own parser', async () => {
  await withForm(fixtures.ASHBY_OPENAI, {}, async (env) => {
    fixtures.wireAshbyYesNo(env.document);
    const result = await run_.runAutofill(ashbyCtx(), null);
    eq(env.document.querySelector('#_systemfield_resume').files.length, 1);
    eq(env.document.querySelector('#ashby-autofill-file').files.length, 0,
       'a file there re-parses the resume and overwrites the filled form');
    notOk(result.decisions.some(x => /autofill from resume|upload file/i.test(x.label || '')));
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

// Ashby uploads (Snowflake, Oct 2026): the file input and its "Upload File /
// or drag and drop here" zone are siblings in one wrapper, and "Additional
// Attachments" names the cover letter only in its description.
const ashbyUpload = (id, title, description, required) => `
  <div class="ashby-application-form-field-entry" data-field-path="${id}">
    <label class="ashby-application-form-question-title" for="${id}">${title}</label>
    ${description ? `<div class="ashby-application-form-question-description"><p>${description}</p></div>` : ''}
    <div role="presentation" class="_container_10xk4_70 ashby-application-form-input-file">
      <input type="file" tabindex="-1" id="${id}" ${required ? 'required' : ''}>
      <div class="_instructions_10xk4_33 ashby-application-form-input-file-dropzone">
        <button class="ashby-application-form-input-file-dropzone-upload"><span>Upload File</span></button>
        <p class="ashby-application-form-input-file-dropzone-instructions">or drag and drop here</p>
      </div>
    </div>
  </div>`;
// Served with no whitespace between tags, as the live page is: a label and its
// description read as one run of text ("Additional AttachmentsCover Letter").
const ASHBY_UPLOADS = extra => compact(`
  <div class="ashby-application-form-container">
    <div class="ashby-application-form-field-entry">
      <label for="_systemfield_name">Full Name</label><input id="_systemfield_name" required>
    </div>
    <div class="ashby-application-form-field-entry">
      <label for="_systemfield_email">Email</label><input id="_systemfield_email" type="email" required>
    </div>
    ${ashbyUpload('_systemfield_resume', 'Resume', '', true)}
    ${extra || ''}
    ${ashbyUpload('q-attachments', 'Additional Attachments', 'Cover Letter, Portfolio, Projects, etc', false)}
  </div>`);
function compact(html) { return html.replace(/>\s+</g, '><').trim(); }
const COVER_CTX = Object.assign({}, CTX, { hasCoverLetter: true });

test('Ashby: "Additional Attachments" asking for a cover letter gets the cover letter', async () => {
  await withForm(ASHBY_UPLOADS(), {}, async (env, sent) => {
    const result = await run_.runAutofill(COVER_CTX, null);
    const box = result.decisions.find(x => x.label === 'Additional Attachments');
    eq(box.slot, 'cover_letter');
    eq(env.document.getElementById('q-attachments').files.length, 1);
    eq(env.document.getElementById('_systemfield_resume').files.length, 1, 'and the resume still goes to Resume');
    ok(sent.some(m => m.type === 'AF_GET_RESUME_FILE' && m.doc === 'cover_letter'));
  });
});

test('Ashby: with no cover letter on file, the attachments box is left for the person', async () => {
  await withForm(ASHBY_UPLOADS(), {}, async (env) => {
    const result = await run_.runAutofill(CTX, null);   // hasCoverLetter: false
    eq(result.decisions.find(x => x.label === 'Additional Attachments').action, p.ASK);
    eq(env.document.getElementById('q-attachments').files.length, 0);
  });
});

test('a form with its own Cover Letter field keeps the catch-all box for the person', async () => {
  await withForm(ASHBY_UPLOADS(ashbyUpload('q-cover', 'Cover Letter', '', false)), {}, async (env) => {
    await run_.runAutofill(COVER_CTX, null);
    eq(env.document.getElementById('q-cover').files.length, 1);
    eq(env.document.getElementById('q-attachments').files.length, 0,
       'one cover letter, in the field made for it');
  });
});

test('Ashby: an upload\'s own drag-and-drop zone is not a second field', async () => {
  await withForm(ASHBY_UPLOADS(), {}, () => {
    const rows = d.describeFields(d.findForm());
    eq(rows.filter(r => r.dropOnly).length, 0,
       'no phantom "Upload File or drag and drop here" row');
    eq(rows.filter(r => r.kind === 'file').length, 2);
  });
});

// Ashby's Location (Snowflake): results come from a network search that
// outlasts the writer's usual option wait, behind a "Loading..." popup.
const LOCATION_CTX = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
  { location: 'Kolkata, West Bengal, India', address_city: 'Kolkata',
    address_state: 'West Bengal', address_country: 'India' }) });
const locationBox = env => env.document.querySelector('.ashby-application-form-input-autocomplete');

test('Ashby: Location waits out the "Loading..." search and picks the place', async () => {
  await withForm(fixtures.ASHBY_LOCATION, {}, async (env) => {
    fixtures.wireAshbyLocation(env.document, { delayMs: 800 });
    const result = await run_.runAutofill(LOCATION_CTX, null);
    const row = byLabel(result.decisions, 'Location');
    ok(row, 'the Location field is found');
    eq(row.outcome, 'ok', `${row.action}: ${row.reason}`);
    locationBox(env).dispatchEvent(new env.window.Event('blur'));
    eq(locationBox(env).value, 'Kolkata, West Bengal, India', 'still there after Ashby\'s blur reset');
  });
});

test('Ashby: a Location that failed once is tried again on the next run', async () => {
  await withForm(fixtures.ASHBY_LOCATION, {}, async (env) => {
    // A search that never answers in time, then Ashby's blur wipes the box.
    fixtures.wireAshbyLocation(env.document, { never: true });
    await run_.runAutofill(LOCATION_CTX, null);
    locationBox(env).dispatchEvent(new env.window.Event('blur'));
    eq(locationBox(env).value, '');
    // The next run, with the network back: not "you edited this".
    fixtures.wireAshbyLocation(env.document, { delayMs: 50 });
    const again = await run_.runAutofill(LOCATION_CTX, null);
    const row = byLabel(again.decisions, 'Location');
    notOk(/you edited/i.test(row.reason || ''), row.reason);
    eq(row.outcome, 'ok', `${row.action}: ${row.reason}`);
    locationBox(env).dispatchEvent(new env.window.Event('blur'));
    eq(locationBox(env).value, 'Kolkata, West Bengal, India');
  });
});

test('clicking into a field and out again is not an edit', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env) => {
    run_.watchUserEdits(d.findForm(), null);
    const el = env.document.querySelector('#q_linkedin');
    el.dispatchEvent(new env.window.Event('blur', { bubbles: true }));
    el.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    const result = await run_.runAutofill(CTX, null);
    const row = byLabel(result.decisions, 'linkedin');
    notOk(/you edited/.test(row.reason || ''), 'nothing was typed, so it is still filled');
    eq(el.value, 'https://linkedin.com/in/adalovelace');
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

// Clearance and criminal history have no profile field, so "Save & fill" keeps
// the person's own answer; citizenship status lives in the profile and is not.
test('Save & fill remembers clearance, criminal-history and citizenship answers', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    const form = env.document.querySelector('form');
    form.insertAdjacentHTML('beforeend', `
      <label for="q_felony">Have you ever been convicted of a felony?</label>
      <select id="q_felony"><option value="">Select…</option><option>Yes</option><option>No</option></select>
      <label for="q_citizen">Citizenship Status</label>
      <select id="q_citizen"><option value="">Select…</option>
        <option>(a) U.S. citizen or national of the United States</option>
        <option>(f) Other (please explain)</option></select>`);
    const result = await run_.runAutofill(CTX, null);

    const felony = byLabel(result.decisions, 'convicted');
    ok(felony, 'the felony question should be found');
    eq(felony.action, p.ASK);
    ok((await run_.answerField(felony, 'No', true)).ok);
    const save = sent.find(m => m.type === 'AF_SAVE_ANSWERS');
    ok(save, 'the person\'s own criminal-history answer is kept');
    eq(save.payload.answers[0].answer, 'No');

    sent.length = 0;
    const citizen = byLabel(result.decisions, 'citizenship status');
    await run_.answerField(citizen, '(f) Other (please explain)', true);
    const kept = sent.find(m => m.type === 'AF_SAVE_ANSWERS');
    ok(kept, 'a citizenship answer is kept too, for this exact question');
    eq(kept.payload.answers[0].answer, '(f) Other (please explain)');
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

// content.js always passes onRemember, which can only reach a sub-frame. On a
// top-level Greenhouse form it answered "no_frame" and nothing was ever saved.
test('"Remember for next time" on a top-level form saves from this page, not via a frame', async () => {
  await withForm(fixtures.GREENHOUSE, {}, async (env, sent) => {
    const result = await run_.runAutofill(CTX, null);
    run_.watchUserEdits(d.findForm(), null);
    const el = env.document.querySelector('#q_linkedin');
    el.value = 'https://linkedin.com/in/ada2';
    el.dispatchEvent(new env.window.Event('change', { bubbles: true }));

    const body = env.document.createElement('div');
    env.document.body.appendChild(body);
    let framed = 0;
    ui.renderResults(body, result, CTX, {
      onRemember: async () => { framed++; return { error: 'no_frame' }; },
    });
    const btn = body.querySelector('#tcvAfRemember');
    ok(btn, 'the remember offer should render');
    btn.click();
    await new Promise(r => setTimeout(r, 0));

    eq(framed, 0, 'a local form must not be routed through the frame handler');
    const save = sent.find(m => m.type === 'AF_SAVE_ANSWERS');
    ok(save, 'the answer must be sent to the store');
    ok(save.payload.answers.some(a => /linkedin/i.test(a.question)));
  });
});

// ── Workday My Experience: Work Experience 1, 2, … ────────────
// Block markup from a real PwC capture (Oct 2026). "Add Another" appends a
// block with fresh ids, as Workday does; ticking "I currently work here" takes
// the block's "To" away. Education has an identical "Add Another" that must
// never be pressed.

function wdDate(id, label) {
  const part = (p, max) => `<div id="${id}-dateSection${p}"><div aria-hidden="true" data-automation-id="dateSection${p}-display">${p === 'Month' ? 'MM' : 'YYYY'}</div>
    <input role="spinbutton" aria-label="${p}" aria-valuemax="${max}" aria-valuemin="1" aria-valuetext="${p === 'Month' ? 'MM' : 'YYYY'}" id="${id}-dateSection${p}-input" data-automation-id="dateSection${p}-input"></div>`;
  return `<div data-automation-id="formField-${id.split('--')[1]}"><fieldset><legend><label><span>${label}<abbr aria-hidden="true">*</abbr></span></label></legend>
    <div id="${id}" role="group" data-automation-id="dateInputWrapper">${part('Month', 12)}<div>/</div>${part('Year', 9999)}</div></fieldset></div>`;
}

function wdExperienceBlock(n, k) {
  const f = `workExperience-${k}--`;
  const text = (name, label, req) => `<div data-automation-id="formField-${name}"><label for="${f}${name}"><span>${label}${req ? '<abbr aria-hidden="true">*</abbr>' : ''}</span></label>
    <input type="text" id="${f}${name}" name="${name}" aria-required="${req}"></div>`;
  return `<div role="group" aria-labelledby="Work-Experience-${n}-panel">
    <div><h5 id="Work-Experience-${n}-panel">Work Experience ${n}</h5>${n > 1 ? '<button>Delete</button>' : ''}</div>
    <div data-fkit-id="${f}null">
      ${text('jobTitle', 'Job Title', true)}${text('companyName', 'Company', true)}${text('location', 'Location', false)}
      <div data-automation-id="formField-currentlyWorkHere"><label for="${f}currentlyWorkHere">I currently work here</label>
        <input id="${f}currentlyWorkHere" type="checkbox" aria-checked="false" name="currentlyWorkHere"></div>
      <div class="dates">${wdDate(f + 'startDate', 'From')}${wdDate(f + 'endDate', 'To')}</div>
      <div data-automation-id="formField-roleDescription"><label for="${f}roleDescription">Role Description</label>
        <textarea id="${f}roleDescription"></textarea></div>
    </div></div>`;
}

const wdPage = (blocks = 1) => `
  <div data-automation-id="applyFlowPage"><h3>My Experience</h3>
  <div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Work-Experience-section"><h4 id="Work-Experience-section">Work Experience</h4>
      ${blocks ? wdExperienceBlock(1, 5) : ''}
      <div><div><button data-automation-id="add-button">Add Another</button></div></div>
    </div>
    <div role="group" aria-labelledby="Education-section"><h4 id="Education-section">Education</h4>
      <div role="group" aria-labelledby="Education-1-panel"><h5 id="Education-1-panel">Education 1</h5>
        <div data-automation-id="formField-gradeAverage"><label for="education-6--gradeAverage">Overall Result (GPA)</label>
          <input type="text" id="education-6--gradeAverage" name="gradeAverage"></div></div>
      <div><button data-automation-id="add-button" id="edu-add">Add Another</button></div>
    </div>
    <div role="group" aria-labelledby="Social-section"><h4 id="Social-section">Social Network URLs</h4>
      <label for="li">LinkedIn (optional)</label><input type="text" id="li" name="linkedInAccount"></div>
  </div>
  <div data-automation-id="pageFooter"><button data-automation-id="pageFooterNextButton">Save and Continue</button></div></div>`;
const WD_MY_EXPERIENCE = wdPage(1);

function wireWorkdayExperience(env) {
  const doc = env.document;
  const log = { eduAdds: 0, next: 0, adds: 0 };
  const section = doc.querySelector('[aria-labelledby="Work-Experience-section"]');
  const add = section.querySelector('[data-automation-id="add-button"]');
  let k = 26;
  const wireCurrent = (block) => {
    const cb = block.querySelector('input[name="currentlyWorkHere"]');
    cb.addEventListener('change', () => {
      const end = block.querySelector('[data-automation-id="formField-endDate"]');
      if (cb.checked && end) end.remove();
    });
  };
  const first = section.querySelector('[aria-labelledby="Work-Experience-1-panel"]');
  if (first) wireCurrent(first);
  add.addEventListener('click', () => {
    const n = section.querySelectorAll('[aria-labelledby$="-panel"]').length + 1;
    log.adds++;
    add.parentElement.parentElement.insertAdjacentHTML('beforebegin', wdExperienceBlock(n, k++));
    wireCurrent(section.querySelector(`[aria-labelledby="Work-Experience-${n}-panel"]`));
  });
  doc.getElementById('edu-add').addEventListener('click', () => { log.eduAdds++; });
  doc.querySelector('[data-automation-id="pageFooterNextButton"]').addEventListener('click', () => { log.next++; });
  return log;
}

// Workday's Education block (as on the user's screenshot, Oct 2026): School or
// University, Degree (a button dropdown, "Select One"), Field of Study, Overall
// Result (GPA), From / To (Actual or Expected) as year-only spinbuttons. The
// section starts with no block and an "Add" button.
function wdYear(id, label) {
  return `<div data-automation-id="formField-${id.split('--')[1]}"><fieldset><legend><label><span>${label}</span></label></legend>
    <div id="${id}" role="group" data-automation-id="dateInputWrapper"><div id="${id}-dateSectionYear"><div aria-hidden="true" data-automation-id="dateSectionYear-display">YYYY</div>
    <input role="spinbutton" aria-label="Year" aria-valuemax="9999" aria-valuemin="1" aria-valuetext="YYYY" id="${id}-dateSectionYear-input" data-automation-id="dateSectionYear-input"></div></div></fieldset></div>`;
}

function wdEducationBlock(n, k) {
  const f = `education-${k}--`;
  const text = (name, label, req) => `<div data-automation-id="formField-${name}"><label for="${f}${name}"><span>${label}${req ? '<abbr aria-hidden="true">*</abbr>' : ''}</span></label>
    <input type="text" id="${f}${name}" name="${name}" aria-required="${req}"></div>`;
  return `<div role="group" aria-labelledby="Education-${n}-panel">
    <div><h5 id="Education-${n}-panel">Education ${n}</h5><button>Delete</button></div>
    <div data-fkit-id="${f}null">
      ${text('schoolName', 'School or University', true)}
      <div data-automation-id="formField-degree"><label id="${f}degree-label" for="${f}degree"><span>Degree<abbr aria-hidden="true">*</abbr></span></label>
        <button type="button" id="${f}degree" aria-haspopup="listbox" aria-labelledby="${f}degree-label ${f}degree" value="">Select One</button></div>
      <div data-automation-id="formField-fieldOfStudy"><label for="${f}fieldOfStudy">Field of Study</label>
        <div data-automation-id="multiSelectContainer"><ul data-automation-id="selectedItemList"></ul>
          <div data-automation-id="multiselectInputContainer">
            <input data-automation-id="searchBox" id="${f}fieldOfStudy" type="text" placeholder="Search"></div></div></div>
      ${text('gradeAverage', 'Overall Result (GPA)', false)}
      <div class="dates">${wdYear(f + 'firstYearAttended', 'From')}${wdYear(f + 'lastYearAttended', 'To (Actual or Expected)')}</div>
    </div></div>`;
}

const WD_EDUCATION_PAGE = `
  <div data-automation-id="applyFlowPage"><h3>My Experience</h3>
  <div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Work-Experience-section"><h4 id="Work-Experience-section">Work Experience</h4>
      <div><div><button data-automation-id="add-button" id="exp-add">Add</button></div></div></div>
    <div role="group" aria-labelledby="Education-section"><h4 id="Education-section">Education</h4>
      <div><div><button data-automation-id="add-button" id="edu-add">Add</button></div></div></div>
    <div role="group" aria-labelledby="Skills-section"><h4 id="Skills-section">Skills</h4>
      <label for="skills-input">Type to Add Skills</label><input type="text" id="skills-input" name="skills"></div>
    <div role="group" aria-labelledby="Resume-section"><h4 id="Resume-section">Resume/CV</h4>
      <label for="resume-file">Resume/CV</label><input type="file" id="resume-file" name="resume"></div>
    <div role="group" aria-labelledby="Social-section"><h4 id="Social-section">Social Network URLs</h4>
      <label for="li">LinkedIn (optional)</label><input type="text" id="li" name="linkedInAccount"></div>
  </div>
  <div id="wd-portal"></div>
  <div data-automation-id="pageFooter"><button data-automation-id="pageFooterNextButton">Save and Continue</button></div></div>`;

// Part of NVIDIA's Workday Field of Study list, in its order.
const WD_FIELDS = ['Accounting', 'Advanced Computing', 'Advertising', 'Aeronautical Engineering', 'Aerospace',
  'Agriculture', 'Animation', 'Applications Design and Data Analysis', 'Applied Computing',
  'Applied Electronics', 'Applied Informatics', 'Applied Mathematics', 'Applied Science',
  'Chemical Engineering', 'Chemistry', 'Civil Engineering', 'Computational Science & Engineering',
  'Computer & Info Science', 'Computer Science', 'Computer Science & Engin.',
  'Electrical Engineering and Computer Science', 'Mechanical Engineering'];

// NVIDIA's real Workday degree list (Oct 2026).
// "High School" is further down the list than the screenshot reached; an
// earlier NVIDIA run had it selected in Education 2.
const WD_DEGREES = ['Post-diploma studies', 'BTECH', 'MTECH', 'MCA', 'University Diploma', 'Associates',
  'Technical/other training', 'Some college', 'PhD', 'Some post college', 'No Degree', 'High School'];

// opts.degreeLoadMs: the Degree list opens with only its disabled "Select One"
//   and loads the real options this long after (NVIDIA's report, Oct 2026).
// opts.enterSelects: Field of Study's Enter selects the exact match itself —
//   the pill appears and no result needs clicking (NVIDIA's report).
function wireWorkdayEducation(env, opts = {}) {
  const doc = env.document;
  const log = { eduAdds: 0, expAdds: 0, next: 0 };
  const section = doc.querySelector('[aria-labelledby="Education-section"]');
  const add = doc.getElementById('edu-add');
  const portal = doc.getElementById('wd-portal');
  let k = 40;
  const wireDegree = (block) => {
    const btn = block.querySelector('[data-automation-id="formField-degree"] button');
    const placeholder = '<li data-value="" role="option" aria-disabled="true" aria-selected="true" id="select-one"><div>Select One</div></li>';
    const fill = () => {
      portal.innerHTML = '<ul role="listbox">' + placeholder + WD_DEGREES.map(o =>
        `<li role="option" data-automation-id="promptOption" data-automation-label="${o}">${o}</li>`).join('') + '</ul>';
      for (const li of portal.querySelectorAll('[role=option]:not([aria-disabled])')) {
        li.addEventListener('mousedown', () => { btn.textContent = li.textContent; btn.value = li.textContent; portal.innerHTML = ''; });
      }
    };
    btn.addEventListener('mousedown', () => {
      btn.setAttribute('aria-expanded', 'true');
      if (!opts.degreeLoadMs) { fill(); return; }
      portal.innerHTML = '<ul role="listbox">' + placeholder + '</ul>';
      doc.defaultView.setTimeout(fill, opts.degreeLoadMs);
    });
  };
  // Workday's Field of Study prompt, as it behaves (NVIDIA, Oct 2026): opening
  // shows the full list's first rows; typing changes nothing; Enter searches and
  // shows the results with the FIRST highlighted; a click adds a selectedItem
  // pill; leaving without a click erases what was typed.
  log.letterKeys = 0;
  const wireField = (block) => {
    const input = block.querySelector('[data-automation-id="formField-fieldOfStudy"] input');
    const pills = block.querySelector('[data-automation-id="formField-fieldOfStudy"] [data-automation-id="selectedItemList"]');
    // opts.hideRoot: while the results are open, Workday marks the page's root
    // aria-hidden="true" (the console warning on NVIDIA) — the results inside it
    // are on screen all the same.
    const root = doc.querySelector('[data-automation-id="applyFlowPage"]');
    const render = (items) => {
      portal.innerHTML = '<ul role="listbox">' + items.map((o, i) =>
        `<li role="option" data-automation-id="promptOption" data-automation-label="${o}"${i === 0 ? ' aria-selected="true"' : ''}>`
        + `<div data-automation-id="promptLeafNode"><span class="radio"></span><span>${o}</span></div></li>`).join('') + '</ul>';
      if (opts.hideRoot) root.setAttribute('aria-hidden', 'true');
      for (const li of portal.querySelectorAll('[role=option]')) {
        li.addEventListener('mousedown', () => {
          pills.innerHTML += `<li><div data-automation-id="selectedItem">${li.textContent}</div></li>`;
          input.value = '';
          portal.innerHTML = '';
          root.removeAttribute('aria-hidden');
        });
      }
    };
    input.addEventListener('mousedown', () => render(WD_FIELDS.slice(0, 12)));
    input.addEventListener('keydown', (e) => {
      if (/^[a-z]$/i.test(e.key)) log.letterKeys++;
      if (e.key !== 'Enter') return;
      const exact = WD_FIELDS.find(o => o.toLowerCase() === input.value.trim().toLowerCase());
      if (opts.enterSelects && exact) {
        log.enterSelected = (log.enterSelected || 0) + 1;
        pills.innerHTML += `<li><div data-automation-id="selectedItem">${exact}</div></li>`;
        input.value = '';
        // and the results still render, with the selected one among them
      }
      const words = (exact || input.value).toLowerCase().split(/\W+/).filter(Boolean).map(w => w.slice(0, 6));
      render(WD_FIELDS.filter(o => o.toLowerCase().split(/\W+/).some(ow => words.some(w => ow.startsWith(w)))));
    });
    input.addEventListener('blur', () => { input.value = ''; });
  };
  add.addEventListener('click', () => {
    const n = section.querySelectorAll('[aria-labelledby$="-panel"]').length + 1;
    log.eduAdds++;
    if (n > 1) add.textContent = 'Add Another';
    add.parentElement.parentElement.insertAdjacentHTML('beforebegin', wdEducationBlock(n, k++));
    const block = section.querySelector(`[aria-labelledby="Education-${n}-panel"]`);
    wireDegree(block);
    wireField(block);
  });
  doc.getElementById('exp-add').addEventListener('click', () => { log.expAdds++; });
  doc.querySelector('[data-automation-id="pageFooterNextButton"]').addEventListener('click', () => { log.next++; });
  return log;
}

// PwC's Workday Voluntary Disclosures (Oct 2026): Date of Birth as three
// spinbuttons, Country / Territory of Birth as a button list in which
// "British Indian Ocean Territory" comes before "India".
const wdDatePart = (id, part, label, max) => `<div id="${id}-dateSection${part}"><div aria-hidden="true" data-automation-id="dateSection${part}-display">${label}</div>
  <input role="spinbutton" aria-label="${part}" aria-valuemax="${max}" aria-valuemin="1" aria-valuetext="${label}" aria-required="true"
         id="${id}-dateSection${part}-input" data-automation-id="dateSection${part}-input"></div>`;
const PWC_BIRTH_PAGE = `
  <div data-automation-id="applyFlowPage"><h3>Voluntary Disclosures</h3>
  <div data-automation-id="applyFlowVoluntaryDisclosuresPage">
    <div role="group" aria-labelledby="Personal-Information-section"><h4 id="Personal-Information-section">Personal Information</h4>
      <div data-automation-id="formField-dateOfBirth"><fieldset><legend><label id="label342"><span>Date of Birth<abbr aria-hidden="true">*</abbr></span></label></legend>
        <div id="personalInfoPerson--dateOfBirth" role="group" data-automation-id="dateInputWrapper">
          ${wdDatePart('personalInfoPerson--dateOfBirth', 'Month', 'MM', 12)}
          ${wdDatePart('personalInfoPerson--dateOfBirth', 'Day', 'DD', 31)}
          ${wdDatePart('personalInfoPerson--dateOfBirth', 'Year', 'YYYY', 9999)}
        </div></fieldset></div>
      <div data-automation-id="formField-countryOfBirth"><label for="personalInfoPerson--countryOfBirth"><span>Country / Territory of Birth<abbr aria-hidden="true">*</abbr></span></label>
        <button aria-haspopup="listbox" type="button" value="" aria-label="Country / Territory of Birth Select One Required"
                name="countryOfBirth" id="personalInfoPerson--countryOfBirth">Select One</button></div>
      <div data-automation-id="formField-regionOfBirth"><label for="personalInfoPerson--regionOfBirth">Region of Birth</label>
        <button aria-haspopup="listbox" type="button" value="" aria-label="Region of Birth Select One"
                name="regionOfBirth" id="personalInfoPerson--regionOfBirth">Select One</button></div>
      <div data-automation-id="formField-cityOfBirth"><label for="personalInfoPerson--cityOfBirth"><span>City of Birth<abbr aria-hidden="true">*</abbr></span></label>
        <input type="text" id="personalInfoPerson--cityOfBirth" name="cityOfBirth" aria-required="true"></div>
    </div>
  </div>
  <div id="wd-portal"></div>
  <div data-automation-id="pageFooter"><button data-automation-id="pageFooterNextButton">Save and Continue</button></div></div>`;
const PWC_COUNTRIES = ['Afghanistan', 'Bhutan', 'British Indian Ocean Territory', 'Brunei Darussalam', 'Iceland',
  'India', 'Indonesia', 'Singapore'];

function wirePwcBirth(env) {
  const doc = env.document;
  const portal = doc.getElementById('wd-portal');
  const btn = doc.getElementById('personalInfoPerson--countryOfBirth');
  btn.addEventListener('mousedown', () => {
    btn.setAttribute('aria-expanded', 'true');
    portal.innerHTML = '<ul role="listbox">'
      + '<li data-value="" role="option" aria-disabled="true" aria-selected="true"><div>Select One</div></li>'
      + PWC_COUNTRIES.map(o => `<li role="option" data-automation-id="promptOption" data-automation-label="${o}"><div>${o}</div></li>`).join('')
      + '</ul>';
    for (const li of portal.querySelectorAll('[role=option]:not([aria-disabled])')) {
      li.addEventListener('mousedown', () => { btn.textContent = li.textContent; btn.value = li.textContent; portal.innerHTML = ''; });
    }
  });
  // Region of Birth, as PwC's behaves: opens with only the disabled "Select
  // One", then loads the regions OF THE CHOSEN COUNTRY — none before one is chosen.
  const region = doc.getElementById('personalInfoPerson--regionOfBirth');
  const placeholder = '<li data-value="" role="option" aria-disabled="true" aria-selected="true"><div>Select One</div></li>';
  region.addEventListener('mousedown', () => {
    region.setAttribute('aria-expanded', 'true');
    portal.innerHTML = '<ul role="listbox">' + placeholder + '</ul>';
    doc.defaultView.setTimeout(() => {
      const regions = btn.value === 'India' ? ['Karnataka', 'Maharashtra', 'West Bengal'] : [];
      portal.innerHTML = '<ul role="listbox">' + placeholder + regions.map(o =>
        `<li role="option" data-automation-id="promptOption"><div>${o}</div></li>`).join('') + '</ul>';
    }, 150);
  });
}

test('PwC Workday: Region of Birth offers the regions of the country just filled, not "Select One"', async () => {
  await withForm(PWC_BIRTH_PAGE, {}, async (env) => {
    wirePwcBirth(env);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { country_of_birth: 'India', date_of_birth: '2003-12-01', city_of_birth: 'Kolkata' }) });
    const result = await run_.runAutofill(ctx, null);
    const region = byLabel(result.decisions, 'region of birth');
    eq(region.action, p.ASK);
    deepEq((region.options || []).map(o => o.label), ['Karnataka', 'Maharashtra', 'West Bengal']);
  });
});

test('PwC Workday: Date of Birth and Country of Birth from the profile; never "British Indian Ocean Territory"', async () => {
  await withForm(PWC_BIRTH_PAGE, {}, async (env, sent) => {
    wirePwcBirth(env);
    // No country of birth stored: the country of citizenship, written the old way.
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { nationality: 'Indian', date_of_birth: '1999-04-07', city_of_birth: 'Kolkata' }) });
    await run_.runAutofill(ctx, null);
    const doc = env.document;
    eq(doc.getElementById('personalInfoPerson--countryOfBirth').textContent, 'India');
    eq(valueOf(env, '[data-automation-id=dateSectionMonth-input]'), '04');
    eq(valueOf(env, '[data-automation-id=dateSectionDay-input]'), '07');
    eq(valueOf(env, '[data-automation-id=dateSectionYear-input]'), '1999');
    eq(doc.getElementById('personalInfoPerson--cityOfBirth').value, 'Kolkata');
    // None of the birth fields went to the server's model.
    const planned = sent.filter(m => m.type === 'AF_PLAN')
      .flatMap(m => ((m.payload && m.payload.fields) || []).map(f => f.label || ''));
    ok(!planned.some(l => /birth/i.test(l)), `sent to the model: ${planned.join(' | ')}`);
  });
});

test('Workday Date of Birth: a spinbutton that drops the leading zero is still the same date, not a mismatch', async () => {
  await withForm(PWC_BIRTH_PAGE, {}, async (env) => {
    wirePwcBirth(env);
    // Workday keeps "1" for the first of the month, not "01".
    for (const el of env.document.querySelectorAll('[role=spinbutton]')) {
      el.addEventListener('change', () => { if (/^0\d$/.test(el.value)) el.value = el.value.slice(1); });
    }
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { country_of_birth: 'India', date_of_birth: '2003-12-01', city_of_birth: 'Kolkata' }) });
    const result = await run_.runAutofill(ctx, null);
    eq(valueOf(env, '[data-automation-id=dateSectionDay-input]'), '1', 'the fixture drops the zero');
    const dob = byLabel(result.decisions, 'date of birth');
    eq(dob.outcome, 'ok', dob.reason);
    eq(ui.displayDate(dob.shown || dob.value), '12-01-2003');
  });
});

test('displayDate: MM-DD-YYYY, zero-padded', () => {
  eq(ui.displayDate('2003-12-01'), '12-01-2003');
  eq(ui.displayDate('12/1/2003'), '12-01-2003');
  eq(ui.displayDate('9/2023'), '09-2023');
  eq(ui.displayDate('2023-09'), '09-2023');
  eq(ui.displayDate('Kolkata'), 'Kolkata');
});

// Workday's citizenship prompts. "Citizenship Status" is hierarchical: each
// country row has a › and opens that country's own level (Citizen / Permanent
// Resident / Non-Citizen); "Primary Nationality" is a flat country list.
const wdPrompt = (id, label) => `
    <div data-automation-id="formField-${id}"><label for="${id}">${label}<abbr aria-hidden="true">*</abbr></label>
      <div data-automation-id="multiSelectContainer"><ul data-automation-id="selectedItemList"></ul>
        <div data-automation-id="multiselectInputContainer">
          <input data-automation-id="searchBox" id="${id}" type="text" placeholder="Search" aria-required="true"></div></div></div>`;
// Workday's two-level "How Did You Hear About Us?" (PwC, Oct 2026): categories
// with ›, each opening its own list under a ← header. opts.searchFinds: Enter
// on a search returns matching leaf rows (else "No Items"). opts.noLinkedIn:
// no category holds LinkedIn, but the top level has "External Agency".
const HEAR_TREE = {
  'Alumni': ['Former Employee'],
  'Job Posting Sites': ['Karriere.at', 'Lagou', 'LinkedIn', 'Monster'],
  'Referral': ['Employee Referral'],
  'Social Platform': ['Facebook', 'Glassdoor', 'LinkedIn', 'Twitter'],
  'Website': ['PwC Careers'],
};
const WD_HEAR_PAGE = `
  <div data-automation-id="applyFlowPage"><h3>My Information</h3>
  <div data-automation-id="applyFlowMyInfoPage">
    ${wdPrompt('source', 'How Did You Hear About Us?')}
    <div data-automation-id="formField-legalNameSection_firstName"><label for="fn">Given Name(s)<abbr>*</abbr></label>
      <input id="fn" type="text" aria-required="true" name="legalName--firstName"></div>
  </div>
  <div id="wd-portal"></div>
  <div data-automation-id="pageFooter"><button data-automation-id="pageFooterNextButton">Save and Continue</button></div></div>`;

function wireWorkdayHear(env, opts = {}) {
  const doc = env.document;
  const portal = doc.getElementById('wd-portal');
  const input = doc.getElementById('source');
  const pills = doc.querySelector('[data-automation-id="formField-source"] [data-automation-id="selectedItemList"]');
  const log = { pressed: [] };
  let tree = Object.assign({}, HEAR_TREE);
  if (opts.flatNoLinkedIn) tree = { 'Company Website': null, 'Social Media': null, 'Employee Referral': null };
  if (opts.noLinkedIn) {
    for (const k of Object.keys(tree)) tree[k] = tree[k].filter(x => x !== 'LinkedIn');
    tree['External Agency'] = null;                 // a top-level leaf
  }
  const row = (o, more) => `<li role="option" data-automation-id="promptOption"><div data-automation-id="promptLeafNode"><span>${o}</span>${more ? '<span class="chevron"></span>' : ''}</div></li>`;
  const choose = (text) => { pills.innerHTML += `<li><div data-automation-id="selectedItem">${text}</div></li>`; input.value = ''; portal.innerHTML = ''; };
  const wireRows = () => {
    for (const li of portal.querySelectorAll('[role=option]')) {
      const label = li.textContent.trim();
      li.addEventListener('mousedown', () => {
        log.pressed.push(label);
        if (Array.isArray(tree[label])) level(label); else choose(label);
      });
    }
  };
  const top = () => { portal.innerHTML = '<ul role="listbox">' + Object.keys(tree).map(k => row(k, Array.isArray(tree[k]))).join('') + '</ul>'; wireRows(); };
  const level = (cat) => {
    portal.innerHTML = `<div><button aria-label="Back">←</button><span>${cat}</span></div><ul role="listbox">`
      + tree[cat].map(o => row(o, false)).join('') + '</ul>';
    wireRows();
  };
  input.addEventListener('mousedown', top);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim().toLowerCase();
    if (!q) { top(); return; }
    const hits = opts.searchFinds
      ? [].concat(...Object.entries(tree).map(([k, v]) => (v || [k]).filter(x => x.toLowerCase().includes(q))))
      : [];
    portal.innerHTML = '<ul role="listbox">' + (hits.length ? hits.map(o => row(o, false)).join('')
      : '<li><div>No Items.</div></li>') + '</ul>';
    wireRows();
  });
  return log;
}
const hearPill = doc => Array.from(doc.querySelectorAll('[data-automation-id="formField-source"] [data-automation-id="selectedItem"]'))
  .map(n => n.textContent).join(' | ');

for (const [name, opts, want] of [
  ['the search finds LinkedIn', { searchFinds: true }, 'LinkedIn'],
  ['LinkedIn is inside a category', {}, 'LinkedIn'],
  ['no LinkedIn anywhere: External Agency', { noLinkedIn: true }, 'External Agency'],
  // A plain row is never pressed as if it were a category.
  ['a flat list with neither: nothing picked', { flatNoLinkedIn: true }, ''],
]) {
  test(`Workday "How Did You Hear About Us?" two-level list — ${name}`, async () => {
    await withForm(WD_HEAR_PAGE, {}, async (env) => {
      const log = wireWorkdayHear(env, opts);
      await run_.runAutofill(CTX, null);
      eq(hearPill(env.document), want);
      ok(!log.pressed.some(l => /referral|alumni/i.test(l)), `never a referral: ${log.pressed.join(', ')}`);
      eq(valueOf(env, '#fn'), 'Ada', 'the rest of the page still fills');
    });
  });
}

const WD_CITIZENSHIP_PAGE = `
  <div data-automation-id="applyFlowPage"><h3>Voluntary Disclosures</h3>
  <div data-automation-id="applyFlowVoluntaryDisclosuresPage">
    ${wdPrompt('citizenshipStatus', 'Citizenship Status')}
    ${wdPrompt('primaryNationality', 'Primary Nationality')}
  </div>
  <div id="wd-portal"></div>
  <div data-automation-id="pageFooter"><button data-automation-id="pageFooterNextButton">Save and Continue</button></div></div>`;
const WD_COUNTRIES = ['Afghanistan', 'Åland Islands', 'Albania', 'Algeria', 'Cambodia', 'British Indian Ocean Territory',
  'India', 'Indonesia', 'Singapore', 'United States of America'];
const WD_LEVEL = ['Citizen', 'Permanent Resident', 'Non-Citizen'];

function wireWorkdayCitizenship(env) {
  const doc = env.document;
  const portal = doc.getElementById('wd-portal');
  const log = { levelsOpened: 0, picks: [] };
  const wire = (id, hierarchical) => {
    const input = doc.getElementById(id);
    const pills = doc.querySelector(`[data-automation-id="formField-${id}"] [data-automation-id="selectedItemList"]`);
    const choose = (text) => {
      log.picks.push(`${id}: ${text}`);
      pills.innerHTML += `<li><div data-automation-id="selectedItem">${text}</div></li>`;
      input.value = '';
      portal.innerHTML = '';
    };
    const row = (o, more) => `<li role="option" data-automation-id="promptOption" data-automation-label="${o}">`
      + `<div data-automation-id="promptLeafNode"><span>${o}</span>${more ? '<span class="chevron"></span>' : ''}</div></li>`;
    const level = (country) => {
      log.levelsOpened++;
      portal.innerHTML = `<div><button aria-label="Back">‹</button><span>${country}</span></div>`
        + '<ul role="listbox">' + WD_LEVEL.map(o => row(o, false)).join('') + '</ul>';
      for (const li of portal.querySelectorAll('[role=option]')) {
        li.addEventListener('mousedown', () => choose(`${country} › ${li.textContent.trim()}`));
      }
    };
    const render = (items) => {
      portal.innerHTML = '<ul role="listbox">' + items.map(o => row(o, hierarchical)).join('') + '</ul>';
      for (const li of portal.querySelectorAll('[role=option]')) {
        const country = li.textContent.trim();
        li.addEventListener('mousedown', () => (hierarchical ? level(country) : choose(country)));
      }
    };
    input.addEventListener('mousedown', () => render(WD_COUNTRIES));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = input.value.trim().toLowerCase();
      render(WD_COUNTRIES.filter(o => o.toLowerCase().includes(q)));
    });
  };
  wire('citizenshipStatus', true);
  wire('primaryNationality', false);
  return log;
}

const pillsOf = (doc, id) => Array.from(doc.querySelectorAll(
  `[data-automation-id="formField-${id}"] [data-automation-id="selectedItem"]`)).map(n => n.textContent).join(' | ');

test('Workday citizenship: the country of citizenship, then its Citizen level; nationality flat', async () => {
  await withForm(WD_CITIZENSHIP_PAGE, {}, async (env) => {
    const log = wireWorkdayCitizenship(env);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { nationality: 'Indian', citizenship_status: 'Not a U.S. citizen or permanent resident' }) });
    await run_.runAutofill(ctx, null);
    eq(pillsOf(env.document, 'citizenshipStatus'), 'India › Citizen');
    eq(pillsOf(env.document, 'primaryNationality'), 'India');
    eq(log.levelsOpened, 1, 'one country opened, never a second');
  });
});

test('Workday citizenship: with no country of citizenship, nothing is picked', async () => {
  await withForm(WD_CITIZENSHIP_PAGE, {}, async (env) => {
    const log = wireWorkdayCitizenship(env);
    await run_.runAutofill(CTX, null);
    eq(log.picks.length, 0, `picked: ${log.picks.join(', ')}`);
  });
});

const WD_SCHOOLS = [
  { school: 'Indian Institute of Technology Delhi', degree: 'M.Tech (Master of Technology)',
    field: 'Chemical Engineering', gpa: '', from: '2023', to: '2025' },
  { school: 'NIT Durgapur', degree: 'B.Tech (Bachelor of Technology)', field: 'Computer Science',
    gpa: '8.1/10', from: '2019', to: '2023' },
];
const eduBlock = (doc, n) => doc.querySelector(`[aria-labelledby="Education-${n}-panel"]`);
const eduVal = (block, name) => block.querySelector(`[name="${name}"]`).value;
const eduField = block => Array.from(block.querySelectorAll(
  '[data-automation-id="formField-fieldOfStudy"] [data-automation-id="selectedItem"]')).map(n => n.textContent).join(' | ');
const eduYear = (block, which) => block.querySelector(`[id$="--${which}-dateSectionYear-input"]`).value;

test('Workday education: "Add" opens a block per school, each filled from the profile', async () => {
  await withForm(WD_EDUCATION_PAGE, {}, async (env) => {
    const log = wireWorkdayEducation(env);
    const ctx = Object.assign({}, CTX, {
      answerBank: Object.assign({}, CTX.answerBank, { gpa: '8.7/10' }),
      facts: { educationEntries: WD_SCHOOLS },
    });
    const result = await run_.runAutofill(ctx, null);
    const doc = env.document;

    const b1 = eduBlock(doc, 1), b2 = eduBlock(doc, 2);
    ok(b1 && b2, 'two blocks added, one per school');
    notOk(eduBlock(doc, 3), 'no empty third block');
    eq(log.eduAdds, 2);
    eq(eduVal(b1, 'schoolName'), 'Indian Institute of Technology Delhi');
    eq(b1.querySelector('[data-automation-id="formField-degree"] button').textContent, 'MTECH',
       'M.Tech takes the list\'s own MTECH');
    // Workday's prompt: committed only as a clicked pill — typed text is erased.
    eq(eduField(b1), 'Chemical Engineering', 'searched with Enter and clicked');
    eq(eduField(b2), 'Computer Science', 'the exact result, not the highlighted "Computational Science & Engineering"');
    eq(log.letterKeys, 0, 'no key-by-key typing — Workday ignores it');
    eq(eduVal(b1, 'gradeAverage'), '8.7/10', 'the first school falls back to the profile GPA');
    eq(eduYear(b1, 'firstYearAttended'), '2023');
    eq(eduYear(b1, 'lastYearAttended'), '2025');

    eq(eduVal(b2, 'schoolName'), 'NIT Durgapur', 'block 2 is school 2');
    eq(b2.querySelector('[data-automation-id="formField-degree"] button').textContent, 'BTECH',
       'B.Tech takes BTECH, never MTECH');
    eq(eduVal(b2, 'gradeAverage'), '8.1/10', 'its own GPA');
    eq(eduYear(b2, 'lastYearAttended'), '2023');

    eq(log.expAdds, 0, "Work Experience's Add is never pressed without jobs");
    eq(log.next, 0, 'never Save and Continue');
    const rows = result.decisions.filter(x => String(x.key).startsWith('repeater:education'));
    eq(rows.length, 2);
    ok(rows.every(x => x.action === p.FILL), rows.map(x => `${x.label}: ${x.reason}`).join(' | '));
  });
});

// The user's own profile, from the NVIDIA reports (Oct 2026).
const NVIDIA_SCHOOLS = [
  { school: 'Jadavpur University, Kolkata', degree: 'Bachelor of Technology', field: 'Chemical Engineering',
    gpa: '7.5', from: '2023', to: '2027' },
  { school: 'Hariyana Vidya Mandir, Kolkata', degree: 'Higher Secondary', field: '',
    gpa: '9.0', from: '2020', to: '2022' },
];

test('Workday education: Degree waits for its options to load past "Select One"', async () => {
  await withForm(WD_EDUCATION_PAGE, {}, async (env) => {
    wireWorkdayEducation(env, { degreeLoadMs: 300 });
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: NVIDIA_SCHOOLS } });
    await run_.runAutofill(ctx, null);
    const doc = env.document;
    const degree = n => eduBlock(doc, n).querySelector('[data-automation-id="formField-degree"] button').textContent;
    eq(degree(1), 'BTECH', 'Bachelor of Technology → BTECH, once the real options load');
    eq(degree(2), 'High School', 'Higher Secondary → High School');
  });
});

test('Workday education: a Degree the rules cannot match is chosen by the model from the list', async () => {
  // Visa (Oct 2026): no rule matched its degree list, the Degree stayed
  // "Select One" and auto-apply stopped. Here: a B.E. against NVIDIA's list,
  // which has BTECH but no B.E. and no "Bachelor's Degree".
  const asked = [];
  const forceAnswer = (f) => {
    asked.push(f);
    return /^Degree/.test(f.label) && f.options.includes('BTECH') ? 'BTECH' : null;
  };
  await withForm(WD_EDUCATION_PAGE, { forceAnswer }, async (env) => {
    wireWorkdayEducation(env);
    const schools = [Object.assign({}, NVIDIA_SCHOOLS[0], { degree: 'Bachelor of Engineering' }), NVIDIA_SCHOOLS[1]];
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: schools } });
    const result = await run_.runAutofill(ctx, null);
    const degree = n => eduBlock(env.document, n).querySelector('[data-automation-id="formField-degree"] button').textContent;
    eq(degree(1), 'BTECH', "the model's pick, from the list");
    eq(degree(2), 'High School', 'the rules still answer what they can — no model call for it');
    eq(asked.length, 1, `one call: ${asked.map(f => f.label).join(' | ')}`);
    ok(/Jadavpur/.test(asked[0].label) && /Bachelor of Engineering/.test(asked[0].label),
       `asked for THIS school's degree: ${asked[0].label}`);
    ok(asked[0].options.includes('BTECH'), 'with the options read from the list');
    const row = result.decisions.find(x => String(x.key) === 'repeater:education:0');
    eq(row.source, 'ai_forced');
    ok(/Degree picked by AI/.test(row.reason), row.reason);
  });
});

test('Workday education: a Field of Study that Enter already selected counts as filled', async () => {
  await withForm(WD_EDUCATION_PAGE, {}, async (env) => {
    const log = wireWorkdayEducation(env, { enterSelects: true });
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: NVIDIA_SCHOOLS } });
    const logged = [];
    const info = console.info, group = console.groupCollapsed;
    console.groupCollapsed = (...a) => { logged.push(a.join(' ')); };
    let result;
    try { result = await run_.runAutofill(ctx, null); } finally { console.groupCollapsed = group; console.info = info; }
    eq(eduField(eduBlock(env.document, 1)), 'Chemical Engineering', 'one pill — never clicked off');
    eq(log.enterSelected, 1);
    notOk(logged.some(l => /did not commit: Field of Study/.test(l)), 'no false "did not commit"');
    const row = result.decisions.find(x => String(x.key) === 'repeater:education:0');
    eq(row.action, p.FILL, row.reason);
  });
});

test('Workday education: Field of Study is clicked while Workday hides the page root from screen readers', async () => {
  await withForm(WD_EDUCATION_PAGE, {}, async (env) => {
    wireWorkdayEducation(env, { hideRoot: true });
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: WD_SCHOOLS } });
    await run_.runAutofill(ctx, null);
    eq(eduField(eduBlock(env.document, 1)), 'Chemical Engineering');
    eq(eduField(eduBlock(env.document, 2)), 'Computer Science');
  });
});

test('Workday education: a block already showing a school takes that school', async () => {
  await withForm(WD_EDUCATION_PAGE, {}, async (env) => {
    wireWorkdayEducation(env);
    const doc = env.document;
    doc.getElementById('edu-add').click();                       // Workday's resume read made block 1…
    eduBlock(doc, 1).querySelector('[name="schoolName"]').value = 'NIT Durgapur';   // …for school 2
    const ctx = Object.assign({}, CTX, { facts: { educationEntries: WD_SCHOOLS } });
    await run_.runAutofill(ctx, null);
    eq(eduYear(eduBlock(doc, 1), 'lastYearAttended'), '2023', 'block 1 completed as NIT Durgapur');
    eq(eduVal(eduBlock(doc, 2), 'schoolName'), 'Indian Institute of Technology Delhi', 'the other school gets a new block');
  });
});

// Workday's "Type to Add Skills" (NVIDIA, Oct 2026): typing does not search;
// Enter shows checkbox results for the current text; clicking a row TOGGLES
// its pill (a second click removes it); the list stays open; blur erases any
// unpicked text. "Deep Learning" starts selected, as Workday's resume read does.
const WD_SKILL_CATALOG = ['Machine Learning (ML)', 'Machine Learning Methods', 'AWS Machine Learning',
  'Deep Learning', 'AWS Deep Learning AMIs', 'Deep Learning Algorithms', 'Python (Programming Language)',
  'Python', 'Pythonic', 'SQL', 'Neural Networks', 'Natural Language Processing (NLP)'];
const WD_SKILLS_PAGE = `
  <div data-automation-id="applyFlowPage"><h2>My Experience</h2>
  <div data-automation-id="applyFlowMyExpPage">
    <div data-automation-id="formField-email"><label for="wd-email">Email</label><input id="wd-email" type="email"></div>
    <div data-automation-id="formField-name"><label for="wd-name">Legal Name</label><input id="wd-name" type="text"></div>
    <div data-automation-id="formField-skills"><label for="wd-skills">Type to Add Skills</label>
      <div data-automation-id="multiSelectContainer">
        <ul role="listbox" data-automation-id="selectedItemList" aria-label="items selected"><li role="presentation" data-automation-id="menuItem"><div role="option" data-automation-id="selectedItem" aria-label="Deep Learning, press delete to clear value.">Deep Learning</div></li></ul>
        <div data-automation-id="multiselectInputContainer">
          <input data-automation-id="searchBox" id="wd-skills" type="text" placeholder="Search"></div></div></div>
  </div><div id="wd-portal"></div></div>`;

// opts.searchMs: Workday's server search — results appear this long after Enter.
// opts.redrawMs: results are drawn, then redrawn (rows replaced) this long after.
// opts.innerOnly: only an element INSIDE each row listens for the click, as a
// checkbox row may — a click on the row element itself does nothing.
function wireWorkdaySkills(env, opts = {}) {
  const doc = env.document;
  const input = doc.getElementById('wd-skills');
  const pills = doc.querySelector('[data-automation-id="selectedItemList"]');
  const portal = doc.getElementById('wd-portal');
  const log = { letterKeys: 0, untoggled: [] };
  const picked = () => Array.from(pills.querySelectorAll('[data-automation-id="selectedItem"]')).map(n => n.textContent);
  // A clicked skill is saved to Workday's server first ("pill-REMOTE_SKILL-…"
  // in the real markup), and the reply REDRAWS the pills from the selection as
  // it stood at that click, plus the new skill. A second click before the
  // first reply therefore loses the first skill: its reply never included it.
  // That is "each new skill erases the previous one" (NVIDIA, Oct 2026).
  const win = doc.defaultView;
  const draw = (names) => {
    pills.innerHTML = names.map(n => `<li role="presentation" data-automation-id="menuItem"><div role="option" data-automation-id="selectedItem" aria-label="${n}, press delete to clear value.">${n}</div></li>`).join('');
  };
  const toggle = (name) => {
    const atClick = picked();
    const next = atClick.includes(name) ? atClick.filter(n => n !== name) : atClick.concat([name]);
    if (atClick.includes(name)) log.untoggled.push(name);
    win.setTimeout(() => draw(next), 120);                    // the server round trip
  };
  const render = (items) => {
    if (!items.length) { portal.innerHTML = '<ul role="listbox"><li>No Items.</li></ul>'; return; }
    portal.innerHTML = '<ul role="listbox">' + items.map(o =>
      `<li role="option" data-automation-id="promptOption" data-automation-label="${o}">`
      + `<div data-automation-id="promptLeafNode"><span class="box"></span><span>${o}</span></div></li>`).join('') + '</ul>';
    for (const li of portal.querySelectorAll('[role=option]')) {
      const target = opts.innerOnly ? li.querySelector('span:last-child') : li;
      target.addEventListener('mousedown', (e) => {
        if (opts.innerOnly && e.target !== target) return;
        toggle(li.textContent);
      });
    }
  };
  input.addEventListener('keydown', (e) => {
    if (/^[a-z]$/i.test(e.key)) log.letterKeys++;
    if (e.key === 'Escape') { portal.innerHTML = ''; return; }
    if (e.key !== 'Enter') return;
    const words = input.value.toLowerCase().split(/\W+/).filter(Boolean);
    const items = WD_SKILL_CATALOG.filter(o => words.every(w => o.toLowerCase().includes(w)));
    const show = () => {
      render(items);
      if (opts.redrawMs) win.setTimeout(() => render(items), opts.redrawMs);   // rows replaced
    };
    if (opts.searchMs) win.setTimeout(show, opts.searchMs); else show();
  });
  input.addEventListener('blur', () => { input.value = ''; });
  log.picked = picked;
  return log;
}

test('Workday skills: each profile skill is searched with Enter and ticked once', async () => {
  await withForm(WD_SKILLS_PAGE, {}, async (env) => {
    const log = wireWorkdaySkills(env);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { top_skills: 'Machine Learning, Deep Learning, Python, Underwater Basket Weaving' }) });
    const result = await run_.runAutofill(ctx, null);
    deepEq(log.picked().sort(), ['Deep Learning', 'Machine Learning (ML)', 'Python'].sort());
    deepEq(log.untoggled, [], 'the already-selected Deep Learning is never clicked off');
    eq(log.letterKeys, 0, 'no key-by-key typing');
    eq(env.document.getElementById('wd-skills').value, '', 'nothing left in the box for Workday to erase');
    const row = byLabel(result.decisions, 'skills');
    eq(row.action, p.FILL);
    ok(/Underwater Basket Weaving/.test(row.reason || ''), `reports the skill Workday lacks: ${row.reason}`);
  });
});

test('Workday skills accumulate — adding one never erases the one before', async () => {
  const empty = WD_SKILLS_PAGE.replace(
    '<li role="presentation" data-automation-id="menuItem"><div role="option" data-automation-id="selectedItem" aria-label="Deep Learning, press delete to clear value.">Deep Learning</div></li>', '');
  await withForm(empty, {}, async (env) => {
    const log = wireWorkdaySkills(env);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { top_skills: 'Machine Learning, Deep Learning, NLP, Python' }) });
    await run_.runAutofill(ctx, null);
    deepEq(log.picked().sort(),
           ['Deep Learning', 'Machine Learning (ML)', 'Natural Language Processing (NLP)', 'Python'].sort(),
           'every skill kept, one after another');
    deepEq(log.untoggled, [], 'no skill was ticked off along the way');
    eq(env.document.getElementById('wd-skills').value, '');
  });
});

test('Workday skills: a slow search is waited for, not skipped', async () => {
  // NVIDIA: TensorFlow's results arrived just as the extension moved on to
  // PyTorch. Here results take far longer than the old wait.
  const empty = WD_SKILLS_PAGE.replace(/<li role="presentation"[\s\S]*?<\/li>/, '');
  await withForm(empty, {}, async (env) => {
    const log = wireWorkdaySkills(env, { searchMs: 400 });
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { top_skills: 'Machine Learning, Deep Learning, Python' }) });
    await run_.runAutofill(ctx, null);
    deepEq(log.picked().sort(), ['Deep Learning', 'Machine Learning (ML)', 'Python'].sort());
  });
});

test('Workday skills: ticked even when the results are redrawn and only the row\'s inside listens', async () => {
  const empty = WD_SKILLS_PAGE.replace(/<li role="presentation"[\s\S]*?<\/li>/, '');
  await withForm(empty, {}, async (env) => {
    const log = wireWorkdaySkills(env, { redrawMs: 40, innerOnly: true });
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { top_skills: 'Machine Learning, Deep Learning, Python' }) });
    await run_.runAutofill(ctx, null);
    deepEq(log.picked().sort(), ['Deep Learning', 'Machine Learning (ML)', 'Python'].sort());
    deepEq(log.untoggled, [], 'never clicked twice into an un-tick');
  });
});

// Greenhouse (Stripe, Oct 2026): Degree is a react-select-style box whose list
// names only levels. Opening shows the whole list; typing filters it. Every
// typed search is counted — the degree must be chosen from one open list.
const STRIPE_DEGREE_LIST = ["Associate's Degree", "Bachelor's Degree", 'Doctor of Medicine (M.D.)',
  'Doctor of Philosophy (Ph.D.)', "Engineer's Degree", 'High School', 'Juris Doctor (J.D.)',
  'Master of Business Administration (M.B.A.)', "Master's Degree"];
const STRIPE_DEGREE_FORM = `
<form id="application-form">
  <div class="field"><label for="first_name">First Name</label><input id="first_name" name="first_name"></div>
  <div class="field"><label for="email">Email</label><input id="email" type="email" name="email"></div>
  <div class="field">
    <label for="q_degree">Degree <abbr title="required">*</abbr></label>
    <div class="select__container">
      <div class="select__control"><div class="select__placeholder">Select...</div>
        <input role="combobox" id="q_degree" aria-haspopup="listbox" aria-autocomplete="list" aria-expanded="false"></div>
      <input type="hidden" name="question_degree" value="">
    </div>
  </div>
</form>`;

function wireStripeDegree(env) {
  const doc = env.document;
  const input = doc.getElementById('q_degree');
  const control = input.parentElement;
  const log = { opens: 0, typed: 0 };
  let menu = null;
  const close = () => { if (menu) menu.remove(); menu = null; input.setAttribute('aria-expanded', 'false'); };
  const render = (filter) => {
    if (!menu) {
      menu = doc.createElement('div');
      menu.id = 'q_degree-listbox';
      menu.setAttribute('role', 'listbox');
      control.parentElement.appendChild(menu);
      input.setAttribute('aria-controls', menu.id);
      input.setAttribute('aria-expanded', 'true');
    }
    const shown = STRIPE_DEGREE_LIST.filter(o => !filter || o.toLowerCase().includes(filter.toLowerCase()));
    menu.innerHTML = shown.map((o, i) => `<div role="option" id="deg-${i}" class="select__option">${o}</div>`).join('');
    for (const node of menu.querySelectorAll('[role=option]')) {
      const pick = () => {
        control.querySelector('.select__placeholder, .select__single-value').outerHTML =
          `<div class="select__single-value">${node.textContent}</div>`;
        control.parentElement.querySelector('input[type=hidden]').value = node.textContent;
        input.value = '';
        close();
      };
      node.addEventListener('mousedown', pick);
      node.addEventListener('click', pick);
    }
  };
  const open = () => { if (!menu) { log.opens++; render(''); } };
  input.addEventListener('mousedown', open);
  input.addEventListener('focus', open);
  input.addEventListener('input', () => { log.typed++; render(input.value); });
  return log;
}

test('Greenhouse degree: B.Tech picks "Bachelor\'s Degree" from one open list, no typed searches', async () => {
  await withForm(STRIPE_DEGREE_FORM, {}, async (env) => {
    const log = wireStripeDegree(env);
    const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, CTX.answerBank,
      { degree: 'B.Tech (Bachelor of Technology)' }) });
    const result = await run_.runAutofill(ctx, null);
    const shown = env.document.querySelector('.select__single-value');
    ok(shown, `degree not committed: ${JSON.stringify(byLabel(result.decisions, 'degree'))}`);
    eq(shown.textContent, "Bachelor's Degree");
    eq(log.typed, 0, 'chosen from the open list — no search typed per spelling');
  });
});

const WD_JOBS = [
  { title: 'AI/ML Engineer', company: 'Zorba AI', location: 'Kolkata', from: '04/2024', to: '', current: true,
    description: 'Built RAG pipelines on GCP.' },
  { title: 'Data Analyst', company: 'Prospus', location: 'Remote', from: '06/2022', to: '03/2024', current: false,
    description: 'Dashboards in Power BI.' },
];

const wdBlock = (doc, n) => doc.querySelector(`[aria-labelledby="Work-Experience-${n}-panel"]`);
const wdVal = (block, name) => block.querySelector(`[name="${name}"], [id$="--${name}"]`).value;
const wdDateVal = (block, which) => ['Month', 'Year'].map(p =>
  block.querySelector(`[id$="--${which}-dateSection${p}-input"]`).value).join('/');

// NVIDIA (Oct 2026): Workday re-renders a text field once it is typed into —
// a NEW <input> with the SAME name in every block. Looking it up again by name
// across the page found block 1's field, so block 2's correct values were
// reported "did not take (mismatch)" while the page showed them right.
function rerenderOnInput(doc, section) {
  section.addEventListener('change', (e) => {
    const old = e.target;
    if (!(old && old.tagName === 'INPUT' && old.type === 'text' && old.isConnected)) return;
    const fresh = old.cloneNode(true);
    fresh.value = old.value;
    old.replaceWith(fresh);
  }, true);
}

test('Workday experience: a re-rendered field is checked in its own block, not block 1', async () => {
  await withForm(WD_MY_EXPERIENCE, {}, async (env) => {
    wireWorkdayExperience(env);
    rerenderOnInput(env.document, env.document.querySelector('[aria-labelledby="Work-Experience-section"]'));
    const ctx = Object.assign({}, CTX, { facts: { workExperience: WD_JOBS } });
    const logged = [];
    const info = console.info;
    console.info = (...a) => { logged.push(a.join(' ')); };
    let result;
    try { result = await run_.runAutofill(ctx, null); } finally { console.info = info; }
    const falseFails = logged.filter(l => /did not take/.test(l));
    deepEq(falseFails, [], 'no field reported as failed while the page holds its value');
    const b2 = wdBlock(env.document, 2);
    eq(wdVal(b2, 'jobTitle'), 'Data Analyst', 'the page holds the right value');
    const rows = result.decisions.filter(x => String(x.key).startsWith('repeater:experience'));
    eq(rows.length, 2);
    ok(rows.every(x => x.action === p.FILL), rows.map(x => `${x.label}: ${x.reason}`).join(' | '));
  });
});

test('Workday experience: each job fills its own block, "Add Another" adds the next', async () => {
  await withForm(WD_MY_EXPERIENCE, {}, async (env) => {
    const log = wireWorkdayExperience(env);
    const ctx = Object.assign({}, CTX, { facts: { workExperience: WD_JOBS } });
    const result = await run_.runAutofill(ctx, null);
    const doc = env.document;

    const b1 = wdBlock(doc, 1), b2 = wdBlock(doc, 2);
    ok(b2, 'a second block was added');
    notOk(wdBlock(doc, 3), 'exactly one press — no empty third block');
    eq(wdVal(b1, 'jobTitle'), 'AI/ML Engineer');
    eq(wdVal(b1, 'companyName'), 'Zorba AI');
    eq(wdVal(b1, 'location'), 'Kolkata');
    ok(b1.querySelector('[name="currentlyWorkHere"]').checked, 'current job ticked');
    eq(wdDateVal(b1, 'startDate'), '04/2024');
    notOk(b1.querySelector('[data-automation-id="formField-endDate"]'), 'no To for the current job');
    eq(wdVal(b1, 'roleDescription'), 'Built RAG pipelines on GCP.', 'Role Description is the description, not the title');

    eq(wdVal(b2, 'jobTitle'), 'Data Analyst', 'block 2 is job 2, not the current title again');
    eq(wdVal(b2, 'companyName'), 'Prospus');
    notOk(b2.querySelector('[name="currentlyWorkHere"]').checked);
    eq(wdDateVal(b2, 'startDate'), '06/2022');
    eq(wdDateVal(b2, 'endDate'), '03/2024');

    eq(log.eduAdds, 0, "Education's Add Another is never pressed");
    eq(log.next, 0, 'never Save and Continue');
    const rows = result.decisions.filter(x => String(x.key).startsWith('repeater:experience'));
    eq(rows.length, 2);
    ok(rows.every(x => x.action === p.FILL), rows.map(x => x.reason).join(' | '));
  });
});

test('Workday experience: one job means no "Add Another" at all', async () => {
  await withForm(WD_MY_EXPERIENCE, {}, async (env) => {
    wireWorkdayExperience(env);
    const ctx = Object.assign({}, CTX, { facts: { workExperience: [WD_JOBS[1]] } });
    await run_.runAutofill(ctx, null);
    eq(wdVal(wdBlock(env.document, 1), 'jobTitle'), 'Data Analyst');
    notOk(wdBlock(env.document, 2), 'no block added');
  });
});

test('Workday experience: a block the form already filled is matched by company, not overwritten', async () => {
  await withForm(WD_MY_EXPERIENCE, {}, async (env) => {
    wireWorkdayExperience(env);
    const b1 = wdBlock(env.document, 1);
    b1.querySelector('[name="jobTitle"]').value = 'Analyst';          // Workday's resume read
    b1.querySelector('[name="companyName"]').value = 'Prospus';
    const ctx = Object.assign({}, CTX, { facts: { workExperience: WD_JOBS } });
    await run_.runAutofill(ctx, null);
    eq(wdVal(b1, 'jobTitle'), 'Analyst', 'what Workday filled stays');
    eq(wdDateVal(b1, 'endDate'), '03/2024', 'its empty boxes come from the Prospus job');
    const b2 = wdBlock(env.document, 2);
    ok(b2, 'the other job got its own block');
    eq(wdVal(b2, 'companyName'), 'Zorba AI');
  });
});

test('Workday experience: a half-filled block 1 gets the rest of job 1 — not skipped (PwC, Oct 2026)', async () => {
  // What a live run left: block 1 had job 1's title / company / location and
  // nothing else; the step skipped it, put job 1 in block 2 and job 2 in block 3.
  await withForm(WD_MY_EXPERIENCE, {}, async (env) => {
    const log = wireWorkdayExperience(env);
    const b1 = wdBlock(env.document, 1);
    b1.querySelector('[name="jobTitle"]').value = 'AI/ML Engineer';
    b1.querySelector('[name="companyName"]').value = 'Zorba AI';
    b1.querySelector('[name="location"]').value = 'Kolkata';
    await run_.runAutofill(Object.assign({}, CTX, { facts: { workExperience: WD_JOBS } }), null);
    ok(b1.querySelector('[name="currentlyWorkHere"]').checked, 'block 1 completed: ticked');
    eq(wdDateVal(b1, 'startDate'), '04/2024', 'block 1 completed: From');
    eq(wdVal(b1, 'roleDescription'), 'Built RAG pipelines on GCP.');
    eq(log.adds, 1, 'one block added, for job 2 only');
    eq(wdVal(wdBlock(env.document, 2), 'companyName'), 'Prospus');
    notOk(wdBlock(env.document, 3), 'no third block');
  });
});

test('Workday experience: no block open yet — "Add Another" opens block 1, then one per further job', async () => {
  await withForm(wdPage(0), {}, async (env) => {
    const log = wireWorkdayExperience(env);
    await run_.runAutofill(Object.assign({}, CTX, { facts: { workExperience: WD_JOBS } }), null);
    eq(log.adds, 2);
    eq(wdVal(wdBlock(env.document, 1), 'companyName'), 'Zorba AI');
    eq(wdVal(wdBlock(env.document, 2), 'companyName'), 'Prospus');
  });
});

test('Workday experience: five jobs fill five blocks, in profile order', async () => {
  const five = ['A Corp', 'B Labs', 'C Systems', 'D Analytics', 'E Ventures'].map((company, i) => ({
    title: `Role ${i + 1}`, company, location: 'Kolkata', from: `0${i + 1}/20${20 - i}`, to: `0${i + 1}/20${21 - i}`,
    current: false, description: `Did thing ${i + 1}.` }));
  await withForm(WD_MY_EXPERIENCE, {}, async (env) => {
    const log = wireWorkdayExperience(env);
    await run_.runAutofill(Object.assign({}, CTX, { facts: { workExperience: five } }), null);
    eq(log.adds, 4, 'n - 1 presses when block 1 is already open');
    five.forEach((job, i) => {
      const b = wdBlock(env.document, i + 1);
      eq(wdVal(b, 'companyName'), job.company, `block ${i + 1}`);
      eq(wdVal(b, 'jobTitle'), job.title, `block ${i + 1}`);
      eq(wdDateVal(b, 'endDate'), job.to, `block ${i + 1}`);
    });
    notOk(wdBlock(env.document, 6));
  });
});

test('Workday experience: a block holding a company not in the profile is left alone', async () => {
  await withForm(WD_MY_EXPERIENCE, {}, async (env) => {
    const log = wireWorkdayExperience(env);
    const b1 = wdBlock(env.document, 1);
    b1.querySelector('[name="companyName"]').value = 'Someone Else Inc';
    await run_.runAutofill(Object.assign({}, CTX, { facts: { workExperience: WD_JOBS } }), null);
    eq(wdVal(b1, 'jobTitle'), '', 'no job title from a different job mixed in');
    eq(log.adds, 2, 'both jobs get their own block');
    eq(wdVal(wdBlock(env.document, 2), 'companyName'), 'Zorba AI');
    eq(wdVal(wdBlock(env.document, 3), 'companyName'), 'Prospus');
  });
});

await run('integration');
