import { q, one } from '../db';
import type { FieldReportPack, FieldReportNarrative, FieldReportSize } from '../field-report/core';
import { fieldReportSpendToday, type FieldReportRunRow } from '../field-report/store';

// Field Report reads (generated_reports kind 'field_report'). Access is NOT
// the Report Portal's usual "public once published" rule: a Field Report
// never leaves a keyholder's own drafts + the published shelf, and a guest
// reads none of it, ever (lib/reports/access.ts PORTAL_ONLY_KINDS already
// keeps it off the guest listing; this module is the second, row-level gate
// for the direct-by-id read and the PDF route). `viewer` is the caller's
// resolved {admin, keyId} — build it with lib/jobs/core.ts's jobViewerFor
// over a PortalIdentity (getPortalIdentity()/identityFromRequest()), the
// same helper the ui_jobs registry uses for the identical admin/key-owner
// question.

export interface FieldReportViewer {
  admin: boolean;
  keyId: string | null;
}

export interface SavedFieldReport {
  id: string;
  title: string;
  pack: FieldReportPack;
  narrative: FieldReportNarrative;
  is_published: boolean;
  created_by: string | null;
  generated_at: string; // ISO
}

export interface FieldReportListRow {
  id: string;
  title: string;
  question: string;
  size: FieldReportSize;
  is_published: boolean;
  created_by: string | null;
  generated_at: string;
  costUsd: number;
}

// admin: always. keyholder: their own ('key:<keyId>') or published. guest
// (no admin, no keyId): never, whatever is_published says.
export function canReadFieldReport(
  row: { is_published: boolean; created_by: string | null },
  viewer: FieldReportViewer
): boolean {
  if (viewer.admin) return true;
  if (!viewer.keyId) return false;
  return row.is_published || row.created_by === `key:${viewer.keyId}`;
}

export async function getFieldReport(id: string, viewer: FieldReportViewer): Promise<SavedFieldReport | null> {
  const row = await one<SavedFieldReport>(
    `select id, title, pack, narrative, is_published, created_by, generated_at::text as generated_at
       from generated_reports
      where kind = 'field_report' and id = $1`,
    [id]
  );
  if (!row || !canReadFieldReport(row, viewer)) return null;
  return row;
}

// The index (app/field-reports/page.tsx): admin sees every run's report,
// everyone else sees only their own drafts plus the published shelf. A
// guest viewer ({ admin: false, keyId: null }) short-circuits to an empty
// list before touching the database, so a guest reaching this by mistake
// (the page itself renders the keyholders-only plate first) still gets
// nothing rather than the published shelf.
export async function listFieldReports(viewer: FieldReportViewer, limit = 50): Promise<FieldReportListRow[]> {
  if (!viewer.admin && !viewer.keyId) return [];
  return q<FieldReportListRow>(
    `select id, title,
            coalesce(pack->>'question', '') as question,
            coalesce(pack->>'size', 'brief') as size,
            is_published, created_by,
            generated_at::text as generated_at,
            coalesce((pack->>'costUsd')::numeric, 0) as "costUsd"
       from generated_reports
      where kind = 'field_report'
        and ($1::boolean or is_published or created_by = $2)
      order by generated_at desc
      limit $3`,
    [viewer.admin, viewer.admin ? null : `key:${viewer.keyId}`, Math.max(1, Math.min(200, limit))]
  );
}

// ---- the desk (app/field-reports/desk/page.tsx) --------------------------------------

export interface FieldReportRunListRow {
  id: string;
  createdAt: string;         // ISO
  createdBy: string;         // 'admin' | 'key:<id>', as stored
  who: string;                // display label: 'admin', the key's name, or a shortened id
  size: FieldReportSize;
  status: FieldReportRunRow['status'];
  costUsd: number;
  title: string;
  reportId: string | null;
}

// The last N runs, admin and keyholder together, newest first. A keyholder
// row's `who` resolves to the portal key's own name when the row is still
// live (a deleted key falls back to a shortened id rather than failing the
// whole list).
export async function listFieldReportRuns(limit = 30): Promise<FieldReportRunListRow[]> {
  const rows = await q<{
    id: string; created_at: string; created_by: string; size: FieldReportSize; status: FieldReportRunRow['status'];
    cost_usd: number; title: string | null; report_id: string | null; key_name: string | null;
  }>(
    `select r.id, r.created_at::text as created_at, r.created_by, r.size, r.status,
            r.cost_usd::float as cost_usd, r.plan->>'title' as title, r.report_id,
            pk.name as key_name
       from field_report_runs r
       left join portal_keys pk
         on r.created_by like 'key:%' and pk.id = nullif(split_part(r.created_by, ':', 2), '')::uuid
      order by r.created_at desc
      limit $1`,
    [Math.max(1, Math.min(200, limit))]
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    createdBy: r.created_by,
    who: r.created_by === 'admin' ? 'admin' : r.key_name || `key ${r.created_by.replace('key:', '').slice(0, 8)}`,
    size: r.size,
    status: r.status,
    costUsd: r.cost_usd,
    title: r.title || '(untitled)',
    reportId: r.report_id,
  }));
}

// Today's Field Report spend: the grand total across admin and every key
// (the desk's headline number) plus the all-keys-together sum that
// field_report_prefs.all_keys_daily_usd caps (fieldReportSpendToday's own
// key filter is not used here; a null keyId means "no single key", so its
// `key` field would always read 0).
export async function getFieldReportSpendToday(): Promise<{ total: number; allKeys: number }> {
  const [{ allKeys }, totalRow] = await Promise.all([
    fieldReportSpendToday(null),
    one<{ total: number }>(
      `select coalesce(sum(cost_usd), 0)::float as total
         from ai_cost_log
        where feature like 'field\\_report\\_%'
          and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`
    ),
  ]);
  return { total: totalRow?.total ?? 0, allKeys };
}
