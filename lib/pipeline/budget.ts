import { one } from '../db';

// The pipeline's daily model-spend cap (the scan's checkScanBudget pattern):
// sums today's four pipeline_* features from ai_cost_log against
// PIPELINE_DAILY_BUDGET_USD (default 1.00, UTC midnight reset). The cron
// engine checks it before each billable unit; past the cap the run fails
// with a resume-tomorrow note rather than spending on. Tavily rows cost 0,
// so a fully cheap-provider day barely registers.
const FEATURES = ['pipeline_discovery', 'pipeline_triage', 'pipeline_analysis', 'pipeline_coverage'];

export async function checkPipelineBudget(): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = Math.max(0.05, Number(process.env.PIPELINE_DAILY_BUDGET_USD || 1.0));
  const row = await one<{ usd: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
      where feature = any($1::text[]) and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [FEATURES]
  );
  const spentUsd = row?.usd ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}
