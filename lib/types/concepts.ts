import type { ConvictionLabel, Resolvability } from './core';
// ---- Concepts — the semantic scaffold ----------------------------------------

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

// A hypothesis a concept is wired to, resolved from its stable code at read time.
// conviction_label is personal-layer (nulled for guests); `unresolved` flags a
// dangling code for the admin (drift guard), mirroring SignalTouch.
export interface ConceptHypothesisLink {
  code: string;
  statement: string;
  conviction_label: ConvictionLabel;
  href: string;
  unresolved?: boolean;
}

export interface ConceptDetail {
  concept: Concept;
  prerequisites: ConceptRef[];
  dependents: ConceptRef[];
  hypotheses: ConceptHypothesisLink[];
}

// AI recommendations for the authoring form (advisory only — the admin confirms
// each suggestion; nothing persists until the form is submitted).
export interface ConceptPrereqRecommendation {
  id: string;
  slug: string;
  name: string;
  reason: string;
}

export interface ConceptHypothesisRecommendation {
  code: string;
  statement: string;
  reason: string;
}

// One recommended-but-missing concept from the admin "Diagnose gaps" scan.
// Recommend-only: it can pre-fill the create form, never write.
export interface ConceptGapRecommendation {
  slug: string;
  name: string;
  short_definition: string;
  explanation: string;
  status: ConceptStatus;
  prerequisite_slugs: string[];
  hypothesis_codes: string[];   // hypotheses that lean on it
  argument: string;
}

export interface ConceptGapScan {
  generatedAt: string;
  recommendations: ConceptGapRecommendation[];
}

// ---- Hypothesis authoring gap scan -------------------------------------------
// AI-proposed, human-committed new hypotheses, mirroring the concept-gap flow.

// One grounding citation: the recent report/signals that motivate the proposal.
// A recommendation that cannot cite recent evidence is not proposed.
interface ArgumentGroundingRef {
  report_id: string | null;
  report_title: string | null;
  signal_ids: string[];
  finding: string;              // the recent development the atlas does not yet capture
}

// One recommended-but-missing hypothesis. Recommend-only: it can pre-fill the
// create form, never write.
export interface ArgumentGapRecommendation {
  code: string;                 // proposed stable code (e.g. 'H7')
  statement: string;
  test: string;                 // the falsification test (required)
  resolvability: Resolvability | null;
  argument: string;             // why the atlas is incomplete without it
  grounding: ArgumentGroundingRef;
}

export interface ArgumentGapScan {
  generatedAt: string;
  recommendations: ArgumentGapRecommendation[];
}
