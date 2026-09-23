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

export interface SweepResult {
  runId: string | null;
  status: 'swept' | 'no_run' | 'busy' | 'skipped' | 'error';
  newItems: number;
  progress?: unknown;
  note?: string;
}

// The two engines the sweep drives, as one table adapter each: the sweep
// body is engine-neutral, only the tables, prefs and step-machine entry
// points differ.
interface SweepEngine {
  label: 'scan' | 'intel';
  article: 'a' | 'an';
  runsTable: 'scan_runs' | 'intel_runs';
  itemsTable: 'scan_items' | 'intel_items';
  getPrefs: () => Promise<{ enabled: boolean }>;
  getRunByDay: (day: string) => Promise<{ id: string; status: string } | null>;
  reopen: (runId: string) => Promise<boolean>;
  claim: (runId: string) => Promise<boolean>;
  release: (runId: string) => Promise<void>;
  appendNotes: (runId: string, notes: string[]) => Promise<void>;
  complete: (runId: string) => Promise<void>;
  advance: (runId: string, deadlineAt: number) => Promise<{ done: boolean }>;
}

const SCAN: SweepEngine = {
  label: 'scan', article: 'a', runsTable: 'scan_runs', itemsTable: 'scan_items',
  getPrefs: getScanPrefs, getRunByDay: getScanRunByDay, reopen: reopenScanRunForSweep,
  claim: claimScanRun, release: releaseScanLease, appendNotes: appendScanRunNotes,
  complete: completeScanRun, advance: advanceScanRun,
};

const INTEL: SweepEngine = {
  label: 'intel', article: 'an', runsTable: 'intel_runs', itemsTable: 'intel_items',
  getPrefs: getIntelPrefs, getRunByDay: getIntelRunByDay, reopen: reopenIntelRunForSweep,
  claim: claimIntelRun, release: releaseIntelLease, appendNotes: appendIntelRunNotes,
  complete: completeIntelRun, advance: advanceIntelRun,
};

async function countItems(table: SweepEngine['itemsTable'], runId: string): Promise<number> {
  const row = await one<{ n: number }>(`select count(*)::int as n from ${table} where run_id = $1`, [runId]);
  return row?.n ?? 0;
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

async function sweepEngine(engine: SweepEngine, day: string, deadlineAt: number): Promise<SweepResult> {
  const prefs = await engine.getPrefs();
  if (!prefs.enabled) {
    return { runId: null, status: 'skipped', newItems: 0, note: `${engine.label} is paused (${engine.label}_prefs.enabled = false)` };
  }

  const run = await engine.getRunByDay(day);
  if (!run) return { runId: null, status: 'no_run', newItems: 0, note: `no ${engine.label} run for today yet` };
  // A 'running' row with a live lease is a window in progress: skip. One
  // whose lease expired is a sweep or window that died mid-flight (a dev
  // server restart, a killed function): resume it without reopening.
  const stale = run.status === 'running' && (await leaseExpired(engine.runsTable, run.id));
  if (run.status === 'running' && !stale) {
    return { runId: run.id, status: 'busy', newItems: 0, note: `${engine.article} ${engine.label} window is already in progress` };
  }
  if (run.status !== 'completed' && !stale) {
    // A 'failed' row is left for the engine's own claim/resume path (the
    // morning cron); the late sweep only ever reopens a clean completed run.
    return {
      runId: run.id, status: 'error', newItems: 0,
      note: `${engine.label} run is ${run.status}, not completed: left for the morning resume`,
    };
  }

  const reopened = stale ? true : await engine.reopen(run.id);
  if (!reopened) return { runId: run.id, status: 'busy', newItems: 0, note: 'could not reopen: lease held or run moved' };
  const claimed = await engine.claim(run.id);
  if (!claimed) return { runId: run.id, status: 'busy', newItems: 0, note: 'could not claim lease after reopen' };

  try {
    const before = await countItems(engine.itemsTable, run.id);
    const progress = await engine.advance(run.id, deadlineAt);
    const after = await countItems(engine.itemsTable, run.id);
    const newItems = after - before;
    // The sweep is bonus work on an already-completed day: never leave the
    // row running (the morning janitor would stamp it failed as stale).
    // Whatever the deadline cut off stays pending on its rows, harmlessly.
    const note = progress.done ? sweepNote(newItems) : `late feed sweep ran out of time; ${newItems} new items, some left unenriched`;
    await engine.appendNotes(run.id, [note]);
    if (!progress.done) await engine.complete(run.id).catch(() => {});
    // The engine's advance already releases its own lease in its finally
    // block; this is a defensive no-op that keeps the contract explicit here too.
    await engine.release(run.id).catch(() => {});
    return { runId: run.id, status: 'swept', newItems, progress, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'late sweep error';
    await engine.appendNotes(run.id, [`late feed sweep failed: ${message}`]).catch(() => {});
    await engine.release(run.id).catch(() => {});
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
    scan = await sweepEngine(SCAN, day, scanDeadline);
  } catch (e) {
    scan = { runId: null, status: 'error', newItems: 0, note: e instanceof Error ? e.message : 'scan sweep error' };
  }

  let intel: SweepResult;
  try {
    intel = await sweepEngine(INTEL, day, intelDeadline);
  } catch (e) {
    intel = { runId: null, status: 'error', newItems: 0, note: e instanceof Error ? e.message : 'intel sweep error' };
  }

  return { day, scan, intel };
}
