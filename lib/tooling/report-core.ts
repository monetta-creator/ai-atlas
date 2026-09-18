import type {
  ToolingProduct, ToolingProductRef, ToolingPack, ToolingLandscapePack, ToolingBriefPack,
  ToolingEntrantsPack, ToolingFeaturesPack, ToolingFeatureRow,
} from '../types';
import type { CitationAllowlist } from '../citations';

// The AI Tooling Monitor's report core: fit-band mapping, the ToolingProduct ->
// ToolingProductRef projection, the citation allowlist, the plain-text prompt
// serializer per pack kind, and the deterministic aggregates the model is
// handed as authoritative. DELIBERATELY dependency-light (type-only imports)
// so scripts/test-tooling-reports.mjs can load it under plain-Node type
// stripping, same discipline as lib/tooling/core.ts.

// A structurally-compatible slice of lib/data/tooling.ts's FeatureMatrix (kept
// local rather than imported, so this pure module carries no dependency on the
// engine's data layer): featureRows only needs the `features` rows.
export interface FeatureMatrixLike {
  features: { tag: string; count: number; products: string[] }[];
}

// ---- Fit band ---------------------------------------------------------------

export function fitBand(fit: number | null | undefined): 'strong' | 'solid' | 'marginal' | 'weak' | null {
  if (fit == null || !Number.isFinite(fit)) return null;
  if (fit >= 80) return 'strong';
  if (fit >= 60) return 'solid';
  if (fit >= 40) return 'marginal';
  return 'weak';
}

// ---- Product ref projection --------------------------------------------------

// A pack's product line: tag assigned by pack order (T1, T2, ...), category
// name resolved by the caller (tooling_products only carries the slug).
export function toProductRef(product: ToolingProduct, index: number, categoryName: string): ToolingProductRef {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    vendor: product.vendor ?? null,
    href: `/tooling/${product.slug}`,
    url: product.url ?? null,
    tag: `T${index + 1}`,
    one_liner: product.one_liner ?? null,
    category: product.category,
    category_name: categoryName,
    maturity: product.maturity,
    deployment: product.deployment ?? [],
    pricing_model: product.pricing_model ?? null,
    compliance_claims: product.compliance_claims ?? [],
    features: product.features ?? [],
    first_seen: product.first_seen,
    fit_band: fitBand(product.agent_fit ?? null),
  };
}

// ---- Citation allowlist -------------------------------------------------------

// Product hrefs tagged T<n>, their homepage urls, and (entrants only) event
// urls. Mirrors lib/research/roundup.ts's allowlistForRoundup shape.
export function allowlistForTooling(pack: ToolingPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const p of pack.products) {
    hrefs.add(p.href);
    tagByHref.set(p.href, p.tag);
    if (p.url) hrefs.add(p.url);
  }
  if (pack.kind === 'tooling_entrants') {
    for (const e of pack.events) if (e.url) hrefs.add(e.url);
  }
  return { hrefs, tagByHref };
}

// ---- Deterministic aggregates -------------------------------------------------

function clip(s: string | null | undefined, n: number): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n)} ...` : t;
}

interface Aggregates {
  byMaturity: Record<string, number>;
  byDeployment: Record<string, number>;
  byPricing: Record<string, number>;
  topFeatures: { tag: string; count: number }[];
}

function aggregateProducts(products: ToolingProductRef[]): Aggregates {
  const byMaturity: Record<string, number> = {};
  const byDeployment: Record<string, number> = {};
  const byPricing: Record<string, number> = {};
  const featureCounts = new Map<string, number>();
  for (const p of products) {
    byMaturity[p.maturity] = (byMaturity[p.maturity] ?? 0) + 1;
    for (const d of p.deployment) byDeployment[d] = (byDeployment[d] ?? 0) + 1;
    const pricing = p.pricing_model ?? 'unspecified';
    byPricing[pricing] = (byPricing[pricing] ?? 0) + 1;
    for (const f of p.features) featureCounts.set(f, (featureCounts.get(f) ?? 0) + 1);
  }
  const topFeatures = [...featureCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([tag, count]) => ({ tag, count }));
  return { byMaturity, byDeployment, byPricing, topFeatures };
}

// The category landscape pack's stats (also the fuller aggregate the brief
// pack's own briefStats below draws from, minus pricing).
export function landscapeStats(products: ToolingProductRef[]): ToolingLandscapePack['stats'] {
  const { byMaturity, byDeployment, byPricing, topFeatures } = aggregateProducts(products);
  return { products: products.length, byMaturity, byDeployment, byPricing, topFeatures };
}

// The build-vs-buy brief's stats: no pricing breakdown (the brief's narrative
// covers pricing per-product), plus the topUp flag when the market picture
// needed padding past the exact capability match.
export function briefStats(products: ToolingProductRef[], topUp: boolean): ToolingBriefPack['stats'] {
  const { byMaturity, byDeployment, topFeatures } = aggregateProducts(products);
  return { products: products.length, byMaturity, byDeployment, topFeatures, ...(topUp ? { topUp: true } : {}) };
}

// Project a feature matrix's rows onto the report shape: novel = carried by
// exactly one cataloged product.
export function featureRows(matrix: FeatureMatrixLike): ToolingFeatureRow[] {
  return matrix.features.map((f) => ({
    tag: f.tag,
    count: f.count,
    products: f.products,
    novel: f.products.length === 1,
  }));
}

// The entrants report's 7-day window ending on `weekDay` ('YYYY-MM-DD'),
// mirroring lib/research/roundup.ts's weekWindow.
export function entrantsWindow(weekDay: string): { from: string; to: string } {
  const end = new Date(`${weekDay}T00:00:00Z`);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  return { from: isoDay(start), to: weekDay };
}

// ---- Prompt serialization -----------------------------------------------------

function fmtProductLine(p: ToolingProductRef): string {
  const lines: string[] = [];
  lines.push(
    `- [${p.tag}](${p.href}) "${p.name}"${p.vendor ? ` by ${p.vendor}` : ''} · ${p.category_name} · ${p.maturity}` +
    `${p.pricing_model ? ` · pricing: ${p.pricing_model}` : ''}` +
    `${p.deployment.length ? ` · deployment: ${p.deployment.join(', ')}` : ''}` +
    `${p.fit_band ? ` · fit: ${p.fit_band}` : ''}`
  );
  if (p.one_liner) lines.push(`    ${clip(p.one_liner, 200)}`);
  if (p.features.length) lines.push(`    features: ${p.features.slice(0, 8).join(', ')}`);
  if (p.compliance_claims.length) lines.push(`    compliance: ${p.compliance_claims.join(', ')}`);
  return lines.join('\n');
}

function fmtCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(', ') : 'none';
}

function fmtLandscapePack(pack: ToolingLandscapePack): string {
  const lines: string[] = [];
  lines.push(`SUBJECT: the ${pack.category_name} category landscape, for a ${pack.audience} audience.`);
  if (pack.dimensions.length) lines.push(`Emphasize: ${pack.dimensions.join(', ')}.`);
  lines.push('');
  lines.push(`PRODUCTS (${pack.products.length}; cite with the exact tag and href):`);
  if (!pack.products.length) lines.push('- none cataloged yet.');
  else for (const p of pack.products) lines.push(fmtProductLine(p));
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  const s = pack.stats;
  lines.push(`- ${s.products} products cataloged.`);
  lines.push(`- Maturity: ${fmtCounts(s.byMaturity)}.`);
  lines.push(`- Deployment: ${fmtCounts(s.byDeployment)}.`);
  lines.push(`- Pricing: ${fmtCounts(s.byPricing)}.`);
  if (s.topFeatures.length) lines.push(`- Top features: ${s.topFeatures.map((f) => `${f.tag} (${f.count})`).join(', ')}.`);
  return lines.join('\n');
}

function fmtBriefPack(pack: ToolingBriefPack): string {
  const lines: string[] = [];
  lines.push(`SUBJECT: a build-or-buy brief for the capability "${pack.capability}"${pack.category ? ` (category: ${pack.category})` : ''}.`);
  lines.push('');
  lines.push(`PRODUCTS THAT MATCH (${pack.products.length}; cite with the exact tag and href):`);
  if (!pack.products.length) lines.push('- none found.');
  else for (const p of pack.products) lines.push(fmtProductLine(p));
  if (pack.internal.ourContext) {
    lines.push('');
    lines.push('INTERNAL CONTEXT (background from the requesting team; inform the recommendation, never quote it, never name the team):');
    lines.push(pack.internal.ourContext);
  }
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  const s = pack.stats;
  lines.push(
    `- ${s.products} products in the market picture` +
    `${s.topUp ? ' (topped up beyond the exact capability match to give a fuller market picture)' : ''}.`
  );
  lines.push(`- Maturity: ${fmtCounts(s.byMaturity)}.`);
  lines.push(`- Deployment: ${fmtCounts(s.byDeployment)}.`);
  if (s.topFeatures.length) lines.push(`- Top features: ${s.topFeatures.map((f) => `${f.tag} (${f.count})`).join(', ')}.`);
  return lines.join('\n');
}

function fmtEntrantsPack(pack: ToolingEntrantsPack): string {
  const lines: string[] = [];
  lines.push(`WEEKLY NEW ENTRANTS: ${pack.from} to ${pack.to}.`);
  if (pack.categories.length) lines.push(`Categories in scope: ${pack.categories.join(', ')}.`);
  lines.push('');
  lines.push(`NEW ENTRANTS (${pack.products.length}; cite with the exact tag and href):`);
  if (!pack.products.length) lines.push('- none this week.');
  else for (const p of pack.products) lines.push(fmtProductLine(p));
  if (pack.events.length) {
    lines.push('');
    lines.push(`MOVES ON TRACKED PRODUCTS (${pack.events.length}; cite the event url when present):`);
    for (const e of pack.events) {
      lines.push(`- ${e.product_name}: ${e.kind} "${clip(e.title, 160)}"${e.url ? ` (${e.url})` : ''} on ${e.date}`);
    }
  }
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  const s = pack.stats;
  lines.push(`- ${s.entrants} new entrants; ${s.deepDived} deep-dived; ${s.events} tracked-product move${s.events === 1 ? '' : 's'} this week.`);
  if (Object.keys(s.byCategory).length) lines.push(`- By category: ${fmtCounts(s.byCategory)}.`);
  return lines.join('\n');
}

function fmtFeaturesPack(pack: ToolingFeaturesPack): string {
  const lines: string[] = [];
  lines.push(`SUBJECT: the feature landscape of ${pack.category_name}${pack.focus ? `, focused on "${pack.focus}"` : ''}.`);
  lines.push('');
  lines.push(`PRODUCTS (${pack.products.length}; cite with the exact tag and href):`);
  if (!pack.products.length) lines.push('- none cataloged yet.');
  else for (const p of pack.products) lines.push(fmtProductLine(p));
  lines.push('');
  lines.push(`FEATURE MATRIX (${pack.features.length} tag${pack.features.length === 1 ? '' : 's'}; novel = carried by exactly one product):`);
  if (!pack.features.length) lines.push('- none recorded.');
  else for (const f of pack.features) lines.push(`- ${f.tag} (${f.count}${f.novel ? ', novel' : ''}): ${f.products.join(', ')}`);
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  const s = pack.stats;
  lines.push(`- ${s.products} products, ${s.features} feature tags, ${s.novel} novel (single-product) feature${s.novel === 1 ? '' : 's'}.`);
  return lines.join('\n');
}

// The plain-text prompt block the model is handed as its user turn, per pack
// kind, with an authoritative STATISTICS section (the fmtRoundupPack/
// fmtSheetPack pattern in lib/research/roundup.ts / lib/tearsheet/generate.ts).
export function fmtToolingPack(pack: ToolingPack): string {
  switch (pack.kind) {
    case 'tooling_landscape': return fmtLandscapePack(pack);
    case 'tooling_brief': return fmtBriefPack(pack);
    case 'tooling_entrants': return fmtEntrantsPack(pack);
    case 'tooling_features': return fmtFeaturesPack(pack);
  }
}
