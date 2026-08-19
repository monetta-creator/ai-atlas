'use client';

import { useActionState } from 'react';
import { unlockPortalAction, type UnlockState } from '@/app/ask/actions';

// The inline portal-key unlock panel. Deliberately NOT a redirect to /login
// (corporate networks flag that page); a colleague pastes the shared team key
// here, or arrives already unlocked via the /datasets/enter?k= link.
const INITIAL: UnlockState = { error: null };

export default function PortalUnlock() {
  const [state, formAction, pending] = useActionState(unlockPortalAction, INITIAL);

  return (
    <div className="plate" style={{ padding: 'var(--card-pad)', maxWidth: 560 }}>
      <div className="section-label">Team access</div>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--dim)', margin: '10px 0 14px' }}>
        Asking the Atlas runs a live model call, so it sits behind the shared team key.
        Paste the key once and this browser stays unlocked for 30 days. Every dataset
        below remains downloadable without it.
      </p>
      <form action={formAction} className="flex items-center gap-3 flex-wrap">
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
