import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { one } from '../db';
import * as m from '../mutations';
import type { RawCompany } from './web';

// The competitor scan (admin-only): find young companies building SIMILAR
// technology to a tracked target and queue them in the same vertical. Clones
// the discovery call shape; inserts reuse insertCompanies (global dedupe by
// domain/name, dismissed companies never re-queued, origin 'discovery').
// Provenance is a note event on the SOURCE company naming what was queued.

const MODEL = 'claude-sonnet-4-6';

export async function scanCompetitors(
  companyId: string,
  steering: string | null
): Promise<{ found: number; inserted: number; names: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the competitor scan.');

  const company = await one<{
    name: string; domain: string | null; vertical: string;
    one_liner: string | null; ai_tech: string | null;
  }>(
    `select name, domain, vertical, one_liner, ai_tech from companies where id = $1`,
    [companyId]
  );
  if (!company) throw new Error('Unknown company.');

  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
    {
      name: 'submit_competitors',
      description: 'Return every distinct young company found building similar technology, with no fit evaluation.',
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
                one_liner: { type: 'string', description: 'One sentence: what the company builds, and how it resembles the target.' },
                stage_hint: { type: 'string', description: "Funding stage if reported: 'pre-seed', 'seed', 'series a', 'series b', 'later', or ''." },
                founded_hint: { type: 'string', description: "Founding year as text if reported, else ''." },
                funding_note: { type: 'string', description: "Latest round if reported, else ''." },
                found_url: { type: 'string', description: 'The article or page URL the company was seen in.' },
              },
              required: ['name', 'url', 'one_liner', 'stage_hint', 'founded_hint', 'funding_note', 'found_url'],
            },
          },
        },
        required: ['companies'],
      },
    },
  ];

  const user = `Find young companies building technology SIMILAR to "${company.name}"${company.domain ? ` (${company.domain})` : ''}.
What the target builds: ${company.one_liner ?? 'unknown'}${company.ai_tech ? `\nIts AI tech: ${company.ai_tech.slice(0, 400)}` : ''}
${steering ? `\nEDITOR'S STEERING FOR THIS PASS (their current priorities, follow it):\n${steering}\n` : ''}
The screen is YOUTH and SIMILARITY: startups founded within roughly the last 6 years, pre-seed through Series B, building comparable AI technology or competing for the same buyers. EXCLUDE "${company.name}" itself, public companies, large incumbents, venture funds, and roundups of already-famous names. Beyond that screen do NOT judge acquisition fit: a later step scores every company. After searching, you MUST call submit_competitors with every distinct company found. Use '' for anything unknown. Never use an em dash anywhere.`;

  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });
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
    feature: 'scout_competitors',
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    metadata: { company_id: companyId, tool: 'competitors' },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_competitors'
  );
  const raw = ((tu?.input as { companies?: RawCompany[] })?.companies ?? [])
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

  const res = await m.insertCompanies(null, company.vertical, raw);
  const names = raw.map((c) => c.name);
  if (raw.length) {
    await m.createCompanyEvent({
      company_id: companyId,
      event_date: new Date().toISOString().slice(0, 10),
      kind: 'note',
      title: `Competitor scan: ${res.inserted} queued for review`,
      note: `Found: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', and more' : ''}. ${res.found - res.inserted} already known.`,
    });
  }
  return { found: res.found, inserted: res.inserted, names };
}
