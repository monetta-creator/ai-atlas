// Pure tests for the late feed sweep's deterministic core (deadline split +
// run-note text). No DB, no network.
// Run: node scripts/test-late-sweep.mjs
import assert from 'node:assert/strict';
import { splitDeadline, sweepNote } from '../lib/feeds/late-sweep-core.ts';

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

console.log('late feed sweep:');

check('splitDeadline gives scan roughly 45% of the window', () => {
  const now = 1_000_000;
  const deadlineAt = now + 300_000; // 5 minute window
  const { scanDeadline, intelDeadline } = splitDeadline(now, deadlineAt);
  assert.equal(scanDeadline, now + 135_000);
  assert.equal(intelDeadline, deadlineAt);
});

check('splitDeadline: scan never gets more time than the overall window', () => {
  const now = 1_000_000;
  const deadlineAt = now + 300_000;
  const { scanDeadline, intelDeadline } = splitDeadline(now, deadlineAt);
  assert.ok(scanDeadline <= intelDeadline);
  assert.ok(scanDeadline >= now);
});

check('splitDeadline: a zero-width window splits to the same instant', () => {
  const now = 5_000;
  const { scanDeadline, intelDeadline } = splitDeadline(now, now);
  assert.equal(scanDeadline, now);
  assert.equal(intelDeadline, now);
});

check('splitDeadline: a deadline already in the past clamps to zero width', () => {
  const now = 10_000;
  const deadlineAt = 5_000;
  const { scanDeadline, intelDeadline } = splitDeadline(now, deadlineAt);
  assert.equal(scanDeadline, now);
  assert.equal(intelDeadline, deadlineAt);
});

check('sweepNote: zero new items', () => {
  assert.equal(sweepNote(0), 'late feed sweep: nothing new');
});

check('sweepNote: singular for exactly one', () => {
  assert.equal(sweepNote(1), 'late feed sweep: 1 new item');
});

check('sweepNote: plural for more than one', () => {
  assert.equal(sweepNote(7), 'late feed sweep: 7 new items');
});

check('sweepNote never uses an em dash', () => {
  assert.ok(!sweepNote(0).includes('—'));
  assert.ok(!sweepNote(3).includes('—'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
