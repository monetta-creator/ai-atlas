'use client';

import { useState } from 'react';
import { runSavantIssueAction } from '@/lib/actions/savant';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { FeatureStats, UiJob } from '@/lib/jobs/core';
import { SAVANT_ISSUE_STEPS } from '@/lib/savant/issue-steps';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// The desk's run control on the shared run panel (2026-09-27): Run (or
// resume a paused run) for a week, and a two-click Rebuild that replaces the
// week's issue. Each click is one server call of up to 270 seconds that moves
// the week's ui_jobs row leg by leg (poll mode: the panel reads the row every
// two seconds); a call that runs out of time parks the run, and the next
// click, or the next Friday cron window, resumes it. No browser dialogs: a
// second click is the confirmation.
export default function RunIssueButton({
  weekEnd, hasIssue, stats, initialJob,
}: { weekEnd: string; hasIssue: boolean; stats?: FeatureStats | null; initialJob?: UiJob | null }) {
  const [armed, setArmed] = useState(false);
  const [force, setForce] = useState(false);

  const run = useModelRun({
    kind: 'savant_issue',
    subject: weekEnd,
    label: `Savant, week ending ${weekEnd}`,
    steps: SAVANT_ISSUE_STEPS,
    stats,
    initialJob,
    mode: 'poll',
    run: async (ctx) => {
      const r = await runSavantIssueAction(weekEnd, force, ctx.jobId);
      ctx.note(r.message);
      return r.parked ? { parked: r.parked } : { href: r.href };
    },
  });

  const busy = run.status === 'running';
  const paused = run.status === 'paused';
  const go = (rebuild: boolean) => {
    setArmed(false);
    setForce(rebuild);
    const from = paused && !rebuild ? run.steps.find((s) => s.state !== 'done')?.key ?? null : null;
    void run.start({ from });
  };

  return (
    <div className="sv-run">
      <div className="flex items-center gap-2 flex-wrap">
        {(!hasIssue || paused) && (
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => go(false)}>
            {busy ? <><span className="spinner mr-btn-spin" aria-hidden="true" />Running</> : paused ? 'Resume this week\'s issue' : 'Run this week\'s issue'}
          </button>
        )}
        {hasIssue && !paused && !armed && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setArmed(true)}>
            Rebuild this issue
          </button>
        )}
        {hasIssue && armed && (
          <>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => go(true)}>
              Confirm rebuild (replaces the issue)
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setArmed(false)}>Cancel</button>
          </>
        )}
      </div>
      <ModelRunPanel run={run} doneLabel="Read the issue" idleHint={
        run.typical.known ? undefined : <>An issue runs in legs of up to five minutes per click; the Friday cron windows resume a paused run.</>
      } />
    </div>
  );
}
