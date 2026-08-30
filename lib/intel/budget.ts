import { one } from '../db';

// The intel desk's daily model-spend guard (the scan budget pattern): sums
// today's UTC spend across the intel features and compares against
// INTEL_DAILY_BUDGET_USD (default 1.00). Checked between units, never inside
// them; a trip ships items unenriched rather than failing the run. The gov
// and feed legs are model-free and always run.

const INTEL_FEATURES = ['intel_enrich', 'intel_synthesis'];

export async function checkIntelBudget(): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = Number(process.env.INTEL_DAILY_BUDGET_USD || 1.0);
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log
      where feature = any($1)
        and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [INTEL_FEATURES]
  );
  const spentUsd = row?.spent ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
