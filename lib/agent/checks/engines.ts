import { one } from '../../db';
import {
  getDailyJobStatus, getScanHealth, getIntelHealth, getResearchHealth, getToolingHealth,
  getTavilyQuota, getTextCoverage, getZeroYieldDomains, getRoundupForWeek, getToolingReportForWeek,
  getIntelPrefs,
} from '../../data';
import { getIntelDeckForDay } from '../../data/intel-deck';
import { checkPipelineBudget } from '../../pipeline/budget';
import { checkScanBudget } from '../../scan/budget';
import { checkIntelBudget } from '../../intel/budget';
import { checkResearchBudget } from '../../research/budget';
import { remedyRef } from '../remedies';
import { daysSince, mondayUtc, lastFridayUtc } from '../time';
import { JOB_KEYS, type AgentCheck, type FindingInput, type JobKey, type Severity } from '../types';

// Engine checks (the plan's Engines table): the four daily jobs' run health
// (via getDailyJobStatus, so state semantics match the lobby widget exactly),
// daily budgets, the Tavily quota, retained-text coverage, zero-yield
// domains, and the two weekly reports' presence. A check that throws is
// caught and recorded by runChecks; its findings are kept.

const CONSOLE: Record<JobKey, string> = {
  scan: '/scan', pipeline: '/pipeline', intel: '/intel', research: '/research/console', tooling: '/tooling/console',
};
const PREFS_TABLE: Record<JobKey, string> = {
  scan: 'scan_prefs', pipeline: 'pipeline_prefs', intel: 'intel_prefs', research: 'research_prefs', tooling: 'tooling_prefs',
};

// engine.failed / engine.no_run: sourced from getDailyJobStatus, the same
// read the lobby's cron tracker widget uses, so a finding's state always
// agrees with what Kevin sees there. Covers the four daily jobs only
// (scan/pipeline/intel/research); tooling is weekly and checked separately
// below (engine.paused; budget is out of scope for it, see the report).
const engineDailyStatus: AgentCheck = {
  key: 'engine.daily_status',
  title: 'Daily engine run status',
  domain: 'engines',
  run: async (ctx) => {
    const status = await getDailyJobStatus();
    const out: FindingInput[] = [];
    for (const job of status.jobs) {
      if (job.state === 'failed') {
        out.push({
          key: `engine.failed:${job.key}`, checkKey: 'engine.failed', subject: job.key, severity: 'high',
          title: `${job.label} run failed`,
          detail: `Today's ${job.label} run failed${job.error ? `: ${job.error}` : ''}. The agent can try resuming the existing run, or open the console to look closer.`,
          metric: { error: job.error }, href: job.console,
          remedy: remedyRef('engine.resume', `Resume the failed ${job.label} run`, { job: job.key }),
        });
      } else if (job.yesterdayIncomplete) {
        out.push({
          key: `engine.failed:${job.key}:yesterday`, checkKey: 'engine.failed', subject: `${job.key}:yesterday`, severity: 'high',
          title: `${job.label}: yesterday's run never finished`,
          detail: `Yesterday's ${job.label} run was left running or failed and nothing resumed it. Today's run may also be affected; check the console.`,
          metric: {}, href: job.console, remedy: null,
        });
      }
      if (job.state === 'pending' && ctx.hourUtc >= 17) {
        out.push({
          key: `engine.no_run:${job.key}`, checkKey: 'engine.no_run', subject: job.key, severity: 'high',
          title: `${job.label}: no run yet today`,
          detail: `It's past 17:00 UTC on a weekday and ${job.label} has no run row for today. The cron may be misfiring; open the console to kick it by hand.`,
          metric: {}, href: job.console, remedy: remedyRef('engine.kick', `Start today's ${job.label} run`, { job: job.key }),
        });
      }
    }
    return out;
  },
};

const engineMissedDays: AgentCheck = {
  key: 'engine.missed_days',
  title: 'Missed engine days (30d)',
  domain: 'engines',
  run: async () => {
    const [scan, intel, research] = await Promise.all([getScanHealth(30), getIntelHealth(30), getResearchHealth(30)]);
    const rows: { job: JobKey; missed: number }[] = [
      { job: 'scan', missed: scan.runs.missedDays },
      { job: 'intel', missed: intel.runs.missedDays },
      { job: 'research', missed: research.runs.missedDays },
    ];
    return rows
      .filter((r) => r.missed > 0)
      .map((r) => ({
        key: `engine.missed_days:${r.job}`, checkKey: 'engine.missed_days', subject: r.job, severity: 'info' as Severity,
        title: `${r.job}: ${r.missed} missed weekday(s) in the last 30 days`,
        detail: `${r.job} has ${r.missed} weekday(s) with no run in the last 30 days.`,
        metric: { missed: r.missed }, href: CONSOLE[r.job], remedy: null,
      }));
  },
};

const enginePaused: AgentCheck = {
  key: 'engine.paused',
  title: 'Paused engines',
  domain: 'engines',
  run: async (ctx) => {
    const out: FindingInput[] = [];
    for (const job of JOB_KEYS) {
      const row = await one<{ enabled: boolean; updated_at: string }>(
        `select enabled, updated_at::text as updated_at from ${PREFS_TABLE[job]} where id = true`
      );
      if (!row || row.enabled) continue;
      const days = Math.floor(daysSince(row.updated_at, ctx.now));
      if (days <= 3) continue;
      out.push({
        key: `engine.paused:${job}`, checkKey: 'engine.paused', subject: job, severity: 'info',
        title: `${job} has been paused for ${days} day${days === 1 ? '' : 's'}`,
        detail: `The ${job} engine's cron toggle has been off for ${days} day${days === 1 ? '' : 's'}. Turn it back on if that wasn't deliberate.`,
        metric: { days }, href: CONSOLE[job], remedy: remedyRef('engine.enable', `Turn ${job} back on`, { job }),
      });
    }
    return out;
  },
};

// Budget checks route through each engine's own check*Budget (same guard the
// engine itself uses before a billable unit). Tooling is excluded: its
// checkToolingBudget needs a run id and kind, not a stateless daily read.
const budgetNearCap: AgentCheck = {
  key: 'budget.near_cap',
  title: 'Daily budget near cap',
  domain: 'engines',
  run: async () => {
    const status = await getDailyJobStatus();
    const checks: { job: JobKey; run: () => Promise<{ ok: boolean; spentUsd: number; capUsd: number }> }[] = [
      { job: 'pipeline', run: checkPipelineBudget },
      { job: 'scan', run: checkScanBudget },
      { job: 'intel', run: checkIntelBudget },
      { job: 'research', run: checkResearchBudget },
    ];
    const out: FindingInput[] = [];
    for (const c of checks) {
      const { spentUsd, capUsd } = await c.run();
      const pct = capUsd > 0 ? spentUsd / capUsd : 0;
      if (pct < 0.9) continue;
      const jobStatus = status.jobs.find((j) => j.key === c.job);
      const incomplete = jobStatus ? jobStatus.state !== 'done' : false;
      const severity: Severity = pct >= 1 && incomplete ? 'high' : 'warn';
      out.push({
        key: `budget.near_cap:${c.job}`, checkKey: 'budget.near_cap', subject: c.job, severity,
        title: `${c.job} spend at ${Math.round(pct * 100)}% of today's budget`,
        detail: `$${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)} spent on ${c.job} today.` +
          (incomplete && pct >= 1 ? ` The run is not done; remaining work may be skipped until tomorrow.` : ''),
        metric: { spentUsd, capUsd, pct: Math.round(pct * 100) }, href: jobStatus?.console ?? CONSOLE[c.job], remedy: null,
      });
    }
    return out;
  },
};

const tavilyQuota: AgentCheck = {
  key: 'tavily.quota',
  title: 'Tavily monthly quota',
  domain: 'engines',
  run: async () => {
    const q = await getTavilyQuota();
    if (q.pctUsed < 0.85 && !q.capHit) return [];
    const severity: Severity = q.capHit ? 'high' : 'warn';
    return [{
      key: 'tavily.quota', checkKey: 'tavily.quota', severity,
      title: q.capHit ? 'Tavily monthly cap hit' : `Tavily quota at ${Math.round(q.pctUsed * 100)}%`,
      detail: q.capHit
        ? `Tavily's monthly query cap has been hit (${q.used} of ${q.cap}). Once Tavily returns 432, the scan, pipeline and intel engines skip their remaining search legs for the day with one run note (feeds, filings and metrics still run). When credits are back, recover the day with /api/cron/{scan,intel}?rerun=search or /api/cron/pipeline?rerun=discovery (outside 00:00-09:00 UTC).`
        : `Tavily usage is at ${Math.round(q.pctUsed * 100)}% of the monthly cap (${q.used} of ${q.cap}), projected ${q.projected} by month end.`,
      metric: { used: q.used, cap: q.cap, projected: q.projected }, href: '/intel', remedy: null,
    }];
  },
};

const textCoverage: AgentCheck = {
  key: 'text.coverage',
  title: 'Retained article text coverage',
  domain: 'engines',
  run: async () => {
    const cov = await getTextCoverage();
    const ratio = cov.total > 0 ? cov.with_text / cov.total : 1;
    if (cov.total === 0 || ratio >= 0.95) return [];
    const missing = cov.total - cov.with_text;
    return [{
      key: 'text.coverage', checkKey: 'text.coverage', severity: 'warn',
      title: `Article text coverage: ${cov.with_text}/${cov.total}`,
      detail: `${missing} published signal(s) are missing retained article text (${Math.round(ratio * 100)}% coverage). The refetch remedy tries up to 5 per run.`,
      metric: { withText: cov.with_text, total: cov.total }, href: '/pipeline',
      remedy: remedyRef('text.refetch_missing', 'Refetch missing article text (up to 5)'),
    }];
  },
};

const pipelineZeroYield: AgentCheck = {
  key: 'pipeline.zero_yield',
  title: 'Zero-yield domains',
  domain: 'engines',
  run: async () => {
    const domains = await getZeroYieldDomains();
    if (domains.length < 10) return [];
    return [{
      key: 'pipeline.zero_yield', checkKey: 'pipeline.zero_yield', severity: 'info',
      title: `${domains.length} domains are zero-yield`,
      detail: `${domains.length} source domains have never yielded an approved candidate in the last 90 days and are now blocked from discovery. Review the list on /pipeline.`,
      metric: { count: domains.length }, href: '/pipeline', remedy: null,
    }];
  },
};

const reportsRoundupMissing: AgentCheck = {
  key: 'reports.roundup_missing',
  title: 'Weekly research roundup',
  domain: 'engines',
  run: async (ctx) => {
    const dow = ctx.now.getUTCDay(); // 0 Sun .. 6 Sat
    const fridayLate = dow === 5 && ctx.now.getUTCHours() >= 22;
    const weekendOrMonday = dow === 0 || dow === 6 || dow === 1;
    if (!fridayLate && !weekendOrMonday) return [];
    const weekEnd = lastFridayUtc(ctx.now);
    const existing = await getRoundupForWeek(weekEnd);
    if (existing) return [];
    return [{
      key: 'reports.roundup_missing', checkKey: 'reports.roundup_missing', severity: 'warn',
      title: `Weekly roundup missing for the week ending ${weekEnd}`,
      detail: `No research roundup exists for the week ending ${weekEnd} yet. It should have generated Friday 21:00 UTC.`,
      metric: { weekEnd }, href: '/research/console',
      remedy: remedyRef('reports.roundup', 'Generate the weekly research roundup'),
    }];
  },
};

const reportsEntrantsMissing: AgentCheck = {
  key: 'reports.entrants_missing',
  title: 'Weekly tooling entrants report',
  domain: 'engines',
  run: async (ctx) => {
    const dow = ctx.now.getUTCDay();
    if (!(dow === 1 && ctx.now.getUTCHours() >= 18)) return [];
    const monday = mondayUtc(ctx.now);
    const existing = await getToolingReportForWeek('tooling_entrants', monday);
    if (existing) return [];
    return [{
      key: 'reports.entrants_missing', checkKey: 'reports.entrants_missing', severity: 'warn',
      title: `Tooling entrants report missing for the week of ${monday}`,
      detail: `No tooling_entrants report exists for the week starting ${monday} yet. It should have generated as part of Monday's weekly run.`,
      metric: { weekStart: monday }, href: '/tooling/console',
      remedy: remedyRef('reports.entrants', "Generate this week's tooling entrants report"),
    }];
  },
};

const reportsIntelDeckMissing: AgentCheck = {
  key: 'reports.intel_deck_missing',
  title: 'Daily company intel deck',
  domain: 'engines',
  run: async (ctx) => {
    const dow = ctx.now.getUTCDay();
    if (dow < 1 || dow > 5) return [];
    const minutesUtc = ctx.now.getUTCHours() * 60 + ctx.now.getUTCMinutes();
    if (minutesUtc < 16 * 60 + 40) return [];
    const prefs = await getIntelPrefs();
    if (!prefs.deck_enabled) return [];
    const today = ctx.now.toISOString().slice(0, 10);
    const existing = await getIntelDeckForDay(today);
    if (existing) return [];
    return [{
      key: 'reports.intel_deck_missing', checkKey: 'reports.intel_deck_missing', severity: 'warn',
      title: `Company intel deck missing for ${today}`,
      detail: `No company intel deck exists for ${today} yet. It should have generated at 16:20 UTC via the /api/cron/intel-deck cron.`,
      metric: { day: today }, href: '/intel',
      remedy: remedyRef('reports.intel_deck', "Generate today's company intel deck"),
    }];
  },
};

const ERROR_NOTE_RE = /error|429|timeout|quota/i;

const notesErrors: AgentCheck = {
  key: 'notes.errors',
  title: 'Error notes in the last 2 days',
  domain: 'engines',
  run: async () => {
    const [scan, intel, research, tooling] = await Promise.all([
      getScanHealth(2), getIntelHealth(2), getResearchHealth(2), getToolingHealth(1),
    ]);
    const sources: { job: string; href: string; issues: { day: string; note: string }[] }[] = [
      { job: 'scan', href: '/scan', issues: scan.issues },
      { job: 'intel', href: '/intel', issues: intel.issues },
      { job: 'research', href: '/research/console', issues: research.issues },
      { job: 'tooling', href: '/tooling/console', issues: tooling.issues },
    ];
    const out: FindingInput[] = [];
    for (const s of sources) {
      const hits = s.issues.filter((i) => ERROR_NOTE_RE.test(i.note));
      if (!hits.length) continue;
      out.push({
        key: `notes.errors:${s.job}`, checkKey: 'notes.errors', subject: s.job, severity: 'info',
        title: `${s.job}: ${hits.length} error note(s) in the last 2 days`,
        detail: `${hits.length} run note(s) mention an error, rate limit, timeout or quota in the last 2 days. Latest: "${hits[0].note.slice(0, 140)}"${hits.length > 1 ? ' (plus more)' : ''}.`,
        metric: { count: hits.length }, href: s.href, remedy: null,
      });
    }
    return out;
  },
};

export const ENGINE_CHECKS: AgentCheck[] = [
  engineDailyStatus,
  engineMissedDays,
  enginePaused,
  budgetNearCap,
  tavilyQuota,
  textCoverage,
  pipelineZeroYield,
  reportsRoundupMissing,
  reportsEntrantsMissing,
  reportsIntelDeckMissing,
  notesErrors,
];
