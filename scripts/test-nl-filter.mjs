// Tests for lib/portal/nl-core.ts (the Data Portal's natural-language-to-filter
// helpers), pure and DB-free. Mirrors scripts/test-dataset-filter.mjs's fixture
// style. Run: node scripts/test-nl-filter.mjs

import assert from 'node:assert/strict';
import {
  buildNlCatalog, NlUnknownDataset, nlSchema, validateNlOutput,
} from '../lib/portal/nl-core.ts';
import { parseFilterSpec } from '../lib/datasets/filter.ts';

let pass = 0; let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// Fixture datasets. `significance` reuses a real registry column key so the
// FIELD_FACTS-backed enum path (lib/datasets/handoff-shared.ts) is exercised
// against the real map, same as scripts/test-dataset-filter.mjs.
const OPEN_DEF = {
  slug: 'fixture-open',
  title: 'Fixture open dataset',
  description: 'An open fixture dataset, for the NL query builder tests.',
  methodology: 'm',
  category: 'meta',
  formats: ['csv', 'json'],
  filters: { lens: true },
  columns: [
    { key: 'signal_id', label: 'ID', type: 'text', def: 'Stable id; the sort tiebreak.' },
    { key: 'title', label: 'Title', type: 'text', def: 'Title.' },
    { key: 'significance', label: 'Significance', type: 'enum', def: 'FIELD_FACTS-backed: high, medium, low.' },
    { key: 'relevance', label: 'Relevance', type: 'number', def: 'A 0 to 1 number.' },
    { key: 'published_on', label: 'Published', type: 'date', def: 'YYYY-MM-DD.' },
    // Its own `values` override a FIELD_FACTS collision: FIELD_FACTS knows
    // `status` as tooling_products' candidate/cataloged/parked/dismissed set.
    { key: 'status', label: 'Status', type: 'enum', def: 'Own override.', values: ['open', 'closed'] },
    // Enum with neither a `values` override nor a FIELD_FACTS entry: the
    // closed set lives only in its gloss, same as the registry's node_type.
    { key: 'node_type', label: 'Node type', type: 'enum', def: 'question, stance, claim, frame, or bridge_claim.' },
  ],
  build: async () => [],
};

const GATED_DEF = {
  ...OPEN_DEF,
  slug: 'fixture-gated',
  title: 'Fixture gated dataset',
  description: 'A key-gated fixture dataset.',
  keyGated: true,
};

const DEFS = [OPEN_DEF, GATED_DEF];
const readableAll = () => true;
const readablePublicOnly = (def) => !def.keyGated;

// ---------------------------------------------------------------------------
// buildNlCatalog / nlSchema

check('buildNlCatalog: lists a readable dataset with its columns and enum values', () => {
  const catalog = buildNlCatalog(DEFS, readableAll);
  assert.match(catalog, /fixture-open: An open fixture dataset/);
  assert.match(catalog, /fixture-gated: A key-gated fixture dataset/);
  assert.match(catalog, /significance: enum \[high, medium, low\]/);
});

check('buildNlCatalog: hides a dataset the reader cannot read', () => {
  const catalog = buildNlCatalog(DEFS, readablePublicOnly);
  assert.match(catalog, /fixture-open:/);
  assert.equal(catalog.includes('fixture-gated:'), false);
});

check('buildNlCatalog: an enum column\'s own values override a FIELD_FACTS collision on the same key', () => {
  const catalog = buildNlCatalog(DEFS, readableAll);
  assert.match(catalog, /status: enum \[open, closed\]/);
  assert.equal(catalog.includes('candidate, cataloged, parked, dismissed'), false);
});

check('buildNlCatalog: an enum column with no declared values falls back to its def gloss, not a bare "enum"', () => {
  const catalog = buildNlCatalog(DEFS, readableAll);
  assert.match(catalog, /node_type: enum \(question, stance, claim, frame, or bridge_claim\.\)/);
});

check('buildNlCatalog: house style, no em dash', () => {
  const catalog = buildNlCatalog(DEFS, readableAll);
  assert.equal(catalog.includes('—'), false);
});

check('nlSchema: dataset enum matches the given slugs, limit carries no minimum/maximum', () => {
  const schema = nlSchema(['fixture-open', 'fixture-gated']);
  assert.deepEqual(schema.properties.dataset.enum, ['fixture-open', 'fixture-gated']);
  const limitProp = schema.properties.params.properties.limit;
  assert.equal('minimum' in limitProp, false);
  assert.equal('maximum' in limitProp, false);
  assert.match(limitProp.description, /50000|50,000/);
});

check('nlSchema: house style, no em dash in any description', () => {
  const schema = nlSchema(['fixture-open']);
  const text = JSON.stringify(schema);
  assert.equal(text.includes('—'), false);
});

// ---------------------------------------------------------------------------
// validateNlOutput

check('validateNlOutput: unknown dataset rejected', () => {
  assert.throws(
    () => validateNlOutput({ dataset: 'nope', params: {}, explanation: '' }, DEFS, readableAll),
    NlUnknownDataset
  );
  assert.throws(
    () => validateNlOutput({ dataset: '', params: {}, explanation: '' }, DEFS, readableAll),
    NlUnknownDataset
  );
});

check('validateNlOutput: key-gated dataset rejected for a non-keyholder', () => {
  assert.throws(
    () => validateNlOutput({ dataset: 'fixture-gated', params: {}, explanation: '' }, DEFS, readablePublicOnly),
    NlUnknownDataset
  );
  // The same dataset succeeds once the reader can see it.
  const out = validateNlOutput({ dataset: 'fixture-gated', params: {}, explanation: 'ok' }, DEFS, readableAll);
  assert.equal(out.dataset, 'fixture-gated');
});

check('validateNlOutput: unknown column in a where filter is dropped with an audit entry', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'nope', op: 'eq', value: 'x' }] }, explanation: 'test' },
    DEFS, readableAll
  );
  assert.equal('where' in out.params, false);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /nope/);
});

check('validateNlOutput: an enum value outside the set is dropped with an audit entry', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'significance', op: 'eq', value: 'critical' }] }, explanation: 'test' },
    DEFS, readableAll
  );
  assert.equal('where' in out.params, false);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /significance/);
});

check('validateNlOutput: a valid where filter survives', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'significance', op: 'eq', value: 'high' }] }, explanation: 'test' },
    DEFS, readableAll
  );
  assert.deepEqual(out.params.where, ['significance:eq:high']);
  assert.equal(out.dropped.length, 0);
});

check('validateNlOutput: limit is clamped into range; 0 or absent means unset', () => {
  const tooBig = validateNlOutput({ dataset: 'fixture-open', params: { limit: 999999 }, explanation: 't' }, DEFS, readableAll);
  assert.equal(tooBig.params.limit, '50000');
  const zero = validateNlOutput({ dataset: 'fixture-open', params: { limit: 0 }, explanation: 't' }, DEFS, readableAll);
  assert.equal('limit' in zero.params, false);
  const negative = validateNlOutput({ dataset: 'fixture-open', params: { limit: -5 }, explanation: 't' }, DEFS, readableAll);
  assert.equal('limit' in negative.params, false);
});

check('validateNlOutput: an unsupported pushdown for the dataset is dropped WITH an audit entry', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { day: '2026-01-01' }, explanation: 't' },
    DEFS, readableAll
  );
  // fixture-open declares only filters.lens, not filters.day: the value
  // never reaches params, but the caller must be told why, not left to
  // wonder why the href it got back is narrower than the question asked.
  assert.equal('day' in out.params, false);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /day is not a filter on fixture-open/);
});

check('validateNlOutput: a malformed value for a SUPPORTED pushdown is dropped, not saved to 400 on every apply', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { lens: 'economy' }, explanation: 't' },
    DEFS, readableAll
  );
  // fixture-open declares filters.lens, but 'economy' is not one of the six.
  assert.equal('lens' in out.params, false);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /Unknown lens/);
});

check('validateNlOutput: an unsupported op for the column\'s type is dropped with parseFilterSpec\'s own message', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'relevance', op: 'contains', value: '1' }] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.equal('where' in out.params, false);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /Unsupported op/);
});

check('validateNlOutput: a malformed date value is dropped', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'published_on', op: 'eq', value: 'not-a-date' }] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.equal('where' in out.params, false);
  assert.match(out.dropped[0], /Bad date/);
});

check('validateNlOutput: a malformed number value is dropped', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'relevance', op: 'gt', value: 'abc' }] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.equal('where' in out.params, false);
  assert.match(out.dropped[0], /Bad number/);
});

check('validateNlOutput: a numeric where value (the model answered a number, not a string) is coerced, not dropped', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'relevance', op: 'gt', value: 0.5 }] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.deepEqual(out.params.where, ['relevance:gt:0.5']);
  assert.equal(out.dropped.length, 0);
});

check('validateNlOutput: an \'in\' filter with spaces after the commas is trimmed and survives', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'significance', op: 'in', value: 'high, medium' }] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.deepEqual(out.params.where, ['significance:in:high,medium']);
  assert.equal(out.dropped.length, 0);
});

check('validateNlOutput: an isnull filter builds the col:isnull: token shape and survives', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { where: [{ col: 'relevance', op: 'isnull', value: '' }] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.deepEqual(out.params.where, ['relevance:isnull:']);
  assert.equal(out.dropped.length, 0);
});

check('validateNlOutput: an unknown column in cols is dropped with an audit entry', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { cols: ['nope'] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.equal('cols' in out.params, false);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /unknown column in cols/);
});

check('validateNlOutput: a sort key on an unknown column is dropped with an audit entry', () => {
  const out = validateNlOutput(
    { dataset: 'fixture-open', params: { sort: [{ col: 'nope', dir: 'asc' }] }, explanation: 't' },
    DEFS, readableAll
  );
  assert.equal('sort' in out.params, false);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /bad sort key/);
});

check('validateNlOutput: more where filters than the cap drops a count note, not silence', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ col: 'relevance', op: 'gt', value: String(i) }));
  const out = validateNlOutput({ dataset: 'fixture-open', params: { where: many }, explanation: 't' }, DEFS, readableAll);
  assert.equal(out.params.where.length, 8);
  assert.match(out.dropped[0], /2 extra filters were dropped/);
});

check('validateNlOutput: more cols than the cap drops a count note, not silence', () => {
  const many = Array.from({ length: 41 }, () => 'title');
  const out = validateNlOutput({ dataset: 'fixture-open', params: { cols: many }, explanation: 't' }, DEFS, readableAll);
  assert.equal(out.params.cols.split(',').length, 40);
  assert.match(out.dropped[0], /1 extra column was dropped/);
});

check('validateNlOutput: more sort keys than the cap drops a count note, not silence', () => {
  const many = [
    { col: 'title', dir: 'asc' }, { col: 'relevance', dir: 'desc' }, { col: 'signal_id', dir: 'asc' },
  ];
  const out = validateNlOutput({ dataset: 'fixture-open', params: { sort: many }, explanation: 't' }, DEFS, readableAll);
  assert.equal(out.params.sort.split(',').length, 2);
  assert.match(out.dropped[0], /1 extra sort key was dropped/);
});

check('validateNlOutput: a numeric-string limit (the model answered a string, not an integer) is accepted', () => {
  const out = validateNlOutput({ dataset: 'fixture-open', params: { limit: '100' }, explanation: 't' }, DEFS, readableAll);
  assert.equal(out.params.limit, '100');
  assert.equal(out.dropped.length, 0);
});

check('validateNlOutput: a limit above the cap is clamped WITH a dropped note explaining why', () => {
  const out = validateNlOutput({ dataset: 'fixture-open', params: { limit: 999999 }, explanation: 't' }, DEFS, readableAll);
  assert.equal(out.params.limit, '50000');
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0], /limit clamped to 50000/);
});

check('validateNlOutput: a clean output round-trips to a params record parseFilterSpec accepts with no errors', () => {
  const out = validateNlOutput(
    {
      dataset: 'fixture-open',
      params: {
        where: [{ col: 'significance', op: 'eq', value: 'high' }],
        cols: ['signal_id', 'title'],
        sort: [{ col: 'title', dir: 'asc' }],
        limit: 25,
        q: 'alpha',
        lens: 'market',
        day: '', since: '', source: '', company: '',
      },
      explanation: 'A clean query about high-significance signals.',
    },
    DEFS, readableAll
  );
  const { errors } = parseFilterSpec(OPEN_DEF, out.params);
  assert.deepEqual(errors, []);
  assert.equal(out.dropped.length, 0);
  assert.equal(out.explanation, 'A clean query about high-significance signals.');
});

check('validateNlOutput: house style, no em dash ever appears in a dropped message', () => {
  const out = validateNlOutput(
    {
      dataset: 'fixture-open',
      params: { where: [{ col: 'bogus', op: 'eq', value: 'x' }, { col: 'significance', op: 'eq', value: 'huge' }] },
      explanation: 'ok',
    },
    DEFS, readableAll
  );
  for (const d of out.dropped) assert.equal(d.includes('—'), false, d);
});

if (fail) {
  console.error(`\n${fail} CHECK(S) FAILED`);
  process.exit(1);
}
console.log(`\nALL NL FILTER CHECKS PASSED (${pass})`);
