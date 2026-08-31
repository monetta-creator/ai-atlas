import type { NextRequest } from 'next/server';
import { checkResearchBudget } from '@/lib/research/budget';
import { runWeeklyRoundup } from '@/lib/research/roundup';

// The weekly research roundup's cron driver: every Friday 21:00 UTC (vercel.json),
// one single-shot call, no lease/run table (unlike the day-keyed engines, this
// composes once a week and is naturally idempotent on scope_to). Same gate as
// every cron route: Bearer CRON_SECRET, failing closed when unset; covered by
// proxy.ts's `/api/cron/` prefix allow-list (no route-by-route entry needed).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const budget = await checkResearchBudget();
    if (!budget.ok) return Response.json({ skipped: 'research budget reached' });
    const result = await runWeeklyRoundup();
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'roundup error' });
  }
}
