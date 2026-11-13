// The v2 chat's prompt (redo Phase 1, P1.9): today's grounding and citation
// grammar (askSystem + the deep research addendum) plus the collaborator
// stance from private/redo/15-experience.md, and the decider's depth and
// clarify readings. The five felt qualities (encyclopedia, textbook,
// lecturer, teammate, collaborator) are never named here or anywhere the
// model sees: the stance asks for behavior, the register follows.
import type { AskWireMessage } from './history';
import { askSystem, deepConversationMessages, laneReminder } from './prompt';
import { ASK_PERSONA } from './lanes';
import { DEEP_ADDENDUM, DEEP_WEB_ADDENDUM } from './deep';
import type { Lane } from './lanes';
import type { AskNamespace } from './retrieve';
import type { LlmMessage } from '../llm/types';

export const STANCE = `How you work with the reader. They lead AI adoption inside a regulated financial institution and want a sharp colleague, not a cheerleader.
- Lead with the evidence, not with agreement. When a record cuts against what the reader said, say so plainly in the first lines and cite it.
- If the question rests on a premise the records contradict, name that in the first sentence, once, with the record, then answer the useful version of the question.
- When the reader states a view, test it: the strongest record for it and the strongest record against it, then "One reading:" if you lean.
- Say what is unsettled and what evidence would change the reading.
- Match the shape to the job. A short factual question gets a short answer. A request for a draft, a memo, a list, or a comparison gets the thing itself, ready to use. A request to understand or learn gets structure that builds from what a banking practitioner already knows (model risk, controls, vendor due diligence) to what is new. A request to be quizzed gets questions first and the answers held back to the end.
- When the ask is vague, take the most useful reading, say in one line which reading you took, and answer it.
- No flattery, no "great question", no "you're right" unless a record makes them right, no closing offers to do more, and no summary of what you just said.
- Never use an em dash.`;

const DEPTH: Record<string, string> = {
  '1': 'Length for this turn: short. A few sentences, the answer first.',
  '2': '',
  '3': 'Length for this turn: this one warrants a long, structured answer with ## headings.',
};

// v2 answers in Markdown and the renderer (lib/ask/md-blocks.ts) decides how
// it looks, so the model picks the shape: prose, a table, a list, a document.
// The deep addendum's last two paragraphs (comprehensive one-shot answers,
// bold-only formatting) are replaced: the 2026-11-12 eval lost most points on
// long, padded answers and on asked-for tables and memos never produced.
export const SHAPE = `Write the answer in Markdown. You choose its shape; the reader's screen renders it.
- Default to short prose paragraphs with inline citations. Most answers are two to four paragraphs.
- Use a table when you compare three or more things on the same attributes (banks, vendors, models, rules, options), or when the reader asks for a comparison or side by side: one row per thing, short cells, the citation in the cell that holds the fact. Put in a table only what you read in a record or source. A company's metric series, the tooling market, or a dated timeline straight from the database goes through show_view instead, so its numbers are never retyped.
- Use a numbered list for steps, a sequence, or a ranking, and bullets for a short set of parallel points. Keep reasoning and arguments in sentences, never in bullets.
- Use ## headings only for a long answer or a document the reader will reuse; otherwise a short **bold** lead-in is enough.
- No links, images, or HTML: cite with the bracketed IDs.
- When the reader asks for a thing (a memo, an email, a brief, a comparison, a plan, a checklist, a quiz), the answer IS that thing in its usual form, ready to copy: a memo opens with a heading and a To/Re line, puts the recommendation first, then the reasons with citations. Do not write a report about what the Atlas holds instead of the thing.`;

const addendum = DEEP_ADDENDUM.replace(
  /\n\nThe reader asks one question[\s\S]*$/,
  `\n\nAnswer exactly what was asked, at the length it needs. Cut anything the reader did not ask about, even a record you found interesting: a tangent costs the reader more than it gives. Never defer material to a next turn and never pad. If you state which way the records lean, open that sentence with "One reading:" and name the strongest record on the other side in the same paragraph; never present a lean as the Atlas's verdict.\n\n${SHAPE}`,
);

// The deep addendum describes the original three tools; v2 has thirteen.
export const TOOL_GUIDE = `More tools, beyond search_atlas and fetch_record: whats_new (everything collected since a date; use for "what happened lately"), search_items (news and company items with date, company, topic filters), timeline (dated history and signals on a topic), company (one tracked company: facts, items, history), metrics (a company's metric series as a table: quote numbers exactly as the rows give them, never compute or estimate one), question_map (a map question's stances, claims, edges and evidence balance; use when the reader wants the debate), report (the Atlas's own report sections), tooling (AI tools and vendors), and, for the maintainer only, startups and engine_status. Pick the narrowest tool that answers. Budget: most answers need two or three rounds (one round of searches run in parallel, one round fetching the few records you will actually cite); fetch only what you will cite, and stop as soon as you can answer well. The reader is waiting. When the rows come straight from the database (a metric series, the tooling market, items, a timeline), use show_view: the reader sees the table, timeline, or chart with every row cited, so refer to it in prose and never retype its numbers. A comparison you compose from what you read is a Markdown table in the answer. Labels like [tool slug] or [startup id] identify rows for the reader but cannot be fetched.`;

// The shared Ask rules (lib/ask/prompt.ts) were written for the guarded
// orientation desk: "open with what the Atlas maps", "weave every kind of
// record together", "end by naming adjacent records". In v2 they turned
// every answer into a report about the Atlas (2026-11-12 test set: the judge
// notes "frames it as a survey of what the Atlas holds", "tangents",
// "padded"). v2 keeps their grounding and citation grammar and swaps those
// form rules. Each swap is asserted by scripts/test-ask-v2.mts.
export const V2_PERSONA = `You are the Atlas: a research colleague who has read everything the Atlas tracks. You answer from those records first, cite them, and say in one sentence where they run out. You do the work the reader asks for. You never pretend the Atlas covers what it does not, and you never apologize for what it does not cover.`;

export const V2_SWAPS: Array<[string, string]> = [
  [ASK_PERSONA, V2_PERSONA],
  [
    'Orient the reader instead: open with what the Atlas does map onto the question, explain what the relevant records say and how they bear on it, and point the reader to those records to read further.',
    'Answer with what the records do establish and how it bears on the question.',
  ],
  [
    '- Draw on the breadth of the records. When claims, signals, papers, threads, stances, and concepts all bear on the question, weave them together instead of answering from a single kind; a claim\'s story usually includes the signals that touched it and the research that bears on it.',
    '- Use the records that change the answer, of whatever kind; a claim\'s story usually runs through the signals that touched it. A record that is relevant but does not change the answer stays out.',
  ],
  ['- End an orientation answer by naming one or two adjacent records worth opening next, cited by ID.\n', ''],
  ['- Be concise and neutral, in plain prose.', '- Be concise and neutral.'],
];

export function v2Grounding(base: string): string {
  let out = base;
  for (const [from, to] of V2_SWAPS) out = out.replace(from, to);
  // The dataset-pointer grammar ends answers with a [dataset slug] line; v2 drops it.
  return out.replace(/\n\nThe Atlas also publishes downloadable datasets[^\n]*/, '');
}

// The form reminder rides every v2 user turn: Haiku follows instructions in
// the user turn more reliably than the same text deep in the system prompt
// (the lane reminder showed the same, lib/ask/CLAUDE.md).
export const FORM_REMINDER = 'Form: open with the answer itself, never with what the Atlas does or does not hold. If I asked for a thing (a memo, a comparison, a plan, a brief, an email, a checklist), write that thing. Three or more things compared on the same points go in a table. Leave out records that do not change the answer. Where the records run out, say so in one sentence.';

// The decider's shape pick (lib/decide/questions.ts), as a per-turn order.
// Prose adds nothing: SHAPE in the system prompt still lets the answerer
// reach for a table or a list on its own.
export const SHAPE_TURN: Record<string, string> = {
  prose: '',
  table: 'Shape for this turn: a comparison. Give the answer in one or two sentences, then a Markdown table with one row per thing compared and a citation in the cell that holds each fact, then at most a short paragraph on what the table means.',
  document: 'Shape for this turn: the document I asked for, in its usual form and ready to copy, with every fact cited. Before it, at most two lines: the reading you took, or the record that contradicts my premise.',
  lesson: 'Shape for this turn: teach it. Start from what a practitioner in a regulated bank already knows (model risk, controls, vendor due diligence), build up in steps under ## headings, work one concrete example from the records with its figures and dates, and end with what is still unsettled. Keep every key fact the explanation rests on; this answer may run long.',
};

export interface V2PromptOpts {
  web: boolean;
  lane: Lane;
  fresh?: boolean;
  depth?: string;
  shape?: string;
  clarify?: boolean;
  reportBlock?: string | null;
  today?: string;
  roster?: string;
}

export function v2System(o: V2PromptOpts): string {
  const parts = [
    v2Grounding(askSystem(o.web, o.lane, o.fresh)),
    addendum,
    TOOL_GUIDE,
    o.web ? DEEP_WEB_ADDENDUM : '',
    STANCE,
    o.roster ?? '',
    `Today is ${o.today ?? new Date().toISOString().slice(0, 10)}.`,
    o.reportBlock ?? '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

// Per-turn guidance rides the latest user turn (it changes turn to turn, so
// it stays out of the cached system prompt).
export function turnGuidance(o: V2PromptOpts): string {
  const lines = [FORM_REMINDER, SHAPE_TURN[o.shape ?? 'prose'] ?? '', DEPTH[o.depth ?? '2'] ?? ''];
  if (o.clarify) lines.push('This ask is ambiguous. Give your best short reading first, then end with ONE clarifying question.');
  return lines.filter(Boolean).join(' ');
}

// The conversation as LlmMessages: the map skeleton as a stable cached
// prefix on the first user turn, prior turns as plain text, the latest turn
// with the research instruction (and the lane reminder that keeps
// @@BEYOND@@ honest on Haiku).
export function v2Messages(msgs: AskWireMessage[], ns: AskNamespace, o: V2PromptOpts, skillRecipe?: string): LlmMessage[] {
  const params = deepConversationMessages(msgs, ns, { web: o.web, lane: o.lane });
  const out: LlmMessage[] = [];
  params.forEach((p, i) => {
    const blocks = typeof p.content === 'string' ? [p.content] : p.content.map((b) => (b.type === 'text' ? b.text : '')).filter(Boolean);
    if (p.role === 'assistant') {
      out.push({ role: 'assistant', content: blocks.join('\n\n'), toolCalls: [] });
      return;
    }
    if (i === 0 && blocks.length > 1) out.push({ role: 'user', prefix: blocks[0], content: blocks.slice(1).join('\n\n') });
    else out.push({ role: 'user', content: blocks.join('\n\n') });
  });
  const g = turnGuidance(o);
  const last = out[out.length - 1];
  if (g && last?.role === 'user') last.content = `${last.content}\n\n${g}`;
  // A skill's recipe rides as a mid-conversation system message right after
  // the turn it governs (after the cached prefix, so the cache stays warm).
  // Not before it: the API refuses a system message at messages[0].
  if (skillRecipe && last?.role === 'user') out.push({ role: 'system', content: skillRecipe });
  return out;
}

export function v2FinalInstruction(o: V2PromptOpts): string {
  return `Research is over. Write the final answer now from the records gathered above, following the citation rules and how you work with the reader. Begin directly with the answer, with no preamble about your research.${laneReminder(o.lane, o.web)}`;
}
