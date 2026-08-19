import { runStructured } from './dossier';
import type { QuestionSummary } from './types';
import type { SummaryInput } from './data';

// Server-only. Turns the assembled question state (+ code-computed metrics) into the
// seven-section one-pager. The model narrates; it must use the numbers it is given.
//
// Why this is TWO concurrent calls WITH a bounded retry, not one shot (the timeout
// fix). Two measured facts drove it:
//  1. Generation runs at ~34 output tok/s on claude-sonnet-4-6 with thinking disabled.
//     The `effort` knob does NOT change this ('low' and 'medium' clock the same — with
//     thinking off there is no extended reasoning to scale), so effort is just 'low'.
//     The seven sections are ~1100-1300 output tokens, i.e. a ~30s model leg AT THE
//     HEALTHY RATE — already most of the 60s function budget.
//  2. On top of that, individual requests hit unpredictable TTFT / queue STALLS of
//     ~30s (a 263-token call clocked 33s end to end). A stall plus the ~30s healthy
//     gen blows the 55s SDK timeout / 60s Vercel cap, the run dies, and it never
//     reaches ai_cost_log — which is exactly why only the ~26-33s survivors were ever
//     logged while the feature "timed out" in use.
// A stall is transient, so the real cure is a RETRY with a short per-attempt timeout
// (the second attempt almost always lands on a fast path). A single full-summary call
// is too long to retry inside 60s (27s + 27s overflows). So the sections are split
// into two groups generated concurrently (Promise.all) — each ~half the output
// (~16s healthy) — which shrinks each leg enough that a 24s-per-attempt + 1-retry
// budget fits: a stalled attempt aborts at 24s and the ~16s retry still lands well
// inside the cap. Concurrency is free here (measured: two parallel calls run at full
// independent speed). Both calls see the full question context, so every section is
// still written against the whole.

const SYSTEM_INTRO = `You write part of a structured one-page summary of the CURRENT STATE of one question in The AI Atlas — a map of where the AI-economy debate stands. You are given the question, its candidate stances, the claims (and bridge-claims linking domains) that hang off them, the relationship graph between them, per-item evidence counts, and precomputed metrics.

Confidence labels mean: settled (high), leaning, contested (genuinely open), thin (little to go on). "Resolved" ≈ settled; "contested" ≈ contested/thin.`;

const SYSTEM_RULES = `Rules: use ONLY the numbers provided (never fabricate counts). Be neutral and oriented (describe the state of the debate; don't argue a side). If something is empty (no evidence, no bridges), say so plainly. Never use an em dash in your output; use a comma, a colon, or separate sentences instead.`;

// The seven sections, split into two balanced groups generated concurrently. Each
// section: [key, instruction]. Keep groups roughly even in expected output length.
const GROUP_A: [keyof QuestionSummary, string][] = [
  ['overall_state', "what's resolved vs still contested, and where the live disagreement sits."],
  ['claims_overview', 'the claims present, including bridge-claims (the inter-domain causal links) called out distinctly.'],
  ['interdependencies', 'how claims/stances/bridges connect — which claims support or contradict which stances, what the bridge-claims tie together — based on the relationship list.'],
  ['headline', 'one neutral sentence capturing the state.'],
];
const GROUP_B: [keyof QuestionSummary, string][] = [
  ['evidence_summary', "how much evidence is attached across the question and how it's distributed (supporting vs contradicting). Use the given numbers exactly; do not invent counts."],
  ['falsifiability', "what would it take to settle the contested points — drawing on the claims' falsification tests."],
  ['patterns_and_gaps', 'notable patterns or gaps — e.g. claims with no evidence yet, one-sided evidence, untested assertions, clustering.'],
];

function systemFor(sections: [keyof QuestionSummary, string][]): string {
  const list = sections.map(([key, desc]) => `- ${key}: ${desc}`).join('\n');
  return `${SYSTEM_INTRO}\n\nWrite ONLY these sections (prose, 2–4 sentences each — tight, specific, reference claim/stance/bridge codes; the headline is one sentence):\n${list}\n\n${SYSTEM_RULES}`;
}

function schemaFor(sections: [keyof QuestionSummary, string][]): object {
  const properties: Record<string, { type: string }> = {};
  for (const [key] of sections) properties[key] = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: sections.map(([key]) => key),
  };
}

function buildPrompt(input: SummaryInput): string {
  const m = input.metrics;
  const stances = input.stances
    .map((s) => `  [${s.code}] ${s.title}${s.holder ? ` (held by ${s.holder})` : ''} — confidence: ${s.confidence_label ?? 'n/a'}; would move off: ${s.test}`)
    .join('\n');
  const claims = input.claims
    .map((c) => `  [${c.code}] ${c.statement}\n     domain: ${c.domain ?? 'n/a'} · confidence: ${c.confidence_label ?? 'n/a'} · evidence: ${c.supports} support / ${c.contradicts} contradict / ${c.neutral} neutral\n     would falsify: ${c.test ?? '(no test)'}`)
    .join('\n');
  const bridges = input.bridges.length
    ? input.bridges
        .map((b) => `  [${b.code}] ${b.statement}\n     links ${b.domain_from} → ${b.domain_to} · confidence: ${b.confidence_label ?? 'n/a'} · evidence: ${b.supports} support / ${b.contradicts} contradict / ${b.neutral} neutral\n     would falsify: ${b.test ?? '(no test)'}`)
        .join('\n')
    : '  (none)';
  const rels = input.relationships.length ? input.relationships.map((r) => `  ${r}`).join('\n') : '  (none recorded)';

  return [
    `QUESTION: ${input.question.title}`,
    input.question.summary ? `Framing: ${input.question.summary}` : '',
    input.question.primary_lens ? `Primary lens: ${input.question.primary_lens}` : '',
    '',
    `METRICS (authoritative — use these exact numbers): ${m.stances} stances · ${m.claims} claims · ${m.bridges} bridge-claims · ${m.contested} contested claims · ${m.evidence_total} evidence items (${m.supporting} supporting / ${m.contradicting} contradicting / ${m.neutral} neutral) · ${m.claims_without_evidence} claims with no evidence · ${m.one_sided} one-sided items`,
    '',
    `STANCES:\n${stances || '  (none)'}`,
    '',
    `CLAIMS:\n${claims || '  (none)'}`,
    '',
    `BRIDGE-CLAIMS:\n${bridges}`,
    '',
    `RELATIONSHIPS (from → relation → to):\n${rels}`,
  ].filter(Boolean).join('\n');
}

export async function generateQuestionSummary(input: SummaryInput): Promise<QuestionSummary> {
  const user = buildPrompt(input);
  // Each call covers half the sections but sees the full context. effort 'low'
  // (narration needs no more; same speed as 'medium' anyway). timeoutMs 24s is the
  // per-ATTEMPT cap: long enough for a healthy half (~16s), short enough to abort a
  // TTFT stall fast; maxRetries 1 then re-attempts (a stall is transient). Worst case
  // both attempts stall (~48s) still throws cleanly inside the 60s function window.
  const runGroup = (group: 'a' | 'b', sections: [keyof QuestionSummary, string][]) =>
    runStructured<Partial<QuestionSummary>>({
      system: systemFor(sections),
      user,
      toolName: 'submit_summary',
      toolDescription: 'Return the requested question-state summary sections.',
      schema: schemaFor(sections),
      maxTokens: 1200,
      effort: 'low',
      timeoutMs: 24_000,
      maxRetries: 1,
      feature: 'question_summary',
      metadata: { group },
    });

  const [a, b] = await Promise.all([runGroup('a', GROUP_A), runGroup('b', GROUP_B)]);
  const out = { ...a, ...b };
  return {
    headline: String(out.headline ?? ''),
    overall_state: String(out.overall_state ?? ''),
    claims_overview: String(out.claims_overview ?? ''),
    interdependencies: String(out.interdependencies ?? ''),
    evidence_summary: String(out.evidence_summary ?? ''),
    falsifiability: String(out.falsifiability ?? ''),
    patterns_and_gaps: String(out.patterns_and_gaps ?? ''),
  };
}
