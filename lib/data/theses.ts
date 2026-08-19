import { q, one } from '../db';
import type {
  ConfidenceLabel,
  Thesis, ThesisReportMeta, SavedThesisReport,
  } from '../types';

// ---- Thesis reports (migration 0027) ----------------------------------------
// Reads for the standing-thesis surface. The /theses console is admin-only; a saved
// thesis report (/thesis-report/[id]) is PUBLIC, so getThesisReport returns only the
// guest-safe pack + sanitized narrative that were frozen at save time.

export async function getTheses(): Promise<Thesis[]> {
  return q<Thesis>(
    `select t.id, t.statement, t.claim_codes, t.mapping_note, t.status::text as status,
            t.created_at::text as created_at, t.updated_at::text as updated_at,
            count(r.id)::int as report_count,
            max(r.generated_at)::text as last_generated_at
       from theses t
       left join thesis_reports r on r.thesis_id = t.id
      group by t.id
      order by t.status = 'active' desc, t.updated_at desc`
  );
}

export async function getThesis(id: string): Promise<Thesis | null> {
  return one<Thesis>(
    `select id, statement, claim_codes, mapping_note, status::text as status,
            created_at::text as created_at, updated_at::text as updated_at, gap_scan
       from theses where id = $1`,
    [id]
  );
}

export async function getThesisReportsMeta(thesisId: string): Promise<ThesisReportMeta[]> {
  return q<ThesisReportMeta>(
    `select id, thesis_id, title, generated_at::text as generated_at,
            coalesce((pack->'stats'->>'matched')::int, 0) as matched
       from thesis_reports
      where thesis_id = $1
      order by generated_at desc, id`,
    [thesisId]
  );
}

export async function getThesisReport(id: string): Promise<SavedThesisReport | null> {
  return one<SavedThesisReport>(
    `select id, thesis_id, title, statement, pack, narrative, generated_at::text as generated_at
       from thesis_reports where id = $1`,
    [id]
  );
}

// The theses tracking a claim/bridge code (the tear-sheet pack's reverse lookup,
// surfaced on claim/bridge pages). Guest-safe: statements are already public via
// the tracker and reports; the mapping itself carries nothing personal. Guests
// link the latest public report; only admins link /theses/[id].
interface ThesisForTarget {
  id: string;
  statement: string;
  latest_report_id: string | null;
}

export async function getThesesForTarget(code: string): Promise<ThesisForTarget[]> {
  return q<ThesisForTarget>(
    `select t.id, t.statement,
            (select r.id from thesis_reports r
              where r.thesis_id = t.id order by r.generated_at desc, r.id limit 1) as latest_report_id
       from theses t
      where t.status = 'active' and t.claim_codes @> array[$1]::text[]
      order by t.statement, t.id`,
    [code]
  );
}

// The /map thesis desk (admin): every ACTIVE thesis, whether or not it has a
// saved report, with its latest run's stats and the flagged gap count. Guests
// keep the report-anchored tracker (getLatestThesisReports); this shape exists
// so a freshly drafted thesis is visible on /map the moment it is created.
export interface ThesisDeskEntry {
  id: string;
  statement: string;
  claim_count: number;
  gap_count: number;
  report_count: number;
  last_generated_at: string | null;
  matched: number;
  supports: number;
  contradicts: number;
  mixed: number;
}

export async function getThesisDesk(): Promise<ThesisDeskEntry[]> {
  return q<ThesisDeskEntry>(
    `select t.id, t.statement,
            coalesce(array_length(t.claim_codes, 1), 0) as claim_count,
            coalesce(jsonb_array_length(t.gap_scan->'recommendations'), 0) as gap_count,
            (select count(*) from thesis_reports x where x.thesis_id = t.id)::int as report_count,
            r.generated_at::text as last_generated_at,
            coalesce((r.pack->'stats'->>'matched')::int, 0) as matched,
            coalesce((r.pack->'stats'->'stances'->>'supports')::int, 0) as supports,
            coalesce((r.pack->'stats'->'stances'->>'contradicts')::int, 0) as contradicts,
            coalesce((r.pack->'stats'->'stances'->>'mixed')::int, 0) as mixed
       from theses t
       left join lateral (
         select generated_at, pack from thesis_reports
          where thesis_id = t.id
          order by generated_at desc, id limit 1
       ) r on true
      where t.status = 'active'
      order by t.updated_at desc, t.id`
  );
}

// The logic-tree data for a thesis's mapped codes: each resolved claim/bridge with
// its confidence band and, for claims, the questions it bears on (via stance
// edges). ADMIN-ONLY caller today (/theses/[id]); confidence_label must be
// stripped before this ever feeds a public surface.
export interface ThesisTreeNode {
  code: string;
  kind: 'claim' | 'bridge';
  statement: string;
  confidence_label: ConfidenceLabel | null;
  href: string;
  questions: { slug: string; label: string; title: string }[];  // claims only
  domain_from: string | null;                                   // bridges only
  domain_to: string | null;
}

export async function getThesisTreeData(claimCodes: string[]): Promise<ThesisTreeNode[]> {
  if (!claimCodes.length) return [];
  const [claimRows, bridgeRows] = await Promise.all([
    q<{ code: string; statement: string; confidence_label: ConfidenceLabel; slug: string | null; sort_order: number | null; title: string | null }>(
      `select c.code, c.statement, c.confidence_label,
              qn.slug, qn.sort_order, qn.title
         from claims c
         left join edges e on e.from_type = 'claim' and e.from_id = c.id and e.to_type = 'stance'
         left join stances s on s.id = e.to_id
         left join questions qn on qn.id = s.question_id
        where c.code = any($1::text[]) and c.is_frame = false
        order by c.code, qn.sort_order`,
      [claimCodes]
    ),
    q<{ code: string; statement: string; confidence_label: ConfidenceLabel; domain_from: string; domain_to: string }>(
      `select code, statement, confidence_label, domain_from::text as domain_from, domain_to::text as domain_to
         from bridge_claims where code = any($1::text[]) order by code`,
      [claimCodes]
    ),
  ]);

  const byCode = new Map<string, ThesisTreeNode>();
  for (const r of claimRows) {
    let node = byCode.get(r.code);
    if (!node) {
      node = {
        code: r.code, kind: 'claim', statement: r.statement, confidence_label: r.confidence_label,
        href: `/claim/${encodeURIComponent(r.code)}`, questions: [], domain_from: null, domain_to: null,
      };
      byCode.set(r.code, node);
    }
    if (r.slug && !node.questions.some((x) => x.slug === r.slug)) {
      node.questions.push({ slug: r.slug, label: `Q${r.sort_order}`, title: r.title ?? '' });
    }
  }
  for (const r of bridgeRows) {
    if (!byCode.has(r.code)) {
      byCode.set(r.code, {
        code: r.code, kind: 'bridge', statement: r.statement, confidence_label: r.confidence_label,
        href: `/bridge/${encodeURIComponent(r.code)}`, questions: [],
        domain_from: r.domain_from, domain_to: r.domain_to,
      });
    }
  }
  // Preserve the thesis's mapping order; unresolved codes are simply absent.
  return claimCodes.flatMap((c) => byCode.get(c) ?? []);
}

// The thesis's latest saved run — the delta baseline for the next pack build.
export async function getLatestThesisRun(
  thesisId: string
): Promise<{ id: string; generated_at: string; signal_ids: string[] } | null> {
  return one<{ id: string; generated_at: string; signal_ids: string[] }>(
    `select id, generated_at::text as generated_at, signal_ids
       from thesis_reports
      where thesis_id = $1
      order by generated_at desc, id
      limit 1`,
    [thesisId]
  );
}
