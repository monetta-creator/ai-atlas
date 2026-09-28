import { routedStructured } from '../model-route';
import { BANNED, SPEC_SHAPES, figuresSchema, unpackSpecs, bakeLogos } from '../savant/figures';
import { validateFigures, domainOf, type SavantFigure, type FigureCatalogEntry } from '../savant/figures-core';
import { checkCompares, textBySource, type LedgerRecord, type RenderedSection, type WebSource } from './core';

// The Full report's figure leg: Savant's figure vocabulary and validator,
// with this report's own section keys and a catalog of the sources the text
// actually cites (an Atlas record's title or a web page's title per href).
// A figure naming an href outside the citation allow-list is dropped whole.

const SYSTEM =
  `You are choosing the figures for a Field Report, a researched report on one question, after its text is final. ` +
  `A figure earns its place only when it makes one point visible at a glance better than the paragraph beside it: ` +
  `the models or firms in a comparison, a placement on two axes, the actors around a rule, a dated sequence, numbers ` +
  `the text states, a process. Kinds: "entities" (a card grid with a favicon each, a one-line note and up to three ` +
  `bullets), "map" (two labeled qualitative axes; your own placement, which the figure labels as a reading), ` +
  `"relation" (actors and what connects them, nodes grouped into columns, labeled edges), "timeline" (dated events), ` +
  `"compare" (bars over numbers the text already states, each bar linked to the source it came from), "steps" (a ` +
  `left-to-right flow). Every entity, point, node, event and bar that carries an href must use an EXACT href from ` +
  `the catalog; an entity absent from the catalog may appear with an empty href only in a map or relation, never in ` +
  `a compare, and every bar of a compare must come from ONE source href (numbers from different studies are not one measurement). Never invent a number, an entity or a date, and never compare numbers the text says measure different ` +
  `things. Prefer two strong figures to four weak ones; an empty list is a fine answer. Plain words for a banking ` +
  `executive; never use an em dash.\n\n${SPEC_SHAPES}`;

const plain = (html: string) => html.replace(/<a [^>]*>(\d+)<\/a>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export async function planFieldReportFigures(opts: {
  sections: RenderedSection[];
  allowed: Set<string>;
  records: LedgerRecord[];
  web: WebSource[];
  model: string;
  metadata: Record<string, unknown>;
}): Promise<{ figures: SavantFigure[]; dropped: string[] }> {
  const label = new Map<string, string>();
  for (const r of opts.records) label.set(r.href, r.title);
  for (const w of opts.web) label.set(w.url, w.title);
  // The catalog is what the text cites, in reading order.
  const catalog = new Map<string, FigureCatalogEntry>();
  for (const s of opts.sections) for (const b of s.blocks) {
    for (const m of b.html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (catalog.has(href) || !opts.allowed.has(href)) continue;
      catalog.set(href, { href, label: (label.get(href) ?? domainOf(href) ?? href).slice(0, 90), domain: domainOf(href) });
    }
  }
  const keys = opts.sections.map((s) => s.key);
  const user = [
    'The report, by section and numbered block. Choose the figures.',
    '',
    ...opts.sections.flatMap((s) => [
      `SECTION ${s.key} (${s.title}):`,
      ...s.blocks.map((b, i) => `  [${i}] ${plain(b.html).slice(0, 700)}`),
      '',
    ]),
    'CATALOG: each line is href=<the value to put in an href field> then name=<what it is>. Copy the href value exactly; never put a name in an href field.',
    ...(catalog.size ? [...catalog.values()].slice(0, 160).map((c) => `- href=${c.href} name=${c.label}`) : ['- none']),
  ].join('\n');
  const out = await routedStructured<{ figures: { spec_json?: unknown }[] }>({
    model: opts.model, system: SYSTEM, user,
    toolName: 'submit_figures', toolDescription: 'Return the figures for this report.',
    schema: figuresSchema(keys), maxTokens: 9000, timeoutMs: 150_000,
    feature: 'field_report_figures', metadata: { ...opts.metadata, leg: 'figures' },
  });
  if (!out || !Array.isArray(out.figures)) throw new Error('the figure leg returned no parsable figures');
  // The planner sometimes writes a source's name where its href belongs;
  // an exact name maps back to its href before validation.
  const byName = new Map([...catalog.values()].map((c) => [c.label.toLowerCase(), c.href] as const));
  const fixHrefs = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fixHrefs);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k,
      k === 'href' && typeof x === 'string' && !opts.allowed.has(x) ? (byName.get(x.trim().toLowerCase()) ?? x) : fixHrefs(x)]));
  };
  const checked = validateFigures(fixHrefs(unpackSpecs(out.figures)), opts.allowed, catalog, BANNED, keys);
  const { figures, dropped } = checkCompares(checked.figures, textBySource(opts.sections, plain));
  await bakeLogos(figures);
  return { figures, dropped: [...checked.dropped, ...dropped] };
}
