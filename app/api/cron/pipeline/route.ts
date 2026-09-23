import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { getOrCreateDailyRun, advancePipelineRun } from '@/lib/pipeline/engine';
import { getRun, getPipelinePrefs } from '@/lib/data';
import { claimPipelineRun, updateRun, reopenPipelineRunForDiscovery } from '@/lib/mutations/pipeline';
import { publishDueDrafts } from '@/lib/mutations/signals';
import { resetTavilyBreaker } from '@/lib/scan/search-tavily';

// The discovery pipeline's cron driver (lifted out of the shared
// /api/cron/scan route when the Vercel Pro upgrade lifted the two-cron cap,
// 2026-08-30). Same gate as every cron route: Bearer CRON_SECRET, failing
// closed when unset; allow-listed in proxy.ts. The /sweep sibling is the
// second daily invocation that resumes whatever this one's budget could not
// finish.
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const WORK_BUDGET_MS = 700_000;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;

  const prefs = await getPipelinePrefs();

  // The promotion sweep (0055): high-significance pipeline drafts with a claim
  // touch, past the veto window, publish here on every weekday window. Cheap
  // SQL plus the same evidence sync a human publish runs; independent of the
  // day's discovery run, so it happens even when that run is already complete.
  let promoted = 0;
  if (prefs.auto_publish_high) {
    try {
      promoted = (await publishDueDrafts({ afterHours: prefs.auto_publish_after_hours, from: prefs.auto_publish_from })).length;
    } catch (e) {
      console.error('[cron/pipeline] promotion sweep failed', e);
    }
  }

  if (!prefs.enabled) {
    return Response.json({ done: true, promoted, skipped: 'pipeline paused (the /pipeline toggle re-enables it)' });
  }
  const deadlineAt = Date.now() + WORK_BUDGET_MS;
  const { runId } = await getOrCreateDailyRun();
  let run = await getRun(runId);
  // ?rerun=discovery reopens a completed run at discovery (see
  // reopenPipelineRunForDiscovery). Bearer-gated like the rest.
  const rerun = req.nextUrl.searchParams.get('rerun');
  if (rerun === 'discovery' && run?.status === 'completed') {
    resetTavilyBreaker(); // a warm instance may still hold a stale trip
    if (await reopenPipelineRunForDiscovery(runId)) run = await getRun(runId);
  }
  // Dead-man ping: fired on every invocation that ends with the run
  // COMPLETED (fresh or alreadyComplete), never on busy/error/paused.
  if (run?.status === 'completed') {
    pingDeadman(process.env.HC_PING_URL_PIPELINE);
    return Response.json({ runId, done: true, alreadyComplete: true, promoted });
  }
  if (!(await claimPipelineRun(runId))) return Response.json({ runId, done: false, busy: true });
  try {
    const progress = await advancePipelineRun(runId, deadlineAt);
    if (progress.done) pingDeadman(process.env.HC_PING_URL_PIPELINE);
    return Response.json({ ...progress, promoted });
  } catch (e) {
    // Console semantics: a thrown step error (triage rethrows) fails the run
    // resumably; the next invocation or a console resume picks it back up.
    const msg = String((e as Error)?.message ?? 'pipeline error');
    await updateRun(runId, { status: 'failed', error: msg }).catch(() => {});
    return Response.json({ runId, done: false, error: msg });
  }
}
