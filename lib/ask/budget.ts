// The chat's monthly spend, summed from ai_cost_log by the redo's feature
// slugs (budget-policy.ts holds the policy). Cap from ASK_MONTHLY_BUDGET_USD.
import { one } from '../db';
import { BUDGET_FEATURES, DEFAULT_MONTHLY_CAP_USD, type BudgetState } from './budget-policy';

export async function askBudget(): Promise<BudgetState> {
  const capUsd = Number(process.env.ASK_MONTHLY_BUDGET_USD || DEFAULT_MONTHLY_CAP_USD);
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log
      where feature = any($1)
        and created_at >= date_trunc('month', now() at time zone 'utc')`,
    [[...BUDGET_FEATURES]],
  );
  return { spentUsd: row?.spent ?? 0, capUsd: Number.isFinite(capUsd) && capUsd > 0 ? capUsd : DEFAULT_MONTHLY_CAP_USD };
}
