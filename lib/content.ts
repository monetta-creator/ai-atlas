import { cache } from 'react';
import { q } from './db';
import { isAdmin, isEditMode, isPreview } from './auth';

// Editable site text. The About pages and the landing header read their copy
// through txt(key, fallback): if an override row exists in content_blocks it wins,
// otherwise the hardcoded default renders. Writes go through the guarded actions.
// This module is server-only by construction (it imports lib/db, which throws in
// the browser, and lib/auth, which reads next/headers cookies).

// Keys are a dotted namespace. Shape-validated rather than prefix-listed
// (2026-08-30: the sitewide edit pass put Editable headers on every editorial
// surface, so the old home|about|glossary prefix allow-list would reject
// them): a kebab-case namespace, then dotted kebab segments. Still rejects
// junk, path-ish, and oversized keys; writes stay admin-gated regardless.
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const CONTENT_MAX_VALUE_LEN = 8000;

export function isValidContentKey(key: string): boolean {
  return typeof key === 'string' && key.length <= 200 && KEY_RE.test(key);
}

export function isValidContentValue(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= CONTENT_MAX_VALUE_LEN;
}

// One query per request, memoized so the About layout, the page, and Prose can all
// resolve overrides without an N+1 of identical lookups.
const getOverrides = cache(async (): Promise<Map<string, string>> => {
  const rows = await q<{ key: string; value: string }>(`select key, value from content_blocks`);
  return new Map(rows.map((r) => [r.key, r.value]));
});

type EditContext = {
  admin: boolean;
  editing: boolean;
  txt: (key: string, fallback: string) => string;
};

// Memoized: pages, the About layout, and the Header can each call this in one
// render without re-running isAdmin()/isEditMode()/getOverrides().
export const getEditContext = cache(async (): Promise<EditContext> => {
  const [admin, editOn, preview, overrides] = await Promise.all([
    isAdmin(), isEditMode(), isPreview(), getOverrides(),
  ]);
  const editing = admin && editOn && !preview; // no edit affordances while previewing as a guest
  const txt = (key: string, fallback: string) => overrides.get(key) ?? fallback;
  return { admin, editing, txt };
});
