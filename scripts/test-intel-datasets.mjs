// Tests for the Intel Desk's four datasets and their importer handoff doc
// (lib/datasets/registry.ts intel-*, lib/intel/handoff.ts buildIntelHandoff).
// Registry/schema-level only, no DB required: mirrors the importer-handoff
// section of scripts/test-scan.mjs. READ-ONLY, never writes a row.
// Run: node scripts/test-intel-datasets.mjs

import assert from 'node:assert/strict';
import { getDataset } from '../lib/datasets/registry.ts';
import { buildRowJsonSchema } from '../lib/datasets/handoff-shared.ts';
import { buildIntelHandoff } from '../lib/intel/handoff.ts';

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

console.log('intel datasets:');

const scanDef = getDataset('external-scan');
const itemsDef = getDataset('intel-items');
const companiesDef = getDataset('intel-companies');
const factsDef = getDataset('intel-facts');
const metricsDef = getDataset('intel-metrics');
const INTEL_DEFS = [itemsDef, companiesDef, factsDef, metricsDef];

check('registry: all four intel-* defs are present', () => {
  assert.ok(scanDef, 'external-scan def missing from the registry');
  for (const d of INTEL_DEFS) assert.ok(d, 'an intel-* def is missing from the registry');
});

// ---- (a) intel-items leading columns mirror external-scan key for key -----

check('intel-items: leading columns mirror external-scan key for key', () => {
  // The mirrored/shared prefix is the base scan-item shape, through
  // enriched_by; external-scan and intel-items then each append their own
  // domain-specific columns after it (intel-items: doc_type, company_slugs,
  // tier; both: source_tier..priority, migration 0052), so the comparison is
  // against that shared prefix, not external-scan's full (longer) column
  // list.
  const scanKeys = scanDef.columns.map((c) => c.key);
  const sharedLen = scanKeys.indexOf('enriched_by') + 1;
  const intelKeys = itemsDef.columns.map((c) => c.key);
  assert.ok(intelKeys.length > sharedLen, 'intel-items has no appended columns beyond the mirrored set');
  assert.deepEqual(intelKeys.slice(0, sharedLen), scanKeys.slice(0, sharedLen));
});

// ---- (b) every column of all four intel defs has real FIELD_FACTS ---------

check('buildRowJsonSchema covers every column of every intel def with real facts', () => {
  for (const d of INTEL_DEFS) {
    const schema = buildRowJsonSchema(d);
    for (const c of d.columns) {
      const p = schema.properties[c.key];
      assert.ok(p, `${d.slug}: no schema property for ${c.key}`);
      // The permissive fallback (['string','number','null']) means
      // lib/datasets/handoff-shared.ts's FIELD_FACTS was not updated for a
      // new column: fix it there.
      assert.ok(
        !(Array.isArray(p.type) && p.type.length === 3),
        `${d.slug}.${c.key} fell back to the permissive type; add it to FIELD_FACTS`
      );
    }
    assert.deepEqual(schema.required, d.columns.map((c) => c.key), d.slug);
  }
});

// ---- (c) buildIntelHandoff covers every column, schemas parse, no em dash -

check('buildIntelHandoff embeds every column key of every def and parseable JSON Schemas', () => {
  const text = buildIntelHandoff({
    defs: INTEL_DEFS,
    companies: [
      { slug: 'example-bank', name: 'Example Bancorp', tier: 'consumer_bank', ticker: 'EXBK', active: true },
      { slug: 'example-fintech', name: 'Example Fintech', tier: 'fintech', ticker: null, active: true },
    ],
    crons: [{ path: '/api/cron/intel', schedule: '0 10 * * 1-5' }],
    host: 'https://example.test',
    generatedOn: '2026-08-30',
  });

  for (const d of INTEL_DEFS) {
    for (const c of d.columns) {
      assert.ok(text.includes(`| ${c.key} |`), `handoff missing ${d.slug}.${c.key}`);
    }
  }

  const fenced = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(fenced.length, INTEL_DEFS.length, `expected ${INTEL_DEFS.length} fenced JSON Schema blocks, found ${fenced.length}`);
  const titles = fenced.map((block) => JSON.parse(block).properties.rows.items.title).sort();
  assert.deepEqual(titles, INTEL_DEFS.map((d) => `${d.slug} row`).sort());

  assert.ok(!text.includes('—'), 'handoff contains an em dash');
});

// ---- (d) all four defs are keyGated and heavy ------------------------------

check('every intel-* dataset is key-gated and heavy: nothing intel-shaped ships ungated', () => {
  for (const d of INTEL_DEFS) {
    assert.equal(d.keyGated, true, `${d.slug}.keyGated`);
    assert.equal(d.heavy, true, `${d.slug}.heavy`);
    assert.equal(d.category, 'intel', `${d.slug}.category`);
  }
});

// ---- (e) intel-metrics: since/source/company incremental-pull filters -----

check('intel-metrics: registry declares the since/source/company filters', () => {
  assert.deepEqual(metricsDef.filters, { since: true, source: true, company: true });
});

check('intel-items and intel-facts declare the company filter too; company is intel-only', () => {
  assert.equal(itemsDef.filters?.company, true);
  assert.equal(factsDef.filters?.company, true);
  assert.equal(companiesDef.filters?.company, undefined, 'intel-companies has no company= filter (it IS the company list)');
  assert.equal(scanDef.filters?.company, undefined, 'external-scan has no company filter');
});

// A mock Q that never touches a DB: it just records the SQL text and params
// passed to it and returns no rows, so a builder can be driven directly.
let capturedSql = '';
let capturedParams = [];
const captureQ = async (sql, params) => {
  capturedSql = sql;
  capturedParams = params ?? [];
  return [];
};

await metricsDef.build(captureQ, {});
const unfilteredSql = capturedSql;

check('buildIntelMetrics: no since/source filter carries neither predicate', () => {
  assert.ok(!unfilteredSql.includes('fetched_at >='), 'unfiltered SQL should not carry the since predicate');
  assert.ok(!unfilteredSql.includes('m.source ='), 'unfiltered SQL should not carry the source predicate');
});

await metricsDef.build(captureQ, { since: '2026-08-01' });
const sinceSql = capturedSql;

check('buildIntelMetrics: since= adds the fetched_at predicate only', () => {
  assert.ok(sinceSql.includes('m.fetched_at >= $1::date'), 'since filter should add the fetched_at predicate');
  assert.ok(!sinceSql.includes('m.source ='), 'since alone should not add the source predicate');
});

await metricsDef.build(captureQ, { source: 'edgar_xbrl' });
const sourceSql = capturedSql;

check('buildIntelMetrics: source= adds the source predicate only', () => {
  assert.ok(sourceSql.includes('m.source = $1'), 'source filter should add the source predicate');
  assert.ok(!sourceSql.includes('fetched_at >='), 'source alone should not add the since predicate');
});

await metricsDef.build(captureQ, { since: '2026-08-01', source: 'edgar_xbrl' });
const bothSql = capturedSql;

check('buildIntelMetrics: since+source combine in one where clause', () => {
  assert.ok(bothSql.includes('m.fetched_at >= $1::date'), 'combined filters should include the since predicate');
  assert.ok(bothSql.includes('m.source = $2'), 'combined filters should include the source predicate, second param');
});

// ---- (f) the company pushdown (the filter grammar's one new SQL param) ----
// Additive-only: no company= means byte-identical SQL to before it existed.

await metricsDef.build(captureQ, {});
check('buildIntelMetrics: no company= carries no company predicate', () => {
  assert.ok(!capturedSql.includes('company_slug ='), 'unfiltered SQL should not carry the company predicate');
});

await metricsDef.build(captureQ, { company: 'example-bank' });
check('buildIntelMetrics: company= adds the company_slug predicate and its param', () => {
  assert.ok(capturedSql.includes('m.company_slug = $1'), 'company filter should add the company_slug predicate');
  assert.deepEqual(capturedParams, ['example-bank']);
});

await metricsDef.build(captureQ, { since: '2026-08-01', source: 'edgar_xbrl', company: 'example-bank' });
check('buildIntelMetrics: since+source+company combine, company last, third param', () => {
  assert.ok(capturedSql.includes('m.fetched_at >= $1::date'));
  assert.ok(capturedSql.includes('m.source = $2'));
  assert.ok(capturedSql.includes('m.company_slug = $3'));
  assert.deepEqual(capturedParams, ['2026-08-01', 'edgar_xbrl', 'example-bank']);
});

await itemsDef.build(captureQ, {});
const itemsUnfilteredSql = capturedSql;
check('buildIntelItems: no company= carries no company_slugs predicate', () => {
  assert.ok(!itemsUnfilteredSql.includes('company_slugs)'), 'unfiltered SQL should not carry the company predicate');
});

await itemsDef.build(captureQ, { company: 'example-bank' });
check('buildIntelItems: company= adds the any(company_slugs) predicate and its param', () => {
  assert.ok(capturedSql.includes('= any(i.company_slugs)'), 'company filter should add the company_slugs predicate');
  assert.ok(capturedParams.includes('example-bank'));
});

await factsDef.build(captureQ, {});
const factsUnfilteredSql = capturedSql;
check('buildIntelFacts: no company= carries no where clause at all', () => {
  assert.ok(!factsUnfilteredSql.includes('where'), 'unfiltered SQL should carry no where clause');
});

await factsDef.build(captureQ, { company: 'example-bank' });
check('buildIntelFacts: company= adds a where f.company_slug predicate and its param', () => {
  assert.ok(capturedSql.includes('where f.company_slug = $1'), 'company filter should add the company_slug predicate');
  assert.deepEqual(capturedParams, ['example-bank']);
});

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
