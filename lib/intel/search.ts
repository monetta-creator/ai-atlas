import { recordApiCall } from '../cost';
import { tavilyQuery } from '../scan/search-tavily';
import { mapTavilyResults } from '../scan/core';
import { LOW_QUALITY_DOMAINS } from '../pipeline/config';
import { resolveIntelTokens } from './core';
import type { IntelCompany } from '../types';

// The intel search leg: LLM-free Tavily news search per company. The quota
// knob lives upstream (searchDueSlugs puts each company on a 3-day ring);
// here every call logs its true query count in metadata so getTavilyQuota can
// sum actual API usage across scan, pipeline, and intel.

const MAX_QUERIES_PER_COMPANY = 2;

export interface FoundItem {
  url: string;
  headline: string;
  source_domain: string;
  published_date: string;
}

export async function searchCompanyNewsTavily(opts: {
  company: Pick<IntelCompany, 'slug' | 'name' | 'aliases' | 'search_queries'>;
  sinceISO: string;
  dayISO: string;
  intelRunId?: string;
}): Promise<FoundItem[]> {
  const { company } = opts;
  const days = Math.max(1, Math.ceil((Date.now() - Date.parse(`${opts.sinceISO}T00:00:00Z`)) / 86_400_000));
  // Registry queries first (already company-phrased); fall back to a plain
  // alias query so a queryless company still gets a search on its ring day.
  const queries = (company.search_queries.length
    ? company.search_queries.map((q) => resolveIntelTokens(q, opts.dayISO))
    : [`"${company.aliases[0] ?? company.name}" news`]
  ).slice(0, MAX_QUERIES_PER_COMPANY);

  const t0 = Date.now();
  const byUrl = new Map<string, FoundItem>();
  for (const query of queries) {
    let results;
    try {
      results = await tavilyQuery({ query, days });
    } catch {
      // One in-call retry: a lost query is a company-ring-day of coverage.
      results = await tavilyQuery({ query, days });
    }
    for (const item of mapTavilyResults(results, LOW_QUALITY_DOMAINS)) {
      if (!byUrl.has(item.url)) byUrl.set(item.url, item);
    }
  }
  await recordApiCall({
    feature: 'intel_discovery',
    model: 'tavily-search',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { intel_run: opts.intelRunId, company: company.slug, queries: queries.length, provider: 'tavily' },
  });
  return [...byUrl.values()];
}
