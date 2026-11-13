// Stage 1: rules where a rule is enough. Each rule settles one question with
// certainty and skips the judge for it. Import-free.
import type { Decision, Decisions, QuestionKey, Situation } from './types';

const URL_RE = /\bhttps?:\/\/\S+/i;
const SMALL_TALK_RE = /^(hi|hey|hello|thanks|thank you|ok|okay|cool|great|got it|bye)[.! ]*$/i;
// Explicit form cues settle shape without the judge: the 8B logprob judge
// leans to its first option and read "Help me really understand X" as prose
// 0.61 / lesson 0.29 (2026-11-12). First match wins: a drafted comparison
// is a document, "teach me X vs Y" is a lesson (which may still hold a table).
const DOCUMENT_RE = /\b(draft|write (me )?(a|an|up|something)|memo|e-?mail|one[- ]pager|one[- ]page|talking points|checklist|brief for|agenda)\b/i;
const TABLE_RE = /\b(compare|comparison|side by side|versus|vs\.?|in a table|tabulate)\b/i;
const LESSON_RE = /\b(teach me|explain|walk me through|eli5|from the basics|like i('| a)m (new|five)|i('| a)m not an? [a-z ]{0,20}person|help me (really )?understand (how|what|why|the))\b/i;

function certain(key: QuestionKey, answer: string, values: string[], reason: string): Decision {
  return {
    key,
    answer,
    probs: Object.fromEntries(values.map((v) => [v, v === answer ? 1 : 0])),
    backend: 'rules',
    trust: 'high',
    latencyMs: 0,
    reason,
  };
}

export function applyRules(s: Situation, keys: QuestionKey[], valuesFor: (k: QuestionKey) => string[]): Decisions {
  const out: Decisions = {};
  const text = s.text.trim();
  const want = new Set(keys);
  const set = (k: QuestionKey, answer: string, reason: string) => {
    if (want.has(k) && !out[k]) out[k] = certain(k, answer, valuesFor(k), reason);
  };

  if (SMALL_TALK_RE.test(text)) {
    set('model_tier', 'cheap', 'small talk');
    set('needs_web', 'no', 'small talk');
    set('needs_clarify', 'no', 'small talk');
    set('depth', '1', 'small talk');
    set('shape', 'prose', 'small talk');
  }
  if (DOCUMENT_RE.test(text)) set('shape', 'document', 'asks for a document');
  if (LESSON_RE.test(text)) set('shape', 'lesson', 'asks to be taught');
  if (TABLE_RE.test(text)) set('shape', 'table', 'asks for a comparison');
  if (URL_RE.test(text)) set('needs_web', 'yes', 'the message carries a link to read');
  if (s.webToggle === true) set('needs_web', 'yes', 'web search is switched on');
  if (s.lane === 'unrelated') {
    set('model_tier', 'cheap', 'off-topic turn');
    set('needs_web', 'no', 'off-topic turn');
  }
  return out;
}
