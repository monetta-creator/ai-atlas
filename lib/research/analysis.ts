import { runStructured } from '../dossier';
import { fetchCandidateText, FetchFailure, MIN_READABLE_CHARS } from '../pipeline/web';
import { SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL } from '../format';
import * as m from '../mutations';
import {
  getPaper, getTargets, getConceptDigest, getThreadDigest, getSourceText,
} from '../data';
import type { Paper, PaperExtraction, SignalLens, ThreadRelation } from '../types';

// Per-paper deep analysis (docs/research-section.md phase 2), two invocations like the
// pipeline's hydrate->analyze: fetch + cache the full text in its own call, then one
// non-web structured call produces the EXTRACTION — a claim-shaped reading, not a
// summary — plus concept/thread proposals and a rigor SUGGESTION. On-demand only: the
// admin clicks Analyze per paper; nothing here runs unattended, and nothing here
// writes evidence or the rigor prior (model proposes, human commits).

const THREAD_RELATIONS: ThreadRelation[] = ['supports', 'complicates', 'contradicts', 'context'];

// ---- hydrate ----------------------------------------------------------------

interface HydrateResult {
  skipped?: boolean;    // text already cached
  via?: string;         // 'html' | 'direct' | 'jina' | 'source'
}

// arXiv's LaTeXML HTML render (arxiv.org/html/<id>) is the cleanest full text when it
// exists (most recent papers); the PDF is the fallback (unpdf extraction + reader
// fallback via fetchCandidateText). Manual non-arXiv papers fetch their own URL; a
// "Send to research" paper reuses its curated source text without any fetch.
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
    // fall through: the source had no usable text; try the paper's URL
  }

  if (p.arxiv_id) {
    try {
      const html = await fetchCandidateText(`https://arxiv.org/html/${p.arxiv_id}`, { allowFallback: false });
      await m.setPaperRawContent(paperId, html.text, 'html');
      return { via: 'html' };
    } catch {
      // older papers have no HTML render — the PDF path below is the normal fallback
    }
    const pdf = await fetchCandidateText(`https://arxiv.org/pdf/${p.arxiv_id}`, {});
    await m.setPaperRawContent(paperId, pdf.text, pdf.via);
    return { via: pdf.via };
  }

  const fetched = await fetchCandidateText(p.url, {});
  await m.setPaperRawContent(paperId, fetched.text, fetched.via);
  return { via: fetched.via };
}

// ---- analyze ----------------------------------------------------------------

const ANALYSIS_SYSTEM = [
  'You analyze one research paper for The AI Atlas, a tool for staying oriented in the AI-economy debate. Produce a structured FINDING, not a summary: a claim-shaped reading the author can test.',
  'headline_claim: what the paper actually asserts, one falsifiable sentence in plain language.',
  'the_test: what was actually measured, on what data or systems, at what scale.',
  'effect_size: how big the result is and where it holds or breaks (scope conditions). Use the paper\'s own numbers.',
  'limitations: what the authors themselves concede, plus any obvious unstated ones.',
  'counterpoint: what a fair skeptic would say (benchmark gaming, tiny n, lab PR dressed as science, prompt sensitivity, no baselines).',
  'econ_implication: what this means for the ECONOMICS of AI in the next 12 to 24 months, stated with restraint. If the honest answer is "little or nothing yet", say exactly that.',
  'who_cares: for each audience lens the paper genuinely speaks to (often just one or two), one concrete sentence on why that audience should care. Omit lenses it does not speak to.',
  'claim_codes: ONLY codes from the provided claim/bridge list this paper genuinely bears on, not merely thematically related. Often empty. These are advisory, they never write evidence.',
  'concept_slugs: listed concepts the paper directly concerns. thread_placements: listed threads this paper would move, each with a relation (supports / complicates / contradicts / context) and a one-sentence why.',
  'proposed_rigor: 0-100, your suggested methodological-rigor prior for this paper, a suggestion only: venue signal, sample size, baselines, code availability, claims-vs-evidence gap.',
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
      econ_implication: { type: 'string' },
      who_cares: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lens: { type: 'string', enum: SIGNAL_LENS_SLUGS },
            note: { type: 'string' },
          },
          required: ['lens', 'note'],
        },
      },
      claim_codes: { type: 'array', items: strEnum(codes) },
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
      'econ_implication', 'who_cares', 'claim_codes', 'concept_slugs', 'thread_placements',
      'proposed_rigor',
    ],
  };
}

interface RawExtraction extends PaperExtraction {
  claim_codes: string[];
  concept_slugs: string[];
}

interface AnalyzePaperResult {
  extraction: PaperExtraction;
  claim_touches: string[];
  suggested_concepts: string[];
  suggested_threads: string[];
}

export async function analyzePaper(paperId: string): Promise<AnalyzePaperResult> {
  const p = await getPaper(paperId);
  if (!p) throw new Error('Paper not found.');

  // The orchestrator hydrates in a separate invocation first; the abstract is the
  // backstop for papers whose full text cannot be fetched (some manual adds).
  const body = (p.raw_content || '').trim() || (p.abstract || '').trim();
  if (body.length < MIN_READABLE_CHARS) {
    throw new Error('No usable text: fetch the full text first, or add an abstract.');
  }

  const { claims, bridges } = await getTargets();
  const targets = [...claims, ...bridges];
  const codes = targets.map((t) => t.code);
  const concepts = await getConceptDigest();
  const threads = await getThreadDigest();
  const conceptSlugs = concepts.map((c) => c.slug);
  const threadSlugs = threads.map((t) => t.slug);

  const targetList = [
    ...claims.map((t) => `[${t.code}] (claim) ${t.statement}`),
    ...bridges.map((t) => `[${t.code}] (bridge-claim) ${t.statement}`),
  ].join('\n');
  const conceptList = concepts.map((c) => `[${c.slug}] ${c.name}: ${c.short_definition}`).join('\n');
  const threadList = threads.map((t) => `[${t.slug}] ${t.title}: ${t.question}`).join('\n');
  const lensGuide = SIGNAL_LENS_SLUGS.map((s) => `[${s}] ${SIGNAL_LENS_LABEL[s]}`).join('\n');

  const meta = [
    p.arxiv_id && `arXiv: ${p.arxiv_id}`,
    p.published_at && `Published: ${p.published_at}`,
    p.authors.length && `Authors: ${p.authors.slice(0, 12).join(', ')}`,
    p.categories.length && `Categories: ${p.categories.join(', ')}`,
    p.comments && `Comment: ${p.comments}`,
  ].filter(Boolean).join('\n');

  const out = await runStructured<RawExtraction>({
    // Digests are shared with triage and stable within a session — the SYSTEM block
    // rides the prompt cache across consecutive Analyze clicks.
    system: [
      ANALYSIS_SYSTEM,
      `\nAUDIENCE LENSES (use only these codes):\n${lensGuide}`,
      `\nARGUMENT-MAP CLAIMS & BRIDGE-CLAIMS (use ONLY these codes):\n${targetList || '(none)'}`,
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
    metadata: { paper_id: paperId, arxiv_id: p.arxiv_id },
    // The model leg runs in its own invocation (hydrate is separate): bound it so one
    // call provably fits the 60s cap; the client retries on a fresh invocation.
    timeoutMs: 45_000,
    maxRetries: 0,
  });

  // Coerce + allow-list everything (never trust the model for codes/slugs/enums).
  const validCode = new Set(codes);
  const validConcept = new Set(conceptSlugs);
  const validThread = new Set(threadSlugs);
  const validLens = new Set<string>(SIGNAL_LENS_SLUGS);
  const validRel = new Set<ThreadRelation>(THREAD_RELATIONS);
  const s = (v: unknown, cap = 2000) => String(v ?? '').slice(0, cap);
  const seenThreads = new Set<string>();
  const extraction: PaperExtraction = {
    headline_claim: s(out.headline_claim),
    the_test: s(out.the_test),
    effect_size: s(out.effect_size),
    limitations: s(out.limitations),
    counterpoint: s(out.counterpoint),
    econ_implication: s(out.econ_implication),
    who_cares: (Array.isArray(out.who_cares) ? out.who_cares : [])
      .filter((w) => w && validLens.has(w.lens as string))
      .map((w) => ({ lens: w.lens as SignalLens, note: s(w.note, 500) })),
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
    claim_touches: pick(out.claim_codes, validCode, 6),
    suggested_concepts: pick(out.concept_slugs, validConcept, 4),
    suggested_threads: (extraction.thread_placements ?? []).map((t) => t.slug),
  };

  await m.setPaperExtraction(paperId, extraction, {
    claim_touches: result.claim_touches,
    suggested_concepts: result.suggested_concepts,
    suggested_threads: result.suggested_threads,
  });
  return result;
}

// Shared helper for the promotion action: the text a signal analysis would read.
export function promotableText(p: Paper): string {
  return ((p.raw_content || '').trim() || (p.abstract || '').trim());
}
