import Link from 'next/link';
import { SIGNAL_CONTEXT_LABEL, signalContextColor } from '@/lib/format';
import type { Report } from '@/lib/types';

// Phase-1 live data preview: renders the DATA half of a Report assembled by the real data
// layer (no AI). This is the proof that the queries return real, scoped rows; Phase 2
// replaces it with the generated narrative + the editor. Server component (no client JS).

export default function ReportPreview({ report }: { report: Report }) {
  const { range, signals, touches, byContext } = report;

  return (
    <section style={{ marginTop: 20 }}>
      <div className="section-label">
        Appendices · underlying data · {range.from} → {range.to} · {report.contexts.length} context
        {report.contexts.length === 1 ? '' : 's'}
      </div>

      {/* Headline counts */}
      <div
        className="flex flex-wrap gap-x-6 gap-y-2 rounded-[var(--radius)] border p-[var(--card-pad)]"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', fontSize: 13, color: 'var(--dim)' }}
      >
        <Stat n={signals.length} label="published signals" />
        <Stat n={touches.length} label="touched hypotheses" />
      </div>

      {/* Touched hypotheses */}
      <div className="section-label" style={{ marginTop: 18 }}>
        Touched hypotheses ({touches.length})
      </div>
      {touches.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
          No hypotheses touched by signals in this range.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {touches.map((t) => (
            <div
              key={t.code}
              className="flex items-baseline gap-2 text-sm rounded-[var(--radius)] border p-2.5"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
            >
              {t.unresolved ? (
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--heat-4)' }} title="Code no longer resolves">
                  {t.code} ⚠
                </span>
              ) : (
                <Link href={t.href} style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                  {t.code}
                </Link>
              )}
              <span style={{ flex: 1, color: 'var(--ink)' }}>{t.statement}</span>
              <span style={{ color: 'var(--faint-ink)', whiteSpace: 'nowrap' }}>
                {t.signal_count} signal{t.signal_count === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* By-context grouping summary (Phase-2 generation input) */}
      <div className="section-label" style={{ marginTop: 18 }}>By-context signal grouping (Phase-2 input)</div>
      <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 12, color: 'var(--faint-ink)' }}>
        {byContext.map((g) => (
          <span key={g.context}>
            <span style={{ color: signalContextColor(g.context) }}>{SIGNAL_CONTEXT_LABEL[g.context]}</span>: {g.signals.length}
          </span>
        ))}
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink)' }}>{n}</span>
      <span style={{ fontSize: 12, color: 'var(--faint-ink)' }}>{label}</span>
    </span>
  );
}
