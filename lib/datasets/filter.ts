import type { DatasetCell, DatasetColumn, DatasetDef, DatasetRow } from './core';
// Explicit .ts extension: a real (non type-only) import, so plain Node
// (scripts/test-dataset-filter.mjs, type stripping) must resolve it exactly
// like the rest of this module chain (see registry.ts/builders.ts).
import { fieldEnumValues } from './handoff-shared.ts';

// The dataset download route's filter grammar: where/cols/sort/limit/q,
// parsed against a dataset's own column list (plus handoff-shared's
// FIELD_FACTS enum sets, for the columns that carry a closed set), then
// applied in pure JS over a builder's already-fetched rows. This module
// knows nothing about SQL or about the route's existing pushdown params
// (lens, day, since, source, and the new company): those stay route-level,
// pushed straight into a builder's WHERE clause before rows ever reach here.
//
// Pure: no DB, no React, no lib/db import, so scripts/test-dataset-filter.mjs
// (plain Node, type stripping) loads it directly, same discipline as core.ts.

type ColType = DatasetColumn['type'];

export type FilterOp =
  | 'eq' | 'ne' | 'in' | 'contains' | 'isnull' | 'notnull'
  | 'gt' | 'gte' | 'lt' | 'lte';

export interface WhereClause {
  col: string;
  op: FilterOp;
  value: string | null;    // eq/ne/contains/gt/gte/lt/lte; null otherwise
  values: string[] | null; // 'in' only; null otherwise
}

export interface SortClause {
  col: string;
  dir: 'asc' | 'desc';
}

export interface FilterSpec {
  where: WhereClause[];
  cols: string[] | null;   // null = no projection requested (every column)
  sort: SortClause[];      // requested keys only; the tiebreak is appended at apply time
  limit: number | null;
  q: string | null;
}

const MAX_WHERE = 8;
const MAX_IN_VALUES = 20;
const MAX_Q_LEN = 200;
const MAX_WHERE_VALUE_LEN = 200;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50_000;
const MAX_SORT = 2;
// A JS-side filter over a huge builder's rows costs real CPU once the corpus
// is large (intel-metrics alone runs to about two million rows), so
// guardFilterRequest below refuses a narrowing request outright once the
// built row count exceeds this cap.
const MAX_FILTERABLE_ROWS = 400_000;

// The closed value set for an enum column: the registry's own DatasetColumn.values
// when the column declares one (it overrides a FIELD_FACTS collision on the same
// key from another domain), else FIELD_FACTS's key-keyed lookup.
function enumValuesFor(col: DatasetColumn): string[] | undefined {
  return col.values ?? fieldEnumValues(col.key);
}

const OPS_BY_TYPE: Record<ColType, FilterOp[]> = {
  enum: ['eq', 'ne', 'in', 'isnull', 'notnull'],
  text: ['eq', 'ne', 'in', 'contains', 'isnull', 'notnull'],
  longtext: ['eq', 'ne', 'in', 'contains', 'isnull', 'notnull'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'isnull', 'notnull'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isnull', 'notnull'],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// searchParams reading: accepts either a real URLSearchParams (the route) or
// a plain record (tests, and any future non-Request caller).

type SearchParamsLike = URLSearchParams | Record<string, string | string[]>;

function paramValues(sp: SearchParamsLike, key: string): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll(key);
  const v = sp[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function paramValue(sp: SearchParamsLike, key: string): string | null {
  const all = paramValues(sp, key);
  return all.length ? all[0] : null;
}

// Splits "col:op:value" on the first two colons only, so a value may itself
// contain a colon (a URL, an ISO timestamp). Missing segments come back as ''.
function splitWhereToken(raw: string): [string, string, string] {
  const i1 = raw.indexOf(':');
  if (i1 === -1) return [raw, '', ''];
  const i2 = raw.indexOf(':', i1 + 1);
  if (i2 === -1) return [raw.slice(0, i1), raw.slice(i1 + 1), ''];
  return [raw.slice(0, i1), raw.slice(i1 + 1, i2), raw.slice(i2 + 1)];
}

function colByKey(def: DatasetDef, key: string): DatasetColumn | undefined {
  return def.columns.find((c) => c.key === key);
}

function valueMatchesType(v: string, type: ColType): boolean {
  if (type === 'date') return DATE_RE.test(v);
  if (type === 'number') return v.trim() !== '' && Number.isFinite(Number(v));
  return true;
}

function badValueMessage(v: string, col: DatasetColumn): string {
  if (col.type === 'date') return `Bad date '${v}' for ${col.key}; use YYYY-MM-DD.`;
  return `Bad number '${v}' for ${col.key}.`;
}

// ---------------------------------------------------------------------------
// parseFilterSpec

export function parseFilterSpec(
  def: DatasetDef, searchParams: SearchParamsLike
): { spec: FilterSpec; errors: string[] } {
  const errors: string[] = [];
  const where: WhereClause[] = [];

  const whereTokens = paramValues(searchParams, 'where');
  if (whereTokens.length > MAX_WHERE) {
    errors.push(`Too many where filters, max ${MAX_WHERE}.`);
  }
  for (const token of whereTokens.slice(0, MAX_WHERE)) {
    const [colKey, opRaw, rawValue] = splitWhereToken(token);
    const col = colByKey(def, colKey);
    if (!col) {
      errors.push(`Unknown column in where: ${colKey}`);
      continue;
    }
    const allowedOps = OPS_BY_TYPE[col.type];
    if (!(allowedOps as string[]).includes(opRaw)) {
      errors.push(`Unsupported op '${opRaw}' for ${col.type} column ${col.key}`);
      continue;
    }
    const op = opRaw as FilterOp;

    if (op === 'isnull' || op === 'notnull') {
      where.push({ col: col.key, op, value: null, values: null });
      continue;
    }

    if (op === 'in') {
      const values = rawValue === '' ? [] : rawValue.split(',');
      if (values.length === 0) {
        errors.push(`Missing value for op 'in' on column ${col.key}`);
        continue;
      }
      if (values.length > MAX_IN_VALUES) {
        errors.push(`Too many values in 'in' filter for ${col.key}, max ${MAX_IN_VALUES}.`);
        continue;
      }
      const tooLong = values.find((v) => v.length > MAX_WHERE_VALUE_LEN);
      if (tooLong !== undefined) {
        errors.push(`Value too long for ${col.key}, max ${MAX_WHERE_VALUE_LEN} characters.`);
        continue;
      }
      const badFormat = values.find((v) => !valueMatchesType(v, col.type));
      if (badFormat !== undefined) {
        errors.push(badValueMessage(badFormat, col));
        continue;
      }
      if (col.type === 'enum') {
        const enumValues = enumValuesFor(col);
        const bad = enumValues ? values.find((v) => !enumValues.includes(v)) : undefined;
        if (bad !== undefined) {
          errors.push(`Unknown value '${bad}' for ${col.key}; valid: ${(enumValues as string[]).join(', ')}`);
          continue;
        }
      }
      where.push({ col: col.key, op: 'in', value: null, values });
      continue;
    }

    // eq / ne / contains / gt / gte / lt / lte: a single value is required.
    if (rawValue === '') {
      errors.push(`Missing value for op '${op}' on column ${col.key}`);
      continue;
    }
    if (rawValue.length > MAX_WHERE_VALUE_LEN) {
      errors.push(`Value too long for ${col.key}, max ${MAX_WHERE_VALUE_LEN} characters.`);
      continue;
    }
    if (!valueMatchesType(rawValue, col.type)) {
      errors.push(badValueMessage(rawValue, col));
      continue;
    }
    if (col.type === 'enum' && (op === 'eq' || op === 'ne')) {
      const enumValues = enumValuesFor(col);
      if (enumValues && !enumValues.includes(rawValue)) {
        errors.push(`Unknown value '${rawValue}' for ${col.key}; valid: ${enumValues.join(', ')}`);
        continue;
      }
    }
    where.push({ col: col.key, op, value: rawValue, values: null });
  }

  // cols=a,b,c projection: a subset of def.columns, in the given order,
  // duplicates removed. 'cols=' (present but empty) is treated as no
  // projection requested, same as the param being absent.
  let cols: string[] | null = null;
  const colsRaw = paramValue(searchParams, 'cols');
  if (colsRaw !== null && colsRaw !== '') {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const key of colsRaw.split(',')) {
      if (!colByKey(def, key)) {
        errors.push(`Unknown column in cols: ${key}`);
        continue;
      }
      if (!seen.has(key)) { seen.add(key); ordered.push(key); }
    }
    cols = ordered;
  }

  // sort=<col>:asc|desc[,<col>:asc|desc], max 2. The stable tiebreak on the
  // def's first column is NOT recorded here; applyFilterSpec appends it.
  const sort: SortClause[] = [];
  const sortRaw = paramValue(searchParams, 'sort');
  if (sortRaw !== null && sortRaw !== '') {
    const parts = sortRaw.split(',');
    if (parts.length > MAX_SORT) {
      errors.push(`Too many sort keys, max ${MAX_SORT}.`);
    }
    for (const part of parts.slice(0, MAX_SORT)) {
      const i = part.indexOf(':');
      const colKey = i === -1 ? part : part.slice(0, i);
      const dir = i === -1 ? '' : part.slice(i + 1);
      const col = colByKey(def, colKey);
      if (!col) {
        errors.push(`Unknown column in sort: ${colKey}`);
        continue;
      }
      if (dir !== 'asc' && dir !== 'desc') {
        errors.push(`Bad sort direction '${dir}' for ${colKey}; use asc or desc.`);
        continue;
      }
      sort.push({ col: col.key, dir });
    }
  }

  // limit=N, 1..50000, clamped into range (the route's existing ?preview=N
  // convention); a 400 only on a token that is not a plain non-negative
  // integer.
  let limit: number | null = null;
  const limitRaw = paramValue(searchParams, 'limit');
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw)) {
      errors.push('Bad limit. Use an integer between 1 and 50000.');
    } else {
      limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Number.parseInt(limitRaw, 10)));
    }
  }

  // q=<text>, max 200 chars. An empty q is treated as absent.
  let qValue: string | null = null;
  const qRaw = paramValue(searchParams, 'q');
  if (qRaw !== null && qRaw !== '') {
    if (qRaw.length > MAX_Q_LEN) {
      errors.push(`q is too long, max ${MAX_Q_LEN} characters.`);
    } else {
      qValue = qRaw;
    }
  }

  return { spec: { where, cols, sort, limit, q: qValue }, errors };
}

// ---------------------------------------------------------------------------
// applyFilterSpec

// Dates ride rows as to_char'd YYYY-MM-DD or ISO timestamps; comparing only
// the first 10 characters lines both shapes up as plain YYYY-MM-DD.
function normalizeCell(cell: DatasetCell, colType: ColType): string | number | null {
  if (cell === null) return null;
  if (colType === 'date') return String(cell).slice(0, 10);
  if (colType === 'number') return typeof cell === 'number' ? cell : Number(cell);
  return String(cell);
}

function cellEquals(cell: DatasetCell, value: string, colType: ColType): boolean {
  const norm = normalizeCell(cell, colType);
  if (norm === null) return false;
  if (colType === 'number') return (norm as number) === Number(value);
  return norm === value;
}

// null is "incomparable": a gt/gte/lt/lte filter never matches a null cell.
function compareCell(cell: DatasetCell, value: string, colType: ColType): number | null {
  const norm = normalizeCell(cell, colType);
  if (norm === null) return null;
  if (colType === 'number') {
    const n = norm as number;
    const v = Number(value);
    return n < v ? -1 : n > v ? 1 : 0;
  }
  const s = norm as string;
  return s < value ? -1 : s > value ? 1 : 0;
}

function cellMatchesWhere(row: DatasetRow, w: WhereClause, colType: ColType): boolean {
  const cell = row[w.col];
  switch (w.op) {
    case 'isnull': return cell === null;
    case 'notnull': return cell !== null;
    case 'eq': return cellEquals(cell, w.value as string, colType);
    // null is "incomparable" (see compareCell below): ne never matches a null
    // cell either, consistent with every other op and with SQL's own <>.
    case 'ne': return cell !== null && !cellEquals(cell, w.value as string, colType);
    case 'in': return (w.values as string[]).some((v) => cellEquals(cell, v, colType));
    case 'contains':
      return cell !== null && String(cell).toLowerCase().includes((w.value as string).toLowerCase());
    case 'gt': { const c = compareCell(cell, w.value as string, colType); return c !== null && c > 0; }
    case 'gte': { const c = compareCell(cell, w.value as string, colType); return c !== null && c >= 0; }
    case 'lt': { const c = compareCell(cell, w.value as string, colType); return c !== null && c < 0; }
    case 'lte': { const c = compareCell(cell, w.value as string, colType); return c !== null && c <= 0; }
    default: return true;
  }
}

// q matches any text/longtext/enum column, case-insensitive substring, OR'd
// across columns; a numeric or date column never participates.
function rowMatchesQ(def: DatasetDef, row: DatasetRow, q: string): boolean {
  const needle = q.toLowerCase();
  for (const c of def.columns) {
    if (c.type !== 'text' && c.type !== 'longtext' && c.type !== 'enum') continue;
    const cell = row[c.key];
    if (cell !== null && String(cell).toLowerCase().includes(needle)) return true;
  }
  return false;
}

// nulls sort last in both directions; numbers compare numerically; every
// other type compares as a plain string (never localeCompare, so the order
// is stable and locale-independent).
function compareValues(a: DatasetCell, b: DatasetCell, colType: ColType, dir: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let cmp: number;
  if (colType === 'number') {
    const an = typeof a === 'number' ? a : Number(a);
    const bn = typeof b === 'number' ? b : Number(b);
    cmp = an < bn ? -1 : an > bn ? 1 : 0;
  } else {
    const as = String(a);
    const bs = String(b);
    cmp = as < bs ? -1 : as > bs ? 1 : 0;
  }
  return dir === 'desc' ? -cmp : cmp;
}

function sortRows(def: DatasetDef, rows: DatasetRow[], sort: SortClause[]): DatasetRow[] {
  if (sort.length === 0) return rows;
  const tiebreak: SortClause = { col: def.columns[0].key, dir: 'asc' };
  // Resolve each key's column type ONCE up front: colByKey does a linear scan
  // of def.columns, and the comparator below runs it on every pairwise
  // comparison (O(n log n) calls) otherwise.
  const keys = [...sort, tiebreak].map((k) => ({
    ...k, type: colByKey(def, k.col)?.type ?? 'text' as ColType,
  }));
  return [...rows].sort((r1, r2) => {
    for (const k of keys) {
      const cmp = compareValues(r1[k.col], r2[k.col], k.type, k.dir);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

export function applyFilterSpec(def: DatasetDef, rows: DatasetRow[], spec: FilterSpec): DatasetRow[] {
  let out = rows;
  if (spec.where.length > 0) {
    out = out.filter((row) =>
      spec.where.every((w) => cellMatchesWhere(row, w, colByKey(def, w.col)?.type ?? 'text'))
    );
  }
  if (spec.q) {
    const q = spec.q;
    out = out.filter((row) => rowMatchesQ(def, row, q));
  }
  out = sortRows(def, out, spec.sort);
  if (spec.limit !== null) out = out.slice(0, spec.limit);
  return out;
}

// ---------------------------------------------------------------------------
// projection, description, narrowing

export function projectColumns(def: DatasetDef, spec: FilterSpec): DatasetColumn[] {
  if (!spec.cols || spec.cols.length === 0) return def.columns;
  const cols: DatasetColumn[] = [];
  for (const key of spec.cols) {
    const c = colByKey(def, key);
    if (c) cols.push(c);
  }
  return cols;
}

export function describeSpec(spec: FilterSpec): string {
  const parts: string[] = [];
  if (spec.where.length) parts.push(`${spec.where.length} filter${spec.where.length === 1 ? '' : 's'}`);
  if (spec.q) parts.push('search');
  if (spec.cols) parts.push(`${spec.cols.length} column${spec.cols.length === 1 ? '' : 's'}`);
  if (spec.sort.length) parts.push('sorted');
  if (spec.limit !== null) parts.push(`limit ${spec.limit}`);
  return parts.length ? parts.join(', ') : 'unfiltered';
}

// True when the request would actually reduce the row count or the column
// set: any where clause, a free-text search, a column projection, or a row
// limit. Sort alone reorders without narrowing, so it does not count (and a
// sort-only request does not earn the '-filtered' filename suffix).
export function isNarrowed(spec: FilterSpec): boolean {
  return spec.where.length > 0 || spec.q !== null || spec.cols !== null || spec.limit !== null;
}

// Broader than isNarrowed: whether the filter grammar was invoked AT ALL,
// including a sort-only request (which reorders but does not narrow). This is
// the boundary a CPU-cost guard cares about: a JS sort over a huge corpus is
// exactly as expensive as a JS filter over one.
export function isFilterRequested(spec: FilterSpec): boolean {
  return isNarrowed(spec) || spec.sort.length > 0;
}

// ---------------------------------------------------------------------------
// guardFilterRequest: the route's two CPU-safety guardrails for a JS-side
// filter/sort pass over a dataset's already-fetched rows, extracted here
// (pure, no DB) so scripts/test-dataset-filter.mjs can exercise them
// directly. The route calls this twice: once before def.build() (rowCount
// omitted, to refuse an unbounded intel-metrics pull before it happens) and
// once after (rowCount set to the built row count, to cap the JS pass over
// whatever the build actually returned).
export interface GuardOpts {
  since?: string;
  source?: string;
  company?: string;
  isPreview: boolean;
  rowCount?: number; // omitted pre-build; the built row count post-build
}

export interface GuardResult {
  status: number;
  error: string;
}

export function guardFilterRequest(def: DatasetDef, spec: FilterSpec, opts: GuardOpts): GuardResult | null {
  if (!isFilterRequested(spec)) return null;

  // intel-metrics runs to about two million rows: a JS-side filter or sort
  // over the whole corpus is only allowed once the request also narrows the
  // SQL pushdown (since, source, or company). Exempt only a preview whose
  // spec carries no where/q: the SQL LIMIT already caps that build at 100
  // rows, so JS-side work afterward is cheap regardless. A preview that DOES
  // carry a where/q cannot use that cheap path (the limit would apply before
  // the filter, see the route), so it fetches the full slice like any other
  // request and is not exempt here either.
  const previewExempt = opts.isPreview && spec.where.length === 0 && spec.q === null;
  if (
    def.slug === 'intel-metrics' && !previewExempt &&
    !opts.since && !opts.source && !opts.company
  ) {
    return { status: 400, error: 'narrow the slice with since, source or company first' };
  }

  // Any dataset whose built rows exceed the cap refuses a narrowing request
  // outright. This is about capping the JS pass, not the fetch (the DB call
  // has already happened by the time rowCount is known), so it only applies
  // on the post-build call.
  if (opts.rowCount !== undefined && opts.rowCount > MAX_FILTERABLE_ROWS) {
    return { status: 413, error: 'narrow the slice' };
  }

  return null;
}
