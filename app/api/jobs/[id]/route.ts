import { identityFromRequest } from '@/lib/portal/identity';
import { getUiJob } from '@/lib/data/jobs';
import { jobViewerFor } from '@/lib/jobs/core';

// One job, polled every 2s by the run panel while a long server-side run
// (a Savant issue) moves its own steps. Same gate as /api/jobs/active; a job
// the caller may not see reads as not found.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const viewer = jobViewerFor(await identityFromRequest(req));
  if (!viewer.admin && !viewer.keyId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const job = await getUiJob(id, viewer);
  if (!job) return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  return Response.json(job, { headers: NO_STORE });
}
