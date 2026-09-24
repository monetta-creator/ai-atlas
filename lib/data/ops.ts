import { one, q } from '../db';
import { OPS_JOBS, type OpsJob, todaysFires, nextFire, fmtEt } from '../ops/registry';
import { PIPELINE_DAY_START_SQL } from '../pipeline/config';
import { getDailyJobStatus, type DailyJobStatus } from './readiness';
import { getScanRunByDay } from './scan';
import { getIntelRunByDay } from './intel';
import { getResearchRunByDay } from './research';
import { getToolingRuns } from './tooling';
import { getRoundupForWeek } from './reports';
import { getIntelDeckForDay } from './intel-deck';
import { getEditionForDay } from './editions';
import { checkScanBudget } from '../scan/budget';
import { checkIntelBudget } from '../intel/budget';
import { checkResearchBudget } from '../research/budget';
import { checkPipelineBudget } from '../pipeline/budget';
import { agentCapUsd } from '../agent/budget';
import { getAgentSpendToday } from './agent';
import { tavilyQuotaWarning } from '../scan/tavily-breaker';
import { checkEmbedBudget } from '../embed/hooks';
import { countMissingEmbeddings } from '../embed/sources';
import { embedModel } from '../embed/client';

// ---- The ONE ops status read -------------------------------------------------
// getOpsStatus(now) answers, per registered job (lib/ops/registry.ts): what
// state is it in right now, what did its last run look like, when does it
// fire next / today, and how is it doing against its daily budget. This is
// the single source for /ops, /api/ops/status, and (via `daily`) the lobby
// Daily Jobs widget, so there is one place that decides "is today's data
// ready" instead of several consoles disagreeing.

export type OpsState = 'completed' | 'running' | 'failed' | 'pending' | 'paused' | 'off';

export interface OpsLastRun {
  startedAt: string | null;
  finishedAt: string | null;
  day: string | null;
  summary: string | null;
  notes: string[];
  href: string;
}

export interface OpsJobStatus {
  job: OpsJob;
  state: OpsState;
  lastRun: OpsLastRun | null;
  nextFireEt: string | null;
  todaysFiresEt: { at: string; atMinutesUtc: number; isFuture: boolean }[];
  spendTodayUsd: number | null;
  budgetCapUsd: number | null;
  tavilyWarning: string | null;
}

export interface OpsStatus {
  now: string;
  daily: DailyJobStatus;
  jobs: OpsJobStatus[];
  scheduledToday: number;
  ranToday: number;
  failedToday: number;
  pausedCount: number;
}

function todayUTC(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function isJobEnabled(job: OpsJob): Promise<boolean> {
  if (!job.pausePref) return true;
  const row = await one<{ v: boolean }>(
    `select ${job.pausePref.column} as v from ${job.pausePref.table} where id = true`
  );
  return row?.v ?? true;
}

interface RawSnapshot {
  status: string;
  step: string | null;
  error: string | null;
  notes: string[];
  day: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
}

async function snapshotFor(job: OpsJob, now: Date): Promise<{ snap: RawSnapshot | null; spentUsd: number | null; capUsd: number | null }> {
  const day = todayUTC(now);
  switch (job.readLatest) {
    case 'scan': {
      const [run, budget] = await Promise.all([getScanRunByDay(day), checkScanBudget()]);
      return {
        snap: run && {
          status: run.status, step: run.step, error: run.error, notes: run.notes, day: run.day,
          startedAt: run.created_at, finishedAt: run.status === 'completed' ? run.updated_at : null,
          summary: `${run.feed_item_count + run.search_item_count} items · ${run.enriched_count} enriched`,
        },
        spentUsd: budget.spentUsd, capUsd: budget.capUsd,
      };
    }
    case 'pipeline': {
      const [run, budget] = await Promise.all([
        one<{ id: string; status: string; step: string; candidate_count: number; signal_count: number; error: string | null; notes: string[]; created_at: string; updated_at: string }>(
          `select id, status::text as status, step::text as step, candidate_count, signal_count, error,
                  coalesce(notes, '{}') as notes, created_at::text as created_at, updated_at::text as updated_at
             from pipeline_runs
            where cadence = 'daily' and created_at >= ${PIPELINE_DAY_START_SQL}
            order by created_at desc limit 1`
        ),
        checkPipelineBudget(),
      ]);
      return {
        snap: run && {
          status: run.status, step: run.step, error: run.error, notes: run.notes, day,
          startedAt: run.created_at, finishedAt: run.status === 'completed' ? run.updated_at : null,
          summary: `${run.candidate_count} candidates · ${run.signal_count} drafts`,
        },
        spentUsd: budget.spentUsd, capUsd: budget.capUsd,
      };
    }
    case 'intel': {
      const [run, budget] = await Promise.all([getIntelRunByDay(day), checkIntelBudget()]);
      return {
        snap: run && {
          status: run.status, step: run.step, error: run.error, notes: run.notes, day: run.day,
          startedAt: run.created_at, finishedAt: run.status === 'completed' ? run.updated_at : null,
          summary: `${run.feed_item_count + run.search_item_count + run.filing_item_count} items · ${run.fact_count} facts${run.metric_count > 0 ? ` · ${run.metric_count} metrics` : ''}`,
        },
        spentUsd: budget.spentUsd, capUsd: budget.capUsd,
      };
    }
    case 'research': {
      const [run, budget] = await Promise.all([getResearchRunByDay(day), checkResearchBudget()]);
      return {
        snap: run && {
          status: run.status, step: run.step, error: run.error, notes: run.notes, day: run.day,
          startedAt: run.created_at, finishedAt: run.status === 'completed' ? run.updated_at : null,
          summary: `${run.pulled_count} pulled · ${run.kept_count} kept`,
        },
        spentUsd: budget.spentUsd, capUsd: budget.capUsd,
      };
    }
    case 'tooling': {
      const runs = await getToolingRuns(6);
      const weekly = runs.filter((r) => r.kind === 'weekly').sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const run = weekly[0] ?? null;
      return {
        snap: run && {
          status: run.status, step: run.step, error: run.error, notes: run.notes, day: run.day,
          startedAt: run.created_at, finishedAt: run.status === 'completed' ? run.updated_at : null,
          summary: `${run.found_count} found · ${run.cataloged_count} cataloged`,
        },
        spentUsd: run?.cost_usd ?? null, capUsd: Number(process.env.TOOLING_WEEKLY_BUDGET_USD || 4),
      };
    }
    case 'roundup': {
      const friday = fridayOfWeekUTC(now);
      const row = await getRoundupForWeek(friday);
      return {
        snap: row && { status: 'completed', step: null, error: null, notes: [], day: friday, startedAt: null, finishedAt: null, summary: 'roundup published' },
        spentUsd: null, capUsd: null,
      };
    }
    case 'intel-deck': {
      const row = await getIntelDeckForDay(day);
      return {
        snap: row && { status: 'completed', step: null, error: null, notes: [], day, startedAt: null, finishedAt: row.generated_at, summary: 'deck generated' },
        spentUsd: null, capUsd: null,
      };
    }
    case 'edition': {
      const row = await getEditionForDay(day);
      return {
        snap: row && { status: 'completed', step: null, error: null, notes: [], day, startedAt: null, finishedAt: row.generated_at, summary: row.narrative?.dropped?.length ? `published, ${row.narrative.dropped.length} dropped` : 'published' },
        spentUsd: null, capUsd: null,
      };
    }
    case 'feeds': {
      const [scanRun, intelRun] = await Promise.all([getScanRunByDay(day), getIntelRunByDay(day)]);
      const scanSwept = (scanRun?.notes ?? []).some((n) => n.startsWith('late feed sweep'));
      const intelSwept = (intelRun?.notes ?? []).some((n) => n.startsWith('late feed sweep'));
      const notes = [...(scanRun?.notes ?? []), ...(intelRun?.notes ?? [])].filter((n) => n.startsWith('late feed sweep'));
      const ran = scanSwept || intelSwept;
      return {
        snap: ran ? { status: 'completed', step: null, error: null, notes, day, startedAt: null, finishedAt: null, summary: notes.join('; ') } : null,
        spentUsd: null, capUsd: null,
      };
    }
    case 'agent': {
      const row = await one<{ n: number; latest: string | null }>(
        `select count(*)::int as n, max(created_at)::text as latest from agent_actions where created_at >= $1::date`,
        [day]
      );
      return {
        snap: row && row.n > 0 ? { status: 'completed', step: null, error: null, notes: [], day, startedAt: null, finishedAt: row.latest, summary: `${row.n} action${row.n === 1 ? '' : 's'} today` } : null,
        spentUsd: (await getAgentSpendToday()).usd, capUsd: agentCapUsd(),
      };
    }
    case 'agent-brief': {
      const row = await one<{ id: string; day: string }>(`select id, day::text as day from agent_briefs where day = $1::date`, [day]);
      return {
        snap: row && { status: 'completed', step: null, error: null, notes: [], day: row.day, startedAt: null, finishedAt: null, summary: 'brief written' },
        spentUsd: null, capUsd: null,
      };
    }
    default:
      return { snap: null, spentUsd: null, capUsd: null };
  }
}

// The most recent Friday on or before `now` (UTC): the roundup's natural key
// (scope_to) is the week-ending Friday, so this is "today's" roundup row on
// a Friday and the last published one every other day of the week.
function fridayOfWeekUTC(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const daysSinceFriday = (dow - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceFriday);
  return d.toISOString().slice(0, 10);
}

export async function getOpsStatus(now: Date = new Date()): Promise<OpsStatus> {
  const daily = await getDailyJobStatus();

  const jobs = await Promise.all(
    OPS_JOBS.map(async (job): Promise<OpsJobStatus> => {
      const [enabled, { snap, spentUsd, capUsd }] = await Promise.all([isJobEnabled(job), snapshotFor(job, now)]);
      const fires = todaysFires(job.schedules, now);
      const scheduledToday = fires.length > 0;

      let state: OpsState;
      if (snap?.status === 'running') state = 'running';
      else if (snap?.status === 'failed') state = 'failed';
      else if (snap?.status === 'completed') state = 'completed';
      else if (!enabled) state = 'paused';
      else if (!scheduledToday) state = 'off';
      else state = 'pending';

      const earliestSchedule = job.schedules[0];
      const next = nextFire(earliestSchedule, now);
      // Pick the soonest next fire across every schedule the job carries.
      const nextAcrossAll = job.schedules.reduce((soonest, expr) => {
        const candidate = nextFire(expr, now);
        return candidate < soonest ? candidate : soonest;
      }, next);

      return {
        job,
        state,
        lastRun: snap
          ? {
              startedAt: snap.startedAt, finishedAt: snap.finishedAt, day: snap.day,
              summary: snap.summary, notes: snap.notes, href: job.consoleHref,
            }
          : null,
        nextFireEt: fmtEt(nextAcrossAll),
        todaysFiresEt: fires.map((f) => ({
          at: fmtEt(f.whenUtc),
          atMinutesUtc: f.whenUtc.getUTCHours() * 60 + f.whenUtc.getUTCMinutes(),
          isFuture: f.isFuture,
        })),
        spendTodayUsd: spentUsd,
        budgetCapUsd: capUsd,
        tavilyWarning: snap ? tavilyQuotaWarning(snap.notes.join('\n')) : null,
      };
    })
  );

  return {
    now: now.toISOString(),
    daily,
    jobs,
    scheduledToday: jobs.filter((j) => j.state !== 'off').length,
    ranToday: jobs.filter((j) => j.state === 'completed').length,
    failedToday: jobs.filter((j) => j.state === 'failed').length,
    pausedCount: jobs.filter((j) => j.state === 'paused').length,
  };
}

// ---- 14-day history grid ----------------------------------------------------

export type OpsCellState = 'completed' | 'failed' | 'off' | 'none';

export interface OpsHistoryRow {
  key: string;
  label: string;
  cells: { day: string; state: OpsCellState }[];
}

function lastNDaysUTC(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function isWeekendUTC(dayISO: string): boolean {
  const dow = new Date(`${dayISO}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

async function dayKeyedHistory(table: string, days: string[]): Promise<Map<string, OpsCellState>> {
  const rows = await q<{ day: string; status: string }>(
    `select day::text as day, status::text as status from ${table} where day >= $1::date`,
    [days[0]]
  );
  const byDay = new Map(rows.map((r) => [r.day, r.status]));
  const out = new Map<string, OpsCellState>();
  for (const day of days) {
    const status = byDay.get(day);
    if (status === 'completed') out.set(day, 'completed');
    else if (status === 'failed' || status === 'running') out.set(day, 'failed');
    else out.set(day, isWeekendUTC(day) ? 'off' : 'none');
  }
  return out;
}

export async function getOpsHistory(days = 14, now: Date = new Date()): Promise<OpsHistoryRow[]> {
  const dayList = lastNDaysUTC(now, days);
  const rows: OpsHistoryRow[] = [];

  for (const job of OPS_JOBS) {
    let cells: Map<string, OpsCellState>;
    switch (job.readLatest) {
      case 'scan':
        cells = await dayKeyedHistory('scan_runs', dayList);
        break;
      case 'intel':
        cells = await dayKeyedHistory('intel_runs', dayList);
        break;
      case 'research':
        cells = await dayKeyedHistory('research_runs', dayList);
        break;
      case 'pipeline': {
        const runRows = await q<{ day: string; status: string }>(
          `select (${PIPELINE_DAY_START_SQL.replace('now()', 'created_at')})::date::text as day, status::text as status
             from pipeline_runs
            where cadence = 'daily' and created_at >= $1::date
            order by created_at desc`,
          [dayList[0]]
        );
        const byDay = new Map<string, string>();
        for (const r of runRows) if (!byDay.has(r.day)) byDay.set(r.day, r.status); // most recent wins (desc order)
        cells = new Map(
          dayList.map((day) => {
            const status = byDay.get(day);
            if (status === 'completed') return [day, 'completed' as const];
            if (status === 'failed' || status === 'running') return [day, 'failed' as const];
            return [day, isWeekendUTC(day) ? 'off' as const : 'none' as const];
          })
        );
        break;
      }
      case 'tooling': {
        const runs = await getToolingRuns(60);
        const byDay = new Map(runs.filter((r) => r.kind === 'weekly').map((r) => [r.day, r.status]));
        cells = new Map(
          dayList.map((day) => {
            const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
            if (dow !== 1) return [day, 'off' as const]; // weekly job, Monday only
            const status = byDay.get(day);
            if (status === 'completed') return [day, 'completed' as const];
            if (status === 'failed' || status === 'running') return [day, 'failed' as const];
            return [day, 'none' as const];
          })
        );
        break;
      }
      case 'roundup': {
        const rowsR = await q<{ day: string }>(
          `select scope_to::text as day from generated_reports where kind = 'roundup' and scope_to >= $1::date`,
          [dayList[0]]
        );
        const present = new Set(rowsR.map((r) => r.day));
        cells = new Map(
          dayList.map((day) => {
            const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
            if (dow !== 5) return [day, 'off' as const]; // Friday only
            return [day, present.has(day) ? 'completed' as const : 'none' as const];
          })
        );
        break;
      }
      case 'intel-deck':
      case 'edition': {
        const kind = job.readLatest === 'edition' ? 'edition' : 'intel_deck';
        const rowsG = await q<{ day: string }>(
          `select scope_to::text as day from generated_reports where kind = $1 and scope_to >= $2::date`,
          [kind, dayList[0]]
        );
        const present = new Set(rowsG.map((r) => r.day));
        cells = new Map(
          dayList.map((day) => [day, present.has(day) ? 'completed' as const : isWeekendUTC(day) ? 'off' as const : 'none' as const])
        );
        break;
      }
      case 'feeds': {
        const [scanRows, intelRows] = await Promise.all([
          q<{ day: string; notes: string[] }>(`select day::text as day, coalesce(notes, '{}') as notes from scan_runs where day >= $1::date`, [dayList[0]]),
          q<{ day: string; notes: string[] }>(`select day::text as day, coalesce(notes, '{}') as notes from intel_runs where day >= $1::date`, [dayList[0]]),
        ]);
        const swept = new Set(
          [...scanRows, ...intelRows]
            .filter((r) => r.notes.some((n) => n.startsWith('late feed sweep')))
            .map((r) => r.day)
        );
        cells = new Map(dayList.map((day) => [day, swept.has(day) ? 'completed' as const : isWeekendUTC(day) ? 'off' as const : 'none' as const]));
        break;
      }
      case 'agent': {
        const rowsA = await q<{ day: string }>(
          `select distinct created_at::date::text as day from agent_actions where created_at >= $1::date`,
          [dayList[0]]
        );
        const present = new Set(rowsA.map((r) => r.day));
        cells = new Map(dayList.map((day) => [day, present.has(day) ? 'completed' as const : 'none' as const]));
        break;
      }
      case 'agent-brief': {
        const rowsB = await q<{ day: string }>(`select day::text as day from agent_briefs where day >= $1::date`, [dayList[0]]);
        const present = new Set(rowsB.map((r) => r.day));
        cells = new Map(dayList.map((day) => [day, present.has(day) ? 'completed' as const : 'none' as const]));
        break;
      }
      default:
        cells = new Map(dayList.map((day) => [day, 'none' as const]));
    }
    rows.push({ key: job.key, label: job.label, cells: dayList.map((day) => ({ day, state: cells.get(day) ?? 'none' })) });
  }

  return rows;
}

// ---- Background work with no cron of its own --------------------------------
// The Atlas Agent's hourly tick, the pipeline's promotion sweep, and the
// incremental embedding hooks all fire from inside another request rather
// than a dedicated schedule; /ops surfaces them separately from the job list.

export interface OpsBackground {
  embeddingsMissing: number;
  embedSpendUsd: number;
  embedCapUsd: number;
  promotedToday: number;
  agentOpenFindings: number;
  agentHighFindings: number;
}

export async function getOpsBackground(): Promise<OpsBackground> {
  const [missingByKind, embedBudget, promoted, findingCounts] = await Promise.all([
    countMissingEmbeddings(q, embedModel()),
    checkEmbedBudget(),
    one<{ n: number }>(
      `select count(*)::int as n from signals where auto_published_at >= date_trunc('day', now() at time zone 'utc')`
    ),
    one<{ open: number; high: number }>(
      `select count(*) filter (where state = 'open')::int as open,
              count(*) filter (where state = 'open' and severity = 'high')::int as high
         from agent_findings`
    ),
  ]);
  const embeddingsMissing = Object.values(missingByKind).reduce((sum, n) => sum + n, 0);
  return {
    embeddingsMissing,
    embedSpendUsd: embedBudget.spentUsd,
    embedCapUsd: embedBudget.capUsd,
    promotedToday: promoted?.n ?? 0,
    agentOpenFindings: findingCounts?.open ?? 0,
    agentHighFindings: findingCounts?.high ?? 0,
  };
}
