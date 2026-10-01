// src/autofill/discover.js against jsdom.
//
// jsdom has no layout, so getBoundingClientRect is all zeros — which is
// precisely the case isVisible() is documented to fail OPEN on. That means
// these tests cover form-root selection, field enumeration, grouping, key
// stability and the display:none/aria-hidden paths, and NOT geometric
// visibility. Geometry is the fixture pages' job (test/fixtures/*.html).
//
// Run: node test/discover.test.mjs

import { test, run, ok, notOk, eq, deepEq } from './harness.mjs';
import { mount } from './dom.mjs';
import * as d from '../src/autofill/discover.js';
import * as p from '../src/autofill/plan.js';
import * as fixtures from './fixtures.mjs';

/**
 * Run discover against a mounted document by installing it as the global.
 *
 * Async and awaited: an earlier sync version restored the globals as soon as
 * fn() returned its PROMISE, so any test with an await in it ran the rest of
 * its body against the wrong document — and a pending 500ms option-wait timer
 * then fired after teardown and crashed the run.
 */
async function withDoc(html, fn) {
  const env = mount(html);
  const saved = {
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    KeyboardEvent: globalThis.KeyboardEvent,
    probe: globalThis.__tcvFieldProbe,
  };
  globalThis.document = env.document;
  globalThis.MutationObserver = env.window.MutationObserver;
  globalThis.KeyboardEvent = env.window.KeyboardEvent;
  globalThis.__tcvFieldProbe = env.probe;
  try {
    return await fn(env);
  } finally {
    globalThis.document = saved.document;
    globalThis.MutationObserver = saved.MutationObserver;
    globalThis.KeyboardEvent = saved.KeyboardEvent;
    globalThis.__tcvFieldProbe = saved.probe;
  }
}

const GREENHOUSE = `
  <form id="application-form">
    <label for="fn">First Name *</label><input id="fn" name="first_name" required>
    <label for="ln">Last Name *</label><input id="ln" name="last_name" required>
    <label for="em">Email *</label><input id="em" name="email" type="email" required>
    <label for="ph">Phone</label><input id="ph" name="phone" type="tel">
    <label for="rz">Resume/CV *</label><input id="rz" name="resume" type="file" required>
    <label for="cl">Cover Letter</label><input id="cl" name="cover_letter" type="file">
    <button type="submit">Submit Application</button>
  </form>`;

const SEARCH_FORM = `
  <form role="search" action="/search">
    <input type="search" name="q"><input name="loc"><button type="submit">Go</button>
  </form>`;

// ── form root selection ──────────────────────────────────────

test('findForm picks a Greenhouse-shaped application form', async () => {
  await withDoc(GREENHOUSE, () => {
    const f = d.findForm();
    ok(f, 'no form found');
    eq(f.root.id, 'application-form');
    ok(f.isForm);
    ok(f.score >= 6, `score ${f.score}`);
  });
});

test('findForm ignores a search form', async () => {
  await withDoc(SEARCH_FORM, () => eq(d.findForm(), null));
});

test('findForm ignores a login form', async () => {
  await withDoc(`<form><input name="email"><input name="pw" type="password">
           <button type="submit">Sign in</button></form>`,
    () => eq(d.findForm(), null, 'a password field means this is not an application'));
});

test('findForm still ignores a sign-up box with a password', async () => {
  await withDoc(`<form><input name="name"><input name="email" type="email">
           <input name="pw" type="password"><input name="pw2" type="password">
           <button type="submit">Create account</button></form>`,
    () => eq(d.findForm(), null, 'account creation alone is not an application'));
});

// iCIMS candidate profile: the application and "create a password" in one form.
const ICIMS_PROFILE = `<form id="cp_form" action="/jobs/26696/candidate">
  <label for="fn">First Name *</label><input id="fn" name="PersonProfileFields.FirstName">
  <label for="ln">Last Name *</label><input id="ln" name="PersonProfileFields.LastName">
  <label for="em">Email *</label><input id="em" type="email" name="PersonProfileFields.Email">
  <label for="ph">Phone *</label><input id="ph" type="tel" name="PhoneNumber">
  <label for="ad">Address *</label><input id="ad" name="AddressStreet1">
  <label for="ci">City *</label><input id="ci" name="AddressCity">
  <label for="zp">Zip *</label><input id="zp" name="AddressZip">
  <label for="rs">Resume *</label><input id="rs" type="file" name="Resume">
  <label for="pw">Create a Password *</label><input id="pw" type="password" name="Password">
  <label for="pw2">Confirm Password *</label><input id="pw2" type="password" name="PasswordConfirm">
  <button type="submit">Next</button></form>`;

test('findForm finds an iCIMS application that also creates an account', async () => {
  await withDoc(ICIMS_PROFILE, () => {
    const f = d.findForm();
    ok(f, 'the candidate profile is an application, password or not');
    eq(f && f.root.id, 'cp_form');
  });
});

test('the password boxes in such a form are never filled', async () => {
  await withDoc(ICIMS_PROFILE, () => {
    const rows = d.describeFields(d.findForm());
    const pw = rows.filter(r => /password/i.test(r.label || ''));
    ok(pw.length >= 1, 'the password rows are described');
    const decisions = p.decide(rows, { answerBank: { first_name: 'Ada', email: 'ada@example.com' } }, null, null);
    for (const x of decisions.filter(x => /password/i.test(x.label || ''))) {
      eq(x.action, p.SKIP, x.label);
      eq(x.value, '', 'nothing written into a password box');
    }
  });
});

test('findForm ignores a newsletter signup', async () => {
  await withDoc(`<form class="newsletter-subscribe"><input name="email"><input name="name">
           <button type="submit">Subscribe</button></form>`,
    () => eq(d.findForm(), null));
});

test('findForm prefers the application form over a search box on the same page', async () => {
  await withDoc(SEARCH_FORM + GREENHOUSE, () => {
    const f = d.findForm();
    eq(f.root.id, 'application-form');
  });
});

// The live Greenhouse regression. Every one of these asserts a field that was
// silently missing from the panel, not merely filled wrongly: the phone
// field's country picker ships an <input type="search">, that vetoed the whole
// <form>, and discovery fell through to ONE of the two .application--questions
// sections — the custom questions. Nothing in the identity block was ever
// found, planned or reported.
test('findForm is not vetoed by a search box inside a field widget', async () => {
  await withDoc(fixtures.GREENHOUSE_REMIX, () => {
    const f = d.findForm();
    ok(f, 'no form found');
    eq(f.root.id, 'application-form',
       'a widget search box must not push the root down into one section');
    ok(f.root.contains(f.root.ownerDocument.getElementById('first_name')),
       'the identity block must be inside the root');
    ok(f.root.contains(f.root.ownerDocument.getElementById('question_1')),
       'the custom questions must be inside the same root');
  });
});

test('describeFields finds both Greenhouse question sections', async () => {
  await withDoc(fixtures.GREENHOUSE_REMIX, () => {
    const rows = d.describeFields(d.findForm());
    const ids = rows.map(r => (r.el && r.el.id) || '');
    for (const id of ['first_name', 'last_name', 'email', 'phone', 'country',
                      'resume', 'question_1', 'question_2', 'question_3']) {
      ok(ids.includes(id), `${id} was not discovered`);
    }
  });
});

test('a Greenhouse upload takes its name from its group, not the Attach button', async () => {
  await withDoc(fixtures.GREENHOUSE_REMIX, () => {
    const rows = d.describeFields(d.findForm());
    const resume = rows.find(r => r.el && r.el.id === 'resume');
    const cover = rows.find(r => r.el && r.el.id === 'cover_letter');
    ok(resume, 'no resume row');
    eq(resume.documentSlot, 'resume', 'the resume must not be left unattachable');
    eq(resume.label, 'Resume/CV*');
    ok(cover, 'no cover letter row');
    eq(cover.documentSlot, 'cover_letter');
    ok(resume.label !== cover.label, 'two uploads must not both read "Attach"');
  });
});

test('a real search form is still rejected', async () => {
  // The veto only loosened for a search input INSIDE something that is
  // otherwise plainly an application; a search box on its own still loses.
  await withDoc(`<form action="/search"><input type="search" name="q">
           <input name="loc"><button type="submit">Go</button></form>`,
    () => eq(d.findForm(), null, 'a two-field search box is not an application'));
  await withDoc(`<form class="job-filter"><input type="search" name="q">
           <input name="loc"><input name="radius"><input name="salary">
           <button type="submit">Filter</button></form>`,
    () => eq(d.findForm(), null, 'a filter bar names itself in its class'));
});

// Adobe's careers site (Phenom People). Copied in shape from the live page:
// the whole upload block sits ABOVE the <form> and inside no form at all, and
// its file input carries no id, no name, no accept and no label — the only
// thing naming it is the button next to it. Both of those had to be true for
// the resume to go unattached, and both are real.
const PHENOM_UPLOAD = `
<div class="apply-page">
  <div class="options-block">
    <div class="cloud-options">
      <div class="drives">
        <button type="button" class="linkedin-btn">Apply With LinkedIn</button>
        <div class="resume-upload-wrapper">
          <button type="button" class="upload-resume-btn" atm-id="resume-button">Upload Resume</button>
          <input type="file" autocomplete="off" tabindex="-1" style="display:none">
        </div>
      </div>
    </div>
  </div>
  <form class="rjsf">
    <label for="fn">First Name</label><input id="fn" name="first_name" required>
    <label for="ln">Last Name</label><input id="ln" name="last_name" required>
    <label for="em">Email</label><input id="em" name="email" type="email" required>
    <label for="ph">Phone</label><input id="ph" name="phone" type="tel">
    <button type="submit">Continue</button>
  </form>
</div>`;

test('an upload that sits outside the form is still found', async () => {
  await withDoc(PHENOM_UPLOAD, () => {
    const f = d.findForm();
    eq(f.root.className, 'rjsf', 'the form is still the root');
    const rows = d.describeFields(f);
    const upload = rows.find(r => r.kind === 'file');
    ok(upload, 'the resume upload must be enumerated even though it is outside the form');
    eq(upload.documentSlot, 'resume');
  });
});

test('a nameless upload is named by the button beside it', async () => {
  await withDoc(PHENOM_UPLOAD, () => {
    const rows = d.describeFields(d.findForm());
    const upload = rows.find(r => r.kind === 'file');
    eq(upload.label, 'Upload Resume',
       'not "Apply With LinkedIn", and not left unreadable');
    ok(upload.readable, 'an upload with no label is not an unreadable field');
  });
});

test('an upload belonging to another form is left alone', async () => {
  // Only uploads that belong to NO form are adopted — a profile-photo or
  // support-ticket upload elsewhere on the page is not part of this application.
  await withDoc(`<div>
      <form id="avatar"><input type="file" name="photo"><input name="alt"></form>
      <form id="application-form">
        <label for="a">First Name</label><input id="a" name="first_name">
        <label for="b">Email</label><input id="b" name="email" type="email">
        <label for="c">Phone</label><input id="c" name="phone" type="tel">
        <button type="submit">Submit</button>
      </form>
    </div>`, () => {
    const rows = d.describeFields(d.findForm());
    notOk(rows.some(r => r.kind === 'file'), 'an upload owned by another form is not ours');
  });
});

test('findForm never returns anything inside the TailorCV sidebar', async () => {
  await withDoc(`<div id="tailorcv-sidebar"><form><input name="a"><input name="b">
           <input name="c" type="email"></form></div>`,
    () => eq(d.findForm(), null, 'our own panel is not an application form'));
});

test('findForm falls back to a common ancestor when there is no <form>', async () => {
  await withDoc(`<div id="wrap"><div><label for="a">Name</label><input id="a" name="name"></div>
           <div><label for="b">Email</label><input id="b" name="email" type="email"></div>
           <div><label for="c">Phone</label><input id="c" name="phone" type="tel"></div></div>`,
    () => {
      const f = d.findForm();
      ok(f, 'a div-based form must still be found');
      ok(f.fields.length >= 3);
    });
});

test('findForm returns null on a page with no form at all', async () => {
  await withDoc('<article><h1>About us</h1><p>We are hiring.</p></article>',
    () => eq(d.findForm(), null));
});

test('findForm does not call a one-field box an application', async () => {
  await withDoc('<form><input name="email"><button type="submit">Go</button></form>',
    () => eq(d.findForm(), null, 'under two fields is not a form worth filling'));
});

test('isApplicationPage is the confident subset of findForm', async () => {
  await withDoc(GREENHOUSE, () => ok(d.isApplicationPage()));
  await withDoc(SEARCH_FORM, () => eq(d.isApplicationPage(), null));
});

// ── ATS detection ────────────────────────────────────────────

test('detectAts recognises the platforms we care about', async () => {
  eq(d.detectAts('https://job-boards.greenhouse.io/acme/jobs/123'), 'greenhouse');
  eq(d.detectAts('https://jobs.lever.co/acme/abc/apply'), 'lever');
  eq(d.detectAts('https://jobs.ashbyhq.com/acme/1234'), 'ashby');
  eq(d.detectAts('https://acme.wd1.myworkdayjobs.com/en-US/careers/job/x'), 'workday');
  eq(d.detectAts('https://jobs.smartrecruiters.com/acme/123'), 'smartrecruiters');
  eq(d.detectAts('https://apply.workable.com/j/ABC'), 'workable');
  eq(d.detectAts('https://careers.acme.com/apply'), 'generic');
});

// ── field descriptors ────────────────────────────────────────

test('describeFields returns one row per field with labels and required flags', async () => {
  await withDoc(GREENHOUSE, () => {
    const rows = d.describeFields(d.findForm());
    const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
    eq(rows.length, 6);
    // Keys are questionSignature(ident), so name="first_name" keys as
    // "first name" — the same normalisation the server registry uses.
    eq(byKey['first name'].label, 'First Name *');
    ok(byKey['first name'].required);
    notOk(byKey.phone.required);
    eq(byKey.email.hints.type, 'email');
    eq(byKey.resume.kind, 'file');
    eq(byKey.resume.documentSlot, 'resume');
    eq(byKey['cover letter'].documentSlot, 'cover_letter');
  });
});

test('describeFields collapses a radio group into one row with its options', async () => {
  await withDoc(`<form>
      <input name="x"><input name="y">
      <fieldset><legend>Are you authorized to work in the US?</legend>
        <label><input type="radio" name="auth" value="yes"> Yes</label>
        <label><input type="radio" name="auth" value="no"> No</label>
      </fieldset>
    </form>`, () => {
    const rows = d.describeFields(d.findForm());
    const auth = rows.find(r => r.key === 'auth');
    ok(auth, 'radio group not found');
    eq(auth.kind, 'radio');
    eq(auth.label, 'Are you authorized to work in the US?',
       'the group question, not one option label');
    eq(auth.members.length, 2);
    deepEq(auth.options.map(o => o.label), ['Yes', 'No']);
    eq(rows.filter(r => r.kind === 'radio').length, 1, 'two radios, one field');
  });
});

test('describeFields groups a nameless Workday-style radiogroup', async () => {
  await withDoc(`<form>
      <input name="x"><input name="y">
      <div role="radiogroup" aria-label="Do you require sponsorship?">
        <label><input type="radio" value="yes"> Yes</label>
        <label><input type="radio" value="no"> No</label>
      </div>
    </form>`, () => {
    const rows = d.describeFields(d.findForm());
    const radios = rows.filter(r => r.kind === 'radio');
    eq(radios.length, 1, 'a nameless group must still collapse to one field');
    eq(radios[0].label, 'Do you require sponsorship?');
    eq(radios[0].members.length, 2);
  });
});

test('describeFields carries native select options', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <label for="s">Where are you based?</label>
      <select id="s" name="based"><option value="">Select…</option>
        <option>USA</option><option>Canada</option><option>Located Elsewhere</option>
      </select></form>`, () => {
    const rows = d.describeFields(d.findForm());
    const sel = rows.find(r => r.key === 'based');
    eq(sel.kind, 'select');
    deepEq(sel.options.map(o => o.label), ['USA', 'Canada', 'Located Elsewhere']);
    notOk(sel.filled, 'sitting on the placeholder is not filled');
  });
});

test('describeFields keys are stable across a re-describe', async () => {
  await withDoc(GREENHOUSE, () => {
    const a = d.describeFields(d.findForm()).map(r => r.key);
    const b = d.describeFields(d.findForm()).map(r => r.key);
    deepEq(a, b);
  });
});

test('duplicate identities get distinct suffixed keys', async () => {
  await withDoc(`<form>
      <label for="c1">Company</label><input id="c1" name="company">
      <label for="c2">Company</label><input id="c2" name="company">
      <input name="other">
    </form>`, () => {
    const rows = d.describeFields(d.findForm());
    const keys = rows.map(r => r.key);
    eq(new Set(keys).size, keys.length, `keys must be unique: ${keys}`);
    ok(keys.includes('company') && keys.includes('company#2'));
  });
});

test('an unreadable field is reported, never silently dropped', async () => {
  await withDoc(`<form><input name="a"><input name="b"><input></form>`, () => {
    const rows = d.describeFields(d.findForm());
    const unreadable = rows.filter(r => !r.readable);
    eq(unreadable.length, 1, 'the identity-less input must appear as unreadable');
    eq(unreadable[0].kind, 'unknown');
  });
});

test('a submit button is never described as a field', async () => {
  await withDoc(GREENHOUSE, () => {
    const rows = d.describeFields(d.findForm());
    notOk(rows.some(r => (r.el.getAttribute('type') || '') === 'submit'));
    notOk(rows.some(r => /submit/i.test(r.label || '')));
  });
});

// ── visibility ───────────────────────────────────────────────

test('isVisible rejects a display:none wrapper', async () => {
  await withDoc(`<div style="display:none"><input name="a"></div>`, (env) => {
    notOk(d.isVisible(env.document.querySelector('[name=a]')));
  });
});

test('isVisible rejects an aria-hidden subtree', async () => {
  await withDoc(`<div aria-hidden="true"><input name="a"></div>`, (env) => {
    notOk(d.isVisible(env.document.querySelector('[name=a]')));
  });
});

test('isVisible rejects a disabled control', async () => {
  await withDoc('<input name="a" disabled>', (env) => {
    notOk(d.isVisible(env.document.querySelector('[name=a]')));
  });
});

test('isVisible accepts a hidden-by-design file input', async () => {
  // Greenhouse fronts the real input with an Attach button and hides it. It is
  // still the field, and set-files still works on it.
  await withDoc(`<div><input name="resume" type="file" style="display:none"></div>`, (env) => {
    ok(d.isVisible(env.document.querySelector('[name=resume]')),
       'a hidden file input must stay reachable');
  });
});

test('isVisible fails open when there is no layout to measure', async () => {
  // jsdom reports an all-zero rect for everything. Treating that as hidden
  // would return an empty field list on a real page whose layout we could not
  // read, which looks like a complete answer and is not one.
  await withDoc('<input name="a">', (env) => {
    ok(d.isVisible(env.document.querySelector('[name=a]')));
  });
});

test('describeFields excludes a hidden field from the form', async () => {
  await withDoc(`<form>
      <input name="a"><input name="b"><input name="c" type="email">
      <div style="display:none"><input name="secret_extra"></div>
    </form>`, () => {
    const rows = d.describeFields(d.findForm());
    notOk(rows.some(r => r.key === 'secret extra'));
  });
});

// ── shadow DOM ───────────────────────────────────────────────

test('fields inside an open shadow root are found and described', async () => {
  await withDoc('<form id="f"><input name="a"><input name="b"><div id="host"></div></form>',
    (env) => {
      const root = env.document.getElementById('host').attachShadow({ mode: 'open' });
      root.innerHTML = '<label for="s">Shadow Field</label><input id="s" name="shadow_field">';
      const rows = d.describeFields(d.findForm());
      ok(rows.some(r => r.key === 'shadow field'), rows.map(r => r.key).join(','));
    });
});

test('an unreadable closed shadow root is counted on the form', async () => {
  await withDoc('<form id="f"><input name="a"><input name="b"><x-w id="host"></x-w></form>',
    (env) => {
      env.document.getElementById('host')
         .attachShadow({ mode: 'closed' }).innerHTML = '<input name="nope">';
      const f = d.findForm();
      ok(f.opaqueHosts >= 1, 'the form must know it could not read everything');
    });
});

// ── reprobe ──────────────────────────────────────────────────

test('reprobe reads back the current value', async () => {
  await withDoc('<form><input name="a"><input name="b"><input name="c" type="email"></form>',
    (env) => {
      const rows = d.describeFields(d.findForm());
      const row = rows.find(r => r.key === 'a');
      notOk(d.reprobe(row).filled);
      env.document.querySelector('[name=a]').value = 'Ada';
      const after = d.reprobe(row);
      ok(after.filled);
      eq(after.value, 'Ada');
    });
});

test('reprobe reads a radio group as a whole', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <fieldset><legend>Authorized?</legend>
        <label><input type="radio" name="auth" value="yes"> Yes</label>
        <label><input type="radio" name="auth" value="no"> No</label>
      </fieldset></form>`, (env) => {
    const row = d.describeFields(d.findForm()).find(r => r.key === 'auth');
    notOk(d.reprobe(row).filled);
    env.document.querySelector('[value=yes]').checked = true;
    const after = d.reprobe(row);
    ok(after.filled);
    eq(after.value, 'Yes');
  });
});

test('reprobe re-resolves a field the framework replaced', async () => {
  await withDoc('<form id="f"><input name="a"><input name="b"><input name="c" type="email"></form>',
    (env) => {
      const row = d.describeFields(d.findForm()).find(r => r.key === 'a');
      // Simulate a React re-render: same logical field, brand new node.
      const old = env.document.querySelector('[name=a]');
      const fresh = env.document.createElement('input');
      fresh.setAttribute('name', 'a');
      fresh.value = 'Ada';
      old.replaceWith(fresh);
      notOk(row.el.isConnected, 'the stored handle is now stale');
      const after = d.reprobe(row);
      ok(after, 'a stale handle must be re-resolved, not give up');
      eq(after.value, 'Ada');
      eq(row.el, fresh, 'the row must now hold the live node');
    });
});

// ── custom dropdown option reading ───────────────────────────

test('readComboboxOptions reads an already-rendered listbox without clicking', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <div class="select__container">
        <input role="combobox" name="based" aria-controls="lb1">
      </div>
      <div id="lb1" role="listbox">
        <div role="option">USA</div><div role="option">Canada</div>
        <div role="option">Located Elsewhere</div>
      </div></form>`, async () => {
    const row = d.describeFields(d.findForm()).find(r => r.kind === 'combobox');
    ok(row, 'combobox not described');
    const opts = await d.readComboboxOptions(row);
    deepEq(opts, ['USA', 'Canada', 'Located Elsewhere']);
  });
});

test('readComboboxOptions opens a widget that renders its menu on click', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <div class="select__container"><input role="combobox" name="based"></div>
      <div id="portal"></div></form>`, async (env) => {
    const input = env.document.querySelector('[role=combobox]');
    input.addEventListener('click', () => {
      env.document.getElementById('portal').innerHTML =
        '<div role="listbox"><div role="option">Yes</div><div role="option">No</div></div>';
    });
    const row = d.describeFields(d.findForm()).find(r => r.kind === 'combobox');
    deepEq(await d.readComboboxOptions(row), ['Yes', 'No']);
  });
});

test('readComboboxOptions opens a react-select, which ignores a bare click', async () => {
  // react-select opens on MOUSEDOWN on its control and ignores events whose
  // target is the inner search input. clickOpen() sent only .click() on that
  // input, so the menu never opened, the read returned nothing, and the
  // sidebar offered a free-text box for a question with eight fixed answers.
  await withDoc(`<form><input name="x"><input name="y">
      <div class="select__container">
        <div class="select__control"><input role="combobox" name="maths"></div>
      </div>
      <div id="portal"></div></form>`, async (env) => {
    const doc = env.document;
    const input = doc.querySelector('[role=combobox]');
    const control = doc.querySelector('.select__control');
    control.addEventListener('mousedown', e => {
      if (e.target === input) return;          // as react-select does
      doc.getElementById('portal').innerHTML =
        '<div role="listbox"><div role="option">Cannot recall</div>' +
        '<div role="option">Top 10% at school</div></div>';
    });
    const row = d.describeFields(d.findForm()).find(r => r.kind === 'combobox');
    deepEq(await d.readComboboxOptions(row), ['Cannot recall', 'Top 10% at school']);
  });
});

test('readComboboxOptions gives up quietly when no menu appears', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <div class="select__container"><input role="combobox" name="based"></div></form>`,
    async () => {
      const row = d.describeFields(d.findForm()).find(r => r.kind === 'combobox');
      deepEq(await d.readComboboxOptions(row), []);
    });
});

await run('discover.js');
