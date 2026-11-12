// The decider's typed questions and answers (redo Phase 1, inspired by
// TypeSafe's Jev, built in-house). Import-free so tests load it directly.

export type QuestionKey = 'model_tier' | 'needs_web' | 'needs_clarify' | 'depth';

export interface ChoiceOption {
  token: string; // the single token the judge answers with (A, B, C, Y, N, 1, 2, 3)
  value: string; // what the decision means (cheap, mid, strong, yes, no, 1, 2, 3)
  describe: string; // shown to the judge after the token
}

export interface Question {
  key: QuestionKey;
  kind: 'choice' | 'yesno' | 'score';
  ask: string; // the question put to the judge
  options: ChoiceOption[];
}

// What the decider knows about the turn. Everything optional except text.
export interface Situation {
  text: string;
  prevUser?: string;
  lane?: string; // covered | thin | adjacent | unrelated, when retrieval ran first
  topRank?: number;
  pickedModel?: string | null; // a manual pick in the selector (not 'auto')
  webToggle?: boolean;
}

export type Backend = 'rules' | 'logprob' | 'structured' | 'default';

export interface Decision {
  key: QuestionKey;
  answer: string; // an option value
  probs: Record<string, number>; // option value -> probability (sums to 1)
  backend: Backend;
  trust: 'high' | 'low';
  latencyMs: number;
  reason?: string;
}

export type Decisions = Partial<Record<QuestionKey, Decision>>;
