import { runStructured } from './dossier';
import type { Lens } from './types';

// Server-only. One non-web structured call that recommends which cross-cutting
// lenses apply to a single claim/stance/bridge statement. Recommend-only: the author
// commits the tags. Same gate philosophy as the claim recommender.

const LENSES: Lens[] = ['market', 'economics', 'social', 'employment', 'education', 'geopolitics', 'stack'];

const SYSTEM = `You assign cross-cutting LENSES to a single statement from The AI Atlas, a map of the AI-economy debate. A lens is an angle for entering the map, not a topic the statement is "about" in passing:
- market: pricing, valuation, where value accrues, competition for rents.
- economics: unit economics, business viability, cost/revenue.
- social: effects on people, culture, behavior, institutions.
- employment: jobs, labor, skills, displacement.
- education: learning, training, schooling, credentialing.
- geopolitics: states, export controls, national strategy, sovereignty.
- stack: the technology layers — silicon, compute, models, inference, tooling, applications.

Return ONLY the lenses that genuinely apply (usually 1 to 3). Return an empty list if none clearly fit — do not stretch. You only recommend; the author commits the tags.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { lenses: { type: 'array', items: { type: 'string', enum: LENSES } } },
  required: ['lenses'],
};

export async function recommendLenses(statement: string): Promise<Lens[]> {
  const text = (statement || '').trim();
  if (!text) return [];
  const out = await runStructured<{ lenses: string[] }>({
    system: SYSTEM,
    user: `STATEMENT:\n${text.slice(0, 1200)}`,
    toolName: 'submit_lenses',
    toolDescription: 'Return the cross-cutting lenses that apply.',
    schema: SCHEMA,
    maxTokens: 200,
    effort: 'low',
    feature: 'lens_recommendations',
  });
  const valid = new Set<string>(LENSES);
  return (out.lenses ?? []).filter((l) => valid.has(l)) as Lens[];
}
