// jsdom scaffolding for the DOM-touching tests.
//
// Why jsdom at all, when the plan's fixture pages run in a real Chrome: the
// field probe and the value writers are the two places where a subtle mistake
// is invisible (a descriptor that silently reports the wrong identity, a write
// that looks applied but never reached React). Both are pure DOM logic, so
// they can be asserted here on every change instead of once per release by
// hand. What jsdom CANNOT do is layout — getBoundingClientRect is all zeros
// and offsetParent is null — so visibility filtering, real dropdown portals
// and DataTransfer file attach stay the fixture pages' job.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_SRC = readFileSync(resolve(HERE, '../../auto_apply/field_probe.js'), 'utf8');

/**
 * A fresh window with `html` in the body and the shared field probe installed.
 * Returns { window, document, probe } — probe being globalThis.__tcvFieldProbe
 * from inside that window, i.e. the same object both real consumers use.
 */
export function mount(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.eval(PROBE_SRC);
  const probe = window.__tcvFieldProbe;
  if (!probe) throw new Error('field_probe.js did not install __tcvFieldProbe');
  return { dom, window, document: window.document, probe };
}

/** Describe the single control matched by `selector`. */
export function describe1(html, selector) {
  const { document, probe } = mount(html);
  const el = document.querySelector(selector);
  if (!el) throw new Error(`test fixture has no ${selector}`);
  return probe.describeEl(probe.control(el));
}
