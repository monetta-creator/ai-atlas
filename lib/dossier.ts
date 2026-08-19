import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from './cost';
import type {
  Dossier, Basis, BasisClaim, Domain, Lens, SourceMetadata, ClaimRecommendation,
} from './types';

// Server-only. The AI source dossier (Design Doc §7.1): one web-grounded
// Anthropic call profiles a source — its internal argument plus external facts
// about the author/outlet — and returns a structured dossier. The model
// SURFACES information (with provenance), never a score; the author still sets
// the reliability prior. Token cost is treated as a non-constraint (favor
// thoroughness; always run the web pass).

const MODEL = 'claude-sonnet-4-6';
const DOMAINS: Domain[] = ['capability', 'economics', 'build_out', 'market', 'labor'];
const LENSES: Lens[] = ['market', 'economics', 'social', 'employment', 'education', 'geopolitics', 'stack'];
const BASES: Basis[] = ['web_verified', 'training_memory', 'document_stated'];

const SYSTEM = `You are a source analyst for The AI Atlas, a tool for staying oriented in the AI-economy debate. You profile a single source so the author can judge how much to trust it.

Produce a DOSSIER, never a score. You surface information; the author decides. Never output a trust number or a verdict on the source's worth.

Hard separation:
- document_internal — analysis grounded ONLY in the provided text.
- external_claims — facts about the author and outlet (incentives, funding, ownership, political/commercial lean). You do NOT have live web access in this run: draw only on what the document states and on your own training knowledge, and be conservative.

Every external claim is a {field, value, basis, confidence} object:
- field: short label, e.g. "funding", "ownership", "commercial incentive", "political lean".
- value: the finding. "unknown" is a perfectly valid value — prefer it to guessing.
- basis: how you know it — "document_stated" (asserted in the source text) or "training_memory" (from your own prior knowledge, not verified now). Do NOT use "web_verified" in this run — there is no live search.
- confidence: 0.0–1.0, calibrated. Lower it for anything from memory, and low generally when uncertain.

FABRICATION IS THE WORST OUTCOME. Never invent a fact to fill a field. An honest "unknown" with low confidence is always better than a plausible guess.

for_the_analyst:
- bias_to_model: the angle/lens to keep in mind when reading this source — NOT a verdict on whether it is right.
- questions_unverified: things a careful reader should check, ranked most load-bearing first.
- suggested_domain_tag: the single best-fit domain (capability | economics | build_out | market | labor).
- suggested_lenses: any applicable lenses.

Never use an em dash in any text you write; use a comma, a colon, or separate sentences instead.

Analyze the document and what you know, then call the submit_dossier tool exactly once with the complete structured dossier.`;

const basisClaimSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: { type: 'string', description: 'short label for the fact, e.g. "funding"' },
    value: { type: 'string', description: 'the finding; "unknown" is valid' },
    basis: { type: 'string', enum: BASES },
    confidence: { type: 'number', description: 'calibrated 0.0–1.0' },
  },
  required: ['field', 'value', 'basis', 'confidence'],
};

const DOSSIER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    document_internal: {
      type: 'object',
      additionalProperties: false,
      properties: {
        thesis: { type: 'string' },
        what_its_selling: { type: 'string' },
        rhetorical_register: { type: 'string' },
        emotional_loading: { type: 'string' },
        specificity: { type: 'string' },
        falsifiable_claims: { type: 'array', items: { type: 'string' } },
        notable_omissions: { type: 'array', items: { type: 'string' } },
        internal_red_flags: { type: 'array', items: { type: 'string' } },
        argument_quality: { type: 'string' },
      },
      required: [
        'thesis', 'what_its_selling', 'rhetorical_register', 'emotional_loading',
        'specificity', 'falsifiable_claims', 'notable_omissions', 'internal_red_flags', 'argument_quality',
      ],
    },
    external_claims: {
      type: 'object',
      additionalProperties: false,
      properties: {
        author: { type: 'array', items: basisClaimSchema },
        outlet: { type: 'array', items: basisClaimSchema },
      },
      required: ['author', 'outlet'],
    },
    for_the_analyst: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bias_to_model: { type: 'string' },
        questions_unverified: { type: 'array', items: { type: 'string' } },
        suggested_domain_tag: { type: 'string', enum: DOMAINS },
        suggested_lenses: { type: 'array', items: { type: 'string', enum: LENSES } },
      },
      required: ['bias_to_model', 'questions_unverified', 'suggested_domain_tag', 'suggested_lenses'],
    },
  },
  required: ['document_internal', 'external_claims', 'for_the_analyst'],
};

interface DossierSource {
  title: string | null;
  author: string | null;
  outlet: string | null;
  url: string | null;
  published_at: string | null;
  raw_text: string | null;
}

function buildUserText(s: DossierSource): string {
  const meta = [
    s.title && `Title: ${s.title}`,
    s.author && `Author: ${s.author}`,
    s.outlet && `Outlet: ${s.outlet}`,
    s.url && `URL: ${s.url}`,
    s.published_at && `Published: ${s.published_at}`,
  ].filter(Boolean).join('\n');
  // Cap the text sent — profiling doesn't need the whole document, and very long
  // input slows the call (and pushes it toward the function timeout).
  const MAX_TEXT = 24000;
  const text = (s.raw_text ?? '').trim();
  const clipped = text.length > MAX_TEXT;
  const body = text
    ? `\n\n--- SOURCE TEXT${clipped ? ' (truncated for length)' : ''} ---\n${text.slice(0, MAX_TEXT)}`
    : '\n\n(No full text was pasted — base document_internal on the metadata and be explicit about what you could not assess.)';
  return `Profile this source.\n\n${meta || '(no metadata provided)'}${body}`;
}

export async function generateDossier(source: DossierSource): Promise<Dossier> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required to generate a dossier.');
  }
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserText(source) },
  ];

  // One forced structured call — fast and reliable inside the function's hard 60s
  // limit. Live web search was dropped: even bounded, the agentic search loop ran
  // past 60s and timed out. The dossier is built from the document + the model's
  // own knowledge, with basis tagged accordingly (never "web_verified" here).
  // Params are loosely typed at the SDK boundary (this SDK version may not yet
  // type effort / strict tools / thinking-disabled, all accepted at runtime).
  const params = {
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'disabled' },
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [
      {
        name: 'submit_dossier',
        description: 'Submit the completed source dossier as structured JSON.',
        strict: true,
        input_schema: DOSSIER_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_dossier' },
    messages,
  };

  const t0 = Date.now();
  const msg = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0]
  )) as Anthropic.Message;
  await recordApiCall({ feature: 'dossier', model: MODEL, usage: msg.usage, wallMs: Date.now() - t0 });

  const submit = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_dossier'
  );
  if (!submit) throw new Error('The model did not return a dossier. Please try again.');
  return normalizeDossier(submit.input);
}

// strict:true already constrains the shape; this clamps confidences and guards
// against any missing arrays before the value is persisted/rendered.
function normalizeDossier(input: unknown): Dossier {
  const d = input as Dossier;
  const clampClaims = (cs: BasisClaim[] | undefined): BasisClaim[] =>
    (Array.isArray(cs) ? cs : []).map((c) => ({
      field: String(c.field ?? ''),
      value: String(c.value ?? 'unknown'),
      basis: BASES.includes(c.basis) ? c.basis : 'training_memory',
      confidence: Math.min(1, Math.max(0, Number(c.confidence) || 0)),
    }));
  const di = d.document_internal ?? ({} as Dossier['document_internal']);
  const fa = d.for_the_analyst ?? ({} as Dossier['for_the_analyst']);
  return {
    document_internal: {
      thesis: di.thesis ?? '',
      what_its_selling: di.what_its_selling ?? '',
      rhetorical_register: di.rhetorical_register ?? '',
      emotional_loading: di.emotional_loading ?? '',
      specificity: di.specificity ?? '',
      falsifiable_claims: di.falsifiable_claims ?? [],
      notable_omissions: di.notable_omissions ?? [],
      internal_red_flags: di.internal_red_flags ?? [],
      argument_quality: di.argument_quality ?? '',
    },
    external_claims: {
      author: clampClaims(d.external_claims?.author),
      outlet: clampClaims(d.external_claims?.outlet),
    },
    for_the_analyst: {
      bias_to_model: fa.bias_to_model ?? '',
      questions_unverified: fa.questions_unverified ?? [],
      suggested_domain_tag: DOMAINS.includes(fa.suggested_domain_tag) ? fa.suggested_domain_tag : 'capability',
      suggested_lenses: Array.isArray(fa.suggested_lenses) ? fa.suggested_lenses.filter((l) => LENSES.includes(l)) : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Shared structured-output runner: one forced, non-web tool call. Fast — used by
// the metadata and claim-recommendation passes; both finish well inside the 60s
// function limit (no web search, no agentic loop).
export async function runStructured<T>(opts: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: object;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  // Cost monitoring (migration 0014): the feature slug this call is logged under, plus
  // optional provenance for the cost dashboard (pipeline run, free-form metadata).
  feature: string;
  pipelineRunId?: string | null;
  metadata?: Record<string, unknown>;
  // Per-call overrides so a near-cap caller (analysis: fetch + model must fit 60s) can
  // tighten the model leg and disable in-call SDK retries. Defaults suit short calls.
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for AI source tools.');
  // Bounded under the 60s cap. Near-cap callers pass a tighter timeoutMs + maxRetries:0
  // (the orchestrator retries on a fresh invocation); short callers keep the 50s/1 defaults.
  const client = new Anthropic({
    apiKey,
    timeout: opts.timeoutMs ?? 50_000,
    maxRetries: opts.maxRetries ?? 1,
  });
  const params = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    thinking: { type: 'disabled' },
    output_config: { effort: opts.effort ?? 'low' },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    tools: [{ name: opts.toolName, description: opts.toolDescription, strict: true, input_schema: opts.schema }],
    tool_choice: { type: 'tool', name: opts.toolName },
    messages: [{ role: 'user', content: opts.user }],
  };
  const t0 = Date.now();
  const msg = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0]
  )) as Anthropic.Message;
  await recordApiCall({
    feature: opts.feature,
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    pipelineRunId: opts.pipelineRunId,
    metadata: opts.metadata,
  });
  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.toolName
  );
  if (!tu) throw new Error('No structured output returned.');
  return tu.input as T;
}

// Change 1 — pull bibliographic metadata from extracted source text.
const METADATA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    author: { type: 'string' },
    url: { type: 'string' },
    published_at: { type: 'string' },
    domain_tag: { type: 'string', enum: [...DOMAINS, ''] },
  },
  required: ['title', 'author', 'url', 'published_at', 'domain_tag'],
};

export async function extractSourceMetadata(text: string): Promise<SourceMetadata> {
  const raw = await runStructured<SourceMetadata>({
    system:
      'Extract bibliographic metadata from the source text. Return "" for any field you cannot determine from the text — never guess or invent. published_at must be YYYY-MM-DD or "". domain_tag classifies the source into the AI-economy domain it most concerns: capability (are models improving), economics (unit economics / business viability), build_out (power, chips, data centers), market (pricing, valuation, where value accrues), labor (jobs, hiring, knowledge work); use "" if unclear.',
    user: `SOURCE TEXT:\n${text.slice(0, 24000)}`,
    toolName: 'submit_metadata',
    toolDescription: 'Return the extracted source metadata.',
    schema: METADATA_SCHEMA,
    maxTokens: 800,
    effort: 'low',
    feature: 'pdf_metadata',
  });
  const domain = String(raw.domain_tag ?? '');
  return {
    title: String(raw.title ?? '').trim(),
    author: String(raw.author ?? '').trim(),
    url: String(raw.url ?? '').trim(),
    published_at: String(raw.published_at ?? '').trim(),
    domain_tag: (DOMAINS as string[]).includes(domain) ? domain : '',
  };
}

// Change 2 — recommend which claims a source is good evidence for (advisory only).
interface RecommendSource {
  text: string;
  title: string | null;
  author: string | null;
  outlet: string | null;
}

export async function recommendClaims(
  src: RecommendSource,
  claims: { code: string; statement: string; test: string | null }[]
): Promise<ClaimRecommendation[]> {
  if (!claims.length) return [];
  const codes = claims.map((c) => c.code);
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            claim_code: { type: 'string', enum: codes },
            direction: { type: 'string', enum: ['supports', 'contradicts', 'neutral'] },
            weight: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
          required: ['claim_code', 'direction', 'weight', 'reason'],
        },
      },
    },
    required: ['recommendations'],
  };
  const claimList = claims
    .map((c) => `[${c.code}] ${c.statement}${c.test ? ` (would be falsified if: ${c.test})` : ''}`)
    .join('\n');
  const meta = [
    src.title && `Title: ${src.title}`,
    src.author && `Author: ${src.author}`,
    src.outlet && `Outlet: ${src.outlet}`,
  ].filter(Boolean).join('  ·  ');

  const out = await runStructured<{ recommendations: ClaimRecommendation[] }>({
    system:
      'You recommend which claims a source is good EVIDENCE for. Each claim is listed with its code and its falsification test. Recommend ONLY claims the source genuinely bears on — omit weak or tangential matches; recommending nothing is correct when the source does not fit any claim. For each: direction = whether the source supports or contradicts the claim (or neutral); weight = high/medium/low by how strong the evidence is; reason = one concise sentence. You only RECOMMEND — the human decides what to attach. Use only claim codes from the provided list. Never use an em dash in your reasons; use a comma or a colon instead.',
    user: `CLAIMS:\n${claimList}\n\nSOURCE${meta ? `  (${meta})` : ''}:\n${(src.text || '').slice(0, 24000) || '(no text provided)'}`,
    toolName: 'submit_recommendations',
    toolDescription: 'Return recommended claim matches.',
    schema,
    maxTokens: 4000,
    effort: 'medium',
    feature: 'claim_recommendations',
  });
  const valid = new Set(codes);
  return (out.recommendations ?? []).filter(
    (r) =>
      valid.has(r.claim_code) &&
      ['supports', 'contradicts', 'neutral'].includes(r.direction) &&
      ['high', 'medium', 'low'].includes(r.weight)
  );
}
