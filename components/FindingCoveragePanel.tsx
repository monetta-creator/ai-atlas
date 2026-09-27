'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { hydratePaperAction, analyzePaperAction } from '@/lib/actions';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// Batch findings extraction over the reviewed shelf: the portal leads with
// findings, so tracked/noted papers without one are holes in the product. Each
// paper is the same two short server calls the per-paper button makes (hydrate,
// then analyze at ~$0.10); the loop runs client-side so every call fits its own
// 60s budget, and Stop halts between papers.
export default function FindingCoveragePanel({
  reviewed, withFinding, missing,
}: {
  reviewed: number;
  withFinding: number;
  missing: { id: string; title: string }[];
}) {
  const router = useRouter();
  const stopRef = useRef(false);

  const STEPS: StepSpec[] = [
    {
      key: 'papers', label: 'Extract findings', running: 'Extracting findings…',
      features: Array.from({ length: missing.length }, () => 'research_analysis'),
    },
  ];

  const run = useModelRun({
    kind: 'research_finding_coverage',
    label: `Analyze missing findings (${missing.length})`,
    steps: STEPS,
    run: async (ctx) => {
      stopRef.current = false;
      let done = 0;
      await ctx.step('papers', async () => {
        for (const p of missing) {
          if (stopRef.current) {
            ctx.note('Stopped.');
            break;
          }
          ctx.note(`Analyzing: ${p.title.slice(0, 80)}`);
          try {
            const h = await hydratePaperAction(p.id);
            if (!h.ok) ctx.note(`  fetch failed (${h.error ?? 'error'}); analyzing from the abstract`);
            let ok = false;
            for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
              const r = await analyzePaperAction(p.id);
              if (r.ok) {
                ok = true;
                done += 1;
                ctx.note(`  done: ${r.headline ?? 'finding extracted'}`);
              } else if (r.terminal || attempt === 2) {
                ctx.note(`  failed: ${r.error ?? 'analysis error'}`);
              } else {
                await new Promise((res) => setTimeout(res, r.status === 429 ? 10_000 : 3_000));
              }
            }
          } catch (e) {
            ctx.note(`  failed: ${e instanceof Error ? e.message : 'unknown error'}`);
          }
        }
      }, { retries: 1 });
      router.refresh();
      return { note: `Finished: ${done} of ${missing.length} findings extracted.` };
    },
  });

  const busy = run.status === 'running';

  return (
    <div className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span style={{ color: 'var(--dim)' }}>
          {withFinding}/{reviewed} reviewed papers have a structured finding.
        </span>
        {missing.length > 0 && !busy && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void run.start()}>
            ✦ Analyze missing ({missing.length})
          </button>
        )}
        {busy && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { stopRef.current = true; }}>
            Stop after this paper
          </button>
        )}
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          ~$0.10 per paper; the finding renders on the paper page and the portal.
        </span>
      </div>
      <ModelRunPanel run={run} />
    </div>
  );
}
