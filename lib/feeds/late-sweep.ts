// The late feed sweep (weekdays 20:30 UTC, app/api/cron/feeds/route.ts): a
// second, feeds-only pass over the scan and intel engines' RSS/Atom sources,
// run after their morning windows have already completed for the day. No
// Tavily, no new tables: it reopens TODAY's completed scan_runs/intel_runs
// row at step 'feeds' (reopenScanRunForSweep/reopenIntelRunForSweep in
// lib/mutations/{scan,intel}.ts) and lets the engine's own step machine
// (advanceScanRun/advanceIntelRun) re-pull feeds and hydrate + enrich
// whatever is new, under the same daily budget. Items it inserts sit in
// scan_items/intel_items for the next morning's Daily Edition window.
//
// Deliberately does NOT create a run: a weekday with no morning run yet (the
// engine disabled, or the morning crons never fired) is left as a `no_run`
// result for the agent's findings to surface, not silently started here.
import { getScanRunByDay, getScanPrefs } from '../data/scan';
import { getIntelRunByDay, getIntelPrefs } from '../data/intel';
import {
  reopenScanRunForSweep, claimScanRun, releaseScanLease, appendScanRunNotes, completeScanRun,
} from '../mutations/scan';
import {
  reopenIntelRunForSweep, claimIntelRun, releaseIntelLease, appendIntelRunNotes, completeIntelRun,
} from '../mutations/intel';
import { advanceScanRun, todayUTC } from '../scan/run';
import { advanceIntelRun } from '../intel/engine';
import { one } from '../db';
import { splitDeadline, sweepNote } from './late-sweep-core';
import type { ScanProgress } from '../types/scan';
import type { IntelProgress } from '../types/intel';

export interface SweepResult {
  runId: string | null;
  status: 'swept' | 'no_run' | 'busy' | 'skipped' | 'error';
  newItems: number;
  progress?: unknown;
  note?: string;
}

async function countScanItems(runId: string): Promise<number> {
  const row = await one<{ n: number }>(`select count(*)::int as n from scan_items where run_id = $1`, [runId]);
  return row?.n ?? 0;
}

async function countIntelItems(runId: string): Promise<number> {
  const row = await one<{ n: number }>(`select count(*)::int as n from intel_items where run_id = $1`, [runId]);
  return row?.n ?? 0;
}

async function sweepScan(day: string, deadlineAt: number): Promise<SweepResult> {
  const prefs = await getScanPrefs();
  if (!prefs.enabled) {
    return { runId: null, status: 'skipped', newItems: 0, note: 'scan is paused (scan_prefs.enabled = false)' };
  }

  const run = await getScanRunByDay(day);
  if (!run) return { runId: null, status: 'no_run', newItems: 0, note: 'no scan run for today yet' };
  // A 'running' row with a live lease is a window in progress: skip. One
  // whose lease expired is a sweep or window that died mid-flight (a dev
  // server restart, a killed function): resume it without reopening.
  const stale = run.status === 'running' && (await leaseExpired('scan_runs', run.id));
  if (run.status === 'running' && !stale) {
    return { runId: run.id, status: 'busy', newItems: 0, note: 'a scan window is already in progress' };
  }
  if (run.status !== 'completed' && !stale) {
    // A 'failed' row is left for claimScanRun's own resume path (the morning
    // cron); the late sweep only ever reopens a clean completed run.
    return {
      runId: run.id, status: 'error', newItems: 0,
      note: `scan run is ${run.status}, not completed: left for the morning resume`,
    };
  }

  const reopened = stale ? true : await reopenScanRunForSweep(run.id);
  if (!reopened) return { runId: run.id, status: 'busy', newItems: 0, note: 'could not reopen: lease held or run moved' };
  const claimed = await claimScanRun(run.id);
  if (!claimed) return { runId: run.id, status: 'busy', newItems: 0, note: 'could not claim lease after reopen' };

  try {
    const before = await countScanItems(run.id);
    const progress: ScanProgress = await advanceScanRun(run.id, deadlineAt);
    const after = await countScanItems(run.id);
    const newItems = after - before;
    // The sweep is bonus work on an already-completed day: never leave the
    // row running (the morning janitor would stamp it failed as stale).
    // Whatever the deadline cut off stays pending on its rows, harmlessly.
    const note = progress.done ? sweepNote(newItems) : `late feed sweep ran out of time; ${newItems} new items, some left unenriched`;
    await appendScanRunNotes(run.id, [note]);
    if (!progress.done) await completeScanRun(run.id).catch(() => {});
    // advanceScanRun already releases its own lease in its finally block;
    // this is a defensive no-op that keeps the contract explicit here too.
    await releaseScanLease(run.id).catch(() => {});
    return { runId: run.id, status: 'swept', newItems, progress, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'late sweep error';
    await appendScanRunNotes(run.id, [`late feed sweep failed: ${message}`]).catch(() => {});
    await releaseScanLease(run.id).catch(() => {});
    return { runId: run.id, status: 'error', newItems: 0, note: message };
  }
}

// The run reads do not carry lease_until; ask the row directly.
async function leaseExpired(table: 'scan_runs' | 'intel_runs', runId: string): Promise<boolean> {
  const row = await one<{ lease_until: string | null }>(
    `select lease_until::text as lease_until from ${table} where id = $1`,
    [runId]
  );
  if (!row?.lease_until) return true;
  const t = new Date(row.lease_until).getTime();
  return !Number.isFinite(t) || t < Date.now();
}

async function sweepIntel(day: string, deadlineAt: number): Promise<SweepResult> {
  const prefs = await getIntelPrefs();
  if (!prefs.enabled) {
    return { runId: null, status: 'skipped', newItems: 0, note: 'intel is paused (intel_prefs.enabled = false)' };
  }

  const run = await getIntelRunByDay(day);
  if (!run) return { runId: null, status: 'no_run', newItems: 0, note: 'no intel run for today yet' };
  // A 'running' row with a live lease is a window in progress: skip. One
  // whose lease expired is a sweep or window that died mid-flight (a dev
  // server restart, a killed function): resume it without reopening.
  const stale = run.status === 'running' && (await leaseExpired('intel_runs', run.id));
  if (run.status === 'running' && !stale) {
    return { runId: run.id, status: 'busy', newItems: 0, note: 'an intel window is already in progress' };
  }
  if (run.status !== 'completed' && !stale) {
    // A 'failed' row is left for claimIntelRun's own resume path (the
    // morning cron); the late sweep only ever reopens a clean completed run.
    return {
      runId: run.id, status: 'error', newItems: 0,
      note: `intel run is ${run.status}, not completed: left for the morning resume`,
    };
  }

  const reopened = stale ? true : await reopenIntelRunForSweep(run.id);
  if (!reopened) return { runId: run.id, status: 'busy', newItems: 0, note: 'could not reopen: lease held or run moved' };
  const claimed = await claimIntelRun(run.id);
  if (!claimed) return { runId: run.id, status: 'busy', newItems: 0, note: 'could not claim lease after reopen' };

  try {
    const before = await countIntelItems(run.id);
    const progress: IntelProgress = await advanceIntelRun(run.id, deadlineAt);
    const after = await countIntelItems(run.id);
    const newItems = after - before;
    const note = progress.done ? sweepNote(newItems) : `late feed sweep ran out of time; ${newItems} new items, some left unenriched`;
    await appendIntelRunNotes(run.id, [note]);
    if (!progress.done) await completeIntelRun(run.id).catch(() => {});
    // advanceIntelRun already releases its own lease in its finally block;
    // this is a defensive no-op that keeps the contract explicit here too.
    await releaseIntelLease(run.id).catch(() => {});
    return { runId: run.id, status: 'swept', newItems, progress, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'late sweep error';
    await appendIntelRunNotes(run.id, [`late feed sweep failed: ${message}`]).catch(() => {});
    await releaseIntelLease(run.id).catch(() => {});
    return { runId: run.id, status: 'error', newItems: 0, note: message };
  }
}

// One invocation: scan first (45% of the window), then intel with whatever
// remains up to the overall deadline. Never throws: each engine's failure is
// captured as its own SweepResult so one engine's error never blocks the
// other's sweep.
export async function runLateFeedSweep(
  opts: { deadlineAt: number; day?: string }
): Promise<{ day: string; scan: SweepResult; intel: SweepResult }> {
  const day = opts.day ?? todayUTC();
  const { scanDeadline, intelDeadline } = splitDeadline(Date.now(), opts.deadlineAt);

  let scan: SweepResult;
  try {
    scan = await sweepScan(day, scanDeadline);
  } catch (e) {
    scan = { runId: null, status: 'error', newItems: 0, note: e instanceof Error ? e.message : 'scan sweep error' };
  }

  let intel: SweepResult;
  try {
    intel = await sweepIntel(day, intelDeadline);
  } catch (e) {
    intel = { runId: null, status: 'error', newItems: 0, note: e instanceof Error ? e.message : 'intel sweep error' };
  }

  return { day, scan, intel };
}
