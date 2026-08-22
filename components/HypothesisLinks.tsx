'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { linkHypothesesAction, unlinkHypothesesAction } from '@/lib/actions';
import type { HypothesisLink } from '@/lib/types';

// Related hypotheses (D-016 promote-and-link): show the links from either end;
// admin can add by code or remove. Guests see the list only.
export default function HypothesisLinks({
  hypothesisId, links, admin,
}: {
  hypothesisId: string;
  links: HypothesisLink[];
  admin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const c = code.trim();
    if (!c) return;
    setError(null);
    startTransition(async () => {
      const r = await linkHypothesesAction(hypothesisId, c);
      if (!r.ok) setError(r.error ?? 'Could not link.');
      else { setCode(''); router.refresh(); }
    });
  }

  function remove(toId: string) {
    startTransition(async () => {
      await unlinkHypothesesAction(hypothesisId, toId);
      router.refresh();
    });
  }

  if (!links.length && !admin) return null;

  return (
    <div>
      {links.length === 0 ? (
        <p style={{ color: 'var(--faint-ink)', fontSize: 13, margin: '0 0 8px' }}>No linked hypotheses.</p>
      ) : (
        <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.7 }}>
          {links.map((l) => {
            const farId = l.from_id === hypothesisId ? l.to_id : l.from_id;
            return (
              <li key={l.id}>
                {l.code ? (
                  <Link href={`/hypothesis/${encodeURIComponent(l.code)}`} style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    {l.code}
                  </Link>
                ) : null}
                {' · '}
                <span style={{ color: 'var(--ink)' }}>{l.statement}</span>
                {l.note && <span style={{ color: 'var(--faint-ink)' }}> ({l.note})</span>}
                {admin && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => remove(farId)}
                      disabled={pending}
                      style={{ border: 'none', background: 'none', color: 'var(--heat-4)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                    >
                      unlink
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {admin && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="input"
            style={{ width: 140, padding: '5px 10px', fontSize: 13 }}
            placeholder="Code, e.g. H4"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            aria-label="Hypothesis code to link"
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={add} disabled={pending || !code.trim()}>
            {pending ? 'Linking…' : 'Link'}
          </button>
          {error && <span className="text-xs" style={{ color: 'var(--heat-4)' }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
