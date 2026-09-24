import { enforceCitations, byTagNumber, type CitationAllowlist } from '../citations.ts';
import type { ThesisNarrative, ThesisPack } from '../types';

// The thesis citation gate: builds the thesis pack's allowlist and gates all
// three narrative slots. The generic enforcement core lives in lib/citations.ts
// (shared with the tear-sheet generators); this module owns only what is
// thesis-shaped. Runs at generation time AND again at the save/render boundaries
// (same belt-and-braces as sanitizeReportNarrative).

export type { CitationAllowlist };
export { enforceCitations };

export function allowlistFor(pack: ThesisPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const s of pack.signals) {
    const href = `/signals/${s.id}`;
    hrefs.add(href);
    tagByHref.set(href, s.tag);
    if (s.source_url) hrefs.add(s.source_url);
  }
  for (const c of pack.claims) hrefs.add(c.href);
  return { hrefs, tagByHref };
}

// ---- Citation entity check --------------------------------------------------
// A deterministic backstop BEHIND enforceCitations: a link can point at a real
// pack record and still be wrong (the reviewer's case: a sentence about
// "Singapore AISI red-teaming" linked S8, a Microsoft record, because S8 was
// simply IN the pack). For every surviving <a href>, the sentence containing it
// must actually mention the cited record, not just cite something allowlisted.
// Pure and pack-scoped: it never reaches outside the same frozen pack
// enforceCitations already validated against.

const STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'we', 'you',
  'there', 'here', 'when', 'while', 'after', 'before', 'since', 'because', 'although',
  'however', 'therefore', 'moreover', 'furthermore', 'meanwhile', 'nevertheless', 'also',
  'still', 'yet', 'then', 'now', 'today', 'recently', 'according', 'overall', 'despite',
  'given', 'even', 'just', 'only', 'both', 'each', 'some', 'many', 'most', 'several',
  'other', 'another', 'such', 'every', 'all', 'any', 'none', 'not', 'and', 'but', 'for',
  'with', 'from', 'into', 'over', 'under', 'about', 'their', 'which', 'where', 'what',
  'who', 'whom', 'would', 'could', 'should', 'will', 'shall',
]);

interface CitedRecord {
  title: string;
  summary: string | null;
}

function wordTokens(text: string): string[] {
  return text.match(/[A-Za-z]+/g) ?? [];
}

// Capitalized words of 4+ letters, minus the sentence-initial-only stopwords
// that get capitalized purely from leading a sentence ("The", "When", ...) and
// carry no identifying information.
function properNouns(text: string): Set<string> {
  const words = text.match(/\b[A-Z][A-Za-z]{3,}\b/g) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (!STOPWORDS.has(w.toLowerCase())) out.add(w);
  }
  return out;
}

function figures(text: string): Set<string> {
  return new Set(text.match(/\d[\d,.]*%?/g) ?? []);
}

function recordText(r: CitedRecord): string {
  return [r.title, r.summary ?? ''].join(' ');
}

// Word -> number of pack record TITLES it appears in (case-insensitive, 4+
// letters). Backs the "rare shared token" rule: a common word two texts share
// proves nothing, an unusual one shared with THIS record is real signal.
function titleTokenFrequency(pack: ThesisPack): Map<string, number> {
  const freq = new Map<string, number>();
  const titles = [...pack.signals.map((s) => s.title), ...pack.claims.map((c) => c.statement)];
  for (const t of titles) {
    const seen = new Set<string>();
    for (const w of wordTokens(t)) {
      if (w.length < 4) continue;
      const lw = w.toLowerCase();
      if (seen.has(lw)) continue;
      seen.add(lw);
      freq.set(lw, (freq.get(lw) ?? 0) + 1);
    }
  }
  return freq;
}

function sentenceMentionsRecord(sentenceText: string, record: CitedRecord, titleFreq: Map<string, number>): boolean {
  const rt = recordText(record);

  const sNouns = properNouns(sentenceText);
  const rNouns = properNouns(rt);
  for (const n of sNouns) if (rNouns.has(n)) return true;

  const sFigures = figures(sentenceText);
  const rFigures = figures(rt);
  for (const f of sFigures) if (rFigures.has(f)) return true;

  const sWords = new Set(wordTokens(sentenceText).filter((w) => w.length >= 4).map((w) => w.toLowerCase()));
  const rWords = new Set(wordTokens(rt).filter((w) => w.length >= 4).map((w) => w.toLowerCase()));
  for (const w of sWords) {
    if (rWords.has(w) && (titleFreq.get(w) ?? 0) <= 3) return true;
  }
  return false;
}

function plainText(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Sentence boundaries at a '.', '!', or '?' character OUTSIDE any tag markup
// (so a period inside an href/title attribute never splits a sentence).
function sentenceSegments(html: string): { start: number; end: number }[] {
  const segments: { start: number; end: number }[] = [];
  let depth = 0;
  let segStart = 0;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '.' || ch === '!' || ch === '?')) {
      segments.push({ start: segStart, end: i + 1 });
      segStart = i + 1;
    }
  }
  if (segStart < html.length) segments.push({ start: segStart, end: html.length });
  return segments;
}

const A_TAG_RE = /<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

// Runs after enforceCitations: every href here already points into the pack.
// A link whose enclosing sentence does not actually mention the cited record
// is unwrapped to a plain <span>, same as an out-of-pack link.
export function checkCitationEntities(html: string | null, pack: ThesisPack): { html: string | null; dropped: string[] } {
  if (!html) return { html, dropped: [] };
  const records = new Map<string, CitedRecord>();
  const labelByHref = new Map<string, string>();
  for (const s of pack.signals) {
    records.set(`/signals/${s.id}`, { title: s.title, summary: s.summary });
    labelByHref.set(`/signals/${s.id}`, s.tag);
  }
  for (const c of pack.claims) {
    records.set(c.href, { title: c.statement, summary: c.test });
    labelByHref.set(c.href, c.code);
  }
  const titleFreq = titleTokenFrequency(pack);
  const segments = sentenceSegments(html);

  const dropped: string[] = [];
  const edits: { start: number; end: number; replacement: string }[] = [];
  A_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = A_TAG_RE.exec(html))) {
    const [full, href, inner] = m;
    const record = records.get(href);
    if (!record) continue;   // an external source_url: nothing local to check against
    const start = m.index;
    const end = start + full.length;
    const seg = segments.find((s) => start >= s.start && start < s.end) ?? { start, end };
    const sentenceText = plainText(html.slice(seg.start, seg.end));
    if (sentenceMentionsRecord(sentenceText, record, titleFreq)) continue;
    const label = labelByHref.get(href) ?? href;
    dropped.push(`${label}: sentence does not mention the cited record`);
    edits.push({ start, end, replacement: `<span>${inner}</span>` });
  }
  if (!edits.length) return { html, dropped: [] };
  let out = '';
  let cursor = 0;
  for (const e of edits) {
    out += html.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  out += html.slice(cursor);
  return { html: out, dropped };
}

// Gate all three narrative slots against the pack and produce the audit fields.
// Deterministic: same HTML + same pack always yields the same result.
export function gateThesisNarrative(
  n: { reading: string | null; counterweight: string | null; bottomLine: string | null },
  pack: ThesisPack
): ThesisNarrative {
  const allow = allowlistFor(pack);
  // Recompute `cited` from whatever survives BOTH gates: a link the entity
  // check unwraps must not still count as cited.
  const citedTagsIn = (html: string | null): string[] => {
    const tags = new Set<string>();
    const re = /<a\s+href="([^"]*)"/g;
    let mm: RegExpExecArray | null;
    while (html && (mm = re.exec(html))) {
      const tag = allow.tagByHref.get(mm[1]);
      if (tag) tags.add(tag);
    }
    return [...tags];
  };
  const gate = (html: string | null) => {
    const cite = enforceCitations(html, allow);
    const entity = checkCitationEntities(cite.html, pack);
    return { html: entity.html, cited: citedTagsIn(entity.html), dropped: [...cite.dropped, ...entity.dropped] };
  };
  const reading = gate(n.reading);
  const counterweight = gate(n.counterweight);
  const bottomLine = gate(n.bottomLine);
  return {
    reading: reading.html,
    counterweight: counterweight.html,
    bottomLine: bottomLine.html,
    citedTags: [...new Set([...reading.cited, ...counterweight.cited, ...bottomLine.cited])].sort(byTagNumber),
    dropped: [...new Set([...reading.dropped, ...counterweight.dropped, ...bottomLine.dropped])].sort(),
  };
}
