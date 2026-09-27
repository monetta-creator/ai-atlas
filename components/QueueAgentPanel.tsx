'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  recommendQueueChunkAction, saveSteeringNoteAction, acceptAgentRecommendationsAction,
  hydratePaperAction, analyzePaperAction,
} from '@/lib/actions';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// The queue agent's console strip: a standing steering note, the "process the
// queue" run (short recommend-only chunks, resumable, the console discipline),
// a summary of what the agent recommends, and per-group BULK accept. Accepting
// tracks chains straight into finding extraction (hydrate + analyze per paper)
// so processing the queue ends with findings on the shelf. The human commits
// everything; the agent only ever recommends.

const CHUNK = 12;

export default function QueueAgentPanel({
  steering, unprocessed, summary,
}: {
  steering: string | null;
  unprocessed: { id: string; title: string }[];
  summary: Record<string, number>;
}) {
  const router = useRouter();
  const [note, setNote] = useState(steering ?? '');
  const [savingNote, setSavingNote] = useState(false);
  // Shared between the two model runs below (only one is ever active, since
  // the buttons that start them disable while the other is busy).
  const stopRef = useRef(false);
  const [otherBusy, setOtherBusy] = useState<string | null>(null);
  const [otherNote, setOtherNote] = useState<string | null>(null);

  const recommended = summary.tracked + summary.noted + summary.dismissed;
  const chunkCount = Math.max(1, Math.ceil(unprocessed.length / CHUNK));

  const QUEUE_STEPS: StepSpec[] = [
    {
      key: 'chunks', label: 'Read the queue', running: 'Reading papers…',
      features: Array.from({ length: chunkCount }, () => 'research_agent'),
    },
  ];

  const queueRun = useModelRun({
    kind: 'research_queue_agent',
    label: `Process the research queue (${unprocessed.length})`,
    steps: QUEUE_STEPS,
    run: async (ctx) => {
      stopRef.current = false;
      const totals = { processed: 0, tracked: 0, noted: 0, dismissed: 0 };
      const chunks: { id: string }[][] = [];
      for (let i = 0; i < unprocessed.length; i += CHUNK) chunks.push(unprocessed.slice(i, i + CHUNK));
      await ctx.step('chunks', async () => {
        ctx.note(`Processing ${unprocessed.length} papers in ${chunks.length} chunks…`);
        for (let i = 0; i < chunks.length; i++) {
          if (stopRef.current) { ctx.note('Stopped; already-processed recommendations are saved.'); break; }
          let done = false;
          for (let attempt = 1; attempt <= 2 && !done; attempt++) {
            const r = await recommendQueueChunkAction(chunks[i].map((p) => p.id));
            if (r.ok) {
              done = true;
              totals.processed += r.processed ?? 0;
              totals.tracked += r.tracked ?? 0;
              totals.noted += r.noted ?? 0;
              totals.dismissed += r.dismissed ?? 0;
              ctx.note(`Chunk ${i + 1}/${chunks.length}: ${r.processed} papers (${r.tracked} track · ${r.noted} note · ${r.dismissed} dismiss)`);
            } else if (attempt === 2) {
              ctx.note(`Chunk ${i + 1} failed (${r.error ?? 'error'}); continuing.`);
            } else {
              await new Promise((res) => setTimeout(res, 4000));
            }
          }
          if ((i + 1) % 3 === 0) router.refresh();
        }
      }, { retries: 1 });
      router.refresh();
      return {
        note: `Done: ${totals.processed} recommendations (${totals.tracked} track · ${totals.noted} note · ${totals.dismissed} dismiss). Review below, then accept per row or in bulk.`,
      };
    },
  });

  const ACCEPT_STEPS: StepSpec[] = [
    { key: 'track', label: 'Track', running: 'Tracking papers…' },
    {
      key: 'papers', label: 'Extract findings', running: 'Extracting findings (~$0.10 per paper)…',
      features: Array.from({ length: summary.tracked }, () => 'research_analysis'),
    },
  ];

  const acceptTrackedRun = useModelRun({
    kind: 'research_queue_accept',
    label: 'Accept tracked + extract findings',
    steps: ACCEPT_STEPS,
    run: async (ctx) => {
      const { ids } = await ctx.step('track', () => acceptAgentRecommendationsAction('tracked'));
      ctx.note(`${ids.length} paper${ids.length === 1 ? '' : 's'} tracked.`);
      router.refresh();
      if (!ids.length) return { note: 'No tracked papers to extract findings for.' };
      stopRef.current = false;
      let ok = 0;
      await ctx.step('papers', async () => {
        for (const id of ids) {
          if (stopRef.current) { ctx.note('Stopped extraction; run "Analyze missing" later for the rest.'); break; }
          try {
            const h = await hydratePaperAction(id);
            if (!h.ok) ctx.note(`  fetch failed (${h.error ?? 'error'}); analyzing from the abstract`);
            const r = await analyzePaperAction(id);
            if (r.ok) { ok++; ctx.note(`  ✓ ${r.headline ?? 'finding extracted'}`); }
            else ctx.note(`  ✗ ${r.error ?? 'analysis failed'}`);
          } catch (e) {
            ctx.note(`  ✗ ${e instanceof Error ? e.message : 'error'}`);
          }
        }
      }, { retries: 1 });
      router.refresh();
      return { note: `Findings: ${ok}/${ids.length} extracted.` };
    },
  });

  const busy = queueRun.status === 'running' || acceptTrackedRun.status === 'running' || !!otherBusy;

  async function saveNote() {
    setSavingNote(true);
    try {
      await saveSteeringNoteAction(note);
      router.refresh();
    } finally {
      setSavingNote(false);
    }
  }

  async function acceptTracked() {
    const n = summary.tracked;
    if (!window.confirm(`Accept all ${n} "tracked" recommendations? This will track (with the agent's whys as review notes, then extract findings) ${n} paper${n === 1 ? '' : 's'}.`)) return;
    await acceptTrackedRun.start();
  }

  async function acceptOther(decision: 'noted' | 'dismissed') {
    const n = summary[decision];
    const label = decision === 'noted' ? 'note' : 'dismiss';
    if (!window.confirm(`Accept all ${n} "${decision}" recommendations? This will ${label} ${n} paper${n === 1 ? '' : 's'}.`)) return;
    setOtherBusy(decision);
    setOtherNote(null);
    try {
      const { ids } = await acceptAgentRecommendationsAction(decision);
      setOtherNote(`${ids.length} paper${ids.length === 1 ? '' : 's'} ${decision}.`);
      router.refresh();
    } finally {
      setOtherBusy(null);
    }
  }

  return (
    <div className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      <div className="field">
        <label htmlFor="agent-steering">Steering note (the agent reads this every run)</label>
        <textarea
          id="agent-steering" className="input" rows={2} maxLength={1500}
          placeholder="e.g. Deprioritize medical applications; agent reliability and labor economics are hot right now."
          value={note} onChange={(e) => setNote(e.target.value)}
        />
        <div style={{ marginTop: 6 }}>
          <button type="button" className="btn btn--quiet btn--sm" disabled={savingNote || note === (steering ?? '')}
            onClick={() => void saveNote()}>
            {savingNote ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className="btn btn--primary btn--sm"
          disabled={busy || unprocessed.length === 0} onClick={() => void queueRun.start()}>
          ✦ Process the queue ({unprocessed.length})
        </button>
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Re-runs refresh every pending paper with the current steering.
        </span>
        {queueRun.status === 'running' && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { stopRef.current = true; }}>
            Stop after this chunk
          </button>
        )}
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Recommend-only: the agent proposes a decision per paper; you commit, per row or in bulk.
        </span>
      </div>
      <ModelRunPanel run={queueRun} />

      {recommended > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: 'var(--dim)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Agent: {summary.tracked} track · {summary.noted} note · {summary.dismissed} dismiss
            {summary.none > 0 ? ` · ${summary.none} unprocessed` : ''}
          </span>
          {summary.tracked > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void acceptTracked()}>
              Accept {summary.tracked} track{summary.tracked === 1 ? '' : 's'} + extract findings
            </button>
          )}
          {summary.noted > 0 && (
            <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void acceptOther('noted')}>
              Accept {summary.noted} note{summary.noted === 1 ? '' : 's'}
            </button>
          )}
          {summary.dismissed > 0 && (
            <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void acceptOther('dismissed')}>
              Accept {summary.dismissed} dismissal{summary.dismissed === 1 ? '' : 's'}
            </button>
          )}
          {acceptTrackedRun.status === 'running' && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => { stopRef.current = true; }}>
              Stop
            </button>
          )}
        </div>
      )}
      <ModelRunPanel run={acceptTrackedRun} />
      {otherNote && (
        <p className="text-xs" style={{ margin: 0, color: 'var(--faint-ink)' }}>{otherNote}</p>
      )}
    </div>
  );
}
