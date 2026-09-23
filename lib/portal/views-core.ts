import type { PortalIdentity } from './keys';
import type { DatasetDef } from '../datasets/core';
// Explicit .ts extension (a real, non type-only import) so plain Node
// (scripts/test-portal-views.mjs, type stripping) resolves it exactly like
// lib/portal/nl-core.ts's own module chain does.
import { isSignalLens, SIGNAL_LENSES } from '../datasets/core.ts';

// Saved views, the pure half (migration 0064). A view's stored spec is the
// URL-PARAM RECORD the download route's filter grammar understands (never
// SQL): the same where/cols/sort/limit/q/lens/day/since/source/company/format
// keys parseFilterSpec (lib/datasets/filter.ts) already reads off a real
// request. Re-validating that record against the live registry on every
// apply (the download route does this, not this module) is what keeps a
// saved view from ever widening a dataset. Dependency-light (only the
// PortalIdentity type), so scripts/test-portal-views.mjs (plain Node, type
// stripping) loads it directly.

export type ViewParamValue = string | string[];
export type ViewParams = Record<string, ViewParamValue>;

export interface ViewRow {
  id: string;
  key_id: string | null;
  owner: 'key' | 'legacy' | 'admin';
  dataset_slug: string;
  name: string;
  spec: ViewParams;
  format: 'csv' | 'json';
  is_shared: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// The filter grammar's own keys (lib/datasets/filter.ts) plus the route's
// pushdowns and `format`. Anything else in a stored or incoming record is
// dropped: a view can carry only what the download route already knows how
// to read.
const VIEW_PARAM_KEYS = [
  'where', 'cols', 'sort', 'limit', 'q', 'lens', 'day', 'since', 'source', 'company', 'format',
] as const;
type ViewParamKey = (typeof VIEW_PARAM_KEYS)[number];

// 'where' is the one key a real request repeats (?where=a&where=b); every
// other key is single-valued, mirroring parseFilterSpec's own paramValue vs.
// paramValues split.
const MULTI_VALUE_KEYS: ReadonlySet<ViewParamKey> = new Set(['where']);
const MAX_VALUES = 8; // mirrors filter.ts's MAX_WHERE; the real cap is re-enforced there
const MAX_VALUE_LEN = 500;

function isViewParamKey(key: string): key is ViewParamKey {
  return (VIEW_PARAM_KEYS as readonly string[]).includes(key);
}

// Drops unknown keys, coerces values to string | string[], and caps sizes so
// a saved or incoming record can never carry more than the filter grammar
// itself would accept from a real URL. Never throws: a record with nothing
// usable simply comes back empty, and the caller's own parseFilterSpec pass
// catches anything that survives sanitizing but still does not parse.
export function sanitizeViewParams(record: unknown): ViewParams {
  const out: ViewParams = {};
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out;
  for (const [key, raw] of Object.entries(record as Record<string, unknown>)) {
    if (!isViewParamKey(key)) continue;
    const values = (Array.isArray(raw) ? raw : [raw])
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .slice(0, MAX_VALUES)
      .map((v) => v.slice(0, MAX_VALUE_LEN));
    if (!values.length) continue;
    out[key] = MULTI_VALUE_KEYS.has(key) ? values : values[0];
  }
  return out;
}

// A view's stored spec, laid under an incoming request's own search params:
// every explicit param OVERRIDES the view's same-named param entirely (a
// request that carries its own `where` replaces the view's whole where list,
// never appends to it), and every other view param passes through unchanged.
// Any param the caller sent that is not part of the view grammar (?preview=,
// ?schema=, ?download=, ?view= itself) rides through untouched too, since the
// download route still needs to read those off the merged result.
export function mergeParams(viewParams: ViewParams, explicit: URLSearchParams): URLSearchParams {
  const merged = new URLSearchParams();
  const overridden = new Set(explicit.keys());
  for (const key of VIEW_PARAM_KEYS) {
    if (overridden.has(key)) continue;
    const value = viewParams[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) merged.append(key, v);
    } else {
      merged.append(key, value);
    }
  }
  for (const [key, value] of explicit.entries()) merged.append(key, value);
  return merged;
}

// Read rule: admin sees every view; an active per-person key sees its own
// key-owned views plus every is_shared view; the legacy team key sees
// legacy-owned views plus every is_shared view. An inactive or unknown
// identity sees nothing (the caller must already have confirmed
// identity.active before a view is even reachable).
export function canReadView(view: ViewRow, identity: PortalIdentity): boolean {
  if (identity.tier === 'admin') return true;
  if (!identity.active) return false;
  if (view.is_shared) return true;
  if (identity.tier === 'key') return view.owner === 'key' && view.key_id === identity.keyId;
  if (identity.tier === 'legacy') return view.owner === 'legacy';
  return false;
}

// Write rule: admin, the owning key, or the legacy owner for a legacy-owned
// view. is_shared makes a view READABLE by every keyholder, not writable by
// them: only the owner (or admin) may rename, re-point, or delete it.
export function canWriteView(view: ViewRow, identity: PortalIdentity): boolean {
  if (identity.tier === 'admin') return true;
  if (!identity.active) return false;
  if (identity.tier === 'key') return view.owner === 'key' && view.key_id === identity.keyId;
  if (identity.tier === 'legacy') return view.owner === 'legacy';
  return false;
}

// The five pushdown keys the download route (app/api/datasets/[slug]/route.ts)
// reads outside the where/cols/sort/limit/q grammar, in one place so a value
// that would 400 on apply is caught at save time too (parseFilterSpec alone
// does not see these keys). lib/datasets/filter.ts is out of reach this pass,
// so this mirrors the route's own regexes rather than importing them from it.
export const PUSHDOWN_KEYS = ['lens', 'day', 'since', 'source', 'company'] as const;
export type PushdownKey = (typeof PUSHDOWN_KEYS)[number];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_RE = /^[a-z0-9_]{1,32}$/;
const COMPANY_RE = /^[a-z0-9-]{1,64}$/;

function isValidDay(v: string): boolean {
  return DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

// One pushdown key/value pair's error, exactly mirroring the download
// route's own checks: null when the value is fine OR the dataset does not
// declare that filter at all (an unsupported pushdown is simply unreachable
// there, never a 400, except company, which the route always checks for
// support). Exported so lib/portal/nl-core.ts's per-key drop loop uses the
// SAME rule rather than a second, possibly-inconsistent copy of it.
export function pushdownError(def: DatasetDef, key: PushdownKey, value: string): string | null {
  if (key === 'lens') {
    if (!def.filters?.lens) return null;
    return isSignalLens(value) ? null : `Unknown lens. Valid: ${SIGNAL_LENSES.join(', ')}.`;
  }
  if (key === 'day' || key === 'since') {
    if (!def.filters?.[key]) return null;
    return isValidDay(value) ? null : `Bad ${key}. Use YYYY-MM-DD.`;
  }
  if (key === 'source') {
    if (!def.filters?.source) return null;
    return SOURCE_RE.test(value) ? null : 'Bad source. Use one of the source codes listed on the dataset page.';
  }
  // company: unlike the other four, the route always checks this one for
  // support, even when the value itself is otherwise well formed.
  if (!def.filters?.company) return 'This dataset has no company filter.';
  return COMPANY_RE.test(value) ? null : 'Bad company. Use a lowercase slug up to 64 characters.';
}

// Save-time gate for a saved view's whole param record (POST and PATCH on
// /api/portal/views): the first pushdown error, or null. Without this, a
// view could save with `company` on a dataset with no company filter, or
// `day: '2026-13-99'`, and then 400 on every future ?view= apply.
export function validatePushdowns(def: DatasetDef, params: ViewParams): string | null {
  for (const key of PUSHDOWN_KEYS) {
    const v = params[key];
    if (typeof v !== 'string') continue;
    const err = pushdownError(def, key, v);
    if (err) return err;
  }
  return null;
}

// The (owner, key_id) pair a NEW view should be stamped with for the calling
// identity. Callers only reach this after confirming identity.active (an
// inactive/'none' identity falls through to the legacy branch here, but the
// route never lets that identity create a view in the first place).
export function ownerOf(identity: PortalIdentity): { owner: 'key' | 'legacy' | 'admin'; keyId: string | null } {
  if (identity.tier === 'admin') return { owner: 'admin', keyId: null };
  if (identity.tier === 'key') return { owner: 'key', keyId: identity.keyId };
  return { owner: 'legacy', keyId: null };
}
