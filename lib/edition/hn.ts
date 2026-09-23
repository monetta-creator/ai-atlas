import type { EditionHnItem } from './types';

// Hacker News front page, AI stories only, via the free Algolia API (the
// same endpoint the Tooling Monitor's discovery uses). Pure network, no
// model, no storage: the edition build calls it once and keeps the result
// in the pack. Any failure yields an empty list, never a thrown error.

const HN_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60';
const AI_TERMS = /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|llms|language model|gpt|openai|anthropic|claude|gemini|llama|mistral|deepseek|copilot|agent|agents|agentic|nvidia|gpu|gpus|inference|transformer|diffusion|chatgpt|cursor|codex|model|models)\b/i;

interface Hit {
  title?: string;
  url?: string | null;
  objectID?: string;
  points?: number;
  num_comments?: number;
}

export function pickAiHits(hits: Hit[], limit = 8): EditionHnItem[] {
  return hits
    .filter((h) => typeof h.title === 'string' && AI_TERMS.test(h.title))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, limit)
    .map((h) => ({
      title: (h.title ?? '').trim(),
      url: h.url ?? null,
      hnUrl: `https://news.ycombinator.com/item?id=${h.objectID ?? ''}`,
      points: h.points ?? 0,
      comments: h.num_comments ?? 0,
    }));
}

export async function fetchHnAiFront(limit = 8, timeoutMs = 8000): Promise<EditionHnItem[]> {
  try {
    const res = await fetch(HN_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const json = (await res.json()) as { hits?: Hit[] };
    return pickAiHits(json.hits ?? [], limit);
  } catch {
    return [];
  }
}
