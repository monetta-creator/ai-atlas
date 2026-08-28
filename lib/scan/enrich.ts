import { runStructured } from '../dossier';
import { clamp01 } from './core';
import type { ScanTopic } from '../types';

// The scan's light enrichment: one Haiku call per hydrated item producing a
// short summary, taxonomy tags (allow-listed against the active topics),
// named entities, and an advisory relevance. Deliberately judgment-light: the
// downstream tool decides what is a signal; off-topic items get LOW RELEVANCE,
// never dropped.
//
// The taxonomy digest rides in the system block (cache_control ephemeral via
// runStructured), so sequential per-item calls within the cache TTL pay for it
// once. Cost-log discipline: feature 'scan_enrich', provenance in
// metadata.scan_run, NEVER pipelineRunId (the ai_cost_log FK trap).

const ENRICH_MODEL = 'claude-haiku-4-5';
const MAX_INPUT_CHARS = 12_000;

export interface ScanEnrichment {
  summary: string;
  tags: string[];
  entities: string[];
  relevance: number | null;
}

interface RawEnrichment {
  summary: string;
  taxonomy_codes: string[];
  entities: string[];
  relevance: number;
}

// Ranges live in descriptions, not minimum/maximum: the Anthropic tool
// validator rejects those keywords on number properties (the 0033 landmine);
// clamp01 clamps at the writer instead.
function enrichSchema(codes: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: {
        type: 'string',
        description: 'Two to three sentences: what happened, and why it matters to banking and financial services strategy. Plain prose, no headline restatement.',
      },
      taxonomy_codes: {
        type: 'array',
        items: { type: 'string', enum: codes },
        description: 'Every taxonomy code the item genuinely bears on, from the provided list only. Usually one or two.',
      },
      entities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Companies, agencies, regulators, and people named in the item. Proper names only.',
      },
      relevance: {
        type: 'number',
        description: 'How relevant the item is to banking and financial services, from 0.0 (unrelated) to 1.0 (directly material). Off-topic items get a low score, not an error.',
      },
    },
    required: ['summary', 'taxonomy_codes', 'entities', 'relevance'],
  };
}

function taxonomyDigest(topics: Pick<ScanTopic, 'taxonomy_code' | 'name' | 'description'>[]): string {
  return topics
    .map((t) => `[${t.taxonomy_code}] ${t.name}${t.description ? `: ${t.description}` : ''}`)
    .join('\n');
}

export async function enrichScanItem(
  item: { id: string; url: string; headline: string | null; source_domain: string | null; raw_content: string },
  topics: Pick<ScanTopic, 'taxonomy_code' | 'name' | 'description'>[],
  scanRunId: string
): Promise<ScanEnrichment> {
  const codes = [...new Set(topics.map((t) => t.taxonomy_code))];
  const system = `You are the enrichment pass of an external news scan for a financial services strategy team. For each item you receive, write a short factual summary, tag it with taxonomy codes, list the named entities, and score its relevance.

The taxonomy (use ONLY these codes; when an item is ambiguous or early-stage, the triage bucket code is the right tag if one exists in the list):
${taxonomyDigest(topics)}

Rules: summarize only what the text supports, never invent facts or figures. Do not editorialize. Never use an em dash in any text you write.`;

  const user = `ITEM
URL: ${item.url}
SOURCE: ${item.source_domain ?? ''}
HEADLINE: ${item.headline ?? ''}

TEXT:
${item.raw_content.slice(0, MAX_INPUT_CHARS)}`;

  const raw = await runStructured<RawEnrichment>({
    system,
    user,
    toolName: 'submit_enrichment',
    toolDescription: 'Return the enrichment for this item.',
    schema: enrichSchema(codes),
    maxTokens: 700,
    effort: 'low',
    feature: 'scan_enrich',
    metadata: { scan_run: scanRunId, item: item.id },
    timeoutMs: 30_000,
    maxRetries: 0,
    model: ENRICH_MODEL,
  });

  const allowed = new Set(codes);
  return {
    summary: String(raw.summary ?? '').trim().slice(0, 1500),
    tags: [...new Set((raw.taxonomy_codes ?? []).filter((c) => allowed.has(c)))],
    entities: [...new Set((raw.entities ?? []).map((e) => String(e).trim()).filter(Boolean))].slice(0, 20),
    relevance: clamp01(raw.relevance),
  };
}
