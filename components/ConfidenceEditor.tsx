'use client';

import { useState } from 'react';
import { moveConfidenceAction } from '@/lib/actions';
import { confidenceText, heatVar } from '@/lib/format';
import HeatChips from './HeatChips';
import type { ConfidenceLabel } from '@/lib/types';

function labelFor(c: number): ConfidenceLabel {
  if (c < 0.4) return 'thin';
  if (c < 0.6) return 'contested';
  if (c < 0.8) return 'leaning';
  return 'settled';
}

export default function ConfidenceEditor({
  targetType,
  targetId,
  current,
  redirectTo,
  evidenceOptions,
}: {
  targetType: 'claim' | 'bridge_claim' | 'stance' | 'position';
  targetId: string;
  current: number | null;
  redirectTo: string;
  // Optional: evidence rows attached to this target, so a move can cite the one that
  // triggered it (closes the evidence → confidence-move loop; rationales.evidence_id).
  evidenceOptions?: { id: string; label: string }[];
}) {
  const [val, setVal] = useState<number>(current ?? 0.5);
  const [reason, setReason] = useState('');
  const label = labelFor(val);
  const moved = current == null || Math.abs(val - current) > 0.0001;
  const ready = !!reason.trim() && moved;

  return (
    <form
      action={moveConfidenceAction}
      className="rounded-[var(--radius)] p-[var(--card-pad)] border"
      style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
    >
      <input type="hidden" name="target_type" value={targetType} />
      <input type="hidden" name="target_id" value={targetId} />
      <input type="hidden" name="redirect_to" value={redirectTo} />
      <input type="hidden" name="new_confidence" value={val} />

      <div className="flex items-center justify-between mb-3">
        <span
          className="uppercase"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10.5px',
            letterSpacing: '0.14em',
            color: 'var(--faint-ink)',
          }}
        >
          Move confidence
        </span>
        <div className="flex items-center gap-3">
          <HeatChips confidence={val} label={label} />
          <span className="font-medium text-sm" style={{ color: heatVar(label) }}>
            {val.toFixed(2)} · {confidenceText(label)}
          </span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={val}
        onChange={(e) => setVal(parseFloat(e.target.value))}
        aria-label="Confidence, 0 to 1"
        className="w-full"
        style={{ accentColor: 'var(--accent)' }}
      />
      <div
        className="flex justify-between mt-1"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--faint-ink)' }}
      >
        <span>thin</span>
        <span>contested</span>
        <span>leaning</span>
        <span>settled</span>
      </div>

      <textarea
        name="reason"
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Rationale (required)."
        aria-label="Rationale for this confidence move"
        rows={2}
        className="input mt-4"
        style={{ resize: 'vertical' }}
      />

      {evidenceOptions && evidenceOptions.length > 0 && (
        <select
          name="evidence_id"
          defaultValue=""
          aria-label="Cite an evidence row for this move (optional)"
          className="input mt-3"
        >
          <option value="">Cite evidence (optional)…</option>
          {evidenceOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-3 mt-3">
        <button
          type="submit"
          disabled={!ready}
          className="btn btn--primary"
          style={!ready ? { opacity: 0.4, cursor: 'not-allowed', boxShadow: 'none' } : undefined}
        >
          Commit with rationale
        </button>
        {!moved && (
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            Move the slider to change the confidence.
          </span>
        )}
      </div>
    </form>
  );
}
