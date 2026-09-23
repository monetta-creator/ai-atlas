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
// The portal Ask's lane classifier (one utility-model call per turn, declined
// turns included), metered under its own slug so it counts toward both caps.
export const PORTAL_CLASSIFY_FEATURE = 'portal_ask_classify';
// Every feature slug that draws on the portal's daily budget. Portal-triggered
// scout research (intel sweeps, document reads) all log as 'portal_scout';
// per-tool granularity lives in ai_cost_log.metadata.tool. 'portal_tooling'
// covers a portal keyholder's tooling-monitor deep dives and report legs.
// 'portal_nl_query' is the Data Portal's natural-language query builder
// (migration 0060 era): one utility-model call per question.
export const PORTAL_NL_FEATURE = 'portal_nl_query';
const PORTAL_FEATURES = ['portal_ask', PORTAL_CLASSIFY_FEATURE, 'portal_scout', 'portal_tooling', PORTAL_NL_FEATURE];

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

interface PortalBudget {
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

// The per-key ceiling on top of the portal-wide one (migration 0060): the key
// row carries its own caps (defaults PORTAL_KEY_DAILY_BUDGET_USD 0.25 and 60
// calls) and every portal-triggered recordApiCall stamps
// metadata.portal_key_id (the Ask route directly; the scout and tooling
// actions through portalKeyMetadata(requirePortal()) in lib/actions/shared.ts),
// so today's spend is one indexed sum. An unknown key id fails closed.
export async function checkKeyBudget(keyId: string): Promise<PortalBudget> {
  const row = await one<{ cap_usd: number | null; cap_calls: number | null; usd: number; n: number }>(
    `select k.daily_ask_budget_usd as cap_usd, k.daily_ask_max_calls as cap_calls,
            coalesce(s.usd, 0)::numeric as usd, coalesce(s.n, 0)::int as n
       from portal_keys k
       left join (
         select coalesce(sum(cost_usd), 0)::numeric as usd, count(*)::int as n
           from ai_cost_log
          where metadata->>'portal_key_id' = $1::text
            and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
       ) s on true
      where k.id = $1::uuid`,
    [keyId]
  );
  const capUsd = row?.cap_usd ?? envNumber('PORTAL_KEY_DAILY_BUDGET_USD', 0.25);
  const capCalls = row?.cap_calls ?? 60;
  const spentUsd = row?.usd ?? 0;
  const calls = row?.n ?? 0;
  return { ok: Boolean(row) && spentUsd < capUsd && calls < capCalls, spentUsd, calls, capUsd, capCalls };
}
