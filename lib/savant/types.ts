import type { SavantFigure } from './figures-core';
// Savant's shapes (2026-09-26): the notebook rows the weekday pass writes,
// the hypotheses ledger, the prefs singleton. The Friday issue's pack and
// narrative shapes join in Phase 2. Types only; plain-Node loadable.

export type NotebookKind = 'plan' | 'note' | 'connection' | 'echo' | 'anomaly' | 'miss' | 'query' | 'editor';

// A record from one of the collecting stores, named the way the embeddings
// table names it (kind + record_id), with enough to render a line.
export interface NotebookRecordRef {
  kind: 'scan_item' | 'intel_item' | 'intel_fact' | 'paper' | 'signal' | 'candidate';
  id: string;
  title: string;
  url: string | null;      // the external source
  href: string | null;     // the in-app page when one exists
  company?: string | null; // intel company slug when relevant
}

// A cross-store connection: a new record sits close to a node of the
// argument map in embedding space. `sim` is cosine similarity.
export interface ConnectionPayload {
  record: NotebookRecordRef;
  target: { kind: 'claim' | 'bridge' | 'stance'; code: string; statement: string; href: string };
  sim: number;
}

// An echo: two records of different kinds saying the same thing (a paper
// and a signal, a fact and a scan item), found the same way.
export interface EchoPayload {
  a: NotebookRecordRef;
  b: NotebookRecordRef;
  sim: number;
}

export type AnomalyKind = 'metric' | 'volume_topic' | 'volume_company' | 'lens_silent';

export interface AnomalyPayload {
  kind: AnomalyKind;
  subject: string;         // company slug, topic slug, or lens
  label: string;           // human label: metric label, topic name, lens
  latest: number;
  baseline: number;        // trailing mean
  z?: number;              // metric / volume z-score vs the trailing window
  period?: string;         // metric period (YYYY-MM-DD) or the week
  unit?: string | null;
  source?: string;         // fdic | y9c | edgar_xbrl | cfpb | ats | scan | intel | signals
  note: string;            // one deterministic sentence
}

export interface MissPayload {
  kind: 'coverage' | 'volume_no_signal' | 'question_quiet';
  headline: string;
  url: string | null;
  detail: string;
}

export interface PlanPayload {
  topic: string;
  question_slug: string;
  why: string;
  hypothesis: { statement: string; what_would_settle_it: string[]; watch: string[] };
  sources_to_pull: string[];
  fallback: boolean;       // true when the deterministic plan stood in for the model
}

export interface NotePayload {
  text: string;            // ~120 words
  model: string | null;
}

export interface NotebookRow<P = unknown> {
  id: string;
  week_end: string;        // YYYY-MM-DD
  day: string;             // YYYY-MM-DD
  kind: NotebookKind;
  key: string;
  payload: P;
  created_at: string;
}

export interface HypothesisUpdate {
  week: string;            // YYYY-MM-DD (the issue's Friday)
  direction: 'strengthened' | 'weakened' | 'unchanged';
  note: string;
  hrefs: string[];
}

export interface Hypothesis {
  id: string;
  statement: string;
  question_slug: string | null;
  posed_week: string;
  status: 'open' | 'strengthened' | 'weakened' | 'closed';
  verdict: string | null;
  what_would_settle: string[];
  watch: string[];
  updates: HypothesisUpdate[];
}

export interface SavantPrefs {
  enabled: boolean;
  writer_model: string;
  editor_model: string;
  notebook_model: string;
  editor_name: string;
  lead_rotation: string[];
  lead_override: string | null;
  email_enabled: boolean;
}

// The reader organization: the intel registry's `self` row, public fields
// only. The name never appears in code; it is read from this row.
export interface SelfCompany {
  slug: string;
  name: string;
  public_blurb: string | null;
}

// ---------------------------------------------------------------- Phase 2: the issue

import type { EditionPaper, EditionTool, EditionRelease, EditionBuilderRead } from '../edition/types';

export interface SavantBrief {
  title: string;
  url: string | null;
  href: string | null;
  domain: string | null;
  date: string | null;     // YYYY-MM-DD
  lens?: string | null;
  company?: string | null;
  kind: 'signal' | 'scan_item' | 'intel_item' | 'intel_fact' | 'paper' | 'candidate';
}

export interface MovedClaim {
  code: string;
  statement: string;
  href: string;
  evidence: number;
  supports: number;
  contradicts: number;
}

export interface SavantMoved {
  evidenceByDirection: { supports: number; contradicts: number; neutral: number };
  evidenceByLens: Record<string, number>;
  signalsByLens: Record<string, number>;
  topClaims: MovedClaim[];
  signals: SavantBrief[];          // published this week, newest first, capped
}

export interface PeerMetricCell {
  code: string;
  label: string;
  latest: number | null;
  period: string | null;
  prev: number | null;
  delta: number | null;          // latest - prev
  pct: number | null;            // delta / |prev|
  unit: string;
  source: string;
  sourceUrl: string | null;
  goodWhen: 'up' | 'down' | 'neutral';
}

export interface PeerRow {
  slug: string;
  name: string;
  tier: string;
  isSelf: boolean;
  metrics: PeerMetricCell[];
  aiItems: number;               // intel items with the tech_ai dimension this week
  aiItemsTrailing: number;       // trailing 4-week mean
  facts: number;                 // intel facts this week
  filings: SavantBrief[];        // edgar / filing items this week
  cfpb: { latest: number | null; prev: number | null; period: string | null; sourceUrl: string | null };
  hiring: { aiMl: number | null; agents: number | null; total: number | null; asOf: string | null };
}

export interface SavantPeers {
  self: PeerRow | null;
  tiers: { tier: string; label: string; rows: PeerRow[] }[];
  codes: { code: string; label: string; unit: string; source: string }[];  // the columns shown
}

export interface DatedItem {
  date: string;
  what: string;
  url: string | null;
  href: string | null;
  trigger: string;
}

export interface QueryLogEntry {
  tool: string;
  query: string;
  results: number;
  round: number;
}

export interface SavantPack {
  weekEnd: string;
  windowFrom: string;
  windowTo: string;
  issueNumber: number;
  self: SelfCompany | null;
  plan: PlanPayload | null;
  hypotheses: { fresh: Hypothesis | null; open: Hypothesis[] };   // fresh = posed this week
  notebook: {
    notes: { day: string; text: string }[];
    connections: ConnectionPayload[];
    echoes: EchoPayload[];
    anomalies: AnomalyPayload[];
    misses: MissPayload[];
  };
  moved: SavantMoved;
  peers: SavantPeers;
  regulation: SavantBrief[];
  research: EditionPaper[];
  researchKept: number;
  tools: { entrants: EditionTool[]; releases: EditionRelease[]; reads: EditionBuilderRead[] };
  ahead: DatedItem[];
  numbers: {
    itemsRead: number;
    outlets: number;
    signals: number;
    papers: number;
    evidence: number;
    connections: number;
    anomalies: number;
    companies: number;
  };
  sources: { domain: string; count: number }[];
  mapHrefs: { href: string; code: string; statement: string }[];   // every claim and bridge, so the lead may link any position
  generatedAt: string;
}

export interface HypothesisReading {
  id: string;
  statement: string;
  posedWeek: string;
  direction: 'strengthened' | 'weakened' | 'unchanged' | 'closed';
  note: string;              // one paragraph, plain text with markdown links allowed -> html at save
  html: string;
  verdict: string | null;
}

export interface SavantDepartment {
  key: 'moved' | 'peers' | 'regulation' | 'research' | 'tools' | 'missed' | 'ahead';
  title: string;
  html: string;              // citation-gated
  empty: boolean;            // true when the department prints its one-line "nothing this week"
}

export interface EditorReview {
  name: string;
  verdict: 'publish' | 'publish_with_edits' | 'hold';
  requiredEdits: { section: string; instruction: string }[];
  cuts: { section: string; quote: string; reason: string }[];
  note: string;              // the signed editor's note printed in the issue
  checks: string[];          // the deterministic checks that fired
}

export interface SavantNarrative {
  title: string;             // the issue's title (from the lead)
  summary: string[];         // 5 bullets, html fragments, each with a link
  lead: { title: string; html: string; wordCount: number };
  hypotheses: { fresh: { statement: string; html: string } | null; readings: HypothesisReading[] };
  departments: SavantDepartment[];
  editor: EditorReview | null;
  research: { queries: QueryLogEntry[]; roundsUsed: number; webSearches: number; dropped: string[] };
  citedTags: string[];
  dropped: string[];
  models: { writer: string; editor: string; lead: string };
  revised: boolean;
  figures?: SavantFigure[];   // the figure leg's output (figures-core.ts); absent on issues before 2026-09-26
}

export interface SavedSavantIssue {
  id: string;
  week_end: string;          // YYYY-MM-DD
  pack: SavantPack;
  narrative: SavantNarrative;
  is_published: boolean;
  generated_at: string;
}

export interface SavantIssueListRow {
  id: string;
  week_end: string;
  title: string;
  issueNumber: number | null;
  is_published: boolean;
}

// The fixed table of contents; the public teaser prints exactly this.
export const SAVANT_TOC: { key: string; title: string }[] = [
  { key: 'summary', title: 'Executive summary' },
  { key: 'lead', title: 'Lead analysis' },
  { key: 'hypotheses', title: "Savant's hypotheses" },
  { key: 'moved', title: 'What moved on the map' },
  { key: 'peers', title: 'Peer and market watch' },
  { key: 'regulation', title: 'Regulation and policy' },
  { key: 'research', title: 'Research desk' },
  { key: 'tools', title: 'Tools and builders' },
  { key: 'missed', title: 'Missed and blind spots' },
  { key: 'ahead', title: 'The week ahead' },
  { key: 'appendix-a', title: 'Appendix A: how this issue was researched' },
  { key: 'appendix-b', title: 'Appendix B: sources' },
  { key: 'editor', title: "Editor's note" },
];

export const SAVANT_STRAPLINE = 'An autonomous research agent with an editorial point of view. Produced by The AI Atlas.';
