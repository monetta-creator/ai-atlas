import type { AnalysisStatus, ConvictionLabel, Direction, RunCadence, RunStatus, RunStep, SignalContext, SignalOrigin, Significance, TriageStatus } from './core';
// ---- Signal Board ----
// A discrete tracked development with internal/external context, tied back to
// the hypotheses it touches. The public feed = the share view; drafts admin-only.
export interface Signal {
  id: string;
  title: string;
  summary: string | null;
  significance: Significance;
  context: SignalContext;
  touches: string[];                // stable hypothesis codes, e.g. ['H1','H4']
  // Per-touch {direction, reason} keyed by code — the draft-stage detail the admin
  // reviews and that becomes evidence on publish. Admin-only read.
  touch_details?: Record<string, { direction: Direction; reason: string }>;
  source_id: string | null;
  published_at: string | null;      // editorial date (ordering + digest range)
  is_published: boolean;
  archived_at: string | null;       // set ⇒ a set-aside draft; out of the queue
  origin: SignalOrigin;             // 'pipeline' = drafted by the intake pipeline
  // Cached AI analysis: admin generates once, everyone reads (editorial, no
  // personal layer; read only by getSignal, off SIGNAL_COLUMNS).
  brief?: SignalBrief | null;
  counterpoint?: SignalCounterpoint | null;
  created_at: string;
  updated_at: string;
  // joined-in for the feed/detail (not columns on `signals`):
  source_title?: string | null;
  source_url?: string | null;
}

// The deep-dive briefing that expands a signal's one-paragraph summary into structure.
export interface SignalBrief {
  what_happened: string;
  why_it_matters: string;
  whats_contested: string;
  what_to_watch: string[];
}

// "The other read": the strongest opposing interpretation of the same development.
export interface SignalCounterpoint {
  the_other_read: string;
  what_would_deflate: string[];
}

// One resolved touch: a code resolved against hypotheses so the detail page can
// show what the development lands on. conviction_label is personal-layer —
// nulled for guests at the data layer, like everywhere else.
export interface SignalTouch {
  code: string;
  statement: string;
  conviction_label: ConvictionLabel;
  href: string;                     // /hypothesis/[code]
  direction?: Direction | null;
  reason?: string | null;           // the model's one-line "why" (admin-only)
  unresolved?: boolean;             // true when a code no longer names a live hypothesis
}

// The AI's proposed draft for a signal (model proposes; the human edits + commits).
interface ProposedSignal {
  title: string;
  summary: string;
  significance: Significance;
  significance_reason: string;
  context: SignalContext;
  touches: { code: string; direction: Direction; reason: string }[];
}

// The pipeline's per-candidate analysis output: a ProposedSignal plus a suggested
// reliability prior for the source (the operator still sets the real value).
export interface AnalyzedSignal extends ProposedSignal {
  proposed_reliability: number; // 0–100
}

export interface PipelineRun {
  id: string;
  triggered_at: string;
  cadence: RunCadence;
  status: RunStatus;
  step: RunStep;
  candidate_count: number;
  approved_count: number;
  signal_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Draft-queue dedupe ----
// The model groups ALL unpublished drafts that report the SAME development from
// different sources. Recommend-only: the admin merges or discards.
export interface DedupeMember {
  signal_id: string;
  title: string;
  source_domain: string | null;
}
export interface DedupeGroup {
  canonical: DedupeMember;
  duplicates: DedupeMember[];
  reason: string;
}
export interface DedupeRecommendation {
  groups: DedupeGroup[];
  scanned: number;
  generated_at: string;
}

export interface SignalCandidate {
  id: string;
  run_id: string;
  url: string;
  headline: string | null;
  source_domain: string | null;
  context: SignalContext;
  published_date: string | null;
  retrieved_at: string;
  triage_status: TriageStatus;
  triage_reason: string | null;
  signal_id: string | null;
  source_id: string | null;         // set when the candidate is a manual upload
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  archived_at: string | null;
  raw_content: string | null;       // omitted from list reads; present per-candidate
  created_at: string;
  updated_at: string;
}
