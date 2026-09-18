import { routedStructured } from '../model-route';
import { isNewsHost } from './core';
import type { RawHit, TriagedProduct } from '../types';

// Discovery triage: from a batch of raw search/HN/GitHub/Product Hunt hits,
// extract distinct, actually-named AI products. Shared by every discover unit
// (lib/tooling/engine.ts): cat:<slug> hands it a category-scoped hit batch,
// ph hands it an unscoped one. The utility model (or Haiku, via
// routedStructured) does the extraction; this module owns the schema, the
// hit-provenance resolution (found_url/found_title/origin come from the ONE
// hit a candidate was matched back to, never from the model), and the
// product_url news-host guard.

const MAX_HITS = 60;

const TRIAGE_SYSTEM = [
  'You triage discovery hits for the AI Tooling Monitor, a market-scan engine that catalogs AI products for the AI-transformation team of a large, regulated financial-services enterprise.',
  'You are given a batch of search hits (an id, a source, a title, a URL, and a snippet); most are news, blog posts, or noise, not products. Extract only DISTINCT AI products actually named in the hits: skip roundup articles, generic commentary, and anything that is not a specific, nameable AI product or platform.',
  'For every product found, give: name; vendor (the company behind it, empty string if unclear); product_url (the product\'s OWN homepage if identifiable from the hit, empty string otherwise, never a news article or aggregator URL); one_liner (one sentence, what it does); category (the single best-fit category from the provided list); is_ai_tool (false for anything that is not actually an AI product, e.g. a hiring announcement or a funding roundup with no named product); confidence (0 to 100, how sure you are this is a real, distinct product); and hit_id (the id of the ONE hit this product was found in).',
  'Never invent a product that is not actually named in the hits. Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

function buildSchema(categorySlugs: string[], hitIds: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      products: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            vendor: { type: 'string', description: "The company behind the product, or '' if unclear." },
            product_url: { type: 'string', description: "The product's own homepage, or '' if not identifiable." },
            one_liner: { type: 'string' },
            category: { type: 'string', enum: categorySlugs },
            is_ai_tool: { type: 'boolean' },
            confidence: { type: 'integer', description: '0 to 100, how sure this is a real distinct AI product.' },
            hit_id: { type: 'string', enum: hitIds, description: 'The id of the hit this product was found in.' },
          },
          required: ['name', 'vendor', 'product_url', 'one_liner', 'category', 'is_ai_tool', 'confidence', 'hit_id'],
        },
      },
    },
    required: ['products'],
  };
}

interface RawTriaged {
  name: string;
  vendor: string;
  product_url: string;
  one_liner: string;
  category: string;
  is_ai_tool: boolean;
  confidence: number;
  hit_id: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function triageHits(opts: {
  hits: RawHit[];
  categories: { slug: string; name: string }[];
  model: string | null;
  runId: string;
  categoryHint?: string | null;
}): Promise<TriagedProduct[]> {
  const hits = opts.hits.slice(0, MAX_HITS);
  if (!hits.length || !opts.categories.length) return [];
  const hitIds = hits.map((_, i) => String(i));
  const categorySlugs = opts.categories.map((c) => c.slug);

  const user = [
    `ACTIVE CATEGORIES:\n${opts.categories.map((c) => `- ${c.slug}: ${c.name}`).join('\n')}`,
    opts.categoryHint
      ? `These hits came from a search targeting the "${opts.categoryHint}" category: default to it unless a product is clearly a better fit elsewhere.`
      : null,
    `HITS:\n${hits
      .map((h, i) => `[${i}] (${h.source}) ${h.title}\nURL: ${h.url}${h.snippet ? `\nSnippet: ${h.snippet}` : ''}`)
      .join('\n\n')}`,
  ].filter(Boolean).join('\n\n');

  const out = await routedStructured<{ products: RawTriaged[] }>({
    model: opts.model,
    system: TRIAGE_SYSTEM,
    user,
    toolName: 'submit_triage',
    toolDescription: 'Submit every distinct AI product extracted from the hits.',
    schema: buildSchema(categorySlugs, hitIds),
    maxTokens: 4000,
    timeoutMs: 60_000,
    feature: 'tooling_triage',
    metadata: { tooling_run: opts.runId, category: opts.categoryHint ?? null },
  });

  const validCategories = new Set(categorySlugs);
  const fallbackCategory =
    opts.categoryHint && validCategories.has(opts.categoryHint) ? opts.categoryHint : categorySlugs[0];
  const out2: TriagedProduct[] = [];
  for (const p of out.products ?? []) {
    if (!p || !p.is_ai_tool) continue;
    const name = String(p.name ?? '').trim();
    if (!name) continue;
    const hitIdx = Number(p.hit_id);
    const hit = Number.isInteger(hitIdx) ? hits[hitIdx] : undefined;
    if (!hit) continue;

    let productUrl: string | null = String(p.product_url ?? '').trim();
    if (productUrl && /^https?:\/\//i.test(productUrl)) {
      const host = hostOf(productUrl);
      if (!host || isNewsHost(host)) productUrl = null;
    } else {
      productUrl = null;
    }

    out2.push({
      name: name.slice(0, 200),
      vendor: p.vendor?.trim() ? p.vendor.trim().slice(0, 200) : null,
      product_url: productUrl,
      one_liner: String(p.one_liner ?? '').trim().slice(0, 500),
      category: validCategories.has(p.category) ? p.category : fallbackCategory,
      found_url: hit.url,
      found_title: hit.title,
      origin: hit.source,
    });
  }
  return out2;
}
