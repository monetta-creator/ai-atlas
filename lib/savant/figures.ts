import { q } from '../db';
import { routedStructured } from '../model-route';
import { fetchLogoDataUris } from '../logo-fetch';
import type { SavantPack, SavantDepartment } from './types';
import { VOICE, deDash } from './write';
import {
  validateFigures, splitBlocks, domainOf, FIGURE_SECTIONS, MAX_FIGURES_PER_ISSUE, MAX_FIGURES_PER_SECTION,
  type SavantFigure, type FigureCatalogEntry,
} from './figures-core';

// The figure leg (2026-09-26): after the text is final, one structured call
// on the writer model reads every section and proposes the figures that
// would tell its story better than prose alone: an entity grid of the
// week's entrants, a two-axis placement of models, a web of actors around
// a regulation, a timeline of a fast week, a step flow. The catalog it may
// draw from is the pack's own records (label, href, favicon domain); the
// validator drops any figure naming an href the citation gate would not
// keep. Favicons for entity cards are baked once here as PNG data URIs so
// the PDF route makes no network calls (the intel deck's discipline).

const BANNED = /\b(bridge-claim|argument map|logic tree|confidence (?:level|score|number)s?|the claim that|this claim|claim \d)\b/i;

// Strict tool schemas compile to a grammar, and a union of six nested
// figure shapes was too large for the API ("The compiled grammar is too
// large"). The per-kind body therefore travels as a JSON string the
// validator parses; the shapes are spelled out in SPEC_SHAPES below.
const FIGURES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    figures: {
      type: 'array',
      description: `2 to ${MAX_FIGURES_PER_ISSUE} figures, at most ${MAX_FIGURES_PER_SECTION} per section; an empty array when nothing earns a figure`,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', description: 'entities | map | relation | timeline | compare | steps' },
          section: { type: 'string', description: FIGURE_SECTIONS.join(' | ') },
          after: { type: 'integer', description: 'the block number of the section the figure follows (blocks are numbered in the input); -1 puts it at the end' },
          title: { type: 'string', description: 'a short title, 4 to 10 words' },
          caption: { type: 'string', description: 'one sentence: the reading the figure supports' },
          spec_json: { type: 'string', description: 'the figure body as a JSON object string in the shape given for its kind' },
        },
        required: ['kind', 'section', 'after', 'title', 'caption', 'spec_json'],
      },
    },
  },
  required: ['figures'],
};

const SPEC_SHAPES =
  `spec_json shapes by kind (a JSON object, hrefs EXACTLY as in the catalog or "" for none):\n` +
  `entities: {"entities":[{"label":"","href":"","note":"one line","bullets":["up to 3, each under 60 characters"]}]} (2 to 6 cards)\n` +
  `map: {"x":{"label":"","low":"","high":""},"y":{"label":"","low":"","high":""},"points":[{"label":"","href":"","x":0.0,"y":0.0}]} (x and y between 0 and 1; 2 to 10 points)\n` +
  `relation: {"nodes":[{"id":"","label":"","href":"","group":"column name"}],"edges":[{"from":"id","to":"id","label":"1 to 4 words"}]} (3 to 12 nodes, 2 to 16 edges; groups become columns left to right in first-seen order)\n` +
  `timeline: {"events":[{"date":"YYYY-MM-DD","label":"","href":""}]} (3 to 8 events)\n` +
  `compare: {"unit":"","bars":[{"label":"","value":0,"href":""}]} (unit is a short suffix such as % or $B or per week; 2 to 8 bars; every value must appear in the section text and every href must be the record it came from)\n` +
  `steps: {"steps":[{"label":"","note":""}]} (3 to 6 steps left to right)`;

const FIGURES_SYSTEM =
  `You are Savant, choosing the figures for your weekly report after the text is final. A figure earns its place ` +
  `only when it tells the story better than the paragraph beside it: it should grab the reader and make one point ` +
  `visible at a glance. Kinds: "entities" is a card grid of named things with a favicon each (the week's new tools, ` +
  `the vendors that shipped, the companies in a story) with a one-line note and up to three bullets per card; "map" ` +
  `places entities on two labeled qualitative axes (for example open-weight to closed against cost per unit of ` +
  `capability), your own placement, which the figure labels as a reading; "relation" is a diagram of actors and ` +
  `what connects them (a regulator, the firms it reaches, the models in question), nodes grouped into columns with ` +
  `labeled edges; "timeline" orders the dated events of a fast-moving story; "compare" draws bars over numbers the ` +
  `text already states, each bar linked to the record it came from; "steps" is a left-to-right flow of a process. ` +
  `Every entity, point, node, event and bar that carries an href must use an EXACT href from the catalog; an entity ` +
  `absent from the catalog may appear with an empty href only in a map or relation, never in a compare. Never invent ` +
  `a number, an entity, or a date. Prefer two strong figures to five weak ones; a section can carry two at most. ` +
  `${VOICE}\n\n${SPEC_SHAPES}`;

export interface PlannedFigures { figures: SavantFigure[]; dropped: string[] }

// The catalog of things Savant may draw: every href the pack carries with a
// label and, where known, the favicon domain. Tooling hrefs resolve their
// vendor domain from the catalog table in one query.
async function buildCatalog(pack: SavantPack): Promise<Map<string, FigureCatalogEntry>> {
  const cat = new Map<string, FigureCatalogEntry>();
  const add = (href: string | null | undefined, label: string, domain: string | null = null) => {
    if (!href || cat.has(href)) return;
    cat.set(href, { href, label, domain: domain ?? domainOf(href) });
  };
  for (const t of pack.tools.entrants) add(t.href, t.name);
  for (const r of pack.tools.releases) { add(r.productHref, r.productName); add(r.url, r.title); }
  for (const r of pack.tools.reads) { add(r.url, r.title); add(r.catalogHref, r.title); }
  for (const p of pack.research) add(p.href, p.title);
  for (const s of pack.moved.signals) add(s.href ?? s.url, s.title, s.domain);
  for (const c of pack.moved.topClaims) add(c.href, c.statement.slice(0, 60));
  for (const r of pack.regulation) { add(r.href ?? r.url, r.title, r.domain); add(r.url, r.title, r.domain); }
  for (const a of pack.ahead) add(a.href ?? a.url, a.what);
  for (const m of pack.notebook.misses) add(m.url, m.headline);
  for (const tier of pack.peers.tiers) for (const row of tier.rows) for (const f of row.filings) add(f.href ?? f.url, `${row.name}: ${f.title}`, f.domain);
  const slugs = [...cat.keys()].map((h) => h.match(/^\/tooling\/([^/?#]+)$/)?.[1]).filter((s): s is string => Boolean(s));
  if (slugs.length) {
    const rows = await q<{ slug: string; vendor_domain: string | null; url: string | null }>(
      `select slug, vendor_domain, url from tooling_products where slug = any($1::text[])`, [slugs]
    ).catch(() => []);
    for (const r of rows) {
      const entry = cat.get(`/tooling/${r.slug}`);
      if (entry) entry.domain = r.vendor_domain ?? domainOf(r.url);
    }
  }
  return cat;
}

const plain = (html: string): string => deDash(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function sectionBlocks(key: string, title: string, html: string): string[] {
  const blocks = splitBlocks(html).map(plain).filter(Boolean);
  if (!blocks.length) return [];
  return [`SECTION ${key} (${title}):`, ...blocks.map((b, i) => `  [${i}] ${b.slice(0, 700)}`), ''];
}

export async function planFigures(
  pack: SavantPack,
  text: { leadTitle: string; leadHtml: string; departments: SavantDepartment[] },
  allowed: Set<string>,
  opts: { model: string; weekEnd: string; timeoutMs?: number }
): Promise<PlannedFigures> {
  const catalog = await buildCatalog(pack);
  const catalogLines = [...catalog.values()].filter((c) => allowed.has(c.href)).slice(0, 160)
    .map((c) => `- ${c.label.slice(0, 70)} :: ${c.href}${c.domain ? ` (${c.domain})` : ''}`);
  const user = [
    `WEEK ENDING ${pack.weekEnd}. The issue's text, by section and numbered block. Choose the figures.`,
    '',
    ...sectionBlocks('lead', text.leadTitle, text.leadHtml),
    ...text.departments.filter((d) => !d.empty).flatMap((d) => sectionBlocks(d.key, d.title, d.html)),
    'CATALOG (label :: href (favicon domain)); use hrefs exactly:',
    ...(catalogLines.length ? catalogLines : ['- none']),
  ].join('\n');
  const out = await routedStructured<{ figures: { spec_json?: unknown }[] }>({
    model: opts.model, system: FIGURES_SYSTEM, user,
    toolName: 'submit_figures', toolDescription: 'Return the figures for this issue.',
    schema: FIGURES_SCHEMA, maxTokens: 9000, timeoutMs: opts.timeoutMs ?? 120_000,
    feature: 'savant_figures', metadata: { week_end: opts.weekEnd, leg: 'figures' },
  });
  if (!out || !Array.isArray(out.figures)) throw new Error('the figure leg returned no parsable figures (truncated or malformed tool input)');
  const raw = out.figures.map((f) => {
    let body: Record<string, unknown> = {};
    if (typeof f.spec_json === 'string') {
      try { body = JSON.parse(f.spec_json) as Record<string, unknown>; } catch { body = {}; }
    }
    return { ...body, ...f, spec_json: undefined };
  });
  const { figures, dropped } = validateFigures(raw, allowed, catalog, BANNED);
  await bakeLogos(figures);
  return { figures, dropped };
}

// Entity cards carry their favicon as a data URI for the PDF; the web path
// fetches favicons live by domain and ignores the baked copy.
async function bakeLogos(figures: SavantFigure[]): Promise<void> {
  const targets: { domain: string; set: (uri: string | null) => void }[] = [];
  for (const f of figures) {
    if (f.kind !== 'entities') continue;
    for (const e of f.entities) if (e.domain) targets.push({ domain: e.domain, set: (uri) => { e.logo = uri; } });
  }
  if (!targets.length) return;
  const uris = await fetchLogoDataUris(targets.map((t) => t.domain));
  targets.forEach((t, i) => t.set(uris[i]));
}
