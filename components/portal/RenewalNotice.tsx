import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { PortalIdentity } from '@/lib/portal/identity';

// What a keyholder sees when their key has lapsed: a plate naming the state
// and a way to ask for a new one. Active or no key renders nothing. Pure
// JSX over two fields (no async, no server imports), so the client-side
// unlock panel can render it too; pages pass the identity straight through.
export type RenewalState = Pick<PortalIdentity, 'state' | 'expiresAt'>;

export default function RenewalNotice({ identity, style }: { identity: RenewalState | null | undefined; style?: CSSProperties }) {
  if (!identity || (identity.state !== 'expired' && identity.state !== 'revoked')) return null;
  const expired = identity.state === 'expired';
  const day = identity.expiresAt ? identity.expiresAt.slice(0, 10) : null;
  return (
    <div className="plate" role="status" style={{ borderColor: 'var(--heat-2)', maxWidth: 560, ...style }}>
      <div className="section-label">{expired ? 'Access key expired' : 'Access key revoked'}</div>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--dim)', margin: '10px 0 14px' }}>
        {expired
          ? `Your access key expired${day ? ` on ${day}` : ''}. Ask the maintainer to renew it; your saved views are kept. Public datasets stay downloadable meanwhile.`
          : 'Your access key was revoked. Ask the maintainer for a new one; public datasets stay downloadable meanwhile.'}
      </p>
      <Link href="/datasets/request" className="btn btn--ghost btn--sm">Request access</Link>
    </div>
  );
}
