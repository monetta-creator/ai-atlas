import { runStructured } from '../dossier';
import { chatJSONOpenRouter } from '../scan/llm';
import { SCAN_ENRICH_MODELS } from '../scan/models';

// Shared model dispatcher for the research subsystem's three model features
// (triage, queue agent, analysis): the scan's dual-provider pattern
// (lib/scan/enrich.ts) applied once instead of three times. `model` is either
// null/empty (the Haiku fallback), an Anthropic id (any `claude-*` id, or an
// entry flagged `anthropic: true` in SCAN_ENRICH_MODELS) routed through
// runStructured's forced-tool path, or an OpenRouter id routed through
// chatJSONOpenRouter as a JSON-object completion with the same system/user
// text plus an explicit only-JSON instruction. Callers keep authoring their
// own system/user/schema exactly as before runStructured; only the model
// selection and provider branch move here.
//
// Passing `model` to runStructured drops thinking/effort (required for
// Haiku, harmless for any other override — see lib/dossier.ts). maxRetries
// is pinned to 0 on both paths: every caller here is a bounded, checkpointed
// chunk (the research engine resumes on the next invocation), matching the
// discipline lib/research/analysis.ts and lib/research/queue-agent.ts
// already used before this dispatcher existed.
//
// Never sets pipelineRunId — research calls are not pipeline_runs rows
// (that column is FK'd there; recordApiCall would silently swallow it).

const FALLBACK_MODEL = 'claude-haiku-4-5';

function isAnthropicModel(model: string): boolean {
  if (model.startsWith('claude-')) return true;
  return SCAN_ENRICH_MODELS.some((m) => m.id === model && m.anthropic);
}

export async function researchStructured<T>(opts: {
  model: string | null;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: object;
  maxTokens: number;
  timeoutMs: number;
  feature: string;
  metadata?: Record<string, unknown>;
}): Promise<T> {
  const picked = opts.model?.trim() || null;

  if (!picked || isAnthropicModel(picked)) {
    return runStructured<T>({
      system: opts.system,
      user: opts.user,
      toolName: opts.toolName,
      toolDescription: opts.toolDescription,
      schema: opts.schema,
      maxTokens: opts.maxTokens,
      feature: opts.feature,
      metadata: opts.metadata,
      timeoutMs: opts.timeoutMs,
      maxRetries: 0,
      model: picked ?? FALLBACK_MODEL,
    });
  }

  // The dispatcher is shared across three different schemas, so it can't hand-write
  // a per-feature key list the way pipeline/analysis.ts and scan/enrich.ts do — it
  // dumps the tool schema itself (the same contract runStructured's forced tool
  // would otherwise enforce) so the open-weight model sees the exact shape expected.
  const user = `${opts.user}

Reply with ONLY a single JSON object, no prose and no code fence, matching this schema exactly:
${JSON.stringify(opts.schema)}`;

  // One bounded retry on the OpenRouter path: open-weight endpoints
  // occasionally emit malformed JSON or hit a transient abort (seen live with
  // GLM triage 2026-08-31), and a chunk retry is cheap next to failing the
  // whole engine step. The refused-reasoning fallback inside
  // chatJSONOpenRouter is orthogonal to this.
  try {
    return await chatJSONOpenRouter<T>({
      model: picked,
      system: opts.system,
      user,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      feature: opts.feature,
      metadata: opts.metadata,
    });
  } catch {
    return chatJSONOpenRouter<T>({
      model: picked,
      system: opts.system,
      user,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      feature: opts.feature,
      metadata: opts.metadata,
    });
  }
}

// Resolves what actually ran, for stamping provenance (papers.analyzed_by,
// mirroring signals.drafted_by): the picked model, or the Haiku fallback when
// none was picked. Never null, so a stamped column always names a real model.
export function resolvedModel(model: string | null): string {
  return model?.trim() || FALLBACK_MODEL;
}
