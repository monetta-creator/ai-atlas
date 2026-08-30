import type { NextRequest } from 'next/server';
import { getOrCreateDailyRun, advancePipelineRun } from '@/lib/pipeline/engine';
import { getRun, getPipelinePrefs } from '@/lib/data';
import { claimPipelineRun, updateRun } from '@/lib/mutations/pipeline';

// The discovery pipeline's cron driver (lifted out of the shared
// /api/cron/scan route when the Vercel Pro upgrade lifted the two-cron cap,
// 2026-08-30). Same gate as every cron route: Bearer CRON_SECRET, failing
// closed when unset; allow-listed in proxy.ts. The /sweep sibling is the
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

  if (!(await getPipelinePrefs()).enabled) {
    return Response.json({ done: true, skipped: 'pipeline paused (the /pipeline toggle re-enables it)' });
  }
  const deadlineAt = Date.now() + WORK_BUDGET_MS;
  const { runId } = await getOrCreateDailyRun();
  const run = await getRun(runId);
  if (run?.status === 'completed') return Response.json({ runId, done: true, alreadyComplete: true });
  if (!(await claimPipelineRun(runId))) return Response.json({ runId, done: false, busy: true });
  try {
    const progress = await advancePipelineRun(runId, deadlineAt);
    return Response.json(progress);
  } catch (e) {
    // Console semantics: a thrown step error (triage rethrows) fails the run
    // resumably; the next invocation or a console resume picks it back up.
    const msg = String((e as Error)?.message ?? 'pipeline error');
    await updateRun(runId, { status: 'failed', error: msg }).catch(() => {});
    return Response.json({ runId, done: false, error: msg });
  }
}
