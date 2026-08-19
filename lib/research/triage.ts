import { runStructured } from '../dossier';
import { fetchPedigreeBatch } from './citations';
import * as m from '../mutations';
import {
  getTargets, countPendingPapers, getConceptDigest, getThreadDigest,
} from '../data';

// Research triage: metadata-only (title + abstract) relevance filtering against the
// Atlas's argument graph — the funnel that makes a several-hundred-papers/day intake
// affordable. One bounded chunk per server action (the console loops until the queue
// drains), mirroring the discovery pipeline's triage. Kept papers carry ADVISORY
// claim touches + suggested concept/thread slugs; nothing here writes evidence.

const TRIAGE_SYSTEM = [
  'You triage new AI research papers for The AI Atlas, a tool for staying oriented in the AI-economy debate.',
  'For each paper decide keep (worth the author\'s attention) or reject, from the title and abstract alone.',
  'KEEP a paper only when it genuinely bears on the Atlas: it is evidence for or against a listed claim or bridge-claim, it moves a listed research thread, it materially changes what a listed concept means in practice, or it is a significant capability, cost, agent-reliability, or labor-automation result that the AI-economy debate will have to absorb.',
  'REJECT the rest: incremental architecture or training tweaks, narrow domain applications, benchmark-only papers with no broader implication, and work whose relevance to the economics of AI requires a stretch. Most papers are incremental; a keep rate of a few percent is normal and correct.',
  'A strong venue signal in the comment field (accepted at a major conference) or an unusually strong result can justify keeping a borderline paper. When genuinely unsure whether a result is material, keep it: the human makes the final call.',
  'For each KEPT paper: summary = 1-2 plain-language sentences on what the paper claims and shows, written for a smart non-specialist deciding whether to read it (what was done, what was found, how big). Start with a capital letter, no jargon walls. reason = one short sentence on why it matters to the Atlas specifically (distinct from the summary). claim_codes = ONLY codes from the provided list the paper genuinely bears on (advisory, often empty); concept_slugs = listed concepts the paper directly concerns; thread_slugs = listed threads the paper would move. Never invent a code or slug.',
  'For each REJECTED paper: summary = an empty string; reason = one short sentence. Start every reason with a capital letter. Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

const TRIAGE_CHUNK = 25;
const ABSTRACT_CLIP = 1400;

function buildSchema(codes: string[], concepts: string[], threads: string[]) {
  const strArray = (values: string[]) => ({
    type: 'array',
    items: values.length ? { type: 'string', enum: values } : { type: 'string' },
  });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            index: { type: 'integer' },
            keep: { type: 'boolean' },
            summary: { type: 'string' },
            reason: { type: 'string' },
            claim_codes: strArray(codes),
            concept_slugs: strArray(concepts),
            thread_slugs: strArray(threads),
          },
          required: ['index', 'keep', 'summary', 'reason', 'claim_codes', 'concept_slugs', 'thread_slugs'],
        },
      },
    },
    required: ['decisions'],
  };
}

interface ResearchTriageResult {
  processed: number;
  kept: number;
  rejected: number;
  remaining: number;
}

// Process ONE chunk of this run's pending papers. The chunk is CLAIMED atomically
// (claimPendingPapers) so the console can run several chunks concurrently without
// double-triaging; decisions move papers out of 'pending', so repeated calls drain
// the queue (and resume a partially-triaged run).
export async function triagePapersChunk(runId: string, chunkSize = TRIAGE_CHUNK): Promise<ResearchTriageResult> {
  await m.updateResearchRun(runId, { step: 'triage', status: 'running', error: null });

  const pending = await m.claimPendingPapers(runId, chunkSize);
  if (!pending.length) {
    await m.recomputeResearchRunCounts(runId);
    return { processed: 0, kept: 0, rejected: 0, remaining: await countPendingPapers(runId) };
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

  const list = pending
    .map((p, i) => {
      const meta = [
        p.categories.join(', '),
        p.published_at ?? '',
        p.comments ? `comment: ${p.comments.slice(0, 160)}` : '',
      ].filter(Boolean).join(' · ');
      return `[${i}] ${p.title}\n    (${meta})\n    ${(p.abstract ?? '').slice(0, ABSTRACT_CLIP)}`;
    })
    .join('\n\n');

  const out = await runStructured<{
    decisions: {
      index: number; keep: boolean; summary: string; reason: string;
      claim_codes: string[]; concept_slugs: string[]; thread_slugs: string[];
    }[];
  }>({
    // The claim/concept/thread digests are identical for every chunk of a run — they
    // ride in the SYSTEM block (cache_control'd by runStructured) so chunks 2..N read
    // them from the prompt cache. Only the paper list rides in the user message.
    system: [
      TRIAGE_SYSTEM,
      `\nARGUMENT-MAP CLAIMS & BRIDGE-CLAIMS (use ONLY these codes):\n${targetList || '(none)'}`,
      `\nCONCEPTS (use ONLY these slugs):\n${conceptList || '(none)'}`,
      `\nRESEARCH THREADS (use ONLY these slugs):\n${threadList || '(none)'}`,
    ].join('\n'),
    user: `PAPERS:\n\n${list}`,
    toolName: 'submit_triage',
    toolDescription: 'Return a keep/reject decision for every paper index.',
    schema: buildSchema(codes, conceptSlugs, threadSlugs),
    maxTokens: 4000,
    effort: 'low',
    feature: 'research_triage',
    metadata: { research_run_id: runId, papers: pending.length },
  });

  // Coerce + allow-list everything (never trust the model for codes/slugs). A missing
  // decision fails closed to reject, mirroring pipeline triage.
  const validCode = new Set(codes);
  const validConcept = new Set(conceptSlugs);
  const validThread = new Set(threadSlugs);
  const byIndex = new Map((out.decisions ?? []).map((d) => [d.index, d]));
  // Sentence-case the model's prose (it tends to write lowercase clauses).
  const sentence = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);
  let kept = 0;
  let rejected = 0;
  const keptArxiv: { id: string; arxiv_id: string }[] = [];
  for (let i = 0; i < pending.length; i++) {
    const d = byIndex.get(i);
    const keep = !!d?.keep;
    const reason = d ? sentence(String(d.reason ?? '').slice(0, 300)) : 'No decision returned';
    const summary = keep && d ? sentence(String(d.summary ?? '').slice(0, 600)) : null;
    const pick = (arr: unknown, valid: Set<string>, cap: number) =>
      Array.isArray(arr)
        ? Array.from(new Set(arr.filter((v): v is string => typeof v === 'string' && valid.has(v)))).slice(0, cap)
        : [];
    await m.setPaperTriage(pending[i].id, keep ? 'kept' : 'rejected', reason, {
      claim_touches: keep ? pick(d?.claim_codes, validCode, 6) : [],
      suggested_concepts: keep ? pick(d?.concept_slugs, validConcept, 4) : [],
      suggested_threads: keep ? pick(d?.thread_slugs, validThread, 3) : [],
    }, summary);
    if (keep) {
      kept++;
      if (pending[i].arxiv_id) keptArxiv.push({ id: pending[i].id, arxiv_id: pending[i].arxiv_id! });
    } else {
      rejected++;
    }
  }

  // Author pedigree for the kept papers (Semantic Scholar, one batch POST, no AI
  // cost) so the queue shows its day-zero quality prior. Best-effort: an S2 hiccup
  // or rate limit must never fail triage; missing values fill in on the next
  // "Refresh citations" click.
  if (keptArxiv.length) {
    try {
      const pedigree = await fetchPedigreeBatch(keptArxiv.map((p) => p.arxiv_id));
      await m.bulkUpdatePedigree(
        keptArxiv
          .map((p, j) => ({ id: p.id, count: pedigree[j].citations, hindex: pedigree[j].hindex }))
          .filter((p) => p.count != null || p.hindex != null)
      );
    } catch {
      // non-fatal by design
    }
  }

  await m.recomputeResearchRunCounts(runId);
  const remaining = await countPendingPapers(runId);
  return { processed: pending.length, kept, rejected, remaining };
}
