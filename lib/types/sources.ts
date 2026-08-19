import type { Direction, Domain, Lens, NodeType, SignalLens, Weight } from './core';
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
