import type { NextRequest } from 'next/server';
import { identityFromRequest } from '@/lib/portal/identity';
import { getSavantIssue } from '@/lib/data/savant-issues';
import { renderSavantPdf, savantPdfFilename } from '@/lib/pdf/savant-doc';
import { isRealDay } from '@/lib/route-shapes';

// The branded PDF download for one Savant issue: key-gated exactly like the
// page (an access-key holder or the admin), 404 for anyone else, same as the
// company intel deck's pdf route.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ week: string }> }): Promise<Response> {
  const { week } = await ctx.params;
  if (!isRealDay(week)) return new Response('Not found', { status: 404 });

  const identity = await identityFromRequest(req);
  const allowed = identity.tier === 'admin' || identity.active;
  if (!allowed) return new Response('Not found', { status: 404 });

  const saved = await getSavantIssue(week);
  if (!saved || (!saved.is_published && identity.tier !== 'admin')) return new Response('Not found', { status: 404 });

  const origin = req.nextUrl.origin || process.env.APP_BASE_URL || '';
  const buf = await renderSavantPdf(saved, origin);

  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${savantPdfFilename(week)}"`,
      'cache-control': 'no-store',
    },
  });
}
