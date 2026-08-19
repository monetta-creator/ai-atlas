'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startPipelineRunAction, discoverBatchAction, discoverBreakingSweepAction, triageChunkAction,
  hydrateCandidateAction, analyzeCandidateAction, markCandidateUnanalyzableAction,
  pendingAnalysisIdsAction, coverageCheckAction,
  completePipelineRunAction, failPipelineRunAction, pendingTriageCountAction,
} from '@/lib/actions';
import { SIGNAL_LENS_LABEL } from '@/lib/format';
import type { PipelineRun, SignalLens } from '@/lib/types';

// How many analyze calls run concurrently. Each is its own Vercel function, so this is
// real parallelism; kept low to respect Anthropic rate limits and leave a per-host
// connection free for the page refresh. Bump after a clean run confirms no 429s.
const ANALYSIS_POOL = 4;

// Concurrent discovery batches. A web-search call is ~30s of mostly server-tool wall
// time; run sequentially, 20 batches was ~10 minutes of the run. Kept below the analysis
// pool because each call holds an Anthropic request open the whole time.
const DISCOVERY_POOL = 3;

// Client orchestrator. Each step is many short server actions (one batch / one candidate)
// so nothing exceeds the Hobby 60s cap; discovery/triage run as sequential chunks, analysis
// as a small concurrent pool. State is persisted server-side after every unit, so closing
// the tab loses nothing — the admin can reopen and resume triage/analysis on the same run.
export default function PipelineConsole({
  latestRun, pendingAnalysisIds,
}: { latestRun: PipelineRun | null; pendingAnalysisIds: string[] }) {
  const router = useRouter();
  const [cadence, setCadence] = useState<'weekly' | 'daily'>('weekly');
  const [lookback, setLookback] = useState<7 | 1>(7);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  // The live run id is held in a ref so async handlers (and the failure path) always
  // see the run created *during* the handler, not a stale render-time value.
  // A run is resumable from its DB checkpoint when it's still 'running'/'failed', OR when it
  // has leftover analysis work (approved candidates with no draft yet) regardless of status
  // — a transient timeout must never strand candidates.
  const resumeId =
    latestRun &&
    (latestRun.status === 'running' ||
      latestRun.status === 'failed' ||
      pendingAnalysisIds.length > 0)
      ? latestRun.id
      : null;
  const runIdRef = useRef<string | null>(resumeId);
  // Approved ids from a triage run in this same session, so "3 · Analysis" right after
  // "2 · Triage" doesn't race the (stale) pendingAnalysisIds prop.
  const sessionApprovedRef = useRef<string[] | null>(null);

  // Live elapsed clock while a step runs, so it's obvious the pipeline is working.
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

  async function runDiscovery(): Promise<string> {
    say(`▶ Discovery (${cadence}, last ${lookback}d)…`);
    const { runId, plan, sinceISO } = await startPipelineRunAction(cadence, lookback);
    runIdRef.current = runId;
    sessionApprovedRef.current = null;
    say(`  run ${runId.slice(0, 8)} · ${plan.length} batches + breaking sweep · since ${sinceISO}`);
    let total = 0;
    const processBatch = async (b: (typeof plan)[number]) => {
      const label = `${SIGNAL_LENS_LABEL[b.lens as SignalLens]} · batch ${b.batchIndex + 1}`;
      // Actually retry a failed batch before moving on — inserts are idempotent
      // (unique(run_id,url)), so a transient timeout/429 becomes eventual success instead
      // of silently-lost candidates (the old "(retryable)" label never retried).
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const { inserted } = await discoverBatchAction(runId, b.lens, b.batchIndex, sinceISO);
          total += inserted;
          say(`  ${label} → +${inserted} (running ${total})`);
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'error';
          if (attempt < MAX_ATTEMPTS) {
            say(`  ↻ ${label}: ${msg}, retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
            await new Promise((r) => setTimeout(r, attempt * 1500));
          } else {
            say(`  ✗ ${label}: ${msg} (gave up after ${MAX_ATTEMPTS} attempts)`);
          }
        }
      }
    };
    // Bounded worker pool, same shape as analysis — each batch is its own Vercel function.
    const queue = [...plan];
    const worker = async () => {
      while (queue.length) {
        const b = queue.shift();
        if (b) await processBatch(b);
      }
    };
    await Promise.all(Array.from({ length: Math.min(DISCOVERY_POOL, plan.length) }, worker));
    // Breaking-events sweep: one extra lens-agnostic, significance-first batch over a
    // curated quality-outlet allowlist — catches the window's headline events (a frontier
    // model release) that the thematic lens queries can miss. Same retry shape as a batch.
    const SWEEP_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= SWEEP_ATTEMPTS; attempt++) {
      try {
        const { inserted } = await discoverBreakingSweepAction(runId, sinceISO);
        total += inserted;
        say(`  Breaking sweep → +${inserted} (running ${total})`);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'error';
        if (attempt < SWEEP_ATTEMPTS) {
          say(`  ↻ breaking sweep: ${msg}, retrying (${attempt}/${SWEEP_ATTEMPTS - 1})`);
          await new Promise((r) => setTimeout(r, attempt * 1500));
        } else {
          say(`  ✗ breaking sweep: ${msg} (gave up after ${SWEEP_ATTEMPTS} attempts)`);
        }
      }
    }
    say(`✓ Discovery done: ${total} candidates.`);
    return runId;
  }

  async function runTriage(runId: string): Promise<string[]> {
    say('▶ Triage…');
    let approved = 0, rejected = 0, duplicate = 0;
    let approvedIds: string[] = [];
    // Drive triage one bounded chunk per call so each fits the 60s cap; loop until the
    // pending queue is drained. Same retry as discovery for transient blips.
    for (let guard = 0; guard < 200; guard++) {
      let res: Awaited<ReturnType<typeof triageChunkAction>> | null = null;
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          res = await triageChunkAction(runId);
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
      if (!res) break;
      approved += res.approved;
      rejected += res.rejected;
      duplicate += res.duplicate;
      if (res.processed > 0) {
        say(`  +${res.processed} triaged → ${approved} approved / ${rejected} rejected / ${duplicate} dup · ${res.remaining} left`);
      }
      if (res.remaining === 0) {
        approvedIds = res.approvedIds ?? [];
        break;
      }
      if (res.processed === 0) break; // safety: nothing left to process
    }
    sessionApprovedRef.current = approvedIds;
    say(`✓ Triage: ${approved} approved · ${rejected} rejected · ${duplicate} duplicate.`);
    return approvedIds;
  }

  // Complete the run only when no candidates are still pending triage; otherwise leave it
  // running (resumable) and tell the admin to finish triage or archive the stragglers. This
  // mirrors completePipelineRunAction's hard guard but keeps the run out of the failed state.
  async function tryComplete(runId: string): Promise<boolean> {
    const pending = await pendingTriageCountAction(runId).catch(() => 0);
    if (pending > 0) {
      say(`◐ ${pending} candidate(s) still pending triage: run “2 · Triage” (or archive them), then complete.`);
      return false;
    }
    await completePipelineRunAction(runId);
    return true;
  }

  // Advisory post-run audit: one web-enabled call re-derives the window's most
  // significant AI developments (independent query phrasing) and marks each as covered
  // or a possible miss against the run's candidates + existing signals. Never blocks the
  // run — a silent miss becoming a visible flag is the whole point (the Kimi K3 lesson).
  async function runCoverage(runId: string) {
    say('▶ Coverage check…');
    try {
      const cov = await coverageCheckAction(runId);
      for (const d of cov.developments) {
        const host = (() => {
          try { return new URL(d.url).hostname.replace(/^www\./, ''); } catch { return ''; }
        })();
        say(d.covered
          ? `  ✓ covered: ${d.headline}`
          : `  ⚠ possible miss: ${d.headline}${host ? ` (${host})` : ''}`);
      }
      const misses = cov.developments.filter((d) => !d.covered).length;
      say(misses
        ? `◐ Coverage check: ${misses} possible miss(es) of ${cov.developments.length}. Saved to the run below.`
        : `✓ Coverage check: all ${cov.developments.length} significant developments accounted for.`);
    } catch (e) {
      say(`✗ Coverage check failed (non-blocking): ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  async function runAnalysis(runId: string, ids: string[]) {
    if (!ids.length) {
      say('▶ Analysis: nothing approved to analyze.');
      // Close the run only if no triage is still pending; audit coverage once closed.
      if (await tryComplete(runId)) await runCoverage(runId);
      return;
    }
    const total = ids.length;
    say(`▶ Analysis: ${total} candidate(s), ${ANALYSIS_POOL} at a time…`);
    let made = 0, flagged = 0, done = 0;

    // Flag a candidate out of the queue with its reason — the terminal give-up path.
    const flagOne = async (id: string, reason: string) => {
      await markCandidateUnanalyzableAction(runId, id, reason).catch(() => {});
      flagged++; done++;
      say(`  ${done}/${total} ⚑ flagged for manual review (${reason})`);
    };

    // Process one candidate in two stages, each its own short invocation:
    //   1. hydrate — fetch + cache the readable text (full 60s budget for slow hosts,
    //      PDF extraction, fallbacks);
    //   2. analyze — the model leg, reading the cached text.
    // Failures the actions classify as TERMINAL (403 bot-wall, dead URL, unparseable
    // document) flag immediately — retrying a deterministic failure just burns wall-time
    // (the old behavior: 3 attempts × backoff per doomed candidate). Transient failures
    // (timeout, 429, 5xx) retry on a fresh invocation. analyzeCandidate is atomic +
    // idempotent, so retries never duplicate a draft.
    const processOne = async (id: string) => {
      const MAX_ATTEMPTS = 3;
      let via: string | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let failMsg: string | null = null;
        let terminal = false;
        try {
          const h = await hydrateCandidateAction(id);
          if (h.ok) { via = h.via; break; }
          failMsg = h.error ?? 'fetch failed';
          terminal = !!h.terminal;
        } catch (e) {
          failMsg = e instanceof Error ? e.message : 'error';
        }
        if (terminal || attempt === MAX_ATTEMPTS) return flagOne(id, failMsg ?? 'fetch failed');
        say(`  ↻ fetch retry (${attempt}/${MAX_ATTEMPTS - 1}): ${failMsg}`);
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let failMsg: string | null = null;
        let rateLimited = false;
        let terminal = false;
        try {
          const r = await analyzeCandidateAction(id);
          if (r.ok) {
            done++;
            if (r.skipped) say(`  ${done}/${total} ⊘ already drafted`);
            else {
              made++;
              const viaNote = via === 'jina' ? ' · via reader' : '';
              say(`  ${done}/${total} ✓ ${r.title} [${r.significance}, ${r.touches} touches, rel≈${r.reliability}]${viaNote}`);
            }
            return;
          }
          // The action returns failures as data (real message + HTTP status + terminal).
          failMsg = r.error ?? 'analysis failed';
          rateLimited = r.status === 429;
          terminal = !!r.terminal;
        } catch (e) {
          // Belt-and-suspenders for an unexpected throw (e.g. the function itself 504s).
          failMsg = e instanceof Error ? e.message : 'error';
        }
        if (terminal || attempt === MAX_ATTEMPTS) return flagOne(id, failMsg ?? 'error');
        say(`  ↻ retrying (${attempt}/${MAX_ATTEMPTS - 1}): ${failMsg}`);
        // Rate limits need real room; other transient errors a short backoff.
        await new Promise((r) => setTimeout(r, (rateLimited ? 10_000 : 3_000) * attempt));
      }
    };

    // Bounded worker pool — each call is its own Vercel function, so this is real parallelism.
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        if (id) await processOne(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(ANALYSIS_POOL, total) }, worker));

    // Only complete the run when nothing is left un-drafted; otherwise leave it resumable
    // (a closed tab / interrupted pass keeps its place — click 3 · Analysis to continue).
    const leftover = await pendingAnalysisIdsAction(runId).catch(() => [] as string[]);
    if (leftover.length) {
      say(`◐ Analysis incomplete: ${made} draft(s), ${flagged} flagged, ${leftover.length} still pending. Click 3 · Analysis again to finish.`);
      return;
    }
    if (await tryComplete(runId)) {
      say(`✓ Analysis done: ${made} draft(s)${flagged ? `, ${flagged} flagged for manual review` : ''}. Review on the Signal Board.`);
      await runCoverage(runId);
    }
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
      if (rid) await failPipelineRunAction(rid, msg).catch(() => {});
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const onDiscovery = () => guard(async () => { await runDiscovery(); });
  const onTriage = () => guard(async () => {
    const rid = runIdRef.current;
    if (!rid) { say('✗ No active run: run discovery first.'); return; }
    await runTriage(rid);
  });
  const onAnalysis = () => guard(async () => {
    const rid = runIdRef.current;
    if (!rid) { say('✗ No active run: run discovery first.'); return; }
    const ids = sessionApprovedRef.current ?? pendingAnalysisIds;
    await runAnalysis(rid, ids);
  });
  const onFull = () => guard(async () => {
    const runId = await runDiscovery();
    const approvedIds = await runTriage(runId);
    await runAnalysis(runId, approvedIds);
  });

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="flex items-end gap-4 flex-wrap" style={{ marginBottom: 16 }}>
        <div className="field" style={{ minWidth: 160 }}>
          <label htmlFor="cadence">Sweep</label>
          <select id="cadence" className="input" value={cadence} disabled={busy}
            onChange={(e) => setCadence(e.target.value as 'weekly' | 'daily')}>
            <option value="weekly">Weekly: all six lenses</option>
            <option value="daily">Daily: Market + Capability</option>
          </select>
        </div>
        <div className="field" style={{ minWidth: 140 }}>
          <label htmlFor="lookback">Lookback</label>
          <select id="lookback" className="input" value={lookback} disabled={busy}
            onChange={(e) => setLookback(Number(e.target.value) as 7 | 1)}>
            <option value={7}>Last 7 days</option>
            <option value={1}>Last 1 day</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn--primary" onClick={onFull} disabled={busy}>
          {busy ? 'Running…' : '▶ Run full pipeline'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onDiscovery} disabled={busy}>1 · Discovery</button>
        <button className="btn btn--ghost btn--sm" onClick={onTriage} disabled={busy}>2 · Triage</button>
        <button className="btn btn--ghost btn--sm" onClick={onAnalysis} disabled={busy}>3 · Analysis</button>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Steps run as many short calls (Hobby 60s cap). Progress is saved after each
        step; the run can be stopped and resumed later.
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
