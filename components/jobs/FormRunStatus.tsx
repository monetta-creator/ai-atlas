'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { aboutLabel, clockLabel, typicalForSteps, usdLabel } from '@/lib/jobs/core';
import { useFeatureStats } from '@/lib/jobs/stats-client';

// The run line for a model call that lives in a <form action> whose server
// action redirects when it finishes (a dossier, a question summary, a signal
// analysis): the page itself changes when it is done, so there is no result
// to hand a job. Renders inside the form, reads useFormStatus, and shows what
// is happening, the elapsed time against the usual time and cost, and a
// quiet "usually …" hint while idle. Pair it with a plain submit button.
//
//   <form action={generateDossierAction}>
//     <SubmitButton /> <FormRunStatus busyLabel="Reading the source…" feature="dossier" />
//   </form>

export default function FormRunStatus({
  busyLabel, feature, calls = 1, idleHint = true,
}: {
  busyLabel: string;
  feature: string;
  calls?: number;
  idleHint?: boolean;
}) {
  const { pending } = useFormStatus();
  const stats = useFeatureStats(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  // Start and stop the clock from a timer callback (no setState in the body).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (pending) { const n = Date.now(); setStartedAt((s) => s ?? n); setNow(n); } else setStartedAt(null);
    }, 0);
    if (!pending) return () => window.clearTimeout(t);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(t); window.clearInterval(id); };
  }, [pending]);

  const typ = typicalForSteps([{ key: 'call', label: '', running: '', features: Array.from({ length: calls }, () => feature) }], stats);
  const usual = typ.known ? [aboutLabel(typ.p50Ms), usdLabel(typ.p50Usd)].filter(Boolean).join(', ') : '';

  if (pending) {
    const elapsed = startedAt ? now - startedAt : 0;
    return (
      <span className="mr-inline" role="status" aria-live="polite">
        <span className="spinner mr-btn-spin" aria-hidden="true" />
        {busyLabel} <span className="mr-clock">{clockLabel(elapsed)}{usual ? ` of ${usual}` : ''}</span>
      </span>
    );
  }
  return idleHint && usual ? <span className="mr-inline mr-inline--hint">usually {usual}</span> : null;
}
