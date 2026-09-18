'use client';

import { useActionState } from 'react';
import { unlockPortalAction, type UnlockState } from '@/app/ask/actions';

// The inline "team key required" panel for /tooling/reports, the /ask idiom
// applied here (never a /login redirect, which corporate networks flag).
// Reuses the existing portal-key action rather than a parallel one: it sets
// the same signed portal cookie the Datasets portal and Ask both read, so
// this page unlocks in step with everything else the key already opens.
// The action itself always lands on /ask on success (it has one caller
// the hidden `next` field brings the visitor straight back to this page).
const INITIAL: UnlockState = { error: null };

export default function ToolingUnlock() {
  const [state, formAction, pending] = useActionState(unlockPortalAction, INITIAL);

  return (
    <div className="plate" style={{ padding: 'var(--card-pad)', maxWidth: 560 }}>
      <div className="section-label">Team access</div>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--dim)', margin: '10px 0 14px' }}>
        Generating a tooling report runs a live model call, so it sits behind the shared team key.
        Paste the key once and this browser stays unlocked for 30 days.
      </p>
      <form action={formAction} className="flex items-center gap-3 flex-wrap">
        <input type="hidden" name="next" value="/tooling/reports" />
        <input
          className="input"
          type="password"
          name="key"
          placeholder="Team portal key"
          autoComplete="off"
          style={{ maxWidth: 280 }}
        />
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? 'Checking…' : 'Unlock'}
        </button>
      </form>
      {state.error && (
        <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--heat-4)' }}>{state.error}</p>
      )}
    </div>
  );
}
