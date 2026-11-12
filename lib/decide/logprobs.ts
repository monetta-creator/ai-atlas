// Turn an OpenAI-compatible logprobs payload into a probability per option.
// Import-free so the parsing test runs on fixtures with no network.
import type { ChoiceOption } from './types';

export interface TopLogprob {
  token: string;
  logprob: number;
}

// Reads the first generated token's top_logprobs (OpenAI chat shape:
// choices[0].logprobs.content[0].top_logprobs). Returns null when absent.
export function firstTokenTop(data: unknown): TopLogprob[] | null {
  const d = data as { choices?: { logprobs?: { content?: { token?: string; logprob?: number; top_logprobs?: TopLogprob[] }[] | null } | null }[] };
  const first = d?.choices?.[0]?.logprobs?.content?.[0];
  if (!first) return null;
  const top = Array.isArray(first.top_logprobs) && first.top_logprobs.length > 0
    ? first.top_logprobs
    : typeof first.token === 'string' && typeof first.logprob === 'number'
      ? [{ token: first.token, logprob: first.logprob }]
      : null;
  return top;
}

const clean = (t: string) => t.replace(/^[\s"'(\[]+|[\s"'.):\]]+$/g, '').toUpperCase();

// Sum the probability mass of tokens matching each option's token (" A",
// "A", "a" all count), then renormalize over the options. Returns null when
// no option token appears among the top candidates.
export function optionProbs(top: TopLogprob[], options: ChoiceOption[]): { probs: Record<string, number>; coverage: number } | null {
  const mass: Record<string, number> = {};
  let covered = 0;
  for (const o of options) mass[o.value] = 0;
  for (const t of top) {
    if (typeof t?.token !== 'string' || typeof t?.logprob !== 'number') continue;
    const tok = clean(t.token);
    const opt = options.find((o) => o.token.toUpperCase() === tok);
    if (!opt) continue;
    const p = Math.exp(t.logprob);
    mass[opt.value] += p;
    covered += p;
  }
  if (covered <= 0) return null;
  const probs: Record<string, number> = {};
  for (const o of options) probs[o.value] = mass[o.value] / covered;
  return { probs, coverage: covered };
}
