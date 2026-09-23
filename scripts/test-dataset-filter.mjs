// Tests for the dataset download route's filter grammar (lib/datasets/filter.ts):
// where/cols/sort/limit/q parsing and application, pure and DB-free. Mirrors
// scripts/test-datasets.mjs's style; run directly with plain Node (type
// stripping resolves the .ts imports below).
//
// Run: node scripts/test-dataset-filter.mjs

import assert from 'node:assert/strict';
import {
  applyFilterSpec, describeSpec, guardFilterRequest, isNarrowed, parseFilterSpec, projectColumns,
} from '../lib/datasets/filter.ts';
import { datasetToCSV, datasetToJSON } from '../lib/datasets/serialize.ts';
import { buildRowJsonSchema } from '../lib/datasets/handoff-shared.ts';

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
// Fixture dataset def. signal_id/title/summary/significance/relevance/
// published_on reuse REAL registry column keys (lib/datasets/handoff-shared.ts
// FIELD_FACTS carries significance's high/medium/low enum), so the closed-set
// validation path is exercised against the real map, not a fixture-only stub.
// `mood` is deliberately absent from FIELD_FACTS, to exercise the permissive
// path for an enum column FIELD_FACTS knows nothing about.

const DEF = {
  slug: 'fixture',
  title: 'Fixture dataset',
  description: 'd',
  methodology: 'm',
  category: 'meta',
  formats: ['csv', 'json'],
  columns: [
    { key: 'signal_id', label: 'ID', type: 'text', def: 'Stable id; the first column, so also the sort tiebreak.' },
    { key: 'title', label: 'Title', type: 'text', def: 'Title.' },
    { key: 'summary', label: 'Summary', type: 'longtext', def: 'Longtext summary.' },
    { key: 'significance', label: 'Significance', type: 'enum', def: 'FIELD_FACTS-backed enum: high, medium, low.' },
    { key: 'mood', label: 'Mood', type: 'enum', def: 'Enum with no FIELD_FACTS entry: permissive.' },
    { key: 'relevance', label: 'Relevance', type: 'number', def: 'A 0 to 1 number, nullable.' },
    { key: 'published_on', label: 'Published', type: 'date', def: 'YYYY-MM-DD or an ISO timestamp.' },
  ],
  build: async () => [],
};

const ROWS = [
  { signal_id: 'a1', title: 'Alpha rising', summary: 'A note about alpha growth in the market', significance: 'high', mood: 'good', relevance: 0.9, published_on: '2026-01-05' },
  { signal_id: 'a2', title: 'Beta falls', summary: 'A note about beta decline', significance: 'medium', mood: 'bad', relevance: 0.5, published_on: '2026-02-10' },
  { signal_id: 'a3', title: 'Gamma steady', summary: null, significance: 'low', mood: null, relevance: null, published_on: null },
  { signal_id: 'a4', title: 'Delta spikes', summary: 'Delta had a spike in usage this quarter', significance: 'high', mood: 'good', relevance: 0.75, published_on: '2026-01-20' },
  { signal_id: 'a5', title: 'Epsilon holds', summary: 'epsilon note, quiet quarter', significance: 'medium', mood: 'neutral', relevance: 0.3, published_on: '2026-03-01T00:00:00Z' },
];

const parse = (params) => parseFilterSpec(DEF, params);
const idsOf = (rows) => rows.map((r) => r.signal_id);

// ---------------------------------------------------------------------------
// where: every op for every column type

check('where: text eq/ne', () => {
  const { spec, errors } = parse({ where: 'title:eq:Beta falls' });
  assert.deepEqual(errors, []);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)), ['a2']);
  const ne = parse({ where: 'significance:ne:high' }).spec;
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, ne)).sort(), ['a2', 'a3', 'a5']);
});

check('where: text in, comma list', () => {
  const { spec, errors } = parse({ where: 'signal_id:in:a1,a3,a5' });
  assert.deepEqual(errors, []);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)).sort(), ['a1', 'a3', 'a5']);
});

check('where: longtext contains, case-insensitive', () => {
  const { spec, errors } = parse({ where: 'summary:contains:QUARTER' });
  assert.deepEqual(errors, []);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)).sort(), ['a4', 'a5']);
});

check('where: enum eq/ne/in with FIELD_FACTS values', () => {
  const eq = parse({ where: 'significance:eq:high' }).spec;
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, eq)).sort(), ['a1', 'a4']);
  const inOp = parse({ where: 'significance:in:high,low' }).spec;
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, inOp)).sort(), ['a1', 'a3', 'a4']);
});

check('where: enum isnull/notnull', () => {
  const isnull = parse({ where: 'mood:isnull:' }).spec;
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, isnull)), ['a3']);
  const notnull = parse({ where: 'mood:notnull' }).spec; // third segment absent entirely
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, notnull)).sort(), ['a1', 'a2', 'a4', 'a5']);
});

check('where: enum with no FIELD_FACTS entry is permissive', () => {
  const { spec, errors } = parse({ where: 'mood:eq:whatever' });
  assert.deepEqual(errors, []);
  assert.deepEqual(applyFilterSpec(DEF, ROWS, spec), []);
});

check('where: number eq/gt/gte/lt/lte/in', () => {
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'relevance:gt:0.5' }).spec)).sort(), ['a1', 'a4']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'relevance:gte:0.5' }).spec)).sort(), ['a1', 'a2', 'a4']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'relevance:lt:0.5' }).spec)).sort(), ['a5']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'relevance:lte:0.5' }).spec)).sort(), ['a2', 'a5']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'relevance:eq:0.5' }).spec)), ['a2']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'relevance:in:0.5,0.9' }).spec)).sort(), ['a1', 'a2']);
});

check('where: number ne never matches a null cell (incomparable, like every other op)', () => {
  // a3.relevance is null; a2.relevance is exactly 0.5 (excluded by ne).
  const { spec } = parse({ where: 'relevance:ne:0.5' });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)).sort(), ['a1', 'a4', 'a5']);
});

check('where: enum ne never matches a null cell either (a3.mood is null)', () => {
  const { spec } = parse({ where: 'mood:ne:good' });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)).sort(), ['a2', 'a5']);
});

check('where: number isnull excludes a comparison from matching', () => {
  // a3.relevance is null: gt/gte/lt/lte never match a null cell either direction.
  const gt = parse({ where: 'relevance:gt:-1' }).spec;
  assert.ok(!idsOf(applyFilterSpec(DEF, ROWS, gt)).includes('a3'));
  const isnull = parse({ where: 'relevance:isnull:' }).spec;
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, isnull)), ['a3']);
});

check('where: date eq/gt/gte/lt/lte, compared as YYYY-MM-DD strings', () => {
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'published_on:gt:2026-01-20' }).spec)).sort(), ['a2', 'a5']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'published_on:gte:2026-01-20' }).spec)).sort(), ['a2', 'a4', 'a5']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'published_on:lt:2026-01-20' }).spec)), ['a1']);
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, parse({ where: 'published_on:eq:2026-03-01' }).spec)), ['a5']);
});

check('where: date isnull/notnull', () => {
  const isnull = parse({ where: 'published_on:isnull:' }).spec;
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, isnull)), ['a3']);
  const notnull = parse({ where: 'published_on:notnull:' }).spec;
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, notnull)).sort(), ['a1', 'a2', 'a4', 'a5']);
});

check('where: date compares only the first 10 characters of an ISO timestamp', () => {
  // a5.published_on is '2026-03-01T00:00:00Z'; eq against the bare date must still match.
  const { spec } = parse({ where: 'published_on:eq:2026-03-01' });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)), ['a5']);
});

check('where: date rejects a non YYYY-MM-DD value', () => {
  const { errors } = parse({ where: 'published_on:eq:03/01/2026' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /published_on/);
});

check('where: multiple where clauses AND together', () => {
  const { spec } = parse({ where: ['significance:eq:high', 'relevance:gt:0.8'] });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)), ['a1']);
});

// The route only ever calls parseFilterSpec with a real URLSearchParams
// (req.nextUrl.searchParams); every other check above drives it with a plain
// record instead. Exercise the URLSearchParams branch directly (paramValues'
// getAll(), including a REPEATED where=), so a regression there cannot hide
// behind an all-green run.
check('parseFilterSpec: the URLSearchParams branch (repeated where=, sort, limit)', () => {
  const sp = new URLSearchParams(
    'where=significance:eq:high&where=relevance:gt:0.8&sort=published_on:desc&limit=2'
  );
  const { spec, errors } = parseFilterSpec(DEF, sp);
  assert.deepEqual(errors, []);
  assert.equal(spec.where.length, 2);
  assert.deepEqual(spec.where.map((w) => w.col), ['significance', 'relevance']);
  assert.deepEqual(spec.sort, [{ col: 'published_on', dir: 'desc' }]);
  assert.equal(spec.limit, 2);
});

// ---------------------------------------------------------------------------
// unknown column / unsupported op / enum rejection: exact messages

check('errors: unknown column names the token', () => {
  const { errors } = parse({ where: 'bogus:eq:x' });
  assert.deepEqual(errors, ["Unknown column in where: bogus"]);
});

check('errors: unsupported op for the column type names both', () => {
  const { errors } = parse({ where: 'title:gt:x' });
  assert.deepEqual(errors, ["Unsupported op 'gt' for text column title"]);
});

check('errors: unknown enum value lists the valid set', () => {
  const { errors } = parse({ where: 'significance:eq:huge' });
  assert.deepEqual(errors, ["Unknown value 'huge' for significance; valid: high, medium, low"]);
});

check('errors: unknown enum value is rejected on the in path too', () => {
  const { errors } = parse({ where: 'significance:in:high,huge' });
  assert.deepEqual(errors, ["Unknown value 'huge' for significance; valid: high, medium, low"]);
});

check('errors: unknown enum value is rejected on the ne path too', () => {
  const { errors } = parse({ where: 'significance:ne:huge' });
  assert.deepEqual(errors, ["Unknown value 'huge' for significance; valid: high, medium, low"]);
});

check('errors: enum op not in the allowed set for enum (contains)', () => {
  const { errors } = parse({ where: 'significance:contains:hi' });
  assert.deepEqual(errors, ["Unsupported op 'contains' for enum column significance"]);
});

check('errors: missing value for a single-value op names the op and column', () => {
  const { errors } = parse({ where: 'title:eq:' });
  assert.match(errors[0], /Missing value/);
  assert.match(errors[0], /title/);
});

check("errors: missing value for op 'in' names the op and column", () => {
  const { errors } = parse({ where: 'signal_id:in:' });
  assert.match(errors[0], /Missing value for op 'in'/);
  assert.match(errors[0], /signal_id/);
});

check('errors: a non-numeric value against a number column names the bad value', () => {
  const { errors } = parse({ where: 'relevance:gt:abc' });
  assert.match(errors[0], /Bad number 'abc'/);
});

check('errors: a where value over the length cap is rejected, and per-element in an in list', () => {
  const long = 'x'.repeat(201);
  const single = parse({ where: `title:eq:${long}` });
  assert.equal(single.errors.length, 1);
  assert.match(single.errors[0], /too long/);
  const inList = parse({ where: `signal_id:in:a1,${long}` });
  assert.equal(inList.errors.length, 1);
  assert.match(inList.errors[0], /too long/);
});

// ---------------------------------------------------------------------------
// caps: in-list max 20, where max 8

check('cap: in-list over 20 values errors', () => {
  const many = Array.from({ length: 21 }, (_, i) => `v${i}`).join(',');
  const { errors } = parse({ where: `signal_id:in:${many}` });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /max 20/);
});

check('cap: in-list at exactly 20 values is fine', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `v${i}`).join(',');
  const { errors } = parse({ where: `signal_id:in:${twenty}` });
  assert.deepEqual(errors, []);
});

check('cap: more than 8 where clauses errors, and only the first 8 are parsed', () => {
  const tokens = Array.from({ length: 9 }, () => 'signal_id:eq:a1');
  const { spec, errors } = parse({ where: tokens });
  assert.ok(errors.some((e) => /max 8/.test(e)));
  assert.equal(spec.where.length, 8);
});

check('cap: exactly 8 where clauses is fine', () => {
  const tokens = Array.from({ length: 8 }, () => 'signal_id:eq:a1');
  const { errors } = parse({ where: tokens });
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------
// a value may itself contain a colon: split on the first two only

check('where token splits on the first two colons only, so a value may contain one', () => {
  const { spec, errors } = parse({ where: 'title:eq:https://example.com/a:b' });
  assert.deepEqual(errors, []);
  assert.equal(spec.where[0].value, 'https://example.com/a:b');
});

// ---------------------------------------------------------------------------
// cols: projection order + duplicate removal + unknown column

check('cols: order preserved, duplicates removed', () => {
  const { spec, errors } = parse({ cols: 'relevance,signal_id,relevance,title' });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.cols, ['relevance', 'signal_id', 'title']);
});

check('cols: unknown key errors and names the token', () => {
  const { errors } = parse({ cols: 'signal_id,bogus' });
  assert.deepEqual(errors, ['Unknown column in cols: bogus']);
});

check('cols: absent means no projection (every column)', () => {
  const { spec } = parse({});
  assert.equal(spec.cols, null);
  assert.deepEqual(projectColumns(DEF, spec), DEF.columns);
});

check('projectColumns: never introduces a key outside the def', () => {
  const { spec } = parse({ cols: 'title,relevance' });
  const projected = projectColumns(DEF, spec);
  const defKeys = new Set(DEF.columns.map((c) => c.key));
  for (const c of projected) assert.ok(defKeys.has(c.key), c.key);
  assert.deepEqual(projected.map((c) => c.key), ['title', 'relevance']);
});

// ---------------------------------------------------------------------------
// sort: multi-key + implicit tiebreak + null-last + numeric compare

check('sort: numeric column compares numerically, not lexicographically', () => {
  const { spec, errors } = parse({ sort: 'relevance:asc' });
  assert.deepEqual(errors, []);
  const sorted = applyFilterSpec(DEF, ROWS, spec);
  // relevance: 0.9, 0.5, null, 0.75, 0.3 -> asc: 0.3, 0.5, 0.75, 0.9, then null last
  assert.deepEqual(idsOf(sorted), ['a5', 'a2', 'a4', 'a1', 'a3']);
});

check('sort: nulls sort last in both asc and desc', () => {
  const asc = applyFilterSpec(DEF, ROWS, parse({ sort: 'relevance:asc' }).spec);
  const desc = applyFilterSpec(DEF, ROWS, parse({ sort: 'relevance:desc' }).spec);
  assert.equal(idsOf(asc).at(-1), 'a3');
  assert.equal(idsOf(desc).at(-1), 'a3');
});

check('sort: a stable tiebreak on the def\'s first column is always appended', () => {
  // Every row has a distinct significance except a1/a4 (both 'high'); the two
  // 'high' rows must come out ordered by signal_id (the first column) asc.
  const { spec } = parse({ sort: 'significance:asc' });
  const sorted = idsOf(applyFilterSpec(DEF, ROWS, spec));
  const highs = sorted.filter((id) => ['a1', 'a4'].includes(id));
  assert.deepEqual(highs, ['a1', 'a4']);
});

check('sort: two-key sort orders by the first key, then the second, within ties', () => {
  const { spec, errors } = parse({ sort: 'significance:asc,relevance:desc' });
  assert.deepEqual(errors, []);
  // significance asc (lexicographic): high < low < medium -> a1/a4, a3, a2/a5;
  // relevance desc breaks each tie: a1(0.9) before a4(0.75); a2(0.5) before a5(0.3).
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)), ['a1', 'a4', 'a3', 'a2', 'a5']);
});

check('sort: limit applies after sort (top-N)', () => {
  const { spec } = parse({ sort: 'relevance:desc', limit: '2' });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)), ['a1', 'a4']);
});

check('sort: max 2 keys', () => {
  const { errors } = parse({ sort: 'signal_id:asc,relevance:desc,title:asc' });
  assert.ok(errors.some((e) => /max 2/.test(e)));
});

check('sort: bad direction errors', () => {
  const { errors } = parse({ sort: 'signal_id:sideways' });
  assert.match(errors[0], /asc or desc/);
});

check('sort: absent means rows keep build order (no re-sort)', () => {
  const { spec } = parse({});
  assert.deepEqual(applyFilterSpec(DEF, ROWS, spec), ROWS);
});

// ---------------------------------------------------------------------------
// limit: clamp 1..50000, applied after where/q/sort

check('limit: clamps into 1..50000', () => {
  assert.equal(parse({ limit: '3' }).spec.limit, 3);
  assert.equal(parse({ limit: '0' }).spec.limit, 1);
  assert.equal(parse({ limit: '999999' }).spec.limit, 50000);
});

check('limit: non-integer token errors', () => {
  const { errors } = parse({ limit: 'lots' });
  assert.match(errors[0], /between 1 and 50000/);
});

check('limit: applied after where narrows the set (slice of the filtered result)', () => {
  const { spec } = parse({ where: 'relevance:notnull:', limit: '2' });
  const rows = applyFilterSpec(DEF, ROWS, spec);
  assert.equal(rows.length, 2);
  // notnull relevance, build order: a1, a2, a4, a5 -> first 2
  assert.deepEqual(idsOf(rows), ['a1', 'a2']);
});

// ---------------------------------------------------------------------------
// q: case-insensitive substring over text/longtext/enum columns only

check('q: matches a text column, case-insensitively', () => {
  const { spec } = parse({ q: 'DELTA' });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)), ['a4']);
});

check('q: matches a longtext column', () => {
  const { spec } = parse({ q: 'decline' });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)), ['a2']);
});

check('q: matches an enum column', () => {
  const { spec } = parse({ q: 'medium' });
  assert.deepEqual(idsOf(applyFilterSpec(DEF, ROWS, spec)).sort(), ['a2', 'a5']);
});

check('q: never matches a number or date column', () => {
  // '0.9' appears nowhere in any text/longtext/enum cell; '2026' appears in
  // no text/longtext/enum cell either, only in date cells.
  assert.deepEqual(applyFilterSpec(DEF, ROWS, parse({ q: '0.9' }).spec), []);
  assert.deepEqual(applyFilterSpec(DEF, ROWS, parse({ q: '2026' }).spec), []);
});

check('q: over 200 chars errors', () => {
  const { errors } = parse({ q: 'x'.repeat(201) });
  assert.match(errors[0], /200/);
});

check('q: exactly 200 chars is fine', () => {
  const { errors } = parse({ q: 'x'.repeat(200) });
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------
// isNarrowed / describeSpec

check('isNarrowed: false for an empty spec', () => {
  assert.equal(isNarrowed(parse({}).spec), false);
});
check('isNarrowed: true for where, q, cols, or limit alone', () => {
  assert.equal(isNarrowed(parse({ where: 'title:eq:x' }).spec), true);
  assert.equal(isNarrowed(parse({ q: 'x' }).spec), true);
  assert.equal(isNarrowed(parse({ cols: 'title' }).spec), true);
  assert.equal(isNarrowed(parse({ limit: '5' }).spec), true);
});
check('isNarrowed: false for sort alone (sort reorders, it does not narrow)', () => {
  assert.equal(isNarrowed(parse({ sort: 'title:asc' }).spec), false);
});

check('describeSpec: unfiltered', () => {
  assert.equal(describeSpec(parse({}).spec), 'unfiltered');
});
check('describeSpec: describes a combined spec in order', () => {
  const { spec } = parse({ where: 'title:eq:x', q: 'y', cols: 'title,signal_id', sort: 'title:asc', limit: '10' });
  assert.equal(describeSpec(spec), '1 filter, search, 2 columns, sorted, limit 10');
});
check('describeSpec: pluralizes filter count', () => {
  const { spec } = parse({ where: ['title:eq:x', 'significance:eq:high'] });
  assert.equal(describeSpec(spec), '2 filters');
});

// ---------------------------------------------------------------------------
// serialize.ts / handoff-shared.ts over a projected def: pure and importable,
// but nothing exercised them against the filter grammar's own projection.

check('serialize: CSV header equals the projected column keys, in order', () => {
  const { spec } = parse({ cols: 'relevance,signal_id,title' });
  const projected = projectColumns(DEF, spec);
  const csv = datasetToCSV(DEF, ROWS.slice(0, 2), { columns: projected });
  const headerLine = csv.split('\r\n')[0];
  assert.equal(headerLine, projected.map((c) => c.key).join(','));
});

check('serialize: JSON envelope columns and filter mirror the projection and spec', () => {
  const { spec } = parse({ cols: 'title,relevance', where: 'significance:eq:high' });
  const projected = projectColumns(DEF, spec);
  const json = JSON.parse(datasetToJSON(DEF, ROWS.slice(0, 1), { columns: projected, filter: spec }));
  assert.deepEqual(json.dataset.columns.map((c) => c.key), projected.map((c) => c.key));
  assert.deepEqual(json.dataset.filter, spec);
});

check('handoff-shared: buildRowJsonSchema over a projected def requires exactly the projected keys', () => {
  const { spec } = parse({ cols: 'signal_id,significance' });
  const projected = projectColumns(DEF, spec);
  const projectedDef = { ...DEF, columns: projected };
  const schema = buildRowJsonSchema(projectedDef);
  assert.deepEqual(schema.required, projected.map((c) => c.key));
});

// ---------------------------------------------------------------------------
// guardFilterRequest: the route's two CPU-safety guardrails, pure and testable
// directly (the route itself imports lib/db, so it cannot load in plain Node).

check('guardFilterRequest: no guard when the grammar was not invoked at all', () => {
  const { spec } = parse({});
  assert.equal(guardFilterRequest(DEF, spec, { isPreview: false }), null);
});

check('guardFilterRequest: intel-metrics requires since/source/company to narrow a where request', () => {
  const IM = { ...DEF, slug: 'intel-metrics' };
  const { spec } = parse({ where: 'significance:eq:high' });
  const denied = guardFilterRequest(IM, spec, { isPreview: false });
  assert.equal(denied.status, 400);
  assert.match(denied.error, /since, source or company/);
  assert.equal(guardFilterRequest(IM, spec, { isPreview: false, since: '2026-01-01' }), null);
});

check('guardFilterRequest: intel-metrics requires narrowing for a sort-only request too', () => {
  const IM = { ...DEF, slug: 'intel-metrics' };
  const { spec } = parse({ sort: 'relevance:desc' });
  assert.equal(guardFilterRequest(IM, spec, { isPreview: false })?.status, 400);
});

check('guardFilterRequest: a no-where/q preview is exempt on intel-metrics', () => {
  const IM = { ...DEF, slug: 'intel-metrics' };
  const { spec } = parse({ sort: 'relevance:desc' });
  assert.equal(guardFilterRequest(IM, spec, { isPreview: true }), null);
});

check('guardFilterRequest: a preview carrying where/q is NOT exempt on intel-metrics', () => {
  const IM = { ...DEF, slug: 'intel-metrics' };
  const { spec } = parse({ where: 'significance:eq:high' });
  assert.equal(guardFilterRequest(IM, spec, { isPreview: true })?.status, 400);
});

check('guardFilterRequest: the post-build row-count cap applies to any dataset, only once rowCount is known', () => {
  const { spec } = parse({ where: 'significance:eq:high' });
  assert.equal(guardFilterRequest(DEF, spec, { isPreview: false }), null, 'pre-build: no rowCount, no cap check');
  assert.equal(guardFilterRequest(DEF, spec, { isPreview: false, rowCount: 100 }), null);
  const denied = guardFilterRequest(DEF, spec, { isPreview: false, rowCount: 400_001 });
  assert.equal(denied.status, 413);
});

// ---------------------------------------------------------------------------
// no em dash in any message string this module can produce

check('house style: no em dash in any error message', () => {
  const probes = [
    parse({ where: 'bogus:eq:x' }),
    parse({ where: 'title:gt:x' }),
    parse({ where: 'significance:eq:huge' }),
    parse({ cols: 'bogus' }),
    parse({ sort: 'bogus:asc' }),
    parse({ limit: 'nope' }),
    parse({ q: 'x'.repeat(201) }),
  ];
  for (const { errors } of probes) {
    for (const e of errors) assert.ok(!e.includes('—'), e);
  }
});

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL DATASET FILTER CHECKS PASSED');
