'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewPaperAction } from '@/lib/actions';
import type { PaperReviewStatus } from '@/lib/types';

// Detail-page review controls: the same track / note / dismiss gate as the queue,
// usable at any time (a decision can be revised; tracking always requires a why).
export default function PaperReviewControls({
  paperId, current, note,
}: { paperId: string; current: PaperReviewStatus; note: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tracking, setTracking] = useState(false);
  const [why, setWhy] = useState(note ?? '');
  const [error, setError] = useState<string | null>(null);

  const decide = (status: 'tracked' | 'noted' | 'dismissed', w = '') => {
    setError(null);
    startTransition(async () => {
      try {
        await reviewPaperAction(paperId, status, w);
        setTracking(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'error');
      }
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {current === 'pending' ? 'awaiting review' : current}
        </span>
        {tracking ? (
          <>
            <input
              className="input" style={{ flex: 1, minWidth: 220 }} autoFocus
              placeholder="Why track this paper? (required)"
              value={why} onChange={(e) => setWhy(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && why.trim()) decide('tracked', why.trim());
                if (e.key === 'Escape') setTracking(false);
              }}
            />
            <button className="btn btn--primary btn--sm" disabled={pending || !why.trim()}
              onClick={() => decide('tracked', why.trim())}>
              Track
            </button>
            <button className="btn btn--quiet btn--sm" onClick={() => setTracking(false)}>Cancel</button>
          </>
        ) : (
          <>
            {current !== 'tracked' && (
              <button className="btn btn--ghost btn--sm" disabled={pending} onClick={() => setTracking(true)}>
                ★ Track
              </button>
            )}
            {current !== 'noted' && (
              <button className="btn btn--quiet btn--sm" disabled={pending} onClick={() => decide('noted')}>
                Note
              </button>
            )}
            {current !== 'dismissed' && (
              <button className="btn btn--quiet btn--sm" disabled={pending} onClick={() => decide('dismissed')}>
                Dismiss
              </button>
            )}
          </>
        )}
      </div>
      {current === 'tracked' && note && !tracking && (
        <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 6 }}>Why: {note}</p>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--heat-4)', marginTop: 6 }}>{error}</p>}
    </div>
  );
}
