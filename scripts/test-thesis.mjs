// Phase-1 test for the thesis-report deterministic core (lib/thesis/pack-core.ts).
// READ-ONLY: it never writes a row, so there is nothing to roll back.
//
// Runs the exact production SQL by injecting a pg client into buildThesisPackCore
// (Node's native type stripping loads the .ts module directly; pack-core keeps
// type-only imports for exactly this reason). Asserts:
//   1. determinism  — two builds of the same thesis are deep-equal (generated_at aside)
//   2. guest-safety — no personal-layer key ever appears in the serialized pack
//   3. direction integrity — touch-direction counts match an independent SQL recount
//   4. internal consistency — tags sequential, stat groups sum to matched, hrefs well-formed
//   5. delta arithmetic — computeDelta against synthetic previous runs
//   6. pure helpers — stanceOf / quarterBuckets edge cases
//
// Run: node scripts/test-thesis.mjs   (loads .env.local; uses DATABASE_URL, else SUPABASE_DB_*)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  buildThesisPackCore, computeDelta, stanceOf, quarterBuckets,
} from '../lib/thesis/pack-core.ts';

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
// Serialize queries: pack-core issues Promise.all batches, which a bare pg.Client
// (unlike the app's pool) cannot run concurrently.
let queue = Promise.resolve();
const q = (sql, params) => {
  const run = queue.then(() => client.query(sql, params).then((r) => r.rows));
  queue = run.catch(() => {});
  return run;
};

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

// ---- 6) pure helpers first (no DB) -----------------------------------------
check('stanceOf: empty -> untyped', () => assert.equal(stanceOf({}), 'untyped'));
check('stanceOf: supports+contradicts -> mixed', () =>
  assert.equal(stanceOf({ a: 'supports', b: 'contradicts' }), 'mixed'));
check('stanceOf: neutral only -> neutral', () => assert.equal(stanceOf({ a: 'neutral' }), 'neutral'));
check('quarterBuckets: zero-fills the span', () =>
  assert.deepEqual(quarterBuckets(['2025-01-15', '2025-07-01']), [
    { bucket: '2025 Q1', n: 1 },
    { bucket: '2025 Q2', n: 0 },
    { bucket: '2025 Q3', n: 1 },
  ]));
check('quarterBuckets: empty in, empty out', () => assert.deepEqual(quarterBuckets([null]), []));

// ---- pick real mapped codes deterministically --------------------------------
const topCodes = (
  await q(
    `select code from (
       select unnest(claim_touches) as code from signals where is_published = true
     ) t group by code order by count(*) desc, code limit 2`
  )
).map((r) => r.code);
console.log(`\nTop touched codes: ${topCodes.join(', ')}`);

const THESIS = {
  id: '00000000-0000-0000-0000-000000000000',
  statement: 'AI is reducing entry-level knowledge work hiring and reshaping white collar employment',
  claim_codes: topCodes,
};

const stripStamp = (pack) => {
  const clone = JSON.parse(JSON.stringify(pack));
  delete clone.generated_at;
  return clone;
};

// ---- 1) determinism ----------------------------------------------------------
const packA = await buildThesisPackCore(q, THESIS, null);
const packB = await buildThesisPackCore(q, THESIS, null);
check('determinism: two builds are deep-equal (generated_at aside)', () =>
  assert.deepEqual(stripStamp(packA), stripStamp(packB)));
console.log(
  `  pack: ${packA.stats.matched}/${packA.stats.scanned} matched · ` +
  `stances ${JSON.stringify(packA.stats.stances)} · ${packA.evidence.length} excerpts`
);

// ---- 2) guest-safety ---------------------------------------------------------
check('guest-safety: no personal-layer keys in the serialized pack', () => {
  const s = JSON.stringify(packA);
  const forbidden = /"(confidence|confidence_label|reliability_prior|note|rationale|rationales|touch_details|domain_note)":/;
  const m = s.match(forbidden);
  assert.equal(m, null, m ? `found forbidden key ${m[1]}` : undefined);
});

// ---- 3) direction integrity (independent SQL recount) ------------------------
const recount = await q(
  `select e.direction::text as direction, count(*)::int as n
     from evidence e
     join signals s on s.id = e.signal_id and s.is_published = true
     left join claims c on e.target_type = 'claim' and c.id = e.target_id and c.is_frame = false
     left join bridge_claims b on e.target_type = 'bridge_claim' and b.id = e.target_id
    where coalesce(c.code, b.code) = any($1::text[])
    group by 1`,
  [topCodes]
);
const sqlDirections = { supports: 0, contradicts: 0, neutral: 0 };
for (const r of recount) sqlDirections[r.direction] = r.n;
check('direction integrity: pack touchDirections match SQL recount', () =>
  assert.deepEqual(packA.stats.touchDirections, sqlDirections));

// ---- 4) internal consistency -------------------------------------------------
check('tags are sequential S1..Sn', () =>
  packA.signals.forEach((s, i) => assert.equal(s.tag, `S${i + 1}`)));
check('matched equals signals.length', () =>
  assert.equal(packA.stats.matched, packA.signals.length));
check('stance counts sum to matched', () =>
  assert.equal(Object.values(packA.stats.stances).reduce((a, b) => a + b, 0), packA.stats.matched));
check('significance counts sum to matched', () =>
  assert.equal(Object.values(packA.stats.significance).reduce((a, b) => a + b, 0), packA.stats.matched));
check('byMatch groups sum to matched', () => {
  const { claim, text, both } = packA.stats.byMatch;
  assert.equal(claim + text + both, packA.stats.matched);
});
check('every mapped claim resolved with a well-formed href', () => {
  assert.equal(packA.claims.length, topCodes.length);
  for (const c of packA.claims) assert.match(c.href, /^\/(claim|bridge)\//);
});
check('every evidence signal_tag resolves to a pack signal', () => {
  const tags = new Set(packA.signals.map((s) => s.tag));
  for (const e of packA.evidence) if (e.signal_tag) assert.ok(tags.has(e.signal_tag));
});
check('delta is null without a previous run', () => assert.equal(packA.delta, null));

// ---- 5) delta arithmetic -----------------------------------------------------
if (packA.signals.length >= 2) {
  const prev = {
    id: '11111111-1111-1111-1111-111111111111',
    generated_at: '2026-01-01T00:00:00.000Z',
    signal_ids: [packA.signals[0].id],
  };
  const d = computeDelta(packA.signals, prev);
  check('delta: new tags exclude the previously seen signal', () =>
    assert.deepEqual(d.new_signal_tags, packA.signals.slice(1).map((s) => s.tag)));
  check('delta: nothing removed when prev is a subset', () => assert.equal(d.removed_count, 0));
  const gone = { ...prev, signal_ids: ['22222222-2222-2222-2222-222222222222'] };
  check('delta: a vanished previous signal counts as removed', () =>
    assert.equal(computeDelta(packA.signals, gone).removed_count, 1));
  check('delta: new stances sum to new tag count', () => {
    const sum = Object.values(d.new_stances).reduce((a, b) => a + b, 0);
    assert.equal(sum, d.new_signal_tags.length);
  });
} else {
  console.log('  (skipped delta arithmetic: fewer than 2 matched signals)');
}

// ---- unmapped thesis ---------------------------------------------------------
const unmapped = await buildThesisPackCore(q, {
  id: '00000000-0000-0000-0000-000000000000',
  statement: 'zzqx quixotic zorbfleet nonexistent',
  claim_codes: [],
});
check('unmapped thesis: consistent and honest about the missing mapping', () => {
  assert.equal(unmapped.stats.matched, unmapped.signals.length);
  assert.equal(unmapped.claims.length, 0);
  assert.ok(unmapped.stats.corpusNote.includes('not yet mapped'));
  for (const s of unmapped.signals) assert.equal(s.stance, 'untyped');
});

await client.end();
if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nAll thesis-core checks passed.');
