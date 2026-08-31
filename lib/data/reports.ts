import { q, one } from '../db';
import type {
  Domain, ConfidenceLabel,
  SignalLens, ReportTouch, SavedReportMeta, Report,
  GeneratedReportMeta, SavedSheet,
  } from '../types';

// ---- Report generation (Phase 1: data layer) -------------------------------
// Period-scoped reads behind the /report generator. The composer (lib/report.ts)
// assembles these into a Report. Row types are co-located with their queries (like
// SummaryInput / EvidenceGraph elsewhere in this file).

// One row of the period funnel aggregate. `lens` is null for the GROUPING SETS grand-
// total row (the () grouping); a slug for each per-lens row.
export interface ReportFunnelRow {
  lens: SignalLens | null;
  candidates: number;
  approved: number;
  rejected: number;
  duplicate: number;
  drafted: number;
  discarded: number;
  published: number;
}

// One resolved touched code with its in-range signal count (input shape for the union).
interface ReportTouchCountRow {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  domain: Domain | null;
  confidence_label: ConfidenceLabel;
  signal_count: number;
}

// Period pipeline funnel anchored on discovery time (signal_candidates.retrieved_at),
// half-open at the end day. GROUPING SETS returns the overall total (lens null) AND a row
// per lens in ONE pass, so the overall and per-lens counts can never disagree. Counts
// only (::int — node-pg hands int4 back as JS numbers); rates are derived in code.
// signal_candidates.lens is a single enum (not an array), so per-lens rows are mutually
// exclusive and sum to the overall. Mirrors getPipelineAnalytics's trusted FILTER idiom
// (counts the candidate rows directly, never the drift-prone pipeline_runs.*_count tallies).
export async function getReportFunnel(from: string, to: string): Promise<ReportFunnelRow[]> {
  return q<ReportFunnelRow>(
    `select sc.lens::text as lens,
            count(*)::int                                                              as candidates,
            count(*) filter (where sc.triage_status = 'approved')::int                 as approved,
            count(*) filter (where sc.triage_status = 'rejected'
                              and sc.analysis_status <> 'discarded')::int              as rejected,
            count(*) filter (where sc.triage_status = 'duplicate')::int                as duplicate,
            count(*) filter (where sc.analysis_status = 'drafted')::int                as drafted,
            count(*) filter (where sc.analysis_status = 'discarded')::int              as discarded,
            count(distinct sig.id) filter (where sig.is_published)::int                as published
       from signal_candidates sc
       left join signals sig on sig.id = sc.signal_id
      where sc.retrieved_at >= $1::date
        and sc.retrieved_at <  ($2::date + 1)
      group by grouping sets ( (sc.lens), () )`,
    [from, to]
  );
}

// Resolve the DISTINCT set of claim/bridge codes the period's signals touch, with the
// count of in-range signals touching each. Same UNION + drift rules as resolveTouches
// (admin sees `unresolved`; guests get broken links filtered out, confidence_label
// nulled), but period-scoped — no per-signal direction/reason; carries signal_count and
// sorts by count desc. `counts` is code → in-range signal count (built by the composer
// from the signals it already fetched, so there is no second signals read).
export async function resolvePeriodTouches(
  counts: Map<string, number>,
  personal: boolean
): Promise<ReportTouch[]> {
  const codes = [...counts.keys()];
  if (!codes.length) return [];
  const rows = await q<ReportTouchCountRow>(
    `select code, 'claim'::text as type, statement, domain::text as domain, confidence_label
       from claims where code = any($1)
     union all
     select code, 'bridge_claim'::text as type, statement, domain_from::text as domain, confidence_label
       from bridge_claims where code = any($1)`,
    [codes]
  );
  // Bare-code keying is safe: claim and bridge-claim code namespaces are disjoint by
  // construction, so the UNION never produces two rows with the same code.
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return codes
    .map((code): ReportTouch | null => {
      const r = byCode.get(code);
      const n = counts.get(code) ?? 0;
      if (!r) {
        // Drift: the code no longer names a live claim/bridge. Admins see it flagged;
        // guests never see a broken link.
        return personal
          ? {
              code, type: 'claim', statement: 'This code no longer resolves to a claim or bridge-claim.',
              domain: null, confidence_label: null, href: '#', signal_count: n, unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        type: r.type,
        statement: r.statement,
        domain: r.domain,
        confidence_label: personal ? r.confidence_label : null,
        href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
        signal_count: n,
      };
    })
    .filter((t): t is ReportTouch => t !== null)
    .sort((a, b) => b.signal_count - a.signal_count || a.code.localeCompare(b.code));
}

// Saved reports (persistence). The full Report lives in the jsonb `data` column (node-pg
// returns it already parsed); list reads return only metadata for the saved-reports list.
export async function listSavedReports(): Promise<SavedReportMeta[]> {
  return q<SavedReportMeta>(
    `select id, title,
            to_char(date_from, 'YYYY-MM-DD') as date_from,
            to_char(date_to, 'YYYY-MM-DD')   as date_to,
            lenses::text[] as lenses,
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

// The most recent saved reports with their full data (the grounding corpus for the
// argument-map gap diagnosis — the model reads recent reports as evidence).
export async function getRecentReports(limit = 2): Promise<{ id: string; title: string; data: Report }[]> {
  return q<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports order by updated_at desc limit $1`,
    [limit]
  );
}

// The most recently saved report (powers the public "Read the latest report" link on home).
export async function getLatestSavedReport(): Promise<{ id: string; title: string; report: Report } | null> {
  const row = await one<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports order by updated_at desc limit 1`
  );
  return row ? { id: row.id, title: row.title, report: row.data } : null;
}

// ---- Generated reports (the Report Portal's tear sheets, migration 0030) ----

const GEN_REPORT_META = `
  id, kind::text as kind, subject, title,
  to_char(scope_from, 'YYYY-MM-DD') as scope_from,
  to_char(scope_to, 'YYYY-MM-DD') as scope_to,
  is_published, generated_at::text as generated_at`;

// Strip stored narrative HTML to a plain-text excerpt (word-boundary clamp).
// Text-only by construction: the preview can never carry a link, so it needs no
// citation-gate pass (the full read view re-gates as always).
function textExcerpt(html: string | null | undefined, max: number): string {
  if (!html) return '';
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#0*39;|&#x0*27;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&#0*34;|&#x0*22;|&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 40))}…`;
}

export async function listGeneratedReports(publishedOnly: boolean): Promise<GeneratedReportMeta[]> {
  // The row-expansion preview projects only the small parts of the stored jsonb:
  // the bottom line (stripped to plain text below, so it carries no links and
  // needs no citation-gate pass) and the pack's deterministic stats/health.
  const rows = await q<GeneratedReportMeta & { bottom_line: string | null }>(
    `select ${GEN_REPORT_META},
            narrative->>'bottomLine' as bottom_line,
            pack->'stats' as stats,
            pack->'health' as health
       from generated_reports
       ${publishedOnly ? 'where is_published = true' : ''}
      order by generated_at desc, id`
  );
  return rows.map(({ bottom_line, ...r }) => ({
    ...r,
    // Some narratives open with a literal "Bottom line:" prefix; the row's
    // preview label already says it, so strip the doubled words.
    abstract: textExcerpt(bottom_line, 460).replace(/^bottom line[:.]?\s*/i, '') || null,
  }));
}

export async function getGeneratedReport(id: string): Promise<SavedSheet | null> {
  return one<SavedSheet>(
    `select ${GEN_REPORT_META}, pack, narrative from generated_reports where id = $1`,
    [id]
  );
}

// ---- Weekly research roundup (kind 'roundup') --------------------------------
// The roundup's natural key is its week-ending date (scope_to): the cron's
// idempotency check before it does any model work.
export async function getRoundupForWeek(weekEnd: string): Promise<{ id: string } | null> {
  return one<{ id: string }>(
    `select id from generated_reports where kind = 'roundup' and scope_to = $1::date limit 1`,
    [weekEnd]
  );
}

// The Research Portal's "This week" strip: the latest published roundup, meta
// only (same guest-safe preview projection as listGeneratedReports).
export async function getLatestRoundup(): Promise<GeneratedReportMeta | null> {
  const row = await one<GeneratedReportMeta & { bottom_line: string | null }>(
    `select ${GEN_REPORT_META}, narrative->>'bottomLine' as bottom_line
       from generated_reports
      where kind = 'roundup' and is_published = true
      order by generated_at desc, id
      limit 1`
  );
  if (!row) return null;
  const { bottom_line, ...meta } = row;
  return { ...meta, abstract: textExcerpt(bottom_line, 320).replace(/^bottom line[:.]?\s*/i, '') || null };
}

// Past published roundups (excludes the one already shown as "latest"), for
// the portal's inline "Past roundups" list.
export async function getPastRoundups(excludeId: string, limit = 4): Promise<GeneratedReportMeta[]> {
  return q<GeneratedReportMeta>(
    `select ${GEN_REPORT_META} from generated_reports
      where kind = 'roundup' and is_published = true and id <> $1
      order by generated_at desc, id
      limit $2`,
    [excludeId, limit]
  );
}
