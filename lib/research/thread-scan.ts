import { runStructured } from '../dossier';
import { q } from '../db';
import * as m from '../mutations';
import { getThreadDigest } from '../data';
import type { ResearchThreadScan, ThreadRecommendation } from '../types';

// The thread gap scan (mirrors concept_gap_scan / argument_gap_scan): one
// restraint-biased model call reads the recent kept papers and the existing
// threads, and argues for AT MOST a few missing threads. Recommend-only; the
// scan persists in the research_thread_scan singleton, is reconciled against
// live slugs on read, and "Create thread" on a card is the human commit.

const SCAN_SYSTEM = [
  'You look for MISSING research threads in the Strategy Atlas research section. A thread is a frontier question that tracked papers keep bearing on.',
  'You are given the existing threads and the recent papers that survived triage. Recommend a new thread ONLY when several recent papers clearly cluster around a question no existing thread covers. Recommending nothing is a normal outcome.',
  'Never propose a thread that overlaps an existing one: if papers fit an existing thread, they belong there.',
  'For each recommendation: slug (kebab-case, short), title (the question as a short phrase), question (one full sentence), argument (2-3 sentences naming the specific papers that motivated it). At most 3.',
  'Never use an em dash anywhere; use a comma, a colon, or separate sentences instead.',
].join(' ');

const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          question: { type: 'string' },
          argument: { type: 'string' },
        },
        required: ['slug', 'title', 'question', 'argument'],
      },
    },
  },
  required: ['recommendations'],
};

export async function diagnoseThreadGaps(): Promise<ResearchThreadScan> {
  const threads = await getThreadDigest();
  const papers = await q<{ title: string; arxiv_id: string | null; triage_reason: string | null; suggested_threads: string[] }>(
    `select title, arxiv_id, triage_reason, suggested_threads
       from papers
      where triage_status = 'kept' and review_status <> 'dismissed'
        and created_at > now() - interval '90 days'
      order by published_at desc nulls last
      limit 120`
  );

  const threadList = threads.map((t) => `[${t.slug}] ${t.title}: ${t.question}`).join('\n');
  const paperList = papers
    .map((p) => `- ${p.title}${p.triage_reason ? ` (${p.triage_reason})` : ''}${p.suggested_threads.length ? ` [fits: ${p.suggested_threads.join(', ')}]` : ' [fits no existing thread]'}`)
    .join('\n');

  const out = await runStructured<{ recommendations: ThreadRecommendation[] }>({
    system: `${SCAN_SYSTEM}\n\nEXISTING THREADS (never duplicate these):\n${threadList || '(none)'}`,
    user: `RECENT KEPT PAPERS (${papers.length}):\n${paperList || '(none)'}`,
    toolName: 'submit_thread_gaps',
    toolDescription: 'Return the recommended missing threads (possibly none).',
    schema: SCAN_SCHEMA,
    maxTokens: 2000,
    effort: 'medium',
    feature: 'research_thread_scan',
    timeoutMs: 55_000,
    maxRetries: 0,
  });

  const existing = new Set(threads.map((t) => t.slug));
  const seen = new Set<string>();
  const recommendations = (Array.isArray(out.recommendations) ? out.recommendations : [])
    .map((r) => ({
      slug: String(r.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60),
      title: String(r.title ?? '').slice(0, 120),
      question: String(r.question ?? '').slice(0, 400),
      argument: String(r.argument ?? '').slice(0, 800),
    }))
    // restraint: drop anything malformed, colliding, or unargued
    .filter((r) => r.slug && r.title && r.question && r.argument)
    .filter((r) => !existing.has(r.slug) && !seen.has(r.slug) && seen.add(r.slug))
    .slice(0, 3);

  const scan: ResearchThreadScan = { generatedAt: new Date().toISOString(), recommendations };
  await m.saveThreadScan(scan.recommendations.length ? scan : null);
  return scan;
}
