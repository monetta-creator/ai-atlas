import Anthropic from '@anthropic-ai/sdk';
import { marked } from 'marked';
import { recordApiCall, type ApiUsage } from '../cost';
import { enforceCitations, type CitationAllowlist } from '../citations';
import { urlForms } from '../edition/pure';
import { revisionKeepsFigures } from '../savant/editor-core';
import {
  draftIssues, linkifyTags, parseReportMarkdown, provenanceShare,
  type FieldReportPlan, type FieldReportSize, type RenderedBlock, type RenderedSection,
  type ReportSectionDraft, type WebSource, type ProvenanceShare, type DraftIssue,
} from './core';
import type { TrackMemo } from './research';

// Field Report's writing leg: the writer (adaptive thinking) turns the track
// memos and the web memo into the report's markdown in a fixed outline, with
// its own reasoning inside :::analysis fences. Full adds an editor review and
// one revision round. The render step labels every paragraph by provenance,
// turns tags into numbered links and runs the citation gate.

type Effort = 'low' | 'medium' | 'high';
const isClaude5 = (model: string) => /^claude-(sonnet-5|opus-5|fable-5)/.test(model);
const thinking = (model: string, effort: Effort) => (isClaude5(model) ? { thinking: { type: 'adaptive' }, output_config: { effort } } : {});
function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey, timeout: 240_000, maxRetries: 1 });
}
const textOf = (res: Anthropic.Message) => res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();

const WRITER_SYSTEM = `You are the writer of Field Report, the research-report desk of The AI Atlas. You write a finished research report from an analyst team's memos: an Atlas research memo per track (citing Atlas records by tag) and a web memo (citing web sources as [W1], [W2]...). Your reader does AI transformation inside a large regulated financial institution and will act on what you write.

Write with a point of view, like a strong analyst: lead with what matters, weigh the evidence, say where it disagrees, and argue your own reading where the evidence runs out. Sourcing rules, which the reader relies on:
- Every sentence that reports evidence cites it, with the tag exactly as the memos show it, in square brackets right after the sentence: [signal S3], [paper P2], [item I4], [fact X1], [report R5], [history H6], [claim 3.1], [bridge B5], [question some-slug], [W4]. Never invent a tag or change its number.
- The Atlas records come first; use the web to fill gaps, add current figures, or bring in what the Atlas lacks.
- Your OWN reasoning (an inference, a judgment, a recommendation, a synthesis that goes beyond what a source says) goes inside a fenced block that starts with a line ":::analysis" and ends with a line ":::". Put each such paragraph in its own block. Anything outside those blocks must be supported by a citation.
- Use only figures that appear in the memos. Never write the words claim, confidence, argument map, record id, tool, memo, track, or web pass, or a bare code like 3.1 in prose; never describe the research process ("the memos found", "the web pass"). Say what the evidence shows, and name a source by what it is ("Bank of America's disclosures", "a Gartner survey"). "The Atlas" may be named as a source of records. Never use an em dash; use a comma, a colon, or separate sentences.

Output GitHub markdown only, exactly this outline, each section opened by a "## " heading and nothing before the first heading:
## Summary
Five bullets ("- "), each one sentence, the report's answer first, each cited or marked analysis by ending with "(analysis)".
## <one section per research track, titled as a plain-language heading for that track, in track order>
## New considerations
## Where the evidence disagrees
## What would change this view
## Open questions
Paragraphs, not walls: 2 to 5 short paragraphs per track section. "### " subheadings are allowed inside a section.`;

export async function writeReport(input: {
  plan: FieldReportPlan;
  question: string;
  size: FieldReportSize;
  tracks: TrackMemo[];
  webMemo: string;
  web: WebSource[];
  model: string;
  effort: Effort;
  metadata: Record<string, unknown>;
}): Promise<string> {
  const c = client();
  const words = input.size === 'full' ? '2500 to 4000' : '1200 to 2000';
  const user = [
    `THE PERSON'S QUESTION: ${input.question}`,
    `THE REPORT'S OBJECTIVE: ${input.plan.objective}`,
    input.plan.considerations.length ? `CONSIDERATIONS THE PLAN RAISED: ${input.plan.considerations.join(' | ')}` : '',
    input.plan.out_of_scope.length ? `OUT OF SCOPE: ${input.plan.out_of_scope.join(' | ')}` : '',
    ...input.tracks.map((t) => `ATLAS MEMO, TRACK ${t.track} (${t.question}):\n${t.memo}`),
    input.webMemo ? `WEB MEMO:\n${input.webMemo}` : 'WEB MEMO: (no web research this run)',
    input.web.length ? `WEB SOURCES (cite by id):\n${input.web.map((s) => `[${s.id}] ${s.title}`).join('\n')}` : '',
    `Write the report now: ${words} words, following the outline and every sourcing rule.`,
  ].filter(Boolean).join('\n\n');
  const t = Date.now();
  const res = await c.messages.create({
    model: input.model, max_tokens: 32_000, system: WRITER_SYSTEM,
    messages: [{ role: 'user', content: user }], ...thinking(input.model, input.effort),
  } as Anthropic.MessageCreateParamsNonStreaming);
  await recordApiCall({ feature: 'field_report_write', model: input.model, usage: res.usage as ApiUsage, wallMs: Date.now() - t, metadata: { ...input.metadata, leg: 'write' } });
  return textOf(res).replace(/\s*—\s*/g, ', ');
}

// ---- the editor (Full) ----------------------------------------------------------------------
export interface EditorVerdict { name: string; verdict: 'publish' | 'publish_with_edits' | 'hold'; edits: string[]; cuts: string[]; note: string }
const EDITOR_NAME = 'The field editor';
const EDITOR_TOOL: Anthropic.Tool = {
  name: 'submit_review',
  description: 'Return the editorial review.',
  input_schema: {
    type: 'object', additionalProperties: false,
    properties: {
      verdict: { type: 'string', enum: ['publish', 'publish_with_edits', 'hold'] },
      required_edits: { type: 'array', items: { type: 'string' }, description: 'specific edits, each naming the section' },
      cuts: { type: 'array', items: { type: 'string' }, description: 'sentences or passages to cut, quoted by their first words' },
      note: { type: 'string', description: 'a signed editor\'s note for the reader, two or three sentences, plain and candid' },
    },
    required: ['verdict', 'required_edits', 'cuts', 'note'],
  },
};

export async function reviewDraft(input: { draft: string; issues: DraftIssue[]; question: string; model: string; effort: Effort; metadata: Record<string, unknown> }): Promise<EditorVerdict> {
  const c = client();
  const t = Date.now();
  const res = await c.messages.create({
    model: input.model, max_tokens: 8000,
    system: `You are the editor of Field Report, the research-report desk of The AI Atlas. You read a draft report before it goes to a senior reader in regulated finance. Check: does it answer the question it was asked; is every evidential sentence cited; is the writer's own reasoning inside analysis blocks rather than dressed as fact; does it overstate what a source says; is anything padded, repeated or vague; is the "What would change this view" section concrete. Be specific and brief. Never use an em dash.`,
    tools: [EDITOR_TOOL], tool_choice: { type: 'tool', name: 'submit_review' },
    messages: [{ role: 'user', content: `QUESTION: ${input.question}\n\nAUTOMATED CHECKS FOUND:\n${input.issues.map((i) => `- ${i.section}: ${i.issue}`).join('\n') || '- nothing'}\n\nDRAFT:\n${input.draft}` }],
    ...thinking(input.model, input.effort),
  } as Anthropic.MessageCreateParamsNonStreaming);
  await recordApiCall({ feature: 'field_report_editor', model: input.model, usage: res.usage as ApiUsage, wallMs: Date.now() - t, metadata: { ...input.metadata, leg: 'editor' } });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const o = (use?.input ?? {}) as { verdict?: string; required_edits?: unknown; cuts?: unknown; note?: string };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 12) : []);
  return {
    name: EDITOR_NAME,
    verdict: o.verdict === 'publish' || o.verdict === 'hold' ? o.verdict : 'publish_with_edits',
    edits: list(o.required_edits),
    cuts: list(o.cuts),
    note: String(o.note ?? '').replace(/\s*—\s*/g, ', ').slice(0, 800),
  };
}

export async function reviseDraft(input: { draft: string; review: EditorVerdict; model: string; effort: Effort; metadata: Record<string, unknown> }): Promise<string> {
  if (!input.review.edits.length && !input.review.cuts.length) return input.draft;
  const c = client();
  const t = Date.now();
  const res = await c.messages.create({
    model: input.model, max_tokens: 32_000, system: WRITER_SYSTEM,
    messages: [{
      role: 'user',
      content: `Revise this report to apply the editor's edits and cuts. Keep the outline, every citation tag, and every :::analysis fence rule. Do not add any figure that is not already in the draft. Return the full revised report in the same markdown format.\n\nEDITS:\n${input.review.edits.map((e) => `- ${e}`).join('\n') || '- none'}\n\nCUTS:\n${input.review.cuts.map((e) => `- ${e}`).join('\n') || '- none'}\n\nDRAFT:\n${input.draft}`,
    }],
    ...thinking(input.model, input.effort),
  } as Anthropic.MessageCreateParamsNonStreaming);
  await recordApiCall({ feature: 'field_report_revise', model: input.model, usage: res.usage as ApiUsage, wallMs: Date.now() - t, metadata: { ...input.metadata, leg: 'revise' } });
  const revised = textOf(res).replace(/\s*—\s*/g, ', ');
  // A revision that adds a number the draft never stated is thrown out.
  if (!revised.includes('## ') || !revisionKeepsFigures(input.draft, revised)) return input.draft;
  return revised;
}

// ---- rendering: provenance, links, the gate -------------------------------------------------
export function buildAllowlist(tagHrefs: Map<string, string>, codeHrefs: Map<string, string>, web: WebSource[]): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const [tag, href] of tagHrefs) for (const f of urlForms(href)) { hrefs.add(f); tagByHref.set(f, tag); }
  for (const [code, href] of codeHrefs) { hrefs.add(href); tagByHref.set(href, code); }
  for (const w of web) for (const f of urlForms(w.url)) { hrefs.add(f); tagByHref.set(f, w.id); }
  return { hrefs, tagByHref };
}

export interface RenderedReport {
  summary: RenderedBlock[];
  sections: RenderedSection[];
  provenance: ProvenanceShare;
  issues: DraftIssue[];
  dropped: string[];
}

export function renderReport(markdown: string, maps: { tagHrefs: Map<string, string>; codeHrefs: Map<string, string>; web: WebSource[] }): RenderedReport {
  const drafts: ReportSectionDraft[] = parseReportMarkdown(markdown);
  const issues = draftIssues(drafts);
  const webHrefs = new Map(maps.web.map((w) => [w.id, w.url]));
  const allow = buildAllowlist(maps.tagHrefs, maps.codeHrefs, maps.web);
  const used = new Map<string, number>(); // one footnote numbering across the whole report
  const dropped = new Set<string>();
  const render = (s: ReportSectionDraft): RenderedSection => ({
    key: s.key,
    title: s.title,
    blocks: s.blocks.map((b) => {
      const markedAnalysis = /\(analysis\)\s*$/i.test(b.md.trim());
      const md = linkifyTags(b.md.replace(/\s*\(analysis\)/gi, ''), { tagHrefs: maps.tagHrefs, codeHrefs: maps.codeHrefs, webHrefs }, used);
      const raw = b.kind === 'h3' ? `<h3>${md}</h3>` : (marked.parse(md, { async: false }) as string);
      const gated = enforceCitations(raw, allow);
      for (const d of gated.dropped) dropped.add(d);
      return { kind: b.kind, html: gated.html ?? '', prov: markedAnalysis ? 'analysis' : b.prov };
    }),
  });
  const rendered = drafts.map(render);
  const summaryIdx = rendered.findIndex((s) => s.key === 'summary');
  const summary = summaryIdx >= 0 ? rendered[summaryIdx].blocks : [];
  const sections = rendered.filter((_, i) => i !== summaryIdx);
  return { summary, sections, provenance: provenanceShare(rendered), issues, dropped: [...dropped] };
}
