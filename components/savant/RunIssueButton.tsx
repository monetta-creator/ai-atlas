'use client';

import { useState, useTransition } from 'react';
import { runSavantIssueAction } from '@/lib/actions/savant';

// The desk's run control: Run (or resume a parked run) for a week, and a
// two-click Rebuild that deletes the week's issue and starts over. Each click
// is one server call of up to 270 seconds; a parked run says so and asks for
// another click. No browser dialogs (they block automation), a second click
// is the confirmation.
export default function RunIssueButton({ weekEnd, hasIssue }: { weekEnd: string; hasIssue: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const run = (force: boolean) => {
    setArmed(false);
    setMsg(force ? 'Rebuilding: research, writing, editing. Up to five minutes per click.' : 'Running: research, writing, editing. Up to five minutes per click.');
    start(async () => {
      try {
        setMsg(await runSavantIssueAction(weekEnd, force));
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'The run failed.');
      }
    });
  };

  return (
    <div className="sv-run">
      <div className="flex items-center gap-2 flex-wrap">
        {!hasIssue && (
          <button type="button" className="btn btn--sm" disabled={pending} onClick={() => run(false)}>
            {pending ? 'Working…' : 'Run this week\'s issue'}
          </button>
        )}
        {hasIssue && !armed && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => setArmed(true)}>
            Rebuild this issue
          </button>
        )}
        {hasIssue && armed && (
          <>
            <button type="button" className="btn btn--sm" disabled={pending} onClick={() => run(true)}>
              {pending ? 'Working…' : 'Confirm rebuild (replaces the issue)'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setArmed(false)}>Cancel</button>
          </>
        )}
      </div>
      {msg && <p className="sv-run-msg">{msg}</p>}
    </div>
  );
}
