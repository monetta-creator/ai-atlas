import type { AnalysisStatus, ConvictionLabel, Direction, TriageStatus } from './core';
import type { SignalContext, Significance } from './core';
import type { Signal } from './signals';

// ---- Dashboard reads (blotter, map board) -----------------------------------
// A hypothesis ranked by how much evidence is attached to it. Evidence counts
// are structural/public; conviction is personal-layer (nulled for guests).
export interface TopHypothesis {
  id: string;
  code: string;
  statement: string;
  conviction: number | null;
  conviction_label: ConvictionLabel;
  evidence_count: number;
  supports: number;
  contradicts: number;
  neutral: number;
}

// ---- Calibration viewer (the snapshot/rationale time-series reader) ----
// Every conviction move writes a full `snapshots` row + a `rationales` row; this
// is the reader over that history. The personal layer in visible form: admin-only.
export interface CalibrationSnapshot {
  at: string;                 // pre-formatted display date
  trigger: string;            // manual | post_commit | scheduled
  bands: { thin: number; contested: number; leaning: number; settled: number };
  total: number;
}

export interface CalibrationTrajectory {
  id: string;
  code: string;
  label: string;
  href: string;
  points: { at: string; conviction: number }[];
  first: number;
  current: number;
  moves: number;
}

export interface CalibrationMove {
  id: string;
  at: string;
  code: string | null;
  label: string;
  href: string | null;
  old_conviction: number | null;
  new_conviction: number | null;
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

// ---- "View data" (chart transparency) -------------------------------------
// A tabular view of exactly what a visualization renders. SAFETY: a dataset must
// be built ONLY from the props a component already received — never a re-fetch —
// so the personal layer stays stripped server-side for guests.
interface ViewDataColumn {
  key: string;
  label: string;
  def?: string;
}
export interface ViewDataset {
  title: string;
  columns: ViewDataColumn[];
  rows: Array<Record<string, string | number>>;
  methodology?: string;
  source?: string;
}

// ---- Signal Board feed (paginated admin board + guest feed) ----
// `status` is honored only for admins; guests are forced to published-only
// server-side (the action is the draft-visibility gate).
export interface SignalsFeedFilters {
  status?: 'published' | 'unpublished' | 'archived';
  contexts?: SignalContext[];
  significance?: Significance[];
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface SignalsPageResult {
  rows: Signal[];
  total: number;
  page: number;
  pageSize: number;
}

// Browsable candidate archive. Public pipeline metadata — no personal layer.
export interface CandidateArchiveFilters {
  context?: SignalContext;
  triage_status?: TriageStatus;
  dateField?: 'retrieved_at' | 'published_date';
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CandidateArchiveRow {
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
  analysis_status: AnalysisStatus;
  signal_id: string | null;
  signal_published: boolean | null;
  archived_at: string | null;
}

export interface CandidateArchiveResult {
  rows: CandidateArchiveRow[];
  total: number;
  page: number;
  pageSize: number;
}

// A light "atlas health" summary for the dashboard's orientation strip. Counts
// are structural/public; `contested` (conviction-derived) is admin-only.
export interface MapHealth {
  hypotheses: number;
  uncovered: number;          // hypotheses with no evidence
  oneSided: number;           // hypotheses with one-sided evidence
  evidence: number;
  signalsPublished: number;
  contested: number | null;   // admin-only
}
