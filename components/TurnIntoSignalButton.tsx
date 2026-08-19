'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  prepareSignalFromSourceAction,
  analyzeCandidateAction,
  overrideAndApproveAction,
  completePipelineRunAction,
} from '@/lib/actions';

// Source-page affordance: turn this source into a Signal Board entry through the SAME steps as
// the discovery pipeline — triage (full, can reject), then analysis into a draft. The model
// proposes; the admin reviews/publishes the draft. We drive 2–3 short server calls from the
// client (each its own function invocation) so neither LLM leg pushes past the 60s cap.
export default function TurnIntoSignalButton({ sourceId }: { sourceId: string }) {
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
      router.push(`/signals/${res.signalId}/edit`);
    } else {
      // Idempotent no-op (already drafted by a peer) — fall back to the board.
      router.push('/signals');
    }
  }

  async function run() {
    setBusy(true);
    setError(false);
    setReview(null);
    setStatus('Triaging…');
    try {
      const r = await prepareSignalFromSourceAction(sourceId);
      if (r.status === 'exists') {
        setStatus('This source already has a signal. Opening it.');
        router.push(`/signals/${r.signalId}/edit`);
        return;
      }
      if (r.triage_status === 'approved') {
        await analyzeAndGo(r.candidateId!, r.runId!);
        return;
      }
      // rejected or duplicate — let the admin override and create anyway
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
      <div className="flex items-center justify-between flex-wrap gap-3" style={{ margin: '36px 0 16px' }}>
        <span className="lbl">Signal Board · turn this source into a tracked signal</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={run}
          disabled={busy}
          style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
          {busy ? 'Working…' : '✦ Turn into signal'}
        </button>
      </div>

      {status && (
        <span
          className="text-xs"
          role="status"
          aria-live="polite"
          style={{ color: error ? 'var(--heat-4)' : 'var(--faint-ink)' }}
        >
          {status}
        </span>
      )}

      {review && (
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
            Create anyway
          </button>
        </div>
      )}
    </div>
  );
}
