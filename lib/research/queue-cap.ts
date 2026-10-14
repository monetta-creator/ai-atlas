import { researchStructured } from './model-route';
import { recommendQueueChunk, queueAgentModel } from './queue-agent';
import { finalists, byCapRank, type FinalistCandidate } from './queue-core';
import { getResearchPrefs, getSteeringNote, getThreadDigest, getUnrecommendedPaperIds } from '../data/research';
import { capResearchQueue } from '../mutations/research';
import { q, one } from '../db';

// "Triage down to N": the review desk's one-shot backlog clear. Two phases,
// each bounded so a server action or a local script can drive it:
//   1. readUnreadBatch: the queue agent reads papers it never recommended on,
//      READ_POOL chunks of 12 concurrently (server actions from one client run
//      serially, so the parallelism lives here, not in the browser).
//   2. pickAndCap: one cheap-model call picks the N most worth the editor's
//      reading time from the agent's track and note picks (most confident
//      first, POOL_MAX shown); every other pending paper is dismissed with
//      review_basis 'bulk_cap'. Dismissal keeps the row and is reversible, and
//      nothing is bulk-noted: noted papers feed the public shelf and the
//      Friday roundup. A failed pick falls back to the agent's confidence order.

const AGENT_CHUNK = 12;
export const READ_POOL = 8;
const POOL_MAX = 100;

export async function countUnreadPending(): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from papers
      where triage_status = 'kept' and review_status = 'pending' and agent_recommendation is null`
  );
  return row?.n ?? 0;
}

export async function readUnreadBatch(pool = READ_POOL): Promise<{ processed: number; failed: number; remaining: number }> {
  const ids = await getUnrecommendedPaperIds(AGENT_CHUNK * pool);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += AGENT_CHUNK) chunks.push(ids.slice(i, i + AGENT_CHUNK));
  const settled = await Promise.allSettled(chunks.map((c) => recommendQueueChunk(c)));
  let processed = 0;
  let failed = 0;
  for (const s of settled) {
    if (s.status === 'fulfilled') processed += s.value.processed;
    else failed++;
  }
  return { processed, failed, remaining: await countUnreadPending() };
}

export interface CapResult {
  pending: number;          // before the cut
  kept: number;
  dismissed: number;
  trackPicksCut: number;    // agent track picks that did not make the N
  unreadCut: number;        // dismissed without an agent read
  picker: 'model' | 'confidence' | 'none';
  model: string | null;
  keepIds: string[];
}

interface Row extends FinalistCandidate {
  title: string;
  reason: string | null;
  finding: string | null;
  touches: string[];
}

export async function pickAndCap(keep: number, opts: { dryRun?: boolean } = {}): Promise<CapResult> {
  const rows = await q<Row>(
    `select id::text as id, title, agent_recommendation::text as rec, agent_confidence as confidence,
            agent_reason as reason, extraction->>'headline_claim' as finding, claim_touches as touches
       from papers
      where triage_status = 'kept' and review_status = 'pending'`
  );
  const prefs = await getResearchPrefs();
  const model = queueAgentModel(prefs.triage_model);
  const base = { pending: rows.length, model };
  if (rows.length <= keep) {
    return { ...base, kept: rows.length, dismissed: 0, trackPicksCut: 0, unreadCut: 0, picker: 'none', keepIds: rows.map((r) => r.id) };
  }

  const pool = rows
    .filter((r) => r.rec === 'tracked' || r.rec === 'noted')
    .sort(byCapRank)
    .slice(0, POOL_MAX);

  let picked: string[] = [];
  let picker: CapResult['picker'] = 'confidence';
  if (pool.length > keep) {
    try {
      picked = await pickFinalists(pool, keep, model);
      if (picked.length) picker = 'model';
    } catch {
      picked = [];
    }
  }
  const keepIds = finalists(rows, picked, keep);
  const keepSet = new Set(keepIds);
  const cut = rows.filter((r) => !keepSet.has(r.id));
  const summary = {
    ...base, kept: keepIds.length, dismissed: cut.length, picker, keepIds,
    trackPicksCut: cut.filter((r) => r.rec === 'tracked').length,
    unreadCut: cut.filter((r) => !r.rec).length,
  };
  if (opts.dryRun) return summary;
  const done = await capResearchQueue(keepIds);
  return { ...summary, dismissed: done.length };
}

async function pickFinalists(pool: Row[], keep: number, model: string | null): Promise<string[]> {
  const [steering, threads] = await Promise.all([getSteeringNote(), getThreadDigest()]);
  const system = [
    'You are the review-queue editor for The AI Atlas, a tool for staying oriented in the AI-economy debate.',
    `A queue agent has already read every paper below and recommended it. The human editor has time for exactly ${keep}. Choose the ${keep} most worth their reading time, best first.`,
    'Prefer papers that move a listed research thread or bear on a listed claim, results the AI-economy debate will have to absorb, and variety across themes over several papers making the same point.',
    steering?.trim() ? `STEERING NOTE from the editor (follow it):\n${steering.trim().slice(0, 1500)}` : '',
    'RESEARCH THREADS:',
    ...threads.map((t) => `- ${t.slug}: ${t.title}`),
    'Never use an em dash anywhere.',
  ].filter(Boolean).join('\n');
  const user = [
    `CANDIDATES (choose ${keep} ids):`,
    ...pool.map((p) => [
      `id: ${p.id}`,
      `title: ${p.title}`,
      `agent: ${p.rec} ${p.confidence ?? ''}`.trim(),
      p.reason ? `agent reason: ${p.reason.slice(0, 220)}` : null,
      p.finding ? `finding: ${p.finding.slice(0, 220)}` : null,
      p.touches.length ? `touches: ${p.touches.join(', ')}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n\n');
  const out = await researchStructured<{ ids: string[] }>({
    model,
    system,
    user,
    toolName: 'submit_finalists',
    toolDescription: `Submit the ${keep} paper ids most worth the editor's reading time, best first.`,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ids: { type: 'array', items: { type: 'string', enum: pool.map((p) => p.id) } } },
      required: ['ids'],
    },
    maxTokens: 3000,
    timeoutMs: 90_000,
    feature: 'research_queue_pick',
  });
  return Array.isArray(out.ids) ? out.ids.filter((x) => typeof x === 'string') : [];
}
