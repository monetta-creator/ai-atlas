import type { Direction, Domain, Lens, Relation, Resolvability, SignalLens, SignalOrigin, Significance, Weight } from './core';
import type { ConceptStatus } from './concepts';
import type { PaperReviewStatus, RisingReject } from './research';
// ---- The Report Portal's generated reports (tear sheets; migration 0030) ----
// Claim/bridge tear sheets, lens deep reports, and the whole-Atlas executive
// briefing share one storage row (generated_reports) and one narrative shape.
// Packs are guest-safe by construction, like ThesisPack: a published report's
// PDF is publicly downloadable, so nothing personal may enter a pack.

export type SheetKind = 'claim' | 'bridge' | 'lens' | 'atlas' | 'roundup';

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

// ---- Weekly research roundup (kind 'roundup'; migration 0046 added the enum
// value) --------------------------------------------------------------------
// A guest-safe weekly digest of tracked+noted papers, thread updates, rising
// rejects, and Argument Map touches, auto-published by the Friday cron
// (lib/research/roundup.ts). Deliberately NOT folded into the SheetPack union
// above: lib/tearsheet/generate.ts's shared helpers (allowlistForSheet,
// fmtSheetPack, SECTION_BRIEFS) access `.signals`/`.node` unconditionally on
// every SheetPack member, which a roundup pack does not carry, and that file
// is outside this task's lane. RoundupPack instead rides its own citation
// gate + narrative generator in lib/research/roundup.ts, and joins SheetPack
// only through AnySheetPack, where generic "saved sheet" readers already key
// purely off `kind` (the portal row/PDF cover/kind label).

export interface RoundupPaper {
  id: string;
  title: string;
  arxiv_id: string | null;
  url: string;
  published_on: string | null;
  review_status: PaperReviewStatus;      // 'tracked' | 'noted' in practice
  rigor_prior: number | null;
  citation_count: number | null;
  headline_claim: string | null;
  effect_size: string | null;
  econ_implication: string | null;
  thread_slugs: string[];
  claim_touches: string[];
}

export interface RoundupThreadUpdate {
  slug: string;
  title: string;
  question: string;
  synthesis_excerpt: string;
  updated_papers: number;                // confirmed thread_papers rows added this week
}

export interface RoundupTouch {
  code: string;
  statement: string | null;
  href: string | null;
  paper_count: number;
}

export interface RoundupStats {
  papersTracked: number;
  papersNoted: number;
  findings: number;
  threadsUpdated: number;
  risingRejects: number;
  // Discovery-run context for the week (optional: absent runs a quiet week).
  runsCompleted?: number;
  papersPulled?: number;
  papersKept?: number;
}

export interface RoundupPack {
  kind: 'roundup';
  generatedAt: string;                   // ISO
  scopeFrom: string;                      // 'YYYY-MM-DD', the week's start
  scopeTo: string;                        // 'YYYY-MM-DD', the week's end (the run day)
  stats: RoundupStats;
  papers: RoundupPaper[];
  threads: RoundupThreadUpdate[];
  risingRejects: RisingReject[];
  touchRollup: RoundupTouch[];
}

// The union a generic "saved sheet" reader may see (the portal row, the PDF
// shell, the read view's header). RoundupPack rides alongside SheetPack
// rather than inside it, per the note above.
export type AnySheetPack = SheetPack | RoundupPack;

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
    // Roundups project their own RoundupStats shape into this same bag.
    papersTracked?: number;
    papersNoted?: number;
    findings?: number;
    threadsUpdated?: number;
    risingRejects?: number;
  } | null;
  health?: AtlasSheetPack['health'] | null;   // atlas briefings carry health, not stats
}

export interface SavedSheet extends GeneratedReportMeta {
  pack: AnySheetPack;
  narrative: SheetNarrative;
}
