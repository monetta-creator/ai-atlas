import { runStructured } from './dossier';
import type { SignalBrief, SignalCounterpoint, Direction } from './types';

// Server-only. One forced, non-web Anthropic call (via runStructured) that turns a
// signal into two cached reader-facing artifacts: a deep-dive BRIEFING that expands the
// one-paragraph summary into structure, and a COUNTERPOINT that steelmans the opposing
// read. The model narrates ONLY over what it is given (the summary, the source text, and
// the claims the signal touches), mirroring the "use only what is provided" discipline in
// lib/summary.ts. Both halves come back from a single call so the admin presses one button.

export interface SignalAnalysisTouch {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  test: string | null;
  direction: Direction | null;
}

interface SignalAnalysisInput {
  title: string;
  summary: string | null;
  source_title: string | null;
  source_text: string | null;
  touches: SignalAnalysisTouch[];
}

interface SignalAnalysis {
  brief: SignalBrief;
  counterpoint: SignalCounterpoint;
}

const SYSTEM = `You are an analyst for The AI Atlas, a tool for staying oriented in the debate about AI and the economy. You are handed ONE tracked development (a "signal") and asked to help a reader understand it in depth, without them having to open the source or rely on a single short summary.

Produce two things from the material provided, and nothing else:

1) BRIEFING: expand the development into four parts:
   - what_happened: the development itself, in plain, concrete prose. No hype.
   - why_it_matters: the stakes, what it changes or pressures. Tie it to the claims it touches where relevant.
   - whats_contested: where reasonable, informed readers still disagree about its meaning or weight. The Atlas maps an unsettled debate, so name the live disagreement honestly.
   - what_to_watch: 2 to 4 concrete, checkable signposts that would tell a reader how this is developing next.

2) COUNTERPOINT: the honest other side:
   - the_other_read: the strongest steelman of the OPPOSING interpretation of this same development. Argue it in good faith, not as a strawman.
   - what_would_deflate: 2 to 4 concrete things that, if true or if they happened, would shrink this signal's significance. Specific and falsifiable, not vague hedges.

Hard rules:
- Ground everything ONLY in the provided material (the title, summary, source text, and touched claims). Do NOT add facts, numbers, dates, names, or events that are not present. An honest, shorter answer beats an invented detail. Fabrication is the worst outcome.
- If the source text is thin or absent, work from the summary and the touched claims and keep claims modest.
- Be neutral and specific. Do not declare a winner in a contested debate.
- Never use an em dash. Use a comma, a colon, or separate sentences instead.

Analyze the material, then call submit_analysis exactly once with the complete structured result.`;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    brief: {
      type: 'object',
      additionalProperties: false,
      properties: {
        what_happened: { type: 'string' },
        why_it_matters: { type: 'string' },
        whats_contested: { type: 'string' },
        what_to_watch: { type: 'array', items: { type: 'string' } },
      },
      required: ['what_happened', 'why_it_matters', 'whats_contested', 'what_to_watch'],
    },
    counterpoint: {
      type: 'object',
      additionalProperties: false,
      properties: {
        the_other_read: { type: 'string' },
        what_would_deflate: { type: 'array', items: { type: 'string' } },
      },
      required: ['the_other_read', 'what_would_deflate'],
    },
  },
  required: ['brief', 'counterpoint'],
};

const DIR_LABEL: Record<Direction, string> = {
  supports: 'this development supports the claim',
  contradicts: 'this development contradicts the claim',
  neutral: 'this development bears on the claim',
};

function buildUser(input: SignalAnalysisInput): string {
  const touches = input.touches.length
    ? input.touches
        .map((t) => {
          const kind = t.type === 'bridge_claim' ? 'bridge-claim' : 'claim';
          const dir = t.direction ? ` (${DIR_LABEL[t.direction]})` : '';
          const test = t.test ? ` Falsified if: ${t.test}` : '';
          return `[${t.code}] ${kind}: ${t.statement}${dir}.${test}`;
        })
        .join('\n')
    : '(this signal is not linked to any claim or bridge-claim)';

  // Cap the source text like the dossier does: profiling does not need the whole document
  // and long input pushes the call toward the function timeout.
  const MAX_TEXT = 24000;
  const text = (input.source_text ?? '').trim();
  const body = text
    ? `\n\n--- SOURCE TEXT${text.length > MAX_TEXT ? ' (truncated for length)' : ''} ---\n${text.slice(0, MAX_TEXT)}`
    : '\n\n(No source text is available. Work from the title, summary, and touched claims, and keep claims modest about what you could not read.)';

  return `DEVELOPMENT TITLE: ${input.title}
${input.source_title ? `SOURCE: ${input.source_title}\n` : ''}SUMMARY (the one-paragraph summary to expand): ${input.summary || '(none provided)'}

CLAIMS THIS DEVELOPMENT TOUCHES ON THE ARGUMENT MAP:
${touches}${body}`;
}

export async function generateSignalAnalysis(input: SignalAnalysisInput): Promise<SignalAnalysis> {
  const out = await runStructured<SignalAnalysis>({
    system: SYSTEM,
    user: buildUser(input),
    toolName: 'submit_analysis',
    toolDescription: 'Submit the completed signal briefing and counterpoint as structured JSON.',
    schema: ANALYSIS_SCHEMA,
    maxTokens: 4000,
    effort: 'medium',
    feature: 'signal_analysis',
  });
  // strict:true constrains the shape; this just guards against missing arrays before persist.
  return {
    brief: {
      what_happened: String(out.brief?.what_happened ?? ''),
      why_it_matters: String(out.brief?.why_it_matters ?? ''),
      whats_contested: String(out.brief?.whats_contested ?? ''),
      what_to_watch: Array.isArray(out.brief?.what_to_watch) ? out.brief.what_to_watch.map(String) : [],
    },
    counterpoint: {
      the_other_read: String(out.counterpoint?.the_other_read ?? ''),
      what_would_deflate: Array.isArray(out.counterpoint?.what_would_deflate)
        ? out.counterpoint.what_would_deflate.map(String)
        : [],
    },
  };
}
