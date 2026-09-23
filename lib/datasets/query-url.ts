import type { DatasetColumn, DatasetDef } from './core';

// The query builder's URL grammar: pure translation between a BuilderState
// (what components/datasets/QueryBuilder.tsx renders as form controls) and
// the download route's own where/cols/sort/limit/q/lens/day/since/source/
// company query string (app/api/datasets/[slug]/route.ts, parsed server-side
// by lib/datasets/filter.ts parseFilterSpec). This module owns none of that
// parsing or validation; it only has to produce tokens parseFilterSpec
// accepts and read them back tolerantly. Kept import-free at runtime (only
// type imports from ./core) so it loads in the browser AND in plain Node
// (scripts/test-query-url.mjs, type stripping) with nothing dragged in.
//
// OPS_BY_TYPE and the numeric caps below are a deliberate MIRROR of
// lib/datasets/filter.ts's own private tables (that module is off limits to
// this task and exports neither). scripts/test-query-url.mjs pins every
// generated op against the real parseFilterSpec so a drift between the two
// copies fails loudly instead of silently.

export type ColType = DatasetColumn['type'];

export interface WhereRow {
  col: string;
  op: string;
  value: string; // raw token value; for 'in' a comma-joined list with no spaces
}

export interface SortRow {
  col: string;
  dir: 'asc' | 'desc';
}

export interface BuilderState {
  where: WhereRow[];
  cols: string[];
  sort: SortRow[];
  limit: number | null;
  q: string;
  pushdowns: Record<string, string>; // lens/day/since/source/company, only the ones in use
}

// The minimal dataset shape fromSearchParams/fromViewParams actually read:
// def.columns[].key/.type (to validate a where/cols/sort token) and
// def.filters (to validate a pushdown key). A real DatasetDef satisfies this
// trivially; so does a saved view's own lighter column list (SavedViews.tsx
// passes through QueryBuilder's QueryColumn[], which carries label/def/values
// too, simply ignored here) with no need to hold a full registry entry.
export interface FilterColumn { key: string; type: ColType }
export type FilterableDef = { columns: FilterColumn[]; filters?: DatasetDef['filters'] };

export const MAX_WHERE = 8;
export const MAX_IN_VALUES = 20;
export const MAX_Q_LEN = 200;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 50_000;
export const MAX_SORT = 2;

const OPS_BY_TYPE: Record<ColType, string[]> = {
  enum: ['eq', 'ne', 'in', 'isnull', 'notnull'],
  text: ['eq', 'ne', 'in', 'contains', 'isnull', 'notnull'],
  longtext: ['eq', 'ne', 'in', 'contains', 'isnull', 'notnull'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'isnull', 'notnull'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isnull', 'notnull'],
};

export function opsForType(type: ColType): string[] {
  return OPS_BY_TYPE[type];
}

export function emptyBuilderState(): BuilderState {
  return { where: [], cols: [], sort: [], limit: null, q: '', pushdowns: {} };
}

const PUSHDOWN_KEYS = ['lens', 'day', 'since', 'source', 'company'] as const;

// ---------------------------------------------------------------------------
// where-token splitting, mirroring filter.ts's splitWhereToken exactly (first
// two colons only, so a value may itself contain one).

function splitWhereToken(raw: string): [string, string, string] {
  const i1 = raw.indexOf(':');
  if (i1 === -1) return [raw, '', ''];
  const i2 = raw.indexOf(':', i1 + 1);
  if (i2 === -1) return [raw.slice(0, i1), raw.slice(i1 + 1), ''];
  return [raw.slice(0, i1), raw.slice(i1 + 1, i2), raw.slice(i2 + 1)];
}

// ---------------------------------------------------------------------------
// toSearchParams: BuilderState -> the route's own query grammar. Empty
// pieces are omitted rather than sent as blank params (a where row with no
// column or no op yet, an empty cols/sort/q, a null limit, an unset
// pushdown). isnull/notnull never carry a value segment.

export function toSearchParams(state: BuilderState): URLSearchParams {
  const sp = new URLSearchParams();

  for (const w of state.where) {
    if (!w.col || !w.op) continue;
    if (w.op === 'isnull' || w.op === 'notnull') {
      sp.append('where', `${w.col}:${w.op}`);
      continue;
    }
    if (!w.value.trim()) continue;
    sp.append('where', `${w.col}:${w.op}:${w.value}`);
  }

  if (state.cols.length) sp.set('cols', state.cols.join(','));
  const liveSort = state.sort.filter((s) => s.col);
  if (liveSort.length) sp.set('sort', liveSort.map((s) => `${s.col}:${s.dir}`).join(','));
  if (state.limit !== null) sp.set('limit', String(state.limit));
  if (state.q.trim()) sp.set('q', state.q.trim());

  for (const key of PUSHDOWN_KEYS) {
    const v = state.pushdowns[key];
    if (v && v.trim()) sp.set(key, v.trim());
  }

  return sp;
}

// ---------------------------------------------------------------------------
// fromSearchParams: the tolerant reverse. Unknown columns, ops not valid for
// a column's type, and out-of-range tokens are dropped silently rather than
// surfaced as errors (that is parseFilterSpec's job, at request time); this
// is only for seeding a builder from a shared link. Mirrors parseFilterSpec's
// own reading rules (order, caps) without reproducing its error reporting.

export function fromSearchParams(sp: URLSearchParams, def: FilterableDef): BuilderState {
  const colType = new Map(def.columns.map((c) => [c.key, c.type] as const));

  const where: WhereRow[] = [];
  for (const raw of sp.getAll('where').slice(0, MAX_WHERE)) {
    const [col, op, value] = splitWhereToken(raw);
    const type = colType.get(col);
    if (!type || !opsForType(type).includes(op)) continue;
    where.push({ col, op, value });
  }

  const cols: string[] = [];
  const colsRaw = sp.get('cols');
  if (colsRaw) {
    const seen = new Set<string>();
    for (const key of colsRaw.split(',')) {
      if (colType.has(key) && !seen.has(key)) { seen.add(key); cols.push(key); }
    }
  }

  const sort: SortRow[] = [];
  const sortRaw = sp.get('sort');
  if (sortRaw) {
    for (const part of sortRaw.split(',').slice(0, MAX_SORT)) {
      const i = part.indexOf(':');
      const col = i === -1 ? part : part.slice(0, i);
      const dir = i === -1 ? '' : part.slice(i + 1);
      if (colType.has(col) && (dir === 'asc' || dir === 'desc')) sort.push({ col, dir });
    }
  }

  let limit: number | null = null;
  const limitRaw = sp.get('limit');
  if (limitRaw && /^\d+$/.test(limitRaw)) {
    limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Number.parseInt(limitRaw, 10)));
  }

  let q = '';
  const qRaw = sp.get('q');
  if (qRaw && qRaw.length <= MAX_Q_LEN) q = qRaw;

  // Only read a pushdown the dataset actually declares (def.filters): a
  // shared/stale link carrying an undeclared key (e.g. ?company=acme on a
  // dataset with no company filter) must not seed state the builder renders
  // no control for and every action then 400s on.
  const pushdowns: Record<string, string> = {};
  for (const key of PUSHDOWN_KEYS) {
    const v = sp.get(key);
    if (v && def.filters?.[key]) pushdowns[key] = v;
  }

  return { where, cols, sort, limit, q, pushdowns };
}

// ---------------------------------------------------------------------------
// fromViewParams / toViewParams: BuilderState <-> a saved view's stored spec
// (lib/portal/views-core.ts's ViewParams shape: `where` a string array, every
// other key a plain string, absent when unused). toViewParams is the exact
// inverse of toSearchParams (build the query string, then read it back into a
// plain record instead of a URLSearchParams); fromViewParams reuses
// fromSearchParams by replaying the record onto a URLSearchParams (repeating
// `where`'s array values) rather than re-implementing its parsing/validation.
// Typed as a plain record (not lib/portal/views-core.ts's ViewParams) so this
// module keeps its own no-runtime-imports contract (see the file header).

export function toViewParams(state: BuilderState): Record<string, string | string[]> {
  const sp = toSearchParams(state);
  const out: Record<string, string | string[]> = {};
  const where = sp.getAll('where');
  if (where.length) out.where = where;
  for (const key of ['cols', 'sort', 'limit', 'q', ...PUSHDOWN_KEYS]) {
    const v = sp.get(key);
    if (v) out[key] = v;
  }
  return out;
}

export function fromViewParams(params: Record<string, string | string[]>, def: FilterableDef): BuilderState {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) { for (const v of value) sp.append(key, v); }
    else sp.append(key, value);
  }
  return fromSearchParams(sp, def);
}

// ---------------------------------------------------------------------------
// hrefs: the download-route URL for one of the builder's actions.

export type BuilderFormat = 'csv' | 'json' | 'schema' | 'preview';

export function hrefs(
  slug: string, state: BuilderState, format: BuilderFormat, previewN?: number
): string {
  const sp = toSearchParams(state);
  // download=1 so the "Download JSON" button actually saves a file; the
  // route otherwise serves JSON inline (a quick in-browser peek is the
  // default for callers that want that, like the preview format below).
  if (format === 'json') { sp.set('format', 'json'); sp.set('download', '1'); }
  else if (format === 'schema') sp.set('schema', '1');
  else if (format === 'preview') sp.set('preview', String(previewN ?? 25));
  const qs = sp.toString();
  return `/api/datasets/${slug}${qs ? `?${qs}` : ''}`;
}

// ---------------------------------------------------------------------------
// describeState: a short human sentence for the count line.

function whereDescription(w: WhereRow): string {
  switch (w.op) {
    case 'eq': return `${w.col} is ${w.value}`;
    case 'ne': return `${w.col} is not ${w.value}`;
    case 'in': return `${w.col} in ${w.value.split(',').map((v) => v.trim()).filter(Boolean).join(', ')}`;
    case 'contains': return `${w.col} contains "${w.value}"`;
    case 'isnull': return `${w.col} is blank`;
    case 'notnull': return `${w.col} is set`;
    case 'gt': return `${w.col} > ${w.value}`;
    case 'gte': return `${w.col} >= ${w.value}`;
    case 'lt': return `${w.col} < ${w.value}`;
    case 'lte': return `${w.col} <= ${w.value}`;
    default: return `${w.col} ${w.op} ${w.value}`;
  }
}

export function describeState(state: BuilderState): string {
  const parts: string[] = [];
  for (const key of PUSHDOWN_KEYS) {
    const v = state.pushdowns[key];
    if (v && v.trim()) parts.push(`${key} ${v.trim()}`);
  }
  const validWhere = state.where.filter((w) => w.col && w.op && (w.op === 'isnull' || w.op === 'notnull' || w.value.trim()));
  if (validWhere.length) parts.push(validWhere.map(whereDescription).join(', '));
  if (state.q.trim()) parts.push(`search "${state.q.trim()}"`);
  const liveSort = state.sort.filter((s) => s.col);
  if (liveSort.length) parts.push(`sorted by ${liveSort.map((s) => `${s.col} ${s.dir}`).join(', ')}`);
  if (state.cols.length) parts.push(`${state.cols.length} column${state.cols.length === 1 ? '' : 's'}`);
  if (state.limit !== null) parts.push(`limit ${state.limit}`);
  return parts.length ? parts.join(' · ') : 'unfiltered';
}

// ---------------------------------------------------------------------------
// requiresNarrowing: the intel-metrics guardrail (lib/datasets/filter.ts
// guardFilterRequest's pre-build check), surfaced here so the builder can
// disable Preview/Download with an inline note instead of letting the
// request round-trip into a 400. Takes only what it reads (def.slug) so a
// client component that never holds a full DatasetDef can call it with a
// plain { slug } object.

export function requiresNarrowing(def: Pick<DatasetDef, 'slug'>, state: BuilderState): boolean {
  if (def.slug !== 'intel-metrics') return false;
  const liveSort = state.sort.filter((s) => s.col);
  // Mirrors the route's own isFilterRequested (isNarrowed || sort), which
  // also counts a cols projection and a limit; without those two terms a
  // cols-only or limit-only request on intel-metrics passed this check but
  // still 400'd server-side with no warning ever shown in the builder.
  const filterRequested =
    state.where.length > 0 || state.q.trim() !== '' || liveSort.length > 0 ||
    state.cols.length > 0 || state.limit !== null;
  if (!filterRequested) return false;
  const { since, source, company } = state.pushdowns;
  return !since && !source && !company;
}
