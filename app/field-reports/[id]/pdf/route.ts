import type { NextRequest } from 'next/server';
import { identityFromRequest } from '@/lib/portal/identity';
import { jobViewerFor } from '@/lib/jobs/core';
import { getFieldReport } from '@/lib/data';
import { renderFieldReportPdf, fieldReportPdfFilename } from '@/lib/pdf/field-report-doc';

// The branded PDF download for one Field Report: gated exactly like the
// page (admin, or the report's own keyholder, or any keyholder once it is
// published) via identityFromRequest, 404 for anyone else, same shape as
// the Savant and company-intel-deck PDF routes.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });

  const identity = await identityFromRequest(req);
  const viewer = jobViewerFor(identity);
  const saved = await getFieldReport(id, viewer);
  if (!saved) return new Response('Not found', { status: 404 });

  const origin = req.nextUrl.origin || process.env.APP_BASE_URL || '';
  const buf = await renderFieldReportPdf(saved, origin);

  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${fieldReportPdfFilename(id)}"`,
      'cache-control': 'no-store',
    },
  });
}
