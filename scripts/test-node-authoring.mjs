import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

// Rollback-only smoke test for the node-authoring write surface (migration 0021 +
// createClaimWithEdges / createBridgeWithEdges). Mirrors the exact SQL the mutations
// run — claim + edges, bridge + feeder edges, the frame CHECK constraints, and the
// argument_gap_scan singleton — inside a transaction it ROLLS BACK. Your real data
// is never touched. Run with: node scripts/test-node-authoring.mjs

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

let ok = true;
const check = (label, pass, extra = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!pass) ok = false;
};

await c.connect();
await c.query('begin');
try {
  // anchors: an existing stance, an existing non-frame claim, an existing bridge
  const stance = (await c.query(`select id, code from stances order by sort_order limit 1`)).rows[0];
  const feedClaim = (await c.query(`select id, code from claims where is_frame = false order by code limit 1`)).rows[0];
  const someBridge = (await c.query(`select id, code from bridge_claims order by code limit 1`)).rows[0];
  check('found a stance / claim / bridge to wire to', !!(stance && feedClaim && someBridge));

  // 1) create a claim (NEUTRAL 0.50, non-frame) — mirrors createClaimWithEdges
  const claim = (await c.query(
    `insert into claims (code, statement, test, domain, domain_note, resolvability, confidence, is_frame, reflexive)
     values ($1,$2,$3,$4,$5,$6,$7,false,false) returning id, code, confidence_label`,
    ['ZZ.1', 'TEST claim: authoring smoke test', 'TEST: would be falsified if X', 'capability', null, 'slow', 0.5]
  )).rows[0];
  check('claim inserted at NEUTRAL 0.50', claim.confidence_label === 'contested', `label=${claim.confidence_label}`);

  // claim -> stance edge + claim -> bridge edge (resolved by code, on-conflict no-op)
  await c.query(
    `insert into edges (from_type, from_id, to_type, to_id, relation)
     values ('claim',$1,'stance',$2,'supports'),('claim',$1,'bridge_claim',$3,'depends_on')
     on conflict (from_type, from_id, to_type, to_id, relation) do nothing`,
    [claim.id, stance.id, someBridge.id]
  );
  const claimEdges = (await c.query(
    `select to_type, relation from edges where from_type='claim' and from_id=$1 order by to_type`,
    [claim.id]
  )).rows;
  check('claim wired to a stance + a bridge', claimEdges.length === 2, JSON.stringify(claimEdges));

  // the claim now appears via the question-map query (claim joined to its stance)
  const onMap = (await c.query(
    `select 1 from edges e where e.from_type='claim' and e.from_id=$1 and e.to_type='stance'`,
    [claim.id]
  )).rowCount;
  check('claim has a home on a question map', onMap === 1);

  // 2) create a bridge with a feeding claim — mirrors createBridgeWithEdges
  const bridge = (await c.query(
    `insert into bridge_claims (code, statement, domain_from, domain_to, test, resolvability, confidence, reflexive, note)
     values ($1,$2,$3,$4,$5,$6,$7,false,$8) returning id, code, confidence_label`,
    ['BZ9', 'TEST bridge: authoring smoke test', 'capability', 'economics', 'TEST: falsified if Y', 'slow', 0.5, null]
  )).rows[0];
  await c.query(
    `insert into edges (from_type, from_id, to_type, to_id, relation)
     values ('claim',$1,'bridge_claim',$2,'supports')
     on conflict (from_type, from_id, to_type, to_id, relation) do nothing`,
    [feedClaim.id, bridge.id]
  );
  const fed = (await c.query(
    `select 1 from edges where to_type='bridge_claim' and to_id=$1 and from_type='claim'`,
    [bridge.id]
  )).rowCount;
  check('bridge inserted + fed by a claim', bridge.confidence_label === 'contested' && fed === 1);

  // 3) the CHECK constraints reject a non-frame claim missing test/domain (savepoint so the
  //    expected error doesn't abort the outer transaction)
  await c.query('savepoint neg');
  let rejected = false;
  try {
    await c.query(
      `insert into claims (code, statement, test, domain, is_frame) values ('ZZ.2','bad',null,null,false)`
    );
  } catch {
    rejected = true;
  }
  await c.query('rollback to savepoint neg');
  check('non-frame claim with no test/domain is rejected by CHECK', rejected);

  // 4) argument_gap_scan singleton upsert (mirrors saveArgumentGapScan)
  await c.query(
    `insert into argument_gap_scan (id, recommendation, generated_at) values (true, $1::jsonb, now())
     on conflict (id) do update set recommendation = excluded.recommendation, generated_at = now()`,
    [JSON.stringify({ generatedAt: new Date().toISOString(), recommendations: [] })]
  );
  const scan = (await c.query(`select recommendation from argument_gap_scan where id = true`)).rowCount;
  check('argument_gap_scan singleton upserts + reads back', scan === 1);

  await c.query('rollback');
  console.log('\nrolled back — your real data is untouched');
  process.exit(ok ? 0 : 1);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('SMOKE TEST FAILED:', e.message);
  process.exit(1);
}
