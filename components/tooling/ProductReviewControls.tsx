'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewProductAction } from '@/lib/actions';
import { TOOLING_STATUS_LABEL } from '@/lib/format';
import type { ToolingStatus } from '@/lib/types';

const STATUSES = Object.keys(TOOLING_STATUS_LABEL) as ToolingStatus[];

// The human gate on the catalog: status select, pinned checkbox, a note.
// Cataloging a product BY HAND requires a why (checked here for a fast
// error and again by the action, which is the real boundary).
export default function ProductReviewControls({
  id, status, pinned, reviewNote,
}: {
  id: string;
  status: ToolingStatus;
  pinned: boolean;
  reviewNote: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nextStatus, setNextStatus] = useState<ToolingStatus>(status);
  const [isPinned, setIsPinned] = useState(pinned);
  const [note, setNote] = useState(reviewNote ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (nextStatus === 'cataloged' && !note.trim()) {
      setError('Cataloging a product by hand requires a why.');
      return;
    }
    startTransition(async () => {
      const r = await reviewProductAction(id, nextStatus, isPinned, note.trim() || null);
      if ('error' in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2" style={{ maxWidth: 480 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="input"
          style={{ width: 'auto' }}
          value={nextStatus}
          onChange={(e) => setNextStatus(e.target.value as ToolingStatus)}
          disabled={pending}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{TOOLING_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--dim)' }}>
          <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} disabled={pending} />
          Pinned
        </label>
      </div>
      <textarea
        className="input"
        rows={2}
        maxLength={1000}
        placeholder={nextStatus === 'cataloged' ? 'Why catalog this by hand?' : 'Note (optional)'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={pending}
      />
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn--primary btn--sm" disabled={pending} onClick={submit}>
          {pending ? 'Saving…' : 'Save review'}
        </button>
      </div>
      {error && <span className="text-xs" style={{ color: 'var(--heat-4)' }}>{error}</span>}
    </div>
  );
}
