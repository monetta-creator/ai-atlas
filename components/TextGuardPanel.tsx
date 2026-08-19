'use client';

import { useState } from 'react';
import { refetchMissingTextAction } from '@/lib/actions';
import type { TextCoverage } from '@/lib/data';

type RefetchResult = Awaited<ReturnType<typeof refetchMissingTextAction>>;

// The retained-text coverage strip on /pipeline: one line of truth for the
// full-text guarantee (N of M published signals hold article text), and the
// catch-up button when anything slipped through the publish-time guard.
// Each invocation processes at most 5 rows; the button repeats until dry.
export default function TextGuardPanel({ initial }: { initial: TextCoverage }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefetchResult | null>(null);

  const cov = result?.coverage ?? initial;
  const missing = cov.total - cov.with_text;

  async function refetch() {
    setBusy(true);
    try {
      setResult(await refetchMissingTextAction());
    } catch {
      // Leave the previous state standing; the button remains the retry.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 8 }}>
      <div className="section-label">
        Retained text · {cov.with_text} of {cov.total} published signals
      </div>
      <div
        className="flex items-baseline flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
      >
        {missing === 0 ? (
          <span style={{ color: 'var(--supports)', fontFamily: 'var(--font-mono)' }}>
            ✓ every published signal holds retained article text
          </span>
        ) : (
          <>
            <span style={{ color: 'var(--heat-4)', fontFamily: 'var(--font-mono)' }}>
              ⚠ {missing} missing
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refetch()} disabled={busy}>
              {busy ? 'Fetching…' : 'Refetch missing (5 at a time)'}
            </button>
          </>
        )}
        {result && (
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
            last pass: {result.retained} retained of {result.attempted} attempted
          </span>
        )}
        {result && result.failures.length > 0 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {result.failures.map((f, i) => (
              <span key={i} style={{ color: 'var(--faint-ink)' }}>
                <span style={{ color: 'var(--heat-4)' }}>failed:</span> {f.title} · {f.reason}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
