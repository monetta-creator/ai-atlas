// The scan enrichment model registry: the curated shortlist the /scan picker
// offers, plus the deterministic per-item model assignment for A/B runs.
// DELIBERATELY dependency-free (like core.ts) so scripts/test-scan.mjs loads
// it under plain Node, and importable by client components (no lib/db).
//
// Every OpenRouter id here must have an ai_rate_cards row (migration 0041) or
// its calls log at cost 0 and the budget guard goes blind; test-scan.mjs
// cross-checks the list against the live rate cards. The Haiku entry routes
// to the existing Anthropic runStructured path and is the A/B baseline.

export interface ScanEnrichModel {
  id: string;      // OpenRouter model id, or the Anthropic model id for the baseline
  label: string;
  vendor: string;
  anthropic?: boolean; // routed via runStructured, not OpenRouter
}

export const SCAN_ENRICH_MODELS: ScanEnrichModel[] = [
  { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash', vendor: 'Alibaba' },
  { id: 'qwen/qwen3-30b-a3b-instruct-2507', label: 'Qwen3 30B A3B', vendor: 'Alibaba' },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM-5.3 Flash', vendor: 'Zhipu' },
  { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2', vendor: 'Mistral' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', vendor: 'DeepSeek' },
  { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout', vendor: 'Meta' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (baseline)', vendor: 'Anthropic', anthropic: true },
];

export function isScanEnrichModel(id: string): boolean {
  return SCAN_ENRICH_MODELS.some((m) => m.id === id);
}

// Deterministic, balanced assignment of an item to one of the selected
// models: hash the UUID's first hex octets. Stable across resumed runs (the
// same item always lands on the same model) and roughly uniform, which is
// what the A/B comparison needs. Empty selection = the Haiku fallback.
export function pickEnrichModel(models: string[], itemId: string): string | null {
  if (!models.length) return null;
  const n = parseInt(itemId.replace(/-/g, '').slice(0, 8), 16);
  return models[(Number.isFinite(n) ? n : 0) % models.length];
}
