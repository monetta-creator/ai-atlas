'use server';

import { revalidatePath } from 'next/cache';
import { getFindingByKey } from '../data/agent';
import * as m from '../mutations';
import { executeRemedy, REMEDIES } from '../agent/remedies';
import { runChecks } from '../agent/runner';
import type { AgentPrefs, FindingState, RemedyResult } from '../agent/types';
import { requireAdmin } from './shared';

// ===== The Atlas Agent (admin console + drawer) ==============================
// Typed-arg actions (not form-driven): the drawer and the chat's run_remedy
// tool both call these directly. Every remedy this file can trigger is
// re-checked by executeRemedy itself (tier, budget, blackout, cooldown), so
// these actions stay thin: authenticate, call, revalidate.

function revalidateAgentSurfaces(): void {
  revalidatePath('/agent');
  revalidatePath('/signals/drafts');
}

// Run the remedy already attached to a finding (the drawer's "Do it" button).
export async function runRemedyAction(findingKey: string): Promise<RemedyResult> {
  await requireAdmin();
  const finding = await getFindingByKey(findingKey);
  if (!finding) return { ok: false, error: 'Finding not found.', summary: 'Finding not found.' };
  if (!finding.remedy) return { ok: false, error: 'This finding has no remedy.', summary: 'This finding has no remedy.' };
  const result = await executeRemedy({
    findingKey, remedyKey: finding.remedy.key, args: finding.remedy.args, actor: 'kevin',
  });
  revalidateAgentSurfaces();
  return result;
}

// Run a remedy by key with explicit args, not tied to a specific finding
// (the chat's run_remedy tool, or a console action with no finding card).
export async function runRemedyByKeyAction(
  remedyKey: string,
  args?: Record<string, unknown>
): Promise<RemedyResult> {
  await requireAdmin();
  if (!REMEDIES[remedyKey]) return { ok: false, error: `Unknown remedy: ${remedyKey}`, summary: `Unknown remedy: ${remedyKey}` };
  const result = await executeRemedy({ findingKey: null, remedyKey, args, actor: 'kevin' });
  revalidateAgentSurfaces();
  return result;
}

export async function setFindingStateAction(
  key: string,
  state: FindingState,
  snoozeDays?: number
): Promise<void> {
  await requireAdmin();
  await m.setFindingState(key, state, { snoozeDays });
  revalidatePath('/agent');
}

export async function markFindingsSeenAction(keys: string[]): Promise<void> {
  await requireAdmin();
  await m.markFindingsSeen(Array.isArray(keys) ? keys.slice(0, 200) : []);
  revalidatePath('/agent');
}

export async function saveAgentPrefsAction(patch: Partial<AgentPrefs>): Promise<void> {
  await requireAdmin();
  await m.saveAgentPrefs(patch);
  revalidatePath('/agent');
}

export async function runChecksNowAction(): Promise<{
  opened: number; reopened: number; updated: number; resolved: number; checked: number; durationMs: number;
}> {
  await requireAdmin();
  const result = await runChecks();
  revalidatePath('/agent');
  return result;
}

// Guarded dynamic import: lib/agent/brief.ts is a later work package's
// deliverable, so this action must type-check and run before it lands.
export async function runBriefNowAction(): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    const briefModulePath = '../agent/brief';
    const mod: { runDailyBrief?: (now: Date) => Promise<unknown> } = await import(briefModulePath);
    if (typeof mod.runDailyBrief !== 'function') return { ok: false, error: 'The daily brief is not wired up yet.' };
    await mod.runDailyBrief(new Date());
    revalidatePath('/agent');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The daily brief is not wired up yet.' };
  }
}
