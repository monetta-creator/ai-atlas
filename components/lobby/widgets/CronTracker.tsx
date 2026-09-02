import Link from 'next/link';
import { getDailyJobStatus } from '@/lib/data';
import type { DailyJob, DailyJobStatus } from '@/lib/data';

// The star widget: is today's data ready, across the three checkpointed
// crons (scan, pipeline, intel)? "Considered" jobs exclude off/paused ones,
// so a weekend (all three off) or a manually-paused board still resolves to
// a clean headline rather than reading as stuck.

function headline(status: DailyJobStatus, considered: DailyJob[], doneCount: number): string {
  if (status.ready) {
    // On a weekend or with a subsystem paused, "ready" can mean one bonus
    // manual run: count the jobs that actually ran instead of claiming all.
    const scope =
      considered.length === status.jobs.length
        ? 'all jobs'
        : considered.length === 1
          ? `1 job (${considered[0].label.toLowerCase()})`
          : `${considered.length} jobs`;
    return `Today’s data is ready · ${scope} done by ${status.readyAtET} ET`;
  }
  if (considered.length === 0) {
    return status.weekend ? 'Weekend · crons scheduled off' : 'All jobs paused';
  }
  // Failed takes priority over running (matches the header dot's priority
  // below): a stalled job is the thing worth noticing first.
  const failed = considered.find((j) => j.state === 'failed');
  if (failed) {
    return `${doneCount} of ${considered.length} complete · ${failed.label} failed`;
  }
  const running = considered.find((j) => j.state === 'running');
  if (running) {
    return `${doneCount} of ${considered.length} complete · ${running.label} running (${running.step})`;
  }
  return `${doneCount} of ${considered.length} complete · waiting on the next cron`;
}

function jobSubline(job: DailyJob): string {
  switch (job.state) {
    case 'done': return `${job.detail ?? '–'} · done ${job.finishedAtET ?? '–'}`;
    case 'running': return `${job.detail ?? 'working'} · ${job.step ?? '–'}`;
    case 'failed': return `failed · ${job.error ?? '–'}`;
    case 'paused': return 'paused';
    case 'off': return 'off today';
    default: return 'not started';
  }
}

// The status row's day is a UTC date key; format it in UTC too so it never
// drifts a day off from the crons it's labeling.
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default async function CronTracker() {
  let status: DailyJobStatus;
  try {
    status = await getDailyJobStatus();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  const considered = status.jobs.filter((j) => j.state !== 'off' && j.state !== 'paused');
  const doneCount = considered.filter((j) => j.state === 'done').length;
  const anyFailed = considered.some((j) => j.state === 'failed');
  const anyRunning = considered.some((j) => j.state === 'running');
  const headState = status.ready ? 'done' : anyFailed ? 'failed' : anyRunning ? 'running' : 'pending';

  return (
    <>
      <div className="lw-head">Daily jobs</div>
      <div className="lw-cron-head">
        <span className="lw-dot" data-state={headState} aria-hidden="true" />
        <span>{headline(status, considered, doneCount)}</span>
        <span className="lw-cron-day">{dayLabel(status.day)}</span>
      </div>
      <div className="lw-jobs">
        {status.jobs.map((job) => (
          <Link key={job.key} href={job.console} className="lw-job">
            <span className="lw-job-label">
              <span className="lw-dot" data-state={job.state} aria-hidden="true" />
              {job.label}
              {job.yesterdayIncomplete && <span className="lw-stale">yesterday incomplete</span>}
            </span>
            <span className="lw-job-sub">{jobSubline(job)}</span>
          </Link>
        ))}
      </div>
      {status.ready && (
        <div className="lw-downloads">
          <span className="lw-downloads-label">Pass to the firewall:</span>
          <a href={`/api/datasets/external-scan?format=json&day=${status.day}&download=1`}>external-scan-{status.day}.json</a>
          <a href={`/api/datasets/signals-export?format=json&download=1`}>signals-export-{status.day}.json</a>
          <a href={`/api/datasets/intel-items?format=json&day=${status.day}&download=1`}>intel-items-{status.day}.json</a>
          <a href={`/api/datasets/intel-facts?format=json&download=1`}>intel-facts-{status.day}.json</a>
        </div>
      )}
    </>
  );
}
