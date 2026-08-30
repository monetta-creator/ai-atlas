import { q, one } from '../db';
import type {
  CostDashboard, RateCard, CostSummary, DailyCostPoint, FeatureCost, RunCost, CostLogRow,
  MonthlyBill, SubsystemCost,
  } from '../types';

// ---- AI cost dashboard (/costs, admin-only; migration 0014) -----------------
// Every aggregate for the cost console in one parallel trip-set. Costs are read straight off
// the FROZEN cost_usd column (priced at call time), never recomputed here. camelCase result
// keys are double-quoted in SQL so they survive Postgres's lowercasing and match the types.
export async function getCostDashboard(): Promise<CostDashboard> {
  const [summaryRow, daily60, features, runs, recent, activeRateCards, rateCardHistory] = await Promise.all([
    one<CostSummary>(
      `select count(*)::int as calls,
              coalesce(sum(cost_usd), 0) as total,
              coalesce(sum(cost_usd) filter (where created_at >= now() - interval '30 days'), 0) as d30,
              coalesce(sum(cost_usd) filter (where created_at >= now() - interval '7 days'), 0)  as d7,
              count(*) filter (where created_at >= now() - interval '30 days')::int as "calls30",
              count(*) filter (where created_at >= now() - interval '7 days')::int  as "calls7",
              coalesce(avg(cost_usd), 0) as "avgCost"
         from ai_cost_log`
    ),
    // 60 zero-filled days (oldest → newest): the extra 30 days of lookback make the 30-day
    // rolling mean a TRUE trailing-30 mean for every one of the 30 days we display.
    q<{ day: string; cost: number; calls: number }>(
      `with days as (
         select generate_series(current_date - interval '59 days', current_date, interval '1 day')::date as day
       ),
       agg as (
         select created_at::date as day, sum(cost_usd) as cost, count(*)::int as calls
           from ai_cost_log
          where created_at >= current_date - interval '59 days'
          group by created_at::date
       )
       select to_char(d.day, 'YYYY-MM-DD') as day,
              coalesce(a.cost, 0) as cost,
              coalesce(a.calls, 0) as calls
         from days d left join agg a on a.day = d.day
        order by d.day`
    ),
    q<FeatureCost>(
      `select feature,
              count(*)::int as calls,
              coalesce(sum(cost_usd), 0) as "totalCost",
              coalesce(avg(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) as "avgTokens",
              coalesce(avg(input_tokens), 0)  as "avgInput",
              coalesce(avg(output_tokens), 0) as "avgOutput",
              coalesce(avg(context_pct), 0)   as "avgContextPct",
              coalesce(percentile_cont(0.5)  within group (order by cost_usd), 0) as p50,
              coalesce(percentile_cont(0.9)  within group (order by cost_usd), 0) as p90,
              coalesce(percentile_cont(0.99) within group (order by cost_usd), 0) as p99
         from ai_cost_log
        group by feature
        order by "totalCost" desc`
    ),
    // Per-run rollup, last 20 runs (a pre-instrumentation run simply shows 0). tokens cast to
    // int (a run's total is well within int range) so it returns a JS number, not a bigint string.
    q<RunCost>(
      `select r.id, r.triggered_at::text as triggered_at, r.cadence::text as cadence, r.status::text as status,
              count(l.id)::int as calls,
              coalesce(sum(l.cost_usd), 0) as cost,
              coalesce(sum(l.input_tokens + l.output_tokens + l.cache_read_tokens + l.cache_write_tokens), 0)::int as tokens
         from pipeline_runs r
         left join ai_cost_log l on l.pipeline_run_id = r.id
        group by r.id
        order by r.triggered_at desc
        limit 20`
    ),
    q<CostLogRow>(
      `select l.id, l.created_at::text as created_at, l.feature, l.model,
              l.input_tokens, l.output_tokens, l.cache_read_tokens, l.cache_write_tokens,
              l.wall_ms, l.context_pct, l.cost_usd,
              l.pipeline_run_id::text as pipeline_run_id
         from ai_cost_log l
        order by l.created_at desc
        limit 100`
    ),
    // Active card per model: the latest effective_date on-or-before today (a future-dated card
    // is not active yet). distinct on (model) + the matching order picks it in one pass.
    q<RateCard>(
      `select distinct on (model)
              id, model, effective_date::text as effective_date,
              input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok,
              context_window, created_at::text as created_at
         from ai_rate_cards
        where effective_date <= current_date
        order by model, effective_date desc, created_at desc`
    ),
    q<RateCard>(
      `select id, model, effective_date::text as effective_date,
              input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok,
              context_window, created_at::text as created_at
         from ai_rate_cards
        order by model asc, effective_date desc, created_at desc`
    ),
  ]);

  // Rolling means over the 60-day series, then keep the last 30 days for display.
  const series = daily60 as { day: string; cost: number; calls: number }[];
  const trailingMean = (i: number, n: number): number => {
    const start = Math.max(0, i - n + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += series[j].cost;
    return sum / (i - start + 1);
  };
  const daily: DailyCostPoint[] = series
    .map((d, i) => ({ day: d.day, cost: d.cost, calls: d.calls, avg7: trailingMean(i, 7), avg30: trailingMean(i, 30) }))
    .slice(-30);

  const summary: CostSummary =
    summaryRow ?? { calls: 0, total: 0, d30: 0, d7: 0, calls30: 0, calls7: 0, avgCost: 0 };

  return { summary, daily, features, runs, recent, activeRateCards, rateCardHistory };
}

// ---- Monthly bill (/costs "showpiece" header) ------------------------------
// Rolls the flat feature-slug log into the handful of subsystems the app's README talks in
// terms of. First-match-wins, prefix-based, with a catch-all — edit here when a new feature
// slug ships (lib/cost.ts recordApiCall call sites are the source of truth for slugs; their
// human labels live in lib/format.ts featureLabel, a separate map for the per-feature table).
const SUBSYSTEM_RULES: { test: (feature: string) => boolean; name: string; cron: boolean }[] = [
  { test: (f) => f.startsWith('scan_'), name: 'External Scan', cron: true },
  { test: (f) => f.startsWith('pipeline_') || f === 'signal_analysis' || f === 'draft_dedupe', name: 'Discovery Pipeline', cron: true },
  { test: (f) => f.startsWith('intel_'), name: 'Intel Desk', cron: true },
  { test: (f) => f.startsWith('research_'), name: 'Research Portal', cron: false },
  { test: (f) => f.startsWith('scout_'), name: 'Startup Scout', cron: false },
  { test: (f) => f.startsWith('portal_'), name: 'Team Portal', cron: false },
  { test: (f) => f === 'ask' || f.startsWith('ask_'), name: 'Ask', cron: false },
  { test: (f) => f.startsWith('report_') || f.startsWith('tearsheet_') || f.startsWith('thesis_'), name: 'Reports & Theses', cron: false },
];
const CATCH_ALL_SUBSYSTEM = { name: 'Atlas core', cron: false };

function subsystemFor(feature: string): { name: string; cron: boolean } {
  const rule = SUBSYSTEM_RULES.find((r) => r.test(feature));
  return rule ? { name: rule.name, cron: rule.cron } : CATCH_ALL_SUBSYSTEM;
}

// One query over ai_cost_log grouped by feature (month-to-date cost + calls, today's cost,
// all-time cost), then rolled into subsystems in JS. Powers the /costs page's monthly-bill
// header, alongside the FIXED_MONTHLY const the page renders it beside.
export async function getMonthlyBill(): Promise<MonthlyBill> {
  const rows = await q<{ feature: string; mtdCalls: number; mtdUsd: number; todayUsd: number; allTimeUsd: number }>(
    `select feature,
            count(*) filter (where created_at >= date_trunc('month', now()))::int as "mtdCalls",
            coalesce(sum(cost_usd) filter (where created_at >= date_trunc('month', now())), 0) as "mtdUsd",
            coalesce(sum(cost_usd) filter (where created_at >= date_trunc('day', now())), 0) as "todayUsd",
            coalesce(sum(cost_usd), 0) as "allTimeUsd"
       from ai_cost_log
      group by feature`
  );

  const bySubsystem = new Map<string, SubsystemCost>();
  for (const r of rows) {
    const { name, cron } = subsystemFor(r.feature);
    const cur = bySubsystem.get(name) ?? { name, cron, mtdUsd: 0, todayUsd: 0, calls: 0, allTimeUsd: 0 };
    cur.mtdUsd += r.mtdUsd;
    cur.todayUsd += r.todayUsd;
    cur.calls += r.mtdCalls;
    cur.allTimeUsd += r.allTimeUsd;
    bySubsystem.set(name, cur);
  }
  const subsystems = [...bySubsystem.values()].sort((a, b) => b.mtdUsd - a.mtdUsd);

  const mtdUsd = subsystems.reduce((s, x) => s + x.mtdUsd, 0);
  const todayUsd = subsystems.reduce((s, x) => s + x.todayUsd, 0);
  const allTimeUsd = subsystems.reduce((s, x) => s + x.allTimeUsd, 0);
  const mtdCalls = subsystems.reduce((s, x) => s + x.calls, 0);

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedUsd = dayOfMonth > 0 ? (mtdUsd / dayOfMonth) * daysInMonth : mtdUsd;

  return { mtdUsd, todayUsd, allTimeUsd, mtdCalls, projectedUsd, subsystems };
}
