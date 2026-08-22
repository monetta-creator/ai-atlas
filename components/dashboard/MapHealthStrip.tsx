import Link from 'next/link';
import type { MapHealth } from '@/lib/types';

// The almanac index strip (Console Broadsheet): one bordered row of big headline
// numerals with mono small-cap labels, replacing the six stat tiles. Public
// structural counts; `contested` is admin-only and only present when personal
// (so it self-gates). Cells link out only where a public destination exists;
// the evidence-shape cells went plain when /landscape retired (2026-08-13).
// Styles: .bs-index* in app/styles/home.css.
function Cell({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: string }) {
  const body = (
    <>
      <span className="bs-index-n" style={tone ? { color: tone } : undefined}>{value}</span>
      <span className="bs-index-l">{label}</span>
    </>
  );
  if (!href) return <span className="bs-index-cell">{body}</span>;
  return <Link href={href} className="bs-index-cell">{body}</Link>;
}

export default function MapHealthStrip({ health }: { health: MapHealth }) {
  return (
    <div className="bs-index">
      <Cell label="Hypotheses" value={health.hypotheses} href="/map" />
      <Cell label="Evidence items" value={health.evidence} />
      <Cell label="Published signals" value={health.signalsPublished} href="/signals" />
      <Cell label="Uncovered" value={health.uncovered} tone={health.uncovered ? 'var(--heat-3)' : undefined} />
      <Cell label="One-sided" value={health.oneSided} tone={health.oneSided ? 'var(--heat-2)' : undefined} />
      {health.contested != null && (
        <Cell label="Contested" value={health.contested} href="/map" tone="var(--heat-2)" />
      )}
    </div>
  );
}
