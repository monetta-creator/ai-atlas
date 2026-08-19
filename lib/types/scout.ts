import type { RunStatus } from './core';
// ---- Startup Scout (migration 0034) -----------------------------------------
// The acquisition-target funnel. tracked == the watchlist. The agent layer
// (verdict/scores/reason), review notes, and non-tracked companies are
// ADMIN-ONLY at read time: guest getters never select those columns, so the
// optional fields below are simply absent from public payloads.
export type CompanyStatus = 'queued' | 'tracked' | 'dismissed' | 'archived';
export type CompanyStage = 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'later' | 'unknown';
export type ScoutVerdict = 'pursue' | 'watch' | 'pass';
export type CompanyEventKind = 'funding' | 'launch' | 'news' | 'milestone' | 'note';
type CompanyOrigin = 'discovery' | 'manual';

export interface ScoutVertical {
  slug: string;
  name: string;
  description: string | null;
  search_queries: string[];
  active: boolean;
  tracked_count?: number;          // joined-in for list views
  queued_count?: number;           // admin list views only
}

// The five acquisition-rubric dimensions, each 1-5 (clamped by the writer).
export interface ScoutScores {
  ai_depth: number;
  acquisition_fit: number;
  traction: number;
  team: number;
  integration_cost: number;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  url: string | null;
  vertical: string;
  one_liner: string | null;
  ai_tech: string | null;          // the AI tech itself: the acquisition object
  founded_year: number | null;
  stage: CompanyStage;
  funding_note: string | null;
  hq: string | null;
  status: CompanyStatus;
  origin: CompanyOrigin;
  created_at: string;
  updated_at: string;
  // admin-only columns (never fetched for guests)
  review_note?: string | null;
  reviewed_at?: string | null;
  agent_verdict?: ScoutVerdict | null;
  agent_reason?: string | null;
  agent_confidence?: number | null;
  agent_scores?: ScoutScores | null;
  agent_at?: string | null;
  fetched_via?: string | null;
  run_id?: string | null;
  found_url?: string | null;
  raw_content?: string | null;     // detail reads only
  dossier?: Record<string, unknown> | null;
}

export interface CompanyEvent {
  id: string;
  company_id: string;
  event_date: string;              // 'YYYY-MM-DD' (cast in the getter)
  kind: CompanyEventKind;
  title: string;
  url: string | null;
  note: string | null;
  signal_id: string | null;
  created_at: string;
}

// A recent-activity row for the public monitor: an event joined to its company.
export interface CompanyEventWithCompany extends CompanyEvent {
  company_name: string;
  company_status: CompanyStatus;
}

export interface ScoutRun {
  id: string;
  triggered_at: string;
  status: RunStatus;
  step: 'discovery' | 'complete';
  found_count: number;
  new_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoutPrefs {
  steering: string | null;
  rubric: string | null;           // null means the code's DEFAULT_RUBRIC applies
}

// A retained document about a company (migration 0035): browser-extracted PDF
// text, the file itself never stored. List reads omit the text column.
export interface CompanyDocument {
  id: string;
  company_id: string;
  filename: string;
  origin: 'admin' | 'portal';
  char_count: number;
  doc_summary: string | null;
  created_at: string;
}
