'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hydratePaperAction, analyzePaperAction } from '@/lib/actions';

// Per-paper deep analysis, on demand only: two short server calls (hydrate = fetch +
// cache the full text with its own 60s budget, analyze = the model leg reading the
// cache). Transient failures retry on fresh invocations; terminal ones stop with the
// real reason. ~$0.10 a click — the human is always in front of the expensive call.
export default function PaperAnalysisButton({
  paperId, hasExtraction,
}: { paperId: string; hasExtraction: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);

  async function run() {
    setBusy(true);
    setError(false);
    try {
      setStatus('Fetching full text…');
      const MAX_ATTEMPTS = 3;
      let hydrated = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !hydrated; attempt++) {
        const h = await hydratePaperAction(paperId);
        if (h.ok) {
          hydrated = true;
          setStatus(h.skipped ? 'Text already cached. Analyzing…' : `Fetched via ${h.via}. Analyzing…`);
        } else if (h.terminal || attempt === MAX_ATTEMPTS) {
          setStatus(`Could not fetch the full text (${h.error ?? 'error'}). Analyzing from the abstract instead…`);
          break;
        } else {
          setStatus(`Fetch failed (${h.error ?? 'error'}), retrying…`);
          await new Promise((r) => setTimeout(r, 2_000 * attempt));
        }
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const r = await analyzePaperAction(paperId);
        if (r.ok) {
          setStatus(`Done: ${r.headline ?? 'finding extracted'} · ${r.touches ?? 0} advisory touches · suggested rigor ${r.proposedRigor ?? '–'}`);
          router.refresh();
          return;
        }
        if (r.terminal || attempt === MAX_ATTEMPTS) {
          setError(true);
          setStatus(`Analysis failed (${r.error ?? 'error'}).`);
          return;
        }
        setStatus(`Analysis failed (${r.error ?? 'error'}), retrying…`);
        await new Promise((r2) => setTimeout(r2, (r.status === 429 ? 10_000 : 3_000) * attempt));
      }
    } catch (e) {
      setError(true);
      setStatus(`Error: ${e instanceof Error ? e.message : 'unknown'}`);
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
        {busy ? 'Working…' : hasExtraction ? '✦ Re-analyze' : '✦ Analyze (fetch full text)'}
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
