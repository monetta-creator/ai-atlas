'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { startOrResumeScanAction, scanTickAction } from '@/lib/actions';
import { useTickLoop, type TickRead } from '@/lib/jobs/use-tick-loop';
import TickLoopPanel from '@/components/jobs/TickLoopPanel';

// Client driver for a manual scan run/resume on the shared tick loop
// (lib/jobs/use-tick-loop.ts): each tick is one short server action (at most
// one bounded work unit), looped until the day's run completes. The cron
// windows are the scheduled driver; this exists for troubleshooting and for
// finishing a day the crons could not.

type ScanTick = Awaited<ReturnType<typeof scanTickAction>>;

function readScan(p: ScanTick): TickRead {
  if ('error' in p && p.error) return { error: p.error };
  if (!('counters' in p)) return { done: true };
  const c = p.counters;
  return {
    step: p.step,
    notes: p.notes,
    line: `  ${p.step} · feeds ${c.feedItems} · search ${c.searchItems} · hydrated ${c.hydrated} · enriched ${c.enriched} · skipped ${c.skipped}`,
    busy: p.busy,
    done: p.done,
  };
}

export default function ScanConsole() {
  const router = useRouter();
  const onSettled = useCallback(() => router.refresh(), [router]);
  const loop = useTickLoop({
    engine: 'scan',
    label: 'External scan',
    start: startOrResumeScanAction,
    tick: scanTickAction,
    read: readScan,
    doneLine: '✓ Scan complete. The dataset serves this day as the latest.',
    onSettled,
  });

  return (
    <TickLoopPanel
      loop={loop}
      startLabel="▶ Run / resume today"
      meta="feeds → search → hydrate → enrich, checkpointed per unit"
      subtitle={<>Runs (or resumes) today&apos;s scan: free press feeds, one web search per active topic, full-text hydration, and model enrichment under the daily budget cap. The four weekday cron windows normally do all of this; this button finishes a day they could not.</>}
    />
  );
}
