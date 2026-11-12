// decide(situation, keys): the fast judge in front of the careful answerer.
// Stages: rules (certain) -> logprob judge (measured probabilities, in
// parallel per question, bounded by POLICY.judgeTimeoutMs) -> Haiku 5.5
// structured fallback (stated probabilities, low trust) -> defaults.
// Thresholds live in policy.ts. Every decision is logged to `decisions`
// (migration 0086) unless opts.log is false.
import { createHash } from 'node:crypto';
import { exec } from '../db';
import { logprobJudge, structuredFallback } from './judge';
import { applyPolicy, defaultDecision } from './policy';
import { QUESTIONS, DEFAULT_KEYS } from './questions';
import { applyRules } from './rules';
import type { Decision, Decisions, QuestionKey, Situation } from './types';

export type { Decision, Decisions, QuestionKey, Situation } from './types';

const valuesFor = (k: QuestionKey) => QUESTIONS[k].options.map((o) => o.value);

export function situationHash(s: Situation): string {
  return createHash('sha256').update(`${s.prevUser ?? ''}\u0000${s.text}`).digest('hex').slice(0, 32);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); })]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface DecideOpts {
  log?: boolean;
  conversationId?: string | null;
  // Test seams.
  judge?: typeof logprobJudge;
  fallback?: typeof structuredFallback;
  timeoutMs?: number;
}

export async function decide(s: Situation, keys: QuestionKey[] = DEFAULT_KEYS, opts: DecideOpts = {}): Promise<Decisions> {
  const judge = opts.judge ?? logprobJudge;
  const fallback = opts.fallback ?? structuredFallback;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const out: Decisions = applyRules(s, keys, valuesFor);
  const pending = keys.filter((k) => !out[k]);

  const judged = await Promise.all(pending.map((k) => withTimeout(judge(QUESTIONS[k], s), timeoutMs)));
  const missing: QuestionKey[] = [];
  pending.forEach((k, i) => {
    const d = judged[i];
    if (d) out[k] = { ...d, answer: applyPolicy(k, d.probs, d.trust) };
    else missing.push(k);
  });

  if (missing.length > 0) {
    const fb = await withTimeout(fallback(missing.map((k) => QUESTIONS[k]), s), timeoutMs * 2);
    for (const d of fb ?? []) out[d.key] = { ...d, answer: applyPolicy(d.key, d.probs, d.trust) };
  }
  for (const k of keys) if (!out[k]) out[k] = defaultDecision(k, valuesFor(k));

  if (opts.log !== false) await logDecisions(s, out, opts.conversationId ?? null);
  return out;
}

export async function logDecisions(s: Situation, ds: Decisions, conversationId: string | null): Promise<void> {
  const hash = situationHash(s);
  const rows = Object.values(ds).filter((d): d is Decision => Boolean(d));
  try {
    for (const d of rows) {
      await exec(
        `insert into decisions (conversation_id, question_key, situation_hash, answer, probabilities, backend, latency_ms)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [conversationId, d.key, hash, d.answer, JSON.stringify({ probs: d.probs, trust: d.trust, reason: d.reason ?? null }), d.backend, Math.round(d.latencyMs)],
      );
    }
  } catch (e) {
    // Telemetry is best-effort: a logging failure never breaks the turn.
    console.error('[decide] log failed', (e as Error).message);
  }
}
