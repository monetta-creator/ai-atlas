// Rollback-only smoke test of the evidence → conviction → rationale → snapshot
// loop on the hypothesis model. Everything runs inside one transaction that is
// rolled back, so your real data is never touched.
// Run directly: `node scripts/test-loop.mjs`.
import { makeClient } from './db.mjs';

const c = makeClient();

await c.connect();
await c.query('begin');
try {
  const src = (await c.query(
    `insert into sources (title, outlet, reliability_prior, raw_text)
     values ('TEST source','TestOutlet',70,'lorem ipsum') returning id`
  )).rows[0].id;

  const hyp = (await c.query(
    `select id, conviction, conviction_label from hypotheses where code = 'H1'`
  )).rows[0];
  if (!hyp) throw new Error("seed hypothesis 'H1' not found — run db:seed first");

  await c.query(
    `insert into evidence (source_id, hypothesis_id, direction, confidence, excerpt)
     values ($1,$2,'supports','high','first support'),
            ($1,$2,'supports','medium','second support')`,
    [src, hyp.id]
  );
  const ev = (await c.query(
    `select direction, count(*)::int n from evidence where hypothesis_id=$1 group by 1`,
    [hyp.id]
  )).rows;

  await c.query(`update hypotheses set conviction = 0.78 where id = $1`, [hyp.id]);
  const moved = (await c.query(
    `select conviction, conviction_label from hypotheses where id = $1`, [hyp.id]
  )).rows[0];

  await c.query(
    `insert into rationales (hypothesis_id, old_conviction, new_conviction, reason)
     values ($1,$2,0.78,'test: evidence reproduced the reported gains')`,
    [hyp.id, hyp.conviction]
  );

  await c.query(`insert into snapshots (state, trigger) values ($1,'post_commit')`, [
    JSON.stringify({ hypotheses: { [hyp.id]: 0.78 } }),
  ]);

  const rat = (await c.query(`select count(*)::int n from rationales where hypothesis_id=$1`, [hyp.id])).rows[0].n;
  const snap = (await c.query(`select count(*)::int n from snapshots`)).rows[0].n;

  console.log('source created                :', !!src);
  console.log('evidence (one-sided)          :', JSON.stringify(ev));
  console.log('label 0.50 -> 0.78            :', hyp.conviction_label, '->', moved.conviction_label);
  console.log('rationale rows for hypothesis :', rat);
  console.log('snapshot rows (in tx)         :', snap);

  await c.query('rollback');
  console.log('rolled back — your real data is untouched (still neutral)');
} catch (e) {
  await c.query('rollback');
  console.error('LOOP TEST FAILED:', e.message);
  process.exit(1);
}
await c.end();
