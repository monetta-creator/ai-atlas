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

// 'item' (scan_items / intel_items, tagged I<n>) and 'fact' (intel_facts,
// tagged X<n>) share the retrieval layer's per-request tag counter with
// signal/paper (migration 0066's vector leg); they never get a claim code's
// "F<n>" shorthand (F1 is already a real frame-claim code — see 'claims.code'
// seeding — so facts had to take a different letter). 'report' (a section of
// the Atlas's own editorial reports, tagged R<n>) shares the same counter.
export type CitationKind = 'claim' | 'bridge' | 'stance' | 'Q' | 'concept' | 'signal' | 'paper' | 'thread' | 'item' | 'fact' | 'report';

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

// A report tag's map value is the full descriptor retrieve.ts/search.ts mint
// it with: 'report:<kind>:<scope>:<uuid>:<section>' (scope may be empty).
// Pure string parsing, no import: this module stays client-safe.
const REPORT_DESCRIPTOR_RE =
  /^report:(edition|roundup|savant):([0-9-]{0,10}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9-]{1,24})$/i;

function parseReportDescriptor(v: string): { kind: string; scope: string | null; id: string; key: string } | null {
  const m = REPORT_DESCRIPTOR_RE.exec(v);
  if (!m) return null;
  return { kind: m[1], scope: m[2] || null, id: m[3], key: m[4] };
}

// A report link, without importing lib/embed/report-sections.ts's own copy
// (kept in sync by hand; that module has zero imports and this one stays
// that way too). Mirrors reportSectionHref there exactly.
function reportHref(kind: string, id: string, scope: string | null, key: string): string {
  if (kind === 'edition' && scope) return `/blotter/${scope}#${key}`;
  if (kind === 'savant' && scope) return `/savant/${scope}#${key}`;
  return `/reports/sheet/${id}#${key}`;
}

// The peek/fetch id for a citation's underlying record, from its SignalMap
// value: unchanged for item/fact (already the composite/bare id the peek
// route expects) and for signal/paper (already the bare uuid); a report's
// full descriptor collapses to '<uuid>:<section>', what /api/ask/peek and
// fetchRecord's 'report' kind expect.
export function toPeekId(kind: CitationKind, mapValue: string): string {
  if (kind === 'report') {
    const d = parseReportDescriptor(mapValue);
    return d ? `${d.id}:${d.key}` : mapValue;
  }
  return mapValue;
}

export interface ParsedCode {
  kind: CitationKind;
  id: string;
  valid: boolean;
  href: string | null;
}

interface CitationSpan {
  start: number;
  end: number;
  raw: string; // the full matched "[...]"
  codes: ParsedCode[];
}

const KIND_WORDS: Record<string, CitationKind> = {
  claim: 'claim', bridge: 'bridge', stance: 'stance', q: 'Q', concept: 'concept', signal: 'signal',
  paper: 'paper', thread: 'thread', item: 'item', fact: 'fact', report: 'report',
};
// A token that is unambiguously a code, so a bracket without a kind word (e.g.
// [3.3], [B1, S2]) is recognized as a citation while ordinary prose like [note]
// is left alone. Slugs are intentionally excluded here (too word-like).
const STRONG = /^(S\d+|P\d+|I\d+|X\d+|R\d+|B\d+|F\d+|\d+(?:\.\d+)?|Q\d+-S\d+[A-Za-z]?)$/i;
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
    // Scan/intel items and intel facts have no Atlas page of their own; the
    // sig map's value carries the source composite id (retrieve.ts mints
    // "scan:<uuid>" / "intel:<uuid>" for items, a bare uuid for facts) and the
    // href points at the key-gated dataset row.
    case 'item': {
      const raw = sig[id];
      if (!raw) return null;
      const [src, uuid] = raw.split(':');
      if (src === 'scan') return `/datasets/external-scan?where=item_id:eq:${encodeURIComponent(uuid)}`;
      if (src === 'intel') return `/datasets/intel-items?where=item_id:eq:${encodeURIComponent(uuid)}`;
      return null;
    }
    case 'fact': {
      const uuid = sig[id];
      return uuid ? `/datasets/intel-facts?where=fact_id:eq:${encodeURIComponent(uuid)}` : null;
    }
    // A report tag's map value is the full descriptor ('report:<kind>:
    // <scope>:<uuid>:<section>'); parse it back to the section's anchor.
    case 'report': {
      const raw = sig[id];
      if (!raw) return null;
      const d = parseReportDescriptor(raw);
      return d ? reportHref(d.kind, d.id, d.scope, d.key) : null;
    }
  }
}

// Membership-first classification: a real code resolves to the right kind even if
// the model's kind word was wrong or missing. Unknown tokens are kept (kind
// inferred by shape, for display) but marked invalid so the UI flags them.
function classify(token: string, ids: ValidIdsPlain, sig: SignalMap): ParsedCode {
  let kind: CitationKind | null = null;
  // The tag map holds S-tags (signals), P-tags (papers), I-tags (scan/intel
  // items), X-tags (intel facts) and R-tags (report passages); the prefix
  // says which record kind the id belongs to.
  if (token in sig) {
    const t = token.toUpperCase();
    kind = t.startsWith('P') ? 'paper' : t.startsWith('I') ? 'item' : t.startsWith('X') ? 'fact' : t.startsWith('R') ? 'report' : 'signal';
  }
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
        : /^I\d+$/i.test(token) ? 'item'
          : /^X\d+$/i.test(token) ? 'fact'
            : /^R\d+$/i.test(token) ? 'report'
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
