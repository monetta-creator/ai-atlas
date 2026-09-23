'use client';

import { useState } from 'react';
import type { KeyIssuedResult } from '@/lib/actions/portal';

// The one place the full key is ever shown. It lives in this component's
// props for the life of the page; the row in portal_keys holds only the
// prefix and an HMAC, so closing this panel is the end of it.
export default function KeyIssuedPanel({ issued, onClose }: { issued: KeyIssuedResult; onClose: () => void }) {
  return (
    <div className="plate" style={{ borderColor: 'var(--accent)', padding: 'var(--card-pad)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="section-label" style={{ flex: 1 }}>Key issued · {issued.name}</div>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Done, hide it</button>
      </div>
      <p className="text-sm" style={{ color: 'var(--dim)', margin: 0, lineHeight: 1.6 }}>
        This key is shown once. It is stored only as a hash, so copy it or the link now; if it is lost,
        revoke it and issue another. Expires {issued.expiresAt.slice(0, 10)}.
        {issued.emailedTo
          ? ` The link was emailed to ${issued.emailedTo}.`
          : ' No email went out (no address, or email is not configured), so share the link yourself.'}
      </p>
      <CopyRow label="Access key" value={issued.key} />
      <CopyRow label="Magic link" value={issued.link} />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the value is selectable in the input below.
    }
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="flex items-center gap-2">
        <input className="input" readOnly value={value} onFocus={(e) => e.currentTarget.select()}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, flex: 1 }} aria-label={label} />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
