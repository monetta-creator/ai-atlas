import { marked } from 'marked';
import { runStructured } from '../dossier';
import { enforceCitations } from '../citations';
import { SHEET_SECTION_TITLES } from '../format';
import { q } from '../db';
import { searchProducts, getNewEntrants, getFeatureMatrix, getToolingCategories, getToolingReportForWeek } from '../data';
import { saveGeneratedReport, setToolingRunReport } from '../mutations';
import {
  toProductRef, allowlistForTooling, fmtToolingPack, landscapeStats, briefStats, featureRows, entrantsWindow,
} from './report-core';
import type {
  ToolingPack, ToolingLandscapePack, ToolingBriefPack, ToolingEntrantsPack, ToolingFeaturesPack,
  ToolingEventRef, ToolingViewer, ToolingCategory, SheetNarrative,
} from '../types';

// The AI Tooling Monitor's report library (Work Package 2): four generated-
// report kinds over the tooling catalog (category landscape, build-vs-buy
// brief, weekly new entrants, feature-steal sheet), narrated by the same
// two-decomposed-runStructured-legs machine as lib/research/roundup.ts and
// lib/tearsheet/generate.ts: the model narrates ONLY over a frozen, guest-safe
// pack, every statistic is computed in code, and every returned section
// passes the deterministic citation gate before it leaves the server.
//
// Only the weekly new-entrants runner (runWeeklyEntrantsReport) lives here as
// a full orchestrator, since it is the one cron-driven, auto-saving kind (the
// second auto-publishing report kind after the roundup). The other three
// kinds are built and saved through the portal/admin report console's step
// actions (a later work package), which call buildToolingPack /
// generateToolingSections / generateToolingClose / gateToolingNarrative
// directly, mirroring the tear-sheet console's pack -> sections -> close ->
// save decomposition.

// ---------------------------------------------------------------- params

export const TOOLING_REPORT_KINDS = [
  'tooling_landscape', 'tooling_brief', 'tooling_entrants', 'tooling_features',
] as const;
export type ToolingReportKind = typeof TOOLING_REPORT_KINDS[number];

export interface ToolingLandscapeParams {
  category: string;
  dimensions: string[];
  audience: ToolingLandscapePack['audience'];
}

export interface ToolingBriefParams {
  capability: string;
  ourContext: string | null;
  category: string | null;
}

export interface ToolingEntrantsParams {
  from: string;
  to: string;
  categories: string[];
}

export interface ToolingFeaturesParams {
  category: string;
  focus: string | null;
}

export type ToolingReportParams =
  | ToolingLandscapeParams | ToolingBriefParams | ToolingEntrantsParams | ToolingFeaturesParams;

// ---------------------------------------------------------------- validation

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIMENSIONS = new Set(['deployment', 'pricing', 'maturity', 'compliance', 'buyer', 'integrations']);
const AUDIENCES = new Set(['executive', 'engineering', 'procurement']);

async function requireCategory(slug: string): Promise<ToolingCategory> {
  const categories = await getToolingCategories(false);
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) throw new Error(`Unknown tooling category: ${slug}`);
  return cat;
}

function validateDimensions(list: string[]): string[] {
  const arr = Array.isArray(list) ? list : [];
  return [...new Set(arr.filter((d) => DIMENSIONS.has(d)))];
}

function validateAudience(a: string): ToolingLandscapePack['audience'] {
  return (AUDIENCES.has(a) ? a : 'executive') as ToolingLandscapePack['audience'];
}

function validateCapability(s: string): string {
  const t = String(s ?? '').trim();
  if (t.length < 3 || t.length > 300) throw new Error('Capability must be between 3 and 300 characters.');
  return t;
}

function validateOurContext(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (t.length > 2000) throw new Error('Internal context must be 2000 characters or fewer.');
  return t;
}

function validateFocus(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  return t ? t.slice(0, 300) : null;
}

function validateDate(s: string, label: string): string {
  if (!DATE_RE.test(String(s ?? ''))) throw new Error(`Bad ${label} date; expected YYYY-MM-DD.`);
  return s;
}

// ---------------------------------------------------------------- pack builders

async function buildLandscapePack(params: ToolingLandscapeParams, viewer: ToolingViewer): Promise<ToolingLandscapePack> {
  const cat = await requireCategory(params.category);
  const dimensions = validateDimensions(params.dimensions);
  const audience = validateAudience(params.audience);
  const rows = await searchProducts({ category: cat.slug, statuses: ['cataloged'], viewer, limit: 60 });
  const products = rows.map((p, i) => toProductRef(p, i, cat.name));
  return {
    kind: 'tooling_landscape',
    category: cat.slug,
    category_name: cat.name,
    dimensions,
    audience,
    products,
    stats: landscapeStats(products),
    builtAt: new Date().toISOString(),
  };
}

async function buildBriefPack(params: ToolingBriefParams, viewer: ToolingViewer): Promise<ToolingBriefPack> {
  const capability = validateCapability(params.capability);
  const ourContext = validateOurContext(params.ourContext);
  const category = params.category ? await requireCategory(params.category) : null;

  const rows = await searchProducts({
    q: capability, category: category?.slug ?? null, statuses: ['cataloged'], viewer, limit: 25,
  });
  let topUp = false;
  if (rows.length < 3) {
    topUp = true;
    const have = new Set(rows.map((r) => r.id));
    const extra = await searchProducts({ category: category?.slug ?? null, statuses: ['cataloged'], viewer, limit: 25 });
    for (const r of extra) {
      if (rows.length >= 25) break;
      if (!have.has(r.id)) { rows.push(r); have.add(r.id); }
    }
  }

  const categories = await getToolingCategories(false);
  const nameOf = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;
  const products = rows.map((p, i) => toProductRef(p, i, nameOf(p.category)));

  return {
    kind: 'tooling_brief',
    capability,
    category: category?.slug ?? null,
    products,
    internal: { ourContext },
    stats: briefStats(products, topUp),
    builtAt: new Date().toISOString(),
  };
}

// The local SQL read the spec calls for: events on cataloged products in the
// entrants window, joined to their product's slug/name. Lives here (not
// lib/data/tooling.ts) since this is WP2's own extra read.
async function getEntrantEventsInWindow(from: string, to: string): Promise<ToolingEventRef[]> {
  return q<ToolingEventRef>(
    `select p.slug as product_slug, p.name as product_name,
            to_char(e.event_date, 'YYYY-MM-DD') as date, e.kind::text as kind, e.title, e.url
       from tooling_events e
       join tooling_products p on p.id = e.product_id
      where p.status = 'cataloged'
        and e.event_date >= $1::date and e.event_date <= $2::date
      order by e.event_date desc, e.created_at desc
      limit 40`,
    [from, to]
  );
}

async function buildEntrantsPack(params: ToolingEntrantsParams, viewer: ToolingViewer): Promise<ToolingEntrantsPack> {
  const from = validateDate(params.from, 'from');
  const to = validateDate(params.to, 'to');
  const known = new Set((await getToolingCategories(false)).map((c) => c.slug));
  const categories = (Array.isArray(params.categories) ? params.categories : []).filter((c) => known.has(c));

  const allEntrants = await getNewEntrants(from, viewer, { untilISO: to, limit: 60 });
  const filtered = categories.length ? allEntrants.filter((p) => categories.includes(p.category)) : allEntrants;

  const categoryRows = await getToolingCategories(false);
  const nameOf = (slug: string) => categoryRows.find((c) => c.slug === slug)?.name ?? slug;
  const products = filtered.map((p, i) => toProductRef(p, i, nameOf(p.category)));

  const events = await getEntrantEventsInWindow(from, to);

  const byCategory: Record<string, number> = {};
  for (const p of products) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
  const deepDived = filtered.filter((p) => p.deep_dive != null).length;

  return {
    kind: 'tooling_entrants',
    from,
    to,
    categories,
    products,
    events,
    stats: { entrants: products.length, byCategory, deepDived, events: events.length },
    builtAt: new Date().toISOString(),
  };
}

async function buildFeaturesPack(params: ToolingFeaturesParams, viewer: ToolingViewer): Promise<ToolingFeaturesPack> {
  const cat = await requireCategory(params.category);
  const focus = validateFocus(params.focus);
  const matrix = await getFeatureMatrix(cat.slug);
  const rows = await searchProducts({ category: cat.slug, statuses: ['cataloged'], viewer, limit: 100 });
  const products = rows.map((p, i) => toProductRef(p, i, cat.name));
  const features = featureRows(matrix);
  return {
    kind: 'tooling_features',
    category: cat.slug,
    category_name: cat.name,
    focus,
    products,
    features,
    stats: { products: products.length, features: features.length, novel: features.filter((f) => f.novel).length },
    builtAt: new Date().toISOString(),
  };
}

export async function buildToolingPack(
  kind: 'tooling_landscape', params: ToolingLandscapeParams, viewer: ToolingViewer
): Promise<ToolingLandscapePack>;
export async function buildToolingPack(
  kind: 'tooling_brief', params: ToolingBriefParams, viewer: ToolingViewer
): Promise<ToolingBriefPack>;
export async function buildToolingPack(
  kind: 'tooling_entrants', params: ToolingEntrantsParams, viewer: ToolingViewer
): Promise<ToolingEntrantsPack>;
export async function buildToolingPack(
  kind: 'tooling_features', params: ToolingFeaturesParams, viewer: ToolingViewer
): Promise<ToolingFeaturesPack>;
export async function buildToolingPack(
  kind: ToolingReportKind, params: ToolingReportParams, viewer: ToolingViewer
): Promise<ToolingPack> {
  switch (kind) {
    case 'tooling_landscape': return buildLandscapePack(params as ToolingLandscapeParams, viewer);
    case 'tooling_brief': return buildBriefPack(params as ToolingBriefParams, viewer);
    case 'tooling_entrants': return buildEntrantsPack(params as ToolingEntrantsParams, viewer);
    case 'tooling_features': return buildFeaturesPack(params as ToolingFeaturesParams, viewer);
    default: throw new Error(`Unknown tooling report kind: ${String(kind)}`);
  }
}

// ---------------------------------------------------------------- narrative

// Belt-and-braces on the writing rule, same as lib/research/roundup.ts.
const deDash = (md: string) => md.replace(/\s*—\s*/g, ', ');

const toHtml = (md: string): string => {
  const clean = deDash(md).trim();
  if (!clean) return '';
  const html = marked.parse(clean, { async: false }) as string;
  return html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');
};

function appendSteering(text: string, steering: string | null): string {
  const t = (steering ?? '').trim();
  if (!t) return text;
  return `${text}\n\nSTEERING NOTE from the requester (their current priorities, follow it):\n${t.slice(0, 1500)}`;
}

const VOICE =
  `You are writing a tooling-market report for The AI Atlas AI Tooling Monitor, read by a corporate ` +
  `strategy team evaluating AI vendors for a large regulated organization. You receive a frozen ` +
  `product pack: cataloged AI tools with their category, maturity, deployment, pricing, features, ` +
  `and computed statistics. Write ONLY from this pack. The voice is a market analyst briefing an ` +
  `internal buyer: confident where the pack is thick, explicit where it is thin, never falsely ` +
  `confident. No fluff, no generic AI-industry prose: every sentence carries a fact from the pack or ` +
  `a judgment grounded in one. Never invent a product, vendor, feature, number, or URL; the ` +
  `STATISTICS block is authoritative, use its exact figures. Cite every specific product inline as a ` +
  `markdown link on its tag using the EXACT href provided, e.g. [T3](/tooling/some-product); never a ` +
  `bare name alone. Do not link to anything outside the pack. Tight paragraphs, bullets where they ` +
  `help. Output GitHub-flavored MARKDOWN. Do not begin with a heading. Never use an em dash in your ` +
  `output; use a comma, a colon, or separate sentences instead.`;

const BRIEF_INTERNAL_NOTE =
  ` The pack may include an INTERNAL CONTEXT block: background from the team requesting this brief. ` +
  `Use it to inform your build-or-buy judgment, but never quote it verbatim and never attribute it ` +
  `to the requesting team; the published brief must read as independent market analysis.`;

const SECTION_BRIEFS: Record<ToolingPack['kind'], string> = {
  tooling_landscape:
    `"reading", titled "${SHEET_SECTION_TITLES.tooling_landscape.reading}" by the app: what the category ` +
    `looks like right now, the products that matter and how they differ, weaving in the strongest ` +
    `examples with citations, 200 to 320 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.tooling_landscape.connections}" by the app: where the ` +
    `category is thin, undifferentiated, or overserved, 120 to 220 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.tooling_landscape.watch}" by the app: what would change the ` +
    `picture, entrants or moves worth watching, 100 to 180 words.`,
  tooling_brief:
    `"reading", titled "${SHEET_SECTION_TITLES.tooling_brief.reading}" by the app: what the market offers ` +
    `for this capability, the strongest matching products with citations, 200 to 320 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.tooling_brief.connections}" by the app: a build-or-buy ` +
    `recommendation, synthesized rather than listed, 140 to 240 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.tooling_brief.watch}" by the app: the risks of buying, the ` +
    `risks of building, and the next step, 100 to 180 words.`,
  tooling_entrants:
    `"reading", titled "${SHEET_SECTION_TITLES.tooling_entrants.reading}" by the app: the week's new ` +
    `entrants and what they signal, weaving the notable ones with citations, 180 to 300 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.tooling_entrants.connections}" by the app: the moves on ` +
    `already-tracked products this week, synthesized, 120 to 220 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.tooling_entrants.watch}" by the app: what to watch next week, ` +
    `80 to 150 words.`,
  tooling_features:
    `"reading", titled "${SHEET_SECTION_TITLES.tooling_features.reading}" by the app: the features worth ` +
    `stealing across the category, citing the products that carry them, 200 to 320 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.tooling_features.connections}" by the app: who does ` +
    `what, the feature map across the field, synthesized rather than listed, 120 to 220 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.tooling_features.watch}" by the app: novel features worth ` +
    `tracking and gaps in the field, 100 to 180 words.`,
};

const SECTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reading: { type: 'string' },
    connections: { type: 'string' },
    watch: { type: 'string' },
  },
  required: ['reading', 'connections', 'watch'],
};

export interface ToolingSectionsOut {
  readingMd: string;
  connectionsMd: string;
  watchMd: string;
  readingHtml: string;
  connectionsHtml: string;
  watchHtml: string;
  dropped: string[];
}

// opts.feature overrides the cost-log feature slug (default
// 'tooling_report_sections'): the /tooling/reports console's actions pass
// 'portal_tooling' for a non-admin keyholder's turn, so the portal daily
// budget's feature-filtered sum actually counts it; opts.metadata carries the
// keyholder's portal_key_id for the per-key sum.
export async function generateToolingSections(
  pack: ToolingPack, steering: string | null, opts?: { feature?: string; metadata?: Record<string, unknown> }
): Promise<ToolingSectionsOut> {
  const voice = pack.kind === 'tooling_brief' ? `${VOICE}${BRIEF_INTERNAL_NOTE}` : VOICE;
  const out = await runStructured<{ reading?: string; connections?: string; watch?: string }>({
    system: `${voice} Produce the three body sections of the report. ${SECTION_BRIEFS[pack.kind]} All three are markdown bodies only, no headings.`,
    user: appendSteering(fmtToolingPack(pack), steering),
    toolName: 'submit_tooling_sections',
    toolDescription: 'Return the three markdown body sections of the tooling report.',
    schema: SECTIONS_SCHEMA,
    maxTokens: 2000,
    effort: 'medium',
    feature: opts?.feature ?? 'tooling_report_sections',
    metadata: { ...opts?.metadata, kind: pack.kind },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const readingMd = String(out.reading ?? '');
  const connectionsMd = String(out.connections ?? '');
  const watchMd = String(out.watch ?? '');
  const allow = allowlistForTooling(pack);
  const reading = enforceCitations(toHtml(readingMd), allow);
  const connections = enforceCitations(toHtml(connectionsMd), allow);
  const watch = enforceCitations(toHtml(watchMd), allow);
  return {
    readingMd,
    connectionsMd,
    watchMd,
    readingHtml: reading.html ?? '',
    connectionsHtml: connections.html ?? '',
    watchHtml: watch.html ?? '',
    dropped: [...new Set([...reading.dropped, ...connections.dropped, ...watch.dropped])].sort(),
  };
}

function fallbackTitle(pack: ToolingPack): string {
  switch (pack.kind) {
    case 'tooling_landscape': return `${pack.category_name}: the field`;
    case 'tooling_brief': return `Build or buy: ${pack.capability}`;
    case 'tooling_entrants': return `New AI tools, week of ${pack.to}`;
    case 'tooling_features': return `${pack.category_name}: features worth stealing`;
  }
}

const CLOSE_SYSTEM =
  `${VOICE} You receive the pack plus the three already-written body sections. Produce "bottom_line": ` +
  `a single standalone paragraph of roughly 60 to 120 words that begins with "**Bottom line:**" ` +
  `(bold) and gives the reader's takeaway: what this report establishes and the single most ` +
  `important thing to do or watch next. Synthesize across the sections, do not repeat them. Also ` +
  `produce "report_title": a short editorial title for the report, at most 10 words, plain text, no ` +
  `quotes, and do not include the words "AI Atlas".`;

const CLOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { bottom_line: { type: 'string' }, report_title: { type: 'string' } },
  required: ['bottom_line', 'report_title'],
};

// Same opts.feature override as generateToolingSections, for the close leg.
export async function generateToolingClose(
  pack: ToolingPack,
  sections: { readingMd: string; connectionsMd: string; watchMd: string },
  opts?: { feature?: string; metadata?: Record<string, unknown> }
): Promise<{ bottomLineHtml: string; title: string; dropped: string[] }> {
  const titles = SHEET_SECTION_TITLES[pack.kind];
  const system = pack.kind === 'tooling_brief' ? `${CLOSE_SYSTEM}${BRIEF_INTERNAL_NOTE}` : CLOSE_SYSTEM;
  const user = [
    fmtToolingPack(pack),
    '',
    `SECTION: ${titles.reading} (already written):`,
    sections.readingMd,
    '',
    `SECTION: ${titles.connections} (already written):`,
    sections.connectionsMd,
    '',
    `SECTION: ${titles.watch} (already written):`,
    sections.watchMd,
  ].join('\n');
  const out = await runStructured<{ bottom_line?: string; report_title?: string }>({
    system,
    user,
    toolName: 'submit_tooling_close',
    toolDescription: 'Return the bottom-line paragraph and an editorial title for the tooling report.',
    schema: CLOSE_SCHEMA,
    maxTokens: 700,
    effort: 'medium',
    feature: opts?.feature ?? 'tooling_report_close',
    metadata: { ...opts?.metadata, kind: pack.kind },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const gated = enforceCitations(toHtml(String(out.bottom_line ?? '')), allowlistForTooling(pack));
  return {
    bottomLineHtml: gated.html ?? '',
    title: deDash(String(out.report_title ?? '')).trim().slice(0, 120) || fallbackTitle(pack),
    dropped: gated.dropped,
  };
}

// Re-gate all four narrative slots against the pack (the save + render
// boundaries; generation already gates before returning). Deterministic.
export function gateToolingNarrative(
  n: { reading: string | null; connections: string | null; watch: string | null; bottomLine: string | null },
  pack: ToolingPack
): SheetNarrative {
  const allow = allowlistForTooling(pack);
  const reading = enforceCitations(n.reading, allow);
  const connections = enforceCitations(n.connections, allow);
  const watch = enforceCitations(n.watch, allow);
  const bottomLine = enforceCitations(n.bottomLine, allow);
  return {
    reading: reading.html,
    connections: connections.html,
    watch: watch.html,
    bottomLine: bottomLine.html,
    citedTags: [...new Set([...reading.cited, ...connections.cited, ...watch.cited, ...bottomLine.cited])].sort(),
    dropped: [...new Set([...reading.dropped, ...connections.dropped, ...watch.dropped, ...bottomLine.dropped])].sort(),
  };
}

// ---------------------------------------------------------------- weekly entrants runner

// The one cron-driven, auto-saving report kind: the second auto-publishing
// kind after the roundup (Kevin's 2026-09-17 decision, gated by the caller's
// autoPublish, which the engine resolves from tooling_prefs.auto_publish_entrants).
// Idempotent on (kind='tooling_entrants', scope_to=weekTo); errors propagate to
// the caller (the engine's step wraps this, same discipline as runWeeklyRoundup).
export async function runWeeklyEntrantsReport(
  runId: string,
  weekFrom: string,
  weekTo: string,
  autoPublish: boolean
): Promise<{ reportId: string } | { skipped: string }> {
  const existing = await getToolingReportForWeek('tooling_entrants', weekTo);
  if (existing) return { skipped: `already complete for the week ending ${weekTo}` };

  const pack = await buildToolingPack(
    'tooling_entrants',
    { from: weekFrom, to: weekTo, categories: [] },
    { admin: true, portal: true }
  );
  if (pack.products.length === 0) return { skipped: 'no new entrants this week' };

  const sections = await generateToolingSections(pack, null);
  const close = await generateToolingClose(pack, sections);
  const narrative = gateToolingNarrative(
    {
      reading: sections.readingHtml,
      connections: sections.connectionsHtml,
      watch: sections.watchHtml,
      bottomLine: close.bottomLineHtml,
    },
    pack
  );

  const reportId = await saveGeneratedReport({
    kind: 'tooling_entrants',
    subject: 'week',
    title: close.title,
    scope_from: weekFrom,
    scope_to: weekTo,
    pack,
    narrative,
    generated_at: pack.builtAt,
    isPublished: autoPublish,
  });
  await setToolingRunReport(runId, reportId);
  return { reportId };
}

// entrantsWindow is re-exported for callers that only have a single
// week-ending day (the console's report builder, the engine's default window).
export { entrantsWindow };
