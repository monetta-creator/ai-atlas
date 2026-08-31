import type { NextRequest } from 'next/server';
import { getOrCreateTodayRun, claimScanRun, advanceScanRun } from '@/lib/scan/run';
import { getScanRun, getScanPrefs } from '@/lib/data/scan';
import { failScanRun } from '@/lib/mutations/scan';

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
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!(await getScanPrefs()).enabled) {
    return Response.json({ done: true, skipped: 'scan paused (the /scan console toggle re-enables it)' });
  }
  const deadlineAt = Date.now() + WORK_BUDGET_MS;
  const { runId, day } = await getOrCreateTodayRun();
  const existing = await getScanRun(runId);
  if (existing?.status === 'completed') return Response.json({ day, done: true, alreadyComplete: true });
  if (!(await claimScanRun(runId))) return Response.json({ day, done: false, busy: true });
  try {
    const progress = await advanceScanRun(runId, deadlineAt);
    return Response.json(progress);
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'scan error');
    await failScanRun(runId, msg).catch(() => {});
    return Response.json({ day, done: false, error: msg });
  }
}
