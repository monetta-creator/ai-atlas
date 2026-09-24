import { recordApiCall } from '../cost';

// The embedding client: OpenRouter's /embeddings endpoint, verified working
// with the existing OPENROUTER_API_KEY (openai/text-embedding-3-small, 1536
// dims, $0.02/Mtok). Batches of 64 texts per call, 30s abort, one bounded
// retry, cost logged through the same recordApiCall path as every other AI
// feature (feature 'embed_index' for backfill/incremental writes, 'embed_query'
// for a live question). This module is an APP module (uses ../cost, which
// pulls lib/db): it is used by lib/embed/index.ts and lib/ask/retrieve.ts's
// hybrid leg, never by a plain-Node script (scripts/backfill-embeddings.mjs
// hand-copies this request shape against a raw fetch instead — see that
// script's header note).

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
const BATCH_SIZE = 64;
const TIMEOUT_MS = 30_000;

export const DEFAULT_EMBED_MODEL = 'openai/text-embedding-3-small';

export function embedModel(): string {
  return process.env.EMBED_MODEL || DEFAULT_EMBED_MODEL;
}

interface EmbeddingsResponse {
  data?: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

async function embedBatch(
  batch: string[],
  model: string,
  apiKey: string,
  feature: 'embed_index' | 'embed_query',
  retried = false
): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: batch }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`OpenRouter embeddings ${res.status}: ${body.slice(0, 200)}`);
    if (!body.trim()) throw new Error('OpenRouter embeddings: empty response body');
    const data = JSON.parse(body) as EmbeddingsResponse;
    if (data.error?.message) throw new Error(`OpenRouter embeddings: ${data.error.message.slice(0, 200)}`);
    const items = data.data ?? [];
    if (items.length !== batch.length) {
      throw new Error(`OpenRouter embeddings: expected ${batch.length} vectors, got ${items.length}`);
    }
    const sorted = [...items].sort((a, b) => a.index - b.index).map((x) => x.embedding);
    await recordApiCall({
      feature,
      model,
      usage: { input_tokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0, output_tokens: 0 },
      wallMs: Date.now() - t0,
    });
    return sorted;
  } catch (e) {
    if (!retried) return embedBatch(batch, model, apiKey, feature, true);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// embedTexts(['q1', 'q2', ...], { feature }) -> one 1536-dim vector per input
// text, IN ORDER. Batches of 64; a batch failing after its retry throws
// (callers decide whether that fails the whole call or is swallowed).
export async function embedTexts(
  texts: string[],
  opts: { feature: 'embed_index' | 'embed_query'; model?: string }
): Promise<number[][]> {
  if (!texts.length) return [];
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
  const model = opts.model ?? embedModel();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    out.push(...(await embedBatch(batch, model, apiKey, opts.feature)));
  }
  return out;
}

// One vector for one question; a thin wrapper so callers never juggle arrays
// for the common single-query case.
export async function embedQuery(text: string, model?: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [vec] = await embedTexts([trimmed], { feature: 'embed_query', model });
  return vec ?? null;
}

export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
