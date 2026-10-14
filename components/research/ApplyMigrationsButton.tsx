'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { applyPendingMigrationsAction } from '@/lib/actions';

// The review desk's error plate: apply the deploy's pending migrations from
// the app itself (lib/migrations.ts), one tap, then reload the page.
export default function ApplyMigrationsButton({ pending }: { pending: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function apply() {
    if (busy) return;
    if (!window.confirm(`Apply ${pending.length} pending migration${pending.length === 1 ? '' : 's'} to the production database?\n\n${pending.join('\n')}`)) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await applyPendingMigrationsAction();
      if ('error' in r) setNote(r.error);
      else if (r.failed) setNote(`Applied ${r.applied.length}; ${r.failed.file} failed: ${r.failed.error}`);
      else {
        setNote(`Applied ${r.applied.join(', ') || 'nothing (already up to date)'}. Reloading…`);
        router.refresh();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dbb-row" style={{ marginTop: 6 }}>
      <button type="button" className="btn btn--primary btn--sm" disabled={busy || pending.length === 0} onClick={() => void apply()}>
        {busy ? 'Applying…' : `Apply ${pending.length} pending migration${pending.length === 1 ? '' : 's'}`}
      </button>
      <span className="dbb-muted">{pending.join(' · ')}</span>
      {note && <p className="dbb-note" style={{ width: '100%' }}>{note}</p>}
    </div>
  );
}
