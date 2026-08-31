import type { NextRequest } from 'next/server';
import { getOrCreateTodayResearchRun, claimResearchRun, advanceResearchRun } from '@/lib/research/engine';
import { getResearchRun, getResearchPrefs } from '@/lib/data/research';
import { failResearchRun } from '@/lib/mutations/research';

// The research engine's cron driver: one run per UTC weekday through the
// checkpointed engine (pull, triage, agent, analyze). Same gate as every cron
// route: Bearer CRON_SECRET, failing closed when unset; allow-listed in
// proxy.ts via the shared /api/cron/* prefix. The /sweep sibling is the
// second daily invocation that resumes whatever this one's budget could not
// finish.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORK_BUDGET_MS = 270_000;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!(await getResearchPrefs()).enabled) {
    return Response.json({ done: true, skipped: 'research paused (the /research/console toggle re-enables it)' });
  }
  const deadlineAt = Date.now() + WORK_BUDGET_MS;
  const { runId, day } = await getOrCreateTodayResearchRun();
  const existing = await getResearchRun(runId);
  if (existing?.status === 'completed') return Response.json({ day, done: true, alreadyComplete: true });
  if (!(await claimResearchRun(runId))) return Response.json({ day, done: false, busy: true });
  try {
    const progress = await advanceResearchRun(runId, deadlineAt);
    return Response.json(progress);
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'research error');
    await failResearchRun(runId, msg).catch(() => {});
    return Response.json({ day, done: false, error: msg });
  }
}
