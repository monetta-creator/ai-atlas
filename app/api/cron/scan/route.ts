import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { getOrCreateTodayRun, claimScanRun, advanceScanRun } from '@/lib/scan/run';
import { getScanRun, getScanPrefs } from '@/lib/data/scan';
import { failScanRun, reopenScanRunForSearch } from '@/lib/mutations/scan';
import { resetTavilyBreaker } from '@/lib/scan/search-tavily';

// The External Scan's cron driver: GET /api/cron/scan, invoked by the weekday
// vercel.json crons (the /sweep sibling is the second invocation that
// finishes what the first one's budget could not) and by curl for local
// end-to-end runs. Since the Vercel Pro upgrade (2026-08-30) each daily
// subsystem has its own cron route: this one is scan-only; the discovery
// pipeline drives from /api/cron/pipeline and the intel desk from
// /api/cron/intel. Allow-listed in proxy.ts (the matcher does not exempt
// /api); the REAL gate is the Vercel cron convention: the platform sends
// `Authorization: Bearer <CRON_SECRET>`, and the route fails closed when the
// env var is unset. Not the admin cookie: the console's server actions cover
// the human path.
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

// Soft work budget under the 800s cap (the Vercel Pro fluid ceiling; raised
// from 300/270 on 2026-08-31 after Monday's 3-day batch overran two windows
// and one unit straddled the 30s headroom into a gateway 504). The engine
// checks it between units; 100s of headroom covers the longest single unit
// (a 90s-bounded model call).
const WORK_BUDGET_MS = 700_000;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;

  if (!(await getScanPrefs()).enabled) {
    return Response.json({ done: true, skipped: 'scan paused (the /scan console toggle re-enables it)' });
  }
  const deadlineAt = Date.now() + WORK_BUDGET_MS;
  const { runId, day } = await getOrCreateTodayRun();
  let existing = await getScanRun(runId);
  // ?rerun=search reopens a completed run at the search step (the 2026-09-23
  // Tavily-quota day; see reopenScanRunForSearch). Bearer-gated like the rest.
  const rerun = req.nextUrl.searchParams.get('rerun');
  if (rerun === 'search' && existing?.status === 'completed') {
    resetTavilyBreaker(); // a warm instance may still hold a stale trip
    if (await reopenScanRunForSearch(runId)) existing = await getScanRun(runId);
  }
  // Dead-man ping: fired on every invocation that ends with the run
  // COMPLETED (fresh or alreadyComplete), never on busy/error/paused.
  if (existing?.status === 'completed') {
    pingDeadman(process.env.HC_PING_URL_SCAN);
    return Response.json({ day, done: true, alreadyComplete: true });
  }
  if (!(await claimScanRun(runId))) return Response.json({ day, done: false, busy: true });
  try {
    const progress = await advanceScanRun(runId, deadlineAt);
    if (progress.done) pingDeadman(process.env.HC_PING_URL_SCAN);
    return Response.json(progress);
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'scan error');
    await failScanRun(runId, msg).catch(() => {});
    return Response.json({ day, done: false, error: msg });
  }
}
