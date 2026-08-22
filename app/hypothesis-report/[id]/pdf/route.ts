import type { NextRequest } from 'next/server';
import { getHypothesisReport } from '@/lib/data';
import { gateHypothesisNarrative } from '@/lib/hypothesis/citations';
import { renderHypothesisPdf, hypothesisPdfFilename } from '@/lib/pdf/hypothesis-doc';

// The branded PDF download for a saved hypothesis report. Public like the read
// view (hypothesis reports are public-by-URL; the console mints the links); the
// narrative is re-gated against the frozen pack before rendering.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });
  const row = await getHypothesisReport(id);
  if (!row) return new Response('Not found', { status: 404 });

  const narrative = gateHypothesisNarrative(row.narrative, row.pack);
  const buf = await renderHypothesisPdf(row, narrative, req.nextUrl.origin);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${hypothesisPdfFilename(row)}"`,
      'cache-control': 'no-store',
    },
  });
}
