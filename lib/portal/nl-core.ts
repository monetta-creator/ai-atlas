import type { DatasetColumn, DatasetDef } from '../datasets/core';
// Explicit .ts extensions on these two (real, non type-only imports) so plain
// Node (scripts/test-nl-filter.mjs, type stripping) resolves them exactly
// like lib/datasets/filter.ts's own module chain does.
import { fieldEnumValues } from '../datasets/handoff-shared.ts';
import { parseFilterSpec } from '../datasets/filter.ts';
import { SIGNAL_LENSES } from '../datasets/core.ts';
import { PUSHDOWN_KEYS, pushdownError, sanitizeViewParams } from './views-core.ts';
import type { ViewParams } from './views-core';

// Natural-language-to-filter, the pure half (migration 0064's NL query
// builder): the catalog text fed to the model, the forced-tool schema, and
// output validation. validateNlOutput deliberately REUSES
// lib/datasets/filter.ts's parseFilterSpec (one where token at a time) rather
// than re-implementing its value-format and enum rules, so a filter the model
// invents gets exactly the rejection message a hand-typed download URL would.
// Dependency-light (no DB, no next/*), so scripts/test-nl-filter.mjs (plain
// Node, type stripping) loads it directly.

const MAX_WHERE = 8;
const MAX_COLS = 40;
const MAX_SORT = 2;
const MAX_LIMIT = 50_000;
const MAX_Q_LEN = 200;

// Same rule as lib/datasets/filter.ts's own enumValuesFor: the registry
// column's own `values` overrides a FIELD_FACTS collision on the same key
// from another domain (e.g. concepts.status vs. tooling_products.status).
function enumValuesFor(col: DatasetColumn): string[] | undefined {
  return col.values ?? fieldEnumValues(col.key);
}

function columnLine(col: DatasetColumn): string {
  const values = col.type === 'enum' ? enumValuesFor(col) : undefined;
  if (values && values.length) return `  - ${col.key}: ${col.type} [${values.join(', ')}]`;
  // An enum column with no declared closed set (neither its own `values`
  // override nor a FIELD_FACTS entry) would otherwise print bare ("key:
  // enum"), inviting the model to guess a value parseFilterSpec has nothing
  // to check it against. Fall back to the column's own one-line gloss, which
  // is where that closed set is documented today (e.g. "question, stance,
  // claim, frame, or bridge_claim.").
  if (col.type === 'enum') return `  - ${col.key}: enum (${col.def})`;
  return `  - ${col.key}: ${col.type}`;
}

// One block per dataset the caller may read: slug, description, then every
// column as "key type [enum values]". Compact on purpose, since this text
// rides in the system prompt of every call.
export function buildNlCatalog(defs: DatasetDef[], readable: (def: DatasetDef) => boolean): string {
  const blocks: string[] = [];
  for (const def of defs) {
    if (!readable(def)) continue;
    blocks.push([`${def.slug}: ${def.description}`, ...def.columns.map(columnLine)].join('\n'));
  }
  return blocks.join('\n\n');
}

const WHERE_OPS = ['eq', 'ne', 'in', 'contains', 'isnull', 'notnull', 'gt', 'gte', 'lt', 'lte'];

// The forced-tool schema. Every field is required (empty array / empty
// string / 0 reads as "not applicable") so the model cannot silently omit a
// field, and validateNlOutput treats a missing key and an explicitly empty
// one the same way either way. Ranges live only in descriptions: the
// Anthropic tool validator rejects minimum/maximum on an integer property.
export function nlSchema(slugs: string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      dataset: { type: 'string', enum: slugs, description: 'The single best-fit dataset for this question.' },
      params: {
        type: 'object',
        additionalProperties: false,
        properties: {
          where: {
            type: 'array',
            description: `Up to ${MAX_WHERE} filters. Empty array if none apply.`,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                col: { type: 'string', description: 'A column key from the catalog above.' },
                op: { type: 'string', enum: WHERE_OPS },
                value: {
                  type: 'string',
                  description: 'The filter value. For op "in", a comma-separated list. Empty string for isnull/notnull.',
                },
              },
              required: ['col', 'op', 'value'],
            },
          },
          cols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Column keys to return, in order. Empty array means every column.',
          },
          sort: {
            type: 'array',
            description: `Up to ${MAX_SORT} sort keys. Empty array if the question does not ask for an order.`,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                col: { type: 'string' },
                dir: { type: 'string', enum: ['asc', 'desc'] },
              },
              required: ['col', 'dir'],
            },
          },
          limit: {
            type: 'integer',
            description: `Row cap, 1 to ${MAX_LIMIT}. Use a modest number, for example 100, unless the question asks for everything. 0 means unset.`,
          },
          q: {
            type: 'string',
            description: `Free-text search across text columns, up to ${MAX_Q_LEN} characters. Empty string if not applicable.`,
          },
          lens: {
            type: 'string',
            description: `Signal Board lens pushdown, when the dataset supports one. Valid: ${SIGNAL_LENSES.join(', ')}. Empty string otherwise.`,
          },
          day: { type: 'string', description: 'A YYYY-MM-DD day pushdown, when the dataset supports one. Empty string otherwise.' },
          since: { type: 'string', description: 'A YYYY-MM-DD lower-bound pushdown, when the dataset supports one. Empty string otherwise.' },
          source: { type: 'string', description: 'A source-code pushdown, when the dataset supports one. Empty string otherwise.' },
          company: { type: 'string', description: 'A company-slug pushdown, when the dataset supports one. Empty string otherwise.' },
        },
        required: ['where', 'cols', 'sort', 'limit', 'q', 'lens', 'day', 'since', 'source', 'company'],
      },
      explanation: {
        type: 'string',
        description:
          'One or two plain sentences: what dataset and filters were chosen and why, or why nothing fits well when the question fits no dataset. Never use an em dash; use a comma or a period instead.',
      },
    },
    required: ['dataset', 'params', 'explanation'],
  };
}

export interface NlValidated {
  dataset: string;
  params: ViewParams;
  dropped: string[];
  explanation: string;
}

// Thrown when the model named a dataset that does not exist, or one the
// caller may not read (key-gated, no active identity). The route turns this
// into a 400; it is never a validation warning folded into `dropped`, because
// there is no query to run at all without a dataset.
export class NlUnknownDataset extends Error {}

interface NlWhereItem { col?: unknown; op?: unknown; value?: unknown }
interface NlSortItem { col?: unknown; dir?: unknown }
interface NlParamsOut {
  where?: unknown;
  cols?: unknown;
  sort?: unknown;
  limit?: unknown;
  q?: unknown;
  lens?: unknown;
  day?: unknown;
  since?: unknown;
  source?: unknown;
  company?: unknown;
}
export interface NlOut {
  dataset?: unknown;
  params?: NlParamsOut;
  explanation?: unknown;
}

function colExists(def: DatasetDef, key: string): boolean {
  return def.columns.some((c) => c.key === key);
}

// Re-checks a single where token exactly the way the download route would
// (parseFilterSpec against a one-item where array): unknown column, bad op
// for the column's type, a value outside a closed enum, or a malformed
// date/number all come back as parseFilterSpec's own message, so a dropped
// filter is never explained by a second, possibly-inconsistent set of rules.
function whereTokenError(def: DatasetDef, token: string): string | null {
  const { errors } = parseFilterSpec(def, { where: [token] });
  return errors.length ? errors[0] : null;
}

export function validateNlOutput(
  out: NlOut, defs: DatasetDef[], readable: (def: DatasetDef) => boolean
): NlValidated {
  const datasetSlug = typeof out.dataset === 'string' ? out.dataset.trim() : '';
  const def = defs.find((d) => d.slug === datasetSlug);
  if (!def) throw new NlUnknownDataset(`Unknown dataset: ${datasetSlug || '(none given)'}.`);
  if (!readable(def)) throw new NlUnknownDataset(`This dataset needs an access key: ${datasetSlug}.`);

  const dropped: string[] = [];
  const p: NlParamsOut = out.params ?? {};

  const whereTokens: string[] = [];
  const rawWhereAll = Array.isArray(p.where) ? (p.where as NlWhereItem[]) : [];
  if (rawWhereAll.length > MAX_WHERE) {
    const extra = rawWhereAll.length - MAX_WHERE;
    dropped.push(`${extra} extra filter${extra === 1 ? ' was' : 's were'} dropped, max ${MAX_WHERE}.`);
  }
  for (const w of rawWhereAll.slice(0, MAX_WHERE)) {
    const col = typeof w.col === 'string' ? w.col : '';
    const op = typeof w.op === 'string' ? w.op : '';
    // qwen (the default) routinely answers a number where the schema asked
    // for a string, e.g. `{ value: 0.5 }` for "relevance:gt:0.5"; coerce
    // rather than dropping a filter that is otherwise perfectly formed.
    const rawValue = typeof w.value === 'number' ? String(w.value) : typeof w.value === 'string' ? w.value : '';
    if (!col || !op) { dropped.push('an incomplete filter was dropped'); continue; }
    // For op 'in', trim each comma-separated piece: the model's natural
    // "high, medium" would otherwise leave a leading space on every value
    // after the first, failing the enum check below and dropping the whole
    // filter over a formatting nicety.
    const value = op === 'in'
      ? rawValue.split(',').map((s) => s.trim()).filter(Boolean).join(',')
      : rawValue;
    const token = op === 'isnull' || op === 'notnull' ? `${col}:${op}:` : `${col}:${op}:${value}`;
    const err = whereTokenError(def, token);
    if (err) { dropped.push(err); continue; }
    whereTokens.push(token);
  }

  const cols: string[] = [];
  const rawColsAll = Array.isArray(p.cols) ? (p.cols as unknown[]) : [];
  if (rawColsAll.length > MAX_COLS) {
    const extra = rawColsAll.length - MAX_COLS;
    dropped.push(`${extra} extra column${extra === 1 ? ' was' : 's were'} dropped, max ${MAX_COLS}.`);
  }
  for (const c of rawColsAll.slice(0, MAX_COLS)) {
    if (typeof c !== 'string') continue;
    if (colExists(def, c)) cols.push(c);
    else dropped.push(`unknown column in cols: ${c}`);
  }

  const sortTokens: string[] = [];
  const rawSortAll = Array.isArray(p.sort) ? (p.sort as NlSortItem[]) : [];
  if (rawSortAll.length > MAX_SORT) {
    const extra = rawSortAll.length - MAX_SORT;
    dropped.push(`${extra} extra sort key${extra === 1 ? ' was' : 's were'} dropped, max ${MAX_SORT}.`);
  }
  for (const s of rawSortAll.slice(0, MAX_SORT)) {
    const col = typeof s.col === 'string' ? s.col : '';
    const dir = typeof s.dir === 'string' ? s.dir : '';
    if (colExists(def, col) && (dir === 'asc' || dir === 'desc')) sortTokens.push(`${col}:${dir}`);
    else dropped.push(`a bad sort key was dropped: ${col || '(none)'}:${dir || '(none)'}`);
  }

  // limit: qwen also sometimes answers a numeric string ("100") where the
  // schema asked for an integer; accept a digit-only string the same as a
  // number rather than silently unsetting the limit.
  const rawLimit =
    typeof p.limit === 'number' ? p.limit
    : typeof p.limit === 'string' && /^\d+$/.test(p.limit) ? Number(p.limit)
    : null;
  let limit: number | null = null;
  if (rawLimit !== null && Number.isFinite(rawLimit) && rawLimit > 0) {
    const rounded = Math.round(rawLimit);
    limit = Math.min(MAX_LIMIT, Math.max(1, rounded));
    if (rounded > MAX_LIMIT) dropped.push(`limit clamped to ${MAX_LIMIT}`);
  }

  const q = typeof p.q === 'string' ? p.q.trim().slice(0, MAX_Q_LEN) : '';

  const params: ViewParams = {};
  if (whereTokens.length) params.where = whereTokens;
  if (cols.length) params.cols = cols.join(',');
  if (sortTokens.length) params.sort = sortTokens.join(',');
  if (limit !== null) params.limit = String(limit);
  if (q) params.q = q;

  for (const key of PUSHDOWN_KEYS) {
    const raw = p[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = raw.trim();
    if (!def.filters?.[key]) { dropped.push(`${key} is not a filter on ${def.slug}`); continue; }
    // The dataset declares this pushdown, so re-check the value against the
    // SAME rule the download route enforces at apply time (lib/portal/views-
    // core.ts's pushdownError), the one place that rule lives now that
    // lib/datasets/filter.ts is out of reach this pass.
    const err = pushdownError(def, key, value);
    if (err) { dropped.push(err); continue; }
    params[key] = value;
  }

  const explanation = typeof out.explanation === 'string' ? out.explanation.trim() : '';

  return { dataset: def.slug, params: sanitizeViewParams(params), dropped, explanation };
}
