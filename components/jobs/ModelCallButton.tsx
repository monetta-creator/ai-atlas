'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { aboutLabel, clockLabel, usdLabel, type FeatureStats } from '@/lib/jobs/core';
import { useModelRun, type RunOutcome } from '@/lib/jobs/use-model-run';

// The compact form of the run panel for a single model call (a gap
// diagnosis, a dossier, an AI suggestion): the button, then one quiet line
// that says what it is doing, the elapsed time against the usual time and
// cost, a visible retry, and how it ended. The call is registered as a job
// like any other, so it too survives leaving the page.
//
//   <ModelCallButton label="Diagnose gaps" busyLabel="Reading the map…"
//     kind="single:argument_gaps" feature="argument_gaps" stats={stats}
//     action={() => diagnoseArgumentGapsAction()} onDone={() => router.refresh()} />

export default function ModelCallButton<T>({
  label, busyLabel, kind, subject = null, jobLabel, feature, features, calls = 1, stats, action, onDone,
  className = 'btn btn--sm', disabled = false, retries, resultHref, title,
}: {
  label: string;
  busyLabel: string;                  // the sentence while it runs ("Reading recent papers…")
  kind: string;                       // ui_jobs.kind, e.g. 'single:argument_gaps'
  subject?: string | null;
  jobLabel?: string;                  // the rail/toast label; defaults to the button label
  feature: string;                    // the ai_cost_log feature it spends
  features?: string[];                // several features, one entry per expected call (overrides feature/calls)
  calls?: number;                     // expected model calls (a two-half summary is 2)
  stats?: FeatureStats | null;
  action: () => Promise<T>;
  onDone?: (result: T) => void | RunOutcome | Promise<void | RunOutcome>;
  className?: string;
  disabled?: boolean;
  retries?: number;
  resultHref?: (result: T) => string | null;
  title?: string;                     // the button's tooltip (e.g. why it is disabled)
}) {
  const run = useModelRun({
    kind,
    subject,
    label: jobLabel ?? label,
    steps: [{ key: 'call', label, running: busyLabel, features: features?.length ? features : Array.from({ length: Math.max(1, calls) }, () => feature) }],
    stats,
    run: async (ctx) => {
      const r = await ctx.step('call', action, retries ? { retries } : undefined);
      const extra = (await onDone?.(r)) || {};
      return { href: resultHref?.(r) ?? null, ...extra };
    },
  });

  // The done tick fades back to idle after a few seconds (set from a timer
  // callback, never in the effect body).
  const [fadedFor, setFadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (run.status !== 'done' || !run.jobId) return;
    const id = run.jobId;
    const t = window.setTimeout(() => setFadedFor(id), 6000);
    return () => window.clearTimeout(t);
  }, [run.status, run.jobId]);
  const showDone = run.status === 'done' && fadedFor !== run.jobId;

  const t = run.typical;
  const usual = t.known ? [aboutLabel(t.p50Ms), usdLabel(t.p50Usd)].filter(Boolean).join(', ') : '';
  const busy = run.status === 'running';

  return (
    <span className="mr-call">
      <button type="button" className={className} disabled={disabled || busy} title={title} onClick={() => void run.start()}>
        {busy ? <><span className="spinner mr-btn-spin" aria-hidden="true" />{label}</> : label}
      </button>
      {busy && (
        <span className="mr-inline" role="status" aria-live="polite">
          {busyLabel} <span className="mr-clock">{clockLabel(run.elapsedMs)}{usual ? ` of ${usual}` : ''}</span>
          {run.attempt > 1 && <span className="mr-inline-retry"> · retrying, attempt {run.attempt} of {run.maxAttempts}</span>}
        </span>
      )}
      {showDone && (
        <span className="mr-inline mr-inline--done" role="status">
          ✓ Done in {clockLabel(run.elapsedMs)}
          {run.costUsd ? ` · ${usdLabel(run.costUsd)}` : ''}
          {run.resultHref && <> · <Link href={run.resultHref} className="mr-link">Open</Link></>}
        </span>
      )}
      {run.status === 'failed' && (
        <span className="mr-inline mr-inline--fail" role="alert">
          ✗ {run.error ?? 'Failed.'}{' '}
          <button type="button" className="mr-inline-btn" onClick={() => void run.start()}>Try again</button>
        </span>
      )}
      {run.status === 'idle' && usual && <span className="mr-inline mr-inline--hint">usually {usual}</span>}
    </span>
  );
}
