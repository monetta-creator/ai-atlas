import { recordApiCall } from '../cost';
import { LOW_QUALITY_DOMAINS } from '../pipeline/config';
import { mapTavilyResults } from './core';
import type { RawScanItem } from './web';

// The scan's LLM-free search leg: Tavily's news search replaces the
// Sonnet + web_search call, because that call's own prompt forbade judgment
// and returned only url/headline/date lists — exactly what a search API
// returns directly. One API call per query (a topic sends at most two), free
// tier 1,000/month against roughly 700 used.
//
// Each topic logs one $0 recordApiCall (model 'tavily-search', usage null,
// deliberately no rate card) so the /scan run history and /costs keep their
// per-run call counts without inventing a token price for a search API.

const TAVILY_URL = 'https://api.tavily.com/search';

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
  for (const query of opts.queries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
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
        throw new Error(`Tavily ${res.status}: ${body.slice(0, 160)}`);
      }
      const data = (await res.json()) as { results?: Parameters<typeof mapTavilyResults>[0] };
      for (const item of mapTavilyResults(data.results, LOW_QUALITY_DOMAINS)) {
        if (!byUrl.has(item.url)) byUrl.set(item.url, item);
      }
    } finally {
      clearTimeout(timer);
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
