// Loop + adapter tests with no network: a fake adapter drives runLoop
// (round bound, deadline, input budget, tool error as is_error, calls-per-round
// cap, narration retract, pause continuation, final answer path), and
// recorded fixtures drive both adapters' parsers (Anthropic raw stream events
// incl. server web search + thinking signature; OpenRouter SSE tool-call
// deltas). Run: npx -y tsx scripts/test-ask-loop.mts
import { runLoop, clip, toApiUsage, type LoopEvent } from '../lib/ask/loop';
import { fromAnthropicEvents, toAnthropicMessages, webToolFor } from '../lib/llm/anthropic';
import { sseJson, toOpenAiMessages } from '../lib/llm/openrouter-adapter';
import type { Adapter, LlmEvent, LlmMessage, TurnRequest } from '../lib/llm/types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };

// A scripted adapter: each call yields the next script entry.
type Step = { text?: string[]; calls?: { name: string; input: unknown }[]; narrationFirst?: string; stop?: 'end' | 'pause'; promptTokens?: number };
function fake(steps: Step[], seen: TurnRequest[]): Adapter {
  let i = 0;
  return {
    provider: 'anthropic',
    async *stream(req: TurnRequest): AsyncIterable<LlmEvent> {
      seen.push({ ...req, messages: [...req.messages] });
      const s = steps[Math.min(i, steps.length - 1)];
      i++;
      if (s.narrationFirst) { yield { type: 'text', text: s.narrationFirst }; yield { type: 'narration_end' }; }
      for (const t of s.text ?? []) yield { type: 'text', text: t };
      const toolCalls = req.noTools ? [] : (s.calls ?? []).map((c, k) => ({ id: `t${i}_${k}`, name: c.name, input: c.input }));
      if (toolCalls.length && !s.narrationFirst) yield { type: 'narration_end' };
      yield { type: 'usage', usage: { input: s.promptTokens ?? 100, output: 10, cacheRead: 0, cacheWrite: 0, webSearches: 0 } };
      yield { type: 'stop', reason: s.stop === 'pause' ? 'pause' : toolCalls.length ? 'tool_use' : 'end', assistant: { role: 'assistant', content: (s.text ?? []).join(''), toolCalls } };
    },
  };
}
const base = { model: 'm', system: 'sys', tools: [], serverWebSearch: false, finalInstruction: 'FINAL NOW', deadlineAt: Date.now() + 60_000 };
const user: LlmMessage[] = [{ role: 'user', content: 'q' }];

// 1. Straight answer.
{
  const seen: TurnRequest[] = []; const ev: LoopEvent[] = [];
  const r = await runLoop({ ...base, adapter: fake([{ text: ['Hello ', 'world'] }], seen), messages: user, exec: async () => ({ text: 'x' }), emit: (e) => ev.push(e) });
  ok(r.answer === 'Hello world' && r.rounds === 1 && r.modelCalls === 1 && !r.forced, 'straight answer');
  ok(ev.filter((e) => e.type === 'delta').length === 2, 'deltas streamed');
}
// 2. Round bound forces a final, tools disabled on the final call.
{
  const seen: TurnRequest[] = []; const ev: LoopEvent[] = [];
  const r = await runLoop({ ...base, caps: { maxRounds: 3 }, adapter: fake([{ calls: [{ name: 'search_atlas', input: { query: 'a' } }], text: ['done'] }], seen), messages: user, exec: async () => ({ text: 'result' }), emit: (e) => ev.push(e) });
  ok(r.forced === 'rounds' && r.rounds === 4 && seen[3].noTools === true && seen[0].noTools === false, `round bound (rounds ${r.rounds}, forced ${r.forced})`);
  const last = seen[3].messages[seen[3].messages.length - 1];
  ok(last.role === 'user' && last.content === 'FINAL NOW', 'final instruction appended');
  ok(r.toolCalls === 3 && r.corpus.length === 3, 'tool results kept for the verifier');
}
// 3. Deadline.
{
  const seen: TurnRequest[] = []; let t = 0;
  const r = await runLoop({ ...base, deadlineAt: 50, now: () => (t += 30), adapter: fake([{ calls: [{ name: 'x', input: {} }], text: ['ans'] }], seen), messages: user, exec: async () => ({ text: 'r' }), emit: () => {} });
  ok(r.forced === 'deadline' && r.answer === 'ans', `deadline (${r.forced})`);
}
// 4. Input budget.
{
  const seen: TurnRequest[] = [];
  const r = await runLoop({ ...base, caps: { inputBudget: 500 }, adapter: fake([{ calls: [{ name: 'x', input: {} }], promptTokens: 900, text: ['a'] }], seen), messages: user, exec: async () => ({ text: 'r' }), emit: () => {} });
  ok(r.forced === 'input' && r.rounds === 2, 'input budget');
}
// 5. Tool errors, invalid JSON, calls-per-round cap all return is_error.
{
  const seen: TurnRequest[] = []; const ev: LoopEvent[] = [];
  const calls = [{ name: 'boom', input: {} }, { name: 'bad', input: { __invalid_json: '{' } }, { name: 'a', input: {} }, { name: 'b', input: {} }];
  await runLoop({ ...base, caps: { maxCallsPerRound: 3, maxRounds: 1 }, adapter: fake([{ calls, text: ['z'] }], seen), messages: user, exec: async (c) => { if (c.name === 'boom') throw new Error('kaput'); return { text: 'fine' }; }, emit: (e) => ev.push(e) });
  const toolMsg = seen[1].messages.find((m) => m.role === 'tool');
  const rs = toolMsg && toolMsg.role === 'tool' ? toolMsg.results : [];
  ok(rs.length === 4, 'every call answered');
  ok(rs[0].isError === true && /kaput/.test(rs[0].text), 'thrown tool -> is_error');
  ok(rs[1].isError === true && /valid JSON/.test(rs[1].text), 'invalid json -> is_error');
  ok(rs[2].isError !== true && rs[3].isError === true && /Too many/.test(rs[3].text), 'per-round cap');
}
// 6. Narration retracted; answer is text after the last narration_end.
{
  const seen: TurnRequest[] = []; const ev: LoopEvent[] = [];
  const r = await runLoop({ ...base, adapter: fake([{ narrationFirst: 'Let me search. ', text: ['The answer.'] }], seen), messages: user, exec: async () => ({ text: '' }), emit: (e) => ev.push(e) });
  ok(ev.some((e) => e.type === 'retract') && r.answer === 'The answer.', 'narration retracted');
}
// 7. Pause continues.
{
  const seen: TurnRequest[] = [];
  const r = await runLoop({ ...base, adapter: fake([{ stop: 'pause' }, { text: ['after pause'] }], seen), messages: user, exec: async () => ({ text: '' }), emit: () => {} });
  ok(r.answer === 'after pause' && r.modelCalls === 2, 'pause continuation');
}
ok(clip('abcdef', 3).startsWith('abc\n[... clipped'), 'clip');
ok(toApiUsage({ input: 10, output: 5, cacheRead: 90, cacheWrite: 0, webSearches: 0 }, 'openrouter').input_tokens === 100, 'openrouter cached tokens priced as input');

// 8. Anthropic fixture: thinking + server web search + text + tool_use.
{
  const evs: Record<string, unknown>[] = [
    { type: 'message_start', message: { usage: { input_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking. ' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"query":"ai ' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'banks"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'content_block_start', index: 3, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://x.test/a', title: 'A' }] } },
    { type: 'content_block_stop', index: 3 },
    { type: 'content_block_start', index: 4, content_block: { type: 'tool_use', id: 'tu1', name: 'search_atlas', input: {} } },
    { type: 'content_block_delta', index: 4, delta: { type: 'input_json_delta', partial_json: '{"query":"agents"}' } },
    { type: 'content_block_stop', index: 4 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 77, server_tool_use: { web_search_requests: 1 } } },
  ];
  async function* gen() { for (const e of evs) yield e; }
  const out: LlmEvent[] = [];
  for await (const e of fromAnthropicEvents(gen())) out.push(e);
  const stop = out.find((e) => e.type === 'stop');
  const usage = out.find((e) => e.type === 'usage');
  ok(out.some((e) => e.type === 'server_search' && e.query === 'ai banks'), 'server search query parsed');
  ok(out.some((e) => e.type === 'web_sources' && e.sources[0].url === 'https://x.test/a'), 'web sources from result block');
  ok(out.filter((e) => e.type === 'narration_end').length === 2, 'narration_end on server_tool_use and tool_use');
  if (stop?.type === 'stop') {
    const raw = stop.assistant.raw as Record<string, unknown>[];
    ok(stop.reason === 'tool_use' && stop.assistant.toolCalls[0].name === 'search_atlas' && (stop.assistant.toolCalls[0].input as { query: string }).query === 'agents', 'tool call reconstructed');
    ok(raw.length === 5 && raw[0].signature === 'SIG' && raw[0].thinking === 'hmm' && raw[3].type === 'web_search_tool_result', 'raw blocks replayable (thinking signature, server result kept)');
  } else ok(false, 'stop event');
  if (usage?.type === 'usage') ok(usage.usage.cacheRead === 1000 && usage.usage.output === 77 && usage.usage.webSearches === 1, 'usage');
}
// 9. Anthropic message mapping: tool results + final instruction merge into one user turn; rolling cache breakpoint.
{
  const msgs = toAnthropicMessages([
    { role: 'user', content: 'q' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 's', input: {} }] },
    { role: 'tool', results: [{ id: 'a', name: 's', text: 'r' }] },
    { role: 'user', content: 'FINAL' },
  ]) as { role: string; content: Record<string, unknown>[] }[];
  ok(msgs.length === 3 && msgs[2].role === 'user' && msgs[2].content.length === 2, 'tool result + instruction merged');
  ok(Boolean(msgs[2].content[1].cache_control) && !msgs[0].content[0].cache_control, 'rolling breakpoint on last user block');
  ok(webToolFor('claude-haiku-5-5').type === 'web_search_20260209' && webToolFor('claude-haiku-4-5').type === 'web_search_20250305', 'web tool variant');
}
// 10. OpenRouter SSE fixture with split tool-call deltas.
{
  const sse = [
    'data: {"choices":[{"delta":{"content":"Let me check."}}]}\n',
    ': keep-alive\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search_","arguments":"{\\"que"}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"atlas","arguments":"ry\\":\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}\n',
    'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":9,"cost":0.0001,"prompt_tokens_details":{"cached_tokens":20}}}\n',
    'data: [DONE]\n',
  ].join('');
  const body = new ReadableStream<Uint8Array>({ start(c) { const b = new TextEncoder().encode(sse); c.enqueue(b.slice(0, 57)); c.enqueue(b.slice(57)); c.close(); } });
  const chunks: Record<string, unknown>[] = [];
  for await (const j of sseJson(body)) chunks.push(j);
  ok(chunks.length === 4, `sse chunks ${chunks.length}`);
  const oa = toOpenAiMessages('sys', [{ role: 'user', content: 'q' }, { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 's', input: { a: 1 } }] }, { role: 'tool', results: [{ id: 'c1', name: 's', text: 'oops', isError: true }] }]);
  ok(oa[0].role === 'system' && (oa[2].tool_calls as unknown[]).length === 1 && oa[3].role === 'tool' && /ERROR/.test(oa[3].content as string), 'openai message mapping');
}

console.log(fail ? `${fail} failure(s)` : 'ok: loop + adapter tests pass');
process.exit(fail ? 1 : 0);
