'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startOrResumeScanAction, scanTickAction } from '@/lib/actions';

// Client driver for a manual scan run/resume, mirroring ScoutConsole: each tick
// is one short server action (at most one bounded work unit), looped until the
// day's run completes. The cron pair is the scheduled driver; this exists for
// troubleshooting and for finishing a day the crons could not.
export default function ScanConsole() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

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
      say('▶ External scan…');
      const { runId, day } = await startOrResumeScanAction();
      say(`  run ${runId.slice(0, 8)} · day ${day}`);
      let lastLine = '';
      // Safety cap far above any real day (20 searches + hydrate/enrich waves).
      for (let tick = 0; tick < 400; tick++) {
        const p = await scanTickAction(runId);
        if ('error' in p && p.error) {
          say(`✗ ${p.error}`);
          return;
        }
        if (!('counters' in p)) return;
        for (const n of p.notes) say(`  · ${n}`);
        const c = p.counters;
        const line = `  ${p.step} · feeds ${c.feedItems} · search ${c.searchItems} · hydrated ${c.hydrated} · enriched ${c.enriched} · skipped ${c.skipped}`;
        if (line !== lastLine) {
          say(line);
          lastLine = line;
        }
        if (p.busy) {
          say('  another invocation holds the run lease (a cron is likely mid-run); try again in a few minutes');
          return;
        }
        if (p.done) {
          say('✓ Scan complete. The dataset serves this day as the latest.');
          return;
        }
      }
      say('✗ tick cap reached without completion; run again to continue');
    } catch (e) {
      say(`✗ ${e instanceof Error ? e.message : 'error'}`);
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
          {busy ? 'Running…' : '▶ Run / resume today'}
        </button>
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          feeds → search → hydrate → enrich, checkpointed per unit
        </span>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Runs (or resumes) today&apos;s scan: free press feeds, one web search per active topic,
        full-text hydration, and Haiku enrichment under the daily budget cap. The two daily
        crons normally do all of this; this button finishes a day they could not.
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
