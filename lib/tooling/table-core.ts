// The tooling table's pure projection + sort/filter core (/tooling/table).
// DELIBERATELY dependency-light like report-core.ts: no lib/db, so
// scripts/test-tooling-table.mjs can load it under plain Node type stripping.
// Runtime imports use explicit relative .ts extensions (the repo convention,
// see lib/cost.ts importing './db.ts') because Node's native TS stripping
// resolves modules literally; type-only imports stay extensionless.

import { fitBand } from './report-core.ts';
import { TOOLING_MATURITY_LABEL } from '../format.ts';
import { DEPLOYMENT_LABEL, PRICING_LABEL, TARGET_BUYER_LABEL, humanize } from '../../components/tooling/labels.ts';
import type { ToolingProduct, ToolingScores } from '../types';

export type SortDir = 'asc' | 'desc';
export type ColKind = 'text' | 'number' | 'date' | 'list';

export interface TableRow {
  id: string;
  slug: string;
  name: string;
  vendor: string | null;
  vendorDomain: string | null;
  url: string | null;
  category: string;
  categoryName: string;
  maturity: string;
  maturityLabel: string;
  deployment: string[];
  deploymentLabel: string;
  pricing: string | null;
  pricingLabel: string | null;
  targetBuyers: string[];
  compliance: string[];
  featureCount: number;
  features: string[];        // first 6, for the table cell
  allFeatures: string[];     // the full list, for the compare strip's feature union
  firstSeen: string;         // 'YYYY-MM-DD'
  pinned: boolean;
  fit: number | null;
  fitBand: string | null;
  scores: ToolingScores | null;
  oneLiner: string | null;
}

export interface TableColumn {
  key: string;
  label: string;
  kind: ColKind;
  portal?: boolean;
  defaultOn: boolean;
}

// Portal-only: fit + the five rubric dimensions (lib/data/tooling.ts's
// PRODUCT_PORTAL_COLUMNS convention; agent_fit/agent_scores are simply absent
// on a guest's row, so a guest ProductTable never even has data to show here).
export const TABLE_COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Name', kind: 'text', defaultOn: true },
  { key: 'vendor', label: 'Vendor', kind: 'text', defaultOn: true },
  { key: 'category', label: 'Category', kind: 'text', defaultOn: true },
  { key: 'maturity', label: 'Maturity', kind: 'text', defaultOn: true },
  { key: 'deployment', label: 'Deployment', kind: 'list', defaultOn: true },
  { key: 'pricing', label: 'Pricing', kind: 'text', defaultOn: true },
  { key: 'targetBuyers', label: 'Target buyers', kind: 'list', defaultOn: false },
  { key: 'compliance', label: 'Compliance', kind: 'list', defaultOn: false },
  { key: 'featureCount', label: 'Features', kind: 'number', defaultOn: true },
  { key: 'firstSeen', label: 'First seen', kind: 'date', defaultOn: true },
  { key: 'fit', label: 'Fit', kind: 'number', portal: true, defaultOn: true },
  { key: 'relevance', label: 'Relevance', kind: 'number', portal: true, defaultOn: false },
  { key: 'enterprise_readiness', label: 'Enterprise readiness', kind: 'number', portal: true, defaultOn: false },
  { key: 'differentiation', label: 'Differentiation', kind: 'number', portal: true, defaultOn: false },
  { key: 'momentum', label: 'Momentum', kind: 'number', portal: true, defaultOn: false },
  { key: 'build_difficulty', label: 'Build difficulty', kind: 'number', portal: true, defaultOn: false },
];

const SCORE_KEYS = new Set(['relevance', 'enterprise_readiness', 'differentiation', 'momentum', 'build_difficulty']);

// Project a ToolingProduct (already column-filtered by the caller's viewer,
// lib/data/tooling.ts's searchProducts) into a table row. categoryName is
// resolved by the caller from getToolingCategories, same as ProductCard's
// page-level categoryName map, because tooling_products only carries the slug.
export function toTableRow(product: ToolingProduct, categoryName: string): TableRow {
  const deployment = product.deployment ?? [];
  const targetBuyers = product.target_buyer ?? [];
  const compliance = product.compliance_claims ?? [];
  const features = product.features ?? [];
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    vendor: product.vendor ?? null,
    vendorDomain: product.vendor_domain ?? null,
    url: product.url ?? null,
    category: product.category,
    categoryName,
    maturity: product.maturity,
    maturityLabel: TOOLING_MATURITY_LABEL[product.maturity] ?? product.maturity,
    deployment,
    deploymentLabel: deployment.map((d) => DEPLOYMENT_LABEL[d] ?? d).join(' · '),
    pricing: product.pricing_model ?? null,
    pricingLabel: product.pricing_model ? (PRICING_LABEL[product.pricing_model] ?? product.pricing_model) : null,
    targetBuyers,
    compliance,
    featureCount: features.length,
    features: features.slice(0, 6),
    allFeatures: features,
    firstSeen: product.first_seen,
    pinned: Boolean(product.pinned),
    fit: product.agent_fit ?? null,
    fitBand: fitBand(product.agent_fit ?? null),
    scores: product.agent_scores ?? null,
    oneLiner: product.one_liner ?? null,
  };
}

// Humanized display strings for a row's list-valued facets, for the drawer
// and the free-text search (compliance/target buyers render nicer than their
// raw snake_case codes; features are free text and render verbatim).
export function targetBuyerLabels(row: TableRow): string[] {
  return row.targetBuyers.map((t) => TARGET_BUYER_LABEL[t] ?? humanize(t));
}
export function complianceLabels(row: TableRow): string[] {
  return row.compliance.map((c) => humanize(c));
}

// The value a column key reads off a row, for both sorting and search. The
// three score-dimension keys resolve through row.scores (null when the row
// carries no agent read, e.g. a guest's row never had scores in the first
// place).
export function cellValue(row: TableRow, key: string): string | number | string[] | null {
  switch (key) {
    case 'name': return row.name;
    case 'vendor': return row.vendor;
    case 'category': return row.categoryName;
    case 'maturity': return row.maturityLabel;
    case 'deployment': return row.deployment;
    case 'pricing': return row.pricingLabel;
    case 'targetBuyers': return row.targetBuyers;
    case 'compliance': return row.compliance;
    case 'featureCount': return row.featureCount;
    case 'firstSeen': return row.firstSeen;
    case 'fit': return row.fit;
    default:
      if (SCORE_KEYS.has(key)) return row.scores ? (row.scores[key as keyof ToolingScores] as number | undefined) ?? null : null;
      return null;
  }
}

function numCompare(na: number | null, nb: number | null, dir: SortDir): number {
  if (na == null && nb == null) return 0;
  if (na == null) return 1;   // nulls sort last regardless of direction
  if (nb == null) return -1;
  return dir === 'asc' ? na - nb : nb - na;
}

// Sort comparator for Array.prototype.sort: numbers numeric with nulls
// always last, dates by their 'YYYY-MM-DD' string (chronological order),
// lists by length then first item, everything else localeCompare.
export function compareRows(a: TableRow, b: TableRow, key: string, dir: SortDir): number {
  const col = TABLE_COLUMNS.find((c) => c.key === key);
  const kind = col?.kind ?? 'text';
  const va = cellValue(a, key);
  const vb = cellValue(b, key);

  if (kind === 'number') {
    const na = typeof va === 'number' ? va : null;
    const nb = typeof vb === 'number' ? vb : null;
    return numCompare(na, nb, dir);
  }

  if (kind === 'list') {
    const la = Array.isArray(va) ? va : [];
    const lb = Array.isArray(vb) ? vb : [];
    let cmp = la.length - lb.length;
    if (cmp === 0) cmp = (la[0] ?? '').localeCompare(lb[0] ?? '');
    return dir === 'asc' ? cmp : -cmp;
  }

  // date and text both compare as strings; dates are 'YYYY-MM-DD' so string
  // order is chronological order.
  const sa = va == null ? '' : String(va);
  const sb = vb == null ? '' : String(vb);
  const cmp = sa.localeCompare(sb);
  return dir === 'asc' ? cmp : -cmp;
}

// Free-text filter over a given set of column keys (the caller passes the
// currently-visible columns, DatasetExplorer's "filter what's on screen"
// convention) plus the row's one-liner, slug and url, which are always
// searchable even when hidden as columns.
export function rowMatches(row: TableRow, needle: string, keys: string[]): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  for (const key of keys) {
    const v = cellValue(row, key);
    const s = Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v);
    if (s.toLowerCase().includes(n)) return true;
  }
  if (row.oneLiner && row.oneLiner.toLowerCase().includes(n)) return true;
  if (row.slug.toLowerCase().includes(n)) return true;
  if (row.url && row.url.toLowerCase().includes(n)) return true;
  return false;
}
