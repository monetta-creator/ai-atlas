'use client';

import { useEffect, useRef, useState } from 'react';
import type { UiJob } from '@/lib/jobs/core';
import { useModelRun } from '@/lib/jobs/use-model-run';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';
import type { FieldReportPlan, FieldReportRunStatus, FieldReportSize } from '@/lib/field-report/core';
import { fieldReportSteps } from '@/lib/field-report/core';
import type { FieldReportState } from '@/components/ask/store';

// The live run (2026-09-28): the server does the actual work in the
// background (POST /api/field-report/run answers at once with a job id and
// keeps going in `after()`), so this card's only job is to watch. It polls
// GET /api/jobs/<jobId> itself, on a plain interval, for the WHOLE lifetime
// of the card; that single poll is the source of truth for whether the run is
// still starting, actively working, paused (parked past its time budget, or
// simply not yet begun), done, or failed. useModelRun/ModelRunPanel is used
// only for the "actively working" visual (steps, elapsed clock, progress
// bar): it is remounted on every fresh snapshot (key = job id + updatedAt),
// so its own internal poll-and-resume machinery is never relied on and its
// `run` callback is never invoked, since calling it would incorrectly mark
// the ui_jobs row "done" from the client with nothing to show for it. Resume
// and Try again both call POST /api/field-report/run directly.
export default function FieldReportRunCard({
  runId, jobId, plan, size, onUpdate,
}: {
  runId: string;
  jobId: string;
  plan: FieldReportPlan | undefined;
  size: FieldReportSize | undefined;
  onUpdate: (patch: Partial<FieldReportState>) => void;
}) {
  const [job, setJob] = useState<UiJob | null>(null);
  const [tick, setTick] = useState(0);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const doneHandledRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 2500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`/api/jobs/${jobId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: UiJob | null) => { if (live && j) setJob(j); })
      .catch(() => { /* the next tick retries */ });
    return () => { live = false; };
  }, [jobId, tick]);

  // Once the job reports done, fetch the saved report and hand the message
  // off to the 'done' stage; the parent swaps this card for FieldReportCard.
  useEffect(() => {
    if (!job || job.status !== 'done' || doneHandledRef.current) return;
    doneHandledRef.current = true;
    fetch(`/api/field-report/${runId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FieldReportRunStatus | null) => {
        if (data?.report) onUpdate({ stage: 'done', report: data.report });
        else onUpdate({ stage: 'error', error: 'The report finished but could not be loaded. Reload the page to try again.' });
      })
      .catch(() => onUpdate({ stage: 'error', error: 'The report finished but could not be loaded. Reload the page to try again.' }));
  }, [job, runId, onUpdate]);

  async function resumeOrRetry() {
    if (!plan || !size) return;
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch('/api/field-report/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, plan, size }),
      });
      const data = (await res.json().catch(() => null)) as { runId?: string; jobId?: string; error?: string } | null;
      if (!res.ok || !data?.jobId) {
        setResumeError((data && typeof data.error === 'string' && data.error) || 'Could not resume the run. Please try again.');
        return;
      }
      if (data.jobId !== jobId) {
        onUpdate({ jobId: data.jobId, runId: data.runId ?? runId });
      } else {
        doneHandledRef.current = false;
        setJob(null);
        setTick((t) => t + 1);
      }
    } catch {
      setResumeError('Could not resume the run. Please try again.');
    } finally {
      setResuming(false);
    }
  }

  if (!job) {
    return <p className="fr-pending"><span className="spinner" aria-hidden="true" /> Starting the run…</p>;
  }

  const hasProgress = job.steps.some((s) => s.state !== 'todo');

  if (job.status === 'queued' && !hasProgress) {
    return <p className="fr-pending"><span className="spinner" aria-hidden="true" /> Starting the run…</p>;
  }

  if (job.status === 'queued') {
    const done = job.steps.filter((s) => s.state === 'done').length;
    return (
      <div className="fr-run fr-run--paused">
        <p>Paused partway through, {done} of {job.steps.length} steps done.</p>
        {resumeError && <p className="fr-error">{resumeError}</p>}
        <button type="button" className="btn btn--quiet btn--sm" disabled={resuming} onClick={() => void resumeOrRetry()}>
          {resuming ? 'Resuming…' : 'Resume'}
        </button>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="fr-run fr-run--failed">
        <p>{job.error ?? 'The run failed.'}</p>
        {resumeError && <p className="fr-error">{resumeError}</p>}
        <button type="button" className="btn btn--quiet btn--sm" disabled={resuming} onClick={() => void resumeOrRetry()}>
          {resuming ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    );
  }

  return (
    <FieldReportRunPanelView
      key={`${job.id}:${job.updatedAt}`}
      job={job}
      size={size ?? 'brief'}
      planTitle={plan?.title ?? job.label}
    />
  );
}

// The presentational half: one fresh useModelRun instance per polled
// snapshot, purely to drive ModelRunPanel's stepper/clock/progress bar.
function FieldReportRunPanelView({ job, size, planTitle }: { job: UiJob; size: FieldReportSize; planTitle: string }) {
  const run = useModelRun({
    kind: 'field_report',
    subject: job.subject ?? job.id,
    label: planTitle,
    steps: fieldReportSteps(size),
    initialJob: job,
    mode: 'poll',
    run: async () => ({}),
  });
  return <ModelRunPanel run={run} doneLabel="Open the report" />;
}
