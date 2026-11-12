// The one bounded research loop (redo Phase 1), provider-agnostic: an
// Adapter (Anthropic or OpenRouter) streams normalized events, `exec` runs
// tool calls (the registry), and the loop enforces the caps: rounds, calls
// per round, result size, input budget, wall-clock deadline. Past any cap it
// forces a final answer with tools declared but disabled.
//
// Text the model writes before a tool call or a server-side search is
// narration ("let me look that up"), not the answer: the loop emits
// `retract` so the client drops it, and the answer is the text after the
// last narration_end of the final call. Tags, lanes, @@BEYOND@@ and the
// verifier sit above this file (the v2 route).
import type { ApiUsage } from '../cost';
import { addUsage, emptyUsage, type Adapter, type LlmMessage, type NormalizedUsage, type StopReason, type ToolCall, type ToolSpec, type WebSource } from '../llm/types';

export interface LoopCaps {
  maxRounds: number;
  maxCallsPerRound: number;
  resultCap: number; // chars per tool result
  inputBudget: number; // tokens in one call's prompt (uncached + cache read + cache write)
}

// Sized for 1M-context 5.5 models (10-architecture.md, upgrade #2), with the
// Haiku 5.5 price line in mind: its cheap rate holds to 100K-token prompts.
export const DEFAULT_CAPS: LoopCaps = { maxRounds: 8, maxCallsPerRound: 6, resultCap: 5000, inputBudget: 95_000 };

export type LoopEvent =
  | { type: 'delta'; text: string }
  | { type: 'retract' }
  | { type: 'status'; text: string }
  | { type: 'tool_call'; name: string; input: unknown; isError: boolean }
  | { type: 'web_sources'; sources: WebSource[] };

export interface LoopOpts {
  adapter: Adapter;
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  serverWebSearch: boolean;
  exec: (call: ToolCall) => Promise<{ text: string; isError?: boolean }>;
  emit: (e: LoopEvent) => void;
  finalInstruction: string;
  deadlineAt: number; // epoch ms
  caps?: Partial<LoopCaps>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  // Called after every model call (cost logging).
  onCall?: (usage: NormalizedUsage, wallMs: number) => Promise<void> | void;
  now?: () => number; // test seam
}

export interface LoopResult {
  answer: string;
  messages: LlmMessage[];
  usage: NormalizedUsage;
  rounds: number;
  modelCalls: number;
  toolCalls: number;
  stop: StopReason;
  forced: null | 'rounds' | 'deadline' | 'input';
  // Every successful tool result, for the verifier's deterministic checks.
  corpus: string[];
}

export function clip(s: string, cap: number): string {
  return s.length <= cap ? s : `${s.slice(0, cap)}\n[... clipped at ${cap} characters; fetch_record a specific record for more]`;
}

// Map normalized usage to the house ApiUsage for recordApiCall. Providers
// without a cache-read rate card (OpenRouter) pay cached tokens at input rate.
export function toApiUsage(u: NormalizedUsage, provider: 'anthropic' | 'openrouter'): ApiUsage {
  if (provider === 'openrouter') return { input_tokens: u.input + u.cacheRead, output_tokens: u.output };
  return {
    input_tokens: u.input,
    output_tokens: u.output,
    cache_creation_input_tokens: u.cacheWrite,
    cache_read_input_tokens: u.cacheRead,
    server_tool_use: { web_search_requests: u.webSearches },
  };
}

export async function runLoop(o: LoopOpts): Promise<LoopResult> {
  const caps: LoopCaps = { ...DEFAULT_CAPS, ...(o.caps ?? {}) };
  const now = o.now ?? Date.now;
  const messages: LlmMessage[] = [...o.messages];
  const corpus: string[] = [];
  let usage = emptyUsage();
  let rounds = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let forced: LoopResult['forced'] = null;
  let pauses = 0;

  for (;;) {
    const final = forced !== null;
    rounds++;
    let roundText = '';
    let stop: StopReason = 'end';
    let assistant: Extract<LlmMessage, { role: 'assistant' }> | null = null;
    let callUsage = emptyUsage();
    const t0 = now();

    for await (const ev of o.adapter.stream({
      model: o.model,
      system: o.system,
      messages,
      tools: o.tools,
      serverWebSearch: o.serverWebSearch && !final,
      noTools: final,
      maxTokens: o.maxTokens ?? 8000,
      effort: o.effort,
      signal: o.signal,
    })) {
      if (ev.type === 'text') {
        roundText += ev.text;
        o.emit({ type: 'delta', text: ev.text });
      } else if (ev.type === 'narration_end') {
        if (roundText) o.emit({ type: 'retract' });
        roundText = '';
      } else if (ev.type === 'server_search') {
        o.emit({ type: 'status', text: `Searching the web: ${ev.query}` });
      } else if (ev.type === 'web_sources') {
        o.emit({ type: 'web_sources', sources: ev.sources });
      } else if (ev.type === 'usage') {
        callUsage = ev.usage;
      } else if (ev.type === 'stop') {
        stop = ev.reason;
        assistant = ev.assistant;
      }
    }
    modelCalls++;
    usage = addUsage(usage, callUsage);
    await o.onCall?.(callUsage, now() - t0);
    if (!assistant) throw new Error('model stream ended without a stop event');
    messages.push(assistant);

    // A server tool paused the turn: re-send as is (bounded).
    if (stop === 'pause' && pauses < 3) {
      pauses++;
      continue;
    }

    if (stop === 'tool_use' && !final && assistant.toolCalls.length) {
      const calls = assistant.toolCalls;
      const results = [];
      for (let i = 0; i < calls.length; i++) {
        const c = calls[i];
        let r: { text: string; isError?: boolean };
        if (i >= caps.maxCallsPerRound) r = { text: `Too many tool calls in one round (limit ${caps.maxCallsPerRound}). Make this call again next round if still needed.`, isError: true };
        else if (c.input && typeof c.input === 'object' && '__invalid_json' in (c.input as object)) r = { text: 'The tool input was not valid JSON. Send the call again.', isError: true };
        else {
          try {
            r = await o.exec(c);
          } catch (e) {
            r = { text: `Tool error: ${(e as Error).message.slice(0, 200)}`, isError: true };
          }
        }
        toolCalls++;
        const text = clip(r.text, caps.resultCap);
        if (!r.isError) corpus.push(text);
        o.emit({ type: 'tool_call', name: c.name, input: c.input, isError: Boolean(r.isError) });
        results.push({ id: c.id, name: c.name, text, isError: r.isError });
      }
      messages.push({ role: 'tool', results });

      const promptTokens = callUsage.input + callUsage.cacheRead + callUsage.cacheWrite;
      if (rounds >= caps.maxRounds) forced = 'rounds';
      else if (now() >= o.deadlineAt) forced = 'deadline';
      else if (promptTokens >= caps.inputBudget) forced = 'input';
      if (forced) {
        o.emit({ type: 'status', text: forced === 'deadline' ? 'Time budget reached, writing with what is gathered' : 'Writing the answer' });
        messages.push({ role: 'user', content: o.finalInstruction });
      }
      continue;
    }

    return { answer: roundText.trim(), messages, usage, rounds, modelCalls, toolCalls, stop, forced, corpus };
  }
}
