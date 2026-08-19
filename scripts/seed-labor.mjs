// Seed the labor question (Q7) — the knowledge-work side of the AI-economy debate.
// Mirrors db:seed's idempotency contract: upsert on slug/code keeping only the
// STRUCTURAL columns in sync on conflict, never clobbering prose (editable on
// /data) or confidence (the author's to move; new nodes start NEUTRAL 0.50).
// Kept out of db:seed because THAT seed resets every confidence to 0.50.
//
// Requires migration 0028 (the 'labor' domain_t value) to be applied first.
// Run: node scripts/seed-labor.mjs   (DATABASE_URL, else SUPABASE_DB_* direct)

import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

const NEUTRAL = 0.5;

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

const question = {
  slug: 'labor',
  sort: 7,
  primary_lens: 'employment',
  title: 'Is AI actually displacing knowledge work, and where does the impact land first?',
  summary:
    'The labor side of the debate: whether AI adoption is reducing knowledge-work employment ' +
    '(with entry-level roles as the leading edge), merely recomposing tasks and career ladders, ' +
    'or whether the macro cycle still drowns out any attributable signal.',
};

const stances = [
  {
    code: 'Q7-S7A', sort: 1,
    title: 'Displacement is real and already visible at the entry level.',
    summary:
      'AI substitutes for junior tasks first, so hiring compression shows up earliest in ' +
      'entry-level knowledge work; what looks like cycle softness is partly structural.',
    test:
      'Entry-level postings and hires in AI-exposed occupations re-converging with ' +
      'less-exposed controls for 12+ months, or attribution studies failing to replicate, ' +
      'would move off this stance.',
  },
  {
    code: 'Q7-S7B', sort: 2,
    title: 'Augmentation and churn, not net displacement.',
    summary:
      'Tasks recompose and productivity rises while total knowledge-work employment holds; ' +
      'the career ladder changes shape, but headcount does not structurally fall.',
    test:
      'A sustained net employment decline in exposed knowledge occupations, controlling for ' +
      'the macro cycle, would move off this stance.',
  },
  {
    code: 'Q7-S7C', sort: 3,
    title: 'Too early to attribute: macro noise dominates.',
    summary:
      'Hiring softness tracks rates and the business cycle; attributing it to AI is premature ' +
      'until exposure-stratified evidence accumulates.',
    test:
      'Replicated exposure-stratified studies attributing hiring or employment declines ' +
      'specifically to AI adoption would move off this stance.',
  },
];

const claims = [
  {
    code: '7.1', domain: 'labor', resolv: 'slow',
    statement:
      'Entry-level hiring in AI-exposed knowledge occupations is contracting relative to less-exposed occupations.',
    test:
      'Postings and hiring datasets (LinkedIn, Indeed, ADP, university digital-economy labs) show an ' +
      'exposed-vs-control gap in entry-level hiring persisting 12+ months; falsified if the gap closes ' +
      'or disappears once cycle controls are applied.',
  },
  {
    code: '7.2', domain: 'labor', resolv: 'clean',
    statement:
      'Large employers are explicitly attributing headcount reductions or hiring freezes to AI.',
    test:
      'The count and scale of major employers making explicit AI attributions in filings, earnings calls, ' +
      'or public statements keeps growing; falsified if attributions stall, reverse, or are walked back ' +
      'as cover for cycle-driven cuts.',
  },
  {
    code: '7.3', domain: 'labor', resolv: 'slow',
    statement:
      'AI adoption compresses the apprenticeship ladder: fewer junior roles per senior, rather than fewer seniors.',
    test:
      'Organization-composition data in exposed functions shows the junior-to-senior ratio falling while ' +
      'senior headcount holds; falsified if ratios hold steady or juniors and seniors decline together.',
  },
  {
    code: '7.4', domain: 'labor', resolv: 'slow',
    statement:
      'Measured productivity gains from AI in knowledge work are large enough to change staffing plans.',
    test:
      'Replicated field studies and RCTs show task-time or throughput gains above roughly 20% in exposed ' +
      'functions, and firms cite them in workforce planning; falsified if gains stay small, fail to ' +
      'replicate, or never reach staffing decisions.',
  },
  {
    code: '7.5', domain: 'labor', resolv: 'slow',
    statement:
      'AI-driven displacement is visible in aggregate labor statistics for knowledge workers, not just in anecdotes.',
    test:
      'White-collar unemployment, hiring, or wage series diverge along AI-exposure indices in official ' +
      'statistics; falsified if aggregate series stay flat once cycle effects are removed.',
  },
];

// claim -> stance edges (plus the one cross-question edge that knits labor into the
// economics question: measurable productivity is the mechanism behind enterprise ROI),
// and the strongest-opposing stance<->stance guardrail for Q7.
const edges = [
  ['claim', '7.1', 'stance', 'Q7-S7A', 'supports'],
  ['claim', '7.1', 'stance', 'Q7-S7C', 'contradicts'],
  ['claim', '7.2', 'stance', 'Q7-S7A', 'supports'],
  ['claim', '7.2', 'stance', 'Q7-S7C', 'contradicts'],
  ['claim', '7.3', 'stance', 'Q7-S7B', 'supports'],
  ['claim', '7.4', 'stance', 'Q7-S7A', 'supports'],
  ['claim', '7.4', 'stance', 'Q7-S7B', 'supports'],
  ['claim', '7.4', 'stance', 'Q3-S3A', 'supports'],
  ['claim', '7.5', 'stance', 'Q7-S7A', 'supports'],
  ['claim', '7.5', 'stance', 'Q7-S7C', 'contradicts'],
  ['stance', 'Q7-S7A', 'stance', 'Q7-S7B', 'contradicts'],
];

await client.connect();
await client.query('begin');
try {
  const qr = await client.query(
    `insert into questions (title, slug, summary, primary_lens, sort_order)
     values ($1,$2,$3,$4,$5)
     on conflict (slug) do update set
       primary_lens=excluded.primary_lens, sort_order=excluded.sort_order
     returning id`,
    [question.title, question.slug, question.summary, question.primary_lens, question.sort]
  );
  const questionId = qr.rows[0].id;

  const stanceId = {};
  for (const s of stances) {
    const r = await client.query(
      `insert into stances (question_id, code, title, holder, summary, test, confidence, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (code) do update set
         question_id=excluded.question_id, sort_order=excluded.sort_order
       returning id`,
      [questionId, s.code, s.title, null, s.summary, s.test, NEUTRAL, s.sort]
    );
    stanceId[s.code] = r.rows[0].id;
  }

  const claimId = {};
  for (const c of claims) {
    const r = await client.query(
      `insert into claims (code, statement, test, domain, domain_note, resolvability, confidence, is_frame, reflexive)
       values ($1,$2,$3,$4,$5,$6,$7,false,false)
       on conflict (code) do update set
         domain=excluded.domain, resolvability=excluded.resolvability
       returning id`,
      [c.code, c.statement, c.test, c.domain, null, c.resolv, NEUTRAL]
    );
    claimId[c.code] = r.rows[0].id;
  }

  const idOf = async (type, code) => {
    if (type === 'claim') return claimId[code];
    if (stanceId[code]) return stanceId[code];
    const r = await client.query(`select id from stances where code = $1`, [code]);
    if (!r.rows[0]) throw new Error(`edge endpoint not found: ${type}:${code}`);
    return r.rows[0].id;
  };

  for (const [ft, fc, tt, tc, rel] of edges) {
    const fromId = ft === 'stance' ? await idOf('stance', fc) : await idOf(ft, fc);
    const toId = await idOf(tt, tc);
    await client.query(
      `insert into edges (from_type, from_id, to_type, to_id, relation)
       values ($1,$2,$3,$4,$5)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing`,
      [ft, fromId, tt, toId, rel]
    );
  }

  // employment lens tags for the new nodes (the /lens views).
  for (const s of stances) {
    await client.query(
      `insert into node_lenses (target_type, target_id, lens) values ('stance',$1,'employment')
       on conflict (target_type, target_id, lens) do nothing`,
      [stanceId[s.code]]
    );
  }
  for (const c of claims) {
    await client.query(
      `insert into node_lenses (target_type, target_id, lens) values ('claim',$1,'employment')
       on conflict (target_type, target_id, lens) do nothing`,
      [claimId[c.code]]
    );
  }

  await client.query('commit');
  console.log('labor seed complete: question 7 (labor), 3 stances, 5 claims, 11 edges, lens tags');
} catch (e) {
  await client.query('rollback');
  console.error('LABOR SEED FAILED:', e.message);
  process.exit(1);
}
await client.end();
