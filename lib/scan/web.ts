import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { domainOf } from '../pipeline/web';

// The scan's web-search discovery leg: the app's third web-enabled path,
// cloning the scout call shape (lib/scout/web.ts searchCompanies): one
// messages.create with the GA web_search server tool plus a submit_items
// client tool, bounded at 50s with SDK retries OFF so a slow call throws
// cleanly and the step engine retries on a later invocation.
//
// Cost-log discipline: NEVER pass pipelineRunId here — ai_cost_log's FK points
// at pipeline_runs, and recordApiCall swallows the violation silently, which
// would blind checkScanBudget. Provenance rides in metadata.scan_run instead.

const MODEL = 'claude-sonnet-4-6';

export interface RawScanItem {
  url: string;
  headline: string;
  source_domain: string;
  published_date: string; // as returned by the model; may be '' or imprecise
}

// One topic's search call: find news items for the topic, unfiltered beyond
// plausibility (the downstream tool triages). Returns [] if the model answers
// without calling the tool.
export async function searchTopicNews(opts: {
  topicName: string;
  topicDescription?: string | null;
  queries: string[]; // already date-token-resolved
  sinceISO: string;
  maxUses?: number;
  scanRunId?: string; // provenance for the cost log metadata
  blockedDomains?: string[];
}): Promise<RawScanItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for scan discovery.');
  if (!opts.queries.length) return [];
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: opts.maxUses ?? 1,
      ...(opts.blockedDomains?.length ? { blocked_domains: opts.blockedDomains } : {}),
    },
    {
      name: 'submit_items',
      description: 'Return every distinct news item found, with no significance evaluation.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string' },
                headline: { type: 'string' },
                source_domain: { type: 'string' },
                published_date: { type: 'string', description: "YYYY-MM-DD if known, else ''." },
              },
              required: ['url', 'headline', 'source_domain', 'published_date'],
            },
          },
        },
        required: ['items'],
      },
    },
  ];

  const user = `Find news items about "${opts.topicName}"${
    opts.topicDescription ? ` (${opts.topicDescription})` : ''
  } published since ${opts.sinceISO}.
Run these web searches (one at a time):
${opts.queries.map((q) => `- ${q}`).join('\n')}

CRITICAL: Do NOT evaluate significance or quality. Do NOT summarize. Prefer primary sources, official announcements, and serious reporting over aggregators and listicles, but when unsure, INCLUDE it: a downstream step triages everything. After searching, you MUST call submit_items with every item found (url, headline, source_domain, published_date; use '' for an unknown date). Never use an em dash anywhere.`;

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
    feature: 'scan_search',
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    metadata: { topic: opts.topicName, scan_run: opts.scanRunId ?? null },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_items'
  );
  if (!tu) return [];
  const out = tu.input as { items?: RawScanItem[] };
  return (out.items ?? [])
    .filter((c) => c && typeof c.url === 'string' && /^https?:\/\//i.test(c.url))
    .map((c) => ({
      url: c.url.trim(),
      headline: String(c.headline ?? '').trim().slice(0, 500),
      source_domain: String(c.source_domain ?? '').trim() || domainOf(c.url),
      published_date: String(c.published_date ?? '').trim(),
    }));
}
