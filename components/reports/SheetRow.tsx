'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setSheetPublishedAction, deleteSheetAction } from '@/lib/actions';
import { SIGNAL_LENS_LABEL, SHEET_KIND_LABEL, dateLabel } from '@/lib/format';
import type { GeneratedReportMeta, SignalLens } from '@/lib/types';

// One generated-report row on the portal. Clicking the container expands a
// preview first (the bottom line as a text abstract + the pack's deterministic
// stats + the coverage note), with "Read the full report" as the explicit next
// click. PDF for everyone the list shows it to; publish/unpublish/delete for
// the admin (publishing is the human gate that makes the report public). The
// preview payload is guest-safe by construction, like the pack itself.
export default function SheetRow({ meta, admin }: { meta: GeneratedReportMeta; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const subjectLabel =
    meta.kind === 'lens' ? SIGNAL_LENS_LABEL[meta.subject as SignalLens] ?? meta.subject :
    meta.kind === 'atlas' ? 'Whole Atlas' : meta.subject;
  const scope = meta.scope_from || meta.scope_to
    ? `${meta.scope_from ?? 'start'} to ${meta.scope_to ?? 'now'}`
    : 'full corpus';

  // The deterministic stat line, per kind (claim/bridge carry evidence stats,
  // lens carries signal stats + code coverage, atlas carries map health).
  const chips: string[] = [];
  const s = meta.stats;
  if (s?.evidence) {
    chips.push(`${s.evidence.total} evidence: ${s.evidence.supports} support / ${s.evidence.contradicts} contradict / ${s.evidence.neutral} neutral`);
    if (s.signals?.total !== undefined) chips.push(`${s.signals.total} signals`);
    if (s.evidence.oneSided) chips.push('⚠ one-sided');
  } else if (s?.signals) {
    const d = s.signals.byDirection;
    chips.push(`${s.signals.total} signals: ${d.supports} support / ${d.contradicts} contradict / ${d.neutral} neutral${d.untyped > 0 ? ` / ${d.untyped} no direction` : ''}`);
    if (s.codes !== undefined) chips.push(`${s.codes} claims covered`);
  } else if (meta.health) {
    const h = meta.health;
    chips.push(`${h.claims} claims · ${h.bridges} bridges · ${h.evidence} evidence rows · ${h.signalsPublished} signals`);
    if (h.uncovered > 0) chips.push(`${h.uncovered} uncovered`);
    if (h.oneSided > 0) chips.push(`${h.oneSided} one-sided`);
  }
  const evidenceWindow = s?.signals?.firstPublished && s?.signals?.lastPublished
    ? `evidence spans ${s.signals.firstPublished.slice(0, 10)} to ${s.signals.lastPublished.slice(0, 10)}`
    : null;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="plate"
      style={{ cursor: 'pointer' }}
      onClick={() => setOpen((o) => !o)}
      role="button"
      aria-expanded={open}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <div style={{ flex: 1, minWidth: 260 }}>
          <span style={{ fontWeight: 600, fontSize: 15.5, color: 'var(--ink)' }}>
            <span aria-hidden="true" style={{ color: 'var(--faint-ink)', fontSize: 11, marginRight: 8 }}>
              {open ? '▾' : '▸'}
            </span>
            {meta.title}
          </span>
          <div className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            {SHEET_KIND_LABEL[meta.kind]}{subjectLabel ? ` · ${subjectLabel}` : ''} · {scope}
            {dateLabel(meta.generated_at) ? ` · ${dateLabel(meta.generated_at)}` : ''}
            {admin && !meta.is_published ? ' · draft' : ''}
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <a href={`/reports/sheet/${meta.id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
          {admin && (
            <>
              <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                onClick={() => void act(() => setSheetPublishedAction(meta.id, !meta.is_published))}>
                {meta.is_published ? 'Unpublish' : 'Publish'}
              </button>
              <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                onClick={() => {
                  if (window.confirm('Delete this report? This cannot be undone.')) {
                    void act(() => deleteSheetAction(meta.id));
                  }
                }}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: 'auto', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {meta.abstract && (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--dim)', lineHeight: 1.55 }}>
              <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: 8 }}>
                Bottom line
              </span>
              {meta.abstract}
            </p>
          )}
          {chips.length > 0 && (
            <p className="text-xs" style={{ margin: 0, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
              {chips.join(' · ')}
              {evidenceWindow ? ` · ${evidenceWindow}` : ''}
            </p>
          )}
          {meta.stats?.corpusNote && (
            <p className="text-xs" style={{ margin: 0, color: 'var(--faint-ink)' }}>
              {meta.stats.corpusNote}
            </p>
          )}
          <p style={{ margin: '2px 0 0' }}>
            <Link href={`/reports/sheet/${meta.id}`} className="btn btn--primary btn--sm">
              Read the full report
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
