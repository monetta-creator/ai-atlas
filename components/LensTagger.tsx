'use client';

import { useState } from 'react';
import { setNodeLensAction, recommendNodeLensesAction } from '@/lib/actions';
import { LENS_LABEL } from '@/lib/format';
import type { Lens } from '@/lib/types';

// Lens tag editor for one node, shown on the /data cards. Seven toggle chips plus an
// on-demand AI "suggest" that highlights recommended lenses (the author still taps to
// apply — recommend-only). Toggles optimistically and persists via setNodeLensAction.
const ALL: Lens[] = ['market', 'economics', 'social', 'employment', 'education', 'geopolitics', 'stack'];

export default function LensTagger({
  targetType,
  targetId,
  statement,
  initial,
}: {
  targetType: 'stance' | 'claim' | 'bridge_claim';
  targetId: string;
  statement: string;
  initial: Lens[];
}) {
  const [active, setActive] = useState<Set<Lens>>(new Set(initial));
  const [suggested, setSuggested] = useState<Set<Lens>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function toggle(l: Lens) {
    const on = !active.has(l);
    setActive((prev) => {
      const n = new Set(prev);
      if (on) n.add(l);
      else n.delete(l);
      return n;
    });
    setSuggested((prev) => {
      if (!prev.has(l)) return prev;
      const n = new Set(prev);
      n.delete(l);
      return n;
    });
    try {
      await setNodeLensAction(targetType, targetId, l, on);
    } catch {
      setActive((prev) => {
        const n = new Set(prev);
        if (on) n.delete(l);
        else n.add(l);
        return n;
      });
      setStatus('Could not save.');
    }
  }

  async function suggest() {
    setBusy(true);
    setStatus('');
    try {
      const recs = await recommendNodeLensesAction(statement);
      const fresh = recs.filter((l) => !active.has(l));
      setSuggested(new Set(fresh));
      setStatus(fresh.length ? `Suggested ${fresh.length}, tap to apply` : 'No new lenses suggested.');
    } catch {
      setStatus("Couldn't get suggestions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lenstag">
      <span className="lenstag__label">Lenses</span>
      <div className="lenstag__chips">
        {ALL.map((l) => {
          const isActive = active.has(l);
          const isSug = !isActive && suggested.has(l);
          return (
            <button
              key={l}
              type="button"
              className="lenschip"
              data-on={isActive ? '1' : undefined}
              data-sug={isSug ? '1' : undefined}
              onClick={() => toggle(l)}
            >
              {LENS_LABEL[l]}
            </button>
          );
        })}
        <button type="button" className="btn btn--quiet btn--sm lenstag__suggest" onClick={suggest} disabled={busy}>
          {busy ? '…' : '✦ suggest'}
        </button>
        {status && <span className="lenstag__status">{status}</span>}
      </div>
    </div>
  );
}
