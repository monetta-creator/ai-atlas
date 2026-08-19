'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startScoutRunAction, discoverScoutBatchAction, completeScoutRunAction, failScoutRunAction,
} from '@/lib/actions';

// Client orchestrator for a scout discovery run, mirroring ResearchConsole:
// each vertical query batch is its own short server action (<=2 web searches,
// under the 60s cap), retried once on failure. Inserts are checkpointed and
// globally deduped server-side, so a stopped run loses nothing.
export default function ScoutConsole({ activeVerticals }: { activeVerticals: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const runIdRef = useRef<string | null>(null);

  const startRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [busy]);
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const current = log.length ? log[log.length - 1].trim() : 'Working…';

  const say = (line: string) => setLog((l) => [...l, line]);

  async function run() {
    if (busy) return;
    startRef.current = Date.now();
    setElapsed(0);
    setBusy(true);
    try {
      say('▶ Scout discovery…');
      const { runId, plan } = await startScoutRunAction();
      runIdRef.current = runId;
      say(`  run ${runId.slice(0, 8)} · ${plan.length} batch${plan.length === 1 ? '' : 'es'} across the active verticals`);
      let found = 0;
      let inserted = 0;
      for (const ref of plan) {
        let res: { found: number; inserted: number } | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            res = await discoverScoutBatchAction(runId, ref.vertical, ref.batchIndex);
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'error';
            if (attempt === 1) say(`  ↻ ${ref.vertical} batch ${ref.batchIndex + 1}: ${msg}, retrying`);
            else throw e;
          }
        }
        if (!res) continue;
        found += res.found;
        inserted += res.inserted;
        say(`  ${ref.vertical} batch ${ref.batchIndex + 1}: ${res.found} found → ${res.inserted} new (run total ${inserted})`);
      }
      await completeScoutRunAction(runId);
      say(`✓ Discovery done: ${found} companies found · ${inserted} new in the queue.`);
      if (inserted === 0) say('  (Everything found was already in the library, or the searches came up dry.)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      say(`✗ ${msg}`);
      const rid = runIdRef.current;
      if (rid) await failScoutRunAction(rid, msg).catch(() => {});
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn--primary" onClick={run} disabled={busy}>
          {busy ? 'Running…' : '▶ Run discovery'}
        </button>
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          {activeVerticals} active vertical{activeVerticals === 1 ? '' : 's'} · 2 web searches per batch
        </span>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Searches the web per vertical for young AI companies (pre-seed through Series B),
        dedupes against the whole library, and queues the new ones for review. Each batch
        is its own short call with progress saved after it, so a run can be stopped and
        rerun safely. Nothing runs on a schedule.
      </p>

      {busy && (
        <div className="pipeline-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>{current}</span>
          <span className="clock">{mmss} elapsed</span>
        </div>
      )}

      {log.length > 0 && (
        <pre
          style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
            background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--dim)',
            maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}
          aria-live="polite"
        >
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}
