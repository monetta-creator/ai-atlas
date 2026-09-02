import { runStructured } from '../dossier';
import { clamp01 } from './core';
import { chatJSONOpenRouter } from './llm';
import { SCAN_ENRICH_MODELS } from './models';
import { CONTENT_KINDS, isContentKind, type ContentKind } from './source-tiers';
import type { ScanTopic } from '../types';

// The scan's light enrichment: one small-model call per hydrated item
// producing a short summary, taxonomy tags (allow-listed against the active
// topics), named entities, and an advisory relevance. Deliberately
// judgment-light: the downstream tool decides what is a signal; off-topic
// items get LOW RELEVANCE, never dropped.
//
// Two provider paths, same prompts, same validation: the /scan picker's
// OpenRouter models (lib/scan/llm.ts, JSON-object output) or the Haiku
// baseline via runStructured (forced tool; also the fallback when no model is
// selected). The taxonomy digest rides in the system block either way.
// Cost-log discipline: feature 'scan_enrich', provenance in
// metadata.scan_run, NEVER pipelineRunId (the ai_cost_log FK trap).

const ENRICH_MODEL = 'claude-haiku-4-5';
const MAX_INPUT_CHARS = 12_000;

export interface ScanEnrichment {
  summary: string;
  tags: string[];
  entities: string[];
  relevance: number | null;
  contentKind: ContentKind;
}

interface RawEnrichment {
  summary: string;
  taxonomy_codes: string[];
  entities: string[];
  relevance: number;
  content_kind: string;
}

// Ranges live in descriptions, not minimum/maximum: the Anthropic tool
// validator rejects those keywords on number properties (the 0033 landmine);
// clamp01 clamps at the writer instead.
// Shared anchored rubric for relevance, interpolated into BOTH provider paths so
// the three A/B models score on one ruler (measured skew before anchoring: GLM
// avg 0.40 vs deepseek 0.57 / qwen 0.55 on randomly split items). Anchors live
// in prose, never schema min/max (the Anthropic tool validator rejects those).
const RELEVANCE_RUBRIC =
  'How relevant to banking and financial services strategy, 0.0 to 1.0. Anchors: 0.9 or higher means a named financial institution, regulator, or payments/AI vendor takes a concrete action with stated numbers or dates (an enforcement action, an earnings beat, a major platform policy change). 0.7 means clearly sector-relevant development without a named actor taking new action (industry trend data, a credible analysis of fraud or credit conditions). 0.4 to 0.5 means sector-adjacent context a strategy reader might skim (macro data, adjacent tech news with plausible spillover). 0.2 means tangential mention only. 0.0 to 0.1 means unrelated locale news, listicles, marketing pages. Score the substance of the text, not the headline. Off-topic items get a low score, not an error.';

// Migration 0052: content_kind discounts promotional text inside an
// otherwise-good source (priorityOf in lib/scan/source-tiers.ts), separately
// from source_tier which rates the domain itself.
const CONTENT_KIND_RUBRIC =
  'What the text IS: news reporting, analysis, data (a study, survey, dataset or statistics release), press_release (company-authored announcement, wire copy), marketing (a product page, vendor content, SEO listicle), opinion (editorial, column), other.';

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
        description: RELEVANCE_RUBRIC,
      },
      content_kind: {
        type: 'string',
        enum: [...CONTENT_KINDS],
        description: CONTENT_KIND_RUBRIC,
      },
    },
    required: ['summary', 'taxonomy_codes', 'entities', 'relevance', 'content_kind'],
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
  scanRunId: string,
  model?: string
): Promise<ScanEnrichment> {
  const codes = [...new Set(topics.map((t) => t.taxonomy_code))];
  const system = `You are the enrichment pass of an external news scan for a financial services strategy team. For each item you receive, write a short factual summary, tag it with taxonomy codes, list the named entities, and score its relevance.

The taxonomy (use ONLY these codes; when an item is ambiguous or early-stage, the triage bucket code is the right tag if one exists in the list):
${taxonomyDigest(topics)}

Rules: summarize only what the text supports, never invent facts or figures. Do not editorialize. Score relevance using the stated anchors consistently, the same way for every item. Never use an em dash in any text you write.`;

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
  "summary": string, two to three sentences (what happened, why it matters to banking and financial services strategy)
  "taxonomy_codes": array of code strings, from the taxonomy list only, usually one or two
  "entities": array of proper names (companies, agencies, regulators, people) named in the item
  "relevance": number. ${RELEVANCE_RUBRIC}
  "content_kind": string, one of ${CONTENT_KINDS.join(', ')}. ${CONTENT_KIND_RUBRIC}`,
        user,
        maxTokens: 700,
        feature: 'scan_enrich',
        metadata: { scan_run: scanRunId, item: item.id },
        // 45s, not the Haiku path's 30: OpenRouter tail latency truncated
        // slow DeepSeek reads at 30s on the first live run.
        timeoutMs: 45_000,
      })
    : await runStructured<RawEnrichment>({
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

  // Open-weight models can return sloppier shapes than the forced tool, so
  // coerce arrays defensively; the allow-list and clamp do the real guarding.
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const allowed = new Set(codes);
  return {
    summary: String(raw.summary ?? '').trim().slice(0, 1500),
    tags: [...new Set(arr(raw.taxonomy_codes).map((c) => String(c).trim()).filter((c) => allowed.has(c)))],
    entities: [...new Set(arr(raw.entities).map((e) => String(e).trim()).filter(Boolean))].slice(0, 20),
    relevance: clamp01(raw.relevance),
    contentKind: isContentKind(raw.content_kind) ? raw.content_kind : 'other',
  };
}
