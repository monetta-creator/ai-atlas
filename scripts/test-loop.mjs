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

await c.connect();
await c.query('begin');
try {
  const src = (await c.query(
    `insert into sources (title, outlet, reliability_prior, raw_text)
     values ('TEST source','TestOutlet',70,'lorem ipsum') returning id`
  )).rows[0].id;

  const claim = (await c.query(
    `select id, confidence, confidence_label from claims where code = '1.1'`
  )).rows[0];

  await c.query(
    `insert into evidence (source_id, target_type, target_id, direction, weight, excerpt)
     values ($1,'claim',$2,'supports','high','first support'),
            ($1,'claim',$2,'supports','medium','second support')`,
    [src, claim.id]
  );
  const ev = (await c.query(
    `select direction, count(*)::int n from evidence where target_type='claim' and target_id=$1 group by 1`,
    [claim.id]
  )).rows;

  await c.query(`update claims set confidence = 0.78 where id = $1`, [claim.id]);
  const moved = (await c.query(
    `select confidence, confidence_label from claims where id = $1`, [claim.id]
  )).rows[0];

  await c.query(
    `insert into rationales (target_type, target_id, old_confidence, new_confidence, reason)
     values ('claim',$1,$2,0.78,'test: evidence reproduced the benchmark gains')`,
    [claim.id, claim.confidence]
  );

  await c.query(`insert into snapshots (state, trigger) values ($1,'post_commit')`, [
    JSON.stringify({ claims: { [claim.id]: 0.78 } }),
  ]);

  const rat = (await c.query(`select count(*)::int n from rationales where target_id=$1`, [claim.id])).rows[0].n;
  const snap = (await c.query(`select count(*)::int n from snapshots`)).rows[0].n;

  console.log('source created           :', !!src);
  console.log('evidence (one-sided)     :', JSON.stringify(ev));
  console.log('label 0.50 -> 0.78       :', claim.confidence_label, '->', moved.confidence_label);
  console.log('rationale rows for claim :', rat);
  console.log('snapshot rows (in tx)    :', snap);

  await c.query('rollback');
  console.log('rolled back — your real data is untouched (still neutral)');
} catch (e) {
  await c.query('rollback');
  console.error('LOOP TEST FAILED:', e.message);
  process.exit(1);
}
await c.end();
