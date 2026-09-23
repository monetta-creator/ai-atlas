import type { NextRequest } from 'next/server';
import { isAdmin, isPortal } from '@/lib/auth';
import { getGeneratedReport } from '@/lib/data';
import { isPortalOnlyKind } from '@/lib/reports/access';
import { renderSheetPdf, sheetPdfFilename } from '@/lib/pdf/sheet-doc';

// The branded PDF download for a generated report. Public ONLY once the report
// is published (the human gate); drafts render for the admin alone, EXCEPT the
// four tooling report kinds, which a portal keyholder may also read as a draft
// (the /tooling/reports console never auto-publishes a landscape/brief/
// features report). Lives under /reports/* so the proxy allow-list already
// covers it (the matcher does not exempt /api, hence the page-prefix
// placement). includeInternal (admin or portal) is the only thing that turns
// on a build-vs-buy brief's internal-context block in the PDF.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });
  const saved = await getGeneratedReport(id);
  if (!saved) return new Response('Not found', { status: 404 });
  const admin = await isAdmin();
  const isTooling = String(saved.kind).startsWith('tooling_');
  const keyed = await isPortal(); // revocation-aware (lib/auth.ts)
  // Portal-only kinds (lib/reports/access.ts) name tracked companies: a
  // guest gets a 404 even when the row is published.
  if (isPortalOnlyKind(String(saved.kind)) && !(admin || keyed)) return new Response('Not found', { status: 404 });
  const portal = isTooling && keyed;
  if (!(saved.is_published || admin || portal)) return new Response('Not found', { status: 404 });

  const buf = await renderSheetPdf(saved, req.nextUrl.origin, admin || portal);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${sheetPdfFilename(saved)}"`,
      'cache-control': 'no-store',
    },
  });
}
