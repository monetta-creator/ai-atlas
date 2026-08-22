import { runStructured } from './dossier';
import type { RawGapRec } from './gaps-core';

export type { RawGapRec };

// Server-only. The report-grounded, restraint-biased proposers for the gap
// diagnoses: bounded model calls that read RECENT EVIDENCE (the latest saved
// reports + recent signals) against the existing hypotheses and argue for the
// few NEW hypotheses the evidence demands but the atlas cannot yet express.
// Recommend-only — a recommendation only ever pre-fills the authoring form; the
// form submit is the sole writer.
//
// Two principles, enforced in the prompt and again in code (lib/gaps-core.ts):
//  - GROUNDED: every recommendation must cite the report/signal that motivates
//    it (the atlas-wide scan) or name the uncovered leg (the per-hypothesis scan).
//  - RESTRAINT: recommending NOTHING is correct and common.

export interface GapAtlasContext {
  hypotheses: { code: string; statement: string; test: string }[];
}

interface GapGrounding {
  reports: { label: string; title: string; text: string }[];
  signals: { label: string; title: string; summary: string; touches: string[] }[];
}

function gapSchema(reportLabels: string[], signalLabels: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            statement: { type: 'string' },
            test: { type: 'string' },
            resolvability: { type: 'string', enum: ['clean', 'slow', 'qualitative', ''] },
            argument: { type: 'string' },
            grounding: {
              type: 'object',
              additionalProperties: false,
              properties: {
                report_label: { type: 'string', enum: [...reportLabels, ''] },
                signal_labels: { type: 'array', items: { type: 'string', enum: signalLabels.length ? signalLabels : [''] } },
                finding: { type: 'string' },
              },
              required: ['report_label', 'signal_labels', 'finding'],
            },
          },
          required: ['code', 'statement', 'test', 'resolvability', 'argument', 'grounding'],
        },
      },
    },
    required: ['recommendations'],
  };
}

function hypothesisList(ctx: GapAtlasContext): string {
  return ctx.hypotheses
    .map((h) => `[${h.code}] ${h.statement} (test: ${h.test})`)
    .join('\n') || '(none yet)';
}

const GAP_SYSTEM = `You audit the hypotheses of the Strategy Atlas (a tool for staying oriented on the strategic questions an operating team is testing) against RECENT EVIDENCE, and recommend the few NEW hypotheses that recent developments demand but the atlas cannot yet express.

You are given: the existing hypotheses (each a falsifiable strategic statement with its test), and a grounding corpus of RECENT EVIDENCE (the latest analyst reports, and recent tracked signals with the hypothesis codes they already touch). Signals that touch NO existing hypothesis are the sharpest gap signal: a tracked development with no home on the atlas.

What to propose: a HYPOTHESIS — a falsifiable strategic statement the recent evidence raises that no existing hypothesis captures, with a concrete falsification test (what evidence would move it).

Hard rules (restraint is the point):
- Recommending NOTHING is correct and common. Only propose where a recent development genuinely has no adequate home. Never restate, split, or paraphrase an existing hypothesis: if an existing one could simply be EDITED to cover it, it is not a gap.
- At most 3 recommendations. Never pad. Fewer is better.
- GROUNDING IS REQUIRED. Every recommendation must cite, in the grounding object, the report and/or the signals it leans on (by their bracketed labels, e.g. [R1], [S3]) and a one-sentence finding: the recent development the atlas does not yet capture. A recommendation you cannot ground in the provided evidence must not be made.
- code: the next free H-code (e.g. "H7"). test: a concrete falsification test. argument: 1 to 3 sentences making the case for why the atlas is incomplete without it (the part the human judges). resolvability is optional (clean | slow | qualitative).

Never use an em dash in any text you write; use a comma, a colon, or separate sentences instead.`;

export async function diagnoseArgumentGaps(ctx: GapAtlasContext, grounding: GapGrounding): Promise<RawGapRec[]> {
  const reportLabels = grounding.reports.map((r) => r.label);
  const signalLabels = grounding.signals.map((s) => s.label);

  const reportBlock = grounding.reports.length
    ? grounding.reports.map((r) => `[${r.label}] ${r.title}\n${r.text}`).join('\n\n')
    : '(no recent reports)';
  const signalBlock = grounding.signals.length
    ? grounding.signals
        .map((s) => `[${s.label}] ${s.title}${s.summary ? `: ${s.summary}` : ''}${s.touches.length ? ` (touches: ${s.touches.join(', ')})` : ' (touches: NONE)'}`)
        .join('\n')
    : '(no recent signals)';

  const out = await runStructured<{ recommendations: RawGapRec[] }>({
    system: GAP_SYSTEM,
    user:
      `EXISTING HYPOTHESES:\n${hypothesisList(ctx)}\n\n` +
      `RECENT EVIDENCE (the grounding corpus)\n\nREPORTS:\n${reportBlock}\n\nSIGNALS:\n${signalBlock}`,
    toolName: 'submit_gap_diagnosis',
    toolDescription: 'Return the recommended missing hypotheses, grounded in recent evidence (or an empty list).',
    schema: gapSchema(reportLabels, signalLabels),
    maxTokens: 3000,
    effort: 'medium',
    timeoutMs: 55_000,
    maxRetries: 0,
    feature: 'argument_gaps',
  });
  return out.recommendations ?? [];
}

const HYP_GAP_SYSTEM = `You audit ONE hypothesis of the Strategy Atlas against the full hypothesis set, and recommend the few NEW hypotheses this one depends on that the atlas cannot yet express.

You are given: the hypothesis under audit (statement + test), all existing hypotheses, and UNEXPLAINED SIGNALS: recent tracked developments that matched the hypothesis text but are not linked to it as evidence (developments it attracts that nothing absorbs).

Think of the hypothesis as a conclusion standing on legs. Each leg is a falsifiable dependency: a narrower statement that, if false, weakens the conclusion. Ask which legs have NO adequate hypothesis of their own — those are candidates for promote-and-link.

Hard rules (restraint is the point):
- Recommending NOTHING is correct and common: a well-covered hypothesis has no gaps. Never restate, split, or paraphrase an existing hypothesis.
- At most 3 recommendations. Never pad. Fewer is better.
- GROUNDING IS REQUIRED. Every recommendation's grounding "finding" must name, in one sentence, the specific leg that has no hypothesis under it. Cite unexplained signals by their bracketed labels (e.g. [S3]) in signal_labels when they evidence the leg; leave the list empty when the gap is purely in the logic.
- code: the next free H-code. test: a concrete falsification test. argument: 1 to 3 sentences making the case that the audited hypothesis is not testable without this leg. resolvability is optional.

Never use an em dash in any text you write; use a comma, a colon, or separate sentences instead.`;

export async function diagnoseHypothesisGaps(
  hyp: { code: string; statement: string; test: string },
  ctx: GapAtlasContext,
  signals: { label: string; title: string; summary: string }[]
): Promise<RawGapRec[]> {
  const signalLabels = signals.map((s) => s.label);
  const signalBlock = signals.length
    ? signals.map((s) => `[${s.label}] ${s.title}${s.summary ? `: ${s.summary}` : ''}`).join('\n')
    : '(none: every matched signal is already linked as evidence)';

  const out = await runStructured<{ recommendations: RawGapRec[] }>({
    system: HYP_GAP_SYSTEM,
    user:
      `HYPOTHESIS UNDER AUDIT: [${hyp.code}] ${hyp.statement}\nTEST: ${hyp.test}\n\n` +
      `EXISTING HYPOTHESES:\n${hypothesisList(ctx)}\n\n` +
      `UNEXPLAINED SIGNALS (matched the text, not linked as evidence):\n${signalBlock}`,
    toolName: 'submit_hypothesis_gap_diagnosis',
    toolDescription: 'Return the hypotheses this one depends on that the atlas lacks (or an empty list).',
    schema: gapSchema([], signalLabels),
    maxTokens: 3000,
    effort: 'medium',
    timeoutMs: 55_000,
    maxRetries: 0,
    feature: 'hypothesis_gaps',
  });
  return out.recommendations ?? [];
}

// Strip HTML to plain text for the grounding corpus (report narratives are stored as HTML).
export function htmlToText(html: string | null | undefined, max = 2400): string {
  if (!html) return '';
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#0*39;|&#x0*27;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&#0*34;|&#x0*22;|&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}
