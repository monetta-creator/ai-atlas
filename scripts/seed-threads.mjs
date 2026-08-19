import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

// Seed for /research threads (migration 0023, docs/research-section.md). Idempotent:
// upserts on slug WITHOUT clobbering synthesis or status — once a thread is live, the
// app (synthesis updates, retitling in the console) is the source of truth, same
// philosophy as seed-concepts.mjs. Run with: npm run db:seed:threads

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

// The five starting frontier questions (agreed 2026-07-09). Editable in the app;
// the model proposes additions later via the thread-scan panel (phase 3).
const threads = [
  {
    slug: 'scaling-returns',
    title: 'Does scaling keep paying off?',
    question: 'Do capability returns to more compute, data, and parameters keep justifying frontier-scale training runs, or are they flattening?',
  },
  {
    slug: 'agent-reliability',
    title: 'Agent reliability vs. the eval-real-work gap',
    question: 'How far does agent performance on benchmarks and evals translate into reliable, unattended real-world task completion?',
  },
  {
    slug: 'inference-cost-curves',
    title: 'Inference cost curves',
    question: 'How fast is the cost per unit of useful model output actually falling, and who captures the savings?',
  },
  {
    slug: 'rl-verifiable-rewards',
    title: 'What RL on verifiable rewards changes',
    question: 'Does reinforcement learning on verifiable rewards shift capability gains away from pretraining scale, and in which domains does it generalize?',
  },
  {
    slug: 'labor-automation-evidence',
    title: 'Automation evidence in real labor data',
    question: 'Where does AI-driven task automation actually show up in employment, wage, and productivity data, beyond pilots and surveys?',
  },
];

async function main() {
  await client.connect();
  let inserted = 0;
  let kept = 0;
  for (const t of threads) {
    const res = await client.query(
      `insert into research_threads (slug, title, question)
       values ($1, $2, $3)
       on conflict (slug) do nothing`,
      [t.slug, t.title, t.question]
    );
    if (res.rowCount) inserted++;
    else kept++;
  }
  console.log(`research_threads: ${inserted} inserted, ${kept} already present (left untouched).`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
