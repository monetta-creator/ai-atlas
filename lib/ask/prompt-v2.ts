// The v2 chat's prompt (redo Phase 1, P1.9): today's grounding and citation
// grammar (askSystem + the deep research addendum) plus the collaborator
// stance from private/redo/15-experience.md, and the decider's depth and
// clarify readings. The five felt qualities (encyclopedia, textbook,
// lecturer, teammate, collaborator) are never named here or anywhere the
// model sees: the stance asks for behavior, the register follows.
import type { AskWireMessage } from './history';
import { askSystem, deepConversationMessages, laneReminder } from './prompt';
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
  '3': 'Length for this turn: this one warrants a long, structured answer with bold section headers.',
};

// The deep addendum forbids follow-up questions; v2 allows exactly one when
// the decider judged the ask too ambiguous to answer usefully.
const addendum = DEEP_ADDENDUM.replace(
  'never ask a follow-up question, never defer material to a next turn, and never pad',
  'never defer material to a next turn and never pad',
);

// The deep addendum describes the original three tools; v2 has thirteen.
export const TOOL_GUIDE = `More tools, beyond search_atlas and fetch_record: whats_new (everything collected since a date; use for "what happened lately"), search_items (news and company items with date, company, topic filters), timeline (dated history and signals on a topic), company (one tracked company: facts, items, history), metrics (a company's metric series as a table: quote numbers exactly as the rows give them, never compute or estimate one), question_map (a map question's stances, claims, edges and evidence balance; use when the reader wants the debate), report (the Atlas's own report sections), tooling (AI tools and vendors), and, for the maintainer only, startups and engine_status. Pick the narrowest tool that answers. Budget: most answers need two or three rounds (one round of searches run in parallel, one round fetching the few records you will actually cite); fetch only what you will cite, and stop as soon as you can answer well. The reader is waiting. Labels like [tool slug] or [startup id] identify rows for the reader but cannot be fetched.`;

export interface V2PromptOpts {
  web: boolean;
  lane: Lane;
  fresh?: boolean;
  depth?: string;
  clarify?: boolean;
  reportBlock?: string | null;
  today?: string;
  roster?: string;
}

export function v2System(o: V2PromptOpts): string {
  const parts = [
    askSystem(o.web, o.lane, o.fresh),
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
  const lines = [DEPTH[o.depth ?? '2'] ?? ''];
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
