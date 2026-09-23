// Tests for lib/portal/views-core.ts (saved views, the pure half).
// Pure, no DB. Run: node scripts/test-portal-views.mjs

import assert from 'node:assert/strict';
import {
  canReadView, canWriteView, mergeParams, ownerOf, sanitizeViewParams, validatePushdowns,
} from '../lib/portal/views-core.ts';
import { ADMIN, LEGACY, NONE } from '../lib/portal/keys.ts';
import { parseFilterSpec } from '../lib/datasets/filter.ts';

let pass = 0; let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

const KEY_A = { tier: 'key', keyId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'A', state: 'active', expiresAt: null, active: true };
const KEY_B = { tier: 'key', keyId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'B', state: 'active', expiresAt: null, active: true };
const KEY_A_EXPIRED = { ...KEY_A, state: 'expired', active: false };

const viewOf = (over) => ({
  id: 'v1', key_id: null, owner: 'key', dataset_slug: 'signals', name: 'My view',
  spec: {}, format: 'csv', is_shared: false, use_count: 0, last_used_at: null,
  created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
});

// A small dataset def for the parseFilterSpec/validatePushdowns checks below.
// Mirrors scripts/test-nl-filter.mjs's fixture style; `significance` reuses a
// real registry column key so the FIELD_FACTS-backed enum path is exercised
// against the real map.
const FIXTURE_DEF = {
  slug: 'fixture-views',
  title: 'Fixture', description: 'd', methodology: 'm', category: 'meta',
  formats: ['csv', 'json'],
  filters: { lens: true, day: true, company: false },
  columns: [
    { key: 'signal_id', label: 'ID', type: 'text', def: 'Stable id; the sort tiebreak.' },
    { key: 'title', label: 'Title', type: 'text', def: 'Title.' },
    { key: 'significance', label: 'Significance', type: 'enum', def: 'FIELD_FACTS-backed: high, medium, low.' },
    { key: 'relevance', label: 'Relevance', type: 'number', def: 'A 0 to 1 number.' },
  ],
  build: async () => [],
};

// ---------------------------------------------------------------------------
// sanitizeViewParams

check('sanitizeViewParams: drops unknown keys, keeps known ones', () => {
  const out = sanitizeViewParams({ lens: 'market', bogus: 'x', where: ['a:eq:b'] });
  assert.deepEqual(out, { lens: 'market', where: ['a:eq:b'] });
});

check('sanitizeViewParams: non-object / array input comes back empty', () => {
  assert.deepEqual(sanitizeViewParams(null), {});
  assert.deepEqual(sanitizeViewParams(undefined), {});
  assert.deepEqual(sanitizeViewParams('nope'), {});
  assert.deepEqual(sanitizeViewParams(['a', 'b']), {});
});

check('sanitizeViewParams: a single-value key with an array input collapses to a scalar', () => {
  const out = sanitizeViewParams({ q: ['first', 'second'] });
  assert.equal(out.q, 'first');
});

check('sanitizeViewParams: where stays an array even for one value', () => {
  const out = sanitizeViewParams({ where: 'a:eq:b' });
  assert.deepEqual(out.where, ['a:eq:b']);
});

check('sanitizeViewParams: caps the number of values and the length of each', () => {
  const many = Array.from({ length: 20 }, (_, i) => `col${i}:eq:v`);
  const out = sanitizeViewParams({ where: many });
  assert.equal(out.where.length, 8);
  const long = sanitizeViewParams({ q: 'x'.repeat(600) });
  assert.equal(long.q.length, 500);
});

check('sanitizeViewParams: empty strings and non-string entries are dropped', () => {
  const out = sanitizeViewParams({ q: '', cols: [1, 2, 'a'] });
  assert.equal('q' in out, false);
  assert.deepEqual(out.cols, 'a');
});

// ---------------------------------------------------------------------------
// mergeParams

check('mergeParams: an explicit param overrides the view\'s same-named one entirely', () => {
  const view = { lens: 'market', limit: '50' };
  const explicit = new URLSearchParams('limit=10');
  const merged = mergeParams(view, explicit);
  assert.equal(merged.get('lens'), 'market');
  assert.equal(merged.get('limit'), '10');
});

check('mergeParams: an explicit where REPLACES the view\'s whole where list, never appends', () => {
  const view = { where: ['a:eq:1', 'b:eq:2'] };
  const explicit = new URLSearchParams('where=c:eq:3');
  const merged = mergeParams(view, explicit);
  assert.deepEqual(merged.getAll('where'), ['c:eq:3']);
});

check('mergeParams: a view-only multi-value key round-trips as repeated params', () => {
  const view = { where: ['a:eq:1', 'b:eq:2'] };
  const merged = mergeParams(view, new URLSearchParams());
  assert.deepEqual(merged.getAll('where'), ['a:eq:1', 'b:eq:2']);
});

check('mergeParams: explicit params outside the view grammar (view, preview, schema) pass through', () => {
  const view = { lens: 'market' };
  const explicit = new URLSearchParams('view=v1&preview=10&schema=1');
  const merged = mergeParams(view, explicit);
  assert.equal(merged.get('view'), 'v1');
  assert.equal(merged.get('preview'), '10');
  assert.equal(merged.get('schema'), '1');
  assert.equal(merged.get('lens'), 'market');
});

// ---------------------------------------------------------------------------
// canReadView / canWriteView / ownerOf

check('canReadView: admin reads everything, shared or not, owned or not', () => {
  assert.equal(canReadView(viewOf({ owner: 'key', key_id: KEY_B.keyId, is_shared: false }), ADMIN), true);
  assert.equal(canReadView(viewOf({ owner: 'legacy', key_id: null, is_shared: false }), ADMIN), true);
});

check('canReadView: a key reads its own non-shared view', () => {
  const view = viewOf({ owner: 'key', key_id: KEY_A.keyId, is_shared: false });
  assert.equal(canReadView(view, KEY_A), true);
  assert.equal(canReadView(view, KEY_B), false);
});

check('canReadView: is_shared makes a view readable by any active identity', () => {
  const view = viewOf({ owner: 'key', key_id: KEY_A.keyId, is_shared: true });
  assert.equal(canReadView(view, KEY_B), true);
  assert.equal(canReadView(view, LEGACY), true);
  assert.equal(canReadView(view, ADMIN), true);
});

check('canReadView: legacy reads legacy-owned or shared views, not another key\'s private view', () => {
  assert.equal(canReadView(viewOf({ owner: 'legacy', key_id: null, is_shared: false }), LEGACY), true);
  assert.equal(canReadView(viewOf({ owner: 'key', key_id: KEY_A.keyId, is_shared: false }), LEGACY), false);
});

check('canReadView: an inactive or absent identity reads nothing, even a shared view', () => {
  assert.equal(canReadView(viewOf({ is_shared: true }), NONE), false);
  assert.equal(canReadView(viewOf({ is_shared: true }), KEY_A_EXPIRED), false);
});

check('canWriteView: only the owning key or admin writes a key-owned view, shared or not', () => {
  const view = viewOf({ owner: 'key', key_id: KEY_A.keyId, is_shared: true });
  assert.equal(canWriteView(view, KEY_A), true);
  assert.equal(canWriteView(view, KEY_B), false);
  assert.equal(canWriteView(view, LEGACY), false);
  assert.equal(canWriteView(view, ADMIN), true);
});

check('canWriteView: only the legacy owner or admin writes a legacy-owned view', () => {
  const view = viewOf({ owner: 'legacy', key_id: null, is_shared: true });
  assert.equal(canWriteView(view, LEGACY), true);
  assert.equal(canWriteView(view, KEY_A), false);
  assert.equal(canWriteView(view, ADMIN), true);
});

check('ownerOf: maps each identity to its stamp', () => {
  assert.deepEqual(ownerOf(ADMIN), { owner: 'admin', keyId: null });
  assert.deepEqual(ownerOf(KEY_A), { owner: 'key', keyId: KEY_A.keyId });
  assert.deepEqual(ownerOf(LEGACY), { owner: 'legacy', keyId: null });
});

// ---------------------------------------------------------------------------
// A stored view's whole point: parseFilterSpec(def, spec) must agree with
// parseFilterSpec(def, mergeParams(spec, <nothing explicit>)), the URL a
// ?view= request actually builds. If these ever diverged, a view could save
// clean and still parse differently (or error) when applied.

check('a stored spec parses identically read directly or round-tripped through mergeParams into a URL', () => {
  const spec = {
    where: ['significance:in:high,medium', 'relevance:isnull:'],
    cols: 'signal_id,title',
    sort: 'title:asc',
    limit: '25',
    lens: 'market',
  };
  const direct = parseFilterSpec(FIXTURE_DEF, spec);
  const viaUrl = parseFilterSpec(FIXTURE_DEF, mergeParams(spec, new URLSearchParams()));
  assert.deepEqual(direct.errors, []);
  assert.deepEqual(viaUrl.errors, []);
  assert.deepEqual(direct.spec, viaUrl.spec);
});

check('a stored spec with an explicit param OVERRIDDEN by the request still round-trips clean', () => {
  const spec = { where: ['significance:eq:high'], limit: '25' };
  const explicit = new URLSearchParams('limit=10');
  const direct = parseFilterSpec(FIXTURE_DEF, { where: ['significance:eq:high'], limit: '10' });
  const viaUrl = parseFilterSpec(FIXTURE_DEF, mergeParams(spec, explicit));
  assert.deepEqual(direct.errors, []);
  assert.deepEqual(viaUrl.errors, []);
  assert.deepEqual(direct.spec, viaUrl.spec);
});

// ---------------------------------------------------------------------------
// validatePushdowns

check('validatePushdowns: a value that would 400 on apply is rejected at save time', () => {
  assert.match(validatePushdowns(FIXTURE_DEF, { lens: 'economy' }), /Unknown lens/);
  assert.match(validatePushdowns(FIXTURE_DEF, { day: '2026-13-99' }), /Bad day/);
  assert.match(validatePushdowns(FIXTURE_DEF, { company: 'acme' }), /no company filter/);
});

check('validatePushdowns: a well-formed value for a supported pushdown passes', () => {
  assert.equal(validatePushdowns(FIXTURE_DEF, { lens: 'market', day: '2026-01-01' }), null);
});

check('validatePushdowns: a pushdown the dataset does not declare is not this gate\'s concern (silently unreachable at apply, not a save-time error)', () => {
  assert.equal(validatePushdowns(FIXTURE_DEF, { source: 'reuters' }), null);
});

if (fail) {
  console.error(`\n${fail} CHECK(S) FAILED`);
  process.exit(1);
}
console.log(`\nALL PORTAL VIEWS CHECKS PASSED (${pass})`);
