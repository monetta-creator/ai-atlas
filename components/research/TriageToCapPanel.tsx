'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { readUnreadBatchAction, capResearchQueueAction } from '@/lib/actions';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// The review desk's one-shot backlog clear (lib/research/queue-cap.ts): the
// queue agent reads every unread paper, one cheap call picks the N most worth
// reading from the agent's track and note picks, and every other pending
// paper is dismissed (review_basis 'bulk_cap'; rows stay, decisions are
// reversible from the paper page). Nothing is bulk-noted.

const CHUNK = 12;

export default function TriageToCapPanel({
  pending, unread, modelLabel,
}: {
  pending: number;
  unread: number;
  modelLabel: string;
}) {
  const router = useRouter();
  const [keep, setKeep] = useState('25');
  const n = Math.max(5, Math.min(200, Math.round(Number(keep) || 25)));

  const steps: StepSpec[] = [
    {
      key: 'read', label: 'Agent reads the unread', running: 'Reading papers…',
      features: Array.from({ length: Math.max(1, Math.ceil(unread / CHUNK)) }, () => 'research_agent'),
    },
    { key: 'cap', label: `Keep the best ${n}, dismiss the rest`, running: 'Picking finalists…', features: ['research_queue_pick'] },
  ];

  const run = useModelRun({
    kind: 'research_queue_cap',
    label: `Triage the research queue down to ${n}`,
    steps,
    run: async (ctx) => {
      await ctx.step('read', async () => {
        let left = unread;
        let stalls = 0;
        while (left > 0) {
          const r = await readUnreadBatchAction();
          if (!r.ok) throw new Error(r.error);
          ctx.note(`Read ${r.processed} papers${r.failed ? ` (${r.failed} chunk${r.failed === 1 ? '' : 's'} failed)` : ''}; ${r.remaining} unread left.`);
          stalls = r.processed === 0 ? stalls + 1 : 0;
          // Two empty batches in a row: stop rather than cut papers nobody read.
          if (stalls >= 2) throw new Error(`The agent stopped making progress with ${r.remaining} unread left.`);
          left = r.remaining;
        }
      }, { retries: 1 });
      const result = await ctx.step('cap', async () => {
        const r = await capResearchQueueAction(n);
        if (!r.ok) throw new Error(r.error);
        return r;
      }, { retries: 1 });
      router.refresh();
      const how = result.picker === 'model' ? `picked by ${result.model ?? 'the model'}` : result.picker === 'confidence' ? 'by agent confidence (the pick call failed)' : 'nothing to cut';
      return {
        note: `Kept ${result.kept} of ${result.pending} (${how}). Dismissed ${result.dismissed}` +
          `${result.trackPicksCut ? `, including ${result.trackPicksCut} agent track picks` : ''}` +
          `${result.unreadCut ? ` and ${result.unreadCut} the agent never read` : ''}. All stay in the library and can be revived.`,
      };
    },
  });

  const busy = run.status === 'running';
  if (pending <= n && run.status === 'idle') return null;

  function start() {
    const msg = `The agent reads ${unread} unread paper${unread === 1 ? '' : 's'} on ${modelLabel}, then keeps the ${n} most worth reading and dismisses the other ${Math.max(0, pending - n)}. Dismissed papers stay in the library and can be revived. Go?`;
    if (window.confirm(msg)) void run.start();
  }

  return (
    <div className="dbb" style={{ marginTop: 14 }}>
      <div className="dbb-row">
        <span className="dbb-label">Triage the backlog</span>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={start}>
          ✦ Triage down to
        </button>
        <input
          className="input dbb-hours" type="number" min={5} max={200} value={keep}
          aria-label="Papers to keep" disabled={busy}
          onChange={(e) => setKeep(e.target.value)}
        />
        <span className="dbb-muted">
          papers · {pending} pending, {unread} unread · reader: {modelLabel}
        </span>
      </div>
      <ModelRunPanel run={run} />
    </div>
  );
}
