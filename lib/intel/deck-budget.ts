import { one } from '../db';

// The company intel deck's daily model-spend guard (the edition budget
// pattern): one narrative call a day (feature 'intel_deck_sentence') against
// INTEL_DECK_DAILY_BUDGET_USD (default 0.10). Past the cap the runner saves a
// deterministic deck (no sentences, no front read) rather than skipping the day.
const FEATURES = ['intel_deck_sentence'];

export async function checkIntelDeckBudget(): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = Number(process.env.INTEL_DECK_DAILY_BUDGET_USD || 0.1);
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log
      where feature = any($1)
        and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [FEATURES]
  );
  const spentUsd = row?.spent ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
