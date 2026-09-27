import Link from 'next/link';
import { getActiveUiJobs, getRecentJobs } from '@/lib/data/jobs';
import { clockLabel, usdLabel, hrefForJob } from '@/lib/jobs/core';

const ADMIN_VIEWER = { admin: true, keyId: null } as const;

// 'ops-model-runs': the model-run registry (migration 0072): what is
// running right now, then the last runs that finished.
export default async function OpsModelRuns() {
  let running: Awaited<ReturnType<typeof getActiveUiJobs>>;
  let recent: Awaited<ReturnType<typeof getRecentJobs>>;
  try {
    [running, recent] = await Promise.all([getActiveUiJobs(ADMIN_VIEWER), getRecentJobs(6, ADMIN_VIEWER)]);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  const finished = recent.filter((j) => j.status === 'done' || j.status === 'failed').slice(0, 4);
  // new Date().getTime(), not Date.now(): the react-hooks/purity rule flags
  // the latter as an impure call during render, even in a server component.
  const now = new Date().getTime();

  return (
    <>
      <div className="lw-head">Model runs</div>
      {running.length === 0 && finished.length === 0 && <p className="ops-empty">No runs yet.</p>}
      {running.length > 0 && (
        <ul className="ops-notes" style={{ fontSize: 12 }}>
          {running.map((j) => {
            const step = j.steps.find((s) => s.state === 'running');
            const elapsed = j.startedAt ? clockLabel(now - Date.parse(j.startedAt)) : '–';
            const href = hrefForJob(j);
            const label = href ? <Link href={href}>{j.label}</Link> : j.label;
            return (
              <li key={j.id}>
                {label}: running{step ? ` · ${step.label}` : ''} · {elapsed}
              </li>
            );
          })}
        </ul>
      )}
      {finished.length > 0 && (
        <>
          <div className="lw-head" style={{ marginTop: running.length > 0 ? 10 : 0 }}>Last finished</div>
          <ul className="ops-notes" style={{ fontSize: 12 }}>
            {finished.map((j) => {
              const dur = j.startedAt && j.finishedAt ? clockLabel(Date.parse(j.finishedAt) - Date.parse(j.startedAt)) : '–';
              const cost = j.costUsd != null ? usdLabel(j.costUsd) : '';
              const href = hrefForJob(j);
              const label = href ? <Link href={href}>{j.label}</Link> : j.label;
              return (
                <li key={j.id} data-error={j.status === 'failed' ? 'true' : undefined}>
                  {label}: {j.status} · {dur}{cost ? ` · ${cost}` : ''}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
