// Tests for the generic per-dataset importer handoff
// (lib/datasets/handoff-generic.ts buildDatasetHandoff, served at
// GET /api/datasets/<slug>/handoff). Registry-level only: no DB, no Request,
// mirrors the registry/schema half of scripts/test-scan.mjs,
// test-intel-datasets.mjs, and test-tooling-datasets.mjs.
// Run: node scripts/test-dataset-handoff.mjs

import assert from 'node:assert/strict';
import { DATASETS, getDataset } from '../lib/datasets/registry.ts';
import { buildDatasetHandoff } from '../lib/datasets/handoff-generic.ts';

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

console.log('generic dataset handoff:');

const ORIGIN = 'https://example.test';

check('every registry def renders a non-empty handoff with no em dash', () => {
  for (const def of DATASETS) {
    const text = buildDatasetHandoff(def, { origin: ORIGIN });
    assert.ok(typeof text === 'string' && text.length > 0, def.slug);
    assert.ok(!text.includes('—'), `${def.slug}: handoff contains an em dash`);
  }
});

check('every registry def\'s handoff embeds every one of its column keys', () => {
  for (const def of DATASETS) {
    const text = buildDatasetHandoff(def, { origin: ORIGIN });
    for (const c of def.columns) {
      assert.ok(text.includes(`| ${c.key} |`), `${def.slug}: handoff missing ${c.key}`);
    }
  }
});

check('every registry def\'s handoff carries one parseable JSON Schema block whose row title matches the slug', () => {
  for (const def of DATASETS) {
    const text = buildDatasetHandoff(def, { origin: ORIGIN });
    const fenced = /```json\n([\s\S]*?)\n```/.exec(text);
    assert.ok(fenced, `${def.slug}: no fenced JSON Schema block`);
    const parsed = JSON.parse(fenced[1]);
    assert.equal(parsed.properties.rows.items.title, `${def.slug} row`, def.slug);
  }
});

check('key-gated datasets\' handoffs mention both access-key header forms', () => {
  const gated = DATASETS.filter((d) => d.keyGated);
  assert.ok(gated.length > 0, 'expected at least one key-gated dataset in the registry');
  for (const def of gated) {
    const text = buildDatasetHandoff(def, { origin: ORIGIN });
    assert.ok(text.includes('Authorization: Bearer'), `${def.slug}: missing Authorization: Bearer`);
    assert.ok(text.includes('X-Atlas-Key'), `${def.slug}: missing X-Atlas-Key`);
  }
});

check('public datasets\' handoffs still carry the scripts-auth paragraph (reused unconditionally)', () => {
  const publicDef = getDataset('signals');
  assert.ok(publicDef && !publicDef.keyGated, 'signals should be public');
  const text = buildDatasetHandoff(publicDef, { origin: ORIGIN });
  assert.ok(text.includes('Authorization: Bearer'), 'signals handoff missing the shared auth paragraph');
});

check('the three intel datasets that declare company mention company= in their handoff', () => {
  for (const slug of ['intel-items', 'intel-facts', 'intel-metrics']) {
    const def = getDataset(slug);
    assert.ok(def, slug);
    assert.ok(def.filters?.company, `${slug} should declare the company filter`);
    const text = buildDatasetHandoff(def, { origin: ORIGIN });
    assert.ok(text.includes('company='), `${slug}: handoff missing company=`);
  }
});

check('a known nullable column renders FIELD_FACTS nullability (headline: string or null)', () => {
  const def = getDataset('external-scan');
  assert.ok(def, 'external-scan');
  const text = buildDatasetHandoff(def, { origin: ORIGIN });
  assert.ok(text.includes('| headline | string or null |'), 'headline should render as "string or null"');
});

check('a def with filters.lens lists every lens value', () => {
  const def = getDataset('signals');
  assert.ok(def?.filters?.lens, 'signals should declare the lens filter');
  const text = buildDatasetHandoff(def, { origin: ORIGIN });
  for (const lens of ['market', 'labor', 'geopolitics', 'regulatory', 'capability', 'society']) {
    assert.ok(text.includes(lens), `handoff missing lens value ${lens}`);
  }
});

check('a def with no filters declares no pushdowns', () => {
  const def = getDataset('argument-nodes');
  assert.ok(def && !def.filters, 'argument-nodes should declare no filters');
  const text = buildDatasetHandoff(def, { origin: ORIGIN });
  assert.ok(text.includes('none; every download here is a full-corpus pull'));
});

check('example requests use the requested origin and the dataset slug', () => {
  const def = getDataset('sources');
  const text = buildDatasetHandoff(def, { origin: ORIGIN });
  assert.ok(text.includes(`${ORIGIN}/api/datasets/sources?format=json`));
  assert.ok(text.includes(`${ORIGIN}/api/datasets/sources?schema=1`));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
