import { recordApiCall } from '../cost';
import * as m from '../mutations';
import type { RawCandidate } from './web';

// A docket-level discovery leg alongside the news/web ones: CourtListener's
// RECAP search surfaces AI copyright/IP litigation against model vendors
// (and adjacent FTC/SEC actions) often days before press coverage. v4's
// anonymous search endpoint is keyless and unthrottled in spike testing
// (2026-09-01: ~10 calls, no 429s, no rate-limit headers) so this needs no
// API key, unlike Tavily/OpenRouter. type=r scopes results to RECAP dockets;
// order_by=dateFiled desc + filed_after=<sinceISO> gives one page (20 items)
// of the newest matching filings, matching the other legs' per-query cap.
//
// The search is full-text over docket filings, not just case names, so a
// bare topical phrase (e.g. "artificial intelligence" AND copyright) still
// pulls in some unrelated suits that happen to mention the phrase in a filed
// document; that noise is what triage exists for, same as any other
// discovery leg. The vendor-name query scopes to caseName specifically
// (spike-verified: an unscoped vendor query drowns in unrelated Meta/Google
// social-media litigation, 229 hits vs 17 caseName-scoped).

const CL_BASE = 'https://www.courtlistener.com/api/rest/v4/search/';
const USER_AGENT = 'AI-Atlas-Discovery/1.0 (research tool; contact: monettacollective@gmail.com)';

export const COURTLISTENER_QUERIES: string[] = [
  // AI/LLM copyright suits.
  '("artificial intelligence" OR "large language model") AND copyright',
  // Suits naming a major model vendor (caseName-scoped: Meta/Google alone are
  // too noisy without it, see above).
  '(caseName:(OpenAI OR Anthropic OR "Stability AI" OR Midjourney) OR ' +
    '((caseName:"Meta Platforms" OR caseName:"Google LLC" OR caseName:"Google DeepMind") AND "artificial intelligence"))',
  // AI training-data suits.
  '"artificial intelligence" AND ("training data" OR "training dataset" OR "training set" OR "web scraping")',
  // AI-related FTC/SEC enforcement actions (caseName-scoped to the agency as
  // plaintiff, or the query is dominated by unrelated cases that merely cite
  // the agencies).
  'caseName:("Federal Trade Commission" OR "Securities and Exchange Commission") AND "artificial intelligence"',
];

interface CourtListenerResult {
  caseName?: string;
  court?: string;
  dateFiled?: string;
  docket_absolute_url?: string;
}

// Pure fetch + normalize for one query: no DB access, so a throwaway script
// can call this directly against the live API to sanity-check a query.
// Throws on a non-2xx response or a network/timeout error (the engine's
// discovery-unit try/catch turns that into a note, never fatal).
export async function fetchCourtListenerQuery(query: string, sinceISO: string): Promise<RawCandidate[]> {
  const url =
    `${CL_BASE}?q=${encodeURIComponent(query)}&type=r` +
    `&order_by=${encodeURIComponent('dateFiled desc')}&filed_after=${encodeURIComponent(sinceISO)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`CourtListener ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as { results?: CourtListenerResult[] };
    const out: RawCandidate[] = [];
    for (const r of data.results ?? []) {
      if (!r.docket_absolute_url || !r.caseName) continue;
      const dateFiled = r.dateFiled ?? '';
      out.push({
        url: `https://www.courtlistener.com${r.docket_absolute_url}`,
        headline: `${r.caseName} (${r.court ?? 'federal court'}, filed ${dateFiled || 'date unknown'})`,
        source_domain: 'courtlistener.com',
        published_date: dateFiled,
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// The discovery unit the engine dispatches: runs the fixed query list with a
// 1s politeness delay between calls, inserts hits as 'regulatory'-lens
// candidates through the same insert path every discovery leg uses
// (unique(run_id, url) dedupes), and logs one $0 cost row for the whole
// batch (mirrors search-tavily.ts's per-topic row: no rate card, so the run
// history and /costs keep an honest per-run call count without inventing a
// token price for a search API).
export async function searchCourtListener(runId: string, sinceISO: string): Promise<number> {
  const t0 = Date.now();
  const byUrl = new Map<string, RawCandidate>();
  for (let i = 0; i < COURTLISTENER_QUERIES.length; i++) {
    const hits = await fetchCourtListenerQuery(COURTLISTENER_QUERIES[i], sinceISO);
    for (const h of hits) if (!byUrl.has(h.url)) byUrl.set(h.url, h);
    if (i < COURTLISTENER_QUERIES.length - 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const inserted = await m.insertCandidates(runId, 'regulatory', [...byUrl.values()], COURTLISTENER_QUERIES);
  await recordApiCall({
    feature: 'pipeline_discovery',
    model: 'courtlistener',
    usage: null,
    wallMs: Date.now() - t0,
    pipelineRunId: runId,
    metadata: { provider: 'courtlistener', queries: COURTLISTENER_QUERIES.length },
  });
  return inserted;
}
