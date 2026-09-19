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
