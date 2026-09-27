import Link from 'next/link';
import type { OpsJobStatus, OpsState } from '@/lib/data/ops';

// Shared, server-safe pieces for the ops board widgets: the family
// grouping, the job card, the timeline, and their small formatters. Lifted
// out of the old OpsRefresh client island (now OpsBoardRefresh, which only
// polls) so OpsJobs.tsx and OpsTimeline.tsx can render them as plain server
// components with no hooks.

export const FAMILY_LABEL: Record<string, string> = {
  engine: 'Engines',
  publisher: 'Publishers',
  sweep: 'Sweeps',
  agent: 'Agent',
  maintenance: 'Maintenance',
};

export const FAMILY_ORDER = ['engine', 'publisher', 'sweep', 'agent', 'maintenance'];

export function stateLabel(state: OpsState): string {
  switch (state) {
    case 'completed': return 'done';
    case 'running': return 'running';
    case 'failed': return 'failed';
    case 'paused': return 'paused';
    case 'off': return 'off today';
    default: return 'pending';
  }
}

export function money(v: number | null): string {
  return typeof v === 'number' ? `$${v.toFixed(2)}` : '–';
}

export function JobCard({ job }: { job: OpsJobStatus }) {
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

const REPEATING_AFTER = 6;

export function Timeline({ jobs }: { jobs: OpsJobStatus[] }) {
  const entries: TimelineEntry[] = [];
  const repeating: { key: string; label: string; count: number; next: string | null }[] = [];
  for (const j of jobs) {
    // An hourly job (the agent tick) would fill the strip with 24 identical
    // rows; it gets one line above the list with its next fire instead.
    if (j.todaysFiresEt.length > REPEATING_AFTER) {
      const next = j.todaysFiresEt.find((f) => f.isFuture);
      repeating.push({ key: j.job.key, label: j.job.label, count: j.todaysFiresEt.length, next: next?.at ?? null });
      continue;
    }
    for (const fire of j.todaysFiresEt) {
      entries.push({ key: j.job.key, label: j.job.label, at: fire.at, atMinutesUtc: fire.atMinutesUtc, isFuture: fire.isFuture, state: j.state });
    }
  }
  entries.sort((a, b) => a.atMinutesUtc - b.atMinutesUtc);
  if (!entries.length && !repeating.length) return <p className="ops-empty">Nothing scheduled today.</p>;
  return (
    <>
    {repeating.map((r) => (
      <p key={r.key} className="ops-tl-repeat">
        {r.label}: {r.count} runs today{r.next ? `, next ${r.next}` : ''}
      </p>
    ))}
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
    </>
  );
}
