import type { Signal } from './signals';
import type { ConvictionLabel, SignalContext } from './core';
// ---- Period report generation --------------------------------------------
// A point-in-time report over a date range + a chosen subset of signal contexts
// (internal / external). Phase 1 assembles the DATA half (in-range signals,
// resolved touches, per-context grouping); the `narrative` slots are null until
// the AI generation fills them, then the editor edits them. Fully serializable
// so it flows unchanged data layer → generation → editor → PDF export.

// The editorial range the report covers. Both bounds are 'YYYY-MM-DD'. `to` is
// inclusive-of-end-day at the data layer (published_at < to::date + 1).
export interface ReportRange {
  from: string;
  to: string;
}

// One hypothesis code touched by the period's signals, resolved to its
// statement, with how many in-range signals touch it. conviction_label is
// personal-layer — nulled for guests, like SignalTouch.
export interface ReportTouch {
  code: string;
  statement: string;
  conviction_label: ConvictionLabel;
  href: string;                     // /hypothesis/[code]
  signal_count: number;
  unresolved?: boolean;             // admin-only drift marker
}

// The period's published signals grouped by context — the input to the
// per-section AI generation.
interface ReportContextGroup {
  context: SignalContext;
  signals: Signal[];
}

// The editable narrative. Generation produces markdown converted to HTML once
// (server-side, via `marked`); these slots hold HTML. A failed section is left
// null (the report still assembles).
interface ReportNarrative {
  macroSurvey: string | null;                  // the cross-context executive survey (HTML)
  perContext: Record<string, string | null>;   // keyed by SignalContext
  claimsRecap: string | null;                  // recap of the hypotheses touched (HTML)
  // One suggested callout per section — plain text; the editor can edit/remove.
  callouts: Record<string, string | null>;
}

// A persisted report's list metadata. The full Report lives in a jsonb column.
export interface SavedReportMeta {
  id: string;
  title: string;
  date_from: string;
  date_to: string;
  contexts: SignalContext[];
  generated_at: string;
  updated_at: string;
}

// The full report state object.
export interface Report {
  range: ReportRange;
  contexts: SignalContext[];       // the selected subset (validated, canonical order)
  generatedAt: string;             // ISO, server clock
  signals: Signal[];               // in-range published signals, recency desc
  touches: ReportTouch[];          // distinct touched hypotheses across the cohort
  byContext: ReportContextGroup[]; // signals grouped per selected context
  narrative: ReportNarrative;      // all slots null in Phase 1
}
