// show_view: the first generative views (redo Phase 4). The model picks a view
// kind and a QUERY (the same params as the source tool); the server runs the
// source tool's own query, mints citation tags, and hands the rows to the
// client through ctx.view. The model never types a value into a view and gets
// back only a short text note with the first rows, so it can write about them.
import { citeToken } from '../ask/deep';
import { metricsTool, queryMetrics, type MetricRow } from './metrics';
import { queryTooling, toolingTool } from './tooling';
import { queryItems, searchItemsTool } from './search_items';
import { queryTimeline, timelineTool } from './timeline';
import { isObj, snip } from './reach-shared';
import { ymd } from './util-b';
import type { AtlasTool, AtlasView, ToolContext } from './types';

const MAX_ROWS = 60;
const NOTE_ROWS = 12;

type Kind = AtlasView['kind'];
type Source = 'metrics' | 'tooling' | 'items' | 'timeline';
const KINDS: Kind[] = ['table', 'timeline', 'chart'];
const SOURCES: Source[] = ['metrics', 'tooling', 'items', 'timeline'];

// Which params each source accepts (mirrors the source tool's own inputs).
const PARAMS: Record<Source, string[]> = {
  metrics: ['company', 'series', 'from', 'to'],
  tooling: ['query', 'category'],
  items: ['query', 'since', 'until', 'company', 'topic'],
  timeline: ['topic', 'from', 'to'],
};

export interface ShowViewInput {
  kind: Kind;
  source: Source;
  // Validated by the source tool's own parser; limit is set in run.
  parsed: Record<string, unknown>;
}

type Row = Record<string, string | number | null>;

export const showViewTool: AtlasTool<ShowViewInput> = {
  name: 'show_view',
  description:
    'Show the reader a table, timeline, or chart built from a query the server runs against the Atlas. You choose the view and the query, never the numbers: the server fills the rows and attaches each row\'s citation. Use when an answer has three or more comparable items, dates, or numbers. Sources: "metrics" (params company, series, from, to; table or chart; a chart plots one series over its periods), "tooling" (params query, category; table), "items" (params query, since, until, company, topic; table or timeline), "timeline" (params topic, from, to; timeline or table). The reader sees the view; refer to it in prose and never retype its numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: KINDS, description: 'table, timeline, or chart. chart works only with source metrics; timeline only with source timeline or items.' },
      source: { type: 'string', enum: SOURCES, description: 'Which collection to query.' },
      params: {
        type: 'object',
        description: 'The query, using only the params listed for the chosen source. company is a tracked-company slug; dates are YYYY-MM-DD.',
        properties: {
          company: { type: 'string', description: 'Tracked-company slug (metrics, items).' },
          series: { type: 'string', description: 'Metric name fragment (metrics), for example "deposits".' },
          from: { type: 'string', description: 'Earliest date, YYYY-MM-DD (metrics, timeline).' },
          to: { type: 'string', description: 'Latest date, YYYY-MM-DD (metrics, timeline).' },
          query: { type: 'string', description: 'Search words (tooling, items).' },
          category: { type: 'string', description: 'Category name (tooling).' },
          since: { type: 'string', description: 'Earliest publish date, YYYY-MM-DD (items).' },
          until: { type: 'string', description: 'Latest publish date, YYYY-MM-DD (items).' },
          topic: { type: 'string', description: 'Topic words (timeline) or scan topic slug (items).' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    required: ['kind', 'source', 'params'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    if (!isObj(input)) return 'Input must be an object.';
    const kind = input.kind as Kind;
    const source = input.source as Source;
    if (!KINDS.includes(kind)) return 'kind must be table, timeline, or chart.';
    if (!SOURCES.includes(source)) return 'source must be metrics, tooling, items, or timeline.';
    if (kind === 'chart' && source !== 'metrics') return 'A chart is only available for source metrics. Use a table or timeline for this source.';
    if (kind === 'timeline' && source !== 'timeline' && source !== 'items') return 'A timeline view is only available for source timeline or items.';
    if (input.params !== undefined && !isObj(input.params)) return 'params must be an object.';
    const raw = (input.params ?? {}) as Record<string, unknown>;
    const extra = Object.keys(raw).filter((k) => !PARAMS[source].includes(k));
    if (extra.length) return `Source ${source} does not take ${extra.join(', ')}. It takes: ${PARAMS[source].join(', ')}.`;
    const delegate = { metrics: metricsTool, tooling: toolingTool, items: searchItemsTool, timeline: timelineTool }[source];
    // The source tool's parser validates formats; limits are set again in run.
    const parsed = delegate.parse(raw);
    if (typeof parsed === 'string') return parsed;
    return { kind, source, parsed: parsed as unknown as Record<string, unknown> };
  },
  async run(p, ctx) {
    ctx.status?.(`Building a ${p.kind} from ${p.source}`);
    const built = await build(p, ctx);
    if (typeof built === 'string') return { text: built };
    const view = built.view;
    view.rows = view.rows.slice(0, MAX_ROWS);
    ctx.view?.(view);
    const lines = built.noteLines.slice(0, NOTE_ROWS);
    const more = view.rows.length > lines.length ? ` (first ${lines.length} listed here)` : '';
    return {
      text: `Shown to the reader: a ${view.kind} of ${view.rows.length} row${view.rows.length === 1 ? '' : 's'}, "${view.title}"${more}. The reader sees every row with its citation; discuss it in prose and do not retype the figures.${view.note ? ` ${view.note}` : ''}\n${lines.join('\n')}`,
    };
  },
};

interface Built { view: AtlasView; noteLines: string[] }

async function build(p: ShowViewInput, ctx: ToolContext): Promise<Built | string> {
  const admin = ctx.identity.kind === 'admin';
  const a = p.parsed as never;
  if (p.source === 'metrics') {
    const input = { ...(a as object), limit: MAX_ROWS } as Parameters<typeof queryMetrics>[0];
    const rows = await queryMetrics(input);
    if (!rows.length) return `No metric rows for ${input.company}${input.series ? ` matching "${input.series}"` : ''} in that range. Try the metrics tool to see which series exist.`;
    return p.kind === 'chart' ? metricsChart(input.company, rows) : metricsTable(input.company, rows);
  }
  if (p.source === 'tooling') {
    const input = { ...(a as object), limit: MAX_ROWS } as Parameters<typeof queryTooling>[0];
    const rows = await queryTooling(input, admin);
    if (!rows) return 'Give at least one search word.';
    if (!rows.length) return `No tooling products match "${input.query}".`;
    // Only public catalog columns: no agent, review, or status fields for anyone.
    const out: Row[] = rows.map((r) => ({
      name: snip(r.name, 80),
      vendor: r.vendor ? snip(r.vendor, 60) : null,
      category: r.category ? snip(r.category, 60) : null,
      pricing: r.pricing_model ? snip(r.pricing_model, 60) : null,
      last_seen: ymd(r.last_seen),
      cite: `[tool ${r.slug}]`,
    }));
    return {
      view: {
        kind: 'table', title: `Tooling matching "${snip(input.query, 50)}"`,
        columns: [
          { key: 'name', label: 'Product', type: 'text' }, { key: 'vendor', label: 'Vendor', type: 'text' },
          { key: 'category', label: 'Category', type: 'text' }, { key: 'pricing', label: 'Pricing', type: 'text' },
          { key: 'last_seen', label: 'Last seen', type: 'date' },
        ],
        rows: out, cite: 'cite',
      },
      noteLines: out.map((r) => `${r.cite} ${r.name} (${[r.vendor, r.category, r.pricing].filter(Boolean).join('; ')})`),
    };
  }
  if (p.source === 'items') {
    const input = { ...(a as object), limit: MAX_ROWS } as Parameters<typeof queryItems>[0];
    const items = await queryItems(input);
    if (!items.length) return 'No items matched those filters.';
    const out: Row[] = items.map((r) => ({
      date: r.published_date,
      title: snip(r.headline ?? 'Untitled', 160),
      where: [r.kind === 'intel' ? `company ${r.label ?? '?'}` : r.label ? `topic ${r.label}` : 'scan', r.source_domain].filter(Boolean).join(', '),
      cite: citeToken('item', ctx.tagger.itemTagFor(`${r.kind}:${r.id}`)),
    }));
    const title = `News items${input.query ? ` for "${snip(input.query, 50)}"` : ''}`;
    const noteLines = out.map((r) => `${r.cite} ${r.date ?? ''} ${r.title} (${r.where})`);
    const view: AtlasView = p.kind === 'timeline'
      ? { kind: 'timeline', title, rows: out.slice().sort((x, y) => String(x.date ?? '').localeCompare(String(y.date ?? ''))), cite: 'cite', x: 'date', y: 'title' }
      : {
          kind: 'table', title,
          columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'title', label: 'Headline', type: 'text' }, { key: 'where', label: 'Where', type: 'text' }],
          rows: out, cite: 'cite',
        };
    return { view, noteLines };
  }
  // timeline source
  const input = a as Parameters<typeof queryTimeline>[0];
  const { hist, sigs } = await queryTimeline(input, MAX_ROWS / 2);
  const all: Row[] = [
    ...hist.map((h): Row => ({ date: h.d, title: snip(h.title, 160), type: 'history', cite: citeToken('history', ctx.tagger.historyTagFor(`${h.id}|${h.url}`)) })),
    ...sigs.map((s): Row => ({ date: s.d, title: snip(s.title, 160), type: `${s.significance} signal`, cite: citeToken('signal', ctx.tagger.tagFor(s.id)) })),
  ].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  if (!all.length) return `No history items or published signals matched "${input.topic}".`;
  const title = `Timeline: ${snip(input.topic, 60)}`;
  const noteLines = all.map((r) => `${r.cite} ${r.date} ${r.title} (${r.type})`);
  const view: AtlasView = p.kind === 'table'
    ? {
        kind: 'table', title,
        columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }],
        rows: all, cite: 'cite',
      }
    : { kind: 'timeline', title, rows: all, cite: 'cite', x: 'date', y: 'title' };
  return { view, noteLines };
}

function metricsTable(company: string, rows: MetricRow[]): Built {
  const out: Row[] = rows.map((r) => ({
    series: snip(r.metric_code, 70), period: r.period, value: r.value, unit: r.unit, cite: snip(r.source, 40) || 'metrics',
  }));
  return {
    view: {
      kind: 'table', title: `Metrics for ${company}`,
      columns: [
        { key: 'series', label: 'Series', type: 'text' }, { key: 'period', label: 'Period', type: 'date' },
        { key: 'value', label: 'Value', type: 'number' }, { key: 'unit', label: 'Unit', type: 'text' },
      ],
      rows: out, cite: 'cite',
    },
    noteLines: out.map((r) => `${r.series} | ${r.period} | ${r.value} | ${r.unit ?? '-'} | ${r.cite}`),
  };
}

function metricsChart(company: string, rows: MetricRow[]): Built {
  // One chart, one unit: with no series named, plot the most-populated series.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.metric_code, (counts.get(r.metric_code) ?? 0) + 1);
  const named = new Set(rows.map((r) => r.metric_code));
  let keep = rows;
  let note: string | undefined;
  if (named.size > 4) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
    keep = rows.filter((r) => top.includes(r.metric_code));
    note = `Plotted the ${top.length} most-populated of ${named.size} matching series; name a series to focus.`;
  }
  const out: Row[] = keep
    .slice()
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((r) => ({ period: r.period, value: r.value, series: snip(r.metric_code, 70), unit: r.unit, cite: snip(r.source, 40) || 'metrics' }));
  const units = new Set(out.map((r) => r.unit).filter(Boolean));
  return {
    view: {
      kind: 'chart', title: `Metrics for ${company}`, rows: out, cite: 'cite', x: 'period', y: 'value', series: 'series',
      unit: units.size === 1 ? String([...units][0]) : undefined, note,
    },
    noteLines: out.map((r) => `${r.series} | ${r.period} | ${r.value} | ${r.unit ?? '-'} | ${r.cite}`),
  };
}
