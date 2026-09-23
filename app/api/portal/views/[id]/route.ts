import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { getDataset } from '@/lib/datasets/registry';
import { parseFilterSpec } from '@/lib/datasets/filter';
import { identityFromRequest, touchKey, unauthorizedMessage } from '@/lib/portal/identity';
import { getView } from '@/lib/data/portal-views';
import { deleteView, updateView } from '@/lib/mutations/portal-views';
import { logPortalUsage } from '@/lib/mutations/portal';
import { canWriteView, sanitizeViewParams, validatePushdowns } from '@/lib/portal/views-core';

// Saved views, one row (migration 0064): PATCH edits it, DELETE removes it.
// Both check canWriteView (owner or admin) and answer 404 rather than 403 on
// a view the caller cannot write, so a probing request cannot distinguish
// "not yours" from "does not exist".
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LEN = 80;
const JSON_HEADERS = { 'Cache-Control': 'no-store' };

function notFound(): Response {
  return Response.json({ error: 'Unknown view.' }, { status: 404, headers: JSON_HEADERS });
}

function identityTier(tier: 'admin' | 'key' | 'legacy' | 'none'): 'admin' | 'key' | 'legacy' {
  return tier === 'admin' ? 'admin' : tier === 'key' ? 'key' : 'legacy';
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  const identity = await identityFromRequest(req);
  if (!identity.active) {
    const denied = unauthorizedMessage(identity);
    return Response.json(denied.body, { status: denied.status, headers: { ...denied.headers, ...JSON_HEADERS } });
  }

  const view = await getView(id);
  if (!view || !canWriteView(view, identity)) {
    return notFound();
  }

  const def = getDataset(view.dataset_slug);
  if (!def) return Response.json({ error: 'That view\'s dataset no longer exists.' }, { status: 400, headers: JSON_HEADERS });

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

  const patch: { name?: string; spec?: ReturnType<typeof sanitizeViewParams>; format?: 'csv' | 'json'; isShared?: boolean } = {};

  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > MAX_NAME_LEN) {
      return Response.json(
        { error: `Name must be 1 to ${MAX_NAME_LEN} characters.` },
        { status: 400, headers: JSON_HEADERS }
      );
    }
    patch.name = name;
  }

  if (input.params !== undefined) {
    const sanitized = sanitizeViewParams(input.params);
    const { errors } = parseFilterSpec(def, sanitized);
    if (errors.length) return Response.json({ error: errors[0] }, { status: 400, headers: JSON_HEADERS });
    // Same pushdown re-check as POST /api/portal/views (lens/day/since/
    // source/company are outside parseFilterSpec's grammar).
    const pushdownErr = validatePushdowns(def, sanitized);
    if (pushdownErr) return Response.json({ error: pushdownErr }, { status: 400, headers: JSON_HEADERS });
    patch.spec = sanitized;
  }

  if (input.format !== undefined) {
    patch.format = input.format === 'json' ? 'json' : 'csv';
  }

  if (input.is_shared !== undefined) {
    patch.isShared = input.is_shared === true;
  }

  await updateView(id, patch);
  const updated = await getView(id);
  return Response.json({ view: updated }, { headers: JSON_HEADERS });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  const identity = await identityFromRequest(req);
  if (!identity.active) {
    const denied = unauthorizedMessage(identity);
    return Response.json(denied.body, { status: denied.status, headers: { ...denied.headers, ...JSON_HEADERS } });
  }

  const view = await getView(id);
  if (!view || !canWriteView(view, identity)) {
    return notFound();
  }

  await deleteView(id);

  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
  after(() => Promise.all([
    logPortalUsage({
      keyId: identity.keyId,
      identity: identityTier(identity.tier),
      kind: 'view_delete',
      datasetSlug: view.dataset_slug,
      status: 200,
      ua,
    }),
    touchKey(identity.keyId),
  ]));

  return Response.json({ ok: true }, { headers: JSON_HEADERS });
}
