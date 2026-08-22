import type { Direction, Weight } from './core';
// ---- AI source dossier — the model surfaces information, never a score; the
// operator still sets the reliability prior. Stored in sources.dossier (jsonb).
// Provenance (`basis`) is surfaced visually in the UI.
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
  };
}

// AI-extracted bibliographic metadata to pre-fill the add-source form.
// Empty string means "not found" — fields are never guessed.
export interface SourceMetadata {
  title: string;
  author: string;
  url: string;
  published_at: string; // YYYY-MM-DD or ''
}

// An AI recommendation that a source is evidence for a hypothesis. Advisory
// only — the operator decides what to attach.
export interface HypothesisRecommendation {
  code: string;
  direction: Direction;
  confidence: Weight;
  reason: string;
}

export interface Source {
  id: string;
  title: string | null;
  author: string | null;
  outlet: string | null;
  url: string | null;
  published_at: string | null;
  reliability_prior: number | null;
  dossier: Dossier | null;
  created_at: string;
}

export interface Evidence {
  id: string;
  hypothesis_id: string;
  source_id: string | null;           // nullable — a signal can be its own source
  signal_id?: string | null;          // set when materialized from a signal on publish
  direction: Direction;
  confidence: Weight;                 // the operator's weight on THIS link (D-017)
  excerpt: string | null;
  note: string | null;                // why it bears; admin-only in guest reads
  actor?: string;
  created_at: string;
  source_title?: string | null;
  source_outlet?: string | null;
  reliability_prior?: number | null;
  signal_title?: string | null;       // joined-in for "via <signal>" provenance
}

export interface Rationale {
  id: string;
  hypothesis_id: string;
  old_conviction: number | null;
  new_conviction: number | null;
  reason: string;
  evidence_id: string | null;
  actor?: string;
  created_at: string;
  // joined-in when a move cited an evidence row
  evidence_excerpt?: string | null;
  evidence_direction?: Direction | null;
  evidence_source?: string | null;
}
