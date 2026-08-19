import { runStructured } from '../dossier';
import { fetchCandidateText } from '../pipeline/web';
import * as m from '../mutations';
import { one } from '../db';
import type { CompanyStage } from '../types';

// Per-company enrichment: fetch the homepage (direct + Jina fallback, SSRF
// guarded, cached in raw_content) and run one structured read that fills ONLY
// null description columns (the human's edits always win) plus a dossier jsonb
// with the full read. One action, well inside the 60s page cap.

const TEXT_CLIP = 14_000;

const ENRICH_SYSTEM = [
  'You are the company-dossier reader for Startup Scout, an acquisition-target tracker.',
  'You are given the text of a company homepage (marketing copy: read it skeptically) plus any facts already known.',
  'Extract only what the text supports; use null or an empty string for anything the page does not state. Do not invent customers, funding, or capabilities.',
  'ai_tech should describe the actual AI technology (models, data, approach) as concretely as the page allows, not the marketing framing.',
  'Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    one_liner: { type: 'string', description: 'One sentence: what the company builds. Empty if unclear.' },
    ai_tech: { type: 'string', description: 'The AI technology itself, 1-3 sentences. Empty if unclear.' },
    founded_year: { type: 'integer', description: 'Founding year if stated, else 0.' },
    stage: { type: 'string', enum: ['pre_seed', 'seed', 'series_a', 'series_b', 'later', 'unknown'] },
    funding_note: { type: 'string', description: "Latest round if stated, e.g. 'Seed, $8M, 2026, a16z'. Empty if unstated." },
    hq: { type: 'string', description: 'Headquarters city/region if stated. Empty if unstated.' },
    summary: { type: 'string', description: 'A 3-5 sentence skeptical dossier: what they build, who for, what is verifiable.' },
    products: { type: 'array', items: { type: 'string' }, description: 'Named products, if any.' },
    customers: { type: 'array', items: { type: 'string' }, description: 'Named customers or design partners, if any.' },
  },
  required: ['one_liner', 'ai_tech', 'founded_year', 'stage', 'funding_note', 'hq', 'summary', 'products', 'customers'],
};

interface EnrichOut {
  one_liner: string;
  ai_tech: string;
  founded_year: number;
  stage: CompanyStage;
  funding_note: string;
  hq: string;
  summary: string;
  products: string[];
  customers: string[];
}

export async function enrichCompany(id: string): Promise<{ via: string; filled: string[] }> {
  const company = await one<{
    id: string; name: string; url: string | null; raw_content: string | null;
    one_liner: string | null; ai_tech: string | null; founded_year: number | null;
    stage: CompanyStage; funding_note: string | null; hq: string | null;
  }>(
    `select id::text as id, name, url, raw_content, one_liner, ai_tech, founded_year, stage, funding_note, hq
       from companies where id = $1`,
    [id]
  );
  if (!company) throw new Error('Unknown company.');
  if (!company.url) throw new Error('No homepage URL to fetch: add one via the facts editor first.');

  let text = company.raw_content;
  let via = 'cache';
  if (!text) {
    const fetched = await fetchCandidateText(company.url, { maxChars: 24_000 });
    text = fetched.text;
    via = fetched.via;
    await m.setCompanyRawContent(id, text, via);
  }

  const known = [
    company.one_liner ? `one_liner: ${company.one_liner}` : null,
    company.ai_tech ? `ai_tech: ${company.ai_tech}` : null,
    company.founded_year ? `founded: ${company.founded_year}` : null,
    company.stage !== 'unknown' ? `stage: ${company.stage}` : null,
    company.funding_note ? `funding: ${company.funding_note}` : null,
    company.hq ? `hq: ${company.hq}` : null,
  ].filter(Boolean);

  const out = await runStructured<EnrichOut>({
    system: ENRICH_SYSTEM,
    user: [
      `COMPANY: ${company.name}`,
      known.length ? `ALREADY KNOWN (do not contradict):\n${known.join('\n')}` : null,
      `HOMEPAGE TEXT:\n${text.slice(0, TEXT_CLIP)}`,
    ].filter(Boolean).join('\n\n'),
    toolName: 'submit_company_dossier',
    toolDescription: 'Submit the extracted company facts and dossier.',
    schema: ENRICH_SCHEMA,
    maxTokens: 1200,
    effort: 'low',
    feature: 'scout_dossier',
    timeoutMs: 55_000,
    maxRetries: 0,
  });

  const filled = await m.updateCompanyEnrichment(id, {
    one_liner: out.one_liner?.trim() || null,
    ai_tech: out.ai_tech?.trim() || null,
    founded_year: out.founded_year >= 1980 && out.founded_year <= 2100 ? out.founded_year : null,
    stage: out.stage,
    funding_note: out.funding_note?.trim() || null,
    hq: out.hq?.trim() || null,
    dossier: {
      summary: out.summary?.trim() || null,
      products: (out.products ?? []).slice(0, 12),
      customers: (out.customers ?? []).slice(0, 12),
      sources: [],
      updated_by: 'homepage',
    },
  });
  return { via, filled };
}
