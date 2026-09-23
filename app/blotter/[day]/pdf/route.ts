import type { NextRequest } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getEditionForDay } from '@/lib/data';
import { buildEditionDeck } from '@/lib/edition/deck';
import { renderCostDeckPdf } from '@/lib/pdf/costs-deck';
import { dateLabel } from '@/lib/format';

// The 16:9 deck PDF export of one day's Daily Edition. Public once the
// edition is published; an admin (out of preview elsewhere is irrelevant
// here, there is no preview flag on a Route Handler) may also pull an
// unpublished day to check a run before it goes live, same gate as
// app/blotter/[day]/page.tsx.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shape AND calendar: '2026-02-30' passes the regex but Postgres throws on
// the ::date cast, which would 500 instead of 404.
function isRealDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ day: string }> }): Promise<Response> {
  const { day } = await ctx.params;
  if (!isRealDay(day)) return new Response('Not found', { status: 404 });

  const edition = await getEditionForDay(day);
  if (!edition) return new Response('Not found', { status: 404 });
  const admin = await isAdmin();
  if (!(edition.is_published || admin)) return new Response('Not found', { status: 404 });

  const origin = req.nextUrl.origin || process.env.APP_BASE_URL || '';
  const deck = buildEditionDeck(edition, origin);
  const buf = await renderCostDeckPdf(deck, {
    footerLabel: `DAILY EDITION · ${dateLabel(day)}`,
    docTitle: `Daily edition, ${dateLabel(day)}, The AI Atlas`,
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="atlas-edition-${day}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
