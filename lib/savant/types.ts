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
