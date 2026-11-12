// Anthropic Messages adapter. Streams RAW events (never the SDK's message
// accumulator, which drops server-tool blocks on the pinned SDK: see
// lib/ask/CLAUDE.md) and rebuilds the assistant content itself, so thinking
// blocks, signatures, server_tool_use and web_search_tool_result blocks are
// replayed verbatim on the next call (5.5 models reject edited history).
import Anthropic from '@anthropic-ai/sdk';
import type { Adapter, LlmEvent, LlmMessage, NormalizedUsage, StopReason, ToolCall, TurnRequest, WebSource } from './types';

type Block = Record<string, unknown> & { type: string };

// Which server web_search variant a model takes. Haiku 5.5 accepted the
// 2026-02-09 (dynamic filtering) variant in the eval dry run, 2026-11-11.
export function webToolFor(model: string): { type: string; name: 'web_search'; max_uses: number } {
  const modern = /claude-(haiku|sonnet|opus)-5-5|claude-opus-5|claude-sonnet-5|claude-fable/.test(model);
  return { type: modern ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 3 };
}

// LlmMessage[] -> Anthropic messages. Adjacent user-role content merges into
// one message (tool results followed by an instruction stay one turn).
export function toAnthropicMessages(msgs: LlmMessage[]): Record<string, unknown>[] {
  const out: { role: string; content: Block[] | string }[] = [];
  const pushUser = (blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role: 'user', content: blocks });
  };
  for (const m of msgs) {
    if (m.role === 'system') out.push({ role: 'system', content: m.content });
    else if (m.role === 'user') pushUser([...(m.prefix ? [{ type: 'text', text: m.prefix, cache_control: { type: 'ephemeral' } }] : []), { type: 'text', text: m.content }]);
    else if (m.role === 'tool') {
      pushUser(m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) })));
    } else {
      const raw = Array.isArray(m.raw) ? (m.raw as Block[]) : null;
      const content: Block[] = raw ?? [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })),
      ];
      out.push({ role: 'assistant', content });
    }
  }
  // Rolling cache breakpoint on the last user-role block.
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role === 'user' && Array.isArray(m.content) && m.content.length) {
      const lastBlock = m.content[m.content.length - 1];
      m.content[m.content.length - 1] = { ...lastBlock, cache_control: { type: 'ephemeral' } };
      break;
    }
  }
  return out;
}

const stopOf = (r: string | null | undefined): StopReason =>
  r === 'tool_use' ? 'tool_use' : r === 'max_tokens' ? 'max_tokens' : r === 'pause_turn' ? 'pause' : r === 'refusal' ? 'refusal' : 'end';

export function anthropicAdapter(apiKey = process.env.ANTHROPIC_API_KEY): Adapter {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  return {
    provider: 'anthropic',
    async *stream(req: TurnRequest): AsyncIterable<LlmEvent> {
      const tools: Record<string, unknown>[] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      if (req.serverWebSearch) tools.push(webToolFor(req.model));
      const params: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: toAnthropicMessages(req.messages),
        stream: true,
        ...(tools.length ? { tools } : {}),
        ...(tools.length && req.noTools ? { tool_choice: { type: 'none' } } : {}),
        ...(req.effort ? { output_config: { effort: req.effort } } : {}),
      };
      const stream = (await client.messages.create(params as unknown as Anthropic.MessageCreateParamsStreaming, { signal: req.signal })) as AsyncIterable<Record<string, unknown>>;

      yield* fromAnthropicEvents(stream);
    },
  };
}

// Raw Messages stream events -> normalized events (exported for the fixture test).
export async function* fromAnthropicEvents(stream: AsyncIterable<Record<string, unknown>>): AsyncIterable<LlmEvent> {
  const blocks: Block[] = [];
  const jsonBuf: string[] = [];
  let text = '';
  const usage: NormalizedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 };
  let stop: StopReason = 'end';

  for await (const ev of stream) {
    const type = ev.type as string;
    if (type === 'message_start') {
      const u = (ev.message as { usage?: Record<string, number> })?.usage ?? {};
      usage.input = u.input_tokens ?? 0;
      usage.cacheRead = u.cache_read_input_tokens ?? 0;
      usage.cacheWrite = u.cache_creation_input_tokens ?? 0;
    } else if (type === 'content_block_start') {
      const idx = ev.index as number;
      const block = { ...(ev.content_block as Block) };
      if (block.type === 'text') block.text = '';
      if (block.type === 'thinking') { block.thinking = block.thinking ?? ''; block.signature = block.signature ?? ''; }
      blocks[idx] = block;
      jsonBuf[idx] = '';
      if (block.type === 'tool_use' || block.type === 'server_tool_use') yield { type: 'narration_end' };
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        const sources: WebSource[] = (block.content as { type?: string; url?: string; title?: string }[])
          .filter((r) => r?.type === 'web_search_result' && r.url)
          .map((r) => ({ url: r.url!, title: r.title ?? r.url! }));
        if (sources.length) yield { type: 'web_sources', sources };
      }
    } else if (type === 'content_block_delta') {
      const idx = ev.index as number;
      const d = ev.delta as Record<string, unknown>;
      const b = blocks[idx];
      if (!b) continue;
      if (d.type === 'text_delta') {
        b.text = (b.text as string) + (d.text as string);
        text += d.text as string;
        yield { type: 'text', text: d.text as string };
      } else if (d.type === 'thinking_delta') b.thinking = (b.thinking as string) + (d.thinking as string);
      else if (d.type === 'signature_delta') b.signature = (b.signature as string) + (d.signature as string);
      else if (d.type === 'input_json_delta') jsonBuf[idx] += d.partial_json as string;
      else if (d.type === 'citations_delta') {
        const c = d.citation as { url?: string; title?: string };
        b.citations = [...((b.citations as unknown[]) ?? []), d.citation];
        if (c?.url) yield { type: 'web_sources', sources: [{ url: c.url, title: c.title ?? c.url }] };
      }
    } else if (type === 'content_block_stop') {
      const idx = ev.index as number;
      const b = blocks[idx];
      if (b && (b.type === 'tool_use' || b.type === 'server_tool_use')) {
        let input: unknown = {};
        try { input = jsonBuf[idx] ? JSON.parse(jsonBuf[idx]) : (b.input ?? {}); } catch { input = { __invalid_json: jsonBuf[idx] }; }
        b.input = input;
        if (b.type === 'server_tool_use') {
          const q = (input as { query?: string })?.query;
          if (typeof q === 'string') yield { type: 'server_search', query: q };
        }
      }
    } else if (type === 'message_delta') {
      const d = ev.delta as { stop_reason?: string };
      stop = stopOf(d?.stop_reason);
      const u = (ev.usage ?? {}) as { output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
      if (typeof u.output_tokens === 'number') usage.output = u.output_tokens;
      if (typeof u.server_tool_use?.web_search_requests === 'number') usage.webSearches = u.server_tool_use.web_search_requests;
    }
  }

  const raw = blocks.filter(Boolean);
  const toolCalls: ToolCall[] = raw
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id as string, name: b.name as string, input: b.input }));
  yield { type: 'usage', usage };
  yield { type: 'stop', reason: toolCalls.length && stop === 'end' ? 'tool_use' : stop, assistant: { role: 'assistant', content: text, toolCalls, raw } };
}
