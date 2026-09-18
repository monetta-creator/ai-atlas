import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { isNewsHost } from './core';
import type { ToolingCategory, TriagedProduct } from '../types';

// The one-time big pull's enumeration leg: Sonnet + web search names every
// product it can find in a category, two passes (established leaders, then
// recently-launched emerging entrants), no youth screen. Clones the
// lib/scout/web.ts call shape. Returns [] if the tool was never called
// (never throws on a model miss — the engine unit just finds nothing).

const MODEL = 'claude-sonnet-4-6';

interface RawEnumProduct {
  name: string;
  vendor: string;
  product_url: string;
  one_liner: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function enumerateCategory(opts: {
  category: ToolingCategory;
  pass: 'leaders' | 'emerging';
  runId: string;
}): Promise<TriagedProduct[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for tooling enumeration.');
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    {
      name: 'submit_products',
      description: 'Return every distinct product found, with no fit evaluation.',
      input_schema: {
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
                vendor: { type: 'string', description: "The vendor/company name, or '' if unclear." },
                product_url: { type: 'string', description: "The product homepage, or '' if unknown." },
                one_liner: { type: 'string', description: 'One sentence: what the product does.' },
              },
              required: ['name', 'vendor', 'product_url', 'one_liner'],
            },
          },
        },
        required: ['products'],
      },
    },
  ];

  const passInstruction = opts.pass === 'leaders'
    ? 'List the ESTABLISHED products a large enterprise would put on its shortlist for this category today. Incumbents, big-tech offerings, and well-known scaleups all belong here; do NOT screen for youth.'
    : 'List EMERGING products in this category launched or meaningfully funded in roughly the last 18 months. Startups and recent launches belong here.';

  const user = `You are helping catalog the AI tool market in the category "${opts.category.name}"${
    opts.category.description ? ` (${opts.category.description})` : ''
  }.
${passInstruction}
Run web searches to find every distinct product that fits. After searching, you MUST call submit_products with every distinct product found (name, vendor, product_url, one_liner). Use '' for anything unknown. Never use an em dash anywhere.`;

  const params = {
    model: MODEL,
    max_tokens: 4000,
    tools,
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: user }],
  };
  const t0 = Date.now();
  const msg = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0]
  )) as Anthropic.Message;
  await recordApiCall({
    feature: 'tooling_enumerate',
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    metadata: { tooling_run: opts.runId, category: opts.category.slug, pass: opts.pass },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_products'
  );
  if (!tu) return [];
  const out = tu.input as { products?: RawEnumProduct[] };
  return (out.products ?? [])
    .filter((p) => p && typeof p.name === 'string' && p.name.trim().length > 1)
    .map((p) => {
      const rawUrl = String(p.product_url ?? '').trim();
      const validUrl = /^https?:\/\//i.test(rawUrl) && !isNewsHost(hostOf(rawUrl)) ? rawUrl : '';
      return {
        name: p.name.trim().slice(0, 200),
        vendor: p.vendor?.trim() ? p.vendor.trim().slice(0, 200) : null,
        product_url: validUrl || null,
        one_liner: String(p.one_liner ?? '').trim().slice(0, 500),
        category: opts.category.slug,
        found_url: validUrl,
        found_title: p.name.trim().slice(0, 200),
        origin: 'enumeration' as const,
      };
    });
}
