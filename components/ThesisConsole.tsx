'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  buildThesisPackAction, generateThesisSectionsAction, generateThesisBottomLineAction,
  saveThesisReportAction, deleteThesisReportAction, setThesisStatusAction, deleteThesisAction,
} from '@/lib/actions';
import type { ThesisSectionsOut } from '@/lib/thesis/generate';
import type { ThesisPack, ThesisReportMeta } from '@/lib/types';
import { dateLabel } from '@/lib/format';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { FeatureStats, StepSpec, UiJob } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';
import ThesisStatsView from './ThesisStatsView';

// The run console for one thesis. ONE primary action ("Generate report") chains the
// whole pipeline client-side: build the deterministic evidence pack, then the two
// citation-gated model legs, each still its own ≤60s server action with retries. A
// failed leg resumes from where it stopped (the pack is deterministic and cached in
// state), never from scratch. The stepper shows where the run is; SAVE stays a
// deliberate separate act (freezing an immutable public run is the human gate).
// The zero-AI floor lives on as a small ghost button: build + save the pack only.

// The chain, declared once: the shared run panel's stepper, its running
// sentences, and the ai_cost_log features behind the usual time and cost.
const STEPS: StepSpec[] = [
  { key: 'pack', label: 'Evidence pack', running: 'Matching signals to the thesis (deterministic, no AI)…' },
  { key: 'sections', label: 'Cited narrative', running: 'Writing the cited narrative and the counterweight…', features: ['thesis_sections'] },
  { key: 'bottom', label: 'Bottom line', running: 'Writing the bottom line and the title…', features: ['thesis_bottom_line'] },
];

function Prose({ html }: { html: string }) {
  // Server-gated HTML only (enforceCitations runs before any HTML reaches this client).
  return <div className="report-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function ThesisConsole({
  thesis,
  initialReports,
  stats,
  initialJob,
}: {
  thesis: { id: string; statement: string; status: string };
  initialReports: ThesisReportMeta[];
  stats?: FeatureStats | null;
  initialJob?: UiJob | null;
}) {
  const router = useRouter();
  const [pack, setPack] = useState<ThesisPack | null>(null);
  const [sections, setSections] = useState<ThesisSectionsOut | null>(null);
  const [bottom, setBottom] = useState<{ bottomLineHtml: string; dropped: string[] } | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [reports, setReports] = useState<ThesisReportMeta[]>(initialReports);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  // The one pipeline, on the shared run hook: a retry resumes at the step
  // that failed with the pack and narrative already built kept (they live in
  // this component's state), never from scratch.
  const run = useModelRun({
    kind: 'thesis',
    subject: thesis.id,
    label: `Thesis report: ${thesis.statement.slice(0, 80)}`,
    steps: STEPS,
    stats,
    initialJob,
    run: async (ctx, from) => {
      if (!from || from === 'pack') {
        setPack(null); setSections(null); setBottom(null); setSavedId(null); setSaveNote(null);
      }
      let p = from && from !== 'pack' ? pack : null;
      if (!p) {
        const r = await ctx.step('pack', () => buildThesisPackAction(thesis.id));
        if (!r.ok) throw new Error(r.error);
        p = r.pack;
        setPack(p);
        ctx.note(`✓ Pack: ${p.stats.matched} of ${p.stats.scanned} signals matched`);
      }
      const packNow = p;
      let sec = from === 'bottom' ? sections : null;
      if (!sec) {
        const r = await ctx.step('sections', () => generateThesisSectionsAction(thesis.id, packNow));
        if (!r.ok) throw new Error(r.error);
        sec = r.sections;
        setSections(sec);
        if (sec.dropped.length) ctx.note(`· The citation gate stripped: ${sec.dropped.join(', ')}`);
      }
      const secNow = sec;
      const bl = await ctx.step('bottom', () =>
        generateThesisBottomLineAction(thesis.id, packNow, { readingMd: secNow.readingMd, counterweightMd: secNow.counterweightMd })
      );
      if (!bl.ok) throw new Error(bl.error);
      setBottom({ bottomLineHtml: bl.bottomLineHtml, dropped: bl.dropped });
      if (bl.dropped.length) ctx.note(`· The citation gate stripped: ${bl.dropped.join(', ')}`);
      setTitle(bl.title || 'Thesis report');
      return { note: '✓ Done. Review the report below, then save it to mint the public link.' };
    },
  });

  const busy = run.status === 'running' || saving;

  // The zero-AI floor: just the deterministic pack, previewed for saving as-is.
  async function buildPackOnly() {
    if (busy) return;
    setSections(null);
    setBottom(null);
    setSavedId(null);
    setSaveNote(null);
    setSaving(true);
    try {
      const r = await buildThesisPackAction(thesis.id);
      if (!r.ok) { setSaveNote(`✗ Pack: ${r.error}`); return; }
      setPack(r.pack);
      setSaveNote(`✓ Pack: ${r.pack.stats.matched} of ${r.pack.stats.scanned} signals matched. Save to publish it without narrative.`);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!pack || busy) return;
    setSaving(true);
    try {
      const r = await saveThesisReportAction({
        thesisId: thesis.id,
        title: title || 'Thesis report',
        pack,
        narrative: {
          reading: sections?.readingHtml || null,
          counterweight: sections?.counterweightHtml || null,
          bottomLine: bottom?.bottomLineHtml || null,
        },
      });
      setSavedId(r.id);
      setReports((prev) => [
        { id: r.id, thesis_id: thesis.id, title: title || 'Thesis report', generated_at: pack.generated_at, matched: pack.stats.matched },
        ...prev,
      ]);
      setSaveNote(`✓ Saved: /thesis-report/${r.id}`);
      router.refresh();
    } catch (e) {
      setSaveNote(`✗ Save: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeReport(id: string) {
    if (!window.confirm('Delete this saved report? Its public link will stop working.')) return;
    try {
      await deleteThesisReportAction(id, thesis.id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      if (savedId === id) setSavedId(null);
      router.refresh();
    } catch (e) {
      setSaveNote(`✗ Delete: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  async function toggleArchived() {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      await setThesisStatusAction(thesis.id, thesis.status === 'archived' ? 'active' : 'archived');
      router.refresh();
    } finally {
      setStatusBusy(false);
    }
  }

  async function removeThesis() {
    if (!window.confirm('Delete this thesis and ALL its saved reports? Public links will stop working.')) return;
    await deleteThesisAction(thesis.id);
    router.push('/theses');
  }

  const primaryLabel = run.status === 'running'
    ? 'Generating'
    : run.status === 'failed'
      ? `Retry from ${(STEPS.find((s) => s.key === run.failedKey)?.label ?? 'the failed step').toLowerCase()}`
      : bottom
        ? 'Regenerate report'
        : 'Generate report';
  const publicUrl = savedId ? `/thesis-report/${savedId}` : null;

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void (run.status === 'failed' ? run.retry() : run.start())}
            disabled={busy}
          >
            {run.status === 'running' && <span className="spinner mr-btn-spin" aria-hidden="true" />}
            {primaryLabel}
          </button>
          {sections ? (
            <button type="button" className="btn" onClick={save} disabled={busy || !pack}>
              {saving ? 'Saving…' : savedId ? 'Save again as a new run' : 'Save report · mint public link'}
            </button>
          ) : pack && run.status !== 'running' ? (
            <button type="button" className="btn" onClick={save} disabled={busy}>
              {saving ? 'Saving…' : 'Save evidence pack only'}
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={buildPackOnly} disabled={busy}>
              Build pack only (no AI)
            </button>
          )}
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            Facts are deterministic; the narrative is regenerable prose over the frozen pack.
          </span>
        </div>

        <ModelRunPanel run={run} />
        {saveNote && <p className="text-sm" style={{ margin: 0, color: 'var(--dim)' }}>{saveNote}</p>}

        {publicUrl && (
          <p style={{ margin: 0, fontSize: 13 }}>
            Public link:{' '}
            <Link href={publicUrl} style={{ color: 'var(--accent)' }}>{publicUrl}</Link>
            {' · '}
            <button
              type="button"
              className="btn"
              style={{ padding: '2px 10px', fontSize: 12 }}
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${publicUrl}`)}
            >
              Copy full URL
            </button>
            {' · '}
            <a href={`${publicUrl}/pdf`} className="btn" style={{ padding: '2px 10px', fontSize: 12 }}>
              Download the PDF
            </a>
          </p>
        )}
      </div>

      {pack && (
        <section>
          <div className="section-label">Evidence pack</div>
          <ThesisStatsView stats={pack.stats} delta={pack.delta} />
          {pack.signals.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--dim)', lineHeight: 1.6 }}>
              {pack.signals.slice(0, 12).map((s) => (
                <li key={s.id}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{s.tag}</span>{' '}
                  <Link href={`/signals/${s.id}`} style={{ color: 'var(--ink)' }}>{s.title}</Link>
                  {' · '}{s.published_at ?? 'undated'} · {s.stance}
                </li>
              ))}
              {pack.signals.length > 12 && (
                <li style={{ color: 'var(--faint-ink)' }}>and {pack.signals.length - 12} more in the pack</li>
              )}
            </ul>
          )}
        </section>
      )}

      {sections && (
        <section className="flex flex-col gap-3">
          <div className="field">
            <label htmlFor="thesis-report-title">Report title</label>
            <input
              id="thesis-report-title"
              className="input"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <div className="section-label">What the signals show</div>
            <Prose html={sections.readingHtml} />
          </div>
          <div>
            <div className="section-label">The other read and what is missing</div>
            <Prose html={sections.counterweightHtml} />
          </div>
          {bottom && (
            <div>
              <div className="section-label">Bottom line</div>
              <Prose html={bottom.bottomLineHtml} />
            </div>
          )}
        </section>
      )}

      <section>
        <div className="section-label">Saved runs ({reports.length})</div>
        {reports.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--faint-ink)' }}>
            No saved reports yet. Generate, review, and save to mint a public link.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--dim)', lineHeight: 1.7 }}>
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/thesis-report/${r.id}`} style={{ color: 'var(--accent)' }}>{r.title}</Link>
                {' · '}{dateLabel(r.generated_at) ?? r.generated_at.slice(0, 10)} · {r.matched} signals
                {' · '}
                <a href={`/thesis-report/${r.id}/pdf`} style={{ color: 'var(--accent)', fontSize: 12 }}>PDF</a>
                {' · '}
                <button
                  type="button"
                  onClick={() => removeReport(r.id)}
                  style={{ border: 'none', background: 'none', color: 'var(--heat-4)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center gap-3 flex-wrap" style={{ fontSize: 13 }}>
        <button type="button" className="btn" onClick={toggleArchived} disabled={statusBusy}>
          {thesis.status === 'archived' ? 'Unarchive thesis' : 'Archive thesis'}
        </button>
        <button
          type="button"
          className="btn"
          style={{ color: 'var(--heat-4)' }}
          onClick={removeThesis}
        >
          Delete thesis
        </button>
      </div>
    </div>
  );
}
