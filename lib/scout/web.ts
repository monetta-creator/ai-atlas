import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';

// Scout discovery: the app's second web-enabled path, cloning the discovery
// pipeline's call shape (lib/pipeline/web.ts searchCandidates): one
// messages.create with the GA web_search server tool plus a submit_companies
// client tool, bounded at 50s with SDK retries OFF so a slow call throws
// cleanly under the 60s cap and the console retries the whole batch.

const MODEL = 'claude-sonnet-4-6';

export interface RawCompany {
  name: string;
  url: string;          // homepage if identifiable, '' otherwise
  one_liner: string;
  stage_hint: string;   // 'seed', 'series a', ... or ''
  founded_hint: string; // year as text, or ''
  funding_note: string;
  found_url: string;    // the article the company was seen in
}

// One vertical's query batch: search the web for young AI companies and return
// every distinct company found, unfiltered beyond the youth screen (the scoring
// agent is the judge). Returns [] if the model answers without calling the tool.
export async function searchCompanies(opts: {
  verticalName: string;
  verticalDescription?: string | null;
  queries: string[];
  maxUses?: number;
  scoutRunId?: string;   // provenance for the cost log metadata
  blockedDomains?: string[];
}): Promise<RawCompany[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for scout discovery.');
  if (!opts.queries.length) return [];
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: opts.maxUses ?? 2,
      ...(opts.blockedDomains?.length ? { blocked_domains: opts.blockedDomains } : {}),
    },
    {
      name: 'submit_companies',
      description: 'Return every distinct young AI company found, with no fit evaluation.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          companies: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                url: { type: 'string', description: 'The company homepage if identifiable, else an empty string.' },
                one_liner: { type: 'string', description: 'One sentence: what the company builds.' },
                stage_hint: { type: 'string', description: "Funding stage if reported: 'pre-seed', 'seed', 'series a', 'series b', 'later', or ''." },
                founded_hint: { type: 'string', description: "Founding year as text if reported, else ''." },
                funding_note: { type: 'string', description: "Latest round if reported, e.g. 'Seed, $8M, 2026, a16z', else ''." },
                found_url: { type: 'string', description: 'The article URL the company was seen in.' },
              },
              required: ['name', 'url', 'one_liner', 'stage_hint', 'founded_hint', 'funding_note', 'found_url'],
            },
          },
        },
        required: ['companies'],
      },
    },
  ];

  const user = `Scout young companies building AI products in the "${opts.verticalName}" vertical${
    opts.verticalDescription ? ` (${opts.verticalDescription})` : ''
  }.
Run these web searches (one at a time):
${opts.queries.map((q) => `- ${q}`).join('\n')}

The screen is YOUTH, not quality: startups founded within roughly the last 6 years, pre-seed through Series B. EXCLUDE public companies, large incumbents, venture funds, accelerators, and roundups of already-famous names. Beyond that screen do NOT judge acquisition fit or quality: a later step scores every company. After searching, you MUST call submit_companies with every distinct company found. Use '' for anything unknown. Never use an em dash anywhere.`;

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
    feature: 'scout_discovery',
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    metadata: { vertical: opts.verticalName, scout_run: opts.scoutRunId ?? null },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_companies'
  );
  if (!tu) return [];
  const out = tu.input as { companies?: RawCompany[] };
  return (out.companies ?? [])
    .filter((c) => c && typeof c.name === 'string' && c.name.trim().length > 1)
    .map((c) => ({
      name: c.name.trim().slice(0, 200),
      url: /^https?:\/\//i.test(String(c.url ?? '').trim()) ? String(c.url).trim() : '',
      one_liner: String(c.one_liner ?? '').trim().slice(0, 300),
      stage_hint: String(c.stage_hint ?? '').trim(),
      founded_hint: String(c.founded_hint ?? '').trim(),
      funding_note: String(c.funding_note ?? '').trim().slice(0, 200),
      found_url: /^https?:\/\//i.test(String(c.found_url ?? '').trim()) ? String(c.found_url).trim() : '',
    }));
}
