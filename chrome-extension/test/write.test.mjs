// src/autofill/write.js — putting values into controls.
//
// Two halves. The plain-DOM half checks the event plumbing and the branch logic.
// The React half is the one that matters: it renders a real controlled component
// through react-dom and asserts the value both arrives AND survives the next
// render pass. A test against plain DOM cannot tell those apart, and the
// difference is exactly the bug that makes naive autofills appear to work and
// then submit empty forms.
//
// Run: node test/write.test.mjs

import { test, run, ok, notOk, eq } from './harness.mjs';
import { mount, polyfillFileApis } from './dom.mjs';
import { mountReact } from './react-host.mjs';
import * as w from '../src/autofill/write.js';
import * as d from '../src/autofill/discover.js';

/** Install a mounted jsdom document as the global, for the duration of fn. */
async function withDoc(html, fn) {
  const env = mount(html);
  polyfillFileApis(env.window);
  const saved = {};
  const names = ['document', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent',
                 'PointerEvent', 'DragEvent', 'DataTransfer', 'File',
                 'MutationObserver', 'HTMLInputElement', 'HTMLTextAreaElement',
                 'HTMLSelectElement', 'atob', 'probe'];
  for (const n of names) saved[n] = globalThis[n];
  globalThis.document = env.document;
  for (const n of names) {
    if (n !== 'document' && n !== 'probe' && env.window[n]) globalThis[n] = env.window[n];
  }
  globalThis.atob = env.window.atob.bind(env.window);
  globalThis.__tcvFieldProbe = env.probe;
  try {
    return await fn(env);
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete globalThis[n];
      else globalThis[n] = saved[n];
    }
    globalThis.__tcvFieldProbe = saved.probe;
  }
}

const rowFor = (env, selector, extra) => {
  const form = d.findForm(env.document);
  const rows = d.describeFields(form);
  const el = env.document.querySelector(selector);
  const row = rows.find(r => r.el === el || (r.members || []).includes(el));
  return Object.assign(row || {}, extra || {});
};

// ── plain DOM: event plumbing ────────────────────────────────

test('setText writes the value and fires input + change', async () => {
  await withDoc('<input name="a">', (env) => {
    const el = env.document.querySelector('[name=a]');
    const seen = [];
    for (const t of ['input', 'change']) el.addEventListener(t, () => seen.push(t));
    ok(w.setText(el, 'Ada'));
    eq(el.value, 'Ada');
    ok(seen.includes('input'), 'input must fire');
    ok(seen.includes('change'), 'change must fire');
  });
});

test('setText uses the prototype setter, not the instance property', async () => {
  // Emulating React's trick: shadow `value` on the instance. A naive
  // `el.value = x` writes the shadow and the real DOM value never changes.
  await withDoc('<input name="a">', (env) => {
    const el = env.document.querySelector('[name=a]');
    let shadow = '';
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return shadow; },
      set(v) { shadow = `SHADOWED:${v}`; },
    });
    w.setText(el, 'Ada');
    // The prototype setter bypassed the instance property entirely.
    const real = Object.getOwnPropertyDescriptor(
      env.window.HTMLInputElement.prototype, 'value').get.call(el);
    eq(real, 'Ada', 'the real DOM value must be set');
    notOk(String(shadow).startsWith('SHADOWED:Ada'),
          'the instance setter must not be the path used');
  });
});

test('setText clears an existing value rather than appending', async () => {
  await withDoc('<input name="a" value="old">', (env) => {
    const el = env.document.querySelector('[name=a]');
    w.setText(el, 'new');
    eq(el.value, 'new');
  });
});

test('typeText produces one input event per character', async () => {
  await withDoc('<input name="a">', async (env) => {
    const el = env.document.querySelector('[name=a]');
    let inputs = 0, keydowns = 0;
    el.addEventListener('input', () => inputs++);
    el.addEventListener('keydown', () => keydowns++);
    await w.typeText(el, 'abc');
    eq(el.value, 'abc');
    ok(inputs >= 3, `got ${inputs} input events`);
    eq(keydowns, 3);
  });
});

test('setSelect picks the matching option and fires change', async () => {
  await withDoc(`<select name="c"><option value="">Select…</option>
      <option value="in">India</option><option value="us">USA</option></select>`, (env) => {
    const el = env.document.querySelector('[name=c]');
    let changed = 0;
    el.addEventListener('change', () => changed++);
    ok(w.setSelect(el, 'India'));
    eq(el.value, 'in');
    eq(changed, 1);
  });
});

test('setSelect refuses a value no option matches', async () => {
  await withDoc(`<select name="c"><option value="us">USA</option>
      <option value="ca">Canada</option></select>`, (env) => {
    const el = env.document.querySelector('[name=c]');
    notOk(w.setSelect(el, 'Bhutan'), 'a non-match must not become a wrong selection');
    eq(el.value, 'us', 'and must not change anything');
  });
});

test('setCheckable clicks a radio rather than assigning checked', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <fieldset><legend>Authorized?</legend>
      <label><input type="radio" name="auth" value="y"> Yes</label>
      <label><input type="radio" name="auth" value="n"> No</label>
      </fieldset></form>`, (env) => {
    const row = rowFor(env, '[value=y]');
    let clicks = 0;
    for (const el of row.members) el.addEventListener('click', () => clicks++);
    ok(w.setCheckable(row, 'No'));
    ok(env.document.querySelector('[value=n]').checked, 'the No option must be checked');
    notOk(env.document.querySelector('[value=y]').checked);
    eq(clicks, 1, 'exactly one real click, not an assignment');
  });
});

test('setCheckable matches a statement-worded radio group by polarity', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <fieldset><legend>Work authorization</legend>
      <label><input type="radio" name="auth" value="a"> I am authorized to work in the US</label>
      <label><input type="radio" name="auth" value="b"> I am not authorized to work in the US</label>
      </fieldset></form>`, (env) => {
    const row = rowFor(env, '[value=a]');
    ok(w.setCheckable(row, 'I am not authorized to work in the US'));
    ok(env.document.querySelector('[value=b]').checked);
  });
});

test('setCheckable ticks a lone consent checkbox for yes and leaves it for no', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <label><input type="checkbox" name="tos"> I agree</label></form>`, (env) => {
    const row = rowFor(env, '[name=tos]');
    notOk(w.setCheckable(row, 'no'), 'no must not tick it');
    notOk(env.document.querySelector('[name=tos]').checked);
    ok(w.setCheckable(row, 'yes'));
    ok(env.document.querySelector('[name=tos]').checked);
  });
});

test('setCheckable is a no-op when already in the desired state', async () => {
  await withDoc(`<form><input name="x"><input name="y">
      <label><input type="checkbox" name="tos" checked> I agree</label></form>`, (env) => {
    const row = rowFor(env, '[name=tos]');
    let clicks = 0;
    row.members[0].addEventListener('click', () => clicks++);
    ok(w.setCheckable(row, 'yes'));
    eq(clicks, 0, 'clicking again would UNCHECK it');
  });
});

test('setContentEditable writes text and fires input', async () => {
  await withDoc('<div id="e" contenteditable="true" aria-label="Notes"></div>', (env) => {
    const el = env.document.getElementById('e');
    let inputs = 0;
    el.addEventListener('input', () => inputs++);
    w.setContentEditable(el, 'Dear team');
    eq((el.textContent || '').trim(), 'Dear team');
    ok(inputs >= 1);
  });
});

// ── file attach ──────────────────────────────────────────────

test('fileFromBase64 builds a real File', async () => {
  await withDoc('<input type="file" name="resume">', (env) => {
    void env;
    const file = w.fileFromBase64(globalThis.btoa('hello pdf'), 'ada.pdf', 'application/pdf');
    eq(file.name, 'ada.pdf');
    eq(file.type, 'application/pdf');
    ok(file.size > 0);
  });
});

test('attachFile puts the file on the input and fires change', async () => {
  await withDoc('<input type="file" name="resume">', (env) => {
    const el = env.document.querySelector('[name=resume]');
    let changed = 0;
    el.addEventListener('change', () => changed++);
    const file = w.fileFromBase64(globalThis.btoa('pdf bytes'), 'ada.pdf', 'application/pdf');
    ok(w.attachFile(el, file), 'the attach must report success');
    eq(el.files.length, 1);
    eq(el.files[0].name, 'ada.pdf');
    eq(changed, 1);
  });
});

test('attachFile works on an input the site has hidden', async () => {
  // Greenhouse fronts the real input with an Attach button and display:none's it.
  await withDoc('<div><input type="file" name="resume" style="display:none"></div>', (env) => {
    const el = env.document.querySelector('[name=resume]');
    const file = w.fileFromBase64(globalThis.btoa('x'), 'ada.pdf', 'application/pdf');
    ok(w.attachFile(el, file));
    eq(el.files.length, 1);
  });
});

test('dropFile dispatches a drop carrying the file', async () => {
  await withDoc('<div class="dropzone" id="z"></div>', (env) => {
    const zone = env.document.getElementById('z');
    let dropped = null;
    zone.addEventListener('drop', (e) => { dropped = e.dataTransfer; });
    const file = w.fileFromBase64(globalThis.btoa('x'), 'ada.pdf', 'application/pdf');
    ok(w.dropFile(zone, file));
    ok(dropped, 'a drop event must reach the zone');
    eq(dropped.files.length, 1);
    eq(dropped.files[0].name, 'ada.pdf');
  });
});

test('findDropZone finds an upload zone around the input', async () => {
  await withDoc('<div class="uppy-Dashboard"><div><input type="file" name="r"></div></div>',
    (env) => {
      const el = env.document.querySelector('[name=r]');
      ok(w.findDropZone(el), 'a drop-only uploader must be discoverable');
    });
});

test('findDropZone returns null for an ordinary file input', async () => {
  await withDoc('<form><input type="file" name="r"></form>', (env) => {
    eq(w.findDropZone(env.document.querySelector('[name=r]')), null);
  });
});

// ── custom combobox ──────────────────────────────────────────

test('commitCombobox opens, filters, and clicks the matching option', async () => {
  const html = `<form><input name="x"><input name="y">
    <div class="select__container">
      <div class="select__control"><input role="combobox" name="based"></div>
      <input type="hidden" name="based_value">
    </div>
    <div id="portal"></div></form>`;
  await withDoc(html, async (env) => {
    const doc = env.document;
    const input = doc.querySelector('[role=combobox]');
    const portal = doc.getElementById('portal');
    const ALL = ['USA', 'Canada', 'Located Elsewhere'];

    const renderMenu = () => {
      const q = (input.value || '').toLowerCase();
      const shown = ALL.filter(o => o.toLowerCase().includes(q));
      portal.innerHTML = '<div role="listbox">' + shown.map(o =>
        `<div role="option" data-v="${o}">${o}</div>`).join('') + '</div>';
      for (const node of portal.querySelectorAll('[role=option]')) {
        // react-select commits on MOUSEDOWN, which is why the writer fires a
        // full pointer sequence instead of just click().
        node.addEventListener('mousedown', () => {
          const control = doc.querySelector('.select__control');
          control.innerHTML =
            `<div class="select__singleValue">${node.dataset.v}</div>` + control.innerHTML;
          doc.querySelector('[name=based_value]').value = node.dataset.v;
          portal.innerHTML = '';
        });
      }
    };
    input.addEventListener('mousedown', renderMenu);
    input.addEventListener('input', renderMenu);

    const row = rowFor(env, '[role=combobox]');
    ok(await w.commitCombobox(row, 'Located Elsewhere'), 'commit must report success');
    eq(doc.querySelector('[name=based_value]').value, 'Located Elsewhere');
    eq(portal.innerHTML, '', 'the menu must be closed afterwards');
  });
});

test('options belonging to a closed widget are never read as this one’s', async () => {
  // Every Greenhouse form ships the intl-tel-input phone country picker, whose
  // 244 <li role="option"> rows sit in a display:none dropdown from first
  // paint. The option query has to sweep the whole document (react-select
  // portals its menu to <body>), so those rows were returned INSTANTLY for
  // every dropdown on the page: "Bachelor's Degree" was matched against a list
  // of countries, matched nothing, and the field reported "we could not get
  // this to stick". Degree, School, Discipline and every custom question on
  // the form failed the same way.
  const html = `<form><input name="x"><input name="y">
    <div class="iti__dropdown-content" style="display:none">
      <ul class="iti__country-list">
        <li class="iti__country" role="option">Afghanistan+93</li>
        <li class="iti__country" role="option">India+91</li>
      </ul>
    </div>
    <div class="select__container">
      <div class="select__control"><input role="combobox" name="degree"></div>
      <input type="hidden" name="degree_value">
    </div>
    <div id="portal"></div></form>`;
  await withDoc(html, async (env) => {
    const doc = env.document;
    const input = doc.querySelector('[role=combobox]');
    const portal = doc.querySelector('#portal');
    const renderMenu = () => {
      portal.innerHTML = '';
      for (const label of ["Associate's Degree", "Bachelor's Degree", 'Doctor of Medicine (M.D.)']) {
        const node = doc.createElement('div');
        node.setAttribute('role', 'option');
        node.dataset.v = label;
        node.textContent = label;
        portal.appendChild(node);
        node.addEventListener('mousedown', () => {
          const control = doc.querySelector('.select__control');
          control.innerHTML =
            `<div class="select__singleValue">${node.dataset.v}</div>` + control.innerHTML;
          doc.querySelector('[name=degree_value]').value = node.dataset.v;
          portal.innerHTML = '';
        });
      }
    };
    // ASYNC, like the real widget: the menu is not in the DOM on the tick the
    // options are first queried. That is what made the stale country rows
    // decisive in production — they were the only thing there to find.
    // 200ms: after the writer's settle wait, well inside optionWaitMs.
    const renderSoon = () => { env.window.setTimeout(renderMenu, 200); };
    input.addEventListener('mousedown', renderSoon);
    input.addEventListener('input', renderSoon);

    const row = rowFor(env, '[role=combobox]');
    ok(await w.commitCombobox(row, "Bachelor's Degree"),
       'the hidden country list must not be mistaken for these options');
    eq(doc.querySelector('[name=degree_value]').value, "Bachelor's Degree");
  });
});

test('typing a filter never blurs the dropdown it is filtering', async () => {
  // setText() blurs by default, because Workday and Formik validate on blur.
  // On a dropdown that is fatal: react-select closes its menu when the search
  // input loses focus, so the query was typed and the menu vanished before
  // anything could be picked. Live, this was "we could not get this to stick"
  // on every react-select on the page.
  const html = `<form><input name="x"><input name="y">
    <div class="select__container">
      <div class="select__control"><input role="combobox" name="race"></div>
      <input type="hidden" name="race_value">
    </div>
    <div id="portal"></div></form>`;
  await withDoc(html, async (env) => {
    const doc = env.document;
    const input = doc.querySelector('[role=combobox]');
    const portal = doc.querySelector('#portal');
    let open = false;
    const render = () => {
      open = true;
      portal.innerHTML = '';
      for (const label of ['Asian', 'Black or African', 'White / European']) {
        const node = doc.createElement('div');
        node.setAttribute('role', 'option');
        node.textContent = label;
        portal.appendChild(node);
        node.addEventListener('mousedown', () => {
          doc.querySelector('[name=race_value]').value = label;
          const control = doc.querySelector('.select__control');
          // PREPEND: the inner input must survive, or the row cannot be
          // re-probed and the commit check has nothing to read.
          control.innerHTML =
            `<div class="select__singleValue">${label}</div>` + control.innerHTML;
          portal.innerHTML = ''; open = false;
        });
      }
    };
    // The widget closes its menu on blur, exactly as react-select does. The
    // ORDER is what this test is about: the per-character fallback can reopen
    // a menu that a blur closed, which hides the bug in jsdom and made it
    // intermittent live. So assert the blur never happens at all while we are
    // filtering — not merely that the value landed in the end.
    const events = [];
    input.addEventListener('blur', () => { events.push('blur'); open = false; portal.innerHTML = ''; });
    input.addEventListener('mousedown', render);
    input.addEventListener('input', render);
    portal.addEventListener('mousedown', () => events.push('pick'), true);

    const row = rowFor(env, '[role=combobox]');
    ok(await w.commitCombobox(row, 'Asian'), 'the menu must still be open to pick from');
    eq(doc.querySelector('[name=race_value]').value, 'Asian');
    eq(events.indexOf('blur'), -1,
       `the search box must not be blurred while its menu is in use: ${events.join(',')}`);
    void open;
  });
});

test('a react-select is opened by its control, not its inner input', async () => {
  // Measured on a live Greenhouse form: pressing the inner search input left
  // the widget closed (aria-expanded="false", "options seen: Array(0)"), while
  // pressing the control opened it with its full list.
  const html = `<form><input name="x"><input name="y">
    <div class="select__container">
      <div class="select__control"><input role="combobox" name="degree"></div>
      <input type="hidden" name="degree_value">
    </div>
    <div id="portal"></div></form>`;
  await withDoc(html, async (env) => {
    const doc = env.document;
    const control = doc.querySelector('.select__control');
    const portal = doc.querySelector('#portal');
    let openedBy = '';
    const render = source => () => {
      if (!openedBy) openedBy = source;
      portal.innerHTML = '';
      const node = doc.createElement('div');
      node.setAttribute('role', 'option');
      node.textContent = "Bachelor's Degree";
      portal.appendChild(node);
      node.addEventListener('mousedown', () => {
        doc.querySelector('[name=degree_value]').value = "Bachelor's Degree";
        control.innerHTML =
          `<div class="select__singleValue">Bachelor's Degree</div>` + control.innerHTML;
        portal.innerHTML = '';
      });
    };
    // react-select's control handler returns early when the event target IS
    // its search input, which is why a press on the input left the live widget
    // closed ("options seen: Array(0)") even though the event bubbles.
    const input = doc.querySelector('[role=combobox]');
    control.addEventListener('mousedown', e => {
      if (e.target === input) return;
      render('control')();
    });

    const row = rowFor(env, '[role=combobox]');
    ok(await w.commitCombobox(row, "Bachelor's Degree"), 'the control must be pressed');
    eq(openedBy, 'control');
    eq(doc.querySelector('[name=degree_value]').value, "Bachelor's Degree");
  });
});

test('commitCombobox reports failure when nothing commits', async () => {
  const html = `<form><input name="x"><input name="y">
    <div class="select__container">
      <div class="select__control"><input role="combobox" name="based"></div>
    </div>
    <div id="portal"></div></form>`;
  await withDoc(html, async (env) => {
    // A widget that shows options but ignores every attempt to pick one — the
    // real Greenhouse EEO failure mode, where typed text stays visible and the
    // field stays required.
    const input = env.document.querySelector('[role=combobox]');
    input.addEventListener('mousedown', () => {
      env.document.getElementById('portal').innerHTML =
        '<div role="listbox"><div role="option">USA</div></div>';
    });
    const row = rowFor(env, '[role=combobox]');
    notOk(await w.commitCombobox(row, 'USA'), 'an uncommitted dropdown must not report success');
  });
});

test('commitCombobox searches with a short term, trying each shape, on a keystroke-only search box', async () => {
  // Oracle Candidate Experience: the City box searches only on real typing and
  // matches options by prefix. Retried with "Kolkata, West Bengal, India", the
  // old writer typed that whole string — no results — and the field stayed empty.
  const html = `<form><input name="x"><input name="y">
    <div class="oj-select-container">
      <input role="combobox" name="city" aria-expanded="false">
    </div>
    <div id="portal"></div></form>`;
  await withDoc(html, async (env) => {
    const input = env.document.querySelector('[role=combobox]');
    const portal = env.document.getElementById('portal');
    const CITIES = ['Kolkata, West Bengal', 'Kolhapur, Maharashtra'];
    input.addEventListener('input', (e) => {
      if (!e.inputType) return;                         // programmatic writes: ignored
      const q = input.value.toLowerCase();
      input.setAttribute('aria-expanded', 'true');
      portal.innerHTML = '<div role="listbox">' + CITIES.filter(c => c.toLowerCase().startsWith(q))
        .map(c => `<div role="option">${c}</div>`).join('') + '</div>';
      for (const o of portal.querySelectorAll('[role=option]')) {
        o.addEventListener('mousedown', () => {
          input.value = o.textContent;
          input.setAttribute('aria-expanded', 'false');
          portal.innerHTML = '';
        });
      }
    });
    const row = rowFor(env, '[role=combobox]');
    ok(await w.commitCombobox(row, 'Kolkata, West Bengal, India',
      ['Kolkata, West Bengal, India', 'Kolkata, West Bengal', 'Kolkata', 'West Bengal', 'India']),
      'found by searching "Kolkata", not the whole address');
    eq(input.value, 'Kolkata, West Bengal');
  });
});

// Oracle Candidate Experience State / City: the list opens UNFILTERED with only
// the rows in view drawn, and filters only on real keystrokes (City's results
// come back from the server a moment later). Programmatic text is ignored.
function wireOracleSelect(env, all, { remoteMs = 0 } = {}) {
  const input = env.document.querySelector('[role=combobox]');
  const portal = env.document.getElementById('portal');
  const draw = (items) => {
    input.setAttribute('aria-expanded', 'true');
    portal.innerHTML = '<div role="listbox">' + items.slice(0, 8)
      .map((c, i) => `<div role="option" class="${i === 0 ? 'oj-hover' : ''}">${c}</div>`).join('') + '</div>';
    for (const o of portal.querySelectorAll('[role=option]')) {
      o.addEventListener('mousedown', () => {
        input.value = o.textContent;
        input.setAttribute('aria-expanded', 'false');
        portal.innerHTML = '';
      });
    }
  };
  input.addEventListener('mousedown', () => draw(remoteMs ? [] : all));   // opens on the full list
  input.addEventListener('focus', () => draw(remoteMs ? [] : all));
  input.addEventListener('input', (e) => {
    if (!e.inputType) return;                                           // programmatic: ignored
    const q = input.value.toLowerCase();
    const hits = all.filter(c => c.toLowerCase().startsWith(q));
    if (remoteMs) setTimeout(() => draw(hits), remoteMs); else draw(hits);
  });
  return input;
}
const ORACLE_SELECT = `<form><input name="x"><input name="y">
  <div class="oj-select-container"><input role="combobox" name="s" aria-expanded="false"></div>
  <div id="portal"></div></form>`;
const STATES = ['Andaman & Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra & Nagar Haveli', 'Daman & Diu', 'Delhi', 'Goa', 'Gujarat',
  'Karnataka', 'Kerala', 'Maharashtra', 'Tamil Nadu', 'Uttar Pradesh', 'West Bengal'];

test('Oracle State: types when the open list does not offer the answer, and picks it', async () => {
  await withDoc(ORACLE_SELECT, async (env) => {
    const input = wireOracleSelect(env, STATES);
    const row = rowFor(env, '[role=combobox]');
    ok(await w.commitCombobox(row, 'Kolkata, West Bengal, India',
      ['Kolkata, West Bengal, India', 'West Bengal, India', 'West Bengal']), 'West Bengal selected');
    eq(input.value, 'West Bengal', 'never "Andhra Pradesh", the highlighted first row');
  });
});

test('Oracle City: waits for results that arrive after typing', async () => {
  await withDoc(ORACLE_SELECT, async (env) => {
    const input = wireOracleSelect(env, ['Kolkata, West Bengal', 'Kolhapur, Maharashtra'], { remoteMs: 300 });
    const row = rowFor(env, '[role=combobox]');
    ok(await w.commitCombobox(row, 'Kolkata, West Bengal, India',
      ['Kolkata, West Bengal, India', 'Kolkata, West Bengal', 'Kolkata']), 'Kolkata selected');
    eq(input.value, 'Kolkata, West Bengal');
  });
});

// The REAL Oracle markup, from a JPMC section 1 capture with City open: the
// list is a role="grid" drawn inside the field (not a listbox of options),
// rows of role="gridcell" whose text is split by a highlight span, filtered
// by the server a moment after each keystroke, committed by clicking a cell.
const ORACLE_CITY_REAL = `<form><input name="x"><input name="y">
  <div class="input-row input-row--has-picker geo-hierarchy-form-element">
    <label class="input-row__label cx-select__label" for="city-17"><span class="input-row__label-text">City <span aria-hidden="true">*</span></span></label>
    <div class="input-row__control-container"><div class="cx-select-container"><div class="input-field-container">
      <div class="input-field-container__left"><input autocomplete="none" name="city" id="city-17" type="text" role="combobox"
        aria-autocomplete="list" aria-haspopup="grid" aria-controls="city-17-listbox" aria-expanded="false" aria-required="true" class="cx-select-input"></div>
      <div class="input-field-container__right"><button type="button" id="city-17-toggle-button" tabindex="-1" aria-expanded="false" aria-controls="city-17-listbox" class="icon-dropdown-arrow"></button></div>
      <div id="city-17-modal"></div>
    </div></div></div>
  </div>
  <div role="grid" id="calendar-1" aria-label="Pick a date"><div role="row"><div role="gridcell">Kolkata, West Bengal</div></div></div>
</form>`;

function wireOracleGrid(env, all, { remoteMs = 0 } = {}) {
  const input = env.document.getElementById('city-17');
  const modal = env.document.getElementById('city-17-modal');
  const close = () => { input.setAttribute('aria-expanded', 'false'); modal.innerHTML = ''; };
  const draw = (items) => {
    input.setAttribute('aria-expanded', 'true');
    const q = input.value;
    modal.innerHTML = '<div class="cx-select__options"><div class="cx-select__listbox">'
      + '<div role="grid" id="city-17-listbox" aria-label="City" aria-busy="false" class="cx-select__list">'
      + items.slice(0, 30).map((c, i) => `<div role="row"><div tabindex="-1" role="gridcell" id="city-17-listitem-${i}" aria-selected="false" class="cx-select__list-item">`
        + `<div class="cx-select__list-item-container"><span class="cx-select__list-item--content">`
        + `<span class="highlight">${c.slice(0, q.length)}</span><span>${c.slice(q.length)}</span></span></div></div></div>`).join('')
      + '</div></div></div>';
    for (const cell of modal.querySelectorAll('[role=gridcell]')) {
      cell.addEventListener('click', () => { input.value = cell.textContent; close(); });
    }
  };
  input.addEventListener('focus', () => draw(remoteMs ? [] : all));
  input.addEventListener('input', (e) => {
    if (!e.inputType) return;                                           // programmatic: ignored
    const q = input.value.toLowerCase();
    const hits = all.filter(c => c.toLowerCase().startsWith(q));
    if (remoteMs) setTimeout(() => draw(hits), remoteMs); else draw(hits);
  });
  return input;
}

const CITIES = ['Kolabira, Odisha', 'Kolachal, Tamil Nadu', 'Kolaghat, West Bengal', 'Kolar, Karnataka',
  'Kolhapur, Maharashtra', 'Kolkata, West Bengal', 'Kollam, Kerala'];

test('Oracle City (real grid markup): reads the gridcells and picks Kolkata, not Kolaghat', async () => {
  await withDoc(ORACLE_CITY_REAL, async (env) => {
    const input = wireOracleGrid(env, CITIES, { remoteMs: 250 });
    const row = rowFor(env, '#city-17');
    ok(await w.commitCombobox(row, 'Kolkata, West Bengal, India',
      ['Kolkata, West Bengal, India', 'Kolkata, West Bengal', 'Kolkata']), 'Kolkata selected');
    eq(input.value, 'Kolkata, West Bengal');
  });
});

test('Oracle Country: a pick that shows as invalid for a moment, then redraws the field, is a success', async () => {
  // From a live run: India was clicked, the field stayed aria-invalid="true"
  // while Oracle loaded the address block, then the field was replaced by a new
  // node reading India. One early read called it a failure, and the repair
  // typed "+91" into Country.
  await withDoc(ORACLE_CITY_REAL, async (env) => {
    const doc = env.document;
    const input = wireOracleGrid(env, ['Iceland', 'India', 'Indonesia']);
    let typedAfterPick = false;
    doc.getElementById('city-17-modal').addEventListener('click', (e) => {
      const cell = e.target.closest && e.target.closest('[role=gridcell]');
      if (!cell) return;
      input.setAttribute('aria-invalid', 'true');                      // flagged a moment longer
      setTimeout(() => {
        const fresh = input.cloneNode(true);                            // the redraw
        fresh.value = cell.textContent.trim();
        fresh.setAttribute('aria-invalid', 'false');
        fresh.setAttribute('aria-expanded', 'false');
        fresh.addEventListener('input', () => { typedAfterPick = true; });
        input.replaceWith(fresh);
      }, 300);
    }, true);
    const row = rowFor(env, '#city-17');
    ok(await w.commitCombobox(row, 'India', ['India', '+91', 'India (+91)']), 'reported as committed');
    eq(doc.getElementById('city-17').value, 'India');
    notOk(typedAfterPick, 'nothing typed over the pick');
  });
});

test('a date picker\'s gridcells are never read as a dropdown\'s options', async () => {
  await withDoc(ORACLE_CITY_REAL, async (env) => {
    const cells = env.probe.optionNodes(env.document).map(n => n.textContent);
    eq(cells.length, 0, `read: ${cells.join(' | ')}`);
  });
});

test('Enter is never pressed on a highlighted row that is not the answer', async () => {
  await withDoc(ORACLE_SELECT, async (env) => {
    const input = wireOracleSelect(env, STATES.filter(s => s !== 'West Bengal'));
    let entered = false;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') entered = true; });
    const row = rowFor(env, '[role=combobox]');
    notOk(await w.commitCombobox(row, 'West Bengal', ['West Bengal']), 'nothing to pick');
    notOk(/Andhra|Andaman/.test(input.value), `wrong state committed: "${input.value}"`);
    void entered;
  });
});

test('commitCombobox refuses to replace a real answer with a decline', async () => {
  const html = `<form><input name="x"><input name="y">
    <div class="select__container"><div class="select__control">
      <div class="select__singleValue">I am not a protected veteran</div>
      <input role="combobox" name="vet">
    </div><input type="hidden" name="vet_v" value="no"></div></form>`;
  await withDoc(html, async (env) => {
    const row = rowFor(env, '[role=combobox]');
    row.value = 'I am not a protected veteran';
    ok(await w.commitCombobox(row, 'I prefer not to answer'),
       'reported as success so the field is not retried');
    eq(env.document.querySelector('[name=vet_v]').value, 'no', 'and nothing changed');
  });
});

// ── applyDecision: verification ──────────────────────────────

test('a phone the widget reformats is not a mismatch', async () => {
  // intl-tel-input rewrites a number as it is typed. We wrote the national
  // number the form asked for and it came back spaced, so verification called
  // it a mismatch, the repair sweep wrote the E.164 form into a box that
  // already had a +91 picker beside it, and the person was left with
  // "+91 82400 44652" rejected in red.
  await withDoc(`<form><input name="a"><input name="phone" type="tel"></form>`, async (env) => {
    const el = env.document.querySelector('[name=phone]');
    el.addEventListener('input', () => {
      const digits = String(el.value || '').replace(/\D/g, '');
      if (digits.length === 10) el.value = digits.slice(0, 5) + ' ' + digits.slice(5);
    });
    const row = rowFor(env, '[name=phone]');
    const res = await w.applyDecision({ row, value: '8240044652' });
    ok(res.ok, `spacing is not disagreement (outcome ${res.outcome}, shown ${res.shown})`);
    eq(res.outcome, 'ok');
  });
});

test('a phone shown with its dial code is the same number', async () => {
  await withDoc(`<form><input name="a"><input name="phone" type="tel"></form>`, async (env) => {
    const el = env.document.querySelector('[name=phone]');
    el.addEventListener('input', () => {
      const digits = String(el.value || '').replace(/\D/g, '');
      if (digits.length === 10) el.value = '+91 ' + digits;
    });
    const row = rowFor(env, '[name=phone]');
    const res = await w.applyDecision({ row, value: '8240044652' });
    ok(res.ok, `a widget adding the country code agrees with us (${res.shown})`);
  });
});

test('a different phone number is still a mismatch', async () => {
  await withDoc(`<form><input name="a"><input name="phone" type="tel"></form>`, async (env) => {
    const el = env.document.querySelector('[name=phone]');
    el.addEventListener('input', () => { el.value = '9999999999'; });
    const row = rowFor(env, '[name=phone]');
    const res = await w.applyDecision({ row, value: '8240044652' });
    notOk(res.ok, 'a genuinely different number must still be reported');
    eq(res.outcome, 'mismatch');
  });
});

test('a value restated as another of its shapes is accepted', async () => {
  // A dial-code picker sent "India" displays "+91". That is the widget
  // agreeing with us, and "+91" is one of the shapes we offered it.
  await withDoc(`<form><input name="a"><input name="country"></form>`, async (env) => {
    const el = env.document.querySelector('[name=country]');
    el.addEventListener('input', () => { if (/india/i.test(el.value)) el.value = '+91'; });
    const row = rowFor(env, '[name=country]');
    const res = await w.applyDecision({ row, value: 'India', candidates: ['India', '+91'] });
    ok(res.ok, `outcome ${res.outcome}, shown ${res.shown}`);
  });
});

test('applyDecision reports ok when the value lands', async () => {
  await withDoc('<form><input name="a"><input name="b"></form>', async (env) => {
    const row = rowFor(env, '[name=a]');
    const res = await w.applyDecision({ row, value: 'Ada' });
    ok(res.ok);
    eq(res.outcome, 'ok');
    eq(res.shown, 'Ada');
  });
});

test('applyDecision reports rejected when the form invalidates the value', async () => {
  await withDoc(`<form><input name="b">
      <div class="field"><input name="phone">
        <div class="error">Phone number is too long</div></div></form>`, async (env) => {
    const row = rowFor(env, '[name=phone]');
    const res = await w.applyDecision({ row, value: '+246 8240044652' });
    notOk(res.ok);
    eq(res.outcome, 'rejected', 'a value the form is rejecting is not a success');
  });
});

test('applyDecision reports mismatch when the page shows something else', async () => {
  await withDoc('<form><input name="b"><input name="a"></form>', async (env) => {
    const el = env.document.querySelector('[name=a]');
    // A field that rewrites whatever is put in it.
    el.addEventListener('input', () => {
      if (el.value !== 'Augusta') {
        Object.getOwnPropertyDescriptor(env.window.HTMLInputElement.prototype, 'value')
          .set.call(el, 'Augusta');
      }
    });
    const row = rowFor(env, '[name=a]');
    const res = await w.applyDecision({ row, value: 'Ada' });
    notOk(res.ok);
    eq(res.outcome, 'mismatch');
    eq(res.shown, 'Augusta');
  });
});

test('applyDecision reports empty when nothing landed', async () => {
  await withDoc('<form><input name="b"><input name="a"></form>', async (env) => {
    const el = env.document.querySelector('[name=a]');
    const setter = Object.getOwnPropertyDescriptor(
      env.window.HTMLInputElement.prototype, 'value').set;
    // A control that discards every write, like a React field whose state never
    // updates. Both the whole-value write and the per-character retry are undone.
    el.addEventListener('input', () => setter.call(el, ''));
    const row = rowFor(env, '[name=a]');
    const res = await w.applyDecision({ row, value: 'Ada' });
    notOk(res.ok);
    eq(res.outcome, 'empty');
  });
});

test('applyDecision needs no value to refuse', async () => {
  await withDoc('<form><input name="a"><input name="b"></form>', async (env) => {
    const row = rowFor(env, '[name=a]');
    const res = await w.applyDecision({ row, value: '' });
    notOk(res.ok);
    eq(res.outcome, 'failed');
  });
});

// ── REAL React: the tests that actually matter ───────────────

test('a React controlled input accepts the write AND keeps it across a render', async () => {
  const host = await mountReact((React) => {
    return function Form() {
      const [first, setFirst] = React.useState('');
      return React.createElement('form', { id: 'f' },
        React.createElement('label', { htmlFor: 'fn' }, 'First Name'),
        React.createElement('input', {
          id: 'fn', name: 'first_name', value: first,
          onChange: e => setFirst(e.target.value),
        }),
        React.createElement('input', { name: 'other', defaultValue: '' }),
        React.createElement('input', { name: 'third', type: 'email', defaultValue: '' }),
      );
    };
  });
  try {
    const el = host.document.getElementById('fn');
    w.setText(el, 'Ada');
    await host.flush();
    eq(el.value, 'Ada', 'React must have accepted the value');
    // The real test: force another render. If React never saw the change, its
    // state is still '' and this pass wipes the field.
    await host.rerender();
    eq(el.value, 'Ada', 'the value must SURVIVE React re-rendering');
  } finally {
    await host.restore();
  }
});

test('setText reaches React state, which a raw assignment is not guaranteed to', async () => {
  // The distinction that matters is whether REACT'S OWN STATE was updated, not
  // just the DOM node — a value React does not know about is gone the moment
  // anything re-renders, and is not in the payload on submit.
  //
  // Asserted on state rather than on el.value: whether a raw `el.value = x`
  // plus a synthetic input event happens to reach React's change tracker varies
  // by React version (19 in this test tolerates it; the React 16/17 builds
  // still common on ATS forms do not). setText does not depend on that
  // tolerance, and this test pins the property we actually rely on.
  let observed = null;
  const host = await mountReact((React) => {
    return function Form() {
      const [v, setV] = React.useState('');
      observed = v;
      return React.createElement('form', null,
        React.createElement('input', {
          id: 'fn', name: 'first_name', value: v,
          onChange: e => setV(e.target.value),
        }),
        React.createElement('input', { name: 'b', defaultValue: '' }),
      );
    };
  });
  try {
    const el = host.document.getElementById('fn');
    eq(observed, '', 'state starts empty');
    w.setText(el, 'Ada');
    await host.flush();
    eq(observed, 'Ada', "React's own state must hold the value, not just the DOM");
    await host.rerender();
    eq(el.value, 'Ada');
  } finally {
    await host.restore();
  }
});

test('base64ToBytes decodes without depending on a host global', () => {
  const bytes = w.base64ToBytes('aGVsbG8gcGRm');
  eq(String.fromCharCode(...bytes), 'hello pdf');
  // Padding variants and a real binary prefix (%PDF-1.4 plus a high byte).
  eq(w.base64ToBytes('YQ==').length, 1);
  eq(w.base64ToBytes('YWI=').length, 2);
  eq(w.base64ToBytes('YWJj').length, 3);
  eq(w.base64ToBytes('').length, 0);
  const pdf = w.base64ToBytes('JVBERi0xLjQK/w==');
  eq(pdf[0], 0x25, '%');
  eq(pdf[pdf.length - 1], 0xff, 'a high byte must survive intact');
});

test('a React controlled textarea accepts the write', async () => {
  const host = await mountReact((React) => {
    return function Form() {
      const [v, setV] = React.useState('');
      return React.createElement('form', null,
        React.createElement('textarea', {
          id: 'ta', name: 'why', value: v, onChange: e => setV(e.target.value),
        }),
        React.createElement('input', { name: 'b', defaultValue: '' }),
      );
    };
  });
  try {
    const el = host.document.getElementById('ta');
    w.setText(el, 'Because the product is good.');
    await host.flush();
    await host.rerender();
    eq(el.value, 'Because the product is good.');
  } finally {
    await host.restore();
  }
});

test('a React controlled select accepts the write', async () => {
  const host = await mountReact((React) => {
    return function Form() {
      const [v, setV] = React.useState('');
      return React.createElement('form', null,
        React.createElement('select', {
          id: 'sel', name: 'based', value: v, onChange: e => setV(e.target.value),
        },
          React.createElement('option', { value: '' }, 'Select…'),
          React.createElement('option', { value: 'usa' }, 'USA'),
          React.createElement('option', { value: 'else' }, 'Located Elsewhere')),
        React.createElement('input', { name: 'b', defaultValue: '' }),
      );
    };
  });
  try {
    const el = host.document.getElementById('sel');
    ok(w.setSelect(el, 'Located Elsewhere'));
    await host.flush();
    await host.rerender();
    eq(el.value, 'else', 'the selection must survive React re-rendering');
  } finally {
    await host.restore();
  }
});

test('a React controlled checkbox is ticked by the click path', async () => {
  const host = await mountReact((React) => {
    return function Form() {
      const [on, setOn] = React.useState(false);
      return React.createElement('form', null,
        React.createElement('label', { htmlFor: 'tos' }, 'I agree to the terms'),
        React.createElement('input', {
          id: 'tos', name: 'tos', type: 'checkbox', checked: on,
          onChange: e => setOn(e.target.checked),
        }),
        React.createElement('input', { name: 'b', defaultValue: '' }),
      );
    };
  });
  try {
    const el = host.document.getElementById('tos');
    const row = { key: 'tos', el, members: [el], kind: 'checkbox', label: 'I agree', options: [] };
    ok(w.setCheckable(row, 'yes'));
    await host.flush();
    await host.rerender();
    ok(el.checked, 'the tick must survive React re-rendering');
  } finally {
    await host.restore();
  }
});

test('a React controlled radio group answers No without touching Yes', async () => {
  const host = await mountReact((React) => {
    return function Form() {
      const [v, setV] = React.useState('');
      const radio = (value, label) => React.createElement('label', { key: value },
        React.createElement('input', {
          type: 'radio', name: 'auth', value, checked: v === value,
          onChange: e => setV(e.target.value),
        }), label);
      return React.createElement('form', null,
        React.createElement('fieldset', null,
          React.createElement('legend', null, 'Are you authorized to work in the US?'),
          radio('y', 'Yes'), radio('n', 'No')),
        React.createElement('input', { name: 'b', defaultValue: '' }),
      );
    };
  });
  try {
    const members = Array.from(host.document.querySelectorAll('[name=auth]'));
    const row = {
      key: 'auth', el: members[0], members, kind: 'radio',
      label: 'Are you authorized to work in the US?', options: [],
    };
    ok(w.setCheckable(row, 'No'));
    await host.flush();
    await host.rerender();
    ok(members[1].checked, 'No must be selected');
    notOk(members[0].checked, 'Yes must not be');
  } finally {
    await host.restore();
  }
});

test('applyDecision verifies a React field through the probe', async () => {
  const host = await mountReact((React) => {
    return function Form() {
      const [v, setV] = React.useState('');
      return React.createElement('form', { id: 'f' },
        React.createElement('label', { htmlFor: 'em' }, 'Email'),
        React.createElement('input', {
          id: 'em', name: 'email', type: 'email', value: v,
          onChange: e => setV(e.target.value),
        }),
        React.createElement('input', { name: 'b', defaultValue: '' }),
        React.createElement('input', { name: 'c', type: 'tel', defaultValue: '' }),
      );
    };
  });
  try {
    const form = d.findForm(host.document);
    ok(form, 'the React form must be discoverable');
    const rows = d.describeFields(form);
    const row = rows.find(r => r.key === 'email');
    ok(row, `email row not found in ${rows.map(r => r.key).join(',')}`);
    const res = await w.applyDecision({ row, value: 'ada@example.com' });
    ok(res.ok, JSON.stringify(res));
    eq(res.outcome, 'ok');
    await host.rerender();
    eq(host.document.getElementById('em').value, 'ada@example.com');
  } finally {
    await host.restore();
  }
});

await run('write.js');
