// Tests for Discovery Pipeline 2.0's deterministic parts: query rotation,
// the daily discovery plan, and the model-registry/rate-card drift guard.
// READ-ONLY: never writes a row. Node type stripping loads the .ts modules.
// Run: node scripts/test-pipeline2.mjs   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import { rotatedQueries, DEFAULT_UTILITY_MODEL } from '../lib/pipeline/config.ts';
import { SCAN_ENRICH_MODELS, isScanEnrichModel } from '../lib/scan/models.ts';
import { looksLikeBotWall } from '../lib/pipeline/botwall.ts';

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

console.log('pipeline 2.0:');

check('rotatedQueries: deterministic, sized, wrapping', () => {
  const qs = ['a', 'b', 'c', 'd', 'e'];
  const day1 = rotatedQueries(qs, '2026-08-31');
  assert.equal(day1.length, 2);
  assert.deepEqual(day1, rotatedQueries(qs, '2026-08-31'));
  // consecutive days advance the window
  const day2 = rotatedQueries(qs, '2026-09-01');
  assert.notDeepEqual(day1, day2);
  // short lists pass through whole
  assert.deepEqual(rotatedQueries(['x', 'y'], '2026-08-31'), ['x', 'y']);
  assert.deepEqual(rotatedQueries(['x'], '2026-08-31', 1), ['x']);
});

check('rotatedQueries: every query is reached across consecutive days', () => {
  const qs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const day = new Date(Date.parse('2026-08-31T00:00:00Z') + i * 86_400_000)
      .toISOString().slice(0, 10);
    for (const q of rotatedQueries(qs, day)) seen.add(q);
  }
  assert.equal(seen.size, qs.length, `only reached ${[...seen].join(',')}`);
});

check('utility model default is a registry model', () => {
  assert.ok(isScanEnrichModel(DEFAULT_UTILITY_MODEL));
  assert.ok(!SCAN_ENRICH_MODELS.find((m) => m.id === DEFAULT_UTILITY_MODEL)?.anthropic);
});

check('looksLikeBotWall: flags a short Cloudflare verification stub', () => {
  const stub =
    'Verifying you are human. This may take a few seconds. ' +
    'ai-atlas.example needs to review the security of your connection before proceeding. ' +
    'Please enable JavaScript and cookies to continue. Cloudflare Ray ID: 8f2a9c1d4e2b0f11. ' +
    'Performance & security by Cloudflare.';
  assert.equal(stub.length < 1200, true, `fixture is ${stub.length} chars, expected < 1200`);
  assert.equal(looksLikeBotWall(stub), true);
});

check('looksLikeBotWall: does not flag a legitimate news paragraph', () => {
  const article =
    'Regulators in three countries opened a joint review of the merger on Tuesday, ' +
    'citing concerns over data portability and market concentration in cloud services. ' +
    'The companies said they would cooperate fully with the inquiry and expected the ' +
    'process to conclude within six months. Analysts said the review was unlikely to ' +
    'block the deal outright but could force divestitures in overlapping product lines. ' +
    'Shares in both companies were little changed in after-hours trading following the news.';
  assert.equal(looksLikeBotWall(article), false);
});

check('looksLikeBotWall: length gate spares a long article that mentions Cloudflare', () => {
  const paragraph =
    'A widespread Cloudflare outage disrupted access to thousands of websites on Tuesday, ' +
    'the company said, after a configuration change in its network triggered cascading ' +
    'failures across its edge points of presence. Engineers rolled back the change within ' +
    'the hour and said full service was restored by early afternoon. ';
  const article = paragraph.repeat(Math.ceil(5000 / paragraph.length)).slice(0, 5000);
  assert.equal(article.length, 5000);
  assert.equal(looksLikeBotWall(article), false);
});

// DB sanity (read-only): 0042 applied, and every OpenRouter registry model
// (the analysis A/B pool) has a rate card so pipeline_analysis costs are real.
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

const { rows: cols } = await client.query(
  `select column_name from information_schema.columns
    where (table_name = 'pipeline_runs' and column_name in ('discovered_units', 'lease_until'))
       or (table_name = 'signals' and column_name = 'drafted_by')
       or (table_name = 'pipeline_prefs' and column_name = 'analysis_models')`
);
check('0042 columns present', () => {
  assert.equal(cols.length, 4, cols.map((c) => c.column_name).join(','));
});

const orIds = SCAN_ENRICH_MODELS.filter((m) => !m.anthropic).map((m) => m.id);
const { rows: carded } = await client.query(
  `select distinct model from ai_rate_cards where model = any($1::text[])`,
  [orIds]
);
check('every OpenRouter registry model has a rate card', () => {
  const have = new Set(carded.map((r) => r.model));
  for (const id of orIds) assert.ok(have.has(id), `no rate card for ${id}`);
});

await client.end();

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
