import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import type { ToolingModelStat } from '@/lib/data';

// The enrichment model A/B, grouped by enriched_by: quality proxies (average
// fit, average feature count) alongside latency from ai_cost_log. Pure
// presentation, so this stays a plain (non-client) component.
export default function ToolingModelAb({ stats }: { stats: ToolingModelStat[] }) {
  if (stats.length === 0) return null;
  const modelLabel = new Map(SCAN_ENRICH_MODELS.map((m) => [m.id, m.label]));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
            <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>model</th>
            <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>products</th>
            <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg fit</th>
            <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg features</th>
            <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg ms</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((m) => (
            <tr key={m.model} style={{ color: 'var(--dim)' }}>
              <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>
                {modelLabel.get(m.model) ?? m.model}
              </td>
              <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.count}</td>
              <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgFit ?? '–'}</td>
              <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgFeatureCount ?? '–'}</td>
              <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgWallMs ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
