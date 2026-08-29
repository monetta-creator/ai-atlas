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
}): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');

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
        max_tokens: opts.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    await recordApiCall({
      feature: opts.feature,
      model: opts.model,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
      wallMs: Date.now() - t0,
      metadata: opts.metadata,
    });
    const content = data.choices?.[0]?.message?.content ?? '';
    return extractJsonObject(content) as T;
  } finally {
    clearTimeout(timer);
  }
}
