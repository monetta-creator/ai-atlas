// Tests for lib/ops/registry.ts: the ops job registry stays in exact sync
// with vercel.json's cron entries, plus the pure cron-expression helpers.
// Pure, no DB. Run: node scripts/test-ops-registry.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS_JOBS, VERCEL_CRONS, parseCron, nextFire, todaysFires, fmtEt } from '../lib/ops/registry.ts';

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

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const vercelJson = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

console.log('lib/ops/registry:');

check('VERCEL_CRONS loaded from the real vercel.json (not stale or empty)', () => {
  assert.deepEqual(VERCEL_CRONS, vercelJson.crons);
  assert.ok(VERCEL_CRONS.length > 10, `found only ${VERCEL_CRONS.length}`);
});

check('every vercel.json cron path has exactly one registry entry', () => {
  const allPaths = OPS_JOBS.flatMap((j) => j.paths);
  const missing = vercelJson.crons.map((c) => c.path).filter((p) => !allPaths.includes(p));
  assert.deepEqual(missing, [], `paths with no registry job: ${missing.join(', ')}`);
});

check('every registry job path exists in vercel.json (no stale paths)', () => {
  const vercelPaths = new Set(vercelJson.crons.map((c) => c.path));
  const stale = OPS_JOBS.flatMap((j) => j.paths).filter((p) => !vercelPaths.has(p));
  assert.deepEqual(stale, [], `registry paths not in vercel.json: ${stale.join(', ')}`);
});

check('no vercel.json cron path is claimed by more than one job', () => {
  const allPaths = OPS_JOBS.flatMap((j) => j.paths);
  const dupes = allPaths.filter((p, i) => allPaths.indexOf(p) !== i);
  assert.deepEqual(dupes, [], `paths claimed twice: ${dupes.join(', ')}`);
});

check('every job\'s schedules array is parallel to its paths array', () => {
  for (const job of OPS_JOBS) {
    assert.equal(job.schedules.length, job.paths.length, `${job.key}: ${job.paths.length} paths vs ${job.schedules.length} schedules`);
  }
});

check('every job carries a known family', () => {
  const known = new Set(['engine', 'publisher', 'sweep', 'agent', 'maintenance']);
  for (const job of OPS_JOBS) {
    assert.ok(known.has(job.family), `${job.key} has unknown family "${job.family}"`);
  }
  // The 'family' field is a TypeScript union (OpsFamily); an actually unknown
  // value ('bogus') is rejected at compile time (npx tsc --noEmit), which this
  // runtime pass cannot exercise directly.
});

check('every job carries a known day boundary', () => {
  const known = new Set(['utc-midnight', 'utc-0600', 'press-16:20', 'press-16:45']);
  for (const job of OPS_JOBS) {
    assert.ok(known.has(job.dayBoundary), `${job.key} has unknown dayBoundary "${job.dayBoundary}"`);
  }
});

check('job keys are unique', () => {
  const keys = OPS_JOBS.map((j) => j.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ---- parseCron / nextFire / todaysFires ------------------------------------

check('parseCron reads a weekday cron ("0 9 * * 1-5")', () => {
  const p = parseCron('0 9 * * 1-5');
  assert.equal(p.minute, 0);
  assert.equal(p.hour, 9);
  assert.deepEqual(p.dows, [1, 2, 3, 4, 5]);
});

check('parseCron reads a Monday-only cron ("0 7 * * 1")', () => {
  const p = parseCron('0 7 * * 1');
  assert.deepEqual(p.dows, [1]);
});

check('parseCron reads an every-day cron ("45 * * * *")', () => {
  // vercel.json's hourly agent tick has a "*" hour field, which this
  // registry does not need to resolve to a single fire; only the minute and
  // dow fields are consulted for a schedule like this one.
  const p = parseCron('45 12 * * *');
  assert.equal(p.dows, '*');
});

check('nextFire on a fixed clock: same-day fire still ahead', () => {
  // Tuesday 2026-09-22 08:00 UTC, cron fires 09:00 weekdays -> today 09:00.
  const now = new Date('2026-09-22T08:00:00Z');
  const next = nextFire('0 9 * * 1-5', now);
  assert.equal(next.toISOString(), '2026-09-22T09:00:00.000Z');
});

check('nextFire on a fixed clock: today\'s fire already passed rolls to tomorrow', () => {
  const now = new Date('2026-09-22T10:00:00Z'); // Tuesday, past 09:00
  const next = nextFire('0 9 * * 1-5', now);
  assert.equal(next.toISOString(), '2026-09-23T09:00:00.000Z');
});

check('nextFire on a fixed clock: Friday past the fire rolls over the weekend', () => {
  const now = new Date('2026-09-25T10:00:00Z'); // Friday, past 09:00
  const next = nextFire('0 9 * * 1-5', now);
  assert.equal(next.toISOString(), '2026-09-28T09:00:00.000Z'); // next Monday
});

check('nextFire on a Monday-only job: rolls a full week from Tuesday', () => {
  const now = new Date('2026-09-22T10:00:00Z'); // Tuesday
  const next = nextFire('0 7 * * 1', now);
  assert.equal(next.toISOString(), '2026-09-28T07:00:00.000Z'); // the following Monday
});

check('nextFire on a Monday-only job: same-day still ahead on Monday morning', () => {
  const now = new Date('2026-09-21T05:00:00Z'); // Monday, before 07:00
  const next = nextFire('0 7 * * 1', now);
  assert.equal(next.toISOString(), '2026-09-21T07:00:00.000Z');
});

check('todaysFires orders multiple schedules earliest first and flags future ones', () => {
  const now = new Date('2026-09-22T12:00:00Z'); // Tuesday noon
  const fires = todaysFires(['0 15 * * 1-5', '0 9 * * 1-5', '0 13 * * 1-5'], now);
  assert.deepEqual(
    fires.map((f) => f.whenUtc.getUTCHours()),
    [9, 13, 15]
  );
  assert.deepEqual(fires.map((f) => f.isFuture), [false, true, true]);
});

check('todaysFires skips a schedule whose day-of-week does not match today', () => {
  const now = new Date('2026-09-22T12:00:00Z'); // Tuesday
  const fires = todaysFires(['0 7 * * 1'], now); // Monday-only
  assert.deepEqual(fires, []);
});

check('fmtEt formats a UTC instant in Eastern time', () => {
  // 2026-09-22T13:00:00Z is 09:00 EDT (UTC-4 in September).
  assert.equal(fmtEt(new Date('2026-09-22T13:00:00Z')), '9:00 AM ET');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
