'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathnameChange } from '@/lib/use-route-change';
import { useJobs } from '@/lib/jobs/jobs-store';
import { clockLabel, hrefForJob, type UiJob } from '@/lib/jobs/core';

// The rail's run indicator (2026-09-27): appears only while something runs,
// a spinning mark with a count; a click lists the runs (label, current step,
// elapsed) with a link to each one's page. Admin sees every run including the
// engines at work; a keyholder sees only the runs they started.

function currentStep(job: UiJob): string {
  const s = job.steps.find((x) => x.state === 'running');
  if (s) return s.note ? `${s.label} · ${s.note}` : s.label;
  return job.status === 'queued' ? 'Paused, resumes on the next run' : 'Starting…';
}

function elapsed(job: UiJob, nowMs: number): string {
  const t = job.startedAt ? Date.parse(job.startedAt) : NaN;
  return Number.isFinite(t) ? clockLabel(nowMs - t) : '';
}

export default function JobsIndicator({ enabled }: { enabled: boolean }) {
  const { active } = useJobs(enabled);
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  usePathnameChange(() => setOpen(false));

  if (!active.length) return null;
  const running = active.filter((j) => j.status === 'running');

  return (
    <div className="portal-rail-item">
      <button
        type="button"
        className="portal-rail-link"
        data-tip={`${active.length} run${active.length === 1 ? '' : 's'} in progress`}
        aria-label={`${active.length} run${active.length === 1 ? '' : 's'} in progress`}
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setOpenedAt(Date.now()); }}
      >
        {running.length ? <span className="spinner jobs-spin" aria-hidden="true" /> : <span aria-hidden="true">⏸</span>}
        <span className="portal-rail-label">Running</span>
        <span className="jobs-badge">{active.length}</span>
      </button>
      {open && (
        <div className="jobs-pop" role="dialog" aria-label="Runs in progress">
          <p className="jobs-pop-head">In progress</p>
          {active.map((j) => {
            const href = hrefForJob(j);
            const body = (
              <>
                <span className="jobs-row-label">
                  {j.status === 'running' ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">⏸</span>}
                  {j.label}
                </span>
                <span className="jobs-row-sub">
                  <span>{currentStep(j)}</span>
                  <span className="mr-clock">{elapsed(j, openedAt)}</span>
                </span>
              </>
            );
            return href ? (
              <Link key={j.id} href={href} className="jobs-row">{body}</Link>
            ) : (
              <div key={j.id} className="jobs-row">{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
