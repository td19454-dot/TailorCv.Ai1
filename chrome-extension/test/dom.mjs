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

/**
 * Add the file-transfer APIs jsdom does not implement.
 *
 * jsdom has no DataTransfer and no DragEvent at all, and `input.files` is
 * getter-only — so nothing in the attach path can run there unaided.
 *
 * WHAT THIS PROVES: that write.js constructs the File correctly from base64,
 * puts it in a DataTransfer, assigns it, and dispatches the events a framework
 * listens for — all of which is our logic and all of which can be wrong.
 *
 * WHAT IT DOES NOT PROVE: that a real browser accepts `input.files = dt.files`
 * and that a real upload widget reacts to the synthetic events. Those are
 * browser behaviours, and the fixture pages in test/fixtures are where they get
 * checked. This stub is deliberately faithful in one respect — it does not make
 * `attachFile` return true unless the assignment it performs actually took.
 */
export function polyfillFileApis(window) {
  if (!window.DataTransfer) {
    window.DataTransfer = class DataTransfer {
      constructor() {
        const files = [];
        files.item = i => files[i] || null;
        this.files = files;
        this.items = {
          add: file => { files.push(file); },
          clear: () => { files.length = 0; },
        };
        this.types = [];
        this.dropEffect = 'none';
        this.effectAllowed = 'all';
        this.setData = () => {};
        this.getData = () => '';
      }
    };
  }
  if (!window.DragEvent) {
    window.DragEvent = class DragEvent extends window.Event {
      constructor(type, init) {
        super(type, init);
        this.dataTransfer = (init && init.dataTransfer) || null;
      }
    };
  }
  // Make `files` accept our stand-in FileList.
  //
  // jsdom DOES define a setter, but it rejects anything that is not a genuine
  // FileList — and a genuine FileList cannot be constructed from script, which
  // is the whole reason DataTransfer exists in browsers. So the setter is
  // replaced outright here. This is the one place the stub diverges from a real
  // browser, and it is why the fixture pages, not this test, are what confirm
  // an upload actually attaches.
  const proto = window.HTMLInputElement.prototype;
  const existing = Object.getOwnPropertyDescriptor(proto, 'files');
  const store = new WeakMap();
  Object.defineProperty(proto, 'files', {
    configurable: true,
    enumerable: true,
    get() {
      if (store.has(this)) return store.get(this);
      return existing && existing.get ? existing.get.call(this) : null;
    },
    set(v) { store.set(this, v); },
  });
  return window;
}

/** Describe the single control matched by `selector`. */
export function describe1(html, selector) {
  const { document, probe } = mount(html);
  const el = document.querySelector(selector);
  if (!el) throw new Error(`test fixture has no ${selector}`);
  return probe.describeEl(probe.control(el));
}
