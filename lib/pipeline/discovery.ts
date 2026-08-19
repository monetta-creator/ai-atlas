import { searchCandidates, searchBreakingSweep } from './web';
import {
  lensBatches, resolveDateTokens, ALL_LENSES, DAILY_LENSES, MAX_SEARCH_USES,
  LOW_QUALITY_DOMAINS, SWEEP_QUERIES, BREAKING_SWEEP_DOMAINS,
} from './config';
import * as m from '../mutations';
import { getZeroYieldDomains } from '../data';
import type { SignalLens, RunCadence } from '../types';

// One unit of discovery: a single lens's query batch (≤3 searches ≈ 45s, under the
// Hobby 60s cap). Pure + idempotent (unique(run_id,url) dedups), so the admin
// orchestrator — or a future cron — can drive it batch by batch and safely retry.
export interface DiscoveryBatchRef {
  lens: SignalLens;
  batchIndex: number;
}

// The ordered list of batches a run will execute, derived from its cadence.
// Daily sweeps only the high-cadence lenses; weekly/manual sweep all six.
export function discoveryPlan(cadence: RunCadence): DiscoveryBatchRef[] {
  const lenses = cadence === 'daily' ? DAILY_LENSES : ALL_LENSES;
  const plan: DiscoveryBatchRef[] = [];
  for (const lens of lenses) {
    lensBatches(lens).forEach((_, batchIndex) => plan.push({ lens, batchIndex }));
  }
  return plan;
}

export async function discoverBatch(
  runId: string,
  lens: SignalLens,
  batchIndex: number,
  sinceISO: string
): Promise<number> {
  const queries = lensBatches(lens, sinceISO)[batchIndex];
  if (!queries || !queries.length) return 0;
  // Curated deny-list + domains the funnel has learned never yield (decided candidates
  // only, so this run can't bias against its own pending discoveries). Filtered at the
  // search itself: junk stops costing triage tokens AND its result slots go to real items.
  const learned = await getZeroYieldDomains().catch(() => [] as string[]);
  const blockedDomains = Array.from(new Set([...LOW_QUALITY_DOMAINS, ...learned]));
  const candidates = await searchCandidates({
    lens, queries, sinceISO, maxUses: MAX_SEARCH_USES, pipelineRunId: runId, blockedDomains,
  });
  const inserted = await m.insertCandidates(runId, lens, candidates, queries);
  await m.recomputeRunCounts(runId);
  return inserted;
}

// The breaking-events sweep: one extra, lens-agnostic discovery unit per run that asks
// "what did the serious press report since the window opened" over a curated
// quality-outlet allowlist, significance-first. The model assigns each development the
// lens it best fits; candidates enter the same triage funnel as every other discovery
// (unique(run_id,url) dedups against the lens batches). Idempotent and retryable like
// discoverBatch — its own invocation, driven by the console after the lens batches.
export async function discoverBreakingSweep(runId: string, sinceISO: string): Promise<number> {
  const queries = resolveDateTokens(SWEEP_QUERIES, sinceISO);
  const found = await searchBreakingSweep({
    queries, sinceISO, allowedDomains: BREAKING_SWEEP_DOMAINS,
    maxUses: MAX_SEARCH_USES, pipelineRunId: runId,
  });
  let inserted = 0;
  for (const lens of ALL_LENSES) {
    const group = found.filter((c) => c.lens === lens);
    if (group.length) inserted += await m.insertCandidates(runId, lens, group, queries);
  }
  await m.recomputeRunCounts(runId);
  return inserted;
}
