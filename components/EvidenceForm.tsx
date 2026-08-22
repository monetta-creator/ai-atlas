'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { addEvidenceBulkAction, recommendHypothesesAction } from '@/lib/actions';
import type { HypothesisRecommendation, Direction, Weight } from '@/lib/types';

interface TargetOption {
  id: string;
  code: string;
  statement: string;
}
interface Sel {
  direction: Direction;
  confidence: Weight;
}

function truncate(s: string, n = 110) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function AttachButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn--primary"
      disabled={pending || count === 0}
      style={pending || count === 0 ? { opacity: 0.5, cursor: pending ? 'wait' : 'not-allowed' } : undefined}
    >
      {pending ? 'Attaching…' : count === 0 ? 'Select hypotheses to attach' : `Attach to ${count} hypothes${count === 1 ? 'is' : 'es'}`}
    </button>
  );
}

export default function EvidenceForm({
  sourceId,
  hypotheses,
}: {
  sourceId: string;
  hypotheses: TargetOption[];
}) {
  const [sel, setSel] = useState<Record<string, Sel>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({}); // hypothesis id -> reason
  const [recommending, setRecommending] = useState(false);
  const [recStatus, setRecStatus] = useState('');
  const [recError, setRecError] = useState(false);

  const byCode = Object.fromEntries(hypotheses.map((h) => [h.code, h]));

  function toggle(t: TargetOption, on: boolean, seed?: Sel) {
    setSel((prev) => {
      const next = { ...prev };
      if (on) next[t.id] = seed ?? next[t.id] ?? { direction: 'supports', confidence: 'medium' };
      else delete next[t.id];
      return next;
    });
  }
  function update(t: TargetOption, patch: Partial<Sel>) {
    setSel((prev) => (prev[t.id] ? { ...prev, [t.id]: { ...prev[t.id], ...patch } } : prev));
  }

  async function recommend() {
    setRecommending(true);
    setRecError(false);
    setRecStatus('Analyzing…');
    try {
      const recs: HypothesisRecommendation[] = await recommendHypothesesAction(sourceId);
      if (!recs.length) {
        setRecStatus('No strong hypothesis matches found. Pick manually below.');
        return;
      }
      const nextSel: Record<string, Sel> = {};
      const nextReasons: Record<string, string> = {};
      for (const r of recs) {
        const h = byCode[r.code];
        if (!h) continue;
        nextSel[h.id] = { direction: r.direction, confidence: r.confidence };
        nextReasons[h.id] = r.reason;
      }
      setSel((prev) => ({ ...nextSel, ...prev })); // keep anything already selected
      setReasons((prev) => ({ ...prev, ...nextReasons }));
      setRecStatus(`Recommended ${recs.length} hypothes${recs.length === 1 ? 'is' : 'es'} (pre-checked below).`);
    } catch (err) {
      setRecError(true);
      const msg = err instanceof Error ? err.message : 'error';
      setRecStatus(`Couldn’t get recommendations (${msg}).`);
    } finally {
      setRecommending(false);
    }
  }

  const count = Object.keys(sel).length;
  const payload = JSON.stringify(
    Object.entries(sel).map(([hypothesis_id, v]) => ({
      hypothesis_id, direction: v.direction, confidence: v.confidence,
    }))
  );

  // recommended hypotheses float to the top
  const sorted = [...hypotheses].sort((a, b) => {
    const ra = reasons[a.id] ? 0 : 1;
    const rb = reasons[b.id] ? 0 : 1;
    return ra - rb;
  });

  const row = (t: TargetOption) => {
    const checked = !!sel[t.id];
    const s = sel[t.id];
    const reason = reasons[t.id];
    return (
      <div
        key={t.id}
        className="border rounded-[var(--radius)] p-2.5"
        style={{
          borderColor: reason ? 'color-mix(in oklab, var(--accent) 35%, var(--line))' : 'var(--line)',
          background: checked ? 'color-mix(in oklab, var(--accent) 5%, var(--surface))' : 'var(--surface)',
        }}
      >
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={(e) => toggle(t, e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
          <span className="flex-1 min-w-0">
            <span className="text-[13px]">
              <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t.code}</span>{' '}
              {truncate(t.statement)}
            </span>
            {reason && (
              <span className="block text-[11px] mt-1" style={{ color: 'var(--accent)' }}>★ {reason}</span>
            )}
          </span>
        </label>
        {checked && (
          <div className="flex items-center gap-2 mt-2" style={{ paddingLeft: 26 }}>
            <select
              className="input"
              style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
              value={s.direction}
              onChange={(e) => update(t, { direction: e.target.value as Direction })}
            >
              <option value="supports">supports</option>
              <option value="contradicts">contradicts</option>
              <option value="neutral">neutral</option>
            </select>
            <select
              className="input"
              style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
              value={s.confidence}
              onChange={(e) => update(t, { confidence: e.target.value as Weight })}
            >
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={recommend} disabled={recommending} style={recommending ? { opacity: 0.6, cursor: 'wait' } : undefined}>
          {recommending ? 'Recommending…' : '★ Recommend hypotheses (AI)'}
        </button>
        {recStatus && (
          <span className="text-xs" role="status" aria-live="polite" style={{ color: recError ? 'var(--heat-4)' : 'var(--faint-ink)' }}>
            {recStatus}
          </span>
        )}
      </div>

      <form action={addEvidenceBulkAction} className="flex flex-col gap-3">
        <input type="hidden" name="source_id" value={sourceId} />
        <input type="hidden" name="payload" value={payload} />

        <div className="flex flex-col gap-2" style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
          {sorted.map(row)}
        </div>

        <div className="field">
          <label htmlFor="excerpt">Note / finding (optional, applies to all selected)</label>
          <input id="excerpt" name="excerpt" className="input" placeholder="The specific finding this source contributes…" />
        </div>

        <div>
          <AttachButton count={count} />
        </div>
      </form>
    </div>
  );
}
