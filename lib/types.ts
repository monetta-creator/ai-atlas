export type Domain = 'capability' | 'economics' | 'build_out' | 'market' | 'labor';
export type Resolvability = 'clean' | 'slow' | 'qualitative';
export type Lens =
  | 'market' | 'economics' | 'social' | 'employment'
  | 'education' | 'geopolitics' | 'stack';
export type Relation = 'supports' | 'contradicts' | 'depends_on' | 'organizes';
export type Direction = 'supports' | 'contradicts' | 'neutral';
export type Weight = 'high' | 'medium' | 'low';
export type NodeType = 'stance' | 'claim' | 'bridge_claim';
export type ConfidenceLabel = 'settled' | 'leaning' | 'contested' | 'thin' | null;

// ---- Signal Board ----
// A separate, audience-tailored lens vocabulary (distinct from the argument map's
// Lens). Mirrors the signal_lens_t Postgres enum in migration 0004.
export type Significance = 'high' | 'medium' | 'low';
export type SignalLens =
  | 'market' | 'labor' | 'geopolitics' | 'regulatory' | 'capability' | 'society';
export type SignalOrigin = 'manual' | 'pipeline';

// ---- Discovery pipeline (migration 0005) ----
export type TriageStatus = 'pending' | 'approved' | 'rejected' | 'duplicate';
// 'source' (migration 0015) = a single-source run created when an admin turns one manual
// source into a signal; kept out of discovery history/analytics and the lookback window.
export type RunCadence = 'manual' | 'daily' | 'weekly' | 'source';
export type RunStatus = 'running' | 'completed' | 'failed';
export type RunStep = 'discovery' | 'triage' | 'analysis' | 'complete';
// Per-candidate analysis outcome (migration 0007). 'drafted' = became a draft signal;
// 'error' = a failed attempt (transient, retried); 'discarded' = terminalized after the
// orchestrator exhausted retries. Lets the dashboard show real analysis-step health.
export type AnalysisStatus = 'pending' | 'drafted' | 'error' | 'discarded';

export interface Question {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  primary_lens: Lens | null;
  sort_order: number;
}

export interface QuestionStats extends Question {
  stance_count: number;
  claim_count: number;
  contested_count: number;
  last_moved: string | null;
  evidence_count: number;   // distinct evidence rows on the question's claims (public)
}

export interface Stance {
  id: string;
  question_id: string;
  code: string;
  title: string;
  holder: string | null;
  summary: string | null;
  test: string;
  confidence: number | null;
  confidence_label: ConfidenceLabel;
  sort_order: number;
}

export interface Claim {
  id: string;
  code: string;
  statement: string;
  test: string | null;
  domain: Domain | null;
  domain_note: string | null;
  resolvability: Resolvability | null;
  confidence: number | null;
  confidence_label: ConfidenceLabel;
  is_frame: boolean;
  reflexive: boolean;
}

export interface BridgeClaim {
  id: string;
  code: string;
  statement: string;
  domain_from: Domain;
  domain_to: Domain;
  test: string;
  resolvability: Resolvability | null;
  confidence: number | null;
  confidence_label: ConfidenceLabel;
  reflexive: boolean;
  note: string | null;
}

export interface Edge {
  id: string;
  from_type: NodeType;
  from_id: string;
  to_type: NodeType;
  to_id: string;
  relation: Relation;
  note: string | null;
}

// ---- AI source dossier (Design Doc §7.1) — the model surfaces information,
// never a score; the author still sets the reliability prior. Stored in
// sources.dossier (jsonb). Provenance (`basis`) is surfaced visually in the UI.
export type Basis = 'web_verified' | 'training_memory' | 'document_stated';

export interface BasisClaim {
  field: string;        // what this fact is about, e.g. "funding", "political lean"
  value: string;        // the finding ("unknown" is a valid value)
  basis: Basis;         // how it's known
  confidence: number;   // 0–1, calibrated
}

export interface Dossier {
  document_internal: {
    thesis: string;
    what_its_selling: string;
    rhetorical_register: string;
    emotional_loading: string;
    specificity: string;
    falsifiable_claims: string[];
    notable_omissions: string[];
    internal_red_flags: string[];
    argument_quality: string;
  };
  external_claims: {
    author: BasisClaim[];
    outlet: BasisClaim[];
  };
  for_the_analyst: {
    bias_to_model: string;          // the angle to keep in mind, NOT a verdict
    questions_unverified: string[]; // ranked by load-bearingness
    suggested_domain_tag: Domain;
    suggested_lenses: Lens[];
  };
}

// AI-extracted bibliographic metadata to pre-fill the add-source form (Change 1).
// Empty string means "not found" — fields are never guessed.
export interface SourceMetadata {
  title: string;
  author: string;
  url: string;
  published_at: string; // YYYY-MM-DD or ''
  domain_tag: string;   // a Domain value or ''
}

// An AI recommendation that a source is evidence for a claim (Change 2). Advisory
// only — the author decides what to attach.
export interface ClaimRecommendation {
  claim_code: string;
  direction: Direction;
  weight: Weight;
  reason: string;
}

// Question state summary (AI one-pager + history log). Numbers in `metrics` are
// computed in code (not the model) so the timeline is trustworthy; the model
// writes the prose sections.
export interface SummaryMetrics {
  stances: number;
  claims: number;
  bridges: number;
  contested: number;
  evidence_total: number;
  supporting: number;
  contradicting: number;
  neutral: number;
  claims_without_evidence: number;
  one_sided: number;
}

export interface QuestionSummary {
  headline: string;            // one-line tl;dr
  overall_state: string;       // what's resolved vs still contested
  claims_overview: string;     // the claims present, incl. bridge-claims
  interdependencies: string;   // connections between claims/stances/bridges
  evidence_summary: string;    // how much evidence is attached, distribution
  falsifiability: string;      // what would it take to settle contested points
  patterns_and_gaps: string;   // notable patterns or gaps in what's collected
}

export interface QuestionSummaryRow {
  id: string;
  question_id: string;
  summary: QuestionSummary;
  metrics: SummaryMetrics;
  created_at: string;
}

export interface Source {
  id: string;
  title: string | null;
  author: string | null;
  outlet: string | null;
  url: string | null;
  published_at: string | null;
  domain_tag: Domain | null;
  reliability_prior: number | null;
  dossier: Dossier | null;
  created_at: string;
}

export interface Evidence {
  id: string;
  source_id: string | null;           // nullable since 0006 — a signal can be its own source
  signal_id?: string | null;          // set when this evidence was materialized from a signal
  lens?: SignalLens | null;           // the audience lens this finding speaks to
  target_type: NodeType;
  target_id: string;
  direction: Direction;
  weight: Weight;
  excerpt: string | null;
  note: string | null;
  created_at: string;
  source_title?: string | null;
  source_outlet?: string | null;
  reliability_prior?: number | null;
  signal_title?: string | null;       // joined-in for "via <signal>" provenance
}

export interface Rationale {
  id: string;
  target_type: string;
  target_id: string;
  old_confidence: number | null;
  new_confidence: number | null;
  reason: string;
  evidence_id: string | null;
  created_at: string;
  // joined-in when a move cited an evidence row (rationales.evidence_id)
  evidence_excerpt?: string | null;
  evidence_direction?: Direction | null;
  evidence_source?: string | null;
}

// ---- Calibration viewer (the snapshot/rationale time-series reader) ----
// Every confidence move writes a full `snapshots` row + a `rationales` row; this is
// the reader over that history. The personal layer in visible form, so admin-only.
export interface CalibrationSnapshot {
  at: string;                 // pre-formatted display date
  trigger: string;            // manual | post_commit | scheduled
  bands: { thin: number; contested: number; leaning: number; settled: number };
  total: number;              // nodes with a (non-null) confidence at this snapshot
}

export interface CalibrationTrajectory {
  type: NodeType | 'position';
  id: string;
  code: string | null;        // positions have no code
  label: string;
  href: string;
  points: { at: string; confidence: number }[];  // confidence at each snapshot it appears in
  first: number;
  current: number;
  moves: number;              // number of changes across the series
}

export interface CalibrationMove {
  id: string;
  at: string;                 // pre-formatted display date
  code: string | null;
  label: string;
  href: string | null;
  old_confidence: number | null;
  new_confidence: number | null;
  reason: string;
  evidence_excerpt: string | null;
  evidence_direction: Direction | null;
  evidence_source: string | null;
}

export interface CalibrationData {
  snapshots: CalibrationSnapshot[];
  trajectories: CalibrationTrajectory[];
  moves: CalibrationMove[];
  totals: { snapshots: number; moves: number; nodesMoved: number; firstAt: string | null; lastAt: string | null };
}

// ---- Phase 7: Worldview & Spine (cross-cutting positions, §3.3) ----
// A node the author can attach to a cross-cutting position, listed in the picker.
export interface NodeOption {
  type: NodeType;            // stance | claim | bridge_claim
  id: string;
  code: string;
  label: string;             // stance title / claim or bridge statement
  question: string | null;   // owning question title (stances only)
}

// One resolved component of a position, with a link to the node it points at.
export interface WorldviewComponent {
  id: string;                // the position_components row id (for removal)
  type: NodeType;
  code: string;
  label: string;
  href: string;              // /claim/[code] · /bridge/[code] · /q/[slug]
}

export interface WorldviewPosition {
  id: string;
  statement: string;
  confidence: number | null;
  confidence_label: ConfidenceLabel;
  private: boolean;
  components: WorldviewComponent[];
}

export interface Worldview {
  spine: BridgeClaim[];           // the bridge-claims, the highest-leverage objects
  positions: WorldviewPosition[]; // the author's spanning views
}

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

// ---- AI cost monitoring (migration 0014) -----------------------------------
// A pricing card for one model, effective from `effective_date` forward. Rates are USD
// per MILLION tokens; the cache_write rate is the 5-min-TTL write price (the app uses
// ephemeral cache_control). Append-only — a price change is a new card, never an edit.
export interface RateCard {
  id: string;
  model: string;
  effective_date: string;        // 'YYYY-MM-DD'
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok: number;
  cache_read_per_mtok: number;
  context_window: number;        // total context tokens (drives utilization %)
  created_at: string;            // ISO
}

// One logged Anthropic call. cost_usd is FROZEN at write time (priced from the then-active
// card; never recomputed). context_pct = (input + cache read + cache write) / context window.
export interface CostLogRow {
  id: string;
  created_at: string;            // ISO
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  wall_ms: number;
  context_pct: number | null;
  cost_usd: number;
  pipeline_run_id: string | null;
}

export interface CostSummary {
  calls: number;
  total: number;                 // all-time spend (USD)
  d30: number;                   // spend, last 30 days
  d7: number;                    // spend, last 7 days
  calls30: number;
  calls7: number;
  avgCost: number;               // mean cost per call, all-time
}

// One day on the daily-spend chart. Always present (zero-filled), with the trailing
// 7- and 30-day rolling means (computed in code over a 60-day fetch window).
export interface DailyCostPoint {
  day: string;                   // 'YYYY-MM-DD'
  cost: number;
  calls: number;
  avg7: number;                  // trailing 7-day mean daily spend
  avg30: number;                 // trailing 30-day mean daily spend
}

// Per-feature rollup with cost percentiles (p50/p90/p99) over that feature's calls.
export interface FeatureCost {
  feature: string;
  calls: number;
  totalCost: number;
  avgTokens: number;             // mean total tokens (input+output+cache) per call
  avgInput: number;
  avgOutput: number;
  avgContextPct: number;         // mean context-window utilization %
  p50: number;
  p90: number;
  p99: number;
}

// Per-pipeline-run cost rollup (the last 20 runs).
export interface RunCost {
  id: string;
  triggered_at: string;          // ISO
  cadence: string;
  status: string;
  calls: number;
  cost: number;
  tokens: number;                // total tokens across the run's calls
}

export interface CostDashboard {
  summary: CostSummary;
  daily: DailyCostPoint[];          // last 30 days, oldest → newest
  features: FeatureCost[];          // highest spend first
  runs: RunCost[];                  // last 20 pipeline runs, newest first
  recent: CostLogRow[];             // last 100 calls, newest first
  activeRateCards: RateCard[];      // the currently-active card per model
  rateCardHistory: RateCard[];      // every card, model then effective_date desc
}

// ---- Concepts — the semantic scaffold (migration 0017) ----------------------

export type ConceptStatus = 'settled' | 'contested';

export interface Concept {
  id: string;
  slug: string;
  name: string;
  short_definition: string;
  explanation: string | null;
  status: ConceptStatus;
  created_at: string;
  updated_at: string;
}

// One dependency edge: "understand `prerequisite_id` before `concept_id`".
export interface ConceptEdge {
  concept_id: string;
  prerequisite_id: string;
}

// The /concepts graph read: every concept plus the confirmed dependency edges.
export interface ConceptGraphData {
  concepts: Concept[];
  edges: ConceptEdge[];
}

// A linked concept reference (the prerequisites / builds-on lists on the detail page).
export interface ConceptRef {
  id: string;
  slug: string;
  name: string;
  short_definition: string;
  status: ConceptStatus;
}

// A claim/bridge a concept is wired to, resolved from its stable code at read time.
// confidence_label is personal-layer (nulled for guests); `unresolved` flags a
// dangling code for the admin (drift guard), mirroring SignalTouch.
export interface ConceptClaimLink {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  confidence_label: ConfidenceLabel;
  href: string;
  unresolved?: boolean;
}

export interface ConceptDetail {
  concept: Concept;
  prerequisites: ConceptRef[];
  dependents: ConceptRef[];
  claims: ConceptClaimLink[];
}

// AI recommendations for the authoring form (advisory only — the admin confirms
// each suggestion; nothing persists until the form is submitted).
export interface ConceptPrereqRecommendation {
  id: string;
  slug: string;
  name: string;
  reason: string;
}

export interface ConceptClaimRecommendation {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  reason: string;
}

// One recommended-but-missing concept from the admin "Diagnose gaps" scan
// (migration 0018). Recommend-only: it can pre-fill the create form, never write.
export interface ConceptGapRecommendation {
  slug: string;
  name: string;
  short_definition: string;
  explanation: string;          // a brief draft seed — the admin expands it in the form
  status: ConceptStatus;        // proposed; same bar as everywhere (contested = the WORD is disputed)
  prerequisite_slugs: string[]; // existing concept slugs it would depend on
  claim_codes: string[];        // claims/bridges on the map that lean on it
  argument: string;             // why the scaffold is incomplete without it / what it bridges
}

export interface ConceptGapScan {
  generatedAt: string;          // ISO
  recommendations: ConceptGapRecommendation[];
}

// ---- Argument-map node authoring (migration 0021) --------------------------
// Adding claims + bridge-claims to the map, AI-proposed and human-committed,
// mirroring the concept-gap flow. Scope is the falsifiable, evidence-bearing
// nodes (claims + bridges); frames/questions/stances are out of scope.

// One proposed edge from a gap recommendation. `code` names the OTHER endpoint
// (the new node is always one end): for a CLAIM rec, a stance or bridge code the
// claim bears on; for a BRIDGE rec, a claim code that feeds the bridge. `relation`
// is one of the graph relations the map renders (organizes is frame-only, excluded).
export interface ArgumentGapEdge {
  code: string;
  relation: Relation;           // supports | contradicts | depends_on
}

// One grounding citation: the recent report/signals that motivate the proposal.
// This is the evidence the human judges — a recommendation that cannot cite recent
// evidence is not proposed (the anti-bloat bar).
interface ArgumentGroundingRef {
  report_id: string | null;     // a saved report this leans on, or null
  report_title: string | null;
  signal_ids: string[];         // recent signals this leans on (resolved to ids)
  finding: string;              // the recent development the map does not yet capture
}

// One recommended-but-missing claim or bridge-claim. Recommend-only: it can
// pre-fill the create form, never write. Per-kind fields are populated by kind
// (claim: domain; bridge: domain_from/domain_to). `question_slug` is the derived
// home question for a claim (from its stance edges) so "Start draft" can route.
export interface ArgumentGapRecommendation {
  kind: 'claim' | 'bridge';
  code: string;                 // proposed stable code (e.g. '3.6', 'B5')
  statement: string;
  test: string;                 // the falsification test (required for both kinds)
  domain: Domain | null;        // claim only
  domain_from: Domain | null;   // bridge only
  domain_to: Domain | null;     // bridge only
  resolvability: Resolvability | null;
  question_slug: string | null; // claim: derived home question for routing the draft
  edges: ArgumentGapEdge[];     // claim: -> stance/bridge ; bridge: feeding claims
  argument: string;             // why the map is incomplete without it (the part the human judges)
  grounding: ArgumentGroundingRef;
}

export interface ArgumentGapScan {
  generatedAt: string;          // ISO
  recommendations: ArgumentGapRecommendation[];
}

// Recommend-only edge suggestions for the claim/bridge authoring forms (advisory;
// the admin confirms each, nothing persists until the form is submitted).
export interface ClaimEdgeRecommendation {
  target_type: 'stance' | 'bridge_claim';
  code: string;
  relation: Relation;
  reason: string;
}

export interface BridgeFeederRecommendation {
  code: string;
  relation: Relation;
  reason: string;
}

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

// ---- The Report Portal's generated reports (tear sheets; migration 0030) ----
// Claim/bridge tear sheets, lens deep reports, and the whole-Atlas executive
// briefing share one storage row (generated_reports) and one narrative shape.
// Packs are guest-safe by construction, like ThesisPack: a published report's
// PDF is publicly downloadable, so nothing personal may enter a pack.

export type SheetKind = 'claim' | 'bridge' | 'lens' | 'atlas';

// 'YYYY-MM-DD' bounds; both null = the full corpus.
export interface SheetScope { from: string | null; to: string | null }

// One signal in a sheet pack. Like ThesisPackSignal but with direction resolved
// toward the sheet's subject code (claim/bridge sheets; null elsewhere).
export interface SheetSignal {
  id: string;
  tag: string;                      // S1, S2, ... assigned in pack order
  title: string;
  summary: string | null;
  significance: Significance;
  lenses: SignalLens[];
  published_at: string | null;      // 'YYYY-MM-DD'
  origin: SignalOrigin;
  source_title: string | null;
  source_url: string | null;
  source_domain: string | null;
  direction: Direction | null;      // toward the subject (claim/bridge sheets only)
}

export interface SheetEvidence {
  code: string;                     // the claim/bridge code the row bears on
  direction: Direction;
  weight: Weight;
  excerpt: string | null;
  lens: SignalLens | null;
  source_title: string | null;
  source_outlet: string | null;
  source_url: string | null;
  source_published: string | null;  // 'YYYY-MM-DD'
  signal_id: string | null;
  signal_tag: string | null;        // resolvable when the signal is in the pack
  signal_title: string | null;
  noted_on: string;                 // evidence.created_at, 'YYYY-MM-DD'
}

interface SheetNodeCore {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  test: string | null;
  resolvability: Resolvability | null;
  reflexive: boolean;
  domain: Domain | null;                                  // claims
  domain_from: Domain | null;                             // bridges
  domain_to: Domain | null;
  href: string;
  lenses: Lens[];                                         // map lens tags (claims only)
}

interface SheetStanceLink {
  relation: Relation;
  stance_code: string;
  stance_title: string;
  q_slug: string;
  q_title: string;
}

interface SheetNodeLink {
  relation: Relation;
  code: string;
  statement: string;
  href: string;
}

interface SheetConceptLink { slug: string; name: string; status: ConceptStatus; href: string }

interface SheetThesisLink { id: string; statement: string; latest_report_id: string | null }

export interface SheetSignalStats {
  total: number;
  byDirection: { supports: number; contradicts: number; neutral: number; untyped: number };
  significance: { high: number; medium: number; low: number };
  lenses: { lens: SignalLens; n: number }[];
  recency: { bucket: string; n: number }[];               // 'YYYY Qn', zero-filled span
  firstPublished: string | null;
  lastPublished: string | null;
}

export interface ClaimSheetStats {
  evidence: {
    total: number; supports: number; contradicts: number; neutral: number;
    byWeight: { high: number; medium: number; low: number };
    oneSided: boolean;
  };
  signals: SheetSignalStats;
  thin: boolean;                    // fewer than 5 evidence items
  corpusNote: string;               // deterministic coverage statement, built in code
}

export interface ClaimSheetPack {
  kind: 'claim' | 'bridge';
  subject: string;                  // the code
  scope: SheetScope;
  generated_at: string;             // ISO
  node: SheetNodeCore;
  stances: SheetStanceLink[];       // claim -> stances it bears on (empty for bridges)
  bridges: SheetNodeLink[];         // claim -> bridges (outgoing) / bridge <- feeding claims
  frames: { code: string; statement: string; href: string }[];
  concepts: SheetConceptLink[];
  theses: SheetThesisLink[];
  evidence: SheetEvidence[];
  signals: SheetSignal[];
  stats: ClaimSheetStats;
}

export interface LensSheetCode {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  test: string | null;
  href: string;
  signal_count: number;
  directions: { supports: number; contradicts: number; neutral: number };
}

interface LensSheetStats {
  signals: SheetSignalStats;
  codes: number;
  oneSidedCodes: string[];          // codes whose in-lens direction data is one-sided
  thin: boolean;                    // fewer than 5 signals
  corpusNote: string;
}

export interface LensSheetPack {
  kind: 'lens';
  subject: SignalLens;
  scope: SheetScope;
  generated_at: string;
  label: string;                    // display label for the lens
  signals: SheetSignal[];
  codes: LensSheetCode[];
  evidence: SheetEvidence[];        // rows carried by pack signals or tagged with the lens
  stats: LensSheetStats;
}

interface AtlasSheetStance {
  code: string;
  title: string;
  claims_supporting: number;        // structural: claim -> stance supports edges
  claims_contradicting: number;
  evidence: { supports: number; contradicts: number; neutral: number };  // rollup via supporting claims
}

export interface AtlasSheetQuestion { slug: string; title: string; stances: AtlasSheetStance[] }

export interface AtlasSheetPack {
  kind: 'atlas';
  subject: null;
  scope: SheetScope;
  generated_at: string;
  questions: AtlasSheetQuestion[];
  health: {
    claims: number; bridges: number; evidence: number; signalsPublished: number;
    uncovered: number; oneSided: number;
  };
  oneSidedTargets: { code: string; statement: string; href: string }[];   // top offenders
  theses: {
    statement: string; report_id: string | null; matched: number;
    supports: number; contradicts: number; mixed: number; generated_at: string | null;
  }[];
  signals: SheetSignal[];           // recent, significance-first, tagged
  stats: { corpusNote: string };
}

export type SheetPack = ClaimSheetPack | LensSheetPack | AtlasSheetPack;

// The narrative half: three gated sections + the close, uniform across kinds
// (headings differ per kind at render time). citedTags/dropped are the citation
// gate's audit, same discipline as ThesisNarrative.
export interface SheetNarrative {
  reading: string | null;
  connections: string | null;
  watch: string | null;
  bottomLine: string | null;
  citedTags: string[];
  dropped: string[];
}

export interface GeneratedReportMeta {
  id: string;
  kind: SheetKind;
  subject: string | null;
  title: string;
  scope_from: string | null;        // 'YYYY-MM-DD' or null
  scope_to: string | null;
  is_published: boolean;
  generated_at: string;             // ISO
  // Row-expansion preview (listGeneratedReports only): the bottom line stripped
  // to plain text (no links, so no citation-gate pass needed) plus the pack's
  // deterministic stats. Guest-safe by construction, like the pack itself.
  abstract?: string | null;
  stats?: {
    evidence?: { total: number; supports: number; contradicts: number; neutral: number; oneSided: boolean };
    signals?: SheetSignalStats;
    codes?: number;
    corpusNote?: string;
  } | null;
  health?: AtlasSheetPack['health'] | null;   // atlas briefings carry health, not stats
}

export interface SavedSheet extends GeneratedReportMeta {
  pack: SheetPack;
  narrative: SheetNarrative;
}

// ---- Tickets — the public feedback box (migration 0032) ---------------------
// Bug reports and feature requests filed from the rail dialogs. `email` is an
// admin-only column: readers must never surface it on a public payload.
export type TicketKind = 'bug' | 'feature';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'declined';

export interface Ticket {
  id: string;
  kind: TicketKind;
  status: TicketStatus;
  title: string;
  body: string;
  email: string;
  severity: string | null;         // bugs only: cosmetic / annoying / blocking
  page: string | null;             // the path the dialog was opened from
  user_agent: string | null;
  admin_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  image_ids: string[];             // joined-in for the admin list
}

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
