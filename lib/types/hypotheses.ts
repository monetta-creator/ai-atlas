import type { Direction, SignalContext, SignalOrigin, Significance } from './core';
// ---- Hypothesis reports -----------------------------------------------------
// Frozen per-hypothesis runs: the deterministic evidence pack + computed stats
// live in `pack` (jsonb, guest-safe BY CONSTRUCTION — a saved report is publicly
// shareable, so no conviction, rationale, admin note, or reliability prior may
// ever enter these shapes); the cited AI narrative in `narrative` (sanitized
// HTML, citation-gated). Reports are immutable rows: a re-run inserts a new row;
// `signal_ids` lets the next run diff against this one.

// One matched signal in the frozen pack. `tag` (S1, S2, ...) is the per-pack
// citation handle; assignment order is deterministic (touch-matched by recency
// then id, then text-only matches by rank), so the same corpus always yields
// the same tags.
export interface HypothesisPackSignal {
  id: string;
  tag: string;
  title: string;
  summary: string | null;
  significance: Significance;
  context: SignalContext;
  published_at: string | null;      // 'YYYY-MM-DD'
  origin: SignalOrigin;
  source_title: string | null;
  source_url: string | null;
  source_domain: string | null;     // normalized hostname (www. stripped)
  matched_via: ('touch' | 'text')[];
  rank: number | null;              // ts_rank when text-matched
  // How the signal bears on THIS hypothesis (from its materialized evidence).
  direction: Direction | null;      // null for text-only matches (untyped)
}

// A quoted excerpt bearing on the hypothesis (evidence.excerpt is public; the
// admin-only evidence.note never enters the pack).
export interface HypothesisPackEvidence {
  direction: Direction;
  excerpt: string;
  signal_id: string | null;
  signal_tag: string | null;        // resolvable when the signal is in the pack
}

export interface HypothesisStats {
  scanned: number;                  // published signals in the corpus at build time
  matched: number;                  // pack signals
  byMatch: { touch: number; text: number; both: number };
  // Signal-level direction counts (untyped = text-only matches).
  directions: { supports: number; contradicts: number; neutral: number; untyped: number };
  significance: { high: number; medium: number; low: number };
  contexts: { context: SignalContext; n: number }[];
  recency: { bucket: string; n: number }[];       // 'YYYY Qn' quarters, zero-filled span
  domains: { domain: string; n: number }[];
  firstPublished: string | null;
  lastPublished: string | null;
  oneSided: boolean;                // supporting evidence with zero contradicting
  thin: boolean;                    // matched < 5
  corpusNote: string;               // deterministic coverage statement, built in code
}

// "Since last run" — computed at pack-build time against the hypothesis's latest
// saved report. Deterministic set arithmetic over signal ids; no model involvement.
export interface HypothesisDelta {
  prev_report_id: string;
  prev_generated_at: string;        // ISO
  new_signal_tags: string[];        // tags (in THIS pack) of signals the last run lacked
  removed_count: number;            // signals the last run had that no longer match
  new_directions: { supports: number; contradicts: number; neutral: number; untyped: number };
}

export interface HypothesisPack {
  hypothesis_id: string;
  code: string;
  statement: string;                // frozen at build
  test: string;
  generated_at: string;             // ISO, server clock at build
  signals: HypothesisPackSignal[];
  evidence: HypothesisPackEvidence[];
  stats: HypothesisStats;
  delta: HypothesisDelta | null;
}

// The narrative half: sanitized, citation-gated HTML. `citedTags`/`dropped` are
// the deterministic audit of the citation gate.
export interface HypothesisNarrative {
  reading: string | null;           // "What the signals show"
  counterweight: string | null;     // "The other read and what's missing"
  bottomLine: string | null;
  citedTags: string[];
  dropped: string[];
}

export interface HypothesisReportMeta {
  id: string;
  hypothesis_id: string;
  title: string;
  generated_at: string;             // ISO
  matched: number;                  // pack->stats->matched
}

export interface SavedHypothesisReport {
  id: string;
  hypothesis_id: string;
  title: string;
  statement: string;
  pack: HypothesisPack;
  narrative: HypothesisNarrative;
  generated_at: string;             // ISO
}
