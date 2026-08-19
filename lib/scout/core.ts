import type { CompanyStage, CompanyEventKind } from '../types';

// Startup Scout's pure core: dedupe normalization, hint parsing, and the
// discovery batch plan. DELIBERATELY dependency-light (type-only imports) so
// scripts/test-scout.mjs can load it under plain-Node type stripping — keep
// runtime imports out of this module.

// Mirrors the companies.name_key generated column exactly
// (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))); keep the two in sync.
export function companyNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Map the model's free-text stage hint onto company_stage_t; anything
// unrecognized degrades to 'unknown' (never throws).
export function parseStageHint(hint: string): CompanyStage {
  const h = String(hint ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (h.includes('preseed')) return 'pre_seed';
  if (h.includes('seriesa')) return 'series_a';
  if (h.includes('seriesb')) return 'series_b';
  if (h.includes('seriesc') || h.includes('seriesd') || h.includes('growth') || h.includes('late')) return 'later';
  if (h.includes('seed')) return 'seed';
  return 'unknown';
}

export function parseFoundedHint(hint: string): number | null {
  const m = /\b(19[89]\d|20\d{2})\b/.exec(String(hint ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1980 && y <= 2100 ? y : null;
}

// Scout's own batch size: 2 web searches per invocation (~30s), the same
// headroom math as the pipeline's QUERIES_PER_BATCH without importing it.
export const SCOUT_QUERIES_PER_BATCH = 2;

export function scoutBatches(queries: string[], size = SCOUT_QUERIES_PER_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < queries.length; i += size) out.push(queries.slice(i, i + size));
  return out;
}

export interface ScoutBatchRef {
  vertical: string;   // slug
  batchIndex: number;
}

// The ordered batch plan for a run, derived from the active verticals' query
// templates. Tokens resolve per batch at execution time; here we only count.
export function scoutPlan(verticals: { slug: string; search_queries: string[]; active: boolean }[]): ScoutBatchRef[] {
  const plan: ScoutBatchRef[] = [];
  for (const v of verticals) {
    if (!v.active) continue;
    scoutBatches(v.search_queries).forEach((_, batchIndex) => plan.push({ vertical: v.slug, batchIndex }));
  }
  return plan;
}

// ---- The dossier merge (three writers: homepage enrich, intel sweep, docs) ---
// The dossier is the machine's own record, but with multiple writers it must be
// MONOTONE: no tool may erase another's finds. Summary: the latest non-empty
// wins. Lists: case-insensitive union, existing order first, capped. Legacy
// {summary, products, customers, enriched_at} shapes merge cleanly (unknown
// keys are dropped).

export interface ScoutDossier {
  summary: string | null;
  products: string[];
  customers: string[];
  sources: string[];       // URLs the tools consulted
  updated_by: 'homepage' | 'intel' | 'document';
  updated_at: string;      // ISO, stamped by the caller
}

function unionCap(existing: unknown, incoming: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const s = String(v ?? '').trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key) || out.length >= cap) return;
    seen.add(key);
    out.push(s);
  };
  if (Array.isArray(existing)) for (const v of existing) push(v);
  for (const v of incoming) push(v);
  return out;
}

export function mergeDossier(
  existing: Record<string, unknown> | null,
  patch: {
    summary: string | null;
    products: string[];
    customers: string[];
    sources: string[];
    updated_by: ScoutDossier['updated_by'];
  },
  nowISO: string
): ScoutDossier {
  const prev = existing ?? {};
  const prevSummary = typeof prev.summary === 'string' && prev.summary.trim() ? prev.summary : null;
  return {
    summary: patch.summary?.trim() ? patch.summary.trim() : prevSummary,
    products: unionCap(prev.products, patch.products, 12),
    customers: unionCap(prev.customers, patch.customers, 12),
    sources: unionCap(prev.sources, patch.sources, 20),
    updated_by: patch.updated_by,
    updated_at: nowISO,
  };
}

// ---- Event dedupe (the research tools log timeline events) -------------------

export function normalizeEventTitle(title: string): string {
  return String(title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeEventUrl(url: string | null): string {
  return String(url ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

// A candidate event already exists when its (non-empty) URL matches an existing
// event's, or its normalized title does. Loose on purpose: a duplicate skipped
// is cheaper than a timeline that repeats itself.
export function eventExists(
  existing: { title: string; url: string | null }[],
  candidate: { title: string; url: string }
): boolean {
  const cUrl = normalizeEventUrl(candidate.url);
  const cTitle = normalizeEventTitle(candidate.title);
  for (const e of existing) {
    if (cUrl && normalizeEventUrl(e.url) === cUrl) return true;
    if (cTitle && normalizeEventTitle(e.title) === cTitle) return true;
  }
  return false;
}

// Map the model's free-text event kind onto company_event_t; degrades to 'news'.
export function parseEventKindHint(hint: string): CompanyEventKind {
  const h = String(hint ?? '').toLowerCase();
  if (h.includes('fund') || h.includes('raise') || h.includes('round') || h.includes('invest')) return 'funding';
  // No bare 'ship' token: 'partnership' and 'flagship' would collide.
  if (h.includes('launch') || h.includes('release')) return 'launch';
  if (h.includes('milestone') || h.includes('partner') || h.includes('customer')) return 'milestone';
  return 'news';
}
