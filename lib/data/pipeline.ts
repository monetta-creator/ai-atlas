import { q, one } from '../db';
import type {
  PipelineRun, SignalCandidate, } from '../types';

// ---- Discovery pipeline (admin-only reads) ---------------------------------
// raw_content (potentially large) is omitted from list reads and fetched only per
// candidate during analysis.
// published_date is a `date` (node-pg would hand it back as a Date); to_char keeps it a
// plain 'YYYY-MM-DD' string so the type is honest and prompt/JSX use is slice-safe.
const CANDIDATE_LIST_COLUMNS = `
  id, run_id, url, headline, source_domain, lens,
  to_char(published_date, 'YYYY-MM-DD') as published_date, retrieved_at,
  triage_status, triage_reason, signal_id, source_id, analysis_status, analysis_error,
  archived_at::text as archived_at, created_at, updated_at`;

export async function getRun(id: string): Promise<PipelineRun | null> {
  return one<PipelineRun>(`select * from pipeline_runs where id = $1`, [id]);
}

export async function getRuns(limit = 20): Promise<PipelineRun[]> {
  // Discovery runs only — single-source ('source') runs are an implementation detail of the
  // manual "Turn into signal" flow and would otherwise flood the history / "latest run" panel.
  return q<PipelineRun>(
    `select * from pipeline_runs where cadence <> 'source' order by triggered_at desc limit $1`,
    [limit]
  );
}

export async function getCandidates(runId: string): Promise<SignalCandidate[]> {
  return q<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates where run_id = $1
      order by lens, triage_status, retrieved_at`,
    [runId]
  );
}

export async function getCandidate(id: string): Promise<SignalCandidate | null> {
  return one<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, raw_content from signal_candidates where id = $1`,
    [id]
  );
}

export async function getApprovedCandidates(runId: string): Promise<SignalCandidate[]> {
  return q<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates
      where run_id = $1 and triage_status = 'approved'
      order by lens, retrieved_at`,
    [runId]
  );
}

// ---- Learning loop (migration 0016) ----------------------------------------
// The pipeline's own funnel history, per source domain. Decided candidates only
// (pending excluded) so a run can never bias against a domain it just discovered.
// "approved" counts the original triage decision: candidates later flagged
// 'unanalyzable:' were approved first, then flipped to rejected by the give-up path.
interface DomainStat {
  domain: string;
  seen: number;
  approved: number;
  drafted: number;
  duplicate: number;
  unanalyzable: number;
}

export async function getDomainStats(minSeen = 2): Promise<DomainStat[]> {
  return q<DomainStat>(
    `select regexp_replace(lower(source_domain), '^www\\.', '') as domain,
            count(*)::int as seen,
            count(*) filter (where triage_status = 'approved' or triage_reason like 'unanalyzable:%')::int as approved,
            count(*) filter (where analysis_status = 'drafted')::int as drafted,
            count(*) filter (where triage_status = 'duplicate')::int as duplicate,
            count(*) filter (where triage_reason like 'unanalyzable:%')::int as unanalyzable
       from signal_candidates
      where source_domain is not null and source_domain <> '' and triage_status <> 'pending'
      group by 1
     having count(*) >= $1
      order by count(*) desc`,
    [minSeen]
  );
}

// Triage processes pending candidates one bounded chunk per server-action call. This
// fetches the next chunk; writing decisions moves them out of
// 'pending', so repeated calls drain the queue (and resume a partially-triaged run).
export async function getPendingCandidates(runId: string, limit: number): Promise<SignalCandidate[]> {
  return q<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates
      where run_id = $1 and triage_status = 'pending' and archived_at is null
      order by lens, retrieved_at
      limit $2`,
    [runId, limit]
  );
}

// Un-triaged candidates blocking the run, archived ones excluded (migration 0013): an archived
// straggler is set aside, so it neither queues for triage nor blocks the run from completing.
export async function countPendingCandidates(runId: string): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from signal_candidates where run_id = $1 and triage_status = 'pending' and archived_at is null`,
    [runId]
  );
  return row?.n ?? 0;
}

// For the discovery lookback window ("last 7 days, or since the last run"). Excludes 'source'
// runs (single manual sources) — they would otherwise shrink the next discovery window.
export async function getLastCompletedRunAt(): Promise<string | null> {
  const row = await one<{ triggered_at: string }>(
    `select triggered_at from pipeline_runs where status = 'completed' and cadence <> 'source' order by triggered_at desc limit 1`
  );
  return (row?.triggered_at as unknown as string) ?? null;
}

// Every URL already tracked: manual sources + any candidate that became a draft. Discovery
// triage flags a re-discovered URL as a duplicate against this set, so a manually-uploaded
// link never re-enters the pipeline. Small (single-user tool); loaded once per triage chunk.
export async function getKnownUrls(): Promise<string[]> {
  const rows = await q<{ url: string }>(
    `select url from sources where url is not null and url <> ''
     union
     select url from signal_candidates where signal_id is not null and url is not null and url <> ''`
  );
  return rows.map((r) => r.url);
}

// Idempotency for the manual "Turn into signal" flow: the most recent candidate for a source
// (if any), so a repeat click resumes it instead of creating a second run/candidate.
export async function getCandidateBySourceId(sourceId: string): Promise<SignalCandidate | null> {
  return one<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates where source_id = $1
      order by created_at desc limit 1`,
    [sourceId]
  );
}

// Has this source already produced a signal? (Covers both the new candidate flow and any
// pre-refactor manual signal created directly with a source_id.)
export async function getSignalIdBySource(sourceId: string): Promise<string | null> {
  const row = await one<{ id: string }>(
    `select id from signals where source_id = $1 order by created_at limit 1`,
    [sourceId]
  );
  return row?.id ?? null;
}

// Triage context: existing signals (title + ISO date) for semantic dedup, and the
// admin's already-rated source outlets so triage can lean on prior human reliability
// judgments. Both kept small — they feed a single triage prompt.
export async function getSignalsDigestForTriage(): Promise<{
  signals: { id: string; title: string; published_at: string | null }[];
  ratedSources: { outlet: string; reliability_prior: number }[];
}> {
  const signals = await q<{ id: string; title: string; published_at: string | null }>(
    `select id, title, to_char(published_at, 'YYYY-MM-DD') as published_at
       from signals order by published_at desc limit 200`
  );
  const ratedSources = await q<{ outlet: string; reliability_prior: number }>(
    `select outlet, reliability_prior from sources
      where reliability_prior is not null and outlet is not null and btrim(outlet) <> ''
      order by reliability_prior desc limit 60`
  );
  return { signals, ratedSources };
}

// ---- Retained-text coverage (the full-text hydration guard, /pipeline) ----
// A published signal "has text" when its source row carries raw_text or any of
// its candidate rows cached raw_content — the same coalesce the document viewer
// and the articles-full-text dataset read.

export interface TextCoverage {
  total: number;
  with_text: number;
}

export async function getTextCoverage(): Promise<TextCoverage> {
  const row = await one<TextCoverage>(
    `select count(*)::int as total,
            count(*) filter (where src.raw_text is not null and length(src.raw_text) > 0
              or exists (select 1 from signal_candidates c
                          where c.signal_id = s.id and c.raw_content is not null))::int as with_text
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published`
  );
  return row ?? { total: 0, with_text: 0 };
}

// A published signal missing retained text (a legacy gap: intake now retains
// text up front). Display-only — the admin re-adds the text on the source.
export interface MissingTextRow {
  signal_id: string;
  title: string;
  source_id: string | null;
  candidate_id: string | null;
  url: string | null;
}

const MISSING_TEXT_SQL = `
  select s.id::text as signal_id, s.title, src.id::text as source_id,
         sc.id::text as candidate_id, coalesce(src.url, sc.url) as url
    from signals s
    left join sources src on src.id = s.source_id
    left join lateral (
      select c.id, c.url from signal_candidates c
       where c.signal_id = s.id
       order by c.retrieved_at desc, c.id limit 1
    ) sc on true
   where s.is_published
     and (src.raw_text is null or length(src.raw_text) = 0)
     and not exists (select 1 from signal_candidates c
                      where c.signal_id = s.id and c.raw_content is not null)`;

export async function listSignalsMissingText(limit = 5): Promise<MissingTextRow[]> {
  return q<MissingTextRow>(
    `${MISSING_TEXT_SQL} order by s.published_at desc nulls last, s.id limit $1`,
    [limit]
  );
}
