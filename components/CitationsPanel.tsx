'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refreshCitationsAction, requeuePaperAction } from '@/lib/actions';
import type { RisingReject } from '@/lib/types';

// The self-correction surface: refresh citation counts in-session (Semantic Scholar,
// free, never a cron), and surface "rising rejects" — papers the funnel passed on
// that the field is citing anyway. Requeue gives them a second review.
export default function CitationsPanel({ rising }: { rising: RisingReject[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function refresh() {
    setBusy(true);
    setMsg('Refreshing citation counts…');
    try {
      const r = await refreshCitationsAction();
      setMsg(`Checked ${r.checked} papers, ${r.updated} counts updated.`);
      router.refresh();
    } catch (e) {
      setMsg(`Refresh failed (${e instanceof Error ? e.message : 'error'}).`);
    } finally {
      setBusy(false);
    }
  }

  const requeue = (id: string) =>
    startTransition(async () => {
      try {
        await requeuePaperAction(id);
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'error');
      }
    });

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn--ghost btn--sm" onClick={refresh} disabled={busy || pending}>
          {busy ? 'Refreshing…' : '↻ Refresh citations'}
        </button>
        {msg && <span className="text-xs" style={{ color: 'var(--faint-ink)' }} role="status">{msg}</span>}
      </div>

      {rising.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="text-xs" style={{
            color: 'var(--heat-2)', fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
          }}>
            Rising outside the funnel · rejected here, cited out there
          </div>
          <div className="flex flex-col gap-1">
            {rising.map((p) => (
              <div key={p.id} className="flex items-center flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                <span className="text-xs" style={{ color: 'var(--heat-2)', fontFamily: 'var(--font-mono)' }}>
                  {p.citation_count}×
                </span>
                <Link href={`/research/${p.id}`} className="hover:underline" style={{ color: 'var(--dim)' }}>
                  {p.title}
                </Link>
                <span className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                  <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                    {p.arxiv_id ?? ''}
                  </span>
                  <button className="btn btn--quiet btn--sm" disabled={pending} onClick={() => requeue(p.id)}>
                    Requeue
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
