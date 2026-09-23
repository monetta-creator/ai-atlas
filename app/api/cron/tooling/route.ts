import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { getOrCreateToolingRun, claimToolingRun, advanceToolingRun } from '@/lib/tooling/engine';
import { getToolingRun, getToolingPrefs, getLatestPullRun } from '@/lib/data/tooling';
import { failToolingRun } from '@/lib/mutations/tooling';

// The tooling monitor's cron driver: the weekly cadence run (default,
// Monday mornings, gated on tooling_prefs.enabled) through the checkpointed
// engine, OR (?kind=pull) an advance of whatever pull run the console
// started — there is no cron SCHEDULE for the pull; a curl loop against this
// query param is the documented way to drive it outside the console's tick
// loop. Same gate as every cron route: Bearer CRON_SECRET, failing closed
// when unset; allow-listed in proxy.ts. The /sweep and /sweep2 siblings are
// the second and third weekly invocations that resume whatever the first
// invocation's budget could not finish.
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const WORK_BUDGET_MS = 700_000;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;

  const deadlineAt = Date.now() + WORK_BUDGET_MS;

  if (req.nextUrl.searchParams.get('kind') === 'pull') {
    const pullRun = await getLatestPullRun();
    if (!pullRun) return Response.json({ done: false, error: 'no pull run to advance' });
    const existing = await getToolingRun(pullRun.id);
    if (existing?.status === 'completed') return Response.json({ done: true, alreadyComplete: true });
    if (!(await claimToolingRun(pullRun.id))) return Response.json({ done: false, busy: true });
    try {
      const progress = await advanceToolingRun(pullRun.id, deadlineAt);
      return Response.json(progress);
    } catch (e) {
      const msg = String((e as Error)?.message ?? 'tooling error');
      await failToolingRun(pullRun.id, msg).catch(() => {});
      return Response.json({ done: false, error: msg });
    }
  }

  if (!(await getToolingPrefs()).enabled) {
    return Response.json({ done: true, skipped: 'tooling paused (the /tooling/console toggle re-enables it)' });
  }
  const { runId, day } = await getOrCreateToolingRun('weekly');
  const existing = await getToolingRun(runId);
  // Dead-man ping: fired on every invocation that ends with the WEEKLY run
  // completed (fresh or alreadyComplete), never on busy/error/paused, and
  // never for the pull leg above (it has no schedule to miss).
  if (existing?.status === 'completed') {
    pingDeadman(process.env.HC_PING_URL_TOOLING);
    return Response.json({ day, done: true, alreadyComplete: true });
  }
  if (!(await claimToolingRun(runId))) return Response.json({ day, done: false, busy: true });
  try {
    const progress = await advanceToolingRun(runId, deadlineAt);
    if (progress.done) pingDeadman(process.env.HC_PING_URL_TOOLING);
    return Response.json(progress);
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'tooling error');
    await failToolingRun(runId, msg).catch(() => {});
    return Response.json({ day, done: false, error: msg });
  }
}
