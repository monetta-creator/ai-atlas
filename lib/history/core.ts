// Pure core for the one-time backfill since ChatGPT (scripts/history-backfill.mts,
// docs/history-backfill.md) and the reader organization's public record
// (docs/self-record.md). Zero imports beyond types, zero DB: tested from plain
// Node by scripts/test-history-core.mjs.
//
// The reader organization's name never appears here: every self query is
// built from the registry row the script reads.

export type Lens = 'market' | 'labor' | 'geopolitics' | 'regulatory' | 'capability' | 'society';
export const LENSES: Lens[] = ['market', 'labor', 'geopolitics', 'regulatory', 'capability', 'society'];

// ChatGPT's public launch; the backfill's floor.
export const HISTORY_START = '2022-11-30';
// The engines' first live day; the backfill's ceiling (everything after is theirs).
export const HISTORY_END = '2026-08-27';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export interface MonthWindow {
  month: string; // YYYY-MM-01, the window key
  start: string; // YYYY-MM-DD, clipped to HISTORY_START
  end: string;   // YYYY-MM-DD, clipped to HISTORY_END
  label: string; // "March 2024"
  name: string;  // "March"
  year: string;  // "2024"
}

// Calendar months from `from` to `to` inclusive, each clipped to the bounds.
export function monthWindows(from = HISTORY_START, to = HISTORY_END): MonthWindow[] {
  const out: MonthWindow[] = [];
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t) return out;
  let y = f.getUTCFullYear();
  let m = f.getUTCMonth();
  while (y < t.getUTCFullYear() || (y === t.getUTCFullYear() && m <= t.getUTCMonth())) {
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(y, m + 1, 0));
    const start = first < f ? f : first;
    const end = last > t ? t : last;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    out.push({
      month: iso(first), start: iso(start), end: iso(end),
      label: `${MONTHS[m]} ${y}`, name: MONTHS[m], year: String(y),
    });
    m += 1;
    if (m === 12) { m = 0; y += 1; }
  }
  // A clipped first window shorter than a week (ChatGPT launched on Nov 30,
  // so November is one day) folds into the next month: Tavily refuses a
  // window whose start equals its end, and a one-day month is not a month.
  if (out.length > 1) {
    const a = out[0];
    const days = (Date.parse(`${a.end}T00:00:00Z`) - Date.parse(`${a.start}T00:00:00Z`)) / 86_400_000;
    if (days < 6) { out[1] = { ...out[1], start: a.start }; out.shift(); }
  }
  return out;
}

// Two month-anchored, news-shaped queries per audience lens. Written for the
// whole era rather than today's headlines (the live lens templates name
// 2026 specifics like H20 rulings and Kimi, which return nothing for 2023).
export const HISTORY_LENS_QUERIES: Record<Lens, string[]> = {
  market: [
    'AI investment funding round valuation {month} {year}',
    'AI chips data center spending Nvidia earnings {month} {year}',
  ],
  labor: [
    'AI jobs layoffs workforce automation {month} {year}',
    'AI workplace productivity adoption study {month} {year}',
  ],
  geopolitics: [
    'AI chip export controls China {month} {year}',
    'national AI strategy compute sovereignty {month} {year}',
  ],
  regulatory: [
    'AI regulation law policy government {month} {year}',
    'AI lawsuit copyright ruling {month} {year}',
  ],
  capability: [
    'new AI model release announcement {month} {year}',
    'AI breakthrough benchmark open source model {month} {year}',
  ],
  society: [
    'AI public opinion survey trust {month} {year}',
    'AI deepfakes misinformation education creative industry {month} {year}',
  ],
};

export function fillTokens(template: string, w: MonthWindow, name = ''): string {
  return template.replaceAll('{month}', w.name).replaceAll('{year}', w.year).replaceAll('{name}', name)
    .replace(/\s+/g, ' ').trim();
}

export function lensQueriesFor(lens: Lens, w: MonthWindow): string[] {
  return HISTORY_LENS_QUERIES[lens].map((t) => fillTokens(t, w));
}

// One month-level roundup query per window: the probe (2026-09-27) showed the
// generic lens queries miss the month's landmarks (December 2022 returned no
// ChatGPT story), while "top AI stories of the month" pieces list them. Its
// results are filed under the lens the triage assigns.
export const ROUNDUP_QUERY = 'biggest AI news stories of {month} {year}';
export function roundupQueryFor(w: MonthWindow): string {
  return fillTokens(ROUNDUP_QUERY, w);
}

// The self company's monthly news queries, built from the registry row's name.
// The name is QUOTED and sent with Tavily's exact_match: unquoted, a two-word
// name built from common words matched unrelated entities in the probe (a
// venture firm, a sports arena). The date lives in the window, not the query.
export const SELF_QUERY_TEMPLATES = [
  '"{name}" artificial intelligence machine learning',
  '"{name}" technology cloud data engineering',
  '"{name}"',
];
export function selfQueriesFor(name: string, w: MonthWindow): string[] {
  return SELF_QUERY_TEMPLATES.map((t) => fillTokens(t, w, name));
}

// ---- Tavily credit reserve ---------------------------------------------------
// The backfill never spends the credits the live crons need: it stops when the
// month-to-date count plus the next unit would cross (cap - reserve).
export const TAVILY_RESERVE = 600;
export function tavilyRoom(monthToDate: number, cap: number, reserve = TAVILY_RESERVE): number {
  return Math.max(0, cap - reserve - Math.max(0, monthToDate));
}

// ---- Dates ---------------------------------------------------------------------
// Tavily's published_date arrives as an RFC-1123 string, an ISO string, or not at
// all. Returns YYYY-MM-DD or null.
export function isoDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
export function inWindow(day: string | null, w: Pick<MonthWindow, 'start' | 'end'>, slackDays = 3): boolean {
  if (!day) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  const s = Date.parse(`${w.start}T00:00:00Z`) - slackDays * 86_400_000;
  const e = Date.parse(`${w.end}T00:00:00Z`) + slackDays * 86_400_000;
  return t >= s && t <= e;
}

// ---- Landmarks -----------------------------------------------------------------
export interface KeptItem {
  id: string;
  title: string;
  lens: Lens;
  significance: 'high' | 'medium' | 'low' | null;
  source_tier: number | null;
  published_date: string;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'and', 'for', 'on', 'with', 'as', 'at', 'by',
  'is', 'its', 'new', 'from', 'after', 'over', 'says', 'said', 'will', 'ai']);
export function titleTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w)));
}
// Distinctive names in a headline: capitalized words that are not sentence
// starters or common words (a company, a model, a person, a country pair).
const COMMON_CAPS = new Set(['the', 'how', 'why', 'what', 'new', 'report', 'study', 'ai', 'us', 'u.s.', 'global', 'top',
  'first', 'after', 'inside', 'here', 'this', 'more', 'big', 'tech', 'startup', 'defense', 'news']);
export function headlineNames(title: string): Set<string> {
  const words = title.replace(/[^A-Za-z0-9.\- ]+/g, ' ').split(/\s+/).filter(Boolean);
  return new Set(words.filter((_w, i) => i > 0 || words.length === 1)
    .filter((w) => /^[A-Z][A-Za-z0-9.-]{2,}$/.test(w) && !COMMON_CAPS.has(w.toLowerCase()))
    .map((w) => w.toLowerCase()));
}
// Two headlines are the same story when their tokens overlap heavily, or when
// they share a distinctive name and still overlap a little ("Anduril raises
// $1.48 billion" vs "Defense tech startup Anduril raises massive $1.5B round").
export function sameStory(a: string, b: string): boolean {
  const j = jaccard(titleTokens(a), titleTokens(b));
  if (j >= 0.33) return true;
  if (j < 0.1) return false;
  const na = headlineNames(a);
  for (const n of headlineNames(b)) if (na.has(n)) return true;
  return false;
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const SIG_WEIGHT = { high: 3, medium: 1.5, low: 0.5 } as const;
function landmarkScore(i: KeptItem): number {
  const sig = i.significance ? SIG_WEIGHT[i.significance] : 1;
  const tier = i.source_tier == null ? 0.8 : ({ 1: 1.2, 2: 1, 3: 0.75, 4: 0.3 } as Record<number, number>)[i.source_tier] ?? 0.8;
  return sig * tier;
}

// A month's landmarks: the strongest kept items, no near-duplicate headlines
// (sameStory), at most `perLens` from one lens so a busy
// lens cannot crowd out the rest, up to `perMonth` in all. Low significance
// never qualifies.
// Headlines that are containers, not developments: a newsletter, a roundup,
// an explainer. The triage prompt rejects them too; this catches the rest.
export const LANDMARK_NOISE_RE = /\b(newsletter|roundup|round-up|week in review|what'?s next|explained|explainer|top \d+|\d+ (things|ways))\b/i;

export function pickLandmarks(items: KeptItem[], perMonth = 8, perLens = 3): KeptItem[] {
  const ranked = items
    .filter((i) => i.significance !== 'low' && !LANDMARK_NOISE_RE.test(i.title))
    .sort((a, b) => landmarkScore(b) - landmarkScore(a) || a.published_date.localeCompare(b.published_date));
  const out: KeptItem[] = [];
  const perLensCount = new Map<Lens, number>();
  for (const i of ranked) {
    if (out.length >= perMonth) break;
    if ((perLensCount.get(i.lens) ?? 0) >= perLens) continue;
    if (out.some((o) => sameStory(o.title, i.title))) continue;
    out.push(i);
    perLensCount.set(i.lens, (perLensCount.get(i.lens) ?? 0) + 1);
  }
  return out;
}

// ---- AI passages in filings ------------------------------------------------------
export const AI_TERMS_RE = /\b(artificial intelligence|machine learning|generative ai|gen ?ai|large language models?|llms?|neural networks?|deep learning|natural language processing|foundation models?|ai(?:-| )(?:powered|driven|enabled|models?|tools?|capabilities|technolog(?:y|ies)|agents?|assistants?)|chatbots?|model risk management)\b/i;

// Paragraph-level extraction from a filing's plain text: every paragraph that
// names an AI term, trimmed to `maxChars`, deduplicated by its first 120
// characters (filings repeat risk-factor boilerplate across sections), capped.
export function extractAiPassages(text: string, opts: { max?: number; maxChars?: number } = {}): string[] {
  const max = opts.max ?? 12;
  const maxChars = opts.maxChars ?? 1200;
  const paras = text.split(/\n\s*\n|(?<=[.!?])\s{2,}/).map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 80);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paras) {
    if (!AI_TERMS_RE.test(p)) continue;
    // A paragraph of undecodable glyphs (two annual-report PDFs extracted as
    // U+FFFD runs) is noise, not a passage.
    if ((p.match(/\uFFFD/g)?.length ?? 0) > p.length * 0.02) continue;
    const key = p.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.length > maxChars ? `${p.slice(0, maxChars - 1).trimEnd()}…` : p);
    if (out.length >= max) break;
  }
  return out;
}

// Strip an SEC HTML document to readable text (script/style dropped, block
// tags to paragraph breaks, entities decoded for the common cases).
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;/g, '’').replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#822[01];/g, '"').replace(/&#[0-9]+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Citation gates for the synthesis --------------------------------------------
export interface TimelineEventIn {
  event_date?: unknown;
  category?: unknown;
  headline?: unknown;
  body?: unknown;
  record_ids?: unknown;
}
export interface TimelineEvent {
  event_date: string;
  category: string;
  headline: string;
  body: string;
  record_ids: string[];
}
export const TIMELINE_CATEGORIES = ['launch', 'statement', 'hire', 'paper', 'patent', 'partnership',
  'regulatory', 'acquisition', 'investment', 'other'];

// Keep an event only when it cites at least one known record and its date
// parses; unknown ids are dropped from the list, an event left with none is
// dropped whole (the citation-gate pattern). No em dashes survive.
export function validateTimeline(events: TimelineEventIn[], known: Set<string>): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const e of Array.isArray(events) ? events : []) {
    const ids = Array.isArray(e.record_ids) ? e.record_ids.map(String).filter((id) => known.has(id)) : [];
    const date = isoDay(String(e.event_date ?? ''));
    const headline = deDash(String(e.headline ?? '')).slice(0, 200);
    if (!ids.length || !date || !headline) continue;
    const cat = String(e.category ?? 'other');
    out.push({
      event_date: date,
      category: TIMELINE_CATEGORIES.includes(cat) ? cat : 'other',
      headline,
      body: deDash(String(e.body ?? '')).slice(0, 800),
      record_ids: [...new Set(ids)],
    });
  }
  return out.sort((a, b) => a.event_date.localeCompare(b.event_date));
}

export interface ProfileSentence { text: string; record_ids: string[] }
export function validateProfile(sentences: unknown, known: Set<string>, max = 15): ProfileSentence[] {
  const out: ProfileSentence[] = [];
  for (const s of Array.isArray(sentences) ? sentences : []) {
    const o = s as { text?: unknown; record_ids?: unknown };
    const ids = Array.isArray(o.record_ids) ? o.record_ids.map(String).filter((id) => known.has(id)) : [];
    const text = deDash(String(o.text ?? '')).trim().slice(0, 500);
    if (!ids.length || !text) continue;
    out.push({ text, record_ids: [...new Set(ids)] });
    if (out.length >= max) break;
  }
  return out;
}

export function deDash(s: string): string {
  return s.replace(/\s*—\s*/g, ', ');
}
