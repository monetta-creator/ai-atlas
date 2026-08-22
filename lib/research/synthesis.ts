import { marked } from 'marked';
import { runStructured } from '../dossier';
import { sanitizeSynthesisHtml } from '../sanitize';
import * as m from '../mutations';
import { getThreadBySlug, getThreadPapers } from '../data';

// The living synthesis page (docs/research-section.md): one bounded model call per
// admin click rewrites a thread's synthesis from its confirmed papers + the prior
// text. Never automatic on ingest; every rewrite is preserved in thread_revisions.
// Grounding rule: the synthesis may only draw on the papers provided — it narrates
// the thread's evidence, it does not import the model's own views.

const SYNTHESIS_SYSTEM = [
  'You maintain one page of a research wiki for The AI Atlas: the living synthesis of a research thread (a frontier question in the AI-economy debate).',
  'Rewrite the synthesis from the CURRENT papers listed and the prior synthesis. This is maintenance, not an essay: keep what still holds, revise what new papers change, and say plainly when papers contradict each other or when the picture has not moved.',
  'Structure (markdown, use ## headings): current state of the question in 2-4 sentences; what the papers actually show (cite papers inline by [arxiv id] or title); where the evidence conflicts or is thin; what would settle it next.',
  'Ground EVERY statement in the provided papers. Do not import outside knowledge or opinions. If the papers are few or weak, the honest synthesis says so.',
  'Voice: a careful analyst\'s working notes. No hype, no verdicts on whether AI is good or bad. 250-500 words.',
  'Never use an em dash anywhere; use a comma, a colon, or separate sentences instead.',
].join(' ');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synthesis_markdown: { type: 'string' },
  },
  required: ['synthesis_markdown'],
};

export async function updateThreadSynthesis(
  slug: string, triggerNote: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const thread = await getThreadBySlug(slug);
  if (!thread) return { ok: false, error: 'Thread not found.' };
  const papers = await getThreadPapers(thread.id);
  if (!papers.length) return { ok: false, error: 'No confirmed papers in this thread yet.' };

  const paperList = papers
    .map((p) => {
      const bits = [
        `- ${p.title} (${p.published_at ?? 'undated'}, ${p.relation})`,
        p.headline && `  finding: ${p.headline}`,
        p.effect && `  effect: ${p.effect}`,
        p.why && `  placed because: ${p.why}`,
        p.review_status === 'tracked' && p.review_note && `  the author tracks this: ${p.review_note}`,
      ].filter(Boolean);
      return bits.join('\n');
    })
    .join('\n');

  const out = await runStructured<{ synthesis_markdown: string }>({
    system: SYNTHESIS_SYSTEM,
    user: [
      `THREAD: ${thread.title}`,
      `QUESTION: ${thread.question}`,
      `\nPRIOR SYNTHESIS (may be empty):\n${thread.synthesis ? thread.synthesis.slice(0, 8000) : '(none yet)'}`,
      `\nCURRENT PAPERS (${papers.length}):\n${paperList}`,
    ].join('\n'),
    toolName: 'submit_synthesis',
    toolDescription: 'Return the rewritten thread synthesis as markdown.',
    schema: SCHEMA,
    maxTokens: 2500,
    effort: 'medium',
    feature: 'research_synthesis',
    metadata: { thread: slug, papers: papers.length },
    // One bounded call, retries on a fresh invocation (the report-generation lesson).
    timeoutMs: 55_000,
    maxRetries: 0,
  });

  const md = String(out.synthesis_markdown ?? '').trim();
  if (!md) return { ok: false, error: 'The model returned an empty synthesis.' };
  const html = sanitizeSynthesisHtml(marked.parse(md, { async: false }) as string) ?? '';
  await m.setThreadSynthesis(thread.id, html, triggerNote);
  return { ok: true };
}
