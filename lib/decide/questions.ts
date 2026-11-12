import type { Question, QuestionKey } from './types';

// The four v1 questions. Options carry single-token answers so the logprob
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
};

export const DEFAULT_KEYS: QuestionKey[] = ['model_tier', 'needs_web', 'needs_clarify', 'depth'];
