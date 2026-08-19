'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateThreadSynthesisAction, setThreadStatusAction } from '@/lib/actions';
import type { ThreadStatus } from '@/lib/types';

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

  async function update() {
    setBusy(true);
    setError(false);
    setMsg('Rewriting the synthesis…');
    try {
      const MAX_ATTEMPTS = 2;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const r = await updateThreadSynthesisAction(slug);
        if (r.ok) {
          setMsg('Synthesis updated.');
          router.refresh();
          return;
        }
        if (attempt === MAX_ATTEMPTS) {
          setError(true);
          setMsg(`Update failed (${r.error ?? 'error'}).`);
          return;
        }
        setMsg(`Update failed (${r.error ?? 'error'}), retrying…`);
        await new Promise((res) => setTimeout(res, 3_000));
      }
    } catch (e) {
      setError(true);
      setMsg(`Error: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

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
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={update}
        disabled={busy || paperCount === 0}
        title={paperCount === 0 ? 'Place papers in this thread first' : undefined}
        style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
      >
        {busy ? 'Working…' : '✦ Update synthesis'}
      </button>
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
