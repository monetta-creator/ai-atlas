import type { NextRequest } from 'next/server';
import { getSavedReport } from '@/lib/data';
import { sanitizeReportNarrative } from '@/lib/sanitize';
import { renderPeriodPdf, periodPdfFilename } from '@/lib/pdf/period-doc';

// The branded PDF download for a saved period report. Public, like the read view
// at /reports/[id] (period reports have no publish gate: saving IS publication).
// Lives under /reports/* so the proxy allow-list already covers it (the matcher
// does not exempt /api, hence the page-prefix placement).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });
  const row = await getSavedReport(id);
  if (!row) return new Response('Not found', { status: 404 });
  const saved = { id: row.id, title: row.title, report: sanitizeReportNarrative(row.report) };

  const buf = await renderPeriodPdf(saved, req.nextUrl.origin);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${periodPdfFilename(saved)}"`,
      'cache-control': 'no-store',
    },
  });
}
