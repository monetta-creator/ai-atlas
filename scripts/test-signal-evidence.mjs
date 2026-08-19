// Rollback-only smoke test of the Signal → Evidence → Claim chain (migration 0006).
// Mirrors test-loop.mjs: everything runs inside one transaction that is rolled back,
// so your real data is never touched. Run directly: `node scripts/test-signal-evidence.mjs`.
import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log('  ok ·', msg);
};

await c.connect();
await c.query('begin');
try {
  const claim = (await c.query(`select id, code from claims where code = '1.1'`)).rows[0];
  if (!claim) throw new Error("seed claim '1.1' not found — run db:seed first");

  // 1) Create an UNPUBLISHED signal carrying a touch with direction + reason. A signal
  //    can be its own source (source_id null), so this also exercises that path.
  const signalId = (await c.query(
    `insert into signals (title, summary, significance, lenses, claim_touches, touch_details, is_published, origin)
     values ('TEST signal','t','medium', '{capability}'::signal_lens_t[], $1::text[], $2::jsonb, false, 'pipeline')
     returning id`,
    [[claim.code], JSON.stringify({ [claim.code]: { direction: 'supports', reason: 'test reason' } })]
  )).rows[0].id;
  const draftEv = (await c.query(`select count(*)::int n from evidence where signal_id = $1`, [signalId])).rows[0].n;
  assert(draftEv === 0, 'a draft signal materializes no evidence');

  // 2) Publish = materialize one evidence row per touch (the syncSignalEvidence logic).
  await c.query(
    `insert into evidence (signal_id, source_id, target_type, target_id, direction, weight, excerpt, lens)
     values ($1, null, 'claim', $2, 'supports', 'medium', 'test reason', 'capability'::signal_lens_t)`,
    [signalId, claim.id]
  );
  const pubEv = (await c.query(
    `select direction, lens, signal_id, source_id from evidence where signal_id = $1`, [signalId]
  )).rows;
  assert(pubEv.length === 1, 'publish materializes one evidence row for the touch');
  assert(pubEv[0].direction === 'supports', 'evidence carries the touch direction');
  assert(pubEv[0].lens === 'capability', 'evidence carries the audience lens (signal_lens_t)');
  assert(pubEv[0].source_id === null, 'a sourceless signal is its own provenance (source_id null)');

  // 3) The provenance CHECK rejects evidence with neither a source nor a signal.
  let rejected = false;
  await c.query('savepoint sp');
  try {
    await c.query(
      `insert into evidence (source_id, signal_id, target_type, target_id, direction, weight)
       values (null, null, 'claim', $1, 'supports', 'medium')`,
      [claim.id]
    );
  } catch {
    rejected = true;
  }
  await c.query('rollback to savepoint sp');
  assert(rejected, 'CHECK rejects evidence with neither source nor signal');

  // 4) Unpublish = delete the signal's materialized evidence.
  await c.query(`delete from evidence where signal_id = $1`, [signalId]);
  const afterUnpub = (await c.query(`select count(*)::int n from evidence where signal_id = $1`, [signalId])).rows[0].n;
  assert(afterUnpub === 0, 'unpublish removes the materialized evidence');

  // 5) Deleting a signal cascades its evidence (re-materialize, then delete the signal).
  await c.query(
    `insert into evidence (signal_id, target_type, target_id, direction, weight)
     values ($1,'claim',$2,'supports','medium')`, [signalId, claim.id]
  );
  await c.query(`delete from signals where id = $1`, [signalId]);
  const afterDelete = (await c.query(`select count(*)::int n from evidence where signal_id = $1`, [signalId])).rows[0].n;
  assert(afterDelete === 0, 'deleting a signal cascade-removes its evidence');

  await c.query('rollback');
  console.log('\nrolled back — your real data is untouched.');
} catch (e) {
  await c.query('rollback');
  console.error('SIGNAL→EVIDENCE TEST FAILED:', e.message);
  process.exit(1);
}
await c.end();
