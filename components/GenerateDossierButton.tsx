'use client';

import { useFormStatus } from 'react-dom';
import { generateDossierAction } from '@/lib/actions';

function SubmitButton({ regenerate }: { regenerate: boolean }) {
  const { pending } = useFormStatus();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="submit"
        className="btn btn--ghost btn--sm"
        disabled={pending}
        style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}
      >
        {pending ? 'Generating dossier…' : regenerate ? 'Regenerate' : 'Generate dossier'}
      </button>
      {pending && (
        <span className="text-[11px]" style={{ color: 'var(--faint-ink)' }}>
          up to a minute
        </span>
      )}
    </span>
  );
}

export default function GenerateDossierButton({
  sourceId,
  hasDossier,
  redirectTo,
}: {
  sourceId: string;
  hasDossier: boolean;
  // Where to return after generating. Defaults (in the action) to /source/[id]; the signal
  // detail page passes its own path so the button there returns to the signal.
  redirectTo?: string;
}) {
  return (
    <form action={generateDossierAction}>
      <input type="hidden" name="source_id" value={sourceId} />
      {redirectTo && <input type="hidden" name="redirect_to" value={redirectTo} />}
      <SubmitButton regenerate={hasDossier} />
    </form>
  );
}
