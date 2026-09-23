import type { NextRequest } from 'next/server';
import { runDailyEdition } from '@/lib/edition/run';

// The daily edition's cron driver: weekdays 16:45 UTC (vercel.json), after
// research's last window. Single-shot like the weekly roundup
// (app/api/cron/roundup/route.ts), idempotent on the day (runDailyEdition
// checks getEditionForDay first). Same gate as every cron route: Bearer
// CRON_SECRET, failing closed when unset; covered by proxy.ts's `/api/cron/`
// prefix allow-list (no route-by-route entry needed).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Optional healthchecks.io-style dead-man ping (the scan/pipeline/intel/
// research convention, e.g. app/api/cron/scan/route.ts's pingDeadman):
// fire-and-forget, fired only when the run actually finished, never on error.
function pingDeadman(url: string | undefined): void {
  if (url) fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => {});
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  // ?day=YYYY-MM-DD writes (or re-checks) a specific edition: backfills and
  // the maintainer's manual runs. Same idempotency as the daily call.
  const rawDay = req.nextUrl.searchParams.get('day');
  const dayParam = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined;
  try {
    const result = await runDailyEdition(dayParam);
    pingDeadman(process.env.HC_PING_URL_EDITION);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'edition error' });
  }
}
