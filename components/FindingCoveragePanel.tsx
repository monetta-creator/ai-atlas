'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hydratePaperAction, analyzePaperAction } from '@/lib/actions';

// Batch findings extraction over the reviewed shelf: the portal leads with
// findings, so tracked/noted papers without one are holes in the product. Each
// paper is the same two short server calls the per-paper button makes (hydrate,
// then analyze at ~$0.10); the loop runs client-side so every call fits its own
// 60s budget, and Stop halts between papers.
export default function FindingCoveragePanel({
  reviewed, withFinding, missing,
}: {
  reviewed: number;
  withFinding: number;
  missing: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);
  const push = (s: string) => setLog((l) => [...l, s]);

  async function run() {
    setBusy(true);
    stopRef.current = false;
    setLog([]);
    let done = 0;
    for (const p of missing) {
      if (stopRef.current) {
        push('Stopped.');
        break;
      }
      push(`Analyzing: ${p.title.slice(0, 80)}`);
      try {
        const h = await hydratePaperAction(p.id);
        if (!h.ok) push(`  fetch failed (${h.error ?? 'error'}); analyzing from the abstract`);
        let ok = false;
        for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
          const r = await analyzePaperAction(p.id);
          if (r.ok) {
            ok = true;
            done += 1;
            push(`  done: ${r.headline ?? 'finding extracted'}`);
          } else if (r.terminal || attempt === 2) {
            push(`  failed: ${r.error ?? 'analysis error'}`);
          } else {
            await new Promise((res) => setTimeout(res, r.status === 429 ? 10_000 : 3_000));
          }
        }
      } catch (e) {
        push(`  failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    push(`Finished: ${done} of ${missing.length} findings extracted.`);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span style={{ color: 'var(--dim)' }}>
          {withFinding}/{reviewed} reviewed papers have a structured finding.
        </span>
        {missing.length > 0 && !busy && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void run()}>
            ✦ Analyze missing ({missing.length})
          </button>
        )}
        {busy && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { stopRef.current = true; }}>
            Stop after this paper
          </button>
        )}
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          ~$0.10 per paper; the finding renders on the paper page and the portal.
        </span>
      </div>
      {log.length > 0 && (
        <pre className="text-xs" role="status" aria-live="polite"
          style={{
            margin: 0, whiteSpace: 'pre-wrap', color: 'var(--faint-ink)',
            maxHeight: 220, overflowY: 'auto', fontFamily: 'var(--font-mono)',
          }}>
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}
