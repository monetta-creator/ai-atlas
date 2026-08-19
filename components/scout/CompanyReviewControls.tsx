'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewCompanyAction } from '@/lib/actions';
import type { CompanyStatus } from '@/lib/types';

// The human gate on the acquisition funnel: Track (requires a why), Dismiss,
// Archive, Requeue. prefillNote carries the agent's reason into the why box so
// accepting a recommendation is one edit away, never auto-applied.
export default function CompanyReviewControls({
  id, status, prefillNote,
}: {
  id: string;
  status: CompanyStatus;
  prefillNote?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tracking, setTracking] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function move(next: CompanyStatus, why: string) {
    setError(null);
    startTransition(async () => {
      try {
        await reviewCompanyAction(id, next, why);
        setTracking(false);
        setNote('');
        router.refresh();
      } catch {
        setError('The review write failed. Tracking requires a why.');
      }
    });
  }

  if (tracking) {
    return (
      <div className="flex flex-col gap-2" style={{ maxWidth: 480 }}>
        <textarea
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why track this company?"
          disabled={pending}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={pending || !note.trim()}
            onClick={() => move('tracked', note)}
          >
            {pending ? 'Tracking…' : 'Track it'}
          </button>
          <button type="button" className="btn btn--quiet btn--sm" disabled={pending} onClick={() => setTracking(false)}>
            Cancel
          </button>
        </div>
        {error && <span className="text-xs" style={{ color: 'var(--heat-4)' }}>{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center flex-wrap gap-2">
      {status !== 'tracked' && (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={pending}
          onClick={() => {
            setNote(prefillNote ?? '');
            setTracking(true);
          }}
        >
          ★ Track…
        </button>
      )}
      {status !== 'dismissed' && (
        <button type="button" className="btn btn--quiet btn--sm" disabled={pending} onClick={() => move('dismissed', '')}>
          {pending ? '…' : 'Dismiss'}
        </button>
      )}
      {status === 'tracked' && (
        <button type="button" className="btn btn--quiet btn--sm" disabled={pending} onClick={() => move('archived', '')}>
          Archive
        </button>
      )}
      {(status === 'dismissed' || status === 'archived') && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => move('queued', '')}>
          Requeue
        </button>
      )}
      {error && <span className="text-xs" style={{ color: 'var(--heat-4)' }}>{error}</span>}
    </div>
  );
}
