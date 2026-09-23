import type { NextRequest } from 'next/server';
import { runLateFeedSweep } from '@/lib/feeds/late-sweep';

// The late feed sweep's cron driver: weekdays 20:30 UTC (vercel.json), well
// after the last morning window for scan/intel. Single-shot like the edition
// and roundup crons: one call reopens today's completed scan_runs/intel_runs
// row at step 'feeds', re-pulls the RSS/Atom feeds (no Tavily), and lets the
// engine hydrate + enrich whatever is new under its existing daily budget.
// Same gate as every cron route: Bearer CRON_SECRET, failing closed when
// unset; covered by proxy.ts's `/api/cron/` prefix allow-list.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORK_BUDGET_MS = 270_000;

// Optional healthchecks.io-style dead-man ping (the scan/pipeline/intel/
// research/edition convention): fire-and-forget, fired only when both
// engines finished in a clean state (swept, no morning run yet, or paused),
// never when either came back busy or errored.
function pingDeadman(url: string | undefined): void {
  if (url) fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => {});
}

const CLEAN_STATUSES = new Set(['swept', 'no_run', 'skipped']);

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  // ?day=YYYY-MM-DD targets a specific day's run: backfills and the
  // maintainer's manual runs. Defaults to today's UTC day.
  const rawDay = req.nextUrl.searchParams.get('day');
  const dayParam = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined;
  try {
    const result = await runLateFeedSweep({ deadlineAt: Date.now() + WORK_BUDGET_MS, day: dayParam });
    if (CLEAN_STATUSES.has(result.scan.status) && CLEAN_STATUSES.has(result.intel.status)) {
      pingDeadman(process.env.HC_PING_URL_FEEDS);
    }
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'late feed sweep error' });
  }
}
