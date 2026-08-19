'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  diagnoseThreadGapsAction, dismissThreadRecommendationAction, clearThreadScanAction,
  createThreadAction,
} from '@/lib/actions';
import type { ResearchThreadScan } from '@/lib/types';

// The thread gap scan (mirrors the concept/argument gap panels): one restraint-biased
// model call proposes missing threads from the recent kept papers; each card's
// "Create thread" is the human commit. The scan persists server-side (singleton).
export default function ThreadScanPanel({ scan }: { scan: ResearchThreadScan | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function diagnose() {
    setBusy(true);
    setMsg('Reading recent papers and existing threads…');
    try {
      const r = await diagnoseThreadGapsAction();
      setMsg(r.recommendations.length
        ? `${r.recommendations.length} thread(s) proposed.`
        : 'No missing threads found: the existing threads cover the recent papers.');
      router.refresh();
    } catch (e) {
      setMsg(`Scan failed (${e instanceof Error ? e.message : 'error'}).`);
    } finally {
      setBusy(false);
    }
  }

  const act = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'error');
      }
    });

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn--ghost btn--sm" onClick={diagnose} disabled={busy || pending}>
          {busy ? 'Scanning…' : '✦ Propose missing threads'}
        </button>
        {scan && (
          <button className="btn btn--quiet btn--sm" disabled={busy || pending}
            onClick={() => act(() => clearThreadScanAction())}>
            Clear scan
          </button>
        )}
        {msg && <span className="text-xs" style={{ color: 'var(--faint-ink)' }} role="status">{msg}</span>}
      </div>

      {scan && scan.recommendations.length > 0 && (
        <div className="flex flex-col gap-1.5" style={{ marginTop: 10 }}>
          {scan.recommendations.map((r) => (
            <div key={r.slug} className="rounded-[var(--radius)] border p-3"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
              <div className="text-sm" style={{ color: 'var(--ink)' }}>
                ✦ {r.title}
                <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>
                  {r.slug}
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--dim)', margin: '4px 0' }}>{r.question}</p>
              <p className="text-xs" style={{ color: 'var(--faint-ink)', margin: '4px 0 8px' }}>{r.argument}</p>
              <div className="flex items-center gap-2">
                <button className="btn btn--ghost btn--sm" disabled={pending}
                  onClick={() => act(() => createThreadAction(r.slug, r.title, r.question))}>
                  Create thread
                </button>
                <button className="btn btn--quiet btn--sm" disabled={pending}
                  onClick={() => act(() => dismissThreadRecommendationAction(r.slug))}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
