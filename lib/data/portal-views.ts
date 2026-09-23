import { one, q } from '../db';
import type { PortalIdentity } from '../portal/keys';
import type { ViewParams, ViewRow } from '../portal/views-core';

// Saved views (migration 0064), the DB-touching half. canReadView's rule
// (lib/portal/views-core.ts) is applied here IN SQL rather than filtered in
// JS after the fact, so a key or legacy caller's listing never even fetches a
// row it cannot see.

interface RawViewRow {
  id: string;
  key_id: string | null;
  owner: string;
  dataset_slug: string;
  name: string;
  spec: unknown;
  format: string;
  is_shared: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: RawViewRow): ViewRow {
  return {
    id: row.id,
    key_id: row.key_id,
    owner: row.owner as ViewRow['owner'],
    dataset_slug: row.dataset_slug,
    name: row.name,
    spec: (row.spec && typeof row.spec === 'object' ? row.spec : {}) as ViewParams,
    format: row.format as ViewRow['format'],
    is_shared: row.is_shared,
    use_count: row.use_count,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const VIEW_SELECT = `
  select id::text as id, key_id::text as key_id, owner, dataset_slug, name, spec,
         format, is_shared, use_count, last_used_at::text as last_used_at,
         created_at::text as created_at, updated_at::text as updated_at
    from portal_views`;

export async function listViews(opts: { datasetSlug?: string; identity: PortalIdentity }): Promise<ViewRow[]> {
  const { datasetSlug, identity } = opts;
  const conds: string[] = [];
  const params: unknown[] = [];

  if (datasetSlug) {
    params.push(datasetSlug);
    conds.push(`dataset_slug = $${params.length}`);
  }

  if (identity.tier === 'key' && identity.keyId) {
    params.push(identity.keyId);
    conds.push(`(is_shared or (owner = 'key' and key_id = $${params.length}))`);
  } else if (identity.tier === 'legacy') {
    conds.push(`(is_shared or owner = 'legacy')`);
  } else if (identity.tier !== 'admin') {
    // Neither admin nor an active key/legacy identity: nothing is readable.
    return [];
  }

  const where = conds.length ? `where ${conds.join(' and ')}` : '';
  const rows = await q<RawViewRow>(`${VIEW_SELECT} ${where} order by created_at desc`, params);
  return rows.map(fromRow);
}

export async function getView(id: string): Promise<ViewRow | null> {
  const row = await one<RawViewRow>(`${VIEW_SELECT} where id = $1::uuid`, [id]);
  return row ? fromRow(row) : null;
}

// How many views the given owner already has, for the 50-per-owner cap.
// `key_id is not distinct from` treats two nulls (legacy/admin owners) as
// equal, unlike `=`.
export async function countOwnerViews(owner: 'key' | 'legacy' | 'admin', keyId: string | null): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from portal_views where owner = $1 and key_id is not distinct from $2::uuid`,
    [owner, keyId]
  );
  return row?.n ?? 0;
}
