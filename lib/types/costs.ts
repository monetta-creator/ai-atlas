// ---- AI cost monitoring (migration 0014) -----------------------------------
// A pricing card for one model, effective from `effective_date` forward. Rates are USD
// per MILLION tokens; the cache_write rate is the 5-min-TTL write price (the app uses
// ephemeral cache_control). Append-only — a price change is a new card, never an edit.
export interface RateCard {
  id: string;
  model: string;
  effective_date: string;        // 'YYYY-MM-DD'
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok: number;
  cache_read_per_mtok: number;
  context_window: number;        // total context tokens (drives utilization %)
  created_at: string;            // ISO
}

// One logged Anthropic call. cost_usd is FROZEN at write time (priced from the then-active
// card; never recomputed). context_pct = (input + cache read + cache write) / context window.
export interface CostLogRow {
  id: string;
  created_at: string;            // ISO
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  wall_ms: number;
  context_pct: number | null;
  cost_usd: number;
  pipeline_run_id: string | null;
}

export interface CostSummary {
  calls: number;
  total: number;                 // all-time spend (USD)
  d30: number;                   // spend, last 30 days
  d7: number;                    // spend, last 7 days
  calls30: number;
  calls7: number;
  avgCost: number;               // mean cost per call, all-time
}

// One day on the daily-spend chart. Always present (zero-filled), with the trailing
// 7- and 30-day rolling means (computed in code over a 60-day fetch window).
export interface DailyCostPoint {
  day: string;                   // 'YYYY-MM-DD'
  cost: number;
  calls: number;
  avg7: number;                  // trailing 7-day mean daily spend
  avg30: number;                 // trailing 30-day mean daily spend
}

// Per-feature rollup with cost percentiles (p50/p90/p99) over that feature's calls.
export interface FeatureCost {
  feature: string;
  calls: number;
  totalCost: number;
  avgTokens: number;             // mean total tokens (input+output+cache) per call
  avgInput: number;
  avgOutput: number;
  avgContextPct: number;         // mean context-window utilization %
  p50: number;
  p90: number;
  p99: number;
}

// Per-pipeline-run cost rollup (the last 20 runs).
export interface RunCost {
  id: string;
  triggered_at: string;          // ISO
  cadence: string;
  status: string;
  calls: number;
  cost: number;
  tokens: number;                // total tokens across the run's calls
}

export interface CostDashboard {
  summary: CostSummary;
  daily: DailyCostPoint[];          // last 30 days, oldest → newest
  features: FeatureCost[];          // highest spend first
  runs: RunCost[];                  // last 20 pipeline runs, newest first
  recent: CostLogRow[];             // last 100 calls, newest first
  activeRateCards: RateCard[];      // the currently-active card per model
  rateCardHistory: RateCard[];      // every card, model then effective_date desc
}

// ---- Monthly bill (/costs "showpiece" header) ------------------------------
// One subsystem's metered rollup, features already merged by the SUBSYSTEMS map in
// lib/data/costs.ts (first-match prefix, catch-all 'Atlas core').
export interface SubsystemCost {
  name: string;
  cron: boolean;      // true for External Scan, Discovery Pipeline, Intel Desk
  mtdUsd: number;      // month-to-date spend (created_at >= date_trunc('month', now()))
  todayUsd: number;    // today's spend (created_at >= date_trunc('day', now()))
  calls: number;       // month-to-date call count
  allTimeUsd: number;
}

export interface MonthlyBill {
  mtdUsd: number;
  todayUsd: number;
  allTimeUsd: number;
  mtdCalls: number;
  projectedUsd: number;              // mtd / dayOfMonth * daysInMonth
  subsystems: SubsystemCost[];       // sorted mtdUsd desc
}
