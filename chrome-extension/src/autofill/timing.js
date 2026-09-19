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
};

export function setTiming(overrides) {
  Object.assign(TIMING, overrides || {});
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
