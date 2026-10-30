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
import * as m_ from '../src/autofill/match.js';

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

test('Bank of America (Workday): military service answered from veteran status; spouse asked', () => {
  const ctx = { answerBank: Object.assign({}, BANK, { veteran_status: 'I have never served in the military' }) };
  const yesNo = { kind: 'combobox', required: true, options: ['Yes', 'No'] };
  const served = p.decide([field('Have you ever served or are you currently serving in the United States military (this includes the National Guard and Reserves)?*', yesNo)], ctx, null, null)[0];
  eq(served.action, p.FILL);
  eq(served.value, 'No', 'never served -> No');
  const spouse = p.decide([field('Are you a current or former military spouse or domestic partner?*', yesNo)], ctx, null, null)[0];
  eq(spouse.action, p.ASK, 'no profile field holds this: the person answers it');
  eq(spouse.value, '');
  eq(p.fieldsForServer([spouse]).length, 0, 'and it is never sent to the model');
});

// SpaceX (greenhouse spacex/8730567002), the lists as the page serves them.
const SPACEX_CITIZENSHIP = [
  '(a) U.S. citizen or national of the United States',
  '(b) U.S. lawful permanent resident',
  '(c) Refugee under 8 U.S.C. 1157',
  '(d) Asylee under 8 U.S.C. 1158',
  '(e) Authorized to work in the United States under the Deferred Action for Childhood Arrivals (DACA) program',
  '(f) Other (please explain)',
];
const SPACEX_CLEARANCE = ['Top Secret SCI with Polygraph', 'Top Secret SCI/SAP', 'Top Secret',
  'DOE Level Q', 'Secret', 'Expired Clearance', 'Never held a clearance', 'Do not wish to disclose'];
const citizenshipRow = () => field('Citizenship Status*', { kind: 'combobox', required: true, options: SPACEX_CITIZENSHIP });
const clearanceRow = () => field('Active Security Clearance(s)*', { kind: 'combobox', required: true, options: SPACEX_CLEARANCE });

test('with nothing stored: citizenship points at the profile; clearance and felony are asked', () => {
  const felony = field('Have you ever been convicted of a felony?', { required: true });
  const [citizenship, clearance, conviction] = p.decide([citizenshipRow(), clearanceRow(), felony], CTX, null, null);
  eq(citizenship.action, p.PROFILE, 'citizenship status now has a profile field');
  eq(clearance.action, p.ASK);
  eq(conviction.action, p.ASK);
  for (const d of [citizenship, clearance, conviction]) {
    eq(d.value, '', 'never guessed');
    ok(d.sensitive);
  }
  eq(p.fieldsForServer([citizenship, clearance, conviction]).length, 0, 'and never sent to the model');
});

test('citizenship status fills from the profile, within its own group only', () => {
  const ctx = status => ({ answerBank: Object.assign({}, BANK, { citizenship_status: status }), hasResume: true });
  const pick = status => p.decide([citizenshipRow()], ctx(status), null, null)[0];
  eq(pick('U.S. citizen or national').value, SPACEX_CITIZENSHIP[0]);
  eq(pick('U.S. lawful permanent resident (green card)').value, SPACEX_CITIZENSHIP[1]);
  eq(pick('Refugee').value, SPACEX_CITIZENSHIP[2]);
  eq(pick('Asylee').value, SPACEX_CITIZENSHIP[3]);
  eq(pick('DACA recipient').value, SPACEX_CITIZENSHIP[4]);
  eq(pick('Not a U.S. citizen or permanent resident').value, SPACEX_CITIZENSHIP[5],
     '"Not a U.S. citizen" is never read as the citizen option');
});

test('citizenship status with no option in its group is asked, not approximated', () => {
  const row = field('Citizenship Status', { kind: 'combobox', options: ['U.S. Citizen', 'Permanent Resident'] });
  const ctx = { answerBank: Object.assign({}, BANK, { citizenship_status: 'Not a U.S. citizen or permanent resident' }) };
  const d = p.decide([row], ctx, null, null)[0];
  eq(d.action, p.ASK);
  notOk(d.value);
});

test('a saved clearance answer fills the SAME question, from this form\'s own options', () => {
  const ctx = Object.assign({}, CTX, { savedSensitive: [
    { question: 'Active Security Clearance(s)*', answer: 'Never held a clearance' }] });
  const d = p.decide([clearanceRow()], ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'Never held a clearance');
  eq(d.source, 'saved_answer');
  eq(p.fieldsForServer([d]).length, 0, 'still never sent to the model');
});

test('Region of Birth can be saved, and the saved answer fills it next time — never via the model', () => {
  const { STORABLE_SENSITIVE } = m_;
  ok(STORABLE_SENSITIVE.has('birth'), 'birth answers may be saved from a form');
  const ctx = Object.assign({}, CTX, { savedSensitive: [{ question: 'Region of Birth', answer: 'West Bengal' }] });
  const d = p.decide([field('Region of Birth', { kind: 'combobox',
                                                 options: ['Karnataka', 'Maharashtra', 'West Bengal'] })], ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'West Bengal');
  eq(d.source, 'saved_answer');
  eq(p.fieldsForServer([d]).length, 0);
});

test('"Have you been employed by X previously?" is answered from the work history', () => {
  const jobs = ws => ({ answerBank: BANK, hasResume: true, facts: { workExperience: ws.map(c => ({ company: c })) } });
  const q = l => field(l, { kind: 'radio', required: true, options: ['Yes', 'No'] });
  // Quantiphi's Workday question stopped auto-apply (Oct 2026).
  const no = p.decide([q('Have you been employed by Quantiphi previously?*')], jobs(['Alignerr']), null, null)[0];
  eq(no.action, p.FILL);
  eq(no.value, 'No');
  eq(p.fieldsForServer([no]).length, 0, 'never asked of the model');
  eq(p.decide([q('Have you been employed by Quantiphi previously?*')],
              jobs(['Quantiphi Analytics Solutions Pvt Ltd']), null, null)[0].value, 'Yes');
  // Not these: a skills question, a tenure question, the government question.
  for (const l of ['Have you worked with Python before?', 'How long have you worked at your current company?',
                   'Have you ever been directly employed by any government or military entity?']) {
    notOk(p.previousEmployerAnswer(q(l), jobs(['Alignerr']), {}), l);
  }
  // However broad the wording, not in the work history is No — never a pause.
  eq(p.decide([q('Have you ever been employed by Citi or any of its predecessor companies, whether as an '
                 + 'employee or via an agency or as a contractor?*')], jobs(['Alignerr']), null, null)[0].value, 'No');
  eq(p.decide([q('Have you ever been employed by Citi, whether as an employee or via an agency?*')],
              jobs(['Citibank N.A.']), null, null)[0].value, 'Yes', 'a match is Yes');
  const empty = { answerBank: Object.assign({}, BANK, { current_company: '', previous_company: '' }), hasResume: true };
  eq(p.decide([q('Have you worked for Globex before?')], empty, null, null)[0].value, 'No', 'no work history: No');
  // An employer called Visa is not a visa question (Visa Workday, Oct 2026):
  // it was sent to the profile as "add your sponsorship answer".
  const visa = 'Have you ever worked for Visa Inc. or any wholly/majority-owned subsidiaries of Visa Inc. '
    + '(e.g., CyberSource, Fundamo, etc.) in any capacity (e.g., Contractor, Full-time Employee, Consultant, '
    + 'Intern, etc.)? If Yes, please answer the questions below. If No, please continue.*';
  const v = p.decide([q(visa)], jobs(['Alignerr']), null, null)[0];
  eq(v.action, p.FILL, `${v.action}: ${v.reason}`);
  eq(v.value, 'No');
  eq(p.decide([q(visa)], jobs(['Visa Inc']), null, null)[0].value, 'Yes');
  // A real visa question is still sensitive.
  ok(p.decide([q('Will you require visa sponsorship?')], jobs(['Alignerr']), null, null)[0].sensitive);
});

test('a saved clearance answer is not reused for a differently worded question', () => {
  const ctx = Object.assign({}, CTX, { savedSensitive: [
    { question: 'Active Security Clearance(s)*', answer: 'Never held a clearance' }] });
  const other = field('Do you currently hold a U.S. security clearance?', { kind: 'combobox', options: ['Yes', 'No'] });
  eq(p.decide([other], ctx, null, null)[0].action, p.ASK);
});

test('a saved criminal-history answer fills the same question', () => {
  const ctx = Object.assign({}, CTX, { savedSensitive: [
    { question: 'Have you ever been convicted of a felony?', answer: 'No' }] });
  const row = field('Have you ever been convicted of a felony?', { kind: 'combobox', options: ['Yes', 'No'] });
  const d = p.decide([row], ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'No');
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
  for (const label of ['Social Security Number', 'Bank account number', 'Aadhaar number']) {
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

test('a long written answer is suggested for review, never filled silently', () => {
  const long = 'x'.repeat(400);
  const server = { answers: { 0: { value: long, source: 'ai_written', confidence: 0.9 } } };
  const d = p.decide([field('Why do you want to work here?', { kind: 'textarea', required: true })],
                     CTX, server, null)[0];
  eq(d.action, p.SUGGEST, 'the user must read a paragraph before it is submitted');
  ok(d.value.length > 180);
});

test('a stored "why" sentence is not pasted into a motivation question', () => {
  const ctx = { answerBank: { why_do_you_want_this_role: 'Great product.' } };
  const d = p.decide([field('Why this role?', { kind: 'textarea' })], ctx, null, null)[0];
  eq(d.value, '', 'written per job by the server instead');
  eq(d.compose, true);
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

// ── name parts ───────────────────────────────────────────────

test('no middle name on file leaves the Middle Name box empty', () => {
  // BANK has first/last but no middle_name key — as for "Shubham Sarkar".
  const d = one(field('Middle Name'));
  eq(d.value, '', 'the full name must never go in a middle name box');
  eq(d.action, p.SKIP);
});

test('a required Middle Name with nothing on file is asked, not guessed', () => {
  const d = one(field('Middle Name', { required: true }));
  eq(d.action, p.ASK);
  eq(d.value, '');
});

test('a known-but-empty field is sent recall-only, never for the model', () => {
  const send = p.fieldsForServer([one(field('Middle Name'))]);
  eq(send.length, 1, 'a saved answer may still exist for it');
  ok(send[0].recallOnly, 'the server must not let the model answer it');
});

test('an AI answer for a known-but-empty field is ignored', () => {
  const server = { answers: { 0: { value: 'Ada Lovelace', source: 'ai', confidence: 0.9 } } };
  const d = p.decide([field('Middle Name')], CTX, server, null)[0];
  eq(d.value, '', 'even if a response carried one');
});

test('a SAVED answer for a known-but-empty field is used', () => {
  const server = { answers: { 0: { value: 'https://ada.dev', source: 'saved_answer',
                                   confidence: 0.85, matchedQuestion: 'Portfolio URL' } } };
  const ctx = { answerBank: { full_name: 'Ada Lovelace' } };
  const d = p.decide([field('Portfolio')], ctx, server, null)[0];
  eq(d.value, 'https://ada.dev');
  eq(d.source, 'saved_answer');
});

test('a stored middle name fills Middle Name, and Middle Initial gets its initial', () => {
  const ctx = { answerBank: Object.assign({}, BANK, { middle_name: 'kumar' }) };
  eq(p.decide([field('Middle Name')], ctx, null, null)[0].value, 'kumar');
  eq(p.decide([field('Middle Initial')], ctx, null, null)[0].value, 'K');
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

// ── one label, several meanings ──────────────────────────────
//
// "Country" and "Current location" name a box without saying what it wants.
// The option list does, and it is already open by the time anything is
// written — so the answer is carried as several shapes and the list picks.

test('candidatesFor offers the country as a name, a dial code and both', () => {
  deepEq(p.candidatesFor('address_country', 'India', BANK),
         ['India', '+91', 'India (+91)']);
});

test('candidatesFor has no dial code to offer without a stored phone', () => {
  deepEq(p.candidatesFor('address_country', 'India', { address_country: 'India' }),
         ['India']);
});

test('candidatesFor offers a location at every granularity, most specific first', () => {
  deepEq(p.candidatesFor('location', BANK.location, BANK),
         ['Kolkata, West Bengal, India', 'Kolkata, West Bengal', 'Kolkata',
          'West Bengal, India', 'West Bengal', 'India']);
});

test('City and State dropdowns try their longest form first, then shorter — and only their own', () => {
  deepEq(p.candidatesFor('address_city', 'Kolkata', BANK),
         ['Kolkata, West Bengal, India', 'Kolkata, West Bengal', 'Kolkata, India', 'Kolkata'],
         'no state or country on its own: those are not cities');
  deepEq(p.candidatesFor('address_state', 'West Bengal', BANK),
         ['Kolkata, West Bengal, India', 'West Bengal, India', 'West Bengal'],
         'no city on its own: that is not a state');
  const city = one(field('City *', { kind: 'combobox', required: true,
    options: ['Kolkata, West Bengal', 'Kolhapur, Maharashtra'] }));
  eq(city.value, 'Kolkata, West Bengal');
  const state = one(field('State *', { kind: 'combobox', required: true, options: ['Maharashtra', 'West Bengal'] }));
  eq(state.value, 'West Bengal');
  eq(one(field('City *', { kind: 'text' })).value, 'Kolkata', 'a text box still gets just the city');
});

test('candidatesFor leaves an ordinary field with exactly one shape', () => {
  deepEq(p.candidatesFor('first_name', 'Ada', BANK), ['Ada']);
});

test('a Country list of names takes the name', () => {
  const d = one(field('Country', { kind: 'select', options: ['Indonesia', 'India', 'Ireland'] }));
  eq(d.action, p.FILL);
  eq(d.value, 'India');
});

test('a Country list of dial codes takes the dial code', () => {
  const d = one(field('Country', { kind: 'select', options: ['+1', '+62', '+91'] }));
  eq(d.action, p.FILL);
  eq(d.value, '+91', 'the same answer, in the shape this list offers');
});

test('a Country list of "India (+91)" takes the combined form', () => {
  const d = one(field('Country', { kind: 'select', options: ['India (+91)', 'Indonesia (+62)'] }));
  eq(d.value, 'India (+91)');
});

test('a location list of full addresses takes the full address', () => {
  const d = one(field('Current location', {
    kind: 'select',
    options: ['Bengaluru, Karnataka, India', 'Kolkata, West Bengal, India'],
  }));
  eq(d.value, 'Kolkata, West Bengal, India');
});

test('a location list of states takes the state', () => {
  const d = one(field('Current location', {
    kind: 'select', options: ['Karnataka', 'West Bengal', 'Maharashtra'],
  }));
  eq(d.value, 'West Bengal');
});

test('a location list of cities never guesses one from the country alone', () => {
  // The old substring rule scored any containment 0.75, so "India" selected
  // the first city ENDING in India — right for Kolkata, silently wrong for
  // anyone else. With no city of ours on the list, this must not be answered.
  const bank = { address_country: 'India' };
  const d = p.decide([field('Current location', {
    kind: 'select', required: true,
    options: ['Bengaluru, Karnataka, India', 'Mumbai, Maharashtra, India'],
  })], { answerBank: bank, hasResume: true }, null, null)[0];
  notOk(d.value, `picked ${d.value}`);
  eq(d.action, p.ASK);
});

test('a closed office list falls back to Other, flagged for review', () => {
  const d = one(field('Current location', {
    kind: 'select', options: ['Bengaluru', 'Hyderabad', 'Other'],
  }));
  eq(d.value, 'Other');
  eq(d.action, p.SUGGEST, 'a compromise the user should see, not a silent fill');
  ok(/isn't offered here/.test(d.reason), d.reason);
});

test('a sensitive question never takes the Other fallback', () => {
  // The whole point of the sensitive tier: "Other" on a work-authorization or
  // demographic question is a declaration filed under the user's name.
  const ctx = { answerBank: Object.assign({}, BANK, { gender: 'Female' }), hasResume: true };
  const d = p.decide([field('Gender', {
    kind: 'select', options: ['Male', 'Other', 'Decline To Self Identify'],
  })], ctx, null, null)[0];
  notOk(d.value === 'Other' && d.action === p.SUGGEST,
        'a stored answer must not be traded for "Other"');
});

test('a field with nothing on file does not take Other either', () => {
  const ctx = { answerBank: {}, hasResume: true };
  const d = p.decide([field('Current location', {
    kind: 'select', required: true, options: ['Bengaluru', 'Other'],
  })], ctx, null, null)[0];
  notOk(d.value, `"Other" must not stand in for an answer we never had (got ${d.value})`);
});

// ── degrees: the profile wording is not the dropdown wording ──

// Reversed in Oct 2026: the degree's own wording and spellings come first
// ("BTECH" where a Workday list offers it), the level ("Bachelor's Degree")
// after, for lists that only name levels (Greenhouse).
test('candidatesFor offers a degree as itself first, then its level', () => {
  deepEq(p.candidatesFor('degree', 'Bachelor of Technology', {}),
         ['Bachelor of Technology', 'BTech', "Bachelor's Degree", 'Bachelors', 'Bachelor',
          'Undergraduate Degree', 'Undergraduate']);
});

const degreeRow = (stored, options) => ({
  key: 'degree', el: null, members: [], kind: 'select', label: 'Degree',
  ident: 'Degree', value: '', filled: false, invalid: false, required: false,
  options, readable: true, documentSlot: null, hints: {},
  candidates: p.candidatesFor('degree', stored, {}), candidateKey: 'degree',
});

// The live case: the profile says "Bachelor of Technology", the form offers
// only levels, and it was reported as "we could not get this to stick".
const SHOT = ["Associate's Degree", "Bachelor's Degree", 'Computer Science Degree',
              'Doctor of Medicine (M.D.)', 'Master of Business Administration',
              'Juris Doctor (J.D.)', 'High School Diploma'];

test('a degree level list takes the level', () => {
  eq(p.coerce('Bachelor of Technology', degreeRow('Bachelor of Technology', SHOT)),
     "Bachelor's Degree");
  eq(p.coerce('B.Tech', degreeRow('B.Tech', SHOT)), "Bachelor's Degree");
  eq(p.coerce('Higher Secondary', degreeRow('Higher Secondary', SHOT)),
     'High School Diploma');
});

test('a list that spells degrees out keeps the exact one', () => {
  const full = ['Bachelor of Technology', 'Master of Technology', 'Bachelor of Science'];
  eq(p.coerce('Bachelor of Technology', degreeRow('Bachelor of Technology', full)),
     'Bachelor of Technology', 'never a sibling degree when ours is on the list');
});

test('a degree is never traded for a different qualification at the same level', () => {
  // "Master's Degree" scores respectably against "Master of Business
  // Administration"; claiming an MBA is not a rounding error.
  eq(p.coerce('Master of Science', degreeRow('Master of Science', SHOT)), null);
  // Nor a doctorate for the first thing on the list that says "Degree".
  eq(p.coerce('PhD', degreeRow('PhD', SHOT)), null);
});

test('short level labels still match', () => {
  const plain = ['Bachelors', 'Masters', 'Doctorate', 'Other'];
  eq(p.coerce('Bachelor of Technology', degreeRow('Bachelor of Technology', plain)), 'Bachelors');
  eq(p.coerce('PhD', degreeRow('PhD', plain)), 'Doctorate');
});

// ── ethnicity: their answer, in the form's words ─────────────
//
// Sensitive, so the rules are stricter than anywhere else: the stored answer
// may be restated in the wording a form offers, and may be WIDENED to the
// category it belongs to, but must never be narrowed and never invented.

const ethnicityRow = (stored, options) => ({
  key: 'race ethnicity', el: null, members: [], kind: 'select',
  label: 'Please indicate your race or ethnicity:', ident: 'race',
  value: '', filled: false, invalid: false, required: true,
  options, readable: true, documentSlot: null, hints: {},
  candidates: p.candidatesFor('race_ethnicity', stored, {}),
  candidateKey: 'race_ethnicity',
});

// The list from the live form that could not be filled.
const RACE_LIST = ['Asian', 'Black or African', 'Hispanic or Latino',
                   'White / European', 'Middle Eastern / North African',
                   'Indigenous / First Nations'];

test('a stored ethnicity takes the broader category the form offers', () => {
  eq(p.coerce('South Asian', ethnicityRow('South Asian', RACE_LIST)), 'Asian');
  eq(p.coerce('Middle Eastern', ethnicityRow('Middle Eastern', RACE_LIST)),
     'Middle Eastern / North African');
});

test('a stored ethnicity is restated in the standard EEO wording', () => {
  const eeo = ['American Indian or Alaska Native', 'Asian', 'Black or African American',
               'Hispanic or Latino', 'White', 'Two or More Races'];
  eq(p.coerce('South Asian', ethnicityRow('South Asian', eeo)), 'Asian');
  eq(p.coerce('Hispanic', ethnicityRow('Hispanic', eeo)), 'Hispanic or Latino');
  eq(p.coerce('Native American', ethnicityRow('Native American', eeo)),
     'American Indian or Alaska Native');
});

test('an ethnicity is NEVER narrowed to something they did not say', () => {
  // The direction that matters. Taking "South Asian" off a list because the
  // profile says "Asian" would file a more specific claim about a protected
  // characteristic than the person ever made.
  eq(p.coerce('Asian', ethnicityRow('Asian', ['South Asian', 'East Asian'])), null);
  eq(p.coerce('Black', ethnicityRow('Black', ['Black Caribbean', 'Black African'])), null);
  eq(p.coerce('White', ethnicityRow('White', ['White British', 'White Irish'])), null);
});

test('an ethnicity is never crossed into another group', () => {
  eq(p.coerce('South Asian', ethnicityRow('South Asian',
     ['Black or African American', 'Hispanic or Latino', 'White'])), null);
});

test('an unrecognised ethnicity is matched literally or left alone', () => {
  eq(p.coerce('Martian', ethnicityRow('Martian', RACE_LIST)), null);
});

test('the whole sensitive row fills from the profile and nowhere else', () => {
  const ctx = { answerBank: Object.assign({}, BANK, { race_ethnicity: 'South Asian' }),
                hasResume: true };
  const row = ethnicityRow('South Asian', RACE_LIST);
  delete row.candidates;           // decide() builds them itself
  delete row.candidateKey;
  const d = p.decide([row], ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'Asian');
  eq(d.sensitive, 'demographic');
  eq(d.source, 'profile');
});

test('a sensitive row with nothing stored still asks, never guesses', () => {
  const row = ethnicityRow('', RACE_LIST);
  delete row.candidates;
  delete row.candidateKey;
  const d = p.decide([row], { answerBank: {}, hasResume: true }, null, null)[0];
  eq(d.action, p.PROFILE);
  notOk(d.value);
});

// Greenhouse: "Are you Hispanic/Latino?" (Yes / No / Decline) comes first, and
// the race list only appears after "No". The stored race answers it as Yes/No.
const HISPANIC_YN = ['Yes', 'No', 'Decline To Self Identify'];
const hispanicRow = () => field('Are you Hispanic/Latino?', { kind: 'combobox', options: HISPANIC_YN });
const raceCtx = race => ({ answerBank: Object.assign({}, BANK, { race_ethnicity: race }), hasResume: true });

test('"Are you Hispanic/Latino?" is answered No from a non-Hispanic race', () => {
  const d = p.decide([hispanicRow()], raceCtx('Asian'), null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'No');
  eq(d.readFirst.stored, 'No', 'the writer re-picks from the open list with the same answer');
  eq(p.decide([hispanicRow()], raceCtx('South Asian'), null, null)[0].value, 'No');
});

test('"Are you Hispanic/Latino?" is answered Yes from a Hispanic race', () => {
  eq(p.decide([hispanicRow()], raceCtx('Hispanic or Latino'), null, null)[0].value, 'Yes');
});

test('"Are you Hispanic/Latino?" is never guessed from a race that does not settle it', () => {
  for (const race of ['Two or More Races', 'Martian']) {
    const d = p.decide([hispanicRow()], raceCtx(race), null, null)[0];
    eq(d.action, p.ASK, race);
    notOk(d.value);
  }
});

test('a race list offering "Hispanic or Latino" is still matched as a race list', () => {
  notOk(p.isHispanicYesNoQuestion('Race / Ethnicity (Hispanic or Latino)'));
  ok(p.isHispanicYesNoQuestion('Are you Hispanic/Latino?'));
});

test('"Please identify your race" is the race question', () => {
  const row = field('Please identify your race', { kind: 'combobox', options: RACE_LIST });
  const d = p.decide([row], raceCtx('South Asian'), null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'Asian');
});

// SpaceX (Greenhouse, Oct 2026): work authorization as statements, not Yes / No.
const SPACEX_AUTH = [
  'I am authorized to work in the United States for any employer',
  'I am authorized to work in the United States for my present employer only',
  'I require sponsorship to work in the United States',
  'I am not authorized to work in the United States',
  'My status to work in the United States is unknown',
];
const authRow = () => field('Are you legally authorized to work in the United States?*',
  { kind: 'combobox', options: SPACEX_AUTH, required: true });
const authCtx = (auth, spons) => ({ answerBank: Object.assign({}, BANK,
  { authorized_to_work_in_country: auth, requires_visa_sponsorship: spons }), hasResume: true });

test('work authorization as statements: read from BOTH stored answers', () => {
  eq(p.decide([authRow()], authCtx('Yes', 'No'), null, null)[0].value, SPACEX_AUTH[0]);
  eq(p.decide([authRow()], authCtx('Yes', 'Yes'), null, null)[0].value, SPACEX_AUTH[2]);
  eq(p.decide([authRow()], authCtx('No', 'Yes'), null, null)[0].value, SPACEX_AUTH[2]);
  eq(p.decide([authRow()], authCtx('No', 'No'), null, null)[0].value, SPACEX_AUTH[3]);
});

test('work authorization as statements: never guessed from one answer alone', () => {
  const d = p.decide([authRow()], authCtx('Yes', ''), null, null)[0];
  eq(d.action, p.ASK, '"any employer" vs "present employer only" is not settled by "Yes"');
  notOk(d.value);
});

test('work authorization Yes / No lists are unchanged', () => {
  const row = field('Are you legally authorized to work in the United States?', { kind: 'combobox', options: ['Yes', 'No'] });
  eq(p.decide([row], authCtx('Yes', 'No'), null, null)[0].value, 'Yes');
});

test('"How did you hear about us?" is always LinkedIn, whatever the profile holds', () => {
  const opts = ['Glassdoor', 'Careers site', 'Indeed', 'LinkedIn', 'Other (indicate below)'];
  const row = field('How did you hear about this job?*', { kind: 'combobox', options: opts });
  const ctx = { answerBank: Object.assign({}, BANK, { how_did_you_hear_about_us: 'Company website' }), hasResume: true };
  eq(p.decide([row], ctx, null, null)[0].value, 'LinkedIn');
});

test('no LinkedIn on the list: "External Agency"; neither: asked, never a referral or event', () => {
  const ask = opts => p.decide([field('How Did You Hear About Us?*', { kind: 'combobox', required: true, options: opts })],
                               CTX, null, null)[0];
  // Capital One's list (Oct 2026).
  const capOne = ask(['Capital One Event', 'College / University Recruiting', 'Contacted by Recruiter',
                      'Disability Event', 'External Agency', 'Employee Referral']);
  eq(capOne.value, 'External Agency');
  const none = ask(['Employee Referral', 'Career Fair', 'Other']);
  eq(none.action, p.ASK);
  notOk(none.value);
});

test('a Workday two-level prompt carries the LinkedIn hierarchy for the writer', () => {
  const d = p.decide([field('How Did You Hear About Us?*', { kind: 'combobox', required: true })], CTX, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'LinkedIn');
  eq(d.hierarchy.leaf, 'LinkedIn');
  eq(d.hierarchy.fallback, 'External Agency');
  ok(d.hierarchy.parents.includes('Job Posting Sites') && d.hierarchy.parents.includes('Social Platform'));
});

// Ashby (OpenAI, Oct 2026) asks the EEO questions as radio lists, not dropdowns.
// The same stored answers must take the same options either way.
const ASHBY_GENDER = ['Male', 'Female', 'Decline to self-identify'];
const ASHBY_RACE = ['Hispanic or Latino', 'White (Not Hispanic or Latino)',
  'Black or African American (Not Hispanic or Latino)',
  'Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)',
  'Asian (Not Hispanic or Latino)', 'American Indian or Alaska Native (Not Hispanic or Latino)',
  'Two or More Races (Not Hispanic or Latino)', 'Decline to self-identify'];
const ASHBY_VETERAN = ['I identify as one or more of the classifications of protected veteran listed above',
  'I am not a protected veteran', 'I decline to self-identify for protected veteran status'];
const radioRow = (label, opts) => field(label, { kind: 'radio', options: opts.map(o => ({ value: o, label: o })) });
const eeoCtx = over => ({ answerBank: Object.assign({}, BANK, over), hasResume: true });

test('EEO radio groups take the same options a dropdown would', () => {
  const ctx = eeoCtx({ gender: 'Cisgender man', race_ethnicity: 'South Asian',
                       veteran_status: 'I have never served in the military' });
  const [g, r, v] = p.decide([radioRow('Gender', ASHBY_GENDER), radioRow('Race', ASHBY_RACE),
                              radioRow('Veteran Status', ASHBY_VETERAN)], ctx, null, null);
  eq(g.value, 'Male');
  eq(r.value, 'Asian (Not Hispanic or Latino)');
  eq(v.value, 'I am not a protected veteran');
  for (const d of [g, r, v]) eq(d.action, p.FILL, d.label);
});

test('an EEO radio never takes the opposite answer through a "contains not" fallback', () => {
  const ctx = eeoCtx({ veteran_status: 'I identify as a protected veteran' });
  const d = p.decide([radioRow('Veteran Status', ASHBY_VETERAN)], ctx, null, null)[0];
  eq(d.value, ASHBY_VETERAN[0]);
});

test('an EEO radio decline maps onto the form\'s own decline', () => {
  const ctx = eeoCtx({ gender: 'Decline to self-identify' });
  eq(p.decide([radioRow('Gender', ASHBY_GENDER)], ctx, null, null)[0].value, 'Decline to self-identify');
});

test('a work-authorization radio worded "Yes, I am…" still fills as before', () => {
  const opts = ['Yes, I am authorized to work in the US', 'No, I am not authorized'];
  const ctx = eeoCtx({ authorized_to_work_in_country: 'Yes', requires_visa_sponsorship: '' });
  eq(p.decide([radioRow('Are you legally authorized to work in the US?', opts)], ctx, null, null)[0].value, opts[0]);
});

// A sensitive question holding the words of an ordinary field. This one holds
// "current" + "company" (current_company) AND "work authorization" (the
// authorized-to-work answer); only the sponsorship answer may answer it.
const SPONSOR_LONG = 'Will you require company sponsorship now or in the future to maintain or extend your current work authorization status?';
const yesNoRow = label => field(label, { kind: 'choice', required: true,
  options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }] });
const eligCtx = { answerBank: Object.assign({}, BANK,
  { authorized_to_work_in_country: 'Yes', requires_visa_sponsorship: 'No' }), hasResume: true };

test('a sponsorship question is answered from the sponsorship answer, whatever else it mentions', () => {
  const d = p.decide([yesNoRow(SPONSOR_LONG)], eligCtx, null, null)[0];
  eq(d.action, p.FILL, 'not "add your sponsorship answer to your profile" — it is there');
  eq(d.value, 'No', 'never the authorized-to-work "Yes"');
});

test('"require <company> to sponsor" is the sponsorship question too (Notion, Oct 2026)', () => {
  const d = p.decide([yesNoRow('Will you now or in the future require Notion to sponsor an immigration case in order to employ you?')],
                     eligCtx, null, null)[0];
  eq(d.action, p.FILL, 'not "add your sponsorship answer to your profile"');
  eq(d.value, 'No');
  eq(p.decide([yesNoRow('Will this company need to sponsor your visa?')], eligCtx, null, null)[0].value, 'No');
});

test('work-authorization questions still take the authorized-to-work answer', () => {
  eq(p.decide([yesNoRow('Are you legally authorized to work in the United States?')], eligCtx, null, null)[0].value, 'Yes');
  eq(p.decide([yesNoRow('Are you authorized to work in the US without sponsorship?')], eligCtx, null, null)[0].value, 'Yes');
});

// Snowflake (Ashby, Oct 2026): an export-control "U.S. person" question. Too long
// and too differently worded to read off the profile's citizenship status, so
// the person answers it once and that answer is reused for the same question.
const US_PERSON_Q = 'A “U.S. person” is a citizen, legal permanent resident, or legal temporary resident (i.e., a refugee or asylee) of the United States. Which of the following best describes your “U.S. person” status?';
const US_PERSON_OPTS = ['I am a U.S. person',
  'I am a citizen of Cuba, Iran, North Korea, or Syria AND I am NOT a U.S. person',
  'None of the above; I am a citizen of a different country'];

test('a saved "U.S. person" answer fills the same question', () => {
  const ctx = Object.assign({}, CTX, { savedSensitive: [{ question: US_PERSON_Q, answer: US_PERSON_OPTS[2] }] });
  const d = p.decide([radioRow(US_PERSON_Q, US_PERSON_OPTS)], ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, US_PERSON_OPTS[2]);
  eq(d.source, 'saved_answer');
});

test('"…AND I am NOT a U.S. person" is never read as a citizen\'s option', () => {
  notOk(p.citizenshipOption('U.S. citizen or national', US_PERSON_OPTS) === US_PERSON_OPTS[1]);
});

// Degree lists as employers serve them (Oct 2026). A degree tries its own
// spellings first, then its level — and never a different degree.
const NVIDIA_DEGREES = ['Select One', 'Post-diploma studies', 'BTECH', 'MTECH', 'MCA', 'University Diploma',
  'Associates', 'Technical/other training', 'Some college', 'PhD', 'Some post college', 'No Degree'];
const STRIPE_DEGREES = ["Associate's Degree", "Bachelor's Degree", 'Doctor of Medicine (M.D.)',
  'Doctor of Philosophy (Ph.D.)', "Engineer's Degree", 'High School', 'Juris Doctor (J.D.)',
  'Master of Business Administration (M.B.A.)', "Master's Degree"];

test('degree: its own spelling where offered, its level where not (Workday vs Greenhouse)', () => {
  const both = (deg, nvidia, stripe) => {
    eq(p.degreeOption(deg, NVIDIA_DEGREES), nvidia, `${deg} on Workday`);
    eq(p.degreeOption(deg, STRIPE_DEGREES), stripe, `${deg} on Greenhouse`);
  };
  both('B.Tech (Bachelor of Technology)', 'BTECH', "Bachelor's Degree");
  both('M.Tech (Master of Technology)', 'MTECH', "Master's Degree");
  both('MCA (Master of Computer Applications)', 'MCA', "Master's Degree");
  both('PhD (Doctor of Philosophy)', 'PhD', 'Doctor of Philosophy (Ph.D.)');
  both('MBA (Master of Business Administration)', null, 'Master of Business Administration (M.B.A.)');
  both("Associate's degree", 'Associates', "Associate's Degree");
  both('High School', null, 'High School');
  both('No degree', 'No Degree', null);
});

test('degree: older free text and resume wording pick the same as the dropdown', () => {
  eq(p.degreeOption('Bachelor of Technology (B.Tech)', NVIDIA_DEGREES), 'BTECH');
  eq(p.degreeOption('Bachelor of Technology in Chemical Engineering', STRIPE_DEGREES), "Bachelor's Degree");
  eq(p.degreeOption('B. Tech', NVIDIA_DEGREES), 'BTECH', 'punctuation and spaces do not matter');
});

test('degree: never a different degree or a different status', () => {
  eq(p.degreeOption('Some college', ['Some post college', 'No Degree']), null);
  notOk(['MTECH', "Master's Degree"].includes(p.degreeOption('B.Tech (Bachelor of Technology)', ['MTECH', "Master's Degree"])));
  eq(p.degreeOption('MD (Doctor of Medicine)', NVIDIA_DEGREES), null, 'an MD is not a PhD');
  eq(p.degreeOption('Diploma', NVIDIA_DEGREES), null, 'a diploma is not a University Diploma');
  eq(p.degreeOption('B.S. / B.Sc (Bachelor of Science)', NVIDIA_DEGREES), null, 'no bachelor\'s on that list: asked');
});

test('degree: candidates run most specific first', () => {
  const c = p.candidatesFor('degree', 'B.Tech (Bachelor of Technology)', {});
  ok(c.indexOf('BTech') < c.indexOf("Bachelor's Degree"), c.join(' | '));
});

test('degree dropdowns are read once, never searched by typing each spelling', () => {
  const row = field('Degree', { kind: 'combobox', options: [] });
  const ctx = { answerBank: Object.assign({}, BANK, { degree: 'B.Tech (Bachelor of Technology)' }) };
  const d = p.decide([row], ctx, null, null)[0];
  eq(d.readFirst && d.readFirst.key, 'degree');
});

test('skills split into one search each: trimmed, unique, capped at 10', () => {
  deepEq(p.splitSkills(' Python, SQL;Machine Learning | python\nDocker '),
         ['Python', 'SQL', 'Machine Learning', 'Docker']);
  eq(p.splitSkills(Array.from({ length: 14 }, (_, i) => `Skill ${i}`).join(', ')).length, 10);
});

test('Workday\'s "Type to Add Skills" plans the profile skills as a list', () => {
  const row = field('Type to Add Skills', { kind: 'combobox', multiPrompt: true });
  const ctx = { answerBank: Object.assign({}, BANK, { top_skills: 'Python, SQL, Docker' }) };
  const d = p.decide([row], ctx, null, null)[0];
  eq(d.action, p.FILL);
  deepEq(d.multiValues, ['Python', 'SQL', 'Docker']);
});

// ── nationality ──────────────────────────────────────────────

test('nationality fills from the stored answer only', () => {
  const ctx = { answerBank: Object.assign({}, BANK, { nationality: 'Indian' }), hasResume: true };
  const d = p.decide([field('Please indicate your nationality:*',
                            { kind: 'select', required: true,
                              options: ['Indian', 'American', 'British'] })],
                     ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'Indian');
  eq(d.sensitive, 'citizenship');
});

test('nationality is never guessed when the profile has none', () => {
  // The country, the phone's dial code and the address are all in this bank —
  // none of them may become a nationality.
  const d = one(field('Please indicate your nationality:*',
                      { kind: 'select', required: true, options: ['Indian', 'American'] }));
  notOk(d.value, `nothing may be written here (got ${d.value})`);
  eq(d.action, p.PROFILE);
});

test('"legally authorised to work" (British spelling) fills from the stored answer, not "add it to your profile"', () => {
  const ctx = { answerBank: Object.assign({}, BANK, { authorized_to_work_in_country: 'Yes' }), hasResume: true };
  const d = p.decide([field('Are you legally authorised to work in the country / territory in which this position is located?*',
                            { kind: 'select', required: true, options: ['Select One', 'Yes', 'No'] })], ctx, null, null)[0];
  eq(d.action, p.FILL, d.reason);
  eq(d.value, 'Yes');
});

// ── date and place of birth ──────────────────────────────────

const PWC_COUNTRIES = ['Bhutan', 'British Indian Ocean Territory', 'Brunei Darussalam', 'Iceland', 'India', 'Indonesia'];
const birthCtx = extra => ({ answerBank: Object.assign({}, BANK, extra), hasResume: true });

test('Country of Birth: the profile\'s, exactly; else the country of citizenship', () => {
  const row = () => field('Country / Territory of Birth*', { kind: 'combobox', required: true, options: PWC_COUNTRIES });
  eq(p.decide([row()], birthCtx({ country_of_birth: 'India' }), null, null)[0].value, 'India');
  // The older nationality wording: never "British Indian Ocean Territory".
  const d = p.decide([row()], birthCtx({ nationality: 'Indian' }), null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'India');
  eq(d.sensitive, 'birth');
});

test('a demonym against a country list never takes a country that merely holds the word', () => {
  eq(p.coerce('Indian', { kind: 'combobox', label: 'Country', options: PWC_COUNTRIES }), 'India');
  eq(p.coerce('Indian', { kind: 'combobox', label: 'Country', options: ['British Indian Ocean Territory', 'Iceland'] }), null);
});

test('options suffixed with their country are not a country list: "Single (India)" stays Single', () => {
  // PwC's Workday Marital Status: a saved "Single (India)" was filled as "Divorced (India)".
  const opts = ['Divorced (India)', 'Married (India)', 'Separated (India)', 'Single (India)', 'Widowed (India)'];
  eq(p.coerce('Single (India)', { kind: 'combobox', label: 'Marital Status*', options: opts }), 'Single (India)');
  eq(p.coerce('Married (India)', { kind: 'combobox', label: 'Marital Status*', options: opts }), 'Married (India)');
});

test('Workday\'s flat citizenship list "Status (Country)" takes the Citizen row of their country', () => {
  const opts = ['Citizen (Cambodia)', 'Permanent Resident (India)', 'Citizen (India)', 'Citizen (Singapore)'];
  const d = p.decide([field('Citizenship Status*', { kind: 'combobox', required: true, options: opts })],
                     { answerBank: Object.assign({}, BANK, { nationality: 'India' }), hasResume: true }, null, null)[0];
  eq(d.value, 'Citizen (India)');
  const onlyPr = p.decide([field('Citizenship Status*', { kind: 'combobox', required: true,
                                                          options: ['Permanent Resident (India)', 'Citizen (Cambodia)'] })],
                          { answerBank: Object.assign({}, BANK, { nationality: 'India' }), hasResume: true }, null, null)[0];
  notOk(onlyPr.value === 'Permanent Resident (India)', 'never a lone non-Citizen row');
});

test('Date of Birth fills from the profile only, and is never sent to the server', () => {
  const dob = () => field('Date of Birth*', { kind: 'date-parts', required: true });
  const d = p.decide([dob()], birthCtx({ date_of_birth: '1999-04-07' }), null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, '1999-04-07');
  const none = p.decide([dob()], CTX, null, null);
  eq(none[0].action, p.PROFILE);
  eq(p.fieldsForServer(none).length, 0, 'never offered to the model');
});

test('City of Birth with nothing stored points at the profile; Region of Birth is asked', () => {
  const [city, region] = p.decide([field('City of Birth*', { required: true }),
                                   field('Region of Birth', { kind: 'combobox' })], CTX, null, null);
  eq(city.action, p.PROFILE);
  eq(region.action, p.ASK);
  eq(p.fieldsForServer([city, region]).length, 0);
});

// ── citizenship by country ───────────────────────────────────

const citizen = (nationality, extra) => ({
  answerBank: Object.assign({}, BANK, { nationality }, extra || {}), hasResume: true,
});
const decideWith = (ctx, f) => p.decide([f], ctx, null, null)[0];
const YES_NO = ['Yes', 'No'];

test('a country list for "Citizenship Status" takes the country, not a U.S. sentence', () => {
  const d = decideWith(citizen('India', { citizenship_status: 'Not a U.S. citizen or permanent resident' }),
    field('Citizenship Status*', { kind: 'combobox', required: true,
                                   options: ['Afghanistan', 'Åland Islands', 'Albania', 'India', 'Indonesia'] }));
  eq(d.action, p.FILL);
  eq(d.value, 'India');
});

test('a Workday prompt not read yet is searched for the country, then its Citizen level', () => {
  const d = decideWith(citizen('India'), field('Citizenship Status*', { kind: 'combobox', required: true }));
  eq(d.action, p.FILL);
  eq(d.value, 'India');
  eq(d.drill, 'Citizen');
});

test('an older free-text "Indian" is read as India', () => {
  const d = decideWith(citizen('Indian'), field('Primary Nationality*', { kind: 'select', required: true,
                                                 options: ['Iceland', 'India', 'Indonesia'] }));
  eq(d.value, 'India');
});

test('a list of nationalities takes the nationality', () => {
  const d = decideWith(citizen('India'), field('Nationality', { kind: 'select',
                                                options: ['British', 'Indian', 'American'] }));
  eq(d.value, 'Indian');
});

test('"Are you a citizen of X?" compares X with the country of citizenship', () => {
  const ask = (label, nat) => decideWith(citizen(nat), field(label, { kind: 'radio', required: true, options: YES_NO }));
  eq(ask('Are you a citizen of Singapore?', 'India').value, 'No');
  eq(ask('Are you a citizen of India?', 'India').value, 'Yes');
  eq(ask('Are you a U.S. citizen?', 'India').value, 'No');
  eq(ask('Are you a US citizen?', 'United States').value, 'Yes');
  eq(ask('Do you hold Singaporean citizenship?', 'Singapore').value, 'Yes');
});

test('"U.S. citizen or permanent resident?" needs the U.S. status when the country is not the U.S.', () => {
  const label = 'Are you a U.S. citizen or permanent resident?';
  const row = () => field(label, { kind: 'radio', required: true, options: YES_NO });
  eq(decideWith(citizen('India'), row()).action, p.ASK, 'a country alone says nothing about a green card');
  eq(decideWith(citizen('India', { citizenship_status: 'U.S. lawful permanent resident (green card)' }), row()).value,
     'Yes');
  eq(decideWith(citizen('India', { citizenship_status: 'Not a U.S. citizen or permanent resident' }), row()).value,
     'No');
  eq(decideWith(citizen('United States'), row()).value, 'Yes');
});

test('a list of U.S. statuses is answered from the country when no U.S. status is set', () => {
  const d = decideWith(citizen('India'), citizenshipRow());
  eq(d.action, p.FILL);
  eq(d.value, '(f) Other (please explain)', 'an Indian citizen is none of (a)-(e)');
  eq(decideWith(citizen('United States'), citizenshipRow()).value,
     '(a) U.S. citizen or national of the United States');
});

test('a country list without the person\'s country is asked, never approximated', () => {
  const d = decideWith(citizen('India'), field('Country of citizenship', { kind: 'select',
                                               options: ['Iceland', 'Indonesia', 'Ireland'] }));
  eq(d.action, p.ASK);
  notOk(d.value);
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
    field('Why do you want to work here?', { kind: 'textarea' }),    // suggest (written by server)
    field('Have you used our product?', { required: true }),         // ask
    field('What is your gender?', { required: true }),               // profile (no stored)
    field('Resume/CV', { kind: 'file', documentSlot: 'resume' }),    // document
    field('Nothing we know', {}),                                   // skip
  ];
  const ctx = { answerBank: Object.assign({}, BANK, { gender: '' }), hasResume: true };
  const server = { answers: { 1: { value: 'Written for this job.', source: 'ai_written', confidence: 0.55 } } };
  const counts = p.summarize(p.decide(rows, ctx, server, null));
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

// ── gender / veteran / disability: the profile's short answer, the form's sentence ──

const GENDER_LIST = ['Cisgender woman', 'Cisgender man', 'Transgender woman', 'Transgender man',
  'Non-binary', 'Two-spirit', 'My gender identity is not listed', "I don't wish to answer"];
const MILITARY_LIST = ['I am on active duty', 'I am part of the national guard or on reserve',
  'I have never served in the military', 'I identify as a protected veteran',
  'I identify as a non-protected veteran', 'I identify in multiple military status categories',
  "I don't wish to answer"];
const DISABILITY_LIST = ['Yes, I have a disability', "No, I don't have a disability", "I don't wish to answer"];

function eeoRow(key, stored, options) {
  return { kind: 'combobox', label: key, options,
           candidates: p.candidatesFor(key, stored, {}), candidateKey: key };
}

test('gender: a stored "Male" / "Female" takes the form\'s cisgender wording', () => {
  eq(p.coerce('Male', eeoRow('gender', 'Male', GENDER_LIST)), 'Cisgender man');
  eq(p.coerce('Female', eeoRow('gender', 'Female', GENDER_LIST)), 'Cisgender woman');
  eq(p.coerce('Male', eeoRow('gender', 'Male', ['Male', 'Female', 'Decline'])), 'Male');
  eq(p.coerce('Female', eeoRow('gender', 'Female', ['Male', 'Female'])), 'Female');
});

test('gender: never crosses into a transgender or different option', () => {
  eq(p.coerce('Male', eeoRow('gender', 'Male', ['Transgender man', 'Female'])), null);
  eq(p.coerce('Non-binary', eeoRow('gender', 'Non-binary', GENDER_LIST)), 'Non-binary');
});

test('veteran: "Not a veteran" takes "never served", never a veteran option', () => {
  eq(p.coerce('Not a veteran', eeoRow('veteran_status', 'Not a veteran', MILITARY_LIST)),
     'I have never served in the military');
  eq(p.coerce('I am not a protected veteran',
              eeoRow('veteran_status', 'I am not a protected veteran', MILITARY_LIST)),
     'I have never served in the military');
  eq(p.coerce('Not a veteran', eeoRow('veteran_status', 'Not a veteran',
     ['I identify as a protected veteran', 'I identify as a non-protected veteran'])), null);
});

test('disability: "No disability" takes the "No, I don\'t…" option, never "Yes"', () => {
  eq(p.coerce('No disability', eeoRow('disability_status', 'No disability', DISABILITY_LIST)),
     "No, I don't have a disability");
  eq(p.coerce('No disability', eeoRow('disability_status', 'No disability',
     ['Yes, I have a disability', "I don't wish to answer"])), null);
  eq(p.coerce('Yes, I have a disability', eeoRow('disability_status', 'Yes, I have a disability',
     DISABILITY_LIST)), 'Yes, I have a disability');
});

test('EEO: a stored decline still maps onto this form\'s decline', () => {
  eq(p.coerce('Prefer not to say', eeoRow('disability_status', 'Prefer not to say', DISABILITY_LIST)),
     "I don't wish to answer");
});

// The profile page stores the most detailed option; coarser forms get the widened answer.
test('profile\'s detailed EEO answers widen onto coarser forms', () => {
  eq(p.coerce('Cisgender man', eeoRow('gender', 'Cisgender man', ['Male', 'Female', 'Decline to self-identify'])), 'Male');
  eq(p.coerce('Cisgender woman', eeoRow('gender', 'Cisgender woman', ['Male', 'Female'])), 'Female');
  const binaryVet = ['I am a protected veteran', 'I am not a protected veteran', "I don't wish to answer"];
  eq(p.coerce('I have never served in the military',
              eeoRow('veteran_status', 'I have never served in the military', binaryVet)),
     'I am not a protected veteran');
  eq(p.coerce('I identify as a non-protected veteran',
              eeoRow('veteran_status', 'I identify as a non-protected veteran', binaryVet)),
     'I am not a protected veteran');
  // ...but a non-protected veteran never becomes "never served".
  eq(p.coerce('I identify as a non-protected veteran',
              eeoRow('veteran_status', 'I identify as a non-protected veteran', MILITARY_LIST)),
     'I identify as a non-protected veteran');
  eq(p.coerce('I identify as a protected veteran',
              eeoRow('veteran_status', 'I identify as a protected veteran', binaryVet)),
     'I am a protected veteran');
  eq(p.coerce('Yes, I have a disability (or previously had a disability)',
              eeoRow('disability_status', 'Yes, I have a disability (or previously had a disability)',
                     ['Yes', 'No', 'Prefer not to say'])), 'Yes');
});

// ── motivation questions and conditional follow-ups ──────────

test('"Why Anthropic?" is written by the server for this job, never pasted from the profile', () => {
  const ctx = { answerBank: { why_do_you_want_this_role: 'I want to build.' } };
  const f = field('Why Anthropic?', { kind: 'textarea', required: true });
  const first = p.decide([f], ctx, null, null)[0];
  eq(first.action, p.ASK);
  eq(first.value, '', 'the stored sentence must not be used as the answer');
  const send = p.fieldsForServer([first]);
  eq(send.length, 1);
  eq(send[0].compose, true);
  const written = { answers: { 0: { value: 'At Acme I built…', source: 'ai_written', confidence: 0.55 } } };
  const second = p.decide([f], ctx, written, null)[0];
  eq(second.action, p.SUGGEST, 'written prose is always reviewed');
  eq(second.value, 'At Acme I built…');
});

test('motivation wordings are recognised; unrelated text fields are not', () => {
  for (const label of ['Why Anthropic?', 'Why Robinhood?*', 'Why do you want to work here?',
                       'Why are you interested in this role?', 'What excites you about this position?',
                       'Cover letter', 'What motivates you to apply?']) {
    eq(p.decide([field(label, { kind: 'textarea' })], CTX, null, null)[0].compose, true, label);
  }
  for (const label of ['Describe a project', 'Current company', 'LinkedIn Profile']) {
    notOk(p.decide([field(label)], CTX, null, null)[0].compose, label);
  }
});

test('"If you answered Yes above, please provide additional information" stays empty', () => {
  const ctx = { answerBank: Object.assign({}, BANK, { cover_letter: 'I want to build.' }) };
  const f = field('If you answered "Yes" to the above question, please provide additional information here:');
  const d = p.decide([f], ctx, null, null)[0];
  eq(d.action, p.SKIP);
  eq(d.value, '');
  eq(p.fieldsForServer([d]).length, 0, 'the model must never be asked to invent an explanation');
});

// Workday appends the country to every option and qualifies each non-Hispanic group.
const WD_RACE = [
  'American Indian or Alaska Native (Not Hispanic or Latino) (United States of America)',
  'Asian (Not Hispanic or Latino) (United States of America)',
  'Black or African American (Not Hispanic or Latino) (United States of America)',
  'Hispanic or Latino (United States of America)',
  'Two or More Races (Not Hispanic or Latino) (United States of America)',
  'White (Not Hispanic or Latino) (United States of America)',
];

test('ethnicity on Workday: the region suffix does not stop a stored answer from filling', () => {
  eq(p.coerce('South Asian', ethnicityRow('South Asian', WD_RACE)),
     'Asian (Not Hispanic or Latino) (United States of America)');
  eq(p.coerce('Black', ethnicityRow('Black', WD_RACE)),
     'Black or African American (Not Hispanic or Latino) (United States of America)');
  eq(p.coerce('White', ethnicityRow('White', WD_RACE)),
     'White (Not Hispanic or Latino) (United States of America)', '"(Not Hispanic…)" is not read as Hispanic');
  eq(p.coerce('Hispanic or Latino', ethnicityRow('Hispanic or Latino', WD_RACE)),
     'Hispanic or Latino (United States of America)');
});

test('Middle Eastern or North African is never recorded as Black', () => {
  eq(p.coerce('Middle Eastern or North African', ethnicityRow('Middle Eastern or North African', WD_RACE)), null,
     'no matching option: the person answers it');
  eq(p.coerce('Middle Eastern or North African', ethnicityRow('Middle Eastern or North African', RACE_LIST.concat(['Middle Eastern or North African']))),
     'Middle Eastern or North African');
});

const termsBox = label => field(label, { kind: 'checkbox', required: true, options: [{ value: 'on', label }] });

test('a terms / privacy checkbox is ticked from the profile permission, with no model', () => {
  const ctx = { answerBank: { accepts_employer_terms_and_privacy_policy: 'Yes' } };
  const d = p.decide([termsBox('By selecting the checkbox, you agree to our Terms and Conditions and Applicant Privacy Policy.*')], ctx, null, null)[0];
  eq(d.action, p.FILL);
  eq(d.value, 'yes');
  eq(p.fieldsForServer([d]).length, 0, 'never asked of the model');
});

test('with the permission off, a terms checkbox takes the usual consent path', () => {
  const d = p.decide([termsBox('I agree to the Terms of Service')], { answerBank: {} }, null, null)[0];
  notOk(d.source === 'profile', 'not ticked from a permission the person has not given');
  eq(p.fieldsForServer([d]).length, 1, 'asked of the server as before');
});

test('the terms permission does not tick marketing or talent-pool opt-ins', () => {
  const ctx = { answerBank: { accepts_employer_terms_and_privacy_policy: 'Yes' } };
  for (const label of ['I would like to receive marketing updates about future roles', 'Join our talent community']) {
    const d = p.decide([termsBox(label)], ctx, null, null)[0];
    notOk(d.action === p.FILL && d.source === 'profile', `${label} -> ${d.action}`);
  }
});

// Oracle Candidate Experience (jpmc.fa.oraclecloud.com): "Country code" beside
// the phone number, options worded "+91 (India)".
test('a phone "Country code" is answered from the stored phone, in the list\'s own wording', () => {
  const ctx = { answerBank: { phone: '+918240044652', address_country: 'India' } };
  const oracle = p.decide([field('Country code', { kind: 'combobox', required: true,
    options: ['+246 (British Indian Ocean Territory)', '+91 (India)', '+1 (United States)'] })], ctx, null, null)[0];
  eq(oracle.action, p.FILL);
  eq(oracle.value, '+91 (India)', 'not British Indian Ocean Territory');
  eq(p.fieldsForServer([oracle]).length, 0, 'no model involved');
  const workday = p.decide([field('Country Phone Code*', { kind: 'combobox', required: true,
    options: ['India (+91)', 'United States of America (+1)'] })], ctx, null, null)[0];
  eq(workday.value, 'India (+91)');
  const country = p.decide([field('Country', { kind: 'combobox', options: ['India', 'Canada'] })], ctx, null, null)[0];
  eq(country.value, 'India', 'a plain "Country" is still the country');
});

test('"Are you at least 18?" is always Yes, with no model; "under 18" is No; 21 is left alone', () => {
  const yn = { required: true, options: ['Yes', 'No'] };
  for (const kind of ['combobox', 'radio', 'choice']) {
    const d = one(field('Are you at least 18 years of age?*', Object.assign({ kind }, yn)));
    eq(d.action, p.FILL, kind);
    eq(d.value, 'Yes', kind);
    eq(d.source, 'standard');
    eq(p.fieldsForServer([d]).length, 0, 'never asked of the model');
  }
  eq(one(field('Are you under the age of 18?', Object.assign({ kind: 'combobox' }, yn))).value, 'No');
  const box = one(field('I confirm I am 18 years of age or older', { kind: 'checkbox', options: [{ value: 'on', label: 'x' }] }));
  eq(box.value, 'yes');
  notOk(one(field('Are you at least 21 years of age?', Object.assign({ kind: 'combobox' }, yn))).source === 'standard',
        '21 is not true of every applicant');
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

test("on Visa's own form, questions naming Visa are not visa-sponsorship questions", () => {
  // Every Visa question naming the company asked for "your sponsorship answer".
  const ctx = Object.assign({}, CTX, { jobCompany: 'Visa' });
  for (const label of [
    'I agree that Visa may reach out to me via SMS regarding my application and candidate experience. '
      + 'Message and data rates may apply. I can opt-out at any time.*',
    'Visa may use automated tools such as AI to support review of your application for this role, and if '
      + 'applicable, match you with relevant existing and future open roles.*']) {
    const d = p.decide([field(label, { kind: 'checkbox', required: true })], ctx, null, null)[0];
    notOk(d.sensitive, `${label.slice(0, 40)}… -> ${d.sensitive}`);
    notOk(/sponsorship/.test(d.reason || ''), d.reason);
  }
  ok(p.decide([field('Will you now or in the future require Visa sponsorship?', { kind: 'combobox', options: ['Yes', 'No'] })],
              ctx, null, null)[0].sensitive, 'a real sponsorship question still is one');
  // Without the employer it stays locked, as before.
  ok(p.decide([field('Visa may use automated tools such as AI to review your application.*', { kind: 'checkbox' })],
              CTX, null, null)[0].sensitive);
});

test('"I have read and consent to the above" is a terms agreement the profile permission ticks', () => {
  // Citi's Terms checkbox (Oct 2026) matched none of the terms phrasings.
  const label = 'Yes, I have read and consent to the above.*';
  ok(p.looksLikeTermsAgreement(label));
  const ctx = Object.assign({}, CTX, {
    answerBank: Object.assign({}, CTX.answerBank, { accepts_employer_terms_and_privacy_policy: 'Yes' }) });
  const d = p.decide([field(label, { kind: 'checkbox', options: [label], required: true })], ctx, null, null)[0];
  eq(d.action, p.FILL, `${d.action}: ${d.reason}`);
  eq(d.source, 'profile');
  // An opt-in is still not a terms agreement.
  notOk(p.looksLikeTermsAgreement('I have read and consent to receive SMS updates about future roles'));
});

test('an outside-employment question is always answered No', () => {
  const yn = label => field(label, { kind: 'combobox', options: ['Yes', 'No'], required: true });
  for (const label of [
    // Mastercard (Oct 2026) — its examples name government service.
    'Are you currently engaged in any outside employment or activity that you would like to continue if you are '
      + 'hired by Mastercard? [Examples of outside employment/activities include paid employment; service in any '
      + 'national, state or local government, including any government department, agency, or state-owned enterprise.]*',
    // Capital One.
    'Do you have a second job, outside business, or other employment that you will continue or that you plan to '
      + 'engage in while employed by Capital One? (This includes part-time jobs, contract work, consulting.)*',
    'Do you have any side business or moonlighting activity?']) {
    const d = p.decide([yn(label)], CTX, null, null)[0];
    eq(d.action, p.FILL, `${label.slice(0, 50)}… -> ${d.action}: ${d.reason}`);
    eq(d.value, 'No');
    notOk(d.sensitive);
  }
  // Not these.
  for (const label of ['Do you have any other work experience?', 'Do you have other employment offers?',
                       'Are you willing to travel for work?', 'Do you have experience in outside sales?']) {
    eq(p.outsideEmploymentAnswer(yn(label)), null, label);
  }
  // Only a Yes / No question.
  eq(p.outsideEmploymentAnswer(field('Do you have a second job?', { kind: 'combobox', options: ['Full-time', 'Part-time'] })), null);
});

test('government-official questions are answered from the profile, and only where it is sure', () => {
  // Walmart (Oct 2026): both paused auto-apply as "we never guess this".
  const WALMART_SELF = 'Are you (or have you been within the last 12 months) a Government Official? Government '
    + 'Official (GO) means any official or employee of any government agency, ministry or department of a '
    + 'government, including any person acting in official capacity for a government, regardless of rank or '
    + 'position; any official or employee of a company wholly or partially controlled by a government (e.g., a '
    + 'state-owned oil company), but excluding employees seconded to such companies; a political party or any '
    + 'official of one; any candidate for political office*';
  const WALMART_FAMILY = 'Are any of your immediate family members Government Officials (Any Official or Employee '
    + 'of any government department/agency; Company or Organization owned fully or partially by government or '
    + 'public institution)?*';
  const yn = label => field(label, { kind: 'combobox', options: ['Yes', 'No'], required: true });
  const run = (label, self, family) => {
    const bank = Object.assign({}, BANK);
    if (self) bank.is_government_official = self;
    if (family) bank.family_government_official = family;
    return p.decide([yn(label)], Object.assign({}, CTX, { answerBank: bank }), null, null)[0];
  };
  const expect = (label, self, family, action, value) => {
    const d = run(label, self, family);
    eq(d.sensitive, 'government_official', `${label.slice(0, 50)}… category`);
    eq(d.action, action, `${label.slice(0, 60)}… [${self}/${family}] -> ${d.action} ${d.value}: ${d.reason}`);
    if (value !== undefined) eq(d.value, value, label.slice(0, 60));
  };

  // No is true of every wording: the profile asks the broadest one.
  expect(WALMART_SELF, 'No', 'No', p.FILL, 'No');
  expect(WALMART_FAMILY, 'No', 'No', p.FILL, 'No');
  expect('Are you a government official?', 'No', undefined, p.FILL, 'No');
  expect('Do you currently hold or have you held, within the last 5 years, a position as a government official?', 'No', 'Yes', p.FILL, 'No');
  expect('Is your spouse a public official?', 'Yes', 'No', p.FILL, 'No');
  expect('Are you related to a government official?', 'Yes', 'No', p.FILL, 'No');
  expect('Do you have any relatives who are foreign officials?', 'Yes', 'No', p.FILL, 'No');
  // Each answer only for its own question: the self Yes never answers family.
  expect(WALMART_FAMILY, 'Yes', 'No', p.FILL, 'No');
  expect(WALMART_SELF, 'No', 'Yes', p.FILL, 'No');
  // Unset -> asked here (pointing at the profile), never a guess.
  expect(WALMART_SELF, undefined, undefined, p.ASK);
  expect(WALMART_FAMILY, 'No', undefined, p.ASK);

  // Yes only where the form asks the same open-ended question.
  expect('Have you ever been a government official?', 'Yes', 'No', p.FILL, 'Yes');
  expect('Has any member of your family ever been a government official?', 'No', 'Yes', p.FILL, 'Yes');
  expect('Are you currently a government official?', 'Yes', 'No', p.ASK);
  expect(WALMART_SELF, 'Yes', 'No', p.ASK);
  expect(WALMART_FAMILY, 'No', 'Yes', p.ASK);

  // Both people in one question: No only when both are No.
  expect('Are you or any of your relatives government officials?', 'No', 'No', p.FILL, 'No');
  expect('Are you or any of your relatives government officials?', 'Yes', 'No', p.ASK);
  expect('Are you or any of your relatives government officials?', 'No', 'Yes', p.ASK);

  // What the profile does not cover, or reads the other way round.
  expect('Do you have a close relative or business associate who is a government official?', 'No', 'No', p.ASK);
  expect('Are you a politically exposed person?', 'No', 'No', p.ASK);
  expect('I confirm that I am not a government official', 'No', 'No', p.ASK);
  expect('Government Official means any official or employee of a government agency.', 'No', 'No', p.ASK);
  // A follow-up box is never filled.
  const follow = p.decide([field('If yes, please provide the name of the government official', { required: false })],
    Object.assign({}, CTX, { answerBank: Object.assign({}, BANK, { is_government_official: 'No', family_government_official: 'No' }) }), null, null)[0];
  eq(follow.action, p.SKIP, `${follow.action}: ${follow.reason}`);
  // Never to the model, any of them.
  eq(p.fieldsForServer([run('Are you a government official?', undefined, undefined)]).length, 0);
});

test('ExxonMobil: board seat, drug treatment, bankruptcy, dismissal are always No; years from the date of birth', () => {
  const yn = label => field(label, { kind: 'combobox', options: ['Yes', 'No'], required: true });
  const bank = Object.assign({}, BANK, { date_of_birth: '1999-04-12', nationality: 'India', country_of_birth: '',
                                         full_name: 'Ada Lovelace' });
  const ctx = Object.assign({}, CTX, { answerBank: bank });
  const one_ = row => p.decide([row], ctx, null, null)[0];
  for (const label of [
    'Are you currently a member of the Board of Directors of any for-profit or non-profit organization?*',
    'Have you ever been treated for drug and/or alcohol abuse?*',
    'Has any bankruptcy action ever been taken against you?*',
    'Have you ever been dismissed from the services of any previous employer(s)?*',
  ]) {
    const d = one_(yn(label));
    eq(d.action, p.FILL, `${label} -> ${d.action}: ${d.reason}`);
    eq(d.value, 'No', label);
  }
  // Not chosen: the person's, or the resume's.
  for (const label of [
    'Do you have a relative and/or a personal relationship with someone who works at this company, an affiliate of this company, one of our vendors, or another oil company?',
    'Have you previously been interviewed for a position with ExxonMobil, Imperial or its affiliates?',
    'Are you bound by any bond to serve the Government, any Statutory Body or Organization?',
  ]) eq(p.standingNoAnswer(yn(label)), null, label);
  // A drug question no rule reads is never the model's.
  eq(m_.classifySensitive('Please describe any drug or alcohol treatment'), 'health');

  const yob = one_(field('What is your year of birth?*', { required: true }));
  eq(yob.sensitive, 'birth', 'never to the model');
  eq(yob.value, '1999', `${yob.action}: ${yob.reason}`);
  const since = one_(field('Year permanent residency or citizenship in that country/region began*', { required: true }));
  eq(since.value, '1999', `${since.action}: ${since.reason}`);
  // Born elsewhere: theirs to type.
  const abroad = p.decide([field('Year permanent residency or citizenship in that country/region began*', { required: true })],
    Object.assign({}, ctx, { answerBank: Object.assign({}, bank, { country_of_birth: 'Nepal' }) }), null, null)[0];
  eq(abroad.action, p.ASK);
  // A second citizenship's year is not the birth year.
  notOk(one_(field('Year you obtained this citizenship', { required: false })).value === '1999');

  const sig = one_(field('Typed Signature*', { required: true }));
  eq(sig.action, p.FILL, `${sig.action}: ${sig.reason}`);
  eq(sig.value, 'Ada Lovelace');
});

test('open to relocating or working on-site: always Yes, over the profile', () => {
  // Oct 2026: "…in-person in one of our offices 25% of the time?" got No.
  const yn = label => field(label, { kind: 'combobox', options: ['Yes', 'No'], required: true });
  const ctx = Object.assign({}, CTX, { answerBank: Object.assign({}, BANK,
    { willing_to_relocate: 'No', remote_work_preference: 'remote' }) });
  for (const label of [
    'Are you open to working in-person in one of our offices 25% of the time?*',
    'Are you open to relocation for this role? *',
    'Are you willing to relocate to Hyderabad?',
    'Are you comfortable working from the office 3 days a week?',
    'Would you be willing to work on-site in Bangalore?',
    'Are you able to work in a hybrid model?',
    'Are you willing to commute to our office?',
  ]) {
    const d = p.decide([yn(label)], ctx, null, null)[0];
    eq(d.action, p.FILL, `${label} -> ${d.action}: ${d.reason}`);
    eq(d.value, 'Yes', label);
  }
  // Facts and other questions are not willingness.
  for (const label of ['Will you require relocation assistance?', 'Are you currently located in Hyderabad?',
                       'Are you willing to travel 50% of the time?', 'Are you unable to work on-site?',
                       'Which office location do you prefer?']) {
    eq(p.willingToWorkThereAnswer(yn(label)), null, label);
  }
  eq(p.willingToWorkThereAnswer(field('Are you open to relocation?', { kind: 'combobox', options: ['Hyderabad', 'Bangalore'] })), null,
     'only a Yes / No question');
});

test('work eligibility and expected compensation in any wording read the profile\'s one answer', () => {
  // DoorDash (Oct 2026): both said "add … to your profile" — the profile held both.
  const bank = Object.assign({}, BANK, { expected_salary: '2500000', authorized_to_work_in_country: 'Yes',
                                         requires_visa_sponsorship: 'No' });
  const ctx = Object.assign({}, CTX, { answerBank: bank });
  const pay = p.decide([field('What is your expected total annual compensation?*', { required: true })], ctx, null, null)[0];
  eq(pay.action, p.FILL, `${pay.action}: ${pay.reason}`);
  eq(pay.value, '2500000');
  const eligible = p.decide([field('Please select from the options below, your current status regarding eligibility to work in India.*',
    { kind: 'select', required: true, options: ['Yes', 'No'] })], ctx, null, null)[0];
  eq(eligible.action, p.FILL, `${eligible.action}: ${eligible.reason}`);
  eq(eligible.value, 'Yes');
  // Never the expected salary for the current one.
  const current = p.decide([field('What is your current annual compensation?*', { required: true })], ctx, null, null)[0];
  notOk(current.action === p.FILL && current.value === '2500000', `${current.action} ${current.value}`);
});

test('"Have you worked at DoorDash?" answered in its own sentences', () => {
  const OPTS = ['I have not worked at DoorDash', 'I am a previous employee', 'I am a previous DoorDash Dasher'];
  const row = options => field('Have you worked at DoorDash?*', { kind: 'combobox', options, required: true });
  const never = p.decide([row(OPTS)], Object.assign({}, CTX, { jobCompany: 'DoorDash' }), null, null)[0];
  eq(never.action, p.FILL, `${never.action}: ${never.reason}`);
  eq(never.value, 'I have not worked at DoorDash');
  // Options not read yet: "No", and the writer re-picks it from the open list.
  const unread = p.decide([row([])], Object.assign({}, CTX, { jobCompany: 'DoorDash' }), null, null)[0];
  eq(unread.value, 'No');
  eq(unread.readFirst && unread.readFirst.key, 'previous_employer');
  // A previous employee — never "a previous Dasher", a courier.
  eq(p.previousEmployerOption('Yes', OPTS), 'I am a previous employee');
  eq(p.previousEmployerOption('No', ['Yes', 'No']), 'No');
  eq(p.previousEmployerOption('Yes', ['I am a previous Dasher', 'I have never worked here']), null);
});

test('EEO questions in any wording are answered from the profile, and remembered when it cannot', () => {
  // Oct 2026, one form: "What is your sex?" went to the model; "What is your
  // sexual orientation?" got the LGBTQ+ answer "No"; "Would you say you have a
  // disability?" matched no profile answer. None could be remembered.
  const pick = (label, options) => field(label, { kind: 'select', options, required: true });
  const decideWith = (row, bank, extra) => p.decide([row],
    Object.assign({}, CTX, { answerBank: Object.assign({}, BANK, bank) }, extra || {}), null, null)[0];

  const sex = decideWith(pick('What is your sex?', ['Male', 'Female', 'Prefer not to say']), { gender: 'Cisgender man' });
  eq(sex.sensitive, 'demographic', 'never to the model');
  eq(sex.action, p.FILL, `${sex.action}: ${sex.reason}`);
  eq(sex.value, 'Male');

  const ORIENTATION = ['Heterosexual/Straight', 'Gay', 'Lesbian', 'Bisexual', 'Prefer not to say'];
  const straight = decideWith(pick('What is your sexual orientation?', ORIENTATION), { lgbtq_identity: 'No' });
  eq(straight.action, p.FILL, `${straight.action}: ${straight.reason}`);
  eq(straight.value, 'Heterosexual/Straight');
  // "Yes" does not say which: theirs to answer — or their saved answer.
  eq(decideWith(pick('What is your sexual orientation?', ORIENTATION), { lgbtq_identity: 'Yes' }).action, p.ASK);
  const savedOrientation = decideWith(pick('What is your sexual orientation?', ORIENTATION), { lgbtq_identity: 'Yes' },
    { savedSensitive: [{ question: 'What is your sexual orientation?', answer: 'Bisexual' }] });
  eq(savedOrientation.value, 'Bisexual');
  // Transgender: LGBTQ+ "No" is No; "Yes" does not say.
  eq(decideWith(pick('Are you transgender?', ['Yes', 'No']), { lgbtq_identity: 'No' }).value, 'No');
  eq(decideWith(pick('Are you transgender?', ['Yes', 'No']), { lgbtq_identity: 'Yes' }).action, p.ASK);

  const DISABILITY = ['Yes, I have a disability (or previously had a disability)', "No, I don't have a disability", 'I do not want to answer'];
  for (const label of ['Would you say you have a disability?', 'Do you consider yourself to be disabled?']) {
    const dis = decideWith(pick(label, DISABILITY), { disability_status: "No, I don't have a disability" });
    eq(dis.action, p.FILL, `${label} -> ${dis.action}: ${dis.reason}`);
    eq(dis.value, "No, I don't have a disability");
  }
  // A spouse's service is not theirs to read off their veteran status.
  eq(decideWith(pick('Are you a military spouse?', ['Yes', 'No']), { veteran_status: 'I am not a protected veteran' }).action, p.ASK);

  // Remembered now — and used after the profile, never before it.
  ok(m_.STORABLE_SENSITIVE.has('demographic'));
  const unplaced = decideWith(pick('Which best describes you?  (EEO: veteran or not)', ['A', 'B']), {},
    { savedSensitive: [{ question: 'Which best describes you?  (EEO: veteran or not)', answer: 'B' }] });
  eq(unplaced.value, 'B', `${unplaced.action}: ${unplaced.reason}`);
  const profileWins = decideWith(pick('What is your sex?', ['Male', 'Female']), { gender: 'Cisgender man' },
    { savedSensitive: [{ question: 'What is your sex?', answer: 'Female' }] });
  eq(profileWins.value, 'Male', 'the profile, which they may have changed since, comes first');
});

test('criminal-history questions take the profile\'s No in any wording, and never touch consent', () => {
  const yn = label => field(label, { kind: 'combobox', options: ['Yes', 'No'], required: true });
  const run = (label, stored, f) => {
    const bank = Object.assign({}, BANK);
    if (stored) bank.has_criminal_history = stored;
    return p.decide([(f || yn)(label)], Object.assign({}, CTX, { answerBank: bank }), null, null)[0];
  };
  const expect = (label, stored, action, value, f) => {
    const d = run(label, stored, f);
    eq(d.sensitive, 'criminal', `${label.slice(0, 50)}… category`);
    eq(d.action, action, `${label.slice(0, 60)}… [${stored}] -> ${d.action} ${d.value}: ${d.reason}`);
    if (value !== undefined) eq(d.value, value, label.slice(0, 60));
  };

  // No answers every narrower wording.
  for (const label of [
    'Have you ever been convicted of a crime?*',
    'Have you been convicted of a felony in the last 7 years?',
    'Do you have any pending criminal charges?',
    'Have you ever been convicted of a felony or misdemeanor (not including minor traffic violations)?',
    'Have you ever been convicted of a criminal offense, other than a minor traffic violation?',
    'Have you been convicted of a crime that has not been sealed or expunged?',
    'Do you have a criminal record?',
    'Have you ever pleaded guilty to a criminal offence?',
  ]) expect(label, 'No', p.FILL, 'No');

  // Unset -> asked here; Yes -> the person, every time.
  expect('Have you ever been convicted of a crime?', undefined, p.ASK);
  expect('Have you ever been convicted of a crime?', 'Yes', p.ASK);

  // Not the person's record, or more than "convicted or charged".
  expect('Do you consent to a background check?', 'No', p.ASK);
  expect('Are you willing to undergo a criminal background check?', 'No', p.ASK);
  expect('Do you authorize us to obtain your criminal history record?', 'No', p.ASK);
  expect('Have you ever been arrested or convicted of a crime?', 'No', p.ASK);
  expect('Have you been convicted of a traffic offence?', 'No', p.ASK);
  expect('Has any member of your family been convicted of a crime?', 'No', p.ASK);
  expect('I certify that I have no criminal convictions', 'No', p.ASK);
  // A lone checkbox is a statement, never a Yes / No.
  expect('I have never been convicted of a crime', 'No', p.ASK, undefined,
    label => field(label, { kind: 'checkbox', options: [label], required: true }));
  // Its follow-up box is never filled.
  const follow = run('If yes, please explain the nature of the conviction', 'No',
    label => field(label, { required: false }));
  eq(follow.action, p.SKIP, `${follow.action}: ${follow.reason}`);
  eq(p.fieldsForServer([run('Have you ever been convicted of a crime?', undefined)]).length, 0);
});

test('a degree list worded by ISCED level takes the option at the same level', () => {
  // Visa's Workday list (Oct 2026): no option holds "Bachelor's Degree", so a
  // B.E. matched nothing and the Degree stayed "Select One".
  const VISA = ['Select One',
    'Below Upper-Secondary Education (ISCED 0–2: primary, lower-secondary; e.g., less than Grade 12, Year 13, Senior 6)',
    'High School or Upper-Secondary Completion (ISCED 3: High-School Diploma, A-Levels, IB Diploma, Abitur, Baccalauréat, Matura, GED)',
    'Post-Secondary Vocational Certificate or Diploma (ISCED 4: trade/technical school, apprenticeship, craftsman diploma)',
    'Other/Not Listed',
    'Associate or Equivalent Short-Cycle Tertiary Qualification (ISCED 5: Associate Degree, Higher National Diploma, DUT, Diploma of Higher Education)',
    'Bachelor’s or Equivalent First-Degree (ISCED 6: BA, BSc, BEng, LLB, etc.)',
    'Master of Business Administration - MBA ( (ISCED 7)',
    'Master’s or Equivalent Second-Degree (ISCED 7: MA, MSc, MEng, MPhil, professional licentiate)',
    'Juris Doctoral or Equivalent (JD)',
    'Doctoral or Equivalent Research Degree (ISCED 8: PhD, DPhil, EdD, MD-Res, professional doctorates)'];
  const pick = stored => p.coerce(stored, { kind: 'combobox', options: VISA.map(o => ({ value: o, label: o })),
    candidates: p.candidatesFor('degree', stored, {}), candidateKey: 'degree' });
  for (const s of ['Bachelor of Engineering', 'B.E.', 'B.Tech', "Bachelor's Degree"]) eq(pick(s), VISA[6], s);
  for (const s of ['M.Tech', 'M.Sc']) eq(pick(s), VISA[8], `${s}: the general master's, not the MBA`);
  eq(pick('MBA'), VISA[7], 'an MBA takes the MBA option');
  eq(pick('PhD'), VISA[10], 'a PhD takes ISCED 8, never the JD');
  eq(pick('High School'), VISA[2]);
  eq(pick('Associate Degree'), VISA[5]);
  // No single level: left for the model to choose, never a guess here.
  eq(pick('Diploma in Mechanical Engineering'), null);
  eq(pick('JD'), null);
});

await run('plan.js');
