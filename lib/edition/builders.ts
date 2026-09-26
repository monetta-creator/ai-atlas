import { routedStructured } from '../model-route';
import { fallbackReads, validateBuilderJudgments } from './builders-core';
import type { CatalogRow } from './builders-core';
import type { EditionBuilderRead, EditionHnItem } from './types';

// What builders are reading, the model leg (2026-09-26). One cheap call per
// edition (edition_prefs.model, GLM by default, feature edition_builders,
// counted by checkEditionBudget) judges the Hacker News front-page
// candidates for an AI builders pod inside a large regulated company and
// writes a one-line why per keep. The pure half (tags, chips, the catalog
// matcher, the validator that is the type boundary for the cheap models'
// JSON, the no-model fallback) lives in ./builders-core.ts.

// Generic by the public-repo rule: never the employer, never a person.
// edition_prefs.builders_steering (0067) overrides it.
export const DEFAULT_BUILDERS_STEERING =
  'The readers work in an AI transformation team at a large regulated financial-services company: production ' +
  'LLM features, agent pilots, internal copilots, model-risk reviews, vendor evaluations, data-governance ' +
  'constraints. Prefer what they can use this quarter.';

const BUILDERS_SYSTEM =
  `You pick reads for an AI builders pod inside a large regulated financial-services company: engineers, ` +
  `product people and transformation leads who build with LLMs, agents and AI tooling under model-risk, ` +
  `security and compliance constraints. Keep an item only if a builder learns something usable: a tool, ` +
  `model or release they might adopt; a pattern, architecture or postmortem; an eval or benchmark result ` +
  `that changes a choice; a security or governance development that changes what they may ship; cost or ` +
  `infrastructure news that changes a budget. Drop general-interest AI news, politics, funding rounds, ` +
  `culture pieces, history, and anything a builder cannot act on. For each keep write one line of at most ` +
  `120 characters: what it is and why a builder in a regulated company cares, plain and concrete, no ` +
  `praise. Tag it with exactly one of: tooling (tools, models, releases), patterns (architecture, ` +
  `postmortems, how-we-built-it), agents, evals (benchmarks, evaluations), security (security, privacy, ` +
  `governance, regulation that binds builders), infra (cost, hardware, serving, capacity), field (useful ` +
  `but none of the above). Return an empty list for a day with no builder reads. Never use an em dash; ` +
  `use a comma or a colon instead.`;

const BUILDERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', description: 'the candidate number shown, 0-based' },
          keep: { type: 'boolean' },
          tag: { type: 'string', description: 'tooling | patterns | agents | evals | security | infra | field' },
          line: { type: 'string', description: 'at most 120 characters; empty string when keep is false' },
        },
        required: ['index', 'keep', 'tag', 'line'],
      },
    },
  },
  required: ['items'],
};

function hostOf(url: string | null): string {
  if (!url) return 'news.ycombinator.com';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export interface BuilderJudgment {
  reads: EditionBuilderRead[];
  judged: boolean;
  error?: string;
}

export async function judgeBuilderReads(
  candidates: EditionHnItem[],
  model: string,
  steering: string | null,
  products: CatalogRow[] = [],
  fallbackPool: EditionHnItem[] = candidates
): Promise<BuilderJudgment> {
  if (!candidates.length) return { reads: [], judged: true };
  const user = [
    'CANDIDATES (Hacker News front page today):',
    ...candidates.map(
      (h, i) =>
        `${i}. "${h.title}" (${hostOf(h.url)}, ${h.points} points, ${h.comments} comments${/^show hn\b/i.test(h.title) ? ', Show HN' : ''})`
    ),
    '',
    'READERS: ' + (steering?.trim() || DEFAULT_BUILDERS_STEERING),
    '',
    'Return one entry per candidate you KEEP (index, keep true, tag, line). Skip the rest.',
  ].join('\n');
  try {
    const out = await routedStructured<{ items?: unknown }>({
      model,
      system: BUILDERS_SYSTEM,
      user,
      toolName: 'submit_builder_reads',
      toolDescription: 'Return the Hacker News candidates worth a builder\'s click, each with a tag and a one-line why.',
      schema: BUILDERS_SCHEMA,
      maxTokens: 1600,
      timeoutMs: 60_000,
      feature: 'edition_builders',
      metadata: { candidates: candidates.length },
    });
    return { reads: validateBuilderJudgments(candidates, out, products), judged: true };
  } catch (e) {
    return {
      reads: fallbackReads(fallbackPool, products),
      judged: false,
      error: e instanceof Error ? e.message : 'model error',
    };
  }
}
