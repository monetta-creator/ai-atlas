import { routedStructured } from '../model-route';
import { md2html, deDash, VOICE } from './write';
import type { EditorReview, SelfCompany } from './types';
import { deterministicChecks, stripTags } from './editor-core';
import type { Draft } from './editor-core';
export { deterministicChecks };
export type { Draft };

// Savant's editor (2026-09-26): the second persona. Deterministic checks
// run first (banned machinery words in prose, position codes in the open,
// em dashes, unsourced sentences about the reader organization, a lead
// outside its length, summary bullets without a link) and are handed to a
// research editor at a firm that sells to bank executives, who returns a
// verdict, required edits per section, cuts, and a signed note. One revision
// round follows (./editor.ts reviseSection): the writer rewrites only the
// sections the editor named. Fully autonomous: a "hold" verdict still
// publishes after the revision, with the editor's note saying so.

const EDITOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', description: 'publish | publish_with_edits | hold' },
    required_edits: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { section: { type: 'string', description: 'summary | lead | hypotheses | moved | peers | regulation | research | tools | missed | ahead' }, instruction: { type: 'string' } }, required: ['section', 'instruction'] } },
    cuts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { section: { type: 'string' }, quote: { type: 'string', description: 'the exact sentence to cut' }, reason: { type: 'string' } }, required: ['section', 'quote', 'reason'] } },
    note: { type: 'string', description: 'the signed editor\'s note printed in the issue, 60 to 140 words, first person, plain' },
  },
  required: ['verdict', 'required_edits', 'cuts', 'note'],
};

export async function editorReview(d: Draft, checks: string[], opts: { model: string; name: string; weekEnd: string; self: SelfCompany | null }): Promise<EditorReview> {
  const system =
    `You are ${opts.name}, the research editor at a firm that sells research to bank executives, reviewing the weekly report an ` +
    `autonomous analyst (Savant) has written. Your checklist: the bottom line comes first; every factual sentence traces to a linked ` +
    `record; nothing about the reader organization${opts.self ? ` (${opts.self.name})` : ''} reads as insider knowledge (a statement about it ` +
    `without a linked public record is cut, not softened; the one exception is the peer and market watch, whose figures are the ` +
    `Atlas's own counts of public items and filings, printed as tables in Appendix B, so its sentences need no per-sentence link); no hedging clouds; no repetition across sections; figures consistent between the ` +
    `prose and the tables; the lead answers its own hypothesis and ends with what to watch; the words claim, confidence, argument map, ` +
    `logic tree and bare position codes never appear in prose; no em dashes. You are exacting but fair: a "hold" is for a report an ` +
    `executive should not see; "publish_with_edits" names the sections to fix; "publish" needs nothing. Required edits are concrete ` +
    `instructions a writer can execute on one section. Your note is printed in the issue, signed, in your own voice: what the issue ` +
    `gets right, what you cut and why, in 60 to 140 words. Never use an em dash.`;
  const user = [
    `WEEK ENDING ${opts.weekEnd}`,
    `AUTOMATED CHECKS THAT FIRED: ${checks.length ? checks.join(' | ') : 'none'}`,
    '',
    `TITLE: ${d.title}`,
    'EXECUTIVE SUMMARY:', ...d.summary.map((s, i) => `${i + 1}. ${stripTags(s)}`),
    '', 'LEAD ANALYSIS:', d.leadMarkdown.slice(0, 12000),
    '', 'HYPOTHESES:', d.freshHtml ? `NEW: ${stripTags(d.freshHtml)}` : '(no new hypothesis)',
    ...d.readings.map((r) => `- ${r.direction.toUpperCase()}: ${r.statement}: ${stripTags(r.html)}`),
    '', ...d.departments.flatMap((x) => [`## ${x.title}`, stripTags(x.html), '']),
  ].join('\n');
  const out = await routedStructured<Record<string, unknown>>({
    model: opts.model, system, user, toolName: 'submit_review', toolDescription: 'Return the editorial review.',
    schema: EDITOR_SCHEMA, maxTokens: 2200, timeoutMs: 150_000, feature: 'savant_editor', metadata: { week_end: opts.weekEnd },
  });
  const v = String(out.verdict ?? 'publish').toLowerCase();
  const verdict: EditorReview['verdict'] = v.includes('hold') ? 'hold' : v.includes('edit') ? 'publish_with_edits' : 'publish';
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : []);
  return {
    name: opts.name,
    verdict,
    requiredEdits: arr(out.required_edits).map((e) => ({ section: String(e.section ?? '').toLowerCase(), instruction: deDash(String(e.instruction ?? '')) })).filter((e) => e.instruction).slice(0, 8),
    cuts: arr(out.cuts).map((c) => ({ section: String(c.section ?? '').toLowerCase(), quote: String(c.quote ?? ''), reason: deDash(String(c.reason ?? '')) })).filter((c) => c.quote).slice(0, 12),
    note: deDash(String(out.note ?? '')).trim(),
    checks,
  };
}

const REVISE_SCHEMA = { type: 'object', additionalProperties: false, properties: { revised_md: { type: 'string' } }, required: ['revised_md'] };

// Rewrite ONE section against the editor's instructions and cuts; the
// caller re-renders and re-gates it. Markdown in, markdown out.
export async function reviseSection(input: {
  section: string; markdown: string; instructions: string[]; cuts: string[]; model: string; weekEnd: string;
}): Promise<string> {
  const user = [
    `SECTION: ${input.section}`,
    'EDITOR\'S REQUIRED EDITS:', ...input.instructions.map((i) => `- ${i}`),
    input.cuts.length ? 'SENTENCES TO CUT:' : '', ...input.cuts.map((c) => `- ${c}`),
    '', 'CURRENT TEXT (markdown, keep every link that survives the edit exactly as written):', input.markdown,
    '', 'Return the revised section. Change only what the edits require; keep length, links and voice otherwise.',
  ].filter((l) => l !== '' || true).join('\n');
  const out = await routedStructured<{ revised_md?: unknown }>({
    model: input.model, system: `You are Savant, revising one section of your weekly report to an editor's instructions. ${VOICE}`, user,
    toolName: 'submit_revision', toolDescription: 'Return the revised section as markdown.',
    schema: REVISE_SCHEMA, maxTokens: 6000, timeoutMs: 150_000, feature: 'savant_revise', metadata: { week_end: input.weekEnd, section: input.section },
  });
  const md = typeof out.revised_md === 'string' ? deDash(out.revised_md).trim() : '';
  return md || input.markdown;
}

export { md2html };
