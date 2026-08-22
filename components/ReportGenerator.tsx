'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SIGNAL_CONTEXT_SLUGS, SIGNAL_CONTEXT_LABEL, SIGNAL_CONTEXT_COLOR } from '@/lib/format';
import {
  getReportDataAction, generateReportContextAction, synthesizeReportAction,
  saveReportAction, listSavedReportsAction, getSavedReportAction, deleteReportAction,
} from '@/lib/actions';
import type { Report, SignalContext, SavedReportMeta } from '@/lib/types';
import ReportDocument from './ReportDocument';
import ReportPrint from './ReportPrint';
import SavedReports from './SavedReports';

// Phase 2: the trigger shell + AI generation. Controls keep the URL in sync (so the
// server-rendered data preview below tracks them); "Generate report" runs the real
// generation — one call per selected context (scoped to that context's signals), then one
// synthesis call — assembling the full Report and handing it to ReportDocument (the
// editor shell). Partial-failure tolerant: a failed section is surfaced inline, not fatal.

const POOL = 2;                      // concurrent per-context calls (each its own bounded call)
const MAX_ATTEMPTS = 3;              // per-context retry budget (transient/rate-limit)
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, attempt * 1500));

type SectionResult = { ok: true; narrative: string; callout: string } | { ok: false; error: string };

export default function ReportGenerator({
  initialFrom,
  initialTo,
  initialContexts,
  initialSaved,
}: {
  initialFrom: string;
  initialTo: string;
  initialContexts: SignalContext[];
  initialSaved: SavedReportMeta[];
}) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [contexts, setContexts] = useState<Set<SignalContext>>(() => new Set(initialContexts));

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<SignalContext | null>(null);
  const startRef = useRef(0);

  // Persistence + post-edit actions.
  const [savedReports, setSavedReports] = useState<SavedReportMeta[]>(initialSaved);
  const [savedId, setSavedId] = useState<string | null>(null);   // DB id of the open report
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [resynth, setResynth] = useState(false);

  const selected = SIGNAL_CONTEXT_SLUGS.filter((c) => contexts.has(c));
  const ready = !!from && !!to && from <= to && selected.length > 0;

  // Keep the URL (and the server-rendered data preview) in sync with the controls.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!ready) return;
    const id = setTimeout(() => {
      router.push(`/reports/period?${new URLSearchParams({ from, to, contexts: selected.join(',') }).toString()}`);
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, contexts]);

  // Live elapsed timer while generating.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startRef.current) / 1000)), 250);
    return () => clearInterval(id);
  }, [busy]);

  function toggleContext(c: SignalContext) {
    setContexts((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  const say = (line: string) => setLog((l) => [...l, line]);

  // One context with retry/backoff. Both a thrown rejection and an {ok:false} are treated
  // as a failed attempt — so a single section never aborts the whole run.
  async function runContext(f: string, t: string, context: SignalContext): Promise<SectionResult> {
    let lastErr = 'error';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await generateReportContextAction(f, t, context);
        if (r.ok) return { ok: true, narrative: r.narrative, callout: r.callout };
        lastErr = r.error;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'error';
      }
      if (attempt < MAX_ATTEMPTS) await backoff(attempt);
    }
    return { ok: false, error: lastErr };
  }

  async function generate() {
    if (!ready || busy) return;
    setBusy(true);
    setReport(null);
    setSectionErrors({});
    setLog([]);
    setElapsed(0);
    startRef.current = Date.now();
    const f = from, t = to;

    try {
      // Fetch the data half for the current controls so the assembled report matches.
      say('Assembling report data…');
      const data = await getReportDataAction(f, t, selected);
      const active = data.byContext.filter((g) => g.signals.length > 0).map((g) => g.context);
      const skipped = data.contexts.filter((c) => !active.includes(c));
      skipped.forEach((c) => say(`· ${SIGNAL_CONTEXT_LABEL[c]}: no developments, skipped`));
      say(`Generating ${active.length} context section${active.length === 1 ? '' : 's'}…`);

      // Per-context, bounded concurrency. Collect successes + failures; never abort.
      const narratives: Record<string, string> = {};
      const callouts: Record<string, string | null> = {};
      const errors: Record<string, string> = {};
      const queue = [...active];
      const worker = async () => {
        for (let context = queue.shift(); context; context = queue.shift()) {
          const res = await runContext(f, t, context);
          if (res.ok) {
            narratives[context] = res.narrative;
            if (res.callout) callouts[context] = res.callout;
            say(`✓ ${SIGNAL_CONTEXT_LABEL[context]}`);
          } else { errors[context] = res.error; say(`✗ ${SIGNAL_CONTEXT_LABEL[context]}: ${res.error}`); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL, active.length) }, worker));

      // Synthesis over the full set + the context summaries that succeeded.
      say('Synthesizing macro survey + hypotheses recap…');
      const summaries = active
        .filter((c) => narratives[c])
        .map((c) => ({ context: c, narrative: narratives[c] }));
      let macroSurvey: string | null = null;
      let claimsRecap: string | null = null;
      let reportTitle = '';
      const syn = await synthesizeReportAction(f, t, data.contexts, summaries);
      if (syn.ok) {
        macroSurvey = syn.macroSurvey;
        claimsRecap = syn.claimsRecap;
        reportTitle = syn.title;
        say('✓ synthesis');
      } else { say(`✗ synthesis: ${syn.error}`); }

      // Assemble the full Report and hand it to the editor shell.
      const perContext: Record<string, string | null> = {};
      for (const c of data.contexts) perContext[c] = narratives[c] ?? null;
      setReport({
        ...data,
        generatedAt: new Date().toISOString(),
        narrative: { macroSurvey, perContext, claimsRecap, callouts },
      });
      setSectionErrors(errors);
      setSavedId(null);                       // a fresh generation is unsaved
      setTitle(reportTitle || `Strategy Atlas Report ${f} to ${t}`);   // editorial title from synthesis
      say(`Done in ${Math.round((Date.now() - startRef.current) / 1000)}s.`);
    } catch (e) {
      say(`✗ ${e instanceof Error ? e.message : 'generation failed'}`);
    } finally {
      setBusy(false);
    }
  }

  // Edits from the rich-text fields flow back into the held Report (HTML), so the object
  // Phase 4 exports always reflects the latest text. `key` is 'macroSurvey' | 'claimsRecap'
  // | `context:<slug>`.
  function editSection(key: string, html: string) {
    setReport((prev) => {
      if (!prev) return prev;
      if (key === 'macroSurvey') return { ...prev, narrative: { ...prev.narrative, macroSurvey: html } };
      if (key === 'claimsRecap') return { ...prev, narrative: { ...prev.narrative, claimsRecap: html } };
      if (key.startsWith('context:')) {
        const context = key.slice(8);
        return { ...prev, narrative: { ...prev.narrative, perContext: { ...prev.narrative.perContext, [context]: html } } };
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

  // Retry a single failed context and merge it (narrative + callout) into the report.
  async function retryContext(context: SignalContext) {
    if (retrying || !report) return;
    setRetrying(context);
    const res = await runContext(report.range.from, report.range.to, context);
    setReport((prev) =>
      prev
        ? {
            ...prev,
            narrative: {
              ...prev.narrative,
              perContext: { ...prev.narrative.perContext, [context]: res.ok ? res.narrative : null },
              callouts: { ...prev.narrative.callouts, [context]: res.ok ? (res.callout || null) : null },
            },
          }
        : prev
    );
    setSectionErrors((prev) => {
      const next = { ...prev };
      if (res.ok) delete next[context];
      else next[context] = res.error;
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
    } catch (e) { say(`✗ save: ${e instanceof Error ? e.message : 'error'}`); }
    finally { setSaving(false); }
  }
  async function openSaved(id: string) {
    try {
      const r = await getSavedReportAction(id);
      if (!r) { await refreshSaved(); return; }
      setReport(r.report);
      setTitle(r.title);
      setSavedId(r.id);
      setSectionErrors({});
      setLog([]);
    } catch (e) { say(`✗ open: ${e instanceof Error ? e.message : 'error'}`); }
  }
  async function deleteSaved(id: string) {
    try {
      await deleteReportAction(id);
      if (id === savedId) setSavedId(null);
      await refreshSaved();
    } catch { /* ignore */ }
  }

  // Re-run synthesis from the CURRENT (edited) section narratives so the macro survey +
  // recap stay consistent after hand-edits/retries — without regenerating the sections.
  async function resynthesize() {
    if (!report || resynth) return;
    setResynth(true);
    try {
      const summaries = report.contexts
        .filter((c) => report.narrative.perContext[c])
        .map((c) => ({ context: c, narrative: report.narrative.perContext[c] as string }));
      const syn = await synthesizeReportAction(report.range.from, report.range.to, report.contexts, summaries);
      if (syn.ok) {
        setReport((prev) =>
          prev
            ? { ...prev, narrative: { ...prev.narrative, macroSurvey: syn.macroSurvey, claimsRecap: syn.claimsRecap } }
            : prev
        );
        if (syn.title) setTitle(syn.title);   // refresh the editorial title from the new summary
      } else { say(`✗ re-synthesis: ${syn.error}`); }
    } catch (e) { say(`✗ re-synthesis: ${e instanceof Error ? e.message : 'error'}`); }
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
          <label>Contexts</label>
          <div className="lens-chip-row">
            {SIGNAL_CONTEXT_SLUGS.map((c) => {
              const on = contexts.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  className="lenschip"
                  data-on={on ? '' : undefined}
                  onClick={() => toggleContext(c)}
                  style={
                    on
                      ? {
                          color: SIGNAL_CONTEXT_COLOR[c],
                          borderColor: `color-mix(in oklab, ${SIGNAL_CONTEXT_COLOR[c]} 45%, var(--line))`,
                          background: `color-mix(in oklab, ${SIGNAL_CONTEXT_COLOR[c]} 10%, var(--surface))`,
                        }
                      : undefined
                  }
                >
                  {SIGNAL_CONTEXT_LABEL[c]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn btn--primary"
            onClick={generate}
            disabled={!ready || busy}
            style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
          >
            {busy ? `Generating… ${elapsed}s` : 'Generate report'}
          </button>
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            {!ready
              ? 'Pick a valid range and at least one context.'
              : 'One analyst pass per context, then a synthesis pass, written as a senior strategy analyst.'}
          </span>
        </div>

        {log.length > 0 && (
          <pre
            role="status"
            aria-live="polite"
            className="text-xs"
            style={{
              margin: 0, padding: 10, whiteSpace: 'pre-wrap',
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius)', color: 'var(--dim)', fontFamily: 'var(--font-mono)',
            }}
          >
            {log.join('\n')}
          </pre>
        )}
      </div>

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
            sectionErrors={sectionErrors}
            onRetryContext={retryContext}
            retrying={retrying}
          />
          {/* Off-screen print layout (portaled to <body>); window.print() renders it. */}
          <ReportPrint report={report} title={title} />
        </>
      )}
    </>
  );
}
