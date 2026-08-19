import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  console.log('\n— questions: stances + claims (via edges) —');
  const perQ = await client.query(`
    select q.sort_order, q.slug,
      (select count(*) from stances s where s.question_id = q.id) as stances,
      (select count(distinct e.from_id) from edges e
         join stances s2 on s2.id = e.to_id and e.to_type='stance'
        where s2.question_id = q.id and e.from_type='claim') as claims
    from questions q order by q.sort_order`);
  for (const r of perQ.rows) console.log(`  Q${r.sort_order} ${r.slug.padEnd(15)} ${r.stances} stances · ${r.claims} claims`);

  console.log('\n— confidence_label generated column (0.50 → ?) —');
  const lbl = await client.query(`select confidence_label, count(*)::int n from claims where is_frame=false group by 1`);
  for (const r of lbl.rows) console.log(`  ${r.confidence_label}: ${r.n}`);

  console.log('\n— F1 frame (no domain/test/confidence; quarantined) —');
  const f = await client.query(`select code, is_frame, domain, test, confidence from claims where code='F1'`);
  console.log('  ', JSON.stringify(f.rows[0]));

  console.log('\n— B1 fed-by (the bridge spine) —');
  const b1 = await client.query(`
    select c.code, e.relation
    from edges e join claims c on c.id = e.from_id
    join bridge_claims b on b.id = e.to_id and e.to_type='bridge_claim'
    where b.code='B1' and e.from_type='claim' order by e.relation, c.code`);
  for (const r of b1.rows) console.log(`  ${r.code} ${r.relation} B1`);

  console.log('\n— reflexive claims —');
  const rx = await client.query(`select code from claims where reflexive=true order by code`);
  console.log('  ', rx.rows.map((r) => r.code).join(', '));

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
