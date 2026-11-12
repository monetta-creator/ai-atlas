// The v2 chat's NDJSON protocol (one JSON object per line). Type-only imports, so the
// order test and the client can load it. Order of a turn:
//   lane -> (decline -> done) | decision -> status* -> (tool_call | status |
//   delta | retract | view | sources)* -> sources? -> verify? -> cost -> error? -> done
// `retract` tells the client to drop the answer text streamed so far in this
// call (it was narration before a tool call or search).

import type { AtlasView } from '../tools/types';

export interface V2Decision {
  model: string;
  label: string;
  provider: 'anthropic' | 'openrouter';
  tier: 'cheap' | 'mid' | 'strong';
  auto: boolean; // the decider picked (vs a manual pick)
  recommended: string; // the decider's pick even when the person chose by hand
  recommendedLabel: string;
  reason: string;
  web: boolean;
  clarify: boolean;
  depth: string;
  estUsd: number;
  budget: { notice: string | null; message: string | null; usedShare: number };
  latencyMs: number;
}

export interface V2Cost {
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  searches: number;
  rounds: number;
  tool_calls: number;
  model: string;
}

export type V2Event =
  | { type: 'lane'; lane: string; reason: string }
  | { type: 'decline'; payload: unknown }
  | { type: 'decision'; decision: V2Decision }
  // A /skill or @agent invocation was recognized (before the decision).
  | { type: 'skill'; slug: string; title: string; kind: 'skill' | 'agent' | 'unknown' }
  | { type: 'status'; text: string }
  | { type: 'tool_call'; name: string; ok: boolean }
  | { type: 'delta'; text: string }
  | { type: 'retract' }
  | { type: 'sources'; sources: { url: string; title: string }[] }
  | { type: 'verify'; report: unknown }
  // Two or three next steps for this turn (lib/ask/chips.ts).
  | { type: 'chips'; chips: { label: string; prompt: string; kind: string }[] }
  // A data-bound view resolved by the show_view tool; any time between decision and cost.
  | { type: 'view'; view: AtlasView }
  | { type: 'cost'; report: V2Cost }
  | { type: 'error'; text: string }
  | { type: 'done'; signals: Record<string, string> };

export const nd = (e: V2Event): string => `${JSON.stringify(e)}\n`;

// Checks a finished turn's event sequence against the protocol (used by the
// test on fixtures and by the curl smoke). Returns problems, empty when valid.
export function protocolProblems(events: V2Event[]): string[] {
  const p: string[] = [];
  if (!events.length) return ['no events'];
  if (events[0].type !== 'lane') p.push('first event must be lane');
  if (events[events.length - 1].type !== 'done') p.push('last event must be done');
  const doneCount = events.filter((e) => e.type === 'done').length;
  if (doneCount !== 1) p.push(`exactly one done (got ${doneCount})`);
  const declined = events.some((e) => e.type === 'decline');
  if (declined) {
    if (events.some((e) => e.type === 'delta' || e.type === 'decision')) p.push('a declined turn has no decision or answer');
    return p;
  }
  const di = events.findIndex((e) => e.type === 'decision');
  const errored = events.some((e) => e.type === 'error');
  const skillAt = events.findIndex((e) => e.type === 'skill');
  // A model-free skill turn (/help, an unknown name, an agent pointer) has no decision.
  const modelFree = skillAt === 1 && di < 0;
  if (!modelFree && !errored && di !== (skillAt === 1 ? 2 : 1)) p.push('decision must follow lane (and skill)');
  const firstDelta = events.findIndex((e) => e.type === 'delta');
  if (firstDelta >= 0 && di > firstDelta) p.push('decision before any answer text');
  const ci = events.findIndex((e) => e.type === 'cost');
  if (ci >= 0 && events.slice(ci + 1).some((e) => e.type === 'delta' || e.type === 'tool_call')) p.push('nothing streams after cost');
  if (!errored && ci < 0) p.push('a finished turn reports its cost');
  return p;
}
