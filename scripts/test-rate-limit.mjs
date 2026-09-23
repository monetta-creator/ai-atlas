// Tests for lib/rate-limit.ts (the pure failure-count limiter behind the
// legacy portal-key throttle). Pure, no DB. Run: node scripts/test-rate-limit.mjs
import assert from 'node:assert/strict';
import { createLimiter } from '../lib/rate-limit.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

check('allow: true under max, false at/after max failures', () => {
  const l = createLimiter({ max: 3, windowMs: 1000 });
  assert.equal(l.allow('a'), true);
  l.fail('a');
  assert.equal(l.allow('a'), true);
  l.fail('a');
  assert.equal(l.allow('a'), true);
  l.fail('a');
  assert.equal(l.allow('a'), false, 'third failure hits max');
});

check('fail: only failures count, never successes or skipped attempts', () => {
  const l = createLimiter({ max: 2, windowMs: 1000 });
  l.fail('a');
  assert.equal(l.allow('a'), true);
  // A caller that never calls fail() (a success, or a skipped compare) leaves
  // the count untouched.
  assert.equal(l.allow('a'), true);
});

check('reset: clears a key\'s recorded failures immediately', () => {
  const l = createLimiter({ max: 1, windowMs: 1000 });
  l.fail('a');
  assert.equal(l.allow('a'), false);
  l.reset('a');
  assert.equal(l.allow('a'), true);
});

check('keys are independent', () => {
  const l = createLimiter({ max: 1, windowMs: 1000 });
  l.fail('a');
  assert.equal(l.allow('a'), false);
  assert.equal(l.allow('b'), true);
});

check('window rollover: a failure older than windowMs no longer counts', () => {
  let t = 0;
  const l = createLimiter({ max: 1, windowMs: 1000, now: () => t });
  l.fail('a');
  assert.equal(l.allow('a'), false, 'still inside the window');
  t = 999;
  assert.equal(l.allow('a'), false, 'still inside the window, just under the edge');
  t = 1001;
  assert.equal(l.allow('a'), true, 'the failure has aged out');
});

check('window rollover: only stale failures are pruned, fresh ones still count', () => {
  let t = 0;
  const l = createLimiter({ max: 2, windowMs: 1000, now: () => t });
  l.fail('a'); // t=0
  t = 900;
  l.fail('a'); // t=900, both still within the window relative to now
  assert.equal(l.allow('a'), false, '2 failures within the last 1000ms hits max=2');
  t = 1001; // the t=0 failure is now stale, the t=900 one is not
  assert.equal(l.allow('a'), true, 'only 1 failure left in window');
  t = 1901; // the t=900 failure is now stale too
  assert.equal(l.allow('a'), true);
});

check('max=0 refuses every attempt immediately', () => {
  const l = createLimiter({ max: 0, windowMs: 1000 });
  assert.equal(l.allow('a'), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
