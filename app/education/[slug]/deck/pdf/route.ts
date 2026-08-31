import type { NextRequest } from 'next/server';
import { getGuide } from '@/lib/education/registry';
import { getGuideDeck, guideDeckPdfFilename } from '@/lib/education/decks';
import { renderCostDeckPdf } from '@/lib/pdf/costs-deck';

// The 16:9 PDF export of a guide deck. Public, unlike the cost/ingestion
// deck exports: guides are reader-facing content, so there is no isAdmin
// gate here (the route already lives on the proxy's /education allow-list).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await ctx.params;
  const guide = getGuide(slug);
  const builder = getGuideDeck(slug);
  if (!guide || !builder) return new Response('Not found', { status: 404 });

  const deck = builder();
  const buf = await renderCostDeckPdf(deck, {
    footerLabel: `EDUCATION · ${guide.kicker}`,
    docTitle: `${guide.title}, The AI Atlas`,
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${guideDeckPdfFilename(slug)}"`,
      'cache-control': 'no-store',
    },
  });
}
