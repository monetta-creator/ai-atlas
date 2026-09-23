import { exec, one } from '../db';
import type { ViewParams } from '../portal/views-core';

// Saved views, the writer half (migration 0064). createView/updateView/
// deleteView are called only after the API route has already checked
// canWriteView (or, for create, that the caller is an active identity under
// its per-owner cap); touchView is fire-and-forget bookkeeping the download
// route calls from next/server's after().

export async function createView(input: {
  owner: 'key' | 'legacy' | 'admin';
  keyId: string | null;
  datasetSlug: string;
  name: string;
  spec: ViewParams;
  format: 'csv' | 'json';
  isShared: boolean;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into portal_views (key_id, owner, dataset_slug, name, spec, format, is_shared)
     values ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)
     returning id::text as id`,
    [input.keyId, input.owner, input.datasetSlug, input.name, JSON.stringify(input.spec), input.format, input.isShared]
  );
  if (!row) throw new Error('Could not save the view.');
  return row.id;
}

export async function updateView(id: string, patch: {
  name?: string;
  spec?: ViewParams;
  format?: 'csv' | 'json';
  isShared?: boolean;
}): Promise<void> {
  await exec(
    `update portal_views set
        name = coalesce($2, name),
        spec = coalesce($3::jsonb, spec),
        format = coalesce($4, format),
        is_shared = coalesce($5, is_shared),
        updated_at = now()
      where id = $1::uuid`,
    [
      id,
      patch.name ?? null,
      patch.spec ? JSON.stringify(patch.spec) : null,
      patch.format ?? null,
      patch.isShared ?? null,
    ]
  );
}

export async function deleteView(id: string): Promise<void> {
  await exec(`delete from portal_views where id = $1::uuid`, [id]);
}

export async function touchView(id: string): Promise<void> {
  await exec(
    `update portal_views set use_count = use_count + 1, last_used_at = now() where id = $1::uuid`,
    [id]
  );
}
