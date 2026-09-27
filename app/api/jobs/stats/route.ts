import { identityFromRequest } from '@/lib/portal/identity';
import { getFeatureStats } from '@/lib/data/jobs';
import { jobViewerFor } from '@/lib/jobs/core';

// The usual time and cost per model feature (medians over 180 days of
// ai_cost_log), fetched once per session by lib/jobs/stats-client.ts so every
// run panel and model-call button can say "usually about 40s, $0.03" without
// each page threading the numbers down. Admin and keyholders only: the
// numbers describe the site's own model spend.
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const viewer = jobViewerFor(await identityFromRequest(req));
  if (!viewer.admin && !viewer.keyId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const stats = await getFeatureStats();
  return Response.json(stats, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
