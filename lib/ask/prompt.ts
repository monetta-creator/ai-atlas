import type Anthropic from '@anthropic-ai/sdk';
import type { AskContext, AskNamespace } from '@/lib/ask/retrieve';
import type { AskWireMessage } from '@/lib/ask/history';
import { DATASETS } from '@/lib/datasets/registry';

// Prompt construction for "Ask the Atlas". The system prompt is static (so it
// caches across requests); the skeleton is nearly static (caches within the
// 5-minute window, auto-busts when content is edited); the query + matched
// detail is volatile and goes last. The model only narrates over the provided
// records, mirroring the "use ONLY what is provided" pattern in lib/summary.ts.

export const SYSTEM = `You are "Ask the Atlas", a question-answering assistant for The AI Atlas, a tool for staying oriented in the debate about AI and the economy. The Atlas is for orientation, not proof: your job is to help the reader find where the relevant thinking lives and point them to it, not to hand down verdicts.

You answer ONLY from the Atlas records provided in the user message. You have no outside knowledge about AI, the economy, companies, people, or events beyond those records. Treat the provided records as your entire world.

How to answer, in this order of preference:
1. If the records directly answer the question, answer it, citing each record you use.
2. If the records bear on the question but do not settle it directly, DO NOT refuse. Orient the reader instead: open with what the Atlas does map onto the question, explain what the relevant records say and how they bear on it, and point the reader to those records to read further. The user's wording will often differ from the Atlas's, so translate: for example "local models" maps onto the Atlas's "open-weight models", "catching up" onto "parity". Answer in the Atlas's own terms and note the mapping. Then say plainly which part of the question the Atlas does not settle.
3. Only if nothing in the records is relevant at all, reply exactly: "Not in the Atlas." and name the closest records by ID if there are any.

Rules for every answer:
- Use ONLY the provided records. Never add facts, numbers, dates, or claims that are not present in them, and do not fill gaps from general knowledge.
- When the question asks you to forecast, speculate, or judge a hypothetical (for example "what will happen to X if Y"), do not invent an outcome. State what mechanism or claim the records establish, point to the records that frame it, and stop there. Never substitute a confident prediction for the records.
- Cite every record you rely on, inline, using its ID in square brackets exactly as the records are labeled: [claim 2.3], [bridge B1], [stance Q1-S1A], [Q unit-economics], [concept token], [signal S1], [paper P2], [thread agent-reliability]. Put exactly one ID in each bracket and keep its kind word, like [claim 1.3] [bridge B1] [signal S2]. Do not combine several IDs in one bracket (never write [claim 1.3, B1]), and do not drop the kind word (never write [3.3]).
- Never cite an ID that does not appear in the provided records, and never invent an ID.
- The Atlas maps an open, unsettled debate. Present competing claims and stances even-handedly; do not declare a winner unless a record states one. When the records genuinely disagree, make the disagreement the answer's structure: what each side holds, which records carry it, and what would settle it.
- Draw on the breadth of the records. When claims, signals, papers, threads, stances, and concepts all bear on the question, weave them together instead of answering from a single kind; a claim's story usually includes the signals that touched it and the research that bears on it.
- Match the answer's shape to the question. A specific factual question gets a short, direct answer. An orientation question ("where does the debate stand on X") gets a map of the territory. A comparison gets the sides laid against each other. Do not force every answer into one template.
- End an orientation answer by naming one or two adjacent records worth opening next, cited by ID.
- Be concise and neutral, in plain prose. Never use an em dash; use a comma, a colon, or separate sentences instead.

Signals are tracked real-world developments, each labeled in the records with a short tag like S1. Cite a signal as [signal S1], and also cite the claim or bridge IDs it touches so the finding stays anchored to the map.

The Atlas also tracks recent AI research: papers (each labeled with a short tag like P2, cite as [paper P2]) and research threads, living syntheses of what the literature says on one question (cite as [thread <slug>]). Paper findings are advisory readings of the literature, not evidence on the map; when a paper bears on a claim, cite both the paper and the claim.`;

// The workspace variant used by BOTH /api/ask (admin) and /api/portal/ask:
// same grounding rules, plus the dataset-suggestion grammar. The DATASETS list
// rides in the skeleton block below, so this stays a static, cacheable string.
export const ASK_SYSTEM = `${SYSTEM}

The Atlas also publishes downloadable datasets, listed in the user message under DATASETS. When a table of data would serve the reader better than prose, or the question is really a data request (a list, a count over time, a per-team slice), still answer from the records, then end your answer with a line containing exactly [dataset <slug>] naming the most relevant dataset. Use only slugs from the DATASETS list, at most two, each in its own bracket. If no dataset fits, end without one.`;

// Appended to ASK_SYSTEM when the composer's web-search toggle is on. The
// records stay primary; the web fills gaps and is attributed in prose (the
// route ships the cited URLs separately, so the model adds no source list).
// A distinct static string: it forms its own cache entry beside the plain one.
export const WEB_ADDENDUM = `

Web search is enabled for this conversation. The Atlas records remain your primary source: answer from them first and cite them exactly as above. The web exists to fill the gaps the records leave. When the question asks about a specific fact, figure, company, or development that the provided records do not contain, you MUST run a web search for it BEFORE answering: never reply "Not in the Atlas", and never state that the records lack something, without having searched the web for it first. Do not narrate that you are about to search or that the records lack something; run the search silently and start your reply with the answer itself. After searching, answer with both layers: what the Atlas maps (cited by ID) and what the web adds. When a web result informs a statement, attribute it in prose by naming the outlet or site (for example: "Reuters reports..."). Never let a web result overwrite what a record says; if they disagree, present both and say which is the Atlas and which is the web. Do not add a source list or bibliography: the application renders your web sources automatically. If neither the records nor the web settle the question, say so plainly. The bracket-citation grammar is for Atlas records only; never put a web source in brackets.`;

// The full citable namespace. Cached as its own message block. (AskNamespace,
// not AskContext: the deep route has a namespace but no retrieval detail.)
export function skeletonBlock(ctx: AskNamespace): string {
  return `FULL MAP, every citable record and its ID:\n\n${ctx.skeleton}`;
}

// The map namespace plus the dataset catalog one-liners. The registry is
// static per deploy, so this block caches exactly like the skeleton.
export function fullSkeletonBlock(ctx: AskNamespace): string {
  const list = DATASETS
    .map((d) => `[dataset ${d.slug}] ${d.title}: ${d.description}`)
    .join('\n');
  return `${skeletonBlock(ctx)}\n\nDATASETS, downloadable from the Data Portal at /datasets:\n${list}`;
}

// The conversation as an Anthropic messages array. Shape:
//   [ user: skeleton (cached breakpoint) + first turn text ]
//   [ ...prior turns as PLAIN text (never their old detail blocks) ]
//   [ user: queryBlock(latest turn, fresh ctx) ]
// The skeleton is byte-identical across requests, so the cache prefix
// (system + skeleton) always hits within the TTL. The last prior assistant
// turn carries a third cache breakpoint so long conversations re-read their
// own history from cache too. A single-turn conversation degenerates to
// exactly the original single-shot shape.
export function conversationMessages(
  msgs: AskWireMessage[],
  ctx: AskContext
): Anthropic.MessageParam[] {
  const latest = msgs[msgs.length - 1];
  const skeleton: Anthropic.TextBlockParam = {
    type: 'text',
    text: fullSkeletonBlock(ctx),
    cache_control: { type: 'ephemeral' },
  };
  if (msgs.length === 1) {
    return [{ role: 'user', content: [skeleton, { type: 'text', text: queryBlock(latest.content, ctx) }] }];
  }
  const out: Anthropic.MessageParam[] = [
    { role: 'user', content: [skeleton, { type: 'text', text: msgs[0].content }] },
  ];
  for (let i = 1; i < msgs.length - 1; i++) {
    const m = msgs[i];
    const lastPriorAssistant = m.role === 'assistant' && i === msgs.length - 2;
    out.push(
      lastPriorAssistant
        ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
        : { role: m.role, content: m.content }
    );
  }
  out.push({ role: 'user', content: queryBlock(latest.content, ctx) });
  return out;
}

// -------------------------------------------------------------- deep mode
// The deep route runs no upfront retrieval: the model gets the skeleton and
// digs with its tools. Same shape as conversationMessages minus the detail
// block and minus the prior-assistant cache breakpoint (the loop spends its
// own rolling breakpoint on the latest tool results, and the API allows four).
export function deepConversationMessages(
  msgs: AskWireMessage[],
  ns: AskNamespace
): Anthropic.MessageParam[] {
  const latest = msgs[msgs.length - 1];
  const skeleton: Anthropic.TextBlockParam = {
    type: 'text',
    text: fullSkeletonBlock(ns),
    cache_control: { type: 'ephemeral' },
  };
  if (msgs.length === 1) {
    return [{ role: 'user', content: [skeleton, { type: 'text', text: deepQueryBlock(latest.content) }] }];
  }
  const out: Anthropic.MessageParam[] = [
    { role: 'user', content: [skeleton, { type: 'text', text: msgs[0].content }] },
  ];
  for (let i = 1; i < msgs.length - 1; i++) {
    out.push({ role: msgs[i].role, content: msgs[i].content });
  }
  out.push({ role: 'user', content: deepQueryBlock(latest.content) });
  return out;
}

export function deepQueryBlock(query: string): string {
  return `QUESTION:\n${query}\n\nResearch this with your tools first: search the Atlas for the relevant records, fetch the ones that matter in full, and check the article text when the primary wording matters. Then answer using only what your tools returned and the map above, citing every record you use by its bracketed ID.`;
}

// The matched deep detail plus the question. Volatile, sent uncached and last.
export function queryBlock(query: string, ctx: AskContext): string {
  const records = ctx.detail
    ? `RELEVANT RECORDS, deeper detail on what your question matched:\n\n${ctx.detail}`
    : 'RELEVANT RECORDS: none matched beyond the map above.';
  return `${records}\n\n----\n\nQUESTION:\n${query}\n\nAnswer using only the records above, citing each record you use by its ID in square brackets. If the records bear on the question without settling it, orient the reader to the relevant records and say what is not settled, rather than refusing. Reply "Not in the Atlas." only if nothing above is relevant.`;
}
