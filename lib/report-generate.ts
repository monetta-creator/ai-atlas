import { marked } from 'marked';
import { runStructured } from './dossier';
import { SIGNAL_CONTEXT_LABEL } from './format';
import type { ReportRange, ReportTouch, Signal, SignalContext } from './types';

// Phase 2/3: AI narrative generation. A single forced-tool, non-web runStructured call
// per section; the data is computed in code, the model only narrates. Voice: a senior
// strategy analyst briefing the leadership team — confident, editorial, a clear point of
// view, tight paragraphs + bullets. The model returns MARKDOWN, which is converted to
// HTML once (the Phase-3 editor edits HTML and Phase 4 renders HTML to PDF). All source
// URLs and hypothesis links are handed in and preserved. Generation is decomposed: one
// call per selected context (scoped to that context's signals), then one synthesis call
// over the full set + the context summaries.
//
// Kept SEPARATE from lib/report.ts (which the RSC report page imports) so the markdown→
// HTML conversion lives only in the 'use server' actions path. We use `marked` (a tiny
// pure-JS parser) rather than react-dom/server's renderToStaticMarkup — the latter is
// forbidden anywhere in Next's Server-Component graph, which includes actions.ts.

const ANALYST_VOICE =
  `Write like a senior strategy analyst briefing the leadership team: confident and ` +
  `editorial, with a clear point of view — not a neutral summary. Mix tight paragraphs ` +
  `with bullet lists. Be selective and concise — lead with the few things that matter, ` +
  `not an exhaustive recap. Do NOT begin with a heading or restate the section title — it ` +
  `is added separately; start directly with the analysis. Output GitHub-flavored MARKDOWN. ` +
  `Cite each development's source as a markdown link using the EXACT url provided ` +
  `(e.g. [outlet](https://…)). When you reference a hypothesis, describe in plain ` +
  `language what it asserts (paraphrase its statement) and put its index code in parentheses, ` +
  `linking that whole phrase to the EXACT href — e.g. [automation pressure lands first in ` +
  `back-office work (H3)](/hypothesis/H3). NEVER refer to a hypothesis by its bare code ` +
  `alone — a reader may not know the codes. Never invent a number, a URL, an href, or a ` +
  `development that is not in the data below. Use only the figures given. ` +
  `Never use an em dash in your output; use a comma, a colon, or separate sentences instead.`;

// Render the model's markdown to HTML once, server-side. HTML is the canonical narrative
// format from here on (the Phase-3 editor edits HTML; Phase 4 renders it to PDF).
function markdownToHtml(md: string): string {
  if (!md.trim()) return '';
  return marked.parse(md, { async: false }) as string;
}

// Drop a leading heading the model may still emit despite the prompt — the section
// title is rendered once by the app, so a leading "## External" would duplicate it.
const stripLeadingHeading = (html: string) => html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');
const toBodyHtml = (md: string) => stripLeadingHeading(markdownToHtml(md));

function fmtSignals(signals: Signal[]): string {
  if (!signals.length) return '  (no published signals in range)';
  return signals
    .map((s) => {
      const src = s.source_url
        ? `[${s.source_title || s.source_url}](${s.source_url})`
        : s.source_title || '(no source link)';
      const touches = s.touches.length ? s.touches.join(', ') : 'none';
      return `- **${s.title}** (${s.significance}) — ${s.summary ?? '(no summary)'}\n    source: ${src} · touches: ${touches}`;
    })
    .join('\n');
}

function fmtTouches(touches: ReportTouch[]): string {
  if (!touches.length) return '  (no hypotheses touched in range)';
  return touches
    .map((t) => `- [${t.code}](${t.href}) — ${t.statement} (${t.signal_count} signal${t.signal_count === 1 ? '' : 's'})`)
    .join('\n');
}

const CALLOUT_INSTRUCTION =
  `Also provide "callout": the SINGLE most important takeaway or main idea of this section, ` +
  `as one punchy sentence (≤ ~16 words) for a highlighted callout box — PLAIN TEXT only, no ` +
  `markdown, no links, no markup. If the section has no single standout takeaway worth ` +
  `calling out, return an empty string.`;

const CONTEXT_SYSTEM =
  `You are writing ONE section of a periodic strategy intelligence report for an operating ` +
  `team tracking its strategic hypotheses. You receive only the developments ("signals") ` +
  `filed under this one context (internal = originating inside the organization, external ` +
  `= the outside world) for the period, and the hypotheses they bear on. Produce the ` +
  `section body for THIS context only: lead with the through-line, then cover the material ` +
  `developments and what they imply, weaving in the hypotheses they touch. ALWAYS END the ` +
  `section with a decisive bottom line: a final standalone paragraph that begins with ` +
  `"**Bottom line:**" (bold) and states the single decision-relevant takeaway for this ` +
  `context — what it means and what to do or watch. ` +
  `Keep the section to roughly 200–350 words. ${CALLOUT_INSTRUCTION} ${ANALYST_VOICE}`;

const CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { narrative: { type: 'string' }, callout: { type: 'string' } },
  required: ['narrative', 'callout'],
};

// One context, scoped to that context's signals only. Returns the section HTML + a
// suggested plain-text callout (the editor may edit/remove it before export).
export async function generateContextNarrative(input: {
  context: SignalContext;
  range: ReportRange;
  signals: Signal[];
  touches: ReportTouch[];
}): Promise<{ narrative: string; callout: string }> {
  const user = [
    `CONTEXT: ${SIGNAL_CONTEXT_LABEL[input.context]}`,
    `PERIOD: ${input.range.from} to ${input.range.to} (inclusive)`,
    '',
    `DEVELOPMENTS UNDER THIS CONTEXT (${input.signals.length}):`,
    fmtSignals(input.signals),
    '',
    `HYPOTHESES THESE DEVELOPMENTS TOUCH:`,
    fmtTouches(input.touches),
  ].join('\n');

  const out = await runStructured<{ narrative?: string; callout?: string }>({
    system: CONTEXT_SYSTEM,
    user,
    toolName: 'submit_context_section',
    toolDescription: 'Return the markdown narrative and a plain-text callout for this context.',
    schema: CONTEXT_SCHEMA,
    maxTokens: 1300,
    effort: 'medium',
    feature: 'report_context',
    metadata: { context: input.context },
    // One attempt per invocation; the client orchestrator retries a failed section on a
    // fresh invocation (mirrors lib/pipeline/analysis.ts).
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  return { narrative: toBodyHtml(String(out.narrative ?? '')), callout: String(out.callout ?? '').trim() };
}

const SYNTH_SYSTEM =
  `You are writing the top of a periodic strategy intelligence report for an operating ` +
  `team tracking its strategic hypotheses. You receive the full set of developments for ` +
  `the period across the covered contexts (internal and external), the full set of ` +
  `hypotheses touched, and the already-written per-context sections. Produce ` +
  `two things. macro_survey — the PERIOD SUMMARY: the cross-context executive read — the ` +
  `big picture, the one or two things that matter most this period, the tensions between ` +
  `the internal and external picture, and your call on what to watch; synthesize across ` +
  `the sections rather than repeating them. claims_recap: a recap of which hypotheses ` +
  `moved — what the period's developments imply for them, leaning on the touch counts. ` +
  `Keep macro_survey to ~250–350 words and claims_recap to ~150–250 words. ` +
  `Also provide report_title: a short, vivid editorial headline for the whole report ` +
  `(≤ 8 words) that captures the period's through-line, like a magazine cover line. Plain ` +
  `text only — no date, no markdown, no quotes, and do not include the words "Strategy Atlas". ${ANALYST_VOICE}`;

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    macro_survey: { type: 'string' },
    claims_recap: { type: 'string' },
    report_title: { type: 'string' },
  },
  required: ['macro_survey', 'claims_recap', 'report_title'],
};

// Synthesis: full signal set + all context summaries → period summary + hypotheses recap.
// (Callouts are per-context only — gathered into the summary-page grid — so synthesis no
// longer produces section callouts.)
export async function synthesizeReport(input: {
  range: ReportRange;
  contexts: SignalContext[];
  signals: Signal[];
  touches: ReportTouch[];
  contextSummaries: { context: SignalContext; narrative: string }[];
}): Promise<{ macroSurvey: string; claimsRecap: string; title: string }> {
  const contextSections = input.contextSummaries.length
    ? input.contextSummaries
        .map((s) => `### ${SIGNAL_CONTEXT_LABEL[s.context]}\n${s.narrative}`)
        .join('\n\n')
    : '  (no context sections were produced)';

  const user = [
    `PERIOD: ${input.range.from} to ${input.range.to} (inclusive)`,
    `CONTEXTS COVERED: ${input.contexts.map((c) => SIGNAL_CONTEXT_LABEL[c]).join(', ')}`,
    '',
    `ALL DEVELOPMENTS THIS PERIOD (${input.signals.length}):`,
    fmtSignals(input.signals),
    '',
    `ALL HYPOTHESES TOUCHED:`,
    fmtTouches(input.touches),
    '',
    `PER-CONTEXT SECTIONS (already written — synthesize across them, do not repeat verbatim):`,
    contextSections,
  ].join('\n');

  const out = await runStructured<{ macro_survey?: string; claims_recap?: string; report_title?: string }>({
    system: SYNTH_SYSTEM,
    user,
    toolName: 'submit_synthesis',
    toolDescription: 'Return the period summary, hypotheses recap, and an editorial report title.',
    schema: SYNTH_SCHEMA,
    maxTokens: 1800,
    effort: 'medium',
    feature: 'report_synthesis',
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  return {
    macroSurvey: toBodyHtml(String(out.macro_survey ?? '')),
    claimsRecap: toBodyHtml(String(out.claims_recap ?? '')),
    title: String(out.report_title ?? '').trim(),
  };
}
