'use client';

import { useState } from 'react';
import {
  preparePaperPromotionAction,
  analyzeCandidateAction,
  overrideAndApproveAction,
  completePipelineRunAction,
  linkPaperToSignalAction,
} from '@/lib/actions';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// Paper-page affordance: promote this paper to the Signal Board through the SAME
// steps as a manual source — triage (full, can reject), then analysis into a draft.
// Promotion is additive (the paper stays in the research library, linked by
// signal_id); publishing the draft is still the human gate that writes evidence.

const STEPS: StepSpec[] = [
  { key: 'triage', label: 'Triage', running: 'Triaging…', features: ['pipeline_triage'] },
  { key: 'analyze', label: 'Analyze', running: 'Analyzing…', features: ['pipeline_analysis'] },
];

export default function PromotePaperButton({ paperId }: { paperId: string }) {
  const [review, setReview] = useState<
    { candidateId: string; runId: string; kind: 'rejected' | 'duplicate'; reason?: string } | null
  >(null);
  const [overriding, setOverriding] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const run = useModelRun({
    kind: 'paper_promotion',
    subject: paperId,
    label: 'Promote to signal',
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
        const r = await ctx.step('triage', () => preparePaperPromotionAction(paperId));
        if (r.status === 'exists') {
          return { href: `/signals/${r.signalId}/edit`, note: 'This paper already has a signal.' };
        }
        if (r.triage_status !== 'approved') {
          const kind = r.triage_status === 'duplicate' ? 'duplicate' : 'rejected';
          setReview({ candidateId: r.candidateId!, runId: r.runId!, kind, reason: r.reason });
          return { parked: `Triage flagged this paper as ${kind}${r.reason ? `: ${r.reason}` : ''}. Review below to override.` };
        }
        candidateId = r.candidateId!;
        runId = r.runId!;
      }
      const res = await ctx.step('analyze', () => analyzeCandidateAction(candidateId));
      await completePipelineRunAction(runId).catch(() => {});
      if (res.signalId) {
        await linkPaperToSignalAction(paperId, res.signalId).catch(() => {});
        return { href: `/signals/${res.signalId}/edit` };
      }
      return { href: '/signals', note: 'Already drafted by a peer.' };
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
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void run.start()}
          disabled={busy}
          style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
          ✦ Promote to signal
        </button>
      </div>

      <ModelRunPanel run={run} doneLabel="Open the draft signal" />

      {review && run.status === 'paused' && (
        <div className="text-sm" style={{
          marginTop: 12, padding: '12px 14px', border: '1px solid var(--line)',
          borderRadius: 8, background: 'var(--surface)',
        }}>
          <p style={{ margin: '0 0 8px', color: 'var(--dim)' }}>
            Triage flagged this paper as <strong>{review.kind}</strong>
            {review.reason ? <>: {review.reason}</> : null}. You can override and create the draft anyway.
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={createAnyway} disabled={busy}>
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
