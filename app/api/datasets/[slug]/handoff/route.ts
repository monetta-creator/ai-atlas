import type { NextRequest } from 'next/server';
import { identityFromRequest, unauthorizedMessage } from '@/lib/portal/identity';
import { getDataset } from '@/lib/datasets/registry';
import { buildDatasetHandoff } from '@/lib/datasets/handoff-generic';

// A generic, per-dataset importer orientation document, for any dataset that
// has no hand-written handoff of its own (lib/scan/handoff.ts,
// lib/intel/handoff.ts, lib/tooling/handoff.ts, and lib/research/handoff.ts
// cover the four domains that do; this route serves every dataset,
// including those four). GET /api/datasets/<slug>/handoff -> text/markdown.
//
// Gate mirrors the download route (app/api/datasets/[slug]/route.ts): a
// public dataset needs no identity; a key-gated one requires an active one,
// same 401 shape (unauthorizedMessage). Sits under the app/api/datasets/
// [slug] segment, itself covered by the '/api/datasets/' proxy prefix
// (lib/route-shapes.ts), so it needs no allow-list change of its own.
export const dynamic = 'force-dynamic';

const PUBLIC_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;
  const def = getDataset(slug);
  if (!def) {
    return Response.json({ error: 'Unknown dataset. See /api/datasets/catalog.' }, { status: 404 });
  }

  if (def.keyGated) {
    const identity = await identityFromRequest(req);
    if (!identity.active) {
      const denied = unauthorizedMessage(identity);
      return Response.json(denied.body, { status: denied.status, headers: denied.headers });
    }
  }

  const text = buildDatasetHandoff(def, { origin: req.nextUrl.origin });
  return new Response(text, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': def.keyGated ? 'no-store' : PUBLIC_CACHE,
    },
  });
}
