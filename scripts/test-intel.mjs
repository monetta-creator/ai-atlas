// Tests for the Intel Desk's deterministic core: the dimension taxonomy
// contract, fact-key normalization (must mirror the intel_facts.fact_key
// generated column), the search rotation ring, sweep-unit checkpointing,
// token resolution, and the 0043 schema's presence. READ-ONLY: never writes
// a row. Node type stripping loads the .ts modules directly.
// Run: node scripts/test-intel.mjs   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  INTEL_DIMENSIONS, INTEL_DIMENSION_CODES, dimensionDigest, intelFactKey,
  searchDueSlugs, resolveIntelTokens, bingNewsFeedUrl, unwrapNewsUrl, sweepUnit, nextUnsweptSlug,
} from '../lib/intel/core.ts';

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
async function checkAsync(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log('intel core:');

check('dimension codes are unique, kebab-safe, and digest-covered', () => {
  assert.equal(new Set(INTEL_DIMENSION_CODES).size, INTEL_DIMENSIONS.length);
  for (const code of INTEL_DIMENSION_CODES) assert.match(code, /^[a-z][a-z_]*$/);
  const digest = dimensionDigest();
  for (const code of INTEL_DIMENSION_CODES) assert.ok(digest.includes(`[${code}]`));
  assert.ok(!digest.includes('—'), 'digest carries an em dash');
});

check('intelFactKey mirrors the generated column (lower, strip, cap 120)', () => {
  assert.equal(intelFactKey('Launched a $1.2B fund!'), 'launcheda12bfund');
  assert.equal(intelFactKey('  Same   fact.  '), intelFactKey('same FACT'));
  assert.equal(intelFactKey('x'.repeat(300)).length, 120);
  assert.equal(intelFactKey('!!!'), '');
});

check('searchDueSlugs covers every company across a full ring cycle', () => {
  const slugs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const seen = new Set();
  const days = ['2026-08-31', '2026-09-01', '2026-09-02'];
  for (const day of days) {
    for (const s of searchDueSlugs(slugs, day, 3)) {
      assert.ok(!seen.has(`${day}:${s}`));
      seen.add(s);
    }
  }
  assert.equal(seen.size, slugs.length, 'every company searched within one cadence cycle');
  // Deterministic: the same day always yields the same subset.
  assert.deepEqual(searchDueSlugs(slugs, '2026-09-01', 3), searchDueSlugs(slugs, '2026-09-01', 3));
  // cadence 1 = everyone, every day.
  assert.deepEqual(searchDueSlugs(slugs, '2026-09-01', 1), slugs);
});

check('sweepUnit / nextUnsweptSlug checkpoint per leg independently', () => {
  assert.equal(sweepUnit('feeds'), 'feeds');
  assert.equal(sweepUnit('search', 'acme'), 'search:acme');
  const slugs = ['a', 'b', 'c'];
  assert.equal(nextUnsweptSlug(slugs, 'search', []), 'a');
  assert.equal(nextUnsweptSlug(slugs, 'search', ['search:a', 'filings:b']), 'b');
  assert.equal(nextUnsweptSlug(slugs, 'filings', ['search:a', 'search:b', 'search:c']), 'a');
  assert.equal(nextUnsweptSlug(slugs, 'search', ['search:a', 'search:b', 'search:c']), null);
});

check('resolveIntelTokens resolves {month}/{year} from the run day', () => {
  assert.equal(resolveIntelTokens('"Acme" news {month} {year}', '2026-08-31'), '"Acme" news August 2026');
  assert.equal(resolveIntelTokens('no tokens', '2026-01-05'), 'no tokens');
});

check('bingNewsFeedUrl quotes the exact phrase', () => {
  const url = bingNewsFeedUrl('Example Bancorp');
  assert.ok(url.startsWith('https://www.bing.com/news/search?q=%22Example%20Bancorp%22'));
});

check('unwrapNewsUrl extracts the publisher URL from Bing apiclick links', () => {
  const wrapped = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=x&url=https%3a%2f%2fwww.npr.org%2f2026%2fstory&c=1&mkt=en-us';
  assert.equal(unwrapNewsUrl(wrapped), 'https://www.npr.org/2026/story');
  assert.equal(unwrapNewsUrl('https://example.com/a'), 'https://example.com/a');
});

// ---- DB sanity: the 0043 schema is present with its invariants.
const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: process.env.SUPABASE_DB_PORT,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log('intel schema:');

await checkAsync('0043 tables exist', async () => {
  const { rows } = await client.query(
    `select table_name from information_schema.tables
      where table_name in ('intel_companies','intel_runs','intel_items','intel_facts','intel_metrics','intel_prefs')`
  );
  assert.equal(rows.length, 6, `expected 6 intel tables, found ${rows.length}`);
});

await checkAsync('fact_key generated column matches intelFactKey', async () => {
  const { rows } = await client.query(
    `select fact, fact_key from intel_facts limit 25`
  );
  for (const r of rows) assert.equal(r.fact_key, intelFactKey(r.fact));
});

await checkAsync('no duplicate (run_id, normalized_url) items', async () => {
  const { rows } = await client.query(
    `select run_id, normalized_url, count(*) from intel_items
      group by 1, 2 having count(*) > 1 limit 5`
  );
  assert.equal(rows.length, 0);
});

await checkAsync('intel_prefs singleton exists', async () => {
  const { rows } = await client.query(`select id, enabled from intel_prefs`);
  assert.equal(rows.length, 1);
});

await client.end();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
