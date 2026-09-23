'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { unlockPortalAction, type UnlockState } from '@/app/ask/actions';
import RenewalNotice, { type RenewalState } from '@/components/portal/RenewalNotice';

// The inline access-key unlock panel. Deliberately NOT a redirect to /login
// (corporate networks flag that page); a colleague pastes their access key
// here, or arrives already unlocked via the /datasets/enter?k= link. When the
// browser carries a lapsed key (expired or revoked) the page passes its state
// in and the renewal notice renders above the form.
const INITIAL: UnlockState = { error: null };

export default function PortalUnlock({ keyState }: { keyState?: RenewalState | null }) {
  const [state, formAction, pending] = useActionState(unlockPortalAction, INITIAL);

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 560 }}>
      <RenewalNotice identity={keyState} />
      <div className="plate" style={{ padding: 'var(--card-pad)' }}>
        <div className="section-label">Access key</div>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--dim)', margin: '10px 0 14px' }}>
          Asking the Atlas runs a live model call, so it sits behind an access key. Paste the key once
          and this browser stays unlocked until the key expires. Public datasets remain downloadable
          without it; the key-gated exports need it.
        </p>
        <form action={formAction} className="flex items-center gap-3 flex-wrap">
          <input
            className="input"
            type="password"
            name="key"
            placeholder="Access key"
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
        <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--faint-ink)', marginBottom: 0 }}>
          No key yet? <Link href="/datasets/request">Request an access key</Link>. The maintainer approves
          requests by hand and sends the key as a link.
        </p>
      </div>
    </div>
  );
}
