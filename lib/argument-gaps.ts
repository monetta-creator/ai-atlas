import { runStructured } from './dossier';
import type { Domain } from './types';
import type { RawGapRec } from './gaps-core';

export type { RawGapRec };

// Server-only. The report-grounded, restraint-biased proposer for the /map gap
// diagnosis: one bounded model call reads RECENT EVIDENCE (the latest saved
// reports + the signals behind them) against the existing Argument Map and argues
// for the few claims / bridge-claims that recent developments demand but the map
// cannot yet express. Recommend-only — a recommendation only ever pre-fills the
// authoring form; the form submit is the sole writer.
//
// Two principles, both enforced here in the prompt and again in code (the action):
//  - GROUNDED: every recommendation must cite the report/signal that motivates it.
//    A proposal that cannot point at recent evidence is not made.
//  - RESTRAINT: recommending NOTHING is correct and common. The bar is "the map
//    genuinely lacks a node the recent evidence demands", never list-filling.

const DOMAINS: Domain[] = ['capability', 'economics', 'build_out', 'market', 'labor'];
const REL_ENUM = ['supports', 'contradicts', 'depends_on']; // organizes is frame-only

export interface GapMapContext {
  questions: { slug: string; sort: number; title: string }[];
  stances: { code: string; title: string; question_slug: string }[];
  claims: { code: string; statement: string; test: string | null; domain: string | null }[];
  bridges: { code: string; statement: string; domain_from: string; domain_to: string }[];
}

export interface GapGrounding {
  reports: { label: string; title: string; text: string }[];
  signals: { label: string; title: string; summary: string; touches: string[] }[];
}

const GAP_SYSTEM = `You audit the Argument Map of The AI Atlas (a tool for staying oriented in the AI-economy debate) against RECENT EVIDENCE, and recommend the few claims or bridge-claims that recent developments demand but the map cannot yet express.

You are given: the existing questions / stances / claims / bridge-claims, and a grounding corpus of RECENT EVIDENCE (the latest analyst reports, and recent tracked signals with the claim codes they already touch). Signals that touch NO existing claim are the sharpest gap signal: a tracked development with no home on the map.

What to propose:
- A CLAIM: a falsifiable, single-domain assertion the recent evidence raises that no existing claim captures. It must bear on at least one existing STANCE (its home on a question), and may feed a bridge-claim.
- A BRIDGE-CLAIM: an inter-domain causal link (domain_from to domain_to) the evidence raises, fed by existing claims.

Hard rules (restraint is the point):
- Recommending NOTHING is correct and common. Only propose where a recent development genuinely has no adequate home on the map. Never restate, split, or paraphrase an existing claim: if an existing claim could simply be EDITED to cover it, it is not a gap.
- At most 3 recommendations. Never pad. Fewer is better.
- GROUNDING IS REQUIRED. Every recommendation must cite, in the grounding object, the report and/or the signals it leans on (by their bracketed labels, e.g. [R1], [S3]) and a one-sentence finding: the recent development the map does not yet capture. A recommendation you cannot ground in the provided evidence must not be made.
- A claim needs: a domain (capability | economics | build_out | market | labor), a falsification test, and suggested_edges with at least one stance code it bears on (relation supports / contradicts / depends_on). Leave domain_from and domain_to empty.
- A bridge-claim needs: domain_from and domain_to, a test, and suggested_edges listing the existing claim codes that feed it. Leave domain empty.
- code: follow the existing convention (claims like "3.6" using the host question's number; bridges like "B5"). argument: 1 to 3 sentences making the case for why the map is incomplete without it (the part the human judges).
- Use ONLY codes from the provided lists for suggested_edges. resolvability is optional (clean | slow | qualitative).

Never use an em dash in any text you write; use a comma, a colon, or separate sentences instead.`;

export async function diagnoseArgumentGaps(map: GapMapContext, grounding: GapGrounding): Promise<RawGapRec[]> {
  const stanceCodes = map.stances.map((s) => s.code);
  const claimCodes = map.claims.map((c) => c.code);
  const bridgeCodes = map.bridges.map((b) => b.code);
  const allEdgeCodes = [...stanceCodes, ...claimCodes, ...bridgeCodes];
  const reportLabels = grounding.reports.map((r) => r.label);
  const signalLabels = grounding.signals.map((s) => s.label);

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['claim', 'bridge'] },
            code: { type: 'string' },
            statement: { type: 'string' },
            test: { type: 'string' },
            domain: { type: 'string', enum: [...DOMAINS, ''] },
            domain_from: { type: 'string', enum: [...DOMAINS, ''] },
            domain_to: { type: 'string', enum: [...DOMAINS, ''] },
            resolvability: { type: 'string', enum: ['clean', 'slow', 'qualitative', ''] },
            suggested_edges: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string', enum: allEdgeCodes.length ? allEdgeCodes : [''] },
                  relation: { type: 'string', enum: REL_ENUM },
                },
                required: ['code', 'relation'],
              },
            },
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
          required: [
            'kind', 'code', 'statement', 'test', 'domain', 'domain_from', 'domain_to',
            'resolvability', 'suggested_edges', 'argument', 'grounding',
          ],
        },
      },
    },
    required: ['recommendations'],
  };

  const questionList = map.questions
    .map((qn) => `Q${qn.sort} [${qn.slug}] ${qn.title}`)
    .join('\n');
  const stanceList = map.stances
    .map((s) => `[${s.code}] (${s.question_slug}) ${s.title}`)
    .join('\n');
  const claimList = map.claims
    .map((c) => `[${c.code}] (${c.domain ?? '?'}) ${c.statement}`)
    .join('\n');
  const bridgeList = map.bridges
    .map((b) => `[${b.code}] (${b.domain_from} -> ${b.domain_to}) ${b.statement}`)
    .join('\n');
  const reportBlock = grounding.reports.length
    ? grounding.reports.map((r) => `[${r.label}] ${r.title}\n${r.text}`).join('\n\n')
    : '(no recent reports)';
  const signalBlock = grounding.signals.length
    ? grounding.signals
        .map((s) => `[${s.label}] ${s.title}${s.summary ? ` — ${s.summary}` : ''}${s.touches.length ? ` (touches: ${s.touches.join(', ')})` : ' (touches: NONE)'}`)
        .join('\n')
    : '(no recent signals)';

  const out = await runStructured<{ recommendations: RawGapRec[] }>({
    system: GAP_SYSTEM,
    user:
      `EXISTING MAP\n\nQUESTIONS:\n${questionList}\n\nSTANCES:\n${stanceList}\n\nCLAIMS:\n${claimList}\n\nBRIDGE-CLAIMS:\n${bridgeList}\n\n` +
      `RECENT EVIDENCE (the grounding corpus)\n\nREPORTS:\n${reportBlock}\n\nSIGNALS:\n${signalBlock}`,
    toolName: 'submit_gap_diagnosis',
    toolDescription: 'Return the recommended missing claims / bridge-claims, grounded in recent evidence (or an empty list).',
    schema,
    // Bounded for the 60s cap (the report-generation lesson): one attempt, brief output;
    // the admin re-runs on a fresh invocation if it times out.
    maxTokens: 3000,
    effort: 'medium',
    timeoutMs: 55_000,
    maxRetries: 0,
    feature: 'argument_gaps',
  });
  return out.recommendations ?? [];
}

// Strip HTML to plain text for the grounding corpus (report narratives are stored as HTML).
export function htmlToText(html: string | null | undefined, max = 2400): string {
  if (!html) return '';
  const text = html
    .replace(/<[^>]+>/g, ' ')
    // decode the common quotes/apostrophes (named + numeric), then strip the rest
    .replace(/&#0*39;|&#x0*27;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&#0*34;|&#x0*22;|&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}
