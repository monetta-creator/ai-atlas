'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { synthesizeIntelDossierAction } from '@/lib/actions';

// On-demand dossier refresh for one registry company: one small-model read
// over its recent enriched items and extracted facts, merged into
// intel_companies.dossier. The weekly synthesis phase covers the rest; this
// is for "I want this one current now".
export default function SynthesizeButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        className="touch-chip"
        style={{ fontSize: 11, padding: '3px 10px', opacity: pending ? 0.5 : 1 }}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const r = await synthesizeIntelDossierAction(slug);
            if ('error' in r) {
              setResult(`✗ ${r.error}`);
            } else if (!r.updated) {
              setResult('· nothing to synthesize yet (no tracked items or facts)');
            } else {
              setResult(`✓ dossier updated from ${r.items} item${r.items === 1 ? '' : 's'}, ${r.facts} fact${r.facts === 1 ? '' : 's'}`);
            }
            router.refresh();
          })
        }
      >
        {pending ? 'Synthesizing…' : 'Synthesize dossier'}
      </button>
      {result && (
        <span className="text-xs" style={{ color: result.startsWith('✗') ? 'var(--heat-4)' : 'var(--faint-ink)' }}>
          {result}
        </span>
      )}
    </div>
  );
}
