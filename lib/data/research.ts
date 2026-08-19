import { q, one } from '../db';
import type {
  Paper, ResearchRun, ResearchThread, ThreadPaperRow, ResearchThreadScan, WatchlistRow, RisingReject,
  RecentThreadRevision, } from '../types';

// ===== Research section (migration 0023) =====================================
// Admin-first surface: no personal-layer stripping yet — every getter here is
// called from admin-gated pages/actions. When /research goes public, review_*,
// rigor_prior, and triage internals become the layer to strip.

// List reads omit the heavy columns (raw_content, extraction) — same discipline as
// signal_candidates. Dates cast to text (pg returns `date` as a JS Date otherwise).
const PAPER_LIST_COLUMNS = `
  id, origin, arxiv_id, url, run_id, source_id, title, abstract, authors, categories,
  comments, arxiv_version,
  to_char(published_at, 'YYYY-MM-DD') as published_at,
  to_char(arxiv_updated, 'YYYY-MM-DD') as arxiv_updated,
  triage_status, triage_reason, triage_summary, claim_touches, suggested_concepts, suggested_threads,
  fetched_via, rigor_prior, review_status, review_note, reviewed_at, signal_id,
  citation_count, citations_checked_at, author_hindex,
  agent_recommendation, agent_reason, agent_confidence, agent_cluster, agent_at::text as agent_at,
  created_at, updated_at`;

export async function getResearchRuns(limit = 15): Promise<ResearchRun[]> {
  return q<ResearchRun>(
    `select id, triggered_at, status, step, to_char(since_date, 'YYYY-MM-DD') as since_date,
            scanned_count, pulled_count, kept_count, rejected_count, error, created_at, updated_at
       from research_runs order by triggered_at desc limit $1`,
    [limit]
  );
}

export async function getLastResearchRunAt(): Promise<string | null> {
  const row = await one<{ triggered_at: string }>(
    `select triggered_at::text as triggered_at from research_runs
      where status = 'completed' order by triggered_at desc limit 1`
  );
  return row?.triggered_at ?? null;
}

export async function countPendingPapers(runId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `select count(*)::text as n from papers where run_id = $1 and triage_status = 'pending'`,
    [runId]
  );
  return Number(row?.n ?? 0);
}

// The review queue: triage-kept papers awaiting the human decision, newest first.
export async function getReviewQueuePapers(limit = 100): Promise<Paper[]> {
  return q<Paper>(
    `select ${PAPER_LIST_COLUMNS} from papers
      where triage_status = 'kept' and review_status = 'pending'
      order by published_at desc nulls last, created_at desc
      limit $1`,
    [limit]
  );
}

export async function getPaper(id: string): Promise<Paper | null> {
  return one<Paper>(
    `select ${PAPER_LIST_COLUMNS}, raw_content, extraction from papers where id = $1`,
    [id]
  );
}

// Triage digests: the concept and thread halves of the run-static system block.
export async function getConceptDigest(): Promise<{ slug: string; name: string; short_definition: string }[]> {
  return q(`select slug, name, short_definition from concepts order by slug`);
}

export async function getThreadDigest(): Promise<{ slug: string; title: string; question: string }[]> {
  return q(`select slug, title, question from research_threads where status = 'open' order by slug`);
}

export async function getResearchThreads(): Promise<ResearchThread[]> {
  return q<ResearchThread>(
    `select t.id, t.slug, t.title, t.question, t.synthesis, t.status, t.created_at, t.updated_at,
            (select count(*)::int from thread_papers tp where tp.thread_id = t.id) as paper_count
       from research_threads t
      order by t.status = 'open' desc, t.title`
  );
}

// Phase 2 getters: the analysis path + the paper detail page.

export async function getSourceText(sourceId: string): Promise<string | null> {
  const row = await one<{ raw_text: string | null }>(
    `select raw_text from sources where id = $1`,
    [sourceId]
  );
  return row?.raw_text ?? null;
}

// Confirmed concept links, resolved against live concepts (a dangling slug degrades
// to name=null — the drift flag, same discipline as concept_claims).
export async function getPaperConcepts(
  paperId: string
): Promise<{ slug: string; name: string | null; status: string }[]> {
  return q(
    `select pc.concept_slug as slug, c.name, pc.status
       from paper_concepts pc
       left join concepts c on c.slug = pc.concept_slug
      where pc.paper_id = $1
      order by pc.created_at`,
    [paperId]
  );
}

export async function getPaperThreads(
  paperId: string
): Promise<{ slug: string; title: string; relation: string; why: string | null; status: string }[]> {
  return q(
    `select t.slug, t.title, tp.relation, tp.why, tp.status
       from thread_papers tp
       join research_threads t on t.id = tp.thread_id
      where tp.paper_id = $1
      order by tp.created_at`,
    [paperId]
  );
}

// Phase 3: threads as pages.

export async function getThreadBySlug(slug: string): Promise<ResearchThread | null> {
  return one<ResearchThread>(
    `select id, slug, title, question, synthesis, status, created_at, updated_at
       from research_threads where slug = $1`,
    [slug]
  );
}

export async function getThreadPapers(threadId: string): Promise<ThreadPaperRow[]> {
  return q<ThreadPaperRow>(
    `select p.id, p.title, p.arxiv_id, p.url,
            to_char(p.published_at, 'YYYY-MM-DD') as published_at,
            tp.relation, tp.why, p.review_status, p.review_note,
            p.extraction->>'headline_claim' as headline,
            p.extraction->>'effect_size' as effect
       from thread_papers tp
       join papers p on p.id = tp.paper_id
      where tp.thread_id = $1 and tp.status = 'confirmed'
      order by p.published_at desc nulls last, p.created_at desc`,
    [threadId]
  );
}

export async function getThreadRevisions(
  threadId: string, limit = 10
): Promise<{ id: string; synthesis: string; trigger_note: string | null; created_at: string }[]> {
  return q(
    `select id, synthesis, trigger_note, created_at::text as created_at
       from thread_revisions where thread_id = $1
      order by created_at desc limit $2`,
    [threadId, limit]
  );
}

// The concept page's admin-only "recent research" pane: confirmed paper links.
export async function getPapersForConcept(
  slug: string, limit = 6
): Promise<{ id: string; title: string; arxiv_id: string | null; url: string; published_at: string | null; headline: string | null }[]> {
  return q(
    `select p.id, p.title, p.arxiv_id, p.url,
            to_char(p.published_at, 'YYYY-MM-DD') as published_at,
            p.extraction->>'headline_claim' as headline
       from paper_concepts pc
       join papers p on p.id = pc.paper_id
      where pc.concept_slug = $1 and pc.status = 'confirmed'
      order by p.published_at desc nulls last, p.created_at desc
      limit $2`,
    [slug, limit]
  );
}

// The thread-scan singleton, reconciled on read: a recommendation whose slug now
// exists as a live thread is dropped (it has been created since the scan).
export async function getThreadScan(): Promise<ResearchThreadScan | null> {
  const row = await one<{ recommendation: ResearchThreadScan }>(
    `select recommendation from research_thread_scan where id = true`
  );
  return row?.recommendation ?? null;
}

export function reconcileThreadScan(
  scan: ResearchThreadScan | null, liveSlugs: Set<string>
): ResearchThreadScan | null {
  if (!scan) return null;
  const recommendations = scan.recommendations.filter((r) => !liveSlugs.has(r.slug));
  return recommendations.length ? { ...scan, recommendations } : null;
}

// Phase 4: the watchlist + the citation self-correction surface.

export async function getWatchlist(limit = 60): Promise<WatchlistRow[]> {
  return q<WatchlistRow>(
    `select id, title, arxiv_id, url,
            to_char(published_at, 'YYYY-MM-DD') as published_at,
            review_note, reviewed_at::text as reviewed_at,
            extraction->>'headline_claim' as headline,
            citation_count, citations_checked_at::text as citations_checked_at, author_hindex, signal_id
       from papers
      where review_status = 'tracked'
      order by reviewed_at desc nulls last
      limit $1`,
    [limit]
  );
}

export async function getRisingRejects(minCitations = 5, limit = 12): Promise<RisingReject[]> {
  return q<RisingReject>(
    `select id, title, arxiv_id, url,
            to_char(published_at, 'YYYY-MM-DD') as published_at,
            triage_reason, review_status, citation_count
       from papers
      where citation_count >= $1
        and (triage_status = 'rejected' or review_status = 'dismissed')
      order by citation_count desc
      limit $2`,
    [minCitations, limit]
  );
}

// The research digest's two halves: papers tracked in the window, threads whose
// synthesis moved in the window.
export async function getTrackedSince(sinceISO: string | null): Promise<WatchlistRow[]> {
  return q<WatchlistRow>(
    `select id, title, arxiv_id, url,
            to_char(published_at, 'YYYY-MM-DD') as published_at,
            review_note, reviewed_at::text as reviewed_at,
            extraction->>'headline_claim' as headline,
            citation_count, citations_checked_at::text as citations_checked_at, signal_id
       from papers
      where review_status = 'tracked'
        and reviewed_at >= coalesce($1::date, (now() - interval '14 days')::date)
      order by reviewed_at desc`,
    [sinceISO]
  );
}

export async function getThreadsUpdatedSince(sinceISO: string | null): Promise<ResearchThread[]> {
  return q<ResearchThread>(
    `select t.id, t.slug, t.title, t.question, t.synthesis, t.status, t.created_at, t.updated_at,
            (select count(*)::int from thread_papers tp where tp.thread_id = t.id) as paper_count
       from research_threads t
      where t.synthesis is not null
        and t.updated_at >= coalesce($1::date, (now() - interval '14 days')::date)
      order by t.updated_at desc`,
    [sinceISO]
  );
}

// The portal's "what's new" strip: synthesis revisions in the window, with the
// trigger note as the human-readable delta. Public (trigger notes are editorial).
export async function getRecentThreadRevisions(sinceISO: string | null, limit = 8): Promise<RecentThreadRevision[]> {
  return q<RecentThreadRevision>(
    `select r.id, t.slug as thread_slug, t.title as thread_title,
            r.trigger_note, r.created_at::text as created_at
       from thread_revisions r
       join research_threads t on t.id = r.thread_id
      where r.created_at >= coalesce($1::date, (now() - interval '14 days')::date)
      order by r.created_at desc
      limit $2`,
    [sinceISO, limit]
  );
}

// Papers on the reviewed shelf whose ADVISORY touches name this claim/bridge code.
// A cross-link only: papers never write evidence (the 0023 invariant).
export async function getPapersForTarget(code: string, limit = 6): Promise<
  { id: string; title: string; arxiv_id: string | null; published_at: string | null; headline: string | null }[]
> {
  return q(
    `select id, title, arxiv_id, to_char(published_at, 'YYYY-MM-DD') as published_at,
            extraction->>'headline_claim' as headline
       from papers
      where triage_status = 'kept' and review_status in ('tracked', 'noted')
        and claim_touches @> array[$1]::text[]
      order by published_at desc nulls last
      limit $2`,
    [code, limit]
  );
}

// The portal's map rollup: which claims/bridges the reviewed shelf bears on,
// resolved to statements (dangling codes keep a null href and read as drift).
export async function getResearchTouchRollup(limit = 10): Promise<
  { code: string; statement: string | null; href: string | null; paper_count: number }[]
> {
  return q(
    `with touches as (
       select unnest(claim_touches) as code
         from papers
        where triage_status = 'kept' and review_status in ('tracked', 'noted')
     )
     select t.code,
            coalesce(c.statement, b.statement) as statement,
            case when c.id is not null then '/claim/' || t.code
                 when b.id is not null then '/bridge/' || t.code
                 else null end as href,
            count(*)::int as paper_count
       from touches t
       left join claims c on c.code = t.code
       left join bridge_claims b on b.code = t.code
      group by t.code, c.id, b.id, c.statement, b.statement
      order by count(*) desc, t.code
      limit $1`,
    [limit]
  );
}

// Findings coverage over the reviewed shelf (tracked + noted). The portal leads
// with findings now, so the console surfaces which reviewed papers still lack one;
// the panel batch-analyzes them, keeping the human in front of the spend.
export async function getFindingCoverage(): Promise<{
  reviewed: number; withFinding: number; missing: { id: string; title: string }[];
}> {
  const counts = await one<{ reviewed: number; with_finding: number }>(
    `select count(*)::int as reviewed, count(extraction)::int as with_finding
       from papers
      where triage_status = 'kept' and review_status in ('tracked', 'noted')`
  );
  const missing = await q<{ id: string; title: string }>(
    `select id, title from papers
      where triage_status = 'kept' and review_status in ('tracked', 'noted')
        and extraction is null
      order by (review_status = 'tracked') desc, reviewed_at desc nulls last`
  );
  return { reviewed: counts?.reviewed ?? 0, withFinding: counts?.with_finding ?? 0, missing };
}

// Noted papers, fetched directly (the old route filtered getReviewedPapers' merged
// tracked+noted list, which silently emptied Noted once tracked rows hit the cap).
export async function getNotedPapers(limit = 60): Promise<Paper[]> {
  return q<Paper>(
    `select ${PAPER_LIST_COLUMNS} from papers
      where review_status = 'noted'
      order by reviewed_at desc nulls last
      limit $1`,
    [limit]
  );
}

// ---- Queue agent (migration 0033) -------------------------------------------
// Readers for the research console's recommend-only queue agent.

// The run button processes ALL pending papers each time (already-recommended
// rows are refreshed too), so editing the steering note and re-running never
// leaves stale recommendations behind. Idempotent; a full pass costs cents.
export async function getAllPendingPaperIds(limit = 400): Promise<{ id: string; title: string }[]> {
  return q<{ id: string; title: string }>(
    `select id, title from papers
      where triage_status = 'kept' and review_status = 'pending'
      order by published_at desc nulls last
      limit $1`,
    [limit]
  );
}

// Counts per agent recommendation over the pending queue, for the panel's
// summary strip and bulk buttons ('none' = not yet processed).
export async function getAgentQueueSummary(): Promise<Record<string, number>> {
  const rows = await q<{ rec: string; n: number }>(
    `select coalesce(agent_recommendation::text, 'none') as rec, count(*)::int as n
       from papers
      where triage_status = 'kept' and review_status = 'pending'
      group by 1`
  );
  const out: Record<string, number> = { tracked: 0, noted: 0, dismissed: 0, none: 0 };
  for (const r of rows) out[r.rec] = r.n;
  return out;
}

export async function getSteeringNote(): Promise<string | null> {
  const row = await one<{ steering: string | null }>(`select steering from research_agent_prefs where id = true`);
  return row?.steering ?? null;
}

// The admin's revealed preferences, digested for the agent prompt: what got
// tracked (with the human why), noted, and dismissed. Taste without training.
export async function getReviewTasteDigest(): Promise<{
  tracked: { title: string; note: string | null }[];
  noted: string[];
  dismissed: string[];
}> {
  const [tracked, noted, dismissed] = await Promise.all([
    q<{ title: string; note: string | null }>(
      `select title, review_note as note from papers
        where review_status = 'tracked' order by reviewed_at desc nulls last limit 25`
    ),
    q<{ title: string }>(
      `select title from papers where review_status = 'noted'
        order by reviewed_at desc nulls last limit 15`
    ),
    q<{ title: string }>(
      `select title from papers where review_status = 'dismissed'
        order by reviewed_at desc nulls last limit 25`
    ),
  ]);
  return { tracked, noted: noted.map((r) => r.title), dismissed: dismissed.map((r) => r.title) };
}
