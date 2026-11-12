// The model catalog for the one chat box (redo Phase 1). One entry per model
// the selector, the decider, or the eval can pick. Import-free so plain
// scripts and client components can load it; prices mirror the ai_rate_cards
// rows (migrations 0084, 0085) and a test checks they agree.
//
// Prices are USD per million tokens. Open-weight ids and prices were checked
// against the live OpenRouter /api/v1/models list on 2026-11-11; Claude
// prices against the Claude API model docs the same day.

export type Provider = 'anthropic' | 'openrouter';
export type Tier = 'cheap' | 'mid' | 'strong';
export type Family = 'claude' | 'open-weight';
export type ModelRole = 'answer' | 'judge' | 'utility';

export interface ModelCaps {
  tools: boolean;
  logprobs: boolean;
  // Anthropic's server-side web_search/web_fetch; open-weight models get our
  // own Tavily-backed web_search tool instead.
  serverWebSearch: boolean;
  structuredOutput: boolean;
  promptCaching: boolean;
}

export interface ModelEntry {
  id: string;
  provider: Provider;
  family: Family;
  label: string;
  tier: Tier;
  inPerM: number;
  outPerM: number;
  cacheWritePerM: number;
  cacheReadPerM: number;
  context: number;
  caps: ModelCaps;
  roles: ModelRole[];
  // Shown in the selector under the label. No em dashes (user-facing).
  blurb: string;
}

const claudeCaps: ModelCaps = { tools: true, logprobs: false, serverWebSearch: true, structuredOutput: true, promptCaching: true };
const openCaps: ModelCaps = { tools: true, logprobs: true, serverWebSearch: false, structuredOutput: true, promptCaching: false };

export const MODELS: readonly ModelEntry[] = [
  {
    id: 'claude-haiku-5-5', provider: 'anthropic', family: 'claude', label: 'Claude Haiku 5.5', tier: 'cheap',
    inPerM: 0.1, outPerM: 0.5, cacheWritePerM: 0.125, cacheReadPerM: 0.01, context: 1_000_000,
    caps: claudeCaps, roles: ['answer', 'utility'], blurb: 'Fast and cheap, the default answerer',
  },
  {
    id: 'claude-sonnet-5-5', provider: 'anthropic', family: 'claude', label: 'Claude Sonnet 5.5', tier: 'mid',
    inPerM: 2, outPerM: 10, cacheWritePerM: 2.5, cacheReadPerM: 0.1, context: 1_000_000,
    caps: claudeCaps, roles: ['answer', 'judge'], blurb: 'Careful reasoning across many records',
  },
  {
    id: 'claude-opus-5-5', provider: 'anthropic', family: 'claude', label: 'Claude Opus 5.5', tier: 'strong',
    inPerM: 4, outPerM: 20, cacheWritePerM: 5, cacheReadPerM: 0.2, context: 1_000_000,
    caps: claudeCaps, roles: ['answer'], blurb: 'The strongest Claude, for the hardest turns',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash', provider: 'openrouter', family: 'open-weight', label: 'DeepSeek V4.1 Flash', tier: 'cheap',
    inPerM: 0.022, outPerM: 0.4, cacheWritePerM: 0, cacheReadPerM: 0, context: 1_048_576,
    caps: openCaps, roles: ['answer', 'utility'], blurb: 'Open-weight, very cheap, good with tools',
  },
  {
    id: 'google/gemma-4-26b-a4b-it', provider: 'openrouter', family: 'open-weight', label: 'Gemma 4 26B', tier: 'cheap',
    inPerM: 0.08, outPerM: 0.1, cacheWritePerM: 0, cacheReadPerM: 0, context: 262_144,
    caps: openCaps, roles: ['answer', 'utility'], blurb: 'Open-weight, small and quick',
  },
  {
    id: 'openai/gpt-oss-120b', provider: 'openrouter', family: 'open-weight', label: 'gpt-oss 120B', tier: 'cheap',
    inPerM: 0.15, outPerM: 0.6, cacheWritePerM: 0, cacheReadPerM: 0, context: 131_072,
    caps: openCaps, roles: ['answer', 'utility'], blurb: 'Open-weight reasoning model',
  },
  {
    id: 'mistralai/mistral-large-4-0', provider: 'openrouter', family: 'open-weight', label: 'Mistral Large 4', tier: 'mid',
    inPerM: 0.7, outPerM: 2.1, cacheWritePerM: 0, cacheReadPerM: 0, context: 1_048_576,
    caps: openCaps, roles: ['answer'], blurb: 'Open-weight, strong writer',
  },
  {
    id: 'deepseek/deepseek-v4-pro', provider: 'openrouter', family: 'open-weight', label: 'DeepSeek V4 Pro', tier: 'mid',
    inPerM: 0.955, outPerM: 1.911, cacheWritePerM: 0, cacheReadPerM: 0, context: 1_048_576,
    caps: openCaps, roles: ['answer'], blurb: 'Open-weight, strong reasoning',
  },
  {
    id: 'meta/muse-spark-open', provider: 'openrouter', family: 'open-weight', label: 'Muse Spark Open', tier: 'mid',
    inPerM: 1.25, outPerM: 4.25, cacheWritePerM: 0, cacheReadPerM: 0, context: 1_048_576,
    caps: openCaps, roles: ['answer'], blurb: 'The most capable US open-weight model',
  },
  {
    id: 'moonshotai/kimi-k3.1-pro', provider: 'openrouter', family: 'open-weight', label: 'Kimi K3.1 Pro', tier: 'strong',
    inPerM: 2, outPerM: 10, cacheWritePerM: 0, cacheReadPerM: 0, context: 1_048_576,
    caps: openCaps, roles: ['answer'], blurb: 'Open-weight frontier contender',
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct', provider: 'openrouter', family: 'open-weight', label: 'Llama 3.1 8B', tier: 'cheap',
    inPerM: 0.02, outPerM: 0.04, cacheWritePerM: 0, cacheReadPerM: 0, context: 131_072,
    caps: openCaps, roles: ['judge'], blurb: 'The decider\'s logprob judge',
  },
];

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelEntry | null {
  return BY_ID.get(id) ?? null;
}

// The default answerer per tier (Auto picks a tier; budget-first: Claude
// Haiku 5.5 is the cheap default until the eval says an open model holds up).
export const TIER_DEFAULT: Record<Tier, string> = {
  cheap: 'claude-haiku-5-5',
  mid: 'claude-sonnet-5-5',
  strong: 'claude-opus-5-5',
};

// Models a person can pick in the selector (answerers only, judges hidden).
export function selectorModels(): ModelEntry[] {
  return MODELS.filter((m) => m.roles.includes('answer'));
}

// A turn's token profile. The default is the measured deep-Ask profile
// (42 turns, 2026-11-11: 2k uncached input, 49k cache reads, 28k cache
// writes, 2k output), scaled 1.3x for the 5.x tokenizer.
export interface TurnProfile {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}
export const DEFAULT_TURN: TurnProfile = { input: 2_600, cacheRead: 64_000, cacheWrite: 36_000, output: 2_600 };

// Estimated USD for one turn. A model without prompt caching pays every
// cached token at the full input rate.
export function estimateTurnUsd(model: ModelEntry, p: TurnProfile = DEFAULT_TURN): number {
  const M = 1_000_000;
  if (!model.caps.promptCaching) {
    return ((p.input + p.cacheRead + p.cacheWrite) * model.inPerM + p.output * model.outPerM) / M;
  }
  return (p.input * model.inPerM + p.cacheRead * model.cacheReadPerM + p.cacheWrite * model.cacheWritePerM + p.output * model.outPerM) / M;
}

// "~1¢", "~12¢", "~$0.40": the selector's per-turn hint.
export function formatTurnCost(usd: number): string {
  if (usd < 0.01) return '<1¢';
  if (usd < 1) return `~${Math.round(usd * 100)}¢`;
  return `~$${usd.toFixed(2)}`;
}
