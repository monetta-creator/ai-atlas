// OpenRouter adapter: OpenAI-compatible chat completions, streamed (SSE),
// with function calling for the Atlas tools. No server web search: the loop
// hands open-weight models our Tavily web_search tool (lib/tools/web.ts).
// Mid-conversation system messages map to role 'system' (the OpenAI shape
// allows them anywhere).
import { OPENROUTER_URL } from './openrouter';
import type { Adapter, LlmEvent, LlmMessage, NormalizedUsage, StopReason, ToolCall, TurnRequest } from './types';

type OaMsg = Record<string, unknown>;

export function toOpenAiMessages(system: string, msgs: LlmMessage[]): OaMsg[] {
  const out: OaMsg[] = [{ role: 'system', content: system }];
  for (const m of msgs) {
    if (m.role === 'system') out.push({ role: 'system', content: m.content });
    else if (m.role === 'user') out.push({ role: 'user', content: m.prefix ? `${m.prefix}\n\n${m.content}` : m.content });
    else if (m.role === 'tool') for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `ERROR: ${r.text}` : r.text });
    else {
      const raw = m.raw && typeof m.raw === 'object' ? (m.raw as OaMsg) : null;
      out.push(
        raw ?? {
          role: 'assistant',
          content: m.content || null,
          ...(m.toolCalls.length
            ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
            : {}),
        },
      );
    }
  }
  return out;
}

const stopOf = (r: string | null | undefined): StopReason =>
  r === 'tool_calls' ? 'tool_use' : r === 'length' ? 'max_tokens' : r === 'content_filter' ? 'refusal' : r === 'error' ? 'error' : 'end';

// Parse an SSE byte stream into JSON payloads (skips comments and [DONE]).
export async function* sseJson(body: ReadableStream<Uint8Array>): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { yield JSON.parse(data); } catch { /* partial or keep-alive */ }
    }
  }
}

export function openrouterAdapter(apiKey = process.env.OPENROUTER_API_KEY): Adapter {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
  return {
    provider: 'openrouter',
    async *stream(req: TurnRequest): AsyncIterable<LlmEvent> {
      const tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: req.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          stream: true,
          usage: { include: true },
          messages: toOpenAiMessages(req.system, req.messages),
          ...(tools.length ? { tools, tool_choice: req.noTools ? 'none' : 'auto' } : {}),
          // Bounded reasoning: answers, not essays of thought.
          reasoning: { effort: req.effort ?? 'low', exclude: true },
          provider: { require_parameters: true },
        }),
      });
      if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

      let text = '';
      let finish: string | null = null;
      const calls: { id: string; name: string; args: string }[] = [];
      const usage: NormalizedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 };
      let announced = false;
      for await (const chunk of sseJson(res.body)) {
        const err = (chunk.error as { message?: string } | undefined)?.message;
        if (err) throw new Error(`OpenRouter: ${err.slice(0, 200)}`);
        const choice = (chunk.choices as Record<string, unknown>[] | undefined)?.[0];
        const delta = (choice?.delta ?? {}) as { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
        if (delta.content) {
          text += delta.content;
          yield { type: 'text', text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          if (!announced) { announced = true; yield { type: 'narration_end' }; }
          const c = (calls[tc.index] ??= { id: '', name: '', args: '' });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
        if (choice?.finish_reason) finish = choice.finish_reason as string;
        const u = chunk.usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
        if (u) {
          const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
          usage.input = Math.max(0, (u.prompt_tokens ?? 0) - cached);
          usage.cacheRead = cached;
          usage.output = u.completion_tokens ?? 0;
          if (typeof u.cost === 'number') usage.providerCostUsd = u.cost;
        }
      }
      const toolCalls: ToolCall[] = calls.filter(Boolean).map((c, i) => {
        let input: unknown = {};
        try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = { __invalid_json: c.args }; }
        return { id: c.id || `call_${i}`, name: c.name, input };
      });
      const raw = {
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      };
      yield { type: 'usage', usage };
      yield { type: 'stop', reason: toolCalls.length ? 'tool_use' : stopOf(finish), assistant: { role: 'assistant', content: text, toolCalls, raw } };
    },
  };
}
