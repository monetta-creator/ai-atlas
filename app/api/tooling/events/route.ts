import type { NextRequest } from 'next/server';
import { isAdmin, isPortal, isPreview } from '@/lib/auth';
import { getProduct, getProductEvents } from '@/lib/data';

// The tooling table's quick-read drawer: GET /api/tooling/events?product=<uuid>.
// Public (needs a proxy.ts allow-list entry, its matcher does not exempt /api/*)
// and guest-safe by construction: `note` (working provenance, "never exported"
// per lib/types/tooling.ts) is stripped for everyone but a real admin, the same
// gate app/tooling/[slug]/page.tsx uses inline for its own events list.
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const productId = req.nextUrl.searchParams.get('product') ?? '';
  if (!UUID_RE.test(productId)) {
    return Response.json({ error: 'Unknown product.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const [adminFlag, preview, portal] = await Promise.all([isAdmin(), isPreview(), isPortal()]);
  const admin = adminFlag && !preview;
  // Same visibility gate as app/tooling/[slug]/page.tsx: a product the viewer
  // cannot open (parked/candidate for guests, dismissed for keyholders) has no
  // events either.
  const product = await getProduct(productId, { admin, portal: portal || admin });
  if (!product) {
    return Response.json({ error: 'Unknown product.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const events = await getProductEvents(product.id, 5);
  const rows = events.map((e) => ({
    id: e.id,
    event_date: e.event_date,
    kind: e.kind,
    title: e.title,
    url: e.url,
    source: e.source,
    ...(admin ? { note: e.note } : {}),
  }));
  return Response.json({ events: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
