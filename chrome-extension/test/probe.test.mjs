// field_probe.js against a real DOM.
//
// The Python suite (test_field_registry.py) stubs the browser call and feeds
// canned JSON, so it proves how the *result* is consumed and nothing about
// whether the JS produces the right result in the first place. That gap is
// exactly how "a dozen fields collapsing onto one identity" and "a filled
// field the form was rejecting counted as done" reached production. These are
// the tests for the JS itself.
//
// Run: node test/probe.test.mjs

import { test, run, ok, notOk, eq, deepEq } from './harness.mjs';
import { mount, describe1 } from './dom.mjs';

// ── identity and labels ──────────────────────────────────────

test('label comes from a label[for] pointing at the input', () => {
  const d = describe1(
    '<label for="fn">First Name</label><input id="fn" name="first_name">', '#fn');
  eq(d.label, 'First Name');
  eq(d.ident, 'first_name');   // name wins over label for identity
  eq(d.kind, 'text');
});

test('aria-label wins over everything else', () => {
  const d = describe1('<input aria-label="Email Address" id="e">', '#e');
  eq(d.label, 'Email Address');
  eq(d.ident, 'Email Address');  // no name/id-free fallback: label is the ident
});

test('aria-labelledby is joined across ids', () => {
  const d = describe1(
    '<span id="a">Phone</span><span id="b">Number</span>' +
    '<input aria-labelledby="a b" name="ph">', '[name=ph]');
  eq(d.label, 'Phone Number');
});

test('an ancestor label supplies the label', () => {
  const d = describe1('<label>Why this role?<textarea name="why"></textarea></label>',
                      'textarea');
  eq(d.label, 'Why this role?');
  eq(d.kind, 'textarea');
});

test('a fieldset legend labels a control with nothing closer', () => {
  const d = describe1(
    '<fieldset><legend>Work Authorization</legend><input name="wa"></fieldset>', '[name=wa]');
  eq(d.label, 'Work Authorization');
});

test('placeholder is the last resort', () => {
  const d = describe1('<input name="z" placeholder="you@example.com">', '[name=z]');
  eq(d.label, 'you@example.com');
});

test('a field with no stable identity is dropped entirely', () => {
  // No name, no id, no label, no placeholder => no ident => null, so the caller
  // can never skip it as "already filled".
  const d = describe1('<input>', 'input');
  eq(d, null);
});

// ── the multi-control refusal ────────────────────────────────

test('a wrapper holding several controls resolves to no field', () => {
  // This is the guard that stopped a page-level container giving a dozen
  // distinct fields the identity of whichever control came first.
  const { document, probe } = mount(
    '<div id="app"><input name="a"><input name="b"><input name="c"></div>');
  eq(probe.control(document.getElementById('app')), null);
});

test('a wrapper holding exactly one control resolves to it', () => {
  const { document, probe } = mount(
    '<div class="field"><input name="only"></div>');
  const el = probe.control(document.querySelector('.field'));
  ok(el);
  eq(el.getAttribute('name'), 'only');
});

test('a label[for] pointing at nothing still finds its inner control', () => {
  const { document, probe } = mount(
    '<label for="missing">Name<input name="inner"></label>');
  const el = probe.control(document.querySelector('label'));
  eq(el.getAttribute('name'), 'inner');
});

// ── radio / checkbox groups ──────────────────────────────────

test('a radio group is ONE logical field keyed on its shared name', () => {
  const html = `
    <fieldset><legend>Are you authorized to work?</legend>
      <label><input type="radio" name="auth" value="y"> Yes</label>
      <label><input type="radio" name="auth" value="n"> No</label>
    </fieldset>`;
  const { document, probe } = mount(html);
  const all = [...document.querySelectorAll('input')].map(el => probe.describeEl(el));
  eq(all[0].ident, 'auth');
  eq(all[1].ident, 'auth');     // same identity => one field, not two
  eq(all[0].kind, 'radio');
  notOk(all[0].filled);
});

test('a checked radio reports the checked member label as the value', () => {
  const html = `
    <label><input type="radio" name="auth" value="y" checked> Yes</label>
    <label><input type="radio" name="auth" value="n"> No</label>`;
  const { document, probe } = mount(html);
  const d = probe.describeEl(document.querySelector('input'));
  ok(d.filled);
  eq(d.value, 'Yes');
});

test('an unchecked consent checkbox is not filled', () => {
  const d = describe1(
    '<label><input type="checkbox" name="tos"> I agree to the terms</label>',
    '[name=tos]');
  eq(d.kind, 'checkbox');
  notOk(d.filled);
});

// ── native select ────────────────────────────────────────────

test('a select on its placeholder option is NOT filled', () => {
  const html = `<label for="s">Country</label><select id="s" name="country">
      <option value="">Select…</option><option value="IN">India</option></select>`;
  const d = describe1(html, '#s');
  eq(d.kind, 'select');
  notOk(d.filled, 'an empty value must not count as filled');
  eq(d.value, 'Select…');   // displayed text is still reported
});

test('a select with a real selection is filled', () => {
  const html = `<select name="country">
      <option value="">Select…</option><option value="IN" selected>India</option></select>`;
  const d = describe1(html, 'select');
  ok(d.filled);
  eq(d.value, 'India');
});

test('optionsFor drops the placeholder and keeps real options', () => {
  const html = `<select name="c">
      <option value="">Select…</option>
      <option value="">--</option>
      <option value="US">United States</option>
      <option value="IN">India</option></select>`;
  const d = describe1(html, 'select');
  deepEq(d.options, [
    { value: 'US', label: 'United States' },
    { value: 'IN', label: 'India' },
  ]);
});

test('an option with no value attribute falls back to its label', () => {
  const d = describe1('<select name="c"><option>Yes</option></select>', 'select');
  deepEq(d.options, [{ value: 'Yes', label: 'Yes' }]);
});

test('optionsFor is null for anything that is not a native select', () => {
  const d = describe1('<input name="t">', 'input');
  eq(d.options, null);
});

// ── react-select shaped comboboxes ───────────────────────────

const RS_COMMITTED = `
  <div class="select__container">
    <div class="select__control">
      <div class="select__singleValue">United States</div>
      <input role="combobox" name="rs" aria-haspopup="listbox">
    </div>
    <input type="hidden" name="country_code" value="US">
  </div>`;

test('a committed react-select reads its value from the wrapper, not the input', () => {
  // The inner input is CLEARED on commit, so reading it would report empty for
  // a field that plainly shows a value.
  const d = describe1(RS_COMMITTED, '[role=combobox]');
  eq(d.kind, 'combobox');
  eq(d.value, 'United States');
  ok(d.filled);
  eq(d.ident, 'country_code');   // the hidden input's name is the stable identity
});

test('a react-select on its placeholder is not filled', () => {
  const html = `
    <div class="select__container"><div class="select__control">
      <div class="select__placeholder">Select…</div>
      <input role="combobox" name="rs">
    </div></div>`;
  const d = describe1(html, '[role=combobox]');
  eq(d.kind, 'combobox');
  eq(d.value, '');
  notOk(d.filled);
});

test('an OPEN menu must not be read as the field value', () => {
  // Falling through to the container's text here would return the whole option
  // list as the value — and since that list contains the option we just asked
  // for, the did-it-commit check would match and call an uncommitted dropdown
  // a success.
  const html = `
    <div class="select__container"><div class="select__control">
      <input role="combobox" name="rs">
      <div class="select__menu">
        <div role="option">I am a veteran</div>
        <div role="option">I am not a veteran</div>
      </div>
    </div></div>`;
  const d = describe1(html, '[role=combobox]');
  eq(d.value, '');
  notOk(d.filled);
});

test('rsContainer never climbs past the widget onto a page wrapper', () => {
  // A page-level <div class="application-container"> matches the same class
  // regex. Climbing to it would give every text input on the form the FIRST
  // react-select's value and identity.
  const { document, probe } = mount(`
    <div class="application-container">
      ${RS_COMMITTED}
      <input name="plain_text" id="pt">
    </div>`);
  const plain = document.getElementById('pt');
  eq(probe.rsContainer(plain), null, 'a plain input must not adopt a widget wrapper');
  const d = probe.describeEl(plain);
  eq(d.kind, 'text');
  eq(d.value, '');
  eq(d.ident, 'plain_text');
});

// ── invalid / rejected values ────────────────────────────────

test('aria-invalid marks a field as rejected', () => {
  const d = describe1('<input name="p" value="+246 8240044652" aria-invalid="true">',
                      '[name=p]');
  ok(d.invalid);
  ok(d.filled, 'the probe still reports the raw filled state; the caller collapses it');
});

test('a sibling error node inside the field wrapper marks it rejected', () => {
  // Greenhouse's actual mechanism: custom validation rendering an error node
  // next to the input rather than setting aria-invalid.
  const html = `<div class="field">
      <input name="phone" value="+246 8240044652">
      <div class="error">Phone number is too long</div>
    </div>`;
  const d = describe1(html, '[name=phone]');
  ok(d.invalid);
});

test('a FORM-level error banner does not condemn every field', () => {
  const html = `<form>
      <div role="alert">Please fix the errors below</div>
      <div class="field"><input name="ok_field" value="Ada"></div>
    </form>`;
  const d = describe1(html, '[name=ok_field]');
  notOk(d.invalid, 'a page-level banner must not mark unrelated fields invalid');
});

test('an empty required field is not invalid merely for being empty', () => {
  const d = describe1('<input name="r" required>', '[name=r]');
  notOk(d.invalid);
  notOk(d.filled);
});

// ── required detection ───────────────────────────────────────

test('the required attribute is detected', () => {
  ok(describe1('<input name="a" required>', '[name=a]').required);
});

test('aria-required is detected', () => {
  ok(describe1('<input name="a" aria-required="true">', '[name=a]').required);
});

test('an asterisk in the label marks a field required', () => {
  const d = describe1('<label for="a">First Name *</label><input id="a" name="a">', '#a');
  ok(d.required);
});

test('"(required)" in the label marks a field required', () => {
  const d = describe1('<label for="a">Resume (required)</label><input id="a" name="a">', '#a');
  ok(d.required);
});

test('a required marker node in the field wrapper is detected', () => {
  const html = `<div class="field">
      <label for="a">Email</label><abbr title="required">*</abbr><input id="a" name="a">
    </div>`;
  ok(describe1(html, '#a').required);
});

test('a plain optional field is not required', () => {
  notOk(describe1('<label for="a">Website</label><input id="a" name="a">', '#a').required);
});

test('a form-level "* required" legend does not mark every field required', () => {
  const html = `<form>
      <p class="required-note">Fields marked * are required</p>
      <div class="field"><label for="a">Website</label><input id="a" name="a"></div>
    </form>`;
  notOk(describe1(html, '#a').required);
});

// ── contenteditable ──────────────────────────────────────────

test('a contenteditable editor is described by its text', () => {
  const html = '<label for="c">Cover letter</label>' +
               '<div id="c" contenteditable="true" aria-label="Cover letter">Dear team</div>';
  const { document, probe } = mount(html);
  const d = probe.describeEl(document.getElementById('c'));
  eq(d.kind, 'contenteditable');
  eq(d.value, 'Dear team');
  ok(d.filled);
});

// ── describeAll / selector resolution (the Python entry point) ──

test('describeAll zips positionally and nulls the unresolvable', () => {
  const { probe } = mount('<input name="a" value="1"><input name="b">');
  const out = probe.describeAll([
    ['css', '[name=a]'],
    ['css', '[name=nope]'],
    ['css', '[name=b]'],
  ]);
  eq(out.length, 3);
  eq(out[0].ident, 'a');
  eq(out[1], null);
  eq(out[2].ident, 'b');
});

test('describeAll survives a selector that throws', () => {
  const { probe } = mount('<input name="a">');
  const out = probe.describeAll([['css', '>>>not a selector<<<'], ['css', '[name=a]']]);
  eq(out[0], null);
  eq(out[1].ident, 'a');
});

test('an xpath selector resolves', () => {
  const { probe } = mount('<input name="a" value="x">');
  const out = probe.describeAll([['xpath', '//input[@name="a"]']]);
  eq(out[0].ident, 'a');
  eq(out[0].value, 'x');
});

test('a text node resolved by xpath climbs to its element', () => {
  const { probe } = mount('<label for="a">Name</label><input id="a" name="a">');
  const out = probe.describeAll([['xpath', '//label/text()']]);
  // The label resolves via for= to the input.
  eq(out[0].ident, 'a');
});

// ── fillableIn enumeration ───────────────────────────────────

test('fillableIn finds every control kind and skips hidden inputs', () => {
  const { document, probe } = mount(`
    <form id="f">
      <input name="a"><textarea name="b"></textarea>
      <select name="c"><option>x</option></select>
      <input type="checkbox" name="d"><input type="radio" name="e">
      <input type="file" name="f">
      <input type="hidden" name="csrf">
      <input type="submit" value="Send">
      <div contenteditable="true">note</div>
    </form>`);
  const { elements } = probe.fillableIn(document.getElementById('f'));
  const names = elements.map(e => e.getAttribute('name') || e.tagName.toLowerCase());
  ok(names.includes('a') && names.includes('b') && names.includes('c'));
  ok(names.includes('d') && names.includes('e'));
  ok(names.includes('f'), 'file inputs must be enumerated');
  ok(names.includes('div'), 'contenteditable must be enumerated');
  notOk(names.includes('csrf'), 'hidden inputs must not be enumerated');
  notOk(elements.some(e => e.getAttribute('type') === 'submit'),
        'submit buttons are not fillable');
});

test('fillableIn descends into an open shadow root', () => {
  const { document, probe } = mount('<form id="f"><div id="host"></div></form>');
  const host = document.getElementById('host');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<input name="inside_shadow">';
  const { elements, shadowRoots } = probe.fillableIn(document.getElementById('f'));
  eq(shadowRoots, 1);
  ok(elements.some(e => e.getAttribute('name') === 'inside_shadow'));
});

test('fillableIn cannot see into a closed shadow root and says so', () => {
  const { document, probe } = mount('<form id="f"><x-widget id="host"></x-widget></form>');
  const host = document.getElementById('host');
  host.attachShadow({ mode: 'closed' }).innerHTML = '<input name="unreachable">';
  const { elements, opaqueHosts } = probe.fillableIn(document.getElementById('f'));
  notOk(elements.some(e => e.getAttribute('name') === 'unreachable'));
  ok(opaqueHosts >= 1, 'an unreadable custom-element host must be counted, not ignored');
});

test('fillableIn does not return the same element twice', () => {
  const { document, probe } = mount('<form id="f"><input name="a"></form>');
  const { elements } = probe.fillableIn(document.getElementById('f'));
  eq(elements.length, 1);
});

// ── helpers the extension leans on ───────────────────────────

test('fieldWrapper prefers the react-select container', () => {
  const { document, probe } = mount(RS_COMMITTED);
  const w = probe.fieldWrapper(document.querySelector('[role=combobox]'));
  ok(w.className.includes('select__'), `got ${w.className}`);
});

test('fieldWrapper falls back to a field-ish ancestor, then the element', () => {
  const { document, probe } = mount(
    '<div class="form-group"><input name="a"></div><input name="b" id="bare">');
  eq(probe.fieldWrapper(document.querySelector('[name=a]')).className, 'form-group');
  eq(probe.fieldWrapper(document.getElementById('bare')).id, 'bare');
});

test('listboxFor resolves aria-controls across a portal', () => {
  const { document, probe } = mount(
    '<input role="combobox" name="rs" aria-controls="menu-1">' +
    '<div id="menu-1" role="listbox"><div role="option">A</div></div>');
  const lb = probe.listboxFor(document.querySelector('[role=combobox]'));
  eq(lb && lb.id, 'menu-1');
});

test('visibleOptionLabels reads options from anywhere in the document', () => {
  const { window, probe } = mount(
    '<div class="select__container"><input role="combobox" name="rs"></div>' +
    '<div role="listbox"><div role="option">USA</div><div role="option">Canada</div>' +
    '<div role="option">Located Elsewhere</div></div>');
  void window;
  deepEq(probe.visibleOptionLabels(), ['USA', 'Canada', 'Located Elsewhere']);
});

test('visibleOptionLabels respects its cap', () => {
  const opts = Array.from({ length: 50 }, (_, i) => `<div role="option">o${i}</div>`).join('');
  const { probe } = mount(`<div role="listbox">${opts}</div>`);
  eq(probe.visibleOptionLabels(10).length, 10);
});

test('the probe installs only once per frame', () => {
  const { window, probe } = mount('<input name="a">');
  const marker = {};
  probe.__marker = marker;
  window.eval('(() => { /* re-inject */ })()');
  eq(window.__tcvFieldProbe.__marker, marker);
});

await run('field_probe.js');
