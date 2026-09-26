'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { aboutLabel, clockLabel, progressPct, usdLabel } from '@/lib/jobs/core';
import type { ModelRun } from '@/lib/jobs/use-model-run';

// The one run panel (2026-09-27): what is running, how far along, how long it
// usually takes and what it usually costs, whether it is retrying, and how it
// ended, with a link to the result or a retry from the step that failed.
// Rendered by every chained console (reports, theses, Savant) under its own
// start button; single calls use the compact ModelCallButton instead.

const GLYPH = { done: '✓', running: '●', failed: '✗', todo: '○' } as const;

export default function ModelRunPanel({
  run, doneLabel = 'Open the result', idleHint, children,
}: {
  run: ModelRun;
  doneLabel?: string;
  idleHint?: ReactNode;      // shown before the first run (e.g. "Usually about 2 min, about $0.35")
  children?: ReactNode;      // extra lines under the done state (gate notes, etc.)
}) {
  const { status, steps, specs, currentKey, typical, elapsedMs, attempt, maxAttempts } = run;
  const t = typical;
  const estimate = [t.known ? aboutLabel(t.p50Ms) : '', t.known ? usdLabel(t.p50Usd) : ''].filter(Boolean).join(' · ');

  if (status === 'idle') {
    return estimate || idleHint ? (
      <p className="mr-idle">{idleHint ?? <>Usually {estimate}.</>}</p>
    ) : null;
  }

  const current = specs.find((s) => s.key === currentKey);
  const pct = status === 'running' ? progressPct(elapsedMs, t.p50Ms, t.p90Ms) : status === 'done' ? 100 : 0;

  return (
    <div className="mr-panel" data-status={status} role="status" aria-live="polite">
      {steps.length > 1 && (
        <ol className="mr-steps">
          {steps.map((s) => (
            <li key={s.key} className="mr-step" data-state={s.state}>
              <span className="mr-glyph" aria-hidden="true">{GLYPH[s.state]}</span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {status === 'running' && (
        <>
          <div className="mr-line">
            <span className="spinner" aria-hidden="true" />
            <span className="mr-now">{current?.running || current?.label || 'Working…'}</span>
            <span className="mr-clock">
              {clockLabel(elapsedMs)} elapsed{estimate ? ` · usually ${estimate}` : ''}
            </span>
          </div>
          {t.known && (
            <div className="mr-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
          )}
          {attempt > 1 && (
            <p className="mr-retry">
              Retrying {current?.label.toLowerCase() ?? 'this step'}, attempt {attempt} of {maxAttempts}. The model call failed or timed out; the earlier steps are kept.
            </p>
          )}
          <p className="mr-leave">You can leave this page: the run continues, the rail shows it, and a note appears when it finishes.</p>
        </>
      )}

      {status === 'paused' && (
        <p className="mr-paused">
          Paused at {clockLabel(elapsedMs)}. {run.log[run.log.length - 1] ?? 'Run again to continue from where it stopped.'}
        </p>
      )}

      {status === 'done' && (
        <p className="mr-done">
          <span aria-hidden="true">✓</span> Done in {clockLabel(elapsedMs)}
          {run.costUsd != null && run.costUsd > 0 ? ` · ${usdLabel(run.costUsd)}` : ''}
          {run.resultHref && (
            <> · <Link href={run.resultHref} className="mr-link">{doneLabel}</Link></>
          )}
        </p>
      )}
      {status === 'done' && children}

      {status === 'failed' && (
        <div className="mr-fail">
          <p><span aria-hidden="true">✗</span> {run.error ?? 'The run failed.'}</p>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => void run.retry()}>
            Retry from {(specs.find((s) => s.key === run.failedKey)?.label ?? 'the failed step').toLowerCase()}
          </button>
        </div>
      )}

      {run.log.length > 0 && (
        <details className="mr-log">
          <summary>Run log ({run.log.length})</summary>
          <pre>{run.log.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
