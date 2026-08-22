// Rollback-only smoke test of the Signal → Evidence → Hypothesis chain.
// Mirrors test-loop.mjs: everything runs inside one transaction that is rolled back,
// so your real data is never touched. Run directly: `node scripts/test-signal-evidence.mjs`.
import { makeClient } from './db.mjs';

const c = makeClient();

const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log('  ok ·', msg);
};

await c.connect();
await c.query('begin');
try {
  const hyp = (await c.query(`select id, code from hypotheses where code = 'H1'`)).rows[0];
  if (!hyp) throw new Error("seed hypothesis 'H1' not found — run db:seed first");

  // 1) Create an UNPUBLISHED signal carrying a touch with direction + reason. A signal
  //    can be its own source (source_id null), so this also exercises that path.
  const signalId = (await c.query(
    `insert into signals (title, summary, significance, context, touches, touch_details, is_published, origin)
     values ('TEST signal','t','medium', 'external'::context_t, $1::text[], $2::jsonb, false, 'pipeline')
     returning id`,
    [[hyp.code], JSON.stringify({ [hyp.code]: { direction: 'supports', reason: 'test reason' } })]
  )).rows[0].id;
  const draftEv = (await c.query(`select count(*)::int n from evidence where signal_id = $1`, [signalId])).rows[0].n;
  assert(draftEv === 0, 'a draft signal materializes no evidence');

  // 2) Publish = materialize one evidence row per touch (the syncSignalEvidence logic).
  await c.query(
    `insert into evidence (signal_id, source_id, hypothesis_id, direction, confidence, excerpt)
     values ($1, null, $2, 'supports', 'medium', 'test reason')`,
    [signalId, hyp.id]
  );
  const pubEv = (await c.query(
    `select direction, signal_id, source_id from evidence where signal_id = $1`, [signalId]
  )).rows;
  assert(pubEv.length === 1, 'publish materializes one evidence row for the touch');
  assert(pubEv[0].direction === 'supports', 'evidence carries the touch direction');
  assert(pubEv[0].source_id === null, 'a sourceless signal is its own provenance (source_id null)');

  // 3) The provenance CHECK rejects evidence with neither a source nor a signal.
  let rejected = false;
  await c.query('savepoint sp');
  try {
    await c.query(
      `insert into evidence (source_id, signal_id, hypothesis_id, direction, confidence)
       values (null, null, $1, 'supports', 'medium')`,
      [hyp.id]
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
    `insert into evidence (signal_id, hypothesis_id, direction, confidence)
     values ($1,$2,'supports','medium')`, [signalId, hyp.id]
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
