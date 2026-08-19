// The inference source record: what a tokenizer plus a logprob-returning model would emit.
//
// Deliberately split from the compiled timeline (./compile). This file describes WHAT the
// model did; the compiler decides how to SHOW it. The seam matters because it is the
// upgrade path: swapping authored data for a real run means writing something that produces
// a ScriptedRun. Nothing downstream changes.
//
// Honesty is a field, not a convention. `provenance` is rendered next to the token strip on
// every run, always, and its three values describe exactly how much of what you are looking
// at is real:
//
//   'authored'   both the token split and the continuation are hand-authored
//   'tokenizer'  the token split is real (a submitted sentence, really tokenized), the
//                continuation is a scripted walkthrough
//   'model'      reserved. Nothing produces this yet.

export interface TokenRec {
  /** Vocabulary index. Real for tokenizer-derived runs. */
  id: number;
  /** The exact piece, including any leading space. */
  text: string;
  /** Render-safe form with whitespace made visible. */
  display: string;
}

export interface Candidate {
  token: TokenRec;
  /** 0..1. The top-k shown need not sum to 1; the remainder is the long tail. */
  prob: number;
}

/** Sparse by construction: only the links worth drawing, never a full N x N matrix. */
interface AttentionSlice {
  layer: number;
  head: number;
  /** One weight per prior position, aligned to the context so far. Sums to about 1. */
  weights: number[];
}

interface OutputStep {
  index: number;
  /** The token actually emitted this cycle. */
  token: TokenRec;
  /** Top-k, sorted descending by prob. The first entry is not always the emitted token. */
  top: Candidate[];
  attention?: AttentionSlice;
  /** One optional editorial sentence for this cycle. No em dashes. */
  note?: string;
}

export type Provenance = 'authored' | 'tokenizer' | 'model';

export interface ScriptedRun {
  id: string;
  title: string;
  /** Shown in the picker, one line. */
  teaser: string;
  prompt: string;
  promptTokens: TokenRec[];
  outputs: OutputStep[];
  provenance: Provenance;
  /** The sentence rendered on the provenance plate. */
  sourceNote: string;
}

/** Whitespace made visible, so a leading space is legible in the token strip. */
function displayOf(text: string): string {
  return text.replace(/ /g, '·').replace(/\n/g, '↵');
}

export function makeToken(id: number, text: string): TokenRec {
  return { id, text, display: displayOf(text) };
}

/** The full context at the start of a given cycle: prompt plus everything emitted before it. */
export function contextAt(run: ScriptedRun, cycle: number): TokenRec[] {
  if (cycle < 0) return run.promptTokens;
  return [...run.promptTokens, ...run.outputs.slice(0, cycle).map((o) => o.token)];
}

export const PROVENANCE_COPY: Record<Provenance, string> = {
  authored:
    'Scripted walkthrough. The token split is real, produced by a byte-pair tokenizer. The probabilities and attention weights are hand-authored to be representative, not measured from a running model.',
  tokenizer:
    'The submitted sentence was tokenized for real. The continuation, probabilities, and attention weights are a scripted walkthrough, not a live model.',
  model: 'Measured from a live model run.',
};
