import { recordApiCall } from '../cost';
import { extractJsonObject } from './core';

// The scan's OpenRouter leg: one OpenAI-compatible chat call returning a JSON
// object, for the cheap open-weight models the /scan picker selects. Plain
// fetch, no SDK dependency. Structured-output discipline is belt and braces:
// response_format json_object where the routed provider honors it, an
// explicit reply-with-only-JSON instruction in the prompt, and the tolerant
// extractor (core.ts) — the caller's own validation (allow-list filters,
// clamps) is the real guard, exactly as with the Anthropic forced-tool path.
//
// Cost telemetry: usage maps prompt/completion tokens onto the house
// ApiUsage shape and recordApiCall prices the call from the model's rate
// card (migration 0041). Same discipline as everywhere: metadata provenance,
// never pipelineRunId.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function chatJSONOpenRouter<T>(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  feature: string;
  metadata?: Record<string, unknown>;
  // ONLY for calls belonging to a pipeline_runs row (the column is FK'd there;
  // recordApiCall swallows violations silently). Scan callers never set it.
  pipelineRunId?: string | null;
}): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');

  // Reasoning discipline, self-adapting per model: shortlist models that
  // think by default (GLM flash measured: 439 chars of reasoning before a
  // 13-char answer) would burn a small max_tokens budget before emitting
  // content, so the first attempt disables reasoning via OpenRouter's
  // unified param. A model whose endpoint REFUSES that (GLM: "Reasoning is
  // mandatory") gets one retry with reasoning BOUNDED instead (live-probed:
  // GLM accepts reasoning.max_tokens and stays inside it) plus matching
  // budget headroom; the refused first call bills nothing.
  const attempt = async (mode: 'off' | 'bounded'): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: mode === 'off' ? opts.maxTokens : opts.maxTokens + 500,
          response_format: { type: 'json_object' },
          reasoning: mode === 'off' ? { enabled: false } : { max_tokens: 400 },
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
        }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
      // A truncated read otherwise dies inside JSON.parse as the opaque
      // "Unexpected end of JSON input" (seen live on slow DeepSeek responses).
      if (!body.trim()) throw new Error('OpenRouter: empty response body');
      const data = JSON.parse(body) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message.slice(0, 200)}`);
      await recordApiCall({
        feature: opts.feature,
        model: opts.model,
        usage: {
          input_tokens: data.usage?.prompt_tokens ?? 0,
          output_tokens: data.usage?.completion_tokens ?? 0,
        },
        wallMs: Date.now() - t0,
        pipelineRunId: opts.pipelineRunId ?? null,
        metadata: opts.metadata,
      });
      const content = data.choices?.[0]?.message?.content ?? '';
      return extractJsonObject(content) as T;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attempt('off');
  } catch (e) {
    if (/reasoning is mandatory/i.test(String((e as Error)?.message))) return attempt('bounded');
    throw e;
  }
}
