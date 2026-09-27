'use client';

import { useState } from 'react';
import {
  prepareSignalFromSourceAction,
  analyzeCandidateAction,
  overrideAndApproveAction,
  completePipelineRunAction,
} from '@/lib/actions';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// Source-page affordance: turn this source into a Signal Board entry through the SAME steps as
// the discovery pipeline — triage (full, can reject), then analysis into a draft. The model
// proposes; the admin reviews/publishes the draft. Each leg is its own server action (its own
// function invocation) so neither LLM leg pushes past the 60s cap; the run is a model run like
// any other, so it survives leaving the page.

const STEPS: StepSpec[] = [
  { key: 'triage', label: 'Triage', running: 'Triaging…', features: ['pipeline_triage'] },
  { key: 'analyze', label: 'Analyze', running: 'Analyzing…', features: ['pipeline_analysis'] },
];

export default function TurnIntoSignalButton({ sourceId }: { sourceId: string }) {
  const [review, setReview] = useState<
    { candidateId: string; runId: string; kind: 'rejected' | 'duplicate'; reason?: string } | null
  >(null);
  const [overriding, setOverriding] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const run = useModelRun({
    kind: 'signal_from_source',
    subject: sourceId,
    label: 'Turn into signal',
    steps: STEPS,
    run: async (ctx, from) => {
      let candidateId: string;
      let runId: string;
      if (from === 'analyze') {
        if (!review) throw new Error('Missing candidate to resume from; triage again.');
        candidateId = review.candidateId;
        runId = review.runId;
      } else {
        setReview(null);
        setOverrideError(null);
        const r = await ctx.step('triage', () => prepareSignalFromSourceAction(sourceId));
        if (r.status === 'exists') {
          return { href: `/signals/${r.signalId}/edit`, note: 'This source already has a signal.' };
        }
        if (r.triage_status !== 'approved') {
          const kind = r.triage_status === 'duplicate' ? 'duplicate' : 'rejected';
          setReview({ candidateId: r.candidateId!, runId: r.runId!, kind, reason: r.reason });
          return { parked: `Triage flagged this source as ${kind}${r.reason ? `: ${r.reason}` : ''}. Review below to override.` };
        }
        candidateId = r.candidateId!;
        runId = r.runId!;
      }
      const res = await ctx.step('analyze', () => analyzeCandidateAction(candidateId));
      await completePipelineRunAction(runId).catch(() => {});
      return {
        href: res.signalId ? `/signals/${res.signalId}/edit` : '/signals',
        note: res.signalId ? undefined : 'Already drafted by a peer.',
      };
    },
  });

  async function createAnyway() {
    if (!review) return;
    setOverriding(true);
    setOverrideError(null);
    try {
      await overrideAndApproveAction(review.candidateId, review.runId);
      await run.start({ from: 'analyze' });
    } catch (e) {
      setOverrideError(`Override failed (${e instanceof Error ? e.message : 'error'}).`);
    } finally {
      setOverriding(false);
    }
  }

  const busy = run.status === 'running' || overriding;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3" style={{ margin: '36px 0 16px' }}>
        <span className="lbl">Signal Board · turn this source into a tracked signal</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void run.start()}
          disabled={busy}
          style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
          ✦ Turn into signal
        </button>
      </div>

      <ModelRunPanel run={run} doneLabel="Open the draft signal" />

      {review && run.status === 'paused' && (
        <div
          className="text-sm"
          style={{
            marginTop: 12,
            padding: '12px 14px',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--surface)',
          }}
        >
          <p style={{ margin: '0 0 8px', color: 'var(--dim)' }}>
            Triage flagged this source as <strong>{review.kind}</strong>
            {review.reason ? <>: {review.reason}</> : null}. It runs the same quality + duplicate
            checks as the discovery pipeline. You can override and create the draft anyway.
          </p>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={createAnyway}
            disabled={busy}
            style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
          >
            {overriding ? 'Overriding…' : 'Create anyway'}
          </button>
          {overrideError && (
            <p className="text-xs" role="alert" style={{ margin: '8px 0 0', color: 'var(--heat-4)' }}>
              {overrideError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
