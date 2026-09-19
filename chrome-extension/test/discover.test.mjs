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

test('readComboboxOptions gives up quietly when no menu appears', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <div class="select__container"><input role="combobox" name="based"></div></form>`,
    async () => {
      const row = d.describeFields(d.findForm()).find(r => r.kind === 'combobox');
      deepEq(await d.readComboboxOptions(row), []);
    });
});

await run('discover.js');
