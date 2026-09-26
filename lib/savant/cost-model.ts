// Savant's cost model (2026-09-26): the models the desk may pick for each
// role, the token profile of one issue week measured on the 09-25 review
// runs, and the estimator the prefs form runs live as the picks change.
// Dependency-free (no import of lib/scan/models: an extensionless lib import
// does not load under plain Node), so a client component and
// scripts/test-savant-issue.mjs can both load it; the test asserts the
// OpenRouter entries here mirror SCAN_ENRICH_MODELS, whose rate cards
// test-scan.mjs checks against the live table.
//
// Roles: the WRITER writes the lead (its own Anthropic tool loop), the front,
// the departments, the peer watch, the revisions and the figures; the EDITOR
// reviews; the NOTEBOOK model writes the Monday plan and the daily note.
// The lead loop uses Anthropic tool use and web search directly, so a
// non-Anthropic writer hands that ONE leg to LEAD_FALLBACK_MODEL.

export interface SavantModelOption {
  id: string;
  label: string;
  vendor: string;
  anthropic: boolean;
}

export const LEAD_FALLBACK_MODEL = 'claude-sonnet-4-6';

export const SAVANT_MODEL_OPTIONS: SavantModelOption[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', vendor: 'Anthropic', anthropic: true },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', vendor: 'Anthropic', anthropic: true },
  { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash', vendor: 'Alibaba', anthropic: false },
  { id: 'qwen/qwen3-30b-a3b-instruct-2507', label: 'Qwen3 30B A3B', vendor: 'Alibaba', anthropic: false },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM-5.3 Flash', vendor: 'Zhipu', anthropic: false },
  { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2', vendor: 'Mistral', anthropic: false },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', vendor: 'DeepSeek', anthropic: false },
  { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout', vendor: 'Meta', anthropic: false },
];

export function isAnthropicId(id: string): boolean {
  return id.startsWith('claude-') || SAVANT_MODEL_OPTIONS.some((m) => m.id === id && m.anthropic);
}

export type SavantRole = 'writer' | 'editor' | 'notebook';

export interface LegProfile {
  leg: string;
  feature: string;
  role: SavantRole;
  anthropicOnly?: boolean;   // the lead loop
  calls: number;             // per issue week
  input: number;             // uncached input tokens per week
  cacheRead: number;         // cached input tokens per week
  output: number;            // output tokens per week
}

// Measured 2026-09-26 over three full runs of the 09-25 issue (ai_cost_log
// by feature, divided by runs) plus the notebook's five weekday passes.
export const SAVANT_TOKEN_PROFILE: LegProfile[] = [
  { leg: 'Lead research loop', feature: 'savant_lead', role: 'writer', anthropicOnly: true, calls: 5, input: 23_500, cacheRead: 8_600, output: 3_800 },
  { leg: 'Front, departments, peer watch', feature: 'savant_sections', role: 'writer', calls: 3, input: 15_300, cacheRead: 0, output: 4_600 },
  { leg: 'Revision round', feature: 'savant_revise', role: 'writer', calls: 2, input: 5_300, cacheRead: 0, output: 3_200 },
  { leg: 'Figures', feature: 'savant_figures', role: 'writer', calls: 1, input: 8_900, cacheRead: 400, output: 2_200 },
  { leg: 'Editor review', feature: 'savant_editor', role: 'editor', calls: 1, input: 6_800, cacheRead: 0, output: 1_300 },
  { leg: 'Monday plan', feature: 'savant_plan', role: 'notebook', calls: 1, input: 1_000, cacheRead: 0, output: 400 },
  { leg: 'Daily notes (5)', feature: 'savant_note', role: 'notebook', calls: 5, input: 9_700, cacheRead: 0, output: 1_000 },
];

export interface ModelRate { input: number; output: number; cacheRead: number }   // USD per million tokens
export type RateTable = Record<string, ModelRate>;

export interface LegEstimate { leg: string; role: SavantRole; model: string; usd: number; fallback: boolean }
export interface WeekEstimate {
  legs: LegEstimate[];
  byRole: Record<SavantRole, number>;
  total: number;
  missingRates: string[];    // picked models with no rate card (their legs count as 0)
}

export function legCost(p: LegProfile, rate: ModelRate): number {
  return (p.input * rate.input + p.cacheRead * rate.cacheRead + p.output * rate.output) / 1_000_000;
}

export function estimateSavantWeek(
  picks: { writer: string; editor: string; notebook: string },
  rates: RateTable
): WeekEstimate {
  const legs: LegEstimate[] = [];
  const byRole: Record<SavantRole, number> = { writer: 0, editor: 0, notebook: 0 };
  const missing = new Set<string>();
  for (const p of SAVANT_TOKEN_PROFILE) {
    let model = picks[p.role];
    let fallback = false;
    if (p.anthropicOnly && !isAnthropicId(model)) { model = LEAD_FALLBACK_MODEL; fallback = true; }
    const rate = rates[model];
    if (!rate) missing.add(model);
    const usd = rate ? legCost(p, rate) : 0;
    legs.push({ leg: p.leg, role: p.role, model, usd, fallback });
    byRole[p.role] += usd;
  }
  const total = byRole.writer + byRole.editor + byRole.notebook;
  return { legs, byRole, total, missingRates: [...missing] };
}

export const fmtUsd = (n: number): string => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);
