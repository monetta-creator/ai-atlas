import type { AnalysisStatus, ConfidenceLabel, Domain, RunCadence, RunStatus, RunStep, SignalLens, Significance, TriageStatus } from './core';
import type { Signal } from './signals';
// ---- Home dashboard (app/page.tsx) -----------------------------------------
// A claim ranked by how much evidence is attached to it. Evidence counts are
// structural/public; confidence is personal-layer (nulled for guests).
export interface TopClaim {
  id: string;
  code: string;
  statement: string;
  domain: Domain | null;
  confidence: number | null;
  confidence_label: ConfidenceLabel;
  evidence_count: number;
  supports: number;
  contradicts: number;
  neutral: number;
}

// One pipeline run, enriched with the published-from-run count and per-candidate
// analysis-status tallies (drafted/errored/discarded). Drives the activity chart,
// conversion rates, triage funnel, and analysis-health views.
export interface PipelineRunPoint {
  id: string;
  triggered_at: string;       // ISO text (cast in SQL)
  cadence: RunCadence;
  status: RunStatus;
  step: RunStep;
  candidate_count: number;
  approved_count: number;
  signal_count: number;       // drafts created (signal_id set)
  published_count: number;    // of those drafts, how many are published
  drafted: number;            // analysis_status = 'drafted'
  errored: number;            // analysis_status = 'error'
  discarded: number;          // analysis_status = 'discarded'
}

export interface RunLensCount {
  run_id: string;
  lens: SignalLens;
  candidates: number;
  published: number;
}

export interface RunTriageBreakdown {
  run_id: string;
  pending: number;
  approved: number;
  rejected: number;    // true triage rejects (analysis discards excluded)
  duplicate: number;
  discarded: number;   // passed triage, terminalized by analysis
}

export interface LensPerformance {
  lens: SignalLens;
  candidates: number;           // ALL discovered (incl. archived) — the funnel denominator
  pending: number;              // triage_status = 'pending', not archived (discovered, not yet triaged)
  approved: number;             // triage_status = 'approved', not archived
  rejected: number;             // triage rejects, not archived/discarded (drives the rate view)
  duplicate: number;            // triage_status = 'duplicate', not archived
  drafted: number;              // analysis_status = 'drafted', not archived
  published: number;            // distinct published signals (drives the rate view)
  published_candidates: number; // approved candidates whose signal is published (⊆ approved; drives the funnel composition)
  archived: number;             // migration 0013 — set aside; its own funnel segment, excluded from the buckets above
}

// One argument-map target (claim or bridge-claim) touched by published, pipeline-sourced
// evidence — the downstream "what the pipeline fed into the map" view. Direction counts are
// per distinct signal (one materialized evidence row per signal×target).
export interface PipelineImpact {
  target_type: 'claim' | 'bridge_claim';
  target_id: string;
  code: string | null;
  label: string;
  signals: number;      // distinct published signals touching this target
  supports: number;     // of those, how many carry a supporting direction
  contradicts: number;
  neutral: number;
}

export interface PipelineAnalytics {
  runs: PipelineRunPoint[];          // chronological ascending
  perRunLens: RunLensCount[];
  triage: RunTriageBreakdown[];
  lensPerformance: LensPerformance[];
  impact: PipelineImpact[];          // claims/bridges touched by published-signal evidence, most-touched first
  totals: {
    runs: number;
    candidates: number;
    approved: number;
    drafted: number;
    published: number;
    errored: number;
    discarded: number;
  };
}

// ---- "View data" (chart transparency) -------------------------------------
// A tabular view of exactly what a visualization renders, surfaced behind a "View data"
// button so the numbers are inspectable and re-usable (copy TSV / download CSV / copy MD).
// SAFETY: a dataset must be built ONLY from the props a component already received — never a
// re-fetch — so the personal layer stays stripped server-side for guests (see lib/data.ts
// strip/stripClaim/getEvidenceFor). v1 sources are public pipeline aggregates (no personal data).
interface ViewDataColumn {
  key: string;
  label: string;
  def?: string;   // one-line gloss of what the column means (shown in the panel)
}
export interface ViewDataset {
  title: string;
  columns: ViewDataColumn[];
  rows: Array<Record<string, string | number>>;
  methodology?: string;   // one-line "how this is computed"
  source?: string;        // provenance, e.g. "AI Atlas discovery pipeline · all runs"
}

// ---- Signal Board feed (paginated admin board + guest feed) ----
// Filters the client sends to getSignalsFeedAction. `status` is honored only for admins;
// guests are forced to published-only server-side (the action is the draft-visibility gate).
export interface SignalsFeedFilters {
  status?: 'published' | 'unpublished' | 'archived';
  lenses?: SignalLens[];
  significance?: Significance[];
  search?: string;     // title/summary ilike, length-capped server-side
  page?: number;       // 1-based
  pageSize?: number;   // clamped server-side
}

export interface SignalsPageResult {
  rows: Signal[];
  total: number;
  page: number;
  pageSize: number;
}

// Browsable candidate archive (section 3). Public pipeline metadata — no personal layer.
export interface CandidateArchiveFilters {
  lens?: SignalLens;
  triage_status?: TriageStatus;
  dateField?: 'retrieved_at' | 'published_date';
  from?: string;       // 'YYYY-MM-DD'
  to?: string;         // 'YYYY-MM-DD'
  search?: string;     // headline/url ilike, length-capped server-side
  page?: number;       // 1-based
  pageSize?: number;   // clamped server-side
}

export interface CandidateArchiveRow {
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
  analysis_status: AnalysisStatus;
  signal_id: string | null;
  signal_published: boolean | null;  // gate the /signals link for guests (drafts 404)
  archived_at: string | null;        // migration 0013
}

export interface CandidateArchiveResult {
  rows: CandidateArchiveRow[];
  total: number;
  page: number;
  pageSize: number;
}

// A light "map health" summary for the dashboard's orientation strip. Counts are
// structural/public; `contested` (confidence-derived) is admin-only.
export interface MapHealth {
  claims: number;
  uncovered: number;          // claims with no evidence
  oneSided: number;           // claims with one-sided evidence
  evidence: number;
  signalsPublished: number;
  contested: number | null;   // admin-only
}
