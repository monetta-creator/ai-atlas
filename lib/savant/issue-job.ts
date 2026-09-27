import { runSavantIssue, type IssueRunOpts, type IssueRunResult } from './issue';
import { SAVANT_ISSUE_STEPS, nextSavantStep } from './issue-steps';
import { createUiJob, markJobStep, finishUiJob, failUiJob, parkUiJob } from '../mutations/jobs';
import { getLatestJobFor } from '../data/jobs';
import { stepsFromSpecs } from '../jobs/core';

// The Friday issue as a registered run (2026-09-27): wraps runSavantIssue so
// every call, from the desk button or a cron window, moves one ui_jobs row
// through the legs. A call that runs out of its time budget parks the job
// (queued, "resumes on the next run") and the next call, a click or the
// 20:20 / 20:40 sweep, picks the same row up; the desk panel polls it.

const ADMIN = { admin: true, keyId: null };

async function resolveJob(weekEnd: string, jobId: string | null | undefined, actor: string, force: boolean): Promise<string> {
  if (jobId) return jobId;
  if (!force) {
    const prev = await getLatestJobFor('savant_issue', weekEnd, ADMIN);
    if (prev && (prev.status === 'running' || prev.status === 'queued')) return prev.id;
  }
  return createUiJob({
    kind: 'savant_issue', subject: weekEnd, label: `Savant, week ending ${weekEnd}`,
    steps: stepsFromSpecs(SAVANT_ISSUE_STEPS), actor,
  });
}

export async function runSavantIssueJob(
  weekEnd: string,
  opts: IssueRunOpts & { jobId?: string | null; actor?: string }
): Promise<IssueRunResult & { jobId: string }> {
  const jobId = await resolveJob(weekEnd, opts.jobId, opts.actor ?? 'admin', !!opts.force);
  const onLeg = async (leg: string, state: 'running' | 'done') => {
    await markJobStep(jobId, leg, state).catch(() => {});
    if (state === 'done') {
      const next = nextSavantStep(leg);
      if (next) await markJobStep(jobId, next, 'running').catch(() => {});
    }
  };
  try {
    const result = await runSavantIssue(weekEnd, { ...opts, onLeg });
    if ('partial' in result) {
      await parkUiJob(jobId, `Paused before ${result.next}: the call used its time budget. The next run resumes here.`);
    } else if ('id' in result) {
      await finishUiJob(jobId, `/savant/${weekEnd}`);
    } else if (result.skipped.startsWith('issue exists')) {
      await finishUiJob(jobId, `/savant/${weekEnd}`);
    } else {
      await failUiJob(jobId, `Skipped: ${result.skipped}`);
    }
    return { ...result, jobId };
  } catch (e) {
    await failUiJob(jobId, e instanceof Error ? e.message : 'savant issue error').catch(() => {});
    throw e;
  }
}
