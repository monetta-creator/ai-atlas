'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { synthesizeIntelDossierAction } from '@/lib/actions';
import ModelCallButton from '@/components/jobs/ModelCallButton';

// On-demand dossier refresh for one registry company: one small-model read
// over its recent enriched items and extracted facts, merged into
// intel_companies.dossier. The weekly synthesis phase covers the rest; this
// is for "I want this one current now".
export default function SynthesizeButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);

  // The action returns a bare {error} shape rather than {ok:false}, so
  // use-model-run would read it as a success; throwing here converts a real
  // failure into the toolkit's standard failed/retry path.
  async function synthesize() {
    const r = await synthesizeIntelDossierAction(slug);
    if ('error' in r) throw new Error(r.error);
    return r;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <ModelCallButton
        label="Synthesize dossier"
        busyLabel="Synthesizing…"
        kind="single:intel_synthesis"
        subject={slug}
        feature="intel_synthesis"
        className="touch-chip"
        action={synthesize}
        onDone={(r) => {
          setResult(!r.updated
            ? '· nothing to synthesize yet (no tracked items or facts)'
            : `✓ dossier updated from ${r.items} item${r.items === 1 ? '' : 's'}, ${r.facts} fact${r.facts === 1 ? '' : 's'}`);
          router.refresh();
        }}
      />
      {result && (
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          {result}
        </span>
      )}
    </div>
  );
}
