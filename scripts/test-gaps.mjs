// Test for the shared gap-diagnosis code gate (lib/gaps-core.ts): the validator
// both scans (map-wide + per-thesis) run their model output through. Pure, no DB.
//
// Run: node scripts/test-gaps.mjs
// (Node's native type stripping loads the .ts module directly; gaps-core keeps
// type-only imports for exactly this reason.)

import assert from 'node:assert/strict';
import {
  validateGapRecommendations, normStatement, GAP_NODE_CODE_RE,
} from '../lib/gaps-core.ts';

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${e.message}`);
  }
};

// A baseline valid raw claim rec against this fixture map.
const ctx = () => ({
  liveCodes: new Set(['3.1', 'B1']),
  stanceCodes: new Set(['S-3A', 'S-7B']),
  bridgeCodes: new Set(['B1']),
  claimCodes: new Set(['3.1']),
  questionSlugByStance: new Map([['S-3A', 'labor'], ['S-7B', 'hiring']]),
  liveStatements: ['AI reduces headcount.'],
  reportByLabel: new Map([['R1', { id: 'rid-1', title: 'The fortnight report' }]]),
  signalByLabel: new Map([['S1', 'sid-1'], ['S2', 'sid-2']]),
});
const rec = (over = {}) => ({
  kind: 'claim',
  code: '3.6',
  statement: 'Entry-level hiring falls where AI tools are adopted.',
  test: 'BLS category data shows no divergence by 2027.',
  domain: 'labor',
  domain_from: '',
  domain_to: '',
  resolvability: 'slow',
  suggested_edges: [{ code: 'S-3A', relation: 'supports' }],
  argument: 'The thesis depends on it.',
  grounding: { report_label: '', signal_labels: ['S1'], finding: 'A tracked development with no home.' },
  ...over,
});

check('valid claim rec passes and resolves its stance home', () => {
  const out = validateGapRecommendations([rec()], ctx());
  assert.equal(out.length, 1);
  assert.equal(out[0].question_slug, 'labor');
  assert.deepEqual(out[0].grounding.signal_ids, ['sid-1']);
  assert.equal(out[0].domain, 'labor');
});

check('novelty bar: paraphrase of a live statement is rejected', () => {
  const out = validateGapRecommendations(
    [rec({ statement: '  AI reduces HEADCOUNT!!  ' })], ctx()
  );
  assert.equal(out.length, 0);
});

check('normStatement normalizes case, punctuation, whitespace', () => {
  assert.equal(normStatement('  AI reduces HEADCOUNT!!  '), 'ai reduces headcount');
});

check('grounding bar: no finding is always rejected', () => {
  const out = validateGapRecommendations(
    [rec({ grounding: { report_label: 'R1', signal_labels: ['S1'], finding: '' } })], ctx()
  );
  assert.equal(out.length, 0);
});

check('grounding bar: requireRef (default) rejects a finding with no resolvable ref', () => {
  const out = validateGapRecommendations(
    [rec({ grounding: { report_label: '', signal_labels: [], finding: 'A leg with no claim.' } })], ctx()
  );
  assert.equal(out.length, 0);
});

check('grounding bar: requireRef false accepts a finding alone (the thesis scan)', () => {
  const out = validateGapRecommendations(
    [rec({ grounding: { report_label: '', signal_labels: [], finding: 'A leg with no claim.' } })],
    { ...ctx(), requireRef: false }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].grounding.report_id, null);
  assert.deepEqual(out[0].grounding.signal_ids, []);
});

check('unresolvable signal labels are dropped; report label resolves', () => {
  const out = validateGapRecommendations(
    [rec({ grounding: { report_label: 'R1', signal_labels: ['S9', 'S2'], finding: 'f' } })], ctx()
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].grounding.report_id, 'rid-1');
  assert.deepEqual(out[0].grounding.signal_ids, ['sid-2']);
});

check('code collisions with live nodes are rejected', () => {
  assert.equal(validateGapRecommendations([rec({ code: '3.1' })], ctx()).length, 0);
});

check('a claim without a stance home is rejected (bridge edge alone is not a home)', () => {
  const out = validateGapRecommendations(
    [rec({ suggested_edges: [{ code: 'B1', relation: 'supports' }] })], ctx()
  );
  assert.equal(out.length, 0);
});

check('dangling edge codes are dropped, surviving stance keeps the rec', () => {
  const out = validateGapRecommendations(
    [rec({ suggested_edges: [{ code: 'S-3A', relation: 'supports' }, { code: 'NOPE', relation: 'supports' }] })],
    ctx()
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].edges.length, 1);
});

check('bad relation is dropped', () => {
  const out = validateGapRecommendations(
    [rec({ suggested_edges: [{ code: 'S-3A', relation: 'organizes' }] })], ctx()
  );
  assert.equal(out.length, 0); // its only stance edge died, so no home
});

check('bridge rec: needs both domains, edges are feeding claims only', () => {
  const out = validateGapRecommendations([rec({
    kind: 'bridge', code: 'B2', domain: '', domain_from: 'labor', domain_to: 'economics',
    suggested_edges: [{ code: '3.1', relation: 'supports' }, { code: 'S-3A', relation: 'supports' }],
  })], ctx());
  assert.equal(out.length, 1);
  assert.equal(out[0].question_slug, null);
  assert.deepEqual(out[0].edges.map((e) => e.code), ['3.1']);
});

check('cap: at most 3 (default) recommendations survive', () => {
  const raws = ['4.1', '4.2', '4.3', '4.4', '4.5'].map((code, i) =>
    rec({ code, statement: `Distinct statement number ${i}.` }));
  assert.equal(validateGapRecommendations(raws, ctx()).length, 3);
});

check('duplicate codes within a batch are rejected', () => {
  const out = validateGapRecommendations(
    [rec(), rec({ statement: 'A different statement entirely.' })], ctx()
  );
  assert.equal(out.length, 1);
});

check('code regex holds', () => {
  assert.ok(GAP_NODE_CODE_RE.test('3.6'));
  assert.ok(GAP_NODE_CODE_RE.test('B5'));
  assert.ok(!GAP_NODE_CODE_RE.test('.bad'));
  assert.ok(!GAP_NODE_CODE_RE.test(''));
});

if (failures) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAll gap-gate checks passed.');
