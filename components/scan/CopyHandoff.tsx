'use client';

import { useState } from 'react';

// Copies the server-generated importer handoff (the full contract as
// markdown) so the admin can paste it straight into the firewall-side
// assistant that builds the importer. Preview collapses under a details
// element; the copy is always the full text.
export default function CopyHandoff({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied: the preview below stays selectable */
    }
  }
  return (
    <div>
      <button className="btn btn--primary" onClick={copy}>
        {copied ? '✓ Copied' : 'Copy importer handoff'}
      </button>
      <details style={{ marginTop: 12 }}>
        <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
          Preview the handoff text ({text.length.toLocaleString()} chars)
        </summary>
        <pre
          style={{
            marginTop: 10, padding: '12px 14px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.55,
            background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--dim)',
            maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </pre>
      </details>
    </div>
  );
}
