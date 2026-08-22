// The Strategy Atlas core model (transition D-016/D-017): one tier of
// belief-objects. A HYPOTHESIS carries the falsifiable test and the gated
// CONVICTION (0..1, word-labeled, human-moved only); EVIDENCE links attach
// directly to hypotheses with a per-link CONFIDENCE (the Weight words), a
// direction, and a why-it-bears note.

export type Resolvability = 'clean' | 'slow' | 'qualitative';
export type Direction = 'supports' | 'contradicts' | 'neutral';
// The evidence-link confidence words (D-017). "Weight" remains the type name
// because the words are weights; the column and UI say confidence.
export type Weight = 'high' | 'medium' | 'low';
export type ConvictionLabel = 'settled' | 'leaning' | 'contested' | 'thin' | null;
export type HypothesisStatus = 'active' | 'retired' | 'resolved';

// ---- Signal Board ----
export type Significance = 'high' | 'medium' | 'low';
// The primary signal axis (D-005): where the development comes from.
export type SignalContext = 'internal' | 'external';
export type SignalOrigin = 'manual' | 'pipeline';

// ---- Intake pipeline ----
export type TriageStatus = 'pending' | 'approved' | 'rejected' | 'duplicate';
// 'source' = a single-source run created when an admin turns one manual
// source into a signal; 'manual' = a multi-candidate intake batch.
export type RunCadence = 'manual' | 'source';
export type RunStatus = 'running' | 'completed' | 'failed';
export type RunStep = 'triage' | 'analysis' | 'complete';
export type AnalysisStatus = 'pending' | 'drafted' | 'error' | 'discarded';

export interface Hypothesis {
  id: string;
  code: string;                  // stable short code: H1, H2, ... (citations, touches)
  statement: string;
  test: string;                  // what evidence would move it
  note: string | null;
  resolvability: Resolvability | null;
  conviction: number | null;     // nulled for guests (the personal layer)
  conviction_label: ConvictionLabel;
  status: HypothesisStatus;
  created_at?: string;
  updated_at?: string;
  // joined-in by list reads:
  evidence_count?: number;
  supports?: number;
  contradicts?: number;
  neutral?: number;
  signal_count?: number;
  last_moved?: string | null;    // admin-only; nulled for guests
  report_count?: number;
  last_generated_at?: string | null;
  // The per-hypothesis gap scan (working layer; selected by detail reads only).
  gap_scan?: import('./concepts').ArgumentGapScan | null;
}

// Promote-and-link (D-016): a related/narrower hypothesis. Joined fields carry
// the far end for display.
export interface HypothesisLink {
  id: string;
  from_id: string;
  to_id: string;
  note: string | null;
  code?: string;                 // the far end's code
  statement?: string;            // the far end's statement
}
