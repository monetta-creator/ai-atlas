import type { NextRequest } from 'next/server';
import { getOrCreateTodayRun, claimScanRun, advanceScanRun } from '@/lib/scan/run';
import { getScanRun } from '@/lib/data/scan';
import { failScanRun } from '@/lib/mutations/scan';

// The daily External Scan driver: GET /api/cron/scan, invoked by the two
// vercel.json crons (the second is the sweeper that finishes what the first
// invocation's 270s could not) and by curl for local end-to-end runs.
// Allow-listed in proxy.ts (the matcher does not exempt /api); the REAL gate
// is the Vercel cron convention below: the platform sends
// `Authorization: Bearer <CRON_SECRET>` on cron invocations, and the route
// fails closed when the env var is unset. Not the admin cookie: the console's
// server actions cover the human path.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Soft work budget under the 300s cap: the engine checks it between units, and
// the longest single unit (a 50s-bounded search call) still fits before 300.
const WORK_BUDGET_MS = 270_000;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { runId, day } = await getOrCreateTodayRun();
  const existing = await getScanRun(runId);
  if (existing?.status === 'completed') {
    return Response.json({ day, done: true, alreadyComplete: true });
  }
  if (!(await claimScanRun(runId))) {
    return Response.json({ day, done: false, busy: true });
  }
  try {
    const progress = await advanceScanRun(runId, Date.now() + WORK_BUDGET_MS);
    return Response.json(progress);
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'scan error');
    await failScanRun(runId, msg).catch(() => {});
    return Response.json({ day, done: false, error: msg }, { status: 500 });
  }
}
