import { recordApiCall } from '../cost';
import { gdeltSafeQuery } from './core';
import type { RawScanItem } from './web';

// The scan's second free search leg: GDELT DOC 2.0, a keyless news-article search
// API (docapi.gdeltproject.org), splitting search volume with Tavily's free tier
// (1,000 queries/month) so the daily scan+pipeline load stops running that tier
// dry. Modeled closely on search-tavily.ts's shape.
//
// Response shape verified live 2026-09-01 against
// `GET .../doc/doc?query=<q>&mode=artlist&format=json&maxrecords=25&timespan=Nd`:
//   { "articles": [ { "url", "url_mobile", "title", "seendate": "YYYYMMDDThhmmssZ",
//                      "socialimage", "domain", "language", "sourcecountry" } ] }
// Both error paths return PLAIN TEXT, not JSON, even on HTTP 200: a short/empty
// query 200s with a message body ("Your search contained a keyword that was too
// short." / "The specified phrase is too short."), and the free tier's ~1-req/5s
// limit 429s with a rate-limit notice. Either way JSON.parse throws, which is the
// signal this module treats as a hard failure.
//
// Each batch logs one $0 recordApiCall (model 'gdelt-doc', usage null, no rate
// card), matching search-tavily.ts's discipline so per-run call counts and /costs
// keep counting this leg even though it's free.

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Politeness: GDELT's own 429 body says "Please limit requests to one every 5
// seconds" (verified live 2026-09-01); hammering it also degrades into
// connection resets. 5.1s between queries keeps every loop under the limit.
const BETWEEN_QUERIES_MS = 5100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GdeltArticle {
  url?: string;
  title?: string;
  domain?: string;
  seendate?: string; // 'YYYYMMDDThhmmssZ' observed; treat anything else as unknown
  language?: string;
  sourcecountry?: string;
}

// GDELT's seendate -> 'YYYY-MM-DD' ('' when the prefix doesn't parse, so callers
// treat it like an unknown date same as an empty Tavily published_date).
function seendateToISO(seendate: string | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(String(seendate ?? '').trim());
  if (!m) return '';
  const [, y, mo, d] = m;
  const iso = `${y}-${mo}-${d}`;
  return Number.isNaN(Date.parse(iso)) ? '' : iso;
}

// One raw GDELT DOC 2.0 call: 20s abort, throws on a non-2xx status OR a body
// that fails to parse as JSON (GDELT's own error format, see module note above).
// `sourcelang:english` rides on every query (GDELT's documented language filter);
// mapGdeltResults below ALSO checks the language field defensively in case a
// result slips through un-filtered.
export async function gdeltQuery(opts: {
  query: string;
  days: number;
  maxRecords?: number;
}): Promise<GdeltArticle[]> {
  const params = new URLSearchParams({
    query: `${gdeltSafeQuery(opts.query)} sourcelang:english`,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(opts.maxRecords ?? 25),
    timespan: `${Math.max(1, opts.days)}d`,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${GDELT_URL}?${params.toString()}`, { signal: controller.signal });
    const body = await res.text();
    if (!res.ok) throw new Error(`GDELT ${res.status}: ${body.slice(0, 160)}`);
    let data: { articles?: GdeltArticle[] };
    try {
      data = JSON.parse(body) as { articles?: GdeltArticle[] };
    } catch {
      // GDELT's error responses are plain text on a 200 (short-keyword /
      // short-phrase / rate-limit notices); surface the body as the error.
      throw new Error(`GDELT: ${body.slice(0, 160)}`);
    }
    return data.articles ?? [];
  } finally {
    clearTimeout(timer);
  }
}

// Map raw GDELT articles onto the same item shape search-tavily.ts's
// mapTavilyResults returns, so callers insert GDELT and Tavily results
// identically. blockedDomains mirrors mapTavilyResults (suffix-matched deny
// list); the language check is the defensive half of the sourcelang: filter.
export function mapGdeltResults(
  articles: GdeltArticle[] | undefined,
  blockedDomains: string[] = []
): { url: string; headline: string; source_domain: string; published_date: string }[] {
  const out: { url: string; headline: string; source_domain: string; published_date: string }[] = [];
  for (const a of articles ?? []) {
    const url = String(a.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (a.language && a.language.trim().toLowerCase() !== 'english') continue;
    let domain = String(a.domain ?? '').trim().toLowerCase();
    if (!domain) {
      try {
        domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        continue;
      }
    }
    if (blockedDomains.some((b) => domain === b || domain.endsWith(`.${b}`))) continue;
    out.push({
      url,
      headline: String(a.title ?? '').trim().slice(0, 500),
      source_domain: domain,
      published_date: seendateToISO(a.seendate),
    });
  }
  return out;
}

// The scan's per-topic search, mirroring searchTopicNewsTavily: one GDELT call
// per (already date-token-resolved) query, deduped by url, one in-call retry on
// failure, one $0 cost row per topic-batch.
export async function searchTopicNewsGdelt(opts: {
  topicName: string;
  queries: string[];
  sinceISO: string; // window start; GDELT takes a day count (timespan)
  scanRunId?: string;
}): Promise<RawScanItem[]> {
  if (!opts.queries.length) return [];
  const days = Math.max(
    1,
    Math.ceil((Date.now() - Date.parse(`${opts.sinceISO}T00:00:00Z`)) / 86_400_000)
  );

  const t0 = Date.now();
  const byUrl = new Map<string, RawScanItem>();
  for (let i = 0; i < opts.queries.length; i++) {
    if (i > 0) await sleep(BETWEEN_QUERIES_MS);
    const query = opts.queries[i];
    // One in-call retry per query, same discipline as searchTopicNewsTavily: a
    // lost query is a whole topic-day of coverage.
    let articles: GdeltArticle[];
    try {
      articles = await gdeltQuery({ query, days });
    } catch {
      await sleep(BETWEEN_QUERIES_MS);
      articles = await gdeltQuery({ query, days });
    }
    for (const item of mapGdeltResults(articles)) {
      if (!byUrl.has(item.url)) byUrl.set(item.url, item);
    }
  }

  await recordApiCall({
    feature: 'scan_search',
    model: 'gdelt-doc',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: {
      topic: opts.topicName,
      scan_run: opts.scanRunId ?? null,
      queries: opts.queries.length,
      provider: 'gdelt',
    },
  });
  return [...byUrl.values()];
}
