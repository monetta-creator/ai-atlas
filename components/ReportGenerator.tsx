'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL, SIGNAL_LENS_COLOR } from '@/lib/format';
import {
  getReportDataAction, generateReportLensAction, synthesizeReportAction,
  saveReportAction, listSavedReportsAction, getSavedReportAction, deleteReportAction,
} from '@/lib/actions';
import type { Report, SignalLens, SavedReportMeta } from '@/lib/types';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { FeatureStats, StepSpec, UiJob } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';
import ReportDocument from './ReportDocument';
import ReportPrint from './ReportPrint';
import SavedReports from './SavedReports';

// Phase 2: the trigger shell + AI generation. Controls keep the URL in sync (so the
// server-rendered data preview below tracks them); "Generate report" runs the real
// generation — one call per active lens (scoped to that lens's signals), then one
// synthesis call — assembling the full Report and handing it to ReportDocument (the
// editor shell). Partial-failure tolerant: a failed lens is surfaced inline, not fatal
// (caught inside the parallel group so it never aborts the run or the other lenses).
// The retry-one-lens control in ReportDocument stays a standalone action (runLens,
// its own three-attempt backoff), independent of the run panel below.

const POOL = 3;                      // concurrent per-lens calls (each its own ≤60s call)
const MAX_ATTEMPTS = 3;              // per-lens retry budget (transient/rate-limit)
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, attempt * 1500));

type LensResult = { ok: true; narrative: string; callout: string } | { ok: false; error: string };

interface Cache {
  key: string;
  data?: Report;
  narratives?: Record<string, string>;
  callouts?: Record<string, string | null>;
}

export default function ReportGenerator({
  initialFrom,
  initialTo,
  initialLenses,
  initialSaved,
  stats,
  initialJob,
}: {
  initialFrom: string;
  initialTo: string;
  initialLenses: SignalLens[];
  initialSaved: SavedReportMeta[];
  stats?: FeatureStats | null;
  initialJob?: UiJob | null;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [lenses, setLenses] = useState<Set<SignalLens>>(() => new Set(initialLenses));

  const [report, setReport] = useState<Report | null>(null);
  const [lensErrors, setLensErrors] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<SignalLens | null>(null);
  // What a resumed run may reuse: the data pack and the lens narratives
  // already written for these same inputs (a retry from a later step never
  // rebuilds or re-runs a lens that already succeeded).
  const [cache, setCache] = useState<Cache | null>(null);

  // Persistence + post-edit actions.
  const [savedReports, setSavedReports] = useState<SavedReportMeta[]>(initialSaved);
  const [savedId, setSavedId] = useState<string | null>(null);   // DB id of the open report
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [resynth, setResynth] = useState(false);
  const [note, setNote] = useState<string | null>(null);   // save/open/re-synthesis status, separate from the run panel

  const selected = SIGNAL_LENS_SLUGS.filter((l) => lenses.has(l));
  const ready = !!from && !!to && from <= to && selected.length > 0;
  const runKey = JSON.stringify([from, to, selected]);

  // The chain's steps depend on which lenses are picked: one per selected
  // lens, run up to POOL at a time. Keyed on the picked set so the array
  // reference stays stable while the selection does not change.
  const specs = useMemo<StepSpec[]>(() => [
    { key: 'data', label: 'Report data', running: 'Assembling report data…' },
    ...selected.map((l): StepSpec => ({
      key: `lens:${l}`, label: SIGNAL_LENS_LABEL[l], running: `Writing ${SIGNAL_LENS_LABEL[l]}…`, features: ['report_lens'],
    })),
    { key: 'synthesis', label: 'Synthesis', running: 'Synthesizing macro survey + claims recap…', features: ['report_synthesis'] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selected.join(',')]);

  // Keep the URL (and the server-rendered data preview) in sync with the controls.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!ready) return;
    const id = setTimeout(() => {
      router.push(`/reports/period?${new URLSearchParams({ from, to, lenses: selected.join(',') }).toString()}`);
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, lenses]);

  function toggleLens(l: SignalLens) {
    setLenses((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }

  // One lens with retry/backoff. Both a thrown rejection and an {ok:false} are treated as
  // a failed attempt — so a single lens never aborts the whole run. Used both inside the
  // chain below (wrapped in ctx.step, retries:1 since the backoff here already covers it)
  // and standalone by retryLens (the ReportDocument "Retry" control on one failed lens).
  async function runLens(f: string, t: string, lens: SignalLens): Promise<LensResult> {
    let lastErr = 'error';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await generateReportLensAction(f, t, lens);
        if (r.ok) return { ok: true, narrative: r.narrative, callout: r.callout };
        lastErr = r.error;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'error';
      }
      if (attempt < MAX_ATTEMPTS) await backoff(attempt);
    }
    return { ok: false, error: lastErr };
  }

  const run = useModelRun({
    kind: 'period_report',
    subject: `${from}:${to}`,
    label: `Period report, ${from} to ${to}`,
    steps: specs,
    stats,
    initialJob,
    run: async (ctx, resumeFrom) => {
      const f = from, t = to;
      const reuse = resumeFrom && cache?.key === runKey ? cache : null;

      let data = resumeFrom && resumeFrom !== 'data' ? reuse?.data : undefined;
      if (!data) {
        setReport(null);
        setLensErrors({});
        data = await ctx.step('data', () => getReportDataAction(f, t, selected));
        setCache({ key: runKey, data });
        ctx.note('✓ Report data assembled');
      }
      const dataNow = data;
      const active = dataNow.byLens.filter((g) => g.signals.length > 0).map((g) => g.lens);
      const skipped = dataNow.lenses.filter((l) => !active.includes(l));
      skipped.forEach((l) => ctx.note(`· ${SIGNAL_LENS_LABEL[l]}: no developments, skipped`));

      // Per-lens, bounded concurrency. A lens already narrated by an earlier
      // attempt (reused from the cache on resume) is never re-run. Collect
      // successes + failures; a lens failure never aborts the others.
      const narratives: Record<string, string> = resumeFrom && resumeFrom !== 'data' ? { ...(reuse?.narratives ?? {}) } : {};
      const callouts: Record<string, string | null> = resumeFrom && resumeFrom !== 'data' ? { ...(reuse?.callouts ?? {}) } : {};
      const errors: Record<string, string> = {};
      const todo = active.filter((l) => !narratives[l]);
      const queue = [...todo];
      const worker = async () => {
        for (let lens = queue.shift(); lens; lens = queue.shift()) {
          try {
            const res = await ctx.step(`lens:${lens}`, () => runLens(f, t, lens), { parallel: true, retries: 1 });
            if (res.ok) { narratives[lens] = res.narrative; if (res.callout) callouts[lens] = res.callout; }
            else errors[lens] = res.error;
          } catch (e) {
            errors[lens] = e instanceof Error ? e.message : 'error';
          }
        }
      };
      if (todo.length) await Promise.all(Array.from({ length: Math.min(POOL, todo.length) }, worker));
      setLensErrors(errors);
      setCache({ key: runKey, data: dataNow, narratives, callouts });

      // Synthesis over the full set + the lens summaries that succeeded (today's
      // behavior: it runs regardless of how many lenses failed).
      const summaries = active.filter((l) => narratives[l]).map((l) => ({ lens: l, narrative: narratives[l] }));
      const syn = await ctx.step('synthesis', () => synthesizeReportAction(f, t, dataNow.lenses, summaries));
      if (!syn.ok) throw new Error(syn.error);

      // Assemble the full Report and hand it to the editor shell.
      const perLens: Record<string, string | null> = {};
      for (const l of dataNow.lenses) perLens[l] = narratives[l] ?? null;
      setReport({
        ...dataNow,
        generatedAt: new Date().toISOString(),
        narrative: { macroSurvey: syn.macroSurvey, perLens, claimsRecap: syn.claimsRecap, callouts },
      });
      setSavedId(null);                       // a fresh generation is unsaved
      setTitle(syn.title || `AI Atlas Report ${f} to ${t}`);   // editorial title from synthesis
      return { note: '✓ Report ready.' };
    },
  });

  // Edits from the rich-text fields flow back into the held Report (HTML), so the object
  // Phase 4 exports always reflects the latest text. `key` is 'macroSurvey' | 'claimsRecap'
  // | `lens:<slug>`.
  function editSection(key: string, html: string) {
    setReport((prev) => {
      if (!prev) return prev;
      if (key === 'macroSurvey') return { ...prev, narrative: { ...prev.narrative, macroSurvey: html } };
      if (key === 'claimsRecap') return { ...prev, narrative: { ...prev.narrative, claimsRecap: html } };
      if (key.startsWith('lens:')) {
        const lens = key.slice(5);
        return { ...prev, narrative: { ...prev.narrative, perLens: { ...prev.narrative.perLens, [lens]: html } } };
      }
      return prev;
    });
  }

  // Edit/remove a section's callout (plain text). `value` null removes it (no box rendered);
  // a string sets it; '' is the "add, empty" state the editor fills in.
  function setCallout(key: string, value: string | null) {
    setReport((prev) =>
      prev ? { ...prev, narrative: { ...prev.narrative, callouts: { ...prev.narrative.callouts, [key]: value } } } : prev
    );
  }

  // Retry a single failed lens and merge it (narrative + callout) into the report.
  async function retryLens(lens: SignalLens) {
    if (retrying || !report) return;
    setRetrying(lens);
    const res = await runLens(report.range.from, report.range.to, lens);
    setReport((prev) =>
      prev
        ? {
            ...prev,
            narrative: {
              ...prev.narrative,
              perLens: { ...prev.narrative.perLens, [lens]: res.ok ? res.narrative : null },
              callouts: { ...prev.narrative.callouts, [lens]: res.ok ? (res.callout || null) : null },
            },
          }
        : prev
    );
    setLensErrors((prev) => {
      const next = { ...prev };
      if (res.ok) delete next[lens];
      else next[lens] = res.error;
      return next;
    });
    setRetrying(null);
  }

  // ---- Persistence ----
  async function refreshSaved() {
    try { setSavedReports(await listSavedReportsAction()); } catch { /* keep current list */ }
  }
  async function saveCurrent() {
    if (!report || saving) return;
    setSaving(true);
    try {
      const res = await saveReportAction({ id: savedId ?? undefined, title, report });
      setSavedId(res.id);
      await refreshSaved();
    } catch (e) { setNote(`✗ save: ${e instanceof Error ? e.message : 'error'}`); }
    finally { setSaving(false); }
  }
  async function openSaved(id: string) {
    try {
      const r = await getSavedReportAction(id);
      if (!r) { await refreshSaved(); return; }
      setReport(r.report);
      setTitle(r.title);
      setSavedId(r.id);
      setLensErrors({});
      setNote(null);
    } catch (e) { setNote(`✗ open: ${e instanceof Error ? e.message : 'error'}`); }
  }
  async function deleteSaved(id: string) {
    try {
      await deleteReportAction(id);
      if (id === savedId) setSavedId(null);
      await refreshSaved();
    } catch { /* ignore */ }
  }

  // Re-run synthesis from the CURRENT (edited) lens narratives so the macro survey + claims
  // recap stay consistent after hand-edits/retries — without regenerating the lenses.
  async function resynthesize() {
    if (!report || resynth) return;
    setResynth(true);
    try {
      const summaries = report.lenses
        .filter((l) => report.narrative.perLens[l])
        .map((l) => ({ lens: l, narrative: report.narrative.perLens[l] as string }));
      const syn = await synthesizeReportAction(report.range.from, report.range.to, report.lenses, summaries);
      if (syn.ok) {
        setReport((prev) =>
          prev
            ? { ...prev, narrative: { ...prev.narrative, macroSurvey: syn.macroSurvey, claimsRecap: syn.claimsRecap } }
            : prev
        );
        if (syn.title) setTitle(syn.title);   // refresh the editorial title from the new summary
      } else { setNote(`✗ re-synthesis: ${syn.error}`); }
    } catch (e) { setNote(`✗ re-synthesis: ${e instanceof Error ? e.message : 'error'}`); }
    finally { setResynth(false); }
  }

  return (
    <>
      <div
        className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" type="date" className="input" value={from} max={to || undefined}
              onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" type="date" className="input" value={to} min={from || undefined}
              onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Lenses</label>
          <div className="lens-chip-row">
            {SIGNAL_LENS_SLUGS.map((l) => {
              const on = lenses.has(l);
              return (
                <button
                  key={l}
                  type="button"
                  className="lenschip"
                  data-on={on ? '' : undefined}
                  onClick={() => toggleLens(l)}
                  style={
                    on
                      ? {
                          color: SIGNAL_LENS_COLOR[l],
                          borderColor: `color-mix(in oklab, ${SIGNAL_LENS_COLOR[l]} 45%, var(--line))`,
                          background: `color-mix(in oklab, ${SIGNAL_LENS_COLOR[l]} 10%, var(--surface))`,
                        }
                      : undefined
                  }
                >
                  {SIGNAL_LENS_LABEL[l]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void (run.status === 'failed' ? run.retry() : run.start())}
            disabled={!ready || run.status === 'running'}
          >
            {run.status === 'running' ? <><span className="spinner mr-btn-spin" aria-hidden="true" />Generating</> : 'Generate report'}
          </button>
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            {!ready
              ? 'Pick a valid range and at least one lens.'
              : 'One analyst pass per lens, then a synthesis pass, written as a senior equity analyst.'}
          </span>
        </div>

        <ModelRunPanel run={run} doneLabel="Review the report below" />
      </div>

      {note && <p className="text-sm" style={{ margin: 0, color: 'var(--dim)' }}>{note}</p>}

      <SavedReports
        reports={savedReports}
        currentId={savedId}
        onOpen={openSaved}
        onDelete={deleteSaved}
      />

      {report && (
        <>
          <ReportDocument
            report={report}
            title={title}
            onTitleChange={setTitle}
            onSave={saveCurrent}
            saving={saving}
            saved={!!savedId}
            onResynthesize={resynthesize}
            resynthesizing={resynth}
            onExport={() => window.print()}
            onEditSection={editSection}
            onEditCallout={setCallout}
            lensErrors={lensErrors}
            onRetryLens={retryLens}
            retrying={retrying}
          />
          {/* Off-screen print layout (portaled to <body>); window.print() renders it. */}
          <ReportPrint report={report} title={title} />
        </>
      )}
    </>
  );
}
