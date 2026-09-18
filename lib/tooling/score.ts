import { q } from '../db';
import { routedStructured, resolvedModel } from '../model-route';
import { clampFit } from './core';
import { getProductsForScoring, getToolingPrefs, getToolingTasteDigest, getToolingCategories } from '../data/tooling';
import { setProductScores } from '../mutations/tooling';

// The catalog-scoring agent: a recommend-only rubric pass over candidates
// whose homepage read is done (enriched or a stamped fetch_error), the
// research queue-agent pattern applied to the tool catalog. The writer
// (setProductScores) auto-catalogs above the threshold and never demotes a
// cataloged or pinned row; nothing here decides anything, it only proposes.

const SCORE_CHUNK = 10;

export const DEFAULT_RUBRIC = [
  'You score AI products for the AI transformation team of a large, regulated financial-services enterprise deciding what to buy, what to build, and what to watch. Score every product 1 to 5 on five dimensions:',
  'relevance: how directly the product serves the AI transformation team\'s buy, build, or watch decisions in this category. 5 = a clear shortlist candidate.',
  'enterprise_readiness: the security, compliance, deployment options, and support a regulated enterprise actually needs. 5 = ready to pilot today.',
  'differentiation: how distinct the product is from the rest of the category, not a commodity wrapper. 5 = a genuinely novel approach.',
  'momentum: signs of traction, funding, adoption, or shipping velocity. 5 = clearly gaining ground.',
  'build_difficulty: how hard the product\'s core capability would be to replicate in-house. 5 = hard to replicate in-house, a strong argument to buy; 1 = trivial to build, a weak argument to buy.',
  'fit: 0 to 100, your overall buy/watch signal combining the five dimensions.',
  'steal: up to 3 specific features from this product worth copying if we built our own; empty if none stand out.',
  'reason: one sentence, under 300 characters, arguing the fit score.',
  'Never name a specific employer or acquirer. Never use an em dash anywhere; use a comma or a colon instead.',
].join('\n');

const SCORE_SYSTEM_HEAD = [
  'You are the scoring agent for the AI Tooling Monitor, a catalog of AI products for a large enterprise\'s AI transformation team deciding what to buy, build, or watch.',
  'For each product, score the rubric below and give a fit score, the five dimension scores, up to 3 features worth stealing, and a one-sentence reason.',
  'Respect the steering note when present: it is the editor\'s current priorities. Learn the editor\'s taste from the decision history: what they cataloged or pinned (and why) and what they dismissed.',
  'Score only what is stated. When a homepage was unreachable, score conservatively from the name, category, and one-liner alone; that is a normal, expected case, not an error.',
  'Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

function buildSchema(ids: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', enum: ids },
            fit: { type: 'integer', description: '0 to 100, overall buy/watch signal.' },
            relevance: { type: 'integer', description: '1 to 5' },
            enterprise_readiness: { type: 'integer', description: '1 to 5' },
            differentiation: { type: 'integer', description: '1 to 5' },
            momentum: { type: 'integer', description: '1 to 5' },
            build_difficulty: { type: 'integer', description: '1 to 5, 5 = hard to replicate in-house' },
            steal: { type: 'array', items: { type: 'string' }, description: 'Up to 3 features worth copying, empty if none.' },
            reason: { type: 'string', description: 'One sentence, under 300 characters.' },
          },
          required: [
            'id', 'fit', 'relevance', 'enterprise_readiness', 'differentiation', 'momentum',
            'build_difficulty', 'steal', 'reason',
          ],
        },
      },
    },
    required: ['scores'],
  };
}

async function buildSystem(): Promise<string> {
  const [prefs, taste, categories] = await Promise.all([
    getToolingPrefs(),
    getToolingTasteDigest(),
    getToolingCategories(true),
  ]);
  const parts = [SCORE_SYSTEM_HEAD];
  parts.push(`\n\nTHE RUBRIC:\n${(prefs.rubric?.trim() || DEFAULT_RUBRIC).slice(0, 4000)}`);
  if (prefs.steering?.trim()) {
    parts.push(`\n\nSTEERING NOTE from the editor (their current priorities, follow it):\n${prefs.steering.trim().slice(0, 1500)}`);
  }
  parts.push(
    '\n\nACTIVE CATEGORIES:',
    ...categories.filter((c) => c.active).map((c) => `- ${c.slug}: ${c.name}`),
    '\nDECISION HISTORY (the editor\'s revealed taste):',
    'Liked (pinned or cataloged):',
    ...taste.liked.map((t) => `- "${t.name}"${t.note ? ` (why: ${t.note})` : ''}`),
    'Dismissed:',
    ...taste.dismissed.map((n) => `- "${n}"`)
  );
  return parts.join('\n');
}

interface RawScoreRow {
  id: string;
  fit: number;
  relevance: number;
  enterprise_readiness: number;
  differentiation: number;
  momentum: number;
  build_difficulty: number;
  steal: string[];
  reason: string;
}

export interface ToolingScoreChunkResult {
  processed: number;
  cataloged: number;
  parked: number;
}

export async function scoreChunk(ids: string[], runId: string | null): Promise<ToolingScoreChunkResult> {
  const chunk = ids.slice(0, SCORE_CHUNK);
  if (!chunk.length) return { processed: 0, cataloged: 0, parked: 0 };
  const [products, prefs] = await Promise.all([getProductsForScoring(chunk), getToolingPrefs()]);
  if (!products.length) return { processed: 0, cataloged: 0, parked: 0 };

  const user = [
    'PRODUCTS TO SCORE (score every id):',
    ...products.map((p) =>
      [
        `id: ${p.id}`,
        `name: ${p.name}${p.vendor ? ` (${p.vendor})` : ''}`,
        `category: ${p.category}`,
        p.one_liner ? `what it does: ${p.one_liner}` : null,
        p.description ? `description: ${p.description.slice(0, 500)}` : null,
        p.features.length ? `features: ${p.features.join(', ')}` : null,
        p.deployment.length ? `deployment: ${p.deployment.join(', ')}` : null,
        p.pricing_model ? `pricing model: ${p.pricing_model}` : null,
        p.maturity !== 'unknown' ? `maturity: ${p.maturity}` : null,
        p.compliance_claims.length ? `compliance claims: ${p.compliance_claims.join(', ')}` : null,
        p.notable_customers.length ? `notable customers: ${p.notable_customers.join(', ')}` : null,
        p.dossier_summary ? `dossier: ${p.dossier_summary.slice(0, 400)}` : null,
        p.fetch_error ? 'homepage unreachable: score conservatively from the name, category, and one-liner alone' : null,
        !p.url ? 'no homepage identified yet: score conservatively from the name, category, and one-liner alone' : null,
      ].filter(Boolean).join('\n')
    ),
  ].join('\n\n');

  const out = await routedStructured<{ scores: RawScoreRow[] }>({
    model: prefs.utility_model,
    system: await buildSystem(),
    user,
    toolName: 'submit_tooling_scores',
    toolDescription: 'Submit the rubric scores for every product id.',
    schema: buildSchema(products.map((p) => p.id)),
    maxTokens: 3000,
    timeoutMs: 60_000,
    feature: 'tooling_score',
    metadata: { tooling_run: runId },
  });

  const valid = new Set(products.map((p) => p.id));
  const resolved = resolvedModel(prefs.utility_model);
  const rows = (out.scores ?? [])
    .filter((s) => valid.has(s.id))
    .map((s) => ({
      id: s.id,
      fit: clampFit(s.fit) ?? 0,
      scores: {
        relevance: s.relevance,
        enterprise_readiness: s.enterprise_readiness,
        differentiation: s.differentiation,
        momentum: s.momentum,
        build_difficulty: s.build_difficulty,
        steal: (s.steal ?? []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 3),
      },
      reason: String(s.reason ?? '').trim().slice(0, 300),
      model: resolved,
    }));
  if (!rows.length) return { processed: 0, cataloged: 0, parked: 0 };

  await setProductScores(rows, prefs.catalog_threshold);

  const statusRows = await q<{ status: string }>(
    `select status::text as status from tooling_products where id = any($1::uuid[])`,
    [rows.map((r) => r.id)]
  );
  return {
    processed: rows.length,
    cataloged: statusRows.filter((r) => r.status === 'cataloged').length,
    parked: statusRows.filter((r) => r.status === 'parked').length,
  };
}
