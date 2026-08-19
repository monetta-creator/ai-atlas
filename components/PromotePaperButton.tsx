'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  preparePaperPromotionAction,
  analyzeCandidateAction,
  overrideAndApproveAction,
  completePipelineRunAction,
  linkPaperToSignalAction,
} from '@/lib/actions';

// Paper-page affordance: promote this paper to the Signal Board through the SAME
// steps as a manual source — triage (full, can reject), then analysis into a draft.
// Promotion is additive (the paper stays in the research library, linked by
// signal_id); publishing the draft is still the human gate that writes evidence.
export default function PromotePaperButton({ paperId }: { paperId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [review, setReview] = useState<
    { candidateId: string; runId: string; kind: 'rejected' | 'duplicate'; reason?: string } | null
  >(null);

  async function analyzeAndGo(candidateId: string, runId: string) {
    setStatus('Analyzing…');
    const res = await analyzeCandidateAction(candidateId);
    if (!res.ok) {
      setError(true);
      setStatus(`Analysis failed (${res.error ?? 'error'}).`);
      return;
    }
    await completePipelineRunAction(runId).catch(() => {});
    if (res.signalId) {
      await linkPaperToSignalAction(paperId, res.signalId).catch(() => {});
      router.push(`/signals/${res.signalId}/edit`);
    } else {
      router.push('/signals');
    }
  }

  async function run() {
    setBusy(true);
    setError(false);
    setReview(null);
    setStatus('Triaging…');
    try {
      const r = await preparePaperPromotionAction(paperId);
      if (r.status === 'exists') {
        setStatus('This paper already has a signal. Opening it.');
        router.push(`/signals/${r.signalId}/edit`);
        return;
      }
      if (r.triage_status === 'approved') {
        await analyzeAndGo(r.candidateId!, r.runId!);
        return;
      }
      setReview({
        candidateId: r.candidateId!,
        runId: r.runId!,
        kind: r.triage_status === 'duplicate' ? 'duplicate' : 'rejected',
        reason: r.reason,
      });
      setStatus('');
    } catch (e) {
      setError(true);
      setStatus(`Couldn’t prepare a signal (${e instanceof Error ? e.message : 'error'}).`);
    } finally {
      setBusy(false);
    }
  }

  async function createAnyway() {
    if (!review) return;
    setBusy(true);
    setError(false);
    setStatus('Overriding…');
    try {
      await overrideAndApproveAction(review.candidateId, review.runId);
      await analyzeAndGo(review.candidateId, review.runId);
    } catch (e) {
      setError(true);
      setStatus(`Override failed (${e instanceof Error ? e.message : 'error'}).`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={run}
          disabled={busy}
          style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
          {busy ? 'Working…' : '✦ Promote to signal'}
        </button>
        {status && (
          <span className="text-xs" role="status" aria-live="polite"
            style={{ color: error ? 'var(--heat-4)' : 'var(--faint-ink)' }}>
            {status}
          </span>
        )}
      </div>

      {review && (
        <div className="text-sm" style={{
          marginTop: 12, padding: '12px 14px', border: '1px solid var(--line)',
          borderRadius: 8, background: 'var(--surface)',
        }}>
          <p style={{ margin: '0 0 8px', color: 'var(--dim)' }}>
            Triage flagged this paper as <strong>{review.kind}</strong>
            {review.reason ? <>: {review.reason}</> : null}. You can override and create the draft anyway.
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={createAnyway} disabled={busy}>
            Create anyway
          </button>
        </div>
      )}
    </div>
  );
}
