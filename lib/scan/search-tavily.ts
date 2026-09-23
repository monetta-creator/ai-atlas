import { recordApiCall } from '../cost';
import { LOW_QUALITY_DOMAINS } from '../pipeline/config';
import { mapTavilyResults, type TavilyResult } from './core';
import type { RawScanItem } from './web';

// The scan's LLM-free search leg: Tavily's news search replaces the
// Sonnet + web_search call, because that call's own prompt forbade judgment
// and returned only url/headline/date lists — exactly what a search API
// returns directly. One API call per query (a topic sends at most two). The
// account is on the 4,000-credit plan since 2026-09-23: the free 1,000 ran
// out on 09-22 (about 60 queries per weekday across scan, pipeline, intel and
// tooling is ~1,300 a month).
//
// Each topic logs one $0 recordApiCall (model 'tavily-search', usage null,
// deliberately no rate card) so the /scan run history and /costs keep their
// per-run call counts without inventing a token price for a search API.

const TAVILY_URL = 'https://api.tavily.com/search';

// The quota circuit breaker lives in tavily-breaker.ts (dependency-free so
// scripts/test-scan.mjs can load it); re-exported here for the engines.
export {
  TAVILY_QUOTA_STATUS, TAVILY_QUOTA_NOTE, tavilyAvailable, markTavilyQuotaExhausted,
  resetTavilyBreaker, TAVILY_QUOTA_NOTE_RE,
} from './tavily-breaker';
import { TAVILY_QUOTA_STATUS, markTavilyQuotaExhausted } from './tavily-breaker';

// One raw Tavily query (shared with the pipeline's search legs,
// lib/pipeline/search.ts, and lib/tooling/sources.ts): 20s abort, throws on
// non-2xx, returns the unmapped results array. include_domains restricts to
// an allowlist (the pipeline's breaking sweep / coverage legs). `topic`
// defaults to 'news' (every existing caller's behavior); `days` only makes
// sense for the news topic, so it's sent only then (a 'general' search, e.g.
// the tooling monitor's evergreen pull queries, has no day window). `days`
// is otherwise optional so a 'general' call need not fabricate one.
// `timeRange` (Tavily's `time_range`) is an alternative recency knob for a
// 'general' search. `maxResults` is clamped to Tavily's 20-result ceiling.
export async function tavilyQuery(opts: {
  query: string;
  days?: number;
  topic?: 'news' | 'general';
  timeRange?: 'day' | 'week' | 'month' | 'year';
  maxResults?: number;
  includeDomains?: string[];
}): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set.');
  const topic = opts.topic ?? 'news';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: opts.query,
        topic,
        ...(topic === 'news' && opts.days != null ? { days: opts.days } : {}),
        ...(opts.timeRange ? { time_range: opts.timeRange } : {}),
        max_results: Math.min(20, opts.maxResults ?? 12),
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === TAVILY_QUOTA_STATUS) markTavilyQuotaExhausted();
      throw new Error(`Tavily ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as { results?: TavilyResult[] };
    return data.results ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export async function searchTopicNewsTavily(opts: {
  topicName: string;
  queries: string[]; // already date-token-resolved, <=2
  sinceISO: string;  // window start; Tavily takes a day count
  scanRunId?: string;
}): Promise<RawScanItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set.');
  if (!opts.queries.length) return [];

  const days = Math.max(
    1,
    Math.ceil((Date.now() - Date.parse(`${opts.sinceISO}T00:00:00Z`)) / 86_400_000)
  );

  const t0 = Date.now();
  const byUrl = new Map<string, RawScanItem>();
  const runQuery = async (query: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(TAVILY_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, topic: 'news', days, max_results: 12 }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === TAVILY_QUOTA_STATUS) markTavilyQuotaExhausted();
        throw new Error(`Tavily ${res.status}: ${body.slice(0, 160)}`);
      }
      const data = (await res.json()) as { results?: Parameters<typeof mapTavilyResults>[0] };
      for (const item of mapTavilyResults(data.results, LOW_QUALITY_DOMAINS)) {
        if (!byUrl.has(item.url)) byUrl.set(item.url, item);
      }
    } finally {
      clearTimeout(timer);
    }
  };
  for (const query of opts.queries) {
    // One in-call retry per query: a lost query is a whole topic-day of
    // coverage (the engine checkpoints the topic as searched either way),
    // and the retry costs one free-tier credit. Seen live on day one.
    try {
      await runQuery(query);
    } catch {
      await runQuery(query);
    }
  }

  await recordApiCall({
    feature: 'scan_search',
    model: 'tavily-search',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { topic: opts.topicName, scan_run: opts.scanRunId ?? null, queries: opts.queries.length },
  });
  return [...byUrl.values()];
}
