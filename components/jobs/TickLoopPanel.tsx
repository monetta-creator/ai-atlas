'use client';

import type { ReactNode } from 'react';
import { clockLabel } from '@/lib/jobs/core';
import type { TickLoop } from '@/lib/jobs/use-tick-loop';

// The engine consoles' shared panel (2026-09-27): the start/resume button,
// "Stop after this unit", a meta line (the run's day, status, budget), a
// sentence on what the button does, then while running the engine's current
// step, its latest counters line and the elapsed time, and the full run log.

const STEP_WORDS: Record<string, string> = {
  feeds: 'Reading the press feeds', search: 'Searching the news', discovery: 'Running the discovery searches',
  discover: 'Running the discovery searches', triage: 'Triaging candidates', hydrate: 'Fetching full text',
  enrich: 'Enriching items with the model', analyze: 'Analyzing with the model', analysis: 'Analyzing with the model',
  score: 'Scoring against the rubric', finish: 'Finishing product pages', events: 'Reading vendor feeds',
  deepdive: 'Running deep dives', report: 'Writing the report', pull: 'Pulling papers', edgar: 'Reading SEC filings',
  metrics: 'Pulling metrics', dossier: 'Writing company dossiers', coverage: 'Checking coverage',
};

export default function TickLoopPanel({
  loop, startLabel, resumeLabel, resumable = false, primary = true, meta, subtitle, children,
}: {
  loop: TickLoop;
  startLabel: string;
  resumeLabel?: string;
  resumable?: boolean;
  primary?: boolean;
  meta?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  const { busy, status } = loop;
  const label = busy ? 'Running' : resumable && resumeLabel ? resumeLabel : startLabel;

  return (
    <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className={primary ? 'btn btn--primary' : 'btn'} onClick={loop.run} disabled={busy}>
          {busy && <span className="spinner mr-btn-spin" aria-hidden="true" />}
          {label}
        </button>
        {busy && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={loop.stop} disabled={loop.stopping}>
            {loop.stopping ? 'Stopping after this unit…' : 'Stop after this unit'}
          </button>
        )}
        {meta && <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{meta}</span>}
      </div>
      {subtitle && <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>{subtitle}</p>}
      {children}

      {status !== 'idle' && (
        <div className="mr-panel" data-status={status === 'stopped' ? 'paused' : status} role="status" aria-live="polite">
          {busy ? (
            <>
              <div className="mr-line">
                <span className="spinner" aria-hidden="true" />
                <span className="mr-now">{(loop.step && STEP_WORDS[loop.step]) || (loop.step ? `Step: ${loop.step}` : 'Starting…')}</span>
                <span className="mr-clock">{clockLabel(loop.elapsedMs)} elapsed · {loop.ticks} unit{loop.ticks === 1 ? '' : 's'}</span>
              </div>
              {loop.lastLine && <p className="mr-leave" style={{ fontFamily: 'var(--font-mono)' }}>{loop.lastLine}</p>}
              <p className="mr-leave">You can leave this page: the run continues, the rail shows it, and a note appears when it finishes.</p>
            </>
          ) : (
            <p className={status === 'done' ? 'mr-done' : status === 'failed' ? 'mr-fail' : 'mr-paused'} style={{ margin: 0 }}>
              {status === 'done' ? '✓ Done' : status === 'failed' ? '✗ Stopped on an error' : '■ Paused'} after {clockLabel(loop.elapsedMs)} · {loop.ticks} unit{loop.ticks === 1 ? '' : 's'}
            </p>
          )}
          {loop.log.length > 0 && (
            <details className="mr-log" open={busy || status === 'failed'}>
              <summary>Run log ({loop.log.length})</summary>
              <pre>{loop.log.join('\n')}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
