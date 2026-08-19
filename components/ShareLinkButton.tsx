'use client';

import { useState } from 'react';

// Copies a public share link (/share?t=<token>) to the clipboard. The token is the
// server-derived share token; the origin is filled in client-side. Anyone with the
// link enters the read-only share view without a login.
export default function ShareLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/share?t=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this share link:', url);
    }
  }

  return (
    <button type="button" className="btn btn--quiet btn--sm" onClick={copy} title="Copy a public share link">
      {copied ? 'Link copied ✓' : 'Share link'}
    </button>
  );
}
