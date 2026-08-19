import { marked } from 'marked';
import { runStructured } from './dossier';
import { SIGNAL_LENS_LABEL } from './format';
import type { ReportFunnel, ReportMetrics, ReportRange, ReportTouch, Signal, SignalLens } from './types';

// Phase 2/3: AI narrative generation. Same template as lib/summary.ts / lib/landscape.ts
// — a single forced-tool, non-web runStructured call (claude-sonnet-4-6, effort medium);
// metrics are computed in code, the model only narrates. Voice: senior equity analyst —
// confident, editorial, a clear point of view, tight paragraphs + bullets. The model
// returns MARKDOWN, which is converted to HTML once (the Phase-3 editor edits HTML and
// Phase 4 renders HTML to PDF). All source URLs and claim detail links are handed in and
// preserved. Generation is decomposed: one call per active lens (scoped to that lens's
// signals), then one synthesis call over the full set + the lens summaries.
//
// Kept SEPARATE from lib/report.ts (which the RSC /report page imports) so the markdown→
// HTML conversion lives only in the 'use server' actions path. We use `marked` (a tiny
// pure-JS parser) rather than react-dom/server's renderToStaticMarkup — the latter is
// forbidden anywhere in Next's Server-Component graph, which includes actions.ts.

const ANALYST_VOICE =
  `Write like a senior equity analyst briefing an investment committee: confident and ` +
  `editorial, with a clear point of view — not a neutral summary. Mix tight paragraphs ` +
  `with bullet lists. Be selective and concise — lead with the few things that matter, ` +
  `not an exhaustive recap. Do NOT begin with a heading or restate the section title — it ` +
  `is added separately; start directly with the analysis. Output GitHub-flavored MARKDOWN. ` +
  `Cite each development's source as a markdown link using the EXACT url provided ` +
  `(e.g. [outlet](https://…)). When you reference a claim or bridge-claim, describe in plain ` +
  `language what it asserts (paraphrase its statement) and put its index code in parentheses, ` +
  `linking that whole phrase to the EXACT href — e.g. [margins hold at the application layer ` +
  `(3.3)](/claim/3.3) or [compute is the binding constraint (B1)](/bridge/B1). NEVER refer to ` +
  `a claim by its bare code alone — a reader may not know the codes. Never invent a number, a ` +
  `URL, an href, or a development that is not in the data below. Use only the figures given. ` +
  `Never use an em dash in your output; use a comma, a colon, or separate sentences instead.`;

// Render the model's markdown to HTML once, server-side. HTML is the canonical narrative
// format from here on (the Phase-3 editor edits HTML; Phase 4 renders it to PDF).
function markdownToHtml(md: string): string {
  if (!md.trim()) return '';
  return marked.parse(md, { async: false }) as string;
}

// Drop a leading heading the model may still emit despite the prompt — the section/lens
// title is rendered once by the app, so a leading "## Market & Valuation" would duplicate it.
const stripLeadingHeading = (html: string) => html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');
const toBodyHtml = (md: string) => stripLeadingHeading(markdownToHtml(md));

const pct = (r: number | null) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);

function fmtSignals(signals: Signal[]): string {
  if (!signals.length) return '  (no published signals in range)';
  return signals
    .map((s) => {
      const src = s.source_url
        ? `[${s.source_title || s.source_url}](${s.source_url})`
        : s.source_title || '(no source link)';
      const touches = s.claim_touches.length ? s.claim_touches.join(', ') : 'none';
      return `- **${s.title}** (${s.significance}) — ${s.summary ?? '(no summary)'}\n    source: ${src} · touches: ${touches}`;
    })
    .join('\n');
}

function fmtTouches(touches: ReportTouch[]): string {
  if (!touches.length) return '  (no claims or bridge-claims touched in range)';
  return touches
    .map((t) => `- [${t.code}](${t.href}) — ${t.statement} (${t.signal_count} signal${t.signal_count === 1 ? '' : 's'})`)
    .join('\n');
}

function fmtFunnel(f: ReportFunnel): string {
  const c = f.counts;
  return (
    `${c.candidates} candidates · ${c.approved} approved · ${c.drafted} drafted · ${c.published} published · ` +
    `triage pass ${pct(f.rates.triagePass)} · analysis conversion ${pct(f.rates.analysisConversion)} · ` +
    `discovery→signal ${pct(f.rates.discoveryToSignal)} · draft→published ${pct(f.rates.draftToPublished)}`
  );
}

const CALLOUT_INSTRUCTION =
  `Also provide "callout": the SINGLE most important takeaway or main idea of this section, ` +
  `as one punchy sentence (≤ ~16 words) for a highlighted callout box — PLAIN TEXT only, no ` +
  `markdown, no links, no markup. If the section has no single standout takeaway worth ` +
  `calling out, return an empty string.`;

const LENS_SYSTEM =
  `You are writing ONE lens section of a periodic AI-economy intelligence report for a ` +
  `financial-institution audience. You receive only the developments ("signals") filed ` +
  `under this one lens for the period, the claims/bridge-claims they bear on, and the ` +
  `discovery-pipeline funnel for the lens. Produce the section body for THIS lens only: ` +
  `lead with the through-line, then cover the material developments and what they imply, ` +
  `weaving in the claims they touch. ALWAYS END the section with a decisive bottom line: a ` +
  `final standalone paragraph that begins with "**Bottom line:**" (bold) and states the ` +
  `single investment-relevant takeaway for this lens — what it means and what to do or watch. ` +
  `Keep the section to roughly 200–350 words. ${CALLOUT_INSTRUCTION} ${ANALYST_VOICE}`;

const LENS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { narrative: { type: 'string' }, callout: { type: 'string' } },
  required: ['narrative', 'callout'],
};

// One lens, scoped to that lens's signals only. Returns the section HTML + a suggested
// plain-text callout (the editor may edit/remove it before export).
export async function generateLensNarrative(input: {
  lens: SignalLens;
  range: ReportRange;
  signals: Signal[];
  funnel: ReportFunnel;
  touches: ReportTouch[];
}): Promise<{ narrative: string; callout: string }> {
  const user = [
    `LENS: ${SIGNAL_LENS_LABEL[input.lens]}`,
    `PERIOD: ${input.range.from} to ${input.range.to} (inclusive)`,
    '',
    `PIPELINE (authoritative — use these exact numbers): ${fmtFunnel(input.funnel)}`,
    '',
    `DEVELOPMENTS UNDER THIS LENS (${input.signals.length}):`,
    fmtSignals(input.signals),
    '',
    `CLAIMS & BRIDGE-CLAIMS THESE DEVELOPMENTS TOUCH:`,
    fmtTouches(input.touches),
  ].join('\n');

  const out = await runStructured<{ narrative?: string; callout?: string }>({
    system: LENS_SYSTEM,
    user,
    toolName: 'submit_lens_section',
    toolDescription: 'Return the markdown narrative and a plain-text callout for this lens.',
    schema: LENS_SCHEMA,
    maxTokens: 1300,
    effort: 'medium',
    feature: 'report_lens',
    metadata: { lens: input.lens },
    // Near-cap: one attempt inside the 60s route window; the client orchestrator retries
    // a failed lens on a fresh invocation (mirrors lib/pipeline/analysis.ts).
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  return { narrative: toBodyHtml(String(out.narrative ?? '')), callout: String(out.callout ?? '').trim() };
}

const SYNTH_SYSTEM =
  `You are writing the top of a periodic AI-economy intelligence report for a ` +
  `financial-institution audience. You receive the full set of developments for the ` +
  `period across all covered lenses, the overall discovery-pipeline funnel, the full set ` +
  `of claims/bridge-claims touched, and the already-written per-lens sections. Produce ` +
  `two things. macro_survey — the PERIOD SUMMARY: the cross-lens executive read — the big ` +
  `picture, the one or two things that matter most this period, the tensions between lenses, ` +
  `and your call on what to watch; synthesize across the per-lens sections rather than ` +
  `repeating them. claims_recap: a recap of which claims and bridge-claims moved — what the ` +
  `period's developments imply for them, leaning on the touch counts. ` +
  `Keep macro_survey to ~250–350 words and claims_recap to ~150–250 words. ` +
  `Also provide report_title: a short, vivid editorial headline for the whole report ` +
  `(≤ 8 words) that captures the period's through-line, like a magazine cover line. Plain ` +
  `text only — no date, no markdown, no quotes, and do not include the words "AI Atlas". ${ANALYST_VOICE}`;

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

// Synthesis: full signal set + all lens summaries → period summary + claims recap.
// (Callouts are per-lens only now — gathered into the summary-page grid — so synthesis no
// longer produces section callouts.)
export async function synthesizeReport(input: {
  range: ReportRange;
  lenses: SignalLens[];
  signals: Signal[];
  metrics: ReportMetrics;
  touches: ReportTouch[];
  lensSummaries: { lens: SignalLens; narrative: string }[];
}): Promise<{ macroSurvey: string; claimsRecap: string; title: string }> {
  const lensSections = input.lensSummaries.length
    ? input.lensSummaries
        .map((s) => `### ${SIGNAL_LENS_LABEL[s.lens]}\n${s.narrative}`)
        .join('\n\n')
    : '  (no lens sections were produced)';

  const user = [
    `PERIOD: ${input.range.from} to ${input.range.to} (inclusive)`,
    `LENSES COVERED: ${input.lenses.map((l) => SIGNAL_LENS_LABEL[l]).join(', ')}`,
    '',
    `OVERALL PIPELINE (authoritative — use these exact numbers): ${fmtFunnel(input.metrics.overall)}`,
    '',
    `ALL DEVELOPMENTS THIS PERIOD (${input.signals.length}):`,
    fmtSignals(input.signals),
    '',
    `ALL CLAIMS & BRIDGE-CLAIMS TOUCHED:`,
    fmtTouches(input.touches),
    '',
    `PER-LENS SECTIONS (already written — synthesize across them, do not repeat verbatim):`,
    lensSections,
  ].join('\n');

  const out = await runStructured<{ macro_survey?: string; claims_recap?: string; report_title?: string }>({
    system: SYNTH_SYSTEM,
    user,
    toolName: 'submit_synthesis',
    toolDescription: 'Return the period summary, claims recap, and an editorial report title.',
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
