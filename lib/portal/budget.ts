import { one } from '@/lib/db';

// The portal Ask spend ceiling. Every /api/portal/ask call is metered into
// ai_cost_log (feature 'portal_ask'); before each model call we sum today's
// spend (UTC day, matching the log's timestamptz) and refuse past the cap.
//
// Two documented soft spots, both bounded to roughly one extra Haiku call:
// recordApiCall is best-effort (a logging failure undercounts), so a secondary
// max-calls guard rides on the same query; and two concurrent requests can both
// pass the check (no lock; acceptable overshoot for a sub-cent call).

export const PORTAL_FEATURE = 'portal_ask';
// Every feature slug that draws on the portal's daily budget. Portal-triggered
// scout research (intel sweeps, document reads) all log as 'portal_scout';
// per-tool granularity lives in ai_cost_log.metadata.tool.
export const PORTAL_FEATURES = ['portal_ask', 'portal_scout'];

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export interface PortalBudget {
  ok: boolean;
  spentUsd: number;
  calls: number;
  capUsd: number;
  capCalls: number;
}

export async function checkPortalBudget(): Promise<PortalBudget> {
  const capUsd = envNumber('PORTAL_DAILY_BUDGET_USD', 1.0);
  const capCalls = envNumber('PORTAL_DAILY_MAX_CALLS', 200);
  const row = await one<{ usd: number; n: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd, count(*)::int as n
       from ai_cost_log
      where feature = any($1::text[])
        and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    [PORTAL_FEATURES]
  );
  const spentUsd = row?.usd ?? 0;
  const calls = row?.n ?? 0;
  return { ok: spentUsd < capUsd && calls < capCalls, spentUsd, calls, capUsd, capCalls };
}
