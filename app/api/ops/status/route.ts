import { isAdmin } from '@/lib/auth';
import { getOpsStatus } from '@/lib/data/ops';

// Polled every 60s by the /ops page's OpsRefresh island so the timeline and
// job cards track running/failed jobs without a full reload. Admin-only,
// no-store: the same gate idiom as /api/agent/pulse and /api/nav/counts.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (!(await isAdmin())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const status = await getOpsStatus();
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
