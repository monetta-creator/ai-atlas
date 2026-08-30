import type { RunStatus } from './core';
import type { ScanFetchStatus, ScanEnrichStatus } from './scan';
// ---- Intel Desk (migration 0043) --------------------------------------------
// A company-intelligence registry with a daily collection engine (feeds,
// search, filings, hydrate, enrich), structured fact extraction, LLM-free
// quarterly metrics, and key-gated dataset export. Admin-only surface; the
// real registry lives in untracked private/intel-companies.json.

export type IntelTier =
  | 'self' | 'card_issuer' | 'consumer_bank' | 'fintech' | 'tech_platform' | 'wildcard';
export type IntelStep = 'feeds' | 'search' | 'filings' | 'hydrate' | 'enrich' | 'complete';
export type IntelDocType = 'news' | 'press' | 'filing' | 'transcript' | 'report';
export type IntelMetricSource = 'edgar_xbrl' | 'fdic' | 'cfpb';

export interface IntelCompany {
  slug: string;
  name: string;
  tier: IntelTier;
  niche: string | null;
  ticker: string | null;
  cik: string | null;              // SEC CIK, digits only (padded at call sites)
  rssd_id: string | null;
  fdic_cert: string | null;
  lei: string | null;
  domain: string | null;
  aliases: string[];               // exact search phrases
  feed_urls: string[];
  search_queries: string[];        // {year}/{month} tokens resolved per run
  active: boolean;
  dossier: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntelRun {
  id: string;
  day: string;                     // 'YYYY-MM-DD' (cast in the getter)
  status: RunStatus;
  step: IntelStep;
  swept_units: string[];           // 'feeds', 'search:<slug>', 'filings:<slug>'
  feed_item_count: number;
  search_item_count: number;
  filing_item_count: number;
  hydrated_count: number;
  enriched_count: number;
  skipped_count: number;
  fact_count: number;
  metric_count: number;
  notes: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
  cost_usd?: number;               // joined-in for the console run history
}

export interface IntelItem {
  id: string;
  run_id: string;
  company_slug: string | null;     // primary company
  company_slugs: string[];         // every registry company the enrichment linked
  url: string;
  normalized_url: string;
  headline: string | null;
  source_domain: string | null;
  published_date: string | null;
  discovered_via: string;          // 'feed' | 'search' | 'edgar' | 'manual'
  doc_type: IntelDocType;
  raw_content: string | null;
  fetched_via: string | null;
  fetch_status: ScanFetchStatus;
  fetch_error: string | null;
  enrich_status: ScanEnrichStatus;
  summary: string | null;
  dimensions: string[];            // allow-listed against INTEL_DIMENSIONS
  entities: string[];
  significance: number | null;     // 0-1
  enriched_by: string | null;
  created_at: string;
}

export interface IntelFact {
  id: string;
  company_slug: string;
  dimension: string;
  fact: string;
  value_text: string | null;
  as_of: string | null;
  item_id: string | null;
  created_at: string;
}

export interface IntelMetric {
  id: string;
  company_slug: string;
  metric_code: string;
  period: string;
  value: number | null;
  unit: string | null;
  source: IntelMetricSource;
  fetched_at: string;
}

export interface IntelProgress {
  runId: string;
  day: string;
  step: IntelStep;
  done: boolean;
  counters: {
    feedItems: number;
    searchItems: number;
    filingItems: number;
    hydrated: number;
    enriched: number;
    skipped: number;
    facts: number;
    metrics: number;
  };
  notes: string[];
}

export interface IntelPrefs {
  enabled: boolean;
  enrich_models: string[];         // empty = Haiku baseline
  utility_model: string | null;
}
