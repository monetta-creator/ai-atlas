'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deepDiveAction } from '@/lib/actions';

// The portal + admin deep-dive button (the Scout ResearchPanel idiom): a
// one-off steering instruction, never persisted, then the call. Data arrives
// as props only; this component must never import a server module.
export default function DeepDivePanel({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [steering, setSteering] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function run() {
    setBusy(true);
    setLog(['Researching the web for strengths, weaknesses, pricing, and recent news…']);
    startTransition(async () => {
      try {
        const r = await deepDiveAction(id, steering);
        if (r.ok) {
          setLog((l) => [...l, `✓ Done. ${r.eventsAdded} event${r.eventsAdded === 1 ? '' : 's'} logged.`]);
          router.refresh();
        } else {
          setLog((l) => [...l, `✗ ${r.error}`]);
        }
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="field">
        <label htmlFor="dd-steering">Steer the research (optional, this run only)</label>
        <textarea
          id="dd-steering"
          className="input"
          rows={2}
          maxLength={1500}
          placeholder="e.g. Focus on data residency and named financial services customers."
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          disabled={pending}
        />
      </div>
      <div>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || pending} onClick={run}>
          {busy || pending ? 'Researching…' : '✦ Run deep dive'}
        </button>
      </div>
      <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
        A skeptical, web-researched read: strengths, weaknesses, pricing, compliance, named customers,
        competitors, and recent news, each with its source.
      </p>
      {log.length > 0 && (
        <pre
          className="text-xs"
          role="status"
          aria-live="polite"
          style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}
        >
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}
