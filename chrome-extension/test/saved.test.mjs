// src/autofill/saved.js — one answer per kind of option list.
//
// The cases live in fixtures/saved_cases.json and are run by the server's
// test_saved_variants.py as well: the browser and the server must pick the
// same option from the same saved answer.
//
// Run: node test/saved.test.mjs

import { readFileSync } from 'node:fs';
import { test, run, eq } from './harness.mjs';
import * as s from '../src/autofill/saved.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/saved_cases.json', import.meta.url), 'utf8'));
const list = v => (typeof v === 'string' ? fixture.lists[v] : v);
const entryOf = e => ({ answer: e.answer, variants: e.variants.map(v => ({ answer: v.answer, options: list(v.options) })) });

for (const c of fixture.cases) {
  test(`pickSaved: ${c.name}`, () => {
    eq(s.pickSaved(entryOf(c.entry), list(c.labels)), c.expect);
  });
}

for (const k of fixture.kinds) {
  test(`listKind: ${k.labels} is ${k.expect}`, () => {
    eq(s.listKind(list(k.labels)), k.expect);
  });
}

test('normalizeOption drops lettering, case and punctuation', () => {
  eq(s.normalizeOption('(e) Authorized to work (DACA)'), 'authorized to work daca');
  eq(s.normalizeOption('b) U.S. lawful permanent resident'), 'u s lawful permanent resident');
  eq(s.normalizeOption('1. Yes'), 'yes');
  // "No." is an answer, not an enumerator.
  eq(s.normalizeOption('No. I am not'), 'no i am not');
});

test('a placeholder is no option', () => {
  eq(s.pickSaved({ answer: 'Select...', variants: [] }, ['Select...', 'Yes', 'No']), null);
});

await run('saved.js');
