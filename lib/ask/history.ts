// The multi-turn wire contract for Ask the Atlas: shared, dependency-free, and
// pure so both the API routes and scripts/test-ask.mjs (plain Node, type
// stripping) can load it. The client sends the whole visible conversation;
// the server never stores anything.
//
// Clamping rules (applied in clampHistory, oldest dropped first):
//   1. per-user-turn cap: 2000 chars (the original single-shot cap, kept)
//   2. long assistant turns are clipped from the HEAD to their last 2500 chars
//      (they are our own prior answers; the tail carries the conclusion)
//   3. keep at most the last MAX_MESSAGES messages AND at most CHAR_BUDGET
//      total chars, dropping oldest whole messages first
//   4. the result must start with a user turn (the Anthropic API requires it),
//      so leading assistant messages left by a trim are dropped too
//   5. the latest user turn is always kept

export interface AskWireMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const USER_TURN_CAP = 2000;
export const ASSISTANT_TURN_CAP = 2500;
export const MAX_MESSAGES = 12;
export const CHAR_BUDGET = 8000;
const RETRIEVAL_QUERY_CAP = 1200;

// Accepts the new { messages } shape or the legacy { query } shape (kept
// indefinitely: it is three lines and keeps curl testing trivial). Returns null
// when the body is unusable; the caller 400s.
export function parseAskBody(body: unknown): AskWireMessage[] | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { query?: unknown; messages?: unknown };
  if (typeof b.query === 'string' && b.query.trim()) {
    return [{ role: 'user', content: b.query.trim() }];
  }
  if (!Array.isArray(b.messages)) return null;
  const out: AskWireMessage[] = [];
  for (const m of b.messages) {
    if (!m || typeof m !== 'object') return null;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed) continue;               // drop empty turns rather than failing
    out.push({ role, content: trimmed });
  }
  if (!out.length) return null;
  if (out[out.length - 1].role !== 'user') return null;
  return out;
}

export function clampHistory(messages: AskWireMessage[]): AskWireMessage[] {
  const capped = messages.map((m) => {
    if (m.role === 'user' && m.content.length > USER_TURN_CAP) {
      return { ...m, content: m.content.slice(0, USER_TURN_CAP) };
    }
    if (m.role === 'assistant' && m.content.length > ASSISTANT_TURN_CAP) {
      return { ...m, content: `[...] ${m.content.slice(-ASSISTANT_TURN_CAP)}` };
    }
    return m;
  });

  // Latest user turn is sacred; budget the rest from newest to oldest.
  const latest = capped[capped.length - 1];
  const prior = capped.slice(0, -1);
  const kept: AskWireMessage[] = [];
  let chars = latest.content.length;
  for (let i = prior.length - 1; i >= 0; i--) {
    if (kept.length + 1 >= MAX_MESSAGES) break;
    if (chars + prior[i].content.length > CHAR_BUDGET) break;
    kept.unshift(prior[i]);
    chars += prior[i].content.length;
  }
  // The API requires the conversation to open with a user turn.
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return [...kept, latest];
}

// Vocabulary translation for retrieval: the Atlas writes in its own terms
// ("open-weight", "parity", "commoditize") and a question phrased in street
// vocabulary ("open source", "beating", "cheap") matches none of them through
// pure lexical FTS. Each rule appends the Atlas-side terms when the question
// uses the street-side ones; expansion only ever ADDS recall (the OR-combined
// tsquery ranks multi-term matches first, so extra lexemes cannot hide a
// direct hit). Pure and dependency-free for scripts/test-ask.mjs.
const VOCAB_RULES: [RegExp, string][] = [
  [/\bopen[ -]?sourced?\b|\blocal (?:models?|llms?)\b|\bopen (?:models?|llms?)\b/i, 'open-weight open weights'],
  [/\bbeat(?:s|ing|en)?\b|\bcatch(?:ing|es)? up\b|\bcaught up\b|\bclos(?:e|ing) the gap\b|\bahead of\b|\bkeep(?:ing)? up\b/i, 'parity lag catch-up'],
  [/\bcheap(?:er|est)?\b|\bprice war\b|\brace to the bottom\b|\baffordable\b/i, 'price-performance cost commoditize'],
  [/\bmoats?\b|\bdefensib(?:le|ility)\b|\bcompetitive advantage\b/i, 'rents commoditize durable'],
  [/\bjobs?\b|\blayoffs?\b|\bworkforce\b|\bhiring\b/i, 'labor employment'],
  [/\bchips?\b|\bgpus?\b|\bsemiconductors?\b/i, 'silicon compute hardware'],
  [/\bbest models?\b|\btop models?\b|\bsmartest\b|\bstate of the art\b|\bsota\b/i, 'frontier benchmark capability'],
];

export function expandVocabulary(query: string): string {
  const extra: string[] = [];
  for (const [re, terms] of VOCAB_RULES) {
    if (re.test(query)) extra.push(terms);
  }
  return extra.length ? `${query} ${extra.join(' ')}` : query;
}

// The per-turn retrieval query: the latest user turn plus the immediately
// preceding user turn. Deterministic and cheap; the FTS layer OR-combines
// lexemes with rank favoring multi-term matches, so broadening with the prior
// turn improves recall on anaphoric follow-ups ("what contradicts that?")
// without hurting precision, and code detection keeps explicitly named codes
// from the prior turn in scope. Vocabulary expansion is appended AFTER the cap
// so a long question can never truncate its own translation terms.
export function retrievalQuery(messages: AskWireMessage[]): string {
  const users = messages.filter((m) => m.role === 'user');
  const latest = users[users.length - 1]?.content ?? '';
  const prev = users[users.length - 2]?.content ?? '';
  const base = `${latest} ${prev}`.trim().slice(0, RETRIEVAL_QUERY_CAP);
  return expandVocabulary(base);
}

export function clampSignalOffset(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(999, Math.max(0, Math.floor(n)));
}

// ---- Per-turn cost report ----------------------------------------------------
// What one Ask turn cost, shown to the reader under the answer. Rides a
// trailing sentinel line on the plain-text stream (the deep route sends it as
// its own NDJSON event instead). Tolerant: a missing or torn sentinel yields null.

export interface AskCostReport {
  cost_usd: number;
  input_tokens: number;      // total context processed, cache reads included
  output_tokens: number;
  cache_read_tokens: number; // the part of input_tokens re-read from cache
  searches: number;          // web searches run this turn
  rounds: number;            // model calls this turn (1 for a quick answer)
  model: string;
}

export const COST_MARKER = '@@ASK_COST@@';

export function encodeCostReport(r: AskCostReport): string {
  return `\n${COST_MARKER}${JSON.stringify(r)}`;
}

const cnum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function parseCostReport(v: unknown): AskCostReport | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    cost_usd: cnum(o.cost_usd),
    input_tokens: Math.floor(cnum(o.input_tokens)),
    output_tokens: Math.floor(cnum(o.output_tokens)),
    cache_read_tokens: Math.floor(cnum(o.cache_read_tokens)),
    searches: Math.floor(cnum(o.searches)),
    rounds: Math.floor(cnum(o.rounds)),
    model: typeof o.model === 'string' ? o.model.slice(0, 60) : '',
  };
}

export function extractCostReport(acc: string): { text: string; cost: AskCostReport | null } {
  const i = acc.lastIndexOf(COST_MARKER);
  if (i < 0) return { text: acc, cost: null };
  const lineEnd = acc.indexOf('\n', i);
  const jsonEnd = lineEnd < 0 ? acc.length : lineEnd;
  let cost: AskCostReport | null = null;
  try {
    cost = parseCostReport(JSON.parse(acc.slice(i + COST_MARKER.length, jsonEnd)));
  } catch {
    // torn line: drop the report, keep the answer
  }
  const text = (acc.slice(0, i) + acc.slice(jsonEnd)).trimEnd();
  return { text, cost };
}
