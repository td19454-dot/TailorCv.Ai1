// The waits the autofill run depends on, in one place.
//
// These are real requirements, not padding: a framework needs a tick to
// re-render before a field can be read back honestly, and a portal-rendered
// dropdown menu does not exist until some time after the click that opens it.
// Reading a field too early reports "empty" for a value that did land, which
// would turn every React field into a false "needs your attention".
//
// They are mutable so the test suite can shrink them. Without that, the
// integration suite spends minutes asleep — long enough that it stops being run
// on every change, which is the actual risk being managed here.
export const TIMING = {
  // How long to let a framework re-render before reading a field back.
  settleMs: 60,
  // How long to wait for a custom dropdown's menu to appear after opening it.
  optionWaitMs: 600,
  // How long to watch for fields that appear in response to an answer.
  revealWatchMs: 900,
  // ...and, while the page is still changing, how much longer. Oracle loads its
  // Address Line / City / State boxes only after Country is picked, from its
  // server; looking once at 900 ms saw none of them.
  revealQuietMs: 700,
  revealMaxMs: 5000,
  // How long a picked dropdown option may take to show as committed. Oracle
  // keeps the field flagged invalid for a moment after a correct pick, then
  // redraws it — a single early read called a good pick a failure.
  commitWaitMs: 2000,
  // How long an upload may take to show as taken. Workday sends the file to its
  // server first and only then shows the filename (clearing the input).
  uploadConfirmMs: 4000,
  // How long an ATS may take to read an uploaded resume into its form (Oracle's
  // "Import your profile") before filling carries on regardless.
  resumeParseMaxMs: 30000,
  // How long after an upload to look for the form starting to read it.
  resumeParseStartMs: 300,
  // Oracle's Education / Experience tiles: how long an entry's form may take
  // to open after Edit, and to close after Save.
  tileOpenMs: 3000,
  tileSaveMs: 4000,
};

export function setTiming(overrides) {
  Object.assign(TIMING, overrides || {});
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = () => (globalThis.performance && globalThis.performance.now
  ? globalThis.performance.now() : Date.now());

/**
 * Where one run's time went: per phase, per field, and per quiet-wait.
 *
 * Measurement only — nothing here changes what the run does. It exists so the
 * next speed-up is chosen from numbers on a real page, not from reading code.
 */
export function startClock() {
  const start = now();
  const phases = {};
  const fields = [];
  const quietWaits = [];
  const add = (phase, ms) => { phases[phase] = (phases[phase] || 0) + ms; };
  return {
    add,
    async time(phase, fn) {
      const t = now();
      try { return await fn(); } finally { add(phase, now() - t); }
    },
    field(info) { fields.push(info); },
    quiet(res) { if (res) quietWaits.push(res); },
    summary() {
      const round = ms => Math.round(ms || 0);
      const out = {};
      for (const k of Object.keys(phases)) out[k] = round(phases[k]);
      return {
        totalMs: round(now() - start),
        phases: out,
        quietWaits: quietWaits.map(q => ({ ms: round(q.ms), capped: !!q.capped })),
        slowFields: fields.slice().sort((a, b) => b.ms - a.ms).slice(0, 5)
          .map(f => ({ label: f.label || '', kind: f.kind || '', ms: round(f.ms), outcome: f.outcome || '' })),
      };
    },
    now,
  };
}
