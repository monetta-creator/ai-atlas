import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { one, q } from '../db';
import * as m from '../mutations';
import { parseStageHint, parseFoundedHint, parseEventKindHint, eventExists } from './core';
import type { CompanyStage } from '../types';

// The web intel sweep: a steered, per-company web-research pass (funding,
// product, team, traction, news). Clones the discovery call shape
// (lib/scout/web.ts): web_search server tool + a submit_company_intel client
// tool, Sonnet, 50s timeout with SDK retries off. Writes are direct but
// bounded: facts fill only null columns, the dossier merges monotonically, and
// events dedupe against the existing timeline. The steering instruction is a
// one-off argument, never persisted.

const MODEL = 'claude-sonnet-4-6';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EVENTS = 6;

interface IntelOut {
  one_liner: string;
  ai_tech: string;
  founded_year: number;
  stage_hint: string;
  funding_note: string;
  hq: string;
  summary: string;
  products: string[];
  customers: string[];
  events: { date: string; kind_hint: string; title: string; url: string }[];
  sources: string[];
}

export async function runIntelSweep(
  companyId: string,
  steering: string | null,
  feature: string   // 'scout_intel' (admin) | 'portal_scout' (keyholder)
): Promise<{ filled: string[]; eventsAdded: number; eventsSkipped: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the intel sweep.');

  const company = await one<{
    id: string; name: string; domain: string | null; vertical: string;
    one_liner: string | null; ai_tech: string | null; founded_year: number | null;
    stage: CompanyStage; funding_note: string | null; hq: string | null;
  }>(
    `select id::text as id, name, domain, vertical, one_liner, ai_tech,
            founded_year, stage, funding_note, hq
       from companies where id = $1`,
    [companyId]
  );
  if (!company) throw new Error('Unknown company.');

  const known = [
    company.one_liner ? `what they do: ${company.one_liner}` : null,
    company.ai_tech ? `AI tech: ${company.ai_tech.slice(0, 400)}` : null,
    company.stage !== 'unknown' ? `stage: ${company.stage}` : null,
    company.founded_year ? `founded: ${company.founded_year}` : null,
    company.funding_note ? `funding: ${company.funding_note}` : null,
    company.hq ? `hq: ${company.hq}` : null,
  ].filter(Boolean);

  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
    {
      name: 'submit_company_intel',
      description: 'Submit everything learned about the company, with no invention.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          one_liner: { type: 'string', description: "One sentence: what the company builds. '' if unlearned." },
          ai_tech: { type: 'string', description: "The AI technology itself, 1-3 concrete sentences. '' if unlearned." },
          founded_year: { type: 'integer', description: 'Founding year if reported, else 0.' },
          stage_hint: { type: 'string', description: "Funding stage if reported: 'pre-seed', 'seed', 'series a', 'series b', 'later', or ''." },
          funding_note: { type: 'string', description: "Latest round if reported, e.g. 'Series A, $24M, 2026, Index'. '' if unlearned." },
          hq: { type: 'string', description: "Headquarters city/region if reported, else ''." },
          summary: { type: 'string', description: 'A 3-5 sentence skeptical dossier update: what is verifiable about the company now.' },
          products: { type: 'array', items: { type: 'string' }, description: 'Named products, if any.' },
          customers: { type: 'array', items: { type: 'string' }, description: 'Named customers or design partners, if any.' },
          events: {
            type: 'array',
            description: 'At most 6 dated developments (funding rounds, launches, notable news), each with its source URL.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                date: { type: 'string', description: "YYYY-MM-DD; use the first of the month when only a month is known." },
                kind_hint: { type: 'string', description: "'funding', 'launch', 'milestone', or 'news'." },
                title: { type: 'string', description: 'One line describing the development.' },
                url: { type: 'string', description: 'The source URL for this development.' },
              },
              required: ['date', 'kind_hint', 'title', 'url'],
            },
          },
          sources: { type: 'array', items: { type: 'string' }, description: 'URLs of the pages consulted.' },
        },
        required: ['one_liner', 'ai_tech', 'founded_year', 'stage_hint', 'funding_note', 'hq', 'summary', 'products', 'customers', 'events', 'sources'],
      },
    },
  ];

  const user = `Research the company "${company.name}"${company.domain ? ` (${company.domain})` : ''}, an acquisition candidate in the "${company.vertical}" vertical.
${known.length ? `\nALREADY KNOWN (do not contradict; fill gaps):\n${known.join('\n')}\n` : ''}${
    steering ? `\nEDITOR'S STEERING FOR THIS PASS (their current priorities, follow it):\n${steering}\n` : ''
  }
Run web searches for its funding history, product and technology, team, traction, and recent news. Read skeptically: marketing copy overstates; report only what sources state, and never invent customers, figures, or rounds. Then you MUST call submit_company_intel with everything learned, '' or 0 for anything unlearned, at most ${MAX_EVENTS} dated events each carrying its source URL. Never use an em dash anywhere.`;

  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });
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
    metadata: { company_id: companyId, tool: 'intel' },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_company_intel'
  );
  if (!tu) throw new Error('The sweep returned nothing usable. Try again.');
  const out = tu.input as IntelOut;

  const filled = await m.fillCompanyFacts(companyId, {
    one_liner: out.one_liner?.trim() || null,
    ai_tech: out.ai_tech?.trim() || null,
    founded_year: parseFoundedHint(String(out.founded_year ?? '')),
    stage: parseStageHint(out.stage_hint ?? ''),
    funding_note: out.funding_note?.trim().slice(0, 200) || null,
    hq: out.hq?.trim().slice(0, 120) || null,
  });
  await m.mergeCompanyDossier(companyId, {
    summary: out.summary?.trim() || null,
    products: (out.products ?? []).map((p) => String(p)),
    customers: (out.customers ?? []).map((c) => String(c)),
    sources: (out.sources ?? []).filter((s) => /^https?:\/\//i.test(String(s))),
    updated_by: 'intel',
  });

  const existing = await q<{ title: string; url: string | null }>(
    `select title, url from company_events where company_id = $1`,
    [companyId]
  );
  let eventsAdded = 0;
  let eventsSkipped = 0;
  for (const ev of (out.events ?? []).slice(0, MAX_EVENTS)) {
    const title = String(ev.title ?? '').trim();
    const url = String(ev.url ?? '').trim();
    if (!title || !DATE_RE.test(String(ev.date ?? '')) || !/^https?:\/\//i.test(url)) {
      eventsSkipped += 1;
      continue;
    }
    if (eventExists(existing, { title, url })) {
      eventsSkipped += 1;
      continue;
    }
    await m.createCompanyEvent({
      company_id: companyId,
      event_date: ev.date,
      kind: parseEventKindHint(ev.kind_hint ?? ''),
      title,
      url,
      // Event notes render publicly on tracked profiles: neutral wording only.
      note: 'Logged by the web intel sweep.',
    });
    existing.push({ title, url });
    eventsAdded += 1;
  }
  return { filled, eventsAdded, eventsSkipped };
}
