'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, UUID_RE } from './shared';
import { getOrCreateTodayIntelRun, claimIntelRun, advanceIntelRun } from '../intel/engine';
import { synthesizeCompanyDossier } from '../intel/synthesis';
import {
  setIntelCompanyActive, setIntelEnabled, setIntelEnrichModels, failIntelRun,
  promoteScoutCompanyToIntel,
} from '../mutations/intel';
import { getIntelRun, getIntelPrefs, getIntelCompanies } from '../data/intel';
import { isScanEnrichModel } from '../scan/models';
import type { IntelProgress } from '../types';

// Intel desk actions (admin). The cron route is the scheduled driver; these
// back the /intel console's manual Run/Resume, the registry toggles, and the
// dossier tools. Failures return as DATA (never thrown): production server
// actions redact thrown messages, and the console needs the real note.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

export async function startOrResumeIntelAction(): Promise<{ runId: string; day: string }> {
  await requireAdmin();
  const { runId, day } = await getOrCreateTodayIntelRun();
  return { runId, day };
}

// One console tick: at most one substantial work unit (the 5s chaining window
// lets instant step transitions ride along), fitting the page's 60s budget.
export async function intelTickAction(
  runId: string
): Promise<(IntelProgress & { busy?: boolean; error?: string }) | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) return { error: 'Bad run id.' };
  const run = await getIntelRun(runId);
  if (!run) return { error: 'Run not found.' };
  if (!(await claimIntelRun(runId))) {
    return {
      runId, day: run.day, step: run.step, done: run.status === 'completed',
      counters: {
        feedItems: run.feed_item_count, searchItems: run.search_item_count,
        filingItems: run.filing_item_count, hydrated: run.hydrated_count,
        enriched: run.enriched_count, skipped: run.skipped_count,
        facts: run.fact_count, metrics: run.metric_count,
      },
      notes: [], busy: true,
    };
  }
  try {
    const progress = await advanceIntelRun(runId, Date.now() + 5_000);
    revalidatePath('/intel');
    return progress;
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'intel error');
    await failIntelRun(runId, msg).catch(() => {});
    return { error: msg };
  }
}

export async function setIntelCompanyActiveAction(slug: string, active: boolean): Promise<void> {
  await requireAdmin();
  if (!SLUG_RE.test(slug)) throw new Error('Bad company slug.');
  await setIntelCompanyActive(slug, Boolean(active));
  revalidatePath('/intel');
}

export async function setIntelEnabledAction(enabled: boolean): Promise<void> {
  await requireAdmin();
  await setIntelEnabled(Boolean(enabled));
  revalidatePath('/intel');
}

// The enrichment model picker (shared registry with the scan). Ids
// allow-listed; empty selection = the Haiku fallback path.
export async function setIntelEnrichModelsAction(models: string[]): Promise<void> {
  await requireAdmin();
  const clean = [...new Set((models ?? []).map(String))].filter(isScanEnrichModel);
  if (clean.length > 8) throw new Error('Too many models selected.');
  await setIntelEnrichModels(clean);
  revalidatePath('/intel');
}

// On-demand dossier refresh for one company (the weekly synthesis phase
// covers the rest).
export async function synthesizeIntelDossierAction(
  slug: string
): Promise<{ updated: boolean; items: number; facts: number } | { error: string }> {
  await requireAdmin();
  if (!SLUG_RE.test(slug)) return { error: 'Bad company slug.' };
  const company = (await getIntelCompanies()).find((c) => c.slug === slug);
  if (!company) return { error: 'Company not found.' };
  try {
    const prefs = await getIntelPrefs();
    const result = await synthesizeCompanyDossier(company, undefined, prefs.utility_model);
    revalidatePath('/intel');
    return result;
  } catch (e) {
    return { error: String((e as Error)?.message ?? 'synthesis error') };
  }
}

// The Scout bridge: a tracked wildcard-niche discovery graduates into the
// intel registry.
export async function promoteScoutCompanyToIntelAction(
  companyId: string
): Promise<{ slug: string; created: boolean } | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(companyId)) return { error: 'Bad company id.' };
  try {
    const result = await promoteScoutCompanyToIntel(companyId);
    revalidatePath('/intel');
    revalidatePath('/scout');
    return result;
  } catch (e) {
    return { error: String((e as Error)?.message ?? 'promote error') };
  }
}
