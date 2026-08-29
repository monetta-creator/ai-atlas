import type { NextRequest } from 'next/server';
import { getOrCreateTodayRun, claimScanRun, advanceScanRun } from '@/lib/scan/run';
import { getScanRun, getScanPrefs } from '@/lib/data/scan';
import { failScanRun } from '@/lib/mutations/scan';
import { getOrCreateDailyRun, advancePipelineRun } from '@/lib/pipeline/engine';
import { getRun, getPipelinePrefs } from '@/lib/data';
import { claimPipelineRun, updateRun } from '@/lib/mutations/pipeline';

// The daily work driver: GET /api/cron/scan, invoked by the two weekday
// vercel.json crons (the second is the sweeper that finishes what the first
// invocation's budget could not) and by curl for local end-to-end runs.
// Hobby allows exactly two crons, so this one route drives BOTH daily jobs
// in sequence: the External Scan first, then the discovery pipeline's daily
// run (Pipeline 2.0 engine) with whatever budget remains. Each is
// independently toggleable (scan_prefs / pipeline_prefs) and independently
// resumable; the sweep invocation picks up whichever ran short.
// Allow-listed in proxy.ts (the matcher does not exempt /api); the REAL gate
// is the Vercel cron convention below: the platform sends
// `Authorization: Bearer <CRON_SECRET>` on cron invocations, and the route
// fails closed when the env var is unset. Not the admin cookie: the consoles'
// server actions cover the human path.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Soft work budget under the 300s cap: the engines check it between units, and
// the longest single unit (a 50s-bounded model call) still fits before 300.
const WORK_BUDGET_MS = 270_000;

interface LegReport {
  done?: boolean;
  skipped?: string;
  busy?: boolean;
  error?: string;
  notes?: string[];
  [k: string]: unknown;
}

async function runScanLeg(deadlineAt: number): Promise<LegReport> {
  if (!(await getScanPrefs()).enabled) {
    return { done: true, skipped: 'scan paused (the /scan console toggle re-enables it)' };
  }
  const { runId, day } = await getOrCreateTodayRun();
  const existing = await getScanRun(runId);
  if (existing?.status === 'completed') return { day, done: true, alreadyComplete: true };
  if (!(await claimScanRun(runId))) return { day, done: false, busy: true };
  try {
    const progress = await advanceScanRun(runId, deadlineAt);
    return progress as unknown as LegReport;
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'scan error');
    await failScanRun(runId, msg).catch(() => {});
    return { day, done: false, error: msg };
  }
}

async function runPipelineLeg(deadlineAt: number): Promise<LegReport> {
  if (!(await getPipelinePrefs()).enabled) {
    return { done: true, skipped: 'pipeline paused (the /pipeline toggle re-enables it)' };
  }
  const { runId } = await getOrCreateDailyRun();
  const run = await getRun(runId);
  if (run?.status === 'completed') return { runId, done: true, alreadyComplete: true };
  if (!(await claimPipelineRun(runId))) return { runId, done: false, busy: true };
  try {
    const progress = await advancePipelineRun(runId, deadlineAt);
    return progress as unknown as LegReport;
  } catch (e) {
    // Console semantics: a thrown step error (triage rethrows) fails the run
    // resumably; the next invocation or a console resume picks it back up.
    const msg = String((e as Error)?.message ?? 'pipeline error');
    await updateRun(runId, { status: 'failed', error: msg }).catch(() => {});
    return { runId, done: false, error: msg };
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const deadlineAt = Date.now() + WORK_BUDGET_MS;
  const scan = await runScanLeg(deadlineAt);
  // The pipeline leg only starts with real time left; otherwise the sweep
  // invocation (or tomorrow) gets it. 60s floors one meaningful unit.
  const pipeline =
    deadlineAt - Date.now() > 60_000
      ? await runPipelineLeg(deadlineAt)
      : { done: false, skipped: 'no budget left this invocation' };

  const done = scan.done !== false && pipeline.done !== false;
  return Response.json({ done, scan, pipeline });
}
