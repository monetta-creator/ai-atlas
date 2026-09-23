import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { getDataset } from '@/lib/datasets/registry';
import { parseFilterSpec } from '@/lib/datasets/filter';
import { identityFromRequest, touchKey, unauthorizedMessage } from '@/lib/portal/identity';
import { countOwnerViews, getView, listViews } from '@/lib/data/portal-views';
import { createView } from '@/lib/mutations/portal-views';
import { logPortalUsage } from '@/lib/mutations/portal';
import { ownerOf, sanitizeViewParams, validatePushdowns } from '@/lib/portal/views-core';

// Saved views (migration 0064): GET lists the views this identity may read
// for a dataset, POST saves a new one. Gated like every other portal surface
// (lib/portal/identity.ts: admin, the legacy team-key cookie, or a per-person
// key by cookie or Authorization/X-Atlas-Key header); a view is otherwise a
// per-owner convenience, never a wider door into a dataset than the download
// route itself already opens (POST re-validates the stored spec against the
// live registry with the same parseFilterSpec the download route runs).
//
// NOT YET on the proxy allow-list (proxy.ts is locked to a sibling agent this
// pass): add the '/api/portal/' prefix there for this route and its
// siblings to work sessionlessly, the way /api/portal/ask already does.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_VIEWS_PER_OWNER = 50;
const MAX_NAME_LEN = 80;
const JSON_HEADERS = { 'Cache-Control': 'no-store' };

function identityTier(tier: 'admin' | 'key' | 'legacy' | 'none'): 'admin' | 'key' | 'legacy' {
  return tier === 'admin' ? 'admin' : tier === 'key' ? 'key' : 'legacy';
}

export async function GET(req: NextRequest): Promise<Response> {
  const identity = await identityFromRequest(req);
  if (!identity.active) {
    const denied = unauthorizedMessage(identity);
    return Response.json(denied.body, { status: denied.status, headers: { ...denied.headers, ...JSON_HEADERS } });
  }

  const datasetSlug = req.nextUrl.searchParams.get('dataset');
  const views = await listViews({ datasetSlug: datasetSlug || undefined, identity });
  return Response.json({ views }, { headers: JSON_HEADERS });
}

export async function POST(req: NextRequest): Promise<Response> {
  const identity = await identityFromRequest(req);
  if (!identity.active) {
    const denied = unauthorizedMessage(identity);
    return Response.json(denied.body, { status: denied.status, headers: { ...denied.headers, ...JSON_HEADERS } });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to the bad-request guard
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Bad request.' }, { status: 400, headers: JSON_HEADERS });
  }
  const input = body as Record<string, unknown>;

  const datasetSlug = typeof input.dataset_slug === 'string' ? input.dataset_slug.trim() : '';
  const def = getDataset(datasetSlug);
  if (!def) return Response.json({ error: 'Unknown dataset.' }, { status: 400, headers: JSON_HEADERS });

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > MAX_NAME_LEN) {
    return Response.json(
      { error: `Name must be 1 to ${MAX_NAME_LEN} characters.` },
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const params = sanitizeViewParams(input.params);
  const { errors } = parseFilterSpec(def, params);
  if (errors.length) return Response.json({ error: errors[0] }, { status: 400, headers: JSON_HEADERS });
  // parseFilterSpec only covers where/cols/sort/limit/q; a saved view can
  // also carry the download route's separate pushdown params (lens/day/
  // since/source/company), which get no check here otherwise and would 400
  // on every future ?view= apply instead of at save time.
  const pushdownErr = validatePushdowns(def, params);
  if (pushdownErr) return Response.json({ error: pushdownErr }, { status: 400, headers: JSON_HEADERS });

  const format = input.format === 'json' ? 'json' : 'csv';
  const isShared = input.is_shared !== false;

  const { owner, keyId } = ownerOf(identity);
  const count = await countOwnerViews(owner, keyId);
  if (count >= MAX_VIEWS_PER_OWNER) {
    return Response.json(
      { error: `You already have ${MAX_VIEWS_PER_OWNER} saved views, the maximum. Delete one first.` },
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const id = await createView({ owner, keyId, datasetSlug: def.slug, name, spec: params, format, isShared });
  const view = await getView(id);

  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
  after(() => Promise.all([
    logPortalUsage({
      keyId: identity.keyId,
      identity: identityTier(identity.tier),
      kind: 'view_save',
      datasetSlug: def.slug,
      spec: params,
      status: 201,
      ua,
    }),
    touchKey(identity.keyId),
  ]));

  return Response.json({ view }, { status: 201, headers: JSON_HEADERS });
}
