// The ONE registry of everything that runs on a schedule. Pure, no DB: reads
// vercel.json itself at import time (so a cron entry there can never drift
// out of sync with what this page knows about) and adds metadata keyed by
// path. scripts/test-ops-registry.mjs asserts every vercel.json cron path
// has exactly one registry entry and vice versa.
//
// A "job" here is a LOGICAL job (one engine, one publisher, one sweep), not
// a raw cron path: the four checkpointed engines (scan/pipeline/intel/
// research) each drive from a primary path plus 2-3 /sweep siblings that
// resume whatever the primary invocation's work budget could not finish, and
// this registry groups them into one job with several `schedules`.


import vercelConfig from '../../vercel.json' with { type: 'json' };
export interface VercelCronEntry {
  path: string;
  schedule: string;
}

// Bundled JSON import, the same way app/scan/page.tsx reads the schedule: an
// fs read of process.cwd()/vercel.json works locally and in the tests but the
// file is not in the serverless bundle, so /ops would 500 in production. The
// import attribute keeps plain Node (the test loader) happy too.
export const VERCEL_CRONS: VercelCronEntry[] = (vercelConfig as { crons: VercelCronEntry[] }).crons;

export type OpsFamily = 'engine' | 'publisher' | 'sweep' | 'agent' | 'maintenance';

// How the job keys "today": which SQL boundary its run row (or generated
// report) uses to decide which calendar day a run belongs to.
export type DayBoundary = 'utc-midnight' | 'utc-0600' | 'press-16:20' | 'press-16:45';

export interface OpsPausePref {
  table: string;
  column: string;
}

export interface OpsJob {
  key: string;
  label: string;
  family: OpsFamily;
  // The vercel.json cron paths that drive this job (primary + /sweep siblings).
  paths: string[];
  // Cron expressions, one per path above, in the same order — derived from
  // VERCEL_CRONS so they can never drift from vercel.json.
  schedules: string[];
  describe: string;
  consoleHref: string;
  pausePref?: OpsPausePref;
  deadmanEnv?: string;
  dayBoundary: DayBoundary;
  // A key into the reader map in lib/data/ops.ts (getOpsStatus's per-job dispatch).
  readLatest: string;
}

function schedulesFor(paths: string[]): string[] {
  return paths.map((p) => {
    const entry = VERCEL_CRONS.find((c) => c.path === p);
    if (!entry) throw new Error(`lib/ops/registry.ts: no vercel.json cron entry for path ${p}`);
    return entry.schedule;
  });
}

function job(spec: Omit<OpsJob, 'schedules'>): OpsJob {
  return { ...spec, schedules: schedulesFor(spec.paths) };
}

export const OPS_JOBS: OpsJob[] = [
  job({
    key: 'scan',
    label: 'External Scan',
    family: 'engine',
    paths: ['/api/cron/scan', '/api/cron/scan/sweep', '/api/cron/scan/sweep2', '/api/cron/scan/sweep3'],
    describe: 'Weekday sweep of public news across configurable topics: RSS/Atom feeds plus Tavily/web search, hydrated and cheap-model enriched.',
    consoleHref: '/scan',
    pausePref: { table: 'scan_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_SCAN',
    dayBoundary: 'utc-midnight',
    readLatest: 'scan',
  }),
  job({
    key: 'pipeline',
    label: 'Discovery Pipeline',
    family: 'engine',
    paths: ['/api/cron/pipeline', '/api/cron/pipeline/sweep', '/api/cron/pipeline/sweep2'],
    describe: 'Discovers AI-economy developments by lens, triages, drafts Signal Board candidates, and runs the post-run coverage check.',
    consoleHref: '/pipeline',
    pausePref: { table: 'pipeline_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_PIPELINE',
    dayBoundary: 'utc-0600',
    readLatest: 'pipeline',
  }),
  job({
    key: 'intel',
    label: 'Intel Desk',
    family: 'engine',
    paths: ['/api/cron/intel', '/api/cron/intel/sweep', '/api/cron/intel/sweep2', '/api/cron/intel/sweep3'],
    describe: 'Company-intelligence sweep: feeds, Tavily search, SEC EDGAR filings, and (Mondays) metrics, enriched into intel_facts.',
    consoleHref: '/intel',
    pausePref: { table: 'intel_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_INTEL',
    dayBoundary: 'utc-midnight',
    readLatest: 'intel',
  }),
  job({
    key: 'research',
    label: 'Research Engine',
    family: 'engine',
    paths: ['/api/cron/research', '/api/cron/research/sweep', '/api/cron/research/sweep2', '/api/cron/research/sweep3'],
    describe: 'Daily research pull -> triage -> queue agent -> analyze over new papers, charter-triaged and GLM-routed.',
    consoleHref: '/research/console',
    pausePref: { table: 'research_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_RESEARCH',
    dayBoundary: 'utc-midnight',
    readLatest: 'research',
  }),
  job({
    key: 'tooling',
    label: 'Tooling Monitor',
    family: 'engine',
    paths: ['/api/cron/tooling', '/api/cron/tooling/sweep', '/api/cron/tooling/sweep2'],
    describe: 'Weekly (Monday) market scan for AI tools: discover, hydrate, enrich, score, deep-dive, and the entrants report.',
    consoleHref: '/tooling/console',
    pausePref: { table: 'tooling_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_TOOLING',
    dayBoundary: 'utc-midnight',
    readLatest: 'tooling',
  }),
  job({
    key: 'roundup',
    label: 'Research Roundup',
    family: 'publisher',
    paths: ['/api/cron/roundup'],
    describe: 'Friday: refreshes threads that gained papers and auto-publishes the weekly research roundup report.',
    consoleHref: '/research',
    dayBoundary: 'utc-midnight',
    readLatest: 'roundup',
  }),
  job({
    key: 'intel-deck',
    label: 'Company Intel Deck',
    family: 'publisher',
    paths: ['/api/cron/intel-deck'],
    describe: 'Weekdays 16:20 UTC: a 16:9 deck of the day’s intel items, facts, filings, and metric moves per tracked company.',
    consoleHref: '/intel/deck',
    pausePref: { table: 'intel_prefs', column: 'deck_enabled' },
    deadmanEnv: 'HC_PING_URL_INTEL_DECK',
    dayBoundary: 'press-16:20',
    readLatest: 'intel-deck',
  }),
  job({
    key: 'edition',
    label: 'Daily Edition',
    family: 'publisher',
    paths: ['/api/cron/edition'],
    describe: 'Weekdays 16:45 UTC: the AI newspaper written from what the day’s engines already stored, never a new search.',
    consoleHref: '/blotter/desk',
    pausePref: { table: 'edition_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_EDITION',
    dayBoundary: 'press-16:45',
    readLatest: 'edition',
  }),
  job({
    key: 'feeds',
    label: 'Late Feed Sweep',
    family: 'sweep',
    paths: ['/api/cron/feeds'],
    describe: 'Weekdays 20:30 UTC: reopens today’s scan and intel runs at the feeds step, no Tavily, under the existing daily budget.',
    consoleHref: '/scan',
    deadmanEnv: 'HC_PING_URL_FEEDS',
    dayBoundary: 'utc-midnight',
    readLatest: 'feeds',
  }),
  job({
    key: 'agent',
    label: 'Atlas Agent Tick',
    family: 'agent',
    paths: ['/api/cron/agent'],
    describe: 'Hourly: every sensor check, then any due auto-tier remedies.',
    consoleHref: '/agent',
    pausePref: { table: 'agent_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_AGENT',
    dayBoundary: 'utc-midnight',
    readLatest: 'agent',
  }),
  job({
    key: 'agent-brief',
    label: 'Atlas Agent Brief',
    family: 'agent',
    paths: ['/api/cron/agent/brief'],
    describe: 'Daily 12:30 UTC: the same tick as the hourly cron, plus the morning memo (emailed when configured).',
    consoleHref: '/agent',
    pausePref: { table: 'agent_prefs', column: 'enabled' },
    deadmanEnv: 'HC_PING_URL_AGENT',
    dayBoundary: 'utc-midnight',
    readLatest: 'agent-brief',
  }),
];

// ---- Pure cron-expression helpers ------------------------------------------
// Supports the subset vercel.json actually uses: "minute hour * * dow" where
// dow is '*', a single day (0-6), a range ('1-5'), or a comma list of either.

interface ParsedCron {
  minute: number;
  hour: number;
  dows: number[] | '*';
}

function parseDowField(field: string): number[] | '*' {
  if (field === '*') return '*';
  const days = new Set<number>();
  for (const token of field.split(',')) {
    const range = token.match(/^(\d)-(\d)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let d = start; d <= end; d += 1) days.add(d);
    } else {
      days.add(Number(token));
    }
  }
  return Array.from(days).sort((a, b) => a - b);
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`parseCron: unsupported expression "${expr}"`);
  const [minute, hour, , , dow] = parts;
  return { minute: Number(minute), hour: Number(hour), dows: parseDowField(dow) };
}

function matchesDow(dows: number[] | '*', dowValue: number): boolean {
  return dows === '*' || dows.includes(dowValue);
}

// The next UTC instant (strictly after `now`) at which `cronExpr` fires.
// Searches forward day by day (bounded to 8 days, enough for even a
// Monday-only weekly job) rather than a general cron engine, since every
// schedule in vercel.json is a single daily time plus a day-of-week filter.
export function nextFire(cronExpr: string, now: Date): Date {
  const { minute, hour, dows } = parseCron(cronExpr);
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const base = new Date(now);
    base.setUTCDate(base.getUTCDate() + dayOffset);
    const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute, 0, 0));
    if (candidate <= now) continue;
    if (!matchesDow(dows, candidate.getUTCDay())) continue;
    return candidate;
  }
  throw new Error(`nextFire: no match found for "${cronExpr}" within 8 days`);
}

export interface TodaysFire {
  cronExpr: string;
  whenUtc: Date;
  isFuture: boolean;
}

// Every fire time that lands on `now`'s UTC calendar day, ordered earliest
// first. A schedule whose day-of-week doesn't match today contributes nothing.
export function todaysFires(cronExprs: string[], now: Date): TodaysFire[] {
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fires: TodaysFire[] = [];
  for (const expr of cronExprs) {
    const { minute, hour, dows } = parseCron(expr);
    if (!matchesDow(dows, todayUtc.getUTCDay())) continue;
    const whenUtc = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate(), hour, minute, 0, 0));
    fires.push({ cronExpr: expr, whenUtc, isFuture: whenUtc > now });
  }
  fires.sort((a, b) => a.whenUtc.getTime() - b.whenUtc.getTime());
  return fires;
}

// 'H:MM AM/PM ET' — the one Eastern-time formatter for the ops page (mirrors
// readiness.ts's RUN_TIME_COLUMNS format, but for a plain JS Date rather than
// a SQL-formatted string).
export function fmtEt(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  return `${hour}:${minute} ${dayPeriod} ET`;
}

export function jobForPath(cronPath: string): OpsJob | undefined {
  return OPS_JOBS.find((j) => j.paths.includes(cronPath));
}
