import type { Direction, SignalLens, SignalOrigin, Significance } from './core';
import type { ArgumentGapScan } from './concepts';
// ---- Thesis reports (migration 0027) ----------------------------------------
// A standing user hypothesis mapped to the argument-map claims it bears on, plus
// frozen per-run reports. The pack is guest-safe BY CONSTRUCTION: a saved report is
// publicly shareable, so no confidence, rationale, admin note, or reliability prior
// may ever enter these shapes. Facts (retrieval, stats, citations) are deterministic;
// only the narrative prose is model-written, and it is citation-gated after the fact.

export type ThesisStatus = 'active' | 'archived';

export interface Thesis {
  id: string;
  statement: string;
  claim_codes: string[];           // confirmed mapping (stable claim/bridge codes)
  mapping_note: string | null;
  status: ThesisStatus;
  created_at: string;
  updated_at: string;
  // The per-thesis gap scan (migration 0036; same payload shape as the map-wide
  // singleton). Selected by getThesis only; reconcile against live codes on read.
  gap_scan?: ArgumentGapScan | null;
  // joined for the /theses list:
  report_count?: number;
  last_generated_at?: string | null;
}

// One matched signal in the frozen pack. `tag` (S1, S2, ...) is the per-pack citation
// handle; assignment order is deterministic (claim-matched by recency then id, then
// text-only matches by rank), so the same corpus always yields the same tags.
export interface ThesisPackSignal {
  id: string;
  tag: string;
  title: string;
  summary: string | null;
  significance: Significance;
  lenses: SignalLens[];
  published_at: string | null;      // 'YYYY-MM-DD'
  origin: SignalOrigin;
  source_title: string | null;
  source_url: string | null;
  source_domain: string | null;     // normalized hostname (www. stripped)
  claim_touches: string[];
  matched_via: ('claim' | 'text')[];
  rank: number | null;              // ts_rank when text-matched
  // mapped-claim code -> direction, from the signal's materialized evidence rows.
  directions: Record<string, Direction>;
  // Signal-level rollup of `directions`: mixed = supports AND contradicts;
  // untyped = no direction data toward any mapped claim (text-only matches).
  stance: 'supports' | 'contradicts' | 'mixed' | 'neutral' | 'untyped';
}

export interface ThesisPackClaim {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  test: string | null;              // the falsifying test (public on claim pages)
  href: string;                     // /claim/[code] or /bridge/[code]
  signal_count: number;             // pack signals touching this code
}

// A quoted excerpt bearing on a mapped claim (evidence.excerpt is public; the
// admin-only evidence.note never enters the pack).
export interface ThesisPackEvidence {
  code: string;
  direction: Direction;
  excerpt: string;
  signal_id: string | null;
  signal_tag: string | null;        // resolvable when the signal is in the pack
}

export interface ThesisStats {
  scanned: number;                  // published signals in the corpus at build time
  matched: number;                  // pack signals
  byMatch: { claim: number; text: number; both: number };
  // Signal-level stance counts (see ThesisPackSignal.stance).
  stances: { supports: number; contradicts: number; mixed: number; neutral: number; untyped: number };
  // (signal, mapped-code) direction pairs — finer-grained than `stances`.
  touchDirections: { supports: number; contradicts: number; neutral: number };
  significance: { high: number; medium: number; low: number };
  lenses: { lens: SignalLens; n: number }[];
  recency: { bucket: string; n: number }[];       // 'YYYY Qn' quarters, zero-filled span
  domains: { domain: string; n: number; seen: number | null; approved: number | null }[];
  firstPublished: string | null;
  lastPublished: string | null;
  oneSided: boolean;                // supporting evidence with zero contradicting/mixed
  thin: boolean;                    // matched < 5
  corpusNote: string;               // deterministic coverage statement, built in code
}

// "Since last run" — computed at pack-build time against the thesis's latest saved
// report. Deterministic set arithmetic over signal ids; no model involvement.
export interface ThesisDelta {
  prev_report_id: string;
  prev_generated_at: string;        // ISO
  new_signal_tags: string[];        // tags (in THIS pack) of signals the last run lacked
  removed_count: number;            // signals the last run had that no longer match
  new_stances: { supports: number; contradicts: number; mixed: number; neutral: number; untyped: number };
}

export interface ThesisPack {
  thesis_id: string;
  statement: string;                // the thesis wording this pack was built for
  generated_at: string;             // ISO, server clock at build
  claims: ThesisPackClaim[];
  signals: ThesisPackSignal[];
  evidence: ThesisPackEvidence[];
  stats: ThesisStats;
  delta: ThesisDelta | null;
}

// The narrative half: sanitized, citation-gated HTML. `citedTags`/`dropped` are the
// deterministic audit of the citation gate (which pack signals the prose actually
// cites; which links were stripped for pointing outside the pack's namespace).
export interface ThesisNarrative {
  reading: string | null;           // "What the signals show"
  counterweight: string | null;     // "The other read and what's missing"
  bottomLine: string | null;
  citedTags: string[];
  dropped: string[];
}

export interface ThesisReportMeta {
  id: string;
  thesis_id: string;
  title: string;
  generated_at: string;             // ISO
  matched: number;                  // pack->stats->matched
}

export interface SavedThesisReport {
  id: string;
  thesis_id: string;
  title: string;
  statement: string;
  pack: ThesisPack;
  narrative: ThesisNarrative;
  generated_at: string;             // ISO
}
