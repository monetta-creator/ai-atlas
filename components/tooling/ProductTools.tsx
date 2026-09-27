'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { enrichProductAction, scoreProductAction, adminDeepDiveAction } from '@/lib/actions';
import ModelCallButton from '@/components/jobs/ModelCallButton';

// Admin-only tool trio: re-run the homepage extraction, re-run the rubric
// score, or run a fresh deep dive with optional steering. Separate from the
// portal+admin DeepDivePanel (which calls the gated deepDiveAction): an
// admin is already authenticated, so this goes straight through
// adminDeepDiveAction with no budget check.
//
// enrichProductAction/scoreProductAction/adminDeepDiveAction return
// `{ ok: true; ... } | { error: string }` (no `ok: false` on the error
// branch), so each action is wrapped to a consistent `{ ok, error }` shape
// before handing it to ModelCallButton (its retry/failure logic keys on
// `'ok' in r && r.ok === false`).
export default function ProductTools({ id }: { id: string }) {
  const router = useRouter();
  const [steering, setSteering] = useState('');

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="field">
        <label htmlFor="pt-steering">Deep dive steering (optional)</label>
        <textarea
          id="pt-steering"
          className="input"
          rows={2}
          maxLength={1500}
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <ModelCallButton
          label="✦ Re-enrich"
          busyLabel="Enriching…"
          kind="single:tooling_enrich"
          subject={id}
          jobLabel="Re-enrich"
          feature="tooling_enrich"
          retries={1}
          className="btn btn--ghost btn--sm"
          action={async () => {
            const r = await enrichProductAction(id);
            return 'ok' in r ? r : { ok: false as const, error: r.error };
          }}
          onDone={(r) => {
            if (!r.ok) return;
            router.refresh();
            return { note: `✓ Re-enriched.${r.isAiTool ? '' : ' The reader flagged this as not an AI tool: it was parked.'}` };
          }}
        />
        <ModelCallButton
          label="✦ Rescore"
          busyLabel="Scoring…"
          kind="single:tooling_score"
          subject={id}
          jobLabel="Rescore"
          feature="tooling_score"
          retries={1}
          className="btn btn--ghost btn--sm"
          action={async () => {
            const r = await scoreProductAction(id);
            return 'ok' in r ? r : { ok: false as const, error: r.error };
          }}
          onDone={(r) => {
            if (!r.ok) return;
            router.refresh();
            return { note: `✓ Rescored.${r.cataloged ? ' Cataloged.' : ' Parked (below the catalog threshold).'}` };
          }}
        />
        <ModelCallButton
          label="✦ Deep dive"
          busyLabel="Researching…"
          kind="single:tooling_deepdive"
          subject={id}
          jobLabel="Deep dive"
          feature="tooling_deepdive"
          retries={1}
          className="btn btn--primary btn--sm"
          action={async () => {
            const r = await adminDeepDiveAction(id, steering || null);
            return 'ok' in r ? r : { ok: false as const, error: r.error };
          }}
          onDone={(r) => {
            if (!r.ok) return;
            router.refresh();
            return { note: `✓ Deep dive done. ${r.eventsAdded} event${r.eventsAdded === 1 ? '' : 's'} logged.` };
          }}
        />
      </div>
    </div>
  );
}
