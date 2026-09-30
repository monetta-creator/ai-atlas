import type { NextRequest } from 'next/server';
import { cronGate, pingDeadman } from '@/lib/cron/shared';
import { runPackBriefs } from '@/lib/context-pack/briefs';

// The Briefcase's weekly cron: Mondays 17:40 UTC (vercel.json), after the
// Intel Desk's last window and its Monday metrics pull, so the week's briefs
// are written from the freshest rows. Writes the section briefs of every
// company with a public record (lib/context-pack/briefs.ts); the packs
// themselves are rendered on download and need no cron. Idempotent on the
// week: a second call writes only what is missing. ?week=YYYY-MM-DD names an
// issue week (its Friday), ?company=<slug> one company, ?force=1 rewrites.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const week = sp.get('week');
  const company = sp.get('company');
  try {
    const result = await runPackBriefs({
      weekEnd: week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : undefined,
      company: company && /^[a-z0-9-]{1,64}$/.test(company) ? company : undefined,
      force: sp.get('force') === '1',
      deadlineMs: 240_000,
      actor: 'cron',
    });
    if (!result.partial) pingDeadman(process.env.HC_PING_URL_CONTEXT_PACK);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'context pack error' });
  }
}
