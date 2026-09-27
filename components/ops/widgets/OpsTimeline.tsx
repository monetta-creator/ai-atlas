import { getOpsStatus } from '@/lib/data/ops';
import { Timeline } from './shared';

// 'ops-timeline': every job's fire times today, past and next, in one strip.
export default async function OpsTimeline() {
  let status: Awaited<ReturnType<typeof getOpsStatus>>;
  try {
    status = await getOpsStatus();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  return (
    <>
      <div className="lw-head">Today’s timeline</div>
      <Timeline jobs={status.jobs} />
    </>
  );
}
