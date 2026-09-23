// Tests for the AI Tooling Monitor's four datasets and their importer handoff
// doc (lib/datasets/registry.ts tooling-*, lib/tooling/handoff.ts
// buildToolingHandoff). Mirrors scripts/test-intel-datasets.mjs's
// registry/schema checks, plus a light DB-backed guest-safety recount (the
// tooling monitor's tables can be empty at this point in the build; every
// check below is written to pass on zero rows).
// Run: node scripts/test-tooling-datasets.mjs   (loads .env.local; DATABASE_URL, else SUPABASE_DB_*)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import { getDataset } from '../lib/datasets/registry.ts';
import { buildRowJsonSchema } from '../lib/datasets/handoff-shared.ts';
import { buildToolingHandoff } from '../lib/tooling/handoff.ts';

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

console.log('tooling datasets:');

const productsDef = getDataset('tooling-products');
const eventsDef = getDataset('tooling-events');
const featuresDef = getDataset('tooling-features');
const catalogDef = getDataset('tooling-catalog');
const TOOLING_DEFS = [productsDef, eventsDef, featuresDef, catalogDef];

check('registry: all four tooling-* defs are present', () => {
  for (const d of TOOLING_DEFS) assert.ok(d, 'a tooling-* def is missing from the registry');
});

// ---- (a) every column of all four tooling defs has real FIELD_FACTS -------

check('buildRowJsonSchema covers every column of every tooling def with real facts', () => {
  for (const d of TOOLING_DEFS) {
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

// ---- (b) buildToolingHandoff covers every column, schemas parse, no em dash

check('buildToolingHandoff embeds every column key of every def and parseable JSON Schemas', () => {
  const text = buildToolingHandoff({
    defs: TOOLING_DEFS,
    categories: [
      { slug: 'coding-assistants', name: 'Coding assistants', description: null, search_queries: [], pull_queries: [], hn_query: null, github_query: null, active: true, sort_order: 10, created_at: '2026-01-01', updated_at: '2026-01-01' },
      { slug: 'agent-platforms', name: 'Agent platforms', description: null, search_queries: [], pull_queries: [], hn_query: null, github_query: null, active: true, sort_order: 20, created_at: '2026-01-01', updated_at: '2026-01-01' },
    ],
    crons: [{ path: '/api/cron/tooling', schedule: '0 7 * * 1' }],
    host: 'https://example.test',
    generatedOn: '2026-09-17',
  });

  for (const d of TOOLING_DEFS) {
    for (const c of d.columns) {
      assert.ok(text.includes(`| ${c.key} |`), `handoff missing ${d.slug}.${c.key}`);
    }
  }

  const fenced = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(fenced.length, TOOLING_DEFS.length, `expected ${TOOLING_DEFS.length} fenced JSON Schema blocks, found ${fenced.length}`);
  const titles = fenced.map((block) => JSON.parse(block).properties.rows.items.title).sort();
  assert.deepEqual(titles, TOOLING_DEFS.map((d) => `${d.slug} row`).sort());

  assert.ok(text.includes('07:00 UTC Mondays'), 'handoff should render the weekly cron label');
  assert.ok(!text.includes('—'), 'handoff contains an em dash');
});

// ---- (c) gating: products is keyGated + heavy; catalog is the public slice

check('tooling-products is keyGated and heavy', () => {
  assert.equal(productsDef.keyGated, true, 'tooling-products.keyGated');
  assert.equal(productsDef.heavy, true, 'tooling-products.heavy');
});
check('tooling-events and tooling-features are keyGated', () => {
  assert.equal(eventsDef.keyGated, true, 'tooling-events.keyGated');
  assert.equal(featuresDef.keyGated, true, 'tooling-features.keyGated');
});
check('tooling-catalog is NOT keyGated: the one public tooling slice', () => {
  assert.ok(!catalogDef.keyGated, 'tooling-catalog should not require the portal key');
});
check('every tooling-* dataset carries category tooling', () => {
  for (const d of TOOLING_DEFS) assert.equal(d.category, 'tooling', d.slug);
});

// ---- (d) house style: no em dash in any tooling registry string ------------

check('registry: no em dash in any tooling dataset string', () => {
  for (const d of TOOLING_DEFS) {
    for (const s of [d.title, d.description, d.methodology]) {
      assert.ok(!s.includes('—'), `${d.slug}: ${s.slice(0, 60)}`);
    }
    for (const c of d.columns) {
      assert.ok(!c.label.includes('—') && !c.def.includes('—'), `${d.slug}.${c.key}`);
    }
  }
});

// ---- (e) tooling-catalog carries no admin/internal-shaped key --------------
// The public slice must never gain a curation/provenance/status column by
// accident; every name below is admin- or portal-only elsewhere in the
// tooling monitor (agent scores, dossier, deep dive, funnel status, review
// state, raw fetch text, the pin flag, discovery origin/found_url).

check('tooling-catalog: no column key matches the admin/internal ban', () => {
  const banned = /^agent_|^dossier|^deep_dive|^status$|^pinned$|^origin$|^found_url$|^review_|^raw_content$/;
  for (const c of catalogDef.columns) {
    assert.ok(!banned.test(c.key), `tooling-catalog carries banned key '${c.key}'`);
  }
});

// A mock Q that never touches a DB and returns no rows, so determinism can
// be checked (and the "empty tables" contract exercised) without a live one.
const mockQ = async () => [];

console.log('\nDeterminism (mock, zero rows):');
for (const d of TOOLING_DEFS) {
  const rows1 = await d.build(mockQ);
  const rows2 = await d.build(mockQ);
  check(`${d.slug}: determinism (mock query, ${rows1.length} rows)`, () => assert.deepEqual(rows1, rows2));
}

// ---- DB-backed checks (read-only) ------------------------------------------
// Skippable when no DB env is configured (registry-only environments); every
// assertion below is written to hold trivially on zero rows, so this section
// never fails on a fresh, unseeded tooling schema.
const hasDbEnv = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_HOST);
if (!hasDbEnv) {
  console.log('\n(no DATABASE_URL/SUPABASE_DB_HOST; skipping DB-backed checks)');
} else {
  const client = process.env.DATABASE_URL
    ? new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    : new pg.Client({
        host: process.env.SUPABASE_DB_HOST,
        port: Number(process.env.SUPABASE_DB_PORT),
        user: process.env.SUPABASE_DB_USER,
        password: process.env.SUPABASE_DB_PASSWORD,
        database: process.env.SUPABASE_DB_NAME,
        ssl: { rejectUnauthorized: false },
      });
  await client.connect();
  // Serialize queries: builders issue Promise.all batches (none of these
  // four do today, but the guard costs nothing and matches
  // scripts/test-datasets.mjs), which a bare pg.Client cannot run concurrently.
  let queue = Promise.resolve();
  const q = (sql, params) => {
    const run = queue.then(() => client.query(sql, params).then((r) => r.rows));
    queue = run.catch(() => {});
    return run;
  };

  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('tooling_categories', 'tooling_products', 'tooling_events', 'tooling_runs', 'tooling_prefs')`
  );
  check('0054 tables present', () => assert.equal(tables.length, 5, `found ${tables.length}/5`));

  console.log('\nLive build, determinism:');
  const built = {};
  for (const d of TOOLING_DEFS) {
    const rows1 = await d.build(q);
    const rows2 = await d.build(q);
    built[d.slug] = rows1;
    check(`${d.slug}: determinism (${rows1.length} rows)`, () => assert.deepEqual(rows1, rows2));
  }

  {
    const ids = [...new Set(built['tooling-catalog'].map((r) => r.id).filter(Boolean))];
    const bad = ids.length
      ? Number((await q(
          `select count(*)::int as n from tooling_products where id = any($1::uuid[]) and status <> 'cataloged'`,
          [ids]
        ))[0].n)
      : 0;
    check(`tooling-catalog: every id resolves to status = cataloged in the DB (${ids.length} distinct)`, () =>
      assert.equal(bad, 0, `${bad} non-cataloged row(s) leaked into tooling-catalog`));
  }

  check('tooling-events: no row carries a note key', () => {
    for (const r of built['tooling-events']) {
      assert.ok(!('note' in r), 'tooling-events row unexpectedly carries note');
    }
  });

  check('tooling-features: every row status is cataloged or parked', () => {
    const allowed = new Set(['cataloged', 'parked']);
    for (const r of built['tooling-features']) assert.ok(allowed.has(r.status), String(r.status));
  });

  check('tooling-products: every row status is not dismissed', () => {
    for (const r of built['tooling-products']) assert.notEqual(r.status, 'dismissed');
  });

  await client.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
