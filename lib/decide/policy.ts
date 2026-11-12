// Every threshold the decider uses, in one reviewable file. The judge returns
// probabilities; this file turns them into actions. Import-free.
import type { Decision, QuestionKey } from './types';

export const POLICY = {
  // model_tier: escalate only on real confidence (budget-first, Q6).
  strongAt: 0.55, // P(strong) at or above this picks the strong tier
  midOrAboveAt: 0.6, // P(mid) + P(strong) at or above this picks mid
  // needs_web: a coin flip is enough (a search is cheap, a stale answer is not).
  webAt: 0.5,
  // needs_clarify: a high bar. Answer first; ask only when nothing useful can be said.
  clarifyAt: 0.8,
  // A structured-fallback answer (stated, not measured, probabilities) never escalates the tier.
  lowTrustMaxTier: 'cheap' as const,
  // The judge's own latency budget; past it the defaults stand.
  judgeTimeoutMs: 2500,
};

// Fallbacks when no backend answers.
export const DEFAULTS: Record<QuestionKey, string> = {
  model_tier: 'cheap',
  needs_web: 'no',
  needs_clarify: 'no',
  depth: '2',
};

// Normalize a probability map over the allowed values; missing values get 0.
export function normalize(probs: Record<string, number>, values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const v of values) {
    const p = Number.isFinite(probs[v]) && probs[v] > 0 ? probs[v] : 0;
    out[v] = p;
    total += p;
  }
  if (total <= 0) return Object.fromEntries(values.map((v) => [v, 1 / values.length]));
  for (const v of values) out[v] = out[v] / total;
  return out;
}

// Map a question's probabilities to its answer value under POLICY.
export function applyPolicy(key: QuestionKey, probs: Record<string, number>, trust: 'high' | 'low'): string {
  switch (key) {
    case 'model_tier': {
      if (trust === 'low') return POLICY.lowTrustMaxTier;
      const strong = probs.strong ?? 0;
      const mid = probs.mid ?? 0;
      if (strong >= POLICY.strongAt) return 'strong';
      if (mid + strong >= POLICY.midOrAboveAt) return 'mid';
      return 'cheap';
    }
    case 'needs_web':
      return (probs.yes ?? 0) >= POLICY.webAt ? 'yes' : 'no';
    case 'needs_clarify':
      return (probs.yes ?? 0) >= POLICY.clarifyAt ? 'yes' : 'no';
    case 'depth': {
      // Expected value, rounded: a score, not a vote.
      const ev = 1 * (probs['1'] ?? 0) + 2 * (probs['2'] ?? 0) + 3 * (probs['3'] ?? 0);
      return String(Math.min(3, Math.max(1, Math.round(ev))));
    }
  }
}

export function defaultDecision(key: QuestionKey, values: string[], latencyMs = 0): Decision {
  const answer = DEFAULTS[key];
  return {
    key,
    answer,
    probs: Object.fromEntries(values.map((v) => [v, v === answer ? 1 : 0])),
    backend: 'default',
    trust: 'low',
    latencyMs,
  };
}
