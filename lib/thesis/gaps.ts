import { runStructured } from '@/lib/dossier';
import type { GapMapContext } from '@/lib/argument-gaps';
import type { RawGapRec } from '@/lib/gaps-core';
import { GAP_DOMAINS, GAP_RELATIONS } from '@/lib/gaps-core';

// Server-only. The thesis-scoped gap proposer (the deal workflow's step 3): one
// bounded model call reads a single thesis, the claims it is mapped to, and the
// signals that matched its text without touching any mapped claim, against the
// full map, and argues for the few claims/bridges the THESIS depends on that the
// map cannot yet express. Recommend-only, same restraint discipline as the
// map-wide scan (lib/argument-gaps.ts); the shared code gate in lib/gaps-core.ts
// re-validates everything before it persists.
//
// Grounding differs from the map-wide scan: the sharpest evidence here is a leg
// of the thesis's own logic with no claim under it. `finding` must name that leg;
// matched-signal citations strengthen a recommendation but are not required
// (the validator runs with requireRef: false).

export interface ThesisGapThesis {
  statement: string;
  mappedClaims: { code: string; kind: 'claim' | 'bridge'; statement: string; test: string | null }[];
}

export interface ThesisGapSignal {
  label: string;      // the pack's S-tag, so citations resolve to real signal ids
  title: string;
  summary: string;
}

const THESIS_GAP_SYSTEM = `You audit ONE standing thesis of The AI Atlas (a tool for staying oriented in the AI-economy debate) against its Argument Map, and recommend the few claims or bridge-claims the thesis depends on that the map cannot yet express.

You are given: the thesis, the claims it is currently mapped to (in full), the existing questions / stances / claims / bridge-claims, and UNEXPLAINED SIGNALS: recent tracked developments that matched the thesis text but touch none of its mapped claims (evidence the thesis attracts that no mapped claim can absorb).

Think of the thesis as a conclusion standing on legs. Each leg is a falsifiable dependency: a claim that, if false, weakens the thesis. Ask which legs have NO adequate claim under them on the map.

What to propose:
- A CLAIM: a falsifiable, single-domain assertion the thesis depends on that no existing claim captures. It must bear on at least one existing STANCE (its home on a question), and may feed a bridge-claim.
- A BRIDGE-CLAIM: an inter-domain causal link (domain_from to domain_to) the thesis depends on, fed by existing claims.

Hard rules (restraint is the point):
- Recommending NOTHING is correct and common: a well-mapped thesis has no gaps. Never restate, split, or paraphrase an existing claim; if an existing claim could simply be EDITED or ADDED TO THE MAPPING to cover the leg, it is not a gap. If an existing UNMAPPED claim covers a leg, that is a mapping fix, not a new claim: do not propose it.
- At most 3 recommendations. Never pad. Fewer is better.
- GROUNDING IS REQUIRED. Every recommendation's grounding "finding" must name, in one sentence, the specific leg of the thesis that has no claim under it. Cite unexplained signals by their bracketed labels (e.g. [S3]) in signal_labels when they evidence the leg; leave the list empty when the gap is purely in the thesis's logic.
- A claim needs: a domain (${GAP_DOMAINS.join(' | ')}), a falsification test, and suggested_edges with at least one stance code it bears on (relation ${GAP_RELATIONS.join(' / ')}). Leave domain_from and domain_to empty.
- A bridge-claim needs: domain_from and domain_to, a test, and suggested_edges listing the existing claim codes that feed it. Leave domain empty.
- code: follow the existing convention (claims like "3.6" using the host question's number; bridges like "B5"). argument: 1 to 3 sentences making the case that the thesis is not testable without this node (the part the human judges).
- Use ONLY codes from the provided lists for suggested_edges. resolvability is optional (clean | slow | qualitative).

Never use an em dash in any text you write; use a comma, a colon, or separate sentences instead.`;

export async function diagnoseThesisGaps(
  thesis: ThesisGapThesis,
  map: GapMapContext,
  signals: ThesisGapSignal[]
): Promise<RawGapRec[]> {
  const stanceCodes = map.stances.map((s) => s.code);
  const claimCodes = map.claims.map((c) => c.code);
  const bridgeCodes = map.bridges.map((b) => b.code);
  const allEdgeCodes = [...stanceCodes, ...claimCodes, ...bridgeCodes];
  const signalLabels = signals.map((s) => s.label);

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
            domain: { type: 'string', enum: [...GAP_DOMAINS, ''] },
            domain_from: { type: 'string', enum: [...GAP_DOMAINS, ''] },
            domain_to: { type: 'string', enum: [...GAP_DOMAINS, ''] },
            resolvability: { type: 'string', enum: ['clean', 'slow', 'qualitative', ''] },
            suggested_edges: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string', enum: allEdgeCodes.length ? allEdgeCodes : [''] },
                  relation: { type: 'string', enum: GAP_RELATIONS },
                },
                required: ['code', 'relation'],
              },
            },
            argument: { type: 'string' },
            grounding: {
              type: 'object',
              additionalProperties: false,
              properties: {
                signal_labels: { type: 'array', items: { type: 'string', enum: signalLabels.length ? signalLabels : [''] } },
                finding: { type: 'string' },
              },
              required: ['signal_labels', 'finding'],
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

  const mappedBlock = thesis.mappedClaims.length
    ? thesis.mappedClaims
        .map((c) => `[${c.code}] (${c.kind}) ${c.statement}${c.test ? ` (test: ${c.test})` : ''}`)
        .join('\n')
    : '(none yet: the thesis is unmapped, so every leg it stands on is a candidate gap)';
  const questionList = map.questions.map((qn) => `Q${qn.sort} [${qn.slug}] ${qn.title}`).join('\n');
  const stanceList = map.stances.map((s) => `[${s.code}] (${s.question_slug}) ${s.title}`).join('\n');
  const claimList = map.claims.map((c) => `[${c.code}] (${c.domain ?? '?'}) ${c.statement}`).join('\n');
  const bridgeList = map.bridges.map((b) => `[${b.code}] (${b.domain_from} -> ${b.domain_to}) ${b.statement}`).join('\n');
  const signalBlock = signals.length
    ? signals.map((s) => `[${s.label}] ${s.title}${s.summary ? `: ${s.summary}` : ''}`).join('\n')
    : '(none: every matched signal touches a mapped claim)';

  const out = await runStructured<{ recommendations: RawGapRec[] }>({
    system: THESIS_GAP_SYSTEM,
    user:
      `THESIS: ${thesis.statement}\n\nMAPPED CLAIMS (the legs already covered):\n${mappedBlock}\n\n` +
      `EXISTING MAP\n\nQUESTIONS:\n${questionList}\n\nSTANCES:\n${stanceList}\n\nCLAIMS:\n${claimList}\n\nBRIDGE-CLAIMS:\n${bridgeList}\n\n` +
      `UNEXPLAINED SIGNALS (matched the thesis text, touch no mapped claim):\n${signalBlock}`,
    toolName: 'submit_thesis_gap_diagnosis',
    toolDescription: 'Return the claims / bridge-claims this thesis depends on that the map lacks (or an empty list).',
    schema,
    // Bounded for the 60s cap: one attempt, brief output; the admin re-runs on a
    // fresh invocation if it times out.
    maxTokens: 3000,
    effort: 'medium',
    timeoutMs: 55_000,
    maxRetries: 0,
    feature: 'thesis_gaps',
  });
  return out.recommendations ?? [];
}
