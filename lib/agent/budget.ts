import { one } from '../db';

// The agent's daily model-spend ceiling (the pipeline/scan/intel/research
// budget pattern): sums today's UTC spend across the three agent_* features
// and compares against AGENT_DAILY_BUDGET_USD (default 0.25). Checked before
// every model-costing remedy and before the brief/chat legs; past the cap the
// agent reads and writes but stops calling models until the next UTC day.
const FEATURES = ['agent_brief', 'agent_chat', 'agent_remedy'];

export async function checkAgentBudget(): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = Math.max(0.05, Number(process.env.AGENT_DAILY_BUDGET_USD || 0.25));
  const row = await one<{ usd: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
      where feature = any($1::text[]) and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [FEATURES]
  );
  const spentUsd = row?.usd ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
