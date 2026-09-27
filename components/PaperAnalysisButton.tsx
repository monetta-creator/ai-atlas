'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hydratePaperAction, analyzePaperAction } from '@/lib/actions';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// Per-paper deep analysis, on demand only: two short server calls (hydrate = fetch +
// cache the full text with its own 60s budget, analyze = the model leg reading the
// cache). A stuck hydrate never blocks analysis (it falls back to the abstract);
// transient analyze failures retry in place. ~$0.10 a click — the human is always
// in front of the expensive call.

const STEPS: StepSpec[] = [
  { key: 'hydrate', label: 'Fetch full text', running: 'Fetching full text…' },
  { key: 'analyze', label: 'Analyze', running: 'Analyzing…', features: ['research_analysis'] },
];

export default function PaperAnalysisButton({
  paperId, hasExtraction,
}: { paperId: string; hasExtraction: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<{ headline?: string; touches?: number; proposedRigor?: number } | null>(null);

  const run = useModelRun({
    kind: 'paper_analysis',
    subject: paperId,
    label: 'Paper analysis',
    steps: STEPS,
    run: async (ctx) => {
      setResult(null);
      try {
        await ctx.step('hydrate', () => hydratePaperAction(paperId), { retries: 3 });
      } catch {
        ctx.note('Could not fetch the full text; analyzing from the abstract instead.');
      }
      const res = await ctx.step('analyze', () => analyzePaperAction(paperId));
      setResult({ headline: res.headline, touches: res.touches, proposedRigor: res.proposedRigor });
      router.refresh();
      return {
        note: `Done: ${res.headline ?? 'finding extracted'} · ${res.touches ?? 0} advisory touches · suggested rigor ${res.proposedRigor ?? '–'}`,
      };
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void (run.status === 'failed' ? run.retry() : run.start())}
          disabled={run.status === 'running'}
          style={run.status === 'running' ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
          {hasExtraction ? '✦ Re-analyze' : '✦ Analyze (fetch full text)'}
        </button>
      </div>
      <ModelRunPanel run={run}>
        {result && (
          <p className="text-xs" style={{ margin: 0, color: 'var(--faint-ink)' }}>
            {result.headline ?? 'finding extracted'} · {result.touches ?? 0} advisory touches · suggested rigor {result.proposedRigor ?? '–'}
          </p>
        )}
      </ModelRunPanel>
    </div>
  );
}
