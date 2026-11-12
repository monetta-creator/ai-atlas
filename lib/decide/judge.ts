// Stage 2: the logprob judge. A small open-weight model on OpenRouter answers
// each question with ONE token; the probability comes from that token's
// logprobs, not from a number the model writes. Fallback when logprobs are
// missing: Claude Haiku 5.5 structured output with stated probabilities,
// marked low-trust (policy.ts never escalates the tier on low trust).
import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { openrouterChat } from '../llm/openrouter';
import { firstTokenTop, optionProbs } from './logprobs';
import { POLICY, normalize } from './policy';
import type { Decision, Question, Situation } from './types';

export const JUDGE_MODEL = 'meta-llama/llama-3.1-8b-instruct';
export const FALLBACK_MODEL = 'claude-haiku-5-5';
const FEATURE = 'ask_decide';

const CONTEXT =
  'You route messages for an AI research assistant used by a practitioner leading AI adoption inside a regulated financial institution. ' +
  'The assistant has a curated, dated database of AI developments (news, filings, papers, company facts, an argument map) and optional web search.';

export function judgePrompt(q: Question, s: Situation): { system: string; user: string } {
  const opts = q.options.map((o) => `${o.token} = ${o.describe}`).join('\n');
  const prev = s.prevUser ? `Previous message from the user: """${s.prevUser.slice(0, 600)}"""\n` : '';
  return {
    system: `${CONTEXT} Answer with exactly one character from the allowed options and nothing else.`,
    user: `${prev}Message: """${s.text.slice(0, 2000)}"""\n\nQuestion: ${q.ask}\n${opts}\n\nAnswer with one character: ${q.options.map((o) => o.token).join(', ')}.`,
  };
}

export async function logprobJudge(q: Question, s: Situation): Promise<Decision | null> {
  const t0 = Date.now();
  const { system, user } = judgePrompt(q, s);
  const res = await openrouterChat(
    {
      model: JUDGE_MODEL,
      max_tokens: 1,
      temperature: 0,
      logprobs: true,
      top_logprobs: 10,
      // Only route to providers that honor every parameter (logprobs included).
      provider: { require_parameters: true },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    { timeoutMs: POLICY.judgeTimeoutMs, feature: FEATURE, metadata: { decide: q.key } },
  );
  const top = firstTokenTop(res.data);
  if (!top) return null;
  const parsed = optionProbs(top, q.options);
  if (!parsed) return null;
  const values = q.options.map((o) => o.value);
  return {
    key: q.key,
    answer: '', // filled by policy in index.ts
    probs: normalize(parsed.probs, values),
    backend: 'logprob',
    trust: parsed.coverage >= 0.5 ? 'high' : 'low',
    latencyMs: Date.now() - t0,
  };
}

// One structured call answering every pending question with stated
// probabilities. Low trust by construction.
export async function structuredFallback(qs: Question[], s: Situation): Promise<Decision[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || qs.length === 0) return [];
  const t0 = Date.now();
  const client = new Anthropic({ apiKey, timeout: 8_000, maxRetries: 0 });
  const properties: Record<string, unknown> = {};
  for (const q of qs) {
    properties[q.key] = {
      type: 'object',
      additionalProperties: false,
      required: q.options.map((o) => o.value),
      properties: Object.fromEntries(q.options.map((o) => [o.value, { type: 'number', description: `probability 0-1 that the answer is: ${o.describe}` }])),
    };
  }
  const schema = { type: 'object', additionalProperties: false, required: qs.map((q) => q.key), properties };
  const body = qs.map((q) => `${q.key}: ${q.ask} Options: ${q.options.map((o) => `${o.value} (${o.describe})`).join('; ')}`).join('\n');
  const res = await client.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 400,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: CONTEXT + ' Give a probability for every option of every question; each question\'s probabilities sum to 1.',
    messages: [{ role: 'user', content: `Message: """${s.text.slice(0, 2000)}"""\n\n${body}` }],
  });
  await recordApiCall({ feature: FEATURE, model: FALLBACK_MODEL, usage: res.usage, wallMs: Date.now() - t0, metadata: { decide: 'fallback' } });
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return [];
  let parsed: Record<string, Record<string, number>>;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    return [];
  }
  const latencyMs = Date.now() - t0;
  return qs.map((q) => ({
    key: q.key,
    answer: '',
    probs: normalize(parsed[q.key] ?? {}, q.options.map((o) => o.value)),
    backend: 'structured' as const,
    trust: 'low' as const,
    latencyMs,
  }));
}
