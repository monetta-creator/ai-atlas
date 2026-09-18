import { one } from '../db';
import type { ToolingRunKind } from '../types';

// The tooling monitor's per-RUN spend guard (the scan/intel budget pattern,
// adapted): every tooling engine call carries metadata.tooling_run = the run
// id, so the guard sums by run rather than by calendar day (a pull run can
// span many days, unlike the daily engines). Checked between units, never
// inside one; a trip skips the remaining deep dives and the report but still
// lets the run complete (the intel behavior).

export async function checkToolingBudget(
  runId: string,
  kind: ToolingRunKind
): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = Number(
    kind === 'pull'
      ? process.env.TOOLING_PULL_BUDGET_USD || 12
      : process.env.TOOLING_WEEKLY_BUDGET_USD || 4
  );
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log
      where metadata->>'tooling_run' = $1`,
    [runId]
  );
  const spentUsd = row?.spent ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
