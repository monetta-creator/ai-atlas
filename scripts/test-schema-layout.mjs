// Tests for the Schema map's pure layout machinery (lib/schema/layout.ts):
// grouping, access-tier coverage, dataset-table coverage, cluster-edge
// aggregation, deterministic layout, and a live guard against a new
// migration's table landing with no subsystem placement. Pure and DB-free.
// Run: node scripts/test-schema-layout.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUBSYSTEMS, ACCESS_TIER, DATASET_TABLES, GROUP_LABELS,
  groupTables, clusterEdges, layoutGroups,
} from '../lib/schema/layout.ts';
import { DATASETS } from '../lib/datasets/registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

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

console.log('lib/schema/layout:');

check('every fixture table (all of SUBSYSTEMS) groups without throwing', () => {
  const names = Object.keys(SUBSYSTEMS);
  const grouped = groupTables(names);
  const total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
  assert.equal(total, names.length);
});

check('groupTables throws on an ungrouped table', () => {
  assert.throws(() => groupTables(['definitely_not_a_real_table']), /No subsystem group/);
});

check('every SUBSYSTEMS group key has a label', () => {
  for (const group of Object.values(SUBSYSTEMS)) {
    assert.ok(GROUP_LABELS[group], `missing label for group "${group}"`);
  }
});

check('ACCESS_TIER covers every SUBSYSTEMS table', () => {
  const missing = Object.keys(SUBSYSTEMS).filter((t) => !ACCESS_TIER[t]);
  assert.deepEqual(missing, [], `tables with no ACCESS_TIER entry: ${missing.join(', ')}`);
});

check('every ACCESS_TIER entry has a tier and a non-empty reason', () => {
  for (const [table, info] of Object.entries(ACCESS_TIER)) {
    assert.ok(['public', 'key', 'admin'].includes(info.tier), `bad tier for ${table}`);
    assert.ok(info.reason && info.reason.length > 0, `empty reason for ${table}`);
  }
});

check('every DATASETS registry slug (except catalog) has a DATASET_TABLES entry', () => {
  const missing = DATASETS
    .map((d) => d.slug)
    .filter((slug) => slug !== 'catalog' && !(slug in DATASET_TABLES));
  assert.deepEqual(missing, [], `datasets missing from DATASET_TABLES: ${missing.join(', ')}`);
});

check('DATASET_TABLES has no slug outside the live registry', () => {
  const registrySlugs = new Set(DATASETS.map((d) => d.slug));
  const stale = Object.keys(DATASET_TABLES).filter((slug) => !registrySlugs.has(slug));
  assert.deepEqual(stale, [], `DATASET_TABLES has stale slugs: ${stale.join(', ')}`);
});

check('every table referenced by DATASET_TABLES exists in SUBSYSTEMS', () => {
  const bad = [];
  for (const [slug, tables] of Object.entries(DATASET_TABLES)) {
    for (const t of tables) {
      if (!SUBSYSTEMS[t]) bad.push(`${slug} -> ${t}`);
    }
  }
  assert.deepEqual(bad, [], `unplaced tables referenced by datasets: ${bad.join(', ')}`);
});

check('clusterEdges aggregates cross-group FKs and drops same-group self-edges', () => {
  const tables = [
    { name: 'signals', comment: null, rows: 10, lastAnalyzed: null, columns: [], fks: [
      { column: 'source_id', refTable: 'sources', refColumn: 'id' },
    ] },
    { name: 'evidence', comment: null, rows: 5, lastAnalyzed: null, columns: [], fks: [
      { column: 'signal_id', refTable: 'signals', refColumn: 'id' }, // same group (signals-pipeline -> signals-pipeline via signals? no, evidence is sources-evidence)
      { column: 'source_id', refTable: 'sources', refColumn: 'id' }, // sources-evidence -> sources-evidence, same group, dropped
    ] },
    { name: 'sources', comment: null, rows: 20, lastAnalyzed: null, columns: [], fks: [] },
  ];
  const edges = clusterEdges(tables);
  // signals (signals-pipeline) -> sources (sources-evidence): 1 (from signals.source_id)
  // evidence (sources-evidence) -> signals (signals-pipeline): 1 (from evidence.signal_id)
  // evidence -> sources: same group, dropped
  const key = (e) => [e.from, e.to].sort().join('|');
  const bySpread = new Map(edges.map((e) => [key(e), e.count]));
  assert.equal(bySpread.get(['signals-pipeline', 'sources-evidence'].sort().join('|')), 2);
  assert.ok(!edges.some((e) => e.from === e.to), 'no self-edges');
});

check('layoutGroups is deterministic (same input, same output)', () => {
  const tables = [
    { name: 'signals', comment: null, rows: 10, lastAnalyzed: null, columns: [], fks: [] },
    { name: 'claims', comment: null, rows: 30, lastAnalyzed: null, columns: [], fks: [] },
    { name: 'evidence', comment: null, rows: 5, lastAnalyzed: null, columns: [], fks: [] },
  ];
  const a = JSON.stringify(layoutGroups(tables));
  const b = JSON.stringify(layoutGroups(tables));
  assert.equal(a, b);
});

check('layoutGroups sorts tables within a group by row count descending', () => {
  const tables = [
    { name: 'claims', comment: null, rows: 5, lastAnalyzed: null, columns: [], fks: [] },
    { name: 'questions', comment: null, rows: 50, lastAnalyzed: null, columns: [], fks: [] },
    { name: 'stances', comment: null, rows: 20, lastAnalyzed: null, columns: [], fks: [] },
  ];
  const groups = layoutGroups(tables);
  const argMap = groups.find((g) => g.key === 'argument-map');
  assert.deepEqual(argMap.tables.map((t) => t.name), ['questions', 'stances', 'claims']);
});

check('layoutGroups omits empty groups (no table for that subsystem in the input)', () => {
  const tables = [{ name: 'claims', comment: null, rows: 1, lastAnalyzed: null, columns: [], fks: [] }];
  const groups = layoutGroups(tables);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'argument-map');
});

// Live guard: every `create table` in the migrations must be placed in
// SUBSYSTEMS, so a new migration that adds a table without updating the map
// fails this suite instead of silently rendering nowhere on the schema map.
check('every migration-created table has a SUBSYSTEMS placement', () => {
  const dir = path.join(repoRoot, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const found = new Set();
  const re = /create\s+table(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/gi;
  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    let m;
    while ((m = re.exec(sql))) found.add(m[1].toLowerCase());
  }
  found.delete('_migrations');
  const missing = [...found].filter((t) => !SUBSYSTEMS[t]);
  assert.deepEqual(missing, [], `migration-created tables missing from SUBSYSTEMS: ${missing.join(', ')}`);
});

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
