import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { getAgentPrefs } from '@/lib/data/agent';
import { runAgentTick } from '@/lib/agent/runner';

// The Atlas Agent's hourly tick: run every sensor check, then any due
// auto-tier remedies. No brief here (see ./brief/route.ts): every day,
// weekends included, because queue aging doesn't take weekends off and every
// check is plain SQL, no model call. Same gate as every cron route: Bearer
// CRON_SECRET, failing closed when unset; covered by proxy.ts's `/api/cron/`
// prefix allow-list.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;

  const prefs = await getAgentPrefs();
  if (!prefs.enabled) {
    return Response.json({ done: true, skipped: 'agent paused (the /agent toggle re-enables it)' });
  }

  try {
    const result = await runAgentTick({ brief: false });
    pingDeadman(process.env.HC_PING_URL_AGENT);
    return Response.json({ done: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'agent tick error';
    return Response.json({ done: false, error: msg });
  }
}
