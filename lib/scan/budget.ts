import { one } from '../db';

// The scan's daily spend ceiling (the lib/portal/budget.ts pattern). Every
// scan model call is metered into ai_cost_log (features below); before each
// billable unit the step engine sums today's spend (UTC day) and, past the
// cap, skips the remaining web-search and enrichment work. The feed leg is
// model-free and always runs.
//
// Same documented soft spots as the portal budget, bounded to roughly one
// extra call: recordApiCall is best-effort, and two concurrent invocations can
// both pass the check (the run lease makes that rare).

const SCAN_FEATURES = ['scan_search', 'scan_enrich'];

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export interface ScanBudget {
  ok: boolean;
  spentUsd: number;
  capUsd: number;
}

export async function checkScanBudget(): Promise<ScanBudget> {
  const capUsd = envNumber('SCAN_DAILY_BUDGET_USD', 1.5);
  const row = await one<{ usd: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd
       from ai_cost_log
      where feature = any($1::text[])
        and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    [SCAN_FEATURES]
  );
  const spentUsd = row?.usd ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
