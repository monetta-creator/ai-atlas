import Link from 'next/link';
import type { ToolingRun } from '@/lib/types';

// Run history: kind, day, status, step, counters, cost, notes (folded under
// a <details>, since a busy run's notes can run long), and a link to the
// week's saved entrants report once it exists. Pure presentation, no
// interactivity beyond the native <details> toggle, so this stays a plain
// (non-client) component the console page renders directly.
export default function ToolingRunsTable({ runs }: { runs: ToolingRun[] }) {
  if (runs.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>No runs yet.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {runs.map((r) => (
        <div
          key={r.id}
          className="flex items-center flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
        >
          <span className="touch-chip" style={{ fontSize: 10, padding: '2px 8px' }}>{r.kind}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{r.day}</span>
          <span
            style={{
              color:
                r.status === 'failed' ? 'var(--heat-4)'
                : r.status === 'completed' ? 'var(--supports)'
                : 'var(--dim)',
            }}
          >
            · {r.status} ({r.step})
          </span>
          <span style={{ marginLeft: 'auto' }}>
            found {r.found_count} · inserted {r.inserted_count} · hydrated {r.hydrated_count} ·
            enriched {r.enriched_count} · scored {r.scored_count} · cataloged {r.cataloged_count} ·
            deep dives {r.deep_dived_count} · events {r.event_count}
            {typeof r.cost_usd === 'number' ? ` · $${r.cost_usd.toFixed(2)}` : ''}
          </span>
          {r.report_id && (
            <Link href={`/reports/sheet/${r.report_id}`} className="touch-chip" style={{ fontSize: 11, padding: '2px 9px' }}>
              Report
            </Link>
          )}
          {r.notes.length > 0 && (
            <details style={{ width: '100%' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--faint-ink)' }}>
                {r.notes.length} note{r.notes.length === 1 ? '' : 's'}
              </summary>
              <div style={{ marginTop: 6, display: 'grid', gap: 2 }}>
                {r.notes.map((n, i) => <div key={i}>{n}</div>)}
              </div>
            </details>
          )}
          {r.error && <span style={{ color: 'var(--heat-4)', width: '100%' }}>{r.error}</span>}
        </div>
      ))}
    </div>
  );
}
