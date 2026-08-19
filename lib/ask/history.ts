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

// The per-turn retrieval query: the latest user turn plus the immediately
// preceding user turn. Deterministic and cheap; the FTS layer OR-combines
// lexemes with rank favoring multi-term matches, so broadening with the prior
// turn improves recall on anaphoric follow-ups ("what contradicts that?")
// without hurting precision, and code detection keeps explicitly named codes
// from the prior turn in scope.
export function retrievalQuery(messages: AskWireMessage[]): string {
  const users = messages.filter((m) => m.role === 'user');
  const latest = users[users.length - 1]?.content ?? '';
  const prev = users[users.length - 2]?.content ?? '';
  return `${latest} ${prev}`.trim().slice(0, RETRIEVAL_QUERY_CAP);
}

export function clampSignalOffset(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(999, Math.max(0, Math.floor(n)));
}

// ---- Web sources (the composer's web-search toggle) --------------------------
// The quick-ask stream is plain text and its headers are sent before the model
// runs, so the cited web sources ride a trailing sentinel line the client
// strips and parses. Tolerant on both ends: a missing or torn sentinel just
// yields no sources.

export interface AskWebSource {
  url: string;
  title: string;
}

export const WEB_SOURCES_MARKER = '@@ASK_WEB_SOURCES@@';

export function encodeWebSources(sources: AskWebSource[]): string {
  return `\n${WEB_SOURCES_MARKER}${JSON.stringify(sources)}`;
}

export function extractWebSources(acc: string): { text: string; sources: AskWebSource[] } {
  const i = acc.lastIndexOf(WEB_SOURCES_MARKER);
  if (i < 0) return { text: acc, sources: [] };
  const text = acc.slice(0, i).trimEnd();
  let sources: AskWebSource[] = [];
  try {
    const parsed = JSON.parse(acc.slice(i + WEB_SOURCES_MARKER.length)) as unknown;
    if (Array.isArray(parsed)) {
      sources = parsed
        .filter((s): s is AskWebSource =>
          !!s && typeof (s as AskWebSource).url === 'string' && /^https?:\/\//i.test((s as AskWebSource).url))
        .map((s) => ({ url: s.url.slice(0, 600), title: String(s.title ?? '').slice(0, 200) || s.url }))
        .slice(0, 8);
    }
  } catch {
    // torn line: drop the sources, keep the answer
  }
  return { text, sources };
}

// Distinct cited web sources from a finished Anthropic message, in citation
// order. Structurally typed so this module stays SDK-free and Node-testable.
export function collectWebSources(msg: {
  content: { type?: string; citations?: { type?: string; url?: string; title?: string | null }[] | null }[];
}): AskWebSource[] {
  const out: AskWebSource[] = [];
  const seen = new Set<string>();
  for (const block of msg.content) {
    if (block.type !== 'text' || !block.citations) continue;
    for (const c of block.citations) {
      if (c.type !== 'web_search_result_location' || !c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      out.push({ url: c.url.slice(0, 600), title: String(c.title ?? '').slice(0, 200) || c.url });
    }
  }
  return out.slice(0, 8);
}
