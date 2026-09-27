import { q, one } from '../db';
import type { SavedSavantIssue, SavantIssueListRow } from '../savant/types';
import type { GeneratedReportMeta } from '../types/tearsheets';

// ---- Savant issues (generated_reports kind 'savant') -----------------------
// One issue per week (scope_to = the Friday, unique index 0069). Key-gated
// content: callers gate on getPortalIdentity() (admin or an active key); the
// public teaser reads only `title` and the fixed TOC, never pack/narrative.

const ROW = `id, scope_to::text as week_end, pack, narrative, is_published, generated_at::text as generated_at`;

export async function getSavantIssue(weekEnd: string): Promise<SavedSavantIssue | null> {
  return one<SavedSavantIssue>(`select ${ROW} from generated_reports where kind = 'savant' and scope_to = $1::date`, [weekEnd]);
}

export async function getLatestSavantIssue(publishedOnly = true): Promise<SavedSavantIssue | null> {
  return one<SavedSavantIssue>(
    `select ${ROW} from generated_reports where kind = 'savant' ${publishedOnly ? 'and is_published' : ''}
      order by scope_to desc limit 1`
  );
}

export async function listSavantIssues(limit = 60, publishedOnly = true): Promise<SavantIssueListRow[]> {
  return q<SavantIssueListRow>(
    `select id, scope_to::text as week_end, title, (pack->>'issueNumber')::int as "issueNumber", is_published
       from generated_reports where kind = 'savant' ${publishedOnly ? 'and is_published' : ''}
      order by scope_to desc limit $1`,
    [Math.max(1, Math.min(365, limit))]
  );
}

// GeneratedReportMeta-shaped rows for kind 'savant' (the same projection
// listGeneratedReports uses for the Report Portal grid), so the archive can
// build its cards with the shared lib/reports/cards.ts toSheetCard rather
// than a bespoke row shape.
export async function listSavantIssueMetas(publishedOnly = true): Promise<GeneratedReportMeta[]> {
  return q<GeneratedReportMeta>(
    `select id, kind::text as kind, subject, title,
            to_char(scope_from, 'YYYY-MM-DD') as scope_from,
            to_char(scope_to, 'YYYY-MM-DD') as scope_to,
            is_published, generated_at::text as generated_at,
            pack->'numbers' as numbers,
            (pack->>'issueNumber')::int as issue_number
       from generated_reports
      where kind = 'savant' ${publishedOnly ? 'and is_published' : ''}
      order by scope_to desc`
  );
}

export async function countSavantIssues(): Promise<number> {
  const row = await one<{ n: number }>(`select count(*)::int as n from generated_reports where kind = 'savant'`);
  return row?.n ?? 0;
}
