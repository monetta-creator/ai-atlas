// Small helpers shared by the research-reach tools (search_items, company,
// metrics, timeline): input coercion that never throws, and result clipping.
export const RESULT_CHARS = 4800;

export const snip = (s: string | null | undefined, n = 200): string => {
  // Stored text may still carry an em dash; the Atlas never emits one.
  const t = (s ?? '').replace(/\u2014/g, ',').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}...` : t;
};

export const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export type ParseErr = { error: string };
export const isErr = (v: unknown): v is ParseErr =>
  isObj(v) && typeof (v as { error?: unknown }).error === 'string';

// Optional YYYY-MM-DD: undefined when absent, an error object when malformed.
export function parseDate(v: unknown, field: string): string | undefined | ParseErr {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return { error: `${field} must be YYYY-MM-DD.` };
  const s = v.trim();
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { error: `${field} is not a real date.` };
  return s;
}

export function parseLimit(v: unknown, def: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

export function optText(v: unknown, field: string, max = 200): string | undefined | ParseErr {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return { error: `${field} must be a string.` };
  const s = v.trim().slice(0, max);
  return s || undefined;
}

// Keep whole lines under the cap (the loop clips at 5,000 characters).
export function clipLines(lines: string[], cap = RESULT_CHARS): string {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > cap) {
      out.push('(more rows omitted; narrow the filters)');
      break;
    }
    out.push(l);
    used += l.length + 1;
  }
  return out.join('\n');
}

// Slug shape: lowercase letters, digits, and - _ .
export const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
