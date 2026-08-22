import { q, one } from '../db';
import type {
  ConvictionLabel,
  ReportTouch, SavedReportMeta, Report,
  } from '../types';

// ---- Period report generation (data layer) ----------------------------------
// Period-scoped reads behind the /reports/period generator. The composer
// (lib/report.ts) assembles these into a Report.

// One resolved touched code with its in-range signal count (input shape).
interface ReportTouchCountRow {
  code: string;
  statement: string;
  conviction_label: ConvictionLabel;
  signal_count: number;
}

// Resolve the DISTINCT set of hypothesis codes the period's signals touch, with
// the count of in-range signals touching each. Same drift rules as
// resolveTouches (admin sees `unresolved`; guests get broken links filtered
// out, conviction_label nulled). `counts` is code → in-range signal count
// (built by the composer from the signals it already fetched).
export async function resolvePeriodTouches(
  counts: Map<string, number>,
  personal: boolean
): Promise<ReportTouch[]> {
  const codes = [...counts.keys()];
  if (!codes.length) return [];
  const rows = await q<ReportTouchCountRow>(
    `select code, statement, conviction_label from hypotheses where code = any($1)`,
    [codes]
  );
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return codes
    .map((code): ReportTouch | null => {
      const r = byCode.get(code);
      const n = counts.get(code) ?? 0;
      if (!r) {
        return personal
          ? {
              code, statement: 'This code no longer resolves to a hypothesis.',
              conviction_label: null, href: '#', signal_count: n, unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        statement: r.statement,
        conviction_label: personal ? r.conviction_label : null,
        href: `/hypothesis/${encodeURIComponent(r.code)}`,
        signal_count: n,
      };
    })
    .filter((t): t is ReportTouch => t !== null)
    .sort((a, b) => b.signal_count - a.signal_count || a.code.localeCompare(b.code));
}

// Saved reports (persistence). The full Report lives in the jsonb `data` column;
// list reads return only metadata for the saved-reports list.
export async function listSavedReports(): Promise<SavedReportMeta[]> {
  return q<SavedReportMeta>(
    `select id, title,
            to_char(date_from, 'YYYY-MM-DD') as date_from,
            to_char(date_to, 'YYYY-MM-DD')   as date_to,
            contexts::text[] as contexts,
            generated_at::text as generated_at,
            updated_at::text   as updated_at
       from reports
      order by updated_at desc`
  );
}

export async function getSavedReport(id: string): Promise<{ id: string; title: string; report: Report } | null> {
  const row = await one<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports where id = $1`,
    [id]
  );
  return row ? { id: row.id, title: row.title, report: row.data } : null;
}

// The most recent saved reports with their full data (the grounding corpus for
// the hypothesis gap diagnosis — the model reads recent reports as evidence).
export async function getRecentReports(limit = 2): Promise<{ id: string; title: string; data: Report }[]> {
  return q<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports order by updated_at desc limit $1`,
    [limit]
  );
}

// The most recently saved report (powers the public "Read the latest report" link).
export async function getLatestSavedReport(): Promise<{ id: string; title: string; report: Report } | null> {
  const row = await one<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports order by updated_at desc limit 1`
  );
  return row ? { id: row.id, title: row.title, report: row.data } : null;
}
