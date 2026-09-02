import { searchCandidates, searchBreakingSweep } from './web';
import { searchCandidatesTavily, searchBreakingSweepGdelt, searchBreakingSweepTavily } from './search';
import { gdeltAvailable } from '../scan/search-gdelt';
import {
  lensBatches, dailyLensQueries, resolveDateTokens, ALL_LENSES, MAX_SEARCH_USES,
  LOW_QUALITY_DOMAINS, SWEEP_QUERIES, BREAKING_SWEEP_DOMAINS,
} from './config';
import * as m from '../mutations';
import { getRun, getPipelinePrefs, getZeroYieldDomains } from '../data';
import type { SignalLens, RunCadence } from '../types';

// One unit of discovery: a single lens's query batch. Pure + idempotent
// (unique(run_id,url) dedups), so the console orchestrator or the cron engine
// can drive it batch by batch and safely retry. Provider: Tavily's LLM-free
// news search when TAVILY_API_KEY is set (seconds per batch), else the
// original Sonnet + web_search call.
export interface DiscoveryBatchRef {
  lens: SignalLens;
  batchIndex: number;
}

// The ordered list of batches a run will execute, derived from its cadence.
// 2.0: daily sweeps ALL six lenses, one batch each of that day's ROTATED
// query pair (full per-lens coverage every ~3 days); weekly/manual runs the
// full batched query set.
export function discoveryPlan(cadence: RunCadence): DiscoveryBatchRef[] {
  if (cadence === 'daily') return ALL_LENSES.map((lens) => ({ lens, batchIndex: 0 }));
  const plan: DiscoveryBatchRef[] = [];
  for (const lens of ALL_LENSES) {
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
  // Daily runs rotate; the cadence comes from the run row so the console and
  // the cron engine resolve identical queries for the same run.
  const run = await getRun(runId);
  const daily = run?.cadence === 'daily';
  const queries = daily
    ? batchIndex === 0 ? dailyLensQueries(lens, sinceISO) : []
    : lensBatches(lens, sinceISO)[batchIndex];
  if (!queries || !queries.length) return 0;

  let candidates;
  if (process.env.TAVILY_API_KEY) {
    candidates = await searchCandidatesTavily({ lens, queries, sinceISO, pipelineRunId: runId });
  } else {
    // Curated deny-list + domains the funnel has learned never yield (decided candidates
    // only, so this run can't bias against its own pending discoveries). Filtered at the
    // search itself: junk stops costing triage tokens AND its result slots go to real items.
    const learned = await getZeroYieldDomains().catch(() => [] as string[]);
    const blockedDomains = Array.from(new Set([...LOW_QUALITY_DOMAINS, ...learned]));
    candidates = await searchCandidates({
      lens, queries, sinceISO, maxUses: MAX_SEARCH_USES, pipelineRunId: runId, blockedDomains,
    });
  }
  const inserted = await m.insertCandidates(runId, lens, candidates, queries);
  await m.recomputeRunCounts(runId);
  return inserted;
}

// The breaking-events sweep: one extra, lens-agnostic discovery unit per run that asks
// "what did the serious press report since the window opened" over a curated
// quality-outlet allowlist, significance-first. 2.0: GDELT (keyless, free) fetches the
// outlets' headlines and a cheap utility model does the significance + lens judgment
// (lib/pipeline/search.ts). GDELT has proven unreliable in production (2026-09-02), so
// the call is guarded by its circuit breaker (gdeltAvailable, lib/scan/search-gdelt) and
// falls back to the Tavily version of the same recipe when TAVILY_API_KEY is set; with
// neither a working GDELT nor a Tavily key, the error rethrows (this function has no
// notes array of its own; the caller in engine.ts logs "discovery failed (sweep)"). The
// Sonnet web_search call remains the fallback for the no-OPENROUTER_API_KEY case (the
// judgment call's requirement; GDELT and Tavily themselves need no key for this leg).
// Candidates enter the same triage funnel as every other discovery.
export async function discoverBreakingSweep(runId: string, sinceISO: string): Promise<number> {
  const queries = resolveDateTokens(SWEEP_QUERIES, sinceISO);
  let found;
  if (process.env.OPENROUTER_API_KEY) {
    const prefs = await getPipelinePrefs();
    try {
      if (!gdeltAvailable()) throw new Error('gdelt circuit open');
      found = await searchBreakingSweepGdelt({
        queries, sinceISO, pipelineRunId: runId, utilityModel: prefs.utility_model,
      });
    } catch (e) {
      if (!process.env.TAVILY_API_KEY) throw e;
      found = await searchBreakingSweepTavily({
        queries, sinceISO, pipelineRunId: runId, utilityModel: prefs.utility_model,
      });
    }
  } else {
    found = await searchBreakingSweep({
      queries, sinceISO, allowedDomains: BREAKING_SWEEP_DOMAINS,
      maxUses: MAX_SEARCH_USES, pipelineRunId: runId,
    });
  }
  let inserted = 0;
  for (const lens of ALL_LENSES) {
    const group = found.filter((c) => c.lens === lens);
    if (group.length) inserted += await m.insertCandidates(runId, lens, group, queries);
  }
  await m.recomputeRunCounts(runId);
  return inserted;
}
