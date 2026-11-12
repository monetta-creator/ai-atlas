// Small shared helpers for the reach-B research tools (question_map,
// whats_new, tooling, startups, engine_status, report).
export const MAX_CHARS = 4800;

export const clip = (s: string | null | undefined, n: number): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// Keep a rendered result under the size budget, cutting at a line boundary.
export function capText(lines: string[], note = '(more rows omitted; narrow the query)'): string {
  const out: string[] = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.length + 1 > MAX_CHARS - note.length - 2) {
      out.push(note);
      break;
    }
    out.push(l);
    len += l.length + 1;
  }
  return out.join('\n');
}

export const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

export const optStr = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
};

export const ymd = (d: Date | string | null): string => {
  if (!d) return '–';
  const x = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? '–' : x.toISOString().slice(0, 10);
};

// Escape LIKE wildcards in user text.
export const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
