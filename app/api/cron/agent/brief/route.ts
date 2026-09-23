import type { NextRequest } from 'next/server';
import { getAgentPrefs } from '@/lib/data/agent';
import { runAgentTick } from '@/lib/agent/runner';

// The Atlas Agent's daily brief: the same tick as the hourly cron (checks,
// then auto remedies) plus the morning memo, once a day at 12:30 UTC (08:30
// ET, after the morning cron windows have reported in). Same gate as every
// cron route: Bearer CRON_SECRET, failing closed when unset; covered by
// proxy.ts's `/api/cron/` prefix allow-list.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function pingDeadman(url: string | undefined): void {
  if (url) fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => {});
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const prefs = await getAgentPrefs();
  if (!prefs.enabled) {
    return Response.json({ done: true, skipped: 'agent paused (the /agent toggle re-enables it)' });
  }

  try {
    const result = await runAgentTick({ brief: true });
    pingDeadman(process.env.HC_PING_URL_AGENT);
    return Response.json({ done: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'agent brief error';
    return Response.json({ done: false, error: msg });
  }
}
