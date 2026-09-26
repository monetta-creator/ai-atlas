import type { EditionHnItem } from './types';

// Hacker News front page, AI stories only, via the free Algolia API (the
// same endpoint the Tooling Monitor's discovery uses). Pure network, no
// model, no storage: the edition build calls it once and keeps the result
// in the pack. Any failure yields an empty list, never a thrown error.

const HN_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60';
const AI_TERMS = /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|llms|language model|gpt|openai|anthropic|claude|gemini|llama|mistral|deepseek|copilot|agent|agents|agentic|nvidia|gpu|gpus|inference|transformer|diffusion|chatgpt|cursor|codex|model|models)\b/i;
// The wider net the builders judge sees (2026-09-26): the AI terms plus the
// builder vocabulary that never says "AI" in a title. Only the judge reads
// this list; the stored `hn` strip (the deck slide, the PDF fallback) keeps
// the narrower AI_TERMS and its cap of 8.
const BUILDER_TERMS = /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|llms|language model|gpt|openai|anthropic|claude|claude code|gemini|llama|mistral|deepseek|copilot|agent|agents|agentic|nvidia|gpu|gpus|inference|transformer|diffusion|chatgpt|cursor|codex|model|models|mcp|rag|evals?|benchmarks?|fine-?tun\w*|lora|vllm|ollama|open-?weights?|hugging ?face|langchain|langgraph|embeddings?|vector (?:db|database|search)|prompt\w*|tokens?)\b/i;

interface Hit {
  title?: string;
  url?: string | null;
  objectID?: string;
  points?: number;
  num_comments?: number;
}

function toItem(h: Hit): EditionHnItem {
  return {
    title: (h.title ?? '').trim(),
    url: h.url ?? null,
    hnUrl: `https://news.ycombinator.com/item?id=${h.objectID ?? ''}`,
    points: h.points ?? 0,
    comments: h.num_comments ?? 0,
  };
}

export function pickAiHits(hits: Hit[], limit = 8): EditionHnItem[] {
  return hits
    .filter((h) => typeof h.title === 'string' && AI_TERMS.test(h.title))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, limit)
    .map(toItem);
}

export function pickBuilderCandidates(hits: Hit[], limit = 25): EditionHnItem[] {
  return hits
    .filter((h) => typeof h.title === 'string' && BUILDER_TERMS.test(h.title))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, limit)
    .map(toItem);
}

async function fetchFrontPage(timeoutMs: number): Promise<Hit[]> {
  try {
    const res = await fetch(HN_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const json = (await res.json()) as { hits?: Hit[] };
    return json.hits ?? [];
  } catch {
    return [];
  }
}

export async function fetchHnAiFront(limit = 8, timeoutMs = 8000): Promise<EditionHnItem[]> {
  return pickAiHits(await fetchFrontPage(timeoutMs), limit);
}

// One fetch, two views: the AI strip the pack stores (8) and the wider
// candidate list the builders judge reads (25).
export async function fetchHnFrontViews(timeoutMs = 8000): Promise<{ hn: EditionHnItem[]; candidates: EditionHnItem[] }> {
  const hits = await fetchFrontPage(timeoutMs);
  return { hn: pickAiHits(hits, 8), candidates: pickBuilderCandidates(hits, 25) };
}
