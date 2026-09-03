import { pullPage } from './pull';
import { triagePapersChunk } from './triage';
import { recommendQueueChunk } from './queue-agent';
import { hydratePaper, analyzePaper } from './analysis';
import { checkResearchBudget } from './budget';
import { lookbackDays } from '../scan/core';
import {
  getResearchRun, getUnrecommendedPaperIds, getNextAnalysisCandidates, countPendingPapers,
} from '../data/research';
import {
  createDayResearchRun, claimResearchRun, renewResearchLease, releaseResearchLease,
  appendResearchRunNotes, updateResearchRun, pruneRejectedPapers, failStaleResearchRuns,
} from '../mutations/research';
import type { ResearchEngineRun, ResearchProgress } from '../types';

// The research library's checkpointed step engine (the intel/scan engine
// pattern), shared by the cron route and the console's tick action. Every
// unit persists to research_runs/papers before the next begins, so an
// invocation that runs out of time resumes exactly where it stopped. Steps in
// order: pull (arXiv, one page per unit, offset = the run's scanned_count),
// triage (metadata relevance filtering, TRIAGE_POOL chunks concurrent per
// unit), agent (the queue-agent recommendation pass over the pending review
// queue), analyze (hydrate + finding extraction, ANALYZE_POOL papers
// concurrent per unit, budget-guarded, over agent-recommended papers).
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
const AGENT_CHUNK_CAP = 8;
const ANALYZE_CAP = 40;
const ANALYZE_POOL = 3; // papers hydrated + analyzed concurrently per unit
const ANALYZE_FAILURE_CAP = 5;
const PULL_FAILURE_CAP = 3;
const TRIAGE_POOL = 2; // triage chunks claimed + processed concurrently per unit
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
  // Stale-run janitor: fail any prior day's run still marked running before
  // touching today's row (it can never be resumed once its day has passed);
  // legacy manual runs (day null) are untouched.
  await failStaleResearchRuns().catch(() => {});
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

      // ---- triage: TRIAGE_POOL chunks concurrent per unit, each claims its own rows ----
      if (run.step === 'triage') {
        const budget = await checkResearchBudget();
        if (!budget.ok) {
          const pending = await countPendingPapers();
          notes.push(`triage: budget reached, ${pending} paper${pending === 1 ? '' : 's'} left pending`);
          await updateResearchRun(runId, { step: 'agent' });
          continue;
        }
        // claimPendingPapers ('for update skip locked', a 5-minute 'in triage'
        // hold) makes concurrent chunks safe: no two chunks claim the same rows.
        const settled = await Promise.allSettled(
          Array.from({ length: TRIAGE_POOL }, () => triagePapersChunk(runId))
        );
        const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
        for (const s of settled) {
          if (s.status === 'rejected') {
            notes.push(`triage chunk failed: ${String((s.reason as Error)?.message ?? 'error').slice(0, 160)}`);
          }
        }
        if (!ok.length) {
          triageFailures++;
          if (triageFailures >= TRIAGE_FAILURE_CAP) {
            const pending = await countPendingPapers();
            notes.push(`triage: ${TRIAGE_FAILURE_CAP} consecutive failures, ${pending} left pending, advancing to agent`);
            await updateResearchRun(runId, { step: 'agent' });
          }
          continue;
        }
        triageFailures = 0;
        const processed = ok.reduce((sum, r) => sum + r.processed, 0);
        const rejected = ok.reduce((sum, r) => sum + r.rejected, 0);
        // Re-read remaining rather than trusting either chunk's own count: two
        // concurrent chunks race on the same GLOBAL pending queue.
        const remaining = await countPendingPapers();
        if (remaining === 0) {
          const current = await getResearchRun(runId);
          const kept = current?.kept_count ?? run.kept_count;
          const totalRejected = current?.rejected_count ?? run.rejected_count;
          notes.push(`triage: ${kept} kept of ${kept + totalRejected}`);
          await updateResearchRun(runId, { step: 'agent' });
        } else if (processed === 0 && rejected === 0) {
          // Nothing claimable and nothing exhausted to reject: the remaining
          // pending papers are held by live claims (a crashed invocation under
          // 5 minutes old). Advance rather than spin on empty claims. The claim
          // is GLOBAL, so anything still held here is picked up and triaged by
          // a later invocation of this run, or by the next day's run once the
          // 5-minute hold expires, instead of being orphaned. Note a run's
          // kept/rejected counters (recomputeResearchRunCounts, scoped by
          // run_id) exclude leftovers absorbed from earlier runs, so an old
          // run's papers triaged here count against whichever run claimed them.
          notes.push(`triage: no claimable papers, ${remaining} left pending, advancing to agent`);
          await updateResearchRun(runId, { step: 'agent' });
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

      // ---- analyze: ANALYZE_POOL papers hydrated + analyzed concurrently per unit, budget-guarded ----
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
      const want = Math.min(ANALYZE_POOL, ANALYZE_CAP - analyzed);
      const candidates = await getNextAnalysisCandidates(analyzeFailedIds, want);
      if (!candidates.length) {
        notes.push(`analyze: ${analyzed} finding${analyzed === 1 ? '' : 's'}, ${analyzeFailures} failure${analyzeFailures === 1 ? '' : 's'}, queue drained`);
        await completeRun(runId);
        continue;
      }
      const results = await Promise.allSettled(
        candidates.map((c) => hydratePaper(c.id).then(() => analyzePaper(c.id)))
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
          analyzed++;
        } else {
          analyzeFailures++;
          analyzeFailedIds.push(candidates[i].id);
          notes.push(`analyze failed (paper ${candidates[i].id}): ${String((r.reason as Error)?.message ?? 'error').slice(0, 160)}`);
        }
      }
    }
    const run = await getResearchRun(runId);
    if (!run) throw new Error('research run not found');
    if (run.status !== 'completed') notes.push('time budget reached: resume to continue');
    return progressOf(run, notes, { agentProcessed, analyzed });
  } finally {
    // Persist issue notes for the health panel, including the time-budget
    // line: it is the only DB evidence a window was exhausted.
    await appendResearchRunNotes(runId, notes).catch(() => {});
    await releaseResearchLease(runId).catch(() => {});
  }
}
