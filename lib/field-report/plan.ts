import { routedStructured } from '../model-route';
import { buildAskContext } from '../ask/retrieve';
import { validatePlan, type FieldReportPlan } from './core';

// The research plan (the Gemini-style step): before anything runs, the Atlas
// rewrites the question into a sharper brief the person can edit. A quick
// Atlas scan comes first so the plan names real records, positions and
// threads rather than generic topics. One structured call, no thinking (a
// plan should arrive in seconds).

const PLAN_SYSTEM = `You are the research planner for Field Report, the research-report desk of The AI Atlas, an intelligence system for the AI economy built on a map of the argument (open questions, stances, falsifiable claims, and the evidence that moves them) plus daily news, research papers, company intelligence and editorial reports. Its readers do AI transformation inside large regulated financial institutions.

Turn the person's question into a research plan a senior analyst would be glad to receive:
- title: an editorial working title, at most 12 words.
- objective: the question sharpened into what the report will actually establish, one or two sentences. Keep the person's intent; make it answerable.
- sub_questions: 3 to 5 questions that together answer the objective. Each becomes a research track and a section. Concrete, non-overlapping, ordered so the report builds.
- considerations: 2 to 4 angles the person did not ask about but should care about (second-order effects, a counter-argument, a constraint in regulated finance, a measurement problem). Say why each matters in a clause.
- atlas_focus: 2 to 5 specific things the Atlas already holds that the research will read first, named as a reader would recognize them (a position, a research thread, a kind of signal, a company's filings). Use the ATLAS SCAN below; never invent a record.
- web_gaps: 2 to 4 things the research will look for on the web because the Atlas does not hold them (a current figure, a new release, a regulator's latest statement, outside evidence).
- out_of_scope: 1 to 3 things the report will deliberately not cover.
- recommended_size: "brief" for a focused question one analyst could answer in a short memo; "full" for a broad or contested question that needs several tracks, outside evidence and an editor.

Plain language, no jargon about the Atlas's internals (never say claim, confidence, argument map, record id, or a code like 3.1). Never use an em dash.`;

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    objective: { type: 'string' },
    sub_questions: { type: 'array', items: { type: 'string' } },
    considerations: { type: 'array', items: { type: 'string' } },
    atlas_focus: { type: 'array', items: { type: 'string' } },
    web_gaps: { type: 'array', items: { type: 'string' } },
    out_of_scope: { type: 'array', items: { type: 'string' } },
    recommended_size: { type: 'string', enum: ['brief', 'full'] },
  },
  required: ['title', 'objective', 'sub_questions', 'considerations', 'atlas_focus', 'web_gaps', 'out_of_scope', 'recommended_size'],
};

export async function draftPlan(input: {
  question: string;
  context?: string | null;
  note?: string | null;
  previous?: FieldReportPlan | null;
  mode: 'admin' | 'portal';
  model: string;
  metadata: Record<string, unknown>;
}): Promise<FieldReportPlan> {
  // A quick look at what the Atlas holds, clipped: titles and the first lines
  // of the best records, so the plan's Atlas focus is real.
  let scan = '';
  try {
    const ctx = await buildAskContext(input.question, { mode: input.mode });
    scan = ctx.detail.slice(0, 6000);
  } catch {
    scan = '(the Atlas scan was unavailable; plan from the question alone)';
  }
  const user = [
    `QUESTION: ${input.question}`,
    input.context ? `EARLIER IN THE CONVERSATION:\n${input.context.slice(0, 3000)}` : '',
    input.previous ? `THE PREVIOUS PLAN (revise it):\n${JSON.stringify(input.previous)}` : '',
    input.note ? `THE PERSON'S NOTE ON WHAT TO CHANGE: ${input.note.slice(0, 1000)}` : '',
    `ATLAS SCAN (what the Atlas already holds on this question):\n${scan || '(nothing retrieved)'}`,
  ].filter(Boolean).join('\n\n');
  const out = await routedStructured<unknown>({
    model: input.model,
    system: PLAN_SYSTEM,
    user,
    toolName: 'submit_plan',
    toolDescription: 'Return the research plan.',
    schema: PLAN_SCHEMA,
    maxTokens: 2500,
    timeoutMs: 60_000,
    feature: 'field_report_plan',
    metadata: input.metadata,
  });
  const plan = validatePlan(out);
  if (typeof plan === 'string') throw new Error(`The planner returned an unusable plan: ${plan}`);
  return plan;
}
