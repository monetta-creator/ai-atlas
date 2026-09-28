import { isAdmin } from '@/lib/auth';
import { getOpsStatus } from '@/lib/data/ops';

// The /ops board no longer polls (2026-09-28): it reads fresh on each page
// load. This route stays for scripts and any other caller that wants the
// status JSON directly. Admin-only, no-store: the same gate idiom as
// /api/agent/pulse and /api/nav/counts.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (!(await isAdmin())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const status = await getOpsStatus();
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
