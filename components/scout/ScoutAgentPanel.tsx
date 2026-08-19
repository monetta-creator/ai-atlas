'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  scoreScoutChunkAction, saveScoutPrefsAction, acceptScoutRecommendationsAction,
} from '@/lib/actions';

// The scoring agent's console strip: the editable acquisition rubric, a
// standing steering note, "score the queue" (short recommend-only chunks,
// resumable), the verdict summary, and bulk accepts for pursue (tracks, the
// agent's why becomes the review note) and pass (dismisses). Watch stays
// queued for per-row judgment. The human commits everything.

const CHUNK = 10;

export default function ScoutAgentPanel({
  steering, rubric, defaultRubric, queued, summary,
}: {
  steering: string | null;
  rubric: string | null;
  defaultRubric: string;
  queued: { id: string; name: string }[];
  summary: Record<string, number>;
}) {
  const router = useRouter();
  const [note, setNote] = useState(steering ?? '');
  const [rubricText, setRubricText] = useState(rubric ?? '');
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);
  const push = (s: string) => setLog((l) => [...l, s]);

  const scored = summary.pursue + summary.watch + summary.pass;
  const prefsDirty = note !== (steering ?? '') || rubricText !== (rubric ?? '');

  async function savePrefs() {
    setSavingPrefs(true);
    try {
      await saveScoutPrefsAction(note, rubricText);
      router.refresh();
    } finally {
      setSavingPrefs(false);
    }
  }

  async function run() {
    setBusy('run');
    stopRef.current = false;
    setLog([]);
    const totals = { processed: 0, pursue: 0, watch: 0, pass: 0 };
    const chunks: { id: string }[][] = [];
    for (let i = 0; i < queued.length; i += CHUNK) chunks.push(queued.slice(i, i + CHUNK));
    push(`Scoring ${queued.length} companies in ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}…`);
    for (let i = 0; i < chunks.length; i++) {
      if (stopRef.current) { push('Stopped; already-scored recommendations are saved.'); break; }
      let done = false;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        const r = await scoreScoutChunkAction(chunks[i].map((c) => c.id));
        if (r.ok) {
          done = true;
          totals.processed += r.processed ?? 0;
          totals.pursue += r.pursue ?? 0;
          totals.watch += r.watch ?? 0;
          totals.pass += r.pass ?? 0;
          push(`Chunk ${i + 1}/${chunks.length}: ${r.processed} companies (${r.pursue} pursue · ${r.watch} watch · ${r.pass} pass)`);
        } else if (attempt === 2) {
          push(`Chunk ${i + 1} failed (${r.error ?? 'error'}); continuing.`);
        } else {
          await new Promise((res) => setTimeout(res, 4000));
        }
      }
      if ((i + 1) % 3 === 0) router.refresh();
    }
    push(`Done: ${totals.processed} scored (${totals.pursue} pursue · ${totals.watch} watch · ${totals.pass} pass). Review below, then accept per row or in bulk.`);
    setBusy(null);
    router.refresh();
  }

  async function accept(verdict: 'pursue' | 'pass') {
    const n = summary[verdict];
    const label = verdict === 'pursue'
      ? `track ${n} compan${n === 1 ? 'y' : 'ies'} with the agent's whys as review notes`
      : `dismiss ${n} compan${n === 1 ? 'y' : 'ies'}`;
    if (!window.confirm(`Accept all ${n} "${verdict}" recommendations? This will ${label}.`)) return;
    setBusy(verdict);
    setLog([]);
    try {
      const { ids } = await acceptScoutRecommendationsAction(verdict);
      push(`${ids.length} compan${ids.length === 1 ? 'y' : 'ies'} ${verdict === 'pursue' ? 'tracked' : 'dismissed'}.`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      <div className="field">
        <label htmlFor="scout-steering">Steering note (the agent reads this every run)</label>
        <textarea
          id="scout-steering" className="input" rows={2} maxLength={1500}
          placeholder="e.g. Embedded payments and document AI are hot; ignore consumer apps and dev tools."
          value={note} onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <details>
        <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
          The acquisition rubric… {rubric ? '(customized)' : '(using the default)'}
        </summary>
        <div className="field" style={{ marginTop: 8 }}>
          <textarea
            id="scout-rubric" className="input" rows={10} maxLength={4000}
            placeholder={defaultRubric}
            value={rubricText} onChange={(e) => setRubricText(e.target.value)}
          />
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 4 }}>
            Empty means the built-in rubric above applies. Edits take effect on the next scoring run.
          </p>
        </div>
      </details>

      {prefsDirty && (
        <div>
          <button type="button" className="btn btn--quiet btn--sm" disabled={savingPrefs}
            onClick={() => void savePrefs()}>
            {savingPrefs ? 'Saving…' : 'Save steering + rubric'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className="btn btn--primary btn--sm"
          disabled={!!busy || queued.length === 0} onClick={() => void run()}>
          ✦ Score the queue ({queued.length})
        </button>
        {busy === 'run' && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { stopRef.current = true; }}>
            Stop after this chunk
          </button>
        )}
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Recommend-only: re-runs re-score every queued company with the current rubric and steering.
        </span>
      </div>

      {scored > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: 'var(--dim)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Agent: {summary.pursue} pursue · {summary.watch} watch · {summary.pass} pass
            {summary.none > 0 ? ` · ${summary.none} unscored` : ''}
          </span>
          {summary.pursue > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy} onClick={() => void accept('pursue')}>
              Accept {summary.pursue} pursue{summary.pursue === 1 ? '' : 's'} → track
            </button>
          )}
          {summary.pass > 0 && (
            <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy} onClick={() => void accept('pass')}>
              Accept {summary.pass} pass{summary.pass === 1 ? '' : 'es'} → dismiss
            </button>
          )}
          {summary.watch > 0 && (
            <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
              Watches stay queued for per-row judgment.
            </span>
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
