import { pullPage } from './pull';
import { triagePapersChunk } from './triage';
import { recommendQueueChunk } from './queue-agent';
import { hydratePaper, analyzePaper } from './analysis';
import { checkResearchBudget } from './budget';
import { lookbackDays } from '../scan/core';
import {
  getResearchRun, getUnrecommendedPaperIds, getNextAnalysisCandidate, countPendingPapers,
} from '../data/research';
import {
  createDayResearchRun, claimResearchRun, renewResearchLease, releaseResearchLease,
  appendResearchRunNotes, updateResearchRun, pruneRejectedPapers,
} from '../mutations/research';
import type { ResearchEngineRun, ResearchProgress } from '../types';

// The research library's checkpointed step engine (the intel/scan engine
// pattern), shared by the cron route and the console's tick action. Every
// unit persists to research_runs/papers before the next begins, so an
// invocation that runs out of time resumes exactly where it stopped. Steps in
// order: pull (arXiv, one page per unit, offset = the run's scanned_count),
// triage (metadata relevance filtering, the existing chunked shape), agent
// (the queue-agent recommendation pass over the pending review queue),
// analyze (per-paper hydrate + finding extraction, budget-guarded, over
// agent-recommended papers).
//
// The OLD manual console flow (startResearchRunAction and friends) creates
// its own since_date-only runs (day null) and is untouched by any of this:
// the engine only ever operates on day-keyed rows, reached exclusively
// through getOrCreateTodayResearchRun.

// Safety caps, all per-invocation (not persisted across cron/sweep calls —
// each invocation gets its own budget of work and a stuck step just resumes
// on the next one):
const PULL_DAY_CAP_PER_LOOKBACK_DAY = 1500; // scanned_count ceiling = this * lookbackDays(day)
const AGENT_CHUNK_SIZE = 12;
const AGENT_CHUNK_CAP = 6;
const ANALYZE_CAP = 40;
const ANALYZE_FAILURE_CAP = 5;
const PULL_FAILURE_CAP = 3;
const TRIAGE_FAILURE_CAP = 3;
const ARXIV_POLITENESS_MS = 3200; // arXiv's ~1 request/3s ask, between pages within one invocation

function shiftDay(dayISO: string, delta: number): string {
  const d = new Date(`${dayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Create (or resume) today's day-keyed run. since = day minus the scan
// lookback window (3 days on Monday, 1 otherwise, the shared weekday-cron
// catch-up rule) so a Monday run reaches back through the weekend. A freshly
// created run also opportunistically prunes expired triage rejects, the same
// housekeeping startResearchRunAction does for a manual run.
export async function getOrCreateTodayResearchRun(): Promise<{ runId: string; day: string }> {
  const day = todayUTC();
  const since = shiftDay(day, -lookbackDays(day));
  const { id, created } = await createDayResearchRun(day, since);
  if (created) await pruneRejectedPapers().catch(() => {});
  return { runId: id, day };
}

export { claimResearchRun };

function progressOf(
  run: ResearchEngineRun,
  notes: string[],
  ephemeral: { agentProcessed: number; analyzed: number }
): ResearchProgress {
  return {
    runId: run.id,
    day: run.day,
    step: run.step,
    done: run.status === 'completed',
    counters: {
      scanned: run.scanned_count,
      pulled: run.pulled_count,
      kept: run.kept_count,
      rejected: run.rejected_count,
      agentProcessed: ephemeral.agentProcessed,
      analyzed: ephemeral.analyzed,
    },
    notes,
  };
}

async function completeRun(runId: string): Promise<void> {
  await updateResearchRun(runId, { step: 'complete', status: 'completed' });
  await releaseResearchLease(runId);
}

// One invocation's worth of work: loop bounded units until the deadline or
// the run completes. The caller holds the lease (claimResearchRun) first.
export async function advanceResearchRun(runId: string, deadlineAt: number): Promise<ResearchProgress> {
  const notes: string[] = [];
  let pullFailures = 0;
  let triageFailures = 0;
  let agentChunks = 0;
  let agentProcessed = 0;
  let analyzed = 0;
  let analyzeFailures = 0;
  const analyzeFailedIds: string[] = [];

  try {
    while (Date.now() < deadlineAt) {
      const run = await getResearchRun(runId);
      if (!run) throw new Error('research run not found');
      if (run.status === 'completed') return progressOf(run, notes, { agentProcessed, analyzed });
      await renewResearchLease(runId);

      // ---- pull: one arXiv page per unit, offset = the run's own scanned_count ----
      if (run.step === 'pull') {
        const cap = PULL_DAY_CAP_PER_LOOKBACK_DAY * Math.max(1, lookbackDays(run.day));
        if (run.scanned_count >= cap) {
          notes.push(`pull: ${run.scanned_count} scanned, ${run.pulled_count} pulled (day cap reached)`);
          await updateResearchRun(runId, { step: 'triage' });
          continue;
        }
        try {
          const r = await pullPage(runId, run.scanned_count, run.since_date);
          pullFailures = 0;
          if (r.done) {
            notes.push(`pull: ${run.scanned_count + r.scanned} scanned, ${run.pulled_count + r.inserted} pulled`);
            await updateResearchRun(runId, { step: 'triage' });
            continue;
          }
          // Only sleep when another page will actually follow this invocation.
          await new Promise((resolve) => setTimeout(resolve, ARXIV_POLITENESS_MS));
        } catch (e) {
          pullFailures++;
          notes.push(`pull failed at offset ${run.scanned_count}: ${String((e as Error)?.message ?? 'error').slice(0, 160)}`);
          if (pullFailures >= PULL_FAILURE_CAP) {
            notes.push(`pull: ${PULL_FAILURE_CAP} consecutive failures, advancing to triage`);
            await updateResearchRun(runId, { step: 'triage' });
          }
        }
        continue;
      }

      // ---- triage: existing chunked relevance filter, claims its own rows ----
      if (run.step === 'triage') {
        const budget = await checkResearchBudget();
        if (!budget.ok) {
          const pending = await countPendingPapers(runId);
          notes.push(`triage: budget reached, ${pending} paper${pending === 1 ? '' : 's'} left pending`);
          await updateResearchRun(runId, { step: 'agent' });
          continue;
        }
        try {
          const r = await triagePapersChunk(runId);
          triageFailures = 0;
          if (r.remaining === 0) {
            notes.push(`triage: ${run.kept_count + r.kept} kept of ${run.kept_count + r.kept + run.rejected_count + r.rejected}`);
            await updateResearchRun(runId, { step: 'agent' });
          }
        } catch (e) {
          triageFailures++;
          notes.push(`triage chunk failed: ${String((e as Error)?.message ?? 'error').slice(0, 160)}`);
          if (triageFailures >= TRIAGE_FAILURE_CAP) {
            const pending = await countPendingPapers(runId);
            notes.push(`triage: ${TRIAGE_FAILURE_CAP} consecutive failures, ${pending} left pending, advancing to agent`);
            await updateResearchRun(runId, { step: 'agent' });
          }
        }
        continue;
      }

      // ---- agent: the queue-agent's recommend-only pass over the pending review queue ----
      if (run.step === 'agent') {
        const budget = await checkResearchBudget();
        if (!budget.ok) {
          notes.push(`agent: budget reached after ${agentProcessed} recommendation${agentProcessed === 1 ? '' : 's'} this run`);
          await updateResearchRun(runId, { step: 'analyze' });
          continue;
        }
        if (agentChunks >= AGENT_CHUNK_CAP) {
          notes.push(`agent: chunk cap reached (${AGENT_CHUNK_CAP}), ${agentProcessed} recommendation${agentProcessed === 1 ? '' : 's'} this run`);
          await updateResearchRun(runId, { step: 'analyze' });
          continue;
        }
        const ids = await getUnrecommendedPaperIds(AGENT_CHUNK_SIZE);
        if (!ids.length) {
          notes.push(`agent: ${agentProcessed} recommendation${agentProcessed === 1 ? '' : 's'} this run, queue drained`);
          await updateResearchRun(runId, { step: 'analyze' });
          continue;
        }
        agentChunks++;
        try {
          const r = await recommendQueueChunk(ids);
          agentProcessed += r.processed;
        } catch (e) {
          notes.push(`agent chunk failed: ${String((e as Error)?.message ?? 'error').slice(0, 160)}`);
        }
        continue;
      }

      // ---- analyze: per-paper hydrate + finding extraction, budget-guarded ----
      // (also the fallback for a legacy 'review' row, or 'complete' with status
      // still running: draining an empty candidate list completes the run.)
      if (analyzed >= ANALYZE_CAP || analyzeFailures >= ANALYZE_FAILURE_CAP) {
        notes.push(`analyze: ${analyzed} finding${analyzed === 1 ? '' : 's'}, ${analyzeFailures} failure${analyzeFailures === 1 ? '' : 's'} (cap reached)`);
        await completeRun(runId);
        continue;
      }
      const budget = await checkResearchBudget();
      if (!budget.ok) {
        notes.push(`analyze: budget reached, ${analyzed} finding${analyzed === 1 ? '' : 's'}, ${analyzeFailures} failure${analyzeFailures === 1 ? '' : 's'}`);
        await completeRun(runId);
        continue;
      }
      const next = await getNextAnalysisCandidate(analyzeFailedIds);
      if (!next) {
        notes.push(`analyze: ${analyzed} finding${analyzed === 1 ? '' : 's'}, ${analyzeFailures} failure${analyzeFailures === 1 ? '' : 's'}, queue drained`);
        await completeRun(runId);
        continue;
      }
      try {
        await hydratePaper(next.id);
        await analyzePaper(next.id);
        analyzed++;
      } catch (e) {
        analyzeFailures++;
        analyzeFailedIds.push(next.id);
        notes.push(`analyze failed (paper ${next.id}): ${String((e as Error)?.message ?? 'error').slice(0, 160)}`);
      }
    }
    const run = await getResearchRun(runId);
    if (!run) throw new Error('research run not found');
    if (run.status !== 'completed') notes.push('time budget reached: resume to continue');
    return progressOf(run, notes, { agentProcessed, analyzed });
  } finally {
    await appendResearchRunNotes(
      runId,
      notes.filter((n) => !n.startsWith('time budget reached'))
    ).catch(() => {});
    await releaseResearchLease(runId).catch(() => {});
  }
}
