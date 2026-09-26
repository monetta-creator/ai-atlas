'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createUiJobAction, markJobStepAction, finishUiJobAction, failUiJobAction, parkUiJobAction,
} from '@/lib/actions';
import {
  applyTransition, stepsFromSpecs, typicalForSteps,
  type FeatureStats, type JobStep, type StepSpec, type Typical, type UiJob,
} from './core';
import { announceJobsChanged } from './jobs-store';

// The shared state machine behind every button that starts a model call
// (2026-09-27). A caller declares its steps (label, running sentence, the
// ai_cost_log features each spends) and a `run` function that walks them
// through ctx.step(); the hook tracks the current step, the attempt, elapsed
// time against the typical time and cost, the log, and the result; and it
// mirrors every move into the ui_jobs registry so the run survives leaving
// the page (the rail shows it, a toast says when it ends, and returning to
// the page resumes the panel from the row).
//
// Two modes. 'chain' (default): the client walks the steps, each its own
// server action, retried visibly. 'poll': one long server action moves the
// job's steps itself (it receives the job id); the hook polls the row every
// two seconds while it runs. A page opened mid-run (initialJob running)
// polls in either mode, since the chain that started it lives elsewhere.
//
// React Compiler rules: no ref reads during render, no setState in an effect
// body (the timer and the poll set state from interval and fetch callbacks).

export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed';

export interface RunCtx {
  jobId: string;
  // Runs one declared step: marks it running, retries it (a result with
  // ok:false or a throw counts as a failed attempt), marks it done or failed.
  // Throws after the last attempt so the run stops there.
  step<T>(key: string, fn: () => Promise<T>, opts?: { retries?: number }): Promise<T>;
  note(line: string): void;
}

export interface RunOutcome {
  href?: string | null;   // the result's page ("Open the result")
  note?: string | null;   // a closing line for the log
  parked?: string | null; // a resumable run that stopped for now (Savant's legs)
}

export interface ModelRun {
  status: RunStatus;
  jobId: string | null;
  steps: JobStep[];
  specs: StepSpec[];
  currentKey: string | null;
  failedKey: string | null;
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
  typical: Typical;
  resultHref: string | null;
  costUsd: number | null;
  error: string | null;
  log: string[];
  start(opts?: { from?: string | null }): Promise<void>;
  retry(): Promise<void>;
  reset(): void;
}

interface State {
  status: RunStatus;
  jobId: string | null;
  steps: JobStep[];
  attempt: number;
  maxAttempts: number;
  startedAt: number | null;
  endedAt: number | null;
  resultHref: string | null;
  costUsd: number | null;
  error: string | null;
  log: string[];
  owned: boolean;
}

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'failed');

export class StepError extends Error {
  constructor(public stepKey: string, message: string) { super(message); }
}

function isFailedResult(r: unknown): string | null {
  if (r && typeof r === 'object' && 'ok' in r && (r as { ok: unknown }).ok === false) {
    const e = (r as { error?: unknown }).error;
    return typeof e === 'string' && e ? e : 'failed';
  }
  return null;
}

function fromJob(job: UiJob): Partial<State> {
  const status: RunStatus =
    job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : job.status === 'queued' ? 'paused' : 'running';
  return {
    status,
    jobId: job.id,
    steps: job.steps,
    startedAt: job.startedAt ? Date.parse(job.startedAt) : null,
    endedAt: job.finishedAt ? Date.parse(job.finishedAt) : null,
    resultHref: job.resultHref,
    costUsd: job.costUsd,
    error: job.error,
  };
}

function initialState(specs: StepSpec[], job: UiJob | null | undefined): State {
  const base: State = {
    status: 'idle', jobId: null, steps: stepsFromSpecs(specs), attempt: 1, maxAttempts: 1,
    startedAt: null, endedAt: null, resultHref: null, costUsd: null, error: null, log: [], owned: false,
  };
  if (!job) return base;
  return { ...base, ...fromJob(job), steps: job.steps.length ? job.steps : base.steps };
}

export function useModelRun(opts: {
  kind: string;
  subject?: string | null;
  label: string;
  steps: StepSpec[];
  stats?: FeatureStats | null;
  initialJob?: UiJob | null;
  mode?: 'chain' | 'poll';
  run: (ctx: RunCtx, from: string | null) => Promise<RunOutcome | void>;
}): ModelRun {
  const { kind, subject = null, label, steps: specs, stats, initialJob, mode = 'chain', run } = opts;
  const [st, setSt] = useState<State>(() => initialState(specs, initialJob));
  const [now, setNow] = useState(0);
  const [pollTick, setPollTick] = useState(0);

  const running = st.status === 'running';
  const polling = running && !!st.jobId && (mode === 'poll' || !st.owned);

  // The clock: one tick a second while running.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // The registry poll: every two seconds while the steps are moved elsewhere.
  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setPollTick((t) => t + 1);
    }, 2000);
    return () => window.clearInterval(id);
  }, [polling]);

  const jobId = st.jobId;
  useEffect(() => {
    if (pollTick === 0 || !jobId) return;
    let live = true;
    fetch(`/api/jobs/${jobId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((job: UiJob | null) => {
        if (!live || !job) return;
        setSt((s) => (s.jobId !== job.id ? s : { ...s, ...fromJob(job), owned: s.owned }));
      })
      .catch(() => { /* keep the last known state; the next tick retries */ });
    return () => { live = false; };
  }, [pollTick, jobId]);

  const say = useCallback((line: string) => setSt((s) => ({ ...s, log: [...s.log, line] })), []);

  const start = useCallback(async (o?: { from?: string | null }) => {
    if (st.status === 'running') return;
    const from = o?.from ?? null;
    const resume = !!from && !!st.jobId;
    const id = resume ? st.jobId! : crypto.randomUUID();
    const t0 = Date.now();
    const keepDone = resume ? st.steps.filter((s) => s.state === 'done').map((s) => s.key) : [];
    const steps = resume
      ? st.steps.map((s) => (s.state === 'done' ? s : { ...s, state: 'todo' as const, endedAt: null, note: null }))
      : stepsFromSpecs(specs);
    setSt((s) => ({
      ...s, status: 'running', jobId: id, steps, attempt: 1, maxAttempts: 1,
      startedAt: resume ? s.startedAt ?? t0 : t0, endedAt: null, resultHref: null, costUsd: null, error: null,
      log: resume ? [...s.log, `Resuming from ${specs.find((x) => x.key === from)?.label ?? from}…`] : [],
      owned: true,
    }));
    setNow(t0);
    // Register first (fast); a failed registry write never blocks the run.
    await createUiJobAction({ id, kind, subject, label, steps: specs, keepDone }).catch(() => {});
    announceJobsChanged();

    const ctx: RunCtx = {
      jobId: id,
      note: say,
      async step<T>(key: string, fn: () => Promise<T>, so?: { retries?: number }): Promise<T> {
        const spec = specs.find((x) => x.key === key);
        const tries = Math.max(1, so?.retries ?? (spec?.features?.length ? 3 : 1));
        const stepLabel = spec?.label ?? key;
        let lastErr = 'failed';
        for (let a = 1; a <= tries; a++) {
          const note = a > 1 ? `Retrying, attempt ${a} of ${tries}` : null;
          setSt((s) => ({
            ...s, attempt: a, maxAttempts: tries,
            steps: applyTransition(s.steps, key, 'running', nowIso(), { attempt: a, note, label: stepLabel }),
          }));
          void markJobStepAction(id, key, 'running', { attempt: a, note, label: stepLabel }).catch(() => {});
          if (a > 1) await sleep((a - 1) * 1500);
          try {
            const r = await fn();
            const bad = isFailedResult(r);
            if (!bad) {
              setSt((s) => ({ ...s, steps: applyTransition(s.steps, key, 'done', nowIso(), { note: null }) }));
              void markJobStepAction(id, key, 'done', { note: null }).catch(() => {});
              return r;
            }
            lastErr = bad;
          } catch (e) {
            lastErr = errText(e);
          }
          say(`✗ ${stepLabel}${tries > 1 ? ` (attempt ${a} of ${tries})` : ''}: ${lastErr}`);
        }
        setSt((s) => ({ ...s, steps: applyTransition(s.steps, key, 'failed', nowIso(), { note: lastErr }) }));
        void markJobStepAction(id, key, 'failed', { note: lastErr.slice(0, 400) }).catch(() => {});
        throw new StepError(key, lastErr);
      },
    };

    try {
      const out = (await run(ctx, from)) || {};
      if (out.parked) {
        await parkUiJobAction(id, out.parked).catch(() => {});
        announceJobsChanged();
        setSt((s) => ({ ...s, status: 'paused', endedAt: Date.now(), log: [...s.log, out.parked!], owned: false }));
        return;
      }
      const href = out.href ?? null;
      const fin = await finishUiJobAction(id, href).catch(() => null);
      announceJobsChanged();
      setSt((s) => ({
        ...s, status: 'done', endedAt: Date.now(), resultHref: href ?? s.resultHref, costUsd: fin?.costUsd ?? null,
        steps: s.steps.map((x) => (x.state === 'running' ? { ...x, state: 'done' as const } : x)),
        log: out.note ? [...s.log, out.note] : s.log,
      }));
    } catch (e) {
      const msg = errText(e);
      void failUiJobAction(id, msg).catch(() => {}).finally(announceJobsChanged);
      setSt((s) => ({ ...s, status: 'failed', endedAt: Date.now(), error: msg }));
    }
  }, [st.status, st.jobId, st.steps, specs, kind, subject, label, run, say]);

  const failedKey = st.steps.find((s) => s.state === 'failed')?.key ?? null;
  const retry = useCallback(() => start({ from: failedKey ?? st.steps.find((s) => s.state !== 'done')?.key ?? null }), [start, failedKey, st.steps]);
  const reset = useCallback(() => setSt(initialState(specs, null)), [specs]);

  const currentKey = st.steps.find((s) => s.state === 'running')?.key ?? null;
  const end = st.endedAt ?? (running ? now : st.startedAt ?? 0);
  const elapsedMs = st.startedAt ? Math.max(0, end - st.startedAt) : 0;

  return {
    status: st.status,
    jobId: st.jobId,
    steps: st.steps,
    specs,
    currentKey,
    failedKey,
    attempt: st.attempt,
    maxAttempts: st.maxAttempts,
    elapsedMs,
    typical: typicalForSteps(specs, stats),
    resultHref: st.resultHref,
    costUsd: st.costUsd,
    error: st.error,
    log: st.log,
    start,
    retry,
    reset,
  };
}
