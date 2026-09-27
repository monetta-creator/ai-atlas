import { getOpsStatus } from '@/lib/data/ops';
import { FAMILY_LABEL, FAMILY_ORDER, JobCard } from './shared';

// 'ops-jobs': every registered job, grouped by family, as the card grid.
export default async function OpsJobs() {
  let status: Awaited<ReturnType<typeof getOpsStatus>>;
  try {
    status = await getOpsStatus();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  const families = FAMILY_ORDER.filter((f) => status.jobs.some((j) => j.job.family === f));

  return (
    <>
      <div className="lw-head">Jobs</div>
      <p className="ops-status-line">
        {status.scheduledToday} scheduled today{' · '}{status.ranToday} ran{' · '}{status.failedToday} failed{' · '}{status.pausedCount} paused
        {status.daily.degraded && ' · partial data'}
      </p>
      {families.map((family) => (
        <div key={family} style={{ marginBottom: 16 }}>
          <div className="ops-h2">{FAMILY_LABEL[family] ?? family}</div>
          <div className="ops-grid">
            {status.jobs.filter((j) => j.job.family === family).map((j) => (
              <JobCard key={j.job.key} job={j} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
