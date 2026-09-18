'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startOrResumeToolingAction, toolingTickAction } from '@/lib/actions';
import type { ToolingRun, ToolingRunKind } from '@/lib/types';

const TICK_CAP = 400;
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

interface BudgetSummary { spentUsd: number; capUsd: number }

// One run/resume tick loop, the IntelConsole shape: each tick is one short,
// bounded server action, looped until the run completes, errors, finds the
// lease already held, or the visitor stops it. Called twice below (weekly,
// pull), each call getting its own independent busy/log/clock state.
function useToolingLoop(kind: ToolingRunKind, onSettled: () => void) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);
  const startRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [busy]);

  async function run() {
    if (busy) return;
    stopRef.current = false;
    startRef.current = Date.now();
    setElapsed(0);
    setBusy(true);
    const lines: string[] = [];
    const say = (line: string) => { lines.push(line); setLog([...lines]); };
    try {
      say(`▶ ${kind === 'weekly' ? "this week's run" : 'the big pull'}…`);
      const started = await startOrResumeToolingAction(kind);
      if ('error' in started) { say(`✗ ${started.error}`); return; }
      say(`  run ${started.runId.slice(0, 8)} · day ${started.day}${started.created ? ' · new' : ' · resumed'}`);
      let lastLine = '';
      for (let tick = 0; tick < TICK_CAP; tick++) {
        if (stopRef.current) { say('■ stopped; nothing is lost, resume any time'); return; }
        const p = await toolingTickAction(started.runId);
        if ('error' in p) { say(`✗ ${p.error}`); return; }
        for (const n of p.notes) say(`  · ${n}`);
        const c = p.counters;
        const line = `  ${p.step} · found ${c.found} · inserted ${c.inserted} · hydrated ${c.hydrated} · enriched ${c.enriched} · scored ${c.scored} · cataloged ${c.cataloged} · deep dives ${c.deepDived} · events ${c.events}`;
        if (line !== lastLine) { say(line); lastLine = line; }
        if (p.busy) { say('  another invocation holds the run lease (a cron may be mid-run); try again shortly'); return; }
        if (p.done) { say('✓ run complete.'); return; }
      }
      say('✗ tick cap reached without completion; run again to continue');
    } catch (e) {
      say(`✗ ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy(false);
      onSettled();
    }
  }

  return { busy, log, elapsed, run: () => void run(), stop: () => { stopRef.current = true; } };
}

function LoopPanel({
  run, budget, primary, startLabel, resumeLabel, subtitle, loop,
}: {
  run: ToolingRun | null;
  budget: BudgetSummary | null;
  primary: boolean;
  startLabel: string;
  resumeLabel: string;
  subtitle: string;
  loop: ReturnType<typeof useToolingLoop>;
}) {
  const resumable = !!run && run.status !== 'completed';
  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button className={primary ? 'btn btn--primary' : 'btn'} onClick={loop.run} disabled={loop.busy}>
          {loop.busy ? 'Running…' : resumable ? resumeLabel : startLabel}
        </button>
        {loop.busy && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={loop.stop}>
            Stop after this tick
          </button>
        )}
        {run && (
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            day {run.day} · {run.status} ({run.step})
            {budget ? ` · $${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}` : ''}
          </span>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>{subtitle}</p>
      {loop.busy && (
        <div className="pipeline-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>{loop.log.length ? loop.log[loop.log.length - 1] : 'Working…'}</span>
          <span className="clock">{mmss(loop.elapsed)} elapsed</span>
        </div>
      )}
      {loop.log.length > 0 && (
        <pre
          style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
            background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--dim)',
            maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}
          aria-live="polite"
        >
          {loop.log.join('\n')}
        </pre>
      )}
    </div>
  );
}

// The console's engine strip: "Run / resume this week" (the Monday crons'
// manual fallback) and "Start the big pull" (a one-time, admin-initiated
// enumeration with no cron of its own; see docs/tooling-monitor.md for the
// headless curl loop). Both share the same tick-loop shape; the pull gets an
// upfront cost confirmation since it is the expensive path.
export default function ToolingConsole({
  weeklyRun, weeklyBudget, pullRun, pullBudget,
}: {
  weeklyRun: ToolingRun | null;
  weeklyBudget: BudgetSummary | null;
  pullRun: ToolingRun | null;
  pullBudget: BudgetSummary | null;
}) {
  const router = useRouter();
  const weekly = useToolingLoop('weekly', () => router.refresh());
  const pull = useToolingLoop('pull', () => router.refresh());

  const pullLoop: ReturnType<typeof useToolingLoop> = {
    ...pull,
    run: () => {
      const ok = window.confirm(
        'Start (or resume) the big pull? It enumerates every active category with Sonnet across two passes ' +
        '(leaders, then emerging), roughly $5 to $10 total. It has no cron: stop and resume it from here at ' +
        'any point, or push it headlessly with the curl loop documented in docs/tooling-monitor.md.'
      );
      if (ok) pull.run();
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <LoopPanel
        run={weeklyRun}
        budget={weeklyBudget}
        primary
        startLabel="▶ Run / resume this week"
        resumeLabel="▶ Resume this week's run"
        subtitle="discover, hydrate, enrich, score, finish, events, deep dive, report: checkpointed per unit. The Monday crons normally do all of this; this finishes a week they could not, or runs it on demand."
        loop={weekly}
      />
      <LoopPanel
        run={pullRun}
        budget={pullBudget}
        primary={false}
        startLabel="Start the big pull…"
        resumeLabel="Resume the big pull"
        subtitle="a one-time enumeration of every active category, incumbents and big tech included alongside startups. No cron; resumable from here or headlessly."
        loop={pullLoop}
      />
    </div>
  );
}
