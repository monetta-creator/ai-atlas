'use client';

import { useFormStatus } from 'react-dom';
import FormRunStatus from '@/components/jobs/FormRunStatus';
import { generateSignalAnalysisAction } from '@/lib/actions';

// Admin button on the signal detail page. One press generates BOTH the briefing and the
// counterpoint (one AI call) and caches them on the signal. Mirrors GenerateDossierButton.

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
        {pending ? 'Generating analysis…' : regenerate ? 'Regenerate analysis' : 'Generate analysis'}
      </button>
      <FormRunStatus busyLabel="Reading the signal…" feature="signal_analysis" />
    </span>
  );
}

export default function GenerateSignalAnalysisButton({
  signalId,
  hasAnalysis,
}: {
  signalId: string;
  hasAnalysis: boolean;
}) {
  return (
    <form action={generateSignalAnalysisAction}>
      <input type="hidden" name="id" value={signalId} />
      <SubmitButton regenerate={hasAnalysis} />
    </form>
  );
}
