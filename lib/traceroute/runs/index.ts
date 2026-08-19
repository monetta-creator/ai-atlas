// The curated inference runs, and the resolver that picks one for a given prompt.
//
// Three runs, chosen to teach three different things:
//   capital-of-france   what near certainty looks like
//   genuinely-uncertain what the output head usually looks like, and why sampling matters
//   tokenizer-seams     that the vocabulary is fixed and rare words break apart
//
// A demo where every probability bar reads 99 percent teaches nothing about sampling, which
// is why the middle one exists.

import type { ScriptedRun, TokenRec } from '../run-types';
import { RUN as CAPITAL } from './capital-of-france';
import { RUN as UNCERTAIN } from './genuinely-uncertain';
import { RUN as SEAMS } from './tokenizer-seams';

export const RUNS: ScriptedRun[] = [CAPITAL, UNCERTAIN, SEAMS];

export const RUN_BY_ID: ReadonlyMap<string, ScriptedRun> = new Map(RUNS.map((r) => [r.id, r]));

export const DEFAULT_RUN_ID = CAPITAL.id;

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.?!]+$/, '');
}

/**
 * Resolve a reader's text to a run.
 *
 * An exact match on a curated prompt returns that run untouched. Anything else keeps the
 * submitted REAL token split (tokenized client-side) and splices it onto the closest curated
 * continuation, flipping `provenance` to 'tokenizer' so the plate says exactly that. The
 * generated half is never presented as anything but a scripted walkthrough.
 */
export function spliceRun(promptTokens: TokenRec[], prompt: string, base: ScriptedRun): ScriptedRun {
  return {
    ...base,
    id: `${base.id}--custom`,
    title: 'Submitted prompt',
    teaser: prompt,
    prompt,
    promptTokens,
    provenance: 'tokenizer',
    sourceNote:
      'The submitted sentence was tokenized for real. The continuation below is a scripted walkthrough, not a live model.',
    // Attention weights were authored against a different context length, so drop them
    // rather than render a distribution that does not line up with the tokens on screen.
    outputs: base.outputs.map((o) => ({ ...o, attention: undefined })),
  };
}

/** Pick the curated run whose prompt is closest in length, as a stand-in continuation. */
export function nearestRun(prompt: string): ScriptedRun {
  const exact = RUNS.find((r) => normalize(r.prompt) === normalize(prompt));
  if (exact) return exact;
  const words = prompt.trim().split(/\s+/).length;
  return RUNS.reduce((best, r) => {
    const d = Math.abs(r.prompt.trim().split(/\s+/).length - words);
    const bd = Math.abs(best.prompt.trim().split(/\s+/).length - words);
    return d < bd ? r : best;
  }, RUNS[0]);
}

export function isCuratedPrompt(prompt: string): boolean {
  return RUNS.some((r) => normalize(r.prompt) === normalize(prompt));
}
