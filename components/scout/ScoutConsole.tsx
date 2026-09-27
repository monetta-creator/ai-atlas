'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  startScoutRunAction, discoverScoutBatchAction, completeScoutRunAction, failScoutRunAction,
} from '@/lib/actions';
import { useModelRun, type RunCtx } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

const STEPS: StepSpec[] = [
  { key: 'discovery', label: 'Discovery', running: 'Searching the web for young AI companies…', features: ['scout_discovery'] },
];

// Client orchestrator for a scout discovery run, mirroring ResearchConsole:
// each vertical query batch is its own short server action (<=2 web searches,
// under the 60s cap), retried once on failure. Inserts are checkpointed and
// globally deduped server-side, so a stopped run loses nothing. On the shared
// model-run registry (lib/jobs/use-model-run.ts): one phase, one ctx.step().
export default function ScoutConsole({ activeVerticals }: { activeVerticals: number }) {
  const router = useRouter();
  const runIdRef = useRef<string | null>(null);

  async function runDiscoveryPhase(ctx: RunCtx) {
    ctx.note('▶ Scout discovery…');
    const { runId, plan } = await startScoutRunAction();
    runIdRef.current = runId;
    ctx.note(`  run ${runId.slice(0, 8)} · ${plan.length} batch${plan.length === 1 ? '' : 'es'} across the active verticals`);
    let found = 0;
    let inserted = 0;
    for (const ref of plan) {
      let res: { found: number; inserted: number } | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          res = await discoverScoutBatchAction(runId, ref.vertical, ref.batchIndex);
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'error';
          if (attempt === 1) ctx.note(`  ↻ ${ref.vertical} batch ${ref.batchIndex + 1}: ${msg}, retrying`);
          else throw e;
        }
      }
      if (!res) continue;
      found += res.found;
      inserted += res.inserted;
      ctx.note(`  ${ref.vertical} batch ${ref.batchIndex + 1}: ${res.found} found → ${res.inserted} new (run total ${inserted})`);
    }
    await completeScoutRunAction(runId);
    ctx.note(`✓ Discovery done: ${found} companies found · ${inserted} new in the queue.`);
    if (inserted === 0) ctx.note('  (Everything found was already in the library, or the searches came up dry.)');
  }

  const run = useModelRun({
    kind: 'engine:scout',
    label: 'Scout discovery',
    steps: STEPS,
    run: async (ctx) => {
      try {
        await ctx.step('discovery', () => runDiscoveryPhase(ctx), { retries: 1 });
        router.refresh();
        return { note: '✓ Done.' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'error';
        const rid = runIdRef.current;
        if (rid) await failScoutRunAction(rid, msg).catch(() => {});
        router.refresh();
        throw e;
      }
    },
  });

  const busy = run.status === 'running';

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn--primary" onClick={() => void run.start()} disabled={busy}>
          {busy ? <><span className="spinner mr-btn-spin" aria-hidden="true" />Running</> : '▶ Run discovery'}
        </button>
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          {activeVerticals} active vertical{activeVerticals === 1 ? '' : 's'} · 2 web searches per batch
        </span>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Searches the web per vertical for young AI companies (pre-seed through Series B),
        dedupes against the whole library, and queues the new ones for review. Each batch
        is its own short call with progress saved after it, so a run can be stopped and
        rerun safely. Nothing runs on a schedule.
      </p>

      <ModelRunPanel run={run} doneLabel="Open the queue" />
    </div>
  );
}
