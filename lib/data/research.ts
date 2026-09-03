import { q, one } from '../db';
import type {
  Paper, ResearchRun, ResearchEngineRun, ResearchPrefs, ResearchThread, ThreadPaperRow, ResearchThreadScan,
  WatchlistRow, RisingReject, RecentThreadRevision, RoundupPaper, ResearchHealth, ResearchModelStat, } from '../types';

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

// ---- Research engine (migration 0046) ---------------------------------------
// Reads for the day-keyed checkpointed engine (lib/research/engine.ts) and the
// home tracker. The engine row shares research_runs with the manual console
// flow (day null there); ENGINE_RUN_COLUMNS pulls only the columns the engine
// shape needs, cast the same way as getIntelRun/getScanRun.

const ENGINE_RUN_COLUMNS = `
  id::text as id, to_char(day, 'YYYY-MM-DD') as day, status, step,
  to_char(since_date, 'YYYY-MM-DD') as since_date,
  scanned_count, pulled_count, kept_count, rejected_count, notes, error, created_at, updated_at`;

// By id, for the engine's own advance loop and the console tick action (the
// getIntelRun precedent).
export async function getResearchRun(runId: string): Promise<ResearchEngineRun | null> {
  return one<ResearchEngineRun>(`select ${ENGINE_RUN_COLUMNS} from research_runs where id = $1`, [runId]);
}

// By day (defaults to today UTC), for the cron route's "already complete"
// check and the home tracker's day-grid style read.
export async function getResearchRunByDay(day?: string): Promise<ResearchEngineRun | null> {
  return one<ResearchEngineRun>(
    `select ${ENGINE_RUN_COLUMNS} from research_runs
      where day = coalesce($1::date, (now() at time zone 'utc')::date)`,
    [day ?? null]
  );
}

// The runtime switches. Missing row = enabled with no models selected (the
// getIntelPrefs idiom): the singleton is created lazily by the first toggle
// or picker save.
export async function getResearchPrefs(): Promise<ResearchPrefs> {
  const row = await one<{ enabled: boolean; triage_model: string | null; analysis_models: string[] }>(
    `select enabled, triage_model, analysis_models from research_prefs where id = true`
  );
  return {
    enabled: row?.enabled ?? true,
    triage_model: row?.triage_model ?? null,
    analysis_models: row?.analysis_models ?? [],
  };
}

// The engine's 'agent' step feed: kept, pending-review papers the queue agent
// has not yet recommended on, oldest-untouched-first isn't needed here
// (published_at desc matches the console's own queue order). Distinct from
// getAllPendingPaperIds (the console's full-refresh "Run" button, which
// re-processes already-recommended rows too): the engine advances past a
// paper once it has been recommended, so a resumed invocation never repeats it.
export async function getUnrecommendedPaperIds(limit = 12): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select id from papers
      where triage_status = 'kept' and review_status = 'pending' and agent_recommendation is null
      order by published_at desc nulls last
      limit $1`,
    [limit]
  );
  return rows.map((r) => r.id);
}

// The engine's 'analyze' step feed: the next batch of papers worth the model
// spend (ANALYZE_POOL-wide, lib/research/engine.ts), agent-recommended
// (tracked or noted) and not yet analyzed. excludeIds keeps one invocation
// from retrying the same broken paper on a later unit after its
// hydrate/analyze call fails.
export async function getNextAnalysisCandidates(excludeIds: string[], limit: number): Promise<{ id: string }[]> {
  return q<{ id: string }>(
    `select id::text as id from papers
      where triage_status = 'kept' and review_status = 'pending'
        and agent_recommendation in ('tracked', 'noted')
        and extraction is null
        and not (id = any($1::uuid[]))
      order by agent_confidence desc nulls last
      limit $2`,
    [excludeIds, limit]
  );
}

// GLOBAL count (no run_id filter): the triage queue is shared across runs, so
// this reflects everything still awaiting triage regardless of which run
// pulled it in (mirrors claimPendingPapers/rejectExhaustedTriagePapers in
// lib/mutations/research.ts).
export async function countPendingPapers(): Promise<number> {
  const row = await one<{ n: string }>(
    `select count(*)::text as n from papers where triage_status = 'pending'`
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

// ---- Weekly research roundup (lib/research/roundup.ts) ---------------------
// Add-only readers for the Friday cron's pack builder. Public columns only:
// review_note and raw_content never appear here (the roundup auto-publishes,
// so its pack must be guest-safe from the start).

// Tracked+noted papers reviewed within [sinceISO, toISO], with their extraction
// fields flattened and confirmed thread placements resolved. reviewed_at (not
// published_at) bounds the window, matching getTrackedSince's convention.
export async function getReviewedSince(sinceISO: string, toISO: string): Promise<RoundupPaper[]> {
  return q<RoundupPaper>(
    `select p.id, p.title, p.arxiv_id, p.url,
            to_char(p.published_at, 'YYYY-MM-DD') as published_on,
            p.review_status, p.rigor_prior, p.citation_count,
            p.extraction->>'headline_claim' as headline_claim,
            p.extraction->>'effect_size' as effect_size,
            p.extraction->>'econ_implication' as econ_implication,
            p.claim_touches,
            coalesce((
              select array_agg(t.slug order by t.slug)
                from thread_papers tp
                join research_threads t on t.id = tp.thread_id
               where tp.paper_id = p.id and tp.status = 'confirmed'
            ), '{}') as thread_slugs
       from papers p
      where p.review_status in ('tracked', 'noted')
        and p.reviewed_at >= $1::date and p.reviewed_at < ($2::date + 1)
      order by p.reviewed_at desc, p.id`,
    [sinceISO, toISO]
  );
}

// Threads that gained a confirmed thread_papers row within the window, with the
// count (the roundup's auto-refresh candidate list, and the per-thread
// "papers added this week" figure in the pack).
export async function getThreadsWithNewPapersSince(
  sinceISO: string, toISO: string
): Promise<{ slug: string; new_papers: number }[]> {
  return q<{ slug: string; new_papers: number }>(
    `select t.slug, count(*)::int as new_papers
       from thread_papers tp
       join research_threads t on t.id = tp.thread_id
      where tp.status = 'confirmed'
        and tp.created_at >= $1::date and tp.created_at < ($2::date + 1)
      group by t.slug
      order by count(*) desc, t.slug`,
    [sinceISO, toISO]
  );
}

// The week's discovery-engine activity: completed day-keyed runs (migration
// 0046) in range, summed. Context for the roundup's narrative, not a gate.
export async function getResearchRunStatsSince(
  sinceISO: string, toISO: string
): Promise<{ runsCompleted: number; papersPulled: number; papersKept: number }> {
  const row = await one<{ runs: number; pulled: number; kept: number }>(
    `select count(*)::int as runs,
            coalesce(sum(pulled_count), 0)::int as pulled,
            coalesce(sum(kept_count), 0)::int as kept
       from research_runs
      where day is not null and status = 'completed'
        and day >= $1::date and day <= $2::date`,
    [sinceISO, toISO]
  );
  return { runsCompleted: row?.runs ?? 0, papersPulled: row?.pulled ?? 0, papersKept: row?.kept ?? 0 };
}

// ---- /research/console operations (the getScanHealth shape applied here) ---
// Every read below is day-keyed-only (research_runs.day is not null): the OLD
// manual console flow's since_date-only rows never enter these aggregates.
const RESEARCH_FEATURES = ['research_triage', 'research_analysis', 'research_agent', 'research_synthesis'];

export async function getResearchHealth(days = 30): Promise<ResearchHealth> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const [runAgg, papersAgg, findingsAgg, spend, issueRows, firstRun] = await Promise.all([
    one<{ completed: number; failed: number; running: number }>(
      `select count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status = 'failed')::int as failed,
              count(*) filter (where status = 'running')::int as running
         from research_runs where day is not null and day > current_date - $1::interval`,
      [interval]
    ),
    one<{ pulled: number; kept: number; rejected: number }>(
      `select coalesce(sum(pulled_count), 0)::int as pulled,
              coalesce(sum(kept_count), 0)::int as kept,
              coalesce(sum(rejected_count), 0)::int as rejected
         from research_runs where day is not null and day > current_date - $1::interval`,
      [interval]
    ),
    // "Reviewed" here means the human decision (tracked/noted) landed within the
    // window, not that the paper was published within it (reviewed_at is the
    // only clean timestamp for when the shelf gained the row).
    one<{ reviewed: number; with_finding: number }>(
      `select count(*)::int as reviewed, count(extraction)::int as with_finding
         from papers
        where review_status in ('tracked', 'noted')
          and reviewed_at > now() - $1::interval`,
      [interval]
    ),
    one<{ usd: number }>(
      `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
        where feature = any($2) and created_at > now() - $1::interval`,
      [interval, RESEARCH_FEATURES]
    ),
    // The last 14 day-keyed runs (not a days-interval window: research may not
    // run every weekday, so a run-count window surfaces real issues even when
    // recent activity is sparse), flattened newest first, capped at 30 notes.
    q<{ day: string; note: string }>(
      `select to_char(r.day, 'YYYY-MM-DD') as day, n as note
         from (select day, notes from research_runs where day is not null
                order by day desc limit 14) r,
              unnest(r.notes) as n
        order by day desc
        limit 30`
    ),
    one<{ first: string | null }>(`select to_char(min(day), 'YYYY-MM-DD') as first from research_runs where day is not null`),
  ]);

  // Missed days: WEEKDAYS in [max(first day-keyed run, window start), today] minus
  // weekdays that have a day-keyed run row (the getScanHealth idiom: the crons
  // run weekdays only, so a quiet weekend is never a miss).
  let missedDays = 0;
  if (firstRun?.first) {
    const dayRows = await q<{ n: number }>(
      `select count(*)::int as n from research_runs
        where day is not null and day > current_date - $1::interval and extract(isodow from day) < 6`,
      [interval]
    );
    const start = new Date(`${firstRun.first}T00:00:00Z`);
    const windowStart = new Date(Date.now() - days * 86_400_000);
    const from = start > windowStart ? start : windowStart;
    let elapsedWeekdays = 0;
    for (let t = from.getTime(); t <= Date.now(); t += 86_400_000) {
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6) elapsedWeekdays += 1;
    }
    missedDays = Math.max(0, elapsedWeekdays - (dayRows[0]?.n ?? 0));
  }

  const kept = papersAgg?.kept ?? 0;
  const rejected = papersAgg?.rejected ?? 0;
  const reviewed = findingsAgg?.reviewed ?? 0;
  const withFinding = findingsAgg?.with_finding ?? 0;

  return {
    days,
    runs: {
      completed: runAgg?.completed ?? 0,
      failed: runAgg?.failed ?? 0,
      running: runAgg?.running ?? 0,
      missedDays,
    },
    papers: {
      pulled: papersAgg?.pulled ?? 0,
      kept,
      rejected,
      keptRate: kept + rejected > 0 ? kept / (kept + rejected) : null,
    },
    findings: {
      reviewed,
      withFinding,
      coverage: reviewed > 0 ? withFinding / reviewed : null,
    },
    spendUsd: spend?.usd ?? 0,
    issues: issueRows,
  };
}

// The /research/console Model A/B table: per analyzing model over the window,
// volume, what the human did with the paper afterward (review_status), and
// cost/latency from the cost log (feature research_analysis). Mirrors
// getAnalysisModelStats (pipeline) / getEnrichModelStats (scan). analyzed_by
// has no clean "when analyzed" timestamp of its own (it rides updated_at,
// which also moves on unrelated edits), so this reads cumulative state
// rather than a days-window slice; only the cost-log half is windowed.
export async function getResearchModelAB(days = 30): Promise<ResearchModelStat[]> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const rows = await q<{
    model: string; analyzed: number; tracked: number; noted: number; dismissed: number;
    avg_agent_confidence: number | null;
    avg_wall_ms: number | null; cost_usd: number | null; calls: number | null;
  }>(
    `select p.analyzed_by as model,
            count(*)::int as analyzed,
            count(*) filter (where p.review_status = 'tracked')::int as tracked,
            count(*) filter (where p.review_status = 'noted')::int as noted,
            count(*) filter (where p.review_status = 'dismissed')::int as dismissed,
            round(avg(p.agent_confidence)::numeric, 1) as avg_agent_confidence,
            l.avg_wall_ms, l.cost_usd, l.calls
       from papers p
       left join (
         select model, round(avg(wall_ms))::int as avg_wall_ms,
                sum(cost_usd)::numeric as cost_usd, count(*)::int as calls
           from ai_cost_log
          where feature = 'research_analysis' and created_at > now() - $1::interval
          group by model
       ) l on l.model = p.analyzed_by
      where p.analyzed_by is not null
      group by p.analyzed_by, l.avg_wall_ms, l.cost_usd, l.calls
      order by analyzed desc, p.analyzed_by`,
    [interval]
  );
  return rows.map((r) => ({
    model: r.model,
    analyzed: r.analyzed,
    tracked: r.tracked,
    noted: r.noted,
    dismissed: r.dismissed,
    avgAgentConfidence: r.avg_agent_confidence === null ? null : Number(r.avg_agent_confidence),
    avgWallMs: r.avg_wall_ms,
    costUsd: r.cost_usd ?? 0,
    costPerPaper: r.calls ? Number(((r.cost_usd ?? 0) / r.calls).toFixed(4)) : null,
  }));
}
