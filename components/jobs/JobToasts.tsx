'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useJobs } from '@/lib/jobs/jobs-store';
import { clockLabel, hrefForJob, usdLabel, type UiJob } from '@/lib/jobs/core';

// Completion notes for runs (2026-09-27): when a run that took a while ends,
// done or failed, a toast says so wherever the reader is now, with a link to
// the result. Short runs (under 30s) finish in front of the reader and get
// no toast; a failed run always does. Rendered once from the Header, outside
// the rail, so it shows on phones too. Shown-once bookkeeping in
// localStorage, the AgentToasts idiom.

const TOASTED_KEY = 'atlas_jobs_toasted_v1';
const MAX_TOASTS = 3;
const DISMISS_MS = 12000;
const QUIET_UNDER_MS = 30_000;

function readToasted(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(TOASTED_KEY) ?? '[]')); } catch { return new Set(); }
}
function writeToasted(set: Set<string>): void {
  try { localStorage.setItem(TOASTED_KEY, JSON.stringify([...set].slice(-300))); } catch { /* private mode */ }
}

function worthAToast(j: UiJob): boolean {
  if (j.status === 'failed') return true;
  const a = j.startedAt ? Date.parse(j.startedAt) : NaN;
  const b = j.finishedAt ? Date.parse(j.finishedAt) : NaN;
  return !(Number.isFinite(a) && Number.isFinite(b)) || b - a >= QUIET_UNDER_MS;
}

function duration(j: UiJob): string {
  const a = j.startedAt ? Date.parse(j.startedAt) : NaN;
  const b = j.finishedAt ? Date.parse(j.finishedAt) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) ? clockLabel(b - a) : '';
}

export default function JobToasts({ enabled }: { enabled: boolean }) {
  const { finished } = useJobs(enabled);
  const [toasts, setToasts] = useState<UiJob[]>([]);

  useEffect(() => {
    if (!finished.length) return;
    const toasted = readToasted();
    const fresh = finished.filter((j) => !toasted.has(j.id) && worthAToast(j)).slice(0, MAX_TOASTS);
    for (const j of finished) toasted.add(j.id);
    writeToasted(toasted);
    if (!fresh.length) return;
    // Deferred a tick: no setState directly in an effect body.
    const id = window.setTimeout(() => setToasts((prev) => [...prev, ...fresh].slice(-MAX_TOASTS)), 0);
    return () => window.clearTimeout(id);
  }, [finished]);

  useEffect(() => {
    if (!toasts.length) return;
    const id = window.setTimeout(() => setToasts((prev) => prev.slice(1)), DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [toasts]);

  if (!toasts.length) return null;

  return (
    <div className="ag-toast-stack" role="status" aria-live="polite">
      {toasts.map((j) => {
        const href = hrefForJob(j);
        const ok = j.status === 'done';
        const tail = [duration(j), ok && j.costUsd ? usdLabel(j.costUsd) : ''].filter(Boolean).join(' · ');
        return (
          <div key={j.id} className="ag-toast" data-tone={ok ? 'done' : 'failed'}>
            <span className="ag-toast-title">
              {ok ? '✓ ' : '✗ '}{j.label} {ok ? 'finished' : 'failed'}{tail ? ` (${tail})` : ''}
              {!ok && j.error ? `: ${j.error.slice(0, 120)}` : ''}
            </span>
            <div className="ag-toast-actions">
              {href && <Link href={href} className="btn btn--quiet btn--sm">Open</Link>}
              <button type="button" className="ag-toast-x" aria-label="Dismiss"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== j.id))}>✕</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
