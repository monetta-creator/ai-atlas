// The Lobby's widget catalog: plain data, no DB, no JSX, importable from both
// server and client code (the customize picker is a client component). The
// board itself is an ordered array of these keys, stored in home_prefs
// (lib/data/home.ts / lib/mutations/home.ts) and rendered by app/page.tsx.

export type WidgetAccess = 'public' | 'admin';

// The two boards (2026-09-27): the lobby ('home', public-leaning, what every
// reader sees) and the admin operations board ('ops', /ops). A widget lists
// the boards it may sit on; the Customize panel offers only those.
export type Board = 'home' | 'ops';
export const BOARDS: Board[] = ['home', 'ops'];

export interface WidgetMeta {
  key: string;
  name: string;
  desc: string;
  access: WidgetAccess;
  span: 1 | 2 | 3;
  boards: Board[];
}

export const WIDGET_CATALOG: WidgetMeta[] = [
  // ---- the lobby (public) ----
  { key: 'edition-front', name: 'Today’s edition', desc: 'The Daily Edition’s top story and its numbers.', access: 'public', span: 2, boards: ['home'] },
  { key: 'savant-latest', name: 'Latest Savant issue', desc: 'The newest weekly research report: its cover and title. Reading it needs an access key.', access: 'public', span: 1, boards: ['home'] },
  { key: 'portal-tiles', name: 'Portals', desc: 'One compact row of every portal.', access: 'public', span: 3, boards: ['home'] },
  { key: 'fresh-across-portals', name: 'New this week', desc: 'The newest tools, tracked papers and published signals, side by side.', access: 'public', span: 2, boards: ['home'] },
  { key: 'hypotheses-ledger', name: 'Open hypotheses', desc: 'The questions Savant is tracking week to week, and where each stands.', access: 'public', span: 1, boards: ['home'] },
  { key: 'latest-signals', name: 'Latest signals', desc: 'The three most recent published signals.', access: 'public', span: 2, boards: ['home'] },
  { key: 'atlas-stats', name: 'Atlas by the numbers', desc: 'Live corpus counts.', access: 'public', span: 1, boards: ['home', 'ops'] },
  { key: 'tooling-entrants', name: 'New AI tools this week', desc: 'Cataloged AI products first seen in the last 7 days.', access: 'public', span: 2, boards: ['home'] },
  { key: 'add-document', name: 'Add a document', desc: 'The upload door into sources, dossiers, and draft signals.', access: 'public', span: 1, boards: ['home'] },

  // ---- the operations board (admin) ----
  { key: 'cron-tracker', name: 'Daily jobs', desc: 'The weekday engines (scan, pipeline, intel, research) and whether today’s data is ready.', access: 'admin', span: 3, boards: ['ops'] },
  { key: 'ops-timeline', name: 'Today’s timeline', desc: 'Every scheduled job’s fire times today, and how each went.', access: 'admin', span: 1, boards: ['ops'] },
  { key: 'ops-jobs', name: 'Jobs', desc: 'Every registered job by family: last run, notes, spend against its cap, next fire.', access: 'admin', span: 3, boards: ['ops'] },
  { key: 'ops-spend', name: 'Spend by feature', desc: 'The last 7 days of model spend by feature, and each engine’s budget against its cap.', access: 'admin', span: 2, boards: ['ops'] },
  { key: 'desk-counts', name: 'Desk', desc: 'The working queues: pipeline, drafts, papers, tickets.', access: 'admin', span: 1, boards: ['ops'] },
  { key: 'todays-spend', name: 'Today’s spend', desc: 'Today’s AI spend and the 30-day forecast.', access: 'admin', span: 1, boards: ['ops'] },
  { key: 'tavily-quota', name: 'Tavily quota', desc: 'Month-to-date search queries against the monthly cap.', access: 'admin', span: 1, boards: ['ops'] },
  { key: 'ops-agent', name: 'Atlas Agent', desc: 'Open findings by severity and the latest daily brief.', access: 'admin', span: 1, boards: ['ops'] },
  { key: 'ops-savant-week', name: 'Savant this week', desc: 'The week’s notebook by day, the next issue, and what the last issue cost.', access: 'admin', span: 2, boards: ['ops'] },
  { key: 'ops-history', name: 'Last 14 days', desc: 'Every job by day, and the recent run notes that flagged a problem.', access: 'admin', span: 3, boards: ['ops'] },
  { key: 'ops-background', name: 'Background work', desc: 'Embedding hooks, the promotion sweep, and the agent’s findings.', access: 'admin', span: 2, boards: ['ops'] },
  { key: 'ops-model-runs', name: 'Model runs', desc: 'Runs in progress and the last runs to finish, with their time and cost.', access: 'admin', span: 1, boards: ['ops'] },
];

// Each board's starting lineup, before an admin customizes it.
export const DEFAULT_BOARD_WIDGETS: Record<Board, string[]> = {
  home: ['edition-front', 'savant-latest', 'portal-tiles', 'fresh-across-portals', 'hypotheses-ledger', 'atlas-stats', 'add-document'],
  ops: ['cron-tracker', 'ops-timeline', 'ops-model-runs', 'ops-agent', 'ops-jobs', 'ops-spend', 'desk-counts', 'todays-spend', 'tavily-quota', 'ops-savant-week', 'ops-history', 'ops-background'],
};
// Kept for callers that predate the boards.
export const DEFAULT_WIDGETS: string[] = DEFAULT_BOARD_WIDGETS.home;

const CATALOG_KEYS = new Set(WIDGET_CATALOG.map((w) => w.key));

export function isWidgetKey(k: string): boolean {
  return CATALOG_KEYS.has(k);
}

export function widgetMeta(k: string): WidgetMeta | undefined {
  return WIDGET_CATALOG.find((w) => w.key === k);
}

export function isBoard(b: unknown): b is Board {
  return b === 'home' || b === 'ops';
}

export function catalogFor(board: Board): WidgetMeta[] {
  return WIDGET_CATALOG.filter((w) => w.boards.includes(board));
}

export function isWidgetOnBoard(k: string, board: Board): boolean {
  return !!widgetMeta(k)?.boards.includes(board);
}
