// src/autofill/capture.js — "Copy page structure for TailorCV".
//
// What leaves the page is pasted to TailorCV, so the one thing these tests are
// for is that nothing the person typed, chose or has in their profile survives,
// while the structure an adapter needs (labels, attributes, options) does.
//
// Run: node test/capture.test.mjs

import { test, run, ok, notOk } from './harness.mjs';
import { mount } from './dom.mjs';
import { capturePageStructure } from '../src/autofill/capture.js';

async function withDoc(html, fn) {
  const env = mount(html);
  const saved = { document: globalThis.document, probe: globalThis.__tcvFieldProbe };
  globalThis.document = env.document;
  globalThis.__tcvFieldProbe = env.probe;
  try {
    return await fn(env);
  } finally {
    globalThis.document = saved.document;
    globalThis.__tcvFieldProbe = saved.probe;
  }
}

const PAGE = `
  <div class="apply-flow">
    <h2>Contact Information</h2>
    <form id="app" action="/apply?token=SECRET-TOKEN-123">
      <label for="fn">First Name *</label><input id="fn" name="firstName" value="Shubham">
      <label for="em">Email *</label><input id="em" type="email" name="email">
      <label for="ph">Phone *</label><input id="ph" type="tel" name="phone" value="8240044652">
      <label for="why">Why this role?</label><textarea id="why" name="why">I want to build models</textarea>
      <p class="prefill">Welcome back, Shubham Sarkar (shubhamsarkarthe1@gmail.com)</p>
      <a href="https://jpmc.fa.oraclecloud.com/job/1?eem=ONE-TIME-CODE&code=abc123">Back to Job Posting</a>
      <div data-automation-id="formField-country">
        <label for="c1">Country *</label>
        <button type="button" aria-haspopup="listbox" id="c1" aria-label="Country India Required">India</button>
      </div>
      <label for="gen">Gender</label>
      <select id="gen" name="gender"><option value="">Select</option><option value="m">Cisgender man</option></select>
      <input type="hidden" name="csrf" value="HIDDEN-SECRET">
      <button type="submit">Next</button>
    </form>
  </div>`;

test('nothing the person typed, chose or has on file survives the capture', async () => {
  await withDoc(PAGE, async (env) => {
    env.document.getElementById('em').value = 'typed@example.com';   // typed, not an attribute
    const out = capturePageStructure(env.document,
      ['Shubham', 'Sarkar', '8240044652', 'shubhamsarkarthe1@gmail.com', 'Kolkata']);
    for (const secret of ['Shubham', 'Sarkar', '8240044652', 'shubhamsarkarthe1@gmail.com', 'typed@example.com',
                          'I want to build', 'ONE-TIME-CODE', 'abc123', 'SECRET-TOKEN-123', 'HIDDEN-SECRET']) {
      notOk(out.includes(secret), `"${secret}" leaked`);
    }
    notOk(/>India</.test(out), 'the chosen dropdown value is hidden');
  });
});

test('the structure an adapter needs is kept', async () => {
  await withDoc(PAGE, async (env) => {
    const out = capturePageStructure(env.document, ['Shubham']);
    for (const kept of ['Contact Information', 'First Name *', 'name="firstName"', 'type="tel"',
                        'data-automation-id="formField-country"', 'aria-haspopup="listbox"',
                        '<option value="m">Cisgender man</option>', 'Back to Job Posting',
                        'https://jpmc.fa.oraclecloud.com/job/1']) {
      ok(out.includes(kept), `missing: ${kept}`);
    }
    ok(/detected fields: \[.*First Name/.test(out), 'the header lists what was detected');
    notOk(out.includes('tailorcv-sidebar'), 'the panel itself is not included');
  });
});

test('profile values are hidden as whole words only, never inside other words', async () => {
  await withDoc(`<form><label for="c">City</label>
      <div data-bind="props: { validateValue: element.validateValue }"><input id="c" name="city"></div>
      <p>Lives in Value town</p></form>`, async (env) => {
    const out = capturePageStructure(env.document, ['Value']);
    ok(out.includes('validateValue: element.validateValue'), 'the binding survives intact');
    notOk(out.includes('Lives in Value'), 'the value itself is still hidden');
  });
});

test('an open Oracle grid popup is captured through aria-controls; indentation is collapsed', async () => {
  await withDoc(`<main><form>
        <label for="city-28">City</label>
        <input id="city-28" name="city" role="combobox" aria-haspopup="grid"
               aria-controls="city-28-listbox" aria-expanded="true">
        <input id="n" name="n"><input id="m" name="m">
      </form></main>
      <div id="city-28-listbox"><table role="grid"><tr role="row"><td role="gridcell">Kolkata, West Bengal</td></tr></table></div>`,
  async (env) => {
    const out = capturePageStructure(env.document, []);
    ok(/id="city-28-listbox"[\s\S]*role="gridcell"[^>]*>Kolkata, West Bengal/.test(out), 'the open list and its options');
    notOk(/\n {4,}</.test(out), 'no indentation runs');
  });
});

await run('capture.js');
