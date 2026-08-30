import { isAdmin } from '@/lib/auth';
import { buildCostDeckData } from '@/lib/costs-deck';
import { renderCostDeckPdf, costDeckPdfFilename } from '@/lib/pdf/costs-deck';

// The 16:9 PDF export of the cost deck. Admin-only, unlike the report PDFs
// under /reports/*: this bill breaks down real spend and isn't meant for the
// public reader surface, so the gate lives in-route rather than riding the
// proxy allow-list.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  if (!(await isAdmin())) return new Response('Not authorized.', { status: 401 });

  const deck = await buildCostDeckData();
  const buf = await renderCostDeckPdf(deck);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${costDeckPdfFilename(deck)}"`,
      'cache-control': 'no-store',
    },
  });
}
