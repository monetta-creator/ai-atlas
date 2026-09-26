import { one } from '../db';

// Savant's model-spend guard, per ISSUE WEEK rather than per day: sums
// ai_cost_log rows for the savant_* features stamped with the week
// (metadata.week_end) against SAVANT_WEEKLY_BUDGET_USD (default 6; a week of
// notebook notes plus the Friday issue is about $1.50). Past the cap the
// notebook skips its model note and the Friday run falls back leg by leg to
// deterministic renderings, never to silence.

export const SAVANT_FEATURES = ['savant_plan', 'savant_note', 'savant_lead', 'savant_sections', 'savant_editor', 'savant_revise', 'savant_teaser'];

export function savantCapUsd(): number {
  const n = Number(process.env.SAVANT_WEEKLY_BUDGET_USD || 6);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

export async function checkSavantBudget(weekEnd: string): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = savantCapUsd();
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log
      where feature = any($1) and metadata->>'week_end' = $2`,
    [SAVANT_FEATURES, weekEnd]
  );
  const spentUsd = row?.spent ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
