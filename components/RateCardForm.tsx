'use client';

import { useActionState } from 'react';
import { addRateCardAction, type AddRateCardState } from '@/lib/actions';

const INITIAL: AddRateCardState = { ok: false };

export interface RateCardDefaults {
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  contextWindow: number;
}

// The "add new pricing" form. The effective date is REQUIRED and has NO default — a card can
// never silently take effect "today"; the admin must choose the date. Model / rates / context
// prefill from the current active card for convenience (edit the number that changed, pick a date).
export default function RateCardForm({ defaults }: { defaults?: RateCardDefaults }) {
  const [state, action, pending] = useActionState(addRateCardAction, INITIAL);
  return (
    <form action={action}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Model</label>
          <input className="input" name="model" defaultValue={defaults?.model ?? 'claude-sonnet-4-6'} required />
        </div>
        <div className="field">
          <label>Effective date *</label>
          <input className="input" type="date" name="effective_date" required />
        </div>
        <div className="field">
          <label>Context window (tokens)</label>
          <input className="input" type="number" name="context_window" min="1" step="1"
            defaultValue={defaults?.contextWindow ?? ''} placeholder="1000000" required />
        </div>
        <div className="field">
          <label>Input · $ / 1M</label>
          <input className="input" type="number" name="input_per_mtok" min="0" step="0.0001"
            defaultValue={defaults?.input ?? ''} placeholder="3.00" required />
        </div>
        <div className="field">
          <label>Output · $ / 1M</label>
          <input className="input" type="number" name="output_per_mtok" min="0" step="0.0001"
            defaultValue={defaults?.output ?? ''} placeholder="15.00" required />
        </div>
        <div className="field">
          <label>Cache write · $ / 1M</label>
          <input className="input" type="number" name="cache_write_per_mtok" min="0" step="0.0001"
            defaultValue={defaults?.cacheWrite ?? ''} placeholder="3.75" required />
        </div>
        <div className="field">
          <label>Cache read · $ / 1M</label>
          <input className="input" type="number" name="cache_read_per_mtok" min="0" step="0.0001"
            defaultValue={defaults?.cacheRead ?? ''} placeholder="0.30" required />
        </div>
      </div>

      <div className="flex items-center gap-3" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending} style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}>
          {pending ? 'Adding…' : 'Add rate card'}
        </button>
        {state.error && <span role="alert" style={{ fontSize: 12.5, color: 'var(--heat-4)' }}>{state.error}</span>}
        {state.ok && <span role="status" style={{ fontSize: 12.5, color: 'var(--supports)' }}>Rate card added ✓</span>}
      </div>
      <p style={{ fontSize: 11, color: 'var(--faint-ink)', margin: '10px 0 0', lineHeight: 1.5 }}>
        Adds a new card effective from the chosen date forward. Past cards and already-logged costs are never changed.
      </p>
    </form>
  );
}
