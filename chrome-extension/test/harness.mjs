// Minimal test harness — deliberately not jest/vitest.
//
// The repo has no JS test runner and no root package.json, and the Python
// tests it does have (test_field_registry.py) are plain scripts run as
// `python test_x.py` that collect test_* functions and print PASS/FAIL. This
// mirrors that convention exactly so both halves of the codebase are tested
// the same way, with one devDependency (jsdom) instead of a framework.
//
// Usage:
//   import { test, run, eq, ok, notOk, deepEq, throws } from './harness.mjs';
//   test('name', () => { ok(thing); });
//   await run('suite name');

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export class AssertionError extends Error {}

function fail(msg) {
  throw new AssertionError(msg);
}

export function ok(value, msg) {
  if (!value) fail(msg || `expected truthy, got ${fmt(value)}`);
}

export function notOk(value, msg) {
  if (value) fail(msg || `expected falsy, got ${fmt(value)}`);
}

export function eq(actual, expected, msg) {
  if (actual !== expected) {
    fail(msg ? `${msg}\n    expected ${fmt(expected)}\n    actual   ${fmt(actual)}`
             : `expected ${fmt(expected)}, got ${fmt(actual)}`);
  }
}

export function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) {
    fail(msg ? `${msg}\n    expected ${b}\n    actual   ${a}`
             : `expected ${b}, got ${a}`);
  }
}

export function throws(fn, msg) {
  try { fn(); } catch (e) { return e; }
  fail(msg || 'expected a throw, got none');
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

export async function run(suite) {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (e) {
      failures.push({ name, e });
      console.log(`  FAIL  ${name}`);
    }
  }
  if (failures.length) {
    console.log('');
    for (const { name, e } of failures) {
      console.log(`FAIL: ${name}`);
      console.log(`  ${e instanceof AssertionError ? e.message : (e && e.stack) || e}`);
      console.log('');
    }
  }
  const total = tests.length;
  console.log('');
  console.log(`${suite || 'tests'}: ${passed}/${total} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}
