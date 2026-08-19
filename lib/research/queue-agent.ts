import { runStructured } from '../dossier';
import * as m from '../mutations';
import {
  getConceptDigest, getThreadDigest, getTargets, getSteeringNote, getReviewTasteDigest,
} from '../data';
import { q } from '../db';

// The research console's queue agent: a recommend-only pass over the pending
// review queue. One bounded chunk per server action (the console loops), the
// triage discipline applied to the DECISION layer: for each paper the model
// recommends tracked / noted / dismissed with a one-line reason, a confidence,
// and a short cluster label (groups dismissals by theme). Grounding: the Atlas
// digests (claims, threads, concepts), the admin's standing steering note, and
// a digest of past human decisions (revealed taste). Nothing here writes
// review_status: the human accepts, per row or in bulk.

export const AGENT_CHUNK = 12;
const ABSTRACT_CLIP = 1000;

const AGENT_SYSTEM_HEAD = [
  'You are the review-queue agent for The AI Atlas, a tool for staying oriented in the AI-economy debate.',
  'Triage has already kept these papers as plausibly relevant; your job is the next decision, the one the human editor makes for every paper: recommend exactly one of tracked, noted, or dismissed.',
  'TRACKED means the watchlist: the editor should read this paper because it plausibly moves a listed research thread, bears on a listed claim or bridge-claim, or is a result the AI-economy debate will have to absorb. Tracking is expensive attention; recommend it sparingly, for the clearly strongest papers.',
  'NOTED means shelf memory: relevant enough to keep visible, not worth the editor\'s reading time now.',
  'DISMISSED means not relevant enough for this Atlas: incremental methods work, narrow applications, benchmark-only results with no economic implication. Most of a typical queue is correctly dismissed; dismissal is reversible and papers that gain citations resurface automatically.',
  'For every paper: reason = one short sentence in plain language arguing the decision for THIS Atlas (for tracked papers, write it as the "why track" note the editor would keep). confidence = 0-100, how sure you are of the decision. cluster = a 2-4 word theme label (e.g. "benchmark only", "narrow medical application", "agent reliability", "labor economics"); clusters group dismissals for one-click bulk review, so keep labels consistent across papers.',
  'Respect the steering note above everything else when present: it is the editor\'s current priorities.',
  'Learn the editor\'s taste from the decision history: what they tracked (and why), noted, and dismissed. Match that revealed preference, not a generic notion of paper quality.',
  'Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

function buildSchema(ids: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', enum: ids },
            recommendation: { type: 'string', enum: ['tracked', 'noted', 'dismissed'] },
            // The Anthropic tool validator rejects minimum/maximum on integers;
            // the range lives in the description and the writer clamps.
            confidence: { type: 'integer', description: '0 to 100' },
            reason: { type: 'string' },
            cluster: { type: 'string' },
          },
          required: ['id', 'recommendation', 'confidence', 'reason', 'cluster'],
        },
      },
    },
    required: ['decisions'],
  };
}

// Run-static context (steering + taste + Atlas digests) rides in the SYSTEM
// block, cache_control'd by runStructured, so chunks 2..N read it from cache.
async function buildSystem(): Promise<string> {
  const [steering, taste, concepts, threads, targets] = await Promise.all([
    getSteeringNote(), getReviewTasteDigest(), getConceptDigest(), getThreadDigest(), getTargets(),
  ]);
  const parts: string[] = [AGENT_SYSTEM_HEAD];
  if (steering?.trim()) {
    parts.push(`\n\nSTEERING NOTE from the editor (their current priorities, follow it):\n${steering.trim().slice(0, 1500)}`);
  }
  parts.push(
    '\n\nDECISION HISTORY (the editor\'s revealed taste):',
    'Tracked:',
    ...taste.tracked.map((t) => `- "${t.title}"${t.note ? ` (why: ${t.note.slice(0, 140)})` : ''}`),
    'Noted:',
    ...taste.noted.map((t) => `- "${t}"`),
    'Dismissed:',
    ...taste.dismissed.map((t) => `- "${t}"`),
    '\nATLAS THREADS (papers that move these lean tracked):',
    ...threads.map((t) => `- ${t.slug}: ${t.title}`),
    '\nATLAS CLAIMS AND BRIDGES (codes only, for bearing):',
    [...targets.claims, ...targets.bridges].map((t) => `[${t.code}] ${t.statement.slice(0, 110)}`).join('\n'),
    '\nATLAS CONCEPTS:',
    concepts.map((c) => c.slug).join(', ')
  );
  return parts.join('\n');
}

export interface AgentChunkResult {
  processed: number;
  tracked: number;
  noted: number;
  dismissed: number;
}

export async function recommendQueueChunk(paperIds: string[]): Promise<AgentChunkResult> {
  const ids = paperIds.slice(0, AGENT_CHUNK);
  const papers = await q<{
    id: string; title: string; abstract: string | null; categories: string[];
    comments: string | null; author_hindex: number | null;
    triage_summary: string | null; triage_reason: string | null;
    claim_touches: string[]; suggested_threads: string[];
  }>(
    `select id::text as id, title, abstract, categories, comments, author_hindex,
            triage_summary, triage_reason, claim_touches, suggested_threads
       from papers
      where id = any($1::uuid[]) and triage_status = 'kept' and review_status = 'pending'`,
    [ids]
  );
  if (!papers.length) return { processed: 0, tracked: 0, noted: 0, dismissed: 0 };

  const user = [
    'PAPERS TO DECIDE (recommend exactly one decision for each id):',
    ...papers.map((p) => [
      `id: ${p.id}`,
      `title: ${p.title}`,
      p.categories.length ? `categories: ${p.categories.join(', ')}` : null,
      p.author_hindex != null ? `h-max: ${p.author_hindex}` : null,
      p.comments ? `comment: ${p.comments.slice(0, 120)}` : null,
      p.triage_summary ? `triage summary: ${p.triage_summary}` : null,
      p.triage_reason ? `triage reason: ${p.triage_reason}` : null,
      p.claim_touches.length ? `advisory touches: ${p.claim_touches.join(', ')}` : null,
      p.suggested_threads.length ? `suggested threads: ${p.suggested_threads.join(', ')}` : null,
      p.abstract ? `abstract: ${p.abstract.slice(0, ABSTRACT_CLIP)}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n\n');

  const out = await runStructured<{
    decisions: { id: string; recommendation: 'tracked' | 'noted' | 'dismissed'; confidence: number; reason: string; cluster: string }[];
  }>({
    system: await buildSystem(),
    user,
    toolName: 'submit_queue_decisions',
    toolDescription: 'Submit one recommended decision per paper id.',
    schema: buildSchema(papers.map((p) => p.id)),
    maxTokens: 2800,
    effort: 'low',
    feature: 'research_agent',
    timeoutMs: 55_000,
    maxRetries: 0,
  });

  const valid = new Set(papers.map((p) => p.id));
  const rows = (out.decisions ?? [])
    .filter((d) => valid.has(d.id))
    .map((d) => ({
      id: d.id,
      recommendation: d.recommendation,
      confidence: d.confidence,
      reason: (d.reason ?? '').trim().slice(0, 500),
      cluster: (d.cluster ?? '').trim().slice(0, 60).toLowerCase() || null,
    }));
  const processed = await m.setAgentRecommendations(rows);
  return {
    processed,
    tracked: rows.filter((r) => r.recommendation === 'tracked').length,
    noted: rows.filter((r) => r.recommendation === 'noted').length,
    dismissed: rows.filter((r) => r.recommendation === 'dismissed').length,
  };
}
