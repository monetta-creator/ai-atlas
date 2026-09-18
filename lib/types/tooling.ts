import type { RunStatus } from './core';

// ---- AI Tooling Monitor (migration 0054) ------------------------------------
// The market-monitor portal: a curated category registry, a weekly discovery
// + catalog engine, and four kinds of generated report. Public catalog; a
// portal key unlocks reports, adds, and the deep-dive button; the console is
// admin-only. Mirrors the Intel Desk / Startup Scout type-file shape.

export type ToolingStatus = 'candidate' | 'cataloged' | 'parked' | 'dismissed';
export type ToolingMaturity =
  | 'startup_early' | 'startup_growth' | 'scaleup' | 'incumbent' | 'big_tech'
  | 'open_source_project' | 'unknown';
export type ToolingOrigin = 'tavily' | 'hn' | 'producthunt' | 'github' | 'enumeration' | 'manual' | 'feed';
export type ToolingEventKind =
  | 'launch' | 'funding' | 'feature' | 'pricing' | 'partnership' | 'news' | 'changelog' | 'note';
export type ToolingStep =
  | 'discover' | 'hydrate' | 'enrich' | 'score' | 'finish' | 'events' | 'deepdive' | 'report' | 'complete';
export type ToolingRunKind = 'weekly' | 'pull';

export interface ToolingCategory {
  slug: string;
  name: string;
  description: string | null;
  search_queries: string[];        // weekly, news-shaped, {year}/{month} tokens; admin-only at read time
  pull_queries: string[];          // evergreen (the one-time big pull); admin-only at read time
  hn_query: string | null;         // 2-4 keywords; admin-only at read time
  github_query: string | null;     // 2-4 keywords; admin-only at read time
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// The five 1-5 rubric dimensions the scoring agent fills in agent_scores.
export interface ToolingScores {
  relevance: number;
  enterprise_readiness: number;
  differentiation: number;
  momentum: number;
  build_difficulty: number;
  steal?: string[];                 // up to three features worth copying (the scorer writes it)
}

// Every column, grouped by visibility (see lib/data/tooling.ts's
// PRODUCT_PUBLIC/PORTAL/ADMIN_COLUMNS): a guest getter's SELECT omits the
// optional keys entirely, so they're simply absent from the object (the
// Company/IntelItem convention).
export interface ToolingProduct {
  id: string;
  name: string;
  slug: string;
  vendor: string | null;
  vendor_domain: string | null;
  url: string | null;
  category: string;                // tooling_categories.slug
  secondary_categories: string[];
  one_liner: string | null;
  description: string | null;
  target_buyer: string[];
  deployment: string[];
  pricing_model: string | null;
  pricing_note: string | null;
  maturity: ToolingMaturity;
  founded_year: number | null;
  hq: string | null;
  funding_note: string | null;
  notable_customers: string[];
  integrations: string[];
  compliance_claims: string[];
  models_used: string[];
  features: string[];
  feed_url: string | null;
  changelog_url: string | null;
  github_repo: string | null;
  feed_checked_at: string | null;
  status: ToolingStatus;
  pinned: boolean;
  dossier: ToolingDossier | null;
  first_seen: string;              // 'YYYY-MM-DD'
  last_seen: string;                // 'YYYY-MM-DD'
  created_at: string;
  updated_at: string;
  // portal-only (added to PRODUCT_PORTAL_COLUMNS)
  deep_dive?: ToolingDeepDive | null;
  agent_fit?: number | null;
  agent_scores?: ToolingScores | null;
  agent_reason?: string | null;
  // admin-only (added to PRODUCT_ADMIN_COLUMNS)
  review_note?: string | null;
  reviewed_at?: string | null;
  agent_model?: string | null;
  agent_at?: string | null;
  raw_content?: string | null;
  fetched_via?: string | null;
  fetched_at?: string | null;
  fetch_error?: string | null;
  enriched_at?: string | null;
  enriched_by?: string | null;
  deep_dived_at?: string | null;
  origin?: ToolingOrigin;
  found_url?: string | null;
  found_title?: string | null;
  run_id?: string | null;
}

export interface ToolingEvent {
  id: string;
  product_id: string;
  event_date: string;              // 'YYYY-MM-DD'
  kind: ToolingEventKind;
  title: string;
  url: string | null;
  note: string | null;             // working provenance, never exported
  source: 'feed' | 'deepdive' | 'discover' | 'manual';
  created_at: string;
}

export interface ToolingRun {
  id: string;
  kind: ToolingRunKind;
  day: string;                     // 'YYYY-MM-DD' (the Monday UTC for a weekly run)
  status: RunStatus;
  step: ToolingStep;
  swept_units: string[];
  found_count: number;
  inserted_count: number;
  hydrated_count: number;
  enriched_count: number;
  scored_count: number;
  cataloged_count: number;
  deep_dived_count: number;
  event_count: number;
  report_id: string | null;
  notes: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
  cost_usd?: number;                // joined-in for the console run history
}

export interface ToolingPrefs {
  enabled: boolean;
  steering: string | null;
  rubric: string | null;            // null means the code's DEFAULT_RUBRIC applies
  utility_model: string | null;     // resolved default applied (null when OPENROUTER_API_KEY is unset)
  enrich_model: string | null;      // resolved default applied
  catalog_threshold: number;
  deep_dive_threshold: number;
  deep_dive_cap: number;
  auto_publish_entrants: boolean;
}

// The step engine's per-invocation report (cron response + console ticks).
export interface ToolingProgress {
  runId: string;
  kind: ToolingRunKind;
  day: string;
  step: ToolingStep;
  done: boolean;
  counters: {
    found: number;
    inserted: number;
    hydrated: number;
    enriched: number;
    scored: number;
    cataloged: number;
    deepDived: number;
    events: number;
  };
  notes: string[];
  busy?: boolean;
}

// The machine's own record about a product, monotonically merged
// (lib/tooling/core.ts mergeToolingDossier) across three writers: the
// homepage enrichment sweep, an on-demand deep dive, and a manual admin edit.
export interface ToolingDossier {
  summary: string | null;
  features: string[];
  customers: string[];
  integrations: string[];
  sources: string[];               // URLs the tools consulted
  updated_by: 'homepage' | 'deepdive' | 'manual';
  updated_at: string;               // ISO, stamped by the caller
}

// A structured on-demand or automatic deep dive (lib/tooling/deepdive.ts).
export interface ToolingDeepDive {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  pricing_detail: string | null;
  compliance: string[];
  customers: string[];
  competitors: string[];
  recent_news: { title: string; url: string; date: string | null }[];
  sources: string[];
  researched_at: string;            // ISO
}

// Read-layer visibility switch, threaded through getProduct/searchProducts.
export interface ToolingViewer {
  admin: boolean;
  portal: boolean;
}

// A raw discovery hit, before triage names it as a product candidate.
export interface RawHit {
  title: string;
  url: string;
  snippet: string;
  source: ToolingOrigin;
  publishedISO: string | null;
}

// One triaged, plausibly-a-product candidate, before insertProducts resolves
// it against the existing catalog.
export interface TriagedProduct {
  name: string;
  vendor: string | null;
  product_url: string | null;
  one_liner: string;
  category: string;                 // tooling_categories.slug
  found_url: string;
  found_title: string;
  origin: ToolingOrigin;
}
