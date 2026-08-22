import { makeClient } from './db.mjs';

// Sanity-check a migrated + seeded database: table presence, seed shape, and
// the invariants the app relies on. Read-only.

const client = makeClient();
let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

async function main() {
  await client.connect();

  const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

  // Tables exist
  for (const t of ['hypotheses', 'evidence', 'signals', 'sources', 'rationales', 'snapshots', 'pipeline_runs', 'signal_candidates']) {
    const r = await one(`select to_regclass($1) as reg`, [`public.${t}`]);
    check(`table ${t} exists`, !!r.reg);
  }

  // Seed shape
  const h = await one(`select count(*)::int as n from hypotheses`);
  check('hypotheses seeded', h.n >= 3, `${h.n} rows`);

  const label = await one(`select conviction, conviction_label from hypotheses where code = 'H1'`);
  check('H1 conviction neutral 0.50 -> "contested"', Number(label?.conviction) === 0.5 && label?.conviction_label === 'contested');

  const sig = await one(`select count(*)::int as n from signals where is_published`);
  check('a published signal exists', sig.n >= 1);

  const ev = await one(
    `select count(*)::int as n from evidence e join hypotheses hy on hy.id = e.hypothesis_id where hy.code = 'H1'`
  );
  check('published signal materialized evidence on H1', ev.n >= 1);

  // Invariants
  const orphan = await one(
    `select count(*)::int as n from evidence where source_id is null and signal_id is null`
  );
  check('evidence always carries provenance', orphan.n === 0);

  const fts = await one(
    `select count(*)::int as n from hypotheses where search_tsv @@ plainto_tsquery('english', 'consolidates')`
  );
  check('hypotheses FTS matches seeded text', fts.n >= 1);

  const rate = await one(`select count(*)::int as n from ai_rate_cards`);
  check('rate cards seeded', rate.n >= 2);

  await client.end();
  if (failures) {
    console.error(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('\nverify: all checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
