'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { startOrResumeToolingAction, toolingTickAction } from '@/lib/actions';
import type { ToolingRun } from '@/lib/types';
import { useTickLoop, type TickRead } from '@/lib/jobs/use-tick-loop';
import TickLoopPanel from '@/components/jobs/TickLoopPanel';

interface BudgetSummary { spentUsd: number; capUsd: number }

type ToolingTick = Awaited<ReturnType<typeof toolingTickAction>>;

function readTooling(p: ToolingTick): TickRead {
  if ('error' in p) return { error: p.error };
  const c = p.counters;
  return {
    step: p.step,
    notes: p.notes,
    line: `  ${p.step} · found ${c.found} · inserted ${c.inserted} · hydrated ${c.hydrated} · enriched ${c.enriched} · scored ${c.scored} · cataloged ${c.cataloged} · deep dives ${c.deepDived} · events ${c.events}`,
    busy: p.busy,
    done: p.done,
  };
}

function ToolingMeta({ run, budget }: { run: ToolingRun | null; budget: BudgetSummary | null }) {
  if (!run) return null;
  return (
    <>day {run.day} · {run.status} ({run.step}){budget ? ` · $${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}` : ''}</>
  );
}

const startWeekly = () => startOrResumeToolingAction('weekly');
const startPull = () => startOrResumeToolingAction('pull');

// The console's engine strip: "Run / resume this week" (the Monday crons'
// manual fallback) and "Start the big pull" (a one-time, admin-initiated
// enumeration with no cron of its own; see docs/tooling-monitor.md for the
// headless curl loop). Both run on the shared tick loop
// (lib/jobs/use-tick-loop.ts); the pull gets an upfront cost confirmation
// since it is the expensive path.
export default function ToolingConsole({
  weeklyRun, weeklyBudget, pullRun, pullBudget,
}: {
  weeklyRun: ToolingRun | null;
  weeklyBudget: BudgetSummary | null;
  pullRun: ToolingRun | null;
  pullBudget: BudgetSummary | null;
}) {
  const router = useRouter();
  const onSettled = useCallback(() => router.refresh(), [router]);

  const weekly = useTickLoop({
    engine: 'tooling',
    label: 'Tooling monitor, this week',
    start: startWeekly,
    tick: toolingTickAction,
    read: readTooling,
    doneLine: '✓ Run complete.',
    onSettled,
  });

  const pull = useTickLoop({
    engine: 'tooling',
    label: 'Tooling monitor, big pull',
    start: startPull,
    tick: toolingTickAction,
    read: readTooling,
    doneLine: '✓ Run complete.',
    onSettled,
  });

  const runPull = useCallback(() => {
    const ok = window.confirm(
      'Start (or resume) the big pull? It enumerates every active category with Sonnet across two passes ' +
      '(leaders, then emerging), roughly $5 to $10 total. It has no cron: stop and resume it from here at ' +
      'any point, or push it headlessly with the curl loop documented in docs/tooling-monitor.md.'
    );
    if (ok) pull.run();
  }, [pull]);

  return (
    <div className="flex flex-col gap-4">
      <TickLoopPanel
        loop={weekly}
        startLabel="▶ Run / resume this week"
        resumeLabel="▶ Resume this week's run"
        resumable={!!weeklyRun && weeklyRun.status !== 'completed'}
        meta={<ToolingMeta run={weeklyRun} budget={weeklyBudget} />}
        subtitle="Discover, hydrate, enrich, score, finish, events, deep dive, report: checkpointed per unit. The Monday crons normally do all of this; this finishes a week they could not, or runs it on demand."
      />
      <TickLoopPanel
        loop={{ ...pull, run: runPull }}
        primary={false}
        startLabel="Start the big pull…"
        resumeLabel="Resume the big pull"
        resumable={!!pullRun && pullRun.status !== 'completed'}
        meta={<ToolingMeta run={pullRun} budget={pullBudget} />}
        subtitle="A one-time enumeration of every active category, incumbents and big tech included alongside startups. No cron; resumable from here or headlessly."
      />
    </div>
  );
}
