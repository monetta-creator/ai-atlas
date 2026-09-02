import type { SourceTierStats, SourceTierRow } from '@/lib/data';

// Read-only "Source reliability" card for the /scan and /intel History &
// health sections (migration 0052): tier distribution, the kind breakdown,
// the rule-rated vs model-rated split, and the recently model-rated domains
// list. No actions here; the source_tiers table is written by the engines'
// once-per-domain rating pass (lib/scan/source-rating.ts), never by hand.
const panel = {
  background: 'var(--surface)', borderColor: 'var(--line)',
} as const;

const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1 · primary',
  2: 'Tier 2',
  3: 'Tier 3',
  4: 'Tier 4 · junk',
};

export default function SourceReliabilityPanel({
  stats, recent, days,
}: {
  stats: SourceTierStats;
  recent: SourceTierRow[];
  days: number;
}) {
  const tierCounts = new Map<number | null, number>(stats.byTier.map((r) => [r.tier, r.items]));
  const unrated = tierCounts.get(null) ?? 0;
  const ratedTotal = stats.modelRated + stats.ruleRated;

  return (
    <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
      <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 4 }}>
        Source reliability · last {days} days
      </div>
      <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 10 }}>
        Reliability is derived from the source, not the text. Kevin does not tune it by hand.
      </div>

      <div
        style={{
          display: 'grid', gap: 'var(--gap, 10px)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        }}
      >
        {([1, 2, 3, 4] as const).map((t) => (
          <div key={t} className="rounded-[var(--radius)] border p-3" style={panel}>
            <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>{TIER_LABEL[t]}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
              {(tierCounts.get(t) ?? 0).toLocaleString()}
            </div>
          </div>
        ))}
        <div className="rounded-[var(--radius)] border p-3" style={panel}>
          <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>Unrated</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
            {unrated.toLocaleString()}
          </div>
        </div>
      </div>

      {stats.byKind.length > 0 && (
        <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 10 }}>
          {stats.byKind.map((k) => `${k.kind ?? 'unrated'} ${k.items}`).join(' · ')}
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 6 }}>
        {ratedTotal > 0
          ? `${stats.ruleRated.toLocaleString()} rule-rated · ${stats.modelRated.toLocaleString()} model-rated (${Math.round((stats.modelRated / ratedTotal) * 100)}%)`
          : 'No stamped items in this window yet.'}
      </div>

      {recent.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
            Recently model-rated domains · {recent.length}
          </summary>
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>domain</th>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>tier</th>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>kind</th>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>reason</th>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.domain} style={{ color: 'var(--dim)' }}>
                    <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>
                      {r.domain}
                    </td>
                    <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>{r.tier}</td>
                    <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>{r.kind}</td>
                    <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>{r.reason ?? '–'}</td>
                    <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--line)' }}>
                      {r.created_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
