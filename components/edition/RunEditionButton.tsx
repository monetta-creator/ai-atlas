'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runEditionNowAction } from '@/lib/actions';

// Admin-only "run it now" for the daily edition: the empty-state and the
// PageTop action slot on /blotter both use this. Busy state while the two
// GLM legs run; a skip (budget, already run today, nothing to report) comes
// back as a plain reason string and renders inline rather than as an error.
export default function RunEditionButton({ day }: { day?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await runEditionNowAction(day);
      const skipped = res && typeof res === 'object' && 'skipped' in res
        ? (res as { skipped?: string | null }).skipped
        : null;
      if (skipped) {
        setNote(skipped);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void run()}>
        {busy ? 'Running…' : "Run today's edition"}
      </button>
      {note && <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{note}</span>}
    </div>
  );
}
