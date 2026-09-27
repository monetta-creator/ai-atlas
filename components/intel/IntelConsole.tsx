'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { startOrResumeIntelAction, intelTickAction } from '@/lib/actions';
import { useTickLoop, type TickRead } from '@/lib/jobs/use-tick-loop';
import TickLoopPanel from '@/components/jobs/TickLoopPanel';

// Client driver for a manual intel run/resume, on the shared tick loop
// (lib/jobs/use-tick-loop.ts): each tick is one short server action (at most
// one bounded work unit), looped until the day's run completes. The cron
// pair is the scheduled driver; this exists for troubleshooting and for
// finishing a day the crons could not.

type IntelTick = Awaited<ReturnType<typeof intelTickAction>>;

function readIntel(p: IntelTick): TickRead {
  if ('error' in p && p.error) return { error: p.error };
  if (!('counters' in p)) return { done: true };
  const c = p.counters;
  return {
    step: p.step,
    notes: p.notes,
    line: `  ${p.step} · feeds ${c.feedItems} · search ${c.searchItems} · filings ${c.filingItems} · hydrated ${c.hydrated} · enriched ${c.enriched} · skipped ${c.skipped} · facts ${c.facts} · metrics ${c.metrics}`,
    busy: p.busy,
    done: p.done,
  };
}

export default function IntelConsole() {
  const router = useRouter();
  const onSettled = useCallback(() => router.refresh(), [router]);
  const loop = useTickLoop({
    engine: 'intel',
    label: 'Intel desk',
    start: startOrResumeIntelAction,
    tick: intelTickAction,
    read: readIntel,
    doneLine: '✓ Intel run complete. The datasets serve this day as the latest.',
    onSettled,
  });

  return (
    <TickLoopPanel
      loop={loop}
      startLabel="▶ Run / resume today"
      meta="feeds → search → filings → hydrate → enrich, checkpointed per unit"
      subtitle={<>Runs (or resumes) today&apos;s intel sweep: free press feeds, rotating per-company web search, EDGAR filings, full-text hydration, and model enrichment (facts and tags) under the daily budget cap. The two daily crons normally do all of this; this button finishes a day they could not.</>}
    />
  );
}
