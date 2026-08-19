import Link from 'next/link';
import { SIGNAL_LENS_LABEL, signalLensColor } from '@/lib/format';
import type { Report, ReportRates } from '@/lib/types';

// Phase-1 live data preview: renders the DATA half of a Report assembled by the real data
// layer (no AI). This is the proof that the queries return real, scoped rows; Phase 2
// replaces it with the generated narrative + the editor. Server component (no client JS).

const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`);

const RATE_LABELS: { key: keyof ReportRates; label: string }[] = [
  { key: 'triagePass', label: 'Triage pass' },
  { key: 'analysisConversion', label: 'Analysis conv.' },
  { key: 'discoveryToSignal', label: 'Discovery→signal' },
  { key: 'draftToPublished', label: 'Draft→published' },
];

export default function ReportPreview({ report }: { report: Report }) {
  const { range, signals, touches, metrics, byLens } = report;
  const o = metrics.overall.counts;

  return (
    <section style={{ marginTop: 20 }}>
      <div className="section-label">
        Appendices · underlying data · {range.from} → {range.to} · {report.lenses.length} lens
        {report.lenses.length === 1 ? '' : 'es'}
      </div>

      {/* Headline counts */}
      <div
        className="flex flex-wrap gap-x-6 gap-y-2 rounded-[var(--radius)] border p-[var(--card-pad)]"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', fontSize: 13, color: 'var(--dim)' }}
      >
        <Stat n={signals.length} label="published signals" />
        <Stat n={touches.length} label="touched claims" />
        <Stat n={o.candidates} label="candidates discovered" />
        <Stat n={o.drafted} label="drafted" />
        <Stat n={o.published} label="published from cohort" />
      </div>

      {/* Overall rates */}
      <div className="flex flex-wrap gap-4" style={{ marginTop: 10 }}>
        {RATE_LABELS.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-[var(--radius)] border"
            style={{
              background: 'var(--surface)', borderColor: 'var(--line)',
              padding: '10px 14px', minWidth: 130,
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink)' }}>
              {pct(metrics.overall.rates[key])}
            </div>
            <div style={{ fontSize: 11, color: 'var(--faint-ink)' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Per-lens funnel */}
      <div className="section-label" style={{ marginTop: 18 }}>Per-lens funnel</div>
      <div className="flex flex-col gap-1">
        {metrics.perLens.map(({ lens, funnel }) => (
          <div
            key={lens}
            className="flex items-center flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
          >
            <span style={{ color: signalLensColor(lens), fontWeight: 600, minWidth: 150 }}>
              {SIGNAL_LENS_LABEL[lens]}
            </span>
            <span>{funnel.counts.candidates} found</span>
            <span>· {funnel.counts.approved} approved</span>
            <span>· {funnel.counts.drafted} drafted</span>
            <span>· {funnel.counts.published} published</span>
            <span style={{ marginLeft: 'auto', color: 'var(--faint-ink)' }}>
              pass {pct(funnel.rates.triagePass)} · conv {pct(funnel.rates.analysisConversion)}
            </span>
          </div>
        ))}
      </div>

      {/* Touched claims */}
      <div className="section-label" style={{ marginTop: 18 }}>
        Touched claims &amp; bridge-claims ({touches.length})
      </div>
      {touches.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
          No claims touched by signals in this range.
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

      {/* By-lens grouping summary (Phase-2 generation input) */}
      <div className="section-label" style={{ marginTop: 18 }}>By-lens signal grouping (Phase-2 input)</div>
      <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 12, color: 'var(--faint-ink)' }}>
        {byLens.map((g) => (
          <span key={g.lens}>
            <span style={{ color: signalLensColor(g.lens) }}>{SIGNAL_LENS_LABEL[g.lens]}</span>: {g.signals.length}
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
