'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { enrichProductAction, scoreProductAction, adminDeepDiveAction } from '@/lib/actions';

// Admin-only tool trio: re-run the homepage extraction, re-run the rubric
// score, or run a fresh deep dive with optional steering. Separate from the
// portal+admin DeepDivePanel (which calls the gated deepDiveAction): an
// admin is already authenticated, so this goes straight through
// adminDeepDiveAction with no budget check.
export default function ProductTools({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [steering, setSteering] = useState('');
  const push = (s: string) => setLog((l) => [...l, s]);

  function runEnrich() {
    setBusy('enrich');
    setLog([]);
    startTransition(async () => {
      try {
        const r = await enrichProductAction(id);
        if ('ok' in r) {
          push(`✓ Re-enriched.${r.isAiTool ? '' : ' The reader flagged this as not an AI tool: it was parked.'}`);
          router.refresh();
        } else {
          push(`✗ ${r.error}`);
        }
      } finally {
        setBusy(null);
      }
    });
  }

  function runScore() {
    setBusy('score');
    setLog([]);
    startTransition(async () => {
      try {
        const r = await scoreProductAction(id);
        if ('ok' in r) {
          push(`✓ Rescored.${r.cataloged ? ' Cataloged.' : ' Parked (below the catalog threshold).'}`);
          router.refresh();
        } else {
          push(`✗ ${r.error}`);
        }
      } finally {
        setBusy(null);
      }
    });
  }

  function runDeepDive() {
    setBusy('deepdive');
    setLog(['Researching…']);
    startTransition(async () => {
      try {
        const r = await adminDeepDiveAction(id, steering || null);
        if ('ok' in r) {
          push(`✓ Deep dive done. ${r.eventsAdded} event${r.eventsAdded === 1 ? '' : 's'} logged.`);
          router.refresh();
        } else {
          push(`✗ ${r.error}`);
        }
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="field">
        <label htmlFor="pt-steering">Deep dive steering (optional)</label>
        <textarea
          id="pt-steering"
          className="input"
          rows={2}
          maxLength={1500}
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          disabled={pending}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || pending} onClick={runEnrich}>
          {busy === 'enrich' ? 'Enriching…' : '✦ Re-enrich'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || pending} onClick={runScore}>
          {busy === 'score' ? 'Scoring…' : '✦ Rescore'}
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={!!busy || pending} onClick={runDeepDive}>
          {busy === 'deepdive' ? 'Researching…' : '✦ Deep dive'}
        </button>
      </div>
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
