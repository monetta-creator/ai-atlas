import { AGENT_CHECKS } from './checks';
import { runDailyBrief } from './brief';
import { executeRemedy } from './remedies';
import { isWeekdayUtc, hoursSince } from './time';
import { upsertFindings } from '../mutations/agent';
import { getAgentPrefs, listFindings } from '../data/agent';
import type { CheckContext, FindingInput } from './types';

// The hourly sensor sweep: run every check (this loop catches and logs a
// check that throws, so one failing check can't take the run down, and
// records the failed check keys so the reconciler leaves their findings
// alone instead of resolving them), collect every finding, and reconcile
// the whole set in one transaction.
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
  const failed = new Set<string>();
  for (const check of AGENT_CHECKS) {
    try {
      inputs.push(...(await check.run(ctx)));
    } catch (e) {
      failed.add(check.key);
      console.error(`[agent] check "${check.key}" threw`, e);
    }
  }
  const counts = await upsertFindings(inputs, now, failed);
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

// The cron entry point: checks, then auto remedies, then (once a day, when
// the 12:30 UTC route asks for it) the brief. A throwing brief never fails
// the tick: the checks and remedies above have already landed.
export async function runAgentTick(opts: { brief: boolean; now?: Date }): Promise<{
  checks: Awaited<ReturnType<typeof runChecks>>;
  remedies: Awaited<ReturnType<typeof runAutoRemedies>>;
  brief: Awaited<ReturnType<typeof runDailyBrief>> | null;
}> {
  const now = opts.now ?? new Date();
  const checks = await runChecks(now);
  const remedies = await runAutoRemedies(now);

  let brief: Awaited<ReturnType<typeof runDailyBrief>> | null = null;
  if (opts.brief) {
    try {
      brief = await runDailyBrief(now);
    } catch (e) {
      console.error('[agent] brief step failed', e);
    }
  }

  return { checks, remedies, brief };
}
