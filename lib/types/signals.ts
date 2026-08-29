import type { AnalysisStatus, ConfidenceLabel, Direction, Domain, RunCadence, RunStatus, RunStep, SignalLens, SignalOrigin, Significance, TriageStatus } from './core';
// ---- Signal Board (migration 0004) ----
// A discrete tracked development, organized by lens and tied back to the claims it
// touches on the Argument Map. The public feed = the share view; drafts are admin-only.
export interface Signal {
  id: string;
  title: string;
  summary: string | null;
  significance: Significance;
  lenses: SignalLens[];
  claim_touches: string[];          // stable claim/bridge codes, e.g. ['2.3','B1']
  // Per-touch {direction, reason} keyed by code — the draft-stage detail the admin
  // reviews and that becomes evidence on publish (migration 0006). Admin-only read.
  touch_details?: Record<string, { direction: Direction; reason: string }>;
  source_id: string | null;
  published_at: string | null;      // editorial date (also drives ordering + digest range)
  is_published: boolean;
  archived_at: string | null;       // set ⇒ a set-aside draft (migration 0009); out of the queue
  origin: SignalOrigin;             // 'pipeline' = created by the discovery pipeline
  // Cached AI analysis (migration 0022): admin generates once, everyone reads. Both are
  // editorial narration (no personal layer), read only by getSignal (off SIGNAL_COLUMNS).
  brief?: SignalBrief | null;
  counterpoint?: SignalCounterpoint | null;
  // Model that drafted a pipeline signal (0042, the analysis A/B stamp).
  // Admin-only read: getSignal strips it for guests; off SIGNAL_COLUMNS.
  drafted_by?: string | null;
  created_at: string;
  updated_at: string;
  // joined-in for the feed/detail (not columns on `signals`):
  source_title?: string | null;
  source_url?: string | null;
}

// The deep-dive briefing that expands a signal's one-paragraph summary into structure.
// Generated alongside the counterpoint by lib/signal-brief.generateSignalAnalysis.
export interface SignalBrief {
  what_happened: string;            // the development itself, in plain prose
  why_it_matters: string;          // the stakes / what it changes
  whats_contested: string;         // where reasonable readers still disagree
  what_to_watch: string[];         // the concrete next signposts to track
}

// "The other read": the strongest opposing interpretation of the same development.
export interface SignalCounterpoint {
  the_other_read: string;          // a steelman of the contrary reading
  what_would_deflate: string[];    // concrete things that would shrink this signal's significance
}

// One resolved claim_touch: a code resolved against claims/bridge_claims so the
// detail page can show what the development lands on. `confidence_label` is part of
// the personal layer — nulled for guests at the data layer, like everywhere else.
export interface SignalTouch {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  domain: Domain | null;            // bridge-claims report domain_from here
  confidence_label: ConfidenceLabel;
  href: string;                     // /claim/[code] or /bridge/[code]
  direction?: Direction | null;     // how this development bears on the touch (from touch_details)
  reason?: string | null;           // the model's one-line "why", preserved (admin-only)
  unresolved?: boolean;             // true when a code no longer names a live claim/bridge
}

// The AI's proposed draft for a signal (model proposes; the human edits + commits).
// Every field is a suggestion the admin can overwrite before saving.
interface ProposedSignal {
  title: string;
  summary: string;
  significance: Significance;
  significance_reason: string;
  lenses: SignalLens[];
  // Each touch now carries a direction (supports/contradicts/neutral) — the model
  // judges how the development bears on the claim — plus the preserved reason.
  claim_touches: { code: string; direction: Direction; reason: string }[];
}

// The pipeline's per-candidate analysis output: a ProposedSignal plus a suggested
// reliability prior for the source (admin still sets the real value).
export interface AnalyzedSignal extends ProposedSignal {
  proposed_reliability: number; // 0–100
}

// ---- Post-run coverage check (migration 0026) ----
// One web-enabled call per completed run re-derives "the most significant AI
// developments since the window opened" with independent query phrasing and marks each
// as covered (a run candidate or existing signal already reports it) or a possible miss.
// Advisory only — it never blocks the run; the panel on /pipeline shows the result.
export interface CoverageDevelopment {
  headline: string;
  url: string;
  covered: boolean;
  matched: string; // the tracked item it matches; '' when covered=false
}
export interface RunCoverage {
  since: string;      // ISO date the check searched from
  checked_at: string; // ISO timestamp, stamped server-side
  developments: CoverageDevelopment[];
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
  coverage: RunCoverage | null;
  discovered_units: string[]; // 0042: the cron engine's per-unit discovery checkpoints

  created_at: string;
  updated_at: string;
}

// ---- Draft-queue dedupe ----
// The model groups ALL unpublished drafts that report the SAME development from different
// sources (semantic, not exact-title). Recommend-only: the admin merges or discards. The
// model returns indexes; the server maps them back to real signal ids and never trusts a raw
// id. Distinct from triage's 'duplicate' (candidate-vs-existing-signal, pre-analysis) — this
// is draft-vs-draft, post-analysis.
export interface DedupeMember {
  signal_id: string;
  title: string;
  source_domain: string | null;    // shown so the admin sees which source each restatement is
}
export interface DedupeGroup {
  canonical: DedupeMember;          // the draft to keep
  duplicates: DedupeMember[];       // drafts that restate it
  reason: string;                   // one line: why these are the same story
}
export interface DedupeRecommendation {
  groups: DedupeGroup[];
  scanned: number;                  // how many drafts were compared
  generated_at: string;             // ISO; stamped by the action (server clock)
}

export interface SignalCandidate {
  id: string;
  run_id: string;
  url: string;
  headline: string | null;
  source_domain: string | null;
  lens: SignalLens;
  published_date: string | null;
  retrieved_at: string;
  triage_status: TriageStatus;
  triage_reason: string | null;
  signal_id: string | null;
  source_id: string | null;         // migration 0015 — set when the candidate is a manual upload
  analysis_status: AnalysisStatus;  // migration 0007
  analysis_error: string | null;    // migration 0007 — message on a failed analysis attempt
  archived_at: string | null;       // migration 0013 — set aside out of the active queue (recoverable)
  raw_content: string | null;       // omitted from list reads; present per-candidate
  created_at: string;
  updated_at: string;
}
