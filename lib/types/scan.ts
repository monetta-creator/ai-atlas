import type { RunStatus } from './core';
// ---- External Scan (migration 0038) -----------------------------------------
// Outside-the-firewall signal discovery: a daily cron-driven sweep across
// configurable news topics (feeds + web search), hydrated to full text and
// lightly enriched, published as the key-gated `external-scan` dataset. The
// whole surface is admin-only except that dataset.

export type ScanStep = 'feeds' | 'search' | 'hydrate' | 'enrich' | 'complete';
export type ScanFetchStatus = 'pending' | 'done' | 'failed' | 'skipped';
export type ScanEnrichStatus = 'pending' | 'done' | 'skipped' | 'error';

export interface ScanTopic {
  slug: string;
  name: string;
  description: string | null;
  taxonomy_code: string;
  search_queries: string[];        // empty = feeds-only topic (the cost knob)
  feed_urls: string[];
  active: boolean;
  created_at: string;
}

export interface ScanRun {
  id: string;
  day: string;                     // 'YYYY-MM-DD' (cast in the getter)
  status: RunStatus;
  step: ScanStep;
  searched_topics: string[];       // per-topic search checkpoints
  feed_item_count: number;
  search_item_count: number;
  hydrated_count: number;
  enriched_count: number;
  skipped_count: number;
  notes: string[];                 // persisted issue notes (0040): dead feeds, failed searches, budget trips
  error: string | null;
  created_at: string;
  updated_at: string;
  cost_usd?: number;               // joined-in for the console run history
}

// The /scan health panel's aggregate read (window = trailing N days).
export interface ScanHealth {
  days: number;
  runs: { completed: number; failed: number; running: number; missedDays: number };
  items: {
    total: number;
    feed: number;
    search: number;
    fetchDone: number;
    fetchFailed: number;
    enrichDone: number;
    enrichSkipped: number;
    enrichError: number;
    avgRelevance: number | null;
    highRelevance: number;          // relevance >= 0.7
    domains: number;                // distinct source domains
  };
  spendUsd: number;
  topicYield: {
    slug: string;
    taxonomy_code: string;
    name: string;
    searchable: boolean;            // active with search queries
    hasFeeds: boolean;              // any feed_urls (a topic with neither is dormant: tag-only)
    active: boolean;
    items: number;
    lastItem: string | null;        // 'YYYY-MM-DD'
  }[];
  issues: { day: string; note: string }[];
}

// The step engine's per-invocation report (cron response + console ticks).
export interface ScanProgress {
  runId: string;
  day: string;
  step: ScanStep;
  done: boolean;
  counters: {
    feedItems: number;
    searchItems: number;
    hydrated: number;
    enriched: number;
    skipped: number;
  };
  notes: string[];
}
