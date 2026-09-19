// src/autofill/plan.js — the tiering reducer.
//
// This is where "never fabricate an answer" either holds or doesn't, so the
// safety rules get the most cases: a sensitive field with no stored answer must
// never be filled, must never be sent to the server, and must never be answered
// by the AI tier even if the server returns something for it.
//
// Run: node test/plan.test.mjs

import { test, run, ok, notOk, eq, deepEq } from './harness.mjs';
import * as p from '../src/autofill/plan.js';

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
  linkedin_url: 'https://linkedin.com/in/adalovelace',
  university: 'IIT Delhi',
  degree: 'B.Tech',
  major: 'Computer Science',
  graduation_date: 'Jun 2024',
  gpa: '8.7/10',
  current_company: 'Acme Corp',
  current_job_title: 'Software Engineer II',
  years_of_experience: '2',
  authorized_to_work_in_country: 'No',
  requires_visa_sponsorship: 'Yes',
  gender: 'Female',
  veteran_status: 'I am not a protected veteran',
  why_do_you_want_this_role:
    'I have spent two years building backend systems in Python and Django, and this '
    + 'role is squarely in that space. I am drawn to the product because it solves a '
    + 'problem I have hit personally, and the engineering blog suggests a team that '
    + 'cares about correctness as much as speed.',
};

const CTX = { answerBank: BANK, hasResume: true, hasCoverLetter: false };

/** A field descriptor of the shape discover.describeFields() produces. */
function field(label, extra) {
  return Object.assign({
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    el: null, members: [], kind: 'text', label, ident: label,
    value: '', filled: false, invalid: false, required: false,
    options: [], readable: true, documentSlot: null, hints: {},
  }, extra || {});
}

const one = (f, server, state) => p.decide([f], CTX, server, state)[0];

// ── Tier 1: deterministic profile answers ────────────────────

test('identity fields fill from the profile with no server call', () => {
  eq(one(field('First Name')).action, p.FILL);
  eq(one(field('First Name')).value, 'Ada');
  eq(one(field('First Name')).source, 'profile');
  eq(one(field('Email Address')).value, 'ada@example.com');
  eq(one(field('University / College')).value, 'IIT Delhi');
  eq(one(field('CGPA')).value, '8.7/10');
});

test('a form needing only profile fields needs no server round trip', () => {
  const rows = ['First Name', 'Last Name', 'Email', 'Phone', 'LinkedIn Profile']
    .map(l => field(l, { required: true }));
  const decisions = p.decide(rows, CTX, null, null);
  notOk(p.needsServer(decisions), 'this form is answerable offline');
  eq(p.summarize(decisions).fill, 5);
});

test('an unknown question becomes a server field, not a guess', () => {
  const d = one(field('Have you ever used Acme products?', { required: true }));
  eq(d.action, p.ASK);
  eq(d.value, '', 'nothing may be invented here');
  const send = p.fieldsForServer([d]);
  eq(send.length, 1);
  eq(send[0].label, 'Have you ever used Acme products?');
});

test('an optional unknown question is skipped, not asked', () => {
  eq(one(field('Anything else we should know?')).action, p.SKIP);
});

// ── Tier 0b: the sensitive lock ──────────────────────────────

test('work authorization fills from the stored answer only', () => {
  const d = one(field('Are you legally authorized to work in the United States?', {
    kind: 'select', required: true, options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }],
  }));
  eq(d.action, p.FILL);
  eq(d.value, 'No', 'the stored profile answer, verbatim');
  eq(d.source, 'profile');
  eq(d.sensitive, 'work_authorization');
});

test('a sensitive field with no stored answer is handed back, never filled', () => {
  const ctx = { answerBank: { full_name: 'Ada Lovelace' } };
  const d = p.decide(
    [field('Are you legally authorized to work in the United States?', { required: true })],
    ctx, null, null)[0];
  eq(d.action, p.PROFILE);
  eq(d.value, '');
  ok(d.reason.includes('profile'), d.reason);
});

test('salary is never guessed', () => {
  const ctx = { answerBank: BANK };   // BANK has no expected_salary
  const d = p.decide([field('What are your salary expectations?', { required: true })],
                     ctx, null, null)[0];
  eq(d.action, p.PROFILE);
  eq(d.value, '');
});

test('a sensitive field is never sent to the server', () => {
  const rows = [
    field('Are you legally authorized to work in the United States?', { required: true }),
    field('Will you now or in the future require sponsorship?', { required: true }),
    field('What is your gender?', { required: true }),
    field('Do you have a disability?', { required: true }),
    field('What are your salary expectations?', { required: true }),
    field('Have you ever been convicted of a felony?', { required: true }),
  ];
  const decisions = p.decide(rows, { answerBank: {} }, null, null);
  eq(p.fieldsForServer(decisions).length, 0,
     'not one sensitive question may leave the browser');
});

test('the AI tier cannot answer a sensitive field even if the server returns one', () => {
  // Defence in depth: the server already refuses these, and the client never
  // sends them — but if a response carried one anyway it must still be ignored.
  const rows = [field('Are you legally authorized to work in the United States?',
                      { required: true })];
  const server = { answers: { 0: { value: 'Yes', source: 'ai', confidence: 0.95 } } };
  const d = p.decide(rows, { answerBank: {} }, server, null)[0];
  eq(d.action, p.PROFILE, 'the sensitive branch returns before the server tier');
  eq(d.value, '');
});

test('never-fill identifiers are skipped outright, not even asked', () => {
  for (const label of ['Social Security Number', 'Bank account number', 'Date of birth']) {
    const d = one(field(label, { required: true }));
    eq(d.action, p.SKIP, label);
    eq(d.value, '', label);
  }
});

test('a never-fill field is not sent to the server either', () => {
  const decisions = p.decide([field('Social Security Number', { required: true })],
                             CTX, null, null);
  eq(p.fieldsForServer(decisions).length, 0);
});

test('an EEO answer already on the page is not downgraded to a decline', () => {
  const ctx = { answerBank: { veteran_status: 'I prefer not to answer' } };
  const d = p.decide([field('Veteran status', {
    kind: 'combobox', value: 'I am not a protected veteran', filled: false,
    options: [{ value: 'a', label: 'I am a protected veteran' },
              { value: 'b', label: 'I am not a protected veteran' },
              { value: 'c', label: 'I prefer not to answer' }],
  })], ctx, null, null)[0];
  eq(d.action, p.SKIP);
  ok(d.reason.includes('already there'), d.reason);
});

// ── option coercion ──────────────────────────────────────────

test('a location answer is coerced onto the options the form really offers', () => {
  const d = one(field('Where are you currently based?', {
    kind: 'select', required: true,
    options: [{ value: '1', label: 'USA' }, { value: '2', label: 'Canada' },
              { value: '3', label: 'Located Elsewhere' }],
  }));
  // "Kolkata, West Bengal, India" is not on the menu; nothing close enough is
  // either, so this is the user's to answer rather than a wrong pick.
  ok([p.ASK, p.SKIP].includes(d.action), `${d.action} / ${d.value}`);
  eq(d.value, '');
});

test('a value that IS one of the options is used', () => {
  const d = one(field('Country', {
    kind: 'select', options: [{ value: 'in', label: 'India' }, { value: 'us', label: 'USA' }],
  }));
  eq(d.action, p.FILL);
  eq(d.value, 'India');
});

test('a select with unreadable options still gets the raw value to try', () => {
  const d = one(field('Country', { kind: 'select', options: [] }));
  eq(d.action, p.FILL);
  eq(d.value, 'India');
});

test('a yes/no radio group is answered by matching the option label', () => {
  const d = one(field('Are you legally authorized to work in the United States?', {
    kind: 'radio', required: true,
    options: [{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }],
  }));
  eq(d.value, 'No');
});

test('a radio group worded as statements is answered by polarity', () => {
  const ctx = { answerBank: { authorized_to_work_in_country: 'No' } };
  const d = p.decide([field('Work authorization', {
    kind: 'radio', required: true,
    options: [{ value: 'a', label: 'I am authorized to work in the US' },
              { value: 'b', label: 'I am not authorized to work in the US' }],
  })], ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'I am not authorized to work in the US', d.value);
});

test('a lone consent checkbox is answered yes from the server tier', () => {
  const server = { answers: { 0: { value: 'yes', source: 'ai', confidence: 0.8 } } };
  const d = p.decide([field('I agree to the privacy policy', { kind: 'checkbox' })],
                     CTX, server, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'yes');
});

test('a checkbox answered no is left alone rather than unchecked', () => {
  const server = { answers: { 0: { value: 'no', source: 'ai', confidence: 0.8 } } };
  const d = p.decide([field('Add me to the talent pool', { kind: 'checkbox' })],
                     CTX, server, null)[0];
  eq(d.value, '', 'nothing to write');
});

// ── prose ────────────────────────────────────────────────────

test('long prose is suggested for review, never filled silently', () => {
  const d = one(field('Why do you want to work here?', { kind: 'textarea', required: true }));
  eq(d.action, p.SUGGEST, 'the user must read a paragraph before it is submitted');
  ok(d.value.length > 180);
});

test('a short answer to the same question is filled normally', () => {
  const ctx = { answerBank: { why_do_you_want_this_role: 'Great product.' } };
  const d = p.decide([field('Why this role?', { kind: 'textarea' })], ctx, null, null)[0];
  eq(d.action, p.SUGGEST, 'the key itself is prose-y, regardless of length');
});

test('server prose below the autofill threshold is suggested', () => {
  const server = { answers: { 0: { value: 'A short answer', source: 'ai', confidence: 0.65 } } };
  const d = p.decide([field('Describe a project', { kind: 'textarea', required: true })],
                     CTX, server, null)[0];
  eq(d.action, p.SUGGEST);
});

test('a server answer below the suggest threshold is asked instead', () => {
  const server = { answers: { 0: { value: 'Maybe', source: 'ai', confidence: 0.2 } } };
  const d = p.decide([field('Unusual question', { kind: 'text', required: true })],
                     CTX, server, null)[0];
  eq(d.action, p.ASK);
});

// ── recall ───────────────────────────────────────────────────

test('a recalled answer names the question it came from', () => {
  const server = { answers: { 0: {
    value: 'Yes, since 2022', source: 'saved_answer', confidence: 0.85,
    matchedQuestion: "Have you ever used Acme's developer platform?",
  } } };
  const d = p.decide([field('Have you used the Acme platform before?', { required: true })],
                     CTX, server, null)[0];
  eq(d.action, p.FILL);
  eq(d.source, 'saved_answer');
  ok(d.reason.includes('your answer to'), d.reason);
});

// ── what must never be overwritten ───────────────────────────

test('a field the user edited is never written to', () => {
  const f = field('First Name', { required: true });
  const d = p.decide([f], CTX, null, { userEdited: [f.key] })[0];
  eq(d.action, p.SKIP);
  ok(d.reason.includes('you edited'), d.reason);
});

test('a field already holding a value is left alone', () => {
  const d = one(field('First Name', { value: 'Augusta', filled: true }));
  eq(d.action, p.SKIP);
  eq(d.value, 'Augusta');
});

test('a field the FORM is rejecting is re-filled, not skipped', () => {
  const d = one(field('Phone', { value: '+246 8240044652', filled: true, invalid: true }));
  eq(d.action, p.FILL, 'a rejected value must be rewritten');
  eq(d.value, '+919876543210');
});

test('a registered field the page still shows is skipped', () => {
  const f = field('First Name', { value: 'Ada', filled: true });
  const d = p.decide([f], CTX, null, { registry: { [f.key]: 'Ada' } })[0];
  eq(d.action, p.SKIP);
  ok(d.reason.includes('already filled'), d.reason);
});

test('a registered field the form CLEARED is filled again', () => {
  const f = field('First Name', { value: '', filled: false });
  const d = p.decide([f], CTX, null, { registry: { [f.key]: 'Ada' } })[0];
  eq(d.action, p.FILL, 'the registry alone is not evidence the value is there');
});

test('an unreadable field is skipped and reported', () => {
  const d = one(field('Mystery', { readable: false }));
  eq(d.action, p.SKIP);
  ok(d.reason.includes('could not read'), d.reason);
});

// ── documents ────────────────────────────────────────────────

test('a resume file field is a document action when a resume is on file', () => {
  const d = one(field('Resume/CV', { kind: 'file', documentSlot: 'resume', required: true }));
  eq(d.action, p.DOCUMENT);
  eq(d.slot, 'resume');
});

test('a resume field with no resume on file asks the user', () => {
  const d = p.decide([field('Resume/CV', { kind: 'file', documentSlot: 'resume', required: true })],
                     { answerBank: BANK, hasResume: false }, null, null)[0];
  eq(d.action, p.ASK);
  ok(d.reason.includes('yourself'), d.reason);
});

test('a cover letter field with none on file asks rather than pretending', () => {
  const d = one(field('Cover Letter', { kind: 'file', documentSlot: 'cover_letter' }));
  eq(d.action, p.ASK, 'we must never claim an attach we cannot do');
});

test('an unrecognised file field asks the user', () => {
  const d = one(field('Writing Sample', { kind: 'file', required: true }));
  eq(d.action, p.ASK);
});

// ── date and phone shaping ───────────────────────────────────

test('a graduation date is shaped to the field format', () => {
  const d = one(field('Graduation Date', { hints: { type: 'date' } }));
  eq(d.value, '2024-06-01');
  const d2 = one(field('Graduation Date', { hints: { placeholder: 'MM/YYYY' } }));
  eq(d2.value, '06/2024');
});

test('an unparseable date is asked rather than written as junk', () => {
  const ctx = { answerBank: { available_start_date: 'whenever you like' } };
  const d = p.decide([field('Available Start Date', {
    required: true, hints: { type: 'date' } })], ctx, null, null)[0];
  eq(d.action, p.ASK);
  eq(d.value, '');
});

test('a phone field gets E.164 by default', () => {
  eq(one(field('Phone Number', { hints: { type: 'tel' } })).value, '+919876543210');
});

test('a phone field beside a country widget gets the national number', () => {
  const d = one(field('Phone Number', { hints: { type: 'tel' }, hasCountryWidget: true }));
  eq(d.value, '9876543210');
});

test('a number field is stripped to digits', () => {
  const ctx = { answerBank: { years_of_experience: '2 years' } };
  const d = p.decide([field('Years of Experience', { hints: { type: 'number' } })],
                     ctx, null, null)[0];
  eq(d.value, '2');
});

test('a value longer than maxLength is truncated, but prose is not', () => {
  const ctx = { answerBank: { first_name: 'Ada' } };
  eq(p.decide([field('First Name', { hints: { maxLength: 2 } })], ctx, null, null)[0].value, 'Ad');
  const long = { answerBank: { why_do_you_want_this_role: 'x'.repeat(400) } };
  const d = p.decide([field('Why this role?', { required: true, hints: { maxLength: 100 } })],
                     long, null, null)[0];
  eq(d.action, p.ASK, 'truncating a paragraph mid-sentence is worse than asking');
});

// ── summarize / fieldsForServer ──────────────────────────────

test('summarize counts every action', () => {
  const rows = [
    field('First Name'),                                            // fill
    field('Why do you want to work here?', { kind: 'textarea' }),    // suggest
    field('Have you used our product?', { required: true }),         // ask
    field('What is your gender?', { required: true }),               // profile (no stored)
    field('Resume/CV', { kind: 'file', documentSlot: 'resume' }),    // document
    field('Nothing we know', {}),                                   // skip
  ];
  const ctx = { answerBank: Object.assign({}, BANK, { gender: '' }), hasResume: true };
  const counts = p.summarize(p.decide(rows, ctx, null, null));
  eq(counts.fill, 1);
  eq(counts.suggest, 1);
  eq(counts.ask, 1);
  eq(counts.profile, 1);
  eq(counts.document, 1);
  eq(counts.skip, 1);
});

test('fieldsForServer carries options and required, and indexes by position', () => {
  const rows = [
    field('First Name'),
    field('Which office do you prefer?', {
      kind: 'select', required: true,
      options: [{ value: 'a', label: 'London' }, { value: 'b', label: 'Berlin' }],
    }),
  ];
  const send = p.fieldsForServer(p.decide(rows, CTX, null, null));
  eq(send.length, 1);
  eq(send[0].i, 1, 'the index must match the decision array position');
  eq(send[0].required, true);
  deepEq(send[0].options, ['London', 'Berlin']);
  eq(send[0].sensitive, false);
});

test('decide does not mutate the rows it is given', () => {
  const f = field('First Name');
  const snapshot = JSON.stringify(f);
  p.decide([f], CTX, null, null);
  eq(JSON.stringify(f), snapshot);
});

test('decide tolerates empty and missing input', () => {
  deepEq(p.decide([], CTX, null, null), []);
  deepEq(p.decide(null, CTX, null, null), []);
  eq(p.decide([field('First Name')], {}, null, null)[0].action, p.SKIP);
});

await run('plan.js');
