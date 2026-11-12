// One normalized conversation and event stream over two providers (redo
// Phase 1): Anthropic Messages for Claude, OpenAI-compatible chat via
// OpenRouter for open-weight models. The loop (lib/ask/loop.ts) speaks only
// these types; each adapter translates. Import-free.

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultMsg {
  id: string;
  name: string;
  text: string;
  isError?: boolean;
}

export type LlmMessage =
  // A mid-conversation operator instruction (a skill's recipe, a reminder).
  | { role: 'system'; content: string }
  // `prefix` is a large stable block (the map skeleton) sent before the
  // content with its own cache breakpoint on Anthropic; concatenated elsewhere.
  | { role: 'user'; content: string; prefix?: string }
  // `raw` is the provider's own assistant content (Anthropic blocks with
  // thinking signatures and server-tool results; OpenAI message object),
  // replayed verbatim on the next call so nothing is edited.
  | { role: 'assistant'; content: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolResultMsg[] };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: object;
}

export interface WebSource {
  url: string;
  title: string;
}

export interface NormalizedUsage {
  input: number; // uncached input tokens
  output: number;
  cacheRead: number;
  cacheWrite: number;
  webSearches: number;
  // Provider-reported USD when it gives one (OpenRouter usage.cost).
  providerCostUsd?: number;
}

export const emptyUsage = (): NormalizedUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 });

export function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    webSearches: a.webSearches + b.webSearches,
    providerCostUsd: a.providerCostUsd != null || b.providerCostUsd != null ? (a.providerCostUsd ?? 0) + (b.providerCostUsd ?? 0) : undefined,
  };
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'pause' | 'refusal' | 'error';

export type LlmEvent =
  | { type: 'text'; text: string }
  // The model started a tool call or a server-side search: any text already
  // streamed this call was narration, not the answer.
  | { type: 'narration_end' }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'server_search'; query: string }
  | { type: 'web_sources'; sources: WebSource[] }
  | { type: 'usage'; usage: NormalizedUsage }
  | { type: 'stop'; reason: StopReason; assistant: Extract<LlmMessage, { role: 'assistant' }> };

export interface TurnRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  // Anthropic: attach the server web_search tool. Open-weight models get our
  // Tavily web_search as an ordinary tool in `tools` instead.
  serverWebSearch: boolean;
  // Write the final answer: tools stay declared (history references them)
  // but the model may not call any.
  noTools: boolean;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface Adapter {
  provider: 'anthropic' | 'openrouter';
  stream(req: TurnRequest): AsyncIterable<LlmEvent>;
}
