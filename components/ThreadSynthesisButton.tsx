'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateThreadSynthesisAction, setThreadStatusAction } from '@/lib/actions';
import type { ThreadStatus } from '@/lib/types';
import ModelCallButton from '@/components/jobs/ModelCallButton';

const STATUSES: ThreadStatus[] = ['open', 'settled', 'dormant'];

// Thread-page controls: rewrite the living synthesis (one bounded model call, every
// rewrite preserved in the revision history) and set the thread's status.
export default function ThreadSynthesisButton({
  slug, status, paperCount,
}: { slug: string; status: ThreadStatus; paperCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState(false);

  async function changeStatus(next: string) {
    setBusy(true);
    try {
      await setThreadStatusAction(slug, next);
      router.refresh();
    } catch (e) {
      setError(true);
      setMsg(`Status change failed (${e instanceof Error ? e.message : 'error'}).`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span title={paperCount === 0 ? 'Place papers in this thread first' : undefined}>
        <ModelCallButton
          label="✦ Update synthesis"
          busyLabel="Rewriting the synthesis…"
          kind="single:research_synthesis"
          subject={slug}
          feature="research_synthesis"
          className="btn btn--ghost btn--sm"
          disabled={busy || paperCount === 0}
          action={() => updateThreadSynthesisAction(slug)}
          onDone={() => router.refresh()}
        />
      </span>
      <select
        className="input" style={{ maxWidth: 130 }} value={status} disabled={busy}
        onChange={(e) => changeStatus(e.target.value)}
        aria-label="Thread status"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {msg && (
        <span className="text-xs" role="status" aria-live="polite"
          style={{ color: error ? 'var(--heat-4)' : 'var(--faint-ink)' }}>
          {msg}
        </span>
      )}
    </div>
  );
}
