import type { QuestionSummary, SummaryMetrics } from '@/lib/types';

function Section({ label, children }: { label: string; children: string }) {
  if (!children?.trim()) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <span className="lbl" style={{ fontSize: 10 }}>{label}</span>
      <p style={{ margin: '5px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
        {children}
      </p>
    </div>
  );
}

function MetricsStrip({ m }: { m: SummaryMetrics }) {
  const items = [
    `${m.claims} claims`,
    `${m.bridges} bridge${m.bridges === 1 ? '' : 's'}`,
    `${m.stances} stances`,
    `${m.contested} contested`,
    `${m.evidence_total} evidence (${m.supporting}+ / ${m.contradicting}−)`,
    `${m.claims_without_evidence} unsupported`,
    `${m.one_sided} one-sided`,
  ];
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1" style={{ fontSize: 11, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
      {items.map((t, i) => (
        <span key={i}>{t}{i < items.length - 1 ? ' ·' : ''}</span>
      ))}
    </div>
  );
}

export default function QuestionSummaryView({
  summary,
  metrics,
}: {
  summary: QuestionSummary;
  metrics?: SummaryMetrics;
}) {
  return (
    <div>
      {summary.headline && (
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, lineHeight: 1.35, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '0 0 12px' }}>
          {summary.headline}
        </p>
      )}
      {metrics && <div style={{ marginBottom: 16 }}><MetricsStrip m={metrics} /></div>}
      <Section label="Overall state">{summary.overall_state}</Section>
      <Section label="Claims & bridge-claims">{summary.claims_overview}</Section>
      <Section label="Interdependencies">{summary.interdependencies}</Section>
      <Section label="Evidence">{summary.evidence_summary}</Section>
      <Section label="Falsifiability: what would settle it">{summary.falsifiability}</Section>
      <Section label="Patterns & gaps">{summary.patterns_and_gaps}</Section>
    </div>
  );
}
