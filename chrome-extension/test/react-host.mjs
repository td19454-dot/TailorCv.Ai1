// Mounts a REAL React tree inside jsdom, so the write layer can be tested
// against the thing it actually has to satisfy.
//
// This is the point of the whole exercise. `el.value = x` looks like it works
// in a plain-DOM test and then fails on every React form in production, because
// React keeps its own copy of the value on the node and reverts to it on the
// next render. Only a real reconciler can tell the difference between a write
// React accepted and a write it is about to undo — so the controlled-input
// tests run against react-dom rather than a hand-rolled imitation of it.

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_SRC = readFileSync(resolve(HERE, '../../auto_apply/field_probe.js'), 'utf8');

/**
 * Build a jsdom window with React available and the shared probe installed,
 * then render the component `defineComponent(React)` returns.
 *
 * `defineComponent` must return a COMPONENT, not an element, and is called
 * exactly once. This matters: an earlier version took a tree factory and called
 * it again on every rerender, which produced a new function identity each time.
 * React treats that as a different component type, so it unmounted and
 * remounted — resetting state and replacing the DOM nodes. A test asserting
 * "the value survived the re-render" then passed by reading a detached node that
 * still held the old value, i.e. passed for precisely the wrong reason.
 *
 * `rerender()` instead forces the real thing: a state update in a wrapper above
 * the component, so the component re-renders with its own state intact.
 */
export async function mountReact(defineComponent) {
  // runScripts is required for window.eval below to run the probe INSIDE this
  // window — without it the probe silently never installs and every consumer
  // sees an undefined __tcvFieldProbe.
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
                        { runScripts: 'dangerously', pretendToBeVisual: true,
                          url: 'https://example.test/apply' });
  const { window } = dom;

  // React reads these off the global scope it is loaded in; pointing the
  // globals at the jsdom window is the standard way to run react-dom in node.
  const saved = captureGlobals(['window', 'document', 'navigator', 'Event', 'InputEvent',
                                'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'DragEvent',
                                'DataTransfer', 'File', 'FileList', 'MutationObserver',
                                'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
                                'HTMLSelectElement', 'Node', 'getComputedStyle',
                                'requestAnimationFrame', 'cancelAnimationFrame', 'atob', 'btoa']);
  installGlobals(window);
  window.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  window.eval(PROBE_SRC);
  const probe = window.__tcvFieldProbe;
  globalThis.__tcvFieldProbe = probe;

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  const Component = defineComponent(React);
  let forceUpdate = null;
  function Wrapper() {
    const [, setTick] = React.useState(0);
    forceUpdate = () => setTick(t => t + 1);
    return React.createElement(Component);
  }

  const container = window.document.getElementById('root');
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(Wrapper));
  });

  return {
    dom,
    window,
    document: window.document,
    probe,
    React,
    act,
    /**
     * Force React through another render pass, preserving component state.
     * This is the check that separates "the value is in the DOM" from "React
     * knows about the value" — only the latter survives.
     */
    async rerender() {
      await act(async () => { if (forceUpdate) forceUpdate(); });
    },
    async flush() {
      await act(async () => { await Promise.resolve(); });
    },
    /**
     * Unmount and put the globals back. Async, and must be awaited.
     *
     * React's scheduler queues work on setImmediate and reads `window.event`
     * when it runs. Restoring the globals synchronously pulled `window` out from
     * under a callback that was already queued, crashing the process AFTER the
     * suite had reported success — which also killed every suite after it in the
     * npm test chain. Draining the scheduler first is the fix.
     */
    async restore() {
      try { await act(async () => { root.unmount(); }); } catch (e) { /* ignore */ }
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
      restoreGlobals(saved);
      delete globalThis.__tcvFieldProbe;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

function captureGlobals(names) {
  const saved = {};
  for (const n of names) {
    saved[n] = {
      had: n in globalThis,
      descriptor: Object.getOwnPropertyDescriptor(globalThis, n),
    };
  }
  return saved;
}

// defineProperty rather than assignment throughout: several of these are
// accessor-only on the Node global (navigator is a getter with no setter as of
// Node 21), so `globalThis.navigator = x` throws.
function put(name, value) {
  Object.defineProperty(globalThis, name, {
    value, writable: true, enumerable: true, configurable: true,
  });
}

function installGlobals(window) {
  put('window', window);
  put('document', window.document);
  put('navigator', window.navigator);
  for (const n of ['Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
                   'DragEvent', 'DataTransfer', 'File', 'FileList', 'MutationObserver',
                   'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
                   'HTMLSelectElement', 'Node']) {
    if (window[n]) put(n, window[n]);
  }
  put('getComputedStyle', window.getComputedStyle.bind(window));
  put('requestAnimationFrame', window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (cb => setTimeout(() => cb(Date.now()), 0)));
  put('cancelAnimationFrame', window.cancelAnimationFrame
    ? window.cancelAnimationFrame.bind(window)
    : clearTimeout);
  put('atob', window.atob.bind(window));
  put('btoa', window.btoa.bind(window));
}

function restoreGlobals(saved) {
  for (const [n, { had, descriptor }] of Object.entries(saved)) {
    if (had && descriptor) Object.defineProperty(globalThis, n, descriptor);
    else if (!had) delete globalThis[n];
  }
}
