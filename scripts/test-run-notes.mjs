// Tests for lib/run-notes.ts's foldRunNotes: first-occurrence order, repeat
// counting, cap behavior. PURE: no DB, no dotenv, no network.
// Run: node scripts/test-run-notes.mjs

import assert from 'node:assert/strict';
import { foldRunNotes } from '../lib/run-notes.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log('run-notes:');

check('dedupe with count across calls', () => {
  const first = foldRunNotes([], ['a']);
  assert.deepEqual(first, ['a']);
  const second = foldRunNotes(first, ['a']);
  assert.deepEqual(second, ['a (x2)']);
});

check('duplicates within one call count too', () => {
  const result = foldRunNotes([], ['a', 'a', 'b']);
  assert.deepEqual(result, ['a (x2)', 'b']);
});

check('count parsing on a pre-suffixed entry', () => {
  const result = foldRunNotes(['a (x2)'], ['a']);
  assert.deepEqual(result, ['a (x3)']);
});

check('first-occurrence order is preserved', () => {
  const result = foldRunNotes(['b', 'a'], ['c', 'a', 'd']);
  assert.deepEqual(result, ['b', 'a (x2)', 'c', 'd']);
});

check('the list is capped, dropping later-first-seen entries beyond the cap', () => {
  const existing = ['a', 'b', 'c'];
  const incoming = ['d', 'e'];
  const result = foldRunNotes(existing, incoming, 3);
  assert.deepEqual(result, ['a', 'b', 'c']);
});

check('cap keeps the earliest entries even when a later one repeats', () => {
  const existing = ['a', 'b', 'c'];
  const result = foldRunNotes(existing, ['c', 'd'], 3);
  assert.deepEqual(result, ['a', 'b', 'c (x2)']);
});

check('a note whose own text ends like a suffix is left alone (only a trailing suffix on an existing entry counts)', () => {
  const result = foldRunNotes([], ['deploy retried after failure (x2)']);
  assert.deepEqual(result, ['deploy retried after failure (x2)']);
});

check('empty incoming strings are skipped', () => {
  const result = foldRunNotes(['a'], ['', 'b']);
  assert.deepEqual(result, ['a', 'b']);
});

check('default cap is 40', () => {
  const incoming = Array.from({ length: 50 }, (_, i) => `note ${i}`);
  const result = foldRunNotes([], incoming);
  assert.equal(result.length, 40);
  assert.equal(result[0], 'note 0');
  assert.equal(result[39], 'note 39');
});

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
