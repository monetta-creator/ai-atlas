import type { NextRequest } from 'next/server';
import { identityFromRequest } from '@/lib/portal/identity';
import { getIntelDeckForDay } from '@/lib/data/intel-deck';
import { buildIntelDeck } from '@/lib/intel/deck-pure';
import { renderCostDeckPdf } from '@/lib/pdf/costs-deck';
import { dateLabel } from '@/lib/format';
import { isRealDay } from '@/lib/route-shapes';
import { logPortalUsage } from '@/lib/mutations/portal';

// The 16:9 PDF of one day's company intel deck. Portal-only like the stage:
// an access-key holder (cookie or Authorization/X-Atlas-Key header) or the
// admin; everyone else gets a 404 so the company names never leak through the
// PDF route. Network-free at render time: the logos were baked onto the pack.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ day: string }> }): Promise<Response> {
  const { day } = await ctx.params;
  if (!isRealDay(day)) return new Response('Not found', { status: 404 });
  const identity = await identityFromRequest(req);
  if (!(identity.tier === 'admin' || identity.active)) return new Response('Not found', { status: 404 });

  const saved = await getIntelDeckForDay(day);
  if (!saved || (!saved.is_published && identity.tier !== 'admin')) return new Response('Not found', { status: 404 });

  const origin = req.nextUrl.origin || process.env.APP_BASE_URL || '';
  const deck = buildIntelDeck(saved, origin);
  const buf = await renderCostDeckPdf(deck, {
    footerLabel: `COMPANY INTEL DECK · ${dateLabel(day)}`,
    docTitle: `Company intel deck, ${dateLabel(day)}, The AI Atlas`,
  });
  if (identity.tier !== 'none') {
    logPortalUsage({ keyId: identity.keyId, identity: identity.tier === 'key' ? 'key' : identity.tier === 'legacy' ? 'legacy' : 'admin', kind: 'deck', datasetSlug: `intel-deck:${day}`, bytes: buf.length, status: 200, ua: req.headers.get('user-agent') });
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="atlas-company-intel-${day}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
