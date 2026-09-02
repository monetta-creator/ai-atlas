import * as m from '../mutations';
import {
  getRun, getPipelinePrefs, getTodayDailyRunId, getApprovedCandidates, countPendingCandidates,
} from '../data';
import { discoveryPlan, discoverBatch, discoverBreakingSweep } from './discovery';
import { searchCourtListener } from './courtlistener';
import { triageChunk } from './triage';
import { analyzeCandidate } from './analysis';
import { hydrateCandidate } from './hydrate';
import { runCoverageCheck } from './coverage';
import { checkPipelineBudget } from './budget';
import { pickEnrichModel } from '../scan/models';
import { lookbackDays } from '../scan/core';
import type { PipelineRun, SignalLens } from '../types';

// The pipeline's server-side step engine (the scan's advanceScanRun pattern):
// loop bounded units until the caller deadline or the run completes,
// persisting after each, under a lease the caller holds (claimPipelineRun).
// Discovery checkpoints per unit in pipeline_runs.discovered_units (0042);
// triage/analysis checkpoint through the existing candidate rows. The admin
// console keeps driving the same underlying functions through its own
// actions; this engine exists so the daily cron can run the whole pipeline
// unattended. Step semantics preserved from the console orchestrator:
// discovery unit failures are notes (never fatal), triage failures fail the
// run (resumable), analysis distinguishes terminal from transient.

const ANALYSIS_POOL = 4;

export interface PipelineProgress {
  runId: string;
  step: string;
  done: boolean;
  notes: string[];
}

function shiftDay(dayISO: string, delta: number): string {
  const d = new Date(`${dayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// The run's lookback window, derived from its own row so every invocation
// (either cron, or a console resume) resolves identical queries: daily runs
// get the weekday window (3 days on Mondays, matching the scan), weekly get 7.
export function runSinceISO(run: Pick<PipelineRun, 'created_at' | 'cadence'>): string {
  const day = new Date(run.created_at).toISOString().slice(0, 10);
  const back = run.cadence === 'weekly' ? 7 : lookbackDays(day);
  return shiftDay(day, -back);
}

// Reuse today's daily run or open one (the three cron invocations share it).
// A prior day's run still marked running can never be resumed (the cron only
// ever advances today's run), so it is failed here rather than lying forever.
export async function getOrCreateDailyRun(): Promise<{ runId: string; created: boolean }> {
  await m.failStaleDailyRuns().catch(() => {});
  const existing = await getTodayDailyRunId();
  if (existing) return { runId: existing, created: false };
  return { runId: await m.createRun('daily'), created: true };
}

export async function advancePipelineRun(runId: string, deadlineAt: number): Promise<PipelineProgress> {
  const notes: string[] = [];
  // Per-candidate attempt count THIS invocation: a flaky candidate gets one
  // in-invocation retry (on the next configured model) before its error rests,
  // preventing an in-invocation spin while leaving the run resumable.
  const attempted = new Map<string, number>();
  try {
    while (Date.now() < deadlineAt) {
      const run = await getRun(runId);
      if (!run) throw new Error('pipeline run not found');
      if (run.status === 'completed') return { runId, step: run.step, done: true, notes };
      await m.renewPipelineLease(runId);
      const sinceISO = runSinceISO(run);

      if (run.step === 'discovery') {
        const units = [
          ...discoveryPlan(run.cadence).map((b) => `${b.lens}:${b.batchIndex}`),
          'sweep',
          'courtlistener',
        ];
        const done = new Set(run.discovered_units ?? []);
        const next = units.find((u) => !done.has(u));
        if (!next) {
          await m.updateRun(runId, { step: 'triage', status: 'running', error: null });
          continue;
        }
        try {
          if (next === 'sweep') {
            await discoverBreakingSweep(runId, sinceISO);
          } else if (next === 'courtlistener') {
            await searchCourtListener(runId, sinceISO);
          } else {
            const [lens, idx] = next.split(':');
            await discoverBatch(runId, lens as SignalLens, Number(idx), sinceISO);
          }
        } catch (e) {
          // Console semantics: a failed discovery unit is a note, never fatal.
          notes.push(`discovery failed (${next}): ${String((e as Error)?.message ?? 'error').slice(0, 120)}`);
        }
        await m.markDiscoveryUnitDone(runId, next);
        continue;
      }

      if (run.step === 'triage' || run.step === 'analysis') {
        // Triage first when anything is pending (a resumed run may hold both).
        const pendingTriage = await countPendingCandidates(runId);
        if (pendingTriage > 0) {
          const budget = await checkPipelineBudget();
          if (!budget.ok) {
            await m.updateRun(runId, {
              status: 'failed',
              error: `budget cap reached ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}): resume to continue`,
            });
            return { runId, step: run.step, done: false, notes };
          }
          const r = await triageChunk(runId);
          notes.push(`triage: ${r.processed} processed (${r.approved} approved), ${r.remaining} left`);
          continue;
        }

        const approved = await getApprovedCandidates(runId);
        const pending = approved.filter((c) => !c.signal_id && (attempted.get(c.id) ?? 0) < 2);
        if (!pending.length) {
          // Nothing analyzable left this invocation. Candidates whose analysis
          // sits at 'error' after their retries no longer hold the run open:
          // only hydrate-transients (analysis_status still pending) do — a run
          // used to stay 'running' forever when one flaky candidate errored in
          // the day's last window, silently skipping the coverage check.
          const leftover = approved.filter((c) => !c.signal_id && c.analysis_status !== 'error').length;
          if (leftover > 0) {
            notes.push(`analysis: ${leftover} candidate(s) left for the next invocation`);
            return { runId, step: 'analysis', done: false, notes };
          }
          const restingErrors = approved.filter((c) => !c.signal_id).length;
          if (restingErrors > 0) notes.push(`analysis: completing with ${restingErrors} errored candidate(s) resting`);
          // Coverage (advisory, never fatal), then complete.
          try {
            await runCoverageCheck(runId);
          } catch (e) {
            notes.push(`coverage check failed: ${String((e as Error)?.message ?? 'error').slice(0, 120)}`);
          }
          await m.updateRun(runId, { step: 'complete', status: 'completed', error: null });
          await m.recomputeRunCounts(runId);
          continue;
        }

        const budget = await checkPipelineBudget();
        if (!budget.ok) {
          await m.updateRun(runId, {
            status: 'failed',
            error: `budget cap reached ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}): resume to continue`,
          });
          return { runId, step: 'analysis', done: false, notes };
        }
        const prefs = await getPipelinePrefs();
        const wave = pending.slice(0, ANALYSIS_POOL);
        await Promise.all(
          wave.map(async (cand) => {
            const attemptNo = attempted.get(cand.id) ?? 0;
            attempted.set(cand.id, attemptNo + 1);
            const giveUp = async (reason: string) => {
              const note = `unanalyzable: ${reason.slice(0, 280)}`;
              await m.setTriage(cand.id, 'rejected', note);
              await m.setAnalysisStatus(cand.id, 'discarded', note);
            };
            const h = await hydrateCandidate(cand.id);
            if (!h.ok) {
              if (h.terminal) await giveUp(h.error ?? 'fetch failed');
              else notes.push(`hydrate failed (${cand.source_domain ?? 'candidate'}): ${(h.error ?? 'error').slice(0, 100)}`);
              return;
            }
            try {
              // The retry moves to the next configured model (or the Sonnet
              // default when only one is configured): a 429/abort on model A
              // rarely repeats on model B in the same minute.
              const models = prefs.analysis_models;
              let model = pickEnrichModel(models, cand.id);
              if (attemptNo > 0 && model) {
                model = models.length > 1 ? models[(models.indexOf(model) + 1) % models.length] : null;
              }
              await analyzeCandidate(cand.id, model ?? undefined);
            } catch (e) {
              const status = (e as { status?: number } | null)?.status;
              const msg = String((e as Error)?.message ?? 'analysis error');
              const terminal = status === 400 || status === 413 || /too little readable text/.test(msg);
              await m.setAnalysisStatus(cand.id, 'error', msg.slice(0, 500)).catch(() => {});
              if (terminal) await giveUp(msg);
              else notes.push(`analyze failed (${cand.source_domain ?? 'candidate'}): ${msg.slice(0, 100)}`);
            }
          })
        );
        await m.recomputeRunCounts(runId);
        continue;
      }

      // Unknown step (legacy 'complete' with status running): finish it.
      await m.updateRun(runId, { step: 'complete', status: 'completed' });
    }
    const run = await getRun(runId);
    if (run && run.status !== 'completed') notes.push('time budget reached: next invocation resumes');
    return { runId, step: run?.step ?? 'unknown', done: run?.status === 'completed', notes };
  } finally {
    // Persist this invocation's issue notes (0047) — they used to ride only the
    // cron HTTP response and vanish.
    await m.appendPipelineRunNotes(runId, notes).catch(() => {});
    await m.releasePipelineLease(runId).catch(() => {});
  }
}
