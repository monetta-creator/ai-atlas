'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  triageChunkAction,
  analyzeCandidateAction, markCandidateUnanalyzableAction,
  pendingAnalysisIdsAction,
  completePipelineRunAction, failPipelineRunAction, pendingTriageCountAction,
} from '@/lib/actions';
import type { PipelineRun } from '@/lib/types';

// How many analyze calls run concurrently. Each is its own server invocation; kept low
// to respect model rate limits and leave a connection free for the page refresh.
const ANALYSIS_POOL = 4;

// Client orchestrator for the INTAKE pipeline. Candidates enter through manual/document
// intake with their text retained; this console drives the remaining steps (triage the
// pending queue, analyze the approved queue, complete the run) as many short server
// actions. State is persisted server-side after every unit, so closing the tab loses
// nothing — the admin can reopen and resume triage/analysis on the same run.
export default function PipelineConsole({
  latestRun, pendingAnalysisIds,
}: { latestRun: PipelineRun | null; pendingAnalysisIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  // A run is resumable from its DB checkpoint when it's still 'running'/'failed', OR when
  // it has leftover analysis work (approved candidates with no draft yet) regardless of
  // status — a transient timeout must never strand candidates.
  const resumeId =
    latestRun &&
    (latestRun.status === 'running' ||
      latestRun.status === 'failed' ||
      pendingAnalysisIds.length > 0)
      ? latestRun.id
      : null;
  const runIdRef = useRef<string | null>(resumeId);
  // Approved ids from a triage pass in this same session, so "Analyze" right after
  // "Triage" doesn't race the (stale) pendingAnalysisIds prop.
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

  async function runTriage(runId: string): Promise<string[]> {
    say('▶ Triage…');
    let approved = 0, rejected = 0, duplicate = 0;
    let approvedIds: string[] = [];
    // Drive triage one bounded chunk per call; loop until the pending queue is drained.
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
  // running (resumable) and tell the admin to finish triage or archive the stragglers.
  async function tryComplete(runId: string): Promise<boolean> {
    const pending = await pendingTriageCountAction(runId).catch(() => 0);
    if (pending > 0) {
      say(`◐ ${pending} candidate(s) still pending triage: run “Triage” (or archive them), then complete.`);
      return false;
    }
    await completePipelineRunAction(runId);
    return true;
  }

  async function runAnalysis(runId: string, ids: string[]) {
    if (!ids.length) {
      say('▶ Analysis: nothing approved to analyze.');
      await tryComplete(runId);
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

    // One model leg per candidate, reading the text retained at intake. Failures the
    // action classifies as TERMINAL (no retained text, request-too-large) flag
    // immediately; transient failures (timeout, 429, 5xx) retry on a fresh invocation.
    // analyzeCandidate is atomic + idempotent, so retries never duplicate a draft.
    const processOne = async (id: string) => {
      const MAX_ATTEMPTS = 3;
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
              say(`  ${done}/${total} ✓ ${r.title} [${r.significance}, ${r.touches} touches, rel≈${r.reliability}]`);
            }
            return;
          }
          // The action returns failures as data (real message + HTTP status + terminal).
          failMsg = r.error ?? 'analysis failed';
          rateLimited = r.status === 429;
          terminal = !!r.terminal;
        } catch (e) {
          // Belt-and-suspenders for an unexpected throw.
          failMsg = e instanceof Error ? e.message : 'error';
        }
        if (terminal || attempt === MAX_ATTEMPTS) return flagOne(id, failMsg ?? 'error');
        say(`  ↻ retrying (${attempt}/${MAX_ATTEMPTS - 1}): ${failMsg}`);
        // Rate limits need real room; other transient errors a short backoff.
        await new Promise((r) => setTimeout(r, (rateLimited ? 10_000 : 3_000) * attempt));
      }
    };

    // Bounded worker pool — each call is its own server invocation, so this is real parallelism.
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        if (id) await processOne(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(ANALYSIS_POOL, total) }, worker));

    // Only complete the run when nothing is left un-drafted; otherwise leave it resumable.
    const leftover = await pendingAnalysisIdsAction(runId).catch(() => [] as string[]);
    if (leftover.length) {
      say(`◐ Analysis incomplete: ${made} draft(s), ${flagged} flagged, ${leftover.length} still pending. Click Analyze again to finish.`);
      return;
    }
    if (await tryComplete(runId)) {
      say(`✓ Analysis done: ${made} draft(s)${flagged ? `, ${flagged} flagged for manual review` : ''}. Review on the Signal Board.`);
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

  const onTriage = () => guard(async () => {
    const rid = runIdRef.current;
    if (!rid) { say('✗ No active run to triage.'); return; }
    await runTriage(rid);
  });
  const onAnalysis = () => guard(async () => {
    const rid = runIdRef.current;
    if (!rid) { say('✗ No active run to analyze.'); return; }
    const ids = sessionApprovedRef.current ?? pendingAnalysisIds;
    await runAnalysis(rid, ids);
  });
  const onResume = () => guard(async () => {
    const rid = runIdRef.current;
    if (!rid) { say('✗ Nothing to resume: no in-flight run.'); return; }
    const approvedIds = await runTriage(rid);
    await runAnalysis(rid, approvedIds.length ? approvedIds : pendingAnalysisIds);
  });

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn--primary" onClick={onResume} disabled={busy || !resumeId}>
          {busy ? 'Running…' : '▶ Resume run (triage + analyze)'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onTriage} disabled={busy || !resumeId}>Triage</button>
        <button className="btn btn--ghost btn--sm" onClick={onAnalysis} disabled={busy || !resumeId}>Analyze</button>
        {!resumeId && (
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            No in-flight run. Candidates enter from a source page (Turn into signal) or the research shelf.
          </span>
        )}
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Steps run as many short calls; progress is saved after each unit, so a run can be
        stopped and resumed later.
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
