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
