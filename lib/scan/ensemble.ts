// The relevance ensemble for the external scan (migration 0053).
//
// The scan's relevance score was written by whichever model the A/B split
// assigned to the item, and the three flash models read the same anchored
// rubric on different rulers (30-day means on randomly split items: deepseek
// 0.58, qwen 0.56, GLM 0.44). The random split is worth keeping (it is what
// made the skew visible, and it keeps the A/B fair), so instead of picking a
// model the score is ENSEMBLED: after enrichment, every other panel model gives
// a score-only read of the same text, `relevance` becomes the median of the
// votes, the raw votes and the spread ride beside it, and the A/B table shows
// each model's bias against the median. Disagreement becomes a signal (the
// spread) instead of noise. Pure module, no imports, Node-tested.

// The default panel: the three OpenRouter flash models the scan already A/Bs.
export const ENSEMBLE_MODELS: readonly string[] = [
  'qwen/qwen3.7-flash', 'z-ai/glm-5.3-flash', 'deepseek/deepseek-v4-flash',
];

// The models that vote on an item: the console's picked enrichment models when
// two or more are picked (so the panel tracks the A/B), else the default trio.
export function ensemblePanel(picked: readonly string[]): string[] {
  const clean = [...new Set(picked.filter((m) => typeof m === 'string' && m.trim()))];
  return clean.length >= 2 ? clean : [...ENSEMBLE_MODELS];
}

export function clamp01(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

export function medianOf(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  return Math.round(m * 100) / 100;
}

export function spreadOf(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return Math.round((Math.max(...v) - Math.min(...v)) * 100) / 100;
}

export type RelevanceVotes = Record<string, number>;

export interface VoteSummary {
  median: number | null;
  spread: number | null;
  n: number;
}

// Summarize a votes map (model id -> 0..1 score). Non-numeric votes are
// ignored; a single vote is its own median with spread 0.
export function summarizeVotes(votes: RelevanceVotes | null | undefined): VoteSummary {
  const values = Object.values(votes ?? {}).map(clamp01).filter((x): x is number => x !== null);
  return { median: medianOf(values), spread: values.length ? spreadOf(values) : null, n: values.length };
}

// Merge new votes into an existing map, dropping non-numeric entries.
export function mergeVotes(existing: RelevanceVotes | null | undefined, incoming: Record<string, unknown>): RelevanceVotes {
  const out: RelevanceVotes = {};
  for (const [k, v] of Object.entries(existing ?? {})) { const c = clamp01(v); if (c !== null) out[k] = c; }
  for (const [k, v] of Object.entries(incoming)) { const c = clamp01(v); if (c !== null) out[k] = c; }
  return out;
}

// Which panel models still owe a vote for an item.
export function missingVoters(panel: readonly string[], votes: RelevanceVotes | null | undefined): string[] {
  const have = new Set(Object.keys(votes ?? {}));
  return panel.filter((m) => !have.has(m));
}
