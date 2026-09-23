import { isAdmin } from '@/lib/auth';
import { getAgentPulse } from '@/lib/data';

// Polled every 60s by the rail orb (components/agent/AgentOrb.tsx) to paint
// the unread badge and drive the toast stack. Admin-only, no-store: the
// count must always reflect the latest check run, never a cached one.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (!(await isAdmin())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const pulse = await getAgentPulse();
  return Response.json(pulse, { headers: { 'Cache-Control': 'no-store' } });
}
