'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUiJobAction, markJobStepAction, finishUiJobAction, failUiJobAction, parkUiJobAction,
} from '@/lib/actions';
import { announceJobsChanged } from './jobs-store';
import type { EngineName } from './core';

// The shared driver for the engine consoles (scan, intel, research, pipeline,
// tooling, scout discovery, research pulls), replacing seven copies of the
// same loop (2026-09-27). Each tick is one short server action that advances
// the engine by a bounded unit; the loop repeats until the run reports done,
// another invocation holds the lease, the reader stops it, or the safety cap
// is reached. The run registers as a ui_jobs row (kind `engine:<name>`,
// subject = the engine's run id), so the rail shows it, a toast says when it
// ends, and it keeps going after the reader navigates away within the site.
//
// A console supplies `start` (create or resume today's run), `tick`, and a
// `read` adapter that turns its engine's progress object into a step name, a
// counters line, notes, and the busy/done flags.

export type TickStatus = 'idle' | 'running' | 'done' | 'stopped' | 'failed';

export interface TickRead {
  error?: string | null;
  step?: string | null;       // the engine's current step (feeds, search, hydrate, enrich, ...)
  line?: string | null;       // one counters line for the log (repeats are dropped)
  notes?: string[];           // engine notes to log once each
  busy?: boolean;             // another invocation holds the lease
  done?: boolean;             // the run completed
}

export interface TickLoop {
  status: TickStatus;
  busy: boolean;
  step: string | null;
  lastLine: string | null;
  elapsedMs: number;
  ticks: number;
  log: string[];
  stopping: boolean;
  run(): void;
  stop(): void;
}

const STEP_LABEL: Record<string, string> = {
  feeds: 'Feeds', search: 'Search', discovery: 'Discovery', discover: 'Discovery', triage: 'Triage',
  hydrate: 'Hydrate', enrich: 'Enrich', analyze: 'Analyze', analysis: 'Analyze', score: 'Score',
  finish: 'Finish', events: 'Events', deepdive: 'Deep dives', report: 'Report', agent: 'Agent',
  pull: 'Pull', edgar: 'Filings', metrics: 'Metrics', dossier: 'Dossiers', coverage: 'Coverage',
  complete: 'Complete',
};
const stepKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 40) || 'step';

export function useTickLoop<S extends { runId: string; day?: string | null; created?: boolean }, P>(opts: {
  engine: EngineName | 'scout' | 'research-pull';
  label: string;
  start: () => Promise<S | { error: string }>;
  tick: (runId: string) => Promise<P>;
  read: (p: P) => TickRead;
  cap?: number;
  doneLine?: string;
  onSettled?: () => void;
}): TickLoop {
  const { engine, label, start, tick, read, cap = 400, doneLine = '✓ Run complete.', onSettled } = opts;
  const [status, setStatus] = useState<TickStatus>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [lastLine, setLastLine] = useState<string | null>(null);
  const [ticks, setTicks] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);

  const busy = status === 'running';
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const run = useCallback(() => {
    if (status === 'running') return;
    stopRef.current = false;
    const t0 = Date.now();
    setStatus('running'); setStopping(false); setStartedAt(t0); setEndedAt(null); setNow(t0);
    setTicks(0); setStep(null); setLastLine(null);
    const lines: string[] = [];
    const say = (line: string) => { lines.push(line); setLog([...lines]); };
    const jobId = crypto.randomUUID();
    let registered = false;

    void (async () => {
      let outcome: 'done' | 'stopped' | 'failed' = 'failed';
      let reason = '';
      try {
        say(`▶ ${label}…`);
        const started = await start();
        if ('error' in started) { reason = started.error; say(`✗ ${started.error}`); return; }
        say(`  run ${started.runId.slice(0, 8)}${started.day ? ` · day ${started.day}` : ''}${started.created === undefined ? '' : started.created ? ' · new' : ' · resumed'}`);
        await createUiJobAction({ id: jobId, kind: `engine:${engine}`, subject: started.runId, label, steps: [] })
          .then(() => { registered = true; announceJobsChanged(); })
          .catch(() => {});
        let prevLine = '';
        let prevStep = '';
        for (let n = 0; n < cap; n++) {
          if (stopRef.current) { outcome = 'stopped'; reason = 'Stopped; nothing is lost, resume any time.'; say(`■ ${reason}`); return; }
          const p = await tick(started.runId);
          setTicks(n + 1);
          const r = read(p);
          if (r.error) { reason = r.error; say(`✗ ${r.error}`); return; }
          for (const note of r.notes ?? []) say(`  · ${note}`);
          if (r.step && r.step !== prevStep) {
            prevStep = r.step;
            setStep(r.step);
            if (registered) void markJobStepAction(jobId, stepKey(r.step), 'running', { label: STEP_LABEL[r.step] ?? r.step }).catch(() => {});
          }
          if (r.line && r.line !== prevLine) { prevLine = r.line; setLastLine(r.line.trim()); say(r.line); }
          if (r.busy) {
            outcome = 'stopped';
            reason = 'Another invocation holds the run lease (a cron is likely mid-run); try again in a few minutes.';
            say(`  ${reason}`);
            return;
          }
          if (r.done) { outcome = 'done'; say(doneLine); return; }
        }
        outcome = 'stopped';
        reason = 'The tick cap was reached before the run completed; run again to continue.';
        say(`✗ ${reason}`);
      } catch (e) {
        reason = e instanceof Error ? e.message : 'error';
        say(`✗ ${reason}`);
      } finally {
        setEndedAt(Date.now());
        setStatus(outcome);
        if (registered) {
          const write = outcome === 'done' ? finishUiJobAction(jobId, null)
            : outcome === 'stopped' ? parkUiJobAction(jobId, reason)
              : failUiJobAction(jobId, reason || 'failed');
          void write.catch(() => {}).finally(announceJobsChanged);
        }
        onSettled?.();
      }
    })();
  }, [status, label, start, tick, read, cap, doneLine, engine, onSettled]);

  const stop = useCallback(() => { stopRef.current = true; setStopping(true); }, []);

  const end = endedAt ?? (busy ? now : startedAt ?? 0);
  return {
    status, busy, step, lastLine, ticks, log, stopping,
    elapsedMs: startedAt ? Math.max(0, end - startedAt) : 0,
    run, stop,
  };
}
