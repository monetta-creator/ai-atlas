import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { runSavantIssue } from '@/lib/savant/issue';
import { weekEndFor } from '@/lib/savant/week';

// Savant's Friday issue: 20:00 UTC (vercel.json), with sweeps at 20:20 and
// 20:40 that call the same runner (app/api/cron/savant/issue/sweep*/route.ts):
// the run parks each finished leg in the notebook and a later call resumes,
// so three 300s calls finish an issue that needs six to nine minutes.
// ?week=YYYY-MM-DD (a Friday) backfills; ?force=1 rebuilds an existing issue.
// Same gate as every cron route: Bearer CRON_SECRET, failing closed when unset.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function handleIssueCron(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;
  const raw = req.nextUrl.searchParams.get('week');
  const weekEnd = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? weekEndFor(raw) : weekEndFor(new Date().toISOString().slice(0, 10));
  const force = req.nextUrl.searchParams.get('force') === '1';
  try {
    const result = await runSavantIssue(weekEnd, { deadlineMs: 270_000, force, origin: req.nextUrl.origin || process.env.APP_BASE_URL });
    if ('id' in result) pingDeadman(process.env.HC_PING_URL_SAVANT_ISSUE);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'savant issue error' });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handleIssueCron(req);
}
