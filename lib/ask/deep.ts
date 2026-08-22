import type Anthropic from '@anthropic-ai/sdk';
import type { ArticleHit, AtlasSearchHit, PeekKind, PeekPayload } from './search';
import type { AskCostReport } from './history';

// Pure helpers for the deep-research loop behind /api/ask/deep: the signal-tag
// minter, the tool definitions and their input validation, tool-result
// rendering, the NDJSON wire protocol, and the deep-mode system addendum.
// Dependency-free at runtime (type-only imports) so scripts/test-deep.mjs can
// load it under plain Node type stripping, mirroring lib/ask/history.ts.

// Loop guards: the research loop is bounded on every axis (rounds, calls per
// round, chars per result, total context, wall clock) so a runaway session can
// never blow the function budget. Wall-clock numbers live in the route.
export const MAX_ROUNDS = 4;
export const MAX_CALLS_PER_ROUND = 6;
export const RESULT_CAP = 1500;
export const INPUT_TOKEN_CAP = 40_000;

// S = signal tags, P = paper tags; one shared counter mints both (see retrieve.ts).
const TAG_RE = /^[SP]\d{1,4}$/i;
const CODE_RE = /^[A-Za-z0-9.\-]{1,20}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- tagger
// Signals have no stable short code; the conversation-scoped tag map (S1, S2,
// ...) is minted server-side. The deep route seeds the minter with the tags
// the client already holds, so a signal rediscovered in a later turn keeps its
// original tag and fetch_record can resolve tags cited turns ago.
interface SignalTagger {
  tagFor(id: string): string;
  paperTagFor(id: string): string;
  idFor(tag: string): string | null;
  refs(): { tag: string; id: string }[];
}

export function createTagger(seed: Record<string, string>, offset: number): SignalTagger {
  // One byId map per kind (a signal uuid and a paper uuid can never collide,
  // but keeping them separate keeps each mint idempotent per kind); one shared
  // byTag map and ONE shared counter so S and P sequences never reuse a number.
  const sById = new Map<string, string>();
  const pById = new Map<string, string>();
  const byTag = new Map<string, string>();
  let max = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  for (const [tag, id] of Object.entries(seed)) {
    const t = tag.toUpperCase();
    if (!TAG_RE.test(t) || byTag.has(t)) continue;
    (t.startsWith('P') ? pById : sById).set(id, t);
    byTag.set(t, id);
    const n = Number(t.slice(1));
    if (n > max) max = n;
  }
  const mint = (byId: Map<string, string>, prefix: 'S' | 'P') => (id: string): string => {
    let t = byId.get(id);
    if (!t) {
      t = `${prefix}${++max}`;
      byId.set(id, t);
      byTag.set(t, id);
    }
    return t;
  };
  return {
    tagFor: mint(sById, 'S'),
    paperTagFor: mint(pById, 'P'),
    idFor(tag: string): string | null {
      return byTag.get(tag.trim().toUpperCase()) ?? null;
    },
    refs(): { tag: string; id: string }[] {
      return [...sById, ...pById].map(([id, tag]) => ({ tag, id }));
    },
  };
}

// The client's stored tag -> uuid map, sent alongside signalOffset. Untrusted
// input: keep only well-shaped entries, bounded.
export function parseSignalMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  let kept = 0;
  for (const [tag, id] of Object.entries(v as Record<string, unknown>)) {
    if (kept >= 200) break;
    if (TAG_RE.test(tag) && typeof id === 'string' && UUID_RE.test(id)) {
      out[tag.toUpperCase()] = id;
      kept++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- tools
// Questions are absent from search_atlas on purpose: they have no search_tsv
// column (0020 skipped them) and all seven are always in the skeleton.
const SEARCH_KINDS = ['claim', 'bridge', 'stance', 'concept', 'signal', 'paper', 'thread'] as const;
const FETCH_KINDS = ['claim', 'bridge', 'stance', 'question', 'concept', 'signal', 'paper', 'thread'] as const;
type FetchKind = (typeof FETCH_KINDS)[number];

export const DEEP_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_atlas',
    description:
      'Full-text search over the Atlas records: claims, bridge claims, stances, concepts, signals, research papers, and research threads. Returns matching records labeled with the exact bracketed IDs to cite. Questions are not searchable here; all seven are already in the map you were given.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms, plain words. Terms are OR-combined; records matching more of them rank first.',
        },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: [...SEARCH_KINDS] },
          description: 'Restrict the search to these record kinds. Omit to search all of them.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: 'Max results per kind, default 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_record',
    description:
      'Fetch one record in full detail: a claim or bridge with its falsifying test, evidence rows, and touching signals; a stance, question, or concept in full; a signal with its brief, counterpoint, and source; a research paper with its structured finding; or a research thread with its synthesis and member papers. Use the ID exactly as labeled: a claim or bridge code like 2.3 or B1, a stance code like Q1-S1A, a question, concept, or thread slug, a signal tag like S3, or a paper tag like P4 from earlier results.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...FETCH_KINDS] },
        id: { type: 'string', description: 'The record ID: a code, a slug, or a signal tag.' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'search_articles',
    description:
      'Search the retained full text of the source articles behind published signals. Returns matching excerpts labeled with the signal each article belongs to. Use when the question needs primary-source language beyond the Atlas summaries.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, plain words.' },
      },
      required: ['query'],
    },
  },
];

// ---------------------------------------------------------------- validation
// Each parser returns the typed input or an error STRING the route feeds back
// to the model as an is_error tool result (so a malformed call self-corrects).

interface SearchAtlasInput {
  query: string;
  kinds: PeekKind[];
  limit: number;
}

export function parseSearchAtlasInput(v: unknown): SearchAtlasInput | string {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const query = typeof o.query === 'string' ? o.query.trim().slice(0, 400) : '';
  if (!query) return 'search_atlas needs a non-empty query string.';
  let kinds: PeekKind[] = [...SEARCH_KINDS];
  if (Array.isArray(o.kinds) && o.kinds.length) {
    const picked = o.kinds.filter(
      (k): k is PeekKind => typeof k === 'string' && (SEARCH_KINDS as readonly string[]).includes(k)
    );
    if (!picked.length) return `kinds must be among: ${SEARCH_KINDS.join(', ')}.`;
    kinds = [...new Set(picked)];
  }
  const n = Math.floor(Number(o.limit));
  const limit = Number.isFinite(n) && n > 0 ? Math.min(8, n) : 5;
  return { query, kinds, limit };
}

interface FetchRecordInput {
  kind: FetchKind;
  id: string;
}

export function parseFetchRecordInput(v: unknown): FetchRecordInput | string {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = typeof o.kind === 'string' ? (o.kind as FetchKind) : ('' as FetchKind);
  if (!(FETCH_KINDS as readonly string[]).includes(kind)) {
    return `kind must be one of: ${FETCH_KINDS.join(', ')}.`;
  }
  const raw = typeof o.id === 'string' ? o.id.trim() : '';
  if (!raw) return 'fetch_record needs an id.';
  if (kind === 'signal') {
    if (!/^S\d{1,4}$/i.test(raw)) return 'For signals, id must be a tag like S3 from an earlier result in this conversation.';
    return { kind, id: raw.toUpperCase() };
  }
  if (kind === 'paper') {
    if (!/^P\d{1,4}$/i.test(raw)) return 'For papers, id must be a tag like P4 from an earlier result in this conversation.';
    return { kind, id: raw.toUpperCase() };
  }
  if (kind === 'question' || kind === 'concept' || kind === 'thread') {
    const slug = raw.toLowerCase();
    if (!SLUG_RE.test(slug)) return 'That does not look like a slug.';
    return { kind, id: slug };
  }
  if (!CODE_RE.test(raw)) return 'That does not look like a record code.';
  return { kind, id: raw };
}

export function parseSearchArticlesInput(v: unknown): { query: string } | string {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const query = typeof o.query === 'string' ? o.query.trim().slice(0, 400) : '';
  if (!query) return 'search_articles needs a non-empty query string.';
  return { query };
}

// ---------------------------------------------------------------- rendering
// The citation token for a record, exactly as the model must cite it.
export function citeToken(kind: PeekKind, id: string): string {
  return kind === 'question' ? `[Q ${id}]` : `[${kind} ${id}]`;
}

export function clipResult(s: string, cap = RESULT_CAP): string {
  return s.length > cap ? `${s.slice(0, cap)} ...` : s;
}

export function renderSearchHits(hits: AtlasSearchHit[]): string {
  if (!hits.length) return 'No records matched. Try different terms or other kinds.';
  return clipResult(hits.map((h) => `${citeToken(h.kind, h.id)} ${h.snippet}`).join('\n'));
}

export function renderArticleHits(hits: ArticleHit[]): string {
  if (!hits.length) return 'No article text matched.';
  return clipResult(
    hits
      .map((h) => {
        const anchor = h.signalTag ? ` ${citeToken('signal', h.signalTag)}` : '';
        return `From "${h.title}"${h.outlet ? ` (${h.outlet})` : ''}${anchor}: ${h.excerpt}`;
      })
      .join('\n\n')
  );
}

// One record, rendered for the model. `id` is the citable ID the caller used
// (a signal TAG, never a uuid); touching-signal uuids are tagged on the way out.
export function renderRecord(p: PeekPayload, id: string, tagFor: (uuid: string) => string): string {
  const parts: string[] = [`${citeToken(p.kind, id)} ${p.title}`];
  if (p.subtitle) parts.push(p.subtitle);
  if (p.body) parts.push(p.body);
  if (p.test) parts.push(`Falsifying test: ${p.test}`);
  if (p.brief) {
    if (p.brief.what_happened) parts.push(`What happened: ${p.brief.what_happened}`);
    if (p.brief.why_it_matters) parts.push(`Why it matters: ${p.brief.why_it_matters}`);
    if (p.brief.whats_contested) parts.push(`What is contested: ${p.brief.whats_contested}`);
  }
  if (p.counterpoint) parts.push(`Counterpoint: ${p.counterpoint}`);
  if (p.lenses?.length) {
    parts.push(`Lenses: ${p.lenses.join(', ')}${p.significance ? ` · significance ${p.significance}` : ''}`);
  }
  if (p.published_on) parts.push(`Published: ${p.published_on}`);
  if (p.source) {
    const bits = [p.source.title, p.source.outlet, p.source.published_on].filter(Boolean);
    if (bits.length) parts.push(`Source: ${bits.join(' · ')}`);
  }
  for (const e of p.evidence) {
    const src = e.source_title ? ` (${e.source_title}${e.outlet ? `, ${e.outlet}` : ''})` : '';
    parts.push(`Evidence (${e.direction}): ${e.excerpt}${src}`);
  }
  if (p.signals.length) {
    parts.push(
      `Touching signals: ${p.signals
        .map((s) => `${citeToken('signal', tagFor(s.id))} "${s.title}"${s.published_on ? ` (${s.published_on})` : ''}`)
        .join('; ')}`
    );
  }
  if (p.stances.length) {
    parts.push(`Stances: ${p.stances.map((s) => `${citeToken('stance', s.code)} ${s.title}`).join('; ')}`);
  }
  if (p.prerequisites.length) {
    parts.push(`Prerequisites: ${p.prerequisites.map((c) => `${citeToken('concept', c.slug)} ${c.name}`).join('; ')}`);
  }
  if (p.builds_toward.length) {
    parts.push(`Builds toward: ${p.builds_toward.map((c) => `${citeToken('concept', c.slug)} ${c.name}`).join('; ')}`);
  }
  for (const f of p.finding ?? []) {
    parts.push(`${f.label}: ${f.value}`);
  }
  if (p.members?.length) {
    parts.push(
      `Papers in this thread: ${p.members
        .map((m) => `"${m.title}"${m.relation ? ` (${m.relation})` : ''}`)
        .join('; ')}`
    );
  }
  return clipResult(parts.join('\n'));
}

// ---------------------------------------------------------------- protocol
// NDJSON, one JSON object per line: status lines while researching, delta
// lines for the streamed answer, one terminal done line carrying the full
// tag -> uuid signal map (the deep-mode replacement for X-Ask-Signals).
const ndLine = (o: object): string => `${JSON.stringify(o)}\n`;
export const ndStatus = (text: string): string => ndLine({ type: 'status', text });
export const ndDelta = (text: string): string => ndLine({ type: 'delta', text });
export const ndError = (text: string): string => ndLine({ type: 'error', text });
export const ndDone = (signals: Record<string, string>): string => ndLine({ type: 'done', signals });
export const ndVerify = (report: VerifyReport): string => ndLine({ type: 'verify', report });
export const ndCost = (report: AskCostReport): string => ndLine({ type: 'cost', report });

export const STATUS_START = 'Reading the question and the map';
export const STATUS_WRITING = 'Writing the answer';
export const STATUS_VERIFYING = 'Checking the answer against the records';
export const statusRound = (n: number): string => `Research round ${n}`;
export const statusSearch = (query: string, n: number): string =>
  `Searched the Atlas for "${query}": ${n} record${n === 1 ? '' : 's'}`;
export const statusRead = (token: string): string => `Read ${token}`;
export const statusArticles = (query: string, n: number): string =>
  `Searched source articles for "${query}": ${n} excerpt${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- verification
// Two anti-hallucination layers over a finished answer. Layer 1 is
// deterministic and free: quoted spans and numeric tokens in the answer must
// literally appear in the gathered material (skeleton + tool results / cited
// records). Layer 2 is a forced-tool model pass judging per-statement
// faithfulness. Verdicts are surfaced to the reader as flags, never silently
// applied: the verifier is itself a model, so only layer 1 is guaranteed.

export interface VerifyReport {
  checked?: number; // model-checked statements; absent = model leg unavailable
  flags: { excerpt: string; issue: string }[];
  quotesChecked: number;
  quotesMissing: string[];
  numbersChecked: number;
  numbersMissing: string[];
  // Sentences that declare an overall verdict without the "One reading:" label
  // (stance-taking made visible: the reader judges, the check only points).
  verdictLanguage?: string[];
  // Web search ran this turn: missing quotes/figures may live in web content
  // the deterministic layer cannot see (search results arrive encrypted), so
  // the UI softens those lines instead of flagging them.
}

const normText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Quoted spans in the answer (citation brackets stripped first so tokens like
// [signal S3] never count as quoted text). Normalized for literal matching.
export function extractQuotes(answer: string): string[] {
  const src = normText(answer.replace(/\[[^\]]*\]/g, ' '));
  const out: string[] = [];
  for (const m of src.matchAll(/"([^"]{20,300})"/g)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

// Numeric tokens of substance: two or more digits, or one digit carrying a
// currency/percent mark. Returned as bare cores ("$103" and "103" both "103")
// so formatting differences never cause a false flag.
export function extractNumbers(answer: string): string[] {
  const src = answer.replace(/\[[^\]]*\]/g, ' ');
  const out: string[] = [];
  for (const m of src.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const tok = m[0];
    if (tok.replace(/[^0-9]/g, '').length < 2 && !/[%$]/.test(tok)) continue;
    const core = tok.replace(/[$,%]/g, '');
    if (!out.includes(core)) out.push(core);
  }
  return out.slice(0, 20);
}

export function runDeterministicChecks(
  answer: string,
  corpus: string[]
): Pick<VerifyReport, 'quotesChecked' | 'quotesMissing' | 'numbersChecked' | 'numbersMissing'> {
  const hay = normText(corpus.join('\n'));
  const quotes = extractQuotes(answer);
  // A long quote clipped by a record's own "..." tail still counts if its head
  // matches; wholesale fabrication does not.
  const quotesMissing = quotes
    .filter((t) => !(hay.includes(t) || (t.length > 60 && hay.includes(t.slice(0, 60)))))
    .slice(0, 6);
  const numbers = extractNumbers(answer);
  const hayCores = new Set<string>();
  for (const m of hay.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) hayCores.add(m[0].replace(/[$,%]/g, ''));
  const numbersMissing = numbers.filter((n) => !hayCores.has(n)).slice(0, 6);
  return {
    quotesChecked: quotes.length,
    quotesMissing,
    numbersChecked: numbers.length,
    numbersMissing,
  };
}

export const VERIFY_TOOL: Anthropic.Tool = {
  name: 'submit_verification',
  description: 'Report the faithfulness check of the answer against the records.',
  input_schema: {
    type: 'object',
    properties: {
      checked: {
        type: 'integer',
        minimum: 0,
        description: 'How many citation-bearing statements in the answer were examined.',
      },
      flags: {
        type: 'array',
        description: 'One entry per unsupported or misattributed statement. Empty if everything is supported.',
        items: {
          type: 'object',
          properties: {
            excerpt: { type: 'string', description: 'The first words of the unsupported statement, at most 120 characters.' },
            issue: { type: 'string', description: 'One sentence: what the cited record actually says, or why the statement is unsupported.' },
          },
          required: ['excerpt', 'issue'],
        },
      },
      verdict_language: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Sentences in the answer that declare an overall verdict, winner, or lean (for example "the evidence leans toward") WITHOUT labeling themselves "One reading:". Quote each by its first words, at most 120 characters. Empty if the answer stays neutral or labels every lean.',
      },
    },
    required: ['checked', 'flags'],
  },
};

export const VERIFY_INSTRUCTION = `Now act as the verifier. Recheck the ANSWER against the records provided in this conversation, statement by statement. For every statement that cites a record, judge whether the cited record actually supports it as written: the figures, the direction of the finding, and who or what it is attributed to. Faithful paraphrase is fine. Unsupported content, a wrong figure, a misattributed citation, or a claim the record does not make are flags. Quoted text must appear in the records. A statement attributed in prose to a web outlet is checked against the web results in this conversation, not the Atlas records; do not flag it merely for being absent from the records. Separately, list in verdict_language any sentence that declares an overall verdict or lean (for example "the evidence leans toward") without labeling itself "One reading:". Report through submit_verification: how many citation-bearing statements you checked, one flag per problem with the statement's first words and a one-sentence issue, and the verdict sentences if any. If everything is supported, submit an empty flags list. Do not rewrite the answer.`;

// System prompt for the standalone verify endpoint (deep mode reuses its own
// conversation and only appends VERIFY_INSTRUCTION).
export const VERIFY_SYSTEM = `You are the verifier for "Ask the Atlas". You are given Atlas records, a question, and an answer that cites those records. Your only job is to judge whether the answer is faithful to the records: statements must match what the cited record says (figures, direction, attribution), and quoted text must appear in the records. You never rewrite the answer, never add information of your own, and never use an em dash. Report only through the submit_verification tool.`;

// The verifier's own output is untrusted model output: clamp it.
export function parseVerifyOutput(
  v: unknown
): { checked: number; flags: VerifyReport['flags']; verdictLanguage: string[] } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = Math.floor(Number(o.checked));
  const checked = Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : 0;
  const flags: VerifyReport['flags'] = [];
  if (Array.isArray(o.flags)) {
    for (const raw of o.flags.slice(0, 8)) {
      if (!raw || typeof raw !== 'object') continue;
      const f = raw as Record<string, unknown>;
      const excerpt = typeof f.excerpt === 'string' ? f.excerpt.trim().slice(0, 140) : '';
      const issue = typeof f.issue === 'string' ? f.issue.trim().slice(0, 280) : '';
      if (excerpt && issue) flags.push({ excerpt, issue });
    }
  }
  const verdictLanguage: string[] = [];
  if (Array.isArray(o.verdict_language)) {
    for (const raw of o.verdict_language.slice(0, 4)) {
      if (typeof raw !== 'string') continue;
      const t = raw.trim().slice(0, 140);
      if (t) verdictLanguage.push(t);
    }
  }
  return { checked, flags, verdictLanguage };
}

// ---------------------------------------------------------------- system
// Appended to the system prompt by the deep route (which since the 2026-08-21
// rework is the DEFAULT admin chat, not a toggle). Never an em dash in any of
// this.
export const DEEP_ADDENDUM = `You research every question before answering. Your tools:
- search_atlas finds records by topic across claims, bridges, stances, concepts, and signals.
- fetch_record pulls one record in full: evidence rows, falsifying tests, touching signals, the article source behind a signal.
- search_articles searches the retained full text of the articles behind published signals, for primary-source language.

Work in rounds: search broadly first, then fetch the records that look load-bearing, then check article text when the exact wording matters. Results are capped, so make each call count; a handful of well-chosen calls beats many shallow ones. When you have enough, stop calling tools and write the final answer following every rule above. Cite only IDs that appear in the map or in your tool results, exactly as labeled there. Signal tags like S3 stay valid across the whole conversation. When a claim's story runs through tracked developments, cite the touching signals by tag alongside the claim, not just the claim.

The reader asks one question and expects the full picture in one answer. Write it comprehensive, pinpoint, and self-contained: never ask a follow-up question, never defer material to a next turn, and never pad. If you state which way the records lean, open that sentence with "One reading:" and name the strongest record on the other side in the same paragraph; never present a lean as the Atlas's verdict.

Write the final answer as prose paragraphs with inline citations. Structure a long answer with short bold section headers, each written as **Header** on its own line. Use no other markdown: no # headings, no bullet markers, no tables, no links.`;
