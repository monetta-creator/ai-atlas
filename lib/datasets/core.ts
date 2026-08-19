// The Datasets portal registry contract. Follows lib/thesis/pack-core.ts:
// query access is INJECTED (`Q`) rather than imported from lib/db so
// scripts/test-datasets.mjs can drive the exact production SQL from plain Node,
// and this module keeps type-only imports for the same reason.
//
// GUEST-SAFE BY CONSTRUCTION: every dataset is downloadable from the public
// portal, so nothing in the personal layer may enter a builder's SELECT list:
// confidence, confidence_label, domain_note, rationales, snapshots,
// reliability_prior, dossier, evidence.note, touch_details, papers.review_note,
// papers.rigor_prior, positions_crosscutting, supply-chain admin notes, and
// unpublished or draft signals are all banned. scripts/test-datasets.mjs
// enforces the ban against the serialized output of every builder.
//
// Determinism: same corpus in, byte-identical rows out. Every ORDER BY carries a
// stable id tiebreaker; dates are formatted with to_char in SQL (node-pg would
// otherwise return Date objects); enums are cast ::text; arrays are joined with
// '; ' into one cell so every value is a flat string, number, or null.

export type Q = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export type DatasetCell = string | number | null;
export type DatasetRow = Record<string, DatasetCell>;

export type DatasetCategory =
  | 'argument-graph'
  | 'signals'
  | 'evidence'
  | 'sources'
  | 'research'
  | 'scout'
  | 'meta';

// `longtext` marks prose columns the explorer should truncate and the schema
// table should flag; `enum` values are closed sets named in the column def.
export type DatasetColumnType = 'text' | 'number' | 'date' | 'enum' | 'longtext';

export interface DatasetColumn {
  key: string;            // stable machine name; the CSV header (snake_case)
  label: string;          // display name for the schema table
  def: string;            // one-line gloss, rendered on the page and in the catalog dataset
  type: DatasetColumnType;
}

export interface DatasetOpts {
  lens?: string;          // validated against SIGNAL_LENSES before it reaches a builder
}

export interface DatasetDef {
  slug: string;           // URL segment + download filename stem
  title: string;
  description: string;    // user-facing, one or two sentences
  methodology: string;    // how it is computed and what is deliberately excluded
  category: DatasetCategory;
  columns: DatasetColumn[];
  formats: ('csv' | 'json')[];
  heavy?: boolean;        // no explorer, truncated preview, download-only posture
  keyGated?: boolean;     // requires the portal key (bulk third-party article text)
  filters?: { lens?: boolean };  // declares supported download query params
  build: (q: Q, opts?: DatasetOpts) => Promise<DatasetRow[]>;
}

// The Signal Board's six audience lenses (signal_lens_t). Kept as a literal here
// rather than imported so the module stays loadable by Node type stripping.
export const SIGNAL_LENSES = [
  'market', 'labor', 'geopolitics', 'regulatory', 'capability', 'society',
] as const;

export function isSignalLens(v: string): boolean {
  return (SIGNAL_LENSES as readonly string[]).includes(v);
}
