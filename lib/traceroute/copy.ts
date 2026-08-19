// Caption copy for the inference timeline.
//
// One function per phase, with the run in scope, so a new sentence gets captions for free.
// House rule enforced here: no em dashes in user-facing text. Use commas, colons, or ` · `.

import { MODEL_SPEC } from './architecture';
import type { PhaseId } from './phases';
import type { ScriptedRun, TokenRec } from './run-types';

export interface CaptionCtx {
  run: ScriptedRun;
  /** -1 for the prompt prologue. */
  cycle: number;
  /** The token being produced this cycle, absent during the prologue. */
  token: TokenRec | null;
  /** How many tokens are in context at the start of this cycle. */
  contextLen: number;
  blockIndex: number | null;
  /** Is this a condensed cycle (the reader has already seen the full pass). */
  condensed: boolean;
}

const { nLayers, dModel, dFF, vocab, nHeads } = MODEL_SPEC.dims;

function n(x: number): string {
  return x.toLocaleString('en-US');
}

export const PHASE_COPY: Record<PhaseId, (c: CaptionCtx) => string> = {
  tokenize: (c) =>
    `The prompt is cut into ${c.run.promptTokens.length} pieces from a fixed vocabulary of ${n(vocab)}. Common words survive whole, rarer ones break apart.`,

  embed: (c) =>
    c.cycle < 0
      ? `Each token becomes a row from the embedding table: ${n(dModel)} numbers. The text is gone from here on.`
      : `The token just produced is embedded and appended. Only this one position is new.`,

  position: () =>
    `Position information is added, so the model can tell an ordered sentence from a bag of words.`,

  'block-enter': (c) =>
    `Block ${(c.blockIndex ?? 0) + 1} of ${nLayers}. It will read the stream, work out an adjustment, and add that adjustment back.`,

  'attn-norm': () => `The stream is rescaled so the arithmetic that follows stays in range.`,

  'attn-qkv': () =>
    `Three learned projections: a query for what this position is looking for, a key for what it offers, and a value for what it passes on.`,

  'kv-reuse': (c) =>
    c.cycle <= 0
      ? `Keys and values for all ${c.contextLen} positions are computed and cached.`
      : `Keys and values for the earlier ${c.contextLen - 1} positions are already cached. Only position ${c.contextLen} is computed. This is why the tenth token costs about the same as the second.`,

  'attn-scores': (c) =>
    `Every position is scored against every earlier one, across ${nHeads} heads at once. ${c.cycle < 0 ? 'All positions at once.' : 'Only the newest position needs new scores.'}`,

  'attn-mix': () =>
    `Values are mixed in proportion to those scores. This is the only step in the whole block where information moves between positions.`,

  'attn-out': () => `One more projection, and attention has done its reading.`,

  'residual-a': () =>
    `The result is added back into the stream. Nothing is replaced, only adjusted, which is what makes a stack this deep trainable.`,

  'mlp-norm': () => `Rescaled again, for the second half of the block.`,

  'mlp-up': () =>
    `Each vector is projected up from ${n(dModel)} to ${n(dFF)} numbers. Most of the model's parameters are spent here.`,

  'mlp-act': () =>
    `A simple elementwise nonlinearity. Without it the entire stack would collapse into one matrix multiply.`,

  'mlp-down': () => `Projected back down to ${n(dModel)}.`,

  'residual-b': () => `Added into the stream again. Block complete.`,

  'blocks-repeat': () =>
    `Blocks 2 through ${nLayers} do exactly the same thing, with their own weights, one after another.`,

  'block-exit': () => `The stream leaves the last block.`,

  'head-norm': () => `A final rescale before the model commits to an answer.`,

  unembed: () =>
    `The stream is projected back out to one raw score for every token in the vocabulary: ${n(vocab)} numbers.`,

  softmax: () =>
    `Those scores become probabilities that sum to one. The model now has an opinion about what comes next.`,

  sample: (c) =>
    c.token
      ? `One token is drawn from that distribution. This time it chose ${JSON.stringify(c.token.text.trim() || c.token.display)}.`
      : `One token is drawn from the distribution.`,

  append: (c) =>
    `That token is appended to the context, which is now ${c.contextLen + 1} tokens long, and the whole stack runs again.`,

  done: (c) =>
    `${c.run.outputs.length} tokens, ${c.run.outputs.length} passes through all ${nLayers} blocks. That loop is the entire trick.`,
};
