import { runStructured } from '../dossier';
import { clamp01 } from '../scan/core';
import { chatJSONOpenRouter } from '../scan/llm';
import { SCAN_ENRICH_MODELS } from '../scan/models';
import { INTEL_DIMENSIONS, INTEL_DIMENSION_CODES, dimensionDigest } from './core';
import type { IntelCompany } from '../types';

// The intel desk's enrichment pass: one small-model call per hydrated item
// producing a summary, company linkage (allow-listed against the registry),
// dimension tags, entities, an advisory significance, and the structured
// FACTS the item supports. Facts are the desk's compounding asset: short,
// dated, provenance-carrying statements that survive after the news cycle.
//
// Two provider paths, same prompts, same validation (the scan enrich shape):
// the picker's OpenRouter models or the Haiku baseline via runStructured.
// Every enum-ish output is deBracketed before allow-listing (the qwen
// display-bracket landmine) and nothing the model writes reaches a table
// without coercion. Cost-log discipline: feature 'intel_enrich', provenance
// in metadata.intel_run, NEVER pipelineRunId (the ai_cost_log FK trap).

const ENRICH_MODEL = 'claude-haiku-4-5';
const MAX_INPUT_CHARS = 12_000;
const MAX_FACTS = 8;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface IntelEnrichment {
  summary: string;
  companySlugs: string[];
  dimensions: string[];
  entities: string[];
  significance: number | null;
  facts: {
    company_slug: string;
    dimension: string;
    fact: string;
    value_text: string | null;
    as_of: string | null;
  }[];
}

interface RawFact {
  company_slug?: string;
  dimension?: string;
  fact?: string;
  value?: string;
  as_of?: string;
}

interface RawEnrichment {
  summary: string;
  company_slugs: string[];
  dimensions: string[];
  entities: string[];
  significance: number;
  facts: RawFact[];
}

// Ranges live in descriptions, not minimum/maximum (the Anthropic tool
// validator rejects those keywords); clamp01 clamps at the writer.
function enrichSchema(slugs: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: {
        type: 'string',
        description: 'Two to three sentences: what happened and why it matters to a competitive strategy desk. Plain prose, no headline restatement.',
      },
      company_slugs: {
        type: 'array',
        items: { type: 'string', enum: slugs },
        description: 'Every tracked company this item materially concerns, from the provided registry only. Empty if none.',
      },
      dimensions: {
        type: 'array',
        items: { type: 'string', enum: INTEL_DIMENSION_CODES },
        description: 'Every dimension the item genuinely bears on, from the provided list only. Usually one or two.',
      },
      entities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Companies, agencies, regulators, and people named in the item. Proper names only.',
      },
      significance: {
        type: 'number',
        description: 'How significant the item is for tracking the named companies, from 0.0 (routine or unrelated) to 1.0 (a major strategic development). Off-topic items get a low score, not an error.',
      },
      facts: {
        type: 'array',
        description: 'Up to 8 discrete, durable facts the TEXT supports about tracked companies: a launch, a number, a hire, a deal term, a stated plan. Skip opinions and speculation. Empty is a normal outcome.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            company_slug: { type: 'string', enum: slugs, description: 'The tracked company the fact is about.' },
            dimension: { type: 'string', enum: INTEL_DIMENSION_CODES, description: 'The single best-fit dimension.' },
            fact: { type: 'string', description: 'One sentence, self-contained, specific. Under 300 characters.' },
            value: { type: 'string', description: 'The key figure or term if there is one (e.g. "$1.2B", "14%", "Q3 2026"), else empty.' },
            as_of: { type: 'string', description: 'The date the fact is true as of, YYYY-MM-DD, if the text supports one; else empty.' },
          },
          required: ['company_slug', 'dimension', 'fact', 'value', 'as_of'],
        },
      },
    },
    required: ['summary', 'company_slugs', 'dimensions', 'entities', 'significance', 'facts'],
  };
}

function registryDigest(companies: Pick<IntelCompany, 'slug' | 'name' | 'aliases'>[]): string {
  return companies
    .map((c) => {
      const aka = c.aliases.filter((a) => a !== c.name);
      return `[${c.slug}] ${c.name}${aka.length ? ` (also: ${aka.join(', ')})` : ''}`;
    })
    .join('\n');
}

// Some open-weight models copy display brackets into enum values ("[slug]").
const deBracket = (v: unknown): string =>
  String(v ?? '').trim().replace(/^\[/, '').replace(/\]$/, '');

export async function enrichIntelItem(
  item: { id: string; url: string; headline: string | null; source_domain: string | null; raw_content: string },
  companies: Pick<IntelCompany, 'slug' | 'name' | 'aliases'>[],
  intelRunId: string,
  model?: string
): Promise<IntelEnrichment> {
  const slugs = companies.map((c) => c.slug);
  const system = `You are the enrichment pass of a company-intelligence desk for a strategy team. For each item you receive, write a short factual summary, link it to the tracked companies it concerns, tag its dimensions, list named entities, score its significance, and extract the durable facts it supports.

The tracked-company registry (link and attribute facts ONLY to these slugs):
${registryDigest(companies)}

The dimensions (use ONLY these codes):
${dimensionDigest()}

Rules: use only what the text supports, never invent facts or figures. A fact must be attributable to a specific tracked company; industry-wide observations are not facts, they belong in the summary. Do not editorialize. Never use an em dash in any text you write.`;

  const user = `ITEM
URL: ${item.url}
SOURCE: ${item.source_domain ?? ''}
HEADLINE: ${item.headline ?? ''}

TEXT:
${item.raw_content.slice(0, MAX_INPUT_CHARS)}`;

  const openrouter = model && !SCAN_ENRICH_MODELS.find((m) => m.id === model)?.anthropic;
  const raw = openrouter
    ? await chatJSONOpenRouter<RawEnrichment>({
        model: model as string,
        system: `${system}

Reply with ONLY a single JSON object, no prose and no code fence, with exactly these keys:
  "summary": string, two to three sentences (what happened, why it matters to a competitive strategy desk)
  "company_slugs": array of registry slug strings the item materially concerns (empty if none)
  "dimensions": array of dimension code strings, from the list only, usually one or two
  "entities": array of proper names (companies, agencies, regulators, people) named in the item
  "significance": number from 0.0 (routine or unrelated) to 1.0 (a major strategic development)
  "facts": array of up to 8 objects {"company_slug": registry slug, "dimension": code, "fact": one self-contained sentence under 300 chars, "value": key figure or empty string, "as_of": "YYYY-MM-DD" or empty string}; empty array is a normal outcome`,
        user,
        maxTokens: 1400,
        feature: 'intel_enrich',
        metadata: { intel_run: intelRunId, item: item.id },
        // 45s, not 30: OpenRouter tail latency truncated slow reads at 30s.
        timeoutMs: 45_000,
      })
    : await runStructured<RawEnrichment>({
        system,
        user,
        toolName: 'submit_intel_enrichment',
        toolDescription: 'Return the enrichment and extracted facts for this item.',
        schema: enrichSchema(slugs),
        maxTokens: 1400,
        effort: 'low',
        feature: 'intel_enrich',
        metadata: { intel_run: intelRunId, item: item.id },
        timeoutMs: 30_000,
        maxRetries: 0,
        model: ENRICH_MODEL,
      });

  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const allowedSlugs = new Set(slugs);
  const allowedDims = new Set(INTEL_DIMENSION_CODES);

  const facts: IntelEnrichment['facts'] = [];
  for (const f of arr(raw.facts) as RawFact[]) {
    const slug = deBracket(f?.company_slug);
    const dimension = deBracket(f?.dimension);
    const fact = String(f?.fact ?? '').trim().slice(0, 400);
    if (!allowedSlugs.has(slug) || !allowedDims.has(dimension) || fact.length < 15) continue;
    const asOf = String(f?.as_of ?? '').trim();
    facts.push({
      company_slug: slug,
      dimension,
      fact,
      value_text: String(f?.value ?? '').trim().slice(0, 120) || null,
      as_of: DATE_RE.test(asOf) ? asOf : null,
    });
    if (facts.length >= MAX_FACTS) break;
  }

  return {
    summary: String(raw.summary ?? '').trim().slice(0, 1500),
    companySlugs: [...new Set(arr(raw.company_slugs).map(deBracket).filter((s) => allowedSlugs.has(s)))],
    dimensions: [...new Set(arr(raw.dimensions).map(deBracket).filter((d) => allowedDims.has(d)))],
    entities: [...new Set(arr(raw.entities).map((e) => String(e).trim()).filter(Boolean))].slice(0, 20),
    significance: clamp01(raw.significance),
    facts,
  };
}

// Keep the const referenced so the digest and schema never drift apart.
void INTEL_DIMENSIONS;
