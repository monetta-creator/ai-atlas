// Tests for the research review desk's pure rules (lib/research/queue-core.ts):
// the auto-dismiss threshold suggestion, the clamps, and the track-why prefill.
// Run: node scripts/test-research-queue.mjs

import assert from 'node:assert/strict';
import {
  suggestThreshold, clampConfidence, clampStaleDays, prefillWhy, QUEUE_DEFAULTS,
} from '../lib/research/queue-core.ts';

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

check('no record, no suggestion', () => {
  assert.equal(suggestThreshold([]), null);
});

check('too few decisions never suggests', () => {
  assert.equal(suggestThreshold([{ floor: 90, n: 10, agreed: 10 }]), null);
});

check('picks the lowest bar that holds across everything above it', () => {
  const bands = [
    { floor: 50, n: 10, agreed: 6 },   // weak band drags 50 and 60 under 95%
    { floor: 70, n: 15, agreed: 15 },
    { floor: 80, n: 20, agreed: 19 },
    { floor: 90, n: 30, agreed: 30 },
  ];
  const s = suggestThreshold(bands);
  assert.equal(s.threshold, 70);
  assert.equal(s.n, 65);
  assert.equal(s.agreed, 64);
});

check('a band under the floor is ignored, 100 folds into 90', () => {
  const s = suggestThreshold([
    { floor: 20, n: 100, agreed: 0 },
    { floor: 100, n: 25, agreed: 25 },
  ]);
  assert.equal(s.threshold, 90);
  assert.equal(s.n, 25);
});

check('an empty band never becomes the bar', () => {
  // Nothing decided in the 50s or 60s: the bar starts where the evidence does.
  const s = suggestThreshold([{ floor: 70, n: 30, agreed: 30 }]);
  assert.equal(s.threshold, 70);
});

check('disagreement everywhere returns null', () => {
  assert.equal(suggestThreshold([{ floor: 90, n: 40, agreed: 30 }]), null);
});

check('options move the bar', () => {
  const bands = [{ floor: 80, n: 12, agreed: 11 }];
  assert.equal(suggestThreshold(bands), null);
  assert.equal(suggestThreshold(bands, { minN: 10, minRate: 0.9 }).threshold, 80);
});

check('clamps', () => {
  assert.equal(clampConfidence(12), 50);
  assert.equal(clampConfidence(140), 100);
  assert.equal(clampConfidence(Number.NaN), QUEUE_DEFAULTS.minConfidence);
  assert.equal(clampStaleDays(0), 3);
  assert.equal(clampStaleDays(999), 180);
  assert.equal(clampStaleDays(14.4), 14);
});

check('prefill only on a track recommendation', () => {
  assert.equal(prefillWhy('tracked', ' moves the labor thread '), 'moves the labor thread');
  assert.equal(prefillWhy('dismissed', 'benchmark only'), '');
  assert.equal(prefillWhy(null, null), '');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
