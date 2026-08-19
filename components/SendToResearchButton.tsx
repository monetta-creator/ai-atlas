'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendSourceToResearchAction } from '@/lib/actions';

// Source-page affordance, alongside (and independent of) "Turn into signal": route
// this source into the research library as a pre-approved paper, reusing its curated
// text and seeding the rigor prior from the reliability prior. The same source can
// go through both doors; neither excludes the other.
export default function SendToResearchButton({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);

  async function run() {
    setBusy(true);
    setError(false);
    setStatus('Sending…');
    try {
      const r = await sendSourceToResearchAction(sourceId);
      setStatus(r.existed ? 'Already in the research library. Opening it.' : 'Added to the research library.');
      router.push(`/research/${r.paperId}`);
    } catch (e) {
      setError(true);
      setStatus(`Couldn’t send to research (${e instanceof Error ? e.message : 'error'}).`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={run}
        disabled={busy}
        style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
      >
        {busy ? 'Working…' : '⌬ Send to research'}
      </button>
      {status && (
        <span className="text-xs" role="status" aria-live="polite"
          style={{ color: error ? 'var(--heat-4)' : 'var(--faint-ink)' }}>
          {status}
        </span>
      )}
    </div>
  );
}
