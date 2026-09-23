import { AGENT_CHECKS } from './checks';
import { executeRemedy } from './remedies';
import { isWeekdayUtc, hoursSince } from './time';
import { upsertFindings } from '../mutations/agent';
import { getAgentPrefs, listFindings } from '../data/agent';
import type { CheckContext, FindingInput } from './types';

// The hourly sensor sweep: run every check (each already catches its own
// errors and returns [] on failure; this loop adds a second net so a check
// that throws before its own try/catch still can't take the run down),
// collect every finding, and reconcile the whole set in one transaction.
export async function runChecks(now: Date = new Date()): Promise<{
  opened: number;
  reopened: number;
  updated: number;
  resolved: number;
  checked: number;
  durationMs: number;
}> {
  const start = Date.now();
  const ctx: CheckContext = { now, weekday: isWeekdayUtc(now), hourUtc: now.getUTCHours() };
  const inputs: FindingInput[] = [];
  for (const check of AGENT_CHECKS) {
    try {
      inputs.push(...(await check.run(ctx)));
    } catch (e) {
      console.error(`[agent] check "${check.key}" threw`, e);
    }
  }
  const counts = await upsertFindings(inputs, now);
  return { ...counts, checked: AGENT_CHECKS.length, durationMs: Date.now() - start };
}

// After the checks: every OPEN finding whose remedy is auto-tier gets a
// try, gated by agent_prefs.auto_enabled (the master switch) and by
// executeRemedy's own guards (budget, blackout, the 12h cooldown).
export async function runAutoRemedies(now: Date = new Date()): Promise<{
  attempted: number;
  ok: number;
  failed: number;
}> {
  const prefs = await getAgentPrefs();
  if (!prefs.auto_enabled) return { attempted: 0, ok: 0, failed: 0 };

  const findings = await listFindings({ states: ['open'] });
  let attempted = 0;
  let ok = 0;
  let failed = 0;
  for (const f of findings) {
    if (!f.remedy || f.remedy.tier !== 'auto') continue;
    // The 12h cooldown is checked here as well as in executeRemedy so an
    // hourly tick does not write a refusal row for every waiting finding.
    if (f.last_action_at && hoursSince(f.last_action_at, now) < 12) continue;
    attempted += 1;
    const result = await executeRemedy({
      findingKey: f.key, remedyKey: f.remedy.key, args: f.remedy.args, actor: 'agent', now,
    });
    if (result.ok) ok += 1;
    else failed += 1;
  }
  return { attempted, ok, failed };
}

// The cron entry point: checks, then auto remedies, then (once a day) the
// brief. The brief step is a dynamic import so this file works before WP2
// lands ./brief.ts; a missing/throwing brief module never fails the tick.
export async function runAgentTick(opts: { brief: boolean; now?: Date }): Promise<{
  checks: Awaited<ReturnType<typeof runChecks>>;
  remedies: Awaited<ReturnType<typeof runAutoRemedies>>;
  brief: unknown;
}> {
  const now = opts.now ?? new Date();
  const checks = await runChecks(now);
  const remedies = await runAutoRemedies(now);

  let brief: unknown = null;
  if (opts.brief) {
    try {
      // A non-literal specifier keeps this from being statically resolved:
      // lib/agent/brief.ts is a later work package's deliverable (WP2), so
      // this file must type-check and run before it lands. Once it exists,
      // this dynamically loads and calls it; until then the tick just skips
      // the brief step.
      const briefModulePath = './brief';
      const mod: { runDailyBrief?: (now: Date) => Promise<unknown> } = await import(briefModulePath);
      if (typeof mod.runDailyBrief === 'function') brief = await mod.runDailyBrief(now);
    } catch (e) {
      console.error('[agent] brief step unavailable or failed', e);
    }
  }

  return { checks, remedies, brief };
}
