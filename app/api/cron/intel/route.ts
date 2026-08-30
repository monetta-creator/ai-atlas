import type { NextRequest } from 'next/server';
import { getOrCreateTodayIntelRun, claimIntelRun, advanceIntelRun } from '@/lib/intel/engine';
import { getIntelRun, getIntelPrefs } from '@/lib/data/intel';
import { failIntelRun } from '@/lib/mutations/intel';

// The intel desk's cron driver: one run per UTC weekday through the
// checkpointed engine (feeds, search, filings, hydrate, enrich). Same gate
// as every cron route: Bearer CRON_SECRET, failing closed when unset;
// allow-listed in proxy.ts. The /sweep sibling is the second daily
// invocation that resumes whatever this one's budget could not finish.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORK_BUDGET_MS = 270_000;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!(await getIntelPrefs()).enabled) {
    return Response.json({ done: true, skipped: 'intel paused (the /intel console toggle re-enables it)' });
  }
  const deadlineAt = Date.now() + WORK_BUDGET_MS;
  const { runId, day } = await getOrCreateTodayIntelRun();
  const existing = await getIntelRun(runId);
  if (existing?.status === 'completed') return Response.json({ day, done: true, alreadyComplete: true });
  if (!(await claimIntelRun(runId))) return Response.json({ day, done: false, busy: true });
  try {
    const progress = await advanceIntelRun(runId, deadlineAt);
    return Response.json(progress);
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'intel error');
    await failIntelRun(runId, msg).catch(() => {});
    return Response.json({ day, done: false, error: msg });
  }
}
