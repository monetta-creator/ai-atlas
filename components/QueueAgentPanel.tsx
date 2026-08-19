'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  recommendQueueChunkAction, saveSteeringNoteAction, acceptAgentRecommendationsAction,
  hydratePaperAction, analyzePaperAction,
} from '@/lib/actions';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);
  const push = (s: string) => setLog((l) => [...l, s]);

  const recommended = summary.tracked + summary.noted + summary.dismissed;

  async function saveNote() {
    setSavingNote(true);
    try {
      await saveSteeringNoteAction(note);
      router.refresh();
    } finally {
      setSavingNote(false);
    }
  }

  async function run() {
    setBusy('run');
    stopRef.current = false;
    setLog([]);
    const totals = { processed: 0, tracked: 0, noted: 0, dismissed: 0 };
    const chunks: { id: string }[][] = [];
    for (let i = 0; i < unprocessed.length; i += CHUNK) chunks.push(unprocessed.slice(i, i + CHUNK));
    push(`Processing ${unprocessed.length} papers in ${chunks.length} chunks…`);
    for (let i = 0; i < chunks.length; i++) {
      if (stopRef.current) { push('Stopped; already-processed recommendations are saved.'); break; }
      let done = false;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        const r = await recommendQueueChunkAction(chunks[i].map((p) => p.id));
        if (r.ok) {
          done = true;
          totals.processed += r.processed ?? 0;
          totals.tracked += r.tracked ?? 0;
          totals.noted += r.noted ?? 0;
          totals.dismissed += r.dismissed ?? 0;
          push(`Chunk ${i + 1}/${chunks.length}: ${r.processed} papers (${r.tracked} track · ${r.noted} note · ${r.dismissed} dismiss)`);
        } else if (attempt === 2) {
          push(`Chunk ${i + 1} failed (${r.error ?? 'error'}); continuing.`);
        } else {
          await new Promise((res) => setTimeout(res, 4000));
        }
      }
      if ((i + 1) % 3 === 0) router.refresh();
    }
    push(`Done: ${totals.processed} recommendations (${totals.tracked} track · ${totals.noted} note · ${totals.dismissed} dismiss). Review below, then accept per row or in bulk.`);
    setBusy(null);
    router.refresh();
  }

  async function accept(decision: 'tracked' | 'noted' | 'dismissed') {
    const n = summary[decision];
    const label = decision === 'tracked' ? 'track (with the agent\'s whys as review notes, then extract findings)'
      : decision === 'noted' ? 'note' : 'dismiss';
    if (!window.confirm(`Accept all ${n} "${decision}" recommendations? This will ${label} ${n} paper${n === 1 ? '' : 's'}.`)) return;
    setBusy(decision);
    setLog([]);
    try {
      const { ids } = await acceptAgentRecommendationsAction(decision);
      push(`${ids.length} paper${ids.length === 1 ? '' : 's'} ${decision === 'tracked' ? 'tracked' : decision}.`);
      router.refresh();
      if (decision === 'tracked' && ids.length) {
        push('Extracting findings (~$0.10 per paper)…');
        stopRef.current = false;
        let ok = 0;
        for (const id of ids) {
          if (stopRef.current) { push('Stopped extraction; run "Analyze missing" later for the rest.'); break; }
          try {
            const h = await hydratePaperAction(id);
            if (!h.ok) push(`  fetch failed (${h.error ?? 'error'}); analyzing from the abstract`);
            const r = await analyzePaperAction(id);
            if (r.ok) { ok++; push(`  ✓ ${r.headline ?? 'finding extracted'}`); }
            else push(`  ✗ ${r.error ?? 'analysis failed'}`);
          } catch (e) {
            push(`  ✗ ${e instanceof Error ? e.message : 'error'}`);
          }
        }
        push(`Findings: ${ok}/${ids.length} extracted.`);
        router.refresh();
      }
    } finally {
      setBusy(null);
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
          disabled={!!busy || unprocessed.length === 0} onClick={() => void run()}>
          ✦ Process the queue ({unprocessed.length})
        </button>
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Re-runs refresh every pending paper with the current steering.
        </span>
        {busy === 'run' && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { stopRef.current = true; }}>
            Stop after this chunk
          </button>
        )}
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Recommend-only: the agent proposes a decision per paper; you commit, per row or in bulk.
        </span>
      </div>

      {recommended > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: 'var(--dim)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Agent: {summary.tracked} track · {summary.noted} note · {summary.dismissed} dismiss
            {summary.none > 0 ? ` · ${summary.none} unprocessed` : ''}
          </span>
          {summary.tracked > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy} onClick={() => void accept('tracked')}>
              Accept {summary.tracked} track{summary.tracked === 1 ? '' : 's'} + extract findings
            </button>
          )}
          {summary.noted > 0 && (
            <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy} onClick={() => void accept('noted')}>
              Accept {summary.noted} note{summary.noted === 1 ? '' : 's'}
            </button>
          )}
          {summary.dismissed > 0 && (
            <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy} onClick={() => void accept('dismissed')}>
              Accept {summary.dismissed} dismissal{summary.dismissed === 1 ? '' : 's'}
            </button>
          )}
          {busy && busy !== 'run' && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => { stopRef.current = true; }}>
              Stop
            </button>
          )}
        </div>
      )}

      {log.length > 0 && (
        <pre className="text-xs" role="status" aria-live="polite"
          style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--faint-ink)', maxHeight: 240, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}
