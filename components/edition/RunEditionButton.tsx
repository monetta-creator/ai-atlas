'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runEditionNowAction } from '@/lib/actions';
import ModelCallButton from '@/components/jobs/ModelCallButton';

// Admin-only "run it now" for the daily edition: the empty-state and the
// PageTop action slot on /blotter both use this. Two GLM legs run inside the
// one action (lib/edition/generate.ts: 'edition_front' then 'edition_column'),
// plus the builders judgment ('edition_builders'); the usual time and cost sum
// all three. A skip (budget, already run today, nothing to
// report) comes back as a plain reason string and renders inline rather than
// as an error.
export default function RunEditionButton({ day }: { day?: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);

  function onDone(res: unknown) {
    const skipped = res && typeof res === 'object' && 'skipped' in res
      ? (res as { skipped?: string | null }).skipped
      : null;
    if (skipped) {
      setNote(skipped);
    } else {
      setNote(null);
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <ModelCallButton
        label="Run today's edition"
        busyLabel="Reading the day and writing the front page and the column…"
        kind="single:edition"
        subject={day ?? null}
        jobLabel={`Daily edition${day ? `, ${day}` : ''}`}
        feature="edition_front"
        features={['edition_front', 'edition_builders', 'edition_column']}
        className="btn btn--primary btn--sm"
        action={() => runEditionNowAction(day)}
        onDone={onDone}
      />
      {note && <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{note}</span>}
    </div>
  );
}
