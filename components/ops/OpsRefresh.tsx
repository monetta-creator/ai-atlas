'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sessionLost, refreshChromeOnce, chromeSessionAlive } from '@/lib/chrome-session-client';
import type { OpsStatus, OpsJobStatus, OpsState } from '@/lib/data/ops';

const POLL_MS = 60_000;

const FAMILY_LABEL: Record<string, string> = {
  engine: 'Engines',
  publisher: 'Publishers',
  sweep: 'Sweeps',
  agent: 'Agent',
  maintenance: 'Maintenance',
};

const FAMILY_ORDER = ['engine', 'publisher', 'sweep', 'agent', 'maintenance'];

function stateLabel(state: OpsState): string {
  switch (state) {
    case 'completed': return 'done';
    case 'running': return 'running';
    case 'failed': return 'failed';
    case 'paused': return 'paused';
    case 'off': return 'off today';
    default: return 'pending';
  }
}

function money(v: number | null): string {
  return typeof v === 'number' ? `$${v.toFixed(2)}` : '–';
}

function JobCard({ job }: { job: OpsJobStatus }) {
  return (
    <Link href={job.job.consoleHref} className="ops-card" data-state={job.state}>
      <div className="ops-card-head">
        <span className="ops-dot" data-state={job.state} aria-hidden="true" />
        <span className="ops-card-title">{job.job.label}</span>
        <span className="ops-card-state">{stateLabel(job.state)}</span>
      </div>
      <p className="ops-card-desc">{job.job.describe}</p>
      <div className="ops-card-meta">
        {job.lastRun ? (
          <span>{job.lastRun.summary ?? 'ran'}{job.lastRun.finishedAt ? ` · ${job.lastRun.day ?? ''}` : ''}</span>
        ) : (
          <span>no run yet</span>
        )}
        {job.tavilyWarning && <span className="ops-warning">{job.tavilyWarning}</span>}
      </div>
      {job.lastRun?.notes && job.lastRun.notes.length > 0 && (
        <ul className="ops-notes">
          {job.lastRun.notes.slice(0, 3).map((n, i) => (
            <li key={i} data-error={/fail|error/i.test(n)}>{n}</li>
          ))}
        </ul>
      )}
      <div className="ops-card-foot">
        {job.budgetCapUsd != null && (
          <span>{money(job.spendTodayUsd)} of {money(job.budgetCapUsd)}</span>
        )}
        <span>next {job.nextFireEt ?? '–'}</span>
      </div>
    </Link>
  );
}

interface TimelineEntry {
  key: string;
  label: string;
  at: string;
  atMinutesUtc: number;
  isFuture: boolean;
  state: OpsState;
}

function Timeline({ jobs }: { jobs: OpsJobStatus[] }) {
  const entries: TimelineEntry[] = [];
  for (const j of jobs) {
    for (const fire of j.todaysFiresEt) {
      entries.push({ key: j.job.key, label: j.job.label, at: fire.at, atMinutesUtc: fire.atMinutesUtc, isFuture: fire.isFuture, state: j.state });
    }
  }
  entries.sort((a, b) => a.atMinutesUtc - b.atMinutesUtc);
  if (!entries.length) return <p className="ops-empty">Nothing scheduled today.</p>;
  return (
    <ol className="ops-timeline">
      {entries.map((e, i) => (
        <li key={`${e.key}-${i}`} className={e.isFuture ? 'ops-tl-future' : 'ops-tl-past'}>
          <span className="ops-dot" data-state={e.isFuture ? 'pending' : e.state} aria-hidden="true" />
          <span className="ops-tl-time">{e.at}</span>
          <span className="ops-tl-label">{e.label}</span>
          <span className="ops-tl-tag">{e.isFuture ? 'next' : stateLabel(e.state)}</span>
        </li>
      ))}
    </ol>
  );
}

export default function OpsRefresh({ initialStatus }: { initialStatus: OpsStatus }) {
  const [status, setStatus] = useState<OpsStatus>(initialStatus);
  const [tick, setTick] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setTick((t) => t + 1);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (tick === 0) return; // the server-rendered initialStatus covers first paint
    let live = true;
    fetch('/api/ops/status', { cache: 'no-store' })
      .then((r) => {
        if (sessionLost(r)) { if (live) refreshChromeOnce(router, window.location.pathname); return Promise.reject(new Error('session')); }
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((data: OpsStatus) => { chromeSessionAlive(); if (live) setStatus(data); })
      .catch(() => { /* keep the last known status */ });
    return () => { live = false; };
  }, [tick, router]);

  const failed = status.failedToday;
  const paused = status.pausedCount;
  const ran = status.ranToday;
  const scheduled = status.scheduledToday;

  const families = FAMILY_ORDER.filter((f) => status.jobs.some((j) => j.job.family === f));

  return (
    <div className="ops-live">
      <p className="ops-status-line">
        {scheduled} scheduled today{' · '}{ran} ran{' · '}{failed} failed{' · '}{paused} paused
        {status.daily.degraded && ' · partial data'}
      </p>

      <section className="ops-section">
        <h2 className="ops-h2">Today</h2>
        <Timeline jobs={status.jobs} />
      </section>

      {families.map((family) => (
        <section key={family} className="ops-section">
          <h2 className="ops-h2">{FAMILY_LABEL[family] ?? family}</h2>
          <div className="ops-grid">
            {status.jobs.filter((j) => j.job.family === family).map((j) => (
              <JobCard key={j.job.key} job={j} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
