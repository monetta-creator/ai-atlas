import { one } from '../db';

// The daily edition's model-spend guard (the research/scan/pipeline budget
// pattern): sums today's UTC spend across the two edition features and
// compares against EDITION_DAILY_BUDGET_USD (default 0.10; two GLM calls
// cost about a cent, so the cap is generous headroom, not a tight ceiling).
// Checked once per run, before either leg; past the cap lib/edition/run.ts
// skips the model entirely and falls back to a deterministic front + no
// column rather than partially spending the budget on one leg.

const EDITION_FEATURES = ['edition_front', 'edition_column'];

export async function checkEditionBudget(): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = Number(process.env.EDITION_DAILY_BUDGET_USD || 0.1);
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log
      where feature = any($1)
        and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [EDITION_FEATURES]
  );
  const spentUsd = row?.spent ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
