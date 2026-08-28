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
  error: string | null;
  created_at: string;
  updated_at: string;
  cost_usd?: number;               // joined-in for the console run history
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
