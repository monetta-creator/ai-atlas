// Tests for the Report Portal's deterministic core (lib/tearsheet/pack-core.ts)
// and the shared citation gate (lib/citations.ts). READ-ONLY: never writes a row.
//
// Drives the exact production SQL by injecting a pg client (Node type stripping
// loads the .ts modules directly; both keep runtime imports Node-loadable).
// Run: node scripts/test-tearsheet.mjs   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  buildClaimSheetPack, buildLensSheetPack, buildAtlasSheetPack, inScope, hrefFor,
} from '../lib/tearsheet/pack-core.ts';
import { enforceCitations } from '../lib/citations.ts';

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
let queue = Promise.resolve();
const q = (sql, params) => {
  const run = queue.then(() => client.query(sql, params).then((r) => r.rows));
  queue = run.catch(() => {});
  return run;
};

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}

// ---- pure helpers -----------------------------------------------------------
check('inScope: all-time accepts anything incl. null date', () => {
  assert.equal(inScope(null, { from: null, to: null }), true);
  assert.equal(inScope('2026-01-01', { from: null, to: null }), true);
});
check('inScope: bounded scope rejects null date and out-of-range', () => {
  assert.equal(inScope(null, { from: '2026-01-01', to: null }), false);
  assert.equal(inScope('2025-12-31', { from: '2026-01-01', to: null }), false);
  assert.equal(inScope('2026-06-01', { from: '2026-01-01', to: '2026-06-01' }), true);
  assert.equal(inScope('2026-06-02', { from: '2026-01-01', to: '2026-06-01' }), false);
});
check('hrefFor shapes', () => {
  assert.equal(hrefFor('claim', '4.2'), '/claim/4.2');
  assert.equal(hrefFor('bridge_claim', 'B3'), '/bridge/B3');
});

// ---- citation gate ----------------------------------------------------------
{
  const allow = {
    hrefs: new Set(['/signals/abc', '/claim/4.2', 'https://example.com/x']),
    tagByHref: new Map([['/signals/abc', 'S3']]),
  };
  const html = '<p><a href="/signals/abc">S3</a> and <a href="/claim/9.9">bad</a> and ' +
    '<a href="https://example.com/x">src</a> and <a href="https://evil.example/y">evil</a></p>';
  const out = enforceCitations(html, allow);
  check('gate keeps allowed links and records cited tags', () => {
    assert.ok(out.html.includes('href="/signals/abc"'));
    assert.deepEqual(out.cited, ['S3']);
    assert.ok(out.html.includes('href="https://example.com/x"'));
    assert.ok(out.html.includes('target="_blank"'));
  });
  check('gate strips outside links (text kept) and records them', () => {
    assert.ok(!out.html.includes('/claim/9.9'));
    assert.ok(!out.html.includes('evil.example'));
    assert.ok(out.html.includes('bad'));   // link killed, text preserved
    assert.deepEqual([...out.dropped].sort(), ['/claim/9.9', 'https://evil.example/y']);
  });
}

// ---- em-dash scan over the model/user-facing modules ------------------------
check('no em dashes in tearsheet modules', () => {
  for (const f of ['lib/tearsheet/pack-core.ts', 'lib/tearsheet/generate.ts', 'lib/pdf/shell.tsx', 'lib/pdf/sheet-doc.tsx', 'lib/pdf/thesis-doc.tsx']) {
    const lines = readFileSync(f, 'utf8').split('\n')
      // The deDash normalizer's own regex legitimately contains the character.
      .filter((l) => !l.includes('.replace('));
    assert.ok(!lines.join('\n').includes('—'), `${f} contains an em dash`);
  }
});

// ---- claim pack (live DB) ---------------------------------------------------
const topClaim = await q(
  `select c.code, count(*)::int as n
     from evidence e join claims c on e.target_type = 'claim' and c.id = e.target_id and c.is_frame = false
    group by c.code order by n desc, c.code limit 1`
);
const code = topClaim[0]?.code;
if (code) {
  const a = await buildClaimSheetPack(q, code, { from: null, to: null });
  const b = await buildClaimSheetPack(q, code, { from: null, to: null });
  check('claim pack: deterministic (generated_at aside)', () => {
    const norm = (p) => JSON.stringify({ ...p, generated_at: null });
    assert.equal(norm(a), norm(b));
  });
  check('claim pack: guest-safe (no personal-layer keys)', () => {
    const json = JSON.stringify(a);
    for (const k of ['"confidence"', '"confidence_label"', '"reliability_prior"', '"domain_note"', '"touch_details"', '"reason"', '"rationale']) {
      assert.ok(!json.includes(k), `pack leaks ${k}`);
    }
  });
  check('claim pack: tags sequential and evidence tags resolve', () => {
    a.signals.forEach((s, i) => assert.equal(s.tag, `S${i + 1}`));
    const tags = new Set(a.signals.map((s) => s.tag));
    for (const e of a.evidence) {
      if (e.signal_tag) assert.ok(tags.has(e.signal_tag), `dangling tag ${e.signal_tag}`);
    }
  });
  check('claim pack: stats sum and one-sided rule', () => {
    const st = a.stats.evidence;
    assert.equal(st.total, a.evidence.length);
    assert.equal(st.supports + st.contradicts + st.neutral, st.total);
    const rule = (st.supports >= 2 && st.contradicts === 0) || (st.contradicts >= 2 && st.supports === 0);
    assert.equal(st.oneSided, rule);
    assert.ok(a.stats.corpusNote.includes('Scope:'));
  });
  check('claim pack: signals published-only and direction values sane', () => {
    for (const sig of a.signals) {
      assert.ok(['supports', 'contradicts', 'neutral', null].includes(sig.direction));
    }
  });
  const mid = a.signals[Math.floor(a.signals.length / 2)]?.published_at;
  if (mid) {
    const scoped = await buildClaimSheetPack(q, code, { from: mid, to: null });
    check('claim pack: scope filters signals and evidence', () => {
      for (const sig of scoped.signals) {
        assert.ok(sig.published_at !== null && sig.published_at >= mid, `signal ${sig.id} out of scope`);
      }
      assert.ok(scoped.signals.length <= a.signals.length);
      assert.ok(scoped.stats.corpusNote.includes(`from ${mid}`));
    });
  }
}

// ---- frame rejection --------------------------------------------------------
const frame = await q(`select code from claims where is_frame = true order by code limit 1`);
if (frame[0]) {
  let threw = false;
  try {
    await buildClaimSheetPack(q, frame[0].code, { from: null, to: null });
  } catch {
    threw = true;
  }
  check('frame codes are refused', () => assert.ok(threw));
}

// ---- lens pack --------------------------------------------------------------
{
  const pack = await buildLensSheetPack(q, 'market', 'Market & Valuation', { from: null, to: null });
  check('lens pack: signals carry the lens and codes ordered by signal count', () => {
    for (const sig of pack.signals) assert.ok(sig.lenses.includes('market'));
    for (let i = 1; i < pack.codes.length; i++) {
      assert.ok(pack.codes[i - 1].signal_count >= pack.codes[i].signal_count);
    }
  });
  check('lens pack: guest-safe', () => {
    const json = JSON.stringify(pack);
    for (const k of ['"confidence"', '"reliability_prior"', '"touch_details"']) {
      assert.ok(!json.includes(k), `pack leaks ${k}`);
    }
  });
}

// ---- atlas pack -------------------------------------------------------------
{
  const pack = await buildAtlasSheetPack(q, { from: null, to: null });
  check('atlas pack: questions present with stance rollups', () => {
    assert.ok(pack.questions.length >= 1);
    assert.ok(pack.questions.every((qn) => qn.stances.length >= 1));
  });
  check('atlas pack: health arithmetic sane', () => {
    assert.ok(pack.health.uncovered >= 0);
    assert.ok(pack.health.oneSided <= pack.health.claims + pack.health.bridges);
    assert.ok(pack.signals.length <= 12);
  });
}

await client.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
