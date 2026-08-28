'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, UUID_RE } from './shared';
import { getOrCreateTodayRun, claimScanRun, advanceScanRun } from '../scan/run';
import { setScanTopicActive, setScanEnabled, failScanRun } from '../mutations/scan';
import { getScanRun } from '../data/scan';
import type { ScanProgress } from '../types';

// External Scan actions (admin). The cron route is the scheduled driver; these
// back the /scan console's manual Run/Resume. Failures return as DATA (never
// thrown): production server actions redact thrown messages, and the console
// needs the real note to log.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

export async function startOrResumeScanAction(): Promise<{ runId: string; day: string }> {
  await requireAdmin();
  const { runId, day } = await getOrCreateTodayRun();
  return { runId, day };
}

// One console tick: at most one substantial work unit (the 5s chaining window
// lets instant step transitions ride along), so the longest unit (a 50s-bounded
// search call) still fits the page's 60s action budget.
export async function scanTickAction(
  runId: string
): Promise<(ScanProgress & { busy?: boolean; error?: string }) | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) return { error: 'Bad run id.' };
  const run = await getScanRun(runId);
  if (!run) return { error: 'Run not found.' };
  if (!(await claimScanRun(runId))) {
    return {
      runId, day: run.day, step: run.step, done: run.status === 'completed',
      counters: {
        feedItems: run.feed_item_count, searchItems: run.search_item_count,
        hydrated: run.hydrated_count, enriched: run.enriched_count, skipped: run.skipped_count,
      },
      notes: [], busy: true,
    };
  }
  try {
    const progress = await advanceScanRun(runId, Date.now() + 5_000);
    revalidatePath('/scan');
    return progress;
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'scan error');
    await failScanRun(runId, msg).catch(() => {});
    return { error: msg };
  }
}

export async function setScanTopicActiveAction(slug: string, active: boolean): Promise<void> {
  await requireAdmin();
  if (!SLUG_RE.test(slug)) throw new Error('Bad topic slug.');
  await setScanTopicActive(slug, Boolean(active));
  revalidatePath('/scan');
}

export async function setScanEnabledAction(enabled: boolean): Promise<void> {
  await requireAdmin();
  await setScanEnabled(Boolean(enabled));
  revalidatePath('/scan');
}
