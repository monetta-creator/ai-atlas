import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { runNotebookDay } from '@/lib/savant/notebook';

// Savant's weekday notebook pass: 17:15 UTC (vercel.json), after the Daily
// Edition's press, so the day's engines and paper are in. Single-shot and
// idempotent on the day (every notebook entry upserts on its dedupe key).
// ?day=YYYY-MM-DD backfills a specific day (a weekend day is allowed there;
// the scheduled call never runs one). Same gate as every cron route: Bearer
// CRON_SECRET, failing closed when unset; proxy.ts allow-lists `/api/cron/`.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;
  const rawDay = req.nextUrl.searchParams.get('day');
  const day = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : new Date().toISOString().slice(0, 10);
  if (!rawDay) {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) return Response.json({ skipped: 'weekend' });
  }
  try {
    const result = await runNotebookDay(day);
    pingDeadman(process.env.HC_PING_URL_SAVANT);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'savant error' });
  }
}
