import type { ConfidenceLabel, Domain, Relation, Resolvability } from './core';
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
