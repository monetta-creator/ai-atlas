import { one, exec, withTx } from '../db';
import type {
  RunStatus, PaperTriageStatus, PaperReviewStatus, ResearchStep, PaperExtraction, ThreadRelation,
  ThreadStatus, ResearchThreadScan,
  } from '../types';
import { sanitizeText } from '../pipeline/web';
import type { ArxivEntry } from '../research/arxiv';

// ---- Research engine (migration 0046) ----------------------------------------
// Writers for the day-keyed checkpointed engine (the intel_runs pattern
// applied to research_runs): createDayResearchRun IS the checkpoint row (day
// is unique among non-null rows, so a second call the same day resumes rather
// than duplicating), the lease trio guards overlapping cron invocations, and
// appendResearchRunNotes persists per-invocation issues (the scan 0040
// pattern). updateResearchRun (below) still drives step/status transitions —
// both flows share it.

export async function createDayResearchRun(day: string, sinceISO: string): Promise<{ id: string; created: boolean }> {
  const inserted = await one<{ id: string }>(
    `insert into research_runs (day, since_date, status, step) values ($1::date, $2::date, 'running', 'pull')
     on conflict (day) where day is not null do nothing
     returning id::text as id`,
    [day, sinceISO]
  );
  if (inserted) return { id: inserted.id, created: true };
  const existing = await one<{ id: string }>(
    `select id::text as id from research_runs where day = $1::date`,
    [day]
  );
  if (!existing) throw new Error('research run vanished between insert and select');
  return { id: existing.id, created: false };
}

// Take the run lease for ~5 minutes. Also flips a failed run back to running
// (resume). False = another invocation holds it; the caller exits quietly.
export async function claimResearchRun(runId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update research_runs
        set lease_until = now() + interval '5 minutes',
            status = 'running', error = null, updated_at = now()
      where id = $1
        and status in ('running', 'failed')
        and (lease_until is null or lease_until < now())
      returning id::text as id`,
    [runId]
  );
  return Boolean(row);
}

// Lease renewal between work units (only the holder calls this) and release on
// clean exit (so a same-day manual resume never waits out the lease).
export async function renewResearchLease(runId: string): Promise<void> {
  await exec(`update research_runs set lease_until = now() + interval '5 minutes' where id = $1`, [runId]);
}

export async function releaseResearchLease(runId: string): Promise<void> {
  await exec(`update research_runs set lease_until = null, updated_at = now() where id = $1`, [runId]);
}

// Persist an invocation's issue notes (the scan 0040 / intel pattern):
// appended in first-occurrence order, deduplicated against what the row
// already holds, capped at 40.
export async function appendResearchRunNotes(runId: string, notes: string[]): Promise<void> {
  const clean = [...new Set(notes.map((n) => sanitizeText(n).trim().slice(0, 300)).filter(Boolean))].slice(0, 20);
  if (!clean.length) return;
  await exec(
    `update research_runs
        set notes = (
          select coalesce(array_agg(n order by o), '{}') from (
            select n, min(ord) as o
              from unnest(notes || $2::text[]) with ordinality as t(n, ord)
             group by n
             order by min(ord)
             limit 40
          ) d
        ), updated_at = now()
      where id = $1`,
    [runId, clean]
  );
}

export async function failResearchRun(runId: string, error: string): Promise<void> {
  await exec(
    `update research_runs set status = 'failed', error = $2, lease_until = null, updated_at = now()
      where id = $1`,
    [runId, error.slice(0, 500)]
  );
}

// The stale-run janitor (mirrors failStaleDailyRuns in mutations/pipeline.ts):
// a daily run left 'running' from a prior day can never be resumed (the cron
// only ever advances today's row), so mark it failed with an honest error
// instead of letting the row lie forever in the console/health panel. Legacy
// manual runs (day is null) are untouched.
export async function failStaleResearchRuns(): Promise<number> {
  return exec(
    `update research_runs
        set status = 'failed', error = 'incomplete: superseded by a newer daily run', updated_at = now()
      where status = 'running' and day is not null and day < (now() at time zone 'utc')::date`
  );
}

// The cron on/off switch. Gates the CRON route only; the console's manual
// tick ignores it on purpose (an admin clicking IS the override).
export async function setResearchEnabled(enabled: boolean): Promise<void> {
  await exec(
    `insert into research_prefs (id, enabled) values (true, $1)
     on conflict (id) do update set enabled = excluded.enabled, updated_at = now()`,
    [enabled]
  );
}

// The console's model pickers (triage utility model + analysis A/B): each
// field updates independently — an undefined field keeps the row's current
// value (or the column default when no row exists yet) rather than clobbering
// the other picker's selection.
export async function setResearchModels(
  opts: { triageModel?: string | null; analysisModels?: string[] }
): Promise<void> {
  const current = await one<{ triage_model: string | null; analysis_models: string[] }>(
    `select triage_model, analysis_models from research_prefs where id = true`
  );
  const triageModel = opts.triageModel !== undefined ? opts.triageModel : (current?.triage_model ?? null);
  const analysisModels = opts.analysisModels !== undefined ? opts.analysisModels : (current?.analysis_models ?? []);
  await exec(
    `insert into research_prefs (id, triage_model, analysis_models) values (true, $1, $2::text[])
     on conflict (id) do update set
       triage_model = excluded.triage_model, analysis_models = excluded.analysis_models, updated_at = now()`,
    [triageModel, analysisModels]
  );
}

// ---- Research section (migration 0023) ---------------------------------------

export async function createResearchRun(sinceISO: string): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into research_runs (since_date, status, step) values ($1::date, 'running', 'pull') returning id`,
    [sinceISO]
  );
  return row!.id;
}

export async function updateResearchRun(
  id: string,
  fields: Partial<{ status: RunStatus; step: ResearchStep; error: string | null }>
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.status !== undefined) { params.push(fields.status); sets.push(`status = $${params.length}`); }
  if (fields.step !== undefined) { params.push(fields.step); sets.push(`step = $${params.length}`); }
  if (fields.error !== undefined) { params.push(fields.error); sets.push(`error = $${params.length}`); }
  if (!sets.length) return;
  params.push(id);
  await exec(`update research_runs set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
}

// Pull-step tallies are increments (one page per call); triage tallies are recomputed
// from the papers themselves (recomputeResearchRunCounts) so re-runs stay honest.
export async function bumpResearchPullCounts(id: string, scanned: number, inserted: number): Promise<void> {
  await exec(
    `update research_runs
        set scanned_count = scanned_count + $1, pulled_count = pulled_count + $2, updated_at = now()
      where id = $3`,
    [scanned, inserted, id]
  );
}

export async function recomputeResearchRunCounts(id: string): Promise<void> {
  await exec(
    `update research_runs r set
       kept_count     = (select count(*) from papers p where p.run_id = r.id and p.triage_status = 'kept'),
       rejected_count = (select count(*) from papers p where p.run_id = r.id and p.triage_status = 'rejected'),
       updated_at = now()
     where r.id = $1`,
    [id]
  );
}

// Bulk-upsert one pulled page. On conflict (a paper already in the library from a prior
// run, a manual add, or a revision bubbling up the sort) refresh the arXiv metadata but
// NEVER touch funnel or review state — triage decisions and the personal layer survive
// re-pulls. Returns how many rows were actually new.
export async function upsertArxivPapers(runId: string, entries: ArxivEntry[]): Promise<number> {
  if (!entries.length) return 0;
  let inserted = 0;
  await withTx(async (c) => {
    for (const e of entries) {
      const res = await c.query(
        `insert into papers
           (origin, arxiv_id, url, run_id, title, abstract, authors, categories, comments,
            arxiv_version, published_at, arxiv_updated)
         values ('arxiv', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, nullif($10,'')::date, nullif($11,'')::date)
         on conflict (arxiv_id) do update set
           title = excluded.title, abstract = excluded.abstract, authors = excluded.authors,
           categories = excluded.categories, comments = excluded.comments,
           arxiv_version = excluded.arxiv_version, arxiv_updated = excluded.arxiv_updated,
           updated_at = now()
         returning (xmax = 0) as is_new`,
        [
          e.arxiv_id, e.url, runId, sanitizeText(e.title), sanitizeText(e.abstract),
          JSON.stringify(e.authors), e.categories, e.comment ? sanitizeText(e.comment) : null,
          e.version, e.published, e.updated,
        ]
      );
      if ((res.rows[0] as { is_new: boolean } | undefined)?.is_new) inserted++;
    }
  });
  return inserted;
}

export async function setPaperTriage(
  paperId: string,
  status: PaperTriageStatus,
  reason: string | null,
  suggestions?: { claim_touches: string[]; suggested_concepts: string[]; suggested_threads: string[] },
  summary?: string | null
): Promise<void> {
  await exec(
    `update papers
        set triage_status = $1, triage_reason = $2,
            triage_summary = coalesce($3, triage_summary),
            claim_touches = coalesce($4, claim_touches),
            suggested_concepts = coalesce($5, suggested_concepts),
            suggested_threads = coalesce($6, suggested_threads),
            updated_at = now()
      where id = $7`,
    [
      status, reason,
      summary ?? null,
      suggestions?.claim_touches ?? null,
      suggestions?.suggested_concepts ?? null,
      suggestions?.suggested_threads ?? null,
      paperId,
    ]
  );
}

// The review decision + its why (the human gate on the research funnel). Tracking
// requires a note — enforced in the action; this just writes.
export async function setPaperReview(paperId: string, status: PaperReviewStatus, note: string | null): Promise<void> {
  await exec(
    `update papers set review_status = $1, review_note = $2, reviewed_at = now(), updated_at = now() where id = $3`,
    [status, note, paperId]
  );
}

// Manual "Add paper": insert as pre-approved (triage 'kept' — human before the expensive
// call). Dedup on arxiv_id/url returns the existing row instead of duplicating; existed
// lets the action route the admin to what is already there.
export async function createManualPaper(input: {
  arxiv_id?: string | null;
  url: string;
  title: string;
  abstract?: string | null;
  authors?: string[];
  categories?: string[];
  comments?: string | null;
  published_at?: string | null; // YYYY-MM-DD
  arxiv_version?: number | null;
  arxiv_updated?: string | null;
  source_id?: string | null;
  raw_content?: string | null;  // pre-hydrated text (the "Send to research" path)
  fetched_via?: string | null;
  rigor_prior?: number | null;  // seeded from the source's reliability prior
}): Promise<{ id: string; existed: boolean }> {
  const existing = await one<{ id: string }>(
    `select id from papers where url = $1 or (arxiv_id is not null and arxiv_id = $2) limit 1`,
    [input.url, input.arxiv_id ?? null]
  );
  if (existing) {
    // Backfill the source link when the paper was already in the library (e.g. pulled
    // from arXiv earlier, now sent over from its curated source page).
    if (input.source_id) {
      await exec(`update papers set source_id = coalesce(source_id, $1), updated_at = now() where id = $2`, [input.source_id, existing.id]);
    }
    return { id: existing.id, existed: true };
  }
  const row = await one<{ id: string }>(
    `insert into papers
       (origin, arxiv_id, url, source_id, title, abstract, authors, categories, comments,
        arxiv_version, published_at, arxiv_updated, triage_status, triage_reason)
     values ('manual', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9,
             nullif($10,'')::date, nullif($11,'')::date, 'kept', 'added by the admin')
     returning id`,
    [
      input.arxiv_id ?? null, input.url, input.source_id ?? null,
      sanitizeText(input.title), input.abstract ? sanitizeText(input.abstract) : null,
      JSON.stringify(input.authors ?? []), input.categories ?? [],
      input.comments ? sanitizeText(input.comments) : null,
      input.arxiv_version ?? null, input.published_at ?? '', input.arxiv_updated ?? '',
    ]
  );
  if (input.raw_content || input.rigor_prior != null) {
    await exec(
      `update papers set raw_content = coalesce($1, raw_content), fetched_via = coalesce($2, fetched_via),
              rigor_prior = coalesce($3, rigor_prior), updated_at = now()
        where id = $4`,
      [input.raw_content ? sanitizeText(input.raw_content) : null, input.fetched_via ?? null, input.rigor_prior ?? null, row!.id]
    );
  }
  return { id: row!.id, existed: false };
}

// Retention for triage rejects (docs/research-section.md): metadata rows are kept ~90
// days for the citation-velocity self-correction, then pruned. Opportunistic — called
// at run start, never from a cron. Guards keep anything referenced or human-touched.
export async function pruneRejectedPapers(days = 90): Promise<number> {
  return exec(
    `delete from papers
      where triage_status = 'rejected'
        and review_status = 'pending'
        and signal_id is null and source_id is null
        and created_at < now() - make_interval(days => $1)
        and not exists (select 1 from thread_papers tp where tp.paper_id = papers.id)
        and not exists (select 1 from paper_concepts pc where pc.paper_id = papers.id)`,
    [days]
  );
}

// Atomically claim one chunk of pending papers for triage, so CONCURRENT triage
// chunks (the console runs a small pool) never send the same paper to the model
// twice: the claim is a single statement with `for update skip locked`, and marks
// the rows via triage_reason. A claim expires after 5 minutes (updated_at), so a
// chunk that died mid-model-call self-heals on the next pass — its papers are
// still triage_status='pending' and get reclaimed.
export async function claimPendingPapers(
  runId: string, limit: number
): Promise<{ id: string; arxiv_id: string | null; title: string; abstract: string | null; categories: string[]; comments: string | null; published_at: string | null }[]> {
  const { rows } = await withTx(async (c) =>
    c.query(
      `update papers set triage_reason = 'in triage', triage_attempts = triage_attempts + 1, updated_at = now()
        where id in (
          select id from papers
           where run_id = $1 and triage_status = 'pending'
             and triage_attempts < 3
             and (triage_reason is distinct from 'in triage' or updated_at < now() - interval '5 minutes')
           order by published_at desc nulls last, created_at
           limit $2
           for update skip locked)
        returning id, arxiv_id, title, abstract, categories, comments,
                  to_char(published_at, 'YYYY-MM-DD') as published_at`,
      [runId, limit]
    )
  );
  return rows as { id: string; arxiv_id: string | null; title: string; abstract: string | null; categories: string[]; comments: string | null; published_at: string | null }[];
}

// Release the claim on papers whose decision never came back from the model
// (truncated output, shifted indices): they stay pending and are immediately
// reclaimable, up to the triage_attempts cap the claim enforces. This replaces
// the old fail-closed 'No decision returned' reject.
export async function releaseTriageClaims(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await exec(
    `update papers set triage_reason = null, updated_at = now()
      where id = any($1::uuid[]) and triage_status = 'pending'`,
    [ids]
  );
}

// Reject papers that burned all their triage attempts without ever getting a
// decision, with a reason distinct from a real model reject. Skips papers a
// live concurrent chunk still holds (fresh 'in triage' marker).
export async function rejectExhaustedTriagePapers(runId: string): Promise<number> {
  return exec(
    `update papers set triage_status = 'rejected', triage_reason = 'Triage unavailable (3 attempts)', updated_at = now()
      where run_id = $1 and triage_status = 'pending' and triage_attempts >= 3
        and (triage_reason is distinct from 'in triage' or updated_at < now() - interval '5 minutes')`,
    [runId]
  );
}

// ---- Research phase 2: analysis cache, extraction, links, promotion ----------

export async function setPaperRawContent(paperId: string, text: string | null, via?: string | null): Promise<void> {
  const clean = text == null ? null : sanitizeText(text);
  await exec(
    `update papers set raw_content = $1, fetched_via = coalesce($2, fetched_via), updated_at = now() where id = $3`,
    [clean, via ?? null, paperId]
  );
}

// Persist the structured finding + refresh the advisory arrays (the full-text pass is
// more authoritative than triage's abstract-only guesses). Never touches rigor_prior.
// analyzedBy stamps which model produced this extraction (migration 0046's
// papers.analyzed_by; mirrors signals.drafted_by) — optional so a caller with
// no model context (none exists today) still writes cleanly.
export async function setPaperExtraction(
  paperId: string,
  extraction: PaperExtraction,
  suggestions: { claim_touches: string[]; suggested_concepts: string[]; suggested_threads: string[] },
  analyzedBy?: string | null
): Promise<void> {
  await exec(
    `update papers set
       extraction = $1::jsonb, claim_touches = $2, suggested_concepts = $3, suggested_threads = $4,
       analyzed_by = coalesce($5, analyzed_by),
       updated_at = now()
     where id = $6`,
    [
      JSON.stringify(extraction),
      suggestions.claim_touches, suggestions.suggested_concepts, suggestions.suggested_threads,
      analyzedBy ?? null,
      paperId,
    ]
  );
}

// The human sets the rigor prior (the model only ever suggested one inside extraction).
export async function setPaperRigor(paperId: string, prior: number | null): Promise<void> {
  await exec(`update papers set rigor_prior = $1, updated_at = now() where id = $2`, [prior, paperId]);
}

export async function setPaperSource(paperId: string, sourceId: string): Promise<void> {
  await exec(`update papers set source_id = $1, updated_at = now() where id = $2`, [sourceId, paperId]);
}

// Promotion is additive: the paper stays in the research library; this link is the
// road a paper's findings take into the Argument Map (via the signal publish gate).
export async function setPaperSignal(paperId: string, signalId: string | null): Promise<void> {
  await exec(`update papers set signal_id = $1, updated_at = now() where id = $2`, [signalId, paperId]);
}

// Paper->concept and paper->thread links are human-committed ('confirmed') rows; the
// model's proposals live in the papers.suggested_* arrays until confirmed here.
export async function confirmPaperConcept(paperId: string, conceptSlug: string): Promise<void> {
  await exec(
    `insert into paper_concepts (paper_id, concept_slug, status) values ($1, $2, 'confirmed')
     on conflict (paper_id, concept_slug) do update set status = 'confirmed'`,
    [paperId, conceptSlug]
  );
}

export async function removePaperConcept(paperId: string, conceptSlug: string): Promise<void> {
  await exec(`delete from paper_concepts where paper_id = $1 and concept_slug = $2`, [paperId, conceptSlug]);
}

export async function placePaperInThread(
  paperId: string, threadSlug: string, relation: ThreadRelation, why: string | null
): Promise<void> {
  const thread = await one<{ id: string }>(`select id from research_threads where slug = $1`, [threadSlug]);
  if (!thread) throw new Error('Thread not found.');
  await exec(
    `insert into thread_papers (thread_id, paper_id, relation, why, status)
     values ($1, $2, $3, $4, 'confirmed')
     on conflict (thread_id, paper_id) do update set relation = excluded.relation, why = excluded.why, status = 'confirmed'`,
    [thread.id, paperId, relation, why]
  );
}

export async function removePaperFromThread(paperId: string, threadSlug: string): Promise<void> {
  await exec(
    `delete from thread_papers tp using research_threads t
      where tp.thread_id = t.id and t.slug = $1 and tp.paper_id = $2`,
    [threadSlug, paperId]
  );
}

// ---- Research phase 3: threads as living pages -------------------------------

// The synthesis write: update the living page AND preserve the prior discipline —
// every rewrite (including the first) lands in thread_revisions with what triggered
// it, atomically. The snapshots idea applied to prose.
export async function setThreadSynthesis(
  threadId: string, synthesisHtml: string, triggerNote: string | null
): Promise<void> {
  await withTx(async (c) => {
    await c.query(
      `update research_threads set synthesis = $1, updated_at = now() where id = $2`,
      [synthesisHtml, threadId]
    );
    await c.query(
      `insert into thread_revisions (thread_id, synthesis, trigger_note) values ($1, $2, $3)`,
      [threadId, synthesisHtml, triggerNote]
    );
  });
}

export async function createThread(slug: string, title: string, question: string): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into research_threads (slug, title, question) values ($1, $2, $3)
     on conflict (slug) do nothing
     returning id`,
    [slug, title, question]
  );
  if (!row) throw new Error('A thread with that slug already exists.');
  return row.id;
}

export async function setThreadStatus(threadId: string, status: ThreadStatus): Promise<void> {
  await exec(`update research_threads set status = $1, updated_at = now() where id = $2`, [status, threadId]);
}

// Persist (or clear) the latest thread scan — singleton row, mirrors concept_gap_scan.
export async function saveThreadScan(scan: ResearchThreadScan | null): Promise<void> {
  if (!scan || !scan.recommendations.length) {
    await exec(`delete from research_thread_scan where id = true`, []);
    return;
  }
  await exec(
    `insert into research_thread_scan (id, recommendation, generated_at)
     values (true, $1::jsonb, now())
     on conflict (id) do update set recommendation = excluded.recommendation, generated_at = now()`,
    [JSON.stringify(scan)]
  );
}

// ---- Research phase 4: citation self-correction -------------------------------

export async function bulkUpdatePedigree(
  pairs: { id: string; count: number | null; hindex: number | null }[]
): Promise<void> {
  if (!pairs.length) return;
  await exec(
    `update papers p set
        citation_count = coalesce(u.count, p.citation_count),
        author_hindex = coalesce(u.hindex, p.author_hindex),
        citations_checked_at = now(), updated_at = now()
       from unnest($1::uuid[], $2::int[], $3::int[]) as u(id, count, hindex)
      where p.id = u.id`,
    [pairs.map((p) => p.id), pairs.map((p) => p.count), pairs.map((p) => p.hindex)]
  );
}

// Put a paper the funnel passed on back into the review queue (the rising-rejects
// second chance): triage flips to kept, the review decision resets to pending.
export async function requeuePaper(paperId: string): Promise<void> {
  await exec(
    `update papers set triage_status = 'kept', review_status = 'pending',
            triage_reason = coalesce(triage_reason, '') || ' [requeued: rising citations]',
            updated_at = now()
      where id = $1`,
    [paperId]
  );
}

// ---- Queue agent (migration 0033) -------------------------------------------
// Recommendations are advisory rows on papers; the review actions below remain
// the only path that changes review_status (human commits, per row or in bulk).

export async function setAgentRecommendations(rows: {
  id: string;
  recommendation: 'tracked' | 'noted' | 'dismissed';
  confidence: number;
  reason: string;
  cluster: string | null;
}[]): Promise<number> {
  return withTx(async (c) => {
    let n = 0;
    for (const r of rows) {
      const res = await c.query(
        `update papers
            set agent_recommendation = $2, agent_reason = $3, agent_confidence = $4,
                agent_cluster = $5, agent_at = now(), updated_at = now()
          where id = $1 and triage_status = 'kept' and review_status = 'pending'`,
        [r.id, r.recommendation, r.reason, Math.max(0, Math.min(100, Math.round(r.confidence))), r.cluster]
      );
      n += res.rowCount ?? 0;
    }
    return n;
  });
}

export async function saveSteeringNote(text: string | null): Promise<void> {
  await exec(
    `insert into research_agent_prefs (id, steering) values (true, $1)
     on conflict (id) do update set steering = excluded.steering, updated_at = now()`,
    [text]
  );
}

// Bulk accept of agent recommendations: applies the SAME review write as a
// manual decision to every pending paper whose recommendation matches. Track
// whys come from the agent reason (editable later on the paper page). Returns
// the affected ids so the console can chain finding extraction for tracks.
export async function acceptAgentRecommendations(
  decision: 'tracked' | 'noted' | 'dismissed'
): Promise<string[]> {
  return withTx(async (c) => {
    const res = await c.query(
      `update papers
          set review_status = $1,
              review_note = case when $1 = 'tracked'
                then coalesce(nullif(agent_reason, ''), 'Tracked on the queue agent''s recommendation.')
                else review_note end,
              reviewed_at = now(), updated_at = now()
        where triage_status = 'kept' and review_status = 'pending' and agent_recommendation = $1
        returning id`,
      [decision]
    );
    return res.rows.map((r) => r.id as string);
  });
}
