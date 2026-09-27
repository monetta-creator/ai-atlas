'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { researchTickAction } from '@/lib/actions';
import { useTickLoop, type TickRead } from '@/lib/jobs/use-tick-loop';
import TickLoopPanel from '@/components/jobs/TickLoopPanel';

// Client driver for a manual research-engine run/resume, on the shared tick
// loop (lib/jobs/use-tick-loop.ts). researchTickAction always operates on
// today's run (created lazily on first call) and takes no run id, so unlike
// scan/intel there is no separate start action: `start` below calls it once
// to learn the run id and day (that first call also performs the run's first
// work unit, same as calling it directly), then the loop's `tick` calls it
// again each round, ignoring the run id the loop threads through (research
// does not need one). The two daily crons are the scheduled driver; this
// exists for troubleshooting and for finishing a day the crons could not.

type ResearchTick = Awaited<ReturnType<typeof researchTickAction>>;

async function startOrResumeResearch(): Promise<{ runId: string; day: string } | { error: string }> {
  const p = await researchTickAction();
  if ('error' in p && p.error) return { error: p.error };
  if (!('runId' in p)) return { error: 'The research run did not start.' };
  return { runId: p.runId, day: p.day };
}

function readResearch(p: ResearchTick): TickRead {
  if ('error' in p && p.error) return { error: p.error };
  if (!('counters' in p)) return { done: true };
  const c = p.counters;
  return {
    step: p.step,
    notes: p.notes,
    line: `  ${p.step} · scanned ${c.scanned} · pulled ${c.pulled} · kept ${c.kept} · rejected ${c.rejected} · agent ${c.agentProcessed} · analyzed ${c.analyzed}`,
    busy: p.busy,
    done: p.done,
  };
}

export default function ResearchEnginePanel() {
  const router = useRouter();
  const onSettled = useCallback(() => router.refresh(), [router]);
  const loop = useTickLoop({
    engine: 'research',
    label: 'Research engine',
    start: startOrResumeResearch,
    tick: tickResearch,
    read: readResearch,
    doneLine: '✓ Research run complete for today.',
    onSettled,
  });

  return (
    <TickLoopPanel
      loop={loop}
      startLabel="▶ Run / resume today"
      meta="pull → triage → agent → analyze, checkpointed per unit"
      subtitle={<>Runs (or resumes) today&apos;s engine run: arXiv pull, triage against the Atlas, the recommend-only queue agent, and per-paper finding extraction under the daily budget cap. The two daily crons normally do all of this; this button finishes a day they could not.</>}
    />
  );
}

// The loop's tick signature threads a run id through (scan/intel need it);
// research does not, so this adapter ignores it.
function tickResearch(): Promise<ResearchTick> {
  return researchTickAction();
}
