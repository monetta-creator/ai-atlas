import type { Signal } from './signals';
import type { ConfidenceLabel, Domain, SignalLens } from './core';
// ---- Report generation (Phase 1: data + scaffold) --------------------------
// A point-in-time intelligence report over a date range + a chosen subset of the six
// Signal Board lenses. Phase 1 assembles the DATA half (in-range signals, resolved
// touches, period pipeline funnel, per-lens grouping); the `narrative` slots are null
// until the Phase-2 AI generation fills them, then the Phase-3 editor edits them. The
// object is fully serializable (all dates are strings) so it flows unchanged from the
// data layer → generation → editor → PDF export.

// The editorial range the report covers. Both bounds are 'YYYY-MM-DD'. `to` is
// inclusive-of-end-day at the data layer (published_at < to::date + 1).
export interface ReportRange {
  from: string;
  to: string;
}

// One claim/bridge-claim code touched by the period's signals, resolved to its
// statement, with how many in-range signals touch it. The period analog of SignalTouch:
// no single direction/reason (those are per-signal), but a cohort `signal_count` instead.
// `confidence_label` is personal-layer — nulled for guests, like SignalTouch.
export interface ReportTouch {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  domain: Domain | null;            // bridge-claims report domain_from here
  confidence_label: ConfidenceLabel;
  href: string;                     // /claim/[code] or /bridge/[code]
  signal_count: number;             // in-range signals whose claim_touches names this code
  unresolved?: boolean;             // admin-only drift marker (code no longer resolves)
}

// Period-scoped funnel counts for one scope (overall, or a single lens). Counts are over
// the DISCOVERY COHORT: candidates with retrieved_at in range. `published` is the
// publish-state of THIS cohort's drafts (may include publications dated after `to` — see
// ReportMetrics). Rates are derived from these ints in code (never in SQL).
interface ReportFunnelCounts {
  candidates: number;      // count(*) of the in-range cohort
  approved: number;        // triage_status='approved'
  rejected: number;        // triage_status='rejected' AND analysis_status<>'discarded'
  duplicate: number;       // triage_status='duplicate'
  drafted: number;         // analysis_status='drafted'
  discarded: number;       // analysis_status='discarded' (passed triage, then terminalized)
  published: number;       // distinct published signals descended from this cohort
}

// The four headline rates, precomputed. null (never NaN) when the denominator is 0.
export interface ReportRates {
  triagePass: number | null;         // approved / (approved + rejected)
  analysisConversion: number | null; // drafted / approved
  discoveryToSignal: number | null;  // drafted / candidates
  draftToPublished: number | null;   // published / drafted
}

// Funnel counts + derived rates for one scope.
export interface ReportFunnel {
  counts: ReportFunnelCounts;
  rates: ReportRates;
}

// All period pipeline metrics: the overall funnel plus a per-lens breakdown. Anchored on
// signal_candidates.retrieved_at (discovery time). `overall` is the TRUE grand total
// across all lenses, not the sum of the selected per-lens rows. The draft→published rate
// is cohort-anchored (not published_at-windowed), so a draft published after `to` still
// counts — the Phase-2 narrative should caveat this reconciliation gap.
export interface ReportMetrics {
  overall: ReportFunnel;
  perLens: { lens: SignalLens; funnel: ReportFunnel }[];   // ordered by SIGNAL_LENS_SLUGS
}

// The period's published signals grouped by lens — the input to Phase-2's per-lens AI
// generation. A signal tagged with N (in-scope) lenses appears under each of them
// (intentional: each lens section narrates every signal relevant to it). Only lenses in
// the report's selected set are present.
interface ReportLensGroup {
  lens: SignalLens;
  signals: Signal[];
}

// The editable narrative. Generation produces markdown which is converted to HTML once
// (server-side, via `marked`) before it reaches the client — so these slots hold HTML,
// the format the Phase-3 rich-text editor edits and Phase 4 renders to PDF. A failed lens
// is left null (the report still assembles).
interface ReportNarrative {
  macroSurvey: string | null;               // synthesis: the cross-lens macro/executive survey (HTML)
  perLens: Record<string, string | null>;   // keyed by SignalLens slug; per-lens analyst narrative (HTML)
  claimsRecap: string | null;               // synthesis: recap of the claims/bridges touched (HTML)
  // One suggested callout per section — the single most important takeaway, PLAIN TEXT for
  // a #000099 callout box in the PDF. Generation proposes them; the editor can edit or
  // remove (null) before export; ≤1 per section. Keyed by 'macroSurvey' | 'claimsRecap' |
  // SignalLens slug. Empty/null/absent → no box rendered (omit cleanly).
  callouts: Record<string, string | null>;
}

// A persisted report's list metadata (drives the saved-reports list). The full Report is
// stored in a jsonb column and returned separately when a report is opened.
export interface SavedReportMeta {
  id: string;
  title: string;
  date_from: string;     // 'YYYY-MM-DD'
  date_to: string;       // 'YYYY-MM-DD'
  lenses: SignalLens[];
  generated_at: string;  // ISO
  updated_at: string;    // ISO
}

// The full report state object. `generatedAt` is the server clock at assembly (ISO).
export interface Report {
  range: ReportRange;
  lenses: SignalLens[];        // the selected subset (validated, canonical order)
  generatedAt: string;         // ISO timestamp, server clock
  signals: Signal[];           // all in-range published signals (selected lenses), recency desc
  touches: ReportTouch[];      // distinct touched claims/bridges across the cohort
  metrics: ReportMetrics;      // period funnel: overall + per-lens
  byLens: ReportLensGroup[];   // signals grouped per selected lens (Phase-2 input)
  narrative: ReportNarrative;  // all slots null in Phase 1
}
