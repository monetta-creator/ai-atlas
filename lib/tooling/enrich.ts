import { routedStructured } from '../model-route';
import { resolvedModel } from '../model-route';
import { parseMaturityHint } from './core';
import { setProductEnrichment, parkProductByAgent } from '../mutations/tooling';
import type { ToolingEnrichmentFacts } from '../mutations/tooling';

// Per-product enrichment: the fetched homepage text (already cached in
// raw_content by the hydrate step) goes through one structured read that
// fills ONLY null facts (a human edit always wins), a normalized feature
// list, and a monotone dossier merge. Mirrors lib/scout/enrich.ts's
// homepage-read shape. A product the read judges is not actually an AI tool
// parks itself immediately (parkProductByAgent) instead of entering scoring.

const TEXT_CLIP = 14_000;
const DESC_CLIP = 600;
const SUMMARY_CLIP = 400;

const TARGET_BUYERS = [
  'engineering', 'data', 'operations', 'compliance', 'risk', 'contact_center',
  'sales', 'marketing', 'legal', 'hr', 'finance', 'strategy', 'everyone',
] as const;
const DEPLOYMENTS = ['saas', 'vpc', 'on_prem', 'api', 'open_source', 'desktop'] as const;
const PRICING_MODELS = ['free', 'freemium', 'per_seat', 'usage', 'enterprise', 'unknown'] as const;
const COMPLIANCE_CLAIMS = [
  'soc2', 'iso27001', 'hipaa', 'gdpr', 'fedramp', 'pci', 'data_residency',
  'no_training_on_customer_data', 'sso', 'audit_logs',
] as const;

// Some open-weight models copy display brackets into enum values (the intel
// enrich lesson, lib/intel/enrich.ts).
const deBracket = (v: unknown): string => String(v ?? '').trim().replace(/^\[/, '').replace(/\]$/, '');

const ENRICH_SYSTEM = [
  'You are the homepage reader for the AI Tooling Monitor, a market-scan engine cataloging AI products for the AI-transformation team of a large, regulated financial-services enterprise deciding what to buy, build, or watch.',
  'You are given a product\'s homepage text (marketing copy: read it skeptically) and its believed category. Extract only what the text supports; use an empty string, empty array, or 0 for anything the page does not state. Never invent customers, pricing, or capabilities.',
  'is_ai_tool should be false when the page shows this is not actually an AI product (a generic SaaS tool with no AI, a company blog, a dead or parked domain).',
  'Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

function enrichSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      one_liner: { type: 'string', description: "One sentence: what the product does. '' if unclear." },
      description: { type: 'string', description: 'A neutral 2-4 sentence description of the product, under 600 characters.' },
      vendor: { type: 'string', description: "The company behind the product, or '' if unclear." },
      target_buyer: {
        type: 'array',
        items: { type: 'string', enum: [...TARGET_BUYERS] },
        description: 'Who inside a large enterprise would buy or champion this, from the list only.',
      },
      deployment: {
        type: 'array',
        items: { type: 'string', enum: [...DEPLOYMENTS] },
        description: 'How the product is deployed, from the list only.',
      },
      pricing_model: { type: 'string', enum: [...PRICING_MODELS] },
      pricing_note: { type: 'string', description: "A short pricing detail if stated, e.g. '$20 per seat per month'. '' if unstated." },
      maturity_hint: {
        type: 'string',
        description: "Free text describing the vendor's maturity, e.g. 'seed startup', 'series b', 'public company', 'big tech', 'open source project'. '' if unclear.",
      },
      founded_year: { type: 'integer', description: 'Founding year if stated, else 0.' },
      hq: { type: 'string', description: "Headquarters city or region if stated, else ''." },
      notable_customers: { type: 'array', items: { type: 'string' }, description: 'Named customers or case studies, if any.' },
      integrations: { type: 'array', items: { type: 'string' }, description: 'Named third-party integrations, if any.' },
      compliance_claims: {
        type: 'array',
        items: { type: 'string', enum: [...COMPLIANCE_CLAIMS] },
        description: 'Compliance or security claims the page actually states, from the list only.',
      },
      models_used: { type: 'array', items: { type: 'string' }, description: 'Named underlying AI models or providers, if stated.' },
      features: { type: 'array', items: { type: 'string' }, description: 'Up to 15 short feature tags (2-4 words each): the concrete things the product does.' },
      changelog_url: { type: 'string', description: "The changelog or release-notes URL if linked, else ''." },
      summary: { type: 'string', description: 'A skeptical 3-5 sentence dossier summary of the page, under 400 characters.' },
      is_ai_tool: { type: 'boolean' },
    },
    required: [
      'one_liner', 'description', 'vendor', 'target_buyer', 'deployment', 'pricing_model', 'pricing_note',
      'maturity_hint', 'founded_year', 'hq', 'notable_customers', 'integrations', 'compliance_claims',
      'models_used', 'features', 'changelog_url', 'summary', 'is_ai_tool',
    ],
  };
}

interface RawEnrichOut {
  one_liner: string;
  description: string;
  vendor: string;
  target_buyer: string[];
  deployment: string[];
  pricing_model: string;
  pricing_note: string;
  maturity_hint: string;
  founded_year: number;
  hq: string;
  notable_customers: string[];
  integrations: string[];
  compliance_claims: string[];
  models_used: string[];
  features: string[];
  changelog_url: string;
  summary: string;
  is_ai_tool: boolean;
}

const trimArr = (a: string[] | undefined): string[] =>
  (a ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);

export async function enrichProduct(
  product: { id: string; name: string; category: string; raw_content: string },
  categories: { slug: string; name: string }[],
  model: string | null,
  runId: string | null
): Promise<{ isAiTool: boolean }> {
  const categoryName = categories.find((c) => c.slug === product.category)?.name ?? product.category;
  const user = `PRODUCT: ${product.name}\nBELIEVED CATEGORY: ${categoryName}\n\nHOMEPAGE TEXT:\n${product.raw_content.slice(0, TEXT_CLIP)}`;

  const out = await routedStructured<RawEnrichOut>({
    model,
    system: ENRICH_SYSTEM,
    user,
    toolName: 'submit_tooling_enrichment',
    toolDescription: 'Submit the extracted product facts and dossier.',
    schema: enrichSchema(),
    maxTokens: 1800,
    timeoutMs: 60_000,
    feature: 'tooling_enrich',
    metadata: { tooling_run: runId },
  });

  if (!out.is_ai_tool) {
    await parkProductByAgent(product.id, 'Enrichment read: not an AI product');
    return { isAiTool: false };
  }

  const targetBuyers = new Set<string>(TARGET_BUYERS);
  const deployments = new Set<string>(DEPLOYMENTS);
  const pricingModels = new Set<string>(PRICING_MODELS);
  const complianceSet = new Set<string>(COMPLIANCE_CLAIMS);

  const pricingModel = deBracket(out.pricing_model);
  const customers = trimArr(out.notable_customers);
  const integrations = trimArr(out.integrations);

  const facts: ToolingEnrichmentFacts = {
    one_liner: out.one_liner?.trim() || null,
    description: out.description?.trim().slice(0, DESC_CLIP) || null,
    vendor: out.vendor?.trim() || null,
    target_buyer: (out.target_buyer ?? []).map(deBracket).filter((v) => targetBuyers.has(v)),
    deployment: (out.deployment ?? []).map(deBracket).filter((v) => deployments.has(v)),
    pricing_model: pricingModels.has(pricingModel) ? pricingModel : null,
    pricing_note: out.pricing_note?.trim() || null,
    maturity: parseMaturityHint(out.maturity_hint ?? ''),
    founded_year: out.founded_year >= 1980 && out.founded_year <= 2100 ? out.founded_year : null,
    hq: out.hq?.trim() || null,
    notable_customers: customers,
    integrations,
    compliance_claims: (out.compliance_claims ?? []).map(deBracket).filter((v) => complianceSet.has(v)),
    models_used: trimArr(out.models_used),
    changelog_url: /^https?:\/\//i.test(String(out.changelog_url ?? '').trim()) ? out.changelog_url.trim() : null,
  };

  const features = trimArr(out.features).slice(0, 15);
  const resolved = resolvedModel(model);

  await setProductEnrichment(
    product.id,
    facts,
    features,
    {
      summary: out.summary?.trim().slice(0, SUMMARY_CLIP) || null,
      customers,
      integrations,
      sources: [],
    },
    resolved
  );
  return { isAiTool: true };
}
