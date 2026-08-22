import { runStructured } from '../dossier';
import { FetchFailure, MIN_READABLE_CHARS } from '../text';
import * as m from '../mutations';
import {
  getPaper, getTargets, getConceptDigest, getThreadDigest, getSourceText,
} from '../data';
import type { Paper, PaperExtraction, ThreadRelation } from '../types';

// Per-paper deep analysis: hydrate the full text from records already in hand,
// then one non-web structured call produces the EXTRACTION — a claim-shaped
// reading, not a summary — plus concept/thread proposals and a rigor SUGGESTION.
// On-demand only: the admin clicks Analyze per paper; nothing here runs
// unattended, and nothing here writes evidence or the rigor prior (model
// proposes, human commits).

const THREAD_RELATIONS: ThreadRelation[] = ['supports', 'complicates', 'contradicts', 'context'];

// ---- hydrate ----------------------------------------------------------------

interface HydrateResult {
  skipped?: boolean;    // text already cached
  via?: string;         // 'source'
}

// There is no fetch leg any more: a paper's text comes from its linked curated
// source (a "Send to research" paper, or a document added through intake). A
// paper without a text-bearing source cannot be hydrated; the admin adds the
// document text on the source first.
export async function hydratePaper(paperId: string): Promise<HydrateResult> {
  const p = await getPaper(paperId);
  if (!p) throw new FetchFailure('paper not found', true, false);
  if (p.raw_content) return { skipped: true };

  if (p.source_id) {
    const text = ((await getSourceText(p.source_id)) || '').trim();
    if (text.length >= MIN_READABLE_CHARS) {
      await m.setPaperRawContent(paperId, text, 'source');
      return { via: 'source' };
    }
  }
  throw new FetchFailure(
    'paper has no retained text: attach a source carrying the document text, then analyze',
    true,
    false
  );
}

// ---- analyze ----------------------------------------------------------------

const ANALYSIS_SYSTEM = [
  'You analyze one research paper or long-form document for the Strategy Atlas, an operating team\'s tool for tracking its strategic hypotheses. Produce a structured FINDING, not a summary: a claim-shaped reading the team can test.',
  'headline_claim: what the document actually asserts, one falsifiable sentence in plain language.',
  'the_test: what was actually measured or examined, on what data or systems, at what scale.',
  'effect_size: how big the result is and where it holds or breaks (scope conditions). Use the document\'s own numbers.',
  'limitations: what the authors themselves concede, plus any obvious unstated ones.',
  'counterpoint: what a fair skeptic would say (benchmark gaming, tiny n, marketing dressed as analysis, cherry-picked baselines).',
  'strategy_implication: what this means for the strategy picture in the next 12 to 24 months, stated with restraint. If the honest answer is "little or nothing yet", say exactly that.',
  'hypothesis_codes: ONLY codes from the provided hypothesis list this document genuinely bears on, not merely thematically related. Often empty. These are advisory, they never write evidence.',
  'concept_slugs: listed concepts the document directly concerns. thread_placements: listed threads this document would move, each with a relation (supports / complicates / contradicts / context) and a one-sentence why.',
  'proposed_rigor: 0-100, your suggested methodological-rigor prior for this document, a suggestion only: venue signal, sample size, baselines, data availability, claims-vs-evidence gap.',
  'Work only from the provided text. Do not fabricate numbers, codes, or slugs. Never use an em dash anywhere; use a comma, a colon, or separate sentences instead.',
].join(' ');

function buildSchema(codes: string[], concepts: string[], threads: string[]) {
  const strEnum = (values: string[]) => (values.length ? { type: 'string', enum: values } : { type: 'string' });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline_claim: { type: 'string' },
      the_test: { type: 'string' },
      effect_size: { type: 'string' },
      limitations: { type: 'string' },
      counterpoint: { type: 'string' },
      strategy_implication: { type: 'string' },
      hypothesis_codes: { type: 'array', items: strEnum(codes) },
      concept_slugs: { type: 'array', items: strEnum(concepts) },
      thread_placements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slug: strEnum(threads),
            relation: { type: 'string', enum: THREAD_RELATIONS },
            why: { type: 'string' },
          },
          required: ['slug', 'relation', 'why'],
        },
      },
      proposed_rigor: { type: 'integer' },
    },
    required: [
      'headline_claim', 'the_test', 'effect_size', 'limitations', 'counterpoint',
      'strategy_implication', 'hypothesis_codes', 'concept_slugs', 'thread_placements',
      'proposed_rigor',
    ],
  };
}

interface RawExtraction extends PaperExtraction {
  hypothesis_codes: string[];
  concept_slugs: string[];
}

interface AnalyzePaperResult {
  extraction: PaperExtraction;
  touches: string[];
  suggested_concepts: string[];
  suggested_threads: string[];
}

export async function analyzePaper(paperId: string): Promise<AnalyzePaperResult> {
  const p = await getPaper(paperId);
  if (!p) throw new Error('Paper not found.');

  // The orchestrator hydrates in a separate invocation first; the abstract is the
  // backstop for papers whose full text was never retained (some manual adds).
  const body = (p.raw_content || '').trim() || (p.abstract || '').trim();
  if (body.length < MIN_READABLE_CHARS) {
    throw new Error('No usable text: hydrate the full text first, or add an abstract.');
  }

  const { hypotheses } = await getTargets();
  const codes = hypotheses.map((t) => t.code);
  const concepts = await getConceptDigest();
  const threads = await getThreadDigest();
  const conceptSlugs = concepts.map((c) => c.slug);
  const threadSlugs = threads.map((t) => t.slug);

  const targetList = hypotheses.map((t) => `[${t.code}] ${t.statement}`).join('\n');
  const conceptList = concepts.map((c) => `[${c.slug}] ${c.name}: ${c.short_definition}`).join('\n');
  const threadList = threads.map((t) => `[${t.slug}] ${t.title}: ${t.question}`).join('\n');

  const meta = [
    p.published_at && `Published: ${p.published_at}`,
    p.authors.length && `Authors: ${p.authors.slice(0, 12).join(', ')}`,
  ].filter(Boolean).join('\n');

  const out = await runStructured<RawExtraction>({
    // Digests are shared with triage and stable within a session — the SYSTEM block
    // rides the prompt cache across consecutive Analyze clicks.
    system: [
      ANALYSIS_SYSTEM,
      `\nTRACKED HYPOTHESES (use ONLY these codes):\n${targetList || '(none)'}`,
      `\nCONCEPTS (use ONLY these slugs):\n${conceptList || '(none)'}`,
      `\nRESEARCH THREADS (use ONLY these slugs):\n${threadList || '(none)'}`,
    ].join('\n'),
    user: `PAPER: ${p.title}\n${meta}\n\n--- FULL TEXT${p.raw_content ? '' : ' (abstract only)'} ---\n${body.slice(0, 24000)}`,
    toolName: 'submit_finding',
    toolDescription: 'Return the structured finding for this paper.',
    schema: buildSchema(codes, conceptSlugs, threadSlugs),
    maxTokens: 3000,
    effort: 'medium',
    feature: 'research_analysis',
    metadata: { paper_id: paperId },
    // The model leg runs in its own invocation (hydrate is separate): bound it so one
    // call stays short; the client retries on a fresh invocation.
    timeoutMs: 45_000,
    maxRetries: 0,
  });

  // Coerce + allow-list everything (never trust the model for codes/slugs/enums).
  const validCode = new Set(codes);
  const validConcept = new Set(conceptSlugs);
  const validThread = new Set(threadSlugs);
  const validRel = new Set<ThreadRelation>(THREAD_RELATIONS);
  const s = (v: unknown, cap = 2000) => String(v ?? '').slice(0, cap);
  const seenThreads = new Set<string>();
  const extraction: PaperExtraction = {
    headline_claim: s(out.headline_claim),
    the_test: s(out.the_test),
    effect_size: s(out.effect_size),
    limitations: s(out.limitations),
    counterpoint: s(out.counterpoint),
    strategy_implication: s(out.strategy_implication),
    thread_placements: (Array.isArray(out.thread_placements) ? out.thread_placements : [])
      .filter((t) => t && validThread.has(t.slug) && !seenThreads.has(t.slug) && seenThreads.add(t.slug))
      .map((t) => ({
        slug: t.slug,
        relation: validRel.has(t.relation) ? t.relation : 'context',
        why: s(t.why, 500),
      })),
    proposed_rigor: Math.max(0, Math.min(100, Math.round(Number(out.proposed_rigor) || 0))),
  };
  const pick = (arr: unknown, valid: Set<string>, cap: number) =>
    Array.isArray(arr)
      ? Array.from(new Set(arr.filter((v): v is string => typeof v === 'string' && valid.has(v)))).slice(0, cap)
      : [];
  const result: AnalyzePaperResult = {
    extraction,
    touches: pick(out.hypothesis_codes, validCode, 6),
    suggested_concepts: pick(out.concept_slugs, validConcept, 4),
    suggested_threads: (extraction.thread_placements ?? []).map((t) => t.slug),
  };

  await m.setPaperExtraction(paperId, extraction, {
    touches: result.touches,
    suggested_concepts: result.suggested_concepts,
    suggested_threads: result.suggested_threads,
  });
  return result;
}

// Shared helper for the promotion action: the text a signal analysis would read.
export function promotableText(p: Paper): string {
  return ((p.raw_content || '').trim() || (p.abstract || '').trim());
}
