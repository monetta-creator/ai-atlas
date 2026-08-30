// The Lobby's widget catalog: plain data, no DB, no JSX, importable from both
// server and client code (the customize picker is a client component). The
// board itself is an ordered array of these keys, stored in home_prefs
// (lib/data/home.ts / lib/mutations/home.ts) and rendered by app/page.tsx.

export type WidgetAccess = 'public' | 'admin';

export interface WidgetMeta {
  key: string;
  name: string;
  desc: string;
  access: WidgetAccess;
  span: 1 | 2 | 3;
}

export const WIDGET_CATALOG: WidgetMeta[] = [
  {
    key: 'cron-tracker',
    name: 'Daily jobs',
    desc: 'Tracks the scan, pipeline, and intel crons and calls the day’s data ready.',
    access: 'admin',
    span: 3,
  },
  {
    key: 'desk-counts',
    name: 'Desk',
    desc: 'The working queues: pipeline, drafts, papers, tickets.',
    access: 'admin',
    span: 1,
  },
  {
    key: 'todays-spend',
    name: 'Today’s spend',
    desc: 'Today’s AI spend and the 30-day forecast.',
    access: 'admin',
    span: 1,
  },
  {
    key: 'tavily-quota',
    name: 'Tavily quota',
    desc: 'Month-to-date search queries against the free-tier cap.',
    access: 'admin',
    span: 1,
  },
  {
    key: 'latest-signals',
    name: 'Latest signals',
    desc: 'The three most recent published signals.',
    access: 'public',
    span: 2,
  },
  {
    key: 'atlas-stats',
    name: 'Atlas by the numbers',
    desc: 'Live corpus counts.',
    access: 'public',
    span: 1,
  },
  {
    key: 'add-document',
    name: 'Add a document',
    desc: 'The upload door into sources, dossiers, and draft signals.',
    access: 'public',
    span: 1,
  },
  {
    key: 'tile-signals',
    name: 'Signal Board',
    desc: 'Tracked AI developments, sorted by audience lens and tied to the claims they touch.',
    access: 'public',
    span: 1,
  },
  {
    key: 'tile-blotter',
    name: 'News Blotter',
    desc: 'The editor’s desk: the fortnight report, claims ledger, signal wire, and pipeline analytics.',
    access: 'public',
    span: 1,
  },
  {
    key: 'tile-map',
    name: 'Claims & Theses',
    desc: 'The argument map: open questions, falsifiable claims, and the standing theses they test.',
    access: 'public',
    span: 1,
  },
  {
    key: 'tile-reports',
    name: 'Report Portal',
    desc: 'Saved period reports and thesis reports, published read-only from the corpus.',
    access: 'public',
    span: 1,
  },
  {
    key: 'tile-datasets',
    name: 'Data Portal',
    desc: 'Self-service datasets from the Atlas corpus, with schema pages and CSV or JSON downloads.',
    access: 'public',
    span: 1,
  },
  {
    key: 'tile-research',
    name: 'Research Portal',
    desc: 'The latest AI research from arXiv, triaged against the Atlas and synthesized into threads.',
    access: 'public',
    span: 1,
  },
  {
    key: 'tile-scout',
    name: 'Startup Scout',
    desc: 'Young AI companies as acquisition targets: discovered by vertical, evaluated, and tracked.',
    access: 'public',
    span: 1,
  },
];

// The board's starting lineup, before an admin ever customizes it.
export const DEFAULT_WIDGETS: string[] = [
  'cron-tracker',
  'desk-counts',
  'tile-signals',
  'tile-blotter',
  'tile-map',
  'tile-reports',
  'tile-datasets',
  'tile-research',
  'tile-scout',
  'add-document',
];

const CATALOG_KEYS = new Set(WIDGET_CATALOG.map((w) => w.key));

export function isWidgetKey(k: string): boolean {
  return CATALOG_KEYS.has(k);
}

export function widgetMeta(k: string): WidgetMeta | undefined {
  return WIDGET_CATALOG.find((w) => w.key === k);
}
