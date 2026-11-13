import type { Question, QuestionKey } from './types';

// The v1 questions (shape added 2026-11-12). Options carry single-token answers so the logprob
// judge reads a real probability off the first output token.
export const QUESTIONS: Record<QuestionKey, Question> = {
  model_tier: {
    key: 'model_tier',
    kind: 'choice',
    ask: 'How capable a model does answering this message well need?',
    options: [
      { token: 'A', value: 'cheap', describe: 'basic: a lookup, a short factual answer, a simple summary, small talk' },
      { token: 'B', value: 'mid', describe: 'careful: synthesis across several sources, a comparison, a structured explanation, a draft' },
      { token: 'C', value: 'strong', describe: 'hardest: long multi-step reasoning, a high-stakes judgment, subtle argument across many documents' },
    ],
  },
  needs_web: {
    key: 'needs_web',
    kind: 'yesno',
    ask: 'Does answering this need a live web search (very recent news, a specific external page, facts unlikely to be in a curated research database of AI developments)?',
    options: [
      { token: 'Y', value: 'yes', describe: 'yes' },
      { token: 'N', value: 'no', describe: 'no' },
    ],
  },
  needs_clarify: {
    key: 'needs_clarify',
    kind: 'yesno',
    ask: 'Is this message so ambiguous that a good assistant must ask a clarifying question before answering anything useful?',
    options: [
      { token: 'Y', value: 'yes', describe: 'yes, too ambiguous to answer' },
      { token: 'N', value: 'no', describe: 'no, a reasonable reading exists' },
    ],
  },
  depth: {
    key: 'depth',
    kind: 'score',
    ask: 'How long and deep should the answer be?',
    options: [
      { token: '1', value: '1', describe: 'a few sentences' },
      { token: '2', value: '2', describe: 'a few paragraphs or a short list' },
      { token: '3', value: '3', describe: 'a long, structured answer' },
    ],
  },
  // The answer's form, picked before it is written (the way the big chat
  // apps let the model choose a table): the answerer gets the pick as a
  // per-turn instruction (lib/ask/prompt-v2.ts SHAPE_TURN).
  shape: {
    key: 'shape',
    kind: 'choice',
    ask: 'What form should the answer take?',
    options: [
      { token: 'A', value: 'prose', describe: 'a direct answer in sentences: a question about facts, a view, what happened, or why' },
      { token: 'B', value: 'table', describe: 'a comparison: several things (banks, vendors, models, rules, options) side by side on the same points' },
      { token: 'C', value: 'document', describe: 'a usable document the user asked for: a memo, email, brief, plan, checklist, or list of steps' },
      { token: 'D', value: 'lesson', describe: 'teaching: the user wants to learn or understand a concept, built up from basics' },
    ],
  },
};

export const DEFAULT_KEYS: QuestionKey[] = ['model_tier', 'needs_web', 'needs_clarify', 'depth', 'shape'];
