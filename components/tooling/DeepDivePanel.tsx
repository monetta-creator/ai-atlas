'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deepDiveAction } from '@/lib/actions';
import ModelCallButton from '@/components/jobs/ModelCallButton';

// The portal + admin deep-dive button (the Scout ResearchPanel idiom): a
// one-off steering instruction, never persisted, then the call. Data arrives
// as props only; this component must never import a server module.
//
// deepDiveAction resolves its own ai_cost_log feature server-side
// ('tooling_deepdive' for admin, 'portal_tooling' for a portal key) since the
// viewer tier isn't threaded into this component's props; the "usual time and
// cost" line below is keyed on the portal feature, the more common caller of
// this panel (admin has its own Deep dive button on ProductTools).
export default function DeepDivePanel({ id }: { id: string }) {
  const router = useRouter();
  const [steering, setSteering] = useState('');

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="field">
        <label htmlFor="dd-steering">Steer the research (optional, this run only)</label>
        <textarea
          id="dd-steering"
          className="input"
          rows={2}
          maxLength={1500}
          placeholder="e.g. Focus on data residency and named financial services customers."
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
        />
      </div>
      <div>
        <ModelCallButton
          label="✦ Run deep dive"
          busyLabel="Researching the web for strengths, weaknesses, pricing, and recent news…"
          kind="single:portal_tooling"
          subject={id}
          jobLabel="Deep dive"
          feature="portal_tooling"
          retries={1}
          className="btn btn--primary btn--sm"
          action={() => deepDiveAction(id, steering)}
          onDone={(r) => {
            if (!r.ok) return;
            router.refresh();
            return { note: `✓ Done. ${r.eventsAdded} event${r.eventsAdded === 1 ? '' : 's'} logged.` };
          }}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
        A skeptical, web-researched read: strengths, weaknesses, pricing, compliance, named customers,
        competitors, and recent news, each with its source.
      </p>
    </div>
  );
}
