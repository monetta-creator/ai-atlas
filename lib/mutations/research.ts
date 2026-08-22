import { one, exec, withTx } from '../db';
import type {
  PaperReviewStatus, PaperExtraction, ThreadRelation,
  ThreadStatus, ResearchThreadScan,
  } from '../types';
import { sanitizeText } from '../text';

// ---- Research section (migration 0023) ---------------------------------------

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
export async function setPaperExtraction(
  paperId: string,
  extraction: PaperExtraction,
  suggestions: { touches: string[]; suggested_concepts: string[]; suggested_threads: string[] }
): Promise<void> {
  await exec(
    `update papers set
       extraction = $1::jsonb, touches = $2, suggested_concepts = $3, suggested_threads = $4,
       updated_at = now()
     where id = $5`,
    [
      JSON.stringify(extraction),
      suggestions.touches, suggestions.suggested_concepts, suggestions.suggested_threads,
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
