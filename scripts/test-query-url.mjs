// Tests for the query builder's URL translation layer
// (lib/datasets/query-url.ts): BuilderState <-> the download route's own
// where/cols/sort/limit/q/pushdown query grammar, pure and DB-free. Mirrors
// scripts/test-dataset-filter.mjs's style; run directly with plain Node
// (type stripping resolves the .ts imports below).
//
// The op matrix in query-url.ts is a hand-kept MIRROR of filter.ts's private
// OPS_BY_TYPE (that module exports neither the table nor a way to reuse it),
// so every generated op is round-tripped through the REAL parseFilterSpec
// here: a drift between the two copies fails this file, not silently.
//
// Run: node scripts/test-query-url.mjs

import assert from 'node:assert/strict';
import { parseFilterSpec } from '../lib/datasets/filter.ts';
import {
  opsForType, toSearchParams, fromSearchParams, hrefs, describeState, requiresNarrowing,
  emptyBuilderState, MAX_WHERE, toViewParams, fromViewParams,
} from '../lib/datasets/query-url.ts';

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

// ---------------------------------------------------------------------------
// Fixture dataset def, reusing real registry column keys (significance and
// published_on carry real FIELD_FACTS/date semantics) so the closed-set and
// date-format validation paths run against the real grammar, not a stub.

const DEF = {
  slug: 'fixture',
  title: 'Fixture dataset',
  description: 'd',
  methodology: 'm',
  category: 'meta',
  formats: ['csv', 'json'],
  filters: { lens: true, day: true, since: true, source: true, company: true },
  columns: [
    { key: 'signal_id', label: 'ID', type: 'text', def: 'Stable id.' },
    { key: 'title', label: 'Title', type: 'text', def: 'Title.' },
    { key: 'summary', label: 'Summary', type: 'longtext', def: 'Longtext summary.' },
    { key: 'significance', label: 'Significance', type: 'enum', def: 'FIELD_FACTS-backed: high, medium, low.' },
    { key: 'relevance', label: 'Relevance', type: 'number', def: 'A 0 to 1 number.' },
    { key: 'published_on', label: 'Published', type: 'date', def: 'YYYY-MM-DD.' },
  ],
  build: async () => [],
};

const TYPES = ['text', 'longtext', 'enum', 'number', 'date'];
const COL_FOR = { text: 'title', longtext: 'summary', enum: 'significance', number: 'relevance', date: 'published_on' };
const SAMPLE = {
  text: { eq: 'Beta falls', ne: 'Beta falls', in: 'Alpha rising,Beta falls', contains: 'Beta' },
  longtext: { eq: 'A note about beta decline', ne: 'A note about beta decline', in: 'A note,Another note', contains: 'note' },
  enum: { eq: 'high', ne: 'high', in: 'high,medium' },
  number: { eq: '0.5', ne: '0.5', gt: '0.1', gte: '0.1', lt: '0.9', lte: '0.9', in: '0.5,0.9' },
  date: { eq: '2026-01-05', ne: '2026-01-05', gt: '2026-01-01', gte: '2026-01-01', lt: '2026-12-31', lte: '2026-12-31' },
};

// ---------------------------------------------------------------------------
// opsForType: every generated op, for every column type, produces a where
// token the REAL parseFilterSpec accepts with no errors.

for (const type of TYPES) {
  const col = COL_FOR[type];
  for (const op of opsForType(type)) {
    check(`opsForType ${type}:${op} matches filter.ts's grammar`, () => {
      const value = (op === 'isnull' || op === 'notnull') ? '' : (SAMPLE[type][op] ?? '');
      const state = { ...emptyBuilderState(), where: [{ col, op, value }] };
      const sp = toSearchParams(state);
      const { errors } = parseFilterSpec(DEF, sp);
      assert.deepEqual(errors, [], `${type}:${op} -> ${sp.toString()}`);
    });
  }
}

check('MAX_WHERE mirrors filter.ts', () => {
  assert.equal(MAX_WHERE, 8);
});

check('isnull/notnull emit col:op with no value segment', () => {
  const state = {
    ...emptyBuilderState(),
    where: [{ col: 'title', op: 'isnull', value: '' }, { col: 'summary', op: 'notnull', value: '' }],
  };
  const sp = toSearchParams(state);
  assert.deepEqual(sp.getAll('where'), ['title:isnull', 'summary:notnull']);
  const { errors } = parseFilterSpec(DEF, sp);
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------
// round trip: toSearchParams -> fromSearchParams for every op and type.

for (const type of TYPES) {
  const col = COL_FOR[type];
  for (const op of opsForType(type)) {
    check(`round trip ${type}:${op}`, () => {
      const value = (op === 'isnull' || op === 'notnull') ? '' : (SAMPLE[type][op] ?? '');
      const original = { where: [{ col, op, value }], cols: [], sort: [], limit: null, q: '', pushdowns: {} };
      const back = fromSearchParams(toSearchParams(original), DEF);
      assert.deepEqual(back.where, original.where);
    });
  }
}

check('round trip: cols, sort, limit, q, pushdowns all survive together', () => {
  const original = {
    where: [{ col: 'significance', op: 'in', value: 'high,medium' }],
    cols: ['title', 'significance', 'relevance'],
    sort: [{ col: 'published_on', dir: 'desc' }, { col: 'relevance', dir: 'asc' }],
    limit: 250,
    q: 'agentic coding',
    pushdowns: { lens: 'market', since: '2026-01-01' },
  };
  const back = fromSearchParams(toSearchParams(original), DEF);
  assert.deepEqual(back, original);
});

// ---------------------------------------------------------------------------
// fromSearchParams: tolerant of an unknown column, a bad op for the column's
// type, extra where tokens past the cap, an unknown cols key, and a bad sort
// direction; none of these throw or surface as an error.

check('fromSearchParams drops an unknown column silently', () => {
  const state = fromSearchParams(new URLSearchParams('where=bogus:eq:x'), DEF);
  assert.deepEqual(state.where, []);
});

check('fromSearchParams drops an op not valid for the column type silently', () => {
  const state = fromSearchParams(new URLSearchParams('where=title:gt:x'), DEF); // gt is not a text op
  assert.deepEqual(state.where, []);
});

check('fromSearchParams caps where at MAX_WHERE and ignores extras', () => {
  const qs = Array.from({ length: 9 }, () => 'where=signal_id:eq:a1').join('&');
  const state = fromSearchParams(new URLSearchParams(qs), DEF);
  assert.equal(state.where.length, MAX_WHERE);
});

check('fromSearchParams ignores an unknown cols key and dedupes, order preserved', () => {
  const state = fromSearchParams(new URLSearchParams('cols=title,bogus,relevance,title'), DEF);
  assert.deepEqual(state.cols, ['title', 'relevance']);
});

check('fromSearchParams caps sort at MAX_SORT and requires a known direction', () => {
  const state = fromSearchParams(new URLSearchParams('sort=title:asc,relevance:desc,published_on:sideways'), DEF);
  assert.deepEqual(state.sort, [{ col: 'title', dir: 'asc' }, { col: 'relevance', dir: 'desc' }]);
});

check('fromSearchParams reads only the pushdowns present in the params', () => {
  const state = fromSearchParams(new URLSearchParams('lens=market&since=2026-01-01'), DEF);
  assert.deepEqual(state.pushdowns, { lens: 'market', since: '2026-01-01' });
});

check('fromSearchParams drops a pushdown the dataset does not declare', () => {
  const noCompany = { ...DEF, filters: { lens: true } };
  const state = fromSearchParams(new URLSearchParams('lens=market&company=acme'), noCompany);
  assert.deepEqual(state.pushdowns, { lens: 'market' });
});

check('fromSearchParams drops every pushdown when the dataset declares no filters at all', () => {
  const noFilters = { ...DEF, filters: undefined };
  const state = fromSearchParams(new URLSearchParams('lens=market&company=acme'), noFilters);
  assert.deepEqual(state.pushdowns, {});
});

check('fromSearchParams over-length q is dropped, exactly-200 is kept', () => {
  const long = fromSearchParams(new URLSearchParams(`q=${'x'.repeat(201)}`), DEF);
  assert.equal(long.q, '');
  const ok = fromSearchParams(new URLSearchParams(`q=${'x'.repeat(200)}`), DEF);
  assert.equal(ok.q.length, 200);
});

// ---------------------------------------------------------------------------
// omission of empties: toSearchParams never emits a blank param.

check('an empty state produces an empty query string', () => {
  assert.equal(toSearchParams(emptyBuilderState()).toString(), '');
});

check('a where row missing a column or op is omitted', () => {
  const sp = toSearchParams({
    ...emptyBuilderState(),
    where: [{ col: '', op: '', value: '' }, { col: 'title', op: '', value: 'x' }, { col: '', op: 'eq', value: 'x' }],
  });
  assert.equal(sp.getAll('where').length, 0);
});

check('a where row with a real op but a blank value is omitted', () => {
  const sp = toSearchParams({ ...emptyBuilderState(), where: [{ col: 'title', op: 'eq', value: '   ' }] });
  assert.equal(sp.getAll('where').length, 0);
});

check('a sort row missing a column is omitted (Add sort key\'s initial state)', () => {
  const sp = toSearchParams({ ...emptyBuilderState(), sort: [{ col: '', dir: 'asc' }] });
  assert.equal(sp.toString(), '');
  const { errors } = parseFilterSpec(DEF, sp);
  assert.deepEqual(errors, []);
});

check('a sort row missing a column is dropped from the live description, not rendered as "sorted by  asc"', () => {
  const desc = describeState({ ...emptyBuilderState(), sort: [{ col: '', dir: 'asc' }] });
  assert.equal(desc, 'unfiltered');
});

check('blank cols/sort/q/limit/pushdowns never appear as params', () => {
  const sp = toSearchParams({ where: [], cols: [], sort: [], limit: null, q: '   ', pushdowns: { lens: '', day: '  ' } });
  assert.equal(sp.toString(), '');
});

// ---------------------------------------------------------------------------
// toViewParams / fromViewParams: BuilderState <-> a saved view's stored spec
// record (lib/portal/views-core.ts's ViewParams shape: `where` a string
// array, every other key a plain string, absent when unused). DEF (a real
// DatasetDef) satisfies the narrower FilterableDef both functions read.

check('toViewParams: an empty state produces an empty record', () => {
  assert.deepEqual(toViewParams(emptyBuilderState()), {});
});

check('toViewParams: where is always an array, even for a single row', () => {
  const state = { ...emptyBuilderState(), where: [{ col: 'significance', op: 'eq', value: 'high' }] };
  assert.deepEqual(toViewParams(state).where, ['significance:eq:high']);
});

check('toViewParams: cols/sort/limit/q/pushdowns are plain strings, empties omitted', () => {
  const state = {
    where: [],
    cols: ['title', 'significance'],
    sort: [{ col: 'published_on', dir: 'desc' }],
    limit: 50,
    q: 'agents',
    pushdowns: { lens: 'market', since: '' },
  };
  const params = toViewParams(state);
  assert.equal(params.cols, 'title,significance');
  assert.equal(params.sort, 'published_on:desc');
  assert.equal(params.limit, '50');
  assert.equal(params.q, 'agents');
  assert.equal(params.lens, 'market');
  assert.equal('since' in params, false);
  assert.equal('day' in params, false);
  assert.equal('where' in params, false);
});

check('toViewParams/fromViewParams round trip a full state (where as an array)', () => {
  const original = {
    where: [
      { col: 'significance', op: 'in', value: 'high,medium' },
      { col: 'title', op: 'contains', value: 'agents' },
    ],
    cols: ['title', 'significance', 'relevance'],
    sort: [{ col: 'published_on', dir: 'desc' }, { col: 'relevance', dir: 'asc' }],
    limit: 250,
    q: 'agentic coding',
    pushdowns: { lens: 'market', since: '2026-01-01' },
  };
  const params = toViewParams(original);
  assert.deepEqual(params.where, ['significance:in:high,medium', 'title:contains:agents']);
  const back = fromViewParams(params, DEF);
  assert.deepEqual(back, original);
});

check('fromViewParams reads an array where and a single-string where the same way', () => {
  const a = fromViewParams({ where: ['title:eq:Beta falls'] }, DEF);
  const b = fromViewParams({ where: 'title:eq:Beta falls' }, DEF);
  assert.deepEqual(a.where, b.where);
});

check('fromViewParams of an empty record matches emptyBuilderState', () => {
  assert.deepEqual(fromViewParams({}, DEF), emptyBuilderState());
});

// ---------------------------------------------------------------------------
// hrefs: one per action, over the route's own /api/datasets/<slug> shape.

check('hrefs: csv with no state is the bare route URL', () => {
  assert.equal(hrefs('signals', emptyBuilderState(), 'csv'), '/api/datasets/signals');
});

check('hrefs: json sets format=json and download=1, so Download JSON saves a file', () => {
  assert.equal(hrefs('signals', emptyBuilderState(), 'json'), '/api/datasets/signals?format=json&download=1');
});

check('hrefs: schema sets schema=1', () => {
  assert.equal(hrefs('signals', emptyBuilderState(), 'schema'), '/api/datasets/signals?schema=1');
});

check('hrefs: preview sets preview=N, defaulting to 25', () => {
  assert.equal(hrefs('signals', emptyBuilderState(), 'preview'), '/api/datasets/signals?preview=25');
  assert.equal(hrefs('signals', emptyBuilderState(), 'preview', 10), '/api/datasets/signals?preview=10');
});

check('hrefs: carries where/cols/sort/limit/q/pushdowns through to the URL', () => {
  const state = {
    where: [{ col: 'significance', op: 'eq', value: 'high' }],
    cols: ['title', 'significance'],
    sort: [{ col: 'published_on', dir: 'desc' }],
    limit: 50,
    q: 'agents',
    pushdowns: { lens: 'market' },
  };
  const sp = new URL(`https://x${hrefs('signals', state, 'csv')}`).searchParams;
  assert.equal(sp.get('where'), 'significance:eq:high');
  assert.equal(sp.get('cols'), 'title,significance');
  assert.equal(sp.get('sort'), 'published_on:desc');
  assert.equal(sp.get('limit'), '50');
  assert.equal(sp.get('q'), 'agents');
  assert.equal(sp.get('lens'), 'market');
});

// ---------------------------------------------------------------------------
// describeState: the count-line sentence.

check('describeState: unfiltered for an empty state', () => {
  assert.equal(describeState(emptyBuilderState()), 'unfiltered');
});

check('describeState: a pushdown-only state is not described as unfiltered', () => {
  const state = { ...emptyBuilderState(), pushdowns: { lens: 'market' } };
  assert.equal(describeState(state), 'lens market');
});

check('describeState: pushdowns lead, followed by where/search/sort/cols/limit', () => {
  const state = {
    where: [{ col: 'significance', op: 'eq', value: 'high' }],
    cols: [], sort: [], limit: null, q: '',
    pushdowns: { lens: 'market', since: '2026-01-01' },
  };
  assert.equal(describeState(state), 'lens market · since 2026-01-01 · significance is high');
});

check('describeState: matches the spec example wording', () => {
  const state = {
    where: [{ col: 'significance', op: 'in', value: 'high,medium' }],
    cols: ['a', 'b', 'c'],
    sort: [{ col: 'published_on', dir: 'desc' }],
    limit: null, q: '', pushdowns: {},
  };
  assert.equal(describeState(state), 'significance in high, medium · sorted by published_on desc · 3 columns');
});

check('describeState: every op renders without an em dash', () => {
  for (const type of TYPES) {
    const col = COL_FOR[type];
    for (const op of opsForType(type)) {
      const value = (op === 'isnull' || op === 'notnull') ? '' : (SAMPLE[type][op] ?? '');
      const desc = describeState({ where: [{ col, op, value }], cols: [], sort: [], limit: null, q: '', pushdowns: {} });
      assert.ok(!desc.includes('—'), `${type}:${op} -> ${desc}`);
    }
  }
  const combo = describeState({
    where: [{ col: 'title', op: 'contains', value: 'agents' }],
    cols: ['title'],
    sort: [{ col: 'title', dir: 'asc' }],
    limit: 10,
    q: 'agentic workflows',
    pushdowns: {},
  });
  assert.ok(!combo.includes('—'), combo);
  assert.match(combo, /search "agentic workflows"/);
  assert.match(combo, /limit 10/);
});

// ---------------------------------------------------------------------------
// requiresNarrowing: the intel-metrics-only inline guard. Mirrors the
// route's own isFilterRequested (isNarrowed || sort), so a cols projection
// or a limit alone trips it too, same as where/q/sort.

check('requiresNarrowing: false for a non intel-metrics dataset regardless of state', () => {
  const state = { where: [{ col: 'x', op: 'eq', value: 'y' }], cols: [], sort: [], limit: null, q: '', pushdowns: {} };
  assert.equal(requiresNarrowing({ slug: 'signals' }, state), false);
});

check('requiresNarrowing: intel-metrics requires since/source/company once where is present', () => {
  const state = { where: [{ col: 'x', op: 'eq', value: 'y' }], cols: [], sort: [], limit: null, q: '', pushdowns: {} };
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, state), true);
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, { ...state, pushdowns: { since: '2026-01-01' } }), false);
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, { ...state, pushdowns: { source: 'edgar_xbrl' } }), false);
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, { ...state, pushdowns: { company: 'acme' } }), false);
});

check('requiresNarrowing: q alone and sort alone also trip it', () => {
  const base = { where: [], cols: [], sort: [], limit: null, q: '', pushdowns: {} };
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, { ...base, q: 'agents' }), true);
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, { ...base, sort: [{ col: 'x', dir: 'asc' }] }), true);
});

check('requiresNarrowing: cols or limit alone now also trip it (mirrors isFilterRequested)', () => {
  const base = { where: [], cols: [], sort: [], limit: null, q: '', pushdowns: {} };
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, { ...base, cols: ['company_slug'] }), true);
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, { ...base, limit: 100 }), true);
  assert.equal(
    requiresNarrowing({ slug: 'intel-metrics' }, { ...base, cols: ['company_slug'], pushdowns: { source: 'edgar_xbrl' } }),
    false
  );
});

check('requiresNarrowing: a sort row missing a column does not trip it on its own', () => {
  const base = { where: [], cols: [], sort: [{ col: '', dir: 'asc' }], limit: null, q: '', pushdowns: {} };
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, base), false);
});

check('requiresNarrowing: an unused builder never trips it', () => {
  assert.equal(requiresNarrowing({ slug: 'intel-metrics' }, emptyBuilderState()), false);
});

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL QUERY BUILDER URL CHECKS PASSED');
