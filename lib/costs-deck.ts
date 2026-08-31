import { q, one } from './db';
import { getCostDashboard, getMonthlyBill, FIXED_MONTHLY } from './data/costs';
import vercelConfig from '../vercel.json';
import { cronLabel } from './datasets/handoff-shared';

// The cost deck: one typed data model consumed by TWO renderers, the live
// 16:9 deck at /costs/deck (HTML) and its PDF export (react-pdf). Payloads
// are plain data by design: react-pdf cannot render DOM JSX, so a slide is a
// kind-discriminated record, never a ReactNode, and the renderers cannot
// drift apart on content. Audience: associates. Generic system language, no
// employer or tracked-company names, a takeaway per content slide.

// ---- forecast math ----------------------------------------------------------
// Moved here from components/SpendForecast.tsx (which imports it back) so the
// deck's forecast slide and the /costs page agree to the cent. The crons that
// drive most metered spend are weekday-only, so daily spend has a weekly
// shape a flat trailing average would wash out: for each of the next 30 days,
// use the mean actual spend of the SAME day type (weekday vs weekend) over
// the trailing 14 actual days. UTC day-of-week keeps the math deterministic.
function parseUTCDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function isWeekendUTC(day: string): boolean {
  const dow = parseUTCDay(day).getUTCDay();
  return dow === 0 || dow === 6;
}
function addDaysUTC(day: string, n: number): string {
  const dt = parseUTCDay(day);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function mean(rows: { cost: number }[]): number {
  return rows.length ? rows.reduce((s, r) => s + r.cost, 0) / rows.length : 0;
}

export function computeForecast(actual: { day: string; cost: number }[]): { day: string; cost: number }[] {
  if (actual.length === 0) return [];
  const trailing = actual.slice(-14);
  const overallMean = mean(trailing);
  const weekday = trailing.filter((d) => !isWeekendUTC(d.day));
  const weekend = trailing.filter((d) => isWeekendUTC(d.day));
  const weekdayMean = weekday.length ? mean(weekday) : overallMean;
  const weekendMean = weekend.length ? mean(weekend) : overallMean;
  const lastDay = actual[actual.length - 1].day;
  return Array.from({ length: 30 }, (_, i) => {
    const day = addDaysUTC(lastDay, i + 1);
    return { day, cost: isWeekendUTC(day) ? weekendMean : weekdayMean };
  });
}

// ---- slide model ------------------------------------------------------------

export interface DeckStat {
  n: string;
  l: string;
  sub?: string;
}

export type DeckSlide =
  | {
      kind: 'title';
      kicker: string;
      title: string;
      subtitle: string;
      bigStat: DeckStat;
      date: string;
    }
  | {
      kind: 'bill';
      kicker: string;
      title: string;
      fixed: { name: string; usd: number; note: string }[];
      fixedTotalUsd: number;
      mtdUsd: number;
      projectedUsd: number;
      todayUsd: number;
      allTimeUsd: number;
      mtdCalls: number;
      runningUsd: number;
      takeaway: string;
    }
  | {
      kind: 'bar-table';
      kicker: string;
      title: string;
      colHeads: string[]; // heads for the value columns after the bar
      rows: { label: string; sub?: string; value: number; cols: string[] }[];
      maxValue: number;
      takeaway: string;
    }
  | {
      kind: 'forecast-chart';
      kicker: string;
      title: string;
      actual: { day: string; cost: number }[];
      forecast: { day: string; cost: number }[];
      forecastSumUsd: number;
      runRateUsd: number;
      takeaway: string;
    }
  | {
      kind: 'before-after';
      kicker: string;
      title: string;
      pairs: { label: string; before: DeckStat; after: DeckStat; factor: string }[];
      footnote: string;
      takeaway: string;
    }
  | {
      kind: 'table';
      kicker: string;
      title: string;
      heads: string[];
      rows: string[][];
      note?: string;
      takeaway: string;
    }
  | {
      kind: 'stat-grid';
      kicker: string;
      title: string;
      stats: DeckStat[];
      note?: string;
      takeaway: string;
    }
  | { kind: 'divider'; kicker: string; title: string; subtitle: string }
  | {
      kind: 'matrix';
      kicker: string;
      title: string;
      cols: string[];
      rows: { label: string; cells: ('yes' | 'partial' | 'no')[] }[];
      note: string;
      takeaway: string;
    }
  | {
      kind: 'bullets';
      kicker: string;
      title: string;
      bullets: { lead: string; text: string }[];
      takeaway: string;
    }
  | {
      kind: 'price-compare';
      kicker: string;
      title: string;
      ours: { label: string; usd: number; unit: string };
      items: {
        label: string;
        example: string;
        lowUsd: number;
        highUsd: number;
        unit: string;
        source: string;
        // "12x to 46x", precomputed against ours.usd so both renderers agree
        multiple: string;
      }[];
      footnote: string;
      takeaway: string;
    };

export interface CostDeck {
  generatedOn: string;
  slides: DeckSlide[];
}

// ---- fixed editorial content ------------------------------------------------

// Savings story: measured engineering results, dated. The before figures come
// from the cost log's frontier-model eras; the after figures from live runs on
// the open-weight stack. These are statements of record, not projections.
const SAVINGS: { label: string; before: DeckStat; after: DeckStat; factor: string }[] = [
  {
    label: 'Discovery pipeline, one run',
    before: { n: '$3.70', l: 'frontier models, weekly (measured 2026-08-17)' },
    after: { n: '$0.013', l: 'open-weight stack, now DAILY (measured 2026-08-29)' },
    factor: '285x cheaper',
  },
  {
    label: 'News-scan enrichment, one day',
    before: { n: '$1.43', l: 'frontier models (morning of 2026-08-29)' },
    after: { n: '$0.013', l: 'open-weight A/B trio, same day, same items' },
    factor: '110x cheaper',
  },
  {
    label: 'Metrics warehouse, 2.0M rows loaded',
    before: { n: 'n/a', l: 'not previously feasible' },
    after: { n: '$0.00', l: 'model-free public APIs, one afternoon (2026-08-30)' },
    factor: 'zero model spend',
  },
];

// Capability matrix: honest cells. 'partial' means the capability exists but
// is constrained (their taxonomy, their models, or a thinner slice); licensed
// content is the commercial products' genuine exclusive and is marked as such.
const MATRIX_COLS = [
  'This system',
  'Enterprise research platform',
  'Financial data terminal',
  'Enterprise news service',
  'CI platform',
];
const MATRIX_ROWS: { label: string; cells: ('yes' | 'partial' | 'no')[] }[] = [
  { label: 'Continuous news monitoring', cells: ['yes', 'yes', 'partial', 'yes', 'yes'] },
  { label: 'Company tracking and CI workflow', cells: ['yes', 'partial', 'partial', 'no', 'yes'] },
  { label: 'Regulatory and filing data depth', cells: ['yes', 'partial', 'yes', 'no', 'no'] },
  { label: 'Licensed content (broker research, transcripts, paywalled press)', cells: ['no', 'yes', 'yes', 'yes', 'partial'] },
  { label: 'AI summaries and Q&A over your own corpus', cells: ['yes', 'yes', 'partial', 'no', 'partial'] },
  { label: 'Custom taxonomy and tracked-company registry', cells: ['yes', 'partial', 'no', 'no', 'partial'] },
  { label: 'Bulk export with formal schemas, built for downstream ingestion', cells: ['yes', 'partial', 'partial', 'no', 'no'] },
  { label: 'Model choice, A/B measurement, per-call cost metering', cells: ['yes', 'no', 'no', 'no', 'no'] },
];

// Market comps: publicly reported figures, researched 2026-08-30 via
// procurement-data aggregators (Vendr, SpendHound, CostBench, TrustRadius)
// and vendor/press sources. Ranges over point estimates; category labels
// lead, example vendors named in small print. Update by re-researching, not
// by editing numbers in place.
const COMPS: { label: string; example: string; lowUsd: number; highUsd: number; unit: string; source: string }[] = [
  {
    label: 'Enterprise research platform',
    example: 'e.g. AlphaSense',
    lowUsd: 10_000,
    highUsd: 40_000,
    unit: 'per seat, per year',
    source: 'procurement data, 2026: $10-20k base seats, most $10-40k; 3-seat teams ~$45-60k',
  },
  {
    label: 'Financial data terminal',
    example: 'e.g. Bloomberg Terminal, LSEG Workspace',
    lowUsd: 22_000,
    highUsd: 31_980,
    unit: 'per seat, per year',
    source: 'Bloomberg 2026 list $31,980 single seat; LSEG Workspace commonly ~$22k',
  },
  {
    label: 'Competitive-intelligence platform',
    example: 'e.g. Klue, Crayon',
    lowUsd: 15_000,
    highUsd: 60_000,
    unit: 'per team, per year',
    source: 'reported 2026: entry ~$15-16k, typical $20-40k, larger deals to $60k+',
  },
  {
    label: 'Media monitoring',
    example: 'e.g. Meltwater',
    lowUsd: 13_275,
    highUsd: 65_020,
    unit: 'per contract, per year',
    source: 'verified average contract values 2026: SMB $13.3k, enterprise $65k, up to $150k+',
  },
  {
    label: 'Enterprise news service',
    example: 'e.g. Factiva',
    lowUsd: 8_400,
    highUsd: 96_000,
    unit: 'per team, per year, by size',
    source: 'reported 2026: 10-user licenses ~$8-11k/yr, 100-user ~$72-96k/yr',
  },
];

// ---- assembly ---------------------------------------------------------------

const usd2 = (n: number): string => `$${n.toFixed(2)}`;

export async function buildCostDeckData(): Promise<CostDeck> {
  const [dash, bill, outcomes] = await Promise.all([
    getCostDashboard(),
    getMonthlyBill(),
    buildOutcomeStats(),
  ]);
  const fixedTotal = FIXED_MONTHLY.reduce((s, f) => s + f.usd, 0);
  const runningUsd = Math.round(fixedTotal + bill.projectedUsd);
  const generatedOn = new Date().toISOString().slice(0, 10);

  const actual = dash.daily.map((d) => ({ day: d.day, cost: d.cost }));
  const forecast = computeForecast(actual);
  const forecastSum = forecast.reduce((s, d) => s + d.cost, 0);

  const crons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;
  const CRON_SUBSYSTEM: [string, string, string][] = [
    ['/api/cron/scan', 'External Scan', 'sweeps news feeds and topic search, enriches items'],
    ['/api/cron/pipeline', 'Discovery Pipeline', 'finds and drafts developments for the signal board'],
    ['/api/cron/intel', 'Intel Desk', 'company feeds, filings, facts, and quarterly metrics'],
  ];
  const subsystemBySlugPrefix = new Map(bill.subsystems.map((s) => [s.name, s]));
  const cronRows: string[][] = crons.map((c) => {
    const owner = CRON_SUBSYSTEM.find(([p]) => c.path.startsWith(p));
    const isSweep = c.path.endsWith('/sweep');
    const sub = owner ? subsystemBySlugPrefix.get(owner[1]) : undefined;
    return [
      c.path,
      cronLabel(c.schedule),
      owner ? owner[1] : '',
      isSweep ? 'finishes what the first pass could not' : owner ? owner[2] : '',
      isSweep ? '(shares the bucket above)' : sub ? usd2(sub.mtdUsd) : '$0.00',
    ];
  });

  const rateRows: string[][] = dash.activeRateCards
    .slice()
    .sort((a, b) => a.input_per_mtok - b.input_per_mtok)
    .map((r) => [
      r.model,
      `$${r.input_per_mtok}`,
      `$${r.output_per_mtok}`,
      r.input_per_mtok >= 1 ? 'frontier: judgment calls' : 'open weight: volume work',
    ]);

  const maxSub = Math.max(...bill.subsystems.map((s) => s.mtdUsd), 0.01);

  const slides: DeckSlide[] = [
    {
      kind: 'title',
      kicker: 'Cost report',
      title: 'The running cost of a standing intelligence system',
      subtitle:
        'Continuous external-signal ingestion, a two-million-point metrics warehouse, daily automated collection, and AI enrichment: the whole stack, priced.',
      bigStat: { n: `~$${runningUsd}`, l: 'per month, all-in (hosting, database, search, and every model call)' },
      date: generatedOn,
    },
    {
      kind: 'bill',
      kicker: 'The monthly bill',
      title: 'Fixed platform plus metered intelligence',
      fixed: FIXED_MONTHLY.map((f) => ({ ...f })),
      fixedTotalUsd: fixedTotal,
      mtdUsd: bill.mtdUsd,
      projectedUsd: bill.projectedUsd,
      todayUsd: bill.todayUsd,
      allTimeUsd: bill.allTimeUsd,
      mtdCalls: bill.mtdCalls,
      runningUsd,
      takeaway: 'The entire system runs for less per month than one seat-hour of most enterprise tooling.',
    },
    {
      kind: 'bar-table',
      kicker: 'Where the money goes',
      title: 'Metered spend by subsystem, this month',
      colHeads: ['This month', 'Today', 'Calls', 'All-time'],
      rows: bill.subsystems.map((s) => ({
        label: s.name,
        sub: s.cron ? 'cron-driven, runs unattended' : undefined,
        value: s.mtdUsd,
        cols: [usd2(s.mtdUsd), usd2(s.todayUsd), String(s.calls), usd2(s.allTimeUsd)],
      })),
      maxValue: maxSub,
      takeaway: 'Every model call is metered and priced at call time; nothing spends without appearing here.',
    },
    {
      kind: 'forecast-chart',
      kicker: 'Trajectory',
      title: 'Daily spend, and the next 30 days',
      actual,
      forecast,
      forecastSumUsd: forecastSum,
      runRateUsd: Math.round(forecastSum + fixedTotal),
      takeaway: 'The forecast uses the trailing two weeks of weekday and weekend averages; the automation is weekday-shaped.',
    },
    {
      kind: 'before-after',
      kicker: 'The savings story',
      title: 'The same work, re-engineered onto cheaper machinery',
      pairs: SAVINGS,
      footnote:
        'Judgment still buys frontier models; volume work runs on benchmarked open-weight models with identical validation gates.',
      takeaway: 'Cost went down two orders of magnitude while cadence went UP from weekly to daily.',
    },
    {
      kind: 'table',
      kicker: 'The cron economy',
      title: 'Six scheduled jobs run the whole collection day',
      heads: ['Job', 'Schedule', 'Subsystem', 'What it does', 'This month'],
      rows: cronRows,
      takeaway: 'The daily automation runs on pennies, and each job is independently budget-capped and resumable.',
    },
    {
      kind: 'table',
      kicker: 'Model economics',
      title: 'The rate card: what a million tokens costs',
      heads: ['Model', 'Input / Mtok', 'Output / Mtok', 'Role'],
      rows: rateRows,
      note: 'Rates are frozen into every logged call at call time, so historical spend never silently reprices.',
      takeaway: 'Judgment buys frontier models. Volume buys open-weight models, A/B measured in production.',
    },
    {
      kind: 'stat-grid',
      kicker: 'Unit economics',
      title: 'What an outcome actually costs',
      stats: outcomes,
      note: 'All-time metered spend divided by all-time output counts, from the cost log and the domain tables.',
      takeaway: 'The unit costs are why the system can afford to read everything and let humans judge the best of it.',
    },
    {
      kind: 'divider',
      kicker: 'Appendix',
      title: 'Market context',
      subtitle: 'What comparable capability costs from commercial vendors, honestly scoped.',
    },
    {
      kind: 'matrix',
      kicker: 'Appendix · capability',
      title: 'Capability, side by side',
      cols: MATRIX_COLS,
      rows: MATRIX_ROWS,
      note: 'Licensed content (broker research, transcript archives, paywalled press) is the commercial products’ genuine exclusive: this system deliberately collects public sources only and exports join keys so licensed data can sit on top downstream.',
      takeaway: 'The overlap is large on monitoring, tracking, and structured data; the gap is licensed content and vendor support.',
    },
    {
      kind: 'price-compare',
      kicker: 'Appendix · price',
      title: 'Annual cost against the market',
      ours: { label: 'This system, all-in', usd: runningUsd * 12, unit: 'per year, unlimited internal readers of the exports' },
      items: COMPS.map((c) => ({
        ...c,
        multiple: `${Math.round(c.lowUsd / (runningUsd * 12))}x to ${Math.round(c.highUsd / (runningUsd * 12))}x`,
      })),
      footnote:
        'Public reported figures, researched 2026-08-30 from procurement-data aggregators and vendor sources; most vendors quote-price, so ranges are shown. Commercial products include licensed content, SLAs, and support this system does not.',
      takeaway: 'Comparable coverage of the PUBLIC-source slice, at roughly one percent of the cheapest commercial entry point.',
    },
  ];

  return { generatedOn, slides };
}

// Unit economics: all-time spend per feature divided by all-time output
// counts. Only units where both sides are cleanly countable; the Ask surfaces
// are excluded because a deep-research answer spans an unknowable number of
// logged calls.
async function buildOutcomeStats(): Promise<DeckStat[]> {
  const [spend, counts, cronDay] = await Promise.all([
    q<{ feature: string; usd: number }>(
      `select feature, coalesce(sum(cost_usd), 0)::float as usd
         from ai_cost_log
        where feature in ('pipeline_analysis', 'scan_enrich', 'intel_enrich')
        group by feature`
    ),
    one<{ drafts: number; scan_done: number; intel_done: number; facts: number; metrics: number }>(
      `select
         (select count(*) from signals where origin = 'pipeline')::int as drafts,
         (select count(*) from scan_items where enrich_status = 'done')::int as scan_done,
         (select count(*) from intel_items where enrich_status = 'done')::int as intel_done,
         (select count(*) from intel_facts)::int as facts,
         (select count(*) from intel_metrics)::int as metrics`
    ),
    one<{ usd: number }>(
      `select coalesce(sum(cost_usd), 0)::float as usd
         from ai_cost_log
        where (feature like 'scan\\_%' or feature like 'pipeline\\_%' or feature like 'intel\\_%')
          and created_at > now() - interval '14 days'`
    ),
  ]);
  const spendBy = new Map(spend.map((s) => [s.feature, s.usd]));
  const per = (usd: number | undefined, n: number | undefined): string =>
    n && usd !== undefined ? `$${(usd / n).toFixed(3)}` : '–';
  const c = counts ?? { drafts: 0, scan_done: 0, intel_done: 0, facts: 0, metrics: 0 };
  return [
    { n: per(spendBy.get('pipeline_analysis'), c.drafts), l: 'per drafted signal', sub: `${c.drafts.toLocaleString()} drafted to date` },
    { n: per(spendBy.get('scan_enrich'), c.scan_done), l: 'per news item enriched', sub: `${c.scan_done.toLocaleString()} enriched to date` },
    { n: per(spendBy.get('intel_enrich'), c.intel_done), l: 'per intel item enriched', sub: `${c.intel_done.toLocaleString()} enriched to date` },
    { n: per(spendBy.get('intel_enrich'), c.facts), l: 'per extracted fact (same spend also buys the summaries)', sub: `${c.facts.toLocaleString()} facts to date` },
    { n: '$0.000', l: 'per metrics-warehouse row', sub: `${c.metrics.toLocaleString()} rows, loaded model-free` },
    { n: usd2((cronDay?.usd ?? 0) / 14), l: 'per day of automated collection', sub: 'trailing two weeks, all three cron subsystems' },
  ];
}
