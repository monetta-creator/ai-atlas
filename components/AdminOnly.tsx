import Link from 'next/link';
import { publicParentFor } from '@/lib/nav';

// The sessionless landing for an admin-only page now that the proxy is open
// by default: isAdmin() is still the real boundary (checked by the caller,
// lib/admin-gate.tsx's adminGate), this is just what a guest sees instead of
// a /login bounce. Links back to the nearest public leaf of the page's group.
export default function AdminOnly({ pathname, title }: { pathname: string; title: string }) {
  const parent = publicParentFor(pathname);
  return (
    <div className="wrap" style={{ maxWidth: 720, paddingTop: 64, paddingBottom: 80 }}>
      <div className="plate">
        <p
          style={{
            fontFamily: 'var(--font-mono, var(--font-body))',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--faint-ink)',
            margin: '0 0 10px',
          }}
        >
          Admin only
        </p>
        <h2 style={{ margin: '0 0 12px' }}>{title}</h2>
        <p style={{ color: 'var(--dim)', fontSize: 14.5, lineHeight: 1.6, margin: '0 0 22px', maxWidth: '56ch' }}>
          This page is part of the maintainer&apos;s desk and needs an admin session.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href={parent.href} className="btn btn--primary">Back to {parent.label}</Link>
          <Link href="/login" className="btn btn--quiet">Admin login</Link>
        </div>
      </div>
    </div>
  );
}
