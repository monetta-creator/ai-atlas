// Tests for the Atlas Agent's pure core: the blackout/weekday/week-key date
// helpers (lib/agent/time.ts) and the finding-reconciliation planner
// (lib/agent/reconcile.ts's reconcileFindings, the pure decision function
// lib/mutations/agent.ts's upsertFindings executes against the DB).
// READ-ONLY, no DB needed: both modules have zero runtime imports (only
// `import type`s, erased by TypeScript), so plain Node type stripping loads
// them directly (the scripts/test-scan.mjs precedent).
// Run: node scripts/test-agent.mjs

import assert from 'node:assert/strict';
import { isBlackout, isWeekdayUtc, hoursSince, daysSince, mondayUtc, lastFridayUtc, ageLabel } from '../lib/agent/time.ts';
import { reconcileFindings } from '../lib/agent/reconcile.ts';

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

console.log('agent time helpers:');

// ---------------------------------------------------------------- isBlackout

check('isBlackout: 00:00 UTC is inside the blackout', () => {
  assert.equal(isBlackout(new Date('2026-09-22T00:00:00Z')), true);
});
check('isBlackout: 08:59 UTC is still inside', () => {
  assert.equal(isBlackout(new Date('2026-09-22T08:59:00Z')), true);
});
check('isBlackout: 09:00 UTC is outside (the window ends there)', () => {
  assert.equal(isBlackout(new Date('2026-09-22T09:00:00Z')), false);
});
check('isBlackout: 23:59 UTC is outside', () => {
  assert.equal(isBlackout(new Date('2026-09-22T23:59:00Z')), false);
});

// -------------------------------------------------------------- isWeekdayUtc

check('isWeekdayUtc: Tuesday is a weekday', () => {
  assert.equal(isWeekdayUtc(new Date('2026-09-22T12:00:00Z')), true); // a Tuesday
});
check('isWeekdayUtc: Saturday is not', () => {
  assert.equal(isWeekdayUtc(new Date('2026-09-26T12:00:00Z')), false); // a Saturday
});
check('isWeekdayUtc: Sunday is not', () => {
  assert.equal(isWeekdayUtc(new Date('2026-09-27T12:00:00Z')), false); // a Sunday
});

// --------------------------------------------------------- mondayUtc / lastFridayUtc

check('mondayUtc: a Tuesday resolves to that week\'s Monday', () => {
  assert.equal(mondayUtc(new Date('2026-09-22T12:00:00Z')), '2026-09-21');
});
check('mondayUtc: a Sunday resolves to the PRECEDING Monday', () => {
  assert.equal(mondayUtc(new Date('2026-09-27T12:00:00Z')), '2026-09-21');
});
check('mondayUtc: a Monday resolves to itself', () => {
  assert.equal(mondayUtc(new Date('2026-09-21T00:30:00Z')), '2026-09-21');
});

check('lastFridayUtc: a Friday resolves to itself', () => {
  assert.equal(lastFridayUtc(new Date('2026-09-25T12:00:00Z')), '2026-09-25');
});
check('lastFridayUtc: a Saturday resolves to yesterday', () => {
  assert.equal(lastFridayUtc(new Date('2026-09-26T12:00:00Z')), '2026-09-25');
});
check('lastFridayUtc: a Monday resolves to the prior Friday', () => {
  assert.equal(lastFridayUtc(new Date('2026-09-21T12:00:00Z')), '2026-09-18');
});
check('lastFridayUtc: a Thursday resolves to the PRIOR week\'s Friday', () => {
  assert.equal(lastFridayUtc(new Date('2026-09-24T12:00:00Z')), '2026-09-18');
});

// ------------------------------------------------------- hoursSince / daysSince

check('hoursSince: 3 hours apart', () => {
  const then = new Date('2026-09-22T09:00:00Z');
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(hoursSince(then.toISOString(), now), 3);
});
check('daysSince: 2 days apart', () => {
  const then = new Date('2026-09-20T12:00:00Z');
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(daysSince(then.toISOString(), now), 2);
});

// -------------------------------------------------------------------- ageLabel

check('ageLabel: under an hour', () => {
  const then = new Date('2026-09-22T11:45:00Z');
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(ageLabel(then.toISOString(), now), 'under an hour');
});
check('ageLabel: hours, singular', () => {
  const then = new Date('2026-09-22T11:00:00Z');
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(ageLabel(then.toISOString(), now), '1 hour');
});
check('ageLabel: days, plural', () => {
  const then = new Date('2026-09-19T12:00:00Z');
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(ageLabel(then.toISOString(), now), '3 days');
});

console.log('finding reconciliation:');

const NOW = new Date('2026-09-22T12:00:00Z');
function input(key, overrides = {}) {
  return {
    key, checkKey: key.split(':')[0], severity: 'warn', title: 't', detail: 'd',
    metric: {}, href: null, remedy: null, ...overrides,
  };
}

check('reconcileFindings: a brand-new key is queued for insert', () => {
  const plan = reconcileFindings([], [input('drafts.backlog')], NOW);
  assert.equal(plan.insert.length, 1);
  assert.equal(plan.reopen.length, 0);
  assert.equal(plan.update.length, 0);
  assert.deepEqual(plan.resolveKeys, []);
});

check('reconcileFindings: a resolved key that fires again is reopened', () => {
  const existing = [{ key: 'drafts.backlog', state: 'resolved', snoozed_until: null }];
  const plan = reconcileFindings(existing, [input('drafts.backlog')], NOW);
  assert.equal(plan.reopen.length, 1);
  assert.equal(plan.insert.length, 0);
});

check('reconcileFindings: an open key that still fires is updated in place', () => {
  const existing = [{ key: 'drafts.backlog', state: 'open', snoozed_until: null }];
  const plan = reconcileFindings(existing, [input('drafts.backlog')], NOW);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].unsnooze, false);
});

check('reconcileFindings: an open key that never fires again is resolved', () => {
  const existing = [{ key: 'drafts.backlog', state: 'open', snoozed_until: null }];
  const plan = reconcileFindings(existing, [], NOW);
  assert.deepEqual(plan.resolveKeys, ['drafts.backlog']);
});

check('reconcileFindings: acked findings are also resolved when they stop firing', () => {
  const existing = [{ key: 'x', state: 'acked', snoozed_until: null }];
  const plan = reconcileFindings(existing, [], NOW);
  assert.deepEqual(plan.resolveKeys, ['x']);
});

check('reconcileFindings: a snoozed finding past its date unsnoozes on update', () => {
  const existing = [{ key: 'x', state: 'snoozed', snoozed_until: '2026-09-20T00:00:00Z' }];
  const plan = reconcileFindings(existing, [input('x')], NOW);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].unsnooze, true);
});

check('reconcileFindings: a snoozed finding still due stays snoozed on update', () => {
  const existing = [{ key: 'x', state: 'snoozed', snoozed_until: '2026-09-25T00:00:00Z' }];
  const plan = reconcileFindings(existing, [input('x')], NOW);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].unsnooze, false);
});

check('reconcileFindings: a snoozed finding that stops firing is resolved, not left snoozed', () => {
  const existing = [{ key: 'x', state: 'snoozed', snoozed_until: '2026-09-25T00:00:00Z' }];
  const plan = reconcileFindings(existing, [], NOW);
  assert.deepEqual(plan.resolveKeys, ['x']);
});

check('reconcileFindings: a failed check keeps its snoozed finding (not resolved)', () => {
  const existing = [
    { key: 'engine.daily_status:scan', check_key: 'engine.daily_status', state: 'snoozed', snoozed_until: '2026-09-25T00:00:00Z' },
    { key: 'drafts.backlog', check_key: 'drafts.backlog', state: 'open', snoozed_until: null },
  ];
  const plan = reconcileFindings(existing, [], NOW, new Set(['engine.daily_status']));
  assert.deepEqual(plan.resolveKeys, ['drafts.backlog']);
});

check('reconcileFindings: mixed batch buckets correctly', () => {
  const existing = [
    { key: 'a', state: 'open', snoozed_until: null },       // still fires -> update
    { key: 'b', state: 'resolved', snoozed_until: null },   // fires again -> reopen
    { key: 'c', state: 'open', snoozed_until: null },       // stops firing -> resolve
  ];
  const inputs = [input('a'), input('b'), input('d')];       // d is brand new -> insert
  const plan = reconcileFindings(existing, inputs, NOW);
  assert.equal(plan.insert.length, 1);
  assert.equal(plan.insert[0].key, 'd');
  assert.equal(plan.reopen.length, 1);
  assert.equal(plan.reopen[0].key, 'b');
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].input.key, 'a');
  assert.deepEqual(plan.resolveKeys, ['c']);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
