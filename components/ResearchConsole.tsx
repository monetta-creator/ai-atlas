'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startResearchRunAction, pullArxivPageAction, triageResearchChunkAction,
  completeResearchRunAction, failResearchRunAction, pendingResearchTriageCountAction,
} from '@/lib/actions';
import type { ResearchRun } from '@/lib/types';
import { useModelRun, type RunCtx } from '@/lib/jobs/use-model-run';
import type { StepSpec } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// Concurrent triage chunks. Each is its own Vercel function (real parallelism); kept
// modest to respect Anthropic rate limits. A 7-day window (~1,500 papers) triages in
// ~6-7 minutes at 3 workers instead of ~20 serial.
const TRIAGE_POOL = 3;

type Mode = 'full' | 'pull' | 'triage';

// The two phases on the shared model-run registry (lib/jobs/use-model-run.ts):
// pull (LLM-free arXiv paging) then triage (the model leg). Each phase's own
// inner loop is unchanged; it reports through ctx.note() and runs inside one
// ctx.step() call, so a failure surfaces as "Retry from <phase>".
const STEPS: StepSpec[] = [
  { key: 'pull', label: 'Pull', running: 'Pulling new papers from arXiv…' },
  { key: 'triage', label: 'Triage', running: 'Triaging papers against the Atlas…', features: ['research_triage'] },
];

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

  // A run is resumable (triage picks up where it left off) while papers are pending.
  const resumeId =
    latestRun && (latestRun.status === 'running' || latestRun.status === 'failed') && pendingTriage > 0
      ? latestRun.id
      : null;
  const runIdRef = useRef<string | null>(resumeId);
  const sinceRef = useRef<string | null>(latestRun?.since_date ?? null);
  // Which of the numbered buttons (or "Run pull + triage") started the
  // current/most recent run; a Retry after a failure keeps resuming in that
  // same mode rather than reverting to the full chain.
  const modeRef = useRef<Mode>('full');

  async function runPullPhase(ctx: RunCtx): Promise<string> {
    ctx.note(`▶ Pull from arXiv (last ${lookback}d)…`);
    const { runId, sinceISO } = await startResearchRunAction(lookback);
    runIdRef.current = runId;
    sinceRef.current = sinceISO;
    ctx.note(`  run ${runId.slice(0, 8)} · since ${sinceISO} · cs.AI + cs.LG + cs.CL`);
    let start = 0;
    let scanned = 0;
    let inserted = 0;
    const MAX_ATTEMPTS = 3;
    for (let guardN = 0; guardN < 60; guardN++) {
      let res: Awaited<ReturnType<typeof pullArxivPageAction>> | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          res = await pullArxivPageAction(runId, start, sinceISO);
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'error';
          if (attempt < MAX_ATTEMPTS) {
            ctx.note(`  ↻ page at ${start}: ${msg}, retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
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
      ctx.note(`  +${res.scanned} scanned → ${inserted} new papers (running ${scanned})`);
      if (res.done) break;
      start = res.nextStart;
      // Politeness gap between pages (the server action itself is one request).
      await new Promise((r) => setTimeout(r, 3_200));
    }
    ctx.note(`✓ Pull done: ${scanned} entries scanned · ${inserted} new papers.`);
    if (inserted === 0 && scanned === 0) {
      ctx.note('  (arXiv announces Sun–Thu evenings ET: an empty pull near a weekend is normal.)');
    }
    return runId;
  }

  async function runTriagePhase(ctx: RunCtx, runId: string) {
    ctx.note(`▶ Triage (${TRIAGE_POOL} chunks at a time)…`);
    let kept = 0, rejected = 0, processed = 0;
    const MAX_ATTEMPTS = 3;
    // Worker pool: each chunk is its own server action, and the server claims chunks
    // atomically (for update skip locked), so workers never double-triage a paper.
    const worker = async () => {
      for (let guardN = 0; guardN < 300; guardN++) {
        let res: Awaited<ReturnType<typeof triageResearchChunkAction>> | null = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            res = await triageResearchChunkAction(runId);
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'error';
            if (attempt < MAX_ATTEMPTS) {
              ctx.note(`  ↻ triage chunk: ${msg}, retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
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
        ctx.note(`  +${processed} triaged → ${kept} kept / ${rejected} rejected · ${res.remaining} left`);
        if (res.remaining === 0) return;
      }
    };
    await Promise.all(Array.from({ length: TRIAGE_POOL }, worker));
    const pending = await pendingResearchTriageCountAction(runId).catch(() => 0);
    if (pending > 0) {
      ctx.note(`◐ ${pending} paper(s) still pending triage: run "2 · Triage" to finish.`);
      return;
    }
    await completeResearchRunAction(runId);
    ctx.note(`✓ Triage: ${kept} kept · ${rejected} rejected. Review the queue below.`);
  }

  const run = useModelRun({
    kind: 'engine:research-pull',
    label: 'Research pull',
    steps: STEPS,
    run: async (ctx, from) => {
      const mode = modeRef.current;
      try {
        let runId = runIdRef.current;
        const wantPull = mode === 'full' ? (!from || from === 'pull') : mode === 'pull';
        const wantTriage = mode === 'full' ? (!from || from === 'pull' || from === 'triage') : mode === 'triage';

        if (wantPull) {
          runId = await ctx.step('pull', () => runPullPhase(ctx), { retries: 1 });
          runIdRef.current = runId;
        }
        if (!runId) throw new Error('No active run: run a pull first.');

        if (wantTriage) {
          await ctx.step('triage', () => runTriagePhase(ctx, runId!), { retries: 1 });
        }

        router.refresh();
        return { note: '✓ Done.' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'error';
        const rid = runIdRef.current;
        if (rid) await failResearchRunAction(rid, msg).catch(() => {});
        router.refresh();
        throw e;
      }
    },
  });

  const busy = run.status === 'running';
  const startMode = (mode: Mode) => {
    if (busy) return;
    modeRef.current = mode;
    void run.start();
  };

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
        <button className="btn btn--primary" onClick={() => startMode('full')} disabled={busy}>
          {busy ? <><span className="spinner mr-btn-spin" aria-hidden="true" />Running</> : '▶ Run pull + triage'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => startMode('pull')} disabled={busy}>1 · Pull</button>
        <button className="btn btn--ghost btn--sm" onClick={() => startMode('triage')} disabled={busy}>2 · Triage</button>
        {resumeId && !busy && (
          <span className="text-xs" style={{ color: 'var(--heat-2)' }}>
            {pendingTriage} paper(s) pending triage from the last run · run 2 · Triage to resume
          </span>
        )}
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
        Pulls the window since the last run (capped at 14 days) from cs.AI, cs.LG, and cs.CL,
        then triages title + abstract against the Atlas. Steps run as many short calls; progress
        is saved after each, so a run can be stopped and resumed. Nothing runs on a schedule.
      </p>

      <ModelRunPanel run={run} doneLabel="Open the queue" />
    </div>
  );
}
