import { routedStructured } from '../model-route';
import { DEFAULT_UTILITY_MODEL } from '../pipeline/config';
import { relevancePrompt } from './pack-core';
import type { RelevancePromptSignal, RelevanceScore } from './pack-core';

// The real thesis-relevance scorer (feature 'thesis_relevance'). Injected into
// buildThesisPackCore as opts.scoreRelevance (see the note in pack-core.ts) so
// the deterministic core stays network-free; this module is the only caller of
// routedStructured for this feature, kept out of pack-core.ts on purpose.
//
// Chunks of 25 signals per call (a long thesis pack routinely carries well
// over a hundred matches, and the schema is a flat array). Chunks run
// independently: one chunk's failure just leaves its signals unscored
// (pack-core's per-signal fallback treats an unscored signal as relevant,
// same as today); only when EVERY chunk fails do we throw, so pack-core's
// catch can record the honest "relevance scoring failed" note instead of
// silently pretending the whole pass succeeded.

const CHUNK_SIZE = 25;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function scoreChunk(
  thesisStatement: string,
  items: RelevancePromptSignal[]
): Promise<RelevanceScore[]> {
  const { system, user, schema } = relevancePrompt(thesisStatement, items);
  const out = await routedStructured<{ scores?: { signal_id: string; relevance: number; why: string }[] }>({
    model: DEFAULT_UTILITY_MODEL,
    system,
    user,
    toolName: 'submit_thesis_relevance',
    toolDescription: 'Return a relevance score from 0 to 1 for each listed signal, judged against the thesis statement.',
    schema,
    maxTokens: 1200,
    timeoutMs: 60_000,
    feature: 'thesis_relevance',
  });
  const validIds = new Set(items.map((i) => i.signal_id));
  return (out.scores ?? [])
    .filter((s) => validIds.has(s?.signal_id))
    .map((s) => ({
      signal_id: s.signal_id,
      relevance: Math.min(1, Math.max(0, Number(s.relevance) || 0)),
      why: String(s.why ?? '').slice(0, 120),
    }));
}

export async function scoreThesisRelevance(
  thesisStatement: string,
  signals: RelevancePromptSignal[]
): Promise<RelevanceScore[]> {
  if (!signals.length) return [];
  const chunks = chunk(signals, CHUNK_SIZE);
  const settled = await Promise.allSettled(chunks.map((c) => scoreChunk(thesisStatement, c)));
  const results: RelevanceScore[] = [];
  let anyOk = false;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      anyOk = true;
      results.push(...r.value);
    }
  }
  if (!anyOk) throw new Error('Thesis relevance scoring failed for every chunk.');
  return results;
}
