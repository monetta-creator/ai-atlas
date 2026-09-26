// Pure checks for the model-run registry core (lib/jobs/core.ts): step
// transitions, the typical-time-and-cost estimate, labels, the progress bar,
// the stale rule, engine jobs, and visibility. Run: node scripts/test-jobs-core.mjs
import assert from 'node:assert/strict';
import {
  stepsFromSpecs, applyTransition, statusFromSteps, typicalForSteps, clockLabel, aboutLabel, usdLabel,
  progressPct, isStale, withStaleRule, jobFromEngineRun, hrefForJob, canSeeJob, STALE_AFTER_MS, STEP_KEY_RE,
} from '../lib/jobs/core.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const SPECS = [
  { key: 'pack', label: 'Evidence pack', running: 'Building…' },
  { key: 'sections', label: 'Narrative', running: 'Writing…', features: ['tearsheet_sections'] },
  { key: 'close', label: 'Bottom line', running: 'Closing…', features: ['tearsheet_close'] },
];
const T = (s) => `2026-09-27T12:00:${String(s).padStart(2, '0')}Z`;

check('steps start todo; a running step closes an earlier running one; done never regresses', () => {
  let s = stepsFromSpecs(SPECS);
  assert.deepEqual(s.map((x) => x.state), ['todo', 'todo', 'todo']);
  s = applyTransition(s, 'pack', 'running', T(0));
  s = applyTransition(s, 'sections', 'running', T(5));
  assert.equal(s[0].state, 'done');
  assert.equal(s[0].endedAt, T(5));
  s = applyTransition(s, 'sections', 'done', T(30));
  s = applyTransition(s, 'sections', 'running', T(31));
  assert.equal(s[1].state, 'done', 'a done step is not reopened');
  assert.equal(s[1].startedAt, T(5));
});

check('an undeclared step is appended (engine steps arrive as the run reports them)', () => {
  const s = applyTransition([], 'hydrate', 'running', T(0), { label: 'Hydrate' });
  assert.equal(s.length, 1);
  assert.equal(s[0].label, 'Hydrate');
  assert.equal(s[0].state, 'running');
});

check('attempts and notes ride on the step', () => {
  let s = stepsFromSpecs(SPECS);
  s = applyTransition(s, 'sections', 'running', T(0), { attempt: 2, note: 'retrying' });
  assert.equal(s[1].attempt, 2);
  assert.equal(s[1].note, 'retrying');
});

check('status from steps', () => {
  const s = stepsFromSpecs(SPECS);
  assert.equal(statusFromSteps(s), 'queued');
  assert.equal(statusFromSteps(applyTransition(s, 'pack', 'running', T(0))), 'running');
  assert.equal(statusFromSteps(applyTransition(s, 'close', 'failed', T(0))), 'failed');
  let all = s;
  for (const k of ['pack', 'sections', 'close']) all = applyTransition(all, k, 'done', T(1));
  assert.equal(statusFromSteps(all), 'done');
});

check('typical sums per-call medians; thin history is unknown and adds nothing', () => {
  const stats = {
    tearsheet_sections: { p50Ms: 40_000, p90Ms: 55_000, p50Usd: 0.06, n: 12 },
    tearsheet_close: { p50Ms: 15_000, p90Ms: 20_000, p50Usd: 0.02, n: 0 },
  };
  const t = typicalForSteps(SPECS, stats);
  assert.equal(t.p50Ms, 40_000);
  assert.equal(t.p90Ms, 55_000);
  assert.equal(Math.round(t.p50Usd * 100), 6);
  assert.deepEqual(t.unknown, ['tearsheet_close']);
  assert.equal(t.known, true);
  const none = typicalForSteps(SPECS, null);
  assert.equal(none.known, false);
  assert.equal(none.p50Ms, 0);
  const tripled = typicalForSteps([{ key: 'lead', label: 'Lead', running: '…', features: ['savant_lead', 'savant_lead', 'savant_lead'] }], { savant_lead: { p50Ms: 20_000, p90Ms: 30_000, p50Usd: 0.03, n: 15 } });
  assert.equal(tripled.p50Ms, 60_000, 'a feature listed three times counts three calls');
});

check('labels', () => {
  assert.equal(clockLabel(42_000), '0:42');
  assert.equal(clockLabel(3_909_000), '1:05:09');
  assert.equal(clockLabel(-5), '0:00');
  assert.equal(aboutLabel(41_000), 'about 40s');
  assert.equal(aboutLabel(2_000), 'about 5s');
  assert.equal(aboutLabel(130_000), 'about 2 min');
  assert.equal(aboutLabel(0), '');
  assert.equal(usdLabel(0.004), 'under $0.01');
  assert.equal(usdLabel(0.35), '$0.35');
  assert.equal(usdLabel(0), '');
});

check('progress: 80% at the median, 95% cap, never 100 while running, 0 without an estimate', () => {
  assert.equal(progressPct(20_000, 40_000, 60_000), 40);
  assert.equal(progressPct(40_000, 40_000, 60_000), 80);
  assert.equal(progressPct(50_000, 40_000, 60_000), 87.5);
  assert.equal(progressPct(999_000, 40_000, 60_000), 95);
  assert.equal(progressPct(10_000, 0, 0), 0);
});

check('a running job whose heartbeat stopped reads as failed', () => {
  const now = Date.parse(T(0));
  const job = { status: 'running', updatedAt: new Date(now - STALE_AFTER_MS - 1000).toISOString(), error: null };
  assert.equal(isStale(job, now), true);
  assert.equal(withStaleRule({ ...job, id: 'x' }, now).status, 'failed');
  assert.equal(isStale({ status: 'done', updatedAt: new Date(0).toISOString() }, now), false);
  assert.equal(isStale({ status: 'running', updatedAt: new Date(now - 1000).toISOString() }, now), false);
});

check('engine runs become synthetic jobs with a console link; visibility by actor', () => {
  const j = jobFromEngineRun('scan', { id: 'r1', day: '2026-09-25', step: 'enrich', started_at: T(0), updated_at: T(9) });
  assert.equal(j.id, 'engine:scan:r1');
  assert.equal(j.status, 'running');
  assert.equal(hrefForJob(j), '/scan');
  assert.equal(hrefForJob({ kind: 'sheet', resultHref: '/reports/sheet/abc' }), '/reports/sheet/abc');
  assert.equal(canSeeJob('key:k1', { admin: false, keyId: 'k1' }), true);
  assert.equal(canSeeJob('key:k1', { admin: false, keyId: 'k2' }), false);
  assert.equal(canSeeJob('admin', { admin: false, keyId: 'k1' }), false);
  assert.equal(canSeeJob('cron', { admin: true, keyId: null }), true);
  assert.ok(STEP_KEY_RE.test('lens:market') && !STEP_KEY_RE.test('Bad Key'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
