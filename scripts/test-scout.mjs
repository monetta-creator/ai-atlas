// Tests for Startup Scout's deterministic core: name-key dedupe normalization
// (must mirror the companies.name_key generated column), the discovery batch
// plan, stage/founded hint parsing, and query token resolution. READ-ONLY:
// never writes a row. Node type stripping loads the .ts modules directly.
// Run: node scripts/test-scout.mjs   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  companyNameKey, parseStageHint, parseFoundedHint, scoutPlan, scoutBatches,
  mergeDossier, eventExists, parseEventKindHint,
} from '../lib/scout/core.ts';

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

console.log('scout core:');

check('companyNameKey strips punctuation and case', () => {
  assert.equal(companyNameKey('Fin-Tech AI, Inc.'), 'fintechaiinc');
  assert.equal(companyNameKey('  Acme  Robotics  '), 'acmerobotics');
  assert.equal(companyNameKey('C3.ai'), 'c3ai');
  assert.equal(companyNameKey('!!!'), '');
});

check('parseStageHint maps free text onto company_stage_t', () => {
  assert.equal(parseStageHint('Seed'), 'seed');
  assert.equal(parseStageHint('pre-seed'), 'pre_seed');
  assert.equal(parseStageHint('Series A'), 'series_a');
  assert.equal(parseStageHint('series b extension'), 'series_b');
  assert.equal(parseStageHint('Series C'), 'later');
  assert.equal(parseStageHint('growth round'), 'later');
  assert.equal(parseStageHint('bootstrapped'), 'unknown');
  assert.equal(parseStageHint(''), 'unknown');
});

check('parseFoundedHint extracts a plausible year or null', () => {
  assert.equal(parseFoundedHint('2021'), 2021);
  assert.equal(parseFoundedHint('founded in 2019'), 2019);
  assert.equal(parseFoundedHint('1802'), null);
  assert.equal(parseFoundedHint('next year'), null);
  assert.equal(parseFoundedHint(''), null);
});

check('scoutPlan enumerates active verticals in <=2-query batches', () => {
  const plan = scoutPlan([
    { slug: 'a', active: true, search_queries: ['q1', 'q2', 'q3'] },
    { slug: 'b', active: false, search_queries: ['q1'] },
    { slug: 'c', active: true, search_queries: ['q1', 'q2'] },
    { slug: 'd', active: true, search_queries: [] },
  ]);
  assert.deepEqual(plan, [
    { vertical: 'a', batchIndex: 0 },
    { vertical: 'a', batchIndex: 1 },
    { vertical: 'c', batchIndex: 0 },
  ]);
});

check('scoutBatches slices into <=2-query invocations', () => {
  assert.deepEqual(scoutBatches(['a', 'b', 'c']), [['a', 'b'], ['c']]);
  assert.deepEqual(scoutBatches([]), []);
});

check('mergeDossier: latest non-empty summary wins, lists union with caps', () => {
  const t = '2026-08-15T12:00:00.000Z';
  const merged = mergeDossier(
    { summary: 'Old read.', products: ['Alpha', 'beta'], customers: [], enriched_at: 'x' },
    { summary: '', products: ['BETA', 'Gamma'], customers: ['Acme'], sources: ['https://a.com'], updated_by: 'intel' },
    t
  );
  assert.equal(merged.summary, 'Old read.');
  assert.deepEqual(merged.products, ['Alpha', 'beta', 'Gamma']);
  assert.deepEqual(merged.customers, ['Acme']);
  assert.deepEqual(merged.sources, ['https://a.com']);
  assert.equal(merged.updated_by, 'intel');
  assert.equal(merged.updated_at, t);
  const replaced = mergeDossier(merged, { summary: 'New read.', products: [], customers: [], sources: [], updated_by: 'document' }, t);
  assert.equal(replaced.summary, 'New read.');
  const many = Array.from({ length: 20 }, (_, i) => `p${i}`);
  assert.equal(mergeDossier(null, { summary: null, products: many, customers: [], sources: [], updated_by: 'homepage' }, t).products.length, 12);
});

check('eventExists: url match (trailing slash), normalized title, empty url', () => {
  const existing = [{ title: 'Series A announced!', url: 'https://x.com/a/' }, { title: 'Launch day', url: null }];
  assert.ok(eventExists(existing, { title: 'other', url: 'https://x.com/a' }));
  assert.ok(eventExists(existing, { title: 'series a ANNOUNCED', url: 'https://y.com/b' }));
  assert.ok(eventExists(existing, { title: 'LAUNCH-DAY', url: '' }));
  assert.ok(!eventExists(existing, { title: 'Series B closed', url: 'https://z.com/c' }));
});

check('parseEventKindHint degrades to news', () => {
  assert.equal(parseEventKindHint('Funding round'), 'funding');
  assert.equal(parseEventKindHint('product launch'), 'launch');
  assert.equal(parseEventKindHint('partnership milestone'), 'milestone');
  assert.equal(parseEventKindHint('press coverage'), 'news');
  assert.equal(parseEventKindHint(''), 'news');
});

// DB round-trip (read-only): the JS normalization must mirror the generated
// column, and the three seed verticals must exist.
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

const { rows: companies } = await client.query(`select name, name_key from companies limit 50`);
check(`companyNameKey mirrors the generated column (${companies.length} rows)`, () => {
  for (const r of companies) assert.equal(companyNameKey(r.name), r.name_key, `mismatch for "${r.name}"`);
});

const { rows: verticals } = await client.query(`select slug from scout_verticals order by slug`);
check('seed verticals present', () => {
  const slugs = verticals.map((r) => r.slug);
  for (const s of ['enterprise-workflows', 'fintech', 'process-automation']) {
    assert.ok(slugs.includes(s), `missing ${s}`);
  }
});

await client.end();

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
