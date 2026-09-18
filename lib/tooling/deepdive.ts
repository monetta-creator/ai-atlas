import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { one } from '../db';
import { parseEventKindHint } from './core';
import { setProductDeepDive, insertProductEvents, mergeProductDossier } from '../mutations/tooling';
import type { ToolingDeepDive, ToolingEventKind } from '../types';

// The on-demand (portal button) and automatic (high-fit entrant) deep dive:
// a steered, web-researched competitive read of one product. Clones
// lib/scout/intel.ts's call shape. Never throws: every failure mode (missing
// key, unknown product, a dead call, a tool never used) returns {ok:false}
// so both the engine's deepdive step and the admin/portal actions can report
// it without a try/catch of their own.

const MODEL = 'claude-sonnet-4-6';
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const MAX_NEWS = 8;

interface DeepDiveOut {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  pricing_detail: string;
  compliance: string[];
  customers: string[];
  competitors: string[];
  recent_news: { title: string; url: string; date: string }[];
  sources: string[];
}

const trimArr = (a: string[] | undefined, cap: number): string[] =>
  (a ?? []).map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, cap);

export async function runDeepDive(
  productId: string,
  steering: string | null,
  feature: 'tooling_deepdive' | 'portal_tooling',
  opts: { runId?: string | null; timeoutMs?: number } = {}
): Promise<{ ok: true; eventsAdded: number } | { ok: false; error: string }> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY is required for the deep dive.' };

    const product = await one<{
      id: string; name: string; vendor: string | null; category: string; url: string | null; one_liner: string | null;
    }>(
      `select id::text as id, name, vendor, category, url, one_liner from tooling_products where id = $1`,
      [productId]
    );
    if (!product) return { ok: false, error: 'Unknown product.' };

    const known = [
      product.vendor ? `vendor: ${product.vendor}` : null,
      product.one_liner ? `what it does: ${product.one_liner}` : null,
      product.url ? `homepage: ${product.url}` : null,
    ].filter(Boolean);

    const tools = [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
      {
        name: 'submit_deep_dive',
        description: 'Submit the completed deep dive, with no invention.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', description: 'A skeptical 3-5 sentence competitive read of the product.' },
            strengths: { type: 'array', items: { type: 'string' } },
            weaknesses: { type: 'array', items: { type: 'string' } },
            pricing_detail: { type: 'string', description: "Concrete pricing if found, else ''." },
            compliance: { type: 'array', items: { type: 'string' }, description: 'Compliance or security claims found (SOC2, HIPAA, etc), if any.' },
            customers: { type: 'array', items: { type: 'string' }, description: 'Named customers or case studies, if any.' },
            competitors: { type: 'array', items: { type: 'string' }, description: 'The products most often compared to this one.' },
            recent_news: {
              type: 'array',
              description: `Up to ${MAX_NEWS} dated developments (launches, funding, partnerships, notable coverage), each with a source URL.`,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                  date: { type: 'string', description: "YYYY-MM-DD; use the first of the month when only a month is known, '' if unknown." },
                },
                required: ['title', 'url', 'date'],
              },
            },
            sources: { type: 'array', items: { type: 'string' }, description: 'URLs of the pages consulted.' },
          },
          required: ['summary', 'strengths', 'weaknesses', 'pricing_detail', 'compliance', 'customers', 'competitors', 'recent_news', 'sources'],
        },
      },
    ];

    const user = `Research the AI product "${product.name}"${product.vendor ? ` by ${product.vendor}` : ''}, in the "${product.category}" category, for a large enterprise's AI transformation team deciding whether to buy, build, or watch this space.
${known.length ? `\nALREADY KNOWN (do not contradict; fill gaps):\n${known.join('\n')}\n` : ''}${
      steering ? `\nEDITOR'S STEERING FOR THIS PASS (their current priorities, follow it):\n${steering.slice(0, 1500)}\n` : ''
    }
Run web searches for its strengths and weaknesses, pricing, compliance and security posture, named customers, its closest competitors, and recent news. Read skeptically: marketing copy overstates; report only what sources state, and never invent customers, figures, or claims. Then you MUST call submit_deep_dive with everything learned, '' or an empty array for anything unlearned, at most ${MAX_NEWS} dated news items each carrying its source URL. Never use an em dash anywhere.`;

    const client = new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 50_000, maxRetries: 0 });
    const params = {
      model: MODEL,
      max_tokens: 3000,
      tools,
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: user }],
    };
    const t0 = Date.now();
    const msg = (await client.messages.create(
      params as unknown as Parameters<typeof client.messages.create>[0]
    )) as Anthropic.Message;
    await recordApiCall({
      feature,
      model: MODEL,
      usage: msg.usage,
      wallMs: Date.now() - t0,
      metadata: { tooling_run: opts.runId ?? null, product_id: productId, tool: 'deepdive' },
    });

    const tu = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_deep_dive'
    );
    if (!tu) return { ok: false, error: 'The deep dive returned nothing usable. Try again.' };
    const out = tu.input as DeepDiveOut;

    const deepDive: ToolingDeepDive = {
      summary: String(out.summary ?? '').trim().slice(0, 2000),
      strengths: trimArr(out.strengths, 12),
      weaknesses: trimArr(out.weaknesses, 12),
      pricing_detail: out.pricing_detail?.trim() || null,
      compliance: trimArr(out.compliance, 12),
      customers: trimArr(out.customers, 12),
      competitors: trimArr(out.competitors, 12),
      recent_news: (out.recent_news ?? [])
        .slice(0, MAX_NEWS)
        .map((n) => ({
          title: String(n.title ?? '').trim().slice(0, 300),
          url: String(n.url ?? '').trim().slice(0, 2000),
          date: DATE_RE.test(String(n.date ?? '')) ? String(n.date).slice(0, 10) : null,
        }))
        .filter((n) => n.title && /^https?:\/\//i.test(n.url)),
      sources: trimArr(out.sources, 20).filter((s) => /^https?:\/\//i.test(s)),
      researched_at: new Date().toISOString(),
    };

    await setProductDeepDive(productId, deepDive);

    const events = deepDive.recent_news.map((n) => ({
      kind: parseEventKindHint(n.title) as ToolingEventKind,
      title: n.title,
      url: n.url,
      date: n.date,
      note: 'Logged by the deep dive.',
    }));
    const { added } = await insertProductEvents(productId, events, 'deepdive');

    await mergeProductDossier(productId, {
      summary: deepDive.summary || null,
      customers: deepDive.customers,
      integrations: [],
      sources: deepDive.sources,
      updated_by: 'deepdive',
    });

    return { ok: true, eventsAdded: added };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? 'deep dive failed') };
  }
}
