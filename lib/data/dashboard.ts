import { q, one } from '../db';
import type {
  Signal, TopHypothesis, CandidateArchiveFilters, CandidateArchiveResult, CandidateArchiveRow,
  MapHealth,
  } from '../types';
import { SIGNAL_COLUMNS } from './signals';

// ---- Dashboard reads (blotter) ----------------------------------------------
// Evidence counts are structural (public); conviction is personal-layer (nulled
// for guests). The candidate archive is public operational metadata.

// Hypotheses ranked by how much evidence is attached. Inner join => only
// hypotheses with ≥1 evidence row surface (the point of "top hypotheses").
export async function getTopHypotheses(personal: boolean, limit = 6): Promise<TopHypothesis[]> {
  const rows = await q<TopHypothesis>(
    `select h.id, h.code, h.statement,
            h.conviction, h.conviction_label,
            count(ev.id)::int as evidence_count,
            count(*) filter (where ev.direction = 'supports')::int   as supports,
            count(*) filter (where ev.direction = 'contradicts')::int as contradicts,
            count(*) filter (where ev.direction = 'neutral')::int     as neutral
       from hypotheses h
       join evidence ev on ev.hypothesis_id = h.id
      group by h.id
      order by evidence_count desc, h.code
      limit $1`,
    [limit]
  );
  return personal ? rows : rows.map((r) => ({ ...r, conviction: null, conviction_label: null }));
}

// The most recently published signals, richer-in-touches first within the
// recency band. Published-only for everyone.
export async function getTopSignals(limit = 6): Promise<Signal[]> {
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published = true
      order by s.published_at desc, cardinality(s.touches) desc, s.created_at desc
      limit $1`,
    [limit]
  );
}

// A light, public orientation strip. `contested` (conviction-derived) is admin-only.
export async function getMapHealth(personal: boolean): Promise<MapHealth> {
  const row = await one<{
    hypotheses: number; uncovered: number; one_sided: number; evidence: number; contested: number;
  }>(`
    with hyp_ev as (
      select h.id, h.conviction_label,
             count(ev.id) as n,
             count(*) filter (where ev.direction = 'supports')   as sup,
             count(*) filter (where ev.direction = 'contradicts') as con
        from hypotheses h
        left join evidence ev on ev.hypothesis_id = h.id
       where h.status = 'active'
       group by h.id
    )
    select
      (select count(*) from hyp_ev)::int as hypotheses,
      (select count(*) from hyp_ev where n = 0)::int as uncovered,
      (select count(*) from hyp_ev where (sup >= 2 and con = 0) or (con >= 2 and sup = 0))::int as one_sided,
      (select count(*) from evidence)::int as evidence,
      (select count(*) from hyp_ev where conviction_label = 'contested')::int as contested
  `);
  const sig = await one<{ n: number }>(
    `select count(*)::int as n from signals where is_published = true`
  );
  return {
    hypotheses: row?.hypotheses ?? 0,
    uncovered: row?.uncovered ?? 0,
    oneSided: row?.one_sided ?? 0,
    evidence: row?.evidence ?? 0,
    signalsPublished: sig?.n ?? 0,
    contested: personal ? (row?.contested ?? 0) : null,
  };
}

// The browsable candidate archive: every intake candidate, filterable/searchable/
// paginated. Dynamic WHERE built param-safely; `dateField` is whitelisted to a
// literal column name; the search term is parameterized with LIKE wildcards escaped.
export async function getCandidateArchive(f: CandidateArchiveFilters): Promise<CandidateArchiveResult> {
  const where: string[] = [];
  const whereParams: unknown[] = [];
  if (f.context) { whereParams.push(f.context); where.push(`sc.context = $${whereParams.length}::context_t`); }
  if (f.triage_status) { whereParams.push(f.triage_status); where.push(`sc.triage_status = $${whereParams.length}::triage_status_t`); }
  const dateCol = f.dateField === 'published_date' ? 'sc.published_date' : 'sc.retrieved_at';
  if (f.from) { whereParams.push(f.from); where.push(`${dateCol} >= $${whereParams.length}::date`); }
  if (f.to) { whereParams.push(f.to); where.push(`${dateCol} <= $${whereParams.length}::date`); }
  if (f.search) {
    const term = `%${f.search.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`;
    whereParams.push(term);
    where.push(`(sc.headline ilike $${whereParams.length} or sc.url ilike $${whereParams.length})`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);

  const [rows, totalRow] = await Promise.all([
    q<CandidateArchiveRow>(
      `select sc.id, sc.run_id, sc.url, sc.headline, sc.source_domain, sc.context::text as context,
              to_char(sc.published_date, 'YYYY-MM-DD') as published_date, sc.retrieved_at::text as retrieved_at,
              sc.triage_status::text as triage_status, sc.triage_reason,
              sc.analysis_status::text as analysis_status, sc.signal_id,
              sig.is_published as signal_published,
              sc.archived_at::text as archived_at
         from signal_candidates sc
         left join signals sig on sig.id = sc.signal_id
         ${clause}
        order by sc.retrieved_at desc
        limit $${whereParams.length + 1} offset $${whereParams.length + 2}`,
      [...whereParams, pageSize, (page - 1) * pageSize]
    ),
    one<{ n: number }>(
      `select count(*)::int as n from signal_candidates sc ${clause}`,
      whereParams
    ),
  ]);
  return { rows, total: totalRow?.n ?? 0, page, pageSize };
}
