import type { RunStatus, SignalLens } from './core';
// ---- Research section (migration 0023, docs/research-section.md) -----------
// The arXiv intake + research library. Papers carry ADVISORY claim touches only:
// nothing here writes evidence — promotion to a signal (papers.signal_id) and the
// publish gate remain the only road into the Argument Map.
type PaperOrigin = 'arxiv' | 'manual';
export type PaperTriageStatus = 'pending' | 'kept' | 'rejected';
export type PaperReviewStatus = 'pending' | 'noted' | 'tracked' | 'dismissed';
export type ThreadStatus = 'open' | 'settled' | 'dormant';
export type ThreadRelation = 'supports' | 'complicates' | 'contradicts' | 'context';
export type ResearchStep = 'pull' | 'triage' | 'review' | 'complete';

export interface Paper {
  id: string;
  origin: PaperOrigin;
  arxiv_id: string | null;         // versionless, e.g. '2607.07708'; null for non-arXiv
  url: string;
  run_id: string | null;
  source_id: string | null;        // set by "Send to research" (phase 2)
  title: string;
  abstract: string | null;
  authors: string[];               // jsonb string array
  categories: string[];
  comments: string | null;         // arXiv comment (the venue-acceptance signal)
  arxiv_version: number | null;
  published_at: string | null;     // YYYY-MM-DD (cast to text in SQL)
  arxiv_updated: string | null;
  triage_status: PaperTriageStatus;
  triage_reason: string | null;    // model-written one-line relevance (why it survived)
  triage_summary: string | null;   // model-written plain-language summary (what it shows)
  claim_touches: string[];         // advisory codes only
  suggested_concepts: string[];    // concept slugs (confirmed via paper_concepts)
  suggested_threads: string[];     // thread slugs (confirmed via thread_papers)
  raw_content: string | null;      // omitted from list reads; present per-paper
  fetched_via: string | null;
  extraction: PaperExtraction | null;
  rigor_prior: number | null;      // 0-100, human-adjustable (model only suggests)
  review_status: PaperReviewStatus;
  review_note: string | null;      // the tracked "why" (required when tracking)
  reviewed_at: string | null;
  signal_id: string | null;        // promotion is additive: the paper stays here
  citation_count: number | null;
  citations_checked_at: string | null;
  author_hindex: number | null;    // max h-index across authors (S2) — a prior, not a verdict
  // Queue-agent recommendation (migration 0033): recommend-only, human commits.
  agent_recommendation: PaperReviewStatus | null;  // never 'pending'
  agent_reason: string | null;
  agent_confidence: number | null; // 0-100
  agent_cluster: string | null;    // short theme label, groups dismissals
  agent_at: string | null;
  created_at: string;
  updated_at: string;
}

// The structured finding (phase 2) — a claim-shaped reading, not a summary.
export interface PaperExtraction {
  headline_claim: string;          // what the paper asserts, one falsifiable sentence
  the_test: string;                // what was actually measured, on what, at what scale
  effect_size: string;             // how big, and where it holds / breaks
  limitations: string;             // what the authors themselves concede
  counterpoint: string;            // what a skeptic says
  econ_implication: string;        // capability -> economy, 12-24 months, stated with restraint
  who_cares: { lens: SignalLens; note: string }[];  // per-audience-lens one-liners
  // Proposals riding with the finding (model proposes, human commits):
  thread_placements?: { slug: string; relation: ThreadRelation; why: string }[];
  proposed_rigor?: number;         // 0-100 SUGGESTION only — never written to rigor_prior
}

export interface ResearchRun {
  id: string;
  triggered_at: string;
  status: RunStatus;
  step: ResearchStep;
  since_date: string;              // YYYY-MM-DD
  scanned_count: number;
  pulled_count: number;
  kept_count: number;
  rejected_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchThread {
  id: string;
  slug: string;
  title: string;
  question: string;
  synthesis: string | null;        // the living page; null until first update
  status: ThreadStatus;
  paper_count?: number;            // joined-in for list views
  created_at: string;
  updated_at: string;
}

// Phase 3: threads as pages. A paper row as seen from a thread (join fields + the
// extraction headline for the synthesis digest and the thread page).
export interface ThreadPaperRow {
  id: string;
  title: string;
  arxiv_id: string | null;
  url: string;
  published_at: string | null;
  relation: ThreadRelation;
  why: string | null;
  review_status: PaperReviewStatus;
  review_note: string | null;
  headline: string | null;         // extraction->>'headline_claim'
  effect: string | null;           // extraction->>'effect_size'
}

// The model-proposed-new-threads scan (research_thread_scan singleton, mirrors
// concept_gap_scan): recommend-only, reconciled against live thread slugs on read.
// "Create thread" on a card is the human commit.
export interface ThreadRecommendation {
  slug: string;
  title: string;
  question: string;
  argument: string;                // why the existing threads don't cover this
}
export interface ResearchThreadScan {
  generatedAt: string;             // ISO; stamped by the action (server clock)
  recommendations: ThreadRecommendation[];
}

// Phase 4: the watchlist + citation self-correction.
export interface WatchlistRow {
  id: string;
  title: string;
  arxiv_id: string | null;
  url: string;
  published_at: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  headline: string | null;           // extraction->>'headline_claim'
  citation_count: number | null;
  author_hindex: number | null;
  citations_checked_at: string | null;
  signal_id: string | null;
}

// A thread-synthesis revision as seen from the portal's "what's new" strip: the
// trigger note is the human-readable delta ("update after tracking 2607.07708").
export interface RecentThreadRevision {
  id: string;
  thread_slug: string;
  thread_title: string;
  trigger_note: string | null;
  created_at: string;
}

// A paper the funnel passed on that the field disagrees with: rejected or dismissed,
// now compounding citations. The self-correction surface ("you dismissed this, it's
// at 80 citations"); requeue puts it back in the review queue.
export interface RisingReject {
  id: string;
  title: string;
  arxiv_id: string | null;
  url: string;
  published_at: string | null;
  triage_reason: string | null;
  review_status: PaperReviewStatus;
  citation_count: number;
}
