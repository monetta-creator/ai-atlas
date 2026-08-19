'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startResearchRunAction, pullArxivPageAction, triageResearchChunkAction,
  completeResearchRunAction, failResearchRunAction, pendingResearchTriageCountAction,
} from '@/lib/actions';
import type { ResearchRun } from '@/lib/types';

// Concurrent triage chunks. Each is its own Vercel function (real parallelism); kept
// modest to respect Anthropic rate limits. A 7-day window (~1,500 papers) triages in
// ~6-7 minutes at 3 workers instead of ~20 serial.
const TRIAGE_POOL = 3;

// Client orchestrator for a research run, mirroring PipelineConsole: each step is many
// short server actions (one arXiv page / one triage chunk), so nothing exceeds the Hobby
// 60s cap and one page per invocation respects arXiv's ~1 req/3s politeness. State is
// persisted server-side after every unit — closing the tab loses nothing; triage on a
// stranded run resumes from its DB checkpoint.
export default function ResearchConsole({
  latestRun, pendingTriage,
}: { latestRun: ResearchRun | null; pendingTriage: number }) {
  const router = useRouter();
  const [lookback, setLookback] = useState<3 | 7 | 14>(7);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  // A run is resumable (triage picks up where it left off) while papers are pending.
  const resumeId =
    latestRun && (latestRun.status === 'running' || latestRun.status === 'failed') && pendingTriage > 0
      ? latestRun.id
      : null;
  const runIdRef = useRef<string | null>(resumeId);
  const sinceRef = useRef<string | null>(latestRun?.since_date ?? null);

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

  async function runPull(): Promise<string> {
    say(`▶ Pull from arXiv (last ${lookback}d)…`);
    const { runId, sinceISO } = await startResearchRunAction(lookback);
    runIdRef.current = runId;
    sinceRef.current = sinceISO;
    say(`  run ${runId.slice(0, 8)} · since ${sinceISO} · cs.AI + cs.LG + cs.CL`);
    let start = 0;
    let scanned = 0;
    let inserted = 0;
    const MAX_ATTEMPTS = 3;
    for (let guard = 0; guard < 60; guard++) {
      let res: Awaited<ReturnType<typeof pullArxivPageAction>> | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          res = await pullArxivPageAction(runId, start, sinceISO);
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'error';
          if (attempt < MAX_ATTEMPTS) {
            say(`  ↻ page at ${start}: ${msg}, retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
            // arXiv politeness: give the API real room before the retry.
            await new Promise((r) => setTimeout(r, 4_000 * attempt));
          } else {
            throw e;
          }
        }
      }
      if (!res) break;
      scanned += res.scanned;
      inserted += res.inserted;
      say(`  +${res.scanned} scanned → ${inserted} new papers (running ${scanned})`);
      if (res.done) break;
      start = res.nextStart;
      // Politeness gap between pages (the server action itself is one request).
      await new Promise((r) => setTimeout(r, 3_200));
    }
    say(`✓ Pull done: ${scanned} entries scanned · ${inserted} new papers.`);
    if (inserted === 0 && scanned === 0) {
      say('  (arXiv announces Sun–Thu evenings ET: an empty pull near a weekend is normal.)');
    }
    return runId;
  }

  async function runTriage(runId: string) {
    say(`▶ Triage (${TRIAGE_POOL} chunks at a time)…`);
    let kept = 0, rejected = 0, processed = 0;
    const MAX_ATTEMPTS = 3;
    // Worker pool: each chunk is its own server action, and the server claims chunks
    // atomically (for update skip locked), so workers never double-triage a paper.
    const worker = async () => {
      for (let guard = 0; guard < 300; guard++) {
        let res: Awaited<ReturnType<typeof triageResearchChunkAction>> | null = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            res = await triageResearchChunkAction(runId);
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'error';
            if (attempt < MAX_ATTEMPTS) {
              say(`  ↻ triage chunk: ${msg}, retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
              await new Promise((r) => setTimeout(r, attempt * 1500));
            } else {
              throw e;
            }
          }
        }
        if (!res || res.processed === 0) return;
        kept += res.kept;
        rejected += res.rejected;
        processed += res.processed;
        say(`  +${processed} triaged → ${kept} kept / ${rejected} rejected · ${res.remaining} left`);
        if (res.remaining === 0) return;
      }
    };
    await Promise.all(Array.from({ length: TRIAGE_POOL }, worker));
    const pending = await pendingResearchTriageCountAction(runId).catch(() => 0);
    if (pending > 0) {
      say(`◐ ${pending} paper(s) still pending triage: click “2 · Triage” to finish.`);
      return;
    }
    await completeResearchRunAction(runId);
    say(`✓ Triage: ${kept} kept · ${rejected} rejected. Review the queue below.`);
  }

  async function guard(fn: () => Promise<void>) {
    if (busy) return;
    startRef.current = Date.now();
    setElapsed(0);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      say(`✗ ${msg}`);
      const rid = runIdRef.current;
      if (rid) await failResearchRunAction(rid, msg).catch(() => {});
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const onFull = () => guard(async () => {
    const runId = await runPull();
    await runTriage(runId);
  });
  const onPull = () => guard(async () => { await runPull(); });
  const onTriage = () => guard(async () => {
    const rid = runIdRef.current;
    if (!rid) { say('✗ No active run: run a pull first.'); return; }
    await runTriage(rid);
  });

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="flex items-end gap-4 flex-wrap" style={{ marginBottom: 16 }}>
        <div className="field" style={{ minWidth: 150 }}>
          <label htmlFor="research-lookback">Lookback</label>
          <select
            id="research-lookback" className="input" value={lookback} disabled={busy}
            onChange={(e) => setLookback(Number(e.target.value) as 3 | 7 | 14)}
          >
            <option value={3}>Last 3 days (~600 papers)</option>
            <option value={7}>Last 7 days (~1,500 papers)</option>
            <option value={14}>Last 14 days (max, ~3,000)</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn--primary" onClick={onFull} disabled={busy}>
          {busy ? 'Running…' : '▶ Run pull + triage'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onPull} disabled={busy}>1 · Pull</button>
        <button className="btn btn--ghost btn--sm" onClick={onTriage} disabled={busy}>2 · Triage</button>
        {resumeId && !busy && (
          <span className="text-xs" style={{ color: 'var(--heat-2)' }}>
            {pendingTriage} paper(s) pending triage from the last run · click 2 · Triage to resume
          </span>
        )}
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Pulls the window since the last run (capped at 14 days) from cs.AI, cs.LG, and cs.CL,
        then triages title + abstract against the Atlas. Steps run as many short calls; progress
        is saved after each, so a run can be stopped and resumed. Nothing runs on a schedule.
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
