import { getLobbyStats } from '@/lib/data';

export default async function AtlasStats() {
  let stats: Awaited<ReturnType<typeof getLobbyStats>>;
  try {
    stats = await getLobbyStats();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  const cells: { n: number; label: string; sub?: string }[] = [
    { n: stats.claims, label: 'claims' },
    {
      n: stats.signalsPublished, label: 'signals',
      sub: stats.signalsWeek > 0 ? `+${stats.signalsWeek} this week` : undefined,
    },
    { n: stats.theses, label: 'theses' },
    { n: stats.papersTracked, label: 'papers' },
    { n: stats.threads, label: 'threads' },
  ];
  return (
    <>
      <div className="lw-head">Atlas by the numbers</div>
      <div className="lw-statgrid">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="lw-big">{c.n}</div>
            <div className="lw-sub">{c.label}</div>
            {c.sub && <div className="lw-sub">{c.sub}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
