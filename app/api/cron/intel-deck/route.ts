import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { runIntelDeck } from '@/lib/intel/deck-run';

// The company intel deck's cron driver: weekdays 16:20 UTC (vercel.json),
// after the Intel Desk's last window (sweep3 15:20 + a 700s budget ends by
// ~15:32) and before the Daily Edition's model legs at 16:45. Single-shot
// like the edition, idempotent on the day (runIntelDeck checks the day first).
// ?day=YYYY-MM-DD backfills or re-checks a specific day.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;
  const rawDay = req.nextUrl.searchParams.get('day');
  const dayParam = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined;
  try {
    const result = await runIntelDeck(dayParam);
    pingDeadman(process.env.HC_PING_URL_INTEL_DECK);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'intel deck error' });
  }
}
