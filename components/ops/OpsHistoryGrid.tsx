import type { OpsHistoryRow, OpsCellState } from '@/lib/data/ops';

// The 14-day history grid: jobs as rows, days as columns. The ScanCalendar
// contribution-calendar idiom (app/scan) doesn't generalize across jobs (its
// fields are scan-specific), so this is a plain per-job row of colored cells
// instead, same status-color vocabulary (completed/failed/off/none).

function cellTitle(job: string, day: string, state: OpsCellState): string {
  switch (state) {
    case 'completed': return `${job}, ${day}: completed`;
    case 'failed': return `${job}, ${day}: failed or stalled`;
    case 'off': return `${job}, ${day}: not scheduled`;
    default: return `${job}, ${day}: no run`;
  }
}

export default function OpsHistoryGrid({ rows }: { rows: OpsHistoryRow[] }) {
  if (!rows.length) return null;
  const days = rows[0].cells.map((c) => c.day);
  return (
    <div className="ops-history">
      <div className="ops-history-scroll">
        <table className="ops-history-table">
          <thead>
            <tr>
              <th scope="col">Job</th>
              {days.map((d) => (
                <th scope="col" key={d}>
                  {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {row.cells.map((c) => (
                  <td key={c.day}>
                    <span
                      className="ops-hist-cell"
                      data-state={c.state}
                      title={cellTitle(row.label, c.day, c.state)}
                      aria-label={cellTitle(row.label, c.day, c.state)}
                      tabIndex={0}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ops-history-legend">
        <span><span className="ops-hist-cell" data-state="completed" /> completed</span>
        <span><span className="ops-hist-cell" data-state="failed" /> failed</span>
        <span><span className="ops-hist-cell" data-state="off" /> not scheduled</span>
        <span><span className="ops-hist-cell" data-state="none" /> no run</span>
      </div>
    </div>
  );
}
