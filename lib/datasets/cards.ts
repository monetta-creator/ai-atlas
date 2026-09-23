import type { DatasetDef } from './core';

// Pure card-shaping for the Data Portal hub (app/datasets/page.tsx +
// components/datasets/DatasetCatalog.tsx). No @/lib/db import anywhere in
// this file or its one dependency (core.ts is pure, and the DatasetDef
// import is type-only and erased at compile time), so this is safe to
// import from a 'use client' component, and relative (not '@/...') so plain
// Node type stripping can load it in scripts/test-dataset-cards.mjs. Mirrors
// lib/reports/cards.ts.

export type DatasetCategory = DatasetDef['category'];

// Every registry category must have a label here. toDatasetCard THROWS on a
// category with no label, so a new registry category with no matching entry
// fails loudly (test and build both) instead of silently dropping a dataset
// from the hub.
export const CATEGORY_LABELS: Record<DatasetCategory, string> = {
  signals: 'Signals',
  evidence: 'Evidence',
  'argument-graph': 'Argument graph',
  sources: 'Sources',
  research: 'Research',
  scout: 'Startup Scout',
  scan: 'External scan',
  intel: 'Company intel',
  tooling: 'Tooling Monitor',
  meta: 'Meta',
};

export interface DatasetCard {
  slug: string;
  title: string;
  description: string;
  category: DatasetCategory;
  categoryLabel: string;
  keyGated: boolean;
  heavy: boolean;
  columnCount: number;
  columnKeys: string[];
  formats: string[]; // 'CSV' / 'JSON'
  lensSlices: boolean;
  filters: string[]; // pushdown query-param names the download route accepts
  href: string;
  csvHref: string;
  jsonHref: string;
}

export function toDatasetCard(def: DatasetDef): DatasetCard {
  const categoryLabel = CATEGORY_LABELS[def.category];
  if (!categoryLabel) {
    throw new Error(`No category label for "${def.category}" (dataset "${def.slug}"); add one to CATEGORY_LABELS.`);
  }
  const filters = Object.entries(def.filters ?? {})
    .filter(([, on]) => on)
    .map(([key]) => key);
  return {
    slug: def.slug,
    title: def.title,
    description: def.description,
    category: def.category,
    categoryLabel,
    keyGated: !!def.keyGated,
    heavy: !!def.heavy,
    columnCount: def.columns.length,
    columnKeys: def.columns.map((c) => c.key),
    formats: def.formats.map((f) => f.toUpperCase()),
    lensSlices: !!def.filters?.lens,
    filters,
    href: `/datasets/${def.slug}`,
    csvHref: `/api/datasets/${def.slug}`,
    jsonHref: `/api/datasets/${def.slug}?format=json`,
  };
}

// ---------------------------------------------------------------- filters

export type DatasetAccessFilter = 'all' | 'public' | 'key';

export interface DatasetFilterState {
  q: string;
  access: DatasetAccessFilter;
  category: string; // '' = every category
}

// q matches title, description, slug, or a column key, case-insensitive
// substring. access splits on keyGated; category is an exact match.
export function filterCards(
  cards: DatasetCard[],
  { q, access, category }: DatasetFilterState
): DatasetCard[] {
  let out = cards;
  if (access === 'public') out = out.filter((c) => !c.keyGated);
  else if (access === 'key') out = out.filter((c) => c.keyGated);
  if (category) out = out.filter((c) => c.category === category);
  const term = q.trim().toLowerCase();
  if (term) {
    out = out.filter((c) => {
      const hay = [c.title, c.description, c.slug, ...c.columnKeys].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }
  return out;
}

// ---------------------------------------------------------------- count line

export function countLine(total: number, shown: number, publicCount: number, keyCount: number): string {
  if (shown === total) {
    return `${total} datasets · ${publicCount} public · ${keyCount} behind an access key`;
  }
  return `${shown} of ${total} datasets match`;
}
