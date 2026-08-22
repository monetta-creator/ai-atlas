'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  buildHypothesisPackAction, generateHypothesisSectionsAction, generateHypothesisBottomLineAction,
  saveHypothesisReportAction, deleteHypothesisReportAction, setHypothesisStatusAction, deleteHypothesisAction,
} from '@/lib/actions';
import type { HypothesisSectionsOut } from '@/lib/hypothesis/generate';
import type { HypothesisPack, HypothesisReportMeta } from '@/lib/types';
import { dateLabel } from '@/lib/format';
import HypothesisStatsView from './HypothesisStatsView';

// The run console for one hypothesis. ONE primary action ("Generate report") chains the
// whole pipeline client-side: build the deterministic evidence pack, then the two
// citation-gated model legs, each still its own ≤60s server action with retries. A
// failed leg resumes from where it stopped (the pack is deterministic and cached in
// state), never from scratch. The stepper shows where the run is; SAVE stays a
// deliberate separate act (freezing an immutable public run is the human gate).
// The zero-AI floor lives on as a small ghost button: build + save the pack only.

const MAX_ATTEMPTS = 3;
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, attempt * 1500));

async function withRetry<T extends { ok: boolean }>(fn: () => Promise<T>): Promise<T> {
  let last: T | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      last = await fn();
      if (last.ok) return last;
    } catch (e) {
      last = { ok: false, error: e instanceof Error ? e.message : 'error' } as unknown as T;
    }
    if (attempt < MAX_ATTEMPTS) await backoff(attempt);
  }
  return last as T;
}

type StepKey = 'pack' | 'sections' | 'bottom';
const STEPS: { key: StepKey; label: string; running: string }[] = [
  { key: 'pack', label: 'Evidence pack', running: 'Building evidence pack…' },
  { key: 'sections', label: 'Cited narrative', running: 'Writing cited narrative…' },
  { key: 'bottom', label: 'Bottom line', running: 'Writing bottom line…' },
];

function Prose({ html }: { html: string }) {
  // Server-gated HTML only (enforceCitations runs before any HTML reaches this client).
  return <div className="report-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function HypothesisConsole({
  hypothesis,
  initialReports,
}: {
  hypothesis: { id: string; statement: string; status: string };
  initialReports: HypothesisReportMeta[];
}) {
  const router = useRouter();
  const [pack, setPack] = useState<HypothesisPack | null>(null);
  const [sections, setSections] = useState<HypothesisSectionsOut | null>(null);
  const [bottom, setBottom] = useState<{ bottomLineHtml: string; dropped: string[] } | null>(null);
  const [title, setTitle] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [runningStep, setRunningStep] = useState<StepKey | null>(null);
  const [failedAt, setFailedAt] = useState<StepKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [reports, setReports] = useState<HypothesisReportMeta[]>(initialReports);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const busy = runningStep !== null || saving;
  const say = (line: string) => setLog((l) => [...l, line]);

  // The one pipeline. `from` lets a failed run resume at the broken leg; a fresh
  // run (from 'pack') clears everything downstream first.
  async function run(from: StepKey) {
    if (busy) return;
    setFailedAt(null);
    if (from === 'pack') {
      setPack(null);
      setSections(null);
      setBottom(null);
      setSavedId(null);
      setLog([]);
    }
    let p = pack;
    try {
      if (from === 'pack' || !p) {
        setRunningStep('pack');
        say('Building evidence pack (deterministic, no AI)…');
        const r = await buildHypothesisPackAction(hypothesis.id);
        if (!r.ok) {
          say(`✗ pack: ${r.error}`);
          setFailedAt('pack');
          return;
        }
        p = r.pack;
        setPack(p);
        say(`✓ pack: ${p.stats.matched} of ${p.stats.scanned} signals matched`);
      }

      let sec = sections;
      if (from !== 'bottom' || !sec) {
        setRunningStep('sections');
        say('Writing cited narrative…');
        const r = await withRetry(() => generateHypothesisSectionsAction(hypothesis.id, p!));
        if (!r.ok) {
          say(`✗ narrative: ${r.error}`);
          setFailedAt('sections');
          return;
        }
        sec = r.sections;
        setSections(sec);
        if (sec.dropped.length) say(`· citation gate stripped: ${sec.dropped.join(', ')}`);
        say('✓ narrative');
      }

      setRunningStep('bottom');
      say('Writing bottom line + title…');
      const bl = await withRetry(() =>
        generateHypothesisBottomLineAction(hypothesis.id, p!, {
          readingMd: sec!.readingMd,
          counterweightMd: sec!.counterweightMd,
        })
      );
      if (!bl.ok) {
        say(`✗ bottom line: ${bl.error}`);
        setFailedAt('bottom');
        return;
      }
      setBottom({ bottomLineHtml: bl.bottomLineHtml, dropped: bl.dropped });
      if (bl.dropped.length) say(`· citation gate stripped: ${bl.dropped.join(', ')}`);
      setTitle(bl.title || 'Hypothesis report');
      say('✓ done. Review below, then save to mint the public link.');
    } finally {
      setRunningStep(null);
    }
  }

  // The zero-AI floor: just the deterministic pack, previewed for saving as-is.
  async function buildPackOnly() {
    if (busy) return;
    setFailedAt(null);
    setSections(null);
    setBottom(null);
    setSavedId(null);
    setLog([]);
    setRunningStep('pack');
    say('Building evidence pack (deterministic, no AI)…');
    try {
      const r = await buildHypothesisPackAction(hypothesis.id);
      if (!r.ok) {
        say(`✗ pack: ${r.error}`);
        setFailedAt('pack');
        return;
      }
      setPack(r.pack);
      say(`✓ pack: ${r.pack.stats.matched} of ${r.pack.stats.scanned} signals matched. Save to publish it without narrative.`);
    } finally {
      setRunningStep(null);
    }
  }

  async function save() {
    if (!pack || busy) return;
    setSaving(true);
    try {
      const r = await saveHypothesisReportAction({
        hypothesisId: hypothesis.id,
        title: title || 'Hypothesis report',
        pack,
        narrative: {
          reading: sections?.readingHtml || null,
          counterweight: sections?.counterweightHtml || null,
          bottomLine: bottom?.bottomLineHtml || null,
        },
      });
      setSavedId(r.id);
      setReports((prev) => [
        { id: r.id, hypothesis_id: hypothesis.id, title: title || 'Hypothesis report', generated_at: pack.generated_at, matched: pack.stats.matched },
        ...prev,
      ]);
      say(`✓ saved: /hypothesis-report/${r.id}`);
      router.refresh();
    } catch (e) {
      say(`✗ save: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeReport(id: string) {
    if (!window.confirm('Delete this saved report? Its public link will stop working.')) return;
    try {
      await deleteHypothesisReportAction(id, hypothesis.id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      if (savedId === id) setSavedId(null);
      router.refresh();
    } catch (e) {
      say(`✗ delete: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  async function toggleRetired() {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      await setHypothesisStatusAction(hypothesis.id, hypothesis.status === 'retired' ? 'active' : 'retired');
      router.refresh();
    } finally {
      setStatusBusy(false);
    }
  }

  async function removeHypothesis() {
    if (!window.confirm('Delete this hypothesis and ALL its saved reports? Public links will stop working.')) return;
    const fd = new FormData();
    fd.set('id', hypothesis.id);
    await deleteHypothesisAction(fd);
    router.push('/map');
  }

  const stepState = (key: StepKey): 'done' | 'running' | 'failed' | 'todo' => {
    if (runningStep === key) return 'running';
    if (failedAt === key) return 'failed';
    if (key === 'pack' && pack) return 'done';
    if (key === 'sections' && sections) return 'done';
    if (key === 'bottom' && bottom) return 'done';
    return 'todo';
  };
  const STEP_GLYPH = { done: '✓', running: '●', failed: '✗', todo: '○' } as const;
  const STEP_COLOR = {
    done: 'var(--accent)',
    running: 'var(--ink)',
    failed: 'var(--heat-4)',
    todo: 'var(--faint-ink)',
  } as const;

  const currentStep = runningStep ? STEPS.find((s) => s.key === runningStep) : null;
  const primaryLabel = currentStep
    ? currentStep.running
    : failedAt
      ? `Retry from ${STEPS.find((s) => s.key === failedAt)?.label.toLowerCase()}`
      : bottom
        ? 'Regenerate report'
        : 'Generate report';
  const publicUrl = savedId ? `/hypothesis-report/${savedId}` : null;

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        {/* Stepper: one pipeline, visible progress. */}
        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 13 }}>
          {STEPS.map((s, i) => {
            const st = stepState(s.key);
            return (
              <span key={s.key} className="flex items-center gap-2">
                {i > 0 && <span style={{ color: 'var(--faint-ink)' }}>→</span>}
                <span style={{ color: STEP_COLOR[st] }}>
                  <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)' }}>{STEP_GLYPH[st]}</span>{' '}
                  {s.label}
                </span>
              </span>
            );
          })}
          <span className="flex items-center gap-2">
            <span style={{ color: 'var(--faint-ink)' }}>→</span>
            <span style={{ color: savedId ? 'var(--accent)' : 'var(--faint-ink)' }}>
              <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)' }}>{savedId ? '✓' : '○'}</span>{' '}
              Saved
            </span>
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => run(failedAt && pack ? failedAt : 'pack')}
            disabled={busy}
            style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
          >
            {primaryLabel}
          </button>
          {sections ? (
            <button type="button" className="btn" onClick={save} disabled={busy || !pack}>
              {saving ? 'Saving…' : savedId ? 'Save again as a new run' : 'Save report · mint public link'}
            </button>
          ) : pack && !runningStep ? (
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
          <HypothesisStatsView stats={pack.stats} delta={pack.delta} />
          {pack.signals.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--dim)', lineHeight: 1.6 }}>
              {pack.signals.slice(0, 12).map((s) => (
                <li key={s.id}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{s.tag}</span>{' '}
                  <Link href={`/signals/${s.id}`} style={{ color: 'var(--ink)' }}>{s.title}</Link>
                  {' · '}{s.published_at ?? 'undated'} · {s.direction ?? 'untyped'}
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
            <label htmlFor="hypothesis-report-title">Report title</label>
            <input
              id="hypothesis-report-title"
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
                <Link href={`/hypothesis-report/${r.id}`} style={{ color: 'var(--accent)' }}>{r.title}</Link>
                {' · '}{dateLabel(r.generated_at) ?? r.generated_at.slice(0, 10)} · {r.matched} signals
                {' · '}
                <a href={`/hypothesis-report/${r.id}/pdf`} style={{ color: 'var(--accent)', fontSize: 12 }}>PDF</a>
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
        <button type="button" className="btn" onClick={toggleRetired} disabled={statusBusy}>
          {hypothesis.status === 'retired' ? 'Reactivate hypothesis' : 'Retire hypothesis'}
        </button>
        <button
          type="button"
          className="btn"
          style={{ color: 'var(--heat-4)' }}
          onClick={removeHypothesis}
        >
          Delete hypothesis
        </button>
      </div>
    </div>
  );
}
