import type { NextRequest } from 'next/server';
import { getThesisReport } from '@/lib/data';
import { gateThesisNarrative } from '@/lib/thesis/citations';
import { renderThesisPdf, thesisPdfFilename } from '@/lib/pdf/thesis-doc';

// The branded PDF download for a saved thesis report. Public like the read view
// (thesis reports are public-by-URL; the /theses console mints the links); the
// narrative is re-gated against the frozen pack before rendering.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });
  const row = await getThesisReport(id);
  if (!row) return new Response('Not found', { status: 404 });

  const narrative = gateThesisNarrative(row.narrative, row.pack);
  const buf = await renderThesisPdf(row, narrative, req.nextUrl.origin);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${thesisPdfFilename(row)}"`,
      'cache-control': 'no-store',
    },
  });
}
