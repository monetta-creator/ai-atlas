'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { researchTickAction } from '@/lib/actions';

// Client driver for a manual research-engine run/resume (the ScanConsole
// tick-loop pattern): each tick is one short server action (at most one
// bounded work unit: pull, triage, agent, or analyze), looped until today's
// day-keyed run completes. researchTickAction always operates on today's run
// (created lazily on first call), so unlike scanTickAction there is no
// separate start/resume call and no runId to thread through. The two daily
// crons are the scheduled driver; this exists for troubleshooting and for
// finishing a day the crons could not.
export default function ResearchEnginePanel() {
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
      say('▶ Research engine…');
      let lastLine = '';
      // Safety cap far above any real day (pull pages + triage/agent/analyze units).
      for (let tick = 0; tick < 400; tick++) {
        const p = await researchTickAction();
        if ('error' in p && p.error) {
          say(`✗ ${p.error}`);
          return;
        }
        if (!('counters' in p)) return;
        for (const n of p.notes) say(`  · ${n}`);
        const c = p.counters;
        const line = `  ${p.step} · scanned ${c.scanned} · pulled ${c.pulled} · kept ${c.kept} · rejected ${c.rejected} · agent ${c.agentProcessed} · analyzed ${c.analyzed}`;
        if (line !== lastLine) {
          say(line);
          lastLine = line;
        }
        if (p.busy) {
          say('  another invocation holds the run lease (a cron is likely mid-run); try again in a few minutes');
          return;
        }
        if (p.done) {
          say('✓ Research run complete for today.');
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
          pull → triage → agent → analyze, checkpointed per unit
        </span>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Runs (or resumes) today&apos;s engine run: arXiv pull, triage against the Atlas, the
        recommend-only queue agent, and per-paper finding extraction under the daily budget cap.
        The two daily crons normally do all of this; this button finishes a day they could not.
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
