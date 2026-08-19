import { q, one } from '../db';
import type {
  Signal, TopClaim, PipelineAnalytics, PipelineRunPoint, RunLensCount, RunTriageBreakdown,
  LensPerformance, PipelineImpact, CandidateArchiveFilters, CandidateArchiveResult, CandidateArchiveRow,
  MapHealth,
  } from '../types';
import { SIGNAL_COLUMNS } from './signals';

// ---- Home dashboard (app/page.tsx) -----------------------------------------
// The landing surface: top claims/signals, pipeline analytics, a browsable candidate
// archive, and a light map-health strip. Evidence counts are structural (public);
// confidence is personal-layer (nulled for guests). The pipeline analytics + archive
// are public operational metadata (no personal-layer fields).

// Claims ranked by how much evidence is attached. Inner join => only claims with ≥1
// evidence row surface (the point of "top claims"). Frames carry no evidence.
export async function getTopClaims(personal: boolean, limit = 6): Promise<TopClaim[]> {
  const rows = await q<TopClaim>(
    `select c.id, c.code, c.statement, c.domain::text as domain,
            c.confidence, c.confidence_label,
            count(ev.id)::int as evidence_count,
            count(*) filter (where ev.direction = 'supports')::int   as supports,
            count(*) filter (where ev.direction = 'contradicts')::int as contradicts,
            count(*) filter (where ev.direction = 'neutral')::int     as neutral
       from claims c
       join evidence ev on ev.target_type = 'claim' and ev.target_id = c.id
      where c.is_frame = false
      group by c.id
      order by evidence_count desc, c.code
      limit $1`,
    [limit]
  );
  // Confidence is the personal layer; evidence counts stay (they're structural).
  return personal ? rows : rows.map((r) => ({ ...r, confidence: null, confidence_label: null }));
}

// The most recently published signals, richer-in-touches first within the recency band.
// Published-only for everyone (the panel is "latest published"); the feed card shows no
// confidence, so there's nothing further to strip.
export async function getTopSignals(limit = 6): Promise<Signal[]> {
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published = true
      order by s.published_at desc, cardinality(s.claim_touches) desc, s.created_at desc
      limit $1`,
    [limit]
  );
}

// A light, public orientation strip. One grouped query for the claim-evidence shape,
// plus a published-signal count. `contested` (confidence-derived) is admin-only.
export async function getMapHealth(personal: boolean): Promise<MapHealth> {
  const row = await one<{
    claims: number; uncovered: number; one_sided: number; evidence: number; contested: number;
  }>(`
    with claim_ev as (
      select c.id, c.confidence_label,
             count(ev.id) as n,
             count(*) filter (where ev.direction = 'supports')   as sup,
             count(*) filter (where ev.direction = 'contradicts') as con
        from claims c
        left join evidence ev on ev.target_type = 'claim' and ev.target_id = c.id
       where c.is_frame = false
       group by c.id
    )
    select
      (select count(*) from claim_ev)::int as claims,
      (select count(*) from claim_ev where n = 0)::int as uncovered,
      (select count(*) from claim_ev where (sup >= 2 and con = 0) or (con >= 2 and sup = 0))::int as one_sided,
      (select count(*) from evidence)::int as evidence,
      (select count(*) from claim_ev where confidence_label = 'contested')::int as contested
  `);
  const sig = await one<{ n: number }>(
    `select count(*)::int as n from signals where is_published = true`
  );
  return {
    claims: row?.claims ?? 0,
    uncovered: row?.uncovered ?? 0,
    oneSided: row?.one_sided ?? 0,
    evidence: row?.evidence ?? 0,
    signalsPublished: sig?.n ?? 0,
    contested: personal ? (row?.contested ?? 0) : null,
  };
}

// Pipeline operations analytics (public per the dashboard's visibility choice — these are
// aggregate counts, not personal-layer data). Five parallel reads: runs (with published +
// analysis-status tallies), per-run×lens counts, per-run triage breakdown, and a lens
// performance aggregate. timestamptz cast to text so the type stays honest over the wire.
export async function getPipelineAnalytics(): Promise<PipelineAnalytics> {
  const [runs, perRunLens, triage, lensPerformance, impact] = await Promise.all([
    q<PipelineRunPoint>(
      `select r.id, r.triggered_at::text as triggered_at,
              r.cadence::text as cadence, r.status::text as status, r.step::text as step,
              r.candidate_count, r.approved_count, r.signal_count,
              count(distinct sig.id) filter (where sig.is_published and sc.archived_at is null)::int   as published_count,
              count(sc.id) filter (where sc.analysis_status = 'drafted'   and sc.archived_at is null)::int as drafted,
              count(sc.id) filter (where sc.analysis_status = 'error'     and sc.archived_at is null)::int as errored,
              count(sc.id) filter (where sc.analysis_status = 'discarded' and sc.archived_at is null)::int as discarded
         from pipeline_runs r
         left join signal_candidates sc on sc.run_id = r.id
         left join signals sig on sig.id = sc.signal_id
        where r.cadence <> 'source'
        group by r.id
        order by r.triggered_at asc`
    ),
    q<RunLensCount>(
      `select sc.run_id, sc.lens::text as lens,
              count(*)::int as candidates,
              count(distinct sig.id) filter (where sig.is_published)::int as published
         from signal_candidates sc
         left join signals sig on sig.id = sc.signal_id
        group by sc.run_id, sc.lens`
    ),
    q<RunTriageBreakdown>(
      // Archived candidates (migration 0013) are excluded from every triage bucket here too, so
      // the per-run triage funnel and the conversion-rate trends stay consistent with the
      // funnel-composition view (which treats archived as its own segment, out of the buckets).
      `select run_id,
              count(*) filter (where triage_status = 'pending'  and archived_at is null)::int as pending,
              count(*) filter (where triage_status = 'approved' and archived_at is null)::int as approved,
              count(*) filter (where triage_status = 'rejected' and analysis_status <> 'discarded' and archived_at is null)::int as rejected,
              count(*) filter (where triage_status = 'duplicate' and archived_at is null)::int as duplicate,
              count(*) filter (where analysis_status = 'discarded' and archived_at is null)::int as discarded
         from signal_candidates
        group by run_id`
    ),
    q<LensPerformance>(
      // candidates counts everything (the funnel denominator). archived (migration 0013) is its
      // own segment, so every other bucket excludes archived_at — an archived candidate leaves
      // pending/approved/rejected/duplicate and lands only in `archived`, keeping the partition exact.
      `select sc.lens::text as lens,
              count(*)::int as candidates,
              count(*) filter (where sc.triage_status = 'pending'   and sc.archived_at is null)::int as pending,
              count(*) filter (where sc.triage_status = 'approved'  and sc.archived_at is null)::int as approved,
              count(*) filter (where sc.triage_status = 'rejected' and sc.analysis_status <> 'discarded' and sc.archived_at is null)::int as rejected,
              count(*) filter (where sc.triage_status = 'duplicate' and sc.archived_at is null)::int as duplicate,
              count(*) filter (where sc.analysis_status = 'drafted' and sc.archived_at is null)::int as drafted,
              count(distinct sig.id) filter (where sig.is_published and sc.archived_at is null)::int as published,
              count(*) filter (where sc.triage_status = 'approved' and sig.is_published and sc.archived_at is null)::int as published_candidates,
              count(*) filter (where sc.archived_at is not null)::int as archived
         from signal_candidates sc
         left join signals sig on sig.id = sc.signal_id
        group by sc.lens`
    ),
    // Downstream impact: argument-map targets touched by published-signal evidence. Evidence
    // with signal_id set exists only while its signal is published (syncSignalEvidence removes
    // it on unpublish; signal_id cascades on delete), so signal_id-not-null == currently live.
    // One evidence row per signal×target, so count(*) per direction == signals per direction.
    q<PipelineImpact>(
      `select e.target_type::text as target_type,
              e.target_id::text as target_id,
              coalesce(c.code, b.code) as code,
              coalesce(c.statement, b.statement) as label,
              count(distinct e.signal_id)::int as signals,
              count(*) filter (where e.direction = 'supports')::int    as supports,
              count(*) filter (where e.direction = 'contradicts')::int as contradicts,
              count(*) filter (where e.direction = 'neutral')::int     as neutral
         from evidence e
         left join claims c        on e.target_type = 'claim'        and c.id = e.target_id
         left join bridge_claims b on e.target_type = 'bridge_claim' and b.id = e.target_id
        where e.signal_id is not null
        -- each (target_type,target_id) resolves to exactly one claim XOR bridge_claim, so c.* / b.*
        -- are functionally dependent on target_id; the coalesce in select picks the non-null side.
        group by e.target_type, e.target_id, c.code, b.code, c.statement, b.statement
        order by count(distinct e.signal_id) desc, count(*) desc`
    ),
  ]);

  const totals = runs.reduce(
    (acc, r) => ({
      runs: acc.runs,
      candidates: acc.candidates + r.candidate_count,
      approved: acc.approved + r.approved_count,
      drafted: acc.drafted + r.drafted,
      published: acc.published + r.published_count,
      errored: acc.errored + r.errored,
      discarded: acc.discarded + r.discarded,
    }),
    { runs: runs.length, candidates: 0, approved: 0, drafted: 0, published: 0, errored: 0, discarded: 0 }
  );

  return { runs, perRunLens, triage, lensPerformance, impact, totals };
}

// The browsable candidate archive: every discovered candidate, filterable/searchable/
// paginated. Dynamic WHERE built param-safely (like getSignals). `dateField` is whitelisted
// to a literal column name (never raw user text); the search term is parameterized and its
// LIKE wildcards escaped. count(*) over() returns the unfiltered-by-page total in one trip.
export async function getCandidateArchive(f: CandidateArchiveFilters): Promise<CandidateArchiveResult> {
  const where: string[] = [];
  const whereParams: unknown[] = [];
  if (f.lens) { whereParams.push(f.lens); where.push(`sc.lens = $${whereParams.length}::signal_lens_t`); }
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
      `select sc.id, sc.run_id, sc.url, sc.headline, sc.source_domain, sc.lens::text as lens,
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
