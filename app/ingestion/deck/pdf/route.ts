import { isAdmin } from '@/lib/auth';
import { buildStoryDeckData } from '@/lib/story-deck';
import { renderCostDeckPdf } from '@/lib/pdf/costs-deck';

// The ingestion story deck as a 16:9 PDF (the shareable artifact). Admin
// only, like the cost deck's export: this route is NOT on the proxy
// allow-list and additionally gates in-route.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  if (!(await isAdmin())) {
    return new Response('Not authorized.', { status: 401 });
  }
  const deck = await buildStoryDeckData();
  const buf = await renderCostDeckPdf(deck, {
    footerLabel: 'THE 1000X QUESTION',
    docTitle: 'The 1000x question, The AI Atlas',
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ingestion-story-${deck.generatedOn}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
