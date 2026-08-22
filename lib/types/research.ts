// ---- Research library -------------------------------------------------------
// Papers/documents worth deep reading, entered by hand or from a curated source
// (no automated pull). Papers carry ADVISORY hypothesis touches only: nothing
// here writes evidence — promotion to a signal (papers.signal_id) and the
// publish gate remain the only road into the record.
export type PaperTriageStatus = 'pending' | 'kept' | 'rejected';
export type PaperReviewStatus = 'pending' | 'noted' | 'tracked' | 'dismissed';
export type ThreadStatus = 'open' | 'settled' | 'dormant';
export type ThreadRelation = 'supports' | 'complicates' | 'contradicts' | 'context';

export interface Paper {
  id: string;
  url: string;
  source_id: string | null;        // set by "Send to research"
  title: string;
  abstract: string | null;
  authors: string[];               // jsonb string array
  published_at: string | null;     // YYYY-MM-DD (cast to text in SQL)
  triage_status: PaperTriageStatus;
  triage_reason: string | null;
  triage_summary: string | null;
  touches: string[];               // advisory hypothesis codes only
  suggested_concepts: string[];    // concept slugs (confirmed via paper_concepts)
  suggested_threads: string[];     // thread slugs (confirmed via thread_papers)
  raw_content: string | null;      // omitted from list reads; present per-paper
  fetched_via: string | null;      // 'source'
  extraction: PaperExtraction | null;
  rigor_prior: number | null;      // 0-100, human-adjustable (model only suggests)
  review_status: PaperReviewStatus;
  review_note: string | null;      // the tracked "why" (required when tracking)
  reviewed_at: string | null;
  signal_id: string | null;        // promotion is additive: the paper stays here
  // Queue-agent recommendation: recommend-only, human commits.
  agent_recommendation: PaperReviewStatus | null;  // never 'pending'
  agent_reason: string | null;
  agent_confidence: number | null; // 0-100
  agent_cluster: string | null;    // short theme label, groups dismissals
  agent_at: string | null;
  created_at: string;
  updated_at: string;
}

// The structured finding — a claim-shaped reading, not a summary.
export interface PaperExtraction {
  headline_claim: string;          // what the paper asserts, one falsifiable sentence
  the_test: string;                // what was actually measured, on what, at what scale
  effect_size: string;             // how big, and where it holds / breaks
  limitations: string;             // what the authors themselves concede
  counterpoint: string;            // what a skeptic says
  strategy_implication: string;    // what it means for the strategy picture, stated with restraint
  // Proposals riding with the finding (model proposes, human commits):
  thread_placements?: { slug: string; relation: ThreadRelation; why: string }[];
  proposed_rigor?: number;         // 0-100 SUGGESTION only — never written to rigor_prior
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

// A paper row as seen from a thread (join fields + the extraction headline).
export interface ThreadPaperRow {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  relation: ThreadRelation;
  why: string | null;
  review_status: PaperReviewStatus;
  review_note: string | null;
  headline: string | null;         // extraction->>'headline_claim'
  effect: string | null;           // extraction->>'effect_size'
}

// The model-proposed-new-threads scan (research_thread_scan singleton):
// recommend-only, reconciled against live thread slugs on read.
export interface ThreadRecommendation {
  slug: string;
  title: string;
  question: string;
  argument: string;
}
export interface ResearchThreadScan {
  generatedAt: string;
  recommendations: ThreadRecommendation[];
}

// The watchlist (tracked papers).
export interface WatchlistRow {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  headline: string | null;           // extraction->>'headline_claim'
  signal_id: string | null;
}

// A thread-synthesis revision as seen from the portal's "what's new" strip.
export interface RecentThreadRevision {
  id: string;
  thread_slug: string;
  thread_title: string;
  trigger_note: string | null;
  created_at: string;
}
