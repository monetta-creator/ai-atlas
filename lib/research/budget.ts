import { one } from '../db';

// The research engine's daily model-spend guard (the intel/scan budget
// pattern): sums today's UTC spend across the research features and compares
// against RESEARCH_DAILY_BUDGET_USD (default 1.00). Checked between units,
// never inside them; a trip defers remaining work to the next run rather than
// failing it. The pull leg is model-free (plain arXiv XML) and always runs.

const RESEARCH_FEATURES = ['research_triage', 'research_analysis', 'research_agent', 'research_synthesis'];

export async function checkResearchBudget(): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = Number(process.env.RESEARCH_DAILY_BUDGET_USD || 1.0);
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log
      where feature = any($1)
        and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [RESEARCH_FEATURES]
  );
  const spentUsd = row?.spent ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
