// Output verification for "Ask the Atlas". Pure, zero-latency, and client-safe
// (no server imports): it parses the inline citations the model emits and checks
// each one against the valid IDs the retrieval layer surfaced. Because the full
// ID namespace (the skeleton) is always provided to the model, a valid citation
// is guaranteed to resolve to a real Atlas page; an unverified one is flagged in
// the UI rather than silently trusted.
//
// The parser is deliberately tolerant: the model sometimes bundles codes in one
// bracket ([claim 1.3, B1]) or drops the kind word ([3.3]). We split brackets
// into individual codes and classify each by namespace membership (robust to a
// wrong or absent kind word), so every real code still links.

export type CitationKind = 'claim' | 'bridge' | 'stance' | 'Q' | 'concept' | 'signal' | 'paper' | 'thread';

// The serializable, static namespace passed from the server page to the client.
// (Signals are not here: they are per-request and arrive via the SignalMap below.)
export interface ValidIdsPlain {
  claims: string[];
  bridges: string[];
  stances: string[];
  questions: string[];
  concepts: string[];
  threads: string[];   // research-thread slugs, cited as [thread <slug>]
  stanceToQuestion: Record<string, string>; // stance code -> its question slug
}

// Per-answer map of tag -> uuid, from the X-Ask-Signals response header.
// Signals mint S-tags and papers P-tags on ONE shared counter, so both kinds
// live in this map and one signalOffset covers them; the prefix carries the kind.
export type SignalMap = Record<string, string>;

export interface ParsedCode {
  kind: CitationKind;
  id: string;
  valid: boolean;
  href: string | null;
}

export interface CitationSpan {
  start: number;
  end: number;
  raw: string; // the full matched "[...]"
  codes: ParsedCode[];
}

const KIND_WORDS: Record<string, CitationKind> = {
  claim: 'claim', bridge: 'bridge', stance: 'stance', q: 'Q', concept: 'concept', signal: 'signal',
  paper: 'paper', thread: 'thread',
};
// A token that is unambiguously a code, so a bracket without a kind word (e.g.
// [3.3], [B1, S2]) is recognized as a citation while ordinary prose like [note]
// is left alone. Slugs are intentionally excluded here (too word-like).
const STRONG = /^(S\d+|P\d+|B\d+|F\d+|\d+(?:\.\d+)?|Q\d+-S\d+[A-Za-z]?)$/i;
const BRACKET = /\[([^\]]+)\]/g;

function hrefFor(kind: CitationKind, id: string, ids: ValidIdsPlain, sig: SignalMap): string | null {
  switch (kind) {
    case 'claim': return `/claim/${encodeURIComponent(id)}`;
    case 'bridge': return `/bridge/${encodeURIComponent(id)}`;
    case 'Q': return `/q/${encodeURIComponent(id)}`;
    case 'concept': return `/concepts/${encodeURIComponent(id)}`;
    case 'stance': {
      const q = ids.stanceToQuestion[id];
      return q ? `/q/${encodeURIComponent(q)}#${encodeURIComponent(id)}` : null;
    }
    case 'signal': {
      const uuid = sig[id];
      return uuid ? `/signals/${encodeURIComponent(uuid)}` : null;
    }
    case 'paper': {
      const uuid = sig[id];
      return uuid ? `/research/${encodeURIComponent(uuid)}` : null;
    }
    case 'thread': return `/research/threads/${encodeURIComponent(id)}`;
  }
}

// Membership-first classification: a real code resolves to the right kind even if
// the model's kind word was wrong or missing. Unknown tokens are kept (kind
// inferred by shape, for display) but marked invalid so the UI flags them.
function classify(token: string, ids: ValidIdsPlain, sig: SignalMap): ParsedCode {
  let kind: CitationKind | null = null;
  // The tag map holds both S-tags (signals) and P-tags (papers); the prefix
  // says which record kind the uuid belongs to.
  if (token in sig) kind = token.toUpperCase().startsWith('P') ? 'paper' : 'signal';
  else if (ids.claims.includes(token)) kind = 'claim';
  else if (ids.bridges.includes(token)) kind = 'bridge';
  else if (ids.stances.includes(token)) kind = 'stance';
  else if (ids.questions.includes(token)) kind = 'Q';
  else if (ids.concepts.includes(token)) kind = 'concept';
  else if (ids.threads?.includes(token)) kind = 'thread';

  if (kind) return { kind, id: token, valid: true, href: hrefFor(kind, token, ids, sig) };

  const inferred: CitationKind =
    /^S\d+$/i.test(token) ? 'signal'
      : /^P\d+$/i.test(token) ? 'paper'
        : /^B\d+$/i.test(token) ? 'bridge'
          : /-S\d+/i.test(token) ? 'stance'
            : /^(F\d+|\d+(?:\.\d+)?)$/i.test(token) ? 'claim'
              : 'concept';
  return { kind: inferred, id: token, valid: false, href: null };
}

export function parseCitations(text: string, ids: ValidIdsPlain, sig: SignalMap): CitationSpan[] {
  const spans: CitationSpan[] = [];
  for (const m of text.matchAll(BRACKET)) {
    const inner = m[1].trim();
    const start = m.index ?? 0;

    // Strip an optional leading kind word; the tokens are still verified by
    // membership, so the word is only a hint about how to read a bare bracket.
    const words = inner.split(/\s+/);
    const hasKind = words.length > 0 && words[0].toLowerCase() in KIND_WORDS;
    const rest = hasKind ? words.slice(1).join(' ') : inner;

    const tokens = rest.split(/[,\s]+/).filter(Boolean);
    if (!tokens.length) continue;
    // No kind word: only a citation if every token is strongly code-shaped.
    if (!hasKind && !tokens.every((t) => STRONG.test(t))) continue;

    spans.push({
      start,
      end: start + m[0].length,
      raw: m[0],
      codes: tokens.map((t) => classify(t, ids, sig)),
    });
  }
  return spans;
}
