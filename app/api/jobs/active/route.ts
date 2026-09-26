import { identityFromRequest } from '@/lib/portal/identity';
import { getActiveUiJobs, getRecentFinishedJobs } from '@/lib/data/jobs';
import { jobViewerFor } from '@/lib/jobs/core';

// Polled by the rail's run indicator (components/jobs/JobsIndicator.tsx):
// the jobs running now and the ones that finished in the last two minutes
// (the toast source). The admin sees every job and the engines at work; a
// keyholder sees only jobs they started. On the proxy's public prefix list
// because keyholders carry no admin/guest cookie; the gate is here.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request): Promise<Response> {
  const viewer = jobViewerFor(await identityFromRequest(req));
  if (!viewer.admin && !viewer.keyId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const [active, finishedSince] = await Promise.all([
    getActiveUiJobs(viewer),
    getRecentFinishedJobs(since, viewer),
  ]);
  return Response.json({ now: new Date().toISOString(), active, finishedSince }, { headers: NO_STORE });
}
