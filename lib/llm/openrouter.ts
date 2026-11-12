// OpenRouter (OpenAI-compatible chat) for open-weight models: the raw call.
// The streaming tool-loop adapter builds on this (lib/llm/openrouter-adapter.ts).
// Every call logs through recordApiCall with the caller's feature slug.
import { recordApiCall } from '../cost';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  cost?: number;
}

export async function openrouterChat(
  body: Record<string, unknown> & { model: string },
  opts: { timeoutMs: number; feature: string; metadata?: Record<string, unknown>; signal?: AbortSignal },
): Promise<{ data: unknown; usage: OpenRouterUsage; wallMs: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const t0 = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, usage: { include: true } }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    if (!text.trim()) throw new Error('OpenRouter: empty response body');
    const data = JSON.parse(text) as { usage?: OpenRouterUsage; error?: { message?: string } };
    if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message.slice(0, 200)}`);
    const usage = data.usage ?? {};
    const wallMs = Date.now() - t0;
    await recordApiCall({
      feature: opts.feature,
      model: body.model,
      usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 },
      wallMs,
      metadata: opts.metadata,
    });
    return { data, usage, wallMs };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
